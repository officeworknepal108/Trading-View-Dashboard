# Further TP/SL-count study: wider and adaptive buffers

**A modest full-sample improvement did not hold in the later-period check. No dashboard change is justified by this test alone.**

## Method

- Original 312 M15/H4-qualified T1/T2/T3 setups and volume conditions. No time, direction or location filter.
- Return to the original next-open/capped-entry policy rather than the rejected 50% pullback.
- Compare fixed 20, 30, 40 and 60-pip SL buffers and buffers equal to 25%/50% of the preceding 14-bar mean true range. The ATR proxy excludes the confirmation candle; insufficient initial context falls back to the original 20-pip buffer.
- Maintain original pattern-wick stop placement, existing 200-pip risk cap and fixed 1:1 TP. A larger stop changes TP too. Risk-cap pending prices can also change; this is the existing entry policy, not frozen entry prices.
- All original 20-pip entries, SL, TP and outcomes reproduce exactly.
- Select using August-September outcomes closed before October 1: require both more TP and fewer SL than baseline, then prefer higher TP count and fewer SL. Evaluate the selected rule on later trades without retuning.

## Earlier-period comparisons

| Buffer | TP | SL | Other | Win rate | Net R |
|---|---:|---:|---:|---:|---:|
| Original 20 pips | 89 | 87 | 7 | 50.57% | 2 |
| 30-pip buffer | 92 | 82 | 9 | 52.87% | 10 |
| 40-pip buffer | 91 | 81 | 11 | 52.91% | 10 |
| 60-pip buffer | 87 | 81 | 15 | 51.79% | 6 |
| 25% of previous ATR buffer | 91 | 83 | 9 | 52.30% | 8 |
| 50% of previous ATR buffer | 90 | 81 | 12 | 52.63% | 9 |

The predeclared objective selects the 30-pip buffer.

## Selected comparison

| Period | Original TP/SL | Original other | Original net R | 30-pip TP/SL | 30-pip other | 30-pip net R |
|---|---:|---:|---:|---:|---:|---:|
| All history | 161/142 | 9 | 19 | 163/137 | 12 | 26 |
| Earlier August-September | 89/87 | 7 | 2 | 92/82 | 9 | 10 |
| Later October-November | 72/55 | 2 | 17 | 71/55 | 3 | 16 |
| October | 58/34 | 0 | 24 | 57/34 | 1 | 23 |
| November | 14/21 | 2 | -7 | 14/21 | 2 | -7 |

Whole-history win rate rises from 53.14% to 54.33%, and closed net R from +19R to +26R. However, later trades fall from 72 TP / 55 SL to 71 TP / 55 SL, with net R falling from +17R to +16R. There is no later-period confirmation of the improvement.

Thirty-five candidate entries change under the existing risk cap when the buffer is widened. Cancelled orders rise from seven to ten. Part of the lower SL count therefore reflects fewer filled orders rather than converted winners.

## Conclusion

A wider buffer is a plausible study variable but the observed full-sample advantage is small and concentrated in earlier data. Do not present it as a reliable solution for more TP and fewer SL or as evidence of a 70% win rate. Keep the baseline unchanged until a separately defined improvement survives genuinely new data and costs.

## Limits

- Same historical market period has been inspected repeatedly, so the later check is retrospective and cannot be called independent forward validation.
- Only the recorded original qualifying setups were simulated; no full pattern rescan under the new rules.
- OHLC ambiguity, cancelled/active trades, costs, position sizing and overlapping trades affect interpretation.
- All net R values are gross, excluding costs and non-final outcomes.
- No dashboard, production entry, SL buffer or TP was changed.