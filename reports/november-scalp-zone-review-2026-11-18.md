# November Scalp 1:1: entry-time zone audit

Coverage: 1?18 November 2026, through 08:45 Nepal time. All 10 clear SL setups are compared with the 13 clear TP setups. This extends the earlier candle-only review.

## Main findings

**The current code explicitly exempts SCALP_1_1 from the opposing-zone entry block.** The approved Scalp 1:1 study also qualifies without a source-zone/Fib entry requirement. A valid volume/H4/H1 signal can therefore open while facing an opposing chart zone. This explains admission, not the eventual cause of an individual SL.

| Condition present at entry | SL setups / 10 | TP setups / 13 |
|---|---:|---:|
| Valid opposing M15 zone before TP | 4 | 1 |
| Valid opposing HTF zone before TP (M30/H1/H4/D) | 9 | 7 |
| Fib-aligned opposing M15/HTF zone before TP | 4 | 2 |
| Engulfing-confirmed opposing M15/HTF zone before TP | 3 | 2 |
| Entry already inside an opposing M15/HTF zone | 5 | 4 |
| Later zone touch and close back against trade before exit | 4 | 1 |
| Existing confirmed-zone-before-1R check would flag | 3 | 2 |

An opposing zone must be on the route from the first entry to its fixed TP, or contain the entry, to count in this table. Active valid structural zones, Fib alignment and completed engulfing confirmation are measured separately. M5 observations are in the raw JSON, not mixed into the M15/HTF table above.

**The strongest entry-time distinction is the M15 obstacle: 4/10 losses versus 1/13 winners.** Broad HTF obstacles are common in both groups (9/10 and 7/13). A blanket HTF exclusion would remove substantial winning evidence too. These are exploratory comparisons from only 23 resolved setups, with overlapping conditions and no independent holdout.

## Every losing setup

Signal times below are Nepal time, identifying the confirming M15 candle open.

### 2026-11-02 16:00 ? BEARISH T1

SELL opened inside the opposing M15 BUY ISS L4 at 3892.735?3902.266 and Daily BUY TJL2 at 3886.465?3953.370. M15 BUY confirmation already existed. Price rose to the sell SL. This is a concrete same-timeframe conflict missed by the Scalp exemption.
First entry **3895.334**, fixed SL **3903.200**, fixed TP **3886.830**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| M15 | ISS L4 BUY | 3892.735?3902.265 | 0.00R | Yes | Yes | No |
| D | TJL2 BUY | 3886.465?3953.370 | 0.00R | No | No | No |
| M15 | Internal TJL2 BUY | 3892.910?3895.020 | 0.04R | No | Yes | No |

### 2026-11-02 17:30 ? BEARISH T1

Another SELL faced the same confirmed M15 BUY ISS L4 and Daily BUY TJL2. Price later touched the M15 band and closed back above its upper edge before the sell SL. The two early sells are related observations from the same opposing support area, not independent confirmations of a universal rule.
First entry **3901.789**, fixed SL **3909.995**, fixed TP **3892.845**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| M15 | ISS L4 BUY | 3892.735?3902.265 | 0.00R | Yes | Yes | Yes |
| D | TJL2 BUY | 3886.465?3953.370 | 0.00R | No | No | No |
| M15 | Internal TJL2 BUY | 3892.910?3895.020 | 0.82R | Yes | Yes | No |

### 2026-11-03 04:45 ? BEARISH T2

SELL entry sat inside the broad Daily BUY TJL2 at 3886.465?3953.370. No valid opposing M15 zone was found before TP. The Daily zone had no qualifying engulfing confirmation in the checked route at entry, so this is structural context rather than a confirmed-block violation.
First entry **3944.013**, fixed SL **3951.110**, fixed TP **3936.250**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| D | TJL2 BUY | 3886.465?3953.370 | 0.00R | No | No | No |

### 2026-11-04 16:15 ? BEARISH T2

SELL faced H1 BUY Internal RBS at 4022.847?4032.610, about 0.67R away. Price touched it and closed back above the band before eventually hitting the sell SL. This is observed HTF support interaction. The zone was not engulfing-confirmed at this first entry.
First entry **4040.584**, fixed SL **4052.520**, fixed TP **4027.580**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| H1 | Internal RBS BUY | 4022.847?4032.610 | 0.67R | No | No | Yes |

### 2026-11-04 22:00 ? BEARISH T3

SELL faced the same H1 BUY Internal RBS, now engulfing-confirmed, around 0.76R away. The existing non-Scalp opposing-zone check would flag it. SL occurred in the entry candle, so OHLC cannot establish a separate zone-touch/rejection sequence before the stop.
First entry **4042.025**, fixed SL **4054.375**, fixed TP **4028.765**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| H1 | Internal RBS BUY | 4022.847?4032.610 | 0.76R | No | Yes | No |

### 2026-11-06 18:00 ? BULLISH T3

BUY opened inside Daily SELL SUPPLY at 4061.240?4082.825 and Daily SELL ISS L3 at 4066.535?4111.883. Price traded in these bands and closed below their lower edges before the buy SL. No valid opposing M15 obstacle was found. These Daily zones were structural, not engulfing-confirmed in the checked route.
First entry **4069.471**, fixed SL **4056.480**, fixed TP **4083.760**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| D | ISS L3 SELL | 4066.535?4111.883 | 0.00R | No | No | Yes |
| D | SUPPLY SELL | 4061.240?4082.825 | 0.00R | No | No | Yes |
| D | Internal TJL2 SELL | 4067.229?4082.825 | 0.00R | No | No | No |

### 2026-11-09 07:15 ? BULLISH T1

BUY faced Fib-aligned H1 SELL ISS L4 at 4126.965?4128.130, only about 0.23R above entry. Price reached it and closed back below the band before SL. This is the clearest close opposing Fib-aligned HTF obstacle; it had no qualifying completed opposing engulfing at entry under the checked route.
First entry **4121.972**, fixed SL **4099.840**, fixed TP **4139.840**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| H1 | ISS L4 SELL | 4126.965?4128.130 | 0.23R | Yes | No | Yes |

### 2026-11-10 18:30 ? BULLISH T2

BUY opened inside Daily SELL SUPPLY/ISS/Internal TJL2 bands. M15 and M30 SELL SBR near 4084.485?4086.820 were also before TP. The trade hit SL in the next candle, with no later completed-candle touch of those upper SBR levels: the unvisited SBR itself is not demonstrated as the cause.
First entry **4078.933**, fixed SL **4070.365**, fixed TP **4087.735**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| D | ISS L3 SELL | 4066.535?4111.883 | 0.00R | No | No | No |
| D | SUPPLY SELL | 4061.240?4082.825 | 0.00R | No | No | No |
| D | Internal TJL2 SELL | 4067.229?4082.825 | 0.00R | No | No | No |
| M15 | SBR SELL | 4084.485?4086.732 | 0.65R | No | No | No |
| M30 | SBR SELL | 4084.485?4086.820 | 0.65R | No | No | No |

### 2026-11-10 20:45 ? BULLISH T1

BUY faced Daily SELL supply and Fib-aligned M15/M30 SELL TJL1 around 4068.715?4075.055 before TP. The later M15 target-side zones were not reached before SL. Recent H1/M15 momentum opposed the buy. This is a direction-failure case with obstacles ahead, not demonstrated rejection at those unvisited levels.
First entry **4050.206**, fixed SL **4030.030**, fixed TP **4070.030**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| D | SUPPLY SELL | 4061.240?4082.825 | 0.55R | No | No | No |
| D | ISS L3 SELL | 4066.535?4111.883 | 0.81R | No | No | No |
| D | Internal TJL2 SELL | 4067.229?4082.825 | 0.84R | No | No | No |
| M15 | TJL1 SELL | 4068.715?4075.055 | 0.92R | Yes | No | No |
| M30 | TJL1 SELL | 4068.715?4073.060 | 0.92R | Yes | No | No |

### 2026-11-16 12:15 ? BEARISH T1

SELL was fully inside the earlier mother candle, but no valid opposing M15/HTF zone before TP was found. H4 direction/EMA aligned; the first entry candle closed against the sell. A zone explanation should not be invented for this case.
First entry **3842.938**, fixed SL **3867.790**, fixed TP **3827.790**.

| TF | Opposing zone | Range | Distance / first-leg risk | Fib aligned | Engulf confirmed at entry | Later rejection close |
|---|---|---:|---:|---|---|---|
| ? | No qualifying obstacle found | ? | ? | ? | ? | ? |

## Repeat-loss area check

Scalp 1:1 is also explicitly exempt from the rule that blocks a previously stopped price area until a fresh M15 CHoCH. Replaying that isolated check against earlier confirmed chart SLs would flag the 2 November 17:30 losing SELL. It would also flag five winning setups in this month. This is not evidence to enable that rule blindly, and it is not a reconstruction of account-specific executed trade history. Earlier losses enter this check only after their SL candle closes. Combining it with other filters would change the sequence of prior trades and requires a fresh simulation.

Both entry legs were checked against the saved active zone geometry; the M15/HTF obstacle yes/no classifications were unchanged between the two legs in all 23 resolved setups. All 10 interactive chart choices rendered successfully in a local browser, including candle canvases and populated zone tables.

## Method and limits

Closed candles only, cutoff at confirmation close; rolling 5000 bars M5/M15/M30 and 1500 H1/H4/D. Historical M1 unavailable for all entries, so no M1 claims.

Same market structure engine, mapped confirmation timing, VIP support, H4 Swing Fib, current-day Nepal Fib and post-CHoCH H1 Fib functions as the dashboard/server. Only active valid zones count as obstacles; pending zones are listed separately. All price obstacles are measured against actual first-leg entry and fixed TP.

Reconstruction depends on available OHLC and rolling history. Zones are as known at entry, not hindsight-created zones. Reaction checks exclude both fill and exit candles and cannot prove causation. Plain, Fib-aligned and engulfing-confirmed zones are distinct. M5 context has shorter warmup than M15. Spread, slippage, historical news and account-specific execution constraints are not resolved by OHLC.

Only candles closed by the confirming candle close were used to establish the entry snapshots. No zone first created after the trade was counted. Reaction checks use later M15 candles strictly between fill and exit; entry/exit candle order is left unresolved. After-entry zones are retained as price references; continued validity at every later candle is not assumed. Distances/flags in the main table use the first pullback entry; the second leg is shown on the chart.

The review does not cover every possible cause. It cannot establish historical news timing, order-book liquidity, live spreads/slippage or M1 context for all early-month entries. Forming HTF intrabar geometry is omitted. Rolling history may differ from what was loaded on the original trading day. No findings are represented as proven market causation.

## Review artifacts

- [Interactive charts for all 10 losses](november-scalp-zone-review-2026-11-18.html)
- [Full snapshots, zone states and winner comparisons](november-scalp-zone-review-2026-11-18.json)

Research direction: test a narrowly defined M15/HTF opposing-zone rule against all available months and fresh data, retaining the same entries, risk, target and transaction-cost assumptions. Keep plain zone presence separate from confirmed and Fib-aligned obstacles. No live rule was changed by this audit.

Validation: checked all 23 outcomes, opposing-side geometry, nonnegative distances, historical zone-origin timestamps, separate SL/TP comparison denominators and the explicit Scalp exemption.
