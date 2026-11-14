# Expanded M15 volume engulfing reports: H4 bias versus no bias

Inputs: Volume-Engulfing-Study-XAUUSD-M15 (4).csv (H4) and (5).csv (no bias). Restored 20-pip M15 buffer, fixed 1:1 TP. Trade dates: early August?13 November 2026 UTC. Original results below have no additional time or direction filters.

## Overall

| Study | Entries | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|
| No bias | 599 | 299 | 283 | 17 | 51.37% | 16 |
| H4 bias | 312 | 161 | 142 | 9 | 53.14% | 19 |

All 312 H4 setups are an exact subset of the no-bias report, with identical entry, SL, TP and outcome. H4 excludes 287 trades: 138 TP, 141 SL, six cancelled, one ambiguous and one active. The closed net improvement is only +3R, despite the higher win rate.

## By type

| Type | No-bias TP/SL | No-bias win rate | No-bias net R | H4 TP/SL | H4 win rate | H4 net R |
|---|---:|---:|---:|---:|---:|---:|
| T1 | 161/156 | 50.79% | 5 | 89/76 | 53.94% | 13 |
| T2 | 88/84 | 51.16% | 4 | 46/45 | 50.55% | 1 |
| T3 | 50/43 | 53.76% | 7 | 26/21 | 55.32% | 5 |

H4 improves T1 net R by 8R, but reduces T2 by 3R and T3 by 2R. Its aggregate benefit is concentrated in T1; a higher win rate for a smaller set does not automatically mean more total profit.

## Monthly consistency

| Month UTC | No-bias TP/SL | Win rate | Net R | H4 TP/SL | Win rate | Net R |
|---|---:|---:|---:|---:|---:|---:|
| 2026-08 | 80/87 | 47.9% | -7 | 30/51 | 37.04% | -21 |
| 2026-09 | 93/75 | 55.36% | 18 | 59/36 | 62.11% | 23 |
| 2026-10 | 99/91 | 52.11% | 8 | 58/34 | 63.04% | 24 |
| 2026-11 | 27/30 | 47.37% | -3 | 14/21 | 40.0% | -7 |

H4 benefits September and October but is worse than no bias in August and November. August and November are partial months.

## Previously discussed filter comparisons

| Filter | No-bias TP/SL | Win rate | Net R | H4 TP/SL | Win rate | Net R |
|---|---:|---:|---:|---:|---:|---:|
| Original without extra filters | 299/283 | 51.37% | 16 | 161/142 | 53.14% | 19 |
| T1 time window; all T2/T3 | 186/170 | 52.25% | 16 | 100/83 | 54.64% | 17 |
| T1 time window; T2 SELL only; all T3 | 146/120 | 54.89% | 26 | 89/67 | 57.05% | 22 |
| Skip T1; T2 SELL only; all T3 | 98/77 | 56.0% | 21 | 61/50 | 54.95% | 11 |

T1 time window means confirmation at 00:00 inclusive to before 06:00 UTC (05:45 to before 11:45 Nepal). These comparisons do not establish a stable 60?70% result.

## Volume condition observations

- No-bias T2: V3 below V2 only is 51.67%; V3 below both is 50.89%.
- No-bias T3: V3 below V2 only is 53.85%; V3 below both is 53.75%.
- H4 T2: both groups are approximately 50%.
- H4 T3 below V2 only is 60%, but has only five trades; below both is 54.76%.
- The stronger V3-below-both label does not establish better historical performance in these expanded exports.

## Interpretation

The expanded sample weakens the earlier short-period findings. Neither simple volume confirmation nor H4 bias has established the previously observed high win rates across the whole period. The next useful study should investigate why August and November differ from September/October, with any new pre-entry feature fixed before separate validation. Avoid turning a period-specific SELL advantage or a hindsight time window into a permanent rule on these results alone.

## Limits

- Both are 8,000-candle requests; CSVs contain trades, not the actual candle count returned. Their range remains early August through 13 November, consistent with the feed limit previously observed.
- Both studies now use the restored 20-pip M15 buffer and fixed 1:1 TP. Earlier 5,000-candle CSVs used a smaller buffer, so they cannot be compared without accounting for that change.
- Win rate and net R exclude cancelled, ambiguous and active outcomes and do not include trading costs.
- Net R is a sum of closed independent study trades; overlapping trades, sizing and account drawdown are not modelled.
- Reapplied time/direction rules were selected retrospectively earlier; these overlapping histories are not fresh independent validation.
- No code, dashboard settings or live rules were changed.