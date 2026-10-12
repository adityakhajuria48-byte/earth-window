"""Small, testable kernels for raster analysis.

Arrays are expected to have matching shapes. Nodata handling and geospatial metadata
belong in the raster-I/O layer; callers should mask invalid pixels before using these
kernels.
"""
from __future__ import annotations

from typing import Literal

import numpy as np

Backend = Literal["numpy", "torch"]


def normalized_difference(
    band_a: np.ndarray,
    band_b: np.ndarray,
    *,
    backend: Backend = "numpy",
    epsilon: float = 1e-8,
) -> np.ndarray:
    """Compute (A - B) / (A + B), safely returning zero where denominator is tiny.

    For NDVI, pass NIR as band_a and red as band_b. Inputs must have identical shapes.
    """
    if band_a.shape != band_b.shape:
        raise ValueError("band_a and band_b must have identical shapes")
    if epsilon <= 0:
        raise ValueError("epsilon must be positive")

    if backend == "numpy":
        a = np.asarray(band_a, dtype=np.float32)
        b = np.asarray(band_b, dtype=np.float32)
        denominator = a + b
        out = np.zeros_like(denominator, dtype=np.float32)
        np.divide(a - b, denominator, out=out, where=np.abs(denominator) >= epsilon)
        return out
    if backend == "torch":
        try:
            import torch
        except ImportError as exc:
            raise RuntimeError(
                "PyTorch backend requested. Install a compatible build of torch first."
            ) from exc
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        a = torch.as_tensor(np.asarray(band_a), dtype=torch.float32, device=device)
        b = torch.as_tensor(np.asarray(band_b), dtype=torch.float32, device=device)
        denominator = a + b
        safe = torch.where(
            torch.abs(denominator) >= epsilon,
            (a - b) / torch.where(
                torch.abs(denominator) >= epsilon,
                denominator,
                torch.ones_like(denominator),
            ),
            torch.zeros_like(denominator),
        )
        if device.type == "cuda":
            torch.cuda.synchronize(device)
        return safe.cpu().numpy()
    raise ValueError(f"Unsupported backend: {backend}")


def absolute_change(before: np.ndarray, after: np.ndarray) -> np.ndarray:
    """Return per-pixel absolute difference as float32."""
    if before.shape != after.shape:
        raise ValueError("before and after arrays must have identical shapes")
    return np.abs(
        np.asarray(after, dtype=np.float32) - np.asarray(before, dtype=np.float32)
    )


def change_mask(
    before: np.ndarray,
    after: np.ndarray,
    *,
    threshold: float,
) -> np.ndarray:
    """Return a boolean mask where absolute change is at least threshold."""
    if threshold < 0:
        raise ValueError("threshold must be non-negative")
    return absolute_change(before, after) >= threshold


def change_summary(mask: np.ndarray) -> dict[str, int | float]:
    """Summarize a boolean change mask without assuming a pixel area."""
    values = np.asarray(mask, dtype=bool)
    total = int(values.size)
    changed = int(np.count_nonzero(values))
    return {
        "total_pixels": total,
        "changed_pixels": changed,
        "changed_fraction": (changed / total) if total else 0.0,
    }
