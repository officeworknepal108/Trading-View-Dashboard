# M15 volume engulfing study without bias

170 XAUUSD M15 trades, fixed 1:1, no bias. Same market period as the prior H4-bias report. All 91 common trade outcomes match the prior export.

## Results

| Selection | Entries | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|
| Original without bias | 170 | 82 | 82 | 6 | 50.0% | 0 |
| T1 time-filtered; all T2/T3 | 107 | 56 | 46 | 5 | 54.9% | 10 |
| T1 time-filtered; T2 SELL only; all T3 | 77 | 47 | 26 | 4 | 64.38% | 21 |
| Skip T1; T2 SELL only; all T3 | 46 | 31 | 13 | 2 | 70.45% | 18 |
| T3 only | 28 | 18 | 9 | 1 | 66.67% | 9 |

The T1 time filter retains confirmations at 00:00 inclusive to before 06:00 UTC (05:45 to before 11:45 Nepal). It leaves T2/T3 unchanged unless the selection explicitly says otherwise.

## Findings

- Without bias, T1 has 42 TP / 49 SL (46.15%, -7R), T2 has 22 TP / 24 SL (47.83%, -2R), and T3 has 18 TP / 9 SL (66.67%, +9R).
- The previously proposed T1 time filter now yields 16 TP / 13 SL (55.17%, +3R), with two other outcomes. The prior 66.67% does not carry over when bias is removed.
- T2 SELL: 13 TP / 4 SL (76.47%, +9R), one other outcome. T2 BUY: 9 TP / 20 SL (31.03%, -11R), one other outcome.
- A simpler candidate for a higher hit rate and fewer SL is to skip T1, allow only SELL for T2, and allow both BUY and SELL for T3. It retains 31 wins and 13 losses; it removes 51 wins and 69 losses from baseline.
- If retaining T1 is important, restricting T1 to the time window and T2 to SELL while keeping all T3 yields 47 TP / 26 SL (+21R). This retains more trades and higher gross net R than skipping T1, at a lower hit rate.
- Requiring a larger volume drop does not give a consistent adequately populated improvement. The V2/V1 <= 0.50 T1 group is 3 TP / 1 SL, only four trades.

## Chronological consistency check

The split is the same signal timestamp used in the previous analysis: 2026-11-02 10:15 UTC.

| Selection | Earlier TP/SL | Earlier win rate | Earlier R | Later TP/SL | Later win rate | Later R |
|---|---:|---:|---:|---:|---:|---:|
| Original without bias | 56/52 | 51.85% | 4 | 26/30 | 46.43% | -4 |
| T1 time-filtered; all T2/T3 | 35/30 | 53.85% | 5 | 21/16 | 56.76% | 5 |
| T1 time-filtered; T2 SELL only; all T3 | 30/19 | 61.22% | 11 | 17/7 | 70.83% | 10 |
| Skip T1; T2 SELL only; all T3 | 20/8 | 71.43% | 12 | 11/5 | 68.75% | 6 |
| T3 only | 11/7 | 61.11% | 4 | 7/2 | 77.78% | 5 |

## Limits

- Same market period as the H4 report; this is not an independent date-range test.
- Rules and combinations were explored after examining this export. Earlier/later splits are consistency checks, not untouched validation.
- Small retained samples and market direction may explain results; do not interpret SELL-only performance as a permanent advantage.
- Only exported outcomes are filtered; candles were not available to resimulate entry, SL, TP or verify the buffer version.
- Win rate and net R exclude active/cancelled trades; gross results exclude costs and may include overlapping positions.
- No source code, study settings or live trading rules were changed.

A fresh date range is needed before adopting a filter as an established improvement. These are comparisons of recorded historical outcomes, not future performance estimates.