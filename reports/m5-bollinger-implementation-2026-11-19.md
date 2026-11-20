# Bollinger M5 implementation

Implemented as a separate XAUUSD strategy (`BOLLINGER_M5`) alongside Scalping, Intraday and Scalp 1:1.

- Each existing account bridge has its own Bollinger enable switch and risk selection. A separate MT5 terminal process is not created for a strategy inside an account. Default OFF and 0.25%; existing account settings are preserved.
- One market entry, fixed original SL and 1.5R TP. No engulfing or volume filter, second entry, partial close, breakeven or opposing-Fib exit. Broker tick rounding is recorded; a live quote outside a 0.05R tolerance from the planned 1.5R is rejected. Slippage can still change realized R.
- Maximum SL is now **80 pips** (8.00 XAUUSD price units). Wider setups are skipped, preserving the original stop rule. Both signal validation and the MT5 bridge enforce the cap; the bridge checks the executable quote against the rounded broker SL. Existing positions keep their exits. Market slippage can still affect actual fill distance.
- Server scanner and chart Study use the same causal rule engine. H4 swing(3) pivots need all right-side bars closed, then a closing-price break sets bias. Only closed H4 data available at M5 confirmation can qualify it.
- Server-generated qualification is required. Browser-submitted Bollinger signals are rejected. Existing account binding, timeframe, daily-risk, spread, freshness, news and maximum-open-position checks remain in force. One Bollinger position/order per account.
- A netting account cannot open Bollinger into an existing position on the same symbol, since that would merge strategies and their exits. A hedging account can retain independent tickets, subject to the existing account limits.
- Accuracy and journal have a Bollinger strategy filter and separate chart-study/MT5 labels. Chart history is zero-spread/fee simulation; the Study provides explicit cost-adjusted cash results. MT5 journal rows use actual execution prices, rounded exits and broker cash results. Study dollars are not broker profits.
- The independent Study supports a date range, paginated M5/H4 history, worker progress/cancellation, historical entry arrows, clickable entry/SL/TP drawings on M5, TP/SL/open/uncertain counts, win/loss percentages, dollars, return %, R, drawdown, monthly and side breakdowns, and CSV with saved settings.
- An OHLC candle touching both exits is uncertain. Missing entry bars are skipped; history gaps during an open trade remain uncertain and reserve occupancy until an exit boundary is observed. Open/uncertain trades do not inflate realized win rate or P&L.

## Use

Open **Indicators → Backtesting → Bollinger M5 Study**. Keep **Saved broker history**, select **3½ months (105 days)**, set the starting balance/risk allowance and press **Run Study**. Backtesting also contains **Trendline Study** and **Volume Engulfing Study**. Choosing a study closes the menus and shows one panel. Settings and completed results are retained while switching between studies; normal symbol-change and replay-rewind safeguards still apply. Hidden Trendline/Volume panels stop their chart-paint loops. The separate dashboard toolbar shortcut remains removed. Monthly results and Trades have separate views. Selecting a trade opens a study-only candle preview; **Show on 5m chart** switches the main chart automatically. Old trades remain inspectable in the private preview even when the main chart lacks those dates. Advanced settings and detailed rules are collapsed.

The Study works while Auto Trading and Bollinger execution are OFF. Account settings expose the separate **Bollinger M5** enable/risk controls. Accuracy and Journal strategy checkboxes include **Bollinger M5**.

The saved dataset contains **40,000 M5 candles, April 30–November 19, 2026**, plus 2,167 H4 context candles derived from the matching M15 snapshot. It is a frozen historical dataset. The default 105-day period is **August 7–November 19**, ending at the snapshot's supplied 10:15 timestamp. It contains **20,505 completed M5 candles in the selected range**, with 19,494 earlier M5 candles retained for indicator context. The final potentially forming export candle is not counted as closed.

The snapshot is a lazy-loaded market-price asset with no accounts, balances, orders or credentials. It is packaged in the production build, so long-period studies do not depend on the recent price feed or require a new server endpoint. Source dataset IDs, selected dates and candle counts are included in CSV exports. Custom dates such as **July 10–October 26** are supported; that range reproduces the earlier native 26-trade replay.

The optional **Recent OANDA prices** source defaults to seven days. Its available M5 history was checked on November 19 and did not cover a full 30-day request; its explicit available-period alternative began October 28. Saved and recent price sources remain separate. These loading checks are not trading-performance claims.

Unsupported recent-feed ranges offer **Run available dates** with an explicit new start/end and 500 earlier candles reserved for context. Saved-history requests outside its available dates fail explicitly. No requested period is silently shortened. Stalled loads have a 60-second client deadline; users can cancel and retry. Calculation failure also has a deadline. Existing chart/live trading inputs are not replaced by Study data.

To update the frozen asset after obtaining matching Gold M5/M15 exports, unlock Gold and run `npx tsx scripts/import-bollinger-history.ts M5.json M15.json`, then rebuild normally. The importer checks symbol/timeframe consistency, removes non-price account metadata and conservatively excludes an unconfirmed final candle. H4 is aggregated from complete 16-bar M15 groups on epoch boundaries. Broker H4 boundaries and bid/mid conventions remain documented modelling assumptions.

The source and production build are prepared. Loading backend and Python bridge changes into an already running installation requires its normal application/bridge restart; no production process restart or live order was performed during implementation.

## New native replay

The native rules are explicit independent definitions because the friend's EMA, stop and H4 helper implementations were not verified. Do not advertise the earlier external 67.6% as the native strategy's accuracy.

The saved broker-history replay for July 10 through October 26 produced **26 trades: 14 TP, 12 SL, 53.85% wins / 46.15% losses, +$395.62 (+7.91%)** on an illustrative $5,000 with a $50 maximum entry allowance, modeled spread/fees and rounded lots. This does not meet the requested 70–80% or 3–4 trades/day objectives. Keep it a research/demo candidate.

The 80-pip-cap replay is saved separately as `m5-bollinger-max80-replay-2026-11-19.md`, JSON and CSV. All 26 original trade records are unchanged; their largest stop is 73.308 pips. Buy/sell tests cover 79.9, 80 and 80.01 pips, wider-pattern rejection and an executable quote crossing the cap. The cap update passed 48 relevant TypeScript tests and all 140 Python bridge tests.

See `m5-bollinger-native-replay-2026-11-19.md`, JSON and trade CSV for monthly figures, source hashes and execution assumptions. H4 was aggregated from contiguous M15 bars on epoch boundaries; broker H4 boundaries and bid/mid candle conventions need verification. This is neither tick-level validation nor an independent out-of-sample test.

Re-run the frozen rules without optimization:

```text
npx tsx scripts/study-bollinger-m5.ts M5.json M15.json output-prefix 2026-07-10 2026-10-27
```

Inputs contain a `bars` array of OHLC candle objects with epoch-second opening timestamps. End date is exclusive. The replay command writes reports only and has no trading API calls.

## Verification

Engine tests cover warmup, population deviation, EMA/Wilder calculations, causal H4 pivots, buy/sell entries, next-open execution, immutable exits, bid/ask costs, fees, lot rounding, gaps, uncertain candles, monthly reconciliation and independent risk/defaults. Server integration checks account isolation, persistence and forged-signal rejection. Python bridge tests use mocked MT5 operations. An isolated headless browser checks all 48 strategy-checkbox combinations, new account defaults, Study history/worker results and clickable trade rows. Test browser data are synthetic and are not performance evidence.

New source, worker, study component, replay command and engine tests are included in the existing local authorization locks. No lock mechanism was weakened.

The long-history update passed all 641 TypeScript regression tests, type checking and production build. The browser verified Indicators-only access, the real saved 40,000-bar asset, the complete 105-day/20,505-candle run while the recent feed was unavailable, monthly results, pagination, older-trade previews, automatic chart switching, recent-feed history alternatives, timeouts, cancellation and retry. The long-period data are the saved real broker snapshot; surrounding live-chart fixtures in browser tests remain synthetic. A separate test reproduces the frozen native July–October result, without inserting any historical profit totals into the engine.
