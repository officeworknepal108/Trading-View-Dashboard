# Pending trend validation and overlapping setup tests

No opposite-engulfing exits. Every filled position retains its original SL and TP. Same archived 252 XAUUSD M15 setups with H4 structure bias, H4 EMA alignment, H1 continuation/Far and 30-pip study buffer. Fixed $50 risk per setup; $5,000 starting balance; no compounding or costs.

Test 1: while an existing capped order is unfilled, revalidate H4 structure and EMA alignment at each M15 open. Only already closed H4 bars count. Cancel an order if either check fails. Do not close an already filled position. Result: no change to any setup. There are 29 pending-at-creation setups, and most fill in the submission candle or cancel without a fill; H4 alignment does not reverse during the relevant waits.

Test 2: reserve one setup slot from order submission until its exit/cancellation candle closes. Ignore additional setups while occupied. Test one slot per direction and one overall; both produce the same accepted set in this sample. Decisions use order occupancy, not the future profit of a signal; no existing trade is closed to admit another. A new order may be admitted at the first M15 open after the older order's resolution candle. Results exclude ambiguous orders from TP/SL accuracy as before.

| Method | Setups | TP | SL | Other | Win rate | Profit | Ending balance |
|---|---:|---:|---:|---:|---:|---:|---:|
| Current single entry per setup | 252 | 140 | 104 | 8 | 57.38% | +$1,800 | $6,800 |
| Recheck H4 support while pending | 252 | 140 | 104 | 8 | 57.38% | +$1,800 | $6,800 |
| One outstanding setup per direction | 192 | 101 | 83 | 8 | 54.89% | +$900 | $5,900 |
| One outstanding setup overall | 192 | 101 | 83 | 8 | 54.89% | +$900 | $5,900 |

| UTC exit month | Current / pending recheck | One outstanding setup |
|---|---:|---:|
| August 2026 | -$550 | -$400 |
| September | +$1,250 | +$850 |
| October | +$1,100 | +$600 |
| November, partial | $0 | -$150 |

Overlap restrictions skip 39 eventual TP and 21 eventual SL. They reduce aggregate exposure but do not improve profit or win rate. Earlier August–September signal-cohort profit falls from $700 to $450; later October–November falls from $1,100 to $450. Those cohorts are reused historical data, not independent validation.

Neither rule is applied to the dashboard or execution. The current 30-pip study configuration remains. No further improvement was demonstrated by these tests.

Validation: all 252 baseline setups reproduce the original outcome, fill time and resolution time using the existing simulator. Closed H4 snapshots are cached by their latest available close. Research files are outside the protected source manifest. Lock check still flags earlier uncommitted protected modifications in OandaProChart.tsx, tradeLevels.ts and trendlineStudy.ts; these were not edited for this experiment.

Limits: matched archived setup set; no new full scan, spread, fees, slippage, financing, portfolio risk cap or costs of overlapping positions. Win rate uses TP/(TP+SL). Repeated testing does not establish future performance.

Reproduce with `npx tsx reports/pending-trend-and-overlap-research.ts`; full records and skipped setup evidence are in `pending-trend-and-overlap-research-2026-11-15.json`.
