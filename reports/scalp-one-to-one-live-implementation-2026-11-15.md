# Scalp 1:1 live app integration

Implemented a third strategy alongside Scalping and Intraday in the existing bridge panel. Scalp 1:1 has an independent enable switch and risk dropdown: 0.25%, 0.5%, 0.75%, 1%, 1.5%, 2%. New installations/older saved configurations default to OFF and 0.25%. Its risk uses the selected MT5 account's current equity, never half the general bridge selection. Each bridge account saves its own Scalp 1:1 risk; strategy visibility follows the existing shared-switch model.

## Entry and exit rules

The live adapter uses the existing volume-engulfing study runner with M15 entries, H4 structure bias, closed H4 EMA20/50 agreement and confirmed H1 continuation/Far. T1/T2/T3 must pass the original volume rules. M15 SL buffer is 30 pips beyond the pattern wick; entry retains the existing immediate/capped pending calculation. Target remains 1:1 from the planned entry and SL. Each setup has one entry and a distinct SCALP_1_1 identity.

There are no three-entry allocations, opposite-engulfing exits, half-at-1R closes or opposing-Fib exits for this style. An unfilled pending order cancels if the original 1R target is reached before entry. Switching the strategy off cancels its still-unfilled orders while filled positions retain their original SL/TP. Distinct IDs prevent older intraday/scalping routes from consuming this strategy's setup or merging journal entries and alert identities.

The existing common bridge controls still apply: account binding, master auto-trading and send-to-MT5 switches, freshness, selected entry timeframes, daily loss allowance, spread and executable-price risk checks, open-position limits, opposite-position safety, trading sessions when enabled, news pauses, broker contract/volume rules and pending expiry. Existing styles keep their own strategy rules and general risk selection. These operational restrictions and live costs mean the historical independent-setup result is not a guarantee of live trade counts or PnL.

## Existing zone table

On the M15 gold chart, rows appear in the existing Zone / Type / Price range / Engulf / Tap–Trade table, labelled SCALP 1:1 · M15. Entry, SL, TP and 1:1 details appear immediately below. Actual server/broker signals display their MT5 state. Chart-only confirmations are explicitly labelled CHART ONLY rather than shown as broker fills. Chart calculations run in a worker. Saved trade style filters and journal performance support the separate style and full-position 1R accounting.

## Validation and runtime

- Full TypeScript test suite: 487 tests passed, followed by 11 passing targeted checks including an additional regression for separate strategy identity.
- Python bridge: 100 tests passed, including independent risk sizing and live risk checks, fixed-target exit isolation, 1R pending cancellation and disabling unfilled orders.
- Isolated server/API integration verified risk persistence, invalid selection handling, independent percentages for the two bridge accounts, and unchanged general bridge risk.
- Live adapter reproduced entry, stop, target, risk distance and RR for T1/T2/T3 in both directions from the saved historical setup set. All six stale confirmations were rejected. Evidence: scalp-one-to-one-live-adapter-parity-2026-11-15.json.
- TypeScript check, production build, git diff whitespace check and authorization lock check passed. Build includes scalpOneToOne.worker.
- Reloaded the local dashboard on port 3002 and its two managed bridges. Read-only API checks confirmed both bridges connected, existing master/send-to-MT5 settings preserved, new strategy OFF and its risk 0.25%. The served app includes the independent selector, zone rows and worker.

To use: refresh the dashboard, open the bridge panel, select Scalp 1:1 risk per trade and enable Scalp 1:1. M15 must be allowed for execution. No live test order was submitted and no new strategy was enabled during implementation. Existing configuration and account selections were retained. All three source authorization sections are relocked after completion; no commit was created.
