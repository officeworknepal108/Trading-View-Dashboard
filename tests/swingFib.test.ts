import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructureCandle } from '../src/services/marketStructure';
import { buildAlternatingSwingFibs } from '../src/services/swingFib';

function candle(
  time: number,
  high: number,
  low: number,
  complete = true,
): StructureCandle {
  return { time, open: low, high, low, close: high, complete };
}

test('swing FIB alternates at 0.5 and retains only current and previous moves', () => {
  const moves = buildAlternatingSwingFibs([
    candle(200, 190, 160),
    candle(300, 180, 140), // Touches 150: up FIB changes to down.
    candle(400, 150, 120), // Continues the down FIB to a lower level 0.
    candle(500, 170, 125), // Touches 160: down FIB changes to up.
  ], {
    sourceTime: 0,
    sourcePrice: 100,
    zeroTime: 100,
    zeroPrice: 200,
  });

  assert.deepEqual(moves, [
    {
      direction: 'down',
      sourceTime: 100,
      sourcePrice: 200,
      zeroTime: 400,
      zeroPrice: 120,
      startedAt: 300,
    },
    {
      direction: 'up',
      sourceTime: 400,
      sourcePrice: 120,
      zeroTime: 500,
      zeroPrice: 170,
      startedAt: 500,
    },
  ]);
});

test('unfinished H4 candle cannot extend or reverse the swing FIB', () => {
  const moves = buildAlternatingSwingFibs([
    candle(200, 250, 90, false),
  ], {
    sourceTime: 0,
    sourcePrice: 100,
    zeroTime: 100,
    zeroPrice: 200,
  });

  assert.deepEqual(moves, [{
    direction: 'up',
    sourceTime: 0,
    sourcePrice: 100,
    zeroTime: 100,
    zeroPrice: 200,
    startedAt: 0,
  }]);
});

test('single H4 candle high-to-low is not a valid Swing FIB range', () => {
  const moves = buildAlternatingSwingFibs([], {
    sourceTime: 100,
    sourcePrice: 100,
    zeroTime: 100,
    zeroPrice: 200,
  });

  assert.deepEqual(moves, []);
});
