import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateZoneAfterChoch,
  classifyChoch,
  classifyDoubleChoch,
  doesInvalidateZone,
  findFirstZoneTapIndex,
  findVipSupportTap,
  findVipSupportTapAcrossContexts,
  getConfirmationBucketStart,
  resolveTjl1Confirmation,
  selectFreshVipSupportTap,
  selectTwoCandleRetracementPivot,
  wasTjl1ConfirmedBy,
  type StructureCandle,
  type StructureZone,
} from '../src/services/marketStructure';

function candle(time: number, close: number, high = close + 1, low = close - 1): StructureCandle {
  return { time, open: close, high, low, close };
}

function zone(overrides: Partial<StructureZone> = {}): StructureZone {
  return {
    id: 'test-zone',
    name: 'TJL1',
    category: 'mg',
    isBuy: false,
    startTime: 100,
    endTime: 500,
    activeFromTime: 300,
    top: 110,
    bottom: 100,
    active: true,
    status: 'valid',
    ...overrides,
  };
}

test('structure pivots include the first candle of a confirmed two-candle retracement', () => {
  const bullish = [
    { time: 0, open: 100, high: 105, low: 99, close: 104 },
    { time: 1, open: 104, high: 110, low: 103, close: 109 },
    { time: 2, open: 109, high: 115, low: 106, close: 107 }, // first red retracement candle
    { time: 3, open: 107, high: 120, low: 103, close: 104 }, // confirmation candle is excluded
  ];
  const bearish = [
    { time: 0, open: 100, high: 101, low: 95, close: 96 },
    { time: 1, open: 96, high: 97, low: 90, close: 91 },
    { time: 2, open: 91, high: 94, low: 85, close: 93 }, // first green retracement candle
    { time: 3, open: 93, high: 97, low: 80, close: 96 }, // confirmation candle is excluded
  ];

  assert.deepEqual(selectTwoCandleRetracementPivot(bullish, 0, 3, 'high'), { index: 2, time: 2, price: 115 });
  assert.deepEqual(selectTwoCandleRetracementPivot(bearish, 0, 3, 'low'), { index: 2, time: 2, price: 85 });
});

test('CHoCH classification follows Valid, Air, VIP, and pending trade rules', () => {
  assert.deepEqual(
    classifyChoch({ tjl1Confirmed: true, tjl2Confirmed: true, vipZoneTapped: false }),
    { chochClass: 'valid', tradeable: true },
  );
  assert.deepEqual(
    classifyChoch({ tjl1Confirmed: false, tjl2Confirmed: true, vipZoneTapped: false }),
    { chochClass: 'air', tradeable: false },
  );
  assert.deepEqual(
    classifyChoch({ tjl1Confirmed: false, tjl2Confirmed: true, vipZoneTapped: true }),
    { chochClass: 'vip', tradeable: true },
  );
  assert.deepEqual(
    classifyChoch({ tjl1Confirmed: true, tjl2Confirmed: false, vipZoneTapped: true }),
    { chochClass: 'pending', tradeable: false },
  );
});

test('a later zone invalidation does not erase an earlier TJL1 confirmation', () => {
  const confirmedThenInvalidated = zone({
    confirmationTime: 200,
    invalidatedAt: 300,
    active: false,
    status: 'invalidated',
  });

  assert.equal(wasTjl1ConfirmedBy(confirmedThenInvalidated, 400), true);
  assert.equal(wasTjl1ConfirmedBy(confirmedThenInvalidated, 100), false);
});

test('Double CHoCH accepts confirmed Valid, AIR, or VIP origins and waits for mapped HTF confirmation', () => {
  assert.deepEqual(classifyDoubleChoch('valid', false), {
    doubleChochStatus: 'pending',
    doubleChochOriginClass: 'valid',
    tradeable: false,
  });
  assert.deepEqual(classifyDoubleChoch('air', true), {
    doubleChochStatus: 'valid',
    doubleChochOriginClass: 'air',
    tradeable: true,
  });
  assert.deepEqual(classifyDoubleChoch('vip', false), {
    doubleChochStatus: 'pending',
    doubleChochOriginClass: 'vip',
    tradeable: false,
  });
  assert.equal(classifyDoubleChoch('pending', true), undefined);
});

test('VIP support requires a mapped HTF zone tap before CHoCH while that zone is valid', () => {
  const sourceCandles = [
    candle(100, 120, 121, 119),
    candle(200, 105, 108, 102),
    candle(300, 115, 117, 113),
    candle(400, 106, 109, 103),
  ];
  const supportZone = zone({
    name: 'QML', startTime: 100, activeFromTime: 100,
    bottom: 100, top: 110, status: 'invalidated', active: false, invalidatedAt: 500,
  });

  const firstTap = findVipSupportTap(sourceCandles, [supportZone], 300, false);
  const freshRetap = findVipSupportTap(sourceCandles, [supportZone], 400, false);
  assert.equal(firstTap?.tapTime, 200);
  assert.equal(freshRetap?.tapTime, 400);
  assert.equal(selectFreshVipSupportTap(firstTap, undefined)?.tapTime, 200);
  assert.equal(selectFreshVipSupportTap(firstTap, 200), undefined);
  assert.equal(selectFreshVipSupportTap(freshRetap, 200)?.tapTime, 400);
  assert.equal(findVipSupportTap(
    sourceCandles,
    [{ ...supportZone, invalidatedAt: 200 }],
    300,
    false,
  ), undefined);
});

test('VIP support accepts either mapped timeframe and keeps the freshest qualifying tap', () => {
  const sourceCandles = [
    candle(100, 50),
    candle(200, 105, 108, 102),
    candle(300, 50),
    candle(400, 205, 208, 202),
  ];
  const firstSupport = zone({
    id: 'first-support', name: 'QML', startTime: 100, activeFromTime: 100,
    bottom: 100, top: 110,
  });
  const secondSupport = zone({
    id: 'second-support', name: 'TJL2', startTime: 300, activeFromTime: 300,
    bottom: 200, top: 210,
  });

  const tap = findVipSupportTapAcrossContexts(sourceCandles, [
    { timeframe: '5m', zones: [firstSupport] },
    { timeframe: '15m', zones: [secondSupport] },
  ], 500, false);

  assert.equal(tap?.timeframe, '15m');
  assert.equal(tap?.zone.id, 'second-support');
  assert.equal(tap?.tapTime, 400);
});

test('VIP support ignores an opposite-direction zone even when its tap is fresher', () => {
  const sourceCandles = [
    candle(100, 50),
    candle(200, 205, 208, 202),
    candle(300, 50),
    candle(400, 105, 108, 102),
  ];
  const sellZone = zone({
    id: 'sell-support', name: 'QML', isBuy: false,
    startTime: 100, activeFromTime: 100, bottom: 200, top: 210,
  });
  const buyZone = zone({
    id: 'buy-support', name: 'RBS', isBuy: true,
    startTime: 300, activeFromTime: 300, bottom: 100, top: 110,
  });

  const bearishTap = findVipSupportTapAcrossContexts(sourceCandles, [
    { timeframe: '15m', zones: [sellZone] },
    { timeframe: '1h', zones: [buyZone] },
  ], 500, false);

  assert.equal(bearishTap?.zone.id, 'sell-support');
  assert.equal(bearishTap?.tapTime, 200);
});

test('TJL1 confirms on the first completed mapped higher-timeframe close', () => {
  const result = resolveTjl1Confirmation([
    candle(0, 105),
    candle(900, 106),
    candle(1800, 108),
    candle(2700, 111),
    candle(3600, 109), // keeps the preceding 1h aggregate in the completed set
  ], {
    confirmationDirection: 'up',
    bottom: 100,
    top: 110,
    formationTime: 900,
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  });

  assert.equal(result.status, 'valid');
  assert.equal(result.confirmationTime, 3600);
  assert.equal(result.confirmationWindowCloseTime, 3600);
});

test('TJL1 stays pending when completed mapped candles have not closed through it', () => {
  const result = resolveTjl1Confirmation([
    candle(0, 105), candle(900, 106), candle(1800, 108), candle(2700, 109), candle(3600, 109),
  ], {
    confirmationDirection: 'up',
    bottom: 100,
    top: 110,
    formationTime: 900,
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.tjl1ConfirmationAttempts, 1);
  assert.equal(result.confirmationWindowCloseTime, 3600);
});

test('directional TJL1 invalidation requires the completed body outside the zone', () => {
  const upward = zone({ invalidationDirection: 'up' });
  assert.equal(doesInvalidateZone(upward, { time: 300, open: 105, high: 112, low: 104, close: 109 }), false);
  assert.equal(doesInvalidateZone(upward, { time: 400, open: 109, high: 112, low: 108, close: 111 }), false);
  assert.equal(doesInvalidateZone(upward, { time: 500, open: 111, high: 113, low: 104, close: 112 }), true);

  const downward = zone({ invalidationDirection: 'down' });
  assert.equal(doesInvalidateZone(downward, { time: 300, open: 105, high: 106, low: 98, close: 101 }), false);
  assert.equal(doesInvalidateZone(downward, { time: 400, open: 101, high: 102, low: 98, close: 99 }), false);
  assert.equal(doesInvalidateZone(downward, { time: 500, open: 99, high: 105, low: 97, close: 98 }), true);
});

test('every zone type invalidates when a completed candle body is fully outside', () => {
  const zoneTypes: Array<Pick<StructureZone, 'name' | 'category'>> = [
    { name: 'TJL2', category: 'mg' },
    { name: 'QML', category: 'mg' },
    { name: 'SBR', category: 'mg' },
    { name: 'RBS', category: 'mg' },
    { name: 'DT', category: 'mg' },
    { name: 'DB', category: 'mg' },
    { name: 'ISS L3', category: 'iss' },
    { name: 'ISS L4', category: 'iss' },
    { name: 'SUPPLY', category: 'supplyDemand' },
    { name: 'DEMAND', category: 'supplyDemand' },
  ];

  for (const type of zoneTypes) {
    const sellZone = zone({ ...type, isBuy: false });
    const buyZone = zone({ ...type, isBuy: true });

    assert.equal(doesInvalidateZone(sellZone, {
      time: 300, open: 105, high: 112, low: 104, close: 111, complete: false,
    }), false, `${type.name} must ignore a live close above the zone`);
    assert.equal(doesInvalidateZone(sellZone, {
      time: 400, open: 111, high: 112, low: 104, close: 109, complete: true,
    }), false, `${type.name} must remain valid while the candle body overlaps the zone`);
    assert.equal(doesInvalidateZone(sellZone, {
      time: 500, open: 111, high: 113, low: 104, close: 112, complete: true,
    }), true, `${type.name} must invalidate when the completed body is above despite wick re-entry`);

    assert.equal(doesInvalidateZone(buyZone, {
      time: 300, open: 105, high: 106, low: 98, close: 99, complete: false,
    }), false, `${type.name} must ignore a live close below the zone`);
    assert.equal(doesInvalidateZone(buyZone, {
      time: 400, open: 99, high: 106, low: 98, close: 101, complete: true,
    }), false, `${type.name} must remain valid while the candle body overlaps the zone`);
    assert.equal(doesInvalidateZone(buyZone, {
      time: 500, open: 99, high: 105, low: 97, close: 98, complete: true,
    }), true, `${type.name} must invalidate when the completed body is below despite wick re-entry`);
  }
});

test('first-tap detection excludes the origin and pre-activation candles', () => {
  const candles = [
    candle(100, 105, 111, 99),
    candle(200, 105, 111, 99),
    candle(300, 105, 111, 99),
  ];

  assert.equal(findFirstZoneTapIndex(candles, zone()), 2);
});

test('pending ISS Level 3 cannot record a tap before higher-timeframe validation', () => {
  const candles = [
    candle(100, 105, 111, 99),
    candle(200, 105, 111, 99),
    candle(300, 105, 111, 99),
  ];
  const level3 = zone({
    name: 'ISS L3',
    category: 'iss',
    status: 'pending',
    activeFromTime: 200,
  });

  assert.equal(findFirstZoneTapIndex(candles, level3), -1);
  assert.equal(findFirstZoneTapIndex(candles, {
    ...level3,
    status: 'valid',
    confirmationTime: 300,
    activeFromTime: 300,
  }), 2);
});

test('CHoCH-created zones ignore historical overlaps and the break candle', () => {
  const converted = zone({
    name: 'SBR',
    startTime: 100,
    activeFromTime: 100,
    tapTime: 200,
    tapBarsAgo: 2,
  });
  const candles = [
    candle(100, 105, 111, 99), // original TJL2 pivot
    candle(200, 105, 111, 99), // historical overlap
    candle(300, 95, 105, 90), // CHoCH break/formation candle
    candle(400, 95, 99, 91), // first eligible candle, no overlap
    candle(500, 105, 108, 102), // genuine post-CHoCH revisit
  ];

  activateZoneAfterChoch(converted, 300, 100);

  assert.equal(converted.activeFromTime, 400);
  assert.equal(converted.tapTime, undefined);
  assert.equal(converted.tapBarsAgo, undefined);
  assert.equal(findFirstZoneTapIndex(candles, converted), 4);
});

test('supply is tapped only by a revisit after its confirming BOS candle', () => {
  const candles = [
    candle(100, 105, 111, 99), // supply origin
    candle(200, 105, 109, 101), // formation overlap: not yet a zone
    candle(300, 95, 106, 90), // confirming BOS candle
    candle(400, 95, 99, 91), // first eligible candle, no overlap
    candle(500, 101, 103, 98), // genuine revisit
  ];
  const supply = zone({
    name: 'SUPPLY',
    category: 'supplyDemand',
    startTime: 100,
    activeFromTime: 400,
    bottom: 100,
    top: 110,
  });

  assert.equal(findFirstZoneTapIndex(candles, supply), 4);
});

test('H4 confirmation buckets follow the 5 p.m. New York OANDA session', () => {
  const sunday21Utc = Date.UTC(2026, 8, 27, 21) / 1000;
  assert.equal(getConfirmationBucketStart(sunday21Utc, 4 * 3600), sunday21Utc);

  const result = resolveTjl1Confirmation([
    candle(sunday21Utc, 105),
    candle(sunday21Utc + 3600, 106),
    candle(sunday21Utc + 2 * 3600, 107),
    candle(sunday21Utc + 3 * 3600, 111),
    candle(sunday21Utc + 4 * 3600, 109),
  ], {
    confirmationDirection: 'up',
    bottom: 100,
    top: 110,
    formationTime: sunday21Utc + 3600,
    sourceBarSeconds: 3600,
    confirmationBarSeconds: 4 * 3600,
  });

  assert.equal(result.status, 'valid');
  assert.equal(result.confirmationTime, sunday21Utc + 4 * 3600);
});

test('weekly confirmation buckets begin at the Sunday OANDA session open', () => {
  const sunday21Utc = Date.UTC(2026, 8, 20, 21) / 1000;
  const dailyCandles = [0, 1, 2, 3, 4, 7].map((days, index) => (
    candle(sunday21Utc + days * 86400, index === 4 ? 111 : 105)
  ));
  const result = resolveTjl1Confirmation(dailyCandles, {
    confirmationDirection: 'up',
    bottom: 100,
    top: 110,
    formationTime: sunday21Utc + 86400,
    sourceBarSeconds: 86400,
    confirmationBarSeconds: 7 * 86400,
  });

  assert.equal(getConfirmationBucketStart(sunday21Utc, 7 * 86400), sunday21Utc);
  assert.equal(result.status, 'valid');
  assert.equal(result.confirmationTime, sunday21Utc + 7 * 86400);
});

test('daily and weekly bucket closes follow New York daylight-saving changes', () => {
  const beforeDstSunday22Utc = Date.UTC(2026, 2, 1, 22) / 1000;
  const afterDstSunday21Utc = Date.UTC(2026, 2, 8, 21) / 1000;
  assert.equal(getConfirmationBucketStart(beforeDstSunday22Utc, 7 * 86400), beforeDstSunday22Utc);
  assert.equal(getConfirmationBucketStart(afterDstSunday21Utc, 7 * 86400), afterDstSunday21Utc);

  const result = resolveTjl1Confirmation([
    candle(beforeDstSunday22Utc, 105),
    candle(beforeDstSunday22Utc + 86400, 105),
    candle(beforeDstSunday22Utc + 2 * 86400, 106),
    candle(beforeDstSunday22Utc + 3 * 86400, 107),
    candle(beforeDstSunday22Utc + 4 * 86400, 111),
    candle(afterDstSunday21Utc, 109),
  ], {
    confirmationDirection: 'up',
    bottom: 100,
    top: 110,
    formationTime: beforeDstSunday22Utc + 86400,
    sourceBarSeconds: 86400,
    confirmationBarSeconds: 7 * 86400,
  });
  assert.equal(result.status, 'valid');
  assert.equal(result.confirmationTime, afterDstSunday21Utc);
});
