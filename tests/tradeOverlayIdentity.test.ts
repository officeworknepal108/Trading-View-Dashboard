import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasIdentifiedDirectZoneLabel,
  isDirectTradeOverlay,
  isTradeOverlayTerminated,
  isTradeOverlayVisibleOnTimeframe,
  liveMtfPositionMatchesChartRow,
  normalizeTradeSetupId,
  retainedDirectTradeHasSource,
  resolveTradeOverlaySetupKey,
  tradeOverlayEntryEventKey,
  tradeOverlayExecutionKey,
  tradeOverlaySetupEntryKey,
  tradeOverlayZoneLabel,
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
