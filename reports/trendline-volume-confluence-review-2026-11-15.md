# Further volume + EMA + trendline research

**No substantial, later-period-supported improvement was found. The accepted H4 EMA20/EMA50 filter remains unchanged.**

## Method

- Same 264 accepted M15 T1/T2/T3 setups with valid volume, H4 structure bias and H4 EMA20/50 agreement.
- Existing entry, 20-pip buffer and 1:1 TP remain fixed.
- Reuse the existing trendline study code and its BUY/SELL colour interpretation, including breakout slope reversal. No permanently preferred direction.
- H1 and H4 evidence only, from the same OANDA history. Supporting lines are recomputed using prefixes closed at each original engulfing confirmation; no line confirmed later is admitted.
- Seven predetermined conditions: any H1/H4 support, H1 continuation, H4 continuation, H1 breakout, H4 breakout, both timeframes, and the existing H1-continuation Far distance category.
- Rank using only August-September closed outcomes, minimum 30 observations, and net R at least as high as the earlier baseline. Freeze the top rule before checking later outcomes.
- The H1 continuation Far test is only the trendline component of an existing preferred setup; the original preferred-badge FIB qualification is not included and must not be assumed.

## Selected result

| Selection | Setups | TP | SL | Other | Win rate | Gross net R |
|---|---:|---:|---:|---:|---:|---:|
| Accepted EMA baseline | 264 | 143 | 115 | 6 | 55.43% | +28 |
| H1 continuation + Far | 252 | 139 | 108 | 5 | 56.28% | +31 |

The selected condition removes four TP, seven SL and one other outcome. It raises historical closed net R by only 3R.

| Period | Baseline TP/SL | Baseline net R | Candidate TP/SL | Candidate net R |
|---|---:|---:|---:|---:|
| August-September | 75/66 | +9 | 74/62 | +12 |
| October-November | 68/49 | +19 | 65/46 | +19 |

All of the net improvement occurs in the earlier period used to choose the condition; later net R is unchanged. That is not strong evidence for adding it. Matching trendline colour alone was already present for essentially all earlier setups and adds little discriminatory information.

## Stronger price-interaction check

Also test an OHLC approximation of actual touch and rejection of a pre-existing H1/H4 line. The line must have been confirmed before the engulfing pattern started; a pattern candle must span the projected line within the existing 0.2-price tolerance, and the final close must be on the trade side. No future line anchors are used.

| Rejection condition | Setups | TP | SL | Other | Win rate | Gross net R | Earlier TP/SL | Later TP/SL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Any H1/H4 line rejection | 68 | 34 | 32 | 2 | 51.52% | +2 | 15/18 | 19/14 |
| H1 continuation rejection | 51 | 22 | 27 | 2 | 44.90% | -5 | 9/17 | 13/10 |
| H4 continuation rejection | 21 | 12 | 8 | 1 | 60.00% | +4 | 3/4 | 9/4 |

The H4-only later rate of 9/13 cannot be treated as a stable approximately 70% method: its earlier result is only 3 TP / 4 SL, and the full group contains only 20 resolved trades. All rejection variants greatly reduce TP count and total R versus baseline.

## Monthly selected-rule results

| Month UTC | Baseline TP/SL | Baseline net R | Candidate TP/SL | Candidate net R |
|---|---:|---:|---:|---:|
| 2026-08 | 16/30 | -14 | 16/27 | -11 |
| 2026-09 | 59/36 | +23 | 58/35 | +23 |
| 2026-10 | 56/34 | +22 | 55/34 | +21 |
| 2026-11 | 12/15 | -3 | 10/12 | -2 |

## Interpretation

These tests do not supply the requested large increase in TP count, win rate or stable profit. They should not be sold as a meaningful breakthrough or automatically stacked onto the dashboard. The original approved EMA study remains the current configuration. Further research needs a separately specified setup and validation on new market history, not a claim that a chosen percentage has been established from repeated use of this period.

## Limits

- All comparisons use previously inspected early-August to mid-November 2026 history; this is retrospective and not independent forward validation.
- H1/H4 trendline history has adequate prior context; M15 supplies the historical entry ATR for the Far measurement. Unsupported distance context is not guessed.
- The touch test is an OHLC diagonal-line interaction approximation; tick-level ordering is unavailable.
- Repeated testing creates selection bias. No search was continued by tuning thresholds after the later-period result.
- Costs, overlapping-position constraints and sizing are excluded; cancelled/ambiguous/active outcomes do not count as wins or losses.
- No dashboard code, filter, stop, entry or target changed during this research turn.