import assert from 'node:assert/strict';
import test from 'node:test';
import { INDICATOR_FIB_LEVELS, indicatorFibPrice } from '../src/services/indicatorFib';

test('manual Fib uses the exact indicator level set', () => {
  assert.deepEqual(
    INDICATOR_FIB_LEVELS.map((level) => level.ratio),
    [0, 0.5, 0.618, 0.71, 0.79, 1],
  );
});

test('Fib level 1 is the structure source and level 0 is the move extreme', () => {
  const sourcePrice = 120;
  const zeroPrice = 100;

  assert.equal(indicatorFibPrice(zeroPrice, sourcePrice, 0), zeroPrice);
  assert.equal(indicatorFibPrice(zeroPrice, sourcePrice, 0.5), 110);
  assert.equal(indicatorFibPrice(zeroPrice, sourcePrice, 0.71), 114.2);
  assert.equal(indicatorFibPrice(zeroPrice, sourcePrice, 1), sourcePrice);
});

test('Fib price logic works for a downward source-to-extreme move', () => {
  assert.equal(indicatorFibPrice(120, 100, 0), 120);
  assert.equal(indicatorFibPrice(120, 100, 0.5), 110);
  assert.equal(indicatorFibPrice(120, 100, 1), 100);
});
