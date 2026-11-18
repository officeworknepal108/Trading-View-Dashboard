# November 2026 Scalp 1:1 SL review

Coverage: 2026-11-01 00:00 through 2026-11-18 08:45 Nepal time. Current strategy applied to TradingView OANDA Gold M15 chart history; this is a chart simulation, not an audit of executed MT5 orders.

**29 qualifying setups: 13 TP, 10 SL, 3 uncertain, 2 unfilled, 1 without a valid pullback entry.** Win rate among 23 clear closed setups: 56.52%. Each setup is counted once.

## What the evidence supports

1. **Failed continuation after the engulfing:** the first execution candle closed against the entry direction in 9/10 losses versus 4/13 winners. Every clear closed setup filled in that first candle, so this is also the entry candle. This is a post-entry diagnostic; a close-based exclusion would delay/change entries and cannot be applied retrospectively as a free improvement.
2. **Very distant H1 trendline qualification in three early-month shorts:** H1 reference distances were 18.40 ATR on 2 Nov 16:00, 19.15 ATR on 2 Nov 17:30, and 10.11 ATR on 3 Nov 04:45 Nepal time. No clear winner in this sample had an H1 reference over 10 ATR away. The current Far rule requires distance greater than 0.5 ATR, with no maximum. A distant reference can be a weak description of the current local reversal, but these three related cases are too few to establish a reliable maximum-distance filter.
3. **Mother-candle containment is a limited contributor this month:** 1/10 SL setups and 3/13 TP setups met the strict full-pattern containment definition. The losing case is 16 Nov 12:15 Nepal time, T1 SELL, inside the 11:30 mother candle. A blanket mother filter would also remove the three winners.
4. **Broad H4 alignment did not prevent local reversals:** every loss passed the strategy H4 bias and EMA alignment checks. The last closed H1 candle opposed 7/10 losses but also 8/13 winners, while 4-hour H1 momentum opposed only 4/10 losses and 7/13 winners. Those comparisons do not establish an effective simple H1 direction filter.
5. **There is no clear evidence here that stops were systematically too tight:** median first-leg stop distance was 1.37 ATR for losses versus 1.38 ATR for winners. None of the 10 losses had a stop under 1 ATR, while 3 winners did. None of the losses returned to the original TP during the 8 consecutive completed M15 candles strictly after the SL candle. This does not prove a wider stop would fail or succeed; a wider stop changes risk, size and target geometry and needs its own test.
6. **Some moves reversed after partial progress:** at least 3/10 losing setups achieved 0.5R favorable movement on fully observed candles strictly between fill and exit. One was near 0.96R before reversal. Fill and exit candles are excluded from this measure to avoid inventing intrabar sequencing. This suggests an exploratory management study, not evidence that break-even or a trailing stop improves total returns.

## Comparisons

| Observation | SL setups (10) | TP setups (13) |
|---|---:|---:|
| Inside mother | 1 | 3 |
| Previous 4 completed H1 candles net against entry | 4 | 7 |
| Last completed H1 candle against entry | 7 | 8 |
| Stop inside prior 8-bar range | 5 | 6 |
| First entry candle closes against trade | 9 | 4 |
| First-leg stop under 1 ATR | 0 | 3 |
| Fill after first execution candle | 0 | 0 |

## Every clear SL setup

All times are Nepal time; signal times identify confirming M15 candle opens. Entry and exit timestamps in the JSON identify M15 candles, not exact broker execution seconds.

| Signal | Side/type | Inside mother | H1 distance / ATR | Entry candle against | Candle intervals from fill to SL | Main observations |
|---|---|---|---:|---|---:|---|
| 2026-11-02 16:00 | bearish / T1 | No | 18.40 | Yes | 3 | Very distant H1 reference; First entry candle rejects direction |
| 2026-11-02 17:30 | bearish / T1 | No | 19.15 | Yes | 6 | Very distant H1 reference; At least 0.65R favorable movement before reversal; First entry candle rejects direction |
| 2026-11-03 04:45 | bearish / T2 | No | 10.11 | Yes | 3 | Very distant H1 reference; First entry candle rejects direction |
| 2026-11-04 16:15 | bearish / T2 | No | 0.74 | Yes | 23 | Recent 4-hour H1 momentum opposes trade; At least 0.96R favorable movement before reversal; First entry candle rejects direction |
| 2026-11-04 22:00 | bearish / T3 | No | 0.59 | Yes | 0 | Recent 4-hour H1 momentum opposes trade; First entry candle rejects direction |
| 2026-11-06 18:00 | bullish / T3 | No | 0.87 | Yes | 3 | First entry candle rejects direction |
| 2026-11-09 07:15 | bullish / T1 | No | 4.86 | No | 22 | At least 0.55R favorable movement before reversal |
| 2026-11-10 18:30 | bullish / T2 | No | 1.30 | Yes | 1 | Recent 4-hour H1 momentum opposes trade; First entry candle rejects direction |
| 2026-11-10 20:45 | bullish / T1 | No | 1.17 | Yes | 4 | Recent 4-hour H1 momentum opposes trade; First entry candle rejects direction |
| 2026-11-16 12:15 | bearish / T1 | Yes | 2.37 | Yes | 15 | Full pattern inside mother; First entry candle rejects direction |

## Limits and next step

Descriptive comparisons, overlapping features and small sample. No causal attribution to news/spread/slippage without broker ticks and archived event timestamps. Post-entry measurements are diagnostic, not pre-entry filters. Prior-swing comparison uses the 8 candles ending before the pattern, not a confirmed pivot. Recovery check requires 8 consecutive completed candles strictly after exit.

Research priority: test local continuation / entry-candle management and the relevance of very distant H1 references on fresh data. Do not assume that skipping a losing setup after observing its next candle can preserve the original entry. Compare changes against the winners too, using fixed risk and costs.

News, spread, slippage and broker-side execution cannot be identified as causes without archived event timestamps, bid/ask quotes and order/deal logs. No event was inferred from its calendar date alone.

For general stop placement principles, [CME explains the importance of logical stop levels and ordinary market movement](https://www.cmegroup.com/education/courses/trade-and-risk-management/proper-position-size). This does not identify the cause of any particular loss in this study.

Validation: all 10 losses retained approved H4 direction/EMA alignment; every clear closed setup filled in its first execution candle; all 10 post-SL recovery checks had 8 consecutive complete candles. Trading code and settings were not changed.

Evidence: [november-scalp-sl-review-2026-11-18.json](november-scalp-sl-review-2026-11-18.json), [november-scalp-sl-review-2026-11-18.csv](november-scalp-sl-review-2026-11-18.csv).
