# XAUUSD Market-Structure Strategy

## Laravel/PHP Reimplementation Specification

Version: 1.0  
Prepared: 2026-10-07  
Canonical reference: the current React/TypeScript dashboard, Express automation server, regression tests, and Python MT5 bridge in this project.

> This document describes the behavior of the existing software. It is an engineering specification, not a profitability claim or financial advice. The Laravel implementation must first reproduce this behavior on a demo account and pass parity tests before it is allowed to submit live orders.

## 1. Handoff instruction for Claude

Build a separate Laravel application from this specification. Do not modify or replace the existing dashboard. Treat all algorithms as deterministic pure functions over time-ordered OHLC candles. Use completed candles for every confirmation, invalidation, pivot, engulfing, and outcome decision unless this specification explicitly says otherwise. Do not infer additional market-structure rules from visual appearance.

The original TypeScript remains the final source of truth if this prose is ambiguous. The most important reference files are listed in Appendix A.

## 2. Strategy inventory

The system contains these distinct but connected strategy layers:

1. OANDA XAUUSD candle acquisition through TradingView's unofficial WebSocket protocol.
2. External MG market structure: Genesis, SH/SL candidates, HH/HL and LL/LH, BOS, protected points, and CHoCH.
3. TJL1 and TJL2 zone generation and mapped higher-timeframe confirmation.
4. CHoCH conversions: QML, SBR/RBS, DB/DT, and classifications Pending, Valid, AIR, or VIP.
5. Double CHoCH conversions: QML A+, QML A++, SBR/RBS, and DBD/DTD.
6. Major Liquidity: every DBD/DTD and qualified second-structure TJL2.
7. Optional H1-and-higher Supply/Demand zones.
8. ISS five-wave structure and post-ISS internal market structure.
9. Structure FIB qualification, including primary and deep-discount bands.
10. Four accepted engulfing patterns, T1 through T4.
11. Direct timeframe trade setups and mapped engulfing fallbacks.
12. H4 Swing FIB confluence.
13. Nepal 09:15 Day FIB confluence.
14. Multi-timeframe (MTF) higher-zone/lower-CHoCH setups.
15. Entry, stop, target, 1R risk-free level, pending-entry cap, and outcome tracking.
16. Optional MT5 queue, deduplication, risk sizing, order placement, and position management.

These layers must remain separate. A chart drawing ending does not end a zone's logical eligibility. A FIB classification does not create or invalidate a structure zone. Replay analysis must never publish MT5 signals.

## 3. Canonical market data

### 3.1 Instrument and feed

- Instrument: `OANDA:XAUUSD`.
- Current provider: TradingView WebSocket, using `unauthorized_user_token`.
- The feed is unofficial. Never silently replace missing OANDA data with another broker or synthetic candles.
- Standard calculation window: up to 1,500 candles per timeframe.
- API maximum: 5,000 candles per request.
- Sort candles in strictly increasing Unix timestamp order and deduplicate by timestamp.
- Candle fields: `time`, `open`, `high`, `low`, `close`, `volume`, `complete`.
- The latest live candle is marked `complete = false`; all historical returned candles are complete.

### 3.2 Supported timeframes

| Code | Duration |
|---|---:|
| M1 | 60 seconds |
| M5 | 300 seconds |
| M15 | 900 seconds |
| M30 | 1,800 seconds |
| H1 | 3,600 seconds |
| H4 | 14,400 seconds |
| D | 86,400 seconds |
| W | 604,800 seconds |
| MO | calendar month for chart support; not used by MT5 scanning |

### 3.3 No-future-data rule

- The current unfinished candle may be displayed but cannot confirm structure, engulfing, invalidation, FIB invalidation, or a completed trade result.
- Higher-timeframe candles used by a lower timeframe must have closed no later than the lower chart's current cutoff.
- An engulfing entry becomes calculable only on the first execution candle whose timestamp is at or after the engulfing candle's close time.

## 4. Timeframe mappings

### 4.1 TJL1/ISS L3/Internal TJL1 confirmation

| Source timeframe | Confirmation timeframe |
|---|---|
| M1 | M5 |
| M5 | M15 |
| M15 | H1 |
| M30 | H1 |
| H1 | H4 |
| H4 | D |
| D | W |

If the confirmation duration is absent or is not greater than the source duration, the zone is valid immediately.

### 4.2 VIP support timeframes

| Source | Allowed mapped support zones |
|---|---|
| M1 | M5 or M15 |
| M5 | M15 or H1 |
| M15 | H1 or H4 |
| M30 | H1 or H4 |
| H1 | H4 or D |
| H4 | D or W |
| D | W or MO |

The freshest qualifying tap across either mapped timeframe is selected. It must have the same post-CHoCH trade direction. One support tap can be consumed by only one CHoCH; another CHoCH requires a fresh retap.

### 4.3 Direct engulfing fallbacks

| Zone timeframe | Native first | Fallback order |
|---|---|---|
| M1 | M1 | M5 |
| M5 | M5 | M15 |
| M15 | M15 | M30 |
| H1 | native may exist, but fallback is intentionally preferred | M15, then M30 |

For M1/M5/M15, fallback is used only when no native, Swing-FIB, or Day-FIB engulfing already exists. For H1, fallback scanning is allowed even when a native engulfing exists, and signal resolution prefers the first available fallback: M15 before M30.

### 4.4 Current MTF mappings

| Higher timeframe zone | Lower timeframe structure | Current confirmation kind |
|---|---|---|
| M15 | M1 | CHoCH |
| M15 | M5 | CHoCH |
| H1 | M5 | CHoCH |
| H4 | M15 | CHoCH |
| D | H1 | CHoCH |

Important parity rules:

- The type model mentions ISS confirmation, but the current MTF builder constructs CHoCH events only. Do not create ISS-based MTF trades.
- D to H1 can appear as an MTF context row, but the current trade-rule matrix has no H1 engulfing execution rule. It is display-only and must not create an order.

## 5. Candle and body primitives

Define:

```text
bodyLow  = min(open, close)
bodyHigh = max(open, close)
bullish  = close > open
bearish  = close < open
```

A full body is beyond a level upward when `bodyLow > level`. It is beyond a level downward when `bodyHigh < level`. Equality does not pass.

### 5.1 Two-candle retracement confirmation

```text
twoRed   = current bearish
           AND previous bearish
           AND current.close < previous.low

twoGreen = current bullish
           AND previous bullish
           AND current.close > previous.high
```

When a two-candle retracement confirms a pivot, search the relevant range through the first retracement candle. Exclude the second candle that merely confirms the retracement. This prevents the confirmation candle from relocating the pivot.

## 6. External MG market-structure state machine

### 6.1 Genesis

- Require at least 12 candles; otherwise return neutral structure with no zones.
- Genesis is the lowest wick in the first 500 loaded candles, or all loaded candles if fewer than 500.
- Initial trend is bullish.
- Genesis becomes the initial protected point and path start.

### 6.2 Bullish-state continuation

1. When `twoRed` first occurs without an active high candidate, find the highest wick from the applicable left boundary through the first retracement candle. Mark provisional SH.
2. If a later candle closes above the SH price:
   - SH becomes HH.
   - Find the lowest wick from HH through the break candle, excluding the previous HL confirmation index; mark HL.
   - Add bullish swing lines and bullish BOS at the HH price.
   - Create BUY TJL1 at HH and BUY TJL2 at HL.
   - Link the pair using the BOS formation timestamp.
   - HL becomes the new protected point.
   - Optionally create Demand from the most recent bearish candle within the last 12 candles before BOS.
3. A bullish trend changes bearish only when a completed candle's full body closes below the protected HL.

### 6.3 Bullish-to-bearish CHoCH

On the full-body close below protected HL:

- Draw bearish CHoCH at the protected level.
- New protected high is the already-confirmed active SH when available; otherwise the highest wick from the old protected point through the break candle.
- Convert the last bullish TJL1 to a SELL QML.
- Convert the last bullish TJL2 to a SELL SBR.
- Create a SELL DT at the new protected high.
- Apply one shared CHoCH classification to QML, SBR, and DT.
- Converted/created zones activate after the CHoCH break candle; the break candle and all earlier overlaps are not taps.
- Reset trend state to bearish.

### 6.4 Bearish-state continuation

Mirror the bullish process:

1. `twoGreen` creates a provisional lowest-wick SL.
2. A later close below SL confirms LL and the highest intervening wick as LH.
3. Add bearish BOS.
4. Create SELL TJL1 at LL and SELL TJL2 at LH.
5. LH becomes protected.
6. Optionally create Supply from the most recent bullish candle within the last 12 candles before BOS.
7. A completed full body above protected LH causes bullish CHoCH.

### 6.5 Bearish-to-bullish CHoCH

- Convert the last bearish TJL1 to a BUY QML.
- Convert the last bearish TJL2 to a BUY RBS.
- Create BUY DB at the new protected low.
- Activate only after the CHoCH candle.
- Reset trend state to bullish.

## 7. Zone geometry

For the pivot candle:

```text
buffer     = abs(close - open) * 0.01
lowerBody  = min(open, close)
upperBody  = max(open, close)
bottomWick = lowerBody - low
topWick    = high - upperBody
```

### 7.1 TJL geometry

- High-pivot zone: `bottom = pivotPrice - (topWick + buffer)`, `top = pivotPrice`.
- Low-pivot zone: `bottom = pivotPrice`, `top = pivotPrice + (bottomWick + buffer)`.
- Direction and pivot side are independent. A bullish TJL1 is a BUY zone at a high pivot; a bearish TJL1 is a SELL zone at a low pivot.
- TJL1 and TJL2 created by the same BOS share `tjlPairTime`.
- TJL1 invalidation direction points toward the midpoint of its paired TJL2.

### 7.2 DB/DT geometry

- DB: `bottom = pivotPrice`; `top = pivotPrice + bottomWick + buffer`.
- DT: `bottom = pivotPrice - topWick - buffer`; `top = pivotPrice`.

### 7.3 Supply/Demand geometry

Supply/Demand creation is enabled only for H1, H4, and D analysis.

- Demand origin: most recent bearish candle in the last 12 candles before bullish BOS. Zone is `[origin.low, max(origin.open, origin.close)]`.
- Supply origin: most recent bullish candle in the last 12 candles before bearish BOS. Zone is `[min(origin.open, origin.close), origin.high]`.
- It activates one source candle after BOS, not on the origin or BOS candle.

### 7.4 Visual width versus logical life

- Default drawing width is 30 actual source candles from the zone's start timestamp.
- Weekend/session gaps must use the timestamp of the actual 30th loaded candle, not `30 * timeframeSeconds` alone.
- `endTime` ends only the drawing. A valid active zone remains logically eligible after that time until invalidated.

## 8. Zone lifecycle, taps, and invalidation

Statuses are `pending`, `valid`, `rejected`, or `invalidated`.

### 8.1 First tap

The first tap is the first candle satisfying all of:

- `candle.time > zone.startTime`;
- `candle.time >= activeFromTime`;
- candle time is before `invalidatedAt` if invalidated;
- `candle.high >= zone.bottom` and `candle.low <= zone.top`.

Pending TJL1, ISS L3, and Internal TJL1 cannot record taps. A CHoCH-created zone ignores historical overlaps and the CHoCH break candle.

### 8.2 General invalidation

Never invalidate on an incomplete candle.

- BUY zone: invalid when the entire completed body is below the zone, `bodyHigh < bottom`.
- SELL zone: invalid when the entire completed body is above the zone, `bodyLow > top`.

### 8.3 Directional invalidation

TJL1, ISS L3, and Internal TJL1 use their `invalidationDirection`:

- Direction `up`: invalid when `bodyLow > top`.
- Direction `down`: invalid when `bodyHigh < bottom`.

A TJL1 is protected from invalidation until the first mapped higher-timeframe confirmation window has closed. A later invalidation never erases historical confirmation evidence.

## 9. Mapped higher-timeframe confirmation

Group source candles into mapped confirmation buckets. Ignore the still-forming final aggregate bucket.

- Up confirmation: first completed aggregate candle with `close > zone.top`.
- Down confirmation: first completed aggregate candle with `close < zone.bottom`.
- Before this occurs, status stays pending.
- Record number of completed confirmation attempts, first confirmation-window close, and actual confirmation close.

### 9.1 OANDA session anchoring

- Sub-H4 aggregation uses ordinary Unix/UTC interval boundaries.
- H4, D, and W use the 17:00 New York forex-session boundary.
- Observe US daylight saving: UTC-4 in DST and UTC-5 otherwise.
- Daily buckets begin at 17:00 New York.
- Weekly buckets begin at the Sunday 17:00 New York session.

## 10. CHoCH classification

At CHoCH, evaluate historical state at formation time:

1. If the paired TJL2 has not received its required mapped close: `pending`, not tradeable.
2. Else if a fresh same-direction mapped VIP support zone was tapped before CHoCH: `vip`, tradeable.
3. Else if paired TJL1 had already been confirmed: `valid`, tradeable.
4. Else: `air`, not tradeable.

VIP rules:

- Support zone must have existed and been usable at CHoCH.
- It must not be rejected or invalidated before CHoCH.
- Confirmation-controlled support zones must already be confirmed.
- Continuous candles inside a zone count as one visit; leaving and returning creates a fresh tap.
- Choose the freshest tap across the two mapped support timeframes.
- Opposite-direction support is ignored even if newer.

## 11. Double CHoCH

A first CHoCH with class Valid, AIR, or VIP may seed Double CHoCH. Pending cannot.

- From a bullish first CHoCH, a later full body below the pending DB extreme forms bearish Double CHoCH.
- From a bearish first CHoCH, a later full body above the pending DT extreme forms bullish Double CHoCH.
- Convert original QML to QML A+.
- Convert original SBR/RBS to QML A++.
- Convert the DB/DT extreme to opposite SBR/RBS.
- Add DTD on bearish Double CHoCH or DBD on bullish Double CHoCH.
- DBD and DTD are always Major Liquidity.
- Double CHoCH remains pending until its own mapped higher-timeframe confirmation and becomes tradeable only after confirmation.

## 12. Major Liquidity

Major Liquidity bypasses structure-FIB eligibility, but still requires a direction-matching T1/T2/T3/T4 engulfing that touches the active zone.

Major Liquidity zones are:

1. Every DBD and DTD.
2. The second structure's TJL2 when the prior same-direction TJL2 was wick-swept after activation, preserved by its completed body, and the sweep occurred before the second BOS.

A normal TJL2 is not Major Liquidity.

## 13. Structure FIB rules

FIB is a confluence layer. It never creates, confirms, or invalidates a structure zone.

### 13.1 General formula

Level 1 is the structure source. Level 0 is the completed continuation extreme.

```text
level(ratio) = zeroPrice + (sourcePrice - zeroPrice) * ratio
```

Primary band: 0.500 to 0.618.  
Deep band: 0.710 to 0.790.  
Extended deep: between 0.790 and the originating DB/DT source price.

### 13.2 TJL FIB

- TJL1 and TJL2 anchor to the current paired TJL2, even when that TJL2 pivot timestamp is later than the TJL1 pivot.
- BUY pair: source is paired TJL2 bottom; level 0 follows the highest completed high.
- SELL pair: source is paired TJL2 top; level 0 follows the lowest completed low.
- TJL1 accepts primary 0.500-0.618 only.
- TJL2 accepts primary, deep 0.710-0.790, and extended deep.
- A later CHoCH or Double CHoCH clears older external TJL1/TJL2 FIB eligibility at or before the reset.

### 13.3 CHoCH FIB

- Single CHoCH anchor is DB/DT.
- DB/DT itself is automatically A+ with band `DB/DT`.
- QML and SBR/RBS are classified against the move from DB/DT to the latest completed continuation extreme and may accept primary or deep.
- Double CHoCH anchor is DBD/DTD; eligible QML A+, QML A++, SBR/RBS, DBD/DTD are evaluated similarly.

### 13.4 Deep invalidation

Deep eligibility is invalidated only by a completed close beyond 0.790 toward the originating DB/DT side:

- SELL move: completed close above 0.790.
- BUY move: completed close below 0.790.

An intrabar close or wick does not invalidate deep FIB.

### 13.5 ISS FIB

For completed ISS L3, level 1 is Point 0 and level 0 starts at Point 5, then follows the latest completed continuation extreme. The current implementation stores ISS FIB anchors and 0.500 but does not independently assign an ISS structure-FIB band/status. Do not invent direct ISS A+ band eligibility beyond what Swing/Day confluence or another existing rule provides.

## 14. Engulfing patterns

Only completed candles qualify. Detection order is T4 longest-to-shortest, then T2, then T3, then T1.

### 14.1 Directional body-strength rule

Used by T1, T2, and T4; not T3.

- Bullish final candle: `body = close - open`; `upperWick = high - close`; require `body >= upperWick`.
- Bearish final candle: `body = open - close`; `lowerWick = close - low`; require `body >= lowerWick`.
- Equality passes. A doji fails.

### 14.2 Type 1

Bullish T1:

- Previous candle bearish.
- Current candle bullish and passes body strength.
- `current.close > previous.high`.

Bearish T1 is the inverse: previous bullish, current bearish, body strength passes, and `current.close < previous.low`.

### 14.3 Type 2

Bullish T2 uses three candles:

- First bearish.
- Middle bullish and `middle.low <= first.low`.
- Final bullish, passes body strength, and `final.close > first.high`.

Bearish T2:

- First bullish.
- Middle bearish and `middle.high >= first.high`.
- Final bearish, passes body strength, and `final.close < first.low`.

### 14.4 Type 3

Bullish T3:

- First bearish.
- Middle bullish and sweeps first low.
- Final bullish and closes above the middle high.

Bearish T3 is the inverse and closes below the middle low. T3 does not use the final-candle body-strength filter; its sweep/continuation geometry is decisive. T2 is checked first so a close through the first candle is not mislabeled T3.

### 14.5 Type 4

- Contains 3 through 10 candles.
- All middle candles must remain inside the first candle's full high-low range.
- First candle may have either color.
- Bullish final candle passes body strength, opens at or below first high, and closes above first high.
- Bearish final candle passes body strength, opens at or above first low, and closes below first low.
- Test longest sequence first to preserve the original tap candle.

## 15. Direct engulfing qualification

For a normal structure-FIB trade:

- Zone must be valid.
- Zone must be A+.
- Engulfing direction must match zone direction: BUY requires bullish; SELL requires bearish.
- At least one candle in the engulfing sequence must touch the active zone after activation.
- Primary-band setups must also have at least one pattern candle trade through exact FIB 0.500.
- Deep, extended-deep, and DB/DT setups do not require exact 0.500 contact.

For Major Liquidity:

- Ignore all structure-FIB alignment requirements.
- Still require active-zone contact and matching direction.
- All four engulfing types are accepted.

Generic mapped fallback scanning uses valid, active, tradeable zones and matching zone contact, without reapplying the zone's structure-FIB detector. Preserve the existing signal-selection priority:

1. Fallback engulfing.
2. Native structure engulfing.
3. Swing-FIB engulfing.
4. Day-FIB engulfing.

### 15.1 Scalping Logic for M1 and M5 execution

Apply this gate to native M1-zone/M1-engulfing setups, an M1 zone using its M5
engulfing fallback, and native M5-zone/M5-engulfing setups. At the completed
entry engulfing close, compute M5 context and the M15 market-structure trend
using only candles that have already closed.

- Bullish M1 or M5 confirmation requires bullish M15 bias.
- Bearish M1 or M5 confirmation requires bearish M15 bias.
- Neutral M15 bias waits and creates no trade.
- An engulfing opposite to the M15 bias waits and creates no trade.
- If the completed M5 trend already matches the signal, classify it as a
  continuation. If M5 trend is opposite, the matching completed engulfing
  confirms the pullback entry. Neutral M5 trend is accepted because the
  completed M5 engulfing itself is the confirmation.

Native M1 confirmation must additionally pass its existing volume policy. This
gate does not alter zone qualification, R:R, stop buffers, risk caps,
pending-entry behavior, M15/M30 routes, or H1 intraday routes.

### 15.2 Intraday Logic for M5 and M15 execution

Apply Intraday Logic to M5 entries from M15/H1 setup timeframes and M15
entries from M15/H1/H4 setup timeframes. At the engulfing close, use only
already-completed higher-timeframe candles:

- H4 is the main bias and must match the engulfing direction.
- H1 must be directional. Matching H1 is continuation; opposite H1 is a
  pullback and may continue only after M15 realigns with H4.
- M15 must match both H4 and the engulfing direction.
- Neutral H4, H1, or M15 waits and creates no intraday trade.

The completed M5 or M15 engulfing remains the entry trigger. Preserve the
existing route-specific R:R, buffer, maximum-risk, pending-entry, deep-FIB,
and 1R management rules.

## 16. H4 Swing FIB

- Seed from the earliest non-zero H4 external swing line.
- A valid seed must span different candles and different prices.
- Direction is up when zero price is above source price, otherwise down.
- Level 1 remains at move origin; level 0 follows continuation extremes using completed H4 candles.
- For an up move, a completed candle touching or crossing 0.500 starts a down move from the old level-0 high to that candle's low.
- For a down move, a completed candle touching or crossing 0.500 starts an up move from the old level-0 low to that candle's high.
- Retain only current and previous moves.
- Apply active Swing FIB to M1, M5, M15, M30, and H1 zones.
- Up swing accepts BUY zones and bullish engulfing; down swing accepts SELL zones and bearish engulfing.
- A zone overlapping either 0.500-0.618 or 0.710-0.790 becomes Swing A+.
- The final engulfing candle must overlap the qualifying band, and the engulfing sequence must touch the zone after both zone activation and the Swing level-0 timestamp.
- Deep-band Swing engulfing does not need exact 0.500 contact.

## 17. Nepal 09:15 Day FIB

- Used on M1, M5, M15, and M30 only.
- Each Nepal calendar day begins its measurement at exactly 09:15 Asia/Kathmandu.
- If the exact 09:15 candle is missing, do not create that day's FIB.
- Level 1 is the 09:15 candle open.
- If latest close is above the open, direction is up and level 0 follows the day's high.
- If latest close is below the open, direction is down and level 0 follows the day's low.
- If equal, choose the side with the greater distance from the open; ties choose up.
- A completed historical day stays frozen.
- Up Day FIB accepts BUY zones/bullish engulfing; down accepts SELL zones/bearish engulfing.
- Either primary or deep band qualifies.
- Final engulfing candle must overlap the selected band; the pattern must touch the active zone after activation and after the Day FIB extreme timestamp.
- Deep Day FIB does not require exact 0.500 contact.

## 18. ISS five-wave structure

ISS is calculated on the current chart timeframe only.

### 18.1 Anchors

- In bullish external structure, an external SH is Point 0 for a bearish ISS, bounded by the external protected low.
- In bearish external structure, an external SL is Point 0 for a bullish ISS, bounded by the external protected high.
- Every ISS point must stay inside its external boundary.
- A body close through Point 0 invalidates that candidate immediately.

### 18.2 Wave state machine

For bullish ISS, alternate highs/lows as described; bearish is inverse:

1. Point 0 is the external SL/SH.
2. Point 1: a two-candle reversal identifies the pivot using the first retracement candle rule. It remains provisional and may be replaced by a more extreme valid pivot before its break.
3. Point 2: after a body close through Point 1 in continuation direction, use the full pullback extreme between Point 1 and the break.
4. Point 3: next confirmed two-candle reversal pivot.
5. Point 4: after a body close through Point 3, use the full intervening opposite extreme.
6. Point 5: next confirmed two-candle reversal pivot. Completion time is the second reversal candle.

### 18.3 ISS zones

- Point 3 creates ISS L3, equivalent to TJL1, with mapped confirmation required.
- Point 4 creates ISS L4, valid immediately at ISS completion.
- L3 and L4 inherit Point 0, Point 5, direction, and completion metadata.
- L3 uses directional invalidation and cannot tap while pending.

### 18.4 Internal structure after ISS

- At ISS completion, only L3/L4 are visible.
- Internal TJL1/TJL2 normally begin after a continuation BOS beyond Point 5.
- Point 3/4 are retained as a hidden seed pair so a direct Point-5 CHoCH can still form.
- Internal bullish/bearish structure mirrors external SH/SL, BOS, TJL1/TJL2, protected point, and full-body CHoCH rules.
- Internal CHoCH converts TJL1 to Internal QML and TJL2 to Internal SBR/RBS, and creates Internal DT/DB.
- Internal processing stops at the next external CHoCH. External BOS does not stop it.

## 19. MTF strategy

An MTF setup is a location-specific reversal. It is not enough for a lower-timeframe CHoCH to occur sometime after an old higher-timeframe tap.

### 19.1 Lower CHoCH event identity

- Event zones must be either external MG QML/SBR/RBS/DT/DB or internal
  Internal QML/SBR/RBS/DT/DB sharing one CHoCH timestamp.
- QML and the matching SBR/RBS must have the same `tjlPairTime` and belong to
  the same external or internal structure family. Never mix the two families.
- That pair time identifies the exact lower-timeframe structure that changed.
- ISS does not replace this same-structure CHoCH requirement.

Direct entries from Internal TJL1/TJL2 and converted Internal QML/SBR/RBS/DB/DT
use the same active/valid, FIB, zone-touch, engulfing, bias, risk, history and
execution rules as their external equivalents. A pending Internal TJL1 cannot
tap or enter before its mapped confirmation.

### 19.2 Higher-timeframe context

For each mapped pair:

- HTF zone must be active, valid, same direction, and usable at the tap time.
- Logical eligibility continues after its 30-bar visual box ends.
- The exact LTF QML plus SBR/RBS source pair must overlap the HTF zone.
- Search completed LTF candles up to and including the CHoCH candle for HTF-zone visits.
- The CHoCH candle itself may provide the HTF tap.
- A continuous visit is one tap; later re-entry is newer.
- If equal tap times compete, prefer Major Liquidity.

### 19.3 Lower entry zone and engulfing

- After CHoCH, choose a valid post-event LTF zone tap.
- An already stored qualified engulfing is preferred so later FIB-zero extension cannot retroactively remove a historical entry.
- Otherwise require the lower zone to overlap its silent CHoCH FIB primary or deep band.
- DB/DT is the originating A+ band.
- Engulfing must match direction, be after CHoCH/tap/activation, occur before invalidation, touch the tapped lower zone, and overlap its qualified band.
- A valid entry takes precedence over a newer unqualified tap.

The compact live table keeps one newest qualifying row per mapping. Historical accuracy reconstruction inspects up to 12 recent events per mapping.

## 20. Trade rule matrix

XAUUSD pip size is `0.1` price unit.

### 20.1 Direct rules

| Zone TF | Engulfing TF | R:R | Stop buffer | Maximum Entry-SL |
|---|---|---:|---:|---:|
| M1 | M1 | 1:3 | 10 pips | 50 pips |
| M1 | M5 | 1:2 | 10 pips | 100 pips |
| M5 | M5 | 1:2 | 10 pips | 100 pips |
| M5 | M15 | 1:1 | 20 pips | 200 pips |
| M15 | M15 | 1:2 | 20 pips | 200 pips |
| M15 | M30 | 1:1 | 20 pips | 300 pips |
| H1 | M15 | 1:2 | 20 pips | 200 pips |
| H1 | M30 | 1:2 | 20 pips | 300 pips |

### 20.2 MTF fallback rules by actual engulfing timeframe

If no exact direct pair exists:

| Engulfing TF | R:R | Buffer | Maximum risk |
|---|---:|---:|---:|
| M1 | 1:3 | 10 pips | 50 pips |
| M5 | 1:2 | 10 pips | 100 pips |
| M15 | 1:2 | 20 pips | 200 pips |
| M30 | 1:1 | 20 pips | 300 pips |

There is no H1 fallback rule.

## 21. Entry, SL, TP, and trade state

### 21.1 Pattern liquidity

Take every candle in the engulfing sequence:

- BUY liquidity = minimum low.
- SELL liquidity = maximum high.

Normal stop:

- BUY `SL = liquidity - bufferPips * 0.1`.
- SELL `SL = liquidity + bufferPips * 0.1`.

If the signal's actual originating FIB source is deep (`0.710-0.790` or extended deep), omit the stop buffer and place SL at liquidity. Deep status from an unrelated confluence layer must not remove the buffer.

### 21.2 First possible entry candle

```text
confirmationClose = signalTime + signalTimeframeSeconds
entryCandle = first execution candle with time >= confirmationClose
```

No trade exists until this candle is available.

### 21.3 Immediate versus capped pending entry

At `entryCandle.open`:

```text
BUY openRisk  = entryOpen - SL
SELL openRisk = SL - entryOpen
maximumRiskPrice = maximumRiskPips * 0.1
```

- If `openRisk > 0` and `openRisk <= maximumRiskPrice`, enter at the candle open; status Active.
- Otherwise cap risk with a pending entry:
  - BUY `entry = SL + maximumRiskPrice`.
  - SELL `entry = SL - maximumRiskPrice`.
  - Initial status Pending.

Then:

```text
risk = abs(entry - SL)
BUY TP  = entry + risk * rewardRisk
SELL TP = entry - risk * rewardRisk
BUY 1R  = entry + risk
SELL 1R = entry - risk
riskPips = risk / 0.1
```

### 21.4 Pending behavior

- BUY fills when candle low is at or below entry.
- SELL fills when candle high is at or above entry.
- If target is reached before the pending entry is ever touched, discard the setup instead of leaving it pending indefinitely.
- After a fill, evaluate outcomes on the fill candle too.

### 21.5 Outcome ordering

For each candle after fill, use this exact priority:

1. TP.
2. Mark 1R reached.
3. SL.

Consequences:

- If TP and SL occur in one candle, result is TP.
- If 1R and SL occur in one candle without TP, result is RF.
- Before 1R, SL result is SL.
- After 1R, status is Risk Free; a later stop result is RF.

Trade states: Pending, Active, Risk Free, TP Hit, SL Hit. Resolved result values: `tp`, `rf`, `sl`.

## 22. Accuracy and history behavior

- Accuracy is optional and off by default.
- Use only resolved TP, RF, and SL trades.
- Accuracy percentage is `TP / (TP + RF + SL) * 100`.
- Use the newest 50 completed direct and MTF trades combined.
- Historical reconstruction should run only when requested because it is expensive.

## 23. Automation scanner

- Automated direct timeframes: M1, M5, M15, H1. M30 is loaded for fallback; H4 and D are loaded for confirmation/VIP/MTF.
- Refresh one of M1/M5/M15/M30/H1/H4/D per scan, rotating one timeframe every 5 seconds.
- Do not scan until all seven timeframe caches contain data.
- Analyze raw structures first, then analyze each timeframe again with mapped VIP contexts.
- Apply direct fallback candles only if they were completed by the source timeframe cutoff.
- Queue only Pending or Active trades. Do not queue Risk Free or completed trades.
- Ignore replay trades.
- Default freshness is 120 seconds from `calculatedAt`; stale candidates are not queued.
- Default pending expiry is 240 minutes.

### 23.1 Signal deduplication

Stable ID fields are:

```text
signalTimeframe : floor(signalAt) : direction : entry(3dp) : SL(3dp) : TP(3dp)
```

The source and zone name are intentionally not part of the ID. Overlapping zones with the same direction, signal time, and levels become one order with a confluence-zone list.

### 23.2 Signal states

`QUEUED -> CLAIMED -> PLACED or ACTIVE -> RISK_FREE -> TP/SL/RF`

Other terminal states: `CANCELLED`, `REJECTED`, `EXPIRED`, `SIMULATED`.

- A claim older than 30 seconds is returned to QUEUED.
- A nonterminal signal at or beyond `expiresAt` becomes EXPIRED.
- The bridge heartbeat is considered connected when younger than 15 seconds.

## 24. MT5 safety and execution

### 24.1 Double live-order gate

An order is simulated if either:

- Dashboard `dryRun` is true; or
- Bridge environment `MT5_ALLOW_LIVE_EXECUTION` is not exactly `YES`.

### 24.2 Config ranges

| Setting | Default | Allowed range |
|---|---:|---:|
| Risk per trade | 0.25% | 0.01%-5% |
| Maximum automated positions plus pending orders | 1 | 1-10 |
| Maximum daily realized loss | 1% | 0.1%-10% |
| Maximum spread | 80 broker points | 1-1,000 |
| Freshness | 120 sec | 15-3,600 sec |
| Pending expiry | 240 min | 1-1,440 min |
| Break-even setting | 1R | 0.5-5 accepted by UI/server |

Parity warning: the current bridge actually moves SL at the `riskFree` price embedded in the signal, which is always 1R. It does not apply the configurable break-even multiplier. Preserve 1R for exact compatibility, or treat using the multiplier as a separately approved behavior change.

### 24.3 Pre-order checks

- MT5 terminal connected.
- Terminal AutoTrading allowed.
- Account trading allowed.
- Broker symbol selectable with live tick.
- Spread not above configured maximum.
- Count positions plus pending orders with the configured magic number; reject at maximum.
- Calculate today's realized loss from profit + commission + swap for matching magic number; reject at limit.
- BUY must satisfy `SL < Entry < TP`; SELL must satisfy `TP < Entry < SL`.

### 24.4 Position size

```text
riskMoney = accountEquity * riskPercent / 100
oneLotLoss = abs(MT5 order_calc_profit(1 lot, entry, SL))
rawVolume = riskMoney / oneLotLoss
```

- Floor volume to broker `volume_step`.
- Reject if below broker minimum; do not round upward and exceed risk.
- Cap at broker maximum.

### 24.5 Order behavior

- Pending dashboard trade becomes BUY LIMIT or SELL LIMIT.
- Active dashboard trade becomes market BUY or SELL at current ask/bid.
- Reject BUY LIMIT at or above ask and SELL LIMIT at or below bid.
- Send SL and TP with order.
- Use GTC and magic number.
- Try IOC, FOK, then RETURN filling policies.
- When 1R is reached, move SL to actual MT5 fill price, not theoretical dashboard entry.
- When an expired pending signal still has an MT5 order, remove it.

## 25. Recommended Laravel architecture

Keep strategy code independent of controllers, Eloquent, and the chart UI.

### 25.1 Modules/classes

```text
app/Domain/Market/Candle.php
app/Domain/Market/Timeframe.php
app/Domain/Structure/StructureZone.php
app/Domain/Structure/MarketStructureResult.php
app/Domain/Trading/EngulfingPattern.php
app/Domain/Trading/TradeLevels.php

app/Services/MarketData/TradingViewWebSocketClient.php
app/Services/Structure/ConfirmationBucketService.php
app/Services/Structure/MarketStructureEngine.php
app/Services/Structure/IssEngine.php
app/Services/Fib/StructureFibService.php
app/Services/Fib/SwingFibService.php
app/Services/Fib/DayFibService.php
app/Services/Trading/EngulfingDetector.php
app/Services/Trading/DirectSetupService.php
app/Services/Trading/MtfSetupService.php
app/Services/Trading/TradeLevelCalculator.php
app/Services/Automation/SignalDeduplicator.php
app/Services/Automation/AutomationScanner.php

app/Jobs/RefreshTimeframeCandles.php
app/Jobs/ScanAutomationSignals.php
app/Console/Commands/RunAutomationScanner.php
```

The MT5 Python bridge may remain a separate process. Laravel should expose compatible authenticated claim, heartbeat, status, and signal-update endpoints. Native PHP should not be assumed to control the local MT5 terminal directly.

### 25.2 Suggested database tables

#### candles

`symbol`, `timeframe`, `opened_at_unix`, `open`, `high`, `low`, `close`, `volume`, `is_complete`; unique on symbol/timeframe/time.

Use DECIMAL, not binary floating point, for persistence. Convert to a consistent numerical representation inside calculation services and compare parity at three decimal places for XAUUSD signal IDs.

#### automation_settings

One row containing enable/dry-run, broker symbol, risk percent, trade/spread/loss limits, freshness, expiry, break-even R, and version.

#### mt5_signals

Store every field from the signal contract: stable ID, direction, order type, source, zone names/timeframes, engulfing type/time, calculated time, Entry/SL/TP/1R, risk, expiry, status, bridge claim, broker identifiers, execution price, volume, and message.

#### optional audit tables

- `strategy_runs`: input candle hashes, engine version, start/end, errors.
- `structure_snapshots`: JSON output for parity/debugging.
- `bridge_heartbeats`.
- `completed_trades` for accuracy/journal.

Do not make database rows the mutable algorithm state while processing candles. Rebuild deterministic state from the ordered candle series, then persist snapshots/signals transactionally.

### 25.3 Queue and locking

- Use one distributed lock per symbol/timeframe scan.
- Use a transaction and unique signal ID constraint for deduplication.
- Claim a queued signal using `SELECT ... FOR UPDATE SKIP LOCKED` or an atomic status update.
- Expire stale claims after 30 seconds.
- Make every bridge status callback idempotent.

## 26. Canonical calculation pipeline

```text
1. Fetch and normalize candles for all required timeframes.
2. Mark latest live candle incomplete.
3. Build raw structure independently for each timeframe.
4. Build mapped VIP support contexts only from closed, cutoff-safe HTF candles.
5. Rebuild final structure per timeframe with VIP contexts.
6. Apply structure FIB and native engulfing in the structure engine.
7. For the visible chart only, optionally layer active H4 Swing FIB then Day FIB.
8. Apply direct engulfing fallbacks in priority order.
9. Resolve one signal per eligible direct zone and calculate trade levels.
10. Build mapped MTF CHoCH rows, qualify LTF engulfing, calculate trade levels.
11. Keep only Pending/Active, non-replay, fresh trades.
12. Deduplicate by stable signal ID and merge confluence zone names.
13. Persist/queue atomically.
14. Bridge claims one signal, applies safety checks, simulates or sends order.
15. Bridge reconciles pending orders/positions and moves SL at 1R.
```

## 27. API contract for Laravel/bridge compatibility

Recommended endpoints matching current behavior:

```text
GET  /api/mt5/status
PUT  /api/mt5/config                  local/admin only
POST /api/mt5/signals                 local/admin only
POST /api/mt5/heartbeat               bearer token
POST /api/mt5/signals/claim           bearer token
POST /api/mt5/signals/{id}/status     bearer token
```

Validate:

- Symbol must be XAUUSD.
- Direction BUY/SELL.
- Order type MARKET/LIMIT.
- Source ENGULFING/MTF.
- Positive finite Entry/SL/TP/1R.
- Correct BUY/SELL level order.
- Finite timestamps.
- Signal not older than freshness threshold.

Use a long random bearer token, HTTPS when crossing machines, encrypted secrets, IP restrictions or VPN, and never expose the unauthenticated MT5 mutation endpoints publicly.

## 28. Required parity tests

Claude must port fixture-based tests before enabling automatic orders. At minimum verify:

### Structure

- Pivot includes the first retracement candle but excludes the second confirmation candle.
- Bullish and bearish BOS create the correct TJL geometry and pair identity.
- Full-body CHoCH, not wick-only CHoCH.
- Valid/AIR/VIP/Pending classification matrix.
- Freshest same-direction VIP tap wins and cannot be reused.
- Converted QML ignores stale TJL1 directional invalidation behavior.
- Every zone invalidates only on completed full-body outside.
- Origin, pre-activation, and CHoCH break candles cannot be taps.
- H4/D/W confirmation bucket alignment follows New York DST and Sunday weekly start.

### FIB and liquidity

- TJL1 primary only; TJL2 primary/deep.
- TJL1 anchors to its paired TJL2 even when that pivot is newer.
- CHoCH/Double CHoCH clears older TJL FIB.
- Deep invalidation requires completed close, not wick/live close.
- DBD/DTD are Major Liquidity.
- Second TJL2 promotion requires earlier TJL2 sweep before second BOS.
- ISS FIB extends from Point 0 through Point 5 continuation.

### Engulfing

- Bullish/bearish T1 only after close.
- T2 sweep and close through first candle.
- T3 sweep and close through middle candle, without body-strength restriction.
- T4 3-10 containment and longest-pattern preference.
- T1/T2/T4 reject weak directional final body; equality passes.
- Normal entry requires A+ FIB, direction, active-zone touch, and correct band touch.
- Major Liquidity accepts any T1-T4 without FIB alignment but still requires zone touch.

### Swing/Day/MTF

- Swing alternates at 0.500, uses completed H4 candles, and retains two moves.
- Day FIB starts only with exact Nepal 09:15 candle and resets daily.
- Direction-matching zones only for Swing and Day.
- Deep Swing/Day engulfing does not require 0.500.
- MTF requires the exact LTF source pair overlapping the HTF zone.
- Old unrelated HTF tap cannot qualify later out-of-zone LTF CHoCH.
- CHoCH candle may be the HTF tap.
- Major Liquidity wins an equal-time HTF tap.
- ISS cannot substitute for MTF CHoCH.

### Trade levels/automation

- Every row in the direct trade matrix.
- Immediate entry and 1R/TP math.
- Deep-origin signal alone removes stop buffer.
- Oversized setup creates capped pending entry.
- Pending setup disappears when TP is reached before entry.
- Same-candle TP priority and RF-before-SL behavior.
- Stable signal ID merges overlapping zones.
- Pending maps to LIMIT; Active maps to MARKET.
- Risk Free/completed trade is not executable.
- Risk percent clamps at 5%; maximum open trades clamps at 10.

## 29. Build sequence for Claude

1. Create immutable Candle/Zone/Pattern/Trade DTOs and timeframe constants.
2. Port low-level predicates and engulfing detector with unit tests.
3. Port confirmation buckets including New York DST fixtures.
4. Port external structure and zone lifecycle.
5. Port CHoCH, Double CHoCH, VIP, and Major Liquidity.
6. Port FIB, Swing FIB, and Day FIB.
7. Port ISS/internal structure.
8. Port MTF.
9. Port trade-level calculation and historical outcomes.
10. Add database persistence, scheduler, locks, and APIs.
11. Reuse or adapt the Python MT5 bridge.
12. Run TypeScript and Laravel engines against identical candle fixtures and diff every structure event, zone field, signal, and trade level.
13. Run in Dry Run on demo, then demo execution, before any live-account decision.

## 30. Explicit non-goals and cautions

- Do not simplify full-body tests into close-only tests where full-body is specified.
- Do not use unfinished candles.
- Do not treat the 30-bar drawing limit as zone expiration.
- Do not turn every FIB overlap into a trade; engulfing and zone rules still apply.
- Do not add MTF mappings, H1 execution rules, ISS-MTF events, market substitutions, or new MG/ISS interpretations without separately approved examples and tests.
- Do not assume backtest intrabar order is known. The current candle-level simulator uses TP-first priority and is therefore an explicit modeling rule.
- Do not expose bridge credentials, MT5 account secrets, or mutation APIs to the public internet.
- Do not claim that parity or passing tests guarantees profit.

## Appendix A: Source-of-truth map

| Concern | Canonical file |
|---|---|
| External structure, zones, CHoCH, Double CHoCH, ISS, FIB, engulfing | `src/services/marketStructure.ts` |
| Direct/MTF rule matrix and Entry/SL/TP/outcomes | `src/services/tradeLevels.ts` |
| MTF qualification | `src/services/mtf.ts` |
| H4 Swing FIB | `src/services/swingFib.ts` |
| Swing confluence | `src/services/swingFibConfluence.ts` |
| Nepal Day FIB | `src/services/dayFib.ts` |
| Day confluence | `src/services/dayFibConfluence.ts` |
| MT5 signal DTO/deduplication | `src/services/mt5Automation.ts` |
| Automation scanning/API | `server.ts` |
| MT5 risk and order execution | `mt5_bridge.py` |
| Data feed | `src/services/tradingViewDatafeed.ts` |
| Regression behavior | `tests/*.test.ts` |

## Appendix B: Suggested initial Claude prompt

```text
Create a new Laravel application implementing the attached XAUUSD strategy specification.
Keep the strategy engine as deterministic framework-independent PHP services, with immutable DTOs
and fixture-based PHPUnit tests. Do not modify the existing TypeScript system. First implement only
data models, calculation services, and parity tests; do not enable live MT5 execution. Preserve every
completed-candle rule, timeframe mapping, state transition, FIB/engulfing rule, and trade-matrix value.
Clearly list any ambiguity instead of inventing behavior. Use the source-of-truth file map when the
original repository is available. Deliver the work in phases and require parity tests before moving
from Dry Run to demo order placement.
```
