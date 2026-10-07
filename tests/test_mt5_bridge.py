import unittest
from types import SimpleNamespace

from mt5_bridge import calculate_partial_close_volume, mt5_rates_to_candles


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


class Mt5CandleConversionTests(unittest.TestCase):
    def test_orders_rates_and_marks_only_the_current_bar_incomplete(self) -> None:
        rates = [
            {"time": 120, "open": 2, "high": 4, "low": 1, "close": 3, "tick_volume": 20},
            {"time": 60, "open": 1, "high": 3, "low": 0.5, "close": 2, "tick_volume": 10},
        ]
        candles = mt5_rates_to_candles(rates)
        self.assertEqual([candle["time"] for candle in candles], [60, 120])
        self.assertEqual([candle["complete"] for candle in candles], [True, False])
        self.assertEqual(candles[0]["volume"], 10.0)

    def test_removes_the_broker_clock_offset_from_candle_times(self) -> None:
        rates = [
            {"time": 10_800, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "tick_volume": 12},
        ]
        candles = mt5_rates_to_candles(rates, 10_800)
        self.assertEqual(candles[0]["time"], 0)


if __name__ == "__main__":
    unittest.main()
