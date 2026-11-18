# Scalp 1:1: opposing M15 zones and entry follow-through

Frozen study period: **3 August?18 November 2026, through 07:45 Nepal time**. The same 235 previously approved setups are compared. Baseline reproduces all 416 confirmed arrows, 216 TP arrows, 150 SL arrows and +45.834743R. One full setup risks 1R split 60%/40% across the two legs.

## Main findings

1. **Broad opposing-M15 exclusion improved November but reduced full-sample profit.** It avoided 34 clear losing setups and removed 47 winning setups. Confirmed gross return fell from +45.83R to +30.32R. It reduced the measured closed-equity drawdown, but did not improve overall known profit.
2. **Fib-only and confirmed-zone variants also reduced full-sample profit.** The Fib-only version reduced the closed-equity drawdown from 11.29R to 7.87R while reducing profit from 45.83R to 39.37R. This is a risk/return trade-off on the measured curve, not an established improvement in real account drawdown.
3. **Waiting for a same-direction candle did not improve profit in either tested implementation.** Keeping original limit prices returned +11.56R. Entering at the following open returned +16.60R; its 76 TP / 26 SL setups give a higher win rate, but later entries change reward/risk and reduce total return. These rules were tested using only information available at the delayed decision time.
4. **A separate any-colour delayed market entry was the only full-period profit increase:** +53.00R versus +45.83R. It is a different timing/price rule, not evidence that same-direction confirmation works. Its advantage was inconsistent across months and heavily concentrated in a few trades. Since October, after the illustrative 0.30 cost, its advantage was only about +0.04R. Removing its three largest paired improvements changes its full-period advantage from +7.16R to -6.71R. It needs fresh forward validation, broker execution checks and explicit risk/lot limits before adoption.

## Full-period comparison

All money amounts below assume a **fixed $50 full-setup risk**, with no compounding. Profit totals include only clearly resolved legs. Costs are illustrative, not observed broker costs. TP/SL columns count setups once; PnL weights each filled leg by its allocated risk.

| Rule | TP setups | SL setups | Gross R | Gross USD at $50 risk | Modeled net R, 0.30 cost | Closed-equity gross DD, R |
|---|---:|---:|---:|---:|---:|---:|
| Current strategy | 116 | 75 | +45.83 | $2,291.74 | +41.05 | 11.29 |
| Skip any valid opposing M15 zone | 69 | 41 | +30.32 | $1,515.83 | +27.52 | 7.87 |
| Skip Fib-aligned opposing M15 zone | 86 | 50 | +39.37 | $1,968.54 | +35.91 | 7.87 |
| Skip engulfing-confirmed opposing M15 zone | 90 | 55 | +37.85 | $1,892.61 | +34.26 | 9.29 |
| Skip Fib + engulfing-confirmed M15 zone | 97 | 60 | +40.40 | $2,020.06 | +36.51 | 10.29 |
| Wait one candle; keep original limits, any colour | 80 | 68 | +15.52 | $775.91 | +11.76 | 12.62 |
| Wait for same-direction candle; keep original limits | 33 | 24 | +11.56 | $578.05 | +10.13 | 7.85 |
| Wait one candle; market entry, any colour | 123 | 70 | +53.00 | $2,649.82 | +47.82 | 10.69 |
| Wait for same-direction candle; market entry | 76 | 26 | +16.60 | $829.82 | +14.65 | 7.77 |
| Any opposing M15 filter + same-direction delayed limits | 19 | 15 | +5.44 | $271.88 | +4.56 | 6.85 |
| Confirmed M15 filter + same-direction delayed limits | 25 | 19 | +7.98 | $398.95 | +6.88 | 7.85 |

Drawdown here is calculated from known closed-leg gross returns ordered by their exit candles. It excludes uncertain/open results and concurrent intratrade exposure, so it is not actual live account drawdown.

## Zone filters: winners removed as well as losses avoided

| Rule | Clear TP setups removed | Clear SL setups avoided |
|---|---:|---:|
| Skip any valid opposing M15 zone | 47 | 34 |
| Skip Fib-aligned opposing M15 zone | 30 | 25 |
| Skip engulfing-confirmed opposing M15 zone | 26 | 20 |
| Skip Fib + engulfing-confirmed M15 zone | 19 | 15 |

## Monthly gross returns, R

| Month | Current | Plain M15 skip | Fib M15 skip | Confirmed M15 skip | Fib + confirmed skip | Same-direction delayed limits | Same-direction delayed market | Any-colour delayed market |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-08 | -7.83 | -6.59 | -6.59 | -5.83 | -6.83 | -7.85 | -7.77 | +2.64 |
| 2026-09 | +26.01 | +13.97 | +20.31 | +15.83 | +18.75 | +9.48 | +8.78 | +22.38 |
| 2026-10 | +24.46 | +16.91 | +20.62 | +23.82 | +24.45 | +7.69 | +11.45 | +19.16 |
| 2026-11 | +3.20 | +6.03 | +5.03 | +4.03 | +4.03 | +2.23 | +4.13 | +8.82 |

November alone gave +3.20R current versus +6.03R plain-zone skip, but September and October gave lower returns after applying that skip rule. The month that motivated the idea is not enough to establish the full-history rule.

## History coverage and robustness

The provider could not supply M15 candles earlier than the archived start. Four early setups had fewer than 500 prior M15 bars: their opposing-zone context is unknown and their original entries were retained by every zone-only filter. Two other setups had no valid entry. The assessed-zone cohort contains 229 setups. Additional 2,000- and 5,000-bar history sensitivities avoid implying that short warmup equals a full historical dashboard snapshot.

| Minimum prior M15 history | Setups | Current R | Plain skip R | Fib skip R | Confirmed skip R | Fib + confirmed R |
|---|---:|---:|---:|---:|---:|---:|
| 500 | 229 | +48.189 | +32.670 | +41.725 | +40.206 | +42.755 |
| 2000 | 188 | +51.354 | +34.590 | +43.645 | +41.372 | +44.921 |
| 5000 | 73 | +17.734 | +16.220 | +17.734 | +18.061 | +18.552 |

On the latest 73 setups with a full 5,000-bar M15 history, Fib+confirmed skip increased known gross return from 17.734R to 18.552R. The small recent gain contrasts with its full-period reduction; this is a reason to investigate robustness, not to label it proven.

## Uncertainty and paired checks

| Rule | Uncertain filled arrows | Unknown fill legs | Common determinate setups | Paired baseline R | Paired variant R |
|---|---:|---:|---:|---:|---:|
| Current strategy | 50 | 13 | 203 | +45.83 | +45.83 |
| Skip any valid opposing M15 zone | 28 | 13 | 203 | +45.83 | +30.32 |
| Skip Fib-aligned opposing M15 zone | 36 | 13 | 203 | +45.83 | +39.37 |
| Skip engulfing-confirmed opposing M15 zone | 40 | 13 | 203 | +45.83 | +37.85 |
| Skip Fib + engulfing-confirmed M15 zone | 42 | 13 | 203 | +45.83 | +40.40 |
| Wait one candle; keep original limits, any colour | 45 | 14 | 201 | +43.71 | +14.88 |
| Wait for same-direction candle; keep original limits | 21 | 12 | 201 | +43.71 | +10.93 |
| Wait one candle; market entry, any colour | 52 | 0 | 203 | +45.83 | +52.87 |
| Wait for same-direction candle; market entry | 28 | 0 | 203 | +45.83 | +16.47 |
| Any opposing M15 filter + same-direction delayed limits | 11 | 9 | 202 | +44.81 | +5.44 |
| Confirmed M15 filter + same-direction delayed limits | 15 | 12 | 201 | +43.71 | +7.34 |

The common-determinate comparisons exclude uncertain fills/results from both versions. The broad full-cohort unknown-outcome bounds overlap substantially, so the exact complete economic return is not established. Bounds are in the JSON; they are conservative scenario bounds, not statistical confidence intervals.

## BUY and SELL context

| Side | Setups considered | Current R | Fib M15 skip R | Same-direction market R | Any-colour market R |
|---|---:|---:|---:|---:|---:|
| BUY | 46 | -4.53 | -2.28 | -7.62 | +7.08 |
| SELL | 189 | +50.36 | +41.65 | +24.21 | +45.92 |

## Rules and assumptions

**period**: 2026-11-18T02:00:00.000Z

**cohort**: 235 previously approved setups, 3 Augustâ€“18 November 2026 through 07:45 Nepal; fixed cohort, not requalified using the added zone warmup history.

**zones**: M15 active valid opposing structural zone known at confirmation close, before the original TP for either planned leg. Plain, Fib, completed engulfing confirmation, and Fib+confirmation variants fixed before viewing results. M15 zone analysis has up to 5000 prior closed bars; H1/H4/D support has up to 1500. Under 500 M15 bars is unknown, not no-zone; those setups are retained unchanged by zone filters. Assessed-only, 2000-bar and 5000-bar sensitivities are separate.

**delay**: Orders activate at the second candle open after confirmation, only after the first candle closes; retain original two limit prices, fixed exits, 60/40 budget and original expiry (60 minutes remain). Cancel if the first waiting candle touched an original SL/TP. Same-direction variant rejects dojis and opposite closes. Original limit-price fills are used consistently, without credit for favorable opening-gap improvement. Separate market variants enter at that next open with original fixed SL/TP, resize to the same 60/40 full-setup risk and require a positive stop/target geometry with stop <=300 pips; the two legs have the same market price.

**costs**: Fixed full-setup risk; returns weighted 60/40. Gross and illustrative 0.30 / 0.60 Gold price-unit round-trip cost deductions per closed leg, scaled by its planned stop distance. Not observed spreads/commission; does not resimulate bid/ask execution or lot rounding.

**uncertainty**: Known closed-leg returns only; uncertain outcomes and unproven fills are reported separately, not treated as known wins/losses. Broad gross bounds allow each uncertain filled/unproven leg to lose its allocated share or gain its planned share*RR, so they are conservative scenario bounds, not confidence intervals. Common-determinate pairs exclude uncertainty from both versions. Closed-equity drawdown excludes uncertain/open positions and overlapping intratrade exposure; it is not live portfolio drawdown.

**validation**: Production baseline reconciles all 416 entry arrows, 216 TP, 150 SL and +45.834743R. Earlier/later and monthly comparisons below are retrospective robustness checks, not untouched holdouts. No live code/settings changed.

The two market-entry controls were added after the original delayed-limit results showed missed fills, to distinguish execution timing from fill selection. All variants are exploratory; the earlier/later dates and months are reused historical data, not an independent holdout. No spread/commission is claimed to match either live account. Fixed-risk resizing can alter lot size, so a better simulated R is not automatically an executable improvement.

## Validation

Independent audit checked 3518 leg-variant records: delayed activation, unchanged original limits, next-open market prices, 300-pip market stop cap, same-direction gating, retention of unknown-zone entries, per-month return reconciliation and modeled cost deductions. Synthetic fixtures check delayed TP, pre-activation/expired-order exclusion and missing-candle uncertainty. Production baseline arrow count, fills, outcomes, entry prices and gross R reconcile with archived evidence.

Trading code and settings were unchanged. No live orders were placed for this study.

## Files

- [Complete results and per-setup evidence](scalp-m15-followthrough-research-2026-11-18.json)
- [Summary CSV](scalp-m15-followthrough-research-2026-11-18-summary.csv)
- [All variant decisions and trade ledger](scalp-m15-followthrough-research-2026-11-18-trade-ledger.csv)
- [Independent validation](scalp-m15-followthrough-research-2026-11-18-validation.json)
