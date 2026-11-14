# Three-entry matched-setup dollar comparison

Starting capital: $5,000. Fixed maximum risk per setup: $50, with no compounding. Same archived 252 M15 XAUUSD setups used in the earlier H4 bias, H4 EMA alignment and H1 continuation/Far research. This is a matched-setup experiment, not a fresh full scan.

The new experiment enters at the next candle open with $25 risk. Additional entries are 20 and 40 pips against that first entry, with $12.50 risk each. SELL entries mirror BUY entries. Each position is sized using its own distance to the shared SL. SL and TP prices are retained from the archived 30-pip setup. Pending entries remain until SL or TP, and any entry at or beyond SL is omitted. These are explicit assumptions because the clarification choices were not answered.

Always entering immediately changes the first entry from the old risk-capped planned price on 29 setups. It also fills setups previously cancelled before their capped entry. The old setup target is retained, so the first leg is not necessarily 1:1 when its entry changes. H1 distance qualification is inherited from the archived setup and is not reselected at the changed entry price. Results must not be described as a full implementation backtest of a newly scanned strategy.

| UTC exit month | Earlier 20-pip single entry | Earlier 30-pip single entry | Three-entry conservative | Three-entry alternate ordering |
|---|---:|---:|---:|---:|
| August 2026 | -$500.00 | -$550.00 | -$526.35 | -$509.74 |
| September | +$1,100.00 | +$1,250.00 | +$1,178.48 | +$1,215.38 |
| October | +$1,050.00 | +$1,100.00 | +$992.98 | +$1,030.15 |
| November, partial | -$100.00 | $0.00 | -$38.13 | -$38.13 |
| Total PnL | +$1,550.00 | +$1,800.00 | +$1,606.98 | +$1,697.66 |
| Ending balance | $6,550.00 | $6,800.00 | $6,606.98 | $6,697.66 |

The three-entry model has 148 TP setups and 104 SL setups, all resolved in this matched sample. Four setups have different profit depending on the order of intrabar fills. Both open-high-low-close and open-low-high-close paths are simulated; the table shows the lower and higher trade-level PnL totals across those paths. This range reflects modeled candle ordering uncertainty, not a confidence interval or a prediction. Earlier single-entry results exclude non-TP/SL outcomes, so outcome coverage differs.

Versus the earlier 30-pip single-entry result, the new model earns $102.34 to $193.02 less. Some winners close before all layers fill; losses can fill all layers. The test does not support claiming improved profit from layering.

Closed M15 history only, exit-candle months in UTC. No spread, commission, financing, slippage, aggregate portfolio risk cap or overlapping-position restrictions are included. Gaps are simulated through planned price levels and do not establish executable fills. Unfilled risk allocations are not charged as losses. No three-entry live automation or dashboard entry policy was changed by this experiment.

Reproduce with `node reports/three-entry-dollar-comparison.mjs`. The script verifies sizing, both directions, partial fills, invalid layers, and uncertain ordering. Full setup evidence is in `three-entry-dollar-comparison-2026-11-15.json`.
