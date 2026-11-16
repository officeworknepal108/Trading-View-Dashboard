# Gold Intraday: two pullback entries with original fixed exits

New Gold Intraday confirmations create two limit orders. The first is 10% of the final confirming engulfing body away from the next entry-timeframe candle's open and receives 60% of the selected Intraday risk. The second is a 25% body pullback and receives 40%. BUY prices are below that open; SELL prices are above it. A $50 total setup allowance allocates $30 and $20, rather than $50 to each order. Existing per-account general risk selections and trading switches are preserved.

The existing qualified setup is calculated first. Its original SL and TP prices remain fixed for both entries. The reference ratios remain 1:2 for M15/M15, H1/M15 and H1/M30; 1:1 for M15/M30; 1:3 for MTF H1/M5; and 1:5 for MTF H4/M15. Individual entry RR is derived from that entry's own distance to the fixed exits. No TP is moved to maintain the original ratio after a pullback fills.

The existing route-specific maximum stop distances remain enforced. Each limit is no worse than the original allowed/capped entry, so both can sometimes coincide. They retain independent order IDs, setup IDs, journal identities and notification identities. The original zone identity remains shared and single-use across routes; only the planned sibling from the same confirmation can enter, not a later signal or another strategy using that consumed zone.

The server freezes one full-setup cash risk allowance from account equity. Both orders use that allowance with their respective shares. Equity increases cannot enlarge the second allocation beyond the frozen budget. Broker price increments round toward a better entry, lot sizes round down, and undersized orders are rejected. Existing spread, account binding, open-position, daily-risk, session, news and zone qualification controls remain in effect. Separate tickets require a hedging account.

Pending orders request broker-enforced expiration at the close of the next entry-timeframe candle: five minutes for M5, fifteen for M15, thirty for M30. Reaching the original TP or SL cancels any unfilled orders. An already filled position retains its original fixed exits. The bridge checks current prices and M1 chart history since confirmation so an earlier TP touch followed by a pullback still retires the unfilled setup. New order placement fails safely when that history cannot be verified. Broker/account context is used for symbols with suffixes. Existing expiry/fill-race and fast-close recovery apply to these orders as well.

Original Intraday eligibility and other existing management rules remain in place. Existing live broker executions and legacy orders retain their facts and exit levels. The change applies to newly qualified Intraday setups; it does not resize existing positions. Scalp 1:1 retains its previously implemented two-entry behavior, and ordinary Scalping and Forex paths are preserved.

Chart history, active drawings, replay entries, order previews and journal rows use the layered entries. Same-bar outcomes with uncertain fill-before-target order are omitted from chart results. Missing execution bars cannot establish a result. M30 fill windows can use both M15 execution bars. Journal total R weights entries by 0.6/0.4; actual cash PnL remains broker-reported. Legacy single-entry chart simulations stay stored but are excluded from the new Gold Intraday display so they cannot double-count the same setup. Real broker records remain visible. Entry counts are distinguished from setup counts; original zone calculations are labelled as reference levels.

Validation:

- Full TypeScript suite: 507 tests passed.
- Full Python bridge suite: 116 tests passed.
- Final targeted Intraday, isolated server/API, Telegram identity and overlay regression run: 41 tests passed.
- TypeScript check and production build passed. Protected-file check passed for all changed protected files.
- Intraday tests cover all six routes, both directions, 60/40 allocations, shared cash allowances, fixed exit geometry, route caps, coalesced prices, original-zone single-use protection, M30/M15 timing, original TP before entry, intrabar ambiguity, weighted journal R, metadata tampering, broker expiry, and TP touches between polls.
- The isolated API test claims both orders separately, rejects browser-forged split orders, preserves per-leg journal metadata and cancels a pending sibling after setup completion. It operates on temporary test data without connecting to a broker.

No test order was submitted to the live accounts. No historical Intraday profitability improvement is claimed; the earlier dollar comparison applied to Scalp 1:1.
