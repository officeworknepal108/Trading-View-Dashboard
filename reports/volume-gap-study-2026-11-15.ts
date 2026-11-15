import fs from 'node:fs';
import assert from 'node:assert/strict';
import { evaluateStudyOutcome } from '../src/services/trendlineStudy';
import { volumeStudyLevels } from '../src/services/volumeEngulfingStudy';
import { assessEngulfingVolumeLogic } from '../src/services/tradeLevels';

// Offline research only. Does not import the server, write settings or submit orders.
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const archived = read('h1-far-filter-buffer-research-2026-11-15.json')
  .find((variant: any) => variant.name === '30-pip buffer');
assert.ok(archived);
const candles: any[] = [...new Map<number, any>([
  ...read('five-month-m15-history-older.json'), ...read('five-month-m15-history-latest.json'),
].map((c: any) => [c.time, c] as [number, any])).values()]
  .sort((a, b) => a.time - b.time);
const indexByTime = new Map(candles.map((c, i) => [c.time, i]));
const split = Date.parse('2026-10-01T00:00:00Z') / 1000;
const rows = archived.records.map((r: any) => {
  const index = indexByTime.get(r.time);
  assert.ok(index !== undefined && index >= 2);
  const signal = r.levels.signal;
  const assessment = assessEngulfingVolumeLogic(candles, signal);
  assert.equal(assessment.passes, true, `archived volume qualification ${r.time}`);
  const reference = signal.type === 'T1' ? assessment.firstVolume! : assessment.secondVolume!;
  const confirming = signal.type === 'T1' ? assessment.secondVolume! : assessment.thirdVolume!;
  assert.ok(Number.isFinite(reference) && reference > 0 && confirming < reference);
  const levels = volumeStudyLevels(candles, signal, candles[index + 1]);
  assert.ok(levels);
  for (const field of ['entry', 'stopLoss', 'takeProfit'] as const) {
    assert.ok(Math.abs(levels[field] - r.levels[field]) < 0.000001, `${field} parity ${r.time}`);
  }
  const replay = evaluateStudyOutcome(levels, candles, 'fixed');
  assert.equal(replay.outcome, r.outcome, `outcome parity ${r.time}`);
  assert.equal(replay.filledAt, r.filledAt);
  assert.equal(replay.resolvedAt, r.resolvedAt);
  return { ...r, volume1: assessment.firstVolume, volume2: assessment.secondVolume,
    volume3: assessment.thirdVolume, referenceVolume: reference, confirmingVolume: confirming,
    gap: reference - confirming, gapPercent: (reference - confirming) / reference * 100,
    period: r.time < split ? 'earlier' : 'later' };
});
assert.equal(rows.length, 252);

function summarize(input: any[]) {
  const tp = input.filter(r => r.outcome === 'tp').length;
  const sl = input.filter(r => r.outcome === 'sl').length;
  const completed = tp + sl;
  return { setups: input.length, tp, sl, other: input.length - completed, completed,
    winRate: completed ? tp / completed * 100 : null, netR: tp - sl,
    meanR: completed ? (tp - sl) / completed : null };
}
const baseline = summarize(rows);
assert.equal(baseline.tp, 140); assert.equal(baseline.sl, 104);
assert.equal(baseline.netR, 36);
const percentThresholds = [0, 1, 2, 5, 10, 15, 20, 25, 30, 40, 50];
const unitThresholds = [0, 10, 25, 50, 100, 250, 500, 1000];
function variant(kind: 'percent' | 'units', minimum: number) {
  const keep = (r: any) => minimum === 0 || (kind === 'percent' ? r.gapPercent : r.gap) >= minimum;
  const retained = rows.filter(keep), removed = rows.filter((r: any) => !keep(r));
  const months = [...new Set(rows.map((r: any) => r.signalUTC.slice(0, 7)))].sort();
  return { minimum, all: summarize(retained), removed: summarize(removed),
    earlier: summarize(retained.filter((r: any) => r.period === 'earlier')),
    later: summarize(retained.filter((r: any) => r.period === 'later')),
    byType: Object.fromEntries(['T1', 'T2', 'T3'].map(type => [type, summarize(retained.filter((r: any) => r.type === type))])),
    bySide: Object.fromEntries(['bullish', 'bearish'].map(side => [side, summarize(retained.filter((r: any) => r.direction === side))])),
    bySignalMonth: Object.fromEntries(months.map(month => [month, summarize(retained.filter((r: any) => r.signalUTC.startsWith(month)))])),
    netRChange: summarize(retained).netR - baseline.netR };
}
const percent = percentThresholds.map(value => variant('percent', value));
const units = unitThresholds.map(value => variant('units', value));
// Select using earlier net R only; equal values prefer retaining more completed trades.
const selected = [...percent].sort((a, b) => b.earlier.netR - a.earlier.netR
  || b.earlier.completed - a.earlier.completed || a.minimum - b.minimum)[0];
const selectedUnits = [...units].sort((a, b) => b.earlier.netR - a.earlier.netR
  || b.earlier.completed - a.earlier.completed || a.minimum - b.minimum)[0];
for (const variants of [percent, units]) {
  for (let i = 0; i < variants.length; i++) {
    assert.equal(variants[i].all.tp + variants[i].removed.tp, baseline.tp);
    assert.equal(variants[i].all.sl + variants[i].removed.sl, baseline.sl);
    if (i) assert.ok(variants[i].all.setups <= variants[i - 1].all.setups);
  }
}
const output = {
  method: {
    strategy: 'Archived Scalp 1:1: M15 T1/T2/T3, H4 structure + EMA20/50, H1 continuation/Far, 30-pip buffer, fixed 1:1 target.',
    source: '252 previously qualified archived setups; entry, SL, TP, fill time and outcome replayed against current functions and cached OHLC.',
    volumeSource: 'The volume values stored in the archived candle feed; raw units depend on that feed. Not MT5 trade lot size.',
    gap: 'T1: V1 - V2. T2/T3: V2 - V3, matching the current basic volume requirement. Existing V3-versus-V1 best-quality classification unchanged.',
    percent: '100 * (reference volume - confirming volume) / reference volume. Threshold is inclusive (>=); baseline retains the existing strict decrease.',
    endpoints: 'Filtering removes setups only. Each retained setup keeps its original entry, SL and TP; no trade changes from SL to TP.',
    evaluation: 'Independent setups; overlapping trades permitted as in the original study. No spread, commission, slippage, compounding, live session/news/position limits or operational fill restrictions.',
    other: 'Pending, active, cancelled or intrabar-ambiguous outcomes excluded from win rate and net R.',
    split: 'Earlier: signal before 2026-10-01 UTC; later: from that date. Chronological cross-check, not a previously untouched holdout.',
    selection: 'Each threshold family selected on earlier-period net R; ties retain more completed trades. All-period best values are exploratory.',
    firstSignal: rows[0].signalUTC, lastSignal: rows.at(-1).signalUTC,
    candlesThrough: new Date((candles.at(-1).time + 900) * 1000).toISOString(),
    parityChecksPassed: rows.length,
  }, baseline, selectedUsingEarlierData: selected.minimum,
  selectedUnitsUsingEarlierData: selectedUnits.minimum, percent, units, rows,
};
const stem = 'volume-gap-study-2026-11-15';
fs.writeFileSync(new URL(`${stem}.json`, import.meta.url), JSON.stringify(output, null, 2));
const summaryCsv = ['kind,minimum,setups,tp,sl,other,win_rate_pct,net_r,removed_tp,removed_sl,earlier_net_r,later_net_r',
  ...(['percent', 'units'] as const).flatMap(kind => (kind === 'percent' ? percent : units).map(v =>
    [kind, v.minimum, v.all.setups, v.all.tp, v.all.sl, v.all.other, v.all.winRate, v.all.netR,
      v.removed.tp, v.removed.sl, v.earlier.netR, v.later.netR].join(',')))];
fs.writeFileSync(new URL(`${stem}.csv`, import.meta.url), summaryCsv.join('\n') + '\n');
const tradeColumns = ['signalUTC', 'type', 'direction', 'volume1', 'volume2', 'volume3', 'gap', 'gapPercent', 'outcome', 'period'];
fs.writeFileSync(new URL(`${stem}-trades.csv`, import.meta.url), [tradeColumns.join(','),
  ...rows.map((r: any) => tradeColumns.map(key => r[key] ?? '').join(','))].join('\n') + '\n');
const table = (variants: typeof percent) => [
  '| Minimum gap | Setups | TP | SL | Other | Win rate | Net R | Removed TP | Removed SL | Earlier R | Later R |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...variants.map(v => `| ${v.minimum} | ${v.all.setups} | ${v.all.tp} | ${v.all.sl} | ${v.all.other} | ${v.all.winRate?.toFixed(2)}% | ${v.all.netR} | ${v.removed.tp} | ${v.removed.sl} | ${v.earlier.netR} | ${v.later.netR} |`),
].join('\n');
fs.writeFileSync(new URL(`${stem}.md`, import.meta.url), [
  '# Scalp 1:1 minimum volume gap study', '',
  ...Object.entries(output.method).map(([key, value]) => `- **${key}:** ${value}`), '',
  '## Minimum percentage decrease', '', table(percent), '',
  '## Minimum raw volume-unit decrease', '', table(units), '',
  `Earlier-period selection: ${selected.minimum}%. Later result: ${selected.later.netR}R versus ${percent[0].later.netR}R baseline.`, '',
  `Earlier-period raw-unit selection: ${selectedUnits.minimum} units. Later result: ${selectedUnits.later.netR}R versus ${units[0].later.netR}R baseline.`, '',
  'Observed: the 250-unit minimum removes 9 TP and 16 SL trades, increasing gross net R from +36R to +43R. It keeps 227 setups (219 completed), with 131 TP and 88 SL, or 59.82% win rate. Earlier +16R versus +14R baseline; later +27R versus +22R. Only 25 excluded trades account for the improvement; multiple thresholds were searched, so this is an exploratory candidate rather than evidence of a reliable optimum.', '',
  'This is a historical filtering experiment. A higher win rate can come with fewer winning trades and lower total R. No dashboard settings or trading rules were changed.', '',
].join('\n'));
console.log(JSON.stringify({ method: output.method, baseline, selectedUsingEarlierData: selected.minimum,
  percent: percent.map(({ byType, bySide, bySignalMonth, ...v }) => v),
  units: units.map(({ byType, bySide, bySignalMonth, ...v }) => v) }, null, 2));
