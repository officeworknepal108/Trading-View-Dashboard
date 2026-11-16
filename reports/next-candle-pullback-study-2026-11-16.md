# Next-M15-candle pullback depth after Scalp 1:1 engulfing

Analysed 227 archived eligible setups: 46 buys and 181 sells. Signal dates: 2026-08-03T13:15:00.000Z through 2026-11-11T04:45:00.000Z. This is about 3.5 months, not five months.

Buy finding: 46/46 next candles dip below their open. At least 25% body-depth is reached by 35/46 (76.1%); at least 50% by 28/46 (60.9%). Only 20/46 dip and finish bullish. These observations do not establish a profitable entry rule.

## Definition

For a BUY: pullback % = (next candle open - next candle low) / confirming engulfing candle body x 100, floored at zero. A SELL uses (next candle high - next candle open). The confirming body is abs(close - open), including for T2/T3; it is not the whole multi-candle pattern or wick range.

Example: engulfing open 3000, close 3010 (body 10); next open 3010, low 3007.50 => 25% pullback. Percentages above 100% are possible. A 25% pullback measured from the next open differs from a limit 25% below the previous close when there is an opening gap.

## Cumulative reach measured from next open

| Pullback threshold | Buy candles | Buy % | Sell candles | Sell % | Combined % |
|---:|---:|---:|---:|---:|---:|
| At least 10% | 42/46 | 91.3% | 163/181 | 90.1% | 90.3% |
| At least 25% | 35/46 | 76.1% | 130/181 | 71.8% | 72.7% |
| At least 33% | 33/46 | 71.7% | 114/181 | 63.0% | 64.8% |
| At least 50% | 28/46 | 60.9% | 88/181 | 48.6% | 51.1% |
| At least 75% | 21/46 | 45.7% | 63/181 | 34.8% | 37.0% |
| At least 100% | 14/46 | 30.4% | 46/181 | 25.4% | 26.4% |
| At least 150% | 8/46 | 17.4% | 24/181 | 13.3% | 14.1% |
| At least 200% | 5/46 | 10.9% | 12/181 | 6.6% | 7.5% |

These rows overlap: a candle reaching 75% also reaches 50% and 25%. Counts are touches at any point during that candle, not wins or guaranteed executable fills.

## Non-overlapping depth buckets

| Maximum next-candle depth | Buy count | Sell count |
|---|---:|---:|
| No dip | 0 | 1 |
| >0 to <10% | 4 | 17 |
| 10 to <25% | 7 | 33 |
| 25 to <50% | 7 | 42 |
| 50 to <75% | 7 | 25 |
| 75 to <100% | 7 | 17 |
| 100 to <150% | 6 | 22 |
| 150 to <200% | 3 | 12 |
| 200% or more | 5 | 12 |

## Dip versus recovery

- buy: 46/46 (100.0%) move adversely from the next open; 20/46 both dip and close back in the signal direction. 46/46 have a nonzero actual lower/upper wick. 0/46 touch the original pattern SL during that next candle. Median maximum dip: 63.6% of the confirmation body, or 4.2 gold price units (42.1 dashboard pips).
- sell: 180/181 (99.4%) move adversely from the next open; 99/181 both dip and close back in the signal direction. 180/181 have a nonzero actual lower/upper wick. 5/181 touch the original pattern SL during that next candle. Median maximum dip: 48.2% of the confirmation body, or 2.5 gold price units (25.3 dashboard pips).

## Alternate: limit level measured from engulfing close

This matches the earlier suggested buy limit = engulfing close minus percentage of engulfing body (sell mirrored). A gap can make the limit marketable immediately; these remain price reach counts, not order simulations.

| Pullback threshold | Buy candles | Buy % | Sell candles | Sell % | Combined % |
|---:|---:|---:|---:|---:|---:|
| At least 10% | 41/46 | 89.1% | 161/181 | 89.0% | 89.0% |
| At least 25% | 35/46 | 76.1% | 130/181 | 71.8% | 72.7% |
| At least 33% | 33/46 | 71.7% | 114/181 | 63.0% | 64.8% |
| At least 50% | 28/46 | 60.9% | 88/181 | 48.6% | 51.1% |
| At least 75% | 21/46 | 45.7% | 63/181 | 34.8% | 37.0% |
| At least 100% | 14/46 | 30.4% | 46/181 | 25.4% | 26.4% |
| At least 150% | 8/46 | 17.4% | 22/181 | 12.2% | 13.2% |
| At least 200% | 5/46 | 10.9% | 12/181 | 6.6% | 7.5% |

## Which original winners and losers dip?

Buy setups only. Original outcomes retain the original entry and 1:1 target. This is a descriptive cross-tab, not the outcome of entering at a pullback price.

| Pullback from next open | Original TP reaching it | Original SL reaching it | Reached and next closes bullish |
|---:|---:|---:|---:|
| 10% | 18/19 | 19/22 | 16/42 |
| 25% | 14/19 | 17/22 | 9/35 |
| 33% | 14/19 | 16/22 | 7/33 |
| 50% | 12/19 | 15/22 | 5/28 |
| 75% | 9/19 | 11/22 | 1/21 |
| 100% | 7/19 | 7/22 | 0/14 |
| 150% | 5/19 | 3/22 | 0/8 |
| 200% | 3/19 | 2/22 | 0/5 |

## Chronological cross-check

Earlier = before 2026-10-01 UTC; later = from that date. Both periods have already been researched previously; neither is an untouched holdout.

| Side / period | Setups | Reaches 25% | Reaches 50% | Median depth |
|---|---:|---:|---:|---:|
| buy-earlier | 37 | 27 (73.0%) | 24 (64.9%) | 63.9% |
| buy-later | 9 | 8 (88.9%) | 4 (44.4%) | 44.1% |
| sell-earlier | 87 | 66 (75.9%) | 46 (52.9%) | 54.0% |
| sell-later | 94 | 64 (68.1%) | 42 (44.7%) | 39.9% |

## Validation and scope

- **market:** Archived OANDA XAUUSD M15; existing Scalp 1:1 qualified setups only.
- **eligibility:** T1/T2/T3; H4 structure + EMA20/50; H1 continuation/Far; 30-pip pattern SL buffer; minimum 250-unit volume decrease. Existing archived entry eligibility is retained.
- **primaryMetric:** BUY: max(0, next open - next low) / abs(confirmation close - confirmation open) * 100. SELL mirrors with next high - next open.
- **alternateMetric:** BUY: max(0, confirmation close - next low) / confirmation body * 100; SELL mirrors. This corresponds to the earlier suggested close-minus-body-fraction limit price.
- **interpretation:** Cumulative percentages are price-touch frequencies within the entire immediate next M15 candle, not win rates, broker fill probabilities, or identification of the future low. 100% means one confirming candle body, not a 100% move in gold price.
- **wick:** The primary metric includes next candles that continue against the signal. Actual wick and close-in-signal-direction counts are recorded separately. A dip is not necessarily rejection.
- **scope:** Includes all eligible archived outcomes, not only winners or filled trades. Does not rescan signals rejected under original entry rules. Exact consecutive completed next bars required.
- **timing:** No inference about whether dip occurred before a rally, TP or SL. M15 OHLC cannot resolve order. Touch can occur after the original setup was invalidated. No hypothetical PnL estimated.
- **limitations:** Retrospective descriptive sample of about 3.5 months. No spread, bid/ask, commission, slippage, live trading gates or portfolio constraints; repeated signals can be dependent. Thresholds are not optimized or forward validated.
- **pips:** Existing dashboard gold convention: 1 pip = 0.1 price units.
- **firstSignal:** 2026-08-03T13:15:00.000Z
- **lastSignal:** 2026-11-11T04:45:00.000Z
- **historyFirst:** 2026-08-02T22:00:00.000Z
- **historyLastCompletedClose:** 2026-11-13T22:00:00.000Z
- **archivedSetups:** 252
- **qualified:** 227
- **analysed:** 227
- **excluded:** []
- **uniqueCandles:** 6890
- **duplicates:** 5000
- **conflictingOHLC:** 0
- **levelParity:** 227
- **outcomeParity:** 227
- **inputs:** [{"file":"volume-gap-study-2026-11-15.json","sha256":"1d4bf3927e0600514a74d1e1af333d10b6f8e44e490e991b2def8998fd32564b"},{"file":"five-month-m15-history-older.json","sha256":"51e6acf4270fd302b50c5e40fce40086797506b66c95c2fa052d70097988dec6"},{"file":"five-month-m15-history-latest.json","sha256":"4a3c578336a2775858cb25eee0d1c3899ebbf3a5ec64a931983d6dc3b16467b9"}]

No live trading or dashboard rules were changed. No entry percentage is declared optimal. A deeper reachable price can belong to a failed engulfing rather than a profitable rejection. Tick/lower-timeframe order replay and cost-aware outcome testing are needed before changing execution.

Reproduce: npx.cmd tsx reports/next-candle-pullback-study-2026-11-16.ts

Detailed candles: next-candle-pullback-study-2026-11-16-candles.csv. Full statistics and source hashes: next-candle-pullback-study-2026-11-16.json.
