import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScalpOneToOneSignals, scalpOneToOneSignal, scalpOneToOneChartRecord } from '../src/services/scalpOneToOne';
import { isGoldTradeRecordRoute } from '../src/services/goldScalping';
import { buildCanonicalTradeRecords, selectTradeChartRecords } from '../src/services/tradeRecordFilters';
import { SCALP_ONE_TO_ONE_RISK_OPTIONS, normalizeScalpOneToOneRisk, isTradeStyleEnabled,
  mt5SignalDisabledReason, applySignalOppositePositionTarget,
  goldAutomationOpposingZoneBlocked, goldAutomationRepeatAreaBlocked, scalpOneToOneVolumePasses } from '../src/services/mt5Automation';
import type { VolumeStudyRecord } from '../src/services/volumeEngulfingStudy';

const record: VolumeStudyRecord = { id: 'VE:XAUUSD:M15:900',
  signal: { type: 'T1', direction: 'bullish', timeframe: 'M15', time: 900, candleCount: 2 },
  confirmedAt: 1800, bias: 'bullish', group: 'V2 < V1', v1: 1000, v2: 750,
  levels: { entry: 100, stopLoss: 90, takeProfit: 110, riskFree: 110, rewardRisk: 1,
    riskPips: 100, riskFreeEnabled: false, status: 'active', pendingAtCreation: false,
    calculatedAt: 1800, filledAt: 1800,
    signal: { type: 'T1', direction: 'bullish', timeframe: 'M15', time: 900, candleCount: 2 } },
  outcome: 'active', filledAt: 1800 };

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
