# Scalp 1:1 two pullback entries

New Scalp 1:1 confirmations now produce two limit orders, measured from the next M15 open using the final confirmed engulfing candle's body. BUY levels subtract 10% and 25% of that body; SELL levels add those amounts. The first entry receives 60% of the selected setup risk and the second 40%. A $50 total allowance therefore allocates $30 and $20. Existing account risk selections and strategy switches are preserved.

The original entry calculation establishes and freezes the common SL and 1:1 reference TP. Neither exit moves when a pullback order fills. Each entry's actual reward/risk is calculated from its own entry to those fixed exits. The original maximum stop-distance rule remains in force: prices cannot be worse than the original capped entry, so the two limits may coincide while keeping distinct identities and allocations.

The server freezes one full-setup cash budget against the connected account equity. Both entries share that allowance; a later equity increase or risk-selection increase cannot enlarge the second entry beyond its original share. Fractional pullback prices round to broker tick increments toward a better entry, with the cash size recalculated for that executable price. Broker lot sizes round down; entries below the broker minimum are rejected rather than rounded up. Cash-risk and daily-loss checks remain active.

Unfilled orders expire at the immediate next M15 close. New orders request broker-enforced specified expiration; unsupported broker requests are rejected rather than silently becoming indefinite orders. A common target/stop or a completed sibling cancels remaining orders. Filled positions retain their fixed exits, including when the second limit expires. Expiry/fill races recover the actual open position, and fast fill-to-close transitions can recover broker deal evidence without a missing journal entry. Separate tickets require an MT5 hedging account; netting accounts are rejected for new layered orders.

Live signal IDs, setup IDs, zone IDs and journal deduplication distinguish the two legs, including when their capped prices coincide. Journal total R weights each leg by 0.6 or 0.4; broker cash PnL remains the broker-reported amount. Chart history uses the layered entry prices and reports only unambiguous filled legs. Accuracy rows count filled entries, whereas the earlier study tables counted completed setups. Existing broker executions remain facts and retain their original exits.

Validation:

- Full TypeScript suite: 497 tests passed, including new entry geometry, mirrored SELL behavior, cap coalescing, original exit preservation, expiry, metadata tampering, partial-fill ambiguity, weighted R and per-leg deduplication coverage.
- Final Python bridge suite: 109 tests passed, including fast-close recovery and broker tick rounding for both BUY and SELL.
- Isolated server/API test verifies both entries can be claimed separately, the shared budget is retained, invalid full-risk allocation is rejected, sibling completion cancels pending entries, and fast closes preserve journal metadata. It uses temporary test data and does not connect to a broker.
- Production price adapters reproduce all 454 legs from 227 archived setups. The $30/$20 gross simulated bounds reproduce $2,257.19949 to $2,403.20037. Evidence: `scalp-two-entry-implementation-parity-2026-11-16.json`.
- TypeScript check, production build and protected-file checks passed. The local dashboard and both server-managed bridges were restarted; read-only checks confirmed both connected and existing per-account risk settings preserved (primary 0.5%, secondary 0.25%).

No synthetic live order was submitted. The archived gross result excludes spreads, commissions, slippage, lot rounding and portfolio limits. The application does not promise those historical profits or impose a fixed $50 account risk.
