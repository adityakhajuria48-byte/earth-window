"""Bounded, single-band GeoTIFF crops. Rasterio is an optional dependency."""
from __future__ import annotations

import io
import argparse
import json
import math
import re
import sys
import time
from urllib.parse import quote, urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_PIXELS = 4_000_000
MAX_BYTES = 64 * 1024 * 1024
HOSTS = {
    "data.inpe.br", "sentinel-cogs.s3.us-west-2.amazonaws.com",
    "sentinel-s2-l2a.s3.amazonaws.com", "earth-search-data.s3.amazonaws.com",
    "landsateuwest.blob.core.windows.net", "modiseuwest.blob.core.windows.net",
    "alos.blob.core.windows.net",
}


def parameters(data):
    if not isinstance(data, dict):
        raise ValueError("Expected a crop request.")
    out = {}
    for key in ("source", "item", "asset"):
        value = data.get(key)
        if not isinstance(value, str) or not 1 <= len(value) <= 250 or any(ord(c) < 32 for c in value):
            raise ValueError("Select a source scene and band first.")
        out[key] = value
    band = data.get("band", 1)
    if isinstance(band, bool) or not isinstance(band, int) or not 1 <= band <= 64:
        raise ValueError("Invalid band number.")
    bbox = data.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in bbox):
        raise ValueError("Enter west, south, east and north in decimal degrees.")
    w, s, e, n = bbox
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise ValueError("Bounds must be ordered and cannot cross the date line. Export each side separately.")
    if e - w > 2 or n - s > 2:
        raise ValueError("Choose an area no wider or taller than 2 degrees.")
    return {**out, "band": band, "bbox": bbox}


def safe_asset(href):
    u = urlparse(href or "")
    if u.scheme != "https" or u.hostname not in HOSTS or u.port not in (None, 443) or u.username or u.password or u.fragment:
        raise ValueError("This asset host is not enabled for crop exports. Use its original file.")
    if not u.path.lower().endswith((".tif", ".tiff")):
        raise ValueError("Crop export currently supports GeoTIFF files only.")
    return href


def resolve(data):
    # Asset URLs and calibration come from the catalogue, never from the browser.
    from app import SOURCES, upstream_json
    q = parameters(data)
    source = next((s for s in SOURCES if s["id"] == q["source"]), None)
    if not source or source.get("access") == "account":
        raise ValueError("This archive needs provider access before it can be cropped.")
    base = source["endpoint"].rsplit("/search", 1)[0]
    url = f'{base}/collections/{quote(source["collection"], safe="")}/items/{quote(q["item"], safe="")}'
    item = upstream_json(url)
    if item.get("id") != q["item"] or item.get("collection") != source["collection"]:
        raise ValueError("The catalogue returned a different scene.")
    asset = item.get("assets", {}).get(q["asset"])
    if not isinstance(asset, dict) or asset.get("auth:refs"):
        raise ValueError("This band is unavailable or requires provider authentication.")
    href = safe_asset(asset.get("href"))
    if urlparse(href).hostname.endswith(".blob.core.windows.net"):
        signed = upstream_json("https://planetarycomputer.microsoft.com/api/sas/v1/sign?" + urlencode({"href": href})).get("href")
        safe_asset(signed)
        if urlparse(signed)[:3] != urlparse(href)[:3]:
            raise ValueError("Unexpected asset authorization response.")
        href = signed
    return q, item, asset, href


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("The asset redirected. Use the original provider download.")


class RangeFile(io.RawIOBase):
    """Seekable, bounded HTTP range reader; refuses redirects and whole-file fallbacks."""
    def __init__(self, href, budget, cache=None):
        super().__init__()
        self.href, self.budget, self.pos, self.size = safe_asset(href), budget, 0, None
        if len(budget) == 1: budget.append(time.monotonic())
        if len(budget) == 2: budget.append(False)
        self.cache = cache if cache is not None else {}
        self.http = build_opener(NoRedirects())
        if -1 in self.cache:
            self.size = self.cache[-1]
        else:
            self._range(0, 1)
            self.cache[-1] = self.size

    def _range(self, start, length):
        try:
            return self._fetch(start, length)
        except Exception:
            # Some GDAL opener callbacks log errors instead of propagating them.
            self.budget[2] = True
            raise OSError("Source range transfer failed.") from None

    def _fetch(self, start, length):
        if time.monotonic() - self.budget[1] > 75:
            raise ValueError("Crop transfer timed out. Try a smaller area or download the original.")
        if length > MAX_BYTES - self.budget[0]:
            raise ValueError("Crop transfer limit reached. Try a smaller area or download the original.")
        req = Request(self.href, headers={"Range": f"bytes={start}-{start+length-1}", "Accept-Encoding": "identity", "User-Agent": "EarthWindow/1.0"})
        with self.http.open(req, timeout=15) as response:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
            if response.status != 206 or not match or int(match[1]) != start:
                raise ValueError("This provider does not support bounded range downloads.")
            total = int(match[3])
            if self.size is not None and total != self.size:
                raise ValueError("The source file changed during export. Please retry.")
            self.size = total
            raw = response.read(length + 1)
            self.budget[0] += len(raw)
            if len(raw) != min(length, total - start) or int(match[2]) != start + len(raw) - 1:
                raise ValueError("Incomplete source data received. Please retry.")
            return raw

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, offset, whence=0):
        pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset if whence == 2 else -1
        if pos < 0:
            raise ValueError("Invalid raster seek.")
        self.pos = pos
        return pos

    def read(self, size=-1):
        size = self.size - self.pos if size < 0 else min(size, self.size - self.pos)
        if size <= 0: return b""
        end, chunks = self.pos + size, []
        while self.pos < end:
            start = self.pos // 65536 * 65536
            if start not in self.cache:
                if len(self.cache) > 64:
                    del self.cache[next(key for key in self.cache if key != -1)]
                self.cache[start] = self._range(start, min(65536, self.size - start))
            count = min(end - self.pos, len(self.cache[start]) - (self.pos - start))
            chunks.append(self.cache[start][self.pos-start:self.pos-start+count])
            self.pos += count
        return b"".join(chunks)


def write_crop(src, output, q, item, asset):
    """Preserve the native grid and stored values; do not resample or stretch."""
    import numpy as np
    import rasterio
    from rasterio.windows import Window, from_bounds
    from rasterio.warp import transform_bounds
    band = q["band"]
    if not src.crs or src.transform.b or src.transform.d or src.transform.a <= 0 or src.transform.e >= 0:
        raise ValueError("This raster needs a georeferencing workflow not supported by crop export.")
    if band > src.count:
        raise ValueError("The selected band is not present in the raster.")
    bounds = transform_bounds("EPSG:4326", src.crs, *q["bbox"], densify_pts=21)
    if not all(math.isfinite(v) for v in bounds) or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
        raise ValueError("This area cannot be represented on the source grid.")
    win = from_bounds(*bounds, src.transform)
    left, top = max(0, math.floor(win.col_off)), max(0, math.floor(win.row_off))
    right, bottom = min(src.width, math.ceil(win.col_off + win.width)), min(src.height, math.ceil(win.row_off + win.height))
    if right <= left or bottom <= top:
        raise ValueError("The requested area does not overlap this raster.")
    win = Window(left, top, right - left, bottom - top)
    if win.width * win.height > MAX_PIXELS:
        raise ValueError("Crop exceeds 4 million native pixels. Select a smaller area.")
    block_h, block_w = src.block_shapes[band - 1]
    if block_h * block_w * np.dtype(src.dtypes[band - 1]).itemsize * src.count > MAX_BYTES:
        raise ValueError("This raster has oversized storage blocks. Download the original for GIS processing.")
    values = src.read(band, window=win)
    mask = src.read_masks(band, window=win)
    rb = asset.get("raster:bands") or asset.get("eo:bands") or []
    meta = rb[band - 1] if len(rb) >= band else {}
    nodata = src.nodatavals[band - 1]
    if nodata is None and meta.get("nodata") is not None:
        nodata = float(meta["nodata"])
        mask[values == nodata] = 0
    mask[~np.isfinite(values)] = 0
    if not np.any(mask):
        raise ValueError("The crop contains only no-data pixels. Choose another scene or area.")
    scale = meta.get("scale")
    if scale is None: scale = src.scales[band - 1]
    offset = meta.get("offset")
    if offset is None: offset = meta.get("scale_add")
    if offset is None: offset = src.offsets[band - 1]
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (scale, offset)):
        raise ValueError("Invalid band calibration metadata.")
    transform = src.window_transform(win)
    # Explicit profile avoids copying whole-scene statistics or incompatible creation options.
    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
        with rasterio.open(output, "w", driver="GTiff", width=int(win.width), height=int(win.height), count=1,
                           dtype=values.dtype, crs=src.crs, transform=transform, nodata=nodata,
                           compress="deflate", tiled=True, blockxsize=256, blockysize=256) as dst:
            dst.write(values, 1)
            dst.write_mask(mask)
            dst.scales, dst.offsets = (scale,), (offset,)
            dst.set_band_description(1, src.descriptions[band - 1] or q["asset"])
            unit = meta.get("unit") or src.units[band - 1]
            if unit: dst.set_band_unit(1, unit)
            dst.update_tags(SOURCE_COLLECTION=item["collection"], SOURCE_ITEM=item["id"], SOURCE_ASSET=q["asset"],
                            SOURCE_BAND=str(band), SOURCE_TIME=json.dumps({k: v for k, v in item.get("properties", {}).items() if k in ("datetime", "start_datetime", "end_datetime")}),
                            REQUESTED_BBOX_WGS84=json.dumps(q["bbox"]),
                            PROCESSING="Native-grid bounding rectangle, clipped to source extent. Stored values unchanged. No cloud/quality masking. Scale and offset retained as metadata.")
    return {"width": int(win.width), "height": int(win.height), "crs": src.crs.to_string()}


def export(data, output):
    import rasterio
    q, item, asset, href = resolve(data)
    budget = [0]
    cache = {}
    # The custom opener only exposes this one validated asset. No GDAL URL fetching or sidecars.
    def opener(path, mode="rb"):
        if path != "source.tif" or mode not in ("r", "rb"):
            raise FileNotFoundError(path)
        return RangeFile(href, budget, cache)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_CACHEMAX=32 * 1024 * 1024):
        with rasterio.open("source.tif", opener=opener, driver="GTiff") as src:
            if budget[2]: raise ValueError("Source transfer failed. Retry or use the original file.")
            result = write_crop(src, output, q, item, asset)
    if budget[2]: raise ValueError("Source transfer failed. No crop can be used; retry or use the original file.")
    return {**result, "transferred_bytes": budget[0]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", help="Crop request JSON downloaded from Earth Window; otherwise reads stdin")
    parser.add_argument("--output", required=True, help="Destination GeoTIFF path")
    args = parser.parse_args()
    try:
        if args.request:
            with open(args.request, encoding="utf-8") as request_file:
                request = json.load(request_file)
        else:
            request = json.load(sys.stdin)
        result = export(request, args.output)
        print(json.dumps(result))
    except Exception as exc:
        # Raw GDAL/provider errors can contain signed URLs. Only expose our own validation text.
        message = str(exc) if isinstance(exc, ValueError) else "The provider could not supply this crop. Try a smaller area or open the original file."
        print(json.dumps({"error": message}))
        sys.exit(1)
