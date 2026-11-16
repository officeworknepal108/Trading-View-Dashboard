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
  activationTime: 1,
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

test('Day FIB applies the same qualification to internal structure zones', () => {
  const result = applyDayFibConfluence([], [
    zone({
      id: 'internal-primary-buy',
      name: 'Internal QML',
      category: 'internal',
      bottom: 107.5,
      top: 110,
    }),
    zone({
      id: 'internal-wrong-direction',
      name: 'Internal SBR',
      category: 'internal',
      isBuy: false,
      bottom: 107.5,
      top: 110,
    }),
  ], buyMove);

  assert.equal(result.zones[0].dayFibBand, '0.5-0.618');
  assert.equal(result.zones[0].dayFibStatus, 'a-plus');
  assert.equal(result.zones[1].dayFibStatus, undefined);
});

test('Day FIB engulfing can form in the deep band without touching exact 0.5', () => {
  const candles: StructureCandle[] = [
    { time: 2, open: 119, high: 120, low: 118, close: 119, complete: true },
    { time: 3, open: 105.5, high: 106, low: 104.4, close: 104.8, complete: true },
    { time: 4, open: 104.8, high: 106.2, low: 104.3, close: 106.1, complete: true },
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

test('Day FIB engulfing qualifies when the prior pattern candle touched the zone but the final candle stays above the band', () => {
  const candles: StructureCandle[] = [
    { time: 2, open: 119, high: 120, low: 118, close: 119, complete: true },
    { time: 3, open: 109.5, high: 110, low: 108, close: 108.5, complete: true },
    { time: 4, open: 113.16, high: 114.5, low: 113.06, close: 114, complete: true },
  ];
  const result = applyDayFibConfluence(candles, [
    zone({ id: 'primary-buy', bottom: 108, top: 110 }),
  ], buyMove);

  assert.ok(Math.abs(candles[2].low - 110 - 3.06) < 1e-9);
  assert.equal(result.zones[0].dayEngulfingType, 'T1');
});

test('invalidated zones cannot retain Day FIB or engulfing status', () => {
  const result = applyDayFibConfluence([], [
    zone({ status: 'invalidated', active: false, invalidatedAt: 10 }),
  ], buyMove);
  assert.equal(result.zones[0].dayFibStatus, undefined);
  assert.equal(result.zones[0].dayEngulfingType, undefined);
});

test('a stale prior-day move clears all Day Fib qualification without clearing independent Swing Fib', () => {
  const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour - 5, minute - 45) / 1000;
  const old: DayFibMove = { ...buyMove, sessionDate: '2026-11-16', activationTime: at(16, 9, 15),
    sourceTime: at(16, 8), zeroTime: at(16, 12) };
  const previous = zone({ startTime: at(16, 8), activeFromTime: at(16, 8),
    dayFibStatus: 'a-plus', dayFibBand: '0.5-0.618', dayEngulfingType: 'T1', dayEngulfingTime: at(16, 14),
    swingFibStatus: 'a-plus', swingFibBand: '0.71-0.79' });
  const staleFeed = [{ time: at(16, 23, 45), open: 115, high: 116, low: 114, close: 115, complete: true }];
  for (const asOf of [at(17, 0), at(17, 9, 14), at(17, 10)]) {
    const result = applyDayFibConfluence(staleFeed, [previous], old, 10, asOf);
    assert.equal(result.zones[0].dayFibStatus, undefined);
    assert.equal(result.zones[0].dayFibBand, undefined);
    assert.equal(result.zones[0].dayEngulfingType, undefined);
    assert.equal(result.zones[0].dayEngulfingTime, undefined);
    assert.equal(result.engulfingMarkers.length, 0);
    assert.equal(result.zones[0].swingFibStatus, 'a-plus');
  }
  assert.equal(previous.dayFibStatus, 'a-plus', 'the saved historical zone is not overwritten');
  const morning = [{ time: at(17, 8), open: 115, high: 116, low: 114, close: 115, complete: true }];
  assert.equal(applyDayFibConfluence(morning, [previous], old).zones[0].dayFibStatus, undefined,
    'the common confluence helper rejects a prior day even if a caller forgets the explicit cutoff');
});
