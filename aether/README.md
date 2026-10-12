# AETHER — Accelerated Earth Observation Engine

AETHER is a research-grade prototype for reproducible, accelerated satellite-raster analysis. It is being developed alongside Earth Window, without changing the existing application.

## First milestone

The MVP provides:
- backend-neutral normalized-difference indices (NumPy baseline, optional PyTorch CPU/CUDA backend);
- threshold-based change masks and simple quality metrics;
- a repeatable benchmark that records hardware/backend, array size, latency and throughput;
- a small test suite for numerical correctness and edge cases.

**Important:** this MVP is a benchmarkable processing kernel, not yet a production satellite platform. It does not claim a speedup until benchmarks are run on specific hardware. Benchmark outputs must include the environment and numerical tolerance.

## Setup

Python 3.10+ is recommended. From the repository root:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -e ".[test]"
```

For PyTorch CPU support, install a compatible PyTorch build separately from the official PyTorch selector. For NVIDIA GPU tests, install a PyTorch build compatible with your CUDA driver/runtime, then verify `torch.cuda.is_available()`.

## Run

```bash
python -m aether.cli benchmark --size 2048 --repeats 5 --backend numpy
python -m aether.cli benchmark --size 2048 --repeats 5 --backend torch
python -m pytest aether/tests -q
```

The Torch backend automatically uses CUDA when available; otherwise it uses CPU and reports that device. The benchmark includes warm-up runs and synchronizes CUDA before timing.

## Engineering rules

1. Compare identical inputs and operations across backends.
2. Report median latency and effective megapixels/second; never report a speedup without measured results.
3. Record device, Python/library versions and array dimensions.
4. Keep a correct NumPy baseline and test numerical equivalence.
5. Treat thresholds as application parameters, not universal scientific truths.

## Roadmap

1. **MVP:** numerical kernels, tests and reproducible benchmarks.
2. **Raster I/O:** read/write GeoTIFF while preserving CRS, transform and nodata.
3. **Real workload:** compare CPU and GPU on representative Sentinel/Landsat scenes.
4. **Optimization:** profile bottlenecks before adding CUDA-specific code.
5. **Customer validation:** test a concrete workflow with Earth-observation users before claiming commercial value.

AETHER's long-term thesis is to make large-scale Earth-observation AI more efficient. That is a hypothesis to validate, not a claim of product-market fit or acquisition interest.
