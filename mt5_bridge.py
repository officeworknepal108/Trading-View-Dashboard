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
        "positions": [{
            "ticket": int(position.ticket),
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


def normalize_volume(raw_volume: float, symbol_info: Any) -> float:
    step = float(symbol_info.volume_step)
    minimum = float(symbol_info.volume_min)
    maximum = float(symbol_info.volume_max)
    stepped = math.floor((raw_volume + 1e-12) / step) * step
    if stepped < minimum:
        raise RuntimeError(
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


def calculate_volume(signal: dict[str, Any], config: dict[str, Any], symbol_info: Any) -> float:
    account = mt5.account_info()
    if not account:
        raise RuntimeError("Unable to read account equity.")
    sl_pips = float(signal.get("riskPips", 0))
    if not math.isfinite(sl_pips) or sl_pips <= 0:
        raise RuntimeError("SL pip distance must be a positive number.")
    risk_money = float(account.equity) * float(config["riskPercent"]) / 100.0
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
    if not is_limit:
        spread = float(tick.ask) - float(tick.bid)
        if not math.isfinite(spread) or spread < 0:
            raise RuntimeError("The live MT5 spread is invalid.")
        if spread >= 0.20 * abs(price - stop):
            raise RuntimeError("MT5 spread is too large relative to the planned stop distance.")
    account = mt5.account_info()
    if not account or not math.isfinite(float(account.equity)) or float(account.equity) <= 0:
        raise RuntimeError("Unable to verify live MT5 account risk.")
    risk_budget = float(account.equity) * float(config["riskPercent"]) / 100.0
    loss_at_stop = mt5.order_calc_profit(
        mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL,
        symbol_info.name, volume, price, stop,
    )
    if loss_at_stop is None or not math.isfinite(float(loss_at_stop)):
        raise RuntimeError("MT5 could not calculate loss at the planned stop.")
    if -float(loss_at_stop) > risk_budget + max(0.01, risk_budget * 0.005):
        raise RuntimeError("Live MT5 entry price would exceed the configured per-trade risk.")
    return price


def overall_profit_snapshot(now: datetime | None = None) -> dict[str, Any]:
    """Read-only bot P/L across all available history of the connected account."""
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
        bot_ids = {int(deal.position_id) for deal in deals
                   if deal.magic == MAGIC_NUMBER and deal.type in trade_types and deal.position_id}
        realized_by_position: dict[int, float] = {}
        for deal in deals:
            if deal.type not in trade_types or (deal.magic != MAGIC_NUMBER and deal.position_id not in bot_ids):
                continue
            amount = math.fsum(float(getattr(deal, field, 0)) for field in ("profit", "commission", "swap", "fee"))
            if not math.isfinite(amount):
                raise RuntimeError("Overall profit/loss is unavailable: invalid deal values.")
            position_id = int(deal.position_id or deal.ticket)
            realized_by_position[position_id] = realized_by_position.get(position_id, 0) + amount
        profit = math.fsum(max(0, value) for value in realized_by_position.values())
        loss = math.fsum(max(0, -value) for value in realized_by_position.values())
        assert_execution_account()
        OVERALL_PROFIT_CACHE.update(key=key, checkedAt=checked_at, botIds=bot_ids,
                                    profit=profit, loss=loss)
    positions = mt5.positions_get()
    if positions is None:
        raise RuntimeError("Overall profit/loss is unavailable: MT5 positions could not be read.")
    floating = math.fsum(float(position.profit) + float(position.swap) for position in positions
                        if position.magic == MAGIC_NUMBER
                        or getattr(position, "identifier", position.ticket) in OVERALL_PROFIT_CACHE["botIds"])
    if not math.isfinite(floating):
        raise RuntimeError("Overall profit/loss is unavailable: invalid floating values.")
    assert_execution_account()
    profit, loss = OVERALL_PROFIT_CACHE["profit"], OVERALL_PROFIT_CACHE["loss"]
    realized = profit - loss
    return {"available": True, "realizedProfitMoney": profit, "realizedLossMoney": loss,
            "netRealizedMoney": realized, "floatingMoney": floating, "netMoney": realized + floating}


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


def check_safety(signal: dict[str, Any], config: dict[str, Any]) -> tuple[Any, Any]:
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
    symbol = str(config["brokerSymbol"])
    if not mt5.symbol_select(symbol, True):
        raise RuntimeError(f"Broker symbol {symbol} is unavailable: {mt5.last_error()}")
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
    return info, tick


def send_with_filling_fallback(request: dict[str, Any], risk_config: dict[str, Any] | None = None) -> Any:
    result = None
    successful_send_codes = (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL)
    for filling in (mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN):
        assert_execution_account()
        candidate = {**request, "type_filling": filling}
        checked = mt5.order_check(candidate)
        if checked is None or checked.retcode not in (0, mt5.TRADE_RETCODE_DONE):
            continue
        assert_execution_account()
        if risk_config is not None:
            check_daily_trade_budget(request, risk_config)
        result = mt5.order_send(candidate)
        if result and result.retcode in successful_send_codes:
            return result
    detail = getattr(result, "comment", None) or str(mt5.last_error())
    raise RuntimeError(f"MT5 rejected the order: {detail}")


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
    result = send_with_filling_fallback(request, risk_config=config)
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
    return details


def pending_order_passed_one_and_half_r(record: dict[str, Any], tick: Any) -> bool:
    entry = float(record["entry"])
    stop_loss = float(record["stopLoss"])
    risk = abs(entry - stop_loss)
    if risk <= 0 or tick is None:
        return False
    if record["direction"] == "BUY":
        return float(tick.bid) > entry + 1.5 * risk
    return float(tick.ask) < entry - 1.5 * risk


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
        if status in {"TP", "SL", "RF", "CANCELLED", "REJECTED", "EXPIRED", "SIMULATED"}:
            state.pop(signal_id, None)
            continue
        if status == "PLACED":
            ticket = int(record.get("brokerTicket") or 0)
            if ticket and (mt5.orders_get(ticket=ticket) or []):
                tick = mt5.symbol_info_tick(record["symbol"])
                if pending_order_passed_one_and_half_r(record, tick):
                    assert_execution_account()
                    removal = mt5.order_send({
                        "action": mt5.TRADE_ACTION_REMOVE,
                        "order": ticket,
                        "magic": MAGIC_NUMBER,
                        "comment": "Pending passed 1.5R",
                    })
                    if not removal or removal.retcode != mt5.TRADE_RETCODE_DONE:
                        print(f"Could not remove 1.5R-expired pending order {ticket}: {mt5.last_error()}", file=sys.stderr)
                        continue
                    update_status(
                        signal_id, "CANCELLED",
                        message="Pending order cancelled after price moved beyond 1.5R before entry.",
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
            if record.get("status") not in {"SIMULATED", "REJECTED"}:
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
