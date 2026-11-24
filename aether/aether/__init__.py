"""AETHER: accelerated Earth-observation processing primitives."""

from .engine import absolute_change, change_mask, normalized_difference

__all__ = ["absolute_change", "change_mask", "normalized_difference"]
__version__ = "0.1.0"
