import assert from 'node:assert/strict';
import test from 'node:test';
import {
  directZoneTableGroupKey,
  groupDirectZoneTableRows,
  hasIdentifiedDirectZoneLabel,
  isDirectTradeOverlay,
  isRetainedDirectZoneTableEntry,
  isTradeOverlayTerminated,
  isTradeOverlayVisibleOnTimeframe,
  liveMtfPositionMatchesChartRow,
  normalizeTradeSetupId,
  retainedDirectTradeHasSource,
  chartSignalMatchesLoadedCandles,
  resolveTradeOverlaySetupKey,
  tradeOverlayEntryEventKey,
  tradeOverlayExecutionKey,
  tradeOverlaySetupEntryKey,
  tradeOverlayZoneLabel,
  tradeOverlayZoneOriginKey,
} from '../src/services/tradeOverlayIdentity';

test('matches a slipped MT5 direct fill to its chart setup', () => {
  const zoneId = 'TJL2-1792156500-4160.171200000001';
  const chartKey = resolveTradeOverlaySetupKey(
    `DIRECT:${zoneId}:1792171800:4165.02`,
  );
  const brokerKey = resolveTradeOverlaySetupKey(
    'MT5:58939721162',
    `DIRECT:M15:${zoneId}`,
  );

  assert.equal(chartKey, `DIRECT:${zoneId}`);
  assert.equal(brokerKey, chartKey);
});

test('keeps MTF setup identities unchanged', () => {
  assert.equal(normalizeTradeSetupId('MTF:setup-42'), 'MTF:setup-42');
  assert.equal(
    resolveTradeOverlaySetupKey('MTF:setup-42:1792171800:4165.02'),
    'MTF:setup-42',
  );
});

test('matches one broker MTF entry to its chart row across differing feed zone IDs', () => {
  const position = {
    setupId: 'MTF:M15-M1-external-choch-broker',
    source: 'MTF', zoneTimeframe: 'M15', signalTimeframe: 'M1',
    signalAt: 1792651260, direction: 'BUY' as const,
  };
  const row = {
    id: 'M15-M1-external-choch-chart', higherTimeframe: 'M15',
    lowerTimeframe: 'M1', direction: 'bullish' as const, engulfingTime: 1792651260,
  };
  assert.equal(liveMtfPositionMatchesChartRow(position, row), true);
  assert.equal(liveMtfPositionMatchesChartRow(position, { ...row, engulfingTime: 1792651320 }), false);
  assert.equal(liveMtfPositionMatchesChartRow(position, { ...row, direction: 'bearish' }), false);
  assert.equal(liveMtfPositionMatchesChartRow(position, { ...row, higherTimeframe: 'H1' }), false);
});

test('identifies duplicate chart entries without merging distinct prices', () => {
  const trade = {
    signal: { timeframe: 'M15', direction: 'bullish', time: 1792647900 },
    entry: 4084.8, stopLoss: 4064.8, takeProfit: 4124.8,
  };
  assert.equal(tradeOverlayExecutionKey(trade), tradeOverlayExecutionKey({ ...trade }));
  assert.equal(tradeOverlayExecutionKey(trade), tradeOverlayExecutionKey({
    ...trade, entry: 4084.800000000001,
  }));
  assert.notEqual(tradeOverlayExecutionKey(trade), tradeOverlayExecutionKey({ ...trade, entry: 4085 }));
  assert.equal(tradeOverlayExecutionKey(trade), tradeOverlayExecutionKey({
    ...trade, signal: { ...trade.signal, time: 1792648800 },
  }), 'the zone table shows one pending entry even when two zone taps have different times');
});

test('does not merge different direct zones', () => {
  assert.notEqual(
    resolveTradeOverlaySetupKey('DIRECT:zone-a:100:10'),
    resolveTradeOverlaySetupKey('MT5:1', 'DIRECT:M15:zone-b'),
  );
});

test('the DT result and its repeated-tap row represent one zone entry', () => {
  const zoneId = 'DT-origin-4146.920';
  const retained = { signal: { timeframe: 'M15', direction: 'bearish', time: 1800 },
    filledAt: 2700, entry: 4140.320, stopLoss: 4146.920, takeProfit: 4127.120, result: 'tp' };
  const current = { ...retained, tapCount: 2, status: 'tp-hit' };
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], current, zoneId, retained), true,
    'a second tap must not bypass the duplicate check for the same completed entry');
  const visibleCurrent = [current].filter(trade => !isRetainedDirectZoneTableEntry([zoneId], trade, zoneId, retained));
  assert.equal(visibleCurrent.length + [retained].length, 1);
  assert.equal(retained.result, 'tp');
  assert.equal(isRetainedDirectZoneTableEntry(['confluence-zone', zoneId], current, zoneId, retained), true);
});

test('different DT origins, entry times, directions and timeframes stay separate even at identical prices', () => {
  const zoneId = 'DT-origin-a';
  const retained = { signal: { timeframe: 'M15', direction: 'bearish', time: 1800 },
    filledAt: 2700, entry: 4140.320, stopLoss: 4146.920, takeProfit: 4127.120 };
  assert.equal(isRetainedDirectZoneTableEntry(['DT-origin-b'], retained, zoneId, retained), false);
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], { ...retained,
    signal: { ...retained.signal, time: 3600 }, filledAt: 4500 }, zoneId, retained), false);
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], { ...retained,
    signal: { ...retained.signal, direction: 'bullish' } }, zoneId, retained), false);
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], { ...retained,
    signal: { ...retained.signal, timeframe: 'H1' } }, zoneId, retained), false);
});

test('pending entries match their signal and a broker fill matches its execution rather than its prices', () => {
  const zoneId = 'DT-origin-a';
  const pending = { signal: { timeframe: 'M15', direction: 'bearish', time: 1800 }, filledAt: undefined };
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], { ...pending }, zoneId, pending), true);
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], { ...pending,
    signal: { ...pending.signal, time: 3600 } }, zoneId, pending), false);
  const filled = { ...pending, filledAt: 2700, entry: 4140.320 };
  const slippedFill = { ...filled, entry: 4140.300, filledAt: 2701 };
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], slippedFill, zoneId, filled), true);
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], { ...filled,
    signal: { ...filled.signal, time: 1801 } }, zoneId, filled), true,
    'the same filled execution survives feed confirmation-time revisions');
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], undefined, zoneId, filled), false);
  assert.equal(isRetainedDirectZoneTableEntry([zoneId], filled, undefined, filled), false);
});

test('DT row identity survives a revised price suffix but never merges a new origin at the same price', () => {
  const oldZone = 'DT-1794290000-4140.320000000001';
  const currentZone = 'DT-1794290000-4140.32';
  const trade = { signal: { timeframe: 'M15', direction: 'bearish', time: 1794291800 } };
  assert.equal(tradeOverlayZoneOriginKey(currentZone), tradeOverlayZoneOriginKey(oldZone));
  assert.equal(isRetainedDirectZoneTableEntry([currentZone], trade, oldZone, trade), true);
  assert.equal(isRetainedDirectZoneTableEntry(['DT-1794290900-4140.32'], trade, oldZone, trade), false);
  assert.equal(isRetainedDirectZoneTableEntry(['DB-1794290000-4140.32'], trade, oldZone, trade), false);
});

const confirmationRow = (id: string, timeframe: string, type: string, confirmedAt: number, filledAt?: number) => ({
  overlay: { id, symbol: 'XAUUSD' }, sourceZoneId: 'DT-1793850300-4146.92', confirmedAt,
  trade: { signal: { timeframe, type, direction: 'bearish', time: confirmedAt - (timeframe === 'M30' ? 1800 : 900) },
    filledAt, entry: 4135.265, stopLoss: 4148.2, takeProfit: 4109.395, result: 'tp' },
});

test('the reported 15m T1 remains one original DT row and 30m T4 becomes a small confirmation', () => {
  const first = confirmationRow('DT-T1', 'M15', 'T1', 1794260700, 1794260700);
  const later = { ...confirmationRow('DT-T4', 'M30', 'T4', 1794270600, 1794270600),
    trade: { ...confirmationRow('DT-T4', 'M30', 'T4', 1794270600, 1794270600).trade,
      entry: 4128.94, stopLoss: 4150.71, takeProfit: 4085.4 } };
  const before = JSON.stringify([first, later]);
  const rows = groupDirectZoneTableRows([later, first], [], 1794280000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].overlay.id, 'DT-T1');
  assert.equal(rows[0].trade, first.trade, 'prices and result belong to the original trade');
  assert.deepEqual(rows[0].additionalConfirmations.map(c => `${c.signal.timeframe} ${c.signal.type}`), ['M30 T4']);
  assert.equal(JSON.stringify([first, later]), before, 'display grouping never rewrites saved entries');
});

test('additional confirmations do not replace an original SL with a later TP or create repeated labels', () => {
  const first = confirmationRow('original', 'M15', 'T1', 10000, 10000);
  first.trade.result = 'sl';
  const later = confirmationRow('confirmation', 'M30', 'T2', 12000, 12000);
  const repeat = confirmationRow('repeat', 'M30', 'T2', 14000, 14000);
  const rows = groupDirectZoneTableRows([repeat, first, later], [], 20000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trade.result, 'sl');
  assert.equal(rows[0].trade.entry, first.trade.entry);
  assert.equal(rows[0].additionalConfirmations.length, 1);
  assert.equal(rows[0].additionalConfirmations[0].signal.type, 'T2');
});

test('annotations require a later completed confirmation and never reveal future replay signals', () => {
  const first = confirmationRow('original', 'M15', 'T1', 10000, 11000);
  const extra = (confirmedAt: number, type: string) => ({ sourceZoneId: first.sourceZoneId, symbol: 'XAUUSD',
    signal: { timeframe: 'M30', type, direction: 'bearish', time: confirmedAt - 1800 }, confirmedAt });
  const rows = groupDirectZoneTableRows([first], [extra(10500, 'T2'), extra(12000, 'T3'), extra(16000, 'T4')], 15000);
  assert.deepEqual(rows[0].additionalConfirmations.map(c => c.signal.type), ['T3']);
  assert.equal(groupDirectZoneTableRows([first], [], 10500).length, 0, 'a future fill cannot supply an entry row');
});

test('grouping keeps distinct origins, symbols and directions separate while allowing revised price suffixes', () => {
  const first = confirmationRow('original', 'M15', 'T1', 10000, 10000);
  const later = confirmationRow('later', 'M30', 'T2', 12000, 12000);
  later.sourceZoneId = 'DT-1793850300-4146.920000001';
  assert.equal(groupDirectZoneTableRows([first, later], [], 20000).length, 1);
  const otherOrigin = { ...later, sourceZoneId: 'DT-1793851200-4146.92' };
  const otherMarket = { ...later, overlay: { id: 'forex', symbol: 'EURUSD' } };
  const otherDirection = { ...later, trade: { ...later.trade, signal: { ...later.trade.signal, direction: 'bullish' } } };
  assert.equal(groupDirectZoneTableRows([first, otherOrigin, otherMarket, otherDirection], [], 20000).length, 4);
  assert.notEqual(directZoneTableGroupKey(first.sourceZoneId, 'XAUUSD', 'bearish'),
    directZoneTableGroupKey(otherOrigin.sourceZoneId, 'XAUUSD', 'bearish'));
});

test('classifies only direct overlays for the Zone Table', () => {
  assert.equal(isDirectTradeOverlay('DIRECT:zone-a:100:10'), true);
  assert.equal(isDirectTradeOverlay('MTF:setup-42:100:10'), false);
  assert.equal(isDirectTradeOverlay('MT5:1', 'MTF:setup-42'), false);
  assert.equal(isDirectTradeOverlay('MT5:2', 'DIRECT:M15:zone-a'), true);
});

test('rejects retained direct trades whose originating zone label was lost', () => {
  const id = 'DIRECT:zone-a:100:10';
  assert.equal(hasIdentifiedDirectZoneLabel(id, undefined, 'SBR · CHART · 1:2'), true);
  assert.equal(hasIdentifiedDirectZoneLabel(id, undefined, 'CHART · CHART · 1:2'), false);
  assert.equal(hasIdentifiedDirectZoneLabel(id, undefined, undefined), false);
  assert.equal(hasIdentifiedDirectZoneLabel('MTF:setup-42:100:10', undefined, undefined), true);
});

test('a retained direct BUY needs its own tapped source zone when the signal is loaded', () => {
  const overlay = {
    id: 'DIRECT:TJL2-100-4115:300:4133.575',
    label: 'TJL2 · CHART · 1:2',
    signalTime: 300,
    direction: 'bullish' as const,
  };
  const signalCandles = [{ time: 300 }];
  const tappedBuy = { id: 'TJL2-100-4115', name: 'TJL2', isBuy: true, tapTime: 200 };
  assert.equal(retainedDirectTradeHasSource(overlay, signalCandles, [[
    { id: 'TJL2-200-4149', name: 'TJL2', isBuy: false, tapTime: 250 },
  ]]), false, 'a tapped SELL TJL2 cannot support the saved BUY');
  assert.equal(retainedDirectTradeHasSource(overlay, signalCandles, [[
    { id: tappedBuy.id, name: 'TJL2', isBuy: true },
  ]]), false, 'the matching BUY zone must actually be tapped');
  assert.equal(retainedDirectTradeHasSource(overlay, signalCandles, [[
    { ...tappedBuy, name: 'RBS' },
  ]]), false, 'a renamed source cannot keep its old TJL2 trade label');
  assert.equal(retainedDirectTradeHasSource(overlay, signalCandles, [[
    { ...tappedBuy, tapTime: 400 },
  ]]), false, 'a later tap cannot justify an earlier signal');
  assert.equal(retainedDirectTradeHasSource(overlay, signalCandles, [[], [tappedBuy]]), true,
    'a tapped source on another eligible zone timeframe can support the trade');
  assert.equal(retainedDirectTradeHasSource(overlay, signalCandles, [[], undefined]), true,
    'wait for all eligible source feeds before rejecting a saved trade');
  assert.equal(retainedDirectTradeHasSource(overlay, [], [[]]), true,
    'preserve a trade whose historical signal is outside loaded candles');
});

test('rejects the pictured one-minute T3 wrongly retained as a fifteen-minute chart entry', () => {
  const overlay = { id: 'DIRECT:TJL1-1794490080-3907.42285:1794493320:3892.86',
    label: 'TJL1 · CHART · 1:2', signalTime: 1794493320, direction: 'bearish' as const };
  const m15 = [{ time: 1794492900 }, { time: 1794493800 }, { time: 1794494700 }];
  const m1 = [{ time: 1794493260 }, { time: 1794493320 }, { time: 1794493380 }];
  assert.equal(chartSignalMatchesLoadedCandles(overlay.signalTime, m15), false);
  assert.equal(retainedDirectTradeHasSource(overlay, m15, [[], []]), false);
  assert.equal(retainedDirectTradeHasSource(overlay, m15, [undefined]), false,
    'known wrong signal candles cannot be accepted because auxiliary zones are still loading');
  assert.equal(chartSignalMatchesLoadedCandles(overlay.signalTime, m1), true);
  assert.equal(chartSignalMatchesLoadedCandles(overlay.signalTime, []), true, 'missing history is unknown');
  assert.equal(chartSignalMatchesLoadedCandles(1794492000, m15), true, 'older records are preserved');
  assert.equal(chartSignalMatchesLoadedCandles(undefined, m15), true);
  assert.equal(retainedDirectTradeHasSource({ ...overlay, id: 'MT5:77' }, m15, [[]]), true,
    'an actual broker fill is never invalidated by chart candle timestamps');
});

test('shows only the learned zone name in a retained direct-trade table row', () => {
  assert.equal(tradeOverlayZoneLabel('DT · CHART · 1:2'), 'DT');
  assert.equal(tradeOverlayZoneLabel('Internal RBS · CHART · 1:3'), 'Internal RBS');
  assert.equal(tradeOverlayZoneLabel(undefined), undefined);
});

test('shows a trade drawing only on its engulfing entry timeframe', () => {
  assert.equal(isTradeOverlayVisibleOnTimeframe('M15', 'M15'), true);
  assert.equal(isTradeOverlayVisibleOnTimeframe('M1', 'M15'), false);
  assert.equal(isTradeOverlayVisibleOnTimeframe('M1', 'M1'), true);
  assert.equal(isTradeOverlayVisibleOnTimeframe('M15', 'M1'), false);
});

test('matches recalculated and broker drawings from the same entry event', () => {
  const chartEvent = tradeOverlayEntryEventKey({
    timeframe: 'M15', direction: 'bullish', time: 1792171800,
  });
  const brokerEvent = tradeOverlayEntryEventKey({
    timeframe: 'M15', direction: 'bullish', time: 1792171800,
  });
  const laterEvent = tradeOverlayEntryEventKey({
    timeframe: 'M15', direction: 'bullish', time: 1792172700,
  });

  assert.equal(chartEvent, brokerEvent);
  assert.notEqual(chartEvent, laterEvent);
});

test('removes every drawing copy immediately after SL or TP completes its execution', () => {
  const completedSetups = new Set(['DIRECT:zone-a', 'MTF:setup-42'].map(setup => (
    tradeOverlaySetupEntryKey(setup, 'M15:bullish:1792171800')
  )));
  const completedEvents = new Set(['M15:bullish:1792171800']);

  assert.equal(isTradeOverlayTerminated(
    'DIRECT:zone-a', 'M15:bullish:1792171800', false, completedSetups, completedEvents,
  ), true, 'a stale active copy cannot outlive a completed setup');
  assert.equal(isTradeOverlayTerminated(
    'DIRECT:recalculated-zone', 'M15:bullish:1792171800', false, completedSetups, completedEvents,
  ), true, 'a recalculated ID is still removed by its completed entry event');
  assert.equal(isTradeOverlayTerminated(
    'DIRECT:zone-b', 'M15:bearish:1792172700', true, completedSetups, completedEvents,
  ), true, 'a completed overlay never draws itself');
  assert.equal(isTradeOverlayTerminated(
    'DIRECT:zone-b', 'M15:bearish:1792172700', false, completedSetups, completedEvents,
  ), false, 'an unrelated unresolved execution remains visible');
});

test('the earlier TJL2 result cannot hide the reported later active entry from the same zone', () => {
  const setup = 'DIRECT:TJL2-1793293200-4025.59';
  const earlierEvent = tradeOverlayEntryEventKey({ timeframe: 'M15', direction: 'bearish', time: 1793306700 });
  const activeEvent = tradeOverlayEntryEventKey({ timeframe: 'M15', direction: 'bearish', time: 1793314800 });
  const completedSetups = new Set([tradeOverlaySetupEntryKey(setup, earlierEvent)]);
  const completedEvents = new Set([earlierEvent]);
  assert.equal(isTradeOverlayTerminated(setup, activeEvent, false, completedSetups, completedEvents), false,
    'the active 4013.620 entry remains drawable after the earlier 4024.035 entry completes');
  assert.equal(isTradeOverlayTerminated(setup, earlierEvent, false, completedSetups, completedEvents), true,
    'a stale active copy of the earlier completed entry stays hidden');
  const drawnSetups = new Set([tradeOverlaySetupEntryKey(setup, earlierEvent)]);
  assert.equal(drawnSetups.has(tradeOverlaySetupEntryKey(setup, activeEvent)), false,
    'drawing the earlier result must not deduplicate the later entry');
  assert.equal(isTradeOverlayTerminated(setup, earlierEvent, false, completedSetups, new Set()), true,
    'the setup check still recognizes the same completed entry');
});
