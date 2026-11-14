# 50% pullback entries after M15 confirmation

The test retains all 312 original H4-qualified T1/T2/T3 setups, existing volume conditions, 20-pip pattern-wick SL buffer, existing 200-pip maximum risk and fixed 1:1 TP. It changes entry execution only. No dashboard or live settings were changed.

## Definitions

- Body midpoint: (confirmation open + confirmation close) / 2.
- Confirmation range midpoint: (confirmation high + confirmation low) / 2.
- Entire pattern midpoint: (highest high + lowest low across the complete T1/T2/T3 pattern) / 2.
- Orders are placed after confirmation, with a four- or eight-bar fill window (one or two hours of M15 bars). A price already at a better valid entry on a subsequent open fills at that open. The existing risk cap can require a deeper limit than the exact midpoint.
- Once filled, a trade remains open until SL/TP or the study end. TP is always one entry-to-SL distance from the actual entry.
- Unlike the earlier body-pullback experiment, a projected target crossing while the limit is unfilled does not cancel this pullback order. Expiry is fixed instead. TP/SL are evaluated only after a fill.
- On the limit-fill bar, TP is counted only if the close proves a post-fill target crossing and SL was not touched; otherwise conflicting/unknown order is marked ambiguous. Marketable open fills have known entry-before-movement order.

## Results

| Entry definition | Wait | Setups | TP | SL | Expired | Ambiguous | Other | Closed win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Original next-open/capped entry | Original | 312 | 161 | 142 | 0 | 1 | 8 | 53.14% | 19 |
| 50% confirmation candle body | 60 min | 312 | 105 | 107 | 83 | 16 | 1 | 49.53% | -2 |
| 50% confirmation candle body | 120 min | 312 | 110 | 120 | 63 | 18 | 1 | 47.83% | -10 |
| 50% confirmation candle full wick range | 60 min | 312 | 104 | 109 | 83 | 15 | 1 | 48.83% | -5 |
| 50% confirmation candle full wick range | 120 min | 312 | 107 | 120 | 65 | 19 | 1 | 47.14% | -13 |
| 50% entire T1/T2/T3 pattern wick range | 60 min | 312 | 88 | 86 | 112 | 26 | 0 | 50.57% | 2 |
| 50% entire T1/T2/T3 pattern wick range | 120 min | 312 | 98 | 99 | 83 | 32 | 0 | 49.75% | -1 |

The entire-pattern midpoint with a two-hour fill window produces 98 TP / 99 SL, with 83 expired setups and 32 ambiguous fills. It does not increase the original 161 confirmed TP count.

## Why better entry prices did not improve total winners

For the entire-pattern/two-hour variant:

- Of the original 142 SL, 26 become TP, 98 remain SL, three expire, and 15 are ambiguous.
- Of the original 161 TP, 71 remain confirmed TP, 72 never fill before expiry, 17 are ambiguous, and one becomes SL.
- One originally cancelled setup becomes TP.

The gain from converting some losing trades is outweighed by missing the original winning moves. Even if every one of the 32 ambiguous outcomes were optimistically counted as TP, 130 would still be below the original 161.

## Limits

- These are matched recorded-setup simulations, not a complete scan for all newly eligible entries under a different execution model.
- Different wait lengths and pending-order rules change trade counts; they are explicitly listed rather than hidden.
- M15 OHLC cannot fully resolve intrabar order. Finer history would be required to resolve ambiguous fills; they are not assumed wins.
- All results are gross, exclude execution costs and ignore portfolio overlap and position sizing.
- This is retrospective experimentation on the same market history, not independent forward validation.
- The strategy is not applied to the dashboard; the original entry rules remain intact.