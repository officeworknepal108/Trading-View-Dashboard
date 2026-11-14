# 5,000-candle M15 studies: no bias versus H4 bias

Both exports use XAUUSD M15, fixed 1:1, and approximately 31 August?13 November 2026. This compares their recorded outcomes without changing entry, SL or TP.

## Overall comparison

| Bias | Entries | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|
| No bias | 431 | 216 | 208 | 7 | 50.94% | 8 |
| H4 bias | 227 | 129 | 96 | 2 | 57.33% | 33 |

H4 removes 204 entries: 87 TP, 112 SL, four cancelled and one active. This improves closed net R by 25R, while removing winning trades as well. All 227 shared trades have matching entries, SL, TP and outcomes.

## Types with H4 bias

| Type | Entries | TP | SL | Other | Win rate | Closed net R |
|---|---:|---:|---:|---:|---:|---:|
| T1 | 129 | 74 | 55 | 0 | 57.36% | 19 |
| T2 | 62 | 33 | 27 | 2 | 55.0% | 6 |
| T3 | 36 | 22 | 14 | 0 | 61.11% | 8 |

## Frozen filter comparisons

| Filter | No-bias TP/SL | Win rate | Net R | H4 TP/SL | Win rate | Net R |
|---|---:|---:|---:|---:|---:|---:|
| Original | 216/208 | 50.94% | 8 | 129/96 | 57.33% | 33 |
| T1 time window; all T2/T3 | 135/123 | 52.33% | 12 | 81/53 | 60.45% | 28 |
| T1 time window; T2 SELL only; all T3 | 111/84 | 56.92% | 27 | 78/46 | 62.9% | 32 |
| Skip T1; T2 SELL only; all T3 | 71/51 | 58.2% | 20 | 52/34 | 60.47% | 18 |
| All SELL (exploratory) | 128/86 | 59.81% | 42 | 121/81 | 59.9% | 40 |
| T1 only, time window | 40/33 | 54.79% | 7 | 26/12 | 68.42% | 14 |

The previous 64%-candidate rules are T1 in the time window, T2 SELL only, and all T3. The previous 70%-candidate rules skip T1, allow T2 SELL only, and allow all T3. Their earlier short-sample names do not describe their current win rates.

## H4 monthly consistency

| Month | Baseline TP/SL | Win rate | Net R | T1-window/T2-SELL/all-T3 TP/SL | Win rate | Net R |
|---|---:|---:|---:|---:|---:|---:|
| 2026-08 | 0/2 | 0.0% | -2 | 0/2 | 0.0% | -2 |
| 2026-09 | 57/39 | 59.38% | 18 | 32/25 | 56.14% | 7 |
| 2026-10 | 59/33 | 64.13% | 26 | 38/13 | 74.51% | 25 |
| 2026-11 | 13/22 | 37.14% | -9 | 8/6 | 57.14% | 2 |

August has only two H4 trades on 31 August, and November is partial. H4 alone was positive in September and October but negative in November.

## T1-specific finding

H4 plus the fixed time window: 38 trades, 26 TP / 12 SL, 68.42%, +14R. Monthly: September 10/5 (66.67%), October 11/5 (68.75%), November 5/2 (71.43%).

Of these, 20 earlier trades before 15 October were 14 TP / 6 SL (70%); the original later 18 were 12 TP / 6 SL (66.67%). This is a promising consistency check, but only 38 observations across the same market period. It does not cover the missing earlier August history.

Restricting T1 to the time window raises its H4 win rate from 57.36% to 68.42%, but reduces its net R from +19R to +14R because it removes 48 wins and 43 losses. Higher win rate is not automatically higher total return.

## Volume and direction

- H4 T2: V3 below both V1/V2 is 23 TP / 20 SL (53.49%); below V2 only is 10 TP / 7 SL (58.82%).
- H4 T3: V3 below both is 19 TP / 13 SL (59.38%); below V2 only is 3 TP / 1 SL (75%), just four trades. Do not treat that tiny group as dependable.
- H4 SELL: 121 TP / 81 SL (59.90%, +40R); H4 BUY: 8 TP / 15 SL (34.78%, -7R), one active. The sample is heavily SELL-weighted.

## Source overlap and limits

All 431 no-bias trades match the earlier extended analysis in price levels and outcomes. One T2 middle-candle volume was revised by the feed, from 6310 to 6300 on 11 November at 13:15 UTC; its outcome and levels are unchanged. This export therefore does not provide fresh independent validation.

- The two exports cover the same study window; first/last qualifying signals differ because of filtering.
- All 431 no-bias trades were already in the prior extended test; this is not independent validation.
- H4 bias selected 203 SELL trades and 24 BUY trades, so its sample is heavily weighted toward selling.
- T1 time window is confirmation at 00:00 inclusive to before 06:00 UTC (05:45 to before 11:45 Nepal).
- Win rate and closed net R exclude active/cancelled trades and trading costs. Trades may overlap.
- No source code, study rules or live trading settings changed.

No code or trading rules were changed.