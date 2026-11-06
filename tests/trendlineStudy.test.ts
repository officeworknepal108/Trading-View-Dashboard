import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTradeLevels, getDirectTradeRule, type EngulfingTradeSignal, type TradeLevels } from '../src/services/tradeLevels';
import { type StructureCandle, type StructureZone } from '../src/services/marketStructure';
import { collectStudySupport, evaluateStudyOutcome, readStudySnapshot, runTrendlineStudy, studyAccuracy,
  studyCandleRule, studyClosedCandles, studyEntryLevels, studyFibSources,
  studyJournalCsv, studyLookbackWindow, studyDateWindow, studyLocalDateStart, studyLocalDateValue,
  studyTimeframes, studyEntryTimeframes, studyComparisonGroup, studyTrendlineBreakdown, STUDY_SECONDS,
  trendlineSupportsBuy, type TrendlineStudyRecord } from '../src/services/trendlineStudy';

const candle = (time: number, open = 100, high = 102, low = 99, close = 101): StructureCandle => (
  { time, open, high, low, close, complete: true }
);
const signal: EngulfingTradeSignal = { type: 'T1', direction: 'bullish', time: 900, candleCount: 2, timeframe: 'M15' };
const zone: StructureZone = { id: 'TJL2:test', name: 'TJL2', category: 'mg', isBuy: true,
  startTime: 0, endTime: 900, top: 102, bottom: 99, active: true, status: 'valid' };
const levels: TradeLevels = { entry: 100, stopLoss: 90, takeProfit: 120, riskFree: 110,
  riskPips: 100, rewardRisk: 2, status: 'active', pendingAtCreation: false, calculatedAt: 1800,
  signal, filledAt: 1800 };
const record = (outcome: TrendlineStudyRecord['outcome'], returnR?: number): TrendlineStudyRecord => ({
  id: `test:${outcome}`, symbol: 'XAUUSD', zoneId: zone.id, zoneName: zone.name,
  zoneTimeframe: 'M15', signal, levels, outcome, returnR, fibGroup: 'No FIB', fibSources: [],
  style: 'INTRADAY', support: [{ timeframe: 'H4', color: 'green', kind: 'continuation',
    firstTime: 0, secondTime: 100, confirmedAt: 200 }],
});

test('study uses trendline colors, including the reversed breakout slope', () => {
  assert.equal(trendlineSupportsBuy({ direction: 'up', kind: 'continuation' }), true);
  assert.equal(trendlineSupportsBuy({ direction: 'down', kind: 'breakout' }), true);
  assert.equal(trendlineSupportsBuy({ direction: 'down', kind: 'continuation' }), false);
  assert.equal(trendlineSupportsBuy({ direction: 'up', kind: 'breakout' }), false);
});

test('only completed candles available by the entry cutoff can supply evidence', () => {
  const candles = [candle(0), candle(14400), { ...candle(28800), complete: false }, candle(43200)];
  assert.deepEqual(studyClosedCandles(candles, 'H4', 28000).map(c => c.time), [0]);
  assert.deepEqual(studyClosedCandles(candles, 'H4', 43200).map(c => c.time), [0, 14400]);
});

test('selection dates follow actual candle timestamps and change for 1000 versus 2000 bars', () => {
  const start = Date.UTC(2026, 9, 1) / 1000;
  const candles = Array.from({ length: 2500 }, (_, i) => (
    candle(start + i * 900 + (i >= 1000 ? 2 * 86400 : 0))
  ));
  const cutoff = candles.at(-1)!.time + 900;
  const large = studyLookbackWindow(candles, 'M15', cutoff, 2000);
  const small = studyLookbackWindow(candles, 'M15', cutoff, 1000);
  assert.equal(large.from, candles[500].time);
  assert.equal(small.from, candles[1500].time);
  assert.equal(large.to, cutoff);
  assert.equal(large.bars, 2000);
  assert.equal(large.available, 2500);
  assert.notEqual(large.from, cutoff - 2000 * 900, 'weekend gaps must not shift the preview');
  assert.deepEqual(studyLookbackWindow(candles, 'M15', cutoff, 5000), large);
});

test('date preview respects replay cutoff, incomplete bars and insufficient loaded history', () => {
  const candles = [candle(0), candle(900), { ...candle(1800), complete: false }, candle(2700)];
  assert.deepEqual(studyLookbackWindow(candles, 'M15', 2700, 2000), {
    from: 0, to: 2700, bars: 2, requested: 2000, available: 2,
  });
  const replay = studyLookbackWindow(candles, 'M15', 900, 50);
  assert.equal(replay.from, 0);
  assert.equal(replay.bars, 1);
  assert.equal(studyLookbackWindow(candles, 'M15', 899, 50).from, undefined);
  assert.equal(studyLookbackWindow([], 'H1', 10000, 2000).bars, 0);
});

test('worker analysis uses the full 2000-bar range shown in the selection preview', () => {
  const candles = Array.from({ length: 2500 }, (_, i) => i % 2 === 0
    ? candle(i * 900, 105, 106, 99, 100) : candle(i * 900, 100, 109, 98, 108));
  const input = { symbol: 'XAUUSD', pipSize: .1, zoneTimeframe: 'M15' as const,
    candles: { M15: candles }, cutoff: 2500 * 900, lookback: 2000, tradingTimeEnabled: false };
  const result = runTrendlineStudy(input);
  const preview = studyLookbackWindow(candles, 'M15', input.cutoff, 2000);
  assert.equal(result.from, preview.from);
  assert.equal(result.from, candles[500].time);
  assert.equal(result.to, preview.to);
  assert.ok(result.scanned > 500, 'the worker must not retain its former 1000-bar cap');
});

test('date selection parses local midnight and rejects invalid calendar dates', () => {
  const midnight = new Date(2026, 9, 1).getTime() / 1000;
  assert.equal(studyLocalDateStart('2026-10-01'), midnight);
  assert.equal(studyLocalDateValue(midnight), '2026-10-01');
  assert.equal(studyLocalDateStart('2026-02-30'), undefined);
  assert.equal(studyLocalDateStart('2026-13-01'), undefined);
  assert.equal(studyLocalDateStart('2026-1-01'), undefined);
  assert.equal(studyLocalDateStart(''), undefined);
});

test('date mode studies an inclusive selected start without applying the 2000-bar cap', () => {
  const candles = Array.from({ length: 3100 }, (_, i) => i % 2 === 0
    ? candle(i * 900, 105, 106, 99, 100) : candle(i * 900, 100, 109, 98, 108));
  const input = { symbol: 'XAUUSD', pipSize: .1, zoneTimeframe: 'M15' as const,
    candles: { M15: candles }, cutoff: 3100 * 900, lookback: 50,
    fromTime: 100 * 900, tradingTimeEnabled: false };
  const preview = studyDateWindow(candles, 'M15', input.cutoff, input.fromTime);
  assert.equal(preview.bars, 3000);
  assert.equal(preview.firstBar, input.fromTime);
  assert.equal(preview.needsHistory, false);
  const result = runTrendlineStudy(input);
  assert.equal(result.from, input.fromTime);
  assert.ok(result.scanned > 1000);
  assert.equal(studyDateWindow(candles.slice(200), 'M15', input.cutoff, input.fromTime).needsHistory, true);
  assert.throws(() => runTrendlineStudy({ ...input, fromTime: input.cutoff }), /start date/);
});

test('a signal confirmed exactly at the selected date boundary belongs to that study', () => {
  const candles = [candle(0, 105, 106, 99, 100), candle(900, 100, 109, 98, 108),
    candle(1800, 108, 109, 107, 108), candle(2700, 108, 109, 107, 108)];
  const result = runTrendlineStudy({ symbol: 'EURUSD', pipSize: .1, zoneTimeframe: 'M15',
    candles: { M15: candles }, fromTime: 1800, cutoff: 3600, lookback: 50, tradingTimeEnabled: false });
  assert.equal(result.scanned, 1, 'the 00:00 confirmation is included even though its candle opened the previous day');
});

test('support accepts same/higher timeframes, rejects opposite colors and future third touches', () => {
  const candles = Array.from({ length: 40 }, (_, i) => {
    const low = 100 + i * 0.2 + ([5, 15, 25].includes(i) ? 0 : 6);
    return candle(i * 14400, low + 0.3, low + 1, low, low + 0.6);
  });
  const support = collectStudySupport({ H4: candles }, 'M15', true, 40 * 14400, 0.1);
  assert.ok(support.some(s => s.timeframe === 'H4' && s.color === 'green' && s.kind === 'continuation'));
  assert.ok(support.every(s => s.confirmedAt <= 40 * 14400));
  assert.equal(collectStudySupport({ M5: candles }, 'M15', true, 40 * 14400, 0.1).length, 0);
  assert.equal(collectStudySupport({ H4: candles }, 'M15', false, 40 * 14400, 0.1).length, 0);
  assert.equal(collectStudySupport({ H4: candles }, 'M15', true, 25 * 14400, 0.1).length, 0);
  assert.deepEqual(collectStudySupport({ H4: candles }, 'M15', true, 27 * 14400, 0.1),
    collectStudySupport({ H4: candles.slice(0, 27) }, 'M15', true, 27 * 14400, 0.1));
});

test('FIB and No FIB groups require numerical confluence, not DB/DT exemptions', () => {
  assert.deepEqual(studyFibSources(zone, [candle(900)]), []);
  assert.deepEqual(studyFibSources({ ...zone, name: 'DB' }, [candle(900)]), []);
  assert.deepEqual(studyFibSources({ ...zone, majorLiquidity: true }, [candle(900)]), []);
  const fib = { ...zone, fibStatus: 'a-plus' as const, fibBand: '0.5-0.618' as const, fibLevel50: 100 };
  assert.deepEqual(studyFibSources(fib, [candle(900)]), ['Structure 0.5-0.618']);
  assert.deepEqual(studyFibSources(fib, [candle(900, 103, 105, 102, 104)]), []);
  assert.deepEqual(studyFibSources({ ...zone, swingFibStatus: 'a-plus', swingFibBand: '0.71-0.79' }, []),
    ['4H Swing 0.71-0.79']);
});

test('study reuses exact production SL/TP rules for immediate and capped entries', () => {
  const source = [candle(0, 103, 104, 99, 100), candle(900, 100, 107, 98, 106)];
  const rule = getDirectTradeRule('M15', 'M15')!;
  for (const open of [105, 130]) {
    const next = candle(1800, open, open, open, open);
    const actual = studyEntryLevels(source, next, signal, rule)!;
    const expected = calculateTradeLevels({ sourceCandles: source, executionCandles: [next], signal, rule })!;
    assert.equal(actual.entry, expected.entry);
    assert.equal(actual.stopLoss, expected.stopLoss);
    assert.equal(actual.takeProfit, expected.takeProfit);
    assert.equal(actual.rewardRisk, expected.rewardRisk);
    assert.equal(actual.pendingAtCreation, open === 130);
  }
  const sell = { ...signal, direction: 'bearish' as const };
  const short = studyEntryLevels(source, candle(1800, 100), sell, rule)!;
  assert.equal(short.stopLoss, 109);
  assert.equal(short.takeProfit, 82);
  const noBuffer = studyEntryLevels(source, candle(1800, 105), signal, rule, true)!;
  assert.equal(noBuffer.stopLoss, 98);
});

test('Gold study retains existing intraday SL/TP and excludes lower-timeframe scalp routes', () => {
  assert.equal(studyCandleRule('XAUUSD', zone, 'M15', 'M15')!.rule.rewardRisk, 2);
  assert.equal(studyCandleRule('XAUUSD', zone, 'M15', 'M30')!.rule.rewardRisk, 1);
  assert.equal(studyCandleRule('XAUUSD', zone, 'M15', 'M1'), undefined);
  assert.equal(studyCandleRule('XAUUSD', zone, 'M15', 'M5'), undefined);
  assert.equal(studyCandleRule('XAUUSD', zone, 'H1', 'M15'), undefined);
  assert.equal(studyCandleRule('XAUUSD', zone, 'M15', 'H1'), undefined);
});

test('fixed targets, losses and half-at-1R returns are evaluated independently', () => {
  assert.equal(evaluateStudyOutcome(levels, [candle(1800, 100, 121, 99)], 'fixed').returnR, 2);
  assert.equal(evaluateStudyOutcome(levels, [candle(1800, 100, 105, 89)], 'fixed').returnR, -1);
  assert.equal(evaluateStudyOutcome(levels, [candle(1800, 100, 121, 99)], 'half-at-1r').returnR, 1.5);
  const rf = evaluateStudyOutcome(levels, [candle(1800, 100, 111, 99), candle(2700, 110, 112, 89)], 'half-at-1r');
  assert.equal(rf.outcome, 'rf');
  assert.equal(rf.returnR, 0);
  assert.equal(evaluateStudyOutcome(levels, [candle(1800, 100, 111, 99), candle(2700, 110, 112, 89)], 'fixed').outcome, 'sl');
  assert.equal(evaluateStudyOutcome(levels, [candle(1800, 100, 105, 99)], 'fixed').outcome, 'active');
});

test('ambiguous TP/SL and first-1R/SL bars never become optimistic wins', () => {
  for (const mode of ['fixed', 'half-at-1r', 'risk-free'] as const) {
    assert.equal(evaluateStudyOutcome(levels, [candle(1800, 100, 121, 89)], mode).outcome, 'ambiguous');
  }
  assert.equal(evaluateStudyOutcome(levels, [candle(1800, 100, 111, 89)], 'half-at-1r').outcome, 'ambiguous');
  const short = { ...levels, stopLoss: 110, takeProfit: 80, riskFree: 90,
    signal: { ...signal, direction: 'bearish' as const } };
  assert.equal(evaluateStudyOutcome(short, [candle(1800, 100, 111, 79)], 'fixed').outcome, 'ambiguous');
  assert.equal(evaluateStudyOutcome(short, [candle(1800, 100, 101, 79)], 'fixed').returnR, 2);
});

test('pending entries distinguish unfilled, cancelled and unknowable fill/TP order', () => {
  const pending = { ...levels, pendingAtCreation: true, filledAt: undefined };
  assert.equal(evaluateStudyOutcome(pending, [candle(1800, 110, 115, 105)], 'fixed').outcome, 'pending');
  assert.equal(evaluateStudyOutcome(pending, [candle(1800, 110, 125, 105)], 'fixed').outcome, 'cancelled');
  assert.equal(evaluateStudyOutcome(pending, [candle(1800, 110, 125, 99)], 'fixed').outcome, 'ambiguous');
  const outcome = evaluateStudyOutcome(pending, [candle(1800, 110, 115, 99), candle(2700, 105, 125, 101)], 'fixed');
  assert.equal(outcome.outcome, 'tp');
  assert.equal(outcome.filledAt, 1800);
});

test('accuracy excludes pending, active, cancelled and ambiguous observations', () => {
  const stats = studyAccuracy([record('tp', 2), record('sl', -1), record('rf', 0),
    record('pending'), record('active'), record('cancelled'), record('ambiguous')]);
  assert.equal(stats.completed, 3);
  assert.ok(Math.abs(stats.accuracy! - 100 / 3) < 1e-10);
  assert.equal(stats.totalR, 1);
  assert.equal(stats.averageR, 1 / 3);
  assert.equal(stats.pending, 2);
  assert.equal(studyAccuracy([]).accuracy, undefined);
});

test('timeframe/type accuracy counts duplicate anchors and trade IDs once per row', () => {
  const win: TrendlineStudyRecord = { ...record('tp', 2), fibGroup: 'With FIB', fibSources: ['Structure 0.5-0.618'],
    support: [record('tp').support[0], { ...record('tp').support[0], firstTime: 50, secondTime: 150 },
      { ...record('tp').support[0], timeframe: 'M15' }, { ...record('tp').support[0], kind: 'breakout' }] };
  const loss: TrendlineStudyRecord = { ...record('sl', -1), fibGroup: 'With FIB', fibSources: win.fibSources };
  const input = [win, win, loss];
  const before = JSON.stringify(input);
  const rows = studyTrendlineBreakdown(input);
  const h4 = rows.find(r => r.timeframe === 'H4' && r.kind === 'continuation')!;
  assert.equal(h4.stats.total, 2);
  assert.equal(h4.stats.completed, 2);
  assert.equal(h4.stats.tp, 1);
  assert.equal(h4.stats.sl, 1);
  assert.equal(h4.stats.accuracy, 50);
  assert.equal(h4.stats.averageR, .5);
  assert.deepEqual(h4.recordIds, [win.id, loss.id]);
  assert.deepEqual(rows.map(r => [r.timeframe, r.kind]), [
    ['M15', 'continuation'], ['H4', 'continuation'], ['H4', 'breakout'],
  ]);
  assert.equal(rows.find(r => r.kind === 'breakout')!.stats.total, 1);
  assert.equal(JSON.stringify(input), before, 'reporting must not modify entry evidence or outcomes');
});

test('breakdown separates FIB groups and keeps unresolved trades out of accuracy', () => {
  const withFib: TrendlineStudyRecord = { ...record('tp', 2), fibGroup: 'With FIB', fibSources: ['Day 0.71-0.79'] };
  const noFib = [record('sl', -1), record('pending'), record('active'), record('ambiguous'), record('cancelled')];
  const rows = studyTrendlineBreakdown([withFib, ...noFib]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fibGroup, 'With FIB');
  assert.equal(rows[0].stats.accuracy, 100);
  assert.equal(rows[1].fibGroup, 'No FIB');
  assert.equal(rows[1].stats.total, 5);
  assert.equal(rows[1].stats.completed, 1);
  assert.equal(rows[1].stats.accuracy, 0);
  assert.equal(rows[1].stats.pending, 2);
  assert.equal(rows[1].stats.ambiguous, 1);
  assert.equal(rows[1].stats.cancelled, 1);
  assert.equal(studyTrendlineBreakdown([record('pending')])[0].stats.accuracy, undefined);
});

test('FIB-only breakdown has no invented timeframe and filtered rows retain exact journal IDs', () => {
  const fibOnly: TrendlineStudyRecord = { ...record('tp', 2), fibGroup: 'FIB only', fibSources: ['Day 0.5-0.618'], support: [] };
  const entries = [record('sl', -1), fibOnly];
  const rows = studyTrendlineBreakdown(entries);
  const row = rows.find(r => r.fibGroup === 'FIB only')!;
  assert.equal(row.timeframe, undefined);
  assert.equal(row.kind, undefined);
  assert.equal(row.stats.tp, 1);
  assert.deepEqual(entries.filter(r => row.recordIds.includes(r.id)), [fibOnly]);
  assert.equal(studyTrendlineBreakdown(entries.filter(r => r.fibGroup === 'FIB only')).length, 1);
  assert.deepEqual(studyTrendlineBreakdown([]), []);
});

test('missing source history does not become a No FIB result; future data cannot change the sample', () => {
  const candles = Array.from({ length: 50 }, (_, i) => i % 2 === 0
    ? candle(i * 900, 105, 106, 99, 100) : candle(i * 900, 100, 109, 98, 108));
  const input = { symbol: 'XAUUSD', pipSize: 0.1, zoneTimeframe: 'M15' as const,
    candles: { M15: candles }, cutoff: 40 * 900, lookback: 20, tradingTimeEnabled: false };
  const result = runTrendlineStudy(input);
  assert.ok(result.scanned > 0);
  assert.equal(result.records.length, 0);
  assert.ok(result.missingTimeframes.includes('H4'));
  assert.deepEqual(result, runTrendlineStudy({ ...input, candles: { M15: candles.slice(0, 40) } }));
  assert.equal(input.candles.M15.length, 50);
});

test('study journal includes FIB group, support and individual levels with CSV escaping', () => {
  const row = { ...record('tp', 2), zoneName: 'TJL2, "test"' };
  const csv = studyJournalCsv([row]);
  assert.ok(csv.includes('"TJL2, ""test"""'));
  assert.ok(csv.includes('"No FIB"'));
  assert.ok(csv.includes('H4 green continuation'));
  assert.ok(csv.includes('"100","90","120","2","tp","2"'));
});

test('pending orders cancel when their source zone expires before filling', () => {
  const pending = { ...levels, pendingAtCreation: true, filledAt: undefined };
  const outcome = evaluateStudyOutcome(pending, [candle(1800, 110, 115, 105),
    candle(2700, 105, 121, 99)], 'fixed', false, at => at < 2700);
  assert.equal(outcome.outcome, 'cancelled');
  assert.equal(outcome.filledAt, undefined);
});

test('saved journals validate chart levels, support evidence, symbol and malformed storage', () => {
  const saved = { version: 3, symbol: 'XAUUSD', zoneTimeframe: 'M15', lookback: 50,
    tradingTimeEnabled: false, result: { records: [record('tp', 2)], scanned: 4, from: 0, to: 3600, missingTimeframes: [] } };
  assert.deepEqual(readStudySnapshot(JSON.stringify(saved), 'XAUUSD'), saved);
  assert.equal(readStudySnapshot(JSON.stringify(saved), 'EURUSD'), undefined);
  assert.equal(readStudySnapshot('{broken', 'XAUUSD'), undefined);
  assert.equal(readStudySnapshot(null, 'XAUUSD'), undefined);
  const bad = structuredClone(saved);
  (bad.result.records[0].levels as any).entry = 'not a price';
  assert.equal(readStudySnapshot(JSON.stringify(bad), 'XAUUSD'), undefined);
  const dated = { ...saved, fromTime: 0 };
  assert.deepEqual(readStudySnapshot(JSON.stringify(dated), 'XAUUSD'), dated);
  assert.equal(readStudySnapshot(JSON.stringify({ ...saved, fromTime: '2026-10-01' }), 'XAUUSD'), undefined);
  assert.equal(readStudySnapshot(JSON.stringify({ ...saved, version: 1 }), 'XAUUSD'), undefined,
    'old snapshots used lower-timeframe routes and must be recalculated');
  assert.equal(readStudySnapshot(JSON.stringify({ ...saved, version: 2 }), 'XAUUSD'), undefined,
    'two-group studies must be recalculated to include FIB-only entries');
});

test('three comparison groups distinguish FIB-only entries from matching-trendline entries', () => {
  const support = record('tp', 2).support;
  assert.equal(studyComparisonGroup(['Structure 0.5-0.618'], support), 'With FIB');
  assert.equal(studyComparisonGroup([], support), 'No FIB');
  assert.equal(studyComparisonGroup(['Structure 0.5-0.618'], []), 'FIB only');
  assert.equal(studyComparisonGroup([], []), undefined, 'neither FIB nor trendline remains excluded');
});

test('FIB-only entries save, restore, export and contribute their own TP/SL accuracy', () => {
  const fibOnly: TrendlineStudyRecord = { ...record('tp', 2), fibGroup: 'FIB only',
    fibSources: ['Structure 0.5-0.618'], support: [] };
  const saved = { version: 3, symbol: 'XAUUSD', zoneTimeframe: 'M15', lookback: 50,
    tradingTimeEnabled: false, result: { records: [fibOnly], scanned: 4, from: 0, to: 3600, missingTimeframes: [] } };
  assert.deepEqual(readStudySnapshot(JSON.stringify(saved), 'XAUUSD'), saved);
  const stats = studyAccuracy([fibOnly, { ...fibOnly, id: 'loss', outcome: 'sl', returnR: -1 }]);
  assert.equal(stats.accuracy, 50);
  assert.equal(stats.totalR, 1);
  assert.match(studyJournalCsv([fibOnly]), /No matching trendline/);
  assert.match(studyJournalCsv([fibOnly]), /FIB only/);
  assert.equal(readStudySnapshot(JSON.stringify({ ...saved, result: { ...saved.result,
    records: [{ ...fibOnly, fibSources: [] }] } }), 'XAUUSD'), undefined, 'FIB-only requires numerical FIB alignment');
});

test('historical engine finds and resolves a real FIB entry without a matching trendline', () => {
  let seed = 2;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let price = 110;
  const m15 = Array.from({ length: 150 }, (_, i) => {
    const open = price; price += (rand() - .5) * 12;
    return { time: i * 900, open, close: price, high: Math.max(open, price) + rand() * 2,
      low: Math.min(open, price) - rand() * 2, complete: true, volume: 100 };
  });
  const higher = (step: number) => Array.from({ length: 100 }, (_, i) => candle((i - 70) * step, 110, 111, 109, 110));
  const result = runTrendlineStudy({ symbol: 'EURUSD', pipSize: .1, zoneTimeframe: 'M15',
    candles: { M15: m15, H1: higher(3600), H4: higher(14400) },
    cutoff: 135000, lookback: 150, tradingTimeEnabled: false });
  const entry = result.records.find(r => r.fibGroup === 'FIB only');
  assert.ok(entry);
  assert.equal(entry.support.length, 0);
  assert.ok(entry.fibSources.includes('Structure 0.5-0.618'));
  assert.equal(entry.outcome, 'sl');
  assert.equal(entry.returnR, -1);
  const production = calculateTradeLevels({ sourceCandles: m15, executionCandles: m15,
    signal: entry.signal, rule: getDirectTradeRule('M15', 'M15')! })!;
  assert.equal(entry.levels.entry, production.entry);
  assert.equal(entry.levels.stopLoss, production.stopLoss);
  assert.equal(entry.levels.takeProfit, production.takeProfit);
});

test('study timeframe and entry selections never include a lower timeframe', () => {
  assert.deepEqual(studyTimeframes('M15'), ['M15', 'M30', 'H1', 'H4', 'D', 'W']);
  assert.deepEqual(studyEntryTimeframes('XAUUSD', 'M15'), ['M15', 'M30']);
  for (const symbol of ['XAUUSD', 'EURUSD']) for (const tf of ['M1', 'M5', 'M15', 'H1'] as const) {
    assert.ok(studyEntryTimeframes(symbol, tf).every(entry => STUDY_SECONDS[entry] >= STUDY_SECONDS[tf]));
    assert.ok(studyTimeframes(tf).every(source => STUDY_SECONDS[source] >= STUDY_SECONDS[tf]));
  }
});

test('Gold M15 calculations ignore loaded M1/M5 patterns and do not report those feeds as missing', () => {
  const native = Array.from({ length: 100 }, (_, i) => candle(i * 900, 100, 102, 99, 101));
  const lower = Array.from({ length: 100 }, (_, i) => i % 2
    ? candle(i * 60, 100, 109, 98, 108) : candle(i * 60, 105, 106, 99, 100));
  const input = { symbol: 'XAUUSD', pipSize: .1, zoneTimeframe: 'M15' as const,
    cutoff: 90000, fromTime: 0, lookback: 2000, tradingTimeEnabled: false };
  const onlyNative = runTrendlineStudy({ ...input, candles: { M15: native } });
  const withLower = runTrendlineStudy({ ...input, candles: { M15: native, M1: lower, M5: lower } });
  assert.deepEqual(withLower, onlyNative);
  assert.equal(withLower.scanned, 0);
  assert.ok(!withLower.missingTimeframes.includes('M1') && !withLower.missingTimeframes.includes('M5'));
});

test('complete historical study produces independent entries and freezes evidence at entry', () => {
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let price = 110;
  const m15 = Array.from({ length: 500 }, (_, i) => {
    const open = price; price += (rand() - .48) * 7;
    return { time: i * 900, open, close: price, high: Math.max(open, price) + rand(),
      low: Math.min(open, price) - rand(), complete: true, volume: 100 };
  });
  const h4 = Array.from({ length: 40 }, (_, i) => {
    const low = 100 + i * .2 + ([5, 15, 25].includes(i) ? 0 : 6);
    return candle(i * 14400, low + .3, low + 1, low, low + .6);
  });
  const input = { symbol: 'EURUSD', pipSize: .1, zoneTimeframe: 'M15' as const,
    candles: { M15: m15, H1: h4.map((c, i) => ({ ...c, time: i * 3600 })), H4: h4 },
    cutoff: 450000, lookback: 100, tradingTimeEnabled: false };
  const frozenInput = JSON.stringify(input);
  const result = runTrendlineStudy(input);
  assert.ok(result.records.length >= 3, 'exercise real structure, engulfing and trendline analysis together');
  assert.ok(result.records.some(r => r.outcome === 'tp'));
  assert.ok(result.records.some(r => r.outcome === 'sl'));
  assert.equal(new Set(result.records.map(r => r.zoneId)).size, result.records.length);
  assert.ok(result.records.every(r => r.support.every(s => s.confirmedAt <= r.signal.time + 900)));
  const appended = { ...input, candles: { ...input.candles,
    M15: [...m15, candle(450000, 10000, 20000, 1, 19000)],
    H4: [...h4, candle(576000, 1, 20000, 0, 19999)] } };
  assert.deepEqual(runTrendlineStudy(appended), result, 'future extremes cannot rewrite an earlier study');
  assert.equal(JSON.stringify(input), frozenInput, 'analysis never modifies chart or trading inputs');
});
