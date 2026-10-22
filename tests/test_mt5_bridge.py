import unittest
from types import SimpleNamespace
from unittest.mock import patch

import mt5_bridge as bridge
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

    def test_intraday_volume_does_not_require_a_partial_close(self) -> None:
        symbol = SimpleNamespace(name="XAUUSD", volume_step=0.01,
                                 volume_min=0.01, volume_max=100)
        signal = {"direction": "BUY", "entry": 100, "stopLoss": 90,
                  "riskPips": 100, "tradeStyle": "INTRADAY"}
        with patch.object(bridge.mt5, "account_info", return_value=SimpleNamespace(equity=4000)), \
             patch.object(bridge.mt5, "order_calc_profit", return_value=-1000):
            self.assertEqual(bridge.calculate_volume(signal, {"riskPercent": 0.25}, symbol), 0.01)
            signal["tradeStyle"] = "SCALPING"
            with self.assertRaisesRegex(RuntimeError, "cannot be split"):
                bridge.calculate_volume(signal, {"riskPercent": 0.25}, symbol)


class TradeStyleRiskFreeTests(unittest.TestCase):
    def test_only_scalping_closes_half_when_price_reaches_one_r(self) -> None:
        position = SimpleNamespace(type=bridge.mt5.POSITION_TYPE_BUY,
                                   price_open=100, sl=90, volume=0.2,
                                   symbol="XAUUSD", ticket=1)
        tick = SimpleNamespace(bid=111, ask=112)
        info = SimpleNamespace(volume_step=0.01)
        base_record = {"status": "ACTIVE", "executionPrice": 100,
                       "initialStopLoss": 90, "riskFree": 110,
                       "riskPips": 100, "volume": 0.2}
        partial = {"partialClosedVolume": 0.1, "remainingVolume": 0.1,
                   "partialClosedAt": 123}
        with patch.object(bridge, "find_position", return_value=position), \
             patch.object(bridge.mt5, "symbol_info_tick", return_value=tick), \
             patch.object(bridge.mt5, "symbol_info", return_value=info), \
             patch.object(bridge, "close_half_position", return_value=partial) as close_half, \
             patch.object(bridge, "update_status") as update:
            intraday = {"trade": {**base_record, "tradeStyle": "INTRADAY"}}
            bridge.manage_open_signals(intraday, [], {"moveStopToBreakEvenAtR": 1})
            close_half.assert_not_called()
            update.assert_not_called()

            scalp = {"trade": {**base_record, "tradeStyle": "SCALPING"}}
            bridge.manage_open_signals(scalp, [], {"moveStopToBreakEvenAtR": 1})
            close_half.assert_called_once()
            self.assertEqual(update.call_args.args[1], "RISK_FREE")


class PendingOrderTwoRTests(unittest.TestCase):
    def test_uses_executable_quote_and_requires_more_than_two_r(self) -> None:
        buy = {"direction": "BUY", "entry": 100, "stopLoss": 90}
        sell = {"direction": "SELL", "entry": 100, "stopLoss": 110}
        self.assertFalse(bridge.pending_order_passed_two_r(buy, SimpleNamespace(bid=120, ask=121)))
        self.assertTrue(bridge.pending_order_passed_two_r(buy, SimpleNamespace(bid=120.01, ask=121)))
        self.assertFalse(bridge.pending_order_passed_two_r(sell, SimpleNamespace(bid=79, ask=80)))
        self.assertTrue(bridge.pending_order_passed_two_r(sell, SimpleNamespace(bid=78, ask=79.99)))

    def test_removes_broker_order_before_reporting_cancellation(self) -> None:
        record = {"status": "PLACED", "direction": "BUY", "symbol": "XAUUSD",
                  "entry": 100, "stopLoss": 90, "brokerTicket": 123}
        state = {"pending": dict(record)}
        with patch.object(bridge.mt5, "orders_get", return_value=[SimpleNamespace(ticket=123)]), \
             patch.object(bridge.mt5, "symbol_info_tick",
                          return_value=SimpleNamespace(bid=120.01, ask=121)), \
             patch.object(bridge.mt5, "order_send",
                          return_value=SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE)) as send, \
             patch.object(bridge, "update_status") as update:
            bridge.manage_open_signals(state, [], {"tradingTimeEnabled": False})
        self.assertNotIn("pending", state)
        self.assertEqual(send.call_args.args[0]["action"], bridge.mt5.TRADE_ACTION_REMOVE)
        self.assertEqual(update.call_args.args[1], "CANCELLED")
        self.assertIn("beyond 2R", update.call_args.kwargs["message"])

    def test_failed_broker_removal_keeps_pending_order(self) -> None:
        record = {"status": "PLACED", "direction": "SELL", "symbol": "XAUUSD",
                  "entry": 100, "stopLoss": 110, "brokerTicket": 123}
        state = {"pending": dict(record)}
        with patch.object(bridge.mt5, "orders_get", return_value=[SimpleNamespace(ticket=123)]), \
             patch.object(bridge.mt5, "symbol_info_tick",
                          return_value=SimpleNamespace(bid=78, ask=79.99)), \
             patch.object(bridge.mt5, "order_send", return_value=SimpleNamespace(retcode=0)), \
             patch.object(bridge, "update_status") as update:
            bridge.manage_open_signals(state, [], {"tradingTimeEnabled": False})
        self.assertIn("pending", state)
        update.assert_not_called()


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


class BrokerTickFreshnessTests(unittest.TestCase):
    def setUp(self) -> None:
        bridge.LAST_BROKER_TICK.clear()
        bridge.LAST_BROKER_TICK_SEEN_AT.clear()

    def test_waits_for_new_tick_then_rejects_quote_that_stops_updating(self) -> None:
        tick = SimpleNamespace(time=10_000, time_msc=10_000_000)
        with patch.object(bridge.mt5, "symbol_info_tick", return_value=tick), \
             patch.object(bridge.time, "time", return_value=10_001):
            with self.assertRaises(bridge.BrokerMarketDataUnavailable):
                bridge.broker_utc_offset_seconds("XAUUSD")
        tick = SimpleNamespace(time=10_002, time_msc=10_002_000)
        with patch.object(bridge.mt5, "symbol_info_tick", return_value=tick), \
             patch.object(bridge.time, "time", return_value=10_003):
            self.assertEqual(bridge.broker_utc_offset_seconds("XAUUSD"), 0)
        with patch.object(bridge.mt5, "symbol_info_tick", return_value=tick), \
             patch.object(bridge.time, "time", return_value=10_124):
            with self.assertRaisesRegex(bridge.BrokerMarketDataUnavailable, "stale"):
                bridge.broker_utc_offset_seconds("XAUUSD")

    def test_recovers_after_broker_tick_clock_resets(self) -> None:
        bridge.LAST_BROKER_TICK["XAUUSD"] = 20_000_000
        bridge.LAST_BROKER_TICK_SEEN_AT["XAUUSD"] = 20_000
        reset_tick = SimpleNamespace(time=10_000, time_msc=10_000_000)
        with patch.object(bridge.mt5, "symbol_info_tick", return_value=reset_tick), \
             patch.object(bridge.time, "time", return_value=10_001):
            with self.assertRaisesRegex(bridge.BrokerMarketDataUnavailable, "Waiting"):
                bridge.broker_utc_offset_seconds("XAUUSD")
        next_tick = SimpleNamespace(time=10_002, time_msc=10_002_000)
        with patch.object(bridge.mt5, "symbol_info_tick", return_value=next_tick), \
             patch.object(bridge.time, "time", return_value=10_003):
            self.assertEqual(bridge.broker_utc_offset_seconds("XAUUSD"), 0)

    def test_large_weekend_offset_stays_unavailable_even_if_tick_changes(self) -> None:
        bridge.LAST_BROKER_TICK["XAUUSD"] = 10_000_000
        bridge.LAST_BROKER_TICK_SEEN_AT["XAUUSD"] = 129_999
        tick = SimpleNamespace(time=10_002, time_msc=10_002_000)
        with patch.object(bridge.mt5, "symbol_info_tick", return_value=tick), \
             patch.object(bridge.time, "time", return_value=130_000):
            with self.assertRaisesRegex(bridge.BrokerMarketDataUnavailable, "outside the safe range"):
                bridge.broker_utc_offset_seconds("XAUUSD")

    def test_weekend_tick_does_not_block_heartbeat_or_claim_a_trade(self) -> None:
        status = {"config": {"brokerSymbol": "XAUUSD"}, "recentSignals": []}
        state: dict[str, dict] = {}
        with patch.object(bridge, "publish_mt5_market_data",
                          side_effect=bridge.BrokerMarketDataUnavailable("Waiting for a new tick.")), \
             patch.object(bridge, "heartbeat") as heartbeat, \
             patch.object(bridge, "manage_open_signals") as manage, \
             patch.object(bridge, "save_state") as save, \
             patch.object(bridge, "api") as api:
            bridge.process_bridge_cycle(status, state, 0)
            self.assertIn("Market data paused", heartbeat.call_args.kwargs["message"])
            manage.assert_not_called()
            api.assert_not_called()
            save.assert_called_once()

    def test_fresh_tick_resumes_normal_signal_handling(self) -> None:
        status = {"config": {"brokerSymbol": "XAUUSD"}, "recentSignals": []}
        with patch.object(bridge, "publish_mt5_market_data", return_value=0), \
             patch.object(bridge, "heartbeat") as heartbeat, \
             patch.object(bridge, "manage_open_signals") as manage, \
             patch.object(bridge, "save_state"), \
             patch.object(bridge, "api", return_value={"signal": None}) as api:
            bridge.process_bridge_cycle(status, {}, 0)
            self.assertEqual(heartbeat.call_args.kwargs["message"], "Bridge ready")
            manage.assert_called_once()
            api.assert_called_once()


if __name__ == "__main__":
    unittest.main()
