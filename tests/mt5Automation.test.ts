import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MT5_DEFAULT_ENABLED_TIMEFRAMES,
  MT5_ENTRY_TIMEFRAME_OPTIONS,
  MT5_RISK_PERCENT_OPTIONS,
  applySignalOppositePositionTarget,
  buildMt5SignalId,
  canMt5SignalExpireBeforeExecution,
  findEarlierZoneEntry,
  tradeZoneExecutionKey,
  tradeRecordZoneExecutionKey,
  calculateXauUsdLotSize,
  goldMt5ZoneExecutionKey,
  priorGoldMt5ZoneExecution,
  isExecutableTrade,
  isMt5EntryTimeframeEnabled,
  isMt5SignalAllowedByTimeframes,
  isTradeStyleEnabled,
  mt5ClosedReturnR,
  mt5SignalDisabledReason,
  mt5ConnectionMatches,
  normalizeMt5DailyLossPercent,
  sanitizeMt5DailyRisk,
  sanitizeMt5OverallProfit,
  mt5DailyRiskAllowsEntry,
  normalizeMt5EnabledTimeframes,
  normalizeMt5RiskPercent,
  shouldRemoveOpenMt5JournalRecord,
  tradeToMt5Signal,
} from '../src/services/mt5Automation';
import type { TradeLevels } from '../src/services/tradeLevels';

test('overall P/L accepts signed broker totals and rejects invalid or inconsistent snapshots', () => {
  const summary = { available: true, realizedProfitMoney: 0, realizedLossMoney: 12.35,
    netRealizedMoney: -12.35, floatingMoney: -2, netMoney: -14.35 };
  assert.deepEqual(sanitizeMt5OverallProfit(summary), summary);
  assert.equal(sanitizeMt5OverallProfit(undefined), undefined);
  assert.deepEqual(sanitizeMt5OverallProfit({ available: false, error: 'Disconnected' }), { available: false, error: 'Disconnected' });
  for (const changes of [{ realizedLossMoney: -1 }, { netMoney: 100 }, { netRealizedMoney: 5 },
    { floatingMoney: Number.NaN }, { netMoney: Number.POSITIVE_INFINITY }]) {
    assert.equal(sanitizeMt5OverallProfit({ ...summary, ...changes })?.available, false);
  }
});

test('daily loss limit is capped at 5 percent and invalid settings preserve the current limit', () => {
  assert.equal(normalizeMt5DailyLossPercent(2), 2);
  assert.equal(normalizeMt5DailyLossPercent(5), 5);
  assert.equal(normalizeMt5DailyLossPercent(10), 5);
  assert.equal(normalizeMt5DailyLossPercent(-1), 0.1);
  assert.equal(normalizeMt5DailyLossPercent(undefined, 3), 3);
});

test('daily loss telemetry blocks new entries at the limit or without usable risk data', () => {
  const values = { available: true, date: '2026-10-24', startingBalance: 10000, limitPercent: 2, limitMoney: 200,
    realizedLossMoney: 100, floatingLossMoney: 20, usedMoney: 120, usedPercent: 1.2,
    remainingMoney: 80, remainingPercent: 0.8, reservedRiskMoney: 30, availableRiskMoney: 50,
    availableRiskPercent: 0.5, limitReached: false, riskUnbounded: false };
  assert.equal(mt5DailyRiskAllowsEntry(sanitizeMt5DailyRisk(values)), true);
  for (const changed of [{ limitReached: true }, { riskUnbounded: true }, { availableRiskMoney: 0 },
    { usedMoney: 200 }, { usedMoney: -1 }, { limitPercent: 10 }, { startingBalance: 0 }, { usedMoney: NaN }]) {
    assert.equal(mt5DailyRiskAllowsEntry(sanitizeMt5DailyRisk({ ...values, ...changed })), false);
  }
  assert.equal(mt5DailyRiskAllowsEntry(undefined), false);
  assert.equal(mt5DailyRiskAllowsEntry(sanitizeMt5DailyRisk({ available: false, error: 'MT5 history unavailable' })), false);
});

test('MT5 execution context requires the current account, server and resolved broker symbol', () => {
  const current = { account: '123', server: 'Broker-Live', brokerSymbol: 'XAUUSD.x' };
  assert.equal(mt5ConnectionMatches(current, { ...current }), true);
  for (const other of [
    { ...current, account: '456' }, { ...current, server: 'Other-Server' },
    { ...current, brokerSymbol: 'XAUUSD' }, {}, { ...current, account: undefined },
  ]) assert.equal(mt5ConnectionMatches(current, other), false);
  assert.equal(mt5ConnectionMatches(undefined, current), false);
  assert.equal(mt5ConnectionMatches({}, {}), false);
});

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
  ], consumed)?.setupId, intraday.setupId);
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

test('the same zone cannot execute again after SL, TP, RF or while active', () => {
  const candidate = { symbol: 'XAUUSD', zoneTimeframe: 'M15' as const,
    zoneId: 'TJL2-1792708200-4032.49', setupId: 'DIRECT:M15:TJL2-1792708200-4032.49' };
  const consumed = new Set(['ACTIVE', 'TP', 'SL', 'RF'] as const);
  for (const status of consumed) {
    const earlier = { ...candidate, status };
    assert.equal(priorGoldMt5ZoneExecution(candidate, [earlier], consumed), earlier);
    const scalp = { ...earlier, setupId: 'GOLD_SCALP:M15:TJL2-1792708200-4032.49' };
    assert.equal(priorGoldMt5ZoneExecution(candidate, [scalp], consumed), scalp);
  }
});

test('zone identity survives price revisions but keeps different origins, markets and timeframes separate', () => {
  const zone = { symbol: 'XAUUSD', zoneTimeframe: 'M15', zoneId: 'TJL2-1792708200-4032.49' };
  const key = tradeZoneExecutionKey(zone);
  assert.equal(tradeZoneExecutionKey({ ...zone, zoneId: 'TJL2-1792708200-4032.365' }), key);
  assert.notEqual(tradeZoneExecutionKey({ ...zone, zoneId: 'TJL2-1792716300-4032.365' }), key);
  assert.notEqual(tradeZoneExecutionKey({ ...zone, symbol: 'EURUSD' }), key);
  assert.notEqual(tradeZoneExecutionKey({ ...zone, zoneTimeframe: 'H1' }), key);
});

test('a filled Major Liquidity chart entry blocks a later Fib entry, including legacy journals', () => {
  const candidate = { symbol: 'XAUUSD', zoneTimeframe: 'M15',
    zoneId: 'TJL2-1792708200-4032.49', signalAt: 300 };
  const earlier = { id: 'DIRECT:TJL2-1792708200-4032.49:100:4014.365',
    zoneTimeframe: 'M15', signalAt: 100, openedAt: 110 };
  assert.equal(tradeRecordZoneExecutionKey(earlier), tradeZoneExecutionKey(candidate));
  assert.equal(findEarlierZoneEntry(candidate, [earlier]), earlier);
  const scalp = { ...earlier, id: 'GOLD_SCALP:M15:TJL2-1792708200-4032.49:100:4014.365' };
  assert.equal(findEarlierZoneEntry(candidate, [scalp]), scalp);
  const legacyDirect = { ...earlier, id: 'DIRECT:M15:TJL2-1792708200-4032.49:100:4014.365' };
  assert.equal(findEarlierZoneEntry(candidate, [legacyDirect]), legacyDirect);
  const mapped = { ...earlier, id: 'MTF:some-setup:100:4014.365', zoneId: candidate.zoneId };
  assert.equal(findEarlierZoneEntry(candidate, [mapped]), mapped);
  assert.equal(findEarlierZoneEntry(candidate, [{ ...earlier, openedAt: undefined }]), undefined);
  assert.equal(findEarlierZoneEntry(candidate, [{ ...earlier, outsideTradingTime: true }]), undefined);
  const broker = { ...earlier, outsideTradingTime: true, mt5Managed: true };
  assert.equal(findEarlierZoneEntry(candidate, [broker]), broker,
    'a real broker entry consumes its zone even when the session filter was disabled');
  assert.equal(findEarlierZoneEntry(candidate, [{ ...earlier, signalAt: 300 }]), undefined,
    'keep the existing entry visible rather than treating it as another entry');
  assert.equal(findEarlierZoneEntry(candidate, [{ ...earlier, symbol: 'EURUSD' }]), undefined);
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

test('trade-style visibility, alerts and new orders agree for all four switch combinations', () => {
  const scalp = { tradeStyle: 'SCALPING' as const, zoneTimeframe: 'H1' as const, signalTimeframe: 'M5' as const };
  const intraday = { tradeStyle: 'INTRADAY' as const, zoneTimeframe: 'M15' as const, signalTimeframe: 'M5' as const };
  const history = [scalp, intraday];
  const before = JSON.stringify(history);
  for (const scalpingEnabled of [false, true]) {
    for (const intradayEnabled of [false, true]) {
      const config = { scalpingEnabled, intradayEnabled, enabledTimeframes: MT5_DEFAULT_ENABLED_TIMEFRAMES };
      assert.equal(isTradeStyleEnabled(config, scalp), scalpingEnabled);
      assert.equal(isTradeStyleEnabled(config, intraday), intradayEnabled);
      assert.deepEqual(history.filter((trade) => isTradeStyleEnabled(config, trade)),
        [...(scalpingEnabled ? [scalp] : []), ...(intradayEnabled ? [intraday] : [])]);
      for (const trade of history) {
        assert.equal(mt5SignalDisabledReason(config, trade) === undefined, isTradeStyleEnabled(config, trade));
      }
      assert.equal(isTradeStyleEnabled(config, { zoneTimeframe: 'M1' }), scalpingEnabled);
      assert.equal(isTradeStyleEnabled(config, { zoneTimeframe: 'M5' }), scalpingEnabled);
      assert.equal(isTradeStyleEnabled(config, { zoneTimeframe: 'H1' }), intradayEnabled);
    }
  }
  assert.equal(JSON.stringify(history), before, 'switches do not mutate or delete stored history');
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
