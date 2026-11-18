# Scalp 1:1: first candle after engulfing versus entry-arrow outcome

All available approved Scalp 1:1 historical entry arrows, 3 Augustâ€“18 November 2026 through 07:45 Nepal. The two entry legs are counted separately, with a second unique-setup count. Chart simulations, not MT5 executions.

The first M15 candle immediately after the completed engulfing confirmation. BUY+red, SELL+green = opposite. A doji is neither direction.

## Main result

**218 of 416 confirmed historical entry arrows (52.40%) had the first post-engulfing candle close against the trade.** They represent 109 distinct engulfing setups, because the two entry legs are separate arrows.

| Pattern | Arrows | TP | SL | Outcome uncertain | Open |
|---|---:|---:|---:|---:|---:|
| BUY engulfing, next candle red | 50 | 22 | 22 | 6 | 0 |
| SELL engulfing, next candle green | 168 | 72 | 76 | 20 | 0 |
| Combined | 218 | 94 | 98 | 26 | 0 |

Counted once per setup, the opposite-candle group has **47 TP setups, 49 SL setups and 13 uncertain setups**. The 218 arrows consist of 109 first-entry and 109 second-entry arrows.

## Comparison

| First post-engulfing candle | Arrows | TP | SL | Uncertain | TP rate among clear closed arrows |
|---|---:|---:|---:|---:|---:|
| Opposes trade | 218 | 94 | 98 | 26 | 48.96% |
| Continues trade | 198 | 122 | 52 | 24 | 70.11% |

Doji first candles: 0 in the confirmed-arrow sample. Uncertain outcomes are excluded from TP rates.

## BUY and SELL must also be inspected separately

| Trade side | Next candle | Arrows | TP | SL | Uncertain | TP rate among clear closed arrows |
|---|---|---:|---:|---:|---:|---:|
| BUY | red | 50 | 22 | 22 | 6 | 50.00% |
| BUY | green | 30 | 10 | 20 | 0 | 33.33% |
| SELL | green | 168 | 72 | 76 | 20 | 48.65% |
| SELL | red | 168 | 112 | 32 | 24 | 77.78% |

The aggregate comparison is driven mainly by SELL entries. In this sample, BUY entries did not show the same direction of association: BUY/red had 22 TP and 22 SL, whereas BUY/green had 10 TP and 20 SL. The two legs of a setup are correlated, so arrow counts are not independent trade observations.

## Actual fill-candle comparison

The first post-engulfing candle and actual limit-fill candle can differ. Both definitions are reported separately. No unfilled or uncertain-fill order is counted as a confirmed arrow.
 There were 45 delayed-fill arrows; 40 arrows have a different color classification between the first post-engulfing candle and their actual fill candle.

| Actual fill candle | Arrows | TP | SL | Uncertain |
|---|---:|---:|---:|---:|
| Opposes trade | 252 | 105 | 112 | 35 |
| Continues trade | 164 | 111 | 38 | 15 |

## Validation and limits

All known fills replayed through scalpOneToOneChartHistory and scalpHistoryFillDisplays; arrow identity, marker time, outcome and entry price checked against archived evidence.

An entry can be proven while its final result remains uncertain. Those arrows are included in the arrow count and excluded from TP/SL win rate. No outcome or candle close is treated as knowable before its own candle finishes.

Reuses the approved setup universe of the full history study. No spread, commission, slippage or account execution restrictions. It does not establish that waiting for the next candle would preserve the original entry or improve returns.

Every arrow was independently reconciled with archived marker time, entry price and outcome. All 416 arrow IDs are unique, and both candle-direction and outcome totals reconcile. No unfilled order was promoted into an arrow. Trading code and settings were not changed.

Waiting to observe the first candle close would change entry timing and price; these are retrospective groups, not a backtest of a delayed-entry rule. Some trades may already have exited by that candle close.

Evidence: [scalp-first-candle-arrow-study-2026-11-18.csv](scalp-first-candle-arrow-study-2026-11-18.csv), [scalp-first-candle-arrow-study-2026-11-18.json](scalp-first-candle-arrow-study-2026-11-18.json).
