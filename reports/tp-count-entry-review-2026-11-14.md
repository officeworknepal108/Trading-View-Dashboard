# Study objective: increase absolute TP count

The objective here is more winning trades, rather than a higher percentage produced by discarding most setups. Original H4-qualified T1/T2/T3 setups are retained as the candidate population: 312. The 20-pip SL buffer, original pattern-wick stop, maximum risk cap and 1:1 TP remain fixed.

## Pullback-entry simulations

After the same completed engulfing confirmation, test a limit entry retracing 25% or 50% of the confirming candle body from its close toward its open. An immediately available better next open fills at that open. Orders expire after four or eight entry-timeframe bars if not filled. Existing target-before-fill cancellation is retained. TP is recalculated to 1R from the actual entry. Intrabar ordering that cannot be established from OHLC is marked ambiguous, not counted as TP.

| Entry | Setups | TP | SL | Cancelled | Ambiguous | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Original next-open/capped entry | 312 | 161 | 142 | 7 | 1 | 1 | 53.14% | 19 |
| 25% body pullback; wait 4 bars | 312 | 120 | 130 | 49 | 12 | 1 | 48.00% | -10 |
| 50% body pullback; wait 4 bars | 312 | 92 | 100 | 107 | 12 | 1 | 47.92% | -8 |
| 25% body pullback; wait 8 bars | 312 | 121 | 131 | 47 | 12 | 1 | 48.02% | -10 |
| 50% body pullback; wait 8 bars | 312 | 93 | 104 | 102 | 12 | 1 | 47.21% | -11 |

All baseline entry, SL, TP and outcomes reproduce the current H4 CSV exactly. None of the pullback variants increases confirmed TP count or net R. Even treating every ambiguous pullback outcome as TP would not reach the original 161 TP. The problem is missed winning moves and unresolved same-bar fill/target ordering, not just the number of SL.

## Trade frequency versus selection

The current no-bias study has 299 TP / 283 SL (+16R); H4 bias has 161 TP / 142 SL (+19R). Removing bias increases winning trades but also losses, and earns less gross net R. Those counts therefore do not meet the earlier goal of more wins with fewer losses.

## Constraint to resolve

The original requirement is fixed 1:1 TP. A closer target can increase the number of TP hits but lowers the reward per winner. Testing 0.75R or 0.5R requires an explicit change to that study requirement; it has not been assumed or applied. Such a test must compare both TP count and gross/net expectancy, with costs.

No dashboard, live rule, entry, SL or TP setting was changed. These are simulations on recorded setups, not independent forward validation or a complete rescan for newly eligible signals.