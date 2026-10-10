# TradingView OANDA Market-Structure Dashboard

A React candlestick dashboard that requests `OANDA:XAUUSD` candles through
TradingView's unofficial WebSocket protocol. It overlays MG market structure,
TJL/QML zones, higher-timeframe TJL1 confirmation, supply/demand, ISS five-wave
structure, bar replay, and an optional local MetaTrader 5 execution bridge. MT5
automation is disabled and in Dry Run mode by default.

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

Native 1m/1m entries require the agreed engulfing-volume test: T1 requires
V2 < V1, while T2/T3 require V3 < V2 (and are marked best quality when V3 is
also below V1). M5/M15 trend disagreement does not veto a volume-confirmed
native M1 entry. The existing 1m-structure/5m-engulfing route remains unchanged.
An M1 QML originating at its broker daily-session high or low is displayed and
sent to MT5 as **1MG QML**.

An Entry is calculated on the first chart candle after the engulfing closes.
The normal zone and MTF tables remain unchanged until that Entry exists; then
they add a detail row with Entry, SL, TP, R:R, actual SL pips, and the Pending,
Active, Risk Free, TP Hit, or SL Hit state. Internal buffers and maximum-risk
caps are deliberately not displayed.

## Scalping Logic

M1 and M5 scalping use the completed M15 structure trend as directional bias
and M5 structure as continuation or pullback context. Native M1 engulfings, M1
zones using an M5 fallback, and native M5-zone/M5-engulfing entries are allowed
only when the completed engulfing direction matches M15. An opposite M5 trend
is treated as a pullback once the matching engulfing has closed; a neutral M15
bias or an engulfing against M15 waits and creates no trade. Native M1 still
requires its agreed volume test and uses 1:3 with a 50-pip cap. M5 confirmation
routes retain 1:2 with a 100-pip cap. Existing zone, FIB/Major Liquidity, stop,
pending-entry and 1R rules remain unchanged. Intraday routes are not part of
this filter.

Internal TJL1/TJL2 and converted Internal QML/SBR/RBS/DB/DT levels use the
same direct-entry qualification, directional bias, risk, history and MT5
execution pipeline as external structure. Internal CHoCH setups are also
eligible for mapped MTF entries when their Internal QML and matching Internal
RBS/SBR share the same pair identity. Internal and external CHoCH families are
never combined to manufacture a setup.

## Intraday Logic

Intraday entries use completed H4 structure as the main bias, H1 structure as
continuation or pullback context, and completed M15 structure as setup
confirmation. Both M5 and M15 engulfing entries are supported. H4 and M15 must
match the entry direction; neutral H4, H1, or M15 conditions wait. An opposite
H1 trend is accepted as a pullback only after M15 has realigned with H4.

Mapped M15-to-M5 and H1-to-M5 setups use the existing M5 1:2 rule, 10-pip
buffer and 100-pip maximum risk. Native M15, H1-to-M15, and H4-to-M15 routes
use the existing M15 1:2 rule, 20-pip buffer and 200-pip maximum risk. The
engulfing must close before entry; existing A+ FIB/Major Liquidity, zone-touch,
pending-entry, deep-FIB stop, and 1R protection rules remain unchanged.

The optional Engulfing Accuracy table is OFF by default. When enabled it counts
only resolved trades as SL, protected RF exits, or TP, and calculates accuracy
as TP divided by all resolved outcomes. Its statistics use a rolling window of
the 50 most recently completed direct-engulfing and MTF trades, reconstructed
from the loaded candle history. Historical reconstruction runs only while the
table is enabled so the normal chart remains responsive.

## Optional MT5 automatic execution

The dashboard can queue fresh, confirmed XAUUSD trades for a local MT5 terminal.
It monitors the implemented direct rules for 1m, 5m, 15m and 1H zones (including
their mapped 5m, 15m and 30m confirmations) plus the existing MTF mappings.
Replay trades, completed trades and signals older
than the configured freshness limit are never queued. Signals with identical
direction, engulfing time and trade levels are deduplicated; overlapping zones
are retained as confluence instead of opening duplicate positions.
If a fresh signal is opposite to an open MT5 position for the configured broker
symbol, only the new signal is reduced to 1:1. The server recalculates this
target again when the bridge claims the signal, so the decision reflects the
positions that are actually open at execution time.
The server refreshes one timeframe at a time in the background, so monitoring
continues when the browser is closed without bursting requests at TradingView.

1. Use an Exness demo account first and enable AutoTrading in MT5.
2. Install the bridge packages: `py -m pip install MetaTrader5 requests python-dotenv`.
3. Copy `.env.mt5.example` to `.env.mt5` and configure the terminal path/account.
4. Set the same long random `MT5_BRIDGE_TOKEN` in `.env` and `.env.mt5`.
5. Start the dashboard. When the signal queue is enabled, the local server
   starts `mt5_bridge.py` invisibly and shows its status and recent logs in the
   **MT5** menu. The batch file remains available only as a manual fallback.
6. Open the **MT5** menu in the dashboard and enable the queue. Keep Dry Run ON
   until the full signal flow is verified.
7. For demo order placement, set `MT5_ALLOW_LIVE_EXECUTION=YES` in `.env.mt5`,
   restart the bridge, and turn Dry Run OFF in the dashboard.

The bridge calculates volume with MT5's broker-reported tick value, respects
the broker volume step, rejects excessive spread/daily loss/open exposure,
places LIMIT orders for pending entries, and moves SL to the actual fill price
when the configured risk-free level is reached. Runtime signals, settings,
credentials and bridge state remain local and are excluded from Git.
Use **START BRIDGE** and **STOP BRIDGE** in the dashboard to manage the hidden
local process; only one server-managed bridge is allowed at a time.

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
