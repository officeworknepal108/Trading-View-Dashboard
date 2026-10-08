import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructureCandle, StructureZone } from '../src/services/marketStructure';
import { applyOneMinuteGenesisQml, executionZoneName } from '../src/services/oneMinuteGenesis';

function candle(time: number, high: number, low: number): StructureCandle {
  return { time, open: low + 1, high, low, close: high - 1, volume: 100, complete: true };
}

function qml(overrides: Partial<StructureZone>): StructureZone {
  return {
    id: 'qml', name: 'QML', category: 'mg', isBuy: false,
    startTime: 60, endTime: 1_800, activeFromTime: 120,
    top: 15, bottom: 14, active: true, status: 'valid',
    ...overrides,
  };
}

test('M1 QMLs at broker daily-session extremes receive the 1MG QML label', () => {
  const daily = [candle(0, 20, 1), candle(86_400, 30, 10)];
  const m1 = [
    candle(0, 12, 8), candle(60, 15, 9), candle(120, 14, 5),
    candle(86_400, 25, 15),
  ];
  const sell = qml({ id: 'sell', startTime: 60, top: 15, bottom: 14, isBuy: false });
  const buy = qml({ id: 'buy', startTime: 120, top: 6, bottom: 5, isBuy: true });
  const ordinary = qml({ id: 'ordinary', startTime: 0, top: 12, bottom: 11, isBuy: false });

  const [markedSell, markedBuy, unchanged] = applyOneMinuteGenesisQml(
    [sell, buy, ordinary], m1, daily,
  );
  assert.equal(markedSell.oneMinuteGenesisQml, 'day-high');
  assert.equal(markedBuy.oneMinuteGenesisQml, 'day-low');
  assert.equal(executionZoneName(markedSell), '1MG QML');
  assert.equal(unchanged.oneMinuteGenesisQml, undefined);
  assert.equal(executionZoneName(unchanged), 'QML');
});

test('1MG classification uses only M1 candles supplied at the replay cutoff', () => {
  const daily = [candle(0, 20, 1)];
  const zone = qml({ startTime: 60, top: 15, bottom: 14, isBuy: false });
  const replayCandles = [candle(0, 12, 8), candle(60, 15, 9)];
  const marked = applyOneMinuteGenesisQml([zone], replayCandles, daily)[0];
  assert.equal(marked.oneMinuteGenesisQml, 'day-high');

  const laterCandles = [...replayCandles, candle(120, 18, 10)];
  const noLongerExtreme = applyOneMinuteGenesisQml([zone], laterCandles, daily)[0];
  assert.equal(noLongerExtreme.oneMinuteGenesisQml, undefined);
});
