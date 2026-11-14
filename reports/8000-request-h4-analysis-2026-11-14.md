# Expanded H4-bias volume engulfing study

Input: Volume-Engulfing-Study-XAUUSD-M15 (4).csv. XAUUSD M15, H4 bias, original study buffers (20 pips for M15), fixed 1:1. Signals: 3 August?13 November 2026 UTC.

## Original result, without additional filters

| Type | Entries | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|
| T1 | 166 | 89 | 76 | 1 | 53.94% | 13 |
| T2 | 99 | 46 | 45 | 8 | 50.55% | 1 |
| T3 | 47 | 26 | 21 | 0 | 55.32% | 5 |
| All | 312 | 161 | 142 | 9 | 53.14% | 19 |

## Why the earlier 58.5% changed

All 227 shared setups match the previous 20-pip simulation exactly in entry, SL, TP and outcome: 131 TP / 93 SL, 58.48%, +38R, three other outcomes.

The 85 additional earlier setups contribute 30 TP / 49 SL, 37.97%, -19R, six other outcomes. Combined: 161 TP / 142 SL, 53.14%, +19R. The deterioration comes from added older history, not a failure to reproduce the previous buffer test.

## Monthly original results

| Month UTC | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|
| 2026-08 | 30 | 51 | 6 | 37.04% | -21 |
| 2026-09 | 59 | 36 | 1 | 62.11% | 23 |
| 2026-10 | 58 | 34 | 0 | 63.04% | 24 |
| 2026-11 | 14 | 21 | 2 | 40.0% | -7 |

August begins on the 3rd and November is partial. Strong September/October results do not carry over to August/November.

## Previously discussed filters, unchanged

| Selection | Entries | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|
| Original, no extra filters | 312 | 161 | 142 | 9 | 53.14% | 19 |
| T1 time window; all T2/T3 | 191 | 100 | 83 | 8 | 54.64% | 17 |
| T1 time window; T2 SELL; all T3 | 159 | 89 | 67 | 3 | 57.05% | 22 |
| Skip T1; T2 SELL; all T3 | 114 | 61 | 50 | 3 | 54.95% | 11 |
| T1 only, time window | 45 | 28 | 17 | 0 | 62.22% | 11 |

The fixed T1 time window is confirmation at 00:00 inclusive to before 06:00 UTC, or 05:45 to before 11:45 Nepal. T1-only time-window performance in added August history is 1 TP / 6 SL; the apparent earlier consistency does not extend to that month. The combined T1-time/T2-SELL/all-T3 filter loses 17R in August. None of these should be presented as a stable 60?70% solution.

## Conclusions

- The unfiltered larger study is 53.14% before costs.
- T1 contributes +13R, T2 only +1R, T3 +5R. T2 is close to breakeven even before execution costs.
- All three types are weaker on the newly added earlier trades.
- H4 bias and the restored buffer do not by themselves resolve the month-to-month variation.
- Further changes need separate market-period validation; adding restrictions to fit a favourable month is not evidence of a durable improvement.

## Limits

- The requested window is 8,000 candles, but the trade-only CSV does not record how many candles the provider actually returned. Its trade range starts 3 August, consistent with the previously observed feed history limit.
- Original shorter 10-pip CSV (3) and this export have different buffers. Comparisons use the previously simulated 20-pip results on the 227 shared setups to separate the buffer effect from the effect of older history.
- Closed-trade win rate and net R exclude seven cancelled, one ambiguous and one active trade, as well as trading costs.
- Historical patterns can overlap; net R is not an account return or drawdown calculation.
- Time and direction filters are retrospective comparisons; no code or dashboard setting was changed during this analysis.