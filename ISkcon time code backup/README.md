# TradingView OANDA Candle Dashboard

A clean React candlestick dashboard that requests `OANDA:XAUUSD` candles through
TradingView's unofficial WebSocket protocol. It contains no strategy, signal,
backtest, synthetic-candle, Binance, Kalbairab, or Bhariba logic.

## Setup

1. Run `npm install` and `npm run dev`.
2. Open `http://127.0.0.1:3000`.

No token is required. This is not the official OANDA API and TradingView may
change or restrict the protocol. The server returns an explicit error when the
feed is unavailable and never substitutes synthetic or Binance candles.
