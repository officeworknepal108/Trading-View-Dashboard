import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScalpOneToOneSignals, scalpOneToOneSignal } from '../src/services/scalpOneToOne';
import { SCALP_ONE_TO_ONE_RISK_OPTIONS, normalizeScalpOneToOneRisk, isTradeStyleEnabled,
  mt5SignalDisabledReason, applySignalOppositePositionTarget,
  goldAutomationOpposingZoneBlocked, goldAutomationRepeatAreaBlocked } from '../src/services/mt5Automation';
import type { VolumeStudyRecord } from '../src/services/volumeEngulfingStudy';

const record: VolumeStudyRecord = { id: 'VE:XAUUSD:M15:900',
  signal: { type: 'T1', direction: 'bullish', timeframe: 'M15', time: 900, candleCount: 2 },
  confirmedAt: 1800, bias: 'bullish', group: 'V2 < V1', v1: 100, v2: 50,
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
  assert.equal(signal.journalContext?.volume2, 50);
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
