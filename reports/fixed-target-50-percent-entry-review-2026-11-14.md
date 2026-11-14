# Corrected 50% pullback study: original SL and TP stay fixed

This implements the clarified example: original entry 100, SL 90, TP 110; new entry 95, SL 90, TP 110. It does NOT reset TP to 1R from 95. The intended new risk-to-reward is 1:3.

## Rules

- Same 312 original M15 T1/T2/T3 setups with valid volume and H4 bias at confirmation.
- Original M15 SL buffer is 20 pips. All original SL and TP prices are preserved exactly from the current H4 CSV.
- Entry = (original planned entry + original SL) / 2. This is halfway from the original entry to the buffered SL, not the candle-body or wick-range midpoint.
- Order is eligible only after the engulfing confirmation. The original entry reference is available at the next execution open, as in the dashboard calculation.
- No 15-minute, one-hour or two-hour expiry. Orders remain eligible until filled or the available study history ends. H4 bias membership is the signal-time snapshot; it is not rechecked at a much later fill.
- The main test also keeps the pending order if the original target was crossed before entry. This is an explicit no-invalidation assumption and materially affects stale entries.
- Fill is recorded at the requested midpoint. Marketable gaps are conservatively charged at that midpoint; a gap through the stop before entry is marked uncertain rather than assigned a fabricated fill or profit.
- OHLC bars touching both exits are ambiguous. On a newly touched limit, a target crossing is counted only when the close proves it followed the entry and no SL was touched; otherwise the order is uncertain.

## Overall results

| Method | Setups | Risk:reward | TP | SL | Other | Closed win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|---:|
| Original | 312 | 1:1 | 161 | 142 | 9 | 53.14% | 19 |
| 50% entry; unchanged exits | 312 | 1:3 | 73 | 210 | 29 | 25.80% | 9 |

The pullback other outcomes are 13 unfilled orders, one active trade, 14 ambiguous intrabar outcomes and one uncertain gap. None are counted as TP or SL.

Net R uses each method own entry-to-SL risk as one unit. The original earns +19 original-risk units; the pullback earns +9 new-risk units. Since new risk distance is half the original, keeping the original position quantity makes the latter equivalent to +4.5 original-risk units. Maintaining the same monetary risk per trade would instead require different position sizing. These are normalized gross study sums, not an account return.

## By engulfing type

| Type | Original TP/SL | Original win rate | Original net R | Pullback TP/SL | Pullback win rate | Pullback net R |
|---|---:|---:|---:|---:|---:|---:|
| T1 | 89/76 | 53.94% | 13 | 43/107 | 28.67% | 22 |
| T2 | 46/45 | 50.55% | 1 | 20/72 | 21.74% | -12 |
| T3 | 26/21 | 55.32% | 5 | 10/31 | 24.39% | -1 |

## Why the result worsened

- All 142 original SL trades still hit the unchanged SL after crossing the new midpoint entry. Better entry reduces the risk distance; it does not make those paths reach the original TP first.
- Of the original 161 winners, 70 remain confirmed TP, 64 become SL, 13 are ambiguous, 13 never fill and one has uncertain gap execution.
- Three originally cancelled setups become TP and four become SL.
- 94 original winning setups fill only after the original trade had already reached TP. This is allowed by keeping orders indefinitely. If such setups should be cancelled when the original target is reached, that is a different order-invalidation rule and needs a separate comparison.
- 25 filled orders wait more than 96 M15 bars; three wait more than 480 bars. Maximum wait is 888 bars. These are trading-bar counts, not continuous calendar-day measurements.

## Monthly closed results

| Signal month UTC | Original TP/SL | Original net R | Pullback TP/SL | Pullback net R |
|---|---:|---:|---:|---:|
| 2026-08 | 30/51 | -21 | 19/65 | -8 |
| 2026-09 | 59/36 | 23 | 24/57 | 15 |
| 2026-10 | 58/34 | 24 | 25/60 | 15 |
| 2026-11 | 14/21 | -7 | 5/28 | -13 |

## Verification and limits

- All 312 original entries, SL, TP and outcomes reproduce the CSV baseline with the existing production functions.
- Every new entry is verified at the original-entry/SL midpoint and every nominal reward-risk ratio is exactly three within numerical tolerance.
- Only recorded qualifying setups are tested, not a rescan for additional setups.
- History covers early August to 13 November 2026; no outcomes beyond the available final bar are assumed.
- Study totals exclude execution costs, position-sizing limits and overlapping-position constraints.
- Same historical data have been examined repeatedly; this is not independent forward validation.
- No dashboard filter, entry, stop or target was changed.