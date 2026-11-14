# Original 5,000-candle studies: baseline diagnostics before extra filters

Inputs: Volume-Engulfing-Study-XAUUSD-M15 (2).csv (no bias) and (3).csv (H4 bias). No time or SELL-only filter is applied in this analysis.

## Paired bias comparison

| Type | No bias TP/SL | Win rate | H4 TP/SL | Win rate | TP removed | SL removed |
|---|---:|---:|---:|---:|---:|---:|
| T1 | 121/118 | 50.63% | 74/55 | 57.36% | 47 | 63 |
| T2 | 58/60 | 49.15% | 33/27 | 55.00% | 25 | 33 |
| T3 | 37/30 | 55.22% | 22/14 | 61.11% | 15 | 16 |
| All | 216/208 | 50.94% | 129/96 | 57.33% | 87 | 112 |

All H4 entries match no-bias entries in prices and outcomes. H4 bias improves the recorded selection, but removes winning trades as well as losses. It is SELL-heavy (203 of 227 entries) and H4 alone lost 9R in the partial November sample, so this does not establish a permanent advantage in every market regime.

## Volume ratio observations

On H4 T1 winners, median V2/V1 is 0.843; on losers it is 0.820. A larger decrease does not distinguish the winners here. H4 T2 winning/losing median V3/V2 is 0.819/0.825, and H4 T3 is 0.775/0.757. These are descriptive comparisons, not sufficient evidence of a reliable volume threshold.

## Buffer simulations without extra entry filters

The same recorded qualifying setups were recalculated from matching OANDA candles with 5-, 10-, and 20-pip buffers. Pattern, direction, volume qualification and any H4 bias membership were held fixed. Existing next-open/capped entry rules, pattern-wick SL and 200-pip risk cap were reused. TP remained exactly 1R, so it moved when risk changed. Risk-free exits were disabled as in the original study. All original 10-pip entries, SL, TP and outcomes reproduced.

| Bias | Buffer | Recorded setups | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|---:|
| No bias | 5 pips | 431 | 213 | 211 | 7 | 50.24% | 2 |
| No bias | 10 pips | 431 | 216 | 208 | 7 | 50.94% | 8 |
| No bias | 20 pips | 431 | 222 | 199 | 10 | 52.73% | 23 |
| H4 bias | 5 pips | 227 | 126 | 99 | 2 | 56.00% | 27 |
| H4 bias | 10 pips | 227 | 129 | 96 | 2 | 57.33% | 33 |
| H4 bias | 20 pips | 227 | 131 | 93 | 3 | 58.48% | 38 |

H4 with 20 pips turns six original losses into TP but also turns three original wins into SL. Net counts move from 129 TP / 96 SL to 131 TP / 93 SL, with other outcomes increasing from two to three. This is a small improvement, not a 60?70% result.

These are matched-setup sensitivity tests, not a complete rescan for any setups that the original 10-pip entry calculation excluded. They do not model spread, commission or slippage. Different buffer results can also change pending fills, ambiguous outcomes and unresolved trades; excluded outcomes are reported explicitly.

## Earlier-period check

An additional 167 earlier no-bias setups from the previous extended data, outside this 5,000-candle export, were checked using the same 10/20-pip comparison.

| Buffer | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|
| 10 pips | 74 | 87 | 6 | 45.96% | -13 |
| 20 pips | 76 | 83 | 8 | 47.80% | -7 |

The wider buffer improves that earlier sample too, but it remains negative before costs. This does not establish a sufficient standalone edge.

## What the evidence supports

1. H4 bias is a better comparison baseline than no bias in these exports; its effect is larger than the tested buffer adjustment.
2. Tightening the study buffer further to five pips worsens the overall results in both exports.
3. Twenty pips is a candidate for further study, with modest improvements on matched setups. It has not been applied to the dashboard.
4. A more aggressive volume-decrease condition is not established as necessary by these data.
5. Determine whether losses come from poor setup location or candle geometry by measuring those features before entry and validating on separate data. The CSV itself lacks zone proximity, candle-body/wick geometry and spread; outcomes alone cannot identify the cause of every SL.
6. Any selection rule must be checked across market regimes and with trading costs; an improved retrospective win rate is not proof of future performance.

No source code, dashboard settings, live trading rules, SL buffer, or TP was changed. The simulations are analysis artifacts only.