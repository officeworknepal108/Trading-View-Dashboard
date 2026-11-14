# T1 volume engulfing analysis

Source: Volume-Engulfing-Study-XAUUSD-M15.csv. Gold, M15 study, H4 bias, fixed 1:1. 91 exported rows; 53 T1 rows.

## Most promising exploratory comparison

Keep T1 confirmations from 00:00 inclusive to before 06:00 UTC (05:45 to before 11:45 Nepal). Keep T2/T3 unchanged.

| Selection | Entries | TP | SL | Other | Win rate | Gross net R |
|---|---:|---:|---:|---:|---:|---:|
| Original T1 | 53 | 27 | 26 | 0 | 50.94% | 1 |
| T1 with time filter | 18 | 12 | 6 | 0 | 66.67% | 6 |
| Original entire study | 91 | 49 | 40 | 2 | 55.06% | 9 |
| Entire study with only T1 time-filtered | 56 | 34 | 20 | 2 | 62.96% | 14 |

This removes 20 T1 losses and 15 T1 wins. It improves the recorded win rate and net R, but reduces the absolute number of winning trades.

## Chronological check

First 35 T1 trades: baseline 20 TP / 15 SL (+5R); time-filtered 7 TP / 4 SL (+3R).
Later 18 T1 trades, starting 2026-11-02 10:15 UTC: baseline 7 TP / 11 SL (-4R); time-filtered 5 TP / 2 SL (+3R).

The rule was explored using this export. This is a chronological consistency check, not confirmation on a fresh independent dataset.

## Other findings

BUY: 2 TP / 7 SL (22.22%, -5R). SELL: 25 TP / 19 SL (56.82%, +6R). All first 35 T1 trades were SELL, so direction is confounded with the market period. A permanent SELL-only rule is not established.

Volume thresholds tested were V2/V1 <= or >= 0.50, 0.65 and 0.80. Larger volume drops did not provide a consistent improvement with adequate counts. The <= 0.50 group contains only three trades.

| Volume filter | All TP/SL | All win rate | Early TP/SL | Later TP/SL |
|---|---:|---:|---:|---:|
| V2/V1 <= 0.5 | 2/1 | 66.67% | 1/1 | 1/0 |
| V2/V1 >= 0.5 | 25/25 | 50.0% | 19/14 | 6/11 |
| V2/V1 <= 0.65 | 4/5 | 44.44% | 2/3 | 2/2 |
| V2/V1 >= 0.65 | 23/21 | 52.27% | 18/12 | 5/9 |
| V2/V1 <= 0.8 | 13/11 | 54.17% | 9/7 | 4/4 |
| V2/V1 >= 0.8 | 14/15 | 48.28% | 11/8 | 3/7 |

## Limits

- Exploratory analysis of one exported snapshot; chronological checks are not a new independent sample.
- Only recorded outcomes were filtered. No changes to buffer, entry, SL, TP, H4 bias, or T2/T3.
- Confirmation is signal UTC plus 15 minutes, available before entry; no outcome is used to select trades.
- The CSV does not identify buffer version or include candle prices; this analysis cannot verify the buffer or resimulate outcomes.
- Gross R ignores spread, commission, slippage and execution constraints. Trades may overlap.
- SELL-only observations are confounded with time: all 35 early T1 trades were SELL.
- The retained later sample has only 7 trades; verify on another date range before treating this as an improvement.

No code or live trading rules were changed. The retained and excluded CSV files show every T1 trade in this comparison.