# M5 Bollinger study ? one entry, fixed 1:1.5

**Research evidence and proposed dashboard study. No trading code or live configuration has been changed.**

## Frozen reference setup

- Instrument XAUUSD; timeframe M5; strategy Bollinger reversal.
- Bollinger period 20, standard-deviation multiplier 2.
- Confirmation filters: EMA, SuperTrend and ADX >=15.
- SuperTrend ATR period 10, multiplier 3; ADX period 14.
- Source EMA-related defaults are 9/21/200; exact source EMA acceptance logic is not verified.
- Preserve the source enabled H4 structure bias (swing length 3). Its causal implementation is not verified.
- One entry per accepted signal; fixed TP at 1.5 initial risk; minRR 0. No engulfing confirmation filter, partial entries, extra volume threshold or two-entry layering was selected.
- Source description: close outside a Bollinger Band, followed by a close back inside in the trade direction; require selected filters. Source stop description is beyond the two pattern candles; full underlying stop/entry helpers are not available.
- The frozen JSON combines recorded global indicator defaults with the selected overrides. It does not incorrectly reuse the global engulfing filter, ADX 20 or fixed 2R defaults.

This is a frozen selected configuration. Do not infer that a newly implemented local EMA/H4/stop rule exactly reproduces the reference result. The proposed native replay definition is documented separately.

## Reference results

| Measure | Recorded result |
|---|---:|
| Source history | 20,000 M5 bars, July 10?October 26, 2026 |
| Completed entries | 34 |
| TP / SL | 23 / 11 |
| Winning / losing entries | 67.6% / 32.4% |
| Net result after assumed 0.30 price-unit costs | +21.25R |
| Profit factor | 2.81 |
| Closed-trade max drawdown | 2.86R |
| Longest losing run | 2 |
| Median / maximum holding time | 15 / 130 minutes |
| Earlier / later half of source history | +8.29R / +12.96R |

At fixed $50 risk and illustrative $5,000 initial capital: **+$1,062.50**, **+21.25%**, ending **$6,062.50**, with historical closed-trade drawdown **$143**. These are additive-R conversions without compounding, executable-lot or margin adjustments. Costs are assumed, not observed actual account charges.
$50 initially risks a $75 gross target; net winners and losers differ once costs are deducted. Reference trade returns are rounded by the source.

## Monthly results

Grouped by recorded exit month; July and October are partial source-history months. Clock epochs are retained as supplied. The source UI labels its chart as MT5 broker time; no unverified conversion to Nepal or true UTC is implied by the ledger.

| Month | Entries | TP | SL | Win rate | Net R | Dollars at $50 risk | % of initial $5,000 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-07 | 6 | 2 | 4 | 33.3% | -1.46 | $-73.00 | -1.46% |
| 2026-08 | 10 | 7 | 3 | 70.0% | +6.88 | $+344.00 | +6.88% |
| 2026-09 | 13 | 9 | 4 | 69.2% | +8.65 | $+432.50 | +8.65% |
| 2026-10 | 5 | 5 | 0 | 100.0% | +7.18 | $+359.00 | +7.18% |

## Direction audit

| Side | Entries | TP | SL | Win rate | Net R |
|---|---:|---:|---:|---:|---:|
| BUY | 15 | 7 | 8 | 46.7% | +1.47 |
| SELL | 19 | 16 | 3 | 84.2% | +19.78 |

Profit is concentrated in sells. Selecting sell-only after observing these outcomes adds further selection bias; its 16/19 result is not an independently validated 84.2% strategy.

## Cost and recent-period checks

| Test | Trades | Win rate | Net R | PF | Max DD |
|---|---:|---:|---:|---:|---:|
| Full history, cost 0.30 | 34 | 67.6% | +21.25 | 2.81 | 2.86R |
| Full history, cost 1.00 | 34 | 67.6% | +15.98 | 2.19 | 3.74R |
| Last 90 stored-data days, cost 0.30 | 32 | 68.8% | +20.92 | 2.96 | 2.13R |
| Last 30 stored-data days, cost 0.30 | 7 | 100% | +10.02 | No losses | 0R |

The recent 30-day test has only seven trades. Its seven wins are not an expected 100% live win rate. The source feed is offline and these windows end in its stored October history, not November.

## Separate broker-based fixed-cohort estimate

Replayed the same 34 source signals on the connected broker?s historical prices, with next-open execution, bid/ask, assumed commission/slippage, 0.01-tick pricing and 0.01-lot minimum/step. Source close differences were median0.05 and maximum0.17 gold-price units. M1 paths were used for 22 signals and native M5 candles for 12. The result is a different execution estimate, not a new reproduction of the original source indicator logic.

| Measure | Broker-cohort estimate |
|---|---:|
| TP / SL | 22 / 12 |
| Win rate | 64.7% |
| Estimated net with maximum $50 allowance, rounded lot sizing | +$916.53 |

This estimate holds the original accepted signal cohort fixed. It does not regenerate signals previously skipped by the source, prove causality of its H4 bias or reproduce live broker operations. It is separate from the original +$1,062.50 calculation. No two-entry result is included in this study.

## Evidence limits and implementation status

The observed 23/34 win rate has an approximate 95% Wilson interval of 50.8%?80.9% even before accounting for correlated regimes and strategy selection. It does not establish 70?80% accuracy. The source configuration was selected after testing many variants on reused history. Roughly two to three entries per week does not meet the desired several entries per day.

The exact source entry, EMA gate, H4 bias and intrabar-fill ordering are unverified. A new native dashboard engine must publish its own results and assumptions instead of assigning itself the old 67.6% value. Source and broker time conventions need explicit handling.

The chart-study proposal is in the accompanying dashboard specification. Source integration requires OandaProChart.tsx, owned by gold/forex/shared; all three sections were LOCKED at the initial check. Report/JSON/CSV files under reports have no owners in the current manifest. No alternate trading path or protected-file edit was created.

## Verification

Reconciled all 34 source entries, 23 TP and 11 SL, positive stop distances, 1.5 gross RR, target/stop endpoint prices, rounded net-R sum, closed-trade drawdown and longest losing run. Preserved all trades and both directions. Source snapshot SHA256 is in JSON. No password, access key or account identifiers are stored in these artifacts.
