import fs from 'node:fs';
import assert from 'node:assert/strict';
import { volumeStudyBias, volumeStudyH4EmaSeries, volumeStudyH4EmaAt,
  volumeStudyEmaAllows } from '../src/services/volumeEngulfingStudy';
import { evaluateStudyOutcome } from '../src/services/trendlineStudy';

const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const rows = read('h1-far-filter-buffer-research-2026-11-15.json')[1].records;
const candles = [...new Map<number, any>([
  ...read('five-month-m15-history-older.json'), ...read('five-month-m15-history-latest.json'),
].map((c: any) => [c.time, c] as [number, any])).values()].sort((a, b) => a.time - b.time);
const h4 = read('h4-regime-history.json');
const cutoff = candles.at(-1)!.time;
const ema = volumeStudyH4EmaSeries(h4, cutoff);
const biasCache = new Map<number, ReturnType<typeof volumeStudyBias>>();
function stillAligned(at: number, direction: 'bullish' | 'bearish') {
  const snapshot = volumeStudyH4EmaAt(ema, at);
  if (!volumeStudyEmaAllows(snapshot, direction)) return false;
  const key = h4.filter((c: any) => c.complete !== false && c.time + 14400 <= at).at(-1)?.time;
  if (key === undefined) return false;
  if (!biasCache.has(key)) biasCache.set(key, volumeStudyBias(h4, 'H4', at));
  return biasCache.get(key) === direction;
}

for (const r of rows) {
  const replay = evaluateStudyOutcome(r.levels, candles, 'fixed');
  assert.equal(replay.outcome, r.outcome);
  assert.equal(replay.filledAt, r.filledAt);
  assert.equal(replay.resolvedAt, r.resolvedAt);
}
const pendingRecheck = rows.map((r: any) => {
  const result = evaluateStudyOutcome(r.levels, candles, 'fixed', false,
    at => stillAligned(at, r.direction));
  return { ...r, ...result, changed: result.outcome !== r.outcome || result.resolvedAt !== r.resolvedAt };
});

function avoidOverlap(directionSeparate: boolean) {
  const busyUntil = new Map<string, number>();
  const records: any[] = [], skipped: any[] = [];
  for (const r of [...rows].sort((a, b) => a.time - b.time)) {
    const key = directionSeparate ? r.direction : 'all';
    const at = r.levels.calculatedAt;
    if (at < (busyUntil.get(key) ?? -Infinity)) { skipped.push(r); continue; }
    records.push(r);
    // Reserve an order slot from submission through its exit/cancellation candle close.
    busyUntil.set(key, r.resolvedAt === undefined ? Infinity : r.resolvedAt + 900);
  }
  return { records, skipped };
}
function summarize(records: any[]) {
  const monthly: Record<string, any> = {};
  let tp = 0, sl = 0, other = 0;
  for (const r of records) {
    if (!['tp', 'sl'].includes(r.outcome)) { other++; continue; }
    if (r.outcome === 'tp') tp++; else sl++;
    const month = new Date(r.resolvedAt * 1000).toISOString().slice(0, 7);
    const row = monthly[month] ??= { tp: 0, sl: 0, pnl: 0 };
    row[r.outcome]++; row.pnl += r.outcome === 'tp' ? 50 : -50;
  }
  let balance = 5000;
  for (const month of Object.keys(monthly).sort()) {
    balance += monthly[month].pnl; monthly[month].balance = balance;
  }
  return { setups: records.length, tp, sl, other, winRate: tp / (tp + sl) * 100,
    pnl: (tp - sl) * 50, balance: 5000 + (tp - sl) * 50, monthly };
}
const sameDirection = avoidOverlap(true), all = avoidOverlap(false);
const variants = [
  { name: 'Current single entry', records: rows },
  { name: 'Cancel pending if closed H4 structure/EMA no longer aligns', records: pendingRecheck },
  { name: 'One outstanding setup per direction', ...sameDirection },
  { name: 'One outstanding setup overall', ...all },
].map(v => ({ ...v, summary: summarize(v.records),
  earlier: summarize(v.records.filter((r: any) => r.time < Date.parse('2026-10-01T00:00:00Z') / 1000)),
  later: summarize(v.records.filter((r: any) => r.time >= Date.parse('2026-10-01T00:00:00Z') / 1000)) }));
assert.equal(variants[0].summary.pnl, 1800);
const output = { method: 'Archived matched 252 setups; no opposite-signal exit. Original SL/TP, 30-pip buffer and entry rules. $50 fixed risk; $5000 start; no compounding/costs. UTC exit months; partial November.',
  baselineParity: rows.length, variants };
fs.writeFileSync(new URL('pending-trend-and-overlap-research-2026-11-15.json', import.meta.url), JSON.stringify(output, null, 2));
console.log(JSON.stringify(variants.map(({ records, skipped, ...v }: any) => ({ ...v,
  changedPending: records.filter((r: any) => r.changed).length, skipped: skipped?.length ?? 0 })), null, 2));
