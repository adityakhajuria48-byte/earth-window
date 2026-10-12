# AETHER — Accelerated Earth Observation Engine

AETHER is a research-grade prototype for reproducible satellite-raster analysis. It is being developed alongside Earth Window, without changing the existing application.

## Current MVP

- NumPy baseline for normalized-difference indices and simple change masks.
- Optional PyTorch backend, using CUDA when available.
- Repeatable benchmark with backend, device, array size, latency and throughput metadata.
- Optional GeoTIFF I/O that preserves CRS, transform and nodata masks, and rejects mismatched grids rather than silently resampling.
- Automated numerical tests and optional raster tests.

This is an early engineering prototype, not a production satellite platform. It makes no speedup claim until benchmarks have been run on documented hardware.

## Setup

Python 3.10+ is recommended. From the repository root:

```bash
cd aether
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -e ".[test,raster]"
python -m pytest tests -q
```

For the optional PyTorch backend, install a compatible PyTorch build separately using the official PyTorch installation selector. Check `torch.cuda.is_available()` to confirm CUDA access.

## Run the benchmark

```bash
python -m aether.cli benchmark --size 2048 --repeats 5 --backend numpy
python -m aether.cli benchmark --size 2048 --repeats 5 --backend torch
```

The Torch backend automatically uses CUDA when available, otherwise CPU, and reports the device. Timings include host/device transfer and CUDA synchronization. Compare identical inputs and report hardware/software versions.

## Raster I/O

`aether.raster.read_band(path)` reads a band as a masked float32 array plus its raster profile.

`aether.raster.normalized_difference_from_files(nir_path, red_path)` computes (NIR - red) / (NIR + red), carries invalid-pixel masks forward, and requires both files to share dimensions, coordinate reference system and transform. It deliberately does not silently reproject or resample.

`aether.raster.write_float_raster(path, values, reference_profile)` writes a single-band float GeoTIFF using the reference profile's georeferencing. Masked values are written as nodata.

Example:

```python
from aether.raster import normalized_difference_from_files, write_float_raster

ndvi, profile = normalized_difference_from_files("nir.tif", "red.tif")
write_float_raster("ndvi.tif", ndvi, profile)
```

Band choice is sensor-specific. For Sentinel-2, NIR/red are typically B08/B04; for Landsat 8/9 surface reflectance, NIR/red are typically SR_B5/SR_B4. Verify product naming, scale factors and offsets before scientific use. Inputs must be calibrated and aligned appropriately.

## Engineering rules

1. Keep a correct NumPy baseline and test numerical equivalence.
2. Record device, Python/library versions and array dimensions.
3. Handle nodata explicitly; never interpret missing pixels as real zero-valued observations.
4. Profile bottlenecks before writing CUDA-specific code.
5. Validate scientific outputs against known cases and document limitations.

## Roadmap

1. **MVP:** kernels, tests, benchmarks and optional GeoTIFF I/O.
2. **Real workloads:** representative Sentinel/Landsat scenes with documented calibration.
3. **Performance:** profile and optimize a measured bottleneck.
4. **Product validation:** interview Earth-observation users and test a narrow paid pilot.

AETHER's long-term thesis is to make large-scale Earth-observation AI more efficient. This remains a hypothesis to validate, not a claim of product-market fit or acquisition interest.
