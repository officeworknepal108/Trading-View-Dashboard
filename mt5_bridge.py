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
from datetime import datetime
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
BRIDGE_ID = os.getenv("MT5_BRIDGE_ID", f"kalbairab-{uuid.getnode():x}")
STATE_FILE = ROOT / ".mt5_bridge_state.json"
CONNECTED_ACCOUNT = ""
CONNECTED_SERVER = ""
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

SESSION = requests.Session()
if BRIDGE_TOKEN:
    SESSION.headers.update({"Authorization": f"Bearer {BRIDGE_TOKEN}"})


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


def initialize_mt5() -> None:
    global CONNECTED_ACCOUNT, CONNECTED_SERVER
    arguments: dict[str, Any] = {}
    if MT5_PATH:
        arguments["path"] = MT5_PATH
    if MT5_LOGIN:
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


def heartbeat(config: dict[str, Any], message: str = "Bridge ready") -> None:
    global CONNECTED_ACCOUNT, CONNECTED_SERVER
    account = mt5.account_info()
    if account:
        CONNECTED_ACCOUNT = str(account.login)
        CONNECTED_SERVER = str(account.server)
    symbol = str(config.get("brokerSymbol", "XAUUSD"))
    positions = mt5.positions_get(symbol=symbol) or []
    try:
        time_offset = broker_utc_offset_seconds(symbol)
    except RuntimeError:
        time_offset = 0
    api("POST", "/api/mt5/heartbeat", json={
        "bridgeId": BRIDGE_ID,
        "processId": os.getpid(),
        "account": CONNECTED_ACCOUNT,
        "server": CONNECTED_SERVER,
        "balance": float(account.balance) if account else None,
        "equity": float(account.equity) if account else None,
        "freeMargin": float(account.margin_free) if account else None,
        "currency": str(account.currency) if account else None,
        "brokerSymbol": symbol,
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
        raise RuntimeError(f"Unable to read {symbol} broker time: {mt5.last_error()}")
    raw_offset = int(tick.time) - int(time.time())
    rounded_offset = int(round(raw_offset / 900.0) * 900)
    if abs(rounded_offset) > 14 * 60 * 60:
        raise RuntimeError(f"Broker time offset {rounded_offset}s is outside the safe range.")
    return rounded_offset


def publish_mt5_market_data(config: dict[str, Any]) -> int:
    symbol = str(config.get("brokerSymbol", "XAUUSD"))
    if not mt5.symbol_select(symbol, True):
        raise RuntimeError(f"Broker symbol {symbol} is unavailable for candle data: {mt5.last_error()}")
    utc_offset = broker_utc_offset_seconds(symbol)
    published = 0
    for label, timeframe in MT5_MARKET_TIMEFRAMES.items():
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
        response = api("POST", "/api/mt5/market-data", json={
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
    # Do not open a position that cannot follow the agreed 50%-at-1R exit plan.
    calculate_partial_close_volume(volume, volume, symbol_info)
    return volume


def today_realized_loss_percent() -> float:
    account = mt5.account_info()
    if not account or account.balance <= 0:
        return 0.0
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    deals = mt5.history_deals_get(start, datetime.now()) or []
    realized = sum(float(deal.profit) + float(deal.commission) + float(deal.swap)
                   for deal in deals if deal.magic == MAGIC_NUMBER)
    return max(0.0, -realized / float(account.balance) * 100.0)


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
    if today_realized_loss_percent() >= float(config["maximumDailyLossPercent"]):
        raise RuntimeError("Maximum automated daily loss has been reached.")
    entry, sl, tp = map(float, (signal["entry"], signal["stopLoss"], signal["takeProfit"]))
    if signal["direction"] == "BUY" and not sl < entry < tp:
        raise RuntimeError("Invalid BUY entry/SL/TP order.")
    if signal["direction"] == "SELL" and not tp < entry < sl:
        raise RuntimeError("Invalid SELL entry/SL/TP order.")
    return info, tick


def send_with_filling_fallback(request: dict[str, Any]) -> Any:
    result = None
    successful_send_codes = (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL)
    for filling in (mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN):
        candidate = {**request, "type_filling": filling}
        checked = mt5.order_check(candidate)
        if checked is None or checked.retcode not in (0, mt5.TRADE_RETCODE_DONE):
            continue
        result = mt5.order_send(candidate)
        if result and result.retcode in successful_send_codes:
            return result
    detail = getattr(result, "comment", None) or str(mt5.last_error())
    raise RuntimeError(f"MT5 rejected the order: {detail}")


def place_signal(signal: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    if config.get("dryRun", True) or not ALLOW_LIVE_EXECUTION:
        reason = "Send Trades to MT5 is NO" if config.get("dryRun", True) else "MT5_ALLOW_LIVE_EXECUTION is not YES"
        update_status(signal["id"], "SIMULATED", message=f"Validated without an order: {reason}.")
        print(f"DRY RUN {signal['direction']} {signal['zoneTimeframe']} {signal['zoneName']}")
        return {"status": "SIMULATED"}

    info, tick = check_safety(signal, config)
    volume = calculate_volume(signal, config, info)
    is_buy = signal["direction"] == "BUY"
    is_limit = signal["orderType"] == "LIMIT"
    if is_limit:
        if is_buy and float(signal["entry"]) >= float(tick.ask):
            raise RuntimeError("BUY LIMIT entry is not below the current ask price.")
        if not is_buy and float(signal["entry"]) <= float(tick.bid):
            raise RuntimeError("SELL LIMIT entry is not above the current bid price.")
        order_type = mt5.ORDER_TYPE_BUY_LIMIT if is_buy else mt5.ORDER_TYPE_SELL_LIMIT
        action = mt5.TRADE_ACTION_PENDING
        price = float(signal["entry"])
    else:
        order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
        action = mt5.TRADE_ACTION_DEAL
        price = float(tick.ask if is_buy else tick.bid)
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
    result = send_with_filling_fallback(request)
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


def manage_open_signals(
    state: dict[str, dict[str, Any]],
    recent: list[dict[str, Any]],
    config: dict[str, Any],
) -> None:
    server_by_id = {item["id"]: item for item in recent}
    for signal_id, record in list(state.items()):
        server_signal = server_by_id.get(signal_id, {})
        status = server_signal.get("status", record.get("status"))
        if status in {"CANCELLED", "EXPIRED"} and record.get("status") == "PLACED":
            ticket = int(record.get("brokerTicket") or 0)
            if ticket and (mt5.orders_get(ticket=ticket) or []):
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
        if status != "RISK_FREE" and partial_already_done:
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
        if status != "RISK_FREE" and reached:
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


def run() -> None:
    initialize_mt5()
    state = load_state()
    last_heartbeat = 0.0
    try:
        while True:
            try:
                status_payload = api("GET", "/api/mt5/status")
                config = status_payload["config"]
                published_timeframes = publish_mt5_market_data(config)
                if published_timeframes:
                    print(f"MT5 DATA: published {published_timeframes} updated timeframe snapshot(s)")
                if time.time() - last_heartbeat >= 5:
                    heartbeat(config)
                    last_heartbeat = time.time()
                recent_signals = status_payload.get("recentSignals", [])
                for server_signal in recent_signals:
                    if (
                        server_signal.get("bridgeId") == BRIDGE_ID
                        and server_signal.get("status") in {"PLACED", "ACTIVE", "RISK_FREE"}
                    ):
                        state.setdefault(server_signal["id"], dict(server_signal))
                manage_open_signals(state, recent_signals, config)
                save_state(state)
                claim = api("POST", "/api/mt5/signals/claim", json={"bridgeId": BRIDGE_ID})
                signal = claim.get("signal")
                if signal:
                    try:
                        record = {**signal, **place_signal(signal, claim["config"])}
                        if record.get("status") not in {"SIMULATED", "REJECTED"}:
                            state[signal["id"]] = record
                            save_state(state)
                    except Exception as error:  # Keep the bridge alive and make the failure visible.
                        update_status(signal["id"], "REJECTED", message=str(error))
                        print(f"REJECTED {signal['id']}: {error}", file=sys.stderr)
            except requests.RequestException as error:
                print(f"Dashboard connection error: {error}", file=sys.stderr)
            except Exception as error:
                print(f"Bridge loop error: {error}", file=sys.stderr)
            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        print("Bridge stopped.")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    run()
