# H1 continuation/Far filter added

The Volume Engulfing Study now enables the approved H1 continuation/Far filter by default. A checkbox allows comparison with the existing H4 EMA filter alone. This applies to T1, T2 and T3, in both directions.

At engulfing confirmation, a BUY requires a confirmed green H1 continuation line; a SELL requires a confirmed red H1 continuation line. The planned entry must be more than 0.5 times the study timeframe's Wilder ATR(14) away from at least one matching line. A line touch is not required. Only closed H1 candles and lines already confirmed at that time qualify. Missing required history prevents qualification.

The result details and CSV include the selected line, its confirmation time and the entry-to-line distance. The existing H4 structure bias, H4 EMA alignment, 20-pip M15 buffer, entry rules and 1:1 reward/risk remain in place. This change is confined to the study.

## Historical verification and further research

The implemented runner reproduced all 252 setup identities from the approved research: 139 TP, 108 SL and 5 other outcomes. Win rate is TP / (TP + SL). Results cover the available August–November 2026 history; requesting 8,000 candles did not supply a full five months.

| Comparison | Setups | TP | SL | Other | Win rate | Net R |
|---|---:|---:|---:|---:|---:|---:|
| Added filter, current 20-pip buffer | 252 | 139 | 108 | 5 | 56.28% | +31 |
| Research only: 30-pip buffer | 252 | 140 | 104 | 8 | 57.38% | +36 |

The 30-pip simulation recalculates levels using the existing risk-cap entry rules and rechecks H1 distance at the recalculated entry. It uses the archived matched setup set, rather than a fresh complete signal scan. Earlier-period net R rises from +12 to +14; later-period net R rises from +19 to +22. Three additional outcomes fall outside TP/SL. A separate quarter-ATR buffer trial produces +31R, with no overall gain.

The 30-pip trial is not applied. The improvement is small, and repeated testing on this same history does not demonstrate an improvement on new data. Neither result includes trading costs or guarantees future performance.

Validation: 27 study tests passed; TypeScript/lint and production build passed. Historical parity matched all 252 setup identities. `git diff --check` passed. `lock:check` still flags earlier uncommitted changes in OandaProChart.tsx, tradeLevels.ts and trendlineStudy.ts; those protected files were not edited for this addition.

Machine-readable evidence: `h1-far-implementation-historical-parity-2026-11-15.json` and `h1-far-filter-buffer-research-2026-11-15.json` in this directory.
