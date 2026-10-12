import numpy as np
import pytest

from aether.engine import (
    absolute_change,
    change_mask,
    change_summary,
    normalized_difference,
)


def test_normalized_difference_known_values():
    a = np.array([[3.0, 1.0], [0.0, 5.0]], dtype=np.float32)
    b = np.array([[1.0, 3.0], [0.0, 5.0]], dtype=np.float32)
    result = normalized_difference(a, b)
    np.testing.assert_allclose(result, [[0.5, -0.5], [0.0, 0.0]], atol=1e-6)


def test_normalized_difference_shape_mismatch():
    with pytest.raises(ValueError):
        normalized_difference(np.ones((2, 2)), np.ones((3, 3)))


def test_normalized_difference_rejects_nonpositive_epsilon():
    with pytest.raises(ValueError):
        normalized_difference(np.ones((1,)), np.ones((1,)), epsilon=0)


def test_absolute_change_and_mask():
    before = np.array([[1, 2], [3, 4]], dtype=np.float32)
    after = np.array([[1, 4], [0, 4]], dtype=np.float32)
    np.testing.assert_allclose(absolute_change(before, after), [[0, 2], [3, 0]])
    np.testing.assert_array_equal(
        change_mask(before, after, threshold=2), [[False, True], [True, False]]
    )


def test_change_mask_rejects_negative_threshold():
    with pytest.raises(ValueError):
        change_mask(np.zeros(2), np.ones(2), threshold=-0.1)


def test_change_summary_empty_and_nonempty():
    assert change_summary(np.array([], dtype=bool)) == {
        "total_pixels": 0,
        "changed_pixels": 0,
        "changed_fraction": 0.0,
    }
    assert change_summary(np.array([[True, False], [True, True]])) == {
        "total_pixels": 4,
        "changed_pixels": 3,
        "changed_fraction": 0.75,
    }
