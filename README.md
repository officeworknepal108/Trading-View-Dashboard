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
