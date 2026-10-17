import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasIdentifiedDirectZoneLabel,
  isDirectTradeOverlay,
  isTradeOverlayTerminated,
  isTradeOverlayVisibleOnTimeframe,
  normalizeTradeSetupId,
  resolveTradeOverlaySetupKey,
  tradeOverlayEntryEventKey,
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
  const completedSetups = new Set(['DIRECT:zone-a', 'MTF:setup-42']);
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
