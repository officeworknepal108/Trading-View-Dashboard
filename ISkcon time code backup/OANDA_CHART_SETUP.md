# TradingView OANDA Chart Setup

The chart requests `OANDA:XAUUSD` through TradingView's unofficial WebSocket
protocol. It does not use the authenticated OANDA v20 API and requires no API
token.

## Run

1. Run `npm install`.
2. Start the dashboard with `npm run dev`.
3. Open `http://127.0.0.1:3000`.

## Data contract

- Provider: unofficial TradingView WebSocket protocol
- TradingView symbol: `OANDA:XAUUSD`
- Supported intervals: M1, M5, M15, M30, H1, H4, and D
- Maximum request size: 5,000 candles; the chart requests 1,500
- Refresh interval: 15 seconds
- The latest candle is labelled as forming
- Failure behavior: explicit disconnected/error state; no fallback data

TradingView can change or restrict this undocumented protocol without notice.
