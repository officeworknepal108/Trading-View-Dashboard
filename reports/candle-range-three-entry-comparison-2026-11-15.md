# Candle-range three-entry dollar comparison

Same archived 252 XAUUSD M15 setups. Starting capital $5,000; fixed risk up to $50 per setup; no compounding. Shared SL/TP prices from the 30-pip-buffer setup remain fixed.

New allocation: first entry immediately at the next candle open risks $25; second risks $15 at a 30% pullback of the confirmed final engulfing candle's high-to-low range; third risks $10 at a 40% total pullback. Offsets are measured from the first entry. SELL pullbacks are upward. Pending entries last until setup SL/TP; any proposed entry at or beyond SL is omitted. Each leg's quantity is sized using its own distance to SL.

| UTC exit month | Earlier single entry, 30-pip buffer | Earlier fixed 20/40-pip layers | New candle-range layers |
|---|---:|---:|---:|
| August 2026 | -$550.00 | -$526.35 | -$493.41 |
| September | +$1,250.00 | +$1,178.48 | +$1,258.46 |
| October | +$1,100.00 | +$992.98 | +$890.11 |
| November, partial | $0.00 | -$38.13 | -$56.76 |
| Total profit | +$1,800.00 | +$1,606.98 | +$1,598.40 |
| Ending balance | $6,800.00 | $6,606.98 | $6,598.40 |

Layered columns use the lower-profit modeled intrabar ordering for each setup. The new model has two uncertain setups: alternate ordering yields +$1,658.00 and an ending balance of $6,658.00. The prior fixed-distance model's corresponding range was +$1,606.98 to +$1,697.66. These are candle-ordering scenarios, not statistical confidence intervals. New setup outcomes are 148 TP and 104 SL; some TPs earn only the first allocation's profit. The earlier 20-pip-buffer single-entry result was +$1,550.

The new conservative PnL is $8.58 below the prior layered test and $201.60 below the 30-pip single-entry test. The alternate scenario is still $142 below the 30-pip single-entry result.

Limitations: matched archived setups, not a new full signal scan. The immediate-entry policy changes 29 first entries relative to the old risk-capped price; inherited H1 distance gates are not recomputed for those changed entries. The shared target is retained, so the first leg is not necessarily 1:1 when entry changes. Immediate entry also fills setups previously cancelled before their capped entry, so outcome coverage differs from the earlier single-entry totals. No spread, commission, financing, slippage, portfolio risk cap or overlap restrictions. Gaps pass through planned fill prices in this simulation. Only completed M15 candles are used. November is partial. No dashboard or live execution changes were made for this test.

Validation: synthetic checks cover the new 30%/40% offsets, $25/$15/$10 sizing, full and partial fills, mirrored SELL behavior and entries beyond SL. All 252 archived records pass offset, maximum-$50-loss and monthly-total checks.

Reproduce: `node reports/three-entry-dollar-comparison.mjs --candle-range`. Full setup/scenario evidence: `candle-range-three-entry-comparison-2026-11-15.json`.
