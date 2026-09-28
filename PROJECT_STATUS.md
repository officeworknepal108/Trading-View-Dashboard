# Project status

Last reviewed: 2026-09-28

## Current state

- The authoritative active project is
  `C:\Users\ABHI\Desktop\new algo file updated`, served at
  `http://127.0.0.1:3002`. Port 3002 is persisted in `.env`.
- The React/TypeScript dashboard loads up to 1,500 `OANDA:XAUUSD` candles from
  TradingView's unofficial WebSocket feed and refreshes every 15 seconds.
- Supported chart intervals: M1, M5, M15, M30, H1, H4, and D.
- Implemented overlays: MG market structure, TJL/QML/SBR/RBS/DT/DB zones,
  mapped higher-timeframe TJL1 confirmation, H1+ supply/demand, ISS 0–5 waves,
  invalid-zone visibility, a collapsible zone table, and bar replay.
- The project has no Git repository. The `backups/` and
  `ISkcon time code backup/` directories are historical snapshots, not active source.

## Latest continuation

- Audited the active source, tests, live API response, build configuration, and
  all current Markdown documentation.
- Corrected mapped higher-timeframe aggregation for OANDA session boundaries:
  H4, daily, and weekly confirmation bars now begin at 5 p.m. New York and
  follow the daylight-saving shift. Weekly bars start at the Sunday session.
- Added regression coverage for H4 session alignment, weekly alignment, and
  daylight-saving boundary changes. The suite now contains seven passing tests.
- Made port 3002 the saved project default and synchronized the setup documents.

### Previous checkpoint

- Completed the pending TJL1 confirmation/invalidation change.
- Added the missing M30→H1 confirmation mapping.
- Prevented a zone's origin candle and pre-activation candles from being counted
  as its first tap.
- Added focused regression tests for confirmation, invalidation, and tap timing.
- Updated user documentation to match the current 30-bar zone width.

## Verification

All of these pass as of the review date:

```text
npm test
npm run lint
npm run build
```

## Suggested next work

The market-structure rules are domain-specific and should be extended only from
explicit chart examples. The next useful step is to capture a small set of dated
XAUUSD examples for each expected MG/ISS pattern, encode them as candle fixtures,
and assert the exact labels, zone prices, confirmation time, and invalidation time.

Do not infer new MG/ISS rules from appearance alone. Record the timeframe, date,
expected swing labels, zone bounds, confirmation candle, and invalidation candle
for each example before changing the structure engine.
