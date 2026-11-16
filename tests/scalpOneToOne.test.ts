import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScalpOneToOneSignals, scalpOneToOneSignal, scalpOneToOneChartRecord } from '../src/services/scalpOneToOne';
import { isGoldTradeRecordRoute } from '../src/services/goldScalping';
import { buildCanonicalTradeRecords, selectTradeChartRecords } from '../src/services/tradeRecordFilters';
import { SCALP_ONE_TO_ONE_RISK_OPTIONS, normalizeScalpOneToOneRisk, isTradeStyleEnabled,
  mt5SignalDisabledReason, applySignalOppositePositionTarget,
  goldAutomationOpposingZoneBlocked, goldAutomationRepeatAreaBlocked, scalpOneToOneVolumePasses } from '../src/services/mt5Automation';
import type { VolumeStudyRecord } from '../src/services/volumeEngulfingStudy';
import { scalpOneToOnePullbackSignals, scalpOneToOneChartHistory, scalpOneToOneChartRecords, scalpPullbackBarStates } from '../src/services/scalpOneToOne';
import { scalpHistoryFillDisplays } from '../src/services/scalpChartDisplay';
import { scalpPullbackSignalError } from '../src/services/mt5Automation';
import { calculateJournalPerformance } from '../src/components/TradeJournal';
import { deduplicateTradeRecords } from '../src/services/tradeRecordDeduplication';
import type { StudyCandles } from '../src/services/trendlineStudyHistory';

const record: VolumeStudyRecord = { id: 'VE:XAUUSD:M15:900',
  signal: { type: 'T1', direction: 'bullish', timeframe: 'M15', time: 900, candleCount: 2 },
  confirmedAt: 1800, bias: 'bullish', group: 'V2 < V1', v1: 1000, v2: 750,
  levels: { entry: 100, stopLoss: 90, takeProfit: 110, riskFree: 110, rewardRisk: 1,
    riskPips: 100, riskFreeEnabled: false, status: 'active', pendingAtCreation: false,
    calculatedAt: 1800, filledAt: 1800,
    signal: { type: 'T1', direction: 'bullish', timeframe: 'M15', time: 900, candleCount: 2 } },
  outcome: 'active', filledAt: 1800 };

const layeredCandles: StudyCandles = { M15: [
  { time: 900, open: 90, high: 101, low: 89, close: 100, volume: 750, complete: true },
  { time: 1800, open: 100, high: 101, low: 97, close: 100, complete: true },
  { time: 2700, open: 100, high: 111, low: 99, close: 110, complete: true },
] };

test('75-minute Scalp history admits later fills, blocks fills at expiry, and keeps actual fill candles', () => {
  const quiet = [1800, 2700, 3600, 4500, 5400].map(time => ({ time, open: 100, high: 101, low: 99.5, close: 100, complete: true }));
  const within = { M15: [layeredCandles.M15![0], ...quiet.map(c => c.time === 5400 ? { ...c, low: 97 } : c),
    { time: 6300, open: 100, high: 111, low: 99.5, close: 110, complete: true }] };
  const { records, fills } = scalpOneToOneChartHistory(record, within, 7200);
  assert.equal(records.length, 2); assert.ok(records.every(r => r.result === 'tp' && r.openedAt === 5400));
  assert.ok(fills.every(fill => fill.trade.filledAt === 5400));
  assert.equal(scalpOneToOneChartHistory(record, within, 5399).fills.length, 0, 'no future OHLC fills');
  const late = { M15: [layeredCandles.M15![0], ...quiet,
    { time: 6300, open: 100, high: 101, low: 97, close: 100, complete: true }] };
  assert.equal(scalpOneToOneChartHistory(record, late, 7200).fills.length, 0);
  const gapStop = { M15: [layeredCandles.M15![0], { time: 1800, open: 89, high: 101, low: 88, close: 100, complete: true }] };
  assert.equal(scalpOneToOneChartHistory(record, gapStop, 2700).fills.length, 0, 'SL gap cancels before a new fill');
});

test('two pullbacks freeze original exits, allocate 60/40 and expire after 75 minutes', () => {
  const snapshot = JSON.stringify(record);
  const signals = scalpOneToOnePullbackSignals(record, layeredCandles, 1800, 240);
  assert.equal(signals.length, 2);
  assert.deepEqual(signals.map(s => s.entry), [99, 97.5]);
  assert.deepEqual(signals.map(s => s.scalpEntry?.riskShare), [0.6, 0.4]);
  assert.equal(new Set(signals.map(s => s.setupId)).size, 2);
  assert.equal(new Set(signals.map(s => s.zoneId)).size, 2);
  for (const signal of signals) {
    assert.equal(signal.orderType, 'LIMIT');
    assert.equal(signal.stopLoss, 90); assert.equal(signal.takeProfit, 110);
    assert.equal(signal.expiresAt, 6300);
    assert.equal(signal.riskFree, 110);
    assert.equal(scalpPullbackSignalError(signal), undefined);
    assert.deepEqual(applySignalOppositePositionTarget(signal, [{ direction: 'SELL' }]), signal);
  }
  assert.equal(JSON.stringify(record), snapshot);
  assert.deepEqual(scalpOneToOnePullbackSignals(record, {}, 1800, 240), []);
});

test('sell pullbacks mirror buys and exact pullbacks remain distinct beyond the original entry', () => {
  const mirrored: StudyCandles = { M15: layeredCandles.M15!.map(c => ({ ...c,
    open: 200 - c.open, high: 200 - c.low, low: 200 - c.high, close: 200 - c.close })) };
  const sell: VolumeStudyRecord = { ...record, signal: { ...record.signal, direction: 'bearish' },
    levels: { ...record.levels, stopLoss: 110, takeProfit: 90, riskFree: 90 } };
  const signals = scalpOneToOnePullbackSignals(sell, mirrored, 1800, 240);
  assert.deepEqual(signals.map(s => s.entry), [101, 102.5]);
  for (const signal of signals) assert.equal(scalpPullbackSignalError(signal), undefined);
  const capped: VolumeStudyRecord = { ...record,
    levels: { ...record.levels, entry: 95, stopLoss: 75, takeProfit: 115, riskFree: 115,
      riskPips: 200, pendingAtCreation: true, status: 'pending' } };
  const cappedSignals = scalpOneToOnePullbackSignals(capped, layeredCandles, 1800, 240);
  assert.deepEqual(cappedSignals.map(s => s.entry), [99, 97.5]);
  assert.ok(cappedSignals.every(s => s.scalpEntry?.version === 3));
  assert.equal(new Set(cappedSignals.map(s => s.id)).size, 2);
  for (const signal of cappedSignals) assert.equal(scalpPullbackSignalError(signal), undefined);
});

test('rejects tampered allocations, shifted exits, expired window geometry and market fallback', () => {
  const signal = scalpOneToOnePullbackSignals(record, layeredCandles, 1800, 240)[0];
  for (const changed of [
    { ...signal, scalpEntry: { ...signal.scalpEntry!, riskShare: 1 } },
    { ...signal, takeProfit: 108 }, { ...signal, entry: 100 },
    { ...signal, expiresAt: 2800 }, { ...signal, calculatedAt: 1801 },
    { ...signal, orderType: 'MARKET' as const },
  ]) assert.match(scalpPullbackSignalError(changed)!, /Invalid Scalp/);
});

test('the reported SELL setup uses exact 10/25 body levels with its original fixed exits under 300 pips', () => {
  const sell: VolumeStudyRecord = { ...record, signal: { ...record.signal, direction: 'bearish' },
    levels: { ...record.levels, entry: 3847.790, stopLoss: 3867.790, takeProfit: 3827.790, riskPips: 200 } };
  const source: StudyCandles = { M15: [
    { time: 900, open: 3851.195, close: 3842.020, high: 3855, low: 3840, complete: true },
    { time: 1800, open: 3842.020, close: 3842.020, high: 3842.020, low: 3842.020, complete: false },
  ] };
  const signals = scalpOneToOnePullbackSignals(sell, source, 1800, 15);
  assert.equal(signals.length, 2);
  assert.ok(Math.abs(signals[0].entry - 3842.9375) < 1e-7);
  assert.ok(Math.abs(signals[1].entry - 3844.31375) < 1e-7);
  assert.ok(Math.abs(signals[0].riskPips - 248.525) < 1e-7);
  assert.ok(Math.abs(signals[1].riskPips - 234.7625) < 1e-7);
  for (const signal of signals) {
    assert.equal(signal.stopLoss, 3867.790); assert.equal(signal.takeProfit, 3827.790);
    assert.equal(scalpPullbackSignalError(signal), undefined);
  }
  assert.deepEqual(signals.map(s => s.scalpEntry?.riskShare), [0.6, 0.4]);
});

test('300-pip Scalp entry limit is inclusive and over-limit legs are skipped without repricing', () => {
  const setup = { ...record, levels: { ...record.levels, entry: 100, stopLoss: 80, takeProfit: 120, riskPips: 200 } };
  const source: StudyCandles = { M15: [layeredCandles.M15![0], { ...layeredCandles.M15![1], open: 111 }] };
  const signals = scalpOneToOnePullbackSignals(setup, source, 1800, 15);
  assert.deepEqual(signals.map(s => s.entry), [110, 108.5]);
  assert.deepEqual(signals.map(s => s.riskPips), [300, 285]);
  for (const signal of signals) assert.equal(scalpPullbackSignalError(signal), undefined);
  const above = scalpOneToOnePullbackSignals(setup, { M15: [source.M15![0], { ...source.M15![1], open: 111.01 }] }, 1800, 15);
  assert.deepEqual(above.map(s => s.scalpEntry?.leg), [25]);
  const invalid = { ...signals[0], entry: 110.01, rewardRisk: 9.99 / 30.01,
    scalpEntry: { ...signals[0].scalpEntry!, nextOpen: 111.01 } };
  assert.match(scalpPullbackSignalError(invalid)!, /Invalid Scalp/);
  const legacy = { ...signals[0], entry: 100, riskPips: 200, rewardRisk: 1, expiresAt: 2700,
    scalpEntry: { ...signals[0].scalpEntry!, version: 1 as const } };
  assert.equal(scalpPullbackSignalError(legacy), undefined, 'saved capped v1 orders retain their original policy');
});

test('bar replay includes partial fills before target; uncertainty never becomes a chart win', () => {
  const signals = scalpOneToOnePullbackSignals(record, layeredCandles, 1800, 240);
  const states = scalpPullbackBarStates({ time: 1800, open: 100, high: 111, low: 97, close: 100 }, signals);
  assert.deepEqual(states.map(s => s.mask).sort(), [0, 1, 3]);
  const ambiguous: StudyCandles = { M15: [layeredCandles.M15![0],
    { time: 1800, open: 100, high: 111, low: 97, close: 100, complete: true }] };
  assert.deepEqual(scalpOneToOneChartRecords(record, ambiguous, 2700), []);
  assert.deepEqual(scalpOneToOneChartRecords(record, layeredCandles, 2699), []);
});

test('layered history uses individual RR and weighted setup R without merging capped siblings', () => {
  const rows = scalpOneToOneChartRecords(record, layeredCandles, 3600);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.result === 'tp' && r.completedAt === 2700));
  assert.ok(Math.abs(calculateJournalPerformance(rows).totalR - 1.4) < 1e-8);
  assert.ok(rows.every(r => isGoldTradeRecordRoute(r, true)));
  const samePrice = rows.map(r => ({ ...r, entry: 95 }));
  assert.equal(deduplicateTradeRecords(samePrice).length, 2);
  const broker = { ...samePrice[0], id: 'MT5:99', brokerTicket: 99, mt5Managed: true };
  const reconciled = deduplicateTradeRecords([...samePrice, broker]);
  assert.equal(reconciled.length, 2);
  assert.ok(reconciled.some(r => r.scalpEntry?.leg === 25 && !r.mt5Managed));
  const stopped = rows.map(r => ({ ...r, result: 'sl' as const }));
  assert.equal(calculateJournalPerformance(stopped).totalR, -1);
});

test('CSV-style below-threshold volume rows are skipped without aborting all historical entries', () => {
  const below: VolumeStudyRecord = { ...record, signal: { ...record.signal, type: 'T2', candleCount: 3 },
    group: 'V3 < V2 and V1', v1: 5417, v2: 5396, v3: 5286 };
  assert.deepEqual(scalpOneToOnePullbackSignals(below, layeredCandles, 1800, 15), []);
  assert.throws(() => scalpOneToOneSignal(below, layeredCandles, 1800, 15), /250-unit/,
    'direct execution validation remains strict');
  const history = [below, record].map(row => scalpOneToOneChartHistory(row, layeredCandles, 3600));
  assert.equal(history[0].fills.length, 0); assert.equal(history[0].records.length, 0);
  assert.equal(history[1].fills.length, 2); assert.equal(history[1].records.length, 2);
});

test('proven entry fills survive an uncertain final result without becoming journal wins or losses', () => {
  const uncertain: StudyCandles = { M15: [layeredCandles.M15![0], layeredCandles.M15![1],
    { time: 2700, open: 100, high: 111, low: 89, close: 100, complete: true }] };
  const history = scalpOneToOneChartHistory(record, uncertain, 3600);
  assert.deepEqual(history.records, []);
  assert.equal(calculateJournalPerformance(history.records).totalR, 0);
  assert.equal(history.fills.length, 2);
  assert.ok(history.fills.every(fill => fill.outcome === 'uncertain' && fill.trade.filledAt === 1800
    && fill.trade.result === undefined && fill.trade.resolvedAt === 2700));
  const displays = scalpHistoryFillDisplays(history.fills, 3600);
  assert.equal(displays.length, 2);
  assert.ok(displays.every(display => display.markerOnly && display.chartFilled && display.markerTime === 1800));
  assert.ok(displays.every(display => display.markerText.includes('Outcome uncertain')));
});

test('uncertain entry-before-TP ordering cannot create historical fill arrows', () => {
  const source: StudyCandles = { M15: [layeredCandles.M15![0],
    { time: 1800, open: 100, high: 111, low: 97, close: 100, complete: true }] };
  assert.deepEqual(scalpOneToOneChartHistory(record, source, 2700).fills, []);
  assert.deepEqual(scalpOneToOneChartHistory(record, layeredCandles, 2699).fills, []);
});

test('fill-history markers retain fill times and hide future outcomes in replay', () => {
  const history = scalpOneToOneChartHistory(record, layeredCandles, 3600);
  assert.equal(history.fills.length, 2);
  assert.deepEqual(scalpHistoryFillDisplays(history.fills, 1799), []);
  assert.deepEqual(scalpHistoryFillDisplays(history.fills, 2000), [], 'completed OHLC cannot prove an earlier intrabar fill');
  const beforeExit = scalpHistoryFillDisplays(history.fills, 2700);
  assert.ok(beforeExit.every(display => display.trade.result === undefined && display.trade.resolvedAt === undefined
    && display.markerText.includes('Open')));
  const afterExit = scalpHistoryFillDisplays(history.fills, 100000);
  assert.ok(afterExit.every(display => display.markerOnly && display.trade.result === 'tp' && display.markerTime === 1800));
});

test('Scalp 1:1 uses its own switch and approved risk choices', () => {
  assert.deepEqual(SCALP_ONE_TO_ONE_RISK_OPTIONS, [0.25, 0.5, 0.75, 1, 1.5, 2]);
  for (const value of SCALP_ONE_TO_ONE_RISK_OPTIONS) assert.equal(normalizeScalpOneToOneRisk(value), value);
  assert.equal(normalizeScalpOneToOneRisk(5), 0.25);
  assert.equal(normalizeScalpOneToOneRisk(undefined, 0.75), 0.75);
  const config = { scalpingEnabled: false, intradayEnabled: false, scalpOneToOneEnabled: true,
    enabledTimeframes: ['M15' as const] };
  const signal = scalpOneToOneSignal(record, {}, 1800, 240);
  assert.equal(isTradeStyleEnabled(config, signal), true);
  assert.equal(mt5SignalDisabledReason(config, signal), undefined);
  assert.match(mt5SignalDisabledReason({ ...config, scalpOneToOneEnabled: false }, signal)!, /Scalp 1:1/);
  assert.match(mt5SignalDisabledReason({ ...config, enabledTimeframes: [] }, signal)!, /M15/);
  assert.equal(isTradeStyleEnabled({ scalpingEnabled: true, intradayEnabled: true }, signal), false);
});

test('live adapter preserves one entry, original SL/TP, volume evidence and strategy identity', () => {
  const snapshot = JSON.stringify(record);
  const signal = scalpOneToOneSignal(record, {}, 1800, 240);
  assert.equal(signal.tradeStyle, 'SCALP_1_1');
  assert.equal(signal.orderType, 'MARKET');
  assert.equal(signal.setupId, 'SCALP_1_1:900');
  assert.ok(signal.id.startsWith('SCALP_1_1:'));
  assert.equal(signal.entry, 100); assert.equal(signal.stopLoss, 90); assert.equal(signal.takeProfit, 110);
  assert.equal(signal.rewardRisk, 1);
  assert.equal(signal.journalContext?.volume2, 750);
  assert.equal(signal.journalContext?.biasAtEntry.H4, 'bullish');
  assert.deepEqual(applySignalOppositePositionTarget(signal, [{ direction: 'SELL' }]), signal);
  assert.equal(goldAutomationOpposingZoneBlocked(signal, []), false);
  assert.equal(goldAutomationRepeatAreaBlocked(signal, [], []), false);
  assert.equal(JSON.stringify(record), snapshot);
  const pending = scalpOneToOneSignal({ ...record,
    levels: { ...record.levels, pendingAtCreation: true, status: 'pending' } }, {}, 1800, 10);
  assert.equal(pending.orderType, 'LIMIT');
  assert.equal(pending.expiresAt, 2400);
});

test('live adapter cannot qualify with missing history', () => {
  assert.deepEqual(buildScalpOneToOneSignals({}, 1800, 240), []);
  assert.deepEqual(buildScalpOneToOneSignals({ M15: [] }, 1800, 240), []);
});

test('250-unit gap is inclusive, uses the correct candle pair and rejects missing or invalid evidence', () => {
  for (const type of ['T1', 'T2', 'T3']) {
    for (const gap of [0, 1, 249, 249.999, 250, 251, 400]) {
      const passed = type === 'T1' ? scalpOneToOneVolumePasses(type, 1000, 1000 - gap)
        : scalpOneToOneVolumePasses(type, 100, 1000, 1000 - gap);
      assert.equal(passed, gap >= 250, `${type} gap ${gap}`);
    }
  }
  assert.equal(scalpOneToOneVolumePasses('T1', 5000, 4800), false, 'raw units, not percent');
  assert.equal(scalpOneToOneVolumePasses('T4', 1000, 500, 250), false);
  assert.equal(scalpOneToOneVolumePasses('T2', undefined, 1000, 750), false);
  for (const invalid of [undefined, NaN, Infinity, -1]) {
    assert.equal(scalpOneToOneVolumePasses('T1', invalid, 0), false);
    assert.equal(scalpOneToOneVolumePasses('T3', 1000, 1000, invalid), false);
  }
});

test('chart records, direct signal conversion and queued MT5 validation all enforce the same gap', () => {
  const config = { scalpingEnabled: true, intradayEnabled: true, scalpOneToOneEnabled: true,
    enabledTimeframes: ['M15' as const] };
  const allowed = scalpOneToOneSignal(record, {}, 1800, 240);
  assert.equal(mt5SignalDisabledReason(config, allowed), undefined);
  for (const v2 of [751, 999, 1000, undefined]) {
    const rejected = { ...record, v2 };
    assert.equal(scalpOneToOneChartRecord(rejected), undefined);
    assert.throws(() => scalpOneToOneSignal(rejected, {}, 1800, 240), /250-unit/);
    const queued = { ...allowed, journalContext: { ...allowed.journalContext!, volume2: v2 } };
    assert.match(mt5SignalDisabledReason(config, queued)!, /250-unit/);
  }
  assert.match(mt5SignalDisabledReason(config, { ...allowed, journalContext: undefined })!, /250-unit/);
  assert.equal(mt5SignalDisabledReason(config, { ...allowed, tradeStyle: 'INTRADAY', journalContext: undefined }), undefined,
    'the new volume rule is scoped to Scalp 1:1');
});

test('Scalp 1:1 chart results share filled entries and fixed outcomes without broker claims', () => {
  const active = scalpOneToOneChartRecord(record)!;
  assert.equal(active.result, 'open');
  assert.equal(active.openedAt, 1800);
  assert.equal(active.tradeStyle, 'SCALP_1_1');
  assert.equal(active.brokerTicket, undefined);
  assert.equal(active.mt5Managed, undefined);
  assert.match(active.autoReason!, /CHART ONLY/);
  assert.equal(active.rewardRisk, 1);
  for (const outcome of ['tp', 'sl'] as const) {
    const completed = scalpOneToOneChartRecord({ ...record, outcome, resolvedAt: 2700 })!;
    assert.equal(completed.result, outcome);
    assert.equal(completed.completedAt, 2700);
    assert.equal(completed.id, active.id, 'closing updates the same journal entry');
    assert.equal(completed.stopLoss, record.levels.stopLoss);
    assert.equal(completed.takeProfit, record.levels.takeProfit);
  }
  for (const outcome of ['pending', 'cancelled', 'ambiguous', 'rf'] as const) {
    assert.equal(scalpOneToOneChartRecord({ ...record, outcome }), undefined);
  }
  assert.equal(scalpOneToOneChartRecord({ ...record, filledAt: undefined }), undefined);
  assert.equal(selectTradeChartRecords([active], 'M15', [{ time: 900 }, { time: 1800 }], true,
    { includeActive: true }).length, 1);
});

test('Scalp 1:1 canonical history keeps qualified chart results and broker facts independently of Fib', () => {
  const chart = scalpOneToOneChartRecord({ ...record, outcome: 'tp', resolvedAt: 2700 })!;
  const options = { marketSymbol: 'XAUUSD', pipSize: 0.1, requireLtfFib: true,
    timeframeData: {}, qualifyMtf: () => undefined };
  assert.equal(isGoldTradeRecordRoute(chart, true), true);
  assert.equal(isGoldTradeRecordRoute({ ...chart, rewardRisk: 3 }), false);
  assert.equal(isGoldTradeRecordRoute({ ...chart, signalTimeframe: 'M5' }), false);
  assert.equal(buildCanonicalTradeRecords([], [chart], options).length, 1);
  assert.equal(buildCanonicalTradeRecords([chart], [], options).length, 0,
    'saved chart rows need qualification from the current study');
  const broker = { ...chart, id: 'MT5:42', mt5Managed: true, brokerTicket: 42 };
  assert.equal(buildCanonicalTradeRecords([broker], [], options).length, 1);
  assert.equal(buildCanonicalTradeRecords([broker], [chart], options).length, 1,
    'a broker execution replaces the corresponding chart simulation');
});
