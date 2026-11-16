import unittest
import json
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
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


class ScalpOneToOneTests(BridgeTestCase):
    def pullback(self, leg=10):
        entry = 99 if leg == 10 else 97.5
        return {"id": f"SCALP_1_1:900:P{leg}", "direction": "BUY", "orderType": "LIMIT",
                "tradeStyle": "SCALP_1_1", "signalTimeframe": "M15", "zoneTimeframe": "M15",
                "zoneName": "Scalp 1:1", "symbol": "XAUUSD", "entry": entry, "stopLoss": 90,
                "takeProfit": 110, "riskPips": (entry - 90) * 10, "rewardRisk": (110 - entry) / (entry - 90),
                "signalAt": 900, "calculatedAt": 1800, "expiresAt": 2700, "scalpSetupRiskBudget": 50,
                "scalpEntry": {"version": 1, "leg": leg, "riskShare": 0.6 if leg == 10 else 0.4,
                               "referenceEntry": 100, "nextOpen": 100, "confirmationBody": 10}}

    def test_two_entries_share_one_frozen_cash_allowance(self):
        config = {"riskPercent": 2, "scalpOneToOneRiskPercent": 1}
        self.assertEqual(bridge.signal_risk_money(self.pullback(10), config, 5000), 30)
        self.assertEqual(bridge.signal_risk_money(self.pullback(25), config, 5000), 20)
        self.assertEqual(bridge.signal_risk_money(self.pullback(25), config, 6000), 20,
                         'equity growth must not enlarge the second allocation')
        self.assertLess(bridge.signal_risk_money(self.pullback(25), config, 4000), 20)
        with self.assertRaisesRegex(RuntimeError, 'risk allocation'):
            bridge.signal_risk_percent({**self.pullback(), 'scalpEntry': {
                **self.pullback()['scalpEntry'], 'riskShare': 1}}, config)
        missing = self.pullback()
        del missing['scalpSetupRiskBudget']
        with self.assertRaisesRegex(RuntimeError, 'budget is missing'):
            bridge.signal_risk_money(missing, config, 5000)

    def test_pullback_validation_preserves_reference_target_and_rejects_repricing(self):
        for leg in [10, 25]:
            bridge.validate_scalp_pullback(self.pullback(leg))
        for change in [{'takeProfit': 108}, {'entry': 100}, {'expiresAt': 2800}, {'orderType': 'MARKET'}]:
            with self.assertRaisesRegex(RuntimeError, 'original fixed SL/TP'):
                bridge.validate_scalp_pullback({**self.pullback(), **change})
        buy = self.pullback()
        sell = {**buy, 'direction': 'SELL', 'entry': 101, 'stopLoss': 110, 'takeProfit': 90}
        bridge.validate_scalp_pullback(sell)

    def test_layered_limit_uses_frozen_target_not_one_r_from_new_entry(self):
        signal = self.pullback()
        self.assertFalse(bridge.pending_order_passed_one_and_half_r(signal, SimpleNamespace(bid=109, ask=109.1)))
        self.assertTrue(bridge.pending_order_passed_one_and_half_r(signal, SimpleNamespace(bid=110, ask=110.1)))

    def test_exact_sell_pullbacks_allow_300_pips_and_keep_original_exits_and_cash_split(self):
        for leg, expected in [(10, 3842.9375), (25, 3844.31375)]:
            signal = self.pullback(leg)
            signal.update(direction='SELL', entry=expected, stopLoss=3867.790, takeProfit=3827.790,
                          riskPips=(3867.790 - expected) * 10,
                          rewardRisk=(expected - 3827.790) / (3867.790 - expected))
            signal['scalpEntry'].update(version=2, referenceEntry=3847.790, nextOpen=3842.020, confirmationBody=9.175)
            bridge.validate_scalp_pullback(signal)
            self.assertEqual(bridge.signal_risk_money(signal, {'scalpOneToOneRiskPercent': 1}, 5000),
                             30 if leg == 10 else 20)

    def test_exact_scalp_limit_includes_300_but_rejects_above_it(self):
        signal = self.pullback()
        signal.update(entry=110, stopLoss=80, takeProfit=120, riskPips=300, rewardRisk=10 / 30)
        signal['scalpEntry'].update(version=2, referenceEntry=100, nextOpen=111)
        bridge.validate_scalp_pullback(signal)
        signal.update(entry=110.01, riskPips=300.1, rewardRisk=9.99 / 30.01)
        signal['scalpEntry']['nextOpen'] = 111.01
        with self.assertRaisesRegex(RuntimeError, 'original fixed SL/TP'):
            bridge.validate_scalp_pullback(signal)

    def test_fast_closed_pullback_recovers_actual_fill_from_broker_deals(self):
        record = {**self.pullback(), 'brokerTicket': 123}
        entered = SimpleNamespace(entry=bridge.mt5.DEAL_ENTRY_IN, price=98.9, volume=0.02, time=1805)
        exited = SimpleNamespace(entry=bridge.mt5.DEAL_ENTRY_OUT, reason=bridge.mt5.DEAL_REASON_TP,
                                 price=110, profit=22.2, swap=0, commission=-0.2, time=1810)
        with patch.object(bridge.mt5, 'history_deals_get', return_value=[entered, exited]):
            details = bridge.closed_trade_details(record, False)
        self.assertEqual(details['status'], 'TP')
        self.assertEqual(details['executionPrice'], 98.9)
        self.assertEqual(details['openedAt'], 1805)
        self.assertEqual(details['closedAt'], 1810)
        self.assertEqual(details['realizedProfit'], 22)

    def test_broker_rounding_never_increases_a_leg_to_the_full_setup_risk(self):
        info = SimpleNamespace(name='XAUUSD', volume_step=0.01, volume_min=0.01, volume_max=100)
        config = {'riskPercent': 2, 'scalpOneToOneRiskPercent': 1}
        def profit(side, symbol, volume, entry, stop):
            return (stop - entry) * volume * 100
        with patch.object(bridge.mt5, 'account_info', return_value=SimpleNamespace(equity=5000)), \
             patch.object(bridge.mt5, 'order_calc_profit', side_effect=profit):
            for leg, allocation in [(10, 30), (25, 20)]:
                signal = self.pullback(leg)
                volume = bridge.calculate_volume(signal, config, info)
                self.assertLessEqual(abs(profit(0, '', volume, signal['entry'], 90)), allocation)
                bridge.checked_live_entry_price(signal, config, info, SimpleNamespace(ask=100, bid=99.9), volume)
            tiny = {**config, 'scalpOneToOneRiskPercent': 0.25}
            with self.assertRaisesRegex(RuntimeError, 'below broker minimum'):
                bridge.calculate_volume(self.pullback(25), tiny, info)

    def test_new_limits_request_broker_enforced_next_bar_expiration(self):
        signal = self.pullback()
        info = SimpleNamespace(name='XAUUSD', trade_tick_size=0.01)
        with patch.object(bridge, 'ALLOW_LIVE_EXECUTION', True), \
             patch.object(bridge, 'check_safety', return_value=(info, SimpleNamespace(ask=100, bid=99.9))), \
             patch.object(bridge, 'calculate_volume', return_value=0.03), \
             patch.object(bridge, 'checked_live_entry_price', return_value=99), \
             patch.object(bridge, 'send_with_filling_fallback', return_value=SimpleNamespace(price=99, order=123)) as send, \
             patch.object(bridge, 'update_status'):
            details = bridge.place_signal(signal, {'dryRun': False})
            request = send.call_args.args[0]
            self.assertEqual(request['sl'], 90)
            self.assertEqual(request['tp'], 110)
            self.assertEqual(request['type_time'], bridge.mt5.ORDER_TIME_SPECIFIED)
            self.assertEqual(request['expiration'], 2700)
            self.assertEqual(details['status'], 'PLACED')

    def test_fractional_pullback_prices_round_toward_better_entry_without_moving_exits(self):
        for side, entry, expected in [('BUY', 99.1234, 99.12), ('SELL', 100.8766, 100.88)]:
            signal = {**self.pullback(), 'direction': side, 'entry': entry}
            if side == 'SELL':
                signal.update(stopLoss=110, takeProfit=90)
            with patch.object(bridge, 'ALLOW_LIVE_EXECUTION', True), \
                 patch.object(bridge, 'check_safety', return_value=(SimpleNamespace(name='XAUUSD', trade_tick_size=0.01),
                     SimpleNamespace(ask=100.5, bid=100.4))), \
                 patch.object(bridge, 'calculate_volume', return_value=0.03) as size, \
                 patch.object(bridge, 'checked_live_entry_price', side_effect=lambda s, *_: s['entry']), \
                 patch.object(bridge, 'send_with_filling_fallback', return_value=SimpleNamespace(price=expected, order=123)) as send, \
                 patch.object(bridge, 'update_status'):
                bridge.place_signal(signal, {'dryRun': False})
                request = send.call_args.args[0]
                self.assertEqual(request['price'], expected)
                self.assertEqual(request['sl'], signal['stopLoss'])
                self.assertEqual(request['tp'], signal['takeProfit'])
                sized_signal = size.call_args.args[0]
                self.assertEqual(sized_signal['entry'], expected)
                self.assertEqual(sized_signal['riskPips'], abs(expected - signal['stopLoss']) * 10)
                self.assertEqual(signal['entry'], entry, 'the source signal remains frozen')

    def test_two_entry_safety_rejects_netting_accounts(self):
        with patch.object(bridge.mt5, 'terminal_info', return_value=SimpleNamespace(connected=True, trade_allowed=True)), \
             patch.object(bridge.mt5, 'account_info', return_value=SimpleNamespace(trade_allowed=True, margin_mode=0)):
            with self.assertRaisesRegex(RuntimeError, 'hedging account'):
                bridge.check_safety(self.pullback(), {'scalpOneToOneEnabled': True})

    def test_expiry_removes_unfilled_order_but_fill_race_recovers_the_position(self):
        pending = {**self.pullback(), 'status': 'PLACED', 'brokerTicket': 123}
        config = {'scalpOneToOneEnabled': True}
        state = {pending['id']: pending.copy()}
        with patch.object(bridge.time, 'time', return_value=2701), \
             patch.object(bridge.mt5, 'orders_get', return_value=[SimpleNamespace(ticket=123)]), \
             patch.object(bridge.mt5, 'symbol_info_tick', return_value=SimpleNamespace(bid=101, ask=101.1)), \
             patch.object(bridge.mt5, 'order_send', return_value=SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE)), \
             patch.object(bridge, 'update_status') as update:
            bridge.manage_open_signals(state, [], config)
            self.assertEqual(state, {})
            self.assertEqual(update.call_args.args[1], 'CANCELLED')
        state = {pending['id']: pending.copy()}
        position = SimpleNamespace(ticket=123, price_open=99, sl=90, type=bridge.mt5.POSITION_TYPE_BUY)
        with patch.object(bridge.time, 'time', return_value=2701), \
             patch.object(bridge.mt5, 'orders_get', return_value=[]), \
             patch.object(bridge.mt5, 'symbol_info_tick', return_value=SimpleNamespace(bid=101, ask=101.1)), \
             patch.object(bridge, 'find_position', return_value=position), \
             patch.object(bridge, 'update_status') as update:
            bridge.manage_open_signals(state, [{**pending, 'status': 'EXPIRED'}], config)
            self.assertEqual(state[pending['id']]['status'], 'ACTIVE')
            self.assertEqual(update.call_args.args[1], 'ACTIVE')
            self.assertEqual(state[pending['id']]['takeProfit'], 110)

    def test_risk_is_independent_and_invalid_selection_is_rejected(self):
        config = {"riskPercent": 2, "scalpOneToOneRiskPercent": 0.75}
        self.assertEqual(bridge.signal_risk_percent({"tradeStyle": "SCALP_1_1"}, config), 0.75)
        self.assertEqual(bridge.signal_risk_percent({"tradeStyle": "INTRADAY"}, config), 2)
        self.assertEqual(bridge.signal_risk_percent({"tradeStyle": "SCALP_1_1"}, {"riskPercent": 2}), 0.25)
        with self.assertRaisesRegex(RuntimeError, "Invalid Scalp"):
            bridge.signal_risk_percent({"tradeStyle": "SCALP_1_1"}, {**config, "scalpOneToOneRiskPercent": 5})

    def test_volume_and_live_risk_guard_both_use_selected_scalp_risk(self):
        symbol = SimpleNamespace(name="XAUUSD", volume_step=0.01, volume_min=0.01, volume_max=100)
        signal = {"direction": "BUY", "entry": 100, "stopLoss": 90, "orderType": "MARKET",
                  "riskPips": 100, "tradeStyle": "SCALP_1_1"}
        config = {"riskPercent": 2, "scalpOneToOneRiskPercent": 0.5}
        def profit(_side, _symbol, volume, opened, closed):
            return (closed - opened) * volume * 100
        with patch.object(bridge.mt5, "account_info", return_value=SimpleNamespace(equity=10_000)), \
             patch.object(bridge.mt5, "order_calc_profit", side_effect=profit):
            self.assertEqual(bridge.calculate_volume(signal, config, symbol), 0.05)
            self.assertEqual(bridge.checked_live_entry_price(signal, config, symbol,
                SimpleNamespace(ask=100, bid=99.9), 0.05), 100)
            with self.assertRaisesRegex(RuntimeError, "per-trade risk"):
                bridge.checked_live_entry_price(signal, config, symbol,
                    SimpleNamespace(ask=101, bid=100.9), 0.05)

    def test_unfilled_scalp_order_is_missed_at_its_one_r_target(self):
        buy = {"direction": "BUY", "entry": 100, "stopLoss": 90, "tradeStyle": "SCALP_1_1"}
        sell = {**buy, "direction": "SELL", "stopLoss": 110}
        self.assertFalse(bridge.pending_order_passed_one_and_half_r(buy, SimpleNamespace(bid=109.9, ask=110)))
        self.assertTrue(bridge.pending_order_passed_one_and_half_r(buy, SimpleNamespace(bid=110, ask=110.1)))
        self.assertTrue(bridge.pending_order_passed_one_and_half_r(sell, SimpleNamespace(bid=89.9, ask=90)))

    def test_disabling_scalp_cancels_only_unfilled_orders(self):
        record = {"status": "PLACED", "direction": "BUY", "symbol": "XAUUSD",
                  "entry": 100, "stopLoss": 90, "brokerTicket": 123, "tradeStyle": "SCALP_1_1"}
        state = {"pending": record}
        with patch.object(bridge.mt5, "orders_get", return_value=[SimpleNamespace(ticket=123)]), \
             patch.object(bridge.mt5, "order_send", return_value=SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE)) as send, \
             patch.object(bridge, "update_status") as update:
            bridge.manage_open_signals(state, [], {"scalpOneToOneEnabled": False})
            self.assertEqual(send.call_args.args[0]["action"], bridge.mt5.TRADE_ACTION_REMOVE)
            self.assertEqual(update.call_args.args[:2], ("pending", "CANCELLED"))
            self.assertEqual(state, {})

    def test_fixed_target_positions_are_excluded_from_opposing_fib_exits(self):
        position = SimpleNamespace(ticket=77, identifier=77, magic=123, symbol="XAUUSD")
        record = {"brokerTicket": 77, "account": "test-account", "server": "test-server",
                  "brokerSymbol": "XAUUSD", "zoneTimeframe": "M15", "tradeStyle": "SCALP_1_1"}
        self.assertIsNone(bridge.position_fib_exit_timeframe(position, {"recentSignals": [record]}, {}))
        self.assertIsNone(bridge.position_fib_exit_timeframe(position, {}, {"trade": record}))


class IntradayPullbackTests(BridgeTestCase):
    def signal(self, leg=10):
        entry = 3009 if leg == 10 else 3007.5
        return {'id': f'INTRA:900:P{leg}', 'tradeStyle': 'INTRADAY', 'source': 'ENGULFING',
                'symbol': 'XAUUSD', 'brokerSymbol': 'XAUUSD.x', 'direction': 'BUY', 'orderType': 'LIMIT',
                'zoneTimeframe': 'M15', 'signalTimeframe': 'M15', 'zoneName': 'TJL1',
                'entry': entry, 'stopLoss': 2990, 'takeProfit': 3050, 'riskPips': (entry - 2990) * 10,
                'rewardRisk': (3050 - entry) / (entry - 2990), 'signalAt': 900, 'calculatedAt': 1800,
                'expiresAt': 2700, 'intradaySetupRiskBudget': 50,
                'intradayEntry': {'version': 1, 'leg': leg, 'riskShare': 0.6 if leg == 10 else 0.4,
                    'referenceEntry': 3010, 'nextOpen': 3010, 'confirmationBody': 10, 'setupKey': 'DIRECT:zone:900'}}

    def test_allocations_use_general_intraday_risk_and_one_frozen_budget(self):
        config = {'riskPercent': 1, 'scalpOneToOneRiskPercent': 2}
        self.assertEqual(bridge.signal_risk_money(self.signal(10), config, 5000), 30)
        self.assertEqual(bridge.signal_risk_money(self.signal(25), config, 5000), 20)
        self.assertEqual(bridge.signal_risk_money(self.signal(25), config, 10000), 20)
        self.assertEqual(bridge.signal_risk_percent(self.signal(10), config), 0.6)
        bad = self.signal()
        bad['intradayEntry']['riskShare'] = 1
        with self.assertRaisesRegex(RuntimeError, 'risk allocation'):
            bridge.signal_risk_money(bad, config, 5000)
        missing = self.signal()
        del missing['intradaySetupRiskBudget']
        with self.assertRaisesRegex(RuntimeError, 'budget is missing'):
            bridge.signal_risk_money(missing, config, 5000)

    def test_all_six_routes_keep_their_original_target_ratio_and_expiry(self):
        routes = [('ENGULFING', 'M15', 'M15', 2, 20, 900), ('ENGULFING', 'M15', 'M30', 1, 30, 1800),
                  ('ENGULFING', 'H1', 'M15', 2, 20, 900), ('ENGULFING', 'H1', 'M30', 2, 30, 1800),
                  ('MTF', 'H1', 'M5', 3, 8, 300), ('MTF', 'H4', 'M15', 5, 20, 900)]
        for source, zone, timeframe, rr, distance, seconds in routes:
            signal = self.signal()
            signal.update(source=source, zoneTimeframe=zone, signalTimeframe=timeframe,
                          stopLoss=3010 - distance, takeProfit=3010 + rr * distance,
                          calculatedAt=900 + seconds, expiresAt=900 + seconds * 2)
            risk = signal['entry'] - signal['stopLoss']
            signal.update(riskPips=risk * 10, rewardRisk=(signal['takeProfit'] - signal['entry']) / risk)
            bridge.validate_intraday_pullback(signal)
            for changed in [{'takeProfit': signal['takeProfit'] + 1}, {'expiresAt': 99999}, {'orderType': 'MARKET'}]:
                with self.assertRaisesRegex(RuntimeError, 'original fixed SL/TP'):
                    bridge.validate_intraday_pullback({**signal, **changed})
        sell = {**self.signal(), 'direction': 'SELL', 'entry': 3011, 'stopLoss': 3030, 'takeProfit': 2970}
        bridge.validate_intraday_pullback(sell)

    def test_exact_intraday_pullback_keeps_its_original_route_limit(self):
        signal = self.signal()
        signal.update(entry=3009, stopLoss=2990, takeProfit=3035, riskPips=190, rewardRisk=26 / 19)
        signal['intradayEntry'].update(version=2, referenceEntry=3005)
        bridge.validate_intraday_pullback(signal)
        self.assertEqual(bridge.signal_risk_money(signal, {'riskPercent': 1}, 5000), 30)
        signal.update(entry=3011, riskPips=210, rewardRisk=24 / 21)
        signal['intradayEntry']['nextOpen'] = 3012
        with self.assertRaisesRegex(RuntimeError, 'original fixed SL/TP'):
            bridge.validate_intraday_pullback(signal)

    def test_unfilled_intraday_waits_for_original_tp_not_the_old_one_and_half_r(self):
        signal = self.signal()
        self.assertFalse(bridge.pending_order_passed_one_and_half_r(signal, SimpleNamespace(bid=3040, ask=3040.1)))
        self.assertTrue(bridge.pending_order_passed_one_and_half_r(signal, SimpleNamespace(bid=3050, ask=3050.1)))
        sell = {**signal, 'direction': 'SELL', 'entry': 3011, 'stopLoss': 3030, 'takeProfit': 2970}
        self.assertFalse(bridge.pending_order_passed_one_and_half_r(sell, SimpleNamespace(bid=2979.9, ask=2980)))
        self.assertTrue(bridge.pending_order_passed_one_and_half_r(sell, SimpleNamespace(bid=2969.9, ask=2970)))

    def test_tp_touch_between_polls_retires_the_limit_even_after_price_pulls_back(self):
        signal = self.signal()
        tick = SimpleNamespace(bid=3040, ask=3040.1)
        rates = [{'time': 1800, 'high': 3051, 'low': 3010}]
        with patch.object(bridge.time, 'time', return_value=1860), \
             patch.object(bridge, 'BROKER_TIME_OFFSET', 0), \
             patch.object(bridge.mt5, 'copy_rates_from_pos', return_value=rates) as copied:
            self.assertTrue(bridge.intraday_boundary_reached(signal, 'XAUUSD.x', tick, strict=True))
            self.assertEqual(copied.call_args.args[0], 'XAUUSD.x')
        with patch.object(bridge.time, 'time', return_value=1860), \
             patch.object(bridge.mt5, 'copy_rates_from_pos', return_value=[{**rates[0], 'time': 1740}]):
            self.assertFalse(bridge.intraday_boundary_reached(signal, 'XAUUSD.x', tick))
        with patch.object(bridge.mt5, 'copy_rates_from_pos', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'TP history'):
                bridge.intraday_boundary_reached(signal, 'XAUUSD.x', tick, strict=True)

    def test_tp_touch_cancels_broker_pending_orders_without_closing_filled_positions(self):
        record = {**self.signal(), 'status': 'PLACED', 'brokerTicket': 123}
        state = {record['id']: record.copy()}
        with patch.object(bridge.time, 'time', return_value=1860), \
             patch.object(bridge.mt5, 'orders_get', return_value=[SimpleNamespace(ticket=123)]), \
             patch.object(bridge.mt5, 'symbol_info_tick', return_value=SimpleNamespace(bid=3040, ask=3040.1)), \
             patch.object(bridge.mt5, 'copy_rates_from_pos', return_value=[{'time': 1800, 'high': 3051, 'low': 3010}]), \
             patch.object(bridge.mt5, 'order_send', return_value=SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE)) as send, \
             patch.object(bridge, 'update_status') as update:
            bridge.manage_open_signals(state, [], {'intradayEnabled': True})
            self.assertEqual(state, {})
            self.assertEqual(send.call_args.args[0]['action'], bridge.mt5.TRADE_ACTION_REMOVE)
            self.assertEqual(update.call_args.args[1], 'CANCELLED')

    def test_group_matching_does_not_mix_other_zones_or_accounts(self):
        first, second = self.signal(10), self.signal(25)
        self.assertTrue(bridge.same_intraday_setup(first, second))
        self.assertFalse(bridge.same_intraday_setup(first, {**second, 'account': 'another-account'}))
        self.assertFalse(bridge.same_intraday_setup(first, {**second,
            'intradayEntry': {**second['intradayEntry'], 'setupKey': 'another-zone'}}))

    def test_intraday_limit_uses_broker_expiry_and_keeps_original_exit_prices(self):
        signal = self.signal()
        info = SimpleNamespace(name='XAUUSD.x', trade_tick_size=0.01)
        with patch.object(bridge, 'ALLOW_LIVE_EXECUTION', True), \
             patch.object(bridge, 'check_safety', return_value=(info, SimpleNamespace(ask=3010, bid=3009.9))), \
             patch.object(bridge, 'calculate_volume', return_value=0.01), \
             patch.object(bridge, 'checked_live_entry_price', side_effect=lambda s, *_: s['entry']), \
             patch.object(bridge, 'send_with_filling_fallback', return_value=SimpleNamespace(price=3009, order=123)) as send, \
             patch.object(bridge, 'update_status'):
            bridge.place_signal(signal, {'dryRun': False})
            order = send.call_args.args[0]
            self.assertEqual(order['sl'], 2990)
            self.assertEqual(order['tp'], 3050)
            self.assertEqual(order['expiration'], 2700)
            self.assertEqual(order['type_time'], bridge.mt5.ORDER_TIME_SPECIFIED)


class LiveEntryGuardTests(BridgeTestCase):
    def test_rejects_wide_spread_and_adverse_price_that_exceeds_cash_risk(self) -> None:
        signal = {"direction": "BUY", "orderType": "MARKET",
                  "entry": 100, "stopLoss": 97}
        config = {"riskPercent": 0.25}
        symbol = SimpleNamespace(name="XAUUSD")
        def profit(_side, _symbol, volume, opened, closed):
            return (closed - opened) * volume * 100
        with patch.object(bridge.mt5, "account_info", return_value=SimpleNamespace(equity=10_000)), \
             patch.object(bridge.mt5, "order_calc_profit", side_effect=profit):
            self.assertEqual(bridge.checked_live_entry_price(
                signal, config, symbol, SimpleNamespace(ask=100, bid=99.8), 0.05), 100)
            with self.assertRaisesRegex(RuntimeError, "spread is too large"):
                bridge.checked_live_entry_price(
                    signal, config, symbol, SimpleNamespace(ask=100, bid=99.3), 0.05)
            with self.assertRaisesRegex(RuntimeError, "per-trade risk"):
                bridge.checked_live_entry_price(
                    signal, config, symbol, SimpleNamespace(ask=102.1, bid=101.9), 0.05)


class OppositePositionGuardTests(BridgeTestCase):
    def test_strong_and_weak_alerts_use_completed_trend_snapshot(self) -> None:
        manual_buy = SimpleNamespace(ticket=123, type=bridge.mt5.POSITION_TYPE_BUY, magic=0)
        sell = {"direction": "SELL", "journalContext": {"biasAtEntry": {"M15": "bearish", "H1": "bearish"}}}
        with patch.object(bridge.mt5, "positions_get", return_value=[manual_buy]) as positions:
            message = bridge.opposite_position_alert(sell, "XAUUSD")
            self.assertIn("STRONG OPPOSITE SELL SETUP - TRADE SKIPPED", message)
            self.assertIn("BUY position #123", message)
            positions.assert_called_with(symbol="XAUUSD")
            sell["journalContext"]["biasAtEntry"]["H1"] = "bullish"
            self.assertIn("WEAK OPPOSITE SELL SETUP - TRADE SKIPPED",
                          bridge.opposite_position_alert(sell, "XAUUSD"))
            self.assertIsNone(bridge.opposite_position_alert(
                {"direction": "BUY", "journalContext": {}}, "XAUUSD"))

    def test_opposite_sell_blocks_buy_immediately_before_order_send(self) -> None:
        manual_sell = SimpleNamespace(ticket=456, type=bridge.mt5.POSITION_TYPE_SELL, magic=0)
        buy = {"direction": "BUY", "journalContext": {"biasAtEntry": {"M15": "bullish", "H1": "bearish"}}}
        request = {"symbol": "XAUUSD"}
        with patch.object(bridge.mt5, "positions_get", return_value=[manual_sell]), \
             patch.object(bridge.mt5, "order_check", return_value=SimpleNamespace(retcode=0)), \
             patch.object(bridge.mt5, "order_send") as send:
            with self.assertRaisesRegex(RuntimeError, "WEAK OPPOSITE BUY SETUP - TRADE SKIPPED"):
                bridge.send_with_filling_fallback(request, entry_signal=buy)
            send.assert_not_called()

    def test_unavailable_positions_fail_closed(self) -> None:
        with patch.object(bridge.mt5, "positions_get", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "safety check failed"):
                bridge.opposite_position_alert({"direction": "SELL"}, "XAUUSD")


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


class OverallProfitTests(BridgeTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.account = SimpleNamespace(login=123, server="Broker", balance=5149.62)
        self.deals, self.positions = [], []
        self.now = datetime(2026, 10, 26, 23, 59, tzinfo=bridge.NEPAL_TIMEZONE)
        cached = patch.object(bridge, "OVERALL_PROFIT_CACHE", {})
        cached.start()
        self.addCleanup(cached.stop)
        for name, value in (("account_info", self.account), ("history_deals_get", self.deals), ("positions_get", self.positions)):
            mocked = patch.object(bridge.mt5, name, return_value=value)
            mocked.start()
            self.addCleanup(mocked.stop)

    def deal(self, position_id, profit, commission=0, magic=None, kind=None, swap=0, fee=0):
        return SimpleNamespace(position_id=position_id, ticket=position_id + len(self.deals), profit=profit,
            commission=commission, swap=swap, fee=fee,
            magic=bridge.MAGIC_NUMBER if magic is None else magic,
            type=bridge.mt5.DEAL_TYPE_SELL if kind is None else kind)

    def test_all_history_counts_bot_and_manual_trades_but_not_deposits(self) -> None:
        self.deals.extend([self.deal(1, 0, commission=-0.10), self.deal(1, -12.25),
                           self.deal(2, 25, commission=-1, swap=-0.5, fee=-0.5),
                           self.deal(3, 100, magic=0), self.deal(4, -7.5, magic=0),
                           self.deal(0, 5000, kind=bridge.mt5.DEAL_TYPE_BALANCE)])
        result = bridge.overall_profit_snapshot(now=self.now)
        self.assertAlmostEqual(result["realizedLossMoney"], 19.85)
        self.assertAlmostEqual(result["realizedProfitMoney"], 123)
        self.assertAlmostEqual(result["netMoney"], 103.15)
        bridge.mt5.history_deals_get.assert_called_once_with(0, self.now.timestamp() + 86400)

    def test_recent_loss_with_broker_server_timestamp_ahead_of_utc_is_included(self) -> None:
        recent_loss = self.deal(1, -12.35)
        broker_timestamp = self.now.timestamp() + 3 * 3600
        with patch.object(bridge.mt5, "history_deals_get", side_effect=lambda start, end:
                          [recent_loss] if end >= broker_timestamp else []):
            self.assertAlmostEqual(bridge.overall_profit_snapshot(now=self.now)["netMoney"], -12.35)

    def test_manual_exit_of_a_bot_position_is_still_part_of_bot_profit(self) -> None:
        self.deals.extend([self.deal(1, 0, commission=-1), self.deal(1, -12, magic=0)])
        self.assertEqual(bridge.overall_profit_snapshot(now=self.now)["realizedLossMoney"], 13)

    def test_floating_profit_is_live_for_bot_and_manual_positions(self) -> None:
        self.deals.append(self.deal(1, -12.35))
        self.positions.extend([SimpleNamespace(ticket=2, magic=bridge.MAGIC_NUMBER, profit=5, swap=-1),
                               SimpleNamespace(ticket=3, magic=0, profit=500, swap=-2)])
        result = bridge.overall_profit_snapshot(now=self.now)
        self.assertEqual(result["floatingMoney"], 502)
        self.assertAlmostEqual(result["netMoney"], 489.65)
        self.positions[0].profit = 8
        self.assertEqual(bridge.overall_profit_snapshot(now=self.now)["floatingMoney"], 505)
        self.assertEqual(bridge.mt5.history_deals_get.call_count, 1)

    def test_midnight_does_not_reset_totals_and_account_switch_does_not_reuse_them(self) -> None:
        self.deals.append(self.deal(1, -12.35))
        with patch.object(bridge.time, "monotonic", side_effect=[0, 31, 32]):
            first = bridge.overall_profit_snapshot(now=self.now)
            second = bridge.overall_profit_snapshot(now=self.now + timedelta(minutes=2))
            self.assertEqual(second["netMoney"], first["netMoney"])
            self.assertEqual(second["capitalHistory"]["tradingNet"], first["capitalHistory"]["tradingNet"])
            self.account.login = 456
            self.deals.clear()
            self.assertEqual(bridge.overall_profit_snapshot(now=self.now)["netMoney"], 0)
        self.assertEqual(bridge.mt5.history_deals_get.call_count, 3)

    def test_balance_change_refreshes_history_without_waiting_for_cache_timeout(self) -> None:
        self.assertEqual(bridge.overall_profit_snapshot(now=self.now)["netMoney"], 0)
        self.deals.append(self.deal(1, -12.35, magic=0))
        self.account.balance -= 12.35
        self.assertAlmostEqual(bridge.overall_profit_snapshot(now=self.now)["netMoney"], -12.35)
        self.assertEqual(bridge.mt5.history_deals_get.call_count, 2)

    def test_missing_or_invalid_history_never_becomes_a_fake_zero(self) -> None:
        with patch.object(bridge.mt5, "history_deals_get", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "history"):
                bridge.overall_profit_snapshot(now=self.now)
        self.deals.append(self.deal(1, float("nan")))
        with self.assertRaisesRegex(RuntimeError, "invalid deal"):
            bridge.overall_profit_snapshot(now=self.now)


class CapitalHistoryTests(BridgeTestCase):
    def test_funding_is_separate_from_net_trading_and_retains_two_months(self) -> None:
        now = datetime(2026, 11, 10, 12, tzinfo=bridge.NEPAL_TIMEZONE)
        def deal(ticket, amount, kind, at):
            return SimpleNamespace(ticket=ticket, position_id=ticket, profit=amount,
                                   type=kind, time=at.timestamp(), commission=0, swap=0, fee=0)
        old = now - timedelta(days=100)
        deals = [deal(1, 5000, bridge.mt5.DEAL_TYPE_BALANCE, old),
                 deal(2, 300, bridge.mt5.DEAL_TYPE_BUY, now),
                 deal(3, -80, bridge.mt5.DEAL_TYPE_SELL, now),
                 deal(4, -150, bridge.mt5.DEAL_TYPE_BALANCE, now),
                 deal(5, 400, bridge.mt5.DEAL_TYPE_BALANCE, now)]
        result = bridge.capital_history_snapshot(deals, 5470, now)
        self.assertEqual(result['initialPrincipal'], 5000)
        self.assertEqual(result['initialAt'], old.timestamp())
        self.assertEqual(result['totalDeposits'], 5400)
        self.assertEqual(result['totalWithdrawals'], 150)
        self.assertEqual(result['withdrawalCount'], 1)
        self.assertEqual(result['tradingNet'], 220)
        self.assertEqual([r['kind'] for r in result['events']], ['withdrawal', 'deposit'])
        self.assertFalse(result['inferredOpening'])
        self.assertEqual(bridge.capital_history_snapshot(list(reversed(deals)), 5470, now), result)

    def test_missing_deposit_history_does_not_invent_an_initial_deposit_date(self) -> None:
        now = datetime(2026, 4, 30, 12, tzinfo=bridge.NEPAL_TIMEZONE)
        result = bridge.capital_history_snapshot([], 5000, now)
        self.assertEqual(result['initialPrincipal'], 5000)
        self.assertEqual(result['initialAt'], 0)
        self.assertTrue(result['inferredOpening'])
        self.assertEqual(result['tradingNet'], 0)

    def test_standalone_broker_commission_is_included_in_net_trading_pnl(self) -> None:
        now = datetime(2026, 11, 10, 12, tzinfo=bridge.NEPAL_TIMEZONE)
        commission = SimpleNamespace(ticket=7, type=bridge.mt5.DEAL_TYPE_COMMISSION,
                                     time=now.timestamp(), profit=-10, commission=0, swap=0, fee=0)
        result = bridge.capital_history_snapshot([commission], 4990, now)
        self.assertEqual(result['initialPrincipal'], 5000)
        self.assertEqual(result['tradingNet'], -10)
        self.assertEqual(result['adjustments'], 0)


class DailyRiskTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="mt5-daily-risk-test-")
        self.assertEqual(Path(temporary.name).resolve().parent, Path(tempfile.gettempdir()).resolve())
        self.addCleanup(temporary.cleanup)
        self.account = SimpleNamespace(login=123, server="Broker", balance=10000)
        self.deals, self.positions, self.orders = [], [], []
        self.now = datetime(2026, 10, 24, 12, tzinfo=bridge.NEPAL_TIMEZONE)
        for name, value in (("DAILY_RISK_FILE", Path(temporary.name) / "risk.json"), ("ACTIVE_ACCOUNT", ("123", "Broker"))):
            mocked = patch.object(bridge, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        for name, value in (("account_info", self.account), ("terminal_info", SimpleNamespace(connected=True)),
                            ("history_deals_get", self.deals), ("positions_get", self.positions), ("orders_get", self.orders)):
            mocked = patch.object(bridge.mt5, name, return_value=value)
            mocked.start()
            self.addCleanup(mocked.stop)
        calc = patch.object(bridge.mt5, "order_calc_profit", side_effect=lambda kind, symbol, volume, entry, stop:
            (stop - entry) * volume * 100 * (1 if kind == bridge.mt5.ORDER_TYPE_BUY else -1))
        calc.start()
        self.addCleanup(calc.stop)

    def deal(self, profit, magic=None, commission=0, swap=0, fee=0):
        return SimpleNamespace(profit=profit, magic=bridge.MAGIC_NUMBER if magic is None else magic,
            commission=commission, swap=swap, fee=fee, type=bridge.mt5.DEAL_TYPE_BUY)

    def position(self, profit=0, sl=3990, magic=None):
        return SimpleNamespace(symbol="XAUUSD.x", magic=bridge.MAGIC_NUMBER if magic is None else magic,
            profit=profit, swap=0, type=bridge.mt5.POSITION_TYPE_BUY, volume=0.1, price_open=4000, sl=sl)

    def snapshot(self, limit=2, now=None):
        return bridge.daily_risk_snapshot({"maximumDailyLossPercent": limit}, now=now or self.now)

    def test_closed_plus_floating_loss_hits_fixed_two_percent_limit(self) -> None:
        self.deals.append(self.deal(-120))
        self.account.balance = 9880
        self.positions.append(self.position(profit=-80, sl=3980))
        daily = self.snapshot()
        self.assertEqual(daily["startingBalance"], 10000)
        self.assertEqual(daily["realizedLossMoney"], 120)
        self.assertEqual(daily["floatingLossMoney"], 80)
        self.assertEqual(daily["usedPercent"], 2)
        self.assertEqual(daily["limitMoney"], 200)
        self.assertTrue(daily["limitReached"])
        self.assertEqual(daily["availableRiskMoney"], 0)

    def test_only_bot_losses_count_and_fees_are_included(self) -> None:
        self.deals.extend([self.deal(-100, commission=-5, swap=-2, fee=-1), self.deal(-300, magic=0)])
        self.account.balance = 9592
        self.positions.append(self.position(profit=-500, magic=0))
        daily = self.snapshot()
        self.assertEqual(daily["startingBalance"], 10000)
        self.assertEqual(daily["realizedLossMoney"], 108)
        self.assertEqual(daily["floatingLossMoney"], 0)

    def test_floating_winners_do_not_hide_losing_positions(self) -> None:
        self.positions.extend([self.position(profit=500), self.position(profit=-80)])
        self.assertEqual(self.snapshot()["floatingLossMoney"], 80)

    def test_daily_stop_survives_recovery_and_restarts_but_resets_on_next_day(self) -> None:
        self.deals.append(self.deal(-200))
        self.account.balance = 9800
        self.assertTrue(self.snapshot()["limitReached"])
        self.deals.clear()
        self.assertTrue(self.snapshot()["limitReached"], "the saved daily stop survives loss recovery")
        self.assertFalse(self.snapshot(limit=5)["limitReached"], "an explicit higher daily limit is respected")
        tomorrow = self.snapshot(now=self.now + timedelta(days=1))
        self.assertFalse(tomorrow["limitReached"])
        self.assertEqual(tomorrow["startingBalance"], 9800)

    def test_account_switch_has_a_separate_daily_balance_and_stop(self) -> None:
        self.positions.append(self.position(profit=-200))
        self.assertTrue(self.snapshot()["limitReached"])
        self.positions.clear()
        self.account.login = 456
        self.account.balance = 5000
        with patch.object(bridge, "ACTIVE_ACCOUNT", ("456", "Broker")):
            daily = self.snapshot()
        self.assertFalse(daily["limitReached"])
        self.assertEqual(daily["limitMoney"], 100)

    def test_open_and_pending_sl_risk_reserve_the_remaining_allowance(self) -> None:
        self.positions.append(self.position(profit=-80, sl=3980))
        self.orders.append(SimpleNamespace(symbol="XAUUSD.x", magic=bridge.MAGIC_NUMBER,
            type=bridge.mt5.ORDER_TYPE_BUY_LIMIT, volume_current=0.1, price_open=4000, sl=3990))
        daily = self.snapshot()
        self.assertEqual(daily["usedMoney"], 80)
        self.assertEqual(daily["reservedRiskMoney"], 220)
        self.assertFalse(daily["limitReached"])
        self.assertEqual(daily["availableRiskMoney"], 0)

    def test_new_trade_fits_exact_remaining_capacity_but_larger_trade_is_blocked(self) -> None:
        self.positions.append(self.position())
        request = {"type": bridge.mt5.ORDER_TYPE_BUY, "symbol": "XAUUSD.x", "volume": 0.1, "price": 4000, "sl": 3990}
        bridge.check_daily_trade_budget(request, {"maximumDailyLossPercent": 2})
        with self.assertRaisesRegex(RuntimeError, "exceeds"):
            bridge.check_daily_trade_budget({**request, "sl": 3989}, {"maximumDailyLossPercent": 2})

    def test_open_swap_is_counted_in_both_current_loss_and_remaining_sl_risk(self) -> None:
        position = self.position(profit=-20)
        position.swap = -10
        self.positions.append(position)
        daily = self.snapshot()
        self.assertEqual(daily["floatingLossMoney"], 30)
        self.assertEqual(daily["reservedRiskMoney"], 80)
        self.assertEqual(daily["availableRiskMoney"], 90)

    def test_invalid_floating_values_do_not_become_zero_loss(self) -> None:
        self.positions.append(self.position(profit=float('nan')))
        with self.assertRaisesRegex(RuntimeError, "invalid floating"):
            self.snapshot()

    def test_missing_sl_pauses_new_entries_without_closing_anything(self) -> None:
        self.positions.append(self.position(sl=0))
        daily = self.snapshot()
        self.assertTrue(daily["riskUnbounded"])
        self.assertEqual(daily["availableRiskMoney"], 0)

    def test_mt5_read_failures_do_not_turn_into_zero_loss(self) -> None:
        for name in ("history_deals_get", "positions_get", "orders_get"):
            with self.subTest(name=name), patch.object(bridge.mt5, name, return_value=None):
                with self.assertRaisesRegex(RuntimeError, "could not be read"):
                    self.snapshot()

    def test_daily_period_starts_at_nepal_midnight(self) -> None:
        with patch.object(bridge.mt5, "history_deals_get", return_value=[]) as history:
            self.snapshot()
        self.assertEqual(history.call_args.args[0], self.now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())

    def test_limit_is_rechecked_before_send_while_exit_orders_are_not_blocked(self) -> None:
        self.positions.append(self.position(profit=-200))
        request = {"type": bridge.mt5.ORDER_TYPE_BUY, "symbol": "XAUUSD.x", "volume": 0.1, "price": 4000, "sl": 3990}
        with patch.object(bridge.mt5, "order_check", return_value=SimpleNamespace(retcode=0)), \
             patch.object(bridge.mt5, "order_send", return_value=SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE)) as send:
            with self.assertRaisesRegex(RuntimeError, "limit reached"):
                bridge.send_with_filling_fallback(request, risk_config={"maximumDailyLossPercent": 2})
            send.assert_not_called()
            bridge.send_with_filling_fallback(request)
            send.assert_called_once()


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


class TerminalProfileTests(unittest.TestCase):
    def load_profile(self, terminal_id):
        import importlib.util
        import os
        spec = importlib.util.spec_from_file_location("isolated_terminal_profile", bridge.__file__)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {"MT5_TERMINAL_ID": terminal_id, "MT5_BRIDGE_ID": "test-bridge"}):
            spec.loader.exec_module(module)
        return module

    def test_profiles_keep_distinct_state_risk_and_bridge_identity(self):
        first = self.load_profile("primary")
        second = self.load_profile("secondary")
        self.assertNotEqual(first.STATE_FILE, second.STATE_FILE)
        self.assertNotEqual(first.DAILY_RISK_FILE, second.DAILY_RISK_FILE)
        self.assertNotEqual(first.BRIDGE_ID, second.BRIDGE_ID)
        self.assertEqual(first.STATE_FILE.name, ".mt5_bridge_state.json")
        self.assertEqual(second.SESSION.headers["X-MT5-Terminal"], "secondary")
        self.assertEqual(first.SESSION.headers["X-MT5-Terminal"], "primary")

    def test_unknown_profile_never_falls_back_to_primary(self):
        with self.assertRaisesRegex(RuntimeError, "Unknown MT5 terminal"):
            self.load_profile("invalid")


class OpposingFibProfitTests(BridgeTestCase):
    def setUp(self):
        super().setUp()
        temporary = tempfile.TemporaryDirectory(prefix='mt5-fib-profit-test-')
        self.assertEqual(Path(temporary.name).resolve().parent, Path(tempfile.gettempdir()).resolve())
        self.addCleanup(temporary.cleanup)
        self.file = Path(temporary.name) / 'fib-profit.json'
        self.now = 1800000000.0
        self.position = SimpleNamespace(ticket=77, identifier=77, time_msc=123456, magic=0,
            symbol='XAUUSD', type=bridge.mt5.POSITION_TYPE_BUY, volume=0.05,
            price_open=100.0, sl=90.0, tp=120.0, profit=20.0, swap=0.0)
        self.info = SimpleNamespace(volume_min=0.01, volume_step=0.01, volume_max=100)
        self.tick = SimpleNamespace(bid=110.0, ask=110.1, time=self.now)
        self.zone = {'id': 'sell-fib', 'timeframe': 'M15', 'isBuy': False, 'bottom': 110.0, 'top': 112.0}
        self.payload = {'config': {'brokerSymbol': 'XAUUSD', 'dryRun': False, 'enabled': False},
            'opposingFibProfitTaking': {'available': True, 'account': 'test-account', 'server': 'test-server',
                'brokerSymbol': 'XAUUSD', 'asOf': self.now, 'zones': [self.zone]}}
        self.payload['config']['manualTradeTimeframes'] = {bridge.manual_trade_timeframe_key(self.position): 'M15'}
        for name, value in [('FIB_PROFIT_FILE', self.file), ('FIB_PROFIT_PREVIOUS_QUOTES', {}),
                            ('ALLOW_LIVE_EXECUTION', True), ('BROKER_TIME_OFFSET', 0)]:
            mocked = patch.object(bridge, name, value); mocked.start(); self.addCleanup(mocked.stop)
        for target, name, value in [(bridge.time, 'time', self.now), (bridge.mt5, 'symbol_info', self.info),
                                    (bridge.mt5, 'symbol_info_tick', self.tick),
                                    (bridge.mt5, 'order_check', SimpleNamespace(retcode=0))]:
            mocked = patch.object(target, name, return_value=value); mocked.start(); self.addCleanup(mocked.stop)
        mocked = patch.object(bridge.mt5, 'positions_get', side_effect=lambda **kwargs:
            [self.position] if self.position.volume > 1e-8 else [])
        mocked.start(); self.addCleanup(mocked.stop)
        def execute(request):
            self.position.volume = round(self.position.volume - request['volume'], 8)
            return SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE, deal=42, order=0)
        mocked = patch.object(bridge.mt5, 'order_send', side_effect=execute)
        self.send = mocked.start(); self.addCleanup(mocked.stop)

    def test_unknown_manual_timeframe_never_closes_even_with_confirmed_opposing_zone(self):
        self.payload['config'].pop('manualTradeTimeframes')
        self.zone['engulfingConfirmedAt'] = self.now
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_not_called()
        self.assertEqual(self.position.volume, 0.05)

    def test_manual_timeframe_binding_is_exact_and_does_not_follow_chart_or_saved_exit_zone(self):
        self.assertEqual(bridge.manual_trade_timeframe_key(self.position),
                         '["test-account","test-server","XAUUSD",77,77,123456]')
        self.assertEqual(bridge.position_fib_exit_timeframe(self.position, self.payload, {}), 'M15')
        self.payload['config']['chartTimeframe'] = 'M1'
        self.assertEqual(bridge.position_fib_exit_timeframe(self.position, self.payload, {}), 'M15')
        self.position.time_msc += 1
        self.assertIsNone(bridge.position_fib_exit_timeframe(self.position, self.payload, {}))
        self.position.time_msc -= 1
        self.position.identifier += 1
        self.assertIsNone(bridge.position_fib_exit_timeframe(self.position, self.payload, {}))
        self.position.identifier -= 1
        with patch.object(bridge, 'ACTIVE_ACCOUNT', ('other', 'test-server')):
            self.assertIsNone(bridge.position_fib_exit_timeframe(self.position, self.payload, {}))

    def test_fifteen_minute_trade_rejects_all_lower_timeframe_partial_and_full_exits(self):
        for timeframe in ['M1', 'M5', 'invalid', None]:
            for confirmed in [False, True]:
                with self.subTest(timeframe=timeframe, confirmed=confirmed):
                    self.zone['timeframe'] = timeframe
                    self.zone['engulfingConfirmedAt'] = self.now if confirmed else None
                    bridge.manage_opposing_fib_profit(self.payload, {})
                    self.send.assert_not_called()
                    self.assertEqual(self.position.volume, 0.05)

    def test_timeframe_order_is_symmetric_and_rejects_unknown_trade_timeframes(self):
        timeframes = list(bridge.FIB_EXIT_TIMEFRAME_SECONDS)
        for own_index, own in enumerate(timeframes):
            for zone_index, zone in enumerate(timeframes):
                self.assertEqual(bridge.fib_exit_timeframe_allowed(own, zone), zone_index >= own_index)
        self.assertFalse(bridge.fib_exit_timeframe_allowed(None, 'M15'))
        self.assertFalse(bridge.fib_exit_timeframe_allowed('M15', 'invalid'))

    def test_automated_trade_uses_its_recorded_setup_not_the_lower_entry_candle_timeframe(self):
        self.position.magic = bridge.MAGIC_NUMBER
        record = {'account': 'test-account', 'server': 'test-server', 'brokerSymbol': 'XAUUSD',
                  'brokerPosition': 77, 'zoneTimeframe': 'H1', 'signalTimeframe': 'M15'}
        bridge.manage_opposing_fib_profit(self.payload, {'bot': record})
        self.send.assert_not_called()
        self.zone['timeframe'] = 'H1'
        bridge.manage_opposing_fib_profit(self.payload, {'bot': record})
        self.send.assert_called_once()
        self.assertEqual(self.position.volume, 0.01)

    def test_unknown_or_conflicting_bot_metadata_cannot_authorize_a_close(self):
        self.position.magic = bridge.MAGIC_NUMBER
        self.zone['engulfingConfirmedAt'] = self.now
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_not_called()
        record = {'account': 'test-account', 'server': 'test-server', 'brokerSymbol': 'XAUUSD',
                  'brokerPosition': 77, 'zoneTimeframe': 'M15'}
        self.payload['recentSignals'] = [{**record, 'zoneTimeframe': 'H1'}]
        bridge.manage_opposing_fib_profit(self.payload, {'bot': record})
        self.send.assert_not_called()

    def test_legacy_lower_timeframe_partial_cannot_close_the_remainder_after_timeframe_correction(self):
        key = bridge.manual_trade_timeframe_key(self.position)
        self.payload['config']['manualTradeTimeframes'][key] = 'M1'
        self.zone['timeframe'] = 'M1'
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0.01)
        self.payload['config']['manualTradeTimeframes'][key] = 'M15'
        self.zone['engulfingConfirmedAt'] = self.now
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()
        self.zone.update(id='eligible-m15', timeframe='M15')
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.send.call_count, 2)

    def test_agreed_lot_splits_and_other_broker_steps(self):
        for volume, closed in [(0.01, 0.01), (0.02, 0.01), (0.03, 0.02), (0.05, 0.04), (0.10, 0.08)]:
            with self.subTest(volume=volume):
                self.assertAlmostEqual(bridge.fib_profit_close_volume(volume, self.info), closed)
        other = SimpleNamespace(volume_min=0.1, volume_step=0.1)
        self.assertEqual(bridge.fib_profit_close_volume(0.3, other), 0.2)
        with self.assertRaises(RuntimeError):
            bridge.fib_profit_close_volume(0.015, self.info)

    def test_manual_buy_is_managed_with_auto_entries_off_once_and_keeps_sl_tp(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        request = self.send.call_args.args[0]
        self.assertEqual(request['position'], 77)
        self.assertEqual(request['type'], bridge.mt5.ORDER_TYPE_SELL)
        self.assertEqual(request['volume'], 0.04)
        self.assertEqual(request['magic'], 0)
        self.assertNotIn('sl', request); self.assertNotIn('tp', request)
        self.assertEqual((self.position.sl, self.position.tp, self.position.volume), (90, 120, 0.01))
        self.assertEqual(next(iter(json.loads(self.file.read_text()).values()))['status'], 'done')
        bridge.FIB_PROFIT_PREVIOUS_QUOTES.clear()  # Simulate a bridge restart.
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()

    def test_minimum_manual_sell_closes_fully_at_buy_zone(self):
        self.position.type = bridge.mt5.POSITION_TYPE_SELL
        self.position.volume, self.position.sl, self.position.tp = 0.01, 110, 80
        self.tick.bid, self.tick.ask = 89.9, 90
        self.zone.update(isBuy=True, bottom=88, top=90)
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.send.call_args.args[0]['type'], bridge.mt5.ORDER_TYPE_BUY)
        self.assertEqual(self.send.call_args.args[0]['price'], 90)
        self.assertEqual(self.position.volume, 0)

    def test_confirmation_closes_the_remaining_twenty_percent_after_restart(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0.01)
        bridge.FIB_PROFIT_PREVIOUS_QUOTES.clear()
        self.zone['engulfingConfirmedAt'] = self.now
        self.tick.bid = 108  # Confirmation need not arrive while still inside the zone.
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual([c.args[0]['volume'] for c in self.send.call_args_list], [0.04, 0.01])
        self.assertEqual(self.position.volume, 0)
        self.assertEqual((self.position.sl, self.position.tp), (90, 120))
        event = next(iter(json.loads(self.file.read_text()).values()))
        self.assertEqual((event['phase'], event['targetRemaining'], event['status']), ('engulfing', 0, 'done'))
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.send.call_count, 2)

    def test_already_confirmed_opposing_zone_closes_all_at_first_touch(self):
        self.zone['engulfingConfirmedAt'] = self.now - 60
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.send.call_args.args[0]['volume'], 0.05)
        self.assertEqual(self.position.volume, 0)
        self.assertNotIn('sl', self.send.call_args.args[0])
        self.assertNotIn('tp', self.send.call_args.args[0])

    def test_h4_bare_engulfing_only_takes_eighty_percent_then_waits_for_mtf_choch(self):
        self.zone.update(timeframe='H4', engulfingConfirmedAt=self.now)
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0.01)
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()
        self.zone['confirmationRoute'] = 'MTF_CHOCH'
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0)
        self.assertEqual(self.send.call_args.args[0]['volume'], 0.01)

    def test_h4_already_mtf_confirmed_closes_full_position_at_first_touch(self):
        self.zone.update(timeframe='H4', engulfingConfirmedAt=self.now, confirmationRoute='MTF_CHOCH')
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0)
        self.assertEqual(self.send.call_args.args[0]['volume'], 0.05)

    def test_legacy_h4_partial_full_exit_plan_cannot_retry_without_mtf_confirmation(self):
        self.zone.update(timeframe='H4', engulfingConfirmedAt=self.now, confirmationRoute='MTF_CHOCH')
        def partial(request):
            self.position.volume = 0.03
            return SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE_PARTIAL, deal=42, order=0)
        self.send.side_effect = partial
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.zone.pop('confirmationRoute')
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()
        self.assertEqual(self.position.volume, 0.03)

    def test_confirmed_buy_zone_closes_sell_remainder_even_after_reversal_into_loss(self):
        self.position.type = bridge.mt5.POSITION_TYPE_SELL
        self.position.sl, self.position.tp = 110, 80
        self.tick.bid, self.tick.ask = 89.9, 90
        self.zone.update(isBuy=True, bottom=88, top=90)
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.zone['engulfingConfirmedAt'] = self.now
        self.tick.bid, self.tick.ask = 100.9, 101
        self.position.profit = -1
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0)
        self.assertEqual(self.send.call_args.args[0]['type'], bridge.mt5.ORDER_TYPE_BUY)
        self.assertEqual(self.send.call_args.args[0]['volume'], 0.01)

    def test_other_zone_confirmation_cannot_close_the_remainder(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        other = {**self.zone, 'id': 'unrelated', 'engulfingConfirmedAt': self.now}
        self.payload['opposingFibProfitTaking']['zones'].append(other)
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0.01)
        self.send.assert_called_once()
        self.zone.update(timeframe='H1', engulfingConfirmedAt=self.now)
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()

    def test_display_reports_actual_partial_and_confirmed_full_close_after_restart(self):
        self.assertEqual(bridge.fib_profit_display_events('XAUUSD'), [])
        bridge.manage_opposing_fib_profit(self.payload, {})
        [event] = bridge.fib_profit_display_events('XAUUSD')
        self.assertEqual((event['ticket'], event['originalVolume'], event['remainingVolume']), (77, 0.05, 0.01))
        self.assertEqual((event['status'], event['phase']), ('partial', 'touch'))
        self.zone['engulfingConfirmedAt'] = self.now
        bridge.manage_opposing_fib_profit(self.payload, {})
        [event] = bridge.fib_profit_display_events('XAUUSD')
        self.assertEqual((event['status'], event['phase'], event['remainingVolume']), ('closed', 'engulfing', 0))

    def test_display_never_claims_an_intent_unknown_result_or_later_sl_was_a_fib_close(self):
        self.send.side_effect = None
        self.send.return_value = None
        with self.assertRaisesRegex(RuntimeError, 'unknown'):
            bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(bridge.fib_profit_display_events('XAUUSD'), [])
        saved = json.loads(self.file.read_text())
        event = next(iter(saved.values()))
        event.update(status='done', progressConfirmed=True, remainingVolume=0.01)
        self.file.write_text(json.dumps(saved))
        self.position.volume = 0  # Position subsequently disappeared via another exit.
        self.assertEqual(bridge.fib_profit_display_events('XAUUSD'), [])

    def test_display_filters_other_account_symbol_reused_ticket_and_unavailable_positions(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(bridge.fib_profit_display_events('EURUSD'), [])
        with patch.object(bridge, 'ACTIVE_ACCOUNT', ('other-account', 'test-server')):
            self.assertEqual(bridge.fib_profit_display_events('XAUUSD'), [])
        self.position.identifier = 88
        self.assertEqual(bridge.fib_profit_display_events('XAUUSD'), [])
        self.position.identifier = 77
        with patch.object(bridge.mt5, 'positions_get', return_value=None):
            self.assertEqual(bridge.fib_profit_display_events('XAUUSD'), [])

    def test_invalid_or_future_confirmation_does_not_close_remainder(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        for value in [None, True, 'confirmed', float('nan'), float('inf'), self.now + 1, 0]:
            self.zone['engulfingConfirmedAt'] = value
            bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()
        self.assertEqual(self.position.volume, 0.01)

    def test_remainder_waits_for_fresh_data_and_stale_ticks_cannot_close(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.zone['engulfingConfirmedAt'] = self.now
        self.payload['opposingFibProfitTaking']['asOf'] = self.now - 91
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.payload['opposingFibProfitTaking']['asOf'] = self.now
        self.tick.time = self.now - 121
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()

    def test_uncertain_remainder_send_is_not_repeated_after_restart(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.zone['engulfingConfirmedAt'] = self.now
        self.send.side_effect = None
        self.send.return_value = None
        with self.assertRaisesRegex(RuntimeError, 'unknown'):
            bridge.manage_opposing_fib_profit(self.payload, {})
        bridge.FIB_PROFIT_PREVIOUS_QUOTES.clear()
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.send.call_count, 2)
        self.assertEqual(self.position.volume, 0.01)

    def test_confirmation_cannot_upgrade_an_unreconciled_eighty_percent_send(self):
        self.send.side_effect = None
        self.send.return_value = None
        with self.assertRaisesRegex(RuntimeError, 'unknown'):
            bridge.manage_opposing_fib_profit(self.payload, {})
        self.zone['engulfingConfirmedAt'] = self.now
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()

    def test_confirmed_full_exit_partial_fills_only_close_the_outstanding_remainder(self):
        self.zone['engulfingConfirmedAt'] = self.now
        def partial(request):
            self.position.volume = round(self.position.volume - min(0.02, request['volume']), 8)
            return SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE_PARTIAL, deal=42, order=0)
        self.send.side_effect = partial
        for _ in range(4):
            bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual([c.args[0]['volume'] for c in self.send.call_args_list], [0.05, 0.03, 0.01])
        self.assertEqual(self.position.volume, 0)

    def test_confirmation_after_partial_eighty_percent_fill_closes_all_that_is_left(self):
        def execute(request):
            closed = 0.02 if self.send.call_count == 1 else request['volume']
            self.position.volume = round(self.position.volume - closed, 8)
            return SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE_PARTIAL, deal=42, order=0)
        self.send.side_effect = execute
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0.03)
        self.zone['engulfingConfirmedAt'] = self.now
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual([c.args[0]['volume'] for c in self.send.call_args_list], [0.04, 0.03])
        self.assertEqual(self.position.volume, 0)

    def test_remainder_intent_must_be_saved_before_sending(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.zone['engulfingConfirmedAt'] = self.now
        with patch.object(bridge, 'write_fib_profit_state', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()
        self.assertEqual(self.position.volume, 0.01)

    def test_rejected_remainder_retries_only_after_delay_and_does_not_repeat_eighty_percent(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.zone['engulfingConfirmedAt'] = self.now
        self.send.side_effect = None
        self.send.return_value = SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_MARKET_CLOSED, comment='Market closed')
        bridge.manage_opposing_fib_profit(self.payload, {})
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.send.call_count, 2)
        saved = json.loads(self.file.read_text())
        next(iter(saved.values()))['attemptedAt'] = self.now - 31
        self.file.write_text(json.dumps(saved))
        def complete(request):
            self.assertEqual(request['volume'], 0.01)
            self.position.volume = 0
            return SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE, deal=43, order=0)
        self.send.side_effect = complete
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0)

    def test_no_close_before_zone_on_loss_beyond_tp_or_for_foreign_account_and_stale_data(self):
        self.tick.bid = 109
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_not_called()
        self.tick.bid = 110; self.position.profit = -1
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.position.profit = 20; self.position.tp = 109
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.position.tp = 120
        self.payload['opposingFibProfitTaking']['account'] = 'foreign'
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.payload['opposingFibProfitTaking']['account'] = 'test-account'
        self.payload['opposingFibProfitTaking']['asOf'] = self.now - 91
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_not_called()

    def test_same_side_or_out_of_path_zones_and_other_ea_positions_do_not_trigger(self):
        self.zone['isBuy'] = True
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.zone.update(isBuy=False, bottom=95, top=97)
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.zone.update(bottom=110, top=112); self.position.magic = 1234
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.position.magic = 0; self.payload['config']['dryRun'] = True
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_not_called()

    def test_tick_crossing_zone_triggers_but_first_observation_past_it_does_not(self):
        self.tick.bid = 113
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_not_called()
        self.tick.bid = 109
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.tick.bid = 113
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()

    def test_uncertain_send_is_never_retried_even_after_restart(self):
        self.send.side_effect = None; self.send.return_value = None
        with self.assertRaisesRegex(RuntimeError, 'unknown'):
            bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(next(iter(json.loads(self.file.read_text()).values()))['status'], 'pending')
        bridge.FIB_PROFIT_PREVIOUS_QUOTES.clear()
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()

    def test_confirmed_rejection_is_not_success_and_waits_before_retry(self):
        self.send.side_effect = None
        self.send.return_value = SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_MARKET_CLOSED, comment='Market closed')
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0.05)
        self.assertEqual(next(iter(json.loads(self.file.read_text()).values()))['status'], 'rejected')
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_called_once()

    def test_bot_remainder_does_not_get_another_half_close_after_restart(self):
        self.position.magic = bridge.MAGIC_NUMBER
        record = {'account': 'test-account', 'server': 'test-server', 'brokerPosition': 77,
                  'brokerSymbol': 'XAUUSD', 'zoneTimeframe': 'M15',
                  'status': 'ACTIVE', 'tradeStyle': 'SCALPING', 'stopLoss': 90, 'riskFree': 110, 'volume': 0.05}
        bridge.manage_opposing_fib_profit(self.payload, {'bot': dict(record)})
        restored = {'bot': dict(record)}
        bridge.manage_opposing_fib_profit({'config': {}, 'opposingFibProfitTaking': {'available': False}}, restored)
        self.assertTrue(restored['bot']['opposingFibProfitTaken'])
        with patch.object(bridge, 'find_position', return_value=self.position), \
             patch.object(bridge, 'close_half_position') as half, patch.object(bridge, 'update_status'):
            bridge.manage_open_signals(restored, [], {})
            half.assert_not_called()

    def test_confirmed_partial_fills_finish_only_the_original_target_volume(self):
        def partial(request):
            self.position.volume = round(self.position.volume - min(0.02, request['volume']), 8)
            return SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE_PARTIAL, deal=42, order=0)
        self.send.side_effect = partial
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0.03)
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0.01)
        self.assertEqual([call.args[0]['volume'] for call in self.send.call_args_list], [0.04, 0.02])
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.send.call_count, 2)

    def test_other_account_cannot_inherit_a_manual_profit_take_record(self):
        bridge.manage_opposing_fib_profit(self.payload, {})
        record = {'account': 'another-account', 'server': 'test-server', 'brokerPosition': 77}
        bridge.manage_opposing_fib_profit({'config': {}, 'opposingFibProfitTaking': {'available': False}}, {'bot': record})
        self.assertNotIn('opposingFibProfitTaken', record)

    def test_rejected_shortfall_retry_preserves_the_original_twenty_percent(self):
        self.position.volume = 0.5
        def first_partial(request):
            self.position.volume = 0.3
            return SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE_PARTIAL, deal=42, order=0)
        self.send.side_effect = first_partial
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.side_effect = None
        self.send.return_value = SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_MARKET_CLOSED, comment='Market closed')
        bridge.manage_opposing_fib_profit(self.payload, {})
        saved = json.loads(self.file.read_text())
        next(iter(saved.values()))['attemptedAt'] = self.now - 31
        self.file.write_text(json.dumps(saved))
        def complete(request):
            self.assertEqual(request['volume'], 0.2, 'close only the original shortfall, not 80% of 0.3')
            self.position.volume = 0.1
            return SimpleNamespace(retcode=bridge.mt5.TRADE_RETCODE_DONE, deal=43, order=0)
        self.send.side_effect = complete
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.assertEqual(self.position.volume, 0.1)

    def test_durable_write_failure_and_stale_ticks_cannot_send_a_close(self):
        self.tick.time = self.now - 121
        bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_not_called()
        self.tick.time = self.now
        with patch.object(bridge, 'write_fib_profit_state', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_not_called()

    def test_corrupt_state_never_becomes_a_fresh_repeated_close(self):
        self.file.write_text('{broken json', encoding='utf-8')
        with self.assertRaises(ValueError):
            bridge.manage_opposing_fib_profit(self.payload, {})
        self.send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
