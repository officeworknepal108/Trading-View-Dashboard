# Scalp 1:1 minimum volume gap study

- **strategy:** Archived Scalp 1:1: M15 T1/T2/T3, H4 structure + EMA20/50, H1 continuation/Far, 30-pip buffer, fixed 1:1 target.
- **source:** 252 previously qualified archived setups; entry, SL, TP, fill time and outcome replayed against current functions and cached OHLC.
- **volumeSource:** The volume values stored in the archived candle feed; raw units depend on that feed. Not MT5 trade lot size.
- **gap:** T1: V1 - V2. T2/T3: V2 - V3, matching the current basic volume requirement. Existing V3-versus-V1 best-quality classification unchanged.
- **percent:** 100 * (reference volume - confirming volume) / reference volume. Threshold is inclusive (>=); baseline retains the existing strict decrease.
- **endpoints:** Filtering removes setups only. Each retained setup keeps its original entry, SL and TP; no trade changes from SL to TP.
- **evaluation:** Independent setups; overlapping trades permitted as in the original study. No spread, commission, slippage, compounding, live session/news/position limits or operational fill restrictions.
- **other:** Pending, active, cancelled or intrabar-ambiguous outcomes excluded from win rate and net R.
- **split:** Earlier: signal before 2026-10-01 UTC; later: from that date. Chronological cross-check, not a previously untouched holdout.
- **selection:** Each threshold family selected on earlier-period net R; ties retain more completed trades. All-period best values are exploratory.
- **firstSignal:** 2026-08-03T10:30:00.000Z
- **lastSignal:** 2026-11-11T04:45:00.000Z
- **candlesThrough:** 2026-11-13T22:00:00.000Z
- **parityChecksPassed:** 252

## Minimum percentage decrease

| Minimum gap | Setups | TP | SL | Other | Win rate | Net R | Removed TP | Removed SL | Earlier R | Later R |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 252 | 140 | 104 | 8 | 57.38% | 36 | 0 | 0 | 14 | 22 |
| 1 | 244 | 137 | 99 | 8 | 58.05% | 38 | 3 | 5 | 14 | 24 |
| 2 | 242 | 136 | 98 | 8 | 58.12% | 38 | 4 | 6 | 15 | 23 |
| 5 | 224 | 127 | 89 | 8 | 58.80% | 38 | 13 | 15 | 15 | 23 |
| 10 | 193 | 109 | 76 | 8 | 58.92% | 33 | 31 | 28 | 13 | 20 |
| 15 | 155 | 89 | 58 | 8 | 60.54% | 31 | 51 | 46 | 18 | 13 |
| 20 | 117 | 63 | 46 | 8 | 57.80% | 17 | 77 | 58 | 10 | 7 |
| 25 | 82 | 44 | 32 | 6 | 57.89% | 12 | 96 | 72 | 6 | 6 |
| 30 | 56 | 31 | 21 | 4 | 59.62% | 10 | 109 | 83 | 1 | 9 |
| 40 | 25 | 16 | 9 | 0 | 64.00% | 7 | 124 | 95 | -1 | 8 |
| 50 | 9 | 6 | 3 | 0 | 66.67% | 3 | 134 | 101 | -2 | 5 |

## Minimum raw volume-unit decrease

| Minimum gap | Setups | TP | SL | Other | Win rate | Net R | Removed TP | Removed SL | Earlier R | Later R |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 252 | 140 | 104 | 8 | 57.38% | 36 | 0 | 0 | 14 | 22 |
| 10 | 248 | 137 | 103 | 8 | 57.08% | 34 | 3 | 1 | 12 | 22 |
| 25 | 246 | 137 | 101 | 8 | 57.56% | 36 | 3 | 3 | 13 | 23 |
| 50 | 245 | 137 | 100 | 8 | 57.81% | 37 | 3 | 4 | 13 | 24 |
| 100 | 244 | 137 | 99 | 8 | 58.05% | 38 | 3 | 5 | 14 | 24 |
| 250 | 227 | 131 | 88 | 8 | 59.82% | 43 | 9 | 16 | 16 | 27 |
| 500 | 199 | 111 | 80 | 8 | 58.12% | 31 | 29 | 24 | 13 | 18 |
| 1000 | 152 | 86 | 58 | 8 | 59.72% | 28 | 54 | 46 | 15 | 13 |

Earlier-period selection: 15%. Later result: 13R versus 22R baseline.

Earlier-period raw-unit selection: 250 units. Later result: 27R versus 22R baseline.

Observed: the 250-unit minimum removes 9 TP and 16 SL trades, increasing gross net R from +36R to +43R. It keeps 227 setups (219 completed), with 131 TP and 88 SL, or 59.82% win rate. Earlier +16R versus +14R baseline; later +27R versus +22R. Only 25 excluded trades account for the improvement; multiple thresholds were searched, so this is an exploratory candidate rather than evidence of a reliable optimum.

This is a historical filtering experiment. A higher win rate can come with fewer winning trades and lower total R. No dashboard settings or trading rules were changed.
