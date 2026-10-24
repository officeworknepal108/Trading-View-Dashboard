import unittest
from types import SimpleNamespace
from unittest.mock import patch

import mt5_bridge as bridge
from mt5_bridge import calculate_partial_close_volume, mt5_rates_to_candles


class BridgeTestCase(unittest.TestCase):
    def setUp(self) -> None:
        for name, value in (("ACTIVE_ACCOUNT", ("test-account", "test-server")), ("LEGACY_STATE_CHECKED", False)):
            mocked = patch.object(bridge, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        for name, value in (("ensure_mt5_connection", SimpleNamespace(login="test-account", server="test-server")),
                            ("resolve_gold_symbol", "XAUUSD"), ("assert_execution_account", None)):
            mocked = patch.object(bridge, name, return_value=value)
            mocked.start()
            self.addCleanup(mocked.stop)


class PartialCloseVolumeTests(BridgeTestCase):
    def setUp(self) -> None:
        super().setUp()
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


class TradeStyleRiskFreeTests(BridgeTestCase):
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
            bridge.manage_open_signals(intraday, [], {"moveStopToBreakEvenAtR": 1,
                                                    "scalpingEnabled": False, "intradayEnabled": False})
            close_half.assert_not_called()
            update.assert_not_called()

            scalp = {"trade": {**base_record, "tradeStyle": "SCALPING"}}
            bridge.manage_open_signals(scalp, [], {"moveStopToBreakEvenAtR": 1,
                                                 "scalpingEnabled": False, "intradayEnabled": False})
            close_half.assert_called_once()
            self.assertEqual(update.call_args.args[1], "RISK_FREE")


class PendingOrderOneAndHalfRTests(BridgeTestCase):
    def test_uses_executable_quote_and_requires_more_than_one_and_half_r(self) -> None:
        buy = {"direction": "BUY", "entry": 100, "stopLoss": 90}
        sell = {"direction": "SELL", "entry": 100, "stopLoss": 110}
        self.assertFalse(bridge.pending_order_passed_one_and_half_r(buy, SimpleNamespace(bid=115, ask=116)))
        self.assertTrue(bridge.pending_order_passed_one_and_half_r(buy, SimpleNamespace(bid=115.01, ask=116)))
        self.assertFalse(bridge.pending_order_passed_one_and_half_r(sell, SimpleNamespace(bid=84, ask=85)))
        self.assertTrue(bridge.pending_order_passed_one_and_half_r(sell, SimpleNamespace(bid=83, ask=84.99)))

    def test_removes_broker_order_before_reporting_cancellation(self) -> None:
        record = {"status": "PLACED", "direction": "BUY", "symbol": "XAUUSD",
                  "entry": 100, "stopLoss": 90, "brokerTicket": 123}
        state = {"pending": dict(record)}
        with patch.object(bridge.mt5, "orders_get", return_value=[SimpleNamespace(ticket=123)]), \
             patch.object(bridge.mt5, "symbol_info_tick",
                          return_value=SimpleNamespace(bid=115.01, ask=116)), \
             patch.object(bridge.mt5, "order_send",
                          return_value=SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE)) as send, \
             patch.object(bridge, "update_status") as update:
            bridge.manage_open_signals(state, [], {"tradingTimeEnabled": False})
        self.assertNotIn("pending", state)
        self.assertEqual(send.call_args.args[0]["action"], bridge.mt5.TRADE_ACTION_REMOVE)
        self.assertEqual(update.call_args.args[1], "CANCELLED")
        self.assertIn("beyond 1.5R", update.call_args.kwargs["message"])

    def test_failed_broker_removal_keeps_pending_order(self) -> None:
        record = {"status": "PLACED", "direction": "SELL", "symbol": "XAUUSD",
                  "entry": 100, "stopLoss": 110, "brokerTicket": 123}
        state = {"pending": dict(record)}
        with patch.object(bridge.mt5, "orders_get", return_value=[SimpleNamespace(ticket=123)]), \
             patch.object(bridge.mt5, "symbol_info_tick",
                          return_value=SimpleNamespace(bid=83, ask=84.99)), \
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


class BrokerTickFreshnessTests(BridgeTestCase):
    def setUp(self) -> None:
        super().setUp()
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


class TradingTimeDefaultTests(BridgeTestCase):
    def test_outside_session_signals_are_not_blocked_when_setting_is_missing_or_off(self) -> None:
        signal = {"id": "session-default-test", "direction": "BUY", "zoneTimeframe": "M15", "zoneName": "DB"}
        with patch.object(bridge, "is_nepal_trading_time", return_value=False), \
             patch.object(bridge, "ALLOW_LIVE_EXECUTION", False), \
             patch.object(bridge, "update_status") as update, \
             patch.object(bridge.mt5, "order_send") as send:
            for config in ({}, {"tradingTimeEnabled": False}):
                self.assertEqual(bridge.place_signal(signal, config)["status"], "SIMULATED")
                self.assertEqual(update.call_args.args[1], "SIMULATED")
            self.assertEqual(bridge.place_signal(signal, {"tradingTimeEnabled": True})["status"], "REJECTED")
            self.assertEqual(update.call_args.args[1], "REJECTED")
            send.assert_not_called()


class GoldSymbolResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.account = SimpleNamespace(login=123, server="Broker-Live")
        saved = patch.object(bridge, "SYMBOL_CANDIDATES", [])
        saved.start()
        self.addCleanup(saved.stop)

    def symbol(self, name, base="USD", profit="USD", mode=None):
        return SimpleNamespace(name=name, currency_base=base, currency_profit=profit,
                               trade_mode=bridge.mt5.SYMBOL_TRADE_MODE_FULL if mode is None else mode)

    def test_detects_broker_suffixes_without_relying_on_gold_currency_metadata(self) -> None:
        for name in ("XAUUSD", "XAUUSD.x", "XAUUSDm", "GOLD"):
            with self.subTest(name=name), patch.object(bridge.mt5, "symbols_get", return_value=[self.symbol(name)]), \
                 patch.object(bridge.mt5, "symbol_select", return_value=True):
                self.assertEqual(bridge.resolve_gold_symbol({"brokerSymbol": "old"}, self.account), name)

    def test_ignores_disabled_close_only_and_non_usd_symbols(self) -> None:
        symbols = [self.symbol("XAUUSD.x"), self.symbol("XAUEUR", "XAU", "EUR"),
                   self.symbol("XAUUSD.old", mode=bridge.mt5.SYMBOL_TRADE_MODE_DISABLED),
                   self.symbol("XAUUSD.close", mode=bridge.mt5.SYMBOL_TRADE_MODE_CLOSEONLY), self.symbol("EURUSD")]
        with patch.object(bridge.mt5, "symbols_get", return_value=symbols), \
             patch.object(bridge.mt5, "symbol_select", return_value=True):
            self.assertEqual(bridge.resolve_gold_symbol({}, self.account), "XAUUSD.x")

    def test_multiple_symbols_require_a_choice_bound_to_current_account_and_server(self) -> None:
        with patch.object(bridge.mt5, "symbols_get", return_value=[self.symbol("XAUUSD"), self.symbol("XAUUSD.x")]), \
             patch.object(bridge.mt5, "symbol_select", return_value=True) as select:
            for config in ({"brokerSymbol": "XAUUSD"},
                           {"brokerSymbol": "XAUUSD", "brokerSymbolAccount": "999", "brokerSymbolServer": "Broker-Live"},
                           {"brokerSymbol": "XAUUSD", "brokerSymbolAccount": "123", "brokerSymbolServer": "Other"}):
                with self.assertRaisesRegex(RuntimeError, "Multiple"):
                    bridge.resolve_gold_symbol(config, self.account)
            select.assert_not_called()
            self.assertEqual(bridge.resolve_gold_symbol({"brokerSymbol": "XAUUSD.x", "brokerSymbolAccount": "123",
                                                        "brokerSymbolServer": "Broker-Live"}, self.account), "XAUUSD.x")

    def test_missing_symbol_or_selection_failure_blocks_resolution(self) -> None:
        with patch.object(bridge.mt5, "symbols_get", return_value=[]):
            with self.assertRaisesRegex(RuntimeError, "No tradable"):
                bridge.resolve_gold_symbol({}, self.account)
        with patch.object(bridge.mt5, "symbols_get", return_value=[self.symbol("XAUUSD")]), \
             patch.object(bridge.mt5, "symbol_select", return_value=False), \
             patch.object(bridge.mt5, "last_error", return_value=(-1, "test failure")):
            with self.assertRaisesRegex(RuntimeError, "Unable to select"):
                bridge.resolve_gold_symbol({}, self.account)


class AccountConnectionTests(unittest.TestCase):
    def test_account_switch_discards_old_bar_and_tick_caches(self) -> None:
        account = SimpleNamespace(login=222, server="New-Server")
        with patch.object(bridge, "ACTIVE_ACCOUNT", ("111", "Old-Server")), \
             patch.object(bridge.mt5, "terminal_info", return_value=SimpleNamespace(connected=True)), \
             patch.object(bridge.mt5, "account_info", return_value=account), \
             patch.dict(bridge.LAST_MARKET_BAR_TIME, {"M1": 123}, clear=True), \
             patch.dict(bridge.LAST_BROKER_TICK, {"XAUUSD": 456}, clear=True), \
             patch.dict(bridge.LAST_BROKER_TICK_SEEN_AT, {"XAUUSD": 789}, clear=True):
            bridge.ensure_mt5_connection()
            self.assertEqual(bridge.ACTIVE_ACCOUNT, ("222", "New-Server"))
            self.assertEqual(bridge.LAST_MARKET_BAR_TIME, {})
            self.assertEqual(bridge.LAST_BROKER_TICK, {})
            self.assertEqual(bridge.LAST_BROKER_TICK_SEEN_AT, {})

    def test_reconnect_follows_terminal_without_restoring_previous_login(self) -> None:
        account = SimpleNamespace(login=222, server="New-Server")
        with patch.object(bridge, "ACTIVE_ACCOUNT", None), patch.object(bridge, "LAST_RECONNECT_AT", 0), \
             patch.object(bridge.time, "monotonic", return_value=100), \
             patch.object(bridge.mt5, "terminal_info", side_effect=[None, SimpleNamespace(connected=True)]), \
             patch.object(bridge.mt5, "account_info", side_effect=[None, account]), \
             patch.object(bridge.mt5, "shutdown") as shutdown, \
             patch.object(bridge, "initialize_mt5") as initialize:
            self.assertEqual(bridge.ensure_mt5_connection(), account)
            initialize.assert_called_once_with(follow_terminal=True)
            shutdown.assert_called_once()

    def test_account_change_between_order_check_and_send_blocks_order(self) -> None:
        with patch.object(bridge, "ACTIVE_ACCOUNT", ("111", "Broker")), \
             patch.object(bridge.mt5, "terminal_info", return_value=SimpleNamespace(connected=True)), \
             patch.object(bridge.mt5, "account_info", side_effect=[SimpleNamespace(login=111, server="Broker"), SimpleNamespace(login=222, server="Broker")]), \
             patch.object(bridge.mt5, "order_check", return_value=SimpleNamespace(retcode=0)), \
             patch.object(bridge.mt5, "order_send") as send:
            with self.assertRaisesRegex(RuntimeError, "account changed"):
                bridge.send_with_filling_fallback({"symbol": "XAUUSD"})
            send.assert_not_called()


class AccountCycleTests(BridgeTestCase):
    def test_missing_server_candles_are_republished_without_waiting_for_a_new_bar(self) -> None:
        with patch.dict(bridge.LAST_MARKET_BAR_TIME, {"M1": 123, "H4": 456}, clear=True), \
             patch.object(bridge, "heartbeat"), patch.object(bridge, "publish_mt5_market_data", return_value=0) as publish, \
             patch.object(bridge, "manage_open_signals"), patch.object(bridge, "save_state"), \
             patch.object(bridge, "api", return_value={"signal": None}):
            status = {"config": {}, "bridge": {"account": "test-account", "server": "test-server", "brokerSymbol": "XAUUSD"},
                      "marketData": {"timeframes": {"M1": {"count": 0}, "H4": {"count": 0}}}}
            bridge.process_bridge_cycle(status, {}, 0)
            self.assertEqual(bridge.LAST_MARKET_BAR_TIME, {})
            publish.assert_called_once()

    def test_unowned_legacy_state_is_not_adopted_after_the_first_account_sync(self) -> None:
        state = {"legacy": {"status": "ACTIVE"}}
        status = {"config": {}, "bridge": {"account": "old", "server": "old"}}
        with patch.object(bridge, "heartbeat"), patch.object(bridge, "publish_mt5_market_data", return_value=0), \
             patch.object(bridge, "manage_open_signals") as manage, patch.object(bridge, "save_state"), \
             patch.object(bridge, "api", return_value={"signal": None}):
            bridge.process_bridge_cycle(status, state, 0)
            status["bridge"] = {"account": "test-account", "server": "test-server"}
            bridge.process_bridge_cycle(status, state, 0)
            self.assertNotIn("account", state["legacy"])
            self.assertEqual(manage.call_args.args[0], {})

    def test_wrong_symbol_still_reports_account_and_does_not_claim_a_trade(self) -> None:
        with patch.object(bridge, "resolve_gold_symbol", side_effect=RuntimeError("Multiple Gold symbols")), \
             patch.object(bridge, "heartbeat") as heartbeat, patch.object(bridge, "api") as api, \
             patch.object(bridge, "publish_mt5_market_data") as publish:
            bridge.process_bridge_cycle({"config": {}}, {}, 0)
            self.assertEqual(heartbeat.call_args.args[0]["brokerSymbol"], "")
            self.assertIn("Multiple", heartbeat.call_args.kwargs["message"])
            publish.assert_not_called()
            api.assert_not_called()

    def test_old_account_positions_are_not_managed_or_imported(self) -> None:
        state = {"old": {"account": "other", "server": "other", "status": "ACTIVE"},
                 "current": {"account": "test-account", "server": "test-server", "status": "ACTIVE"}}
        with patch.object(bridge, "heartbeat"), patch.object(bridge, "publish_mt5_market_data", return_value=0), \
             patch.object(bridge, "manage_open_signals") as manage, patch.object(bridge, "save_state"), \
             patch.object(bridge, "api", return_value={"signal": None}):
            bridge.process_bridge_cycle({"config": {}, "recentSignals": [{"id": "foreign", "bridgeId": bridge.BRIDGE_ID,
                "account": "other", "server": "other", "status": "ACTIVE"}]}, state, 0)
            self.assertEqual(list(manage.call_args.args[0]), ["current"])
            self.assertEqual(manage.call_args.args[1], [])
            self.assertIn("old", state)
            self.assertNotIn("foreign", state)


if __name__ == "__main__":
    unittest.main()
