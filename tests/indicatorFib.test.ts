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


test('internal Double CHoCH has its own indicator option and independent Fib visibility', async () => {
  const { DEFAULT_FIB_VISIBILITY, INTERNAL_FIB_VISIBILITY_OPTIONS, fibVisibilityKey, isFibMarkingVisible } =
    await import('../src/components/OandaProChart');
  const internal = { id: 'int-double', name: 'Internal QML A+' as const, category: 'internal' as const,
    isBuy: true, startTime: 100, endTime: 200, top: 110, bottom: 100,
    active: true, status: 'valid' as const, doubleChochTime: 150 };
  const external = { ...internal, category: 'mg' as const, name: 'QML A+' as const };
  assert.ok(INTERNAL_FIB_VISIBILITY_OPTIONS.some(option => option.key === 'intDoubleChoch'));
  assert.equal(fibVisibilityKey(internal), 'intDoubleChoch');
  assert.equal(fibVisibilityKey(external), 'doubleChoch');
  const externalOnly = { ...DEFAULT_FIB_VISIBILITY, doubleChoch: true };
  assert.equal(isFibMarkingVisible(internal, true, externalOnly, DEFAULT_FIB_VISIBILITY, [false,false,false,false]), false);
  const internalOnly = { ...DEFAULT_FIB_VISIBILITY, intDoubleChoch: true };
  assert.equal(isFibMarkingVisible(internal, true, internalOnly, DEFAULT_FIB_VISIBILITY, [false,false,false,false]), true);
  assert.equal(isFibMarkingVisible(external, true, internalOnly, DEFAULT_FIB_VISIBILITY, [false,false,false,false]), false);
  assert.equal(isFibMarkingVisible(internal, false, internalOnly, DEFAULT_FIB_VISIBILITY, [false,false,false,false]), false);
});
