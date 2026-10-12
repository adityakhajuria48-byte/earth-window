"""Command-line benchmark for AETHER's normalized-difference kernel."""
from __future__ import annotations

import argparse
import json
import platform
import statistics
import time

import numpy as np

from .engine import normalized_difference


def run_benchmark(size: int, repeats: int, backend: str) -> dict:
    if size < 1:
        raise ValueError("--size must be >= 1")
    if repeats < 1:
        raise ValueError("--repeats must be >= 1")

    rng = np.random.default_rng(20261012)
    band_a = rng.random((size, size), dtype=np.float32)
    band_b = rng.random((size, size), dtype=np.float32)

    device = "cpu"
    torch_version = None
    if backend == "torch":
        try:
            import torch
        except ImportError as exc:
            raise SystemExit(
                "Torch backend requested. Install PyTorch using the official selector."
            ) from exc
        device = "cuda" if torch.cuda.is_available() else "cpu"
        torch_version = torch.__version__

    # Warm-up: initializes libraries and CUDA kernels before timing.
    normalized_difference(band_a, band_b, backend=backend)
    timings = []
    for _ in range(repeats):
        start = time.perf_counter()
        normalized_difference(band_a, band_b, backend=backend)
        timings.append(time.perf_counter() - start)

    median_seconds = statistics.median(timings)
    megapixels = (size * size) / 1_000_000
    return {
        "project": "AETHER",
        "operation": "normalized_difference",
        "backend": backend,
        "device": device,
        "array_shape": [size, size],
        "pixels": size * size,
        "repeats": repeats,
        "latency_seconds_median": median_seconds,
        "latency_seconds_all": timings,
        "throughput_megapixels_per_second": (
            megapixels / median_seconds if median_seconds > 0 else None
        ),
        "python": platform.python_version(),
        "numpy": np.__version__,
        "torch": torch_version,
        "seed": 20261012,
        "notes": "Includes host-device transfer for the Torch backend; compare identical hardware and conditions.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(prog="aether", description="AETHER raster-kernel tools")
    subparsers = parser.add_subparsers(dest="command", required=True)
    bench = subparsers.add_parser("benchmark", help="benchmark normalized difference")
    bench.add_argument("--size", type=int, default=2048, help="square array width/height")
    bench.add_argument("--repeats", type=int, default=5)
    bench.add_argument("--backend", choices=("numpy", "torch"), default="numpy")
    args = parser.parse_args()

    if args.command == "benchmark":
        print(json.dumps(run_benchmark(args.size, args.repeats, args.backend), indent=2))


if __name__ == "__main__":
    main()
