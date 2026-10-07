import unittest
from types import SimpleNamespace

from mt5_bridge import calculate_partial_close_volume


class PartialCloseVolumeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.symbol = SimpleNamespace(volume_step=0.01, volume_min=0.01)

    def test_closes_exact_half_when_broker_step_allows_it(self) -> None:
        self.assertEqual(calculate_partial_close_volume(0.20, 0.20, self.symbol), 0.10)

    def test_rounds_up_to_preserve_break_even_or_better(self) -> None:
        self.assertEqual(calculate_partial_close_volume(0.05, 0.05, self.symbol), 0.03)
        self.assertEqual(calculate_partial_close_volume(0.03, 0.03, self.symbol), 0.02)

    def test_rejects_a_position_that_cannot_be_split(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "cannot be split"):
            calculate_partial_close_volume(0.01, 0.01, self.symbol)


if __name__ == "__main__":
    unittest.main()
