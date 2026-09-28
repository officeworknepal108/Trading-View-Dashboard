# TradingView OANDA Market-Structure Dashboard

A React candlestick dashboard that requests `OANDA:XAUUSD` candles through
TradingView's unofficial WebSocket protocol. It overlays MG market structure,
TJL/QML zones, higher-timeframe TJL1 confirmation, supply/demand, ISS five-wave
structure, and bar replay. It does not place trades or substitute synthetic or
Binance candles.

## Setup

1. Run `npm install` and `npm run dev`.
2. Open `http://127.0.0.1:3002`.

Port 3002 is the saved default in `.env`. To use another port temporarily, set
the `PORT` environment variable before starting the server.

## Current checkpoint

- Active project folder: `C:\Users\ABHI\Desktop\new algo file updated`
- Current dashboard: `http://127.0.0.1:3002`
- TJL1 mapped confirmation uses the observed OANDA session boundaries. H4,
  daily, and weekly aggregation is anchored to 5 p.m. New York and follows the
  daylight-saving shift.
- Domain-specific MG/ISS extensions remain intentionally deferred until dated,
  user-validated XAUUSD chart examples are available.

## Verification

- `npm run lint` checks TypeScript.
- `npm test` runs market-structure regression tests.
- `npm run build` creates the production dashboard and server bundle.

No token is required. This is not the official OANDA API and TradingView may
change or restrict the protocol. The server returns an explicit error when the
feed is unavailable and never substitutes synthetic or Binance candles.
