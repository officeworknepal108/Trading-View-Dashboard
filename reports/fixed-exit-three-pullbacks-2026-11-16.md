# Three pullback entries with original fixed SL and TP

Illustrative $5,000 starting balance, fixed $50 total risk per setup, split equally by risk across 10%/25%/50% body pullback entries. Original exit prices are frozen. No compounding; gross before trading costs.

| Side | Original single-entry PnL | Exact three-entry PnL range | Cap-preserving PnL range |
|---|---:|---:|---:|
| all | +$2,150.00 | +$1,868.96 to +$2,010.77 | +$1,888.94 to +$2,003.68 |
| buy | -$150.00 | +$41.48 to +$87.35 | +$5.10 to +$23.90 |
| sell | +$2,300.00 | +$1,827.48 to +$1,923.42 | +$1,883.84 to +$1,979.78 |

## Monthly PnL by UTC exit date

| Month | Original | Exact lower | Exact upper | Cap-preserving lower | Cap-preserving upper |
|---|---:|---:|---:|---:|---:|
| 2026-08 | -$350.00 | -$133.67 | -$87.80 | -$137.76 | -$118.96 |
| 2026-09 | +$1,150.00 | +$1,050.60 | +$1,050.60 | +$1,059.55 | +$1,059.55 |
| 2026-10 | +$1,350.00 | +$925.05 | +$1,020.99 | +$939.12 | +$1,035.06 |
| 2026-11 | +$0.00 | +$26.98 | +$26.98 | +$28.03 | +$28.03 |

## Fill and outcome counts

| Variant / ordering | TP setups | SL setups | Unfilled | Filled legs | Uncertain setups | PnL | Ending illustrative balance |
|---|---:|---:|---:|---:|---:|---:|---:|
| exact_10_25_50 / worst | 121 | 79 | 27 | 476 | 5 | +$1,868.96 | $6,868.96 |
| exact_10_25_50 / best | 126 | 79 | 22 | 486 | 5 | +$2,010.77 | $7,010.77 |
| preserve_original_risk_cap / worst | 116 | 78 | 33 | 465 | 3 | +$1,888.94 | $6,888.94 |
| preserve_original_risk_cap / best | 119 | 78 | 30 | 471 | 3 | +$2,003.68 | $7,003.68 |

A TP setup may have only one or two filled entries. TP/SL counts are setup counts, not three full-size trades. Remaining legs are cancelled when the common target or stop is hit. Unfilled setups earn zero.

## Assumptions and validation

- **startingBalanceUSD:** 5000.0
- **fixedRiskUSDPerSetup:** 50.0
- **allocation:** One third of the $50 setup risk per leg; size each leg from its own entry-to-SL distance. No redistribution for unfilled/omitted legs.
- **entry:** Next M15 open minus 10%, 25%, 50% of final confirming candle body for BUY; plus for SELL. No immediate/open entry.
- **exits:** Exact original archived SL and TP frozen for every leg; individual entry reward/risk therefore varies.
- **expiry:** Pending legs expire at the end of the immediate next M15 candle, or earlier at the first common TP/SL touch. Filled legs remain until common SL/TP.
- **capVariants:** Primary exact levels do not apply the old maximum price-risk cap. Sensitivity clamps pending-entry setups to an entry no worse than the original capped entry. Both retain the same fixed-dollar risk budget.
- **intrabar:** Enumerates all continuous event orders consistent with next-bar OHLC, including partial fills before TP. Not restricted to two monotonic OHLC paths. Later double-touch bars branch to SL and TP. Dollar range is the sum of per-setup extremes, not a confidence interval or guaranteed realizable portfolio path.
- **costs:** Gross USD; no spread, commission, financing, lot rounding, slippage or gap execution loss. Planned fill and exit prices assumed.
- **portfolio:** No compounding, no simultaneous-position or shared-margin limits; independent setup risk can overlap. Starting balance is illustrative, not the actual account balance.
- **data:** 227 matched previously qualified setups, 46 buys/181 sells; Aug 3-Nov 11, 2026; completed OANDA M15 history through Nov 13. Existing filters inherited, not recomputed at changed entry prices; not a fresh signal scan.
- **validation:** Prior source SHA256 hashes verified; original 131TP/88SL/$2150 baseline asserted; synthetic event-order, partial-fill, expiry and stop checks passed; side and monthly PnL reconcile; each setup planned SL loss <=$50.
- **changes:** Research artifacts only. No dashboard source, live settings or broker orders changed.

The exact-level variant may exceed the existing maximum allowed price-distance risk; this is counted in JSON/CSV. The cap-preserving variant retains that restriction, potentially putting multiple legs at the same capped entry. Neither variant changes the account risk allowance.

The range reflects unresolved candle ordering. It is not a measured live profit or a statistically estimated future return. Dollar results scale linearly with the fixed risk budget in this cost-free model: halve all PnL for $25 risk; double it for $100 risk.

Reproduce: python reports/fixed-exit-three-pullbacks-2026-11-16.py
