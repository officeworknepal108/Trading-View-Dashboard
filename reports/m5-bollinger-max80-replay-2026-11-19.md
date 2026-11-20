# Native Bollinger M5 replay

M5 BB20/2 re-entry, EMA200, SuperTrend ATR10/3, ADX14 >=15, confirmed H4 swing(3) break bias. One next-open entry, two-candle stop +0.2 ATR14 (minimum 1 ATR, maximum 80 pips; wider setups skipped), fixed 1.5R target. No engulfing, volume, partial close or breakeven.

Period: 2026-07-10 to 2026-10-27 (exclusive), feed epochs.

| Trades | TP | SL | Open | Uncertain | Win rate | Realized P&L | Capital return | Net R | Cash drawdown |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 26 | 14 | 12 | 0 | 0 | 53.8% | $395.62 | 7.91% | 8.60R | $125.68 |

| Exit month | TP | SL | Open | Uncertain | Win rate | Realized P&L | Capital return |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-07 | 1 | 3 | 0 | 0 | 25.0% | -$73.30 | -1.47% |
| 2026-08 | 6 | 3 | 0 | 0 | 66.7% | $269.18 | 5.38% |
| 2026-09 | 5 | 3 | 0 | 0 | 62.5% | $202.75 | 4.06% |
| 2026-10 | 2 | 3 | 0 | 0 | 40.0% | -$3.01 | -0.06% |

- Independent native replay, not a reproduction of the earlier 34-trade source-dashboard result.
- Frozen rules; no search or parameter optimization in this script. Not an independent out-of-sample validation.
- H4 bars are aggregated from 16 contiguous M15 bars on 14400-second epoch boundaries. Broker H4 chart boundaries may differ.
- Input timestamps are retained as supplied. ISO dates are epoch representations, not a verified broker timezone conversion.
- Study assumes mid-price candles, constant 0.30 price-unit spread, $7 round-trip commission per lot, contract 100, minimum/step 0.01 lot.
- MT5 bars may be bid-based. The mid-price assumption is a modelling limitation, not a verified bid/ask replay.
- Risk allowance $50 per entry, initial capital $5000, no compounding, no slippage. Lots rounded down including commission in the allowance.
- Uncertain/open trades do not contribute to realized P&L or win rate. Unknown exits can make realized totals incomplete.
- No live orders, account updates, Telegram messages or production data writes are performed.
