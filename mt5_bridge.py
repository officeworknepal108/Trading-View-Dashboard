"""Reliable local bridge from the dashboard signal queue to MetaTrader 5.

Install: py -m pip install MetaTrader5 requests python-dotenv
Configure: copy .env.mt5.example to .env.mt5 and fill only the required values.
Run: py mt5_bridge.py
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN, ROUND_UP
from pathlib import Path
from typing import Any
from urllib.parse import quote

import MetaTrader5 as mt5
import requests
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env.mt5")

DASHBOARD_URL = os.getenv("DASHBOARD_URL", "http://127.0.0.1:3002").rstrip("/")
BRIDGE_TOKEN = os.getenv("MT5_BRIDGE_TOKEN", "").strip()
MT5_PATH = os.getenv("MT5_PATH", "").strip()
MT5_LOGIN = int(os.getenv("MT5_LOGIN", "0") or 0)
MT5_PASSWORD = os.getenv("MT5_PASSWORD", "")
MT5_SERVER = os.getenv("MT5_SERVER", "")
MAGIC_NUMBER = int(os.getenv("MT5_MAGIC_NUMBER", "998877"))
POLL_SECONDS = max(0.5, float(os.getenv("MT5_POLL_SECONDS", "1")))
ALLOW_LIVE_EXECUTION = os.getenv("MT5_ALLOW_LIVE_EXECUTION", "NO").upper() == "YES"
TERMINAL_ID = os.getenv("MT5_TERMINAL_ID", "primary")
if TERMINAL_ID not in {"primary", "secondary"}:
    raise RuntimeError("Unknown MT5 terminal profile")
BRIDGE_ID = os.getenv("MT5_BRIDGE_ID", f"kalbairab-{uuid.getnode():x}") + ("-secondary" if TERMINAL_ID == "secondary" else "")
STATE_FILE = ROOT / (".mt5_bridge_state.secondary.json" if TERMINAL_ID == "secondary" else ".mt5_bridge_state.json")
DAILY_RISK_FILE = ROOT / (".mt5_daily_risk_state.secondary.json" if TERMINAL_ID == "secondary" else ".mt5_daily_risk_state.json")
FIB_PROFIT_FILE = ROOT / (".mt5_fib_profit_state.secondary.json" if TERMINAL_ID == "secondary" else ".mt5_fib_profit_state.json")
FIB_PROFIT_PREVIOUS_QUOTES: dict[str, float] = {}
OVERALL_PROFIT_CACHE: dict[str, Any] = {}
CONNECTED_ACCOUNT = ""
CONNECTED_SERVER = ""
ACTIVE_ACCOUNT: tuple[str, str] | None = None
SYMBOL_CANDIDATES: list[str] = []
LAST_RECONNECT_AT = 0.0
BROKER_TIME_OFFSET = 0
LEGACY_STATE_CHECKED = False
MT5_MARKET_TIMEFRAMES = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4,
    "D": mt5.TIMEFRAME_D1,
}
LAST_MARKET_BAR_TIME: dict[str, int] = {}
LAST_BROKER_TICK: dict[str, int] = {}
LAST_BROKER_TICK_SEEN_AT: dict[str, float] = {}
MAX_BROKER_TICK_IDLE_SECONDS = 120


class BrokerMarketDataUnavailable(RuntimeError):
    """The latest quote cannot safely establish a live broker clock."""


NEPAL_TIMEZONE = timezone(timedelta(hours=5, minutes=45))
NEPAL_TRADING_SESSIONS = ((345, 495), (705, 885), (1065, 1245))

SESSION = requests.Session()
SESSION.headers.update({"X-MT5-Terminal": TERMINAL_ID})
if BRIDGE_TOKEN:
    SESSION.headers.update({"Authorization": f"Bearer {BRIDGE_TOKEN}"})


def is_nepal_trading_time(timestamp: float | None = None) -> bool:
    instant = datetime.fromtimestamp(timestamp if timestamp is not None else time.time(), tz=NEPAL_TIMEZONE)
    minute = instant.hour * 60 + instant.minute
    return any(start <= minute <= end for start, end in NEPAL_TRADING_SESSIONS)


def api(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    response = SESSION.request(method, f"{DASHBOARD_URL}{path}", timeout=5, **kwargs)
    response.raise_for_status()
    payload = response.json()
    if payload.get("ok") is False:
        raise RuntimeError(payload.get("error", "Dashboard request failed."))
    return payload


def load_state() -> dict[str, dict[str, Any]]:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state: dict[str, dict[str, Any]]) -> None:
    temporary = STATE_FILE.with_name(f".{STATE_FILE.stem}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(state, indent=2), encoding="utf-8")
    for attempt in range(6):
        try:
            temporary.replace(STATE_FILE)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.05 * (attempt + 1))


def initialize_mt5(follow_terminal: bool = False) -> None:
    global CONNECTED_ACCOUNT, CONNECTED_SERVER
    arguments: dict[str, Any] = {}
    if MT5_PATH:
        arguments["path"] = MT5_PATH
    if MT5_LOGIN and not follow_terminal:
        arguments.update(login=MT5_LOGIN, password=MT5_PASSWORD, server=MT5_SERVER)
    if not mt5.initialize(**arguments):
        raise RuntimeError(f"MT5 initialization failed: {mt5.last_error()}")
    account = mt5.account_info()
    terminal = mt5.terminal_info()
    if not account or not terminal:
        raise RuntimeError(f"MT5 account/terminal unavailable: {mt5.last_error()}")
    if not terminal.connected:
        raise RuntimeError("MT5 terminal is not connected to the broker.")
    CONNECTED_ACCOUNT = str(account.login)
    CONNECTED_SERVER = str(account.server)
    print(f"Connected: account {account.login} | {account.server} | equity {account.equity:.2f}")


def account_identity(account: Any) -> tuple[str, str]:
    return str(account.login), str(account.server)


def ensure_mt5_connection() -> Any:
    global ACTIVE_ACCOUNT, LAST_RECONNECT_AT, BROKER_TIME_OFFSET
    terminal, account = mt5.terminal_info(), mt5.account_info()
    if not terminal or not terminal.connected or not account:
        if time.monotonic() - LAST_RECONNECT_AT < 5:
            raise RuntimeError("Waiting for the MT5 terminal connection.")
        LAST_RECONNECT_AT = time.monotonic()
        mt5.shutdown()
        # Reattach to the terminal's current login; never restore an old login after a switch.
        initialize_mt5(follow_terminal=True)
        terminal, account = mt5.terminal_info(), mt5.account_info()
    if not terminal or not terminal.connected or not account:
        raise RuntimeError("MT5 terminal is disconnected or has no logged-in account.")
    identity = account_identity(account)
    if ACTIVE_ACCOUNT != identity:
        ACTIVE_ACCOUNT = identity
        LAST_MARKET_BAR_TIME.clear()
        LAST_BROKER_TICK.clear()
        LAST_BROKER_TICK_SEEN_AT.clear()
        BROKER_TIME_OFFSET = 0
    return account


def resolve_gold_symbol(config: dict[str, Any], account: Any) -> str:
    global SYMBOL_CANDIDATES
    symbols = mt5.symbols_get()
    if symbols is None:
        SYMBOL_CANDIDATES = []
        raise RuntimeError(f"Unable to load broker symbols: {mt5.last_error()}")
    # Currency metadata excludes Gold priced in another currency and disabled/close-only contracts.
    SYMBOL_CANDIDATES = sorted({info.name for info in symbols
        if (str(getattr(info, "currency_base", "")).upper() == "XAU"
            or "XAUUSD" in info.name.upper() or info.name.upper() == "GOLD"
            or info.name.upper().startswith("GOLD."))
        and str(getattr(info, "currency_profit", "")).upper() == "USD"
        and getattr(info, "trade_mode", None) == mt5.SYMBOL_TRADE_MODE_FULL})
    selected = str(config.get("brokerSymbol", ""))
    selection_account = (str(config.get("brokerSymbolAccount", "")), str(config.get("brokerSymbolServer", "")))
    if len(SYMBOL_CANDIDATES) == 1:
        selected = SYMBOL_CANDIDATES[0]
    elif not (selection_account == account_identity(account) and selected in SYMBOL_CANDIDATES):
        if not SYMBOL_CANDIDATES:
            raise RuntimeError("No tradable Gold/USD symbol is available on this MT5 account.")
        raise RuntimeError("Multiple Gold symbols are available. Choose the broker symbol in the dashboard MT5 panel.")
    if not mt5.symbol_select(selected, True):
        raise RuntimeError(f"Unable to select broker symbol {selected}: {mt5.last_error()}")
    return selected


def assert_execution_account() -> None:
    terminal, account = mt5.terminal_info(), mt5.account_info()
    if ACTIVE_ACCOUNT is None or not terminal or not terminal.connected or not account or account_identity(account) != ACTIVE_ACCOUNT:
        raise RuntimeError("MT5 account changed or disconnected; waiting for connection synchronization.")


def heartbeat(config: dict[str, Any], message: str = "Bridge ready") -> dict[str, Any]:
    global CONNECTED_ACCOUNT, CONNECTED_SERVER
    account = mt5.account_info()
    terminal = mt5.terminal_info()
    connected = bool(account and terminal and terminal.connected)
    if connected:
        CONNECTED_ACCOUNT = str(account.login)
        CONNECTED_SERVER = str(account.server)
    symbol = str(config.get("brokerSymbol", "XAUUSD"))
    if not connected or account_identity(account) != ACTIVE_ACCOUNT:
        symbol = ""
    positions = (mt5.positions_get(symbol=symbol) or []) if connected and symbol else []
    time_offset = BROKER_TIME_OFFSET
    try:
        daily_risk = daily_risk_snapshot(config) if connected else {"available": False, "error": "MT5 is disconnected."}
    except (RuntimeError, OSError, ValueError) as error:
        daily_risk = {"available": False, "error": str(error)}
    try:
        overall_profit = overall_profit_snapshot() if connected else {"available": False, "error": "MT5 is disconnected."}
    except (RuntimeError, OSError, ValueError) as error:
        overall_profit = {"available": False, "error": str(error)}
    return api("POST", "/api/mt5/heartbeat", json={
        "bridgeId": BRIDGE_ID,
        "processId": os.getpid(),
        "account": CONNECTED_ACCOUNT if connected else "",
        "server": CONNECTED_SERVER if connected else "",
        "terminalConnected": connected,
        "symbolResolved": connected and bool(symbol),
        "symbolCandidates": SYMBOL_CANDIDATES,
        "balance": float(account.balance) if account else None,
        "equity": float(account.equity) if account else None,
        "freeMargin": float(account.margin_free) if account else None,
        "currency": str(account.currency) if account else None,
        "brokerSymbol": symbol,
        "dailyRisk": daily_risk,
        "overallProfit": overall_profit,
        "capitalHistory": overall_profit.get("capitalHistory"),
        "fibProfitEvents": fib_profit_display_events(symbol) if connected and symbol else [],
        "positions": [{
            "ticket": int(position.ticket),
            "identifier": int(getattr(position, 'identifier', 0) or position.ticket),
            "openedAtMsc": int(getattr(position, 'time_msc', 0) or int(position.time) * 1000),
            "symbol": str(position.symbol),
            "direction": "BUY" if position.type == mt5.POSITION_TYPE_BUY else "SELL",
            "volume": float(position.volume),
            "priceOpen": float(position.price_open),
            "priceCurrent": float(position.price_current),
            "stopLoss": float(position.sl),
            "takeProfit": float(position.tp),
            "profit": float(position.profit),
            "swap": float(position.swap),
            "openedAt": int(position.time) - time_offset,
            "comment": str(position.comment),
            "magic": int(position.magic),
        } for position in positions],
        "message": message,
    })


def mt5_rates_to_candles(rates: Any, broker_utc_offset_seconds: int = 0) -> list[dict[str, Any]]:
    ordered = sorted(rates, key=lambda rate: int(rate["time"]))
    if not ordered:
        return []
    current_bar_time = int(ordered[-1]["time"])
    return [{
        "time": int(rate["time"]) - broker_utc_offset_seconds,
        "open": float(rate["open"]),
        "high": float(rate["high"]),
        "low": float(rate["low"]),
        "close": float(rate["close"]),
        "volume": float(rate["tick_volume"]),
        "complete": int(rate["time"]) < current_bar_time,
    } for rate in ordered]


def broker_utc_offset_seconds(symbol: str) -> int:
    """Return the server-clock offset encoded in this broker's MT5 epochs."""
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise BrokerMarketDataUnavailable(
            f"Unable to read {symbol} broker time: {mt5.last_error()}"
        )
    now = time.time()
    tick_marker = int(getattr(tick, "time_msc", 0) or int(tick.time) * 1000)
    previous_tick = LAST_BROKER_TICK.get(symbol)
    if previous_tick is None or tick_marker != previous_tick:
        LAST_BROKER_TICK[symbol] = tick_marker
        LAST_BROKER_TICK_SEEN_AT[symbol] = now
    if previous_tick is None or tick_marker <= 0 or tick_marker < previous_tick:
        raise BrokerMarketDataUnavailable(f"Waiting for a new {symbol} broker tick.")
    if now - LAST_BROKER_TICK_SEEN_AT[symbol] > MAX_BROKER_TICK_IDLE_SECONDS:
        raise BrokerMarketDataUnavailable(f"{symbol} broker tick is stale; waiting for a new quote.")
    raw_offset = int(tick.time) - int(now)
    rounded_offset = int(round(raw_offset / 900.0) * 900)
    if abs(rounded_offset) > 14 * 60 * 60:
        raise BrokerMarketDataUnavailable(
            f"Broker time offset {rounded_offset}s is outside the safe range."
        )
    return rounded_offset


def publish_mt5_market_data(config: dict[str, Any]) -> int:
    global BROKER_TIME_OFFSET
    symbol = str(config.get("brokerSymbol", "XAUUSD"))
    if not mt5.symbol_select(symbol, True):
        raise RuntimeError(f"Broker symbol {symbol} is unavailable for candle data: {mt5.last_error()}")
    utc_offset = broker_utc_offset_seconds(symbol)
    BROKER_TIME_OFFSET = utc_offset
    published = 0
    for label, timeframe in MT5_MARKET_TIMEFRAMES.items():
        assert_execution_account()
        preview = mt5.copy_rates_from_pos(symbol, timeframe, 0, 2)
        if preview is None or len(preview) < 2:
            continue
        current_bar_time = max(int(rate["time"]) for rate in preview)
        if LAST_MARKET_BAR_TIME.get(label) == current_bar_time:
            continue
        rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, 1_500)
        if rates is None or len(rates) < 10:
            continue
        candles = mt5_rates_to_candles(rates, utc_offset)
        assert_execution_account()
        response = api("POST", "/api/mt5/market-data", json={
            "bridgeId": BRIDGE_ID,
            "account": ACTIVE_ACCOUNT[0] if ACTIVE_ACCOUNT else "",
            "server": ACTIVE_ACCOUNT[1] if ACTIVE_ACCOUNT else "",
            "timeframe": label,
            "symbol": symbol,
            "candles": candles,
        })
        if int(response.get("count", 0)) < 10:
            raise RuntimeError(f"Dashboard rejected the {label} MT5 candle snapshot.")
        LAST_MARKET_BAR_TIME[label] = current_bar_time
        published += 1
    return published


def update_status(signal_id: str, status: str, **details: Any) -> None:
    api("POST", f"/api/mt5/signals/{quote(signal_id, safe='')}/status", json={
        "status": status,
        "account": ACTIVE_ACCOUNT[0] if ACTIVE_ACCOUNT else "",
        "server": ACTIVE_ACCOUNT[1] if ACTIVE_ACCOUNT else "",
        **details,
    })


class BelowMinimumLot(RuntimeError):
    pass


def normalize_volume(raw_volume: float, symbol_info: Any) -> float:
    step = float(symbol_info.volume_step)
    minimum = float(symbol_info.volume_min)
    maximum = float(symbol_info.volume_max)
    stepped = math.floor((raw_volume + 1e-12) / step) * step
    if stepped < minimum:
        raise BelowMinimumLot(
            f"Calculated volume {raw_volume:.4f} is below broker minimum {minimum}; trade rejected to protect risk."
        )
    digits = max(0, len(f"{step:.10f}".rstrip("0").split(".")[-1]))
    return round(min(maximum, stepped), digits)


def volume_digits(symbol_info: Any) -> int:
    step = float(symbol_info.volume_step)
    return max(0, len(f"{step:.10f}".rstrip("0").split(".")[-1]))


def calculate_partial_close_volume(initial_volume: float, current_volume: float, symbol_info: Any) -> float:
    """Return a broker-valid close volume nearest to half, rounding up when needed.

    Rounding up preserves the intended gross break-even-or-better result if the
    remaining position later reaches the original stop loss.
    """
    step = float(symbol_info.volume_step)
    minimum = float(symbol_info.volume_min)
    digits = volume_digits(symbol_info)
    if step <= 0 or minimum <= 0:
        raise RuntimeError("Broker returned invalid volume rules for partial closing.")
    if current_volume + step / 10 < minimum * 2:
        raise RuntimeError(
            f"Position volume {current_volume:g} cannot be split into two broker-valid parts "
            f"(minimum {minimum:g})."
        )
    desired = initial_volume / 2.0
    close_units = math.ceil((desired - 1e-12) / step)
    close_volume = round(close_units * step, digits)
    maximum_close = current_volume - minimum
    if close_volume > maximum_close + step / 10:
        close_units = math.floor((maximum_close + 1e-12) / step)
        close_volume = round(close_units * step, digits)
    remaining_volume = round(current_volume - close_volume, digits)
    if close_volume + step / 10 < minimum or remaining_volume + step / 10 < minimum:
        raise RuntimeError(
            f"Position volume {current_volume:g} cannot be split safely using broker step {step:g}."
        )
    return close_volume


def pullback_entry(signal: dict[str, Any]) -> dict[str, Any] | None:
    return signal.get('intradayEntry') if signal.get('tradeStyle') == 'INTRADAY' else signal.get('scalpEntry')


def same_intraday_setup(first: dict[str, Any], second: dict[str, Any]) -> bool:
    return (first.get('tradeStyle') == second.get('tradeStyle') == 'INTRADAY'
            and bool(first.get('intradayEntry')) and bool(second.get('intradayEntry'))
            and first['intradayEntry'].get('setupKey') == second['intradayEntry'].get('setupKey')
            and all(first.get(key) == second.get(key) for key in ('signalAt', 'direction', 'signalTimeframe', 'account', 'server', 'brokerSymbol')))


def signal_risk_percent(signal: dict[str, Any], config: dict[str, Any]) -> float:
    if signal.get("tradeStyle") == "SCALP_1_1":
        value = float(config.get("scalpOneToOneRiskPercent", 0.5))
        if value not in (0.25, 0.5, 0.75, 1.0, 1.5, 2.0):
            raise RuntimeError("Invalid Scalp 1:1 risk selection.")
        multiplier = signal.get('scalpSetupRiskMultiplier', 1)
        if isinstance(multiplier, bool) or multiplier not in (1, 0.5):
            raise RuntimeError('Invalid Scalp 1:1 setup risk multiplier.')
        value *= multiplier
    elif signal.get('tradeStyle') == 'BOLLINGER_M5':
        value = float(config.get('bollingerM5RiskPercent', .25))
        if value not in (.25, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5):
            raise RuntimeError('Invalid Bollinger M5 risk selection.')
    elif signal.get('tradeStyle') == 'INTRADAY':
        value = float(config.get('intradayRiskPercent', config.get('riskPercent', .5)))
    elif signal.get('tradeStyle') == 'SCALPING':
        value = float(config.get('scalpingRiskPercent', config.get('riskPercent', .25)))
    else:
        value = float(config["riskPercent"])
    if not math.isfinite(value) or value <= 0:
        raise RuntimeError("Invalid per-trade risk selection.")
    leg = pullback_entry(signal)
    if leg:
        abhi = bool(signal.get('scalpEntry') and leg.get('version') == 4)
        expected = ({10: 0.4, 25: 0.6} if abhi else {10: 0.6, 25: 0.4}).get(leg.get("leg"))
        if leg.get("version") not in ((1, 2, 3, 4) if abhi else (1, 2, 3)) or expected is None or leg.get("riskShare") != expected:
            raise RuntimeError("Invalid pullback risk allocation.")
        if signal.get('pullbackFallback') == 'SECOND_ONLY':
            if leg.get('leg') != 25:
                raise RuntimeError('First entry is skipped in second-only mode.')
        else:
            value *= expected
    return value


def signal_risk_money(signal: dict[str, Any], config: dict[str, Any], equity: float) -> float:
    budget = equity * signal_risk_percent(signal, config) / 100.0
    leg = pullback_entry(signal)
    if leg:
        budget_key = 'intradaySetupRiskBudget' if signal.get('intradayEntry') else 'scalpSetupRiskBudget'
        frozen = float(signal.get(budget_key, 0))
        if not math.isfinite(frozen) or frozen <= 0:
            raise RuntimeError("Pullback shared setup risk budget is missing.")
        budget = min(budget, frozen * (1 if signal.get('pullbackFallback') == 'SECOND_ONLY' else float(leg['riskShare'])))
    return budget


def validate_scalp_pullback(signal: dict[str, Any]) -> None:
    leg = signal.get("scalpEntry")
    if not leg:
        return  # Preserve existing single-entry positions/orders.
    if leg.get('version') == 4:
        try:
            sign = 1 if signal['direction'] == 'BUY' else -1
            anchor, body, candle_range = map(float, (leg['confirmationClose'], leg['confirmationBody'], leg['confirmationRange']))
            entry, stop, target = map(float, (signal['entry'], signal['stopLoss'], signal['takeProfit']))
            risk = sign * (entry - stop)
            valid = (leg['leg'] in (10, 25) and leg['riskShare'] == {10: .4, 25: .6}[leg['leg']]
                and all(math.isfinite(v) and v > 0 for v in (anchor, body, candle_range, entry, stop, target, float(leg['referenceEntry'])))
                and body <= candle_range + 1e-6 and body / candle_range >= .3 - 1e-10
                and leg['nextOpen'] == anchor and isinstance(leg['setupKey'], str) and 0 < len(leg['setupKey']) <= 300
                and signal['orderType'] == 'LIMIT' and abs(entry - (anchor - sign * body * leg['leg'] / 100)) <= 1e-6
                and 0 < risk <= 30.000001 and abs(sign * (target-entry) / risk - 1.25) <= 1e-6
                and abs(float(signal['rewardRisk']) - 1.25) <= 1e-6
                and abs(float(signal['riskPips']) - risk * 10) <= 1e-5
                and signal['calculatedAt'] == signal['signalAt'] + 900
                and signal['expiresAt'] == signal['calculatedAt'] + 3600)
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            valid = False
        if not valid:
            raise RuntimeError('Invalid Abhi Scalp Logic confirmation pullback, allocation or 1.25R target.')
        return
    try:
        index = leg["leg"]
        share = {10: 0.6, 25: 0.4}.get(index)
        reference, opening, body = map(float, (leg["referenceEntry"], leg["nextOpen"], leg["confirmationBody"]))
        entry, stop, target = map(float, (signal["entry"], signal["stopLoss"], signal["takeProfit"]))
        sign = 1 if signal["direction"] == "BUY" else -1
        requested = opening - sign * body * index / 100
        expected = requested if leg['version'] >= 2 else min(requested, reference) if sign == 1 else max(requested, reference)
        maximum_risk = 30 if leg['version'] >= 2 else 20
        risk, reward = sign * (entry - stop), sign * (target - entry)
        valid = (leg["version"] in (1, 2, 3) and share is not None and leg["riskShare"] == share
                 and all(math.isfinite(v) and v > 0 for v in (reference, opening, body))
                 and signal["orderType"] == "LIMIT" and abs(expected - entry) <= 0.000001
                 and abs((stop + target) / 2 - reference) <= 0.000001
                 and 0 < sign * (reference - stop) <= 20.000001
                 and 0 < risk <= maximum_risk + 0.000001 and reward > 0
                 and abs(float(signal["rewardRisk"]) - reward / risk) <= 0.000001
                 and signal["calculatedAt"] == signal["signalAt"] + 900
                 and signal["expiresAt"] == signal["calculatedAt"] + (4500 if leg['version'] >= 3 else 900))
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        valid = False
    if not valid:
        raise RuntimeError("Invalid Scalp 1:1 pullback entry or original fixed SL/TP.")


def validate_intraday_pullback(signal: dict[str, Any]) -> None:
    leg = signal.get('intradayEntry')
    if not leg:
        return
    direct = {('M15', 'M15'): (2, 200), ('M15', 'M30'): (1, 300),
              ('H1', 'M15'): (2, 200), ('H1', 'M30'): (2, 300)}
    mtf = {('H1', 'M5'): (3, 80), ('H4', 'M15'): (5, 200)}
    try:
        pair = (signal['zoneTimeframe'], signal['signalTimeframe'])
        rule = (mtf if signal['source'] == 'MTF' else direct).get(pair)
        seconds = {'M5': 300, 'M15': 900, 'M30': 1800}.get(signal['signalTimeframe'])
        index = leg['leg']
        share = {10: 0.6, 25: 0.4}.get(index)
        reference, opening, body = map(float, (leg['referenceEntry'], leg['nextOpen'], leg['confirmationBody']))
        entry, stop, target = map(float, (signal['entry'], signal['stopLoss'], signal['takeProfit']))
        sign = 1 if signal['direction'] == 'BUY' else -1
        raw = opening - sign * body * index / 100
        expected = raw if leg['version'] >= 2 else min(raw, reference) if sign == 1 else max(raw, reference)
        risk, reward, original_risk = sign * (entry - stop), sign * (target - entry), sign * (reference - stop)
        valid = (rule is not None and seconds is not None and share is not None
                 and signal.get('tradeStyle') == 'INTRADAY' and not signal.get('scalpEntry')
                 and leg['version'] in (1, 2, 3) and leg['riskShare'] == share
                 and isinstance(leg['setupKey'], str) and 0 < len(leg['setupKey']) <= 400
                 and all(math.isfinite(v) and v > 0 for v in (reference, opening, body, entry, stop, target))
                 and signal['orderType'] == 'LIMIT' and abs(expected - entry) <= 0.000001
                 and 0 < original_risk * 10 <= rule[1] + 0.00001
                 and abs(sign * (target - reference) - original_risk * rule[0]) <= 0.000001
                 and 0 < risk * 10 <= rule[1] + 0.00001 and reward > 0
                 and abs(float(signal['riskPips']) - risk * 10) <= 0.00001
                 and abs(float(signal['rewardRisk']) - reward / risk) <= 0.000001
                 and signal['calculatedAt'] == signal['signalAt'] + seconds
                 and signal['expiresAt'] == signal['calculatedAt'] + (4500 if leg['version'] >= 3 else seconds))
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        valid = False
    if not valid:
        raise RuntimeError('Invalid Intraday pullback entry or original fixed SL/TP.')


def intraday_boundary_reached(signal: dict[str, Any], symbol: str, tick: Any, strict: bool = False) -> bool:
    """Retire the limit even if price touched TP between two bridge polls."""
    buy = signal['direction'] == 'BUY'
    stop, target = float(signal['stopLoss']), float(signal['takeProfit'])
    current = float(tick.bid if buy else tick.ask)
    if (current <= stop or current >= target) if buy else (current >= stop or current <= target):
        return True
    duration = max(60, int(signal['expiresAt']) - int(signal['calculatedAt']))
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, min(1442, duration // 60 + 2))
    if rates is None or len(rates) == 0:
        if strict:
            raise RuntimeError('Unable to verify original TP/SL history before placing a limit.')
        return False
    for bar in rates:
        at = int(bar['time']) - BROKER_TIME_OFFSET
        if int(signal['calculatedAt']) <= at < min(int(signal['expiresAt']), int(time.time()) + 1):
            # MT5 chart bars are bid quotes. A chart-price boundary invalidates
            # an unfilled setup; it never closes an already filled position.
            if buy and (float(bar['high']) >= target or float(bar['low']) <= stop):
                return True
            if not buy and (float(bar['low']) <= target or float(bar['high']) >= stop):
                return True
    return False


def calculate_volume(signal: dict[str, Any], config: dict[str, Any], symbol_info: Any) -> float:
    account = mt5.account_info()
    if not account:
        raise RuntimeError("Unable to read account equity.")
    sl_pips = float(signal.get("riskPips", 0))
    if not math.isfinite(sl_pips) or sl_pips <= 0:
        raise RuntimeError("SL pip distance must be a positive number.")
    risk_money = signal_risk_money(signal, config, float(account.equity))
    formula_one_lot_loss = sl_pips * 10.0
    raw_volume = risk_money / formula_one_lot_loss

    # The agreed XAUUSD formula assumes $10 per pip for one standard lot.
    # Confirm that the connected broker uses the same contract before risking
    # money; a non-standard symbol must never silently use the wrong lot size.
    order_type = mt5.ORDER_TYPE_BUY if signal["direction"] == "BUY" else mt5.ORDER_TYPE_SELL
    one_lot_loss = mt5.order_calc_profit(
        order_type,
        symbol_info.name,
        1.0,
        float(signal["entry"]),
        float(signal["stopLoss"]),
    )
    if one_lot_loss is None or abs(one_lot_loss) <= 0:
        raise RuntimeError(f"MT5 could not calculate SL risk: {mt5.last_error()}")
    broker_one_lot_loss = abs(float(one_lot_loss))
    tolerance = max(0.01, formula_one_lot_loss * 0.02)
    if abs(broker_one_lot_loss - formula_one_lot_loss) > tolerance:
        raise RuntimeError(
            "Broker XAUUSD contract does not match $10 per pip per 1 lot: "
            f"formula={formula_one_lot_loss:.2f}, MT5={broker_one_lot_loss:.2f}."
        )
    volume = normalize_volume(raw_volume, symbol_info)
    # Only scalping positions need enough volume for the 50%-at-1R exit.
    if signal.get("tradeStyle") == "SCALPING":
        calculate_partial_close_volume(volume, volume, symbol_info)
    return volume


def checked_live_entry_price(signal: dict[str, Any], config: dict[str, Any],
                             symbol_info: Any, tick: Any, volume: float) -> float:
    """Reject a market entry whose current quote breaks its spread or cash-risk budget."""
    buy = signal["direction"] == "BUY"
    is_limit = signal["orderType"] == "LIMIT"
    price = float(signal["entry"] if is_limit else tick.ask if buy else tick.bid)
    stop = float(signal["stopLoss"])
    if not math.isfinite(price) or not math.isfinite(stop) or price <= 0:
        raise RuntimeError("The executable MT5 price or stop loss is invalid.")
    if (buy and price <= stop) or (not buy and price >= stop):
        raise RuntimeError("The live MT5 quote has passed the planned stop loss.")
    if signal.get('tradeStyle') == 'BOLLINGER_M5':
        # Check the executable quote against the rounded broker SL as well as the planned signal.
        if abs(price - stop) * 10 > 80 + 1e-8:
            raise RuntimeError('Bollinger M5 SL exceeds the 80-pip maximum at the live entry price.')
        target = float(signal['takeProfit'])
        live_rr = ((target - price) if buy else (price - target)) / abs(price - stop)
        if abs(live_rr - 1.5) > .05:
            raise RuntimeError('Live Bollinger M5 entry moved outside the 1.5R tolerance; fixed exits are preserved.')
    if not is_limit:
        spread = float(tick.ask) - float(tick.bid)
        if not math.isfinite(spread) or spread < 0:
            raise RuntimeError("The live MT5 spread is invalid.")
        if spread >= 0.20 * abs(price - stop):
            raise RuntimeError("MT5 spread is too large relative to the planned stop distance.")
    account = mt5.account_info()
    if not account or not math.isfinite(float(account.equity)) or float(account.equity) <= 0:
        raise RuntimeError("Unable to verify live MT5 account risk.")
    risk_budget = signal_risk_money(signal, config, float(account.equity))
    loss_at_stop = mt5.order_calc_profit(
        mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL,
        symbol_info.name, volume, price, stop,
    )
    if loss_at_stop is None or not math.isfinite(float(loss_at_stop)):
        raise RuntimeError("MT5 could not calculate loss at the planned stop.")
    if -float(loss_at_stop) > risk_budget + max(0.01, risk_budget * 0.005):
        raise RuntimeError("Live MT5 entry price would exceed the configured per-trade risk.")
    return price


def capital_history_snapshot(deals: Any, balance: float, instant: datetime) -> dict[str, Any]:
    """Separate broker funding from net trading returns; retain two calendar months of rows."""
    import calendar
    month_index = instant.year * 12 + instant.month - 1 - 2
    year, month_zero = divmod(month_index, 12)
    cutoff = instant.replace(year=year, month=month_zero + 1,
                             day=min(instant.day, calendar.monthrange(year, month_zero + 1)[1])).timestamp()
    trade_types = (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL)
    cost_types = {getattr(mt5, name) for name in (
        "DEAL_TYPE_COMMISSION", "DEAL_TYPE_COMMISSION_DAILY", "DEAL_TYPE_COMMISSION_MONTHLY",
        "DEAL_TYPE_COMMISSION_AGENT_DAILY", "DEAL_TYPE_COMMISSION_AGENT_MONTHLY", "DEAL_TYPE_INTEREST",
    ) if hasattr(mt5, name)}
    rows, trading, adjustments = [], [], []
    deposits, withdrawals, withdrawal_count = 0.0, 0.0, 0
    initial, initial_at, inferred = 0.0, 0, False
    ordered = sorted(deals, key=lambda d: (getattr(d, "time_msc", 0) or getattr(d, "time", 0) * 1000, d.ticket))
    values = [math.fsum(float(getattr(d, field, 0)) for field in ("profit", "commission", "swap", "fee")) for d in ordered]
    if any(not math.isfinite(value) for value in values):
        raise RuntimeError("Capital history contains invalid deal values.")
    opening = balance - math.fsum(values)
    # Preserve balance predating broker-provided history without inventing a deposit date.
    if opening > 0.02:
        initial = deposits = opening
        inferred = True
    elif opening < -0.02:
        adjustments.append(opening)
    for deal, amount in zip(ordered, values):
        at = float(getattr(deal, "time", 0))
        if deal.type in trade_types or deal.type in cost_types:
            trading.append(amount)
            continue
        if deal.type == mt5.DEAL_TYPE_BALANCE and amount > 0:
            kind = "deposit"
            if not initial:
                initial, initial_at, kind = amount, at, "initial-deposit"
            deposits += amount
        elif deal.type == mt5.DEAL_TYPE_BALANCE and amount < 0:
            withdrawals -= amount
            withdrawal_count += 1
            kind = "withdrawal"
        else:
            adjustments.append(amount)
            kind = "adjustment"
        if at >= cutoff and amount:
            rows.append({"id": str(deal.ticket), "at": at, "kind": kind, "amount": amount})
    return {"balance": balance, "initialPrincipal": initial, "initialAt": initial_at,
            "inferredOpening": inferred, "totalDeposits": deposits, "totalWithdrawals": withdrawals,
            "withdrawalCount": withdrawal_count, "tradingNet": math.fsum(trading),
            "adjustments": math.fsum(adjustments), "asOf": instant.timestamp(), "events": rows}


def overall_profit_snapshot(now: datetime | None = None) -> dict[str, Any]:
    """Read-only trade P/L across all available history of the connected account."""
    assert_execution_account()
    account = mt5.account_info()
    if not account or not math.isfinite(float(account.balance)):
        raise RuntimeError("Overall profit/loss is unavailable: unable to read account balance.")
    key = (*account_identity(account), float(account.balance))
    checked_at = time.monotonic()
    if OVERALL_PROFIT_CACHE.get("key") != key or checked_at - OVERALL_PROFIT_CACHE.get("checkedAt", 0) >= 30:
        instant = now or datetime.now(NEPAL_TIMEZONE)
        # History contains executed deals only. Cover server-clock timestamps
        # ahead of UTC, including before the first fresh tick reveals its offset.
        deals = mt5.history_deals_get(0, instant.timestamp() + 24 * 60 * 60)
        if deals is None:
            raise RuntimeError("Overall profit/loss is unavailable: MT5 history could not be read.")
        trade_types = (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL)
        realized_by_position: dict[int, float] = {}
        for deal in deals:
            if deal.type not in trade_types:
                continue
            amount = math.fsum(float(getattr(deal, field, 0)) for field in ("profit", "commission", "swap", "fee"))
            if not math.isfinite(amount):
                raise RuntimeError("Overall profit/loss is unavailable: invalid deal values.")
            position_id = int(deal.position_id or deal.ticket)
            realized_by_position[position_id] = realized_by_position.get(position_id, 0) + amount
        profit = math.fsum(max(0, value) for value in realized_by_position.values())
        loss = math.fsum(max(0, -value) for value in realized_by_position.values())
        assert_execution_account()
        capital = capital_history_snapshot(deals, float(account.balance), instant)
        OVERALL_PROFIT_CACHE.update(key=key, checkedAt=checked_at, profit=profit, loss=loss, capital=capital)
    positions = mt5.positions_get()
    if positions is None:
        raise RuntimeError("Overall profit/loss is unavailable: MT5 positions could not be read.")
    floating = math.fsum(float(position.profit) + float(position.swap) for position in positions)
    if not math.isfinite(floating):
        raise RuntimeError("Overall profit/loss is unavailable: invalid floating values.")
    assert_execution_account()
    profit, loss = OVERALL_PROFIT_CACHE["profit"], OVERALL_PROFIT_CACHE["loss"]
    realized = profit - loss
    return {"available": True, "realizedProfitMoney": profit, "realizedLossMoney": loss,
            "netRealizedMoney": realized, "floatingMoney": floating, "netMoney": realized + floating,
            "capitalHistory": OVERALL_PROFIT_CACHE["capital"]}


def daily_risk_snapshot(config: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Bot-only daily loss and committed SL risk, in the account's deposit currency."""
    assert_execution_account()
    account = mt5.account_info()
    if not account or not math.isfinite(float(account.balance)):
        raise RuntimeError("Daily risk is unavailable: unable to read account balance.")
    instant = now.astimezone(NEPAL_TIMEZONE) if now else datetime.now(NEPAL_TIMEZONE)
    start = instant.replace(hour=0, minute=0, second=0, microsecond=0)
    deals = mt5.history_deals_get(start.timestamp(), instant.timestamp())
    positions, orders = mt5.positions_get(), mt5.orders_get()
    if deals is None or positions is None or orders is None:
        raise RuntimeError("Daily risk is unavailable: MT5 history, positions or pending orders could not be read.")
    def cash(deal: Any) -> float:
        value = sum(float(getattr(deal, field, 0)) for field in ("profit", "commission", "swap", "fee"))
        if not math.isfinite(value):
            raise RuntimeError("Daily risk is unavailable: invalid deal values.")
        return value
    realized = sum(cash(deal) for deal in deals if deal.magic == MAGIC_NUMBER)
    bots = [position for position in positions if position.magic == MAGIC_NUMBER]
    def position_loss(position: Any) -> float:
        value = float(position.profit) + float(position.swap)
        if not math.isfinite(value):
            raise RuntimeError("Daily risk is unavailable: invalid floating loss.")
        return max(0.0, -value)
    floating_loss = sum(position_loss(position) for position in bots)
    try:
        saved = json.loads(DAILY_RISK_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        saved = {}
    key = json.dumps([*account_identity(account), start.date().isoformat()])
    row = saved.get(key)
    changed = row is None
    if row is None:
        opening_balance = float(account.balance) - sum(cash(deal) for deal in deals)
        # A newly funded account has no positive midnight balance; use its funded balance before trading P/L.
        if opening_balance <= 0:
            opening_balance = float(account.balance) - sum(cash(deal) for deal in deals
                if deal.type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL))
        row = {"startingBalance": opening_balance, "blockedLimitPercent": 0.0}
    base = float(row["startingBalance"])
    if not math.isfinite(base) or base <= 0:
        raise RuntimeError("Daily risk is unavailable: a positive daily starting balance is required.")
    limit_percent = float(config.get("maximumDailyLossPercent", 2))
    if not math.isfinite(limit_percent) or not math.isfinite(float(row["blockedLimitPercent"])):
        raise RuntimeError("Daily risk is unavailable: invalid daily limit.")
    limit_percent = min(5.0, max(0.1, limit_percent))
    limit_money = base * limit_percent / 100
    realized_loss = max(0.0, -realized)
    used_money = realized_loss + floating_loss
    if used_money >= limit_money - 1e-8 and float(row["blockedLimitPercent"]) < limit_percent:
        row["blockedLimitPercent"] = limit_percent
        changed = True
    blocked = float(row["blockedLimitPercent"]) >= limit_percent
    reserved = 0.0
    unbounded = False
    for item in [*bots, *(order for order in orders if order.magic == MAGIC_NUMBER)]:
        if float(item.sl) <= 0:
            unbounded = True
            continue
        buy = item.type in (mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP, mt5.ORDER_TYPE_BUY_STOP_LIMIT)
        volume = float(item.volume if hasattr(item, "volume") else item.volume_current)
        profit_at_sl = mt5.order_calc_profit(mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL,
            item.symbol, volume, float(item.price_open), float(item.sl))
        if profit_at_sl is None or not math.isfinite(float(profit_at_sl)):
            raise RuntimeError("Daily risk is unavailable: unable to calculate existing SL risk.")
        floating = position_loss(item) if hasattr(item, "profit") else 0.0
        loss_at_sl = max(0.0, -float(profit_at_sl) - float(getattr(item, "swap", 0)))
        reserved += max(0.0, loss_at_sl - floating)
    assert_execution_account()
    if changed:
        saved[key] = row
        temporary = DAILY_RISK_FILE.with_name(f".{DAILY_RISK_FILE.stem}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(saved, indent=2), encoding="utf-8")
        temporary.replace(DAILY_RISK_FILE)
    remaining = max(0.0, limit_money - used_money)
    available = 0.0 if blocked or unbounded else max(0.0, remaining - reserved)
    return {"available": True, "date": start.date().isoformat(), "startingBalance": base,
        "limitPercent": limit_percent, "limitMoney": limit_money,
        "realizedLossMoney": realized_loss, "floatingLossMoney": floating_loss,
        "usedMoney": used_money, "usedPercent": used_money / base * 100,
        "remainingMoney": remaining, "remainingPercent": remaining / base * 100,
        "reservedRiskMoney": reserved, "availableRiskMoney": available,
        "availableRiskPercent": available / base * 100, "limitReached": blocked, "riskUnbounded": unbounded}


def check_daily_trade_budget(request: dict[str, Any], config: dict[str, Any]) -> None:
    daily = daily_risk_snapshot(config)
    if daily["limitReached"]:
        raise RuntimeError("Daily loss limit reached; new automated trades are blocked for today.")
    if daily["riskUnbounded"]:
        raise RuntimeError("Cannot allocate daily risk while an automated position or pending order has no SL.")
    buy = request["type"] in (mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_BUY_LIMIT)
    pnl = mt5.order_calc_profit(mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL,
        request["symbol"], request["volume"], request["price"], request["sl"])
    if pnl is None or not math.isfinite(float(pnl)):
        raise RuntimeError("Unable to calculate the new trade's daily SL risk.")
    if max(0.0, -float(pnl)) > daily["availableRiskMoney"] + 1e-8:
        raise RuntimeError("New trade's SL risk exceeds today's remaining daily risk allowance.")


def opposite_position_alert(signal: dict[str, Any], symbol: str) -> str | None:
    """Check the live account, including manual trades, before an opposite entry."""
    positions = mt5.positions_get(symbol=symbol)
    if positions is None:
        raise RuntimeError("Open MT5 positions are unavailable; opposite-position safety check failed.")
    opposite_type = (mt5.POSITION_TYPE_SELL if signal["direction"] == "BUY"
                     else mt5.POSITION_TYPE_BUY)
    opposite = next((position for position in positions if position.type == opposite_type), None)
    if opposite is None:
        return None
    bias = (signal.get("journalContext") or {}).get("biasAtEntry") or {}
    expected = "bullish" if signal["direction"] == "BUY" else "bearish"
    aligned = bias.get("M15") == expected and bias.get("H1") == expected
    strength = "STRONG" if aligned else "WEAK"
    open_side = "SELL" if signal["direction"] == "BUY" else "BUY"
    reason = (f"M15 and H1 are both {expected}." if aligned else
              f"M15 is {bias.get('M15', 'unconfirmed')}; H1 is {bias.get('H1', 'unconfirmed')}. "
              f"Both trends do not confirm {signal['direction']}.")
    action = ("Review the open position and its stop loss; no trade was opened." if aligned
              else "No trade was opened.")
    return (f"{strength} OPPOSITE {signal['direction']} SETUP - TRADE SKIPPED: "
            f"{open_side} position #{opposite.ticket} is already open on {symbol}. "
            f"{reason} {action}")


def validate_bollinger_m5(signal: dict[str, Any], config: dict[str, Any]) -> None:
    if not config.get('bollingerM5Enabled', False):
        raise RuntimeError('Bollinger M5 automatic trading is disabled.')
    try:
        sign = 1 if signal['direction'] == 'BUY' else -1
        entry, stop, target = map(float, (signal['entry'], signal['stopLoss'], signal['takeProfit']))
        risk = sign * (entry - stop)
        if risk * 10 > 80 + 1e-8:
            raise RuntimeError('Bollinger M5 SL exceeds the 80-pip maximum.')
        valid = (signal['direction'] in ('BUY', 'SELL') and signal.get('source') == 'BOLLINGER'
                 and signal.get('symbol') == 'XAUUSD' and signal.get('orderType') == 'MARKET'
                 and signal.get('zoneTimeframe') == 'H4' and signal.get('signalTimeframe') == 'M5'
                 and not signal.get('scalpEntry') and not signal.get('intradayEntry')
                 and all(math.isfinite(v) and v > 0 for v in (entry, stop, target)) and risk > 0
                 and abs(sign * (target - entry) / risk - 1.5) < 1e-6
                 and signal.get('rewardRisk') == 1.5
                 and signal['calculatedAt'] == signal['signalAt'] + 300
                 and signal['calculatedAt'] < signal['expiresAt'] <= signal['calculatedAt'] + 299
                 and signal['calculatedAt'] <= time.time() < signal['expiresAt'])
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        valid = False
    if not valid:
        raise RuntimeError('Invalid Bollinger M5 single entry, freshness or fixed 1.5R exits.')


def check_bollinger_position_isolation(signal: dict[str, Any], account: Any, symbol: str) -> None:
    if signal.get('tradeStyle') != 'BOLLINGER_M5':
        return
    if not account:
        raise RuntimeError('Unable to verify the Bollinger M5 account position mode.')
    hedging = getattr(mt5, 'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING', 2)
    if getattr(account, 'margin_mode', None) != hedging and any(
            position.symbol == symbol for position in (mt5.positions_get() or [])):
        raise RuntimeError('Bollinger M5 cannot merge into an existing netting-account position; independent exits are required.')


def check_safety(signal: dict[str, Any], config: dict[str, Any]) -> tuple[Any, Any]:
    if signal.get('tradeStyle') == 'BOLLINGER_M5':
        validate_bollinger_m5(signal, config)
    if signal.get('intradayEntry'):
        if not config.get('intradayEnabled', True):
            raise RuntimeError('Intraday automatic trading is disabled.')
        validate_intraday_pullback(signal)
    if signal.get("tradeStyle") == "SCALP_1_1" and not config.get("scalpOneToOneEnabled", False):
        raise RuntimeError("Scalp 1:1 automatic trading is disabled.")
    if signal.get("tradeStyle") == "SCALP_1_1":
        validate_scalp_pullback(signal)
        risk = abs(float(signal["entry"]) - float(signal["stopLoss"]))
        reward = abs(float(signal["takeProfit"]) - float(signal["entry"]))
        if signal.get("signalTimeframe") != "M15" or risk <= 0 or (not signal.get("scalpEntry") and abs(reward - risk) > 0.00001):
            raise RuntimeError("Scalp 1:1 requires M15 confirmation and a fixed 1:1 target.")
    enabled_timeframes = config.get("enabledTimeframes", ["M1", "M5", "M15", "M30", "H1"])
    signal_timeframe = str(signal.get("signalTimeframe", ""))
    zone_timeframe = str(signal.get("zoneTimeframe", ""))
    controlled_timeframes = {"M1", "M5", "M15", "M30", "H1"}
    if ((signal_timeframe in controlled_timeframes and signal_timeframe not in enabled_timeframes)
            or (zone_timeframe in controlled_timeframes and zone_timeframe not in enabled_timeframes)):
        raise RuntimeError(
            f"{zone_timeframe or 'Unknown'} setup / {signal_timeframe or 'Unknown'} entry "
            "automatic trading is disabled."
        )
    terminal = mt5.terminal_info()
    account = mt5.account_info()
    if not terminal or not terminal.connected:
        raise RuntimeError("MT5 terminal is disconnected.")
    if not terminal.trade_allowed:
        raise RuntimeError("MT5 AutoTrading is disabled in the terminal.")
    if account and not account.trade_allowed:
        raise RuntimeError("Trading is not permitted on this MT5 account.")
    if pullback_entry(signal):
        hedging = getattr(mt5, 'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING', 2)
        if not account or getattr(account, 'margin_mode', None) != hedging:
            raise RuntimeError("Two pullback entries require an MT5 hedging account for independent tickets.")
        if float(signal['expiresAt']) <= time.time():
            raise RuntimeError("Pullback entry deadline has expired.")
    symbol = str(config["brokerSymbol"])
    if not mt5.symbol_select(symbol, True):
        raise RuntimeError(f"Broker symbol {symbol} is unavailable: {mt5.last_error()}")
    check_bollinger_position_isolation(signal, account, symbol)
    conflict = opposite_position_alert(signal, symbol)
    if conflict:
        raise RuntimeError(conflict)
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    if not info or not tick:
        raise RuntimeError(f"No live tick is available for {symbol}.")
    spread_points = (float(tick.ask) - float(tick.bid)) / float(info.point)
    if spread_points > float(config["maximumSpreadPoints"]):
        raise RuntimeError(f"Spread {spread_points:.0f} points exceeds the configured maximum.")
    positions = [position for position in (mt5.positions_get() or []) if position.magic == MAGIC_NUMBER]
    orders = [order for order in (mt5.orders_get() or []) if order.magic == MAGIC_NUMBER]
    if len(positions) + len(orders) >= int(config["maximumOpenTrades"]):
        raise RuntimeError("Maximum number of automated open trades has been reached.")
    if daily_risk_snapshot(config)["limitReached"]:
        raise RuntimeError("Daily loss limit reached; new automated trades are blocked for today.")
    entry, sl, tp = map(float, (signal["entry"], signal["stopLoss"], signal["takeProfit"]))
    if signal["direction"] == "BUY" and not sl < entry < tp:
        raise RuntimeError("Invalid BUY entry/SL/TP order.")
    if signal["direction"] == "SELL" and not tp < entry < sl:
        raise RuntimeError("Invalid SELL entry/SL/TP order.")
    if pullback_entry(signal):
        current = float(tick.bid if signal['direction'] == 'BUY' else tick.ask)
        if (signal['direction'] == 'BUY' and (current <= sl or current >= tp)
                or signal['direction'] == 'SELL' and (current >= sl or current <= tp)):
            raise RuntimeError("Original Scalp 1:1 SL/TP reached before entry.")
        if intraday_boundary_reached(signal, symbol, tick, strict=True):
            raise RuntimeError('Original setup SL/TP already reached; unfilled limits are cancelled.')
    return info, tick


def send_with_filling_fallback(request: dict[str, Any], risk_config: dict[str, Any] | None = None,
                               entry_signal: dict[str, Any] | None = None, allow_gtc_expiry_fallback: bool = False) -> Any:
    result = None
    successful_send_codes = (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL)
    for filling in (mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN):
        assert_execution_account()
        candidate = {**request, "type_filling": filling}
        checked = mt5.order_check(candidate)
        invalid_expiry = getattr(mt5, 'TRADE_RETCODE_INVALID_EXPIRATION', 10022)
        if (allow_gtc_expiry_fallback and checked is not None and checked.retcode == invalid_expiry
                and candidate.get('type_time') == mt5.ORDER_TIME_SPECIFIED):
            candidate = {key: value for key, value in candidate.items() if key != 'expiration'}
            candidate['type_time'] = mt5.ORDER_TIME_GTC
            checked = mt5.order_check(candidate)
        if checked is None or checked.retcode not in (0, mt5.TRADE_RETCODE_DONE):
            continue
        assert_execution_account()
        if risk_config is not None:
            check_daily_trade_budget(request, risk_config)
        if entry_signal is not None:
            conflict = opposite_position_alert(entry_signal, request["symbol"])
            if conflict:
                raise RuntimeError(conflict)
        result = mt5.order_send(candidate)
        if (allow_gtc_expiry_fallback and result is not None and result.retcode == invalid_expiry
                and candidate.get('type_time') == mt5.ORDER_TIME_SPECIFIED):
            # This is an explicit rejection, so no order was accepted. Recheck
            # GTC with the same fixed exits, sizing and bridge-managed deadline.
            fallback = {key: value for key, value in request.items() if key != 'expiration'}
            fallback['type_time'] = mt5.ORDER_TIME_GTC
            return send_with_filling_fallback(fallback, risk_config, entry_signal)
        if result and result.retcode in successful_send_codes:
            return result
    detail = getattr(result, "comment", None) or str(mt5.last_error())
    raise RuntimeError(f"MT5 rejected the order: {detail}")


def quantized_pullback_signal(signal: dict[str, Any], info: Any) -> dict[str, Any]:
    step = float(getattr(info, 'trade_tick_size', 0) or getattr(info, 'point', 0))
    if not math.isfinite(step) or step <= 0:
        raise RuntimeError('Unable to verify broker tick size for a pullback limit.')
    units = (Decimal(str(signal['entry'])) / Decimal(str(step))).to_integral_value(
        rounding=ROUND_DOWN if signal['direction'] == 'BUY' else ROUND_UP)
    entry = float(units * Decimal(str(step)))
    result = {**signal, 'entry': entry, 'riskPips': abs(entry - float(signal['stopLoss'])) * 10}
    if signal.get('scalpEntry', {}).get('version') == 4:
        # Preserve the planned exits. Quantization may improve the entry by one tick.
        target_units = (Decimal(str(signal['takeProfit'])) / Decimal(str(step))).to_integral_value(
            rounding=ROUND_UP if signal['direction'] == 'BUY' else ROUND_DOWN)
        stop_units = (Decimal(str(signal['stopLoss'])) / Decimal(str(step))).to_integral_value(
            rounding=ROUND_DOWN if signal['direction'] == 'BUY' else ROUND_UP)
        result['takeProfit'] = float(target_units * Decimal(str(step)))
        result['stopLoss'] = float(stop_units * Decimal(str(step)))
        result['riskPips'] = abs(entry - result['stopLoss']) * 10
    return result


def quantized_bollinger_signal(signal: dict[str, Any], info: Any) -> dict[str, Any]:
    step = float(getattr(info, 'trade_tick_size', 0) or getattr(info, 'point', 0))
    if not math.isfinite(step) or step <= 0:
        raise RuntimeError('Unable to verify broker tick size for Bollinger M5.')
    def price(value: Any) -> float:
        return float((Decimal(str(value)) / Decimal(str(step))).to_integral_value() * Decimal(str(step)))
    stop, target = price(signal['stopLoss']), price(signal['takeProfit'])
    return {**signal, 'stopLoss': stop, 'takeProfit': target, 'riskPips': abs(float(signal['entry']) - stop) * 10}


def prepare_pullback_allocation(signal: dict[str, Any], config: dict[str, Any], info: Any) -> dict[str, Any]:
    meta = pullback_entry(signal)
    if not meta or meta.get('version', 0) < 3 or signal.get('pullbackFallback') == 'SECOND_ONLY':
        return signal
    below = False
    abhi = bool(signal.get('scalpEntry') and meta.get('version') == 4)
    for leg, share in (((10, .4), (25, .6)) if abhi else ((10, .6), (25, .4))):
        sign = 1 if signal['direction'] == 'BUY' else -1
        entry = float(meta['confirmationClose'] if abhi else meta['nextOpen']) - sign * float(meta['confirmationBody']) * leg / 100
        trial = {**signal, 'entry': entry, 'riskPips': abs(entry - float(signal['stopLoss'])) * 10,
                 ('intradayEntry' if signal.get('intradayEntry') else 'scalpEntry'): {**meta, 'leg': leg, 'riskShare': share}}
        if abhi:
            trial['takeProfit'] = entry + sign * abs(entry-float(signal['stopLoss'])) * 1.25
        try:
            calculate_volume(quantized_pullback_signal(trial, info), config, info)
        except BelowMinimumLot:
            below = True
    if not below:
        return signal
    # The server atomically skips leg one and records the allocation for both
    # legs before any order can be sent. Never move risk from an accepted order.
    response = api('POST', '/api/mt5/pullback-allocation', json={'id': signal['id'], 'bridgeId': BRIDGE_ID,
        'account': ACTIVE_ACCOUNT[0], 'server': ACTIVE_ACCOUNT[1], 'brokerSymbol': info.name})
    if not response.get('ok') or not response.get('signal'):
        raise RuntimeError('Unable to confirm second-entry-only allocation.')
    return response['signal']


def place_signal(signal: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    if config.get("tradingTimeEnabled", False) and not is_nepal_trading_time():
        update_status(signal["id"], "REJECTED", message="Outside Nepal trading time; automatic entry is blocked.")
        return {"status": "REJECTED"}
    if config.get("dryRun", True) or not ALLOW_LIVE_EXECUTION:
        reason = "Send Trades to MT5 is NO" if config.get("dryRun", True) else "MT5_ALLOW_LIVE_EXECUTION is not YES"
        update_status(signal["id"], "SIMULATED", message=f"Validated without an order: {reason}.")
        print(f"DRY RUN {signal['direction']} {signal['zoneTimeframe']} {signal['zoneName']}")
        return {"status": "SIMULATED"}

    info, tick = check_safety(signal, config)
    if signal.get('tradeStyle') == 'BOLLINGER_M5':
        signal = quantized_bollinger_signal(signal, info)
    signal = prepare_pullback_allocation(signal, config, info)
    if signal.get('pullbackFallback') == 'SECOND_ONLY' and pullback_entry(signal).get('leg') == 10:
        return {'status': 'CANCELLED', 'pullbackFallback': 'SECOND_ONLY'}
    if pullback_entry(signal):
        # Round toward a better entry, preserving the frozen exits and cash cap.
        signal = quantized_pullback_signal(signal, info)
    volume = calculate_volume(signal, config, info)
    is_buy = signal["direction"] == "BUY"
    is_limit = signal["orderType"] == "LIMIT"
    checked_price = checked_live_entry_price(signal, config, info, tick, volume)
    if is_limit:
        if is_buy and float(signal["entry"]) >= float(tick.ask):
            raise RuntimeError("BUY LIMIT entry is not below the current ask price.")
        if not is_buy and float(signal["entry"]) <= float(tick.bid):
            raise RuntimeError("SELL LIMIT entry is not above the current bid price.")
        order_type = mt5.ORDER_TYPE_BUY_LIMIT if is_buy else mt5.ORDER_TYPE_SELL_LIMIT
        action = mt5.TRADE_ACTION_PENDING
        price = checked_price
    else:
        order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
        action = mt5.TRADE_ACTION_DEAL
        price = checked_price
    tag = hashlib.sha1(signal["id"].encode("utf-8")).hexdigest()[:10]
    request = {
        "action": action,
        "symbol": info.name,
        "volume": volume,
        "type": order_type,
        "price": price,
        "sl": float(signal["stopLoss"]),
        "tp": float(signal["takeProfit"]),
        "deviation": 20,
        "magic": MAGIC_NUMBER,
        "comment": f"KB-{tag}",
        "type_time": mt5.ORDER_TIME_GTC,
    }
    expiry_modes = int(getattr(info, 'expiration_mode', 1))
    if pullback_entry(signal) and is_limit:
        if expiry_modes & 4:  # SYMBOL_EXPIRATION_SPECIFIED
            request['type_time'] = mt5.ORDER_TIME_SPECIFIED
            request['expiration'] = int(signal['expiresAt']) + BROKER_TIME_OFFSET
        elif not expiry_modes & 1:  # SYMBOL_EXPIRATION_GTC
            raise RuntimeError('Broker supports neither exact pending expiry nor bridge-managed GTC orders.')
    result = send_with_filling_fallback(request, risk_config=config, entry_signal=signal,
        allow_gtc_expiry_fallback=bool(pullback_entry(signal) and is_limit and expiry_modes & 1))
    status = "PLACED" if is_limit else "ACTIVE"
    execution_price = float(result.price or price)
    initial_stop_loss = float(signal["stopLoss"])
    actual_risk = abs(execution_price - initial_stop_loss)
    risk_multiple = float(config.get("moveStopToBreakEvenAtR", 1))
    actual_risk_free = execution_price + actual_risk * risk_multiple if is_buy else execution_price - actual_risk * risk_multiple
    details = {
        "status": status,
        "brokerTicket": int(result.order),
        "brokerPosition": int(result.order) if not is_limit else 0,
        "executionPrice": execution_price,
        "initialStopLoss": initial_stop_loss,
        "openedAt": int(time.time()),
        "riskFree": actual_risk_free,
        "riskPips": actual_risk * 10,
        "volume": volume,
        "comment": request["comment"],
        **({'executionTakeProfit': float(request['tp'])} if signal.get('tradeStyle') == 'BOLLINGER_M5' or signal.get('scalpEntry', {}).get('version') == 4 else {}),
        **({'pullbackFallback': 'SECOND_ONLY'} if signal.get('pullbackFallback') == 'SECOND_ONLY' else {}),
    }
    update_status(signal["id"], status, **{key: value for key, value in details.items() if key != "status"})
    print(f"{status}: {signal['direction']} {volume} {info.name} ticket {result.order}")
    return details


def find_position(record: dict[str, Any]) -> Any | None:
    position_ticket = int(record.get("brokerPosition") or 0)
    if position_ticket:
        positions = mt5.positions_get(ticket=position_ticket) or []
        if positions:
            return positions[0]
    comment = record.get("comment", "")
    for position in mt5.positions_get() or []:
        if position.magic == MAGIC_NUMBER and (not comment or position.comment == comment):
            return position
    return None


def close_half_position(position: Any, record: dict[str, Any]) -> dict[str, Any]:
    info = mt5.symbol_info(position.symbol)
    tick = mt5.symbol_info_tick(position.symbol)
    if not info or not tick:
        raise RuntimeError(f"No live tick is available to partially close {position.symbol}.")
    initial_volume = float(record.get("initialVolume") or record.get("volume") or position.volume)
    current_volume = float(position.volume)
    close_volume = calculate_partial_close_volume(initial_volume, current_volume, info)
    is_buy = position.type == mt5.POSITION_TYPE_BUY
    price = float(tick.bid if is_buy else tick.ask)
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": position.symbol,
        "position": int(position.ticket),
        "volume": close_volume,
        "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
        "price": price,
        "deviation": 20,
        "magic": MAGIC_NUMBER,
        "comment": "KB 50pct at 1R",
    }
    result = send_with_filling_fallback(request)
    remaining_position = find_position(record)
    remaining_volume = float(remaining_position.volume) if remaining_position else 0.0
    actual_closed_volume = max(0.0, current_volume - remaining_volume)
    if actual_closed_volume < close_volume - float(info.volume_step) / 2:
        raise RuntimeError(
            f"MT5 reported an incomplete partial close: requested {close_volume:g}, "
            f"closed {actual_closed_volume:g}."
        )
    return {
        "initialVolume": initial_volume,
        "partialClosedVolume": actual_closed_volume,
        "remainingVolume": remaining_volume,
        "partialClosePrice": float(result.price or price),
        "partialCloseTicket": int(result.deal or result.order),
        "partialClosedAt": int(time.time()),
    }


def fib_profit_close_volume(volume: float, symbol_info: Any) -> float:
    """Floor 80% to the broker step, leaving a valid remainder; close an unsplittable minimum lot."""
    current, step, minimum = map(lambda v: Decimal(str(v)), (volume, symbol_info.volume_step, symbol_info.volume_min))
    if not all(value.is_finite() and value > 0 for value in (current, step, minimum)):
        raise RuntimeError("Invalid broker volume limits for Fib profit taking.")
    units = current / step
    if abs(units - units.to_integral_value()) > Decimal('0.000001'):
        raise RuntimeError("Position volume does not match the broker lot step.")
    units = int(units.to_integral_value())
    minimum_units = int((minimum / step).to_integral_value(rounding=ROUND_UP))
    if units < 2 * minimum_units:
        return float(current)
    close_units = min(int((Decimal(units) * Decimal('0.8')).to_integral_value(rounding=ROUND_DOWN)), units - minimum_units)
    return float(Decimal(max(minimum_units, close_units)) * step)


def write_fib_profit_state(state: dict[str, Any]) -> None:
    temporary = FIB_PROFIT_FILE.with_suffix(f".{os.getpid()}.tmp")
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(state, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(FIB_PROFIT_FILE)


class FibCloseRejected(RuntimeError):
    pass


def fib_zone_engulfing_confirmed(zone: dict[str, Any], as_of: float) -> bool:
    confirmed_at = zone.get('engulfingConfirmedAt')
    return ((zone.get('timeframe') != 'H4' or zone.get('confirmationRoute') == 'MTF_CHOCH')
            and type(confirmed_at) in (int, float) and math.isfinite(confirmed_at)
            and 0 < confirmed_at <= as_of)


def fib_profit_display_events(symbol: str) -> list[dict[str, Any]]:
    """Publish broker-confirmed results, never a saved intent or a predicted fill."""
    try:
        saved = json.loads(FIB_PROFIT_FILE.read_text(encoding='utf-8'))
        if not isinstance(saved, dict):
            return []
        events = []
        for key, event in saved.items():
            owner = json.loads(key)
            if tuple(owner[:2]) != ACTIVE_ACCOUNT or owner[2] != symbol or not event.get('progressConfirmed'):
                continue
            ticket = int(event['ticket'])
            live = mt5.positions_get(ticket=ticket)
            if live is None:
                continue
            original = float(event['originalVolume'])
            if live:
                position = live[0]
                if (len(live) != 1 or position.symbol != symbol or int(position.type) != owner[5]
                        or int(getattr(position, 'identifier', 0) or position.ticket) != owner[3]
                        or int(getattr(position, 'time_msc', getattr(position, 'time', 0))) != owner[4]):
                    continue
                remaining = float(position.volume)
            elif event.get('status') == 'done' and float(event.get('remainingVolume', -1)) == 0:
                remaining = 0.0
            else:
                continue  # A later SL/TP/manual close is not an engulfing exit.
            if not 0 <= remaining < original:
                continue
            events.append({'ticket': ticket, 'direction': 'BUY' if owner[5] == mt5.POSITION_TYPE_BUY else 'SELL',
                'originalVolume': original, 'remainingVolume': remaining,
                'phase': 'engulfing' if event.get('phase') == 'engulfing' else 'touch',
                'status': 'closed' if remaining == 0 else 'partial',
                'zoneTimeframe': event.get('zoneTimeframe'), 'zoneName': event.get('zoneName'),
                'updatedAt': float(event.get('attemptedAt', 0))})
        return sorted(events, key=lambda event: event['updatedAt'], reverse=True)[:25]
    except (OSError, ValueError, TypeError, KeyError, IndexError):
        return []


def send_fib_profit_close(request: dict[str, Any]) -> Any:
    # Never retry an uncertain order_send with a different filling mode: 0.02 lots
    # could otherwise close twice and lose the intended 0.01-lot remainder.
    for filling in (mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN):
        assert_execution_account()
        candidate = {**request, 'type_filling': filling}
        live = mt5.positions_get(ticket=request['position'])
        if not live or len(live) != 1 or live[0].symbol != request['symbol'] or float(live[0].volume) < request['volume'] - 1e-9:
            raise FibCloseRejected('Position changed before the Fib close; no close was sent.')
        expected = mt5.ORDER_TYPE_SELL if live[0].type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
        if candidate['type'] != expected:
            raise FibCloseRejected('Position direction changed before the Fib close.')
        checked = mt5.order_check(candidate)
        if checked is None or checked.retcode not in (0, mt5.TRADE_RETCODE_DONE):
            continue
        assert_execution_account()
        result = mt5.order_send(candidate)
        if result is None:
            raise RuntimeError("Fib close result is unknown; saved intent prevents a duplicate close.")
        if result.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL):
            return result
        if result.retcode == mt5.TRADE_RETCODE_INVALID_FILL:
            continue
        raise FibCloseRejected(f"Fib close rejected: {getattr(result, 'comment', result.retcode)}")
    raise FibCloseRejected("Broker did not accept a filling mode for the Fib close.")


FIB_EXIT_TIMEFRAME_SECONDS = {'M1': 60, 'M5': 300, 'M15': 900, 'M30': 1800,
                             'H1': 3600, 'H4': 14400, 'D': 86400}


def manual_trade_timeframe_key(position: Any) -> str | None:
    ticket = int(position.ticket)
    identifier = int(getattr(position, 'identifier', 0) or ticket)
    opened = int(getattr(position, 'time_msc', 0) or int(getattr(position, 'time', 0)) * 1000)
    if not ACTIVE_ACCOUNT or not all(ACTIVE_ACCOUNT) or min(ticket, identifier, opened) <= 0:
        return None
    return json.dumps([*ACTIVE_ACCOUNT, str(position.symbol), ticket, identifier, opened], separators=(',', ':'), ensure_ascii=False)


def position_fib_exit_timeframe(position: Any, status_payload: dict[str, Any],
                                state: dict[str, dict[str, Any]]) -> str | None:
    if position.magic == 0:
        key = manual_trade_timeframe_key(position)
        assignments = (status_payload.get('config') or {}).get('manualTradeTimeframes') or {}
        value = assignments.get(key) if key and isinstance(assignments, dict) else None
        return value if isinstance(value, str) and value in FIB_EXIT_TIMEFRAME_SECONDS else None
    identifiers = {int(position.ticket), int(getattr(position, 'identifier', 0) or position.ticket)}
    matches = [record for record in [*state.values(), *status_payload.get('recentSignals', [])]
               if (record.get('account'), record.get('server')) == ACTIVE_ACCOUNT
               and record.get('brokerSymbol') == position.symbol
               and any(int(record.get(field) or 0) in identifiers for field in ('brokerPosition', 'brokerTicket'))]
    if any(record.get('tradeStyle') in ('SCALP_1_1', 'BOLLINGER_M5') for record in matches):
        return None  # Fixed SL/TP only; no opposing-Fib partial or full exit.
    timeframes = {record.get('zoneTimeframe') for record in matches}
    value = next(iter(timeframes)) if len(timeframes) == 1 else None
    return value if isinstance(value, str) and value in FIB_EXIT_TIMEFRAME_SECONDS else None


def fib_exit_timeframe_allowed(trade_timeframe: str | None, zone_timeframe: str | None) -> bool:
    if not isinstance(trade_timeframe, str) or not isinstance(zone_timeframe, str):
        return False
    trade_seconds = FIB_EXIT_TIMEFRAME_SECONDS.get(trade_timeframe or '')
    zone_seconds = FIB_EXIT_TIMEFRAME_SECONDS.get(zone_timeframe or '')
    return trade_seconds is not None and zone_seconds is not None and zone_seconds >= trade_seconds


def manage_opposing_fib_profit(status_payload: dict[str, Any], state: dict[str, dict[str, Any]]) -> None:
    try:
        saved = json.loads(FIB_PROFIT_FILE.read_text(encoding='utf-8'))
        if not isinstance(saved, dict):
            raise RuntimeError("Invalid saved Fib profit-taking state; no closes were sent.")
    except FileNotFoundError:
        saved = {}
    # Restore the remainder protection even while fresh zone data is loading after restart.
    for saved_key, event in saved.items():
        owner = json.loads(saved_key)
        if tuple(owner[:2]) != ACTIVE_ACCOUNT or (event.get('status') not in ('pending', 'partial', 'done')
                                                and not event.get('progressConfirmed')):
            continue
        for record in state.values():
            if (record.get('account'), record.get('server')) == ACTIVE_ACCOUNT \
                    and int(record.get('brokerPosition') or record.get('brokerTicket') or 0) == int(event.get('ticket', 0)):
                record['opposingFibProfitTaken'] = True
    config = status_payload.get('config') or {}
    snapshot = status_payload.get('opposingFibProfitTaking') or {}
    now = time.time()
    if config.get('dryRun', True) or not ALLOW_LIVE_EXECUTION or snapshot.get('available') is not True:
        return
    if (snapshot.get('account'), snapshot.get('server')) != ACTIVE_ACCOUNT:
        return
    as_of = snapshot.get('asOf')
    if not isinstance(as_of, (int, float)) or not math.isfinite(as_of) or not 0 <= now - as_of <= 90:
        return
    symbol = snapshot.get('brokerSymbol')
    if not symbol or symbol != config.get('brokerSymbol'):
        return
    assert_execution_account()
    positions = mt5.positions_get(symbol=symbol)
    if positions is None:
        raise RuntimeError("Unable to read positions for opposing Fib profit taking.")
    for position in positions:
        if position.magic not in (0, MAGIC_NUMBER) or position.symbol != symbol:
            continue
        trade_timeframe = position_fib_exit_timeframe(position, status_payload, state)
        if trade_timeframe is None:
            continue  # Never infer a manual trade's analysis timeframe from the current chart.
        key = json.dumps([*ACTIVE_ACCOUNT, symbol, int(getattr(position, 'identifier', 0) or position.ticket),
                          int(getattr(position, 'time_msc', getattr(position, 'time', 0))), int(position.type)])
        prior = saved.get(key)
        if prior and not fib_exit_timeframe_allowed(trade_timeframe, prior.get('zoneTimeframe')):
            prior = None  # A legacy lower-timeframe plan cannot authorize another close.
        info = mt5.symbol_info(symbol)
        if not info:
            continue
        if prior and (not math.isfinite(float(prior.get('targetRemaining', -1)))
                      or not 0 <= float(prior.get('targetRemaining', -1)) < float(prior.get('originalVolume', 0))):
            raise RuntimeError('Invalid saved Fib close target; no close was sent.')
        def mark_managed() -> None:
            for record in state.values():
                if int(record.get('brokerPosition') or record.get('brokerTicket') or 0) == int(position.ticket):
                    record['opposingFibProfitTaken'] = True
        if prior and prior.get('status') in ('pending', 'done'):
            # Reconcile after a crash/order timeout without ever submitting another 80% close.
            if float(position.volume) <= float(prior['targetRemaining']) + float(info.volume_step) / 2:
                if prior.get('status') != 'done' or not prior.get('progressConfirmed'):
                    prior.update(status='done', progressConfirmed=True)
                    write_fib_profit_state(saved)
            elif (prior.get('status') == 'pending' and prior.get('brokerRetcode') == mt5.TRADE_RETCODE_DONE_PARTIAL
                  and float(position.volume) < float(prior['lastVolume']) - float(info.volume_step) / 2):
                prior['status'] = 'partial'
                prior['progressConfirmed'] = True
                write_fib_profit_state(saved)
            mark_managed()
            # A pending ambiguous send must be reconciled before any new phase.
            # Once 80% is confirmed closed, the same zone may now close the rest.
            if prior.get('status') == 'pending' or float(prior['targetRemaining']) == 0:
                continue
        if prior and prior.get('status') == 'rejected' and now - float(prior.get('attemptedAt', now)) < 30:
            continue
        if prior and prior.get('progressConfirmed') and float(position.volume) > float(prior['lastVolume']) + float(info.volume_step) / 2:
            prior.update(status='done', error='Position volume increased after the partial close; remaining plan stopped.')
            write_fib_profit_state(saved)
            mark_managed()
            continue
        tick = mt5.symbol_info_tick(symbol)
        if not tick:
            continue
        tick_time = float(getattr(tick, 'time', 0)) - BROKER_TIME_OFFSET
        if tick_time <= 0 or abs(now - tick_time) > 120:
            continue
        buy = position.type == mt5.POSITION_TYPE_BUY
        quote, entry, target = float(tick.bid if buy else tick.ask), float(position.price_open), float(position.tp)
        if not all(math.isfinite(v) and v > 0 for v in (quote, entry, target)):
            continue
        previous_quote = FIB_PROFIT_PREVIOUS_QUOTES.get(key, quote)
        FIB_PROFIT_PREVIOUS_QUOTES[key] = quote
        has_fib_progress = bool(prior and prior.get('progressConfirmed'))
        candidates = []
        for zone in snapshot.get('zones', []):
            if not fib_exit_timeframe_allowed(trade_timeframe, zone.get('timeframe')):
                continue
            if zone.get('isBuy') is not (not buy):
                continue
            bottom, top = zone.get('bottom'), zone.get('top')
            if not all(isinstance(v, (int, float)) and math.isfinite(v) and v > 0 for v in (bottom, top)) or top <= bottom:
                continue
            edge = bottom if buy else top
            if not (entry < edge < target if buy else target < edge < entry):
                continue
            touched = bottom <= quote <= top or (previous_quote < bottom <= quote if buy else previous_quote > top >= quote)
            same_saved_zone = bool(prior and zone.get('id') == prior.get('zoneId')
                                   and zone.get('timeframe') == prior.get('zoneTimeframe', zone.get('timeframe')))
            confirmed_remainder = (has_fib_progress and same_saved_zone
                                   and fib_zone_engulfing_confirmed(zone, min(now, as_of)))
            if prior and not same_saved_zone:
                continue
            if prior and prior.get('status') == 'done' and not confirmed_remainder:
                continue
            if confirmed_remainder:
                # The zone was already touched: confirmation can arrive after
                # price leaves it, even if the remaining position is now losing.
                touched = True
            if touched:
                candidates.append((abs(edge - entry), zone))
        if not candidates:
            continue
        zone = min(candidates, key=lambda item: item[0])[1]
        full_exit = fib_zone_engulfing_confirmed(zone, min(now, as_of))
        if prior and prior.get('phase') == 'engulfing' and not full_exit:
            continue  # A legacy H4 engulfing-only plan cannot authorize a new remainder close.
        closing_remainder = has_fib_progress and full_exit
        if not closing_remainder and (float(position.profit) + float(position.swap) <= 0
                                     or not (entry < quote < target if buy else target < quote < entry)):
            continue
        upgrading = bool(prior and full_exit and prior.get('phase') != 'engulfing')
        if prior and prior.get('progressConfirmed') and int(prior.get('attempts', 0)) >= 3 and not upgrading:
            prior.update(status='done', remainingVolume=float(position.volume))
            write_fib_profit_state(saved)
            mark_managed()
            continue
        # Re-read the exact ticket immediately before closing, including manual trades (magic 0).
        assert_execution_account()
        live = mt5.positions_get(ticket=int(position.ticket))
        if not live or len(live) != 1 or live[0].type != position.type or live[0].symbol != symbol:
            continue
        position = live[0]
        if position_fib_exit_timeframe(position, status_payload, state) != trade_timeframe:
            continue
        if (not closing_remainder and float(position.profit) + float(position.swap) <= 0) or float(position.tp) != target:
            continue
        volume = float(position.volume)
        close_volume = (volume if full_exit else
                        round(volume - float(prior['targetRemaining']), 8) if prior and prior.get('progressConfirmed')
                        else fib_profit_close_volume(volume, info))
        if close_volume < float(info.volume_min) - 1e-8:
            if prior:
                prior.update(status='done', remainingVolume=volume)
                write_fib_profit_state(saved)
                mark_managed()
            continue
        if close_volume > float(info.volume_max):
            raise RuntimeError("Fib close exceeds the broker's per-order volume limit.")
        # Durably record the fixed remaining volume BEFORE the broker request.
        plan = prior if prior and prior.get('progressConfirmed') else {
            'originalVolume': volume, 'closeVolume': close_volume, 'targetRemaining': round(volume - close_volume, 8),
            'zoneId': zone.get('id'), 'zoneTimeframe': zone.get('timeframe'), 'zoneName': zone.get('name'),
            'originalSL': float(position.sl), 'originalTP': float(position.tp)}
        if full_exit:
            plan = {**plan, 'targetRemaining': 0.0, 'phase': 'engulfing',
                    'engulfingConfirmedAt': zone['engulfingConfirmedAt'],
                    'attempts': 0 if upgrading else int(plan.get('attempts', 0))}
        saved[key] = {**plan, 'status': 'pending', 'ticket': int(position.ticket), 'attemptedAt': now,
                      'lastVolume': volume, 'lastRequestedClose': close_volume, 'attempts': int(plan.get('attempts', 0)) + 1}
        write_fib_profit_state(saved)
        mark_managed()
        try:
            result = send_fib_profit_close({
                'action': mt5.TRADE_ACTION_DEAL, 'symbol': symbol, 'position': int(position.ticket),
                'volume': close_volume, 'type': mt5.ORDER_TYPE_SELL if buy else mt5.ORDER_TYPE_BUY,
                'price': quote, 'deviation': 20, 'magic': int(position.magic),
                'comment': 'KB Fib engulf exit' if full_exit else 'KB Fib80 profit',
            })
        except FibCloseRejected as error:
            saved[key].update(status='rejected', error=str(error))
            write_fib_profit_state(saved)
            if not saved[key].get('progressConfirmed'):
                for record in state.values():
                    if int(record.get('brokerPosition') or record.get('brokerTicket') or 0) == int(position.ticket):
                        record.pop('opposingFibProfitTaken', None)
            print(str(error), file=sys.stderr)
            continue
        saved[key]['deal'] = int(result.deal or result.order)
        saved[key]['brokerRetcode'] = int(result.retcode)
        remaining = mt5.positions_get(ticket=int(position.ticket))
        if remaining is not None:
            remaining_volume = float(remaining[0].volume) if remaining else 0.0
            if remaining_volume < volume - float(info.volume_step) / 2:
                # Finish only a confirmed partial fill's shortfall; never recalculate 80% of the remainder.
                complete = remaining_volume <= float(saved[key]['targetRemaining']) + float(info.volume_step) / 2
                saved[key].update(status='done' if complete else 'partial', remainingVolume=remaining_volume, progressConfirmed=True)
        write_fib_profit_state(saved)
        print(f"FIB PROFIT: position {position.ticket}; requested close {close_volume:g} of {volume:g} lots at opposing {zone.get('timeframe')} zone; original SL/TP unchanged.")


def closed_result(record: dict[str, Any], was_risk_free: bool) -> str:
    position_ticket = int(record.get("brokerPosition") or record.get("brokerTicket") or 0)
    deals = mt5.history_deals_get(position=position_ticket) or []
    exits = [deal for deal in deals if deal.entry == mt5.DEAL_ENTRY_OUT]
    if exits:
        last = exits[-1]
        if last.reason == mt5.DEAL_REASON_TP:
            return "TP"
        if last.reason == mt5.DEAL_REASON_SL:
            return "RF" if was_risk_free else "SL"
        return "TP" if sum(float(deal.profit) for deal in exits) > 0 else ("RF" if was_risk_free else "SL")
    return "RF" if was_risk_free else "CANCELLED"


def closed_trade_details(record: dict[str, Any], was_risk_free: bool) -> dict[str, Any]:
    position_ticket = int(record.get("brokerPosition") or record.get("brokerTicket") or 0)
    deals = mt5.history_deals_get(position=position_ticket) or []
    exits = [deal for deal in deals if deal.entry == mt5.DEAL_ENTRY_OUT]
    details: dict[str, Any] = {
        "status": closed_result(record, was_risk_free),
        "closedAt": int(time.time()),
    }
    if exits:
        details["closePrice"] = float(exits[-1].price)
        details["realizedProfit"] = sum(
            float(deal.profit) + float(deal.swap) + float(deal.commission)
            for deal in exits
        )
        if pullback_entry(record):
            entries = [deal for deal in deals if deal.entry == mt5.DEAL_ENTRY_IN]
            total_volume = sum(float(deal.volume) for deal in entries)
            if total_volume > 0:
                details['executionPrice'] = sum(float(deal.price) * float(deal.volume) for deal in entries) / total_volume
                details['volume'] = total_volume
                # Deal history uses the broker clock, just like position/candle
                # timestamps. The dashboard compares these values against UTC.
                details['openedAt'] = int(min(deal.time for deal in entries)) - BROKER_TIME_OFFSET
                details['closedAt'] = int(max(deal.time for deal in exits)) - BROKER_TIME_OFFSET
    return details


def pending_order_passed_one_and_half_r(record: dict[str, Any], tick: Any) -> bool:
    entry = float(record["entry"])
    stop_loss = float(record["stopLoss"])
    risk = abs(entry - stop_loss)
    if risk <= 0 or tick is None:
        return False
    if record.get('intradayEntry'):
        return (float(tick.bid) >= float(record['takeProfit']) if record['direction'] == 'BUY'
                else float(tick.ask) <= float(record['takeProfit']))
    multiple = 1.0 if record.get("tradeStyle") == "SCALP_1_1" else 1.5
    if record.get("tradeStyle") == "SCALP_1_1":
        if record.get('scalpEntry'):
            target = float(record['takeProfit'])
            return (float(tick.bid) >= target if record['direction'] == 'BUY' else float(tick.ask) <= target)
        return (float(tick.bid) >= entry + risk if record["direction"] == "BUY"
                else float(tick.ask) <= entry - risk)
    if record["direction"] == "BUY":
        return float(tick.bid) > entry + multiple * risk
    return float(tick.ask) < entry - multiple * risk


def scalp_pending_sibling_finished(record: dict[str, Any], other: dict[str, Any]) -> bool:
    if (other.get('tradeStyle') != 'SCALP_1_1' or other.get('signalAt') != record.get('signalAt')
            or other.get('direction') != record.get('direction')):
        return False
    meta = record.get('scalpEntry') or {}
    if meta.get('version') == 4:
        return (other.get('status') == 'SL' and other.get('scalpEntry', {}).get('version') == 4
                and other.get('scalpEntry', {}).get('setupKey') == meta.get('setupKey')
                and other.get('stopLoss') == record.get('stopLoss'))
    return other.get('status') in {'TP', 'SL', 'RF'}


def manage_open_signals(
    state: dict[str, dict[str, Any]],
    recent: list[dict[str, Any]],
    config: dict[str, Any],
) -> None:
    server_by_id = {item["id"]: item for item in recent}
    for signal_id, record in list(state.items()):
        assert_execution_account()
        server_signal = server_by_id.get(signal_id, {})
        status = server_signal.get("status", record.get("status"))
        # A broker fill can race server expiry/cancellation. Recover that filled
        # ticket first so its journal and fixed exits remain managed.
        if (pullback_entry(record) and record.get('status') == 'PLACED'
                and status in {'CANCELLED', 'EXPIRED'} and find_position(record)):
            status = 'PLACED'
        elif (pullback_entry(record) and record.get('status') == 'PLACED'
              and status in {'CANCELLED', 'EXPIRED'}):
            closed = closed_trade_details(record, False)
            if closed.get('status') in {'TP', 'SL', 'RF'} and closed.get('closePrice'):
                update_status(signal_id, closed.pop('status'), **closed)
                state.pop(signal_id, None)
                continue
        disabled_scalp_order = (status == "PLACED" and record.get("tradeStyle") == "SCALP_1_1"
                               and not config.get("scalpOneToOneEnabled", False)
                               and bool(mt5.orders_get(ticket=int(record.get("brokerTicket") or 0)) or []))
        if disabled_scalp_order:
            status = "CANCELLED"  # Stop unfilled orders; an open position keeps its SL/TP.
        disabled_intraday_order = (status == 'PLACED' and bool(record.get('intradayEntry'))
            and not config.get('intradayEnabled', True)
            and bool(mt5.orders_get(ticket=int(record.get('brokerTicket') or 0)) or []))
        if disabled_intraday_order:
            status = 'CANCELLED'
        pullback_cancel = None
        if status == 'PLACED' and pullback_entry(record):
            broker_symbol = record.get('brokerSymbol') or record['symbol']
            tick = mt5.symbol_info_tick(broker_symbol)
            expired = float(record.get('expiresAt', 0)) <= time.time()
            stop_hit = tick is not None and (float(tick.bid) <= float(record['stopLoss'])
                if record['direction'] == 'BUY' else float(tick.ask) >= float(record['stopLoss']))
            sibling_done = any(scalp_pending_sibling_finished(record, item) for item in recent)
            if record.get('intradayEntry'):
                sibling_done = any(same_intraday_setup(record, item) and item.get('status') in {'TP', 'SL', 'RF'} for item in recent)
            stop_hit = stop_hit or (tick is not None and intraday_boundary_reached(record, broker_symbol, tick))
            if expired or stop_hit or sibling_done:
                ticket = int(record.get('brokerTicket') or 0)
                if ticket and (mt5.orders_get(ticket=ticket) or []):
                    status = 'CANCELLED'
                    pullback_cancel = 'Pullback order cancelled: entry deadline or original setup SL/TP reached.'
        if status == "PLACED" and config.get("tradingTimeEnabled", False) and not is_nepal_trading_time():
            ticket = int(record.get("brokerTicket") or 0)
            if ticket and (mt5.orders_get(ticket=ticket) or []):
                assert_execution_account()
                removal = mt5.order_send({
                    "action": mt5.TRADE_ACTION_REMOVE,
                    "order": ticket,
                    "magic": MAGIC_NUMBER,
                    "comment": "Outside trading time",
                })
                if not removal or removal.retcode != mt5.TRADE_RETCODE_DONE:
                    print(f"Could not remove out-of-session pending order {ticket}: {mt5.last_error()}", file=sys.stderr)
                    continue
            update_status(signal_id, "CANCELLED", message="Pending order cancelled outside Nepal trading time.")
            state.pop(signal_id, None)
            continue
        if status in {"CANCELLED", "EXPIRED"} and record.get("status") == "PLACED":
            ticket = int(record.get("brokerTicket") or 0)
            if ticket and (mt5.orders_get(ticket=ticket) or []):
                assert_execution_account()
                removal = mt5.order_send({
                    "action": mt5.TRADE_ACTION_REMOVE,
                    "order": ticket,
                    "magic": MAGIC_NUMBER,
                    "comment": "Dashboard expiry",
                })
                if not removal or removal.retcode != mt5.TRADE_RETCODE_DONE:
                    print(f"Could not remove expired pending order {ticket}: {mt5.last_error()}", file=sys.stderr)
                    continue
            if disabled_scalp_order:
                update_status(signal_id, "CANCELLED", message="Scalp 1:1 disabled; unfilled order cancelled.")
            elif disabled_intraday_order:
                update_status(signal_id, 'CANCELLED', message='Intraday disabled; unfilled order cancelled.')
            elif pullback_cancel:
                update_status(signal_id, 'CANCELLED', message=pullback_cancel)
        if status in {"TP", "SL", "RF", "CANCELLED", "REJECTED", "EXPIRED", "SIMULATED"}:
            state.pop(signal_id, None)
            continue
        if status == "PLACED":
            ticket = int(record.get("brokerTicket") or 0)
            if ticket and (mt5.orders_get(ticket=ticket) or []):
                tick = mt5.symbol_info_tick(record.get('brokerSymbol') or record['symbol'])
                if pending_order_passed_one_and_half_r(record, tick):
                    assert_execution_account()
                    removal = mt5.order_send({
                        "action": mt5.TRADE_ACTION_REMOVE,
                        "order": ticket,
                        "magic": MAGIC_NUMBER,
                        "comment": "Pending passed 1R" if record.get("tradeStyle") == "SCALP_1_1" else "Pending passed 1.5R",
                    })
                    if not removal or removal.retcode != mt5.TRADE_RETCODE_DONE:
                        print(f"Could not remove 1.5R-expired pending order {ticket}: {mt5.last_error()}", file=sys.stderr)
                        continue
                    update_status(
                        signal_id, "CANCELLED",
                        message=("Pending order cancelled at the original 1R target before entry."
                                 if record.get("tradeStyle") == "SCALP_1_1"
                                 else "Pending order cancelled after price moved beyond 1.5R before entry."),
                    )
                    state.pop(signal_id, None)
                    print(f"CANCELLED: pending order {ticket} moved beyond 1.5R before entry")
                continue
            position = find_position(record)
            if position:
                execution_price = float(position.price_open)
                initial_stop_loss = float(record.get("initialStopLoss") or position.sl or record["stopLoss"])
                actual_risk = abs(execution_price - initial_stop_loss)
                risk_multiple = float(config.get("moveStopToBreakEvenAtR", 1))
                risk_free = execution_price + actual_risk * risk_multiple if position.type == mt5.POSITION_TYPE_BUY else execution_price - actual_risk * risk_multiple
                record["brokerPosition"] = int(position.ticket)
                record["status"] = "ACTIVE"
                record["executionPrice"] = execution_price
                record["initialStopLoss"] = initial_stop_loss
                record["riskFree"] = risk_free
                record["riskPips"] = actual_risk * 10
                update_status(
                    signal_id,
                    "ACTIVE",
                    brokerPosition=int(position.ticket),
                    executionPrice=execution_price,
                    initialStopLoss=initial_stop_loss,
                    openedAt=int(time.time()),
                    riskFree=risk_free,
                    riskPips=actual_risk * 10,
                )
                continue
            close_details = closed_trade_details(record, False)
            update_status(
                signal_id,
                close_details.pop("status"),
                **close_details,
                message="Pending order no longer exists.",
            )
            state.pop(signal_id, None)
            continue
        position = find_position(record)
        if not position:
            close_details = closed_trade_details(record, status == "RISK_FREE")
            update_status(
                signal_id,
                close_details.pop("status"),
                **close_details,
                message="MT5 position closed.",
            )
            state.pop(signal_id, None)
            continue
        if record.get('tradeStyle') in ('SCALP_1_1', 'BOLLINGER_M5') or record.get('opposingFibProfitTaken'):
            continue  # Its remaining position must reach the original TP/SL, without another 1R partial close.
        is_buy = position.type == mt5.POSITION_TYPE_BUY
        tick = mt5.symbol_info_tick(position.symbol)
        execution_price = float(position.price_open)
        initial_stop_loss = float(record.get("initialStopLoss") or position.sl or record["stopLoss"])
        actual_risk = abs(execution_price - initial_stop_loss)
        risk_multiple = float(config.get("moveStopToBreakEvenAtR", 1))
        risk_free = execution_price + actual_risk * risk_multiple if is_buy else execution_price - actual_risk * risk_multiple
        if status != "RISK_FREE" and abs(float(record.get("riskFree") or 0) - risk_free) > 1e-9:
            record["executionPrice"] = execution_price
            record["initialStopLoss"] = initial_stop_loss
            record["riskFree"] = risk_free
            record["riskPips"] = actual_risk * 10
            update_status(
                signal_id,
                "ACTIVE",
                executionPrice=execution_price,
                riskFree=risk_free,
                riskPips=actual_risk * 10,
            )
        reached = tick and (float(tick.bid) >= risk_free if is_buy else float(tick.ask) <= risk_free)
        info = mt5.symbol_info(position.symbol)
        initial_volume = float(record.get("initialVolume") or record.get("volume") or position.volume)
        current_volume = float(position.volume)
        partial_already_done = bool(record.get("partialClosedAt")) or (
            info is not None and current_volume < initial_volume - float(info.volume_step) / 2
        )
        if status != "RISK_FREE" and partial_already_done and (
            record.get("tradeStyle") == "SCALPING" or record.get("partialClosedAt")
        ):
            partial_details = {
                "initialVolume": initial_volume,
                "partialClosedVolume": max(0.0, initial_volume - current_volume),
                "remainingVolume": current_volume,
                "partialClosePrice": float(record.get("partialClosePrice") or 0),
                "partialCloseTicket": int(record.get("partialCloseTicket") or 0),
                "partialClosedAt": int(record.get("partialClosedAt") or time.time()),
            }
            record.update(partial_details)
            record["status"] = "RISK_FREE"
            update_status(
                signal_id,
                "RISK_FREE",
                **partial_details,
                message="50% was closed at 1R; the remaining position keeps its original SL and TP.",
            )
            continue
        if status != "RISK_FREE" and record.get("tradeStyle") == "SCALPING" and reached:
            partial_details = close_half_position(position, record)
            record.update(partial_details)
            record["status"] = "RISK_FREE"
            update_status(
                signal_id,
                "RISK_FREE",
                **partial_details,
                message="50% closed at 1R; remaining volume continues with the original SL and TP.",
            )
            print(
                f"RISK FREE: closed {partial_details['partialClosedVolume']:g} {position.symbol}; "
                f"remaining {partial_details['remainingVolume']:g} with original SL/TP"
            )


def process_bridge_cycle(
    status_payload: dict[str, Any],
    state: dict[str, dict[str, Any]],
    last_heartbeat: float,
) -> float:
    global LEGACY_STATE_CHECKED
    account = ensure_mt5_connection()
    config = dict(status_payload["config"])
    try:
        config["brokerSymbol"] = resolve_gold_symbol(config, account)
    except RuntimeError as error:
        config["brokerSymbol"] = ""
        heartbeat(config, message=str(error))
        return time.time()
    remote = status_payload.get("bridge", {})
    if (remote.get("account"), remote.get("server"), remote.get("brokerSymbol")) != (*ACTIVE_ACCOUNT, config["brokerSymbol"]):
        LAST_MARKET_BAR_TIME.clear()
    else:
        for label, history in status_payload.get("marketData", {}).get("timeframes", {}).items():
            if not history.get("count"):
                LAST_MARKET_BAR_TIME.pop(label, None)
    # Synchronize account and symbol before publishing any candles or accepting a signal.
    if time.time() - last_heartbeat >= 5 or status_payload.get("bridge", {}).get("account") != str(account.login):
        heartbeat(config, message="Bridge ready")
        last_heartbeat = time.time()
    assert_execution_account()
    try:
        published_timeframes = publish_mt5_market_data(config)
        market_data_issue = None
    except RuntimeError as error:
        published_timeframes = 0
        market_data_issue = str(error)
    if published_timeframes:
        print(f"MT5 DATA: published {published_timeframes} updated timeframe snapshot(s)")
    if market_data_issue is not None or time.time() - last_heartbeat >= 5:
        message = f"Market data paused: {market_data_issue}" if market_data_issue else "Bridge ready"
        heartbeat(config, message=message)
        last_heartbeat = time.time()
    recent_signals = [record for record in status_payload.get("recentSignals", [])
                      if (record.get("account"), record.get("server")) == ACTIVE_ACCOUNT]
    previous_bridge = status_payload.get("bridge", {})
    # Check legacy ownership only at startup, never after publishing a different account's heartbeat.
    if not LEGACY_STATE_CHECKED:
        LEGACY_STATE_CHECKED = True
        if (previous_bridge.get("account"), previous_bridge.get("server")) == ACTIVE_ACCOUNT:
            for record in state.values():
                if not record.get("account"):
                    record.update(account=str(account.login), server=str(account.server))
    for server_signal in recent_signals:
        if (
            server_signal.get("bridgeId") == BRIDGE_ID
            and (server_signal.get("account"), server_signal.get("server")) == ACTIVE_ACCOUNT
            and server_signal.get("status") in {"PLACED", "ACTIVE", "RISK_FREE"}
        ):
            state.setdefault(server_signal["id"], dict(server_signal))
    if market_data_issue is None:
        manage_opposing_fib_profit(status_payload, state)
        active_state = {key: value for key, value in state.items()
                        if (value.get("account"), value.get("server")) == ACTIVE_ACCOUNT}
        managed_ids = set(active_state)
        manage_open_signals(active_state, recent_signals, config)
        for removed_id in managed_ids - active_state.keys():
            state.pop(removed_id, None)
    save_state(state)
    if market_data_issue is not None:
        return last_heartbeat
    assert_execution_account()
    claim = api("POST", "/api/mt5/signals/claim", json={
        "bridgeId": BRIDGE_ID, "account": str(account.login), "server": str(account.server),
        "brokerSymbol": config["brokerSymbol"],
    })
    signal = claim.get("signal")
    if signal:
        try:
            if (signal.get("account"), signal.get("server")) != ACTIVE_ACCOUNT:
                raise RuntimeError("Signal belongs to a different MT5 account.")
            if signal.get("brokerSymbol") != config["brokerSymbol"] or claim["config"].get("brokerSymbol") != config["brokerSymbol"]:
                raise RuntimeError("Broker symbol changed while claiming the signal; waiting for synchronization.")
            assert_execution_account()
            record = {**signal, **place_signal(signal, claim["config"])}
            if record.get("status") not in {"SIMULATED", "REJECTED", "CANCELLED"}:
                state[signal["id"]] = record
                save_state(state)
        except Exception as error:  # Keep the bridge alive and make the failure visible.
            update_status(signal["id"], "REJECTED", message=str(error))
            print(f"REJECTED {signal['id']}: {error}", file=sys.stderr)
    return last_heartbeat


def run() -> None:
    state = load_state()
    last_heartbeat = 0.0
    try:
        while True:
            try:
                status_payload = api("GET", "/api/mt5/status")
                last_heartbeat = process_bridge_cycle(status_payload, state, last_heartbeat)
            except requests.RequestException as error:
                print(f"Dashboard connection error: {error}", file=sys.stderr)
            except Exception as error:
                print(f"Bridge loop error: {error}", file=sys.stderr)
                try:
                    heartbeat({"brokerSymbol": ""}, message=str(error))
                except Exception:
                    pass  # Keep retrying even when the terminal or dashboard is temporarily unavailable.
            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        print("Bridge stopped.")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    run()
