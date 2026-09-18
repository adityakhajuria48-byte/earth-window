"""Georeferencing, calibration, range-boundary and API safeguards; no live providers."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import crops

try:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
except ImportError:
    rasterio = None

Q = {"source": "s2", "item": "example", "asset": "red", "band": 1, "bbox": [10.02, 19.94, 10.06, 19.98]}
ITEM = {"id": "example", "collection": "sentinel-2-l2a", "properties": {"datetime": "2024-01-02T03:04:05Z"}}


class RequestTests(unittest.TestCase):
    def test_invalid_extent_and_band(self):
        for patch_data in ({"bbox": [179, 0, -179, 1]}, {"bbox": [0, 0, 3, 1]}, {"bbox": [0, 0, float("nan"), 1]}, {"band": True}, {"band": 0}, {"item": ""}):
            with self.subTest(patch_data=patch_data), self.assertRaises(ValueError):
                crops.parameters({**Q, **patch_data})

    def test_url_allowlist(self):
        for href in ("file:///etc/passwd", "https://localhost/a.tif", "https://data.inpe.br.evil.test/a.tif", "https://x@data.inpe.br/a.tif", "https://data.inpe.br:8080/a.tif", "https://data.inpe.br/a.vrt"):
            with self.subTest(href=href), self.assertRaises(ValueError): crops.safe_asset(href)

    def test_resolve_uses_catalogue_not_client_url(self):
        scene = {**ITEM, "assets": {"red": {"href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/red.tif"}}}
        with patch("app.upstream_json", return_value=scene) as fetch:
            q, item, asset, href = crops.resolve({**Q, "href": "http://localhost/private"})
        self.assertEqual(href, scene["assets"]["red"]["href"])
        self.assertIn("/collections/sentinel-2-l2a/items/example", fetch.call_args.args[0])

    def test_protected_or_wrong_scene_rejected(self):
        with self.assertRaises(ValueError): crops.resolve({**Q, "source": "s1-slc"})
        with patch("app.upstream_json", return_value={**ITEM, "id": "wrong"}), self.assertRaises(ValueError): crops.resolve(Q)

    def test_range_refuses_whole_file_and_excess_bytes(self):
        response = io.BytesIO(b"x")
        response.status, response.headers = 200, {}
        with patch.object(crops, "build_opener") as factory:
            factory.return_value.open.return_value = response
            with self.assertRaisesRegex(OSError, "transfer failed"):
                crops.RangeFile("https://data.inpe.br/a.tif", [0])
        with self.assertRaisesRegex(OSError, "transfer failed"):
            crops.RangeFile("https://data.inpe.br/a.tif", [crops.MAX_BYTES])


@unittest.skipIf(rasterio is None, "Install requirements-raster.txt to validate raster exports")
class RasterTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.source = Path(self.folder.name) / "source.tif"
        self.output = Path(self.folder.name) / "crop.tif"
        self.values = np.arange(100, dtype="uint16").reshape(10, 10)
        self.values[3, 3] = 0
        with rasterio.open(self.source, "w", driver="GTiff", width=10, height=10, count=1, dtype="uint16", crs="EPSG:4326", transform=from_origin(10, 20, .01, .01), nodata=0) as src:
            src.write(self.values, 1)
            src.scales, src.offsets = (.0001,), (-.2,)
            src.set_band_unit(1, "reflectance")

    def test_native_pixels_transform_mask_and_calibration(self):
        # Bounds slightly inside exact pixel edges to avoid floating point boundary ambiguity.
        q = {**Q, "bbox": [10.020001, 19.940001, 10.059999, 19.979999]}
        with rasterio.open(self.source) as src: crops.write_crop(src, self.output, q, ITEM, {})
        with rasterio.open(self.output) as out:
            np.testing.assert_array_equal(out.read(1), self.values[2:6, 2:6])
            self.assertEqual(out.crs.to_epsg(), 4326)
            self.assertEqual(out.transform, from_origin(10.02, 19.98, .01, .01))
            self.assertEqual(out.scales, (.0001,))
            self.assertEqual(out.offsets, (-.2,))
            self.assertEqual(out.units, ("reflectance",))
            self.assertEqual(out.read_masks(1)[1, 1], 0)
            self.assertEqual(out.tags()["SOURCE_ITEM"], "example")

    def test_catalogue_scale_overrides_format_defaults(self):
        with rasterio.open(self.source) as src:
            crops.write_crop(src, self.output, Q, ITEM, {"raster:bands": [{"scale": .0000275, "offset": -.2}]})
        with rasterio.open(self.output) as out: self.assertEqual(out.scales, (.0000275,))

    def test_no_overlap_and_pixel_limit(self):
        with rasterio.open(self.source) as src:
            with self.assertRaisesRegex(ValueError, "overlap"): crops.write_crop(src, self.output, {**Q, "bbox": [11, 19, 12, 20]}, ITEM, {})
            with patch.object(crops, "MAX_PIXELS", 1), self.assertRaisesRegex(ValueError, "4 million"):
                crops.write_crop(src, self.output, Q, ITEM, {})

    def test_null_catalogue_offset_uses_geotiff_value(self):
        with rasterio.open(self.source) as src:
            crops.write_crop(src, self.output, Q, ITEM, {"eo:bands": [{"scale": .0001, "scale_add": None}]})
        with rasterio.open(self.output) as out:
            self.assertEqual(out.scales, (.0001,))
            self.assertEqual(out.offsets, (-.2,))

    def test_custom_range_opener(self):
        payload = self.source.read_bytes()
        class Response(io.BytesIO):
            status = 206
            def __init__(self, first, last):
                super().__init__(payload[first:last+1]); self.headers = {"Content-Range": f"bytes {first}-{last}/{len(payload)}"}
        def request(req, timeout):
            first, last = map(int, req.headers["Range"].split("=")[1].split("-"))
            return Response(first, min(last, len(payload)-1))
        with patch.object(crops, "resolve", return_value=(Q, ITEM, {}, "https://data.inpe.br/test.tif")), patch.object(crops, "build_opener") as factory:
            factory.return_value.open.side_effect = request
            result = crops.export(Q, self.output)
        self.assertGreater(result["transferred_bytes"], 0)
        with rasterio.open(self.output) as out: self.assertEqual(out.crs.to_epsg(), 4326)


if __name__ == "__main__": unittest.main()
