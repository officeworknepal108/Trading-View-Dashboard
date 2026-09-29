import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyChoch,
  doesInvalidateZone,
  findFirstZoneTapIndex,
  findVipSupportTap,
  getConfirmationBucketStart,
  resolveTjl1Confirmation,
  selectFreshVipSupportTap,
  selectTwoCandleRetracementPivot,
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

  const firstTap = findVipSupportTap(sourceCandles, [supportZone], 300);
  const freshRetap = findVipSupportTap(sourceCandles, [supportZone], 400);
  assert.equal(firstTap?.tapTime, 200);
  assert.equal(freshRetap?.tapTime, 400);
  assert.equal(selectFreshVipSupportTap(firstTap, undefined)?.tapTime, 200);
  assert.equal(selectFreshVipSupportTap(firstTap, 200), undefined);
  assert.equal(selectFreshVipSupportTap(freshRetap, 200)?.tapTime, 400);
  assert.equal(findVipSupportTap(sourceCandles, [{ ...supportZone, invalidatedAt: 200 }], 300), undefined);
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

test('directional TJL1 invalidation uses a candle close and ignores a wick', () => {
  const upward = zone({ invalidationDirection: 'up' });
  assert.equal(doesInvalidateZone(upward, { time: 300, open: 105, high: 112, low: 104, close: 109 }), false);
  assert.equal(doesInvalidateZone(upward, { time: 400, open: 109, high: 112, low: 108, close: 111 }), true);

  const downward = zone({ invalidationDirection: 'down' });
  assert.equal(doesInvalidateZone(downward, { time: 300, open: 105, high: 106, low: 98, close: 101 }), false);
  assert.equal(doesInvalidateZone(downward, { time: 400, open: 101, high: 102, low: 98, close: 99 }), true);
});

test('first-tap detection excludes the origin and pre-activation candles', () => {
  const candles = [
    candle(100, 105, 111, 99),
    candle(200, 105, 111, 99),
    candle(300, 105, 111, 99),
  ];

  assert.equal(findFirstZoneTapIndex(candles, zone()), 2);
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
