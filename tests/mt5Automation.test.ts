import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MT5_DEFAULT_ENABLED_TIMEFRAMES,
  MT5_ENTRY_TIMEFRAME_OPTIONS,
  MT5_RISK_PERCENT_OPTIONS,
  applySignalOppositePositionTarget,
  buildMt5SignalId,
  canMt5SignalExpireBeforeExecution,
  canQueueSingleSlReentry,
  calculateXauUsdLotSize,
  goldMt5ZoneExecutionKey,
  priorGoldMt5ZoneExecution,
  isExecutableTrade,
  isMt5EntryTimeframeEnabled,
  isMt5SignalAllowedByTimeframes,
  mt5ClosedReturnR,
  mt5SignalDisabledReason,
  normalizeMt5EnabledTimeframes,
  normalizeMt5RiskPercent,
  shouldRemoveOpenMt5JournalRecord,
  tradeToMt5Signal,
} from '../src/services/mt5Automation';
import type { TradeLevels } from '../src/services/tradeLevels';

test('MT5 result R includes the partial scalp close and the remaining exit', () => {
  const trade = {
    direction: 'BUY' as const,
    entry: 4090.56,
    stopLoss: 4086.81,
    initialVolume: 0.72,
    partialClosedVolume: 0.36,
    partialClosePrice: 4094.77,
  };
  assert.equal(Math.round(mt5ClosedReturnR({ ...trade, closePrice: 4099.89 }) * 100) / 100, 1.81);
  assert.equal(Math.round(mt5ClosedReturnR({ ...trade, closePrice: 4086.81 }) * 100) / 100, 0.06);
  assert.equal(mt5ClosedReturnR({ ...trade, partialClosedVolume: 0, closePrice: 4086.81 }), -1);
});

test('Gold scalp and later intraday entries share one MT5 zone execution key', () => {
  const scalp = {
    symbol: 'XAUUSD', zoneTimeframe: 'M15' as const,
    setupId: 'GOLD_SCALP:M15:TJL2-123',
  };
  const intraday = {
    symbol: 'XAUUSD', zoneTimeframe: 'M15' as const,
    setupId: 'DIRECT:M15:TJL2-123', zoneId: 'TJL2-123',
  };
  assert.equal(goldMt5ZoneExecutionKey(scalp), goldMt5ZoneExecutionKey(intraday));
  assert.notEqual(goldMt5ZoneExecutionKey({ ...intraday, zoneId: 'TJL2-456' }),
    goldMt5ZoneExecutionKey(scalp));
  assert.equal(goldMt5ZoneExecutionKey({ ...intraday, symbol: 'EURUSD' }), undefined);
  const consumed = new Set(['QUEUED', 'ACTIVE', 'TP', 'SL'] as const);
  const earlierScalp = { ...scalp, status: 'TP' as const };
  assert.equal(priorGoldMt5ZoneExecution(intraday, [earlierScalp], consumed), earlierScalp);
  assert.equal(priorGoldMt5ZoneExecution(intraday, [
    { ...earlierScalp, status: 'REJECTED' as const },
  ], consumed), undefined);
  assert.equal(priorGoldMt5ZoneExecution(intraday, [
    { ...earlierScalp, setupId: intraday.setupId },
  ], consumed), undefined);
});

test('MT5 risk selector exposes only the agreed percentages and normalizes legacy values', () => {
  assert.deepEqual(MT5_RISK_PERCENT_OPTIONS, [
    0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
  ]);
  assert.equal(normalizeMt5RiskPercent(0.26), 0.25);
  assert.equal(normalizeMt5RiskPercent(2.6), 2.5);
  assert.equal(normalizeMt5RiskPercent(5), 5);
  assert.equal(normalizeMt5RiskPercent('invalid', 1), 1);
});

test('MT5 permits exactly one later retry only after a full SL', () => {
  assert.equal(canQueueSingleSlReentry([{ status: 'SL', signalAt: 100 }], 200), true);
  assert.equal(canQueueSingleSlReentry([{ status: 'SL', signalAt: 100 }], 100), false);
  assert.equal(canQueueSingleSlReentry([{ status: 'RF', signalAt: 100 }], 200), false);
  assert.equal(canQueueSingleSlReentry([{ status: 'TP', signalAt: 100 }], 200), false);
  assert.equal(canQueueSingleSlReentry([{ status: 'ACTIVE', signalAt: 100 }], 200), false);
  assert.equal(canQueueSingleSlReentry([
    { status: 'SL', signalAt: 100 },
    { status: 'SL', signalAt: 200 },
  ], 300), false, 'a second SL cannot create a third attempt');
});

test('MT5 expiry applies only before execution and stale terminal journal cards are removed', () => {
  assert.equal(canMt5SignalExpireBeforeExecution('QUEUED'), true);
  assert.equal(canMt5SignalExpireBeforeExecution('CLAIMED'), true);
  assert.equal(canMt5SignalExpireBeforeExecution('PLACED'), true);
  assert.equal(canMt5SignalExpireBeforeExecution('ACTIVE'), false);
  assert.equal(canMt5SignalExpireBeforeExecution('RISK_FREE'), false);

  assert.equal(shouldRemoveOpenMt5JournalRecord('EXPIRED'), true);
  assert.equal(shouldRemoveOpenMt5JournalRecord('CANCELLED'), true);
  assert.equal(shouldRemoveOpenMt5JournalRecord('REJECTED'), true);
  assert.equal(shouldRemoveOpenMt5JournalRecord('ACTIVE'), false);
  assert.equal(shouldRemoveOpenMt5JournalRecord('RISK_FREE'), false);
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

test('Scalping and Intraday switches independently gate setup routes, including M5 entries', () => {
  const enabledTimeframes = ['M1', 'M5', 'M15', 'M30', 'H1'] as const;
  const scalpingOnly = { enabledTimeframes, scalpingEnabled: true, intradayEnabled: false };
  const intradayOnly = { enabledTimeframes, scalpingEnabled: false, intradayEnabled: true };
  const bothOff = { enabledTimeframes, scalpingEnabled: false, intradayEnabled: false };
  const scalpM5Entry = { zoneTimeframe: 'M1', signalTimeframe: 'M5' } as const;
  const intradayM5Entry = { zoneTimeframe: 'M15', signalTimeframe: 'M5' } as const;

  assert.equal(mt5SignalDisabledReason(scalpingOnly, scalpM5Entry), undefined);
  assert.match(mt5SignalDisabledReason(scalpingOnly, intradayM5Entry) ?? '', /Intraday/);
  assert.match(mt5SignalDisabledReason(intradayOnly, scalpM5Entry) ?? '', /Scalping/);
  assert.equal(mt5SignalDisabledReason(intradayOnly, intradayM5Entry), undefined);
  assert.match(mt5SignalDisabledReason(bothOff, scalpM5Entry) ?? '', /Scalping/);
  assert.match(mt5SignalDisabledReason(bothOff, intradayM5Entry) ?? '', /Intraday/);
  assert.match(mt5SignalDisabledReason({
    ...scalpingOnly, enabledTimeframes: ['M1'],
  }, scalpM5Entry) ?? '', /M5 entry/);
  const goldScalp = {
    zoneTimeframe: 'M15', signalTimeframe: 'M5', tradeStyle: 'SCALPING',
  } as const;
  assert.equal(mt5SignalDisabledReason(scalpingOnly, goldScalp), undefined);
  assert.match(mt5SignalDisabledReason(intradayOnly, goldScalp) ?? '', /Scalping/);
  assert.equal(mt5SignalDisabledReason(intradayOnly, {
    zoneTimeframe: 'H1', signalTimeframe: 'M5', tradeStyle: 'INTRADAY',
  }), undefined);
});

test('MT5 rejects an MTF signal queued under the other LTF Fib setting', () => {
  const base = {
    enabledTimeframes: ['M5', 'M15', 'H1'] as const,
    scalpingEnabled: true,
    intradayEnabled: true,
  };
  const signal = {
    source: 'MTF' as const,
    zoneTimeframe: 'H1' as const,
    signalTimeframe: 'M5' as const,
    mtfLtfFibRequiredAtSignal: false,
  };
  assert.equal(mt5SignalDisabledReason({ ...base, mtfLtfFibRequired: false }, signal), undefined);
  assert.match(mt5SignalDisabledReason({ ...base, mtfLtfFibRequired: true }, signal) ?? '', /Fib setting changed/);
  assert.equal(mt5SignalDisabledReason({ ...base, mtfLtfFibRequired: true }, {
    ...signal, mtfLtfFibRequiredAtSignal: true,
  }), undefined);
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

  const scalp = applySignalOppositePositionTarget(
    { ...signal, tradeStyle: 'SCALPING' }, [{ direction: 'SELL' }],
  );
  assert.equal(scalp.rewardRisk, 3);
  assert.equal(scalp.takeProfit, 4180);
  const intraday = applySignalOppositePositionTarget(
    { ...signal, tradeStyle: 'INTRADAY' }, [{ direction: 'SELL' }],
  );
  assert.equal(intraday.rewardRisk, 3);
  assert.equal(intraday.takeProfit, 4180);
});

test('only pending and active dashboard trades are executable', () => {
  assert.equal(isExecutableTrade(activeTrade), true);
  assert.equal(isExecutableTrade({ ...activeTrade, status: 'pending' }), true);
  assert.equal(isExecutableTrade({ ...activeTrade, status: 'risk-free' }), false);
  assert.equal(isExecutableTrade({ ...activeTrade, status: 'tp-hit' }), false);
});
