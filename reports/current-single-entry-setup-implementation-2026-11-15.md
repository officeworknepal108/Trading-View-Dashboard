# Implemented M15/H4 single-entry study configuration

The Volume Engulfing Study opens with M15, H4 structure bias, H4 EMA alignment on, H1 continuation/Far on, and an 8,000-candle history request. The new Apply M15 / H4 single-entry setup button restores these choices and the All type/volume filters. Other timeframes remain selectable.

Rules required for the reproduced historical result:

- Existing T1/T2/T3 engulfing confirmations; T4 excluded.
- T1 requires V2 < V1. T2/T3 require V3 < V2; their volume subgroups remain visible.
- Closed H4 structure trend must match the direction. Neutral trend skips the setup.
- Closed H4 EMA20 > EMA50 for BUY; EMA20 < EMA50 for SELL.
- An already-confirmed matching H1 continuation line is required: green for BUY, red for SELL. Planned entry must be more than 0.5 times the entry-timeframe Wilder ATR14 away from at least one matching line. No touch or FIB qualification is implied.
- M15 SL extends beyond the pattern's extreme wick by 30 pips. Other timeframe buffers and production trade rules are unchanged.
- Existing entry at the next candle open, or pending entry at the existing risk cap, remains. One entry per qualifying setup; qualifying setups may overlap.
- TP is 1:1 from the planned entry and SL. Filled trades remain until SL or TP. No opposite-engulfing exit, layering, overlap restriction or new pending-trend cancellation is applied.

The result panel now shows PnL at $50 fixed risk and the balance from $5,000, for the currently visible type/volume subset. This is a study accounting example, not live position sizing or order automation. No compounding. Only TP/SL outcomes count toward dollar PnL.

## Full historical replay

The actual runVolumeStudy function, with the current 30-pip implementation, scanned the saved M15 history and independently reproduced:

| Setups | TP | SL | Other | Win rate | Net R | PnL at $50 | Balance from $5,000 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 252 | 140 | 104 | 8 | 57.38% | +36 | +$1,800 | $6,800 |

Every setup identity and outcome matched the archived 30-pip research: no extra setups, missing setups or outcome changes. Evidence is in current-30-pip-full-runner-parity-2026-11-15.json.

The run requested 8,000 candles but the saved feed provided 6,889 closed M15 candles including pattern context. History ends at the Nov 13, 2026 cutoff in the evidence file. This is not a five-month result or a promise of identical counts when history, cutoff, symbol or settings change. Costs are excluded; unresolved/cancelled/ambiguous outcomes do not count as TP/SL.

Validation: all 27 study tests, TypeScript check, and production build passed. git diff --check passed. lock:check continues to flag pre-existing protected modifications in OandaProChart.tsx, tradeLevels.ts and trendlineStudy.ts; none was edited for this implementation. Only the unprotected study component was changed in this turn, alongside report artifacts. All three authorization sections are relocked at completion.
