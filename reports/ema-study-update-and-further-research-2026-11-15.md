# Added EMA study filter and further research

## Implemented in the Volume Engulfing Study

- H4 EMA20/EMA50 agreement switch, enabled by default. The structure-bias selector now defaults to H4.
- BUY requires EMA20 > EMA50; SELL requires EMA20 < EMA50, checked on the latest H4 bar closed at engulfing confirmation.
- Turn the EMA switch off to run the original comparison. The filter is study-only and uses a fixed H4 timeframe independently of the selected structure-bias timeframe.
- Existing T1/T2/T3 volume rules, entry policy, 20-pip M15 SL buffer, 1:1 TP, and 8,000-candle request limit are retained.
- Monthly UTC signal-month summaries follow the current type and volume-group view filters.
- Results show the applied EMA setting and rejection count; selected entries show their EMA evidence. CSV includes the setting, H4 bar timestamp and both EMA values.

## Verification

- 22 study tests passed: seeded EMA calculations, equality and direction rejection, incomplete/future bar rejection, historical availability, history loading, pagination, monthly grouping and existing volume/entry rules.
- Type check and production build passed.
- Full historical runner reproduces both original 312 entries (161 TP / 142 SL) and filtered 264 entries (143 TP / 115 SL), including every monthly TP/SL total.
- Independently checked all 312 EMA snapshots and all 264 selected trade identities against the approved research.
- Only the study component, service and its tests were changed in this turn. Live entry rules were not changed.

## Further research, not applied

| Addition to approved EMA filter | TP | SL | Other | Win rate | Gross net R | Earlier net R | Later net R |
|---|---:|---:|---:|---:|---:|---:|---:|
| Original 20 pips | 143 | 115 | 6 | 55.43% | +28 | +9 | +19 |
| 30-pip buffer | 144 | 111 | 9 | 56.47% | +33 | +13 | +20 |
| 25% of previous ATR buffer | 142 | 114 | 8 | 55.47% | +28 | +11 | +17 |
| EMA50 slope agrees over 3 closed H4 bars | 122 | 98 | 6 | 55.45% | +24 | +7 | +17 |

The 30-pip buffer is a small candidate improvement: one more TP, four fewer SL, three more other outcomes, +5R gross over the approved EMA+20-pip baseline. Earlier-period net R rises from +9R to +13R; later-period net R from +19R to +20R. It has NOT been enabled or added as a dashboard buffer choice.

The buffer experiment recalculates SL, 1:1 TP and capped-entry prices using the existing production calculation on the same recorded setup membership. Its additional cancellations mean lower SL count does not solely represent losses converted into wins.

The EMA-slope check reduces net R, and the adaptive quarter-ATR buffer has no full-sample gain and worsens later-period performance. Neither was added.

## Monthly 20 versus 30-pip research

| Month UTC | Approved EMA +20 TP/SL | Net R | EMA +30 TP/SL | Net R |
|---|---:|---:|---:|---:|
| 2026-08 | 16/30 | -14 | 15/30 | -15 |
| 2026-09 | 59/36 | +23 | 61/33 | +28 |
| 2026-10 | 56/34 | +22 | 56/33 | +23 |
| 2026-11 | 12/15 | -3 | 12/15 | -3 |

These comparisons reuse the same short historical sample and are exploratory, not fresh independent validation. Costs and portfolio constraints are excluded. A small later improvement is not strong evidence of a durable edge. The accepted EMA filter remains on the original 20-pip buffer.

The repository lock check still flags protected changes from earlier uncommitted work. No locked protected file was edited in this turn. All sections are relocked at completion.