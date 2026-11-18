# Overlapping Scalp 1:1 pullback-depth study

34 later setups: 23 TP, 9 SL, 2 unfilled. 34 have a same-direction earlier open setup. Uses the saved 3 August–18 November 2026 sample, through 07:45 Nepal.

100% = absolute body of the later setup final engulfing confirmation candle. Pullback starts at next M15 open; SELL uses upward movement, BUY downward movement. Values can exceed 100%.

## First 75 minutes, or existing exit if earlier

| Outcome | Setups measured | Median depth, bounded | Full depth range |
|---|---:|---:|---:|
| TP | 23 | 109.7–109.7% | 10.4–493.3% |
| SL | 9 | 198.9–198.9% | 156.8–273.3% |

## Full lifetime before existing exit

| Outcome | Setups measured | Median depth, bounded | Full depth range |
|---|---:|---:|---:|
| TP | 23 | 123.6–123.6% | 10.4–493.3% |
| SL | 9 | 218.3–218.3% | 156.8–273.3% |

## TP setups reaching each depth within entry window

| Depth | Definitely reached | Possibly reached, including definite |
|---|---:|---:|
| 10% | 23/23 | 23/23 |
| 25% | 20/23 | 20/23 |
| 40% | 15/23 | 15/23 |
| 50% | 15/23 | 15/23 |
| 60% | 15/23 | 15/23 |
| 75% | 15/23 | 15/23 |
| 100% | 13/23 | 13/23 |
| 150% | 7/23 | 7/23 |
| 200% | 5/23 | 5/23 |

## Method and limits

- **reference:** 100% = absolute body of the later setup final engulfing confirmation candle. Pullback starts at next M15 open; SELL uses upward movement, BUY downward movement. Values can exceed 100%.
- **overlap:** A separate earlier setup has at least one confirmed filled leg strictly before the later confirmation and a known exit candle strictly after it. Both intrabar boundary equality cases and unresolved earlier exits are excluded. This is temporal overlap, not containment inside the earlier trade price range. All qualifying later signals are counted, including third or subsequent signals.
- **entryWindow:** Maximum adverse depth from next open over the first 75 minutes, stopping at existing setup exit if earlier.
- **beforeExit:** Maximum adverse depth from next open through the existing common TP/SL. Does not imply an unfilled order remains eligible beyond 75 minutes.
- **bounds:** All complete candles before the exit candle are observed. On a TP candle, opening price and established fills provide guaranteed depth; the adverse wick provides possible depth because OHLC cannot place it before/after TP. On SL candles, depth stops at SL (or gap open).
- **limitations:** Offline chart simulations. Existing 10/25 entries and original exits define outcomes. Not a backtest of alternative entries; deeper entries would alter fills and risk/reward. No fees, spread, slippage or broker executions. Two unfilled setups remain in the overlap census but are not assigned trade-life depth. Earlier uncertain exits may hide additional overlaps.

The two existing pullback legs count as one setup. No trading code or settings changed. Detailed setup rows are in [CSV](overlapping-scalp-pullback-depth-2026-11-18.csv) and [JSON](overlapping-scalp-pullback-depth-2026-11-18.json).

Validation: reproduces the 34-setup overlap census and 23/9/2 outcomes; validates archived 10/25 entry geometry, common exits, continuous completed M15 coverage, and depth bounds for every measured setup.
