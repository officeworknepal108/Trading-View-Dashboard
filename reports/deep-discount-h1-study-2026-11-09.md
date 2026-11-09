# Gold H1 Deep Discount and Trendline Study

Period: 2026-10-08T10:00:00.000Z to 2026-11-09T05:00:00.000Z.

500 completed H1 bars; M15/M30 confirmations; all sessions. TradingView WebSocket data for OANDA:XAUUSD.

| Counting method | Setups / entries | TP | SL | Still open | TP rate on completed | Total R |
|---|---:|---:|---:|---:|---:|---:|
| Independent zone setups (dashboard study) | 6 | 2 | 3 | 1 | 40% | 1R |
| Unique executions after merging identical levels and confirmation | 5 | 2 | 2 | 1 | 50% | 2R |

Internal DB and ISS L4 generated identical entry, stop and target on one signal. The dashboard retains both zone setups; the unique-execution row counts that entry once.

All deep-discount setups in this sample had matching trendline evidence. There were no deep-discount setups without trendline support, so this sample cannot measure the added benefit of trendlines.

Evidence uses only candles completed by confirmation. Matching support means direction and timeframe, without requiring a trendline touch or minimum proximity. Continuation/breakout and ATR distance filters are available in the dashboard.

The sample is small. These are simulated zone setups, not broker-account results. Spread, slippage and commission are not modelled. The current ISS L4 setup was still open at the report cutoff.

Files: `deep-discount-h1-study-2026-11-09.json` contains full study records; `deep-discount-h1-study-2026-11-09.csv` contains the six deep-discount zone rows.
