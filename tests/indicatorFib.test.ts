import assert from 'node:assert/strict';
import test from 'node:test';
import { INDICATOR_FIB_LEVELS, indicatorFibPrice } from '../src/services/indicatorFib';

test('H1 zone entry labels show the lower-timeframe confirmation rather than native H1 engulfing', async () => {
  const { displayEngulfingLabel } = await import('../src/components/OandaProChart');
  const zone = { id: 'iss-l4', name: 'ISS L4' as const, category: 'iss' as const, isBuy: false,
    startTime: 100, endTime: 200, bottom: 184, top: 187, active: true, status: 'valid' as const,
    fibStatus: 'a-plus' as const, fibBand: 'deep' as const,
    engulfingType: 'T3' as const, engulfingDirection: 'bearish' as const, engulfingTime: 1794193200,
    fallbackEngulfingType: 'T4' as const, fallbackEngulfingDirection: 'bearish' as const,
    fallbackEngulfingTime: 1794192300, fallbackEngulfingTimeframe: 'M15' };
  assert.equal(displayEngulfingLabel(zone, 'H1'), '15M T4 BEAR');
  assert.equal(displayEngulfingLabel({ ...zone, fallbackEngulfingType: 'T1',
    fallbackEngulfingTime: 1794191400, fallbackEngulfingTimeframe: 'M30' }, 'H1'), '30M T1 BEAR');
  assert.equal(displayEngulfingLabel({ ...zone, fallbackEngulfingType: undefined }, 'H1'), undefined,
    'a native H1 T3 is not an intraday entry confirmation');
  assert.equal(displayEngulfingLabel({ ...zone, fibStatus: 'not-valid' }, 'H1'), undefined);
});

test('manual Fib uses the exact indicator level set', () => {
  assert.deepEqual(
    INDICATOR_FIB_LEVELS.map((level) => level.ratio),
    [0, 0.5, 0.618, 0.71, 0.79, 1],
  );
});

test('used-zone entry reference displays levels without claiming a new trade or an outside-session block', async () => {
  const { TradeDetailsRow } = await import('../src/components/OandaProChart');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const trade = { entry: 4120.01, stopLoss: 4136.135, takeProfit: 4087.76, riskFree: 4103.885,
    riskFreeEnabled: false, riskPips: 161.25, rewardRisk: 2, status: 'active' as const,
    pendingAtCreation: false, calculatedAt: 1794193200, filledAt: 1794193200,
    signal: { type: 'T4' as const, direction: 'bearish' as const, time: 1794192300,
      candleCount: 4, timeframe: 'M15' as const } };
  const html = renderToStaticMarkup(createElement(TradeDetailsRow, {
    trade, colSpan: 5, referenceOnly: true, hideReferenceStatus: true,
  }));
  assert.match(html, /ENTRY/);
  assert.match(html, /4,120\.010/);
  assert.match(html, /4,136\.135/);
  assert.match(html, /4,087\.760/);
  assert.doesNotMatch(html, /OUTSIDE TRADING TIME|MT5 ACTIVE|PENDING/);
});

test('deep-discount display includes qualified live ISS L4 and uses the entry Fib source for trades', async () => {
  const { isDeepDiscountZoneDisplay } = await import('../src/components/OandaProChart');
  const zone = { id: 'iss-l4', name: 'ISS L4' as const, category: 'iss' as const, isBuy: false,
    startTime: 100, endTime: 200, bottom: 184, top: 187, active: true, status: 'valid' as const };
  assert.equal(isDeepDiscountZoneDisplay(zone), false);
  for (const fibBand of ['deep', '0.71-0.79'] as const) {
    assert.equal(isDeepDiscountZoneDisplay({ ...zone, fibBand, fibStatus: 'a-plus' }), true);
    assert.equal(isDeepDiscountZoneDisplay({ ...zone, fibBand, fibStatus: 'not-valid' }), false);
  }
  assert.equal(isDeepDiscountZoneDisplay({ ...zone, fibStatus: 'a-plus', fibBand: '0.5-0.618' }), false);
  assert.equal(isDeepDiscountZoneDisplay({ ...zone, swingFibStatus: 'a-plus', swingFibBand: '0.71-0.79' }), true);
  assert.equal(isDeepDiscountZoneDisplay({ ...zone, h1SwingFibStatus: 'aligned', h1SwingFibBand: '0.71-0.79' }), true);
  assert.equal(isDeepDiscountZoneDisplay({ ...zone, dayFibStatus: 'a-plus', dayFibBand: '0.71-0.79' }), true);
  const mixed = { ...zone, fibStatus: 'a-plus' as const, fibBand: '0.5-0.618' as const,
    engulfingTime: 150, engulfingType: 'T1' as const,
    swingFibStatus: 'a-plus' as const, swingFibBand: '0.71-0.79' as const,
    swingEngulfingTime: 180, swingEngulfingType: 'T2' as const };
  assert.equal(isDeepDiscountZoneDisplay(mixed), true);
  assert.equal(isDeepDiscountZoneDisplay(mixed, {
    time: 150, type: 'T1', direction: 'bearish', candleCount: 2, timeframe: 'H1',
  }), false, 'a primary-band entry does not inherit an unrelated deep Swing Fib badge');
  assert.equal(isDeepDiscountZoneDisplay(mixed, {
    time: 180, type: 'T2', direction: 'bearish', candleCount: 3, timeframe: 'H1',
  }), true);
  for (const name of ['DB', 'DT'] as const) assert.equal(isDeepDiscountZoneDisplay({ ...zone, name }), true);
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
