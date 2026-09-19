"""Bounded source-pixel previews, sharing the original crop access safeguards."""
import argparse
import json
import sys
import tempfile
from pathlib import Path


def raster_preview(path):
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    with rasterio.open(path) as src:
        ratio = min(1, 512 / max(src.width, src.height))
        width, height = max(1, round(src.width * ratio)), max(1, round(src.height * ratio))
        values = src.read(1, out_shape=(height, width), resampling=Resampling.nearest)
        mask = src.read_masks(1, out_shape=(height, width), resampling=Resampling.nearest) > 0
        mask &= np.isfinite(values)
        if not np.any(mask):
            raise ValueError("No valid pixels in this preview area. Choose another area or band.")
        lo, hi = np.percentile(values[mask], [2, 98])
        return {"width": width, "height": height,
                "data": [float(v) if ok else None for v, ok in zip(values.flat, mask.flat)],
                "lo": float(lo), "hi": float(hi), "bbox": list(src.bounds),
                "epsg": src.crs.to_epsg(), "crs": src.crs.to_string(), "mapSafe": True,
                "processing": "Selected-area source pixels; nearest-neighbour preview, maximum 512 pixels per side. No cloud or quality masking."}


def export(data, output):
    from crops import export as crop_export
    with tempfile.TemporaryDirectory(prefix="earth-window-preview-") as folder:
        crop = Path(folder) / "source.tif"
        crop_export(data, crop)
        result = raster_preview(crop)
        Path(output).write_text(json.dumps(result, allow_nan=False, separators=(",", ":")))
    return {"width": result["width"], "height": result["height"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(export(json.load(sys.stdin), args.output)))
    except Exception as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else "The provider could not supply this preview. Retry or open the original file."}))
        sys.exit(1)
