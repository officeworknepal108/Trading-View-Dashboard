import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MT5_DEFAULT_ENABLED_TIMEFRAMES,
  MT5_ENTRY_TIMEFRAME_OPTIONS,
  MT5_RISK_PERCENT_OPTIONS,
  mt5StrategyRiskPercent,
  goldAutomationCountertrendBlocked,
  goldM1BuyCountertrendBlocked,
  goldM5ScalpingBuyCountertrendBlocked,
  goldAutomationFastMoveBlocked,
  goldAutomationHighImpactUsdNewsTimes,
  goldAutomationNewsPauseUntil,
  goldAutomationOpposingZoneBlocked,
  goldOpposingZoneBeforeOneR,
  prepareGoldOpposingZones,
  goldOpposingZoneBlockLabel,
  sanitizeMt5FibProfitEvents,
  mt5FibProfitEventLabel,
  goldAutomationRepeatAreaBlocked,
  applySignalOppositePositionTarget,
  buildMt5SignalId,
  canMt5SignalExpireBeforeExecution,
  findEarlierZoneEntry,
  findMissedZoneEntry,
  isSameZoneEntryConfirmation,
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
  opposingFibProfitZones,
  mt5ConnectionMatches,
  manualTradeTimeframeKey,
  positionFibExitTimeframe,
  normalizeMt5DailyLossPercent,
  sanitizeMt5DailyRisk,
  sanitizeMt5OverallProfit,
  mt5DailyRiskAllowsEntry,
  normalizeMt5EnabledTimeframes,
  normalizeMt5RiskPercent,
  shouldRemoveOpenMt5JournalRecord,
  tradeToMt5Signal,
} from '../src/services/mt5Automation';

test('each strategy selects its own risk and legacy shared risk initializes both new controls', () => {
  const legacy = { riskPercent: 1, scalpOneToOneRiskPercent: .75 };
  assert.equal(mt5StrategyRiskPercent(legacy, 'INTRADAY'), 1);
  assert.equal(mt5StrategyRiskPercent(legacy, 'SCALPING'), 1);
  assert.equal(mt5StrategyRiskPercent(legacy, 'SCALP_1_1'), .75);
  const separate = { ...legacy, intradayRiskPercent: .5, scalpingRiskPercent: 2 };
  assert.equal(mt5StrategyRiskPercent(separate, 'INTRADAY'), .5);
  assert.equal(mt5StrategyRiskPercent(separate, 'SCALPING'), 2);
  assert.equal(mt5StrategyRiskPercent(separate, 'SCALP_1_1'), .75);
  assert.equal(mt5StrategyRiskPercent({ ...separate, scalpingRiskPercent: 3 }, 'INTRADAY'), .5);
  assert.equal(mt5StrategyRiskPercent(separate), 1, 'unclassified legacy entries keep their existing risk');
});

test('manual Fib exit timeframes bind the exact account, contract, ticket and opening identity', () => {
  const connection = { account: 'test-account', server: 'test-server', brokerSymbol: 'XAUUSD' };
  const position = { ticket: 77, identifier: 77, openedAtMsc: 123456, symbol: 'XAUUSD', magic: 0 };
  const key = manualTradeTimeframeKey(connection, position)!;
  assert.equal(key, '["test-account","test-server","XAUUSD",77,77,123456]', 'must match Python key encoding');
  const config = { manualTradeTimeframes: { [key]: 'M15' as const } };
  assert.equal(positionFibExitTimeframe(connection, position, config, []), 'M15');
  for (const changed of [{ ...position, identifier: 78 }, { ...position, openedAtMsc: 123457 }, { ...position, ticket: 78 }]) {
    assert.equal(positionFibExitTimeframe(connection, changed, config, []), undefined);
  }
  assert.equal(positionFibExitTimeframe({ ...connection, account: 'other' }, position, config, []), undefined);
  assert.equal(manualTradeTimeframeKey(connection, { ...position, openedAtMsc: undefined }), undefined);
  assert.equal(manualTradeTimeframeKey(connection, { ...position, symbol: 'XAUUSD.x' }), undefined);
  const automated = { account: connection.account, server: connection.server, brokerSymbol: 'XAUUSD',
    brokerPosition: 77, zoneTimeframe: 'H1', signalTimeframe: 'M15' } as Mt5StoredSignal;
  assert.equal(positionFibExitTimeframe(connection, { ...position, magic: 998877 }, config, [automated]), 'H1');
  assert.equal(positionFibExitTimeframe(connection, { ...position, magic: 998877 }, config,
    [automated, { ...automated, zoneTimeframe: 'M15' }]), undefined, 'conflicting recorded setup timeframes cannot authorize an exit');
});

test('opposing profit zones require current explicit Fibonacci alignment', () => {
  const zone = { id: 'fib-sell', active: true, status: 'valid', isBuy: false, startTime: 100,
    bottom: 110, top: 112, fibStatus: 'a-plus', fibBand: '0.71-0.79' } as StructureZone;
  assert.deepEqual(opposingFibProfitZones([zone], 'M15', 1000), [
    { id: 'fib-sell', timeframe: 'M15', isBuy: false, bottom: 110, top: 112 },
  ]);
  for (const changes of [{ active: false }, { status: 'rejected' }, { fibStatus: 'not-valid' },
    { startTime: 1100 }, { invalidatedAt: 900 }, { fibDeepInvalidatedAt: 800 }, { top: NaN }]) {
    assert.equal(opposingFibProfitZones([{ ...zone, ...changes } as StructureZone], 'M15', 1000).length, 0);
  }
  assert.equal(opposingFibProfitZones([{ ...zone, fibStatus: undefined,
    dayFibStatus: 'a-plus', dayFibBand: '0.71-0.79' }], 'M30', 1000).length, 1);
  assert.equal(opposingFibProfitZones([{ ...zone, fibStatus: undefined, name: 'DT' }], 'M15', 1000).length, 0,
    'a bare DT label is not proof of Fib alignment');
});
import type { Mt5SignalInput, Mt5StoredSignal } from '../src/services/mt5Automation';
import type { StructureLine, StructureZone } from '../src/services/marketStructure';
import type { TradeLevels } from '../src/services/tradeLevels';

test('Fib exit snapshots carry only completed engulfing confirmation for the same aligned zone', () => {
  const zone = { id: 'buy-qml', name: 'QML', category: 'mg', isBuy: true, bottom: 97, top: 101,
    startTime: 0, activeFromTime: 50, endTime: 10_000, active: true, status: 'valid',
    tradeable: true, fibStatus: 'a-plus', fibBand: '0.5-0.618', fibLevel50: 105 } as StructureZone;
  const candles = [
    { time: 100, open: 100, high: 101, low: 98, close: 99, complete: true },
    { time: 1000, open: 99, high: 103, low: 97, close: 102, complete: true },
  ];
  const zones = [zone, { ...zone, id: 'other-qml', bottom: 110, top: 112 }];
  const snapshot = opposingFibProfitZones(zones, 'H1', 1900, { M15: candles });
  assert.equal(snapshot[0].engulfingConfirmedAt, 1900);
  assert.equal(snapshot[1].engulfingConfirmedAt, undefined);
  assert.equal(opposingFibProfitZones([zone], 'H1', 1899, { M15: candles })[0].engulfingConfirmedAt, undefined);
  assert.equal(opposingFibProfitZones([zone], 'H1', 2000, {
    M15: candles.map((c, i) => i === 1 ? { ...c, complete: false } : c),
  })[0].engulfingConfirmedAt, undefined);
  assert.equal(opposingFibProfitZones([{ ...zone, isBuy: false }], 'H1', 2000,
    { M15: candles })[0].engulfingConfirmedAt, undefined);
  assert.equal(opposingFibProfitZones([zone], 'H1', 2000)[0].engulfingConfirmedAt, undefined);
  assert.equal(opposingFibProfitZones([{ ...zone, fibStatus: 'not-valid' }], 'H1', 2000,
    { M15: candles }).length, 0);
  assert.equal(opposingFibProfitZones([zone], 'M5', 1300, { M5: candles })[0].engulfingConfirmedAt, 1300);
});

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

test('only a confirmed broker entry consumes a live zone across routes and legacy identities', () => {
  const candidate = { symbol: 'XAUUSD', zoneTimeframe: 'M15',
    zoneId: 'TJL2-1792708200-4032.49', signalAt: 300 };
  const earlier = { id: 'DIRECT:TJL2-1792708200-4032.49:100:4014.365',
    zoneTimeframe: 'M15', signalAt: 100, openedAt: 110, brokerTicket: 123 };
  assert.equal(tradeRecordZoneExecutionKey(earlier), tradeZoneExecutionKey(candidate));
  assert.equal(findEarlierZoneEntry(candidate, [earlier]), earlier);
  const scalp = { ...earlier, id: 'GOLD_SCALP:M15:TJL2-1792708200-4032.49:100:4014.365' };
  assert.equal(findEarlierZoneEntry(candidate, [scalp]), scalp);
  const legacyDirect = { ...earlier, id: 'DIRECT:M15:TJL2-1792708200-4032.49:100:4014.365' };
  assert.equal(findEarlierZoneEntry(candidate, [legacyDirect]), legacyDirect);
  const mapped = { ...earlier, id: 'MTF:some-setup:100:4014.365', zoneId: candidate.zoneId };
  assert.equal(findEarlierZoneEntry(candidate, [mapped]), mapped);
  assert.equal(findEarlierZoneEntry(candidate, [{ ...earlier, openedAt: undefined }]), undefined);
  const outsideHoursExecution = { ...earlier, outsideTradingTime: true };
  assert.equal(findEarlierZoneEntry(candidate, [outsideHoursExecution]), outsideHoursExecution,
    'a confirmed broker fill remains consumed regardless of the chart session label');
  const broker = { ...earlier, outsideTradingTime: true, mt5Managed: true };
  assert.equal(findEarlierZoneEntry(candidate, [broker]), broker,
    'a real broker entry consumes its zone even when the session filter was disabled');
  assert.equal(findEarlierZoneEntry(candidate, [{ ...earlier, signalAt: 300 }]), undefined,
    'keep the existing entry visible rather than treating it as another entry');
  assert.equal(findEarlierZoneEntry(candidate, [{ ...earlier, symbol: 'EURUSD' }]), undefined);
});

test('an unqualified or simulated chart journal record cannot consume a live zone', () => {
  const candidate = { symbol: 'XAUUSD', zoneTimeframe: 'M15',
    zoneId: 'TJL1-1794492000-3890.29265', signalAt: 1794570300 };
  const paper = { id: 'GOLD_SCALP:M15:TJL1-1794492000-3890.29265:1794528900:3885.585',
    symbol: 'XAUUSD', zoneTimeframe: 'M15', zoneId: candidate.zoneId,
    signalAt: 1794528900, openedAt: 1794529200 };
  for (const record of [paper, { ...paper, mt5Managed: true }, { ...paper, brokerTicket: 0 },
    { ...paper, brokerTicket: -1 }, { ...paper, outsideTradingTime: true }]) {
    assert.equal(findEarlierZoneEntry(candidate, [record]), undefined);
  }
  assert.equal(findEarlierZoneEntry(candidate, [{ ...paper, brokerPosition: 77 }])?.brokerPosition, 77);
  assert.equal(findEarlierZoneEntry(candidate, [{ ...paper, brokerTicket: 77, openedAt: undefined }]), undefined,
    'a pending order is reserved by the signal queue, not proof that an entry filled');
  assert.equal(findEarlierZoneEntry(candidate, [paper, { ...paper, brokerTicket: 78 }])?.brokerTicket, 78,
    'an unqualified paper record must not hide a genuine later broker record');
});

test('a verified missed entry retires its zone across new engulfings and entry routes', () => {
  const connection = { account: '123', server: 'Broker-A', brokerSymbol: 'XAUUSD' };
  const candidate = { symbol: 'XAUUSD', zoneTimeframe: 'M15' as const,
    zoneId: 'TJL1-1794492000-3890.29265', setupId: 'DIRECT:M15:zone' };
  const missed = { ...candidate, ...connection, id: 'first-valid-entry', status: 'EXPIRED',
    entryQualifiedAt: 100, signalAt: 90 } as Mt5StoredSignal;
  const scalp = { ...candidate, setupId: 'GOLD_SCALP:M15:zone', zoneId: 'TJL1-1794492000-3890.30' };
  // A restart loads the same durable evidence; price revisions and routes do not reset it.
  const restored = JSON.parse(JSON.stringify([missed])) as Mt5StoredSignal[];
  assert.equal(findMissedZoneEntry(scalp, restored, connection)?.id, missed.id);
  assert.equal(findMissedZoneEntry(candidate, [{ ...missed, entryQualifiedAt: undefined }], connection), undefined,
    'an old or unqualified expired record is not proof of a valid missed entry');
  for (const status of ['REJECTED', 'SIMULATED', 'ACTIVE', 'TP'] as const) {
    assert.equal(findMissedZoneEntry(candidate, [{ ...missed, status }], connection), undefined);
  }
  assert.equal(findMissedZoneEntry({ ...candidate, zoneId: 'TJL1-1794492900-3890.30' }, restored, connection), undefined);
  assert.equal(findMissedZoneEntry(candidate, restored, { ...connection, account: 'other' }), undefined);
  assert.equal(findMissedZoneEntry(candidate, restored, { ...connection, server: 'other' }), undefined);
  assert.equal(findMissedZoneEntry(candidate, restored, { ...connection, brokerSymbol: 'GOLD' }), undefined);
  assert.equal(findMissedZoneEntry(candidate, [{ ...missed, openedAt: 100, brokerPosition: 77 }], connection), undefined,
    'a confirmed fill is handled by the broker duplicate protection, not labelled missed');
});

test('concurrent H1-zone 15M and 30M confirmations can be displayed without releasing the used-zone block', () => {
  const candidate = { symbol: 'XAUUSD', zoneTimeframe: 'H1',
    zoneId: 'iss-l4-1793894400', signalAt: 1794192300, signalTimeframe: 'M15' as const };
  const manual = { id: 'DIRECT:iss-l4-1793894400:1794191400:4120.17',
    zoneTimeframe: 'H1', signalAt: 1794191400, signalTimeframe: 'M30' as const, openedAt: 1794193200, brokerTicket: 123 };
  assert.equal(findEarlierZoneEntry(candidate, [manual]), manual, 'execution stays blocked');
  assert.equal(isSameZoneEntryConfirmation(candidate, manual), true,
    'both signals confirm at 08:45 Nepal and may share an entry reference');
  assert.equal(isSameZoneEntryConfirmation(candidate, { ...manual, signalAt: 1794189600 }), false,
    'a genuinely earlier entry is not a reference for this confirmation');
  assert.equal(isSameZoneEntryConfirmation(candidate, { ...manual, signalTimeframe: undefined }), false,
    'do not guess the confirmation timeframe of a legacy record');
  assert.equal(isSameZoneEntryConfirmation(candidate, { ...manual, zoneTimeframe: 'M15' }), false);
  assert.equal(isSameZoneEntryConfirmation(candidate, { ...manual, symbol: 'EURUSD' }), false);
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

test('gold entry guards block bearish one-minute buys, opposing zones before 1R, and repeat stopped areas', () => {
  const candidate = {
    symbol: 'XAUUSD', direction: 'BUY', signalTimeframe: 'M1',
    entry: 100, stopLoss: 97, takeProfit: 109, signalAt: 2_000, calculatedAt: 2_060,
    journalContext: { biasAtEntry: { M15: 'bearish', H1: 'bearish' } },
  } as unknown as Mt5SignalInput;
  assert.equal(goldAutomationCountertrendBlocked(candidate), true);
  assert.equal(goldAutomationCountertrendBlocked({ ...candidate,
    journalContext: { ...candidate.journalContext!, biasAtEntry: {
      ...candidate.journalContext!.biasAtEntry, H1: 'bullish',
    } },
  }), false);
  const sellZone = { active: true, status: 'valid', isBuy: false, opposingEngulfingConfirmedAt: 1_000,
    id: 'confirmed-sell', name: 'QML', category: 'mg', endTime: 3_000,
    startTime: 0, bottom: 102, top: 104 } as const;
  assert.equal(goldAutomationOpposingZoneBlocked(candidate, [sellZone]), true);
  assert.equal(goldAutomationOpposingZoneBlocked(candidate, [{ ...sellZone, bottom: 103, top: 106 }]), false);
  assert.equal(goldAutomationOpposingZoneBlocked(candidate, [{ ...sellZone, bottom: 104, top: 106 }]), false);
  assert.equal(goldAutomationOpposingZoneBlocked(candidate, [{ ...sellZone, bottom: 110, top: 112 }]), false);
  assert.equal(goldAutomationOpposingZoneBlocked(candidate, [{ ...sellZone, status: 'invalidated' }]), false);
  const picturedSell = { ...candidate, direction: 'SELL' as const,
    entry: 3959.4, stopLoss: 3972.31, takeProfit: 3933.58 };
  const picturedBuyZone = { ...sellZone, name: 'TJL2' as const, isBuy: true,
    bottom: 3950.575, top: 3954.817 };
  const obstacle = goldOpposingZoneBeforeOneR(picturedSell, [picturedBuyZone]);
  assert.equal(obstacle?.zone.name, 'TJL2');
  assert.ok(Math.abs((obstacle?.rewardRisk ?? 0) - 0.355) < 0.001);
  assert.equal(goldAutomationOpposingZoneBlocked(picturedSell,
    [{ ...picturedBuyZone, bottom: 3942, top: 3946.48 }]), false);
  const previous = [{ symbol: 'XAUUSD', direction: 'BUY', status: 'SL',
    entry: 101, stopLoss: 98, closedAt: 1_260 }] as Mt5StoredSignal[];
  assert.equal(goldAutomationRepeatAreaBlocked(candidate, previous, []), true);
  const confirmedChoch = [{ type: 'choch', direction: 'bullish', toTime: 800 }] as StructureLine[];
  assert.equal(goldAutomationRepeatAreaBlocked(candidate, previous, confirmedChoch), false);
  assert.equal(goldAutomationRepeatAreaBlocked({ ...candidate, entry: 110, stopLoss: 107 }, previous, []), false);
});

test('opposing QML blocks only after its own completed, direction-matching engulfing', () => {
  const zone = { id: 'h1-qml', name: 'QML', category: 'mg', isBuy: true,
    bottom: 3975.65, top: 4000.774, startTime: 0, endTime: 10_000,
    activeFromTime: 100, active: true, status: 'valid', tradeable: true,
    fibStatus: 'a-plus', fibBand: '0.5-0.618', fibLevel50: 4009.515 } as StructureZone;
  const sell = { direction: 'SELL' as const, entry: 3989.055, stopLoss: 4002.73,
    signalAt: 5_000, calculatedAt: 5_900 };
  // The pictured T2: the aligned zone is touched, but exact Fib 50% is not.
  const candles = [
    { time: 1_000, open: 3982.165, high: 3984.175, low: 3978.245, close: 3978.77, complete: true },
    { time: 1_900, open: 3978.825, high: 3985.705, low: 3968.765, close: 3982.71, complete: true },
    { time: 2_800, open: 3983.02, high: 3995.415, low: 3980.745, close: 3994.345, complete: true },
  ];
  assert.equal(goldOpposingZoneBeforeOneR(sell, [zone]), undefined);
  assert.equal(goldOpposingZoneBeforeOneR(sell, prepareGoldOpposingZones([zone], 'H1', {})), undefined);
  for (const timeframe of ['H1'] as const) {
    const prepared = prepareGoldOpposingZones([zone], timeframe, { M15: candles });
    assert.equal(prepared[0].opposingEngulfingConfirmedAt, 3_700);
    assert.equal(goldOpposingZoneBlockLabel({ zone: prepared[0], rewardRisk: 0 }),
      `NO ENTRY · ${timeframe} QML BUY CONFIRMED BY M15 T2 · 0.00R`);
    assert.equal(goldOpposingZoneBeforeOneR(sell, prepared)?.rewardRisk, 0);
    assert.equal(goldOpposingZoneBeforeOneR({ ...sell, signalAt: 2_700, calculatedAt: 3_699 }, prepared), undefined);
    assert.equal(goldOpposingZoneBeforeOneR({ ...sell, signalAt: 2_800, calculatedAt: 3_700 }, prepared)?.rewardRisk, 0);
    assert.equal(goldOpposingZoneBeforeOneR(sell, prepareGoldOpposingZones([zone], timeframe,
      { M15: candles.map((c, i) => i === 2 ? { ...c, complete: false } : c) })), undefined);
  }
  assert.equal(goldOpposingZoneBeforeOneR(sell, prepareGoldOpposingZones([zone], 'H1', {
    M15: candles.map(c => ({ ...c, open: c.open + 100, high: c.high + 100,
      low: c.low + 100, close: c.close + 100 })),
  })), undefined, 'an unrelated engulfing outside this QML cannot confirm it');
  assert.equal(goldOpposingZoneBeforeOneR(sell, prepareGoldOpposingZones([
    { ...zone, activeFromTime: 4_000 },
  ], 'H1', { M15: candles })), undefined, 'confirmation before zone activation does not count');
  assert.equal(goldOpposingZoneBeforeOneR(sell, prepareGoldOpposingZones([
    { ...zone, active: false, status: 'invalidated' },
  ], 'H1', { M15: candles })), undefined);
  const mirrored = candles.map(c => ({ ...c, open: 8000 - c.open, close: 8000 - c.close,
    high: 8000 - c.low, low: 8000 - c.high }));
  assert.equal(goldOpposingZoneBeforeOneR(sell,
    prepareGoldOpposingZones([zone], 'H1', { M15: mirrored })), undefined,
  'a bearish engulfing does not confirm a BUY zone');
  const buy = { ...sell, direction: 'BUY' as const, entry: 8000 - sell.entry, stopLoss: 8000 - sell.stopLoss };
  const sellZone = { ...zone, isBuy: false, bottom: 8000 - zone.top, top: 8000 - zone.bottom };
  assert.equal(goldOpposingZoneBeforeOneR(buy, [sellZone]), undefined);
  assert.equal(goldOpposingZoneBeforeOneR(buy,
    prepareGoldOpposingZones([sellZone], 'H1', { M15: mirrored }))?.rewardRisk, 0);
  assert.equal(goldOpposingZoneBeforeOneR(sell,
    prepareGoldOpposingZones([zone], 'H1', { M30: candles }))?.rewardRisk, 0);
  assert.equal(goldOpposingZoneBeforeOneR(sell,
    prepareGoldOpposingZones([zone], 'H4', { M30: candles })), undefined,
  'unmapped M30 confirmation is not accepted for an H4 zone');
  assert.equal(goldOpposingZoneBeforeOneR(sell,
    prepareGoldOpposingZones([zone], 'H4', { M15: candles })), undefined,
  'a bare M15 engulfing cannot confirm H4 without the MTF CHoCH setup');
});

test('table close labels use actual broker volume and reject inconsistent exit telemetry', () => {
  const raw = { ticket: 77, direction: 'BUY', originalVolume: 0.05, remainingVolume: 0.01,
    phase: 'touch', status: 'partial', updatedAt: 1000, zoneTimeframe: 'M15', zoneName: 'QML' };
  const [event] = sanitizeMt5FibProfitEvents([raw]);
  assert.ok(event);
  assert.equal(mt5FibProfitEventLabel(event), '80% CLOSED · 20% RUNNING');
  assert.equal(mt5FibProfitEventLabel({ ...event, originalVolume: 0.02 }), '50% CLOSED · 50% RUNNING');
  assert.equal(mt5FibProfitEventLabel({ ...event, remainingVolume: 0, status: 'closed', phase: 'engulfing' }),
    'FULLY CLOSED · Opposing engulfing confirmed');
  assert.equal(mt5FibProfitEventLabel({ ...event, remainingVolume: 0, status: 'closed' }),
    'FULLY CLOSED · Fib zone touch');
  for (const change of [{ status: 'pending' }, { status: 'closed' }, { remainingVolume: 0 },
    { remainingVolume: -1 }, { remainingVolume: 0.06 }, { originalVolume: NaN }, { direction: 'invalid' },
    { ticket: -1 }, { updatedAt: Infinity }]) {
    assert.deepEqual(sanitizeMt5FibProfitEvents([{ ...raw, ...change }]), []);
  }
  assert.deepEqual(sanitizeMt5FibProfitEvents(undefined), []);
});

test('chart and MT5 share the exact one-minute buy countertrend rule', () => {
  assert.equal(goldM1BuyCountertrendBlocked('M1', 'BUY', 'bearish', 'bearish'), true);
  assert.equal(goldM1BuyCountertrendBlocked('M1', 'BUY', 'bearish', 'bullish'), false);
  assert.equal(goldM1BuyCountertrendBlocked('M1', 'SELL', 'bearish', 'bearish'), false);
  assert.equal(goldM1BuyCountertrendBlocked('M5', 'BUY', 'bearish', 'bearish'), false);
  assert.equal(goldM1BuyCountertrendBlocked('M1', 'BUY', undefined, 'bearish'), false);
});

test('bearish M15 and H1 block M5 scalp buys while allowing MTF buys', () => {
  const candidate = {
    source: 'ENGULFING', tradeStyle: 'SCALPING', signalTimeframe: 'M5', direction: 'BUY',
    journalContext: { biasAtEntry: { M15: 'bearish', H1: 'bearish' } },
  } as unknown as Mt5SignalInput;
  assert.equal(goldM5ScalpingBuyCountertrendBlocked('M5', 'BUY', 'bearish', 'bearish'), true);
  assert.equal(goldAutomationCountertrendBlocked(candidate), true);
  assert.equal(goldAutomationCountertrendBlocked({ ...candidate, source: 'MTF' }), false);
  assert.equal(goldAutomationCountertrendBlocked({ ...candidate, tradeStyle: 'INTRADAY' }), false);
  assert.equal(goldAutomationCountertrendBlocked({ ...candidate, direction: 'SELL' }), false);
  assert.equal(goldAutomationCountertrendBlocked({ ...candidate,
    journalContext: { ...candidate.journalContext!, biasAtEntry: {
      ...candidate.journalContext!.biasAtEntry, H1: 'bullish',
    } },
  }), false);
  assert.equal(goldAutomationCountertrendBlocked({ ...candidate,
    source: 'MTF', signalTimeframe: 'M1',
  }), true);
});

test('fast-move guard only uses completed candles available at signal time', () => {
  const candles = Array.from({ length: 23 }, (_, index) => ({
    time: index * 60, open: 100, high: index === 22 ? 104 : 101,
    low: 100, close: 100, volume: 10, complete: true,
  }));
  const candidate = { signalTimeframe: 'M1', signalAt: 22 * 60,
    calculatedAt: 23 * 60, entry: 100, stopLoss: 97,
    journalContext: { entrySnapshotCandles: candles },
  } as unknown as Mt5SignalInput;
  assert.equal(goldAutomationFastMoveBlocked(candidate), true);
  assert.equal(goldAutomationFastMoveBlocked({ ...candidate,
    journalContext: { ...candidate.journalContext!, entrySnapshotCandles: [
      ...candles.slice(0, 22), { ...candles[22], high: 101 }, { ...candles[22], time: 23 * 60 },
    ] },
  }), false);
});

test('high-impact USD news calendar preserves the event timezone and pauses only around that event', () => {
  const events = goldAutomationHighImpactUsdNewsTimes([
    { country: 'USD', impact: 'High', date: '2026-10-30T08:30:00-04:00' },
    { country: 'USD', impact: 'Low', date: '2026-10-30T09:00:00-04:00' },
    { country: 'EUR', impact: 'High', date: '2026-10-30T10:00:00+01:00' },
  ]);
  const release = Date.parse('2026-10-30T12:30:00Z') / 1000;
  assert.deepEqual(events, [release]);
  assert.equal(goldAutomationNewsPauseUntil(events, release - 901), undefined);
  assert.equal(goldAutomationNewsPauseUntil(events, release - 900), release + 900);
  assert.equal(goldAutomationNewsPauseUntil(events, release + 900), release + 900);
  assert.throws(() => goldAutomationHighImpactUsdNewsTimes([{ country: 'USD', impact: 'High', date: 'unknown' }]));
});
