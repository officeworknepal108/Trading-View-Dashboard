# Two-entry fixed-exit comparison

$5,000 illustrative starting balance. $50 fixed setup risk: $25 per entry. Same original SL and TP. 227 matched archived setups, August 3-November 11, 2026. Gross PnL, no compounding.

Original single entry: +$2,150.00, 43.00% return; 131 TP / 88 SL / 8 unfilled, 59.82% completed-setup win rate.

## exact

| Entry pair | All-trade PnL | Return on $5,000 | Completed setup win rate | Buy PnL | Sell PnL | Original sells + layered buys |
|---|---:|---:|---:|---:|---:|---:|
| 10/25% | +$2,198.87 to +$2,381.05 | 43.98% to 47.62% | 60.50% to 61.46% | +$5.17 to +$73.98 | +$2,193.69 to +$2,307.08 | +$2,305.17 to +$2,373.98 |
| 10/50% | +$1,783.51 to +$1,914.10 | 35.67% to 38.28% | 60.50% to 61.46% | +$58.71 to +$105.13 | +$1,724.80 to +$1,808.97 | +$2,358.71 to +$2,405.13 |
| 25/50% | +$1,624.50 to +$1,737.15 | 32.49% to 34.74% | 57.76% to 58.79% | +$60.56 to +$82.94 | +$1,563.94 to +$1,654.21 | +$2,360.56 to +$2,382.94 |
## cap_preserved

| Entry pair | All-trade PnL | Return on $5,000 | Completed setup win rate | Buy PnL | Sell PnL | Original sells + layered buys |
|---|---:|---:|---:|---:|---:|---:|
| 10/25% | +$2,226.79 to +$2,368.37 | 44.54% to 47.37% | 59.79% to 60.41% | -$36.42 to -$8.22 | +$2,263.21 to +$2,376.59 | +$2,263.58 to +$2,291.78 |
| 10/50% | +$1,796.04 to +$1,908.41 | 35.92% to 38.17% | 59.79% to 60.41% | +$22.76 to +$50.96 | +$1,773.28 to +$1,857.45 | +$2,322.76 to +$2,350.96 |
| 25/50% | +$1,643.98 to +$1,734.25 | 32.88% to 34.69% | 57.32% to 57.86% | +$28.95 to +$28.95 | +$1,615.03 to +$1,705.30 | +$2,328.95 to +$2,328.95 |

## Assumptions and validation

- **startingBalanceUSD:** 5000.0
- **fixedRiskUSDPerSetup:** 50.0
- **allocation:** Two entries; $25 planned risk per entry, $50 total setup risk. No reallocation when an entry misses.
- **entry:** Test pairs: 10%/25%, 10%/50%, 25%/50% of confirming candle body from next M15 open. BUY below open, SELL above.
- **exits:** Exact original archived SL and TP frozen for every leg; individual entry reward/risk therefore varies.
- **expiry:** Pending legs expire at the end of the immediate next M15 candle, or earlier at the first common TP/SL touch. Filled legs remain until common SL/TP.
- **capVariants:** Primary exact levels do not apply the old maximum price-risk cap. Sensitivity clamps pending-entry setups to an entry no worse than the original capped entry. Both retain the same fixed-dollar risk budget.
- **intrabar:** Enumerates all continuous event orders consistent with next-bar OHLC, including partial fills before TP. Not restricted to two monotonic OHLC paths. Later double-touch bars branch to SL and TP. Dollar range is the sum of per-setup extremes, not a confidence interval or guaranteed realizable portfolio path.
- **costs:** Gross USD; no spread, commission, financing, lot rounding, slippage or gap execution loss. Planned fill and exit prices assumed.
- **portfolio:** No compounding, no simultaneous-position or shared-margin limits; independent setup risk can overlap. Starting balance is illustrative, not the actual account balance.
- **data:** 227 matched previously qualified setups, 46 buys/181 sells; Aug 3-Nov 11, 2026; completed OANDA M15 history through Nov 13. Existing filters inherited, not recomputed at changed entry prices; not a fresh signal scan.
- **validation:** Generalized equal-risk engine reproduces saved 3-entry PnL bounds and counts exactly for both cap policies. All 2-entry legs risk $25, total planned loss <=$50; side and monthly totals reconcile.
- **changes:** Research artifacts only. No dashboard source, live settings or broker orders changed.
- **comparison:** Same 227 archived setups and frozen SL/TP as prior three-entry study; same next-candle-only fill window and TP/SL cancellation. Exact and cap-preserving results separate.
- **selection:** Three pair candidates examined retrospectively. Best observed combination is exploratory, not independent validation. Hybrid buys/sells selected after inspecting outcomes.
- **engineSHA256:** 637e00967b3b99026c0e61ec69d91855e1ec834d538a7cc39cb95626781820d6

Dollar bounds reflect unknown intrabar event ordering, not statistical confidence intervals. Setup win rate excludes unfilled orders. Partial-fill winners do not necessarily use the full $50 risk budget. Exact pairs may breach the existing stop-distance cap; cap-preserved prices are clamped to the old capped entry and can coincide.

No live trading rules, dashboard source or settings were changed. Fresh-data testing with spread, commissions, slippage, overlapping-position limits and lot rounding is needed before applying an exploratory winner.

Reproduce: python reports/fixed-exit-two-pullbacks-2026-11-16.py
