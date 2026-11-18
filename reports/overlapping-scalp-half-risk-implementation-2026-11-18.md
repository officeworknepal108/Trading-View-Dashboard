# Half risk for overlapping Scalp 1:1 setups

New Scalp 1:1 setups receive half the account's selected Scalp risk when a separate earlier Scalp 1:1 setup has a broker-confirmed open Gold position. The check runs when the server queues the setup, against the fresh account heartbeat. Account, broker server, resolved contract, and position ticket/identifier must match.

The normal 10% and 25% pullback entries, original stop and target, and 75-minute entry window remain in place. The setup still splits its allowance 60% to the first entry and 40% to the second. For a normal $50 allowance, an overlapping setup receives $25, allocated $15/$10. Third and later overlapping setups also receive half of the normal allowance, without repeatedly halving it.

The server freezes the cash budget, multiplier, and earlier signal reference. The sibling reuses them even after the earlier trade closes or account equity/risk settings increase. Previously queued setups preserve their existing frozen allowances. Pending orders, unrelated strategies, another account/contract, and the other entry within the same setup do not trigger a new reduction. An earlier risk-free position still counts while it remains open.

Python sizing applies the frozen multiplier to current selected risk, then caps each entry at its frozen cash share. Equity or risk reductions can lower sizing further; increases cannot enlarge the frozen allowance. Broker lot rounding and existing minimum-volume and second-only fallback rules continue to apply. No open broker position or pending broker order is resized by this change.

Validation:

- 57 targeted TypeScript tests passed, covering open-position matching, account isolation, frozen sibling allocations and existing entry geometry.
- 135 Python bridge tests passed, including half-budget sizing, equity growth/decline, invalid multipliers, fallback and executable lot calculations.
- Isolated MT5 server integration passed, including preservation of reduced metadata on both claimed entries.
- TypeScript checking, production build, diff whitespace check and protected-file integrity check passed.
- Local dashboard and its two existing managed bridges restarted. Both connected, symbols resolved and market data fresh. Execution switches and selected risks preserved.

Verified selected risk at restart:

| Terminal | Normal Scalp risk | New overlapping setup risk |
|---|---:|---:|
| Primary | 0.75% | 0.375% |
| Secondary | 0.50% | 0.25% |

These percentages are total setup risk, before the 60/40 split. This implements the agreed exposure rule; it does not establish an optimal risk fraction or a measured portfolio drawdown improvement.
