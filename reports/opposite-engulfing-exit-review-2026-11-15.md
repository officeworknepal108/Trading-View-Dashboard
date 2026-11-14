# Opposite engulfing early-exit test

Test a new exit rule on the archived 252 XAUUSD M15 single-entry setups. Keep the approved 30-pip study buffer, original risk-capped entry, H4 bias, H4 EMA alignment, H1 continuation/Far selection, and original 1:1 target. Use $50 fixed risk per setup and $5,000 starting balance. No compounding or trading costs.

Rule: while filled and still open, detect an opposite T1/T2/T3 using the existing confirmation and volume rules. Exit at the following M15 candle open, after the opposite candle closes. Do not require higher-timeframe agreement for this exit signal. A second predetermined variant triggers only when the closed signal candle marks the open trade below its entry. Both variants are disclosed; no threshold was tuned.

| Method | Full TP | Full SL | Early exits | Other | Profit | Ending balance |
|---|---:|---:|---:|---:|---:|---:|
| Current single entry | 140 | 104 | 0 | 8 | +$1,800.00 | $6,800.00 |
| Exit on opposite volume engulfing | 112 | 68 | 64 | 8 | +$1,438.53 | $6,438.53 |
| Same exit, only while losing | 116 | 72 | 56 | 8 | +$1,311.16 | $6,311.16 |

Early exits include gains and losses at variable reward/risk. A lower full-SL count does not mean fewer losing trades or higher profit. Both ideas reduce dollar profit and full TP count; neither is applied.

| UTC exit month | Current | Opposite exit | Opposite exit only while losing |
|---|---:|---:|---:|
| August 2026 | -$550.00 | -$587.48 | -$587.48 |
| September | +$1,250.00 | +$1,114.35 | +$1,067.37 |
| October | +$1,100.00 | +$848.51 | +$768.13 |
| November, partial | $0.00 | +$63.14 | +$63.14 |

Both tests underperform in the earlier August–September signal cohort and later October–November cohort. These cohorts reuse already inspected history and are not independent validation. Monthly rounding may differ by a cent from the total, which uses unrounded trade PnL.

Validation: all 252 archived baseline records reproduce exactly with the existing outcome simulator, including outcome, fill and resolution times. Exits require a completed opposite candle and a later executable open. Stops/targets in the opposite candle take priority over the signal at its close. A gap already beyond a boundary retains the baseline boundary outcome. Incomplete candles and gaps in the next-candle timeline are not used for early exits. Pending or ambiguous records are not silently treated as successful early exits. No app, execution or lock-control files changed.

Limits: matched archived setup set; no spread, fees, slippage, financing, overlapping-position limit or aggregate portfolio risk cap. OHLC boundary and pending-entry ambiguity follows the existing study simulator. This test does not establish future returns.

Reproduce with `npx tsx reports/opposite-engulfing-exit-research.ts`; full evidence in `opposite-engulfing-exit-research-2026-11-15.json`.
