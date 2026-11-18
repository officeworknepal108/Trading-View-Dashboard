# Keep versus skip inside-mother Scalp setups

Period: 3 August?18 November 2026, through 07:45 Nepal time.

Fixed full-setup cash allowance, 60% to P10 and 40% to P25; each leg uses its actual entry-to-fixed-TP RR. Sum only unambiguous closed legs. Pending, open, uncertain and unfilled legs add no realized PnL. No compounding, fees, spread or slippage; no account balance assumed.

| Measure | Keep all | Skip inside-mother setups |
|---|---:|---:|
| Qualifying setups | 235 | 213 |
| Clear TP / SL setups | 116 / 75 | 106 / 66 |
| Win rate on clear closed setups | 60.73% | 61.63% |
| Confirmed gross R | 45.8347R | 43.2770R |
| Gross profit at fixed $50 full-setup risk | $2291.74 | $2163.85 |
| Gross profit at fixed $100 full-setup risk | $4583.47 | $4327.70 |

Skipping raises the measured win rate by 0.89 percentage points, while reducing confirmed gross profit by 5.58%. At $50 full-setup risk, the reduction is $127.89; at $100 it is $255.78.

The 22 removed setups include 10 TP, 9 SL, 2 uncertain and 1 unfilled. Uncertain outcomes remain excluded from the profit totals; exclusion does not mean they have zero economic value. A broad sensitivity bound for the two uncertain inside setups is -2R to +1.7100R in addition to the known +2.5578R. Actual costs can change the comparison.

Interpretation: this sample does not support a blanket exclusion for improving total gross profit. Retain the existing rule for now and validate a proposed skip rule on new demo/replay data with transaction costs before changing live automation. No live trading rules were modified.

Backtests are hypothetical, as described in the [SEC investor bulletin on performance claims](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-47).
