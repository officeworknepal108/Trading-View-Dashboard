# Symmetric adaptive H4 trend filter for the original M15 study

## Rule

Keep the original H4 market-structure bias, M15 T1/T2/T3 engulfing/volume confirmations, original entry policy, 20-pip SL buffer and 1:1 TP. Add one condition based on the latest closed H4 bar:

- BUY only when H4 EMA20 > H4 EMA50.
- SELL only when H4 EMA20 < H4 EMA50.
- Equality allows neither direction.

The rule changes with market direction; it is not a permanent SELL-only gate. The condition is checked at the original historical engulfing confirmation, using only an H4 candle already closed by that time. EMA periods were fixed at 20 and 50 before checking outcomes.

## Comparison

| Study | Setups | TP | SL | Other | Closed win rate | Gross net R |
|---|---:|---:|---:|---:|---:|---:|
| Original H4 baseline | 312 | 161 | 142 | 9 | 53.14% | +19 |
| H4 baseline + EMA20/50 agreement | 264 | 143 | 115 | 6 | 55.43% | +28 |

This removes 18 winners and 27 losers, improving gross net R by 9R. It does not create more winning trades: TP count falls from 161 to 143. Its benefit is fewer losses relative to winners and higher closed net R.

## Earlier and later periods

| Period | Original TP/SL | Original net R | Filtered TP/SL | Filtered net R |
|---|---:|---:|---:|---:|
| August-September | 89/87 | +2 | 75/66 | +9 |
| October-November | 72/55 | +17 | 68/49 | +19 |

The EMA20/50 condition was selected from four predetermined regime checks on August-September closed outcomes before examining that condition on the later period. Selection used a minimum 30 closed observations and the highest training Wilson lower bound. The alternatives were close/EMA50 alignment, DMI direction plus ADX>=20, and EMA alignment plus ADX>=20. No period or ADX threshold was subsequently tuned.

These are retrospective chronological checks on months already studied repeatedly; they are not fresh independent forward validation.

## Monthly consistency

| Month UTC | Original TP/SL | Original net R | Filtered TP/SL | Filtered net R |
|---|---:|---:|---:|---:|
| 2026-08 | 30/51 | -21 | 16/30 | -14 |
| 2026-09 | 59/36 | +23 | 59/36 | +23 |
| 2026-10 | 58/34 | +24 | 56/34 | +22 |
| 2026-11 | 14/21 | -7 | 12/15 | -3 |

August and November are partial months. Both remain negative after the filter; October loses 2R relative to baseline. The condition does not fix every regime or demonstrate a 70% win rate.

## Direction breakdown

| Direction | Original TP/SL | Original win rate | Filtered TP/SL | Filtered win rate |
|---|---:|---:|---:|---:|
| bullish | 23/39 | 37.10% | 21/33 | 38.89% |
| bearish | 138/103 | 57.26% | 122/82 | 59.80% |

Both directions are permitted, but BUY performance is still negative in this period. A symmetric rule is not evidence of profitability in all market directions.

## Other test in this turn

Waiting for a later M15 close beyond the engulfing confirmation extreme did not improve total R. A one-bar window yielded 65 TP / 48 SL (+17R), and a three-bar window 95 TP / 78 SL (+17R), compared with baseline +19R. These variants were not adopted.

## Data, verification and limits

- Same recorded 312 H4-qualified XAUUSD M15 setups, early August?13 November 2026. All selected prices and outcomes are retained from the supplied H4 CSV.
- H4 history has 5,000 OANDA bars beginning August 2023. EMA20/EMA50 are computed chronologically with SMA initialization; later bars cannot affect earlier EMA values.
- All 264 selected setups were checked for a closed H4 bar available before confirmation and the correct BUY/SELL EMA relation.
- The 264-row candidate journal preserves the original H4 bias labels, entries, SL, TP and outcomes.
- Gross net R excludes costs, overlapping-position constraints and position sizing. Cancelled, active and ambiguous observations do not count as wins or losses.
- Repeated testing of the same history introduces selection bias even with earlier-only ranking for this new condition.
- This is a study candidate for validation on new history, not a proven live improvement.
- No source code, dashboard filter or live trading setting was changed.