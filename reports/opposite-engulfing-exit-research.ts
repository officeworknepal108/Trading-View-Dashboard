import fs from 'node:fs';
import assert from 'node:assert/strict';
import { detectEngulfingPatternAt } from '../src/services/marketStructure';
import { volumeStudyGroup } from '../src/services/volumeEngulfingStudy';
import { evaluateStudyOutcome } from '../src/services/trendlineStudy';

const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const variants = read('h1-far-filter-buffer-research-2026-11-15.json');
const original = variants[1].records;
const candles = [...new Map<number, any>([
  ...read('five-month-m15-history-older.json'), ...read('five-month-m15-history-latest.json'),
].map((c: any) => [c.time, c] as [number, any])).values()].sort((a, b) => a.time - b.time);
const byTime = new Map(candles.map((c, i) => [c.time, i]));
const oppositeSignals = candles.map((c, i) => {
  const pattern = detectEngulfingPatternAt(candles, i);
  if (!pattern || pattern.type === 'T4') return undefined;
  const signal = { type: pattern.type, direction: pattern.direction, timeframe: 'M15' as const,
    time: c.time, candleCount: pattern.candleCount };
  return volumeStudyGroup(candles, signal) ? signal : undefined;
});

// Preserve the existing simulator's pending-entry and ambiguous-bar treatment.
for (const r of original) {
  const replay = evaluateStudyOutcome(r.levels, candles, 'fixed');
  assert.equal(replay.outcome, r.outcome, `Baseline outcome parity at ${r.signalUTC}`);
  assert.equal(replay.resolvedAt, r.resolvedAt);
  assert.equal(replay.filledAt, r.filledAt);
}

function earlyExit(r: any, requireLosing = false) {
  if (r.filledAt === undefined) return { ...r };
  const sign = r.direction === 'bullish' ? 1 : -1;
  const risk = Math.abs(r.levels.entry - r.levels.stopLoss);
  for (let i = byTime.get(r.filledAt)!; i < candles.length - 1; i++) {
    const current = candles[i], next = candles[i + 1];
    // A stop/target touched during the signal candle takes priority over its close.
    if (r.resolvedAt !== undefined && current.time >= r.resolvedAt) break;
    const opposite = oppositeSignals[i];
    if (!opposite || opposite.direction === r.direction || current.complete === false
      || next.complete === false || next.time !== current.time + 900) continue;
    // Decide using the just-closed bar. Execute at the following open, never a future close.
    if (requireLosing && sign * (current.close - r.levels.entry) >= 0) continue;
    const openReturn = sign * (next.open - r.levels.entry) / risk;
    // Retain baseline boundary fills if a gap has already crossed SL or TP.
    if (openReturn <= -1 || openReturn >= 1) continue;
    assert.ok(next.time > current.time && next.time >= r.filledAt);
    return { ...r, outcome: 'early-exit', returnR: openReturn, resolvedAt: next.time,
      exitPrice: next.open, oppositeSignalTime: current.time, oppositeType: opposite.type };
  }
  return { ...r };
}

function summarize(records: any[]) {
  const monthly: Record<string, any> = {};
  let pnl = 0, exits = 0, tp = 0, sl = 0, other = 0;
  for (const r of records) {
    if (!['tp', 'sl', 'early-exit'].includes(r.outcome)) { other++; continue; }
    const amount = r.returnR * 50;
    pnl += amount;
    if (r.outcome === 'early-exit') exits++;
    if (r.outcome === 'tp') tp++;
    if (r.outcome === 'sl') sl++;
    const month = new Date(r.resolvedAt * 1000).toISOString().slice(0, 7);
    const row = monthly[month] ??= { pnl: 0, tp: 0, sl: 0, earlyExits: 0 };
    row.pnl += amount;
    if (r.outcome === 'early-exit') row.earlyExits++; else row[r.outcome]++;
  }
  let balance = 5000;
  for (const month of Object.keys(monthly).sort()) {
    balance += monthly[month].pnl;
    monthly[month].pnl = +monthly[month].pnl.toFixed(2);
    monthly[month].balance = +balance.toFixed(2);
  }
  return { tp, sl, exits, other, pnl: +pnl.toFixed(2), balance: +(5000 + pnl).toFixed(2), monthly };
}

// Fixed ideas: close on every opposite signal, and close only if currently losing.
// Both variants disclosed; no tuned thresholds or best-month exclusions.
const output = [
  { name: 'Current single entry', records: original },
  { name: 'Exit on opposite volume engulfing', records: original.map((r: any) => earlyExit(r)) },
  { name: 'Exit on opposite volume engulfing only while losing', records: original.map((r: any) => earlyExit(r, true)) },
].map(v => ({ name: v.name, summary: summarize(v.records),
  earlier: summarize(v.records.filter((r: any) => r.time < Date.parse('2026-10-01T00:00:00Z') / 1000)),
  later: summarize(v.records.filter((r: any) => r.time >= Date.parse('2026-10-01T00:00:00Z') / 1000)),
  records: v.records }));
assert.equal(output[0].summary.pnl, 1800);
fs.writeFileSync(new URL('opposite-engulfing-exit-research-2026-11-15.json', import.meta.url), JSON.stringify({
  method: 'Same archived 252 single-entry setups, 30-pip SL buffer, original SL/TP and risk-capped entry. $50 fixed risk, $5000 starting balance. Opposite T1/T2/T3 must pass existing volume rules; exit on next M15 open. No costs. UTC exit month, partial November. No live/dashboard changes.',
  baselineReplayParity: original.length, output,
}, null, 2));
console.log(JSON.stringify(output.map(({ records, ...summary }) => summary), null, 2));
