# Stronger observed TP/SL-count candidate: SELL-only without H4 gating

**This recorded configuration improves both TP and SL counts versus the original H4 study, but is not a proven market-independent strategy.**

## Configuration

- XAUUSD M15; all T1/T2/T3 engulfing types.
- Existing volume eligibility and original next-open/capped entry policy.
- SELL entries only; disable the H4 direction gate.
- Original 20-pip M15 pattern-wick SL buffer and 1:1 TP.
- No time window, midpoint pullback, close target or price-location condition.

## Comparison

| Configuration | Setups | TP | SL | Other | Win rate | Gross net R |
|---|---:|---:|---:|---:|---:|---:|
| Original H4, both directions | 312 | 161 | 142 | 9 | 53.14% | +19 |
| H4, SELL only | 245 | 138 | 103 | 4 | 57.26% | +35 |
| No H4 gate, SELL only | 303 | 173 | 124 | 6 | 58.25% | +49 |

Relative to original H4: 12 more TP, 18 fewer SL, +30R gross net improvement.

This is a change in setup selection, not converting individual H4 losses into wins: remove 67 H4 BUY setups (23 TP / 39 SL, five other), then add 58 SELL setups outside H4 agreement (35 TP / 21 SL, two other).

## Monthly and chronological consistency

| Period | TP | SL | Other | Win rate | Gross net R |
|---|---:|---:|---:|---:|---:|
| 2026-08 | 44 | 42 | 2 | 51.16% | +2 |
| 2026-09 | 59 | 36 | 1 | 62.11% | +23 |
| 2026-10 | 58 | 34 | 0 | 63.04% | +24 |
| 2026-11 | 12 | 12 | 3 | 50.00% | +0 |
| August-September | 103 | 78 | 3 | 56.91% | +25 |
| October-November | 70 | 46 | 3 | 60.34% | +24 |

August and November are partial months. November is breakeven before costs, so there is no evidence of profit in every period. The earlier/later gross results are both positive, but these same periods have been examined repeatedly and are not independent validation.

## By type

| Type | Setups | TP | SL | Other | Win rate | Gross net R |
|---|---:|---:|---:|---:|---:|---:|
| T1 | 170 | 97 | 70 | 3 | 58.08% | +27 |
| T2 | 85 | 48 | 34 | 3 | 58.54% | +14 |
| T3 | 48 | 28 | 20 | 0 | 58.33% | +8 |

## Other new tests in this turn

Moving the stop to the confirmation candle wick produced 154 TP / 154 SL, 0R, worse than baseline. Stop protection selected on earlier trades also failed to improve the later result. One late-trigger half-risk protection variant improved gross R by only 1R, based on two reduced losses, while keeping TP count unchanged. Neither provides a convincing improvement over the direction-only configuration.

## Limits

- Same previously analysed early-August to mid-November period; not fresh independent or live validation.
- Direction-only candidate was already included among training-selected candidates in the earlier feature review. This is a review of a stronger observed configuration, not a newly proven edge.
- The 303 setups are not a simple subset of the 312 H4 setups: H4 BUY entries are excluded and additional SELL entries with no H4 requirement are included.
- SELL advantage may be specific to the market period; a rising market or different regime is needed for separate validation.
- Gross normalized R excludes costs, overlapping-position constraints and position sizing. Cancelled/ambiguous/active outcomes are excluded from win rate and net R.
- No source code, live rule, dashboard filter, entry, buffer or target was changed.

The appropriate next step is a separately specified validation on new market data, including different directional regimes and execution costs, before any dashboard or live application. The observed win rate is 58.25%, not 70%.