# Overlapping Scalp 1:1: 10% / 25% versus 20% / 40% entries

Paired comparison on 34 baseline overlapping setups, 3 August–18 November 2026 through 07:45 Nepal. All other trades retain existing settings in the proposed scope; their results are not included in this table.

| Measure | Current 10% / 25% | Proposed 20% / 40% |
|---|---:|---:|
| TP setups | 23 | 20 |
| SL setups | 9 | 9 |
| Unfilled setups | 2 | 5 |
| Uncertain setups | 0 | 0 |
| TP legs | 43 | 35 |
| SL legs | 18 | 18 |
| Gross R | 15.4906 to 15.4906 | 13.2184 to 13.2184 |

Candidate gross delta: -2.2723 to -2.2723R. 3 baseline winners become entirely unfilled. Improved setups: 15; worse: 8; unchanged: 11.

## Method and limits

- **scope:** Paired counterfactual on the same 34 baseline-identified overlapping later setups, including 2 originally unfilled setups. All 34 had a same-direction earlier trade open by the strict known-fill/known-exit rule. All other setups are outside this paired comparison.
- **entries:** Baseline 10%/25%, candidate 20% / 40% of later setup final confirmation body, measured from immediate next M15 open. Risk weights stay 60% first leg / 40% second; unused allocation is not transferred.
- **exits:** Original common stop and target remain fixed. 75-minute limit-entry window, cancellation at original exit, maximum entry-to-stop 30 price units. Outcome paths replayed with production scalpPullbackBarStates over continuous completed M15 candles.
- **accounting:** 1R is one fixed full-setup cash-risk allowance. Filled positions sized to their own entry-to-stop distance; TP earns risk share times actual entry-to-fixed-target RR, SL loses its risk share. No compounding, fees, spread, slippage, lot rounding, margin or daily risk restrictions.
- **selection:** Overlap membership is held fixed from the baseline study, not dynamically recomputed under the candidate. A complete conditional portfolio replay must check whether altered fill times change which future signals count as overlapping. Same-exit-bar timing and uncertain earlier trades were excluded from the original cohort.
- **uncertainty:** Enumerates OHLC-consistent paths; reports min/max gross R when fill order is ambiguous. No assumption that high or low happened first.
- **interpretation:** In-sample comparison selected after observing these data; not evidence of future or cost-adjusted profitability. Trading code/settings remain unchanged.

Hypothetical historical performance does not reflect actual executions; see [SEC investor bulletin](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins-47).

Validation: every baseline setup and leg outcome and entry price reproduced from archived evidence. Production path enumeration reused for both variants. Setup-level details in [CSV](overlapping-scalp-20-40-comparison-2026-11-18.csv) and [JSON](overlapping-scalp-20-40-comparison-2026-11-18.json).

## Higher-RR and cash-profit audit

Each TP leg uses its actual entry-to-target distance divided by entry-to-stop distance. Deeper entries therefore earn a higher RR when filled; position size increases to keep that leg's allocated dollar risk constant. No winning leg is assigned a flat 1R.

Fixed $50 total setup risk ($30 first entry, $20 second), no costs or compounding:

| Group | Setups | Current gross PnL | Proposed gross PnL | Difference |
|---|---:|---:|---:|---:|
| Both proposed entries filled and won | 15 | $851.38 | $939.28 | $87.90 |
| Only proposed 20% entry filled and won | 5 | $274.89 | $171.64 | $-103.24 |
| Original winner entirely missed | 3 | $98.27 | $0.00 | $-98.27 |
| Both variants stopped out | 9 | $-450.00 | $-450.00 | $0.00 |
| Both variants unfilled | 2 | $0.00 | $0.00 | $0.00 |

Example: 22 October 2026 14:30 Nepal SELL. Same stop 4097.02, target 4069.26.

| Variant | Pullback | Entry | Actual RR | Allocated risk | TP profit |
|---|---:|---:|---:|---:|---:|
| baseline | 10% | 4084.09050 | 1:1.1470 | $30.00 | $34.41 |
| baseline | 25% | 4085.51625 | 1:1.4131 | $20.00 | $28.26 |
| candidate | 20% | 4085.04100 | 1:1.3174 | $30.00 | $39.52 |
| candidate | 40% | 4086.94200 | 1:1.7545 | $20.00 | $35.09 |

Overall gross PnL at $50 setup risk: $774.53 versus $660.92. Change: $-113.61 using unrounded values. Rounded component amounts can differ by one cent when added.
