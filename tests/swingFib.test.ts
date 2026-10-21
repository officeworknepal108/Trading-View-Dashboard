import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructureCandle } from '../src/services/marketStructure';
import { buildAlternatingSwingFibs } from '../src/services/swingFib';

function candle(
  time: number,
  high: number,
  low: number,
  complete = true,
  open = low,
): StructureCandle {
  return { time, open, high, low, close: high, complete };
}

test('swing FIB alternates at 0.5 and retains only current and previous moves', () => {
  const moves = buildAlternatingSwingFibs([
    candle(200, 190, 160),
    candle(300, 180, 140, true, 180), // Opens above 150, then touches it.
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

test('a candle already beyond 0.5 at its open cannot reverse an upward swing', () => {
  const seed = { sourceTime: 0, sourcePrice: 100, zeroTime: 100, zeroPrice: 200 };
  const openedBelowMidpoint = candle(200, 190, 140, true, 145);
  assert.equal(buildAlternatingSwingFibs([openedBelowMidpoint], seed).length, 1);
  const moves = buildAlternatingSwingFibs([
    openedBelowMidpoint,
    candle(300, 180, 130, true, 180),
  ], seed);
  assert.equal(moves[1]?.direction, 'down');
  assert.equal(moves[1]?.startedAt, 300);
});

test('a candle already beyond 0.5 at its open cannot reverse a downward swing', () => {
  const seed = { sourceTime: 0, sourcePrice: 200, zeroTime: 100, zeroPrice: 100 };
  const openedAboveMidpoint = candle(200, 170, 110, true, 160);
  assert.equal(buildAlternatingSwingFibs([openedAboveMidpoint], seed).length, 1);
  const moves = buildAlternatingSwingFibs([
    openedAboveMidpoint,
    candle(300, 170, 110, true, 120),
  ], seed);
  assert.equal(moves[1]?.direction, 'up');
  assert.equal(moves[1]?.startedAt, 300);
});

test('unfinished H4 candle extends the active extreme but cannot reverse the swing FIB', () => {
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
    zeroTime: 200,
    zeroPrice: 250,
    startedAt: 0,
  }]);
});

test('unfinished H4 candle touching 0.5 cannot activate the opposite swing', () => {
  const moves = buildAlternatingSwingFibs([
    candle(200, 190, 140, false),
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
