# Gold M15 Scalp 1:1: engulfing patterns inside mother candles

Observed M15 history: 03 Aug 2026 03:45 through 18 Nov 2026 07:45 Nepal time. The last forming candle is excluded.

## Results

| Group | Setups | TP | SL | Uncertain | No fill | No valid entry |
|---|---:|---:|---:|---:|---:|---:|
| Inside mother candle | 22 | 10 | 9 | 2 | 1 | 0 |
| Other qualifying setups | 213 | 106 | 66 | 30 | 9 | 2 |
| All qualifying setups | 235 | 116 | 75 | 32 | 10 | 2 |

Inside-pattern TP rate among the 19 clear closed setups: **52.63%**. The two pullback legs are counted separately below: **20 TP legs, 18 SL legs, 4 uncertain legs, 2 unfilled legs**. A setup is counted once in the main table, even if both legs fill.

## Definition and method

Entire T1/T2/T3 pattern and all intervening M15 candles fit within an earlier candle high/low including wicks; mother precedes the entire pattern; stop at any missing M15 candle. Inclusive edges with at least one strictly inside edge. Nearest enclosing mother recorded.

Current Scalp 1:1 functions: H4 structure and EMA20/50, H1 continuation/Far, volume decrease >=250, 10/25% pullback legs, original fixed exits, 75-minute entry expiry, 300-pip per-leg limit.

Chart simulations, not MT5 executions. OHLC ordering ambiguity and missing candles remain uncertain. No spread, commission, slippage or live operational/session restrictions applied. Trading code/settings unchanged.

The simulation uses the current two-leg strategy and its current 75-minute entry window. It does not reconstruct historical broker execution, rejected lot sizes, real spreads or the settings that were active on each past date. The full engulfing pattern must fit, not just its final candle body.

Validation: all 227 archived setups passing the 250-unit volume rule were reproduced, with 8 additional qualifying setups in the newer data. Independent full-range checks confirmed the 22 flagged patterns. Allowing containment across time gaps added no inside setups. Mother range detection also checked multi-bar containment, wick breaches, missing-candle isolation and full-pattern containment.

## Pattern types

| Type | Inside setups | TP | SL | Uncertain | No fill |
|---|---:|---:|---:|---:|---:|
| T1 | 17 | 7 | 8 | 1 | 1 |
| T2 | 4 | 3 | 0 | 1 | 0 |
| T3 | 1 | 0 | 1 | 0 | 0 |

## All inside setups

All times below are Nepal time. Signal time is the confirming M15 candle open.

| Engulfing candle | Side | Type | Mother candle | Mother high | Mother low | Outcome |
|---|---|---|---|---:|---:|---|
| 11 Aug 2026 22:15 | bullish | T3 | 11 Aug 2026 21:15 | 4387.100 | 4369.150 | sl |
| 24 Aug 2026 07:30 | bullish | T2 | 24 Aug 2026 06:00 | 4640.475 | 4594.515 | uncertain |
| 24 Aug 2026 15:30 | bullish | T2 | 24 Aug 2026 14:15 | 4646.300 | 4628.895 | tp |
| 11 Sep 2026 08:00 | bearish | T1 | 11 Sep 2026 07:15 | 4335.070 | 4322.610 | tp |
| 11 Sep 2026 13:00 | bearish | T2 | 11 Sep 2026 11:45 | 4361.150 | 4345.775 | tp |
| 11 Sep 2026 14:30 | bearish | T1 | 11 Sep 2026 14:00 | 4357.635 | 4343.645 | tp |
| 14 Sep 2026 14:00 | bearish | T1 | 14 Sep 2026 13:30 | 4322.240 | 4307.995 | tp |
| 29 Sep 2026 00:45 | bearish | T1 | 28 Sep 2026 22:45 | 4146.770 | 4126.215 | tp |
| 29 Sep 2026 01:15 | bearish | T1 | 28 Sep 2026 22:45 | 4146.770 | 4126.215 | not-filled |
| 29 Sep 2026 21:45 | bearish | T1 | 29 Sep 2026 21:00 | 4163.000 | 4148.420 | sl |
| 30 Sep 2026 16:15 | bearish | T1 | 30 Sep 2026 15:00 | 4191.020 | 4183.110 | sl |
| 02 Oct 2026 02:00 | bearish | T1 | 02 Oct 2026 00:15 | 4182.265 | 4171.665 | uncertain |
| 12 Oct 2026 20:30 | bearish | T1 | 12 Oct 2026 20:00 | 4170.320 | 4158.840 | sl |
| 17 Oct 2026 00:00 | bearish | T1 | 16 Oct 2026 23:15 | 4168.125 | 4158.505 | sl |
| 21 Oct 2026 20:45 | bearish | T1 | 21 Oct 2026 20:00 | 4135.365 | 4126.120 | sl |
| 22 Oct 2026 14:30 | bearish | T1 | 22 Oct 2026 14:00 | 4094.070 | 4081.885 | tp |
| 23 Oct 2026 13:30 | bearish | T1 | 23 Oct 2026 11:15 | 4028.560 | 4010.905 | sl |
| 29 Oct 2026 16:00 | bearish | T1 | 29 Oct 2026 14:45 | 4038.045 | 4022.680 | sl |
| 03 Nov 2026 07:15 | bearish | T1 | 03 Nov 2026 06:45 | 3961.165 | 3945.940 | tp |
| 11 Nov 2026 10:30 | bullish | T1 | 11 Nov 2026 07:15 | 4052.675 | 4036.165 | tp |
| 16 Nov 2026 08:30 | bearish | T2 | 16 Nov 2026 06:45 | 3889.475 | 3859.975 | tp |
| 16 Nov 2026 12:15 | bearish | T1 | 16 Nov 2026 11:30 | 3867.175 | 3832.460 | sl |

Evidence: [inside-mother-scalp-study-2026-11-18.json](inside-mother-scalp-study-2026-11-18.json), [inside-mother-scalp-study-2026-11-18.csv](inside-mother-scalp-study-2026-11-18.csv).

Trading rules and dashboard settings were not changed by this study.

Validation status: all 19 Scalp 1:1 tests passed, and an independent range/continuity/fixed-exit audit verified all 22 flagged setups. The repository-wide lock check reports existing uncommitted protected edits from earlier work (`mt5_bridge.py`, `OandaProChart.tsx`, and `tests/test_mt5_bridge.py`); this study did not edit those files. Gold, Forex, and Shared remain locked.
