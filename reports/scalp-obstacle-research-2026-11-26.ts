// Offline research only. Imports pure analysis functions; never imports server or submits orders.
// This unprotected report script is not an application/runtime alternative.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { analyzeMarketStructure, detectEngulfingPatternAt, DISABLED_HIGHER_TIMEFRAME_CONFIRMATION } from '../src/services/marketStructure';
import { buildAlternatingSwingFibs, buildOneHourSwingFibs } from '../src/services/swingFib';
import { applySwingFibConfluence, applyPostChochH1SwingFibConfluence } from '../src/services/swingFibConfluence';
import { buildDayFibs, selectDayFibForTime } from '../src/services/dayFib';
import { applyDayFibConfluence } from '../src/services/dayFibConfluence';
import { prepareGoldOpposingZones } from '../src/services/mt5Automation';

const root = new URL('./', import.meta.url), stem = 'scalp-obstacle-research-2026-11-26';
const read = (file: string) => JSON.parse(fs.readFileSync(new URL(file, root), 'utf8'));
const save = (file: string, value: unknown) => fs.writeFileSync(new URL(file, root), JSON.stringify(value, null, 2) + '\n');
const sourceBytes = fs.readFileSync(new URL(`${stem}-market-data.json`, root));
const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const shortHistory = process.argv.includes('--short-history');
const historySuffix = shortHistory ? '-1500' : '';
const data = JSON.parse(sourceBytes.toString()), sources = data.candles;
const seconds: any = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D: 86400 };
const confirmations: any = { M1: 300, M5: DISABLED_HIGHER_TIMEFRAME_CONFIRMATION, M15: 3600, M30: 3600, H1: 14400, H4: 86400, D: 604800 };
const supports: any = { M1: ['M5', 'M15'], M5: ['H1'], M15: ['H1', 'H4'], M30: ['H1', 'H4'], H1: ['H4', 'D'] };
const localDay = (t: number) => new Date((t + 20700) * 1000).toISOString().slice(0, 10);
const localTime = (t: number) => new Date((t + 20700) * 1000).toISOString().slice(11, 16);
const before = (bars: any[], end: number, tf: string) => bars.filter(b => b.complete !== false && b.time + seconds[tf] <= end);
const analyze = (tf: string, bars: any[], vipSupport?: any[]) => analyzeMarketStructure(bars, {
  sourceBarSeconds: seconds[tf], confirmationBarSeconds: confirmations[tf],
  allowSupplyDemand: ['H1', 'H4', 'D'].includes(tf), zoneVisualBars: 30, vipSupport,
});
const fibAligned = (z: any) => (z.fibStatus === 'a-plus' && z.fibDeepInvalidatedAt === undefined)
  || z.swingFibStatus === 'a-plus' || z.dayFibStatus === 'a-plus' || z.h1SwingFibStatus === 'aligned';
const fibSources = (z: any) => [z.fibStatus === 'a-plus' ? 'structure' : '', z.swingFibStatus === 'a-plus' ? 'H4 swing' : '',
  z.dayFibStatus === 'a-plus' ? 'day' : '', z.h1SwingFibStatus === 'aligned' ? 'H1 swing' : ''].filter(Boolean);

const groups = new Map<string, any>();
for (const file of ['../data/trade-journal.json', '../data/trade-journal.secondary.json']) {
  for (const r of read(file).trades) {
    const abhi = r.tradeStyle === 'SCALP_1_1' && r.scalpEntry?.version === 4;
    const legacy = r.tradeStyle === 'SCALPING' && localDay(r.signalAt) === '2026-11-25';
    if (!(abhi || legacy) || !['tp', 'sl', 'rf'].includes(r.result)) continue;
    if (localDay(r.signalAt) < '2026-10-07' || localDay(r.signalAt) > '2026-11-25') continue;
    const key = [r.tradeStyle, r.signalAt, r.direction].join(':');
    const group = groups.get(key) ?? { key, style: r.tradeStyle, signalAt: r.signalAt, direction: r.direction, legs: new Map() };
    const leg = abhi ? r.scalpEntry.leg : 0, old = group.legs.get(leg);
    // Prefer chart plans for the original two-entry allocation; broker cash is not simulated here.
    if (!old || ((old.mt5Managed || old.brokerTicket) && !(r.mt5Managed || r.brokerTicket))) group.legs.set(leg, r);
    groups.set(key, group);
  }
}
let setups = [...groups.values()].filter(g => g.style !== 'SCALP_1_1' || g.legs.size === 2).map(g => {
  const legs = [...g.legs.values()].sort((a: any, b: any) => (a.scalpEntry?.leg ?? 0) - (b.scalpEntry?.leg ?? 0));
  const sign = g.direction === 'bullish' ? 1 : -1, decisionAt = g.signalAt + (g.style === 'SCALP_1_1' ? 900 : seconds[legs[0].signalTimeframe]);
  return { ...g, sign, day: localDay(g.signalAt), signalNepal: localTime(g.signalAt), decisionAt,
    zoneTimeframe: legs[0].zoneTimeframe, legs: legs.map((r: any) => {
      const e = r.scalpEntry;
      const entry = e ? e.confirmationClose - sign * e.confirmationBody * e.leg / 100 : r.entry;
      const risk = sign * (entry - r.stopLoss), targetR = e ? 1.25 : r.rewardRisk;
      assert.ok(risk > 0 && Number.isFinite(entry));
      return { slot: e?.leg ?? 0, entry, risk, stopLoss: r.stopLoss, targetR, takeProfit: entry + sign * risk * targetR,
        share: e ? e.riskShare : 1, expiresAt: decisionAt + (e ? 3600 : 1800), savedResult: r.result,
        savedR: r.result === 'sl' ? -1 : r.result === 'rf' ? 0 : e ? 1.25 : (1 + r.rewardRisk) / 2 };
    }) };
}).sort((a, b) => a.signalAt - b.signalAt);
if (process.argv.includes('--yesterday')) setups = setups.filter(g => g.day === '2026-11-25');

const rules = [
  { id: 'baseline', label: 'Original SL and target' },
  { id: 'skip_same_fib_tp', label: 'Skip: same-chart opposing Fib zone before TP' },
  { id: 'skip_same_any_tp', label: 'Skip: same-chart opposing zone before TP' },
  { id: 'skip_all_fib_tp', label: 'Skip: any studied timeframe opposing Fib zone before TP' },
  { id: 'skip_all_fib_1r', label: 'Skip: any opposing Fib zone within 1R' },
  { id: 'skip_confirmed_tp', label: 'Skip: already-confirmed opposing reversal before TP' },
  { id: 'cap_same_fib', label: 'TP before same-chart Fib zone; skip if reward below 0.75R' },
  { id: 'cap_all_fib', label: 'TP before nearest Fib zone; skip if reward below 0.75R' },
  { id: 'exit_m5_opposite', label: 'Exit after closed opposite M5 engulfing' },
  { id: 'exit_m5_fib_rejection', label: 'Exit after opposite M5 engulfing touching a known opposing Fib zone' },
  { id: 'exit_m15_failure', label: 'Exit after M15 closes beyond confirmation open against trade' },
  { id: 'be_05', label: 'Breakeven after +0.5R' },
  { id: 'partial_05', label: 'Take half at +0.5R; stop remainder at entry' },
];
const engineVersion = 'v2';
const spec = { createdUTC: new Date().toISOString(), engineVersion, sourceHash, shortHistory, rules,
  universe: 'Saved v4 Abhi setups with both recorded legs, Oct7-Nov25; two Nov25 M1 zone scalps analysed separately. Original qualification is not rebuilt. Only already-filled/closed saved samples are available.',
  cutoff: 'Only candles fully closed at signal confirmation; active valid opposing zones only. Fib is reconstructed independently at each cutoff. No current/future zones veto earlier trades.',
  room: 'Zone near edge in favorable direction; overlap gives zero room. Skip entire setup if either intended leg is blocked. TP buffer is 0.1R before obstacle; adjusted target must be at least 0.75R.',
  splits: 'Oct7-31 development comparison; Nov1-24 later comparison; Nov25 case study. All dates previously inspected, not untouched holdout data.',
  execution: 'Current broker M1 bid OHLC; original planned entries reconstructed before outcome. 60min Abhi limit expiry; legacy 30min assumed. OHLC two intrabar paths, entry and bracket ordering preserved. Gross R and 0.20/0.50 price-unit round-trip sensitivity. Stop gaps use bar open. Signal exits execute next M1 open, never on the signalling close.',
};
save(`${stem}${historySuffix}-plan.json`, spec);

function obstacleSnapshot(g: any) {
  const frames = g.style === 'SCALPING' ? ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D'] : ['M5', 'M15', 'M30', 'H1', 'H4', 'D'];
  const candles: any = {}, raw: any = {};
  for (const tf of frames) {
    candles[tf] = before(sources[tf], g.decisionAt, tf).slice(-(!shortHistory && ['M1', 'M5', 'M15', 'M30'].includes(tf) ? 5000 : 1500));
    assert.ok(candles[tf].every((b: any) => b.time + seconds[tf] <= g.decisionAt));
    assert.ok(candles[tf].length >= 50, `Missing ${tf} warmup at ${g.day}`);
    raw[tf] = analyze(tf, candles[tf]);
  }
  const seed = raw.H4.lines.filter((l: any) => l.type === 'swing' && l.fromTime !== l.toTime && l.fromPrice !== l.toPrice)
    .sort((a: any, b: any) => a.toTime - b.toTime)[0];
  const swing = seed ? buildAlternatingSwingFibs(candles.H4, { sourceTime: seed.fromTime, sourcePrice: seed.fromPrice, zeroTime: seed.toTime, zeroPrice: seed.toPrice }) : [];
  const h1Swing = buildOneHourSwingFibs(candles.H1, raw.H1.markers);
  const obstacles: any[] = [];
  for (const tf of frames) {
    const supported = analyze(tf, candles[tf], (supports[tf] ?? []).map((support: string) => ({ timeframe: support, zones: raw[support].zones })));
    let zones = applySwingFibConfluence(candles[tf], supported.zones, ['M1', 'M5'].includes(tf) ? undefined : swing).zones;
    if (tf === 'M15' || tf === 'M30') zones = applyDayFibConfluence(candles[tf], zones, selectDayFibForTime(buildDayFibs(candles[tf]), g.decisionAt), 10, g.decisionAt).zones;
    if (tf === 'M15') zones = applyPostChochH1SwingFibConfluence(candles[tf], zones, raw.M15.lines, h1Swing);
    const confirmed = new Map(prepareGoldOpposingZones(zones, tf as any, candles, { m15Structure: raw.M15, requireLtfFib: false }).map(z => [z.id, z]));
    for (const z of zones) {
      if (!z.active || z.status !== 'valid' || z.isBuy === (g.sign === 1)
        || z.startTime > g.signalAt || (z.activeFromTime ?? z.startTime) > g.decisionAt
        || (z.confirmationTime ?? z.startTime) > g.decisionAt) continue;
      const confirmation: any = confirmed.get(z.id);
      const distances = g.legs.map((l: any) => {
        const forward = g.sign === 1 ? z.top >= l.entry : z.bottom <= l.entry;
        const distance = g.sign === 1 ? Math.max(0, z.bottom - l.entry) : Math.max(0, l.entry - z.top);
        return { slot: l.slot, inPath: forward, roomR: forward ? distance / l.risk : null,
          beforeTP: forward && distance < l.risk * l.targetR };
      });
      if (!distances.some((d: any) => d.beforeTP)) continue;
      obstacles.push({ timeframe: tf, id: z.id, name: z.name, bottom: z.bottom, top: z.top,
        startTime: z.startTime, activeFromTime: z.activeFromTime, fib: fibAligned(z), fibSources: fibSources(z),
        fibBand: z.fibBand, swingFibBand: z.swingFibBand, dayFibBand: z.dayFibBand, h1SwingFibBand: z.h1SwingFibBand,
        reversalConfirmed: confirmation?.opposingEngulfingConfirmedAt !== undefined && confirmation.opposingEngulfingConfirmedAt <= g.decisionAt,
        reversalConfirmedAt: confirmation?.opposingEngulfingConfirmedAt, distances });
    }
  }
  return { obstacles, trends: Object.fromEntries(frames.map(tf => [tf, raw[tf].trend])),
    historyCounts: Object.fromEntries(frames.map(tf => [tf, candles[tf].length])) };
}

function exitSignals(g: any, obstacles: any[]) {
  const end = g.decisionAt + 86400 * 3;
  const result: any = { exit_m5_opposite: [], exit_m5_fib_rejection: [], exit_m15_failure: [] };
  const confirmation = sources.M15.find((b: any) => b.time === g.signalAt);
  for (const tf of ['M5', 'M15']) {
    const bars = sources[tf];
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i], at = b.time + seconds[tf];
      if (at <= g.decisionAt || at > end || b.complete === false) continue;
      if (tf === 'M15' && confirmation && g.sign * (b.close - confirmation.open) < 0) result.exit_m15_failure.push(at);
      if (tf !== 'M5') continue;
      const pattern = detectEngulfingPatternAt(bars.slice(Math.max(0, i - 12), i + 1), Math.min(i, 12), 10);
      if (!pattern || pattern.direction === g.direction) continue;
      result.exit_m5_opposite.push(at);
      const patternBars = bars.slice(Math.max(0, i - pattern.candleCount + 1), i + 1);
      if (obstacles.some(z => z.fib && patternBars.some((c: any) => c.high >= z.bottom && c.low <= z.top))) result.exit_m5_fib_rejection.push(at);
    }
  }
  return result;
}

function stepPath(initial: any, values: number[], cfg: any, target: number, time: number, signalExit: boolean) {
  const state = { ...initial };
  const initialStop = state.armed ? 0 : -1;
  if (signalExit && state.filled && values[0] > initialStop && values[0] < target)
    return { done: true, r: state.bank + state.remaining * values[0], at: time, reason: 'signal', fillAt: state.fillAt };
  for (let i = 0; i < values.length; i++) {
    const p = values[i], prior = i ? values[i - 1] : p;
    if (!state.filled) {
      if (p >= target || i === 0 && p <= -1)
        return { done: true, r: 0, at: time, reason: 'unfilled' };
      if (p <= 0 && (i === 0 || prior > 0)) {
        state.filled = true;
        state.fillAt = time;
        // Limit fill receives no favorable-gap bonus; retain original planned risk.
      } else continue;
    }
    const stop = state.armed ? 0 : -1;
    if (p <= stop) return { done: true, r: state.bank + state.remaining * (i === 0 ? Math.min(p, stop) : stop), at: time, reason: state.armed ? 'be' : 'sl', fillAt: state.fillAt };
    if (cfg.be && p >= .5 && !state.armed) {
      state.armed = true;
      if (cfg.partial) { state.bank = .25; state.remaining = .5; }
    }
    if (p >= target) return { done: true, r: state.bank + state.remaining * target, at: time, reason: 'tp', fillAt: state.fillAt };
  }
  return state;
}

function replayLeg(g: any, leg: any, cfg: any, signals: number[]) {
  const bars = sources.M1;
  let left = 0, right = bars.length;
  while (left < right) { const mid = (left + right) >>> 1; if (bars[mid].time < g.decisionAt) left = mid + 1; else right = mid; }
  let states = [{ filled: false, armed: false, remaining: 1, bank: 0, fillAt: undefined as number | undefined }];
  const outcomes: any[] = [];
  for (let i = left; i < bars.length; i++) {
    const b = bars[i];
    if (b.complete === false) break;
    const normalized = ['open', 'high', 'low', 'close'].map(k => g.sign * (b[k] - leg.entry) / leg.risk);
    const next = new Map<string, any>();
    for (const state of states) {
      if (!state.filled && b.time >= leg.expiresAt) { outcomes.push({ done: true, r: 0, at: b.time, reason: 'unfilled' }); continue; }
      const exit = state.filled && signals.some(at => at > state.fillAt! && at <= b.time);
      for (const path of [normalized, [normalized[0], normalized[2], normalized[1], normalized[3]]]) {
        const value = stepPath(state, path, cfg, cfg.targetR ?? leg.targetR, b.time, exit);
        if (value.done) outcomes.push(value);
        else next.set(JSON.stringify(value), value);
      }
    }
    states = [...next.values()];
    if (!states.length) break;
  }
  if (states.some(s => s.filled)) return { open: true, low: null, high: null };
  if (states.length) outcomes.push({ r: 0, reason: 'pending' });
  assert.ok(outcomes.length > 0);
  const low = Math.min(...outcomes.map(o => o.r)), high = Math.max(...outcomes.map(o => o.r));
  const filled = outcomes.filter(o => o.fillAt !== undefined || !['unfilled', 'pending'].includes(o.reason));
  return { low, high, ambiguous: high - low > 1e-8, filled: filled.length > 0,
    // Conservative cost charge if any possible path fills; spread is sensitivity, not observed fees.
    costR20: filled.length ? .2 / leg.risk : 0, costR50: filled.length ? .5 / leg.risk : 0,
    reasons: [...new Set(outcomes.map(o => o.reason))], latestExit: Math.max(...outcomes.map(o => o.at ?? 0)) };
}

function policy(g: any, snapshot: any, rule: string, events: any) {
  const allFib = snapshot.obstacles.filter((z: any) => z.fib);
  const same = snapshot.obstacles.filter((z: any) => z.timeframe === g.zoneTimeframe);
  const sameFib = same.filter((z: any) => z.fib);
  let blockZones: any[] = [];
  if (rule === 'skip_same_fib_tp') blockZones = sameFib;
  if (rule === 'skip_same_any_tp') blockZones = same;
  if (rule === 'skip_all_fib_tp') blockZones = allFib;
  if (rule === 'skip_all_fib_1r') blockZones = allFib.filter((z: any) => z.distances.some((d: any) => d.inPath && d.roomR < 1));
  if (rule === 'skip_confirmed_tp') blockZones = snapshot.obstacles.filter((z: any) => z.reversalConfirmed);
  const targets = g.legs.map((l: any) => l.targetR);
  if (rule.startsWith('cap_')) {
    const obstacles = rule === 'cap_same_fib' ? sameFib : allFib;
    g.legs.forEach((leg: any, i: number) => {
      const rooms = obstacles.flatMap((z: any) => z.distances.filter((d: any) => d.slot === leg.slot && d.beforeTP).map((d: any) => d.roomR));
      if (rooms.length) targets[i] = Math.min(leg.targetR, Math.min(...rooms) - .1);
    });
    if (targets.some((t: number) => t < .75)) blockZones = obstacles;
  }
  if (blockZones.length) return { skipped: true, low: 0, high: 0, cost20: 0, cost50: 0, ambiguous: false, filled: false, blockedBy: blockZones.map(z => `${z.timeframe}:${z.name}`) };
  const legs = g.legs.map((leg: any, i: number) => replayLeg(g, leg, { targetR: targets[i], be: ['be_05', 'partial_05'].includes(rule), partial: rule === 'partial_05' }, events[rule] ?? []));
  if (legs.some((l: any) => l.open)) return { open: true, low: null, high: null };
  const low = legs.reduce((s: number, l: any, i: number) => s + l.low * g.legs[i].share, 0);
  const high = legs.reduce((s: number, l: any, i: number) => s + l.high * g.legs[i].share, 0);
  return { skipped: false, low, high,
    cost20: low - legs.reduce((s: number, l: any, i: number) => s + l.costR20 * g.legs[i].share, 0),
    cost50: low - legs.reduce((s: number, l: any, i: number) => s + l.costR50 * g.legs[i].share, 0),
    ambiguous: high - low > 1e-8, filled: legs.some((l: any) => l.filled), latestExit: Math.max(...legs.map((l: any) => l.latestExit)), legs };
}

const initial = { filled: false, armed: false, bank: 0, remaining: 1 };
assert.equal(stepPath(initial, [.2, 1.5, -.1, .2], {}, 1.25, 0, false).reason, 'unfilled');
assert.equal(stepPath(initial, [-1.5, -1, -2, -1], {}, 1.25, 0, false).reason, 'unfilled');
assert.equal(stepPath({ ...initial, filled: true }, [.1, 1.4, 0, .8], { be: true, partial: true }, 1.25, 0, false).r, .875);
assert.equal(stepPath({ ...initial, filled: true }, [.1, .8, -.2, .1], { be: true, partial: true }, 1.25, 0, false).r, .25);

const checkpoint = `${stem}${historySuffix}${process.argv.includes('--yesterday') ? '-yesterday' : ''}-${engineVersion}-rows.json`;
const old = fs.existsSync(new URL(checkpoint, root)) ? read(checkpoint) : { sourceHash, rows: [] };
assert.equal(old.sourceHash, sourceHash, 'Market data changed: use a new checkpoint name');
const rows: any[] = old.rows;
for (const g of setups) {
  if (rows.some(r => r.key === g.key)) continue;
  const start = Date.now(), snapshot = obstacleSnapshot(g), events = exitSignals(g, snapshot.obstacles);
  const results = Object.fromEntries(rules.map(rule => [rule.id, policy(g, snapshot, rule.id, events)]));
  rows.push({ ...g, ...snapshot, results, savedR: g.legs.reduce((s: number, l: any) => s + l.share * l.savedR, 0) });
  save(checkpoint, { sourceHash, rows });
  console.log(JSON.stringify({ day: g.day, time: g.signalNepal, style: g.style, elapsedSeconds: (Date.now() - start) / 1000,
    obstacles: snapshot.obstacles.length, fibObstacles: snapshot.obstacles.filter(z => z.fib).length,
    savedR: rows.at(-1).savedR, results: Object.fromEntries(Object.entries(results).map(([key, value]: any) => [key, value.low])) }));
}
console.log(JSON.stringify({ complete: true, setups: rows.length, checkpoint }));
