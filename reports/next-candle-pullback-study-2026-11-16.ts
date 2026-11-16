import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { scalpOneToOneVolumePasses } from '../src/services/mt5Automation';
import { volumeStudyLevels } from '../src/services/volumeEngulfingStudy';
import { evaluateStudyOutcome } from '../src/services/trendlineStudy';

// Offline descriptive research only: reads archived history; writes reports only.
// No server import, broker access, settings changes or order submission.
const stem = 'next-candle-pullback-study-2026-11-16';
const files = ['volume-gap-study-2026-11-15.json',
  'five-month-m15-history-older.json', 'five-month-m15-history-latest.json'];
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const archive = read(files[0]);
const byTime = new Map<number, any>();
let duplicates = 0, conflictingOHLC = 0;
for (const name of files.slice(1)) for (const c of read(name)) {
  assert.ok([c.time, c.open, c.high, c.low, c.close].every(Number.isFinite));
  assert.ok(c.high >= Math.max(c.open, c.close, c.low) && c.low <= Math.min(c.open, c.close));
  const prior = byTime.get(c.time);
  if (prior) {
    duplicates++;
    if (['open', 'high', 'low', 'close'].some(k => Math.abs(prior[k] - c[k]) > 1e-8)) conflictingOHLC++;
  }
  // Preserve the completed version if a duplicate last bar is labelled incomplete.
  if (!prior || c.complete !== false || prior.complete === false) byTime.set(c.time, c);
}
assert.equal(conflictingOHLC, 0, 'Overlapping feeds must agree on OHLC');
const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
const indexByTime = new Map(candles.map((c, i) => [c.time, i]));
const eligible = archive.rows.filter((r: any) => scalpOneToOneVolumePasses(r.type,
  r.volume1, r.volume2, r.volume3));
assert.equal(eligible.length, 227, 'Current minimum-volume-gap strategy parity');
assert.equal(new Set(eligible.map((r: any) => r.time)).size, eligible.length);
const rows: any[] = [], excluded: any[] = [];
let levelParity = 0, outcomeParity = 0;
for (const r of eligible) {
  const i = indexByTime.get(r.time);
  assert.ok(i !== undefined && i >= 2);
  const confirmation = candles[i], next = candles[i + 1];
  if (!next || next.time !== confirmation.time + 900 || next.complete === false
    || confirmation.complete === false) {
    excluded.push({ time: r.time, reason: 'Missing/nonconsecutive/incomplete next M15 candle' });
    continue;
  }
  const body = Math.abs(confirmation.close - confirmation.open);
  assert.ok(body > 0);
  const buy = r.direction === 'bullish';
  assert.equal(buy, confirmation.close > confirmation.open, `confirmation side ${r.time}`);
  const levels = volumeStudyLevels(candles, r.levels.signal, next);
  assert.ok(levels);
  for (const key of ['entry', 'stopLoss', 'takeProfit'] as const)
    assert.ok(Math.abs(levels[key] - r.levels[key]) < 1e-7, `${key} parity ${r.time}`);
  levelParity++;
  const replay = evaluateStudyOutcome(levels, candles, 'fixed');
  assert.equal(replay.outcome, r.outcome, `outcome parity ${r.time}`);
  assert.equal(replay.filledAt, r.filledAt);
  assert.equal(replay.resolvedAt, r.resolvedAt);
  outcomeParity++;
  const extreme = buy ? next.low : next.high;
  const direction = buy ? 1 : -1;
  const dip = Math.max(0, direction * (next.open - extreme));
  const closeRetracement = Math.max(0, direction * (confirmation.close - extreme));
  const actualWick = buy ? Math.min(next.open, next.close) - next.low
    : next.high - Math.max(next.open, next.close);
  rows.push({ signalUTC: r.signalUTC, nextUTC: new Date(next.time * 1000).toISOString(),
    side: buy ? 'buy' : 'sell', type: r.type, originalOutcome: r.outcome,
    originalCappedEntry: r.levels.pendingAtCreation, period: r.period,
    confirmationOpen: confirmation.open, confirmationClose: confirmation.close,
    confirmationBody: body, nextOpen: next.open, nextHigh: next.high, nextLow: next.low,
    nextClose: next.close, dipPrice: dip, dipPips: dip / 0.1,
    dipBodyPercent: dip / body * 100,
    closeRetracementBodyPercent: closeRetracement / body * 100,
    actualWickBodyPercent: actualWick / body * 100,
    nextClosesInSignalDirection: direction * (next.close - next.open) > 1e-8,
    openingGapBodyPercent: direction * (next.open - confirmation.close) / body * 100,
    nextTouchesOriginalSL: buy ? next.low <= levels.stopLoss : next.high >= levels.stopLoss,
    volumeGap: r.gap });
}
assert.equal(excluded.length, 0);
const eps = 1e-8, thresholds = [10, 25, 33, 50, 75, 100, 150, 200];
const pct = (n: number, d: number) => d ? n / d * 100 : null;
const quantile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * p;
  const lower = Math.floor(index), fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.ceil(index)] * fraction;
};
function summary(input: any[]) {
  const count = input.length;
  const depths = input.map(r => r.dipBodyPercent);
  const anyDip = input.filter(r => r.dipPrice > eps).length;
  const cumulative = thresholds.map(threshold => {
    const reached = input.filter(r => r.dipBodyPercent + eps >= threshold);
    const fromClose = input.filter(r => r.closeRetracementBodyPercent + eps >= threshold);
    return { threshold, reached: reached.length, percent: pct(reached.length, count),
      notReached: count - reached.length,
      reachedAndClosesInSignalDirection: reached.filter(r => r.nextClosesInSignalDirection).length,
      reachedAndTouchesOriginalSL: reached.filter(r => r.nextTouchesOriginalSL).length,
      fromConfirmationCloseReached: fromClose.length,
      fromConfirmationClosePercent: pct(fromClose.length, count),
      byOriginalOutcome: Object.fromEntries(['tp', 'sl', 'active', 'pending', 'cancelled', 'ambiguous']
        .map(outcome => [outcome, { total: input.filter(r => r.originalOutcome === outcome).length,
          reached: reached.filter(r => r.originalOutcome === outcome).length }])) };
  });
  for (let i = 1; i < cumulative.length; i++) assert.ok(cumulative[i].reached <= cumulative[i - 1].reached);
  const bins = [[0, 10], [10, 25], [25, 50], [50, 75], [75, 100], [100, 150], [150, 200], [200, Infinity]];
  const distribution = [{ range: 'No dip', count: count - anyDip }, ...bins.map(([low, high]) => ({
    range: low === 0 ? '>0 to <10%' : high === Infinity ? '200% or more' : `${low} to <${high}%`,
    count: input.filter(r => r.dipPrice > eps && r.dipBodyPercent + eps >= low
      && r.dipBodyPercent + eps < high).length }))];
  assert.equal(distribution.reduce((sum, b) => sum + b.count, 0), count);
  return { count, anyDip, anyDipPercent: pct(anyDip, count),
    hasActualWick: input.filter(r => r.actualWickBodyPercent > eps).length,
    dipAndClosesInSignalDirection: input.filter(r => r.dipPrice > eps && r.nextClosesInSignalDirection).length,
    originalCappedEntries: input.filter(r => r.originalCappedEntry).length,
    nextTouchesOriginalSL: input.filter(r => r.nextTouchesOriginalSL).length,
    bodyPercentQuantiles: Object.fromEntries([0.1, 0.25, 0.5, 0.75, 0.9, 0.95]
      .map(p => [`p${p * 100}`, quantile(depths, p)])),
    medianDipPrice: quantile(input.map(r => r.dipPrice), 0.5),
    medianDipPips: quantile(input.map(r => r.dipPips), 0.5),
    distribution, cumulative };
}
const groups = { all: summary(rows), buy: summary(rows.filter(r => r.side === 'buy')),
  sell: summary(rows.filter(r => r.side === 'sell')) };
const output = { method: {
  market: 'Archived OANDA XAUUSD M15; existing Scalp 1:1 qualified setups only.',
  eligibility: 'T1/T2/T3; H4 structure + EMA20/50; H1 continuation/Far; 30-pip pattern SL buffer; minimum 250-unit volume decrease. Existing archived entry eligibility is retained.',
  primaryMetric: 'BUY: max(0, next open - next low) / abs(confirmation close - confirmation open) * 100. SELL mirrors with next high - next open.',
  alternateMetric: 'BUY: max(0, confirmation close - next low) / confirmation body * 100; SELL mirrors. This corresponds to the earlier suggested close-minus-body-fraction limit price.',
  interpretation: 'Cumulative percentages are price-touch frequencies within the entire immediate next M15 candle, not win rates, broker fill probabilities, or identification of the future low. 100% means one confirming candle body, not a 100% move in gold price.',
  wick: 'The primary metric includes next candles that continue against the signal. Actual wick and close-in-signal-direction counts are recorded separately. A dip is not necessarily rejection.',
  scope: 'Includes all eligible archived outcomes, not only winners or filled trades. Does not rescan signals rejected under original entry rules. Exact consecutive completed next bars required.',
  timing: 'No inference about whether dip occurred before a rally, TP or SL. M15 OHLC cannot resolve order. Touch can occur after the original setup was invalidated. No hypothetical PnL estimated.',
  limitations: 'Retrospective descriptive sample of about 3.5 months. No spread, bid/ask, commission, slippage, live trading gates or portfolio constraints; repeated signals can be dependent. Thresholds are not optimized or forward validated.',
  pips: 'Existing dashboard gold convention: 1 pip = 0.1 price units.',
  firstSignal: rows[0].signalUTC, lastSignal: rows.at(-1).signalUTC,
  historyFirst: new Date(candles[0].time * 1000).toISOString(),
  historyLastCompletedClose: new Date((candles.filter(c => c.complete !== false).at(-1).time + 900) * 1000).toISOString(),
  archivedSetups: archive.rows.length, qualified: eligible.length, analysed: rows.length, excluded,
  uniqueCandles: candles.length, duplicates, conflictingOHLC, levelParity, outcomeParity,
  inputs: files.map(file => ({ file, sha256: crypto.createHash('sha256')
    .update(fs.readFileSync(new URL(file, import.meta.url))).digest('hex') })),
}, groups,
  byTypeAndSide: Object.fromEntries(['buy', 'sell'].flatMap(side => ['T1', 'T2', 'T3']
    .map(type => [`${side}-${type}`, summary(rows.filter(r => r.side === side && r.type === type))]))),
  byPeriodAndSide: Object.fromEntries(['buy', 'sell'].flatMap(side => ['earlier', 'later']
    .map(period => [`${side}-${period}`, summary(rows.filter(r => r.side === side && r.period === period))]))),
  rows };
fs.writeFileSync(new URL(`${stem}.json`, import.meta.url), JSON.stringify(output, null, 2) + '\n');
const columns = Object.keys(rows[0]);
fs.writeFileSync(new URL(`${stem}-candles.csv`, import.meta.url), [columns.join(','),
  ...rows.map(r => columns.map(k => r[k]).join(','))].join('\n') + '\n');
const f = (n: number | null) => n === null ? 'n/a' : n.toFixed(1);
const reachTable = (key: 'reached' | 'fromConfirmationCloseReached') => [
  '| Pullback threshold | Buy candles | Buy % | Sell candles | Sell % | Combined % |',
  '|---:|---:|---:|---:|---:|---:|',
  ...thresholds.map((threshold, i) => { const b = groups.buy.cumulative[i], s = groups.sell.cumulative[i], a = groups.all.cumulative[i];
    return `| At least ${threshold}% | ${b[key]}/${groups.buy.count} | ${f(pct(b[key], groups.buy.count))}% | ${s[key]}/${groups.sell.count} | ${f(pct(s[key], groups.sell.count))}% | ${f(pct(a[key], groups.all.count))}% |`; }),
].join('\n');
const lines = ['# Next-M15-candle pullback depth after Scalp 1:1 engulfing', '',
  `Analysed ${rows.length} archived eligible setups: ${groups.buy.count} buys and ${groups.sell.count} sells. Signal dates: ${rows[0].signalUTC} through ${rows.at(-1).signalUTC}. This is about 3.5 months, not five months.`, '',
  `Buy finding: ${groups.buy.anyDip}/${groups.buy.count} next candles dip below their open. At least 25% body-depth is reached by ${groups.buy.cumulative[1].reached}/${groups.buy.count} (${f(groups.buy.cumulative[1].percent)}%); at least 50% by ${groups.buy.cumulative[3].reached}/${groups.buy.count} (${f(groups.buy.cumulative[3].percent)}%). Only ${groups.buy.dipAndClosesInSignalDirection}/${groups.buy.count} dip and finish bullish. These observations do not establish a profitable entry rule.`, '',
  '## Definition', '',
  'For a BUY: pullback % = (next candle open - next candle low) / confirming engulfing candle body x 100, floored at zero. A SELL uses (next candle high - next candle open). The confirming body is abs(close - open), including for T2/T3; it is not the whole multi-candle pattern or wick range.', '',
  'Example: engulfing open 3000, close 3010 (body 10); next open 3010, low 3007.50 => 25% pullback. Percentages above 100% are possible. A 25% pullback measured from the next open differs from a limit 25% below the previous close when there is an opening gap.', '',
  '## Cumulative reach measured from next open', '', reachTable('reached'), '',
  'These rows overlap: a candle reaching 75% also reaches 50% and 25%. Counts are touches at any point during that candle, not wins or guaranteed executable fills.', '',
  '## Non-overlapping depth buckets', '',
  '| Maximum next-candle depth | Buy count | Sell count |', '|---|---:|---:|',
  ...groups.buy.distribution.map((b, i) => `| ${b.range} | ${b.count} | ${groups.sell.distribution[i].count} |`), '',
  '## Dip versus recovery', '',
  ...(['buy', 'sell'] as const).map(side => { const g = groups[side];
    return `- ${side}: ${g.anyDip}/${g.count} (${f(g.anyDipPercent)}%) move adversely from the next open; ${g.dipAndClosesInSignalDirection}/${g.count} both dip and close back in the signal direction. ${g.hasActualWick}/${g.count} have a nonzero actual lower/upper wick. ${g.nextTouchesOriginalSL}/${g.count} touch the original pattern SL during that next candle. Median maximum dip: ${f(g.bodyPercentQuantiles.p50)}% of the confirmation body, or ${f(g.medianDipPrice)} gold price units (${f(g.medianDipPips)} dashboard pips).`; }), '',
  '## Alternate: limit level measured from engulfing close', '',
  'This matches the earlier suggested buy limit = engulfing close minus percentage of engulfing body (sell mirrored). A gap can make the limit marketable immediately; these remain price reach counts, not order simulations.', '',
  reachTable('fromConfirmationCloseReached'), '',
  '## Which original winners and losers dip?', '',
  'Buy setups only. Original outcomes retain the original entry and 1:1 target. This is a descriptive cross-tab, not the outcome of entering at a pullback price.', '',
  '| Pullback from next open | Original TP reaching it | Original SL reaching it | Reached and next closes bullish |',
  '|---:|---:|---:|---:|',
  ...groups.buy.cumulative.map(v => `| ${v.threshold}% | ${v.byOriginalOutcome.tp.reached}/${v.byOriginalOutcome.tp.total} | ${v.byOriginalOutcome.sl.reached}/${v.byOriginalOutcome.sl.total} | ${v.reachedAndClosesInSignalDirection}/${v.reached} |`), '',
  '## Chronological cross-check', '',
  'Earlier = before 2026-10-01 UTC; later = from that date. Both periods have already been researched previously; neither is an untouched holdout.', '',
  '| Side / period | Setups | Reaches 25% | Reaches 50% | Median depth |', '|---|---:|---:|---:|---:|',
  ...Object.entries(output.byPeriodAndSide).map(([name, g]) => `| ${name} | ${g.count} | ${g.cumulative[1].reached} (${f(g.cumulative[1].percent)}%) | ${g.cumulative[3].reached} (${f(g.cumulative[3].percent)}%) | ${f(g.bodyPercentQuantiles.p50)}% |`), '',
  '## Validation and scope', '',
  ...Object.entries(output.method).map(([k, v]) => `- **${k}:** ${typeof v === 'object' ? JSON.stringify(v) : v}`), '',
  'No live trading or dashboard rules were changed. No entry percentage is declared optimal. A deeper reachable price can belong to a failed engulfing rather than a profitable rejection. Tick/lower-timeframe order replay and cost-aware outcome testing are needed before changing execution.', '',
  `Reproduce: npx.cmd tsx reports/${stem}.ts`, '',
  `Detailed candles: ${stem}-candles.csv. Full statistics and source hashes: ${stem}.json.`, '',
];
fs.writeFileSync(new URL(`${stem}.md`, import.meta.url), lines.join('\n'));
console.log(JSON.stringify({ analysed: rows.length, levelParity, outcomeParity,
  sides: Object.fromEntries(Object.entries(groups).map(([side, g]) => [side, {
    count: g.count, anyDip: g.anyDip, medianBodyPercent: g.bodyPercentQuantiles.p50,
    cumulative: g.cumulative.map(v => ({ threshold: v.threshold, count: v.reached, percent: v.percent })),
  }])) }, null, 2));
