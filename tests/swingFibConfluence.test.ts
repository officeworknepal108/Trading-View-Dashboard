import assert from 'node:assert/strict';
import test from 'node:test';
import { applySwingFibConfluence } from '../src/services/swingFibConfluence';
import type { StructureCandle, StructureZone } from '../src/services/marketStructure';
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
    { time: 4, open: 115, high: 115.2, low: 113.5, close: 113.8, complete: true },
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

test('invalidated zones cannot retain Swing FIB or engulfing status', () => {
  const result = applySwingFibConfluence([], [
    zone({ status: 'invalidated', active: false, invalidatedAt: 10 }),
  ], sellMove);
  assert.equal(result.zones[0].swingFibStatus, undefined);
  assert.equal(result.zones[0].swingEngulfingType, undefined);
});
