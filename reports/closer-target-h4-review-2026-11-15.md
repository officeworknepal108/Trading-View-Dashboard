# Original entry and SL with closer TP: H4-bias study

Same 312 XAUUSD M15 T1/T2/T3 setups with H4 bias, original entry policy and 20-pip M15 SL buffer. Only target distance changes: 1R, 0.75R or 0.5R. No time, direction, candle-shape or price-location filter. No 50% pullback entry is used.

## Overall result

| Target | Setups | TP | SL | Other | Win rate | Closed net R | Profit factor | Breakeven win rate before costs |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1R | 312 | 161 | 142 | 9 | 53.14% | +19.00 | 1.134 | 50.00% |
| 0.75R | 312 | 167 | 133 | 12 | 55.67% | -7.75 | 0.942 | 57.14% |
| 0.5R | 312 | 200 | 99 | 13 | 66.89% | +1.00 | 1.010 | 66.67% |

All original baseline levels and outcomes reproduced. Each trial preserves original entry and SL exactly. Every TP distance and per-win R return was independently checked against the requested target ratio.

The 0.5R target increases TP count by 39 and reduces SL count by 43 relative to baseline. It converts 41 original losing setups to confirmed TP, but two original winners become intrabar-ambiguous, and pending-order cancellations also change. The overall counts include all outcomes rather than assuming the same 303 completed trades.

A 0.5R winner earns half a risk unit; one full SL offsets two such winners. The resulting 200 wins earn 100R, while 99 losses cost 99R, leaving only +1R gross. Its 66.89% win rate is barely above the 66.67% no-cost breakeven level. Costs exceeding an average 0.00334R per closed trade would erase this gross gain.

The original 1R target earns 161R - 142R = +19R. The 0.75R target earns 125.25R - 133R = -7.75R. A higher winning percentage did not improve overall expectancy in these tests.

## Results by type

| Type | 1R TP/SL | Win rate | Net R | 0.75R TP/SL | Win rate | Net R | 0.5R TP/SL | Win rate | Net R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T1 | 89/76 | 53.94% | +13.00 | 96/69 | 58.18% | +3.00 | 113/52 | 68.48% | +4.50 |
| T2 | 46/45 | 50.55% | +1.00 | 45/43 | 51.14% | -9.25 | 59/29 | 67.05% | +0.50 |
| T3 | 26/21 | 55.32% | +5.00 | 26/21 | 55.32% | -1.50 | 28/18 | 60.87% | -4.00 |

## Monthly results

| Month UTC | 1R TP/SL | Net R | 0.75R TP/SL | Net R | 0.5R TP/SL | Win rate | Net R |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-08 | 30/51 | -21.00 | 33/46 | -21.25 | 45/33 | 57.69% | -10.50 |
| 2026-09 | 59/36 | +23.00 | 59/35 | +9.25 | 67/27 | 71.28% | +6.50 |
| 2026-10 | 58/34 | +24.00 | 61/31 | +14.75 | 70/22 | 76.09% | +13.00 |
| 2026-11 | 14/21 | -7.00 | 14/21 | -10.50 | 18/17 | 51.43% | -8.00 |

August and November are partial months. The 0.5R choice still loses gross R in both. Its better September/October win rates do not establish a stable 70% expected win rate.

## Pending and ambiguous orders

Original next-open/capped entries and their existing invalidation are retained. When an unfilled capped order sees its target reached first, it is cancelled. A closer target can therefore cancel a pending setup earlier even though its entry and SL prices are unchanged. A bar with unknowable entry/target or SL/target order remains ambiguous. Active, cancelled and ambiguous outcomes are excluded from win rate and closed net R.

Other outcomes:

- 1R: {"cancelled": 7, "ambiguous": 1, "active": 1}
- 0.75R: {"cancelled": 10, "ambiguous": 1, "active": 1}
- 0.5R: {"cancelled": 10, "ambiguous": 3}

## Conclusion and limits

The half-risk target meets the narrow count objective of more TP and fewer SL in this sample, but it substantially worsens gross profitability versus the original 1R target. Do not equate 66.89% with a stronger trading method.

- Same retrospective period, early August?13 November 2026, already analysed repeatedly; not independent forward validation.
- Recorded qualifying setups only, not a full rescan for newly eligible setups under different execution logic.
- Gross normalized R excludes costs, position sizing and overlapping-position constraints.
- No dashboard or live entry, stop or target setting changed.