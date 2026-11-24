"""Optional GeoTIFF I/O helpers that preserve geospatial metadata."""
from __future__ import annotations
from pathlib import Path
import numpy as np
from .engine import normalized_difference

def _rasterio():
    try:
        import rasterio
    except ImportError as exc:
        raise RuntimeError('GeoTIFF support requires Rasterio. Install with: pip install -e ".[raster]"') from exc
    return rasterio

def read_band(path: str | Path, band: int = 1) -> tuple[np.ma.MaskedArray, dict]:
    """Read one band as float32 masked array plus raster profile."""
    rasterio = _rasterio()
    with rasterio.open(path) as src:
        if band < 1 or band > src.count:
            raise ValueError(f"band must be between 1 and {src.count}")
        values = src.read(band, masked=True).astype("float32")
        profile = src.profile.copy()
    return values, profile

def normalized_difference_from_files(path_a: str | Path, path_b: str | Path, *, band_a: int = 1, band_b: int = 1, epsilon: float = 1e-8) -> tuple[np.ma.MaskedArray, dict]:
    """Compute (A-B)/(A+B), preserving invalid pixels and requiring an identical grid."""
    rasterio = _rasterio()
    a, profile_a = read_band(path_a, band_a)
    b, _ = read_band(path_b, band_b)
    with rasterio.open(path_a) as src_a, rasterio.open(path_b) as src_b:
        same_grid = (src_a.width == src_b.width and src_a.height == src_b.height
                     and src_a.transform == src_b.transform and src_a.crs == src_b.crs)
    if not same_grid:
        raise ValueError("Input rasters must share dimensions, transform and CRS; align them first")
    invalid = np.ma.getmaskarray(a) | np.ma.getmaskarray(b)
    result = normalized_difference(a.filled(0), b.filled(0), epsilon=epsilon)
    return np.ma.array(result, mask=invalid), profile_a

def write_float_raster(path: str | Path, values: np.ndarray | np.ma.MaskedArray, reference_profile: dict, *, nodata: float = -9999.0) -> None:
    """Write one float32 GeoTIFF using a reference profile's georeferencing."""
    rasterio = _rasterio()
    array = np.ma.asarray(values, dtype=np.float32)
    if array.ndim != 2:
        raise ValueError("values must be a 2D single-band array")
    profile = reference_profile.copy()
    expected = (profile.get("height"), profile.get("width"))
    if array.shape != expected:
        raise ValueError(f"array shape {array.shape} does not match profile {expected}")
    profile.update(count=1, dtype="float32", nodata=nodata)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(np.asarray(array.filled(nodata), dtype=np.float32), 1)
