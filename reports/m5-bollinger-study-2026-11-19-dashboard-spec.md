# Proposed M5 Bollinger dashboard study

Status: original study-only proposal, superseded by the implemented strategy and Study described in `m5-bollinger-implementation-2026-11-19.md`. The final implementation includes independent per-account execution controls, default OFF, as requested for the new strategy. The remainder of this file records the earlier proposal.

## UI and scope

Add a BOLLINGER M5 STUDY toggle beside the existing chart studies. Use a worker for long history scans. The panel includes the study rules, date range/history coverage, progress, TP/SL/open/uncertain/skipped counts, monthly cash/R summaries, drawdown, buy/sell breakdown, CSV download and clickable historical records. Clicked records display the study entry/SL/TP on the chart. Clearly mark simulated records CHART STUDY; do not merge them into broker executions or send MT5 orders. Do not add an automation enable switch.

The panel uses XAUUSD M5 and completed M5/H4 candles. Loading study-only history must not replace live trading inputs. Preserve chart layout, existing Scalp 1:1 controls, journal identities, account bindings and strategy settings. Existing charts/strategies continue to work independently.

## Two evidence types must stay distinct

1. Imported reference summary and its 34-trade ledger: static source-dashboard evidence, shown in its own tab and clock labels. Do not plot imported reference prices as if they were native broker fills.
2. Native independent replay: calculate new local signals using explicit rules and publish its own counts and performance. Never seed its results with 67.6% or claim it reproduces the original source helpers.

## Proposed explicit native defaults

- Bollinger Bands: 20 closing prices, population standard deviation, multiplier 2.
- Buy pattern: previous complete M5 close below its lower band; current complete M5 close back inside its band and current candle bullish. Mirror for sells.
- EMA gate: close above EMA200 for buys, below for sells. This is an explicit native definition; the source EMA filter is not verified. Source-related defaults 9/21/200 are retained in the reference snapshot but are not silently combined into extra native filters.
- SuperTrend: Wilder ATR10, multiplier3, direction agrees at the completed confirmation candle.
- ADX: Wilder14, at least15.
- H4 bias: use confirmed local structure only, admitting only H4 candles closed by the M5 confirmation. Swing candidates require their right-side confirmation bars before they become usable. Log the local structure definition and neutral/unknown cases; never use the final chart?s later swings for historical decisions. The source H4 helper is not assumed identical.
- One entry at the next M5 open with explicit bid/ask and costs; no engulfing/volume filter added.
- Stop: two-pattern-candle extreme plus 0.2 ATR14, minimum one ATR initial risk. This is a native rule to be tested, not a verified transcription of the source helper.
- Target: entry plus/minus 1.5 times initial risk. Keep stop and target fixed. No layering, partial close, averaging, breakeven or timed exit.
- One position at a time. Open positions at the study end remain OPEN; ambiguous stop/target ordering stays uncertain or uses a clearly labelled conservative sensitivity. Missing candles/H4 context remain UNKNOWN, not a fabricated result.
- Price/volume sizing uses selected broker rules when known; round lots down and skip undersized orders. Fixed $50 risk is an illustrative default allowance, not a live risk-setting change.

## Files expected for chart integration

- Existing protected integration point: src/components/OandaProChart.tsx ? owners gold, forex, shared.
- Proposed isolated files: src/components/BollingerStudy.tsx, src/services/bollingerStudy.ts, src/services/bollingerStudy.worker.ts and relevant tests. Check the current manifest again before editing any source/test file.
- Reuse existing history/structure/indicator helpers read-only where appropriate. Any required edit to an existing helper must follow its listed owners.

All three owning sections of OandaProChart.tsx must be UNLOCKED before integration. Enter passwords only in the private masked local prompts. No lock manifests, hooks or authorization controls are to be changed.

## Acceptance checks

- Stable Bollinger/EMA/ATR/ADX/SuperTrend calculations with sufficient warmup and both trade directions.
- Historical H4 decisions depend only on closed/confirmed data available at each M5 signal.
- Next-open fills, spread, gaps, prices and rounded-volume sizing are explicit; no same-signal-candle fills.
- Single-entry identity and risk accounting; no influence on Scalp 1:1 or MT5 dispatch.
- Month/side/TP/SL/open/unknown totals reconcile with the exported ledger.
- Date coverage, progress/cancellation, timezone handling and click-to-chart behaviour work without freezing the live chart.
- Native replay is compared with a reference snapshot for known indicator/geometry cases; performance differences are reported, not forced to the old percentage.
- Run relevant tests, type/build checks and lock:check after authorized source work; commit normally or relock all sections when finished.
