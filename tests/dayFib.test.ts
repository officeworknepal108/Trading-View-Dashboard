import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDayFibs, selectDayFibForTime, nepalDayStartUtc } from '../src/services/dayFib';
import type { StructureCandle } from '../src/services/marketStructure';

const nepalTimestamp = (day: number, hour: number, minute: number) => (
  Date.UTC(2026, 9, day, hour - 5, minute - 45) / 1000
);

function candle(day: number, hour: number, minute: number, open: number, high: number, low: number, close: number): StructureCandle {
  return { time: nepalTimestamp(day, hour, minute), open, high, low, close, complete: true };
}

test('Day Fib activates at 9:15 but starts from the earlier daily low wick on an upward day', () => {
  const moves = buildDayFibs([
    candle(2, 9, 0, 99, 102, 98, 101),
    candle(2, 9, 15, 100, 103, 99, 102),
    candle(2, 10, 0, 102, 108, 101, 107),
    candle(2, 15, 0, 107, 106, 103, 105),
  ]);

  assert.equal(moves.length, 1);
  assert.equal(moves[0].direction, 'up');
  assert.equal(moves[0].activationTime, nepalTimestamp(2, 9, 15));
  assert.equal(moves[0].sourcePrice, 98);
  assert.equal(moves[0].sourceTime, nepalTimestamp(2, 9, 0));
  assert.equal(moves[0].zeroPrice, 108);
  assert.equal(moves[0].zeroTime, nepalTimestamp(2, 10, 0));
});

test('Day Fib follows the low on a downward day and resets at the next 9:15', () => {
  const moves = buildDayFibs([
    candle(2, 9, 15, 100, 102, 99, 101),
    candle(2, 18, 0, 97, 98, 90, 92),
    candle(3, 0, 0, 92, 120, 80, 110),
    candle(3, 9, 15, 110, 111, 107, 108),
    candle(3, 12, 0, 108, 109, 100, 102),
  ]);

  assert.equal(moves.length, 2);
  assert.deepEqual(moves.map((move) => [move.direction, move.sourcePrice, move.zeroPrice]), [
    ['down', 102, 90],
    ['down', 120, 80],
  ]);
});

test('Day Fib is not created when the exact 9:15 starting candle is missing', () => {
  assert.deepEqual(buildDayFibs([
    candle(2, 9, 30, 100, 110, 99, 108),
  ]), []);
});

test('November 17 never selects November 16 or 15, including before 9:15 and when the feed is stale', () => {
  const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour - 5, minute - 45) / 1000;
  const bars = [15, 16].flatMap(day => [
    { time: at(day, 9, 15), open: 100, high: 110, low: 90, close: 105, complete: true },
    { time: at(day, 16), open: 105, high: 120, low: 100, close: 115, complete: true },
  ]);
  const old = buildDayFibs(bars);
  assert.equal(selectDayFibForTime(old, at(16, 23, 59))?.sessionDate, '2026-11-16');
  for (const time of [at(17, 0), at(17, 9, 14), at(17, 9, 15), at(17, 12)])
    assert.equal(selectDayFibForTime(old, time), undefined);
  assert.equal(nepalDayStartUtc(at(16, 23, 59)) + 86400, nepalDayStartUtc(at(17, 0)));
  const today = buildDayFibs([...bars,
    { time: at(17, 8), open: 100, high: 105, low: 95, close: 102, complete: true },
    { time: at(17, 9, 15), open: 102, high: 108, low: 101, close: 106, complete: false },
  ]);
  assert.equal(selectDayFibForTime(today, at(17, 9, 14)), undefined, 'future activation cannot leak into replay');
  assert.equal(selectDayFibForTime(today, at(17, 9, 15))?.sessionDate, '2026-11-17', 'today starts when its 9:15 candle arrives');
  assert.equal(selectDayFibForTime(today, at(16, 16))?.sessionDate, '2026-11-16', 'historical study uses its own day');
});
