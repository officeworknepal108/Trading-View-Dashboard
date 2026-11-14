# Review of the 70% win-rate target

**No consistently supported 70% rule was found in the supplied data.** The prior short-period 64?70% observations weakened when more history was included. This review tests additional pre-entry features rather than tuning a rule until a desired percentage appears.

## Data and method

- Base: 599 XAUUSD M15 no-bias setups, with H4 membership tagged from the matching 312-entry H4 export.
- Original volume eligibility, original 20-pip M15 buffer, existing maximum risk, and fixed 1:1 TP remain unchanged.
- Candle geometry and context are calculated from the matching OANDA history. Pattern-wick SL at the original 20-pip buffer was verified for every one of the 599 rows.
- Features: confirmation body fraction, close location within its range, relative volume, confirmation range relative to previous volatility, risk/volatility, wick sweeps, and position relative to the preceding 20-bar range.
- Volatility is a simple mean of true range for the previous 14 closed bars, excluding the confirmation candle; it is not Wilder smoothing.
- Tested 22 fixed rules or small combinations against four bases: no bias, H4 bias, no-bias SELL, H4-bias SELL. Total 88 candidates.
- Selection uses only August/September trades whose outcomes were closed before October 1. Minimum 40 closed trades. Candidates are ranked by their training Wilson 95% lower bound, then net R.
- The top three exact candidate memberships were saved before evaluating October/November features against outcomes. No later-period retuning was performed.
- These months and their aggregate outcomes have already been examined earlier in the conversation. Therefore this is retrospective chronological checking, not fresh independent or forward validation.

## Main finding

No eligible training candidate reached 70%; the highest training hit rate was 61.90%. The conservative ranking selected a volatility-size condition, a price-location condition, and SELL-only without extra candle conditions.

| Candidate | Training TP/SL | Training win rate | October TP/SL | October win rate | November TP/SL | November win rate | Overall TP/SL | Overall win rate | Overall closed R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| No bias SELL + Confirmation range 0.75-2 ATR | 72/47 | 60.5% | 44/26 | 62.86% | 5/8 | 38.46% | 121/81 | 59.9% | 40 |
| No bias SELL + Pattern near prior 20-bar extreme (25%) | 52/32 | 61.9% | 29/12 | 70.73% | 6/6 | 50.0% | 87/50 | 63.5% | 37 |
| No bias SELL + No extra candle rule | 103/78 | 56.91% | 58/34 | 63.04% | 12/12 | 50.0% | 173/124 | 58.25% | 49 |

These rates exclude other outcomes. Training/October labels resolving after the respective period boundary are censored rather than used to select or evaluate that phase. Overall results use the exported outcomes through the end of available history.

## Price-location candidate, explained

This candidate uses all three engulfing types, valid existing volume conditions, no H4 bias, and SELL entries only. At confirmation, compute the high and low of the 20 preceding candles. Keep the setup when the engulfing pattern highest wick is within the upper quarter of that range or exceeds the preceding high. This is a pre-entry price-location test, not a new engulfing definition.

Exact condition for SELL: (preceding20High - patternHigh) / (preceding20High - preceding20Low) <= 0.25. Only bars before the confirmation candle define the preceding range. The full pattern is known at confirmation.

- Overall: 141 setups, 87 TP / 50 SL, four other outcomes, 63.50%, +37R before costs.
- Earlier selection period: 52 TP / 32 SL, 61.90%.
- Later combined October/November: 35 TP / 18 SL, 66.04%.
- October: 29 TP / 12 SL, 70.73%.
- November: 6 TP / 6 SL, 50.00%.

The 70.73% October figure must not be presented as the expected win rate. November does not confirm it. The full-sample rate is 63.50%. The ordinary Wilson interval is about 55.18?71.09%, before accounting for candidate selection or dependent overlapping trades.

SELL-only without the location condition earned +49R on more trades at 58.25%; the location candidate earned +37R at 63.50%. The higher hit rate does not mean more total R. The SELL advantage may be market-period-specific and should not become a permanent direction restriction without different market regimes.

## What to do next

Treat price location as a candidate feature for a separate study, not as a proven 70% fix. Keep a new validation period separate, include realistic execution costs, and compare a predeclared rule with its baseline without retuning on that period. Do not change TP to manufacture a higher win rate while assuming profitability stays the same. If 1:1 remains mandatory, the supplied history does not support promising a durable 70% result.

## Limits

- Only early August through mid-November data are available, and many earlier exports overlap it.
- Testing 88 variants introduces selection bias even though later outcomes were not used to rank them.
- Candle-pattern trades can overlap and share market conditions; ordinary binomial confidence intervals can understate uncertainty.
- Prices are OHLC, not tick-by-tick bid/ask execution; costs are excluded and ambiguous/cancelled/active outcomes do not count as wins or losses.
- Results are historical recorded-setup selections, not a guaranteed live win rate.
- No source code, dashboard filter, live trading rule, SL or TP was changed.