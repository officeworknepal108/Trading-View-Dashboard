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
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2), encoding="utf-8")
    temporary.replace(STATE_FILE)


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
    api("POST", "/api/mt5/heartbeat", json={
        "bridgeId": BRIDGE_ID,
        "processId": os.getpid(),
        "account": CONNECTED_ACCOUNT,
        "server": CONNECTED_SERVER,
        "brokerSymbol": config.get("brokerSymbol", "XAUUSDm"),
        "message": message,
    })


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


def calculate_volume(signal: dict[str, Any], config: dict[str, Any], symbol_info: Any) -> float:
    account = mt5.account_info()
    if not account:
        raise RuntimeError("Unable to read account equity.")
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
    risk_money = float(account.equity) * float(config["riskPercent"]) / 100.0
    return normalize_volume(risk_money / abs(one_lot_loss), symbol_info)


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
    for filling in (mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN):
        candidate = {**request, "type_filling": filling}
        checked = mt5.order_check(candidate)
        if checked is None or checked.retcode not in (0, mt5.TRADE_RETCODE_DONE):
            continue
        result = mt5.order_send(candidate)
        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            return result
    detail = getattr(result, "comment", None) or str(mt5.last_error())
    raise RuntimeError(f"MT5 rejected the order: {detail}")


def place_signal(signal: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    if config.get("dryRun", True) or not ALLOW_LIVE_EXECUTION:
        reason = "Dashboard dry run" if config.get("dryRun", True) else "MT5_ALLOW_LIVE_EXECUTION is not YES"
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
    details = {
        "status": status,
        "brokerTicket": int(result.order),
        "brokerPosition": int(result.order) if not is_limit else 0,
        "executionPrice": float(result.price or price),
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


def manage_open_signals(state: dict[str, dict[str, Any]], recent: list[dict[str, Any]]) -> None:
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
                record["brokerPosition"] = int(position.ticket)
                record["status"] = "ACTIVE"
                update_status(signal_id, "ACTIVE", brokerPosition=int(position.ticket), executionPrice=float(position.price_open))
                continue
            result = closed_result(record, False)
            update_status(signal_id, result, message="Pending order no longer exists.")
            state.pop(signal_id, None)
            continue
        position = find_position(record)
        if not position:
            result = closed_result(record, status == "RISK_FREE")
            update_status(signal_id, result, message="MT5 position closed.")
            state.pop(signal_id, None)
            continue
        is_buy = position.type == mt5.POSITION_TYPE_BUY
        tick = mt5.symbol_info_tick(position.symbol)
        risk_free = float(record["riskFree"])
        reached = tick and (float(tick.bid) >= risk_free if is_buy else float(tick.ask) <= risk_free)
        if status != "RISK_FREE" and reached:
            request = {
                "action": mt5.TRADE_ACTION_SLTP,
                "symbol": position.symbol,
                "position": int(position.ticket),
                "sl": float(position.price_open),
                "tp": float(position.tp),
                "magic": MAGIC_NUMBER,
            }
            result = mt5.order_send(request)
            if result and result.retcode == mt5.TRADE_RETCODE_DONE:
                record["status"] = "RISK_FREE"
                update_status(signal_id, "RISK_FREE", message="SL moved to the actual MT5 entry price.")


def run() -> None:
    initialize_mt5()
    state = load_state()
    last_heartbeat = 0.0
    try:
        while True:
            try:
                status_payload = api("GET", "/api/mt5/status")
                config = status_payload["config"]
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
                manage_open_signals(state, recent_signals)
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
