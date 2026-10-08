import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MT5_DEFAULT_ENABLED_TIMEFRAMES,
  MT5_ENTRY_TIMEFRAME_OPTIONS,
  MT5_RISK_PERCENT_OPTIONS,
  applySignalOppositePositionTarget,
  buildMt5SignalId,
  calculateXauUsdLotSize,
  isExecutableTrade,
  isMt5EntryTimeframeEnabled,
  isMt5SignalAllowedByTimeframes,
  normalizeMt5EnabledTimeframes,
  normalizeMt5RiskPercent,
  tradeToMt5Signal,
} from '../src/services/mt5Automation';
import type { TradeLevels } from '../src/services/tradeLevels';

test('MT5 risk selector exposes only the agreed percentages and normalizes legacy values', () => {
  assert.deepEqual(MT5_RISK_PERCENT_OPTIONS, [
    0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
  ]);
  assert.equal(normalizeMt5RiskPercent(0.26), 0.25);
  assert.equal(normalizeMt5RiskPercent(2.6), 2.5);
  assert.equal(normalizeMt5RiskPercent(5), 5);
  assert.equal(normalizeMt5RiskPercent('invalid', 1), 1);
});

test('MT5 entry timeframe selector accepts supported choices and can disable M1', () => {
  assert.deepEqual(MT5_ENTRY_TIMEFRAME_OPTIONS, ['M1', 'M5', 'M15', 'M30', 'H1']);
  assert.deepEqual(MT5_DEFAULT_ENABLED_TIMEFRAMES, ['M5', 'M15', 'M30', 'H1']);
  const selected = normalizeMt5EnabledTimeframes(['H1', 'M5', 'M5', 'H4', 'M15']);
  assert.deepEqual(selected, ['M5', 'M15', 'H1']);
  assert.equal(isMt5EntryTimeframeEnabled(selected, 'M1'), false);
  assert.equal(isMt5EntryTimeframeEnabled(selected, 'M5'), true);
  assert.deepEqual(normalizeMt5EnabledTimeframes([], ['M5']), []);
  assert.deepEqual(normalizeMt5EnabledTimeframes(undefined, ['M5', 'M15']), ['M5', 'M15']);
});

test('disabled M1 blocks native, direct and MTF signals related to M1', () => {
  const enabled = ['M5', 'M15', 'M30', 'H1'] as const;
  assert.equal(isMt5SignalAllowedByTimeframes(enabled, {
    zoneTimeframe: 'M1', signalTimeframe: 'M1',
  }), false);
  assert.equal(isMt5SignalAllowedByTimeframes(enabled, {
    zoneTimeframe: 'M1', signalTimeframe: 'M5',
  }), false);
  assert.equal(isMt5SignalAllowedByTimeframes(enabled, {
    zoneTimeframe: 'M5', signalTimeframe: 'M1',
  }), false);
  assert.equal(isMt5SignalAllowedByTimeframes(enabled, {
    zoneTimeframe: 'M5', signalTimeframe: 'M15',
  }), true);
  assert.equal(isMt5SignalAllowedByTimeframes(enabled, {
    zoneTimeframe: 'H4', signalTimeframe: 'H1',
  }), true);
});

test('XAUUSD lot size follows cash risk divided by SL pips times ten', () => {
  assert.equal(calculateXauUsdLotSize(100, 150), 1 / 15);
  assert.equal(calculateXauUsdLotSize(200, 150), 2 / 15);
  assert.throws(() => calculateXauUsdLotSize(100, 0), /SL pip distance/);
});

const activeTrade: TradeLevels = {
  entry: 4150,
  stopLoss: 4140,
  takeProfit: 4170,
  riskFree: 4160,
  riskPips: 100,
  rewardRisk: 2,
  status: 'active',
  pendingAtCreation: false,
  calculatedAt: 1_000,
  filledAt: 1_000,
  signal: {
    type: 'T1', direction: 'bullish', time: 900, candleCount: 2, timeframe: 'M15',
  },
};

test('MT5 signal IDs deduplicate overlapping zones with identical execution levels', () => {
  const common = {
    source: 'ENGULFING' as const,
    signalTimeframe: 'M15' as const,
    signalAt: 900,
    direction: 'BUY' as const,
    entry: 4150,
    stopLoss: 4140,
    takeProfit: 4170,
  };
  assert.equal(buildMt5SignalId(common), buildMt5SignalId(common));
  assert.equal(
    buildMt5SignalId(common),
    buildMt5SignalId({ ...common, source: 'MTF' }),
  );
});

test('active trade becomes a market signal and pending trade becomes a limit signal', () => {
  const active = tradeToMt5Signal({
    source: 'ENGULFING', setupId: 'DIRECT:M15:db-1000',
    zoneName: 'DB', zoneTimeframe: 'M15', trade: activeTrade,
    now: 1_010, pendingExpiryMinutes: 60,
  });
  const pending = tradeToMt5Signal({
    source: 'ENGULFING', zoneName: 'DB', zoneTimeframe: 'M15',
    trade: { ...activeTrade, status: 'pending' }, now: 1_010, pendingExpiryMinutes: 60,
  });
  assert.equal(active.orderType, 'MARKET');
  assert.equal(pending.orderType, 'LIMIT');
  assert.equal(active.expiresAt, 4_610);
  assert.equal(active.direction, 'BUY');
  assert.equal(active.setupId, 'DIRECT:M15:db-1000');
  assert.equal(active.normalRewardRisk, 2);
});

test('MT5 signal target is finalized from the positions open at execution time', () => {
  const signal = tradeToMt5Signal({
    source: 'ENGULFING', zoneName: '1MG QML', zoneTimeframe: 'M1',
    trade: { ...activeTrade, rewardRisk: 3, takeProfit: 4180 },
    now: 1_010, pendingExpiryMinutes: 60,
  });
  const hedged = applySignalOppositePositionTarget(signal, [{ direction: 'SELL' }]);
  assert.equal(hedged.normalRewardRisk, 3);
  assert.equal(hedged.rewardRisk, 1);
  assert.equal(hedged.takeProfit, 4160);

  const restored = applySignalOppositePositionTarget(hedged, []);
  assert.equal(restored.rewardRisk, 3);
  assert.equal(restored.takeProfit, 4180);
  assert.notEqual(hedged.id, restored.id);
});

test('only pending and active dashboard trades are executable', () => {
  assert.equal(isExecutableTrade(activeTrade), true);
  assert.equal(isExecutableTrade({ ...activeTrade, status: 'pending' }), true);
  assert.equal(isExecutableTrade({ ...activeTrade, status: 'risk-free' }), false);
  assert.equal(isExecutableTrade({ ...activeTrade, status: 'tp-hit' }), false);
});
