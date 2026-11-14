import fs from 'node:fs';
import assert from 'node:assert/strict';

// Research on the archived matched setup set. No dashboard/live order changes.
// XAUUSD uses 0.1 price per pip. Each leg is sized from its own entry to the shared SL.
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const variants = read('h1-far-filter-buffer-research-2026-11-15.json');
const candleRangeMode = process.argv.includes('--candle-range');
const candles = [...new Map([
  ...read('five-month-m15-history-older.json'),
  ...read('five-month-m15-history-latest.json'),
].map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
const byTime = new Map(candles.map((c, i) => [c.time, i]));
const month = time => new Date(time * 1000).toISOString().slice(0, 7);
const round = n => Math.round(n * 100) / 100;

function simulate(bars, entry, stop, target, direction, split = true, engulfingRange) {
  const sign = direction === 'bullish' ? 1 : -1;
  const sl = (stop - entry) * sign;
  const tp = (target - entry) * sign;
  if (!(sl < 0 && tp > 0)) return [{ outcome: 'invalid', pnl: 0, fills: 0 }];
  const allocation = engulfingRange === undefined ? [[0, 25], [-2, 12.5], [-4, 12.5]]
    : [[0, 25], [-engulfingRange * 0.3, 15], [-engulfingRange * 0.4, 10]];
  const legs = (split ? allocation : [[0, 50]])
    .filter(([at]) => at > sl + 1e-10)
    .map(([at, budget]) => ({ at, budget, units: budget / (at - sl) }));
  let active = [{ filled: 1, last: 0 }];
  const closed = [];
  const move = (state, to, time) => {
    if (state.outcome) return;
    const start = state.last;
    const crosses = at => to >= start ? at >= start - 1e-10 && at <= to + 1e-10
      : at <= start + 1e-10 && at >= to - 1e-10;
    const events = [{ at: sl, outcome: 'sl' }, { at: tp, outcome: 'tp' },
      ...legs.map((leg, i) => ({ at: leg.at, i }))
        .filter(e => !(state.filled & (1 << e.i)))].filter(e => crosses(e.at))
      .sort((a, b) => Math.abs(a.at - start) - Math.abs(b.at - start));
    for (const event of events) {
      if (event.outcome) {
        const filled = legs.filter((_, i) => state.filled & (1 << i));
        Object.assign(state, { outcome: event.outcome, resolvedAt: time,
          pnl: filled.reduce((sum, leg) => sum + leg.units * (event.at - leg.at), 0),
          fills: filled.length });
        break;
      }
      state.filled |= 1 << event.i;
    }
    state.last = to;
  };
  for (const bar of bars) {
    if (bar.complete === false) continue;
    const next = [];
    for (const state of active) {
      // Both feasible OHLC orderings; crossing a gap uses planned prices (no slippage).
      for (const path of [[bar.open, bar.high, bar.low, bar.close],
        [bar.open, bar.low, bar.high, bar.close]]) {
        const branch = { ...state };
        for (const price of path) move(branch, (price - entry) * sign, bar.time);
        if (branch.outcome) closed.push(branch); else next.push(branch);
      }
    }
    active = [...new Map(next.map(s => [s.filled, s])).values()];
    if (!active.length) break;
  }
  for (const state of active) closed.push({ ...state, outcome: 'active', pnl: 0,
    fills: legs.filter((_, i) => state.filled & (1 << i)).length });
  return [...new Map(closed.map(s => [`${s.outcome}:${s.resolvedAt}:${s.filled}`, s])).values()];
}

// Verify risk sizing, direction mirroring, no-pullback wins, full-risk losses,
// partial fills, invalid legs, and ambiguous ordering before running the research.
const bar = (high, low, close = 100) => ({ time: 900, open: 100, high, low, close, complete: true });
assert.equal(simulate([bar(110, 99)], 100, 90, 110, 'bullish')[0].pnl, 25);
assert.equal(simulate([bar(101, 90)], 100, 90, 110, 'bullish')[0].pnl, -50);
assert.equal(simulate([bar(110, 97)], 100, 90, 110, 'bullish').length, 2);
assert.equal(simulate([bar(101, 90)], 100, 110, 90, 'bearish')[0].pnl, 25);
assert.equal(simulate([bar(110, 99)], 100, 110, 90, 'bearish')[0].pnl, -50);
assert.equal(simulate([bar(100, 99)], 100, 99, 101, 'bullish')[0].pnl, -25);
const partial = simulate([{ time: 0, open: 100, high: 101, low: 97, close: 100 },
  { time: 900, open: 100, high: 110, low: 100, close: 110 }], 100, 90, 110, 'bullish');
assert.ok(partial.every(s => Math.abs(s.pnl - 43.75) < 1e-8));
const rangeBars = [{ time: 0, open: 100, high: 101, low: 95, close: 100 },
  { time: 900, open: 100, high: 110, low: 100, close: 110 }];
const rangeProfit = 25 + 15 * 13 / 7 + 10 * 14 / 6;
assert.ok(simulate(rangeBars, 100, 90, 110, 'bullish', true, 10)
  .every(s => Math.abs(s.pnl - rangeProfit) < 1e-8));
assert.equal(simulate([bar(101, 90)], 100, 90, 110, 'bullish', true, 10)[0].pnl, -50);
assert.equal(simulate([bar(110, 99)], 100, 90, 110, 'bullish', true, 10)[0].pnl, 25);
const mirroredRangeBars = rangeBars.map(c => ({ ...c, open: 200 - c.open,
  high: 200 - c.low, low: 200 - c.high, close: 200 - c.close }));
assert.ok(simulate(mirroredRangeBars, 100, 110, 90, 'bearish', true, 10)
  .every(s => Math.abs(s.pnl - rangeProfit) < 1e-8));
assert.equal(simulate([bar(100, 99)], 100, 99, 101, 'bullish', true, 10)[0].pnl, -25);

function baseline(v) {
  const monthly = {};
  for (const r of v.records) {
    if (!['tp', 'sl'].includes(r.outcome)) continue;
    const row = monthly[month(r.resolvedAt)] ??= { tp: 0, sl: 0, pnl: 0 };
    row[r.outcome]++;
    row.pnl += r.outcome === 'tp' ? 50 : -50;
  }
  return { name: v.name, monthly, pnl: Object.values(monthly).reduce((sum, r) => sum + r.pnl, 0) };
}

const records = variants[1].records.map(r => {
  const index = byTime.get(r.time + 900);
  assert.notEqual(index, undefined, 'Next candle required for an immediate entry');
  const bars = candles.slice(index);
  const entry = bars[0].open;
  const engulfing = candles[byTime.get(r.time)];
  assert.ok(engulfing && engulfing.complete !== false && engulfing.high > engulfing.low);
  const engulfingRange = engulfing.high - engulfing.low;
  // Retain the approved setup's SL and TP price levels rather than moving the target.
  const scenarios = simulate(bars, entry, r.levels.stopLoss, r.levels.takeProfit, r.direction,
    true, candleRangeMode ? engulfingRange : undefined);
  const control = simulate(bars, entry, r.levels.stopLoss, r.levels.takeProfit, r.direction, false);
  const worst = scenarios.reduce((a, b) => a.pnl <= b.pnl ? a : b);
  const best = scenarios.reduce((a, b) => a.pnl >= b.pnl ? a : b);
  return { signalUTC: r.signalUTC, type: r.type, direction: r.direction, entry,
    ...(candleRangeMode ? { engulfingRange, engulfingRangePips: engulfingRange / 0.1,
      plannedEntries: [entry, entry + (r.direction === 'bullish' ? -1 : 1) * engulfingRange * 0.3,
        entry + (r.direction === 'bullish' ? -1 : 1) * engulfingRange * 0.4] } : {}),
    priorPlannedEntry: r.levels.entry, stopLoss: r.levels.stopLoss, takeProfit: r.levels.takeProfit,
    changedFirstEntry: Math.abs(entry - r.levels.entry) > 1e-9,
    uncertain: scenarios.some(s => Math.abs(s.pnl - worst.pnl) > 1e-8 || s.outcome !== worst.outcome),
    worst, best, scenarios, control };
});

function summary(which) {
  const monthly = {};
  let uncertain = 0, invalid = 0, active = 0;
  for (const r of records) {
    if (r.uncertain) uncertain++;
    const s = r[which];
    if (s.outcome === 'invalid') { invalid++; continue; }
    if (s.outcome === 'active') { active++; continue; }
    const row = monthly[month(s.resolvedAt)] ??= { tp: 0, sl: 0, pnl: 0, fills: 0 };
    row[s.outcome]++; row.pnl += s.pnl; row.fills += s.fills;
  }
  let balance = 5000;
  for (const m of Object.keys(monthly).sort()) {
    const row = monthly[m];
    balance += row.pnl;
    row.pnl = round(row.pnl); row.balance = round(balance);
  }
  return { monthly, pnl: round(balance - 5000), balance: round(balance), uncertain, invalid, active };
}

const result = {
  assumptions: { startingBalance: 5000, setupRisk: 50, riskSplit: candleRangeMode ? [25, 15, 10] : [25, 12.5, 12.5],
    ...(candleRangeMode ? { pullbackRangeFractions: [0, 0.3, 0.4],
      rangeDefinition: 'confirmed final engulfing candle high minus low, offsets from the first entry' }
      : { pullbackPips: [0, 20, 40] }),
    pipSize: 0.1, firstEntry: 'next M15 candle open, bypassing the old risk cap',
    exits: 'shared archived 30-pip setup SL and TP prices', pendingExpiry: 'setup SL or TP',
    costs: 'excluded; fills at planned prices, gaps do not model slippage',
    candles: 'completed M15 only; both OHLC orderings simulated',
    comparison: 'matched archived 252 setups, not a fresh full signal scan; H1 gate not recomputed for changed first entry',
    monthly: 'UTC exit candle; partial November', compounding: false },
  earlier20: baseline(variants[0]), earlier30: baseline(variants[1]),
  conservative: summary('worst'), optimistic: summary('best'),
  changedFirstEntries: records.filter(r => r.changedFirstEntry).length,
  records,
};
const output = candleRangeMode ? 'candle-range-three-entry-comparison-2026-11-15.json'
  : 'three-entry-dollar-comparison-2026-11-15.json';
fs.writeFileSync(new URL(output, import.meta.url), JSON.stringify(result, null, 2));
const { records: journal, ...compact } = result;
console.log(JSON.stringify(compact, null, 2));
