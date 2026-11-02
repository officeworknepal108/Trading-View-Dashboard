import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPostChochH1SwingFibConfluence, applySwingFibConfluence } from '../src/services/swingFibConfluence';
import type { StructureCandle, StructureLine, StructureZone } from '../src/services/marketStructure';
import { resolveZoneEngulfingSignal } from '../src/services/tradeLevels';
import type { SwingFibMove } from '../src/services/swingFib';

function zone(overrides: Partial<StructureZone>): StructureZone {
  return {
    id: 'zone', name: 'TJL2', category: 'mg', isBuy: false,
    startTime: 0, endTime: 100, activeFromTime: 1,
    top: 112, bottom: 111, active: true, status: 'valid',
    ...overrides,
  };
}

const sellMove: SwingFibMove = {
  direction: 'down', startedAt: 0,
  sourceTime: 0, sourcePrice: 120,
  zeroTime: 2, zeroPrice: 100,
};

const previousBuyMove: SwingFibMove = {
  direction: 'up', startedAt: -10,
  sourceTime: -10, sourcePrice: 100,
  zeroTime: 0, zeroPrice: 120,
};

test('1H swing qualifies only a pre-existing M15 TJL after opposite CHoCH and completed engulfing', () => {
  const choch: StructureLine = {
    id: 'm15-choch', type: 'choch', direction: 'bullish', label: 'CHoCH',
    fromTime: 0, toTime: 1800, fromPrice: 100, toPrice: 100,
  };
  const candles: StructureCandle[] = [
    { time: 3600, open: 110, high: 113, low: 109, close: 112, complete: true },
    { time: 4500, open: 112, high: 113.5, low: 108, close: 108.5, complete: true },
    { time: 5400, open: 108.5, high: 109, low: 107, close: 108, complete: false },
  ];
  const candidates = [
    zone({ id: 'matching-tjl1', name: 'TJL1', startTime: 900,
      activeFromTime: 1800, bottom: 110.5, top: 112, swingFibBand: '0.71-0.79' }),
    zone({ id: 'wrong-zone', name: 'QML', startTime: 900, bottom: 110.5, top: 112 }),
    zone({ id: 'newer-zone', name: 'TJL2', startTime: 2700, bottom: 110.5, top: 112 }),
    zone({ id: 'wrong-side', name: 'TJL2', isBuy: true, startTime: 900,
      bottom: 110.5, top: 112 }),
  ];
  const result = applyPostChochH1SwingFibConfluence(candles, candidates, [choch], [sellMove]);
  assert.equal(result[0].h1SwingFibBand, '0.5-0.618');
  assert.equal(result[0].h1SwingEngulfingType, 'T1');
  assert.equal(result[0].swingFibBand, '0.71-0.79', '4H swing metadata is preserved');
  assert.equal(resolveZoneEngulfingSignal(result[0], 'M15')?.time, 4500);
  assert.ok(result.slice(1).every((item) => item.h1SwingFibStatus === undefined));
  assert.equal(applyPostChochH1SwingFibConfluence(candles, candidates, [], [sellMove])[0]
    .h1SwingFibStatus, undefined);
});

test('1H swing touch without completed engulfing stays aligned without an entry signal', () => {
  const choch: StructureLine = {
    id: 'm15-choch', type: 'choch', direction: 'bullish', label: 'CHoCH',
    fromTime: 0, toTime: 1800, fromPrice: 100, toPrice: 100,
  };
  const candles: StructureCandle[] = [
    { time: 3600, open: 111, high: 112, low: 110, close: 111.5, complete: true },
    { time: 4500, open: 111.5, high: 112, low: 110.5, close: 111, complete: false },
  ];
  const [result] = applyPostChochH1SwingFibConfluence(
    candles, [zone({ name: 'TJL1', startTime: 900, bottom: 110.5, top: 112 })],
    [choch], [sellMove],
  );
  assert.equal(result.h1SwingFibStatus, 'aligned');
  assert.equal(result.h1SwingEngulfingTime, undefined);
  assert.equal(resolveZoneEngulfingSignal(result, 'M15'), undefined);
});

test('post-CHoCH M15 TJL can align with the previous 1H swing deep band', () => {
  const choch: StructureLine = {
    id: 'm15-choch', type: 'choch', direction: 'bullish', label: 'CHoCH',
    fromTime: 0, toTime: 1800, fromPrice: 100, toPrice: 100,
  };
  const candles: StructureCandle[] = [
    { time: 3600, open: 108, high: 109, low: 107, close: 108, complete: true },
  ];
  const result = applyPostChochH1SwingFibConfluence(candles, [
    zone({ name: 'TJL1', startTime: 900, bottom: 110.5, top: 112 }),
    zone({ name: 'TJL2', startTime: 900, bottom: 114.5, top: 115.5 }),
  ], [choch], [sellMove, previousBuyMove]);
  assert.equal(result[0].h1SwingFibBand, '0.5-0.618');
  assert.equal(result[1].h1SwingFibBand, '0.71-0.79');
});

test('4H selling Swing FIB accepts only selling zones in either golden band', () => {
  const result = applySwingFibConfluence([], [
    zone({ id: 'primary-sell', bottom: 110.5, top: 112 }),
    zone({ id: 'deep-sell', bottom: 114.5, top: 115.5 }),
    zone({ id: 'primary-buy', isBuy: true, bottom: 110.5, top: 112 }),
    zone({ id: 'outside-sell', bottom: 105, top: 106 }),
  ], sellMove);

  assert.equal(result.zones[0].swingFibBand, '0.5-0.618');
  assert.equal(result.zones[1].swingFibBand, '0.71-0.79');
  assert.equal(result.zones[2].swingFibStatus, undefined);
  assert.equal(result.zones[3].swingFibStatus, undefined);
});

test('previous Swing FIB retains only its primary band while latest retains both bands', () => {
  const result = applySwingFibConfluence([], [
    zone({ id: 'previous-primary-buy', isBuy: true, bottom: 108, top: 109 }),
    zone({ id: 'previous-deep-buy', isBuy: true, bottom: 104.5, top: 105.5 }),
    zone({ id: 'latest-primary-sell', bottom: 110.5, top: 112 }),
    zone({ id: 'latest-deep-sell', bottom: 114.5, top: 115.5 }),
  ], [previousBuyMove, sellMove]);

  assert.equal(result.zones[0].swingFibBand, '0.5-0.618');
  assert.equal(result.zones[0].swingFibStatus, 'a-plus');
  assert.equal(result.zones[1].swingFibStatus, undefined);
  assert.equal(result.zones[2].swingFibBand, '0.5-0.618');
  assert.equal(result.zones[3].swingFibBand, '0.71-0.79');
});

test('Swing FIB applies the same qualification to internal structure zones', () => {
  const result = applySwingFibConfluence([], [
    zone({
      id: 'internal-primary-sell',
      name: 'Internal QML',
      category: 'internal',
      bottom: 110.5,
      top: 112,
    }),
    zone({
      id: 'internal-wrong-direction',
      name: 'Internal RBS',
      category: 'internal',
      isBuy: true,
      bottom: 110.5,
      top: 112,
    }),
  ], sellMove);

  assert.equal(result.zones[0].swingFibBand, '0.5-0.618');
  assert.equal(result.zones[0].swingFibStatus, 'a-plus');
  assert.equal(result.zones[1].swingFibStatus, undefined);
});

test('Swing engulfing can form inside the deep band without touching exact 0.5', () => {
  const candles: StructureCandle[] = [
    { time: 2, open: 101, high: 102, low: 100, close: 101, complete: true },
    { time: 3, open: 114.5, high: 115.4, low: 114, close: 115, complete: true },
    { time: 4, open: 115, high: 115.5, low: 113.5, close: 113.8, complete: true },
  ];
  const result = applySwingFibConfluence(candles, [
    zone({ id: 'deep-sell', bottom: 114.2, top: 115.6 }),
  ], sellMove);

  assert.equal(result.zones[0].swingFibBand, '0.71-0.79');
  assert.equal(result.zones[0].swingEngulfingType, 'T1');
  assert.equal(result.zones[0].swingEngulfingDirection, 'bearish');
  assert.equal(result.engulfingMarkers.length, 1);
  assert.ok(candles[2].low > 110, 'the engulfing candle does not touch the exact 0.5 level');
});

test('Swing engulfing qualifies when the prior pattern candle touched the zone but the final candle misses the band', () => {
  const candles: StructureCandle[] = [
    { time: 2, open: 101, high: 102, low: 100, close: 101, complete: true },
    { time: 3, open: 114.5, high: 115.5, low: 114.2, close: 115, complete: true },
    { time: 4, open: 113, high: 113.5, low: 110.5, close: 111, complete: true },
  ];
  const result = applySwingFibConfluence(candles, [
    zone({ id: 'deep-sell', bottom: 114.2, top: 115.6 }),
  ], sellMove);

  assert.ok(candles[2].high < 114.2);
  assert.equal(result.zones[0].swingEngulfingType, 'T1');
});

test('invalidated zones cannot retain Swing FIB or engulfing status', () => {
  const result = applySwingFibConfluence([], [
    zone({ status: 'invalidated', active: false, invalidatedAt: 10 }),
  ], sellMove);
  assert.equal(result.zones[0].swingFibStatus, undefined);
  assert.equal(result.zones[0].swingEngulfingType, undefined);
});
