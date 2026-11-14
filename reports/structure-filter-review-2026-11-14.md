# Additional structure filters for the original M15 + H4 study

**The tested structure filters do not justify replacing the original study rules.**

## Baseline and data

312 XAUUSD M15 setups from early August to 13 November 2026, H4 bias, original 20-pip M15 SL buffer and fixed 1:1 TP. Baseline: 161 TP / 142 SL, nine other outcomes, 53.14%, +19R before costs. No time or SELL-only condition is used in this review.

## Additional pre-entry conditions tested

- H1 and H4 trends agree with the engulfing direction.
- M15 and H4 trends agree with the engulfing direction.
- H1, M15 and H4 trends all agree.
- Latest M15 BOS/CHoCH is in the entry direction and occurred within 20 completed bars.
- No opposite M15 CHoCH in the previous eight completed bars.
- H1/H4 agreement plus confirmation body occupying at least 60% of its full range.

H1 and M15 structure is recomputed using the existing dashboard analyzer on candle prefixes closed by the historical engulfing confirmation. The H4 membership comes from the supplied CSV. The H1 source has 5,000 OANDA bars from January through November, covering the whole study period. Forming/future bars are excluded. No source code or entry/SL/TP calculation was changed.

## Earlier-period selection

Rules were compared on August?September outcomes closed before October 1. Minimum 30 closed observations. The top two extra filters were frozen before evaluating later-period outcomes. Neither selected rule had a better training Wilson lower confidence bound than the baseline.

| Condition | Earlier TP | Earlier SL | Earlier win rate | Earlier net R |
|---|---:|---:|---:|---:|
| H4 baseline | 89 | 87 | 50.57% | 2 |
| H1 and H4 trends agree | 52 | 50 | 50.98% | 2 |
| M15 and H4 trends agree | 45 | 41 | 52.33% | 4 |
| H1 + M15 + H4 trends agree | 35 | 32 | 52.24% | 3 |
| Latest M15 BOS/CHoCH aligned within 20 bars | 10 | 10 | 50.0% | 0 |
| No opposite M15 CHoCH within 8 bars | 86 | 85 | 50.29% | 1 |
| H1/H4 agreement + body >=60% | 33 | 36 | 47.83% | -3 |

The aligned recent-BOS/CHoCH rule had only 20 closed earlier-period observations and did not meet the minimum.

## Full and later-period results for the frozen candidates

| Condition | All TP/SL | All win rate | All net R | Later TP/SL | Later win rate | Later net R |
|---|---:|---:|---:|---:|---:|---:|
| Original H4 baseline | 161/142 | 53.14% | 19 | 72/55 | 56.69% | 17 |
| No opposite M15 CHoCH within 8 bars | 155/140 | 52.54% | 15 | 69/55 | 55.65% | 14 |
| M15 and H4 trends agree | 84/73 | 53.5% | 11 | 39/32 | 54.93% | 7 |

M15/H4 agreement removes 77 original TP and 69 original SL, reducing total closed net R by 8R. Avoiding a recent opposite CHoCH removes six TP and only two SL, reducing net R by 4R. Neither solves the weak November period.

## Interpretation

A recognizable market-structure condition is not automatically a useful predictive filter. In these data the additional agreement/recent-break checks do not reliably remove more losses than wins. There is no evidence here for a dependable 70% result while preserving the original entry rules and 1:1 TP.

A filter only selects among existing setups; it cannot create additional winning trades from the same journal. Improving absolute winning-trade count requires studying a different entry/exit or setup definition, which was not changed here. A credible next experiment should be specified before obtaining a fresh date range and should include execution costs.

## Limits

- Same retrospective market period and overlapping trade histories already analysed previously; this is not independent forward validation.
- Repeated experimentation introduces selection bias. Training-only ranking and later-period checking reduce direct fitting of these new conditions to later outcomes but do not remove the broader selection problem.
- Market-structure state depends on the available historical context; all tests use the same stored candle prefixes and analyzer settings.
- Gross net R excludes spread, commission, slippage, position sizing and overlapping-position constraints.
- Cancelled, ambiguous and active outcomes are excluded from win rates.
- No new filter was added to the dashboard or live trading rules.