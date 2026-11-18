import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fetchTradingViewCandles } from '../src/services/tradingViewDatafeed';
import { runVolumeStudy, VOLUME_STUDY_MAX_LOOKBACK } from '../src/services/volumeEngulfingStudy';
import { scalpOneToOneVolumePasses } from '../src/services/mt5Automation';
import { scalpOneToOnePullbackSignals, scalpOneToOneChartHistory } from '../src/services/scalpOneToOne';
import { chartPullbackState } from '../src/services/pullbackEntryDisplay';
import type { StructureCandle } from '../src/services/marketStructure';

// Descriptive research: reads market data and strategy functions; writes reports only.
const root = new URL('./', import.meta.url);
const stem = 'inside-mother-scalp-study-2026-11-18';
const read = (file: string) => JSON.parse(fs.readFileSync(new URL(file, root), 'utf8'));
const write = (file: string, value: unknown) => fs.writeFileSync(new URL(file, root), JSON.stringify(value, null, 2) + '\n');
const iso = (time: number) => new Date(time * 1000).toISOString();
const now = Math.floor(Date.now() / 1000);
const inputs: Record<string, StructureCandle[]> = {};
for (const [tf, archives] of Object.entries({ M15: ['five-month-m15-history-older.json', 'five-month-m15-history-latest.json'],
  H1: ['h1-filter-history.json'], H4: ['h4-regime-history.json'] })) {
  const cache = `${stem}-${tf}.json`;
  let fresh: StructureCandle[];
  if (fs.existsSync(new URL(cache, root))) fresh = read(cache);
  else {
    fresh = await fetchTradingViewCandles({ symbol: 'XAUUSD', exchange: 'OANDA', granularity: tf, count: 5000, timeoutMs: 20000 });
    write(cache, fresh);
  }
  const merged = new Map<number, StructureCandle>();
  let revisedOverlap = 0;
  for (const batch of [...archives.map(read), fresh]) for (const bar of batch) {
    assert.ok([bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
    assert.ok(bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close));
    const prior = merged.get(bar.time);
    if (prior && ['open', 'high', 'low', 'close', 'volume'].some(k => prior[k] !== bar[k])) revisedOverlap++;
    if (!prior || bar.complete !== false || prior.complete === false) merged.set(bar.time, bar);
  }
  inputs[tf] = [...merged.values()].sort((a,b) => a.time-b.time);
  console.log(tf, 'bars', inputs[tf].length, 'from', iso(inputs[tf][0].time), 'to', iso(inputs[tf].at(-1)!.time), 'revised overlaps', revisedOverlap);
}
const candles = inputs.M15;
const cutoff = Math.min(now, candles.at(-1)!.time + (candles.at(-1)!.complete === false ? 0 : 900));
const closed = candles.filter(c => c.complete !== false && c.time + 900 <= cutoff);
assert.ok(closed.length <= VOLUME_STUDY_MAX_LOOKBACK, 'Use explicit study chunks rather than silently truncating older history');
const indexByTime = new Map(candles.map((c,i) => [c.time,i]));

// A mother remains eligible only until a full-wick breach or a missing M15 slot.
// The mother precedes the whole pattern, and every intervening bar must fit.
function enclosingMother(bars: StructureCandle[], start: number, end: number): number | undefined {
  let high = -Infinity, low = Infinity;
  for (let k = end; k >= start; k--) {
    if (bars[k].complete === false || k < end && bars[k+1].time !== bars[k].time+900) return;
    high = Math.max(high,bars[k].high); low = Math.min(low,bars[k].low);
  }
  for (let j = start-1; j >= 0; j--) {
    const mother = bars[j];
    if (mother.complete === false || bars[j+1].time !== mother.time+900) return;
    if (high <= mother.high && low >= mother.low && (high < mother.high || low > mother.low)) return j;
    high = Math.max(high,mother.high); low = Math.min(low,mother.low);
  }
}
// Check multi-candle containment, wick breaks, gap isolation and the whole pattern.
const fixture = (time: number, high: number, low: number) => ({ time, open: low, close: high, high, low, complete: true });
assert.equal(enclosingMother([fixture(0,110,90),fixture(900,105,95),fixture(1800,106,94),fixture(2700,108,92)],2,3),0);
assert.equal(enclosingMother([fixture(0,110,90),fixture(900,111,95),fixture(1800,106,94),fixture(2700,108,92)],2,3),undefined);
assert.equal(enclosingMother([fixture(0,110,90),fixture(1800,106,94),fixture(2700,108,92)],1,2),undefined);
assert.equal(enclosingMother([fixture(0,110,90),fixture(900,112,94),fixture(1800,108,92)],1,2),undefined);

console.log('Scanning approved strategy through',iso(cutoff));
const study = runVolumeStudy({ symbol: 'XAUUSD', timeframe: 'M15', biasTimeframe: 'H4', h4EmaFilter: true,
  h1TrendlineFilter: true, cutoff, lookback: closed.length, candles: inputs },
  (done,total) => { if (done % 1000 === 0) console.log('scan',done,'/',total); });
const rows = study.records.filter(r => scalpOneToOneVolumePasses(r.signal.type,r.v1,r.v2,r.v3)).map(r => {
  const end = indexByTime.get(r.signal.time)!;
  const start = end-r.signal.candleCount+1;
  const motherIndex = enclosingMother(candles,start,end);
  const mother = motherIndex === undefined ? undefined : candles[motherIndex];
  const signals = scalpOneToOnePullbackSignals(r,inputs,r.confirmedAt,240);
  const history = scalpOneToOneChartHistory(r,inputs,cutoff);
  const legs = signals.map(s => {
    const fill = history.fills.find(f => f.leg===s.scalpEntry!.leg);
    const chart = chartPullbackState(s,candles,cutoff);
    const outcome = fill?.outcome ?? (chart.status==='ambiguous' || chart.status==='unavailable' || chart.status==='filled'
      ? 'uncertain' : chart.status==='waiting' ? 'pending' : 'not-filled');
    return { leg: s.scalpEntry!.leg, entry:s.entry, stopLoss:s.stopLoss,takeProfit:s.takeProfit,
      outcome, filledUTC: fill?.trade.filledAt===undefined ? undefined : iso(fill.trade.filledAt),
      resolvedUTC: fill?.trade.resolvedAt===undefined ? undefined : iso(fill.trade.resolvedAt) };
  });
  const filled = legs.filter(l=>['tp','sl','active'].includes(l.outcome));
  const outcomes = new Set(filled.map(l=>l.outcome));
  const outcome = !legs.length ? 'no-valid-entry' : legs.some(l=>l.outcome==='uncertain') ? 'uncertain'
    : outcomes.size>1 ? 'mixed' : filled.length ? filled[0].outcome : legs.some(l=>l.outcome==='pending') ? 'pending' : 'not-filled';
  return { signalUTC: iso(r.signal.time), direction:r.signal.direction, type:r.signal.type, insideMother: !!mother,
    motherUTC: mother ? iso(mother.time) : undefined, motherHigh:mother?.high,motherLow:mother?.low,
    patternHigh:Math.max(...candles.slice(start,end+1).map(c=>c.high)),
    patternLow:Math.min(...candles.slice(start,end+1).map(c=>c.low)),
    motherAgeBars:motherIndex===undefined ? undefined : end-motherIndex, outcome, legs };
});
function summarize(group: typeof rows) {
  const count = (outcome: string) => group.filter(r=>r.outcome===outcome).length;
  const legs=group.flatMap(r=>r.legs);
  return { setups:group.length,tp:count('tp'),sl:count('sl'),open:count('active'),pending:count('pending'),
    uncertain:count('uncertain'),mixed:count('mixed'),notFilled:count('not-filled'),noValidEntry:count('no-valid-entry'),
    closedWinRate:count('tp')+count('sl') ? count('tp')/(count('tp')+count('sl'))*100 : null,
    entryLegs:legs.length,legOutcomes:Object.fromEntries(['tp','sl','active','pending','uncertain','not-filled'].map(o=>[o,legs.filter(l=>l.outcome===o).length])) };
}
const inside=rows.filter(r=>r.insideMother),outside=rows.filter(r=>!r.insideMother);
const result = { method: { source:'TradingView OANDA:XAUUSD, archived OHLC merged with latest fetched completed candles',
  firstCandleUTC:iso(candles[0].time),throughUTC:iso(cutoff),computedAtUTC:iso(now),
  definition:'Entire T1/T2/T3 pattern and all intervening M15 candles fit within an earlier candle high/low including wicks; mother precedes the entire pattern; stop at any missing M15 candle. Inclusive edges with at least one strictly inside edge. Nearest enclosing mother recorded.',
  strategy:'Current Scalp 1:1 functions: H4 structure and EMA20/50, H1 continuation/Far, volume decrease >=250, 10/25% pullback legs, original fixed exits, 75-minute entry expiry, 300-pip per-leg limit.',
  counting:'One signal is one setup; 10% and 25% entries additionally counted as separate legs. TP/SL setup requires at least one confirmed filled leg and no uncertain or conflicting leg outcome.',
  scope:'Chart simulations, not MT5 executions. OHLC ordering ambiguity and missing candles remain uncertain. No spread, commission, slippage or live operational/session restrictions applied. Trading code/settings unchanged.' },
  all:summarize(rows),inside:summarize(inside),outside:summarize(outside),
  insideByType:Object.fromEntries(['T1','T2','T3'].map(t=>[t,summarize(inside.filter(r=>r.type===t))])),
  insideByMonth:Object.fromEntries([...new Set(inside.map(r=>r.signalUTC.slice(0,7)))].map(m=>[m,summarize(inside.filter(r=>r.signalUTC.startsWith(m)))])),rows };
assert.equal(result.all.setups,result.inside.setups+result.outside.setups);
for (const group of [result.all,result.inside,result.outside]) assert.equal(group.setups,
  group.tp+group.sl+group.open+group.pending+group.uncertain+group.mixed+group.notFilled+group.noValidEntry);
write(`${stem}.json`,result);
const csv = ['signalUTC,direction,type,insideMother,motherUTC,motherHigh,motherLow,patternHigh,patternLow,motherAgeBars,outcome,firstLegOutcome,secondLegOutcome',
  ...rows.map(r=>[r.signalUTC,r.direction,r.type,r.insideMother,r.motherUTC,r.motherHigh,r.motherLow,r.patternHigh,r.patternLow,r.motherAgeBars,r.outcome,
    r.legs.find(l=>l.leg===10)?.outcome,r.legs.find(l=>l.leg===25)?.outcome].join(','))].join('\n')+'\n';
fs.writeFileSync(new URL(`${stem}.csv`,root),csv);
console.log(JSON.stringify({method:result.method,all:result.all,inside:result.inside,outside:result.outside,insideByType:result.insideByType,insideByMonth:result.insideByMonth},null,2));
