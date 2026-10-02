import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDayFibConfluence } from '../src/services/dayFibConfluence';
import type { DayFibMove } from '../src/services/dayFib';
import type { StructureCandle, StructureZone } from '../src/services/marketStructure';

function zone(overrides: Partial<StructureZone>): StructureZone {
  return {
    id: 'zone', name: 'TJL2', category: 'mg', isBuy: true,
    startTime: 0, endTime: 100, activeFromTime: 1,
    top: 110, bottom: 108, active: true, status: 'valid',
    ...overrides,
  };
}

const buyMove: DayFibMove = {
  sessionDate: '2026-10-02', direction: 'up',
  sourceTime: 0, sourcePrice: 100,
  zeroTime: 2, zeroPrice: 120,
};

test('buying Day FIB accepts only buying zones in either golden band', () => {
  const result = applyDayFibConfluence([], [
    zone({ id: 'primary-buy', bottom: 107.5, top: 110 }),
    zone({ id: 'deep-buy', bottom: 104.2, top: 105.8 }),
    zone({ id: 'primary-sell', isBuy: false, bottom: 107.5, top: 110 }),
    zone({ id: 'outside-buy', bottom: 116, top: 117 }),
  ], buyMove);

  assert.equal(result.zones[0].dayFibBand, '0.5-0.618');
  assert.equal(result.zones[1].dayFibBand, '0.71-0.79');
  assert.equal(result.zones[2].dayFibStatus, undefined);
  assert.equal(result.zones[3].dayFibStatus, undefined);
});

test('Day FIB engulfing can form in the deep band without touching exact 0.5', () => {
  const candles: StructureCandle[] = [
    { time: 2, open: 119, high: 120, low: 118, close: 119, complete: true },
    { time: 3, open: 105.5, high: 106, low: 104.4, close: 104.8, complete: true },
    { time: 4, open: 104.8, high: 106.2, low: 104.6, close: 106.1, complete: true },
  ];
  const result = applyDayFibConfluence(candles, [
    zone({ id: 'deep-buy', bottom: 104.2, top: 105.8 }),
  ], buyMove);

  assert.equal(result.zones[0].dayFibBand, '0.71-0.79');
  assert.equal(result.zones[0].dayEngulfingType, 'T1');
  assert.equal(result.zones[0].dayEngulfingDirection, 'bullish');
  assert.equal(result.engulfingMarkers.length, 1);
  assert.ok(candles[2].high < 110, 'the engulfing candle does not touch the exact 0.5 level');
});

test('invalidated zones cannot retain Day FIB or engulfing status', () => {
  const result = applyDayFibConfluence([], [
    zone({ status: 'invalidated', active: false, invalidatedAt: 10 }),
  ], buyMove);
  assert.equal(result.zones[0].dayFibStatus, undefined);
  assert.equal(result.zones[0].dayEngulfingType, undefined);
});
