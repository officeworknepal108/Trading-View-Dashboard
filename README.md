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

## Optional chart knowledge agent

The chart includes a conversational, read-only agent that can search the
project's services, tests and documentation while inspecting the current chart,
zones, MTF rows and replay state. It uses the free local Ollama backend by
default (`AI_PROVIDER=ollama`, `OLLAMA_MODEL=qwen3:1.7b`), so no paid API key is
required. Ollama must be installed and the configured model downloaded.

OpenAI remains optional: set `AI_PROVIDER=openai` and add `OPENAI_API_KEY` to
`.env`. The key stays on the Express server and is never sent to browser code.

The agent can propose a correction, lesson or completed trade result. Nothing
is learned until the user selects **Approve & Learn**. Approved memory is stored
locally in `data/ai-agent-memory.json`, is included in future answers, and never
changes trading logic or places trades automatically. Trade-result learning
records profit, loss and breakeven outcomes to reduce winner-only outcome bias.

## Engulfing trade levels

Tradeable 1m, 5m, and 15m zones use the chart timeframe engulfing first and
then one mapped fallback: 1m→5m, 5m→15m, and 15m→30m. The finalized trade
matrix is 1m/1m at 1:3, 1m/5m at 1:2, 5m/5m at 1:2, 5m/15m at 1:1,
15m/15m at 1:2, and 15m/30m at 1:1. The corresponding maximum Entry-to-SL
distances are 50, 100, 100, 200, 200, and 300 pips. Buffers are applied
internally (10 pips for 1m/5m engulfings and 20 pips for 15m/30m engulfings).
When the actual entry originates from the 0.71–0.79 or extended Deep Discount
FIB band, SL is placed at the engulfing liquidity with no added buffer.

An Entry is calculated on the first chart candle after the engulfing closes.
The normal zone and MTF tables remain unchanged until that Entry exists; then
they add a detail row with Entry, SL, TP, R:R, actual SL pips, and the Pending,
Active, Risk Free, TP Hit, or SL Hit state. Internal buffers and maximum-risk
caps are deliberately not displayed.

The optional Engulfing Accuracy table is OFF by default. When enabled it counts
only resolved trades as SL, protected RF exits, or TP, and calculates accuracy
as TP divided by all resolved outcomes.

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
