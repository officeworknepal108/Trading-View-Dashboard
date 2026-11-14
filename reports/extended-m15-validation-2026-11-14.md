# Extended OANDA M15 validation: partial five-month request

**The previous 64% and 70% results did not persist across the longer available history.**

The request was for approximately 14 June?14 November 2026. The same OANDA feed only supplied history from 2 August. The study uses entries from 3 August and ends 13 November at 21:45 UTC (14 November, 03:30 Nepal). This is approximately 3.5 months, not a completed five-month test.

## Method

- Same dashboard functions for engulfing detection, volume eligibility, entry/SL/TP, and outcome evaluation.
- XAUUSD M15, no bias, T1/T2/T3 only, 10-pip study SL buffer, existing risk cap, fixed 1:1 TP.
- All 170 trades from the supplied no-bias CSV reproduced with matching entry, SL, TP and outcome.
- Frozen filters from the original analysis; no tuning on the added history.
- First 10 available candles used only as context.

## All available history

| Selection | Entries | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|
| Unfiltered T1/T2/T3 | 598 | 290 | 295 | 13 | 49.57% | -5 |
| T1 time window; T2/T3 unchanged | 370 | 180 | 179 | 11 | 50.14% | 1 |
| Original 64% candidate: T1 time window; T2 SELL only; all T3 | 273 | 144 | 125 | 4 | 53.53% | 19 |
| Original 70% candidate: skip T1; T2 SELL only; all T3 | 178 | 94 | 82 | 2 | 53.41% | 12 |
| T3 only | 94 | 47 | 46 | 1 | 50.54% | 1 |

The T1 time window is confirmation from 00:00 inclusive to before 06:00 UTC, or 05:45 to before 11:45 Nepal.

## Previously unseen earlier period

3 August?14 October UTC. These trades were not in the CSV used to find the filters. No included trade resolves across this boundary.

| Selection | Original CSV win rate | Earlier TP | Earlier SL | Earlier win rate | Earlier closed net R |
|---|---:|---:|---:|---:|---:|
| Unfiltered T1/T2/T3 | 50.0% | 207 | 212 | 49.4% | -5 |
| T1 time window; T2/T3 unchanged | 54.9% | 123 | 132 | 48.24% | -9 |
| Original 64% candidate: T1 time window; T2 SELL only; all T3 | 64.38% | 96 | 99 | 49.23% | -3 |
| Original 70% candidate: skip T1; T2 SELL only; all T3 | 70.45% | 62 | 69 | 47.33% | -7 |
| T3 only | 66.67% | 28 | 37 | 43.08% | -9 |

The original 70% candidate loses money before costs in the earlier unseen period. The original 64% candidate is also negative there. The original rates were period-specific and should not be treated as reliable expected win rates.

## Monthly results for the two original candidates

| Month UTC | 64% candidate TP/SL | Win rate | Net R | 70% candidate TP/SL | Win rate | Net R |
|---|---:|---:|---:|---:|---:|---:|
| 2026-08 | 33/43 | 43.42% | -10 | 23/33 | 41.07% | -10 |
| 2026-09 | 46/43 | 51.69% | 3 | 27/30 | 47.37% | -3 |
| 2026-10 | 47/32 | 59.49% | 15 | 33/14 | 70.21% | 19 |
| 2026-11 | 18/7 | 72.0% | 11 | 11/5 | 68.75% | 6 |

August starts on the 3rd and November ends on the 13th; these are partial months.

## Limits

- This covers about 3.5 months, not the requested five. June/July data were unavailable from the current feed.
- The earlier period was not used to choose the tested filters, but this is retrospective validation, not a forward live test.
- Gross fixed-1R results exclude costs, overlapping-position constraints and real execution differences.
- Same-bar SL/TP ambiguity, cancelled trades and active trades are excluded from win rate and net R.
- No new filters were optimized on the longer sample. No source code or live rules were changed.

To complete five months with comparable volume, older OANDA OHLCV candles are required. MT5 broker history would be a separate provider test and should be labelled separately.