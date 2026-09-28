# TradingView OANDA Chart Setup

The chart requests `OANDA:XAUUSD` through TradingView's unofficial WebSocket
protocol. It does not use the authenticated OANDA v20 API and requires no API
token.

## Run

1. Run `npm install`.
2. Start the dashboard with `npm run dev`.
3. Open `http://127.0.0.1:3002`.

The saved default is `PORT=3002` in `.env`.

## Data contract

- Provider: unofficial TradingView WebSocket protocol
- TradingView symbol: `OANDA:XAUUSD`
- Supported intervals: M1, M5, M15, M30, H1, H4, and D
- Maximum request size: 5,000 candles; the chart requests 1,500
- Refresh interval: 15 seconds
- The latest candle is labelled as forming
- Failure behavior: explicit disconnected/error state; no fallback data

## Structure overlays

- MG structure begins at the Genesis Low and marks HH, HL, LH, LL, BOS, and CHoCH.
- TJL1 confirmation mapping is 1m→5m, 5m→15m, 15m/30m→1h, 1h→4h,
  4h→daily, and daily→weekly.
- The 1h→4h, 4h→daily, and daily→weekly mappings use the OANDA forex
  session boundary at 5 p.m. New York. The UTC boundary changes automatically
  with U.S. daylight saving time; weekly aggregation starts at the Sunday
  session open.
- Zones are drawn for 30 source bars. Their active/invalid state is still retained.
- Supply/demand is calculated only on H1, H4, and D.
- ISS uses the active chart timeframe and draws its 0–5 wave structure.

## Checks

Run `npm test`, `npm run lint`, and `npm run build` after changing the structure engine.

TradingView can change or restrict this undocumented protocol without notice.
