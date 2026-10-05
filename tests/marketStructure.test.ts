import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateZoneAfterChoch,
  applyIssFibAnchors,
  classifyChoch,
  classifyDoubleChoch,
  classifyFibOverlap,
  detectEngulfingPatternAt,
  doesInvalidateZone,
  findDeepFibInvalidationTime,
  findTjlFibSource,
  findZoneEngulfingPattern,
  findIssFiveWaves,
  findFirstZoneTapIndex,
  findVipSupportTap,
  findVipSupportTapAcrossContexts,
  getConfirmationBucketStart,
  invalidateTjlFibBeforeLatestStructureReset,
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

test('FIB overlap accepts primary for TJL1 and both primary and deep for TJL2', () => {
  const levels = { level50: 50, level618: 61.8, level71: 71, level79: 79 };
  assert.equal(classifyFibOverlap({
    zoneBottom: 55, zoneTop: 57, ...levels, acceptDeep: false,
  }), '0.5-0.618');
  assert.equal(classifyFibOverlap({
    zoneBottom: 55, zoneTop: 57, ...levels, acceptDeep: true,
  }), '0.5-0.618', 'TJL2 accepts the primary band');
  assert.equal(classifyFibOverlap({
    zoneBottom: 73, zoneTop: 75, ...levels, acceptDeep: false,
  }), undefined, 'TJL1 does not accept the deep band');
  assert.equal(classifyFibOverlap({
    zoneBottom: 73, zoneTop: 75, ...levels, acceptDeep: true,
  }), '0.71-0.79', 'TJL2 accepts the deep band as well as the primary band');
  assert.equal(classifyFibOverlap({
    zoneBottom: 82, zoneTop: 88, ...levels, acceptDeep: true,
    sourcePrice: 100, deepBandValid: true,
  }), 'deep', 'a zone beyond 0.79 is named deep premium/discount toward DB/DT');
  assert.equal(classifyFibOverlap({
    zoneBottom: 82, zoneTop: 88, ...levels, acceptDeep: true,
    sourcePrice: 100, deepBandValid: false,
  }), undefined, 'a completed close through 0.79 invalidates the deep setup');
});

test('CHoCH and Double CHoCH reset older external TJL1 and TJL2 FIB setups', () => {
  const fibFields = {
    fibRelevant: true,
    fibBand: '0.5-0.618' as const,
    fibStatus: 'a-plus' as const,
    fibLevel50: 105,
    fibSourceTime: 100,
    fibSourcePrice: 110,
    fibZeroTime: 200,
    fibZeroPrice: 100,
  };
  const oldTjl1 = zone({ ...fibFields, id: 'old-tjl1', name: 'TJL1', startTime: 100 });
  const oldTjl2 = zone({ ...fibFields, id: 'old-tjl2', name: 'TJL2', startTime: 200 });
  const currentTjl1 = zone({ ...fibFields, id: 'current-tjl1', name: 'TJL1', startTime: 500 });
  const internalTjl = zone({
    ...fibFields,
    id: 'internal-tjl',
    name: 'Internal TJL1',
    category: 'internal',
    startTime: 100,
  });
  const choch = zone({ id: 'choch', name: 'QML', startTime: 300, chochTime: 300 });
  const doubleChoch = zone({
    id: 'double-choch',
    name: 'QML A+',
    startTime: 400,
    doubleChochTime: 400,
  });

  invalidateTjlFibBeforeLatestStructureReset([
    oldTjl1,
    oldTjl2,
    currentTjl1,
    internalTjl,
    choch,
    doubleChoch,
  ]);

  assert.equal(oldTjl1.fibRelevant, false);
  assert.equal(oldTjl1.fibStatus, undefined);
  assert.equal(oldTjl2.fibSourceTime, undefined);
  assert.equal(currentTjl1.fibStatus, 'a-plus', 'a TJL formed after the latest reset remains eligible');
  assert.equal(internalTjl.fibStatus, 'a-plus', 'external CHoCH does not reset internal ISS structure FIB');
});

test('TJL1 FIB uses its current paired TJL2 even when the TJL2 pivot is newer', () => {
  const oldTjl2 = zone({
    id: 'old-tjl2', name: 'TJL2', isBuy: true, startTime: 100, tjlPairTime: 300,
  });
  const currentTjl1 = zone({
    id: 'current-tjl1', name: 'TJL1', isBuy: true, startTime: 200, tjlPairTime: 500,
  });
  const currentTjl2 = zone({
    id: 'current-tjl2', name: 'TJL2', isBuy: true, startTime: 250, tjlPairTime: 500,
  });

  assert.equal(
    findTjlFibSource(currentTjl1, [oldTjl2, currentTjl1, currentTjl2])?.id,
    'current-tjl2',
  );

  const bearishTjl1 = zone({
    id: 'bearish-tjl1', name: 'TJL1', isBuy: false, startTime: 600, tjlPairTime: 800,
  });
  const bearishTjl2 = zone({
    id: 'bearish-tjl2', name: 'TJL2', isBuy: false, startTime: 700, tjlPairTime: 800,
  });
  assert.equal(
    findTjlFibSource(bearishTjl1, [currentTjl2, bearishTjl1, bearishTjl2])?.id,
    'bearish-tjl2',
  );

  const internalTjl1 = zone({
    id: 'internal-tjl1', name: 'Internal TJL1', category: 'internal',
    isBuy: true, startTime: 900, tjlPairTime: 1100,
  });
  const internalTjl2 = zone({
    id: 'internal-tjl2', name: 'Internal TJL2', category: 'internal',
    isBuy: true, startTime: 1000, tjlPairTime: 1100,
  });
  const internalReset = zone({
    id: 'internal-reset', name: 'Internal QML', category: 'internal',
    startTime: 1050, chochTime: 1050,
  });
  assert.equal(
    findTjlFibSource(internalTjl1, [internalTjl1, internalTjl2, internalReset])?.id,
    'internal-tjl2',
    'a current internal pair uses its TJL2 pivot even when that pivot precedes the reset',
  );
});

test('ISS FIB runs from Point 0 and extends beyond Point 5 to the latest completed extreme', () => {
  const bullishIss = zone({
    id: 'bullish-iss',
    name: 'ISS L3',
    category: 'iss',
    isBuy: true,
    issPoint0Time: 100,
    issPoint0Price: 90,
    issPoint5Time: 500,
    issPoint5Price: 120,
    issDirection: 'bullish',
    issCompletionTime: 600,
  });
  applyIssFibAnchors([
    { time: 500, open: 118, high: 120, low: 116, close: 119, complete: true },
    { time: 600, open: 119, high: 128, low: 118, close: 126, complete: true },
    { time: 700, open: 126, high: 135, low: 125, close: 134, complete: false },
  ], [bullishIss]);
  assert.equal(bullishIss.fibSourceTime, 100);
  assert.equal(bullishIss.fibSourcePrice, 90);
  assert.equal(bullishIss.fibZeroTime, 600);
  assert.equal(bullishIss.fibZeroPrice, 128, 'a live extension beyond Point 5 is ignored until complete');

  const bearishIss = zone({
    id: 'bearish-iss',
    name: 'ISS L3',
    category: 'iss',
    isBuy: false,
    issPoint0Time: 100,
    issPoint0Price: 130,
    issPoint5Time: 500,
    issPoint5Price: 100,
    issDirection: 'bearish',
  });
  applyIssFibAnchors([
    { time: 500, open: 102, high: 104, low: 100, close: 101, complete: true },
    { time: 600, open: 101, high: 102, low: 94, close: 95, complete: true },
  ], [bearishIss]);
  assert.equal(bearishIss.fibZeroPrice, 94);
});

test('deep FIB invalidation requires a completed close beyond 0.79, not a wick or live close', () => {
  const wickAndLiveOnly: StructureCandle[] = [
    { time: 1, open: 120, high: 125, low: 118, close: 123, complete: true },
    { time: 2, open: 123, high: 124, low: 99, close: 105, complete: true },
    { time: 3, open: 105, high: 106, low: 95, close: 98, complete: false },
  ];
  assert.equal(findDeepFibInvalidationTime(wickAndLiveOnly, 1, 100, false), undefined);

  const closedOutside = [
    ...wickAndLiveOnly,
    { time: 4, open: 105, high: 106, low: 97, close: 99, complete: true },
  ];
  assert.equal(findDeepFibInvalidationTime(closedOutside, 1, 100, false), 4);
  assert.equal(findDeepFibInvalidationTime([
    { time: 1, open: 80, high: 82, low: 75, close: 78, complete: true },
    { time: 2, open: 78, high: 101, low: 77, close: 99, complete: true },
    { time: 3, open: 99, high: 102, low: 98, close: 101, complete: true },
  ], 1, 100, true), 3);
});

test('engulfing detector recognizes bullish and bearish Type 1 patterns only after close', () => {
  const bullish: StructureCandle[] = [
    { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 2, open: 10, high: 14, low: 9.5, close: 13.5, complete: true },
  ];
  const bearish: StructureCandle[] = [
    { time: 1, open: 10, high: 13, low: 9, close: 12, complete: true },
    { time: 2, open: 12, high: 12.5, low: 8, close: 8.5, complete: true },
  ];

  assert.equal(detectEngulfingPatternAt(bullish, 1)?.type, 'T1');
  assert.equal(detectEngulfingPatternAt(bullish, 1)?.direction, 'bullish');
  assert.equal(detectEngulfingPatternAt(bearish, 1)?.direction, 'bearish');
  bullish[1].complete = false;
  assert.equal(detectEngulfingPatternAt(bullish, 1), undefined);
});

test('Type 2 uses an opposite-color sweep candle and closes beyond the first candle', () => {
  const bullish: StructureCandle[] = [
    { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 2, open: 10, high: 12, low: 8, close: 11, complete: true },
    { time: 3, open: 9, high: 14, low: 8.5, close: 13.5, complete: true },
  ];
  const bearish: StructureCandle[] = [
    { time: 1, open: 10, high: 13, low: 9, close: 12, complete: true },
    { time: 2, open: 12, high: 14, low: 10, close: 11, complete: true },
    { time: 3, open: 13, high: 13.5, low: 8, close: 8.5, complete: true },
  ];

  assert.equal(detectEngulfingPatternAt(bullish, 2)?.type, 'T2');
  assert.equal(detectEngulfingPatternAt(bullish, 2)?.direction, 'bullish');
  assert.equal(detectEngulfingPatternAt(bearish, 2)?.type, 'T2');
  assert.equal(detectEngulfingPatternAt(bearish, 2)?.direction, 'bearish');

  bullish[2] = { ...bullish[2], high: 12.5, close: 12 };
  assert.notEqual(detectEngulfingPatternAt(bullish, 2)?.type, 'T2');
});

test('Type 3 uses a mixed middle candle that sweeps the first candle', () => {
  const bullish: StructureCandle[] = [
    { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 2, open: 10, high: 12, low: 8, close: 11, complete: true },
    { time: 3, open: 11, high: 13, low: 10, close: 12.5, complete: true },
  ];
  const bearish: StructureCandle[] = [
    { time: 1, open: 10, high: 13, low: 9, close: 12, complete: true },
    { time: 2, open: 12, high: 14, low: 10, close: 11, complete: true },
    { time: 3, open: 11, high: 12, low: 9, close: 9.5, complete: true },
  ];

  assert.equal(detectEngulfingPatternAt(bullish, 2)?.type, 'T3');
  assert.equal(detectEngulfingPatternAt(bullish, 2)?.direction, 'bullish');
  assert.equal(detectEngulfingPatternAt(bearish, 2)?.type, 'T3');
  assert.equal(detectEngulfingPatternAt(bearish, 2)?.direction, 'bearish');

  bullish[2] = { ...bullish[2], high: 14, close: 13.5 };
  assert.equal(
    detectEngulfingPatternAt(bullish, 2)?.type,
    'T2',
    'closing above the first red candle high upgrades the mixed sweep from Type 3 to Type 2',
  );
});

test('Type 4 contains all middle candles inside the first candle over 3–10 candles', () => {
  const bullish: StructureCandle[] = [
    { time: 1, open: 12, high: 13, low: 8, close: 9, complete: true },
    { time: 2, open: 9, high: 11, low: 8.5, close: 10, complete: true },
    { time: 3, open: 10, high: 12, low: 9, close: 11, complete: true },
    { time: 4, open: 11, high: 12.5, low: 10, close: 10.5, complete: true },
    { time: 5, open: 10.5, high: 14.5, low: 10, close: 14, complete: true },
  ];
  assert.deepEqual(detectEngulfingPatternAt(bullish, 4), {
    type: 'T4', direction: 'bullish', candleCount: 5, startIndex: 0, endIndex: 4,
  });

  bullish[2] = { ...bullish[2], high: 15 };
  assert.notEqual(detectEngulfingPatternAt(bullish, 4)?.type, 'T4');

  const sameColorBearish: StructureCandle[] = [
    { time: 1, open: 4187.785, high: 4189.375, low: 4183.55, close: 4183.975, complete: true },
    { time: 2, open: 4184.025, high: 4187.79, low: 4184.025, close: 4185.385, complete: true },
    { time: 3, open: 4185.29, high: 4188.765, low: 4184.09, close: 4185.385, complete: true },
    { time: 4, open: 4185.44, high: 4187.29, low: 4184.65, close: 4186.35, complete: true },
    { time: 5, open: 4186.28, high: 4186.705, low: 4181.76, close: 4183.02, complete: true },
  ];
  assert.deepEqual(detectEngulfingPatternAt(sameColorBearish, 4), {
    type: 'T4', direction: 'bearish', candleCount: 5, startIndex: 0, endIndex: 4,
  }, 'a red tap candle can confirm through a later red body closing below its low');

  const oneInsideCandle: StructureCandle[] = [
    { time: 1, open: 12, high: 13, low: 8, close: 9, complete: true },
    { time: 2, open: 9, high: 12, low: 9, close: 11, complete: true },
    { time: 3, open: 11, high: 14.5, low: 10, close: 14, complete: true },
  ];
  assert.deepEqual(detectEngulfingPatternAt(oneInsideCandle, 2), {
    type: 'T4', direction: 'bullish', candleCount: 3, startIndex: 0, endIndex: 2,
  }, 'one inside candle is sufficient between the tap and breakout candles');
});

test('Types 1, 2, and 4 reject a weak confirmation while Type 3 follows sweep geometry', () => {
  const patterns: Array<{ type: 'T1' | 'T2' | 'T3' | 'T4'; candles: StructureCandle[] }> = [
    {
      type: 'T1',
      candles: [
        { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
        { time: 2, open: 10, high: 14, low: 9.5, close: 13.5, complete: true },
      ],
    },
    {
      type: 'T2',
      candles: [
        { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
        { time: 2, open: 10, high: 12, low: 8, close: 11, complete: true },
        { time: 3, open: 9, high: 14, low: 8.5, close: 13.5, complete: true },
      ],
    },
    {
      type: 'T3',
      candles: [
        { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
        { time: 2, open: 10, high: 12, low: 8, close: 11, complete: true },
        { time: 3, open: 11, high: 13, low: 10, close: 12.5, complete: true },
      ],
    },
    {
      type: 'T4',
      candles: [
        { time: 1, open: 12, high: 13, low: 8, close: 9, complete: true },
        { time: 2, open: 9, high: 12, low: 9, close: 11, complete: true },
        { time: 3, open: 11, high: 14.5, low: 10, close: 14, complete: true },
      ],
    },
  ];

  for (const { type, candles } of patterns) {
    const endIndex = candles.length - 1;
    assert.equal(detectEngulfingPatternAt(candles, endIndex)?.type, type);
    const weakConfirmation = candles.map((candle) => ({ ...candle }));
    const final = weakConfirmation[endIndex];
    final.high = final.close + (final.close - final.open) + 0.01;
    if (type === 'T3') {
      assert.equal(detectEngulfingPatternAt(weakConfirmation, endIndex)?.type, 'T3');
    } else {
      assert.equal(
        detectEngulfingPatternAt(weakConfirmation, endIndex),
        undefined,
        `${type} must be rejected when the bullish upper wick is larger than its body`,
      );
    }
  }
});

test('bearish Type 3 accepts the chart-confirmed continuation candle with a longer lower wick', () => {
  const candles: StructureCandle[] = [
    { time: 1, open: 4168.790, high: 4172.390, low: 4168.785, close: 4172.150, complete: true },
    { time: 2, open: 4172.135, high: 4172.415, low: 4170.760, close: 4170.920, complete: true },
    { time: 3, open: 4171.070, high: 4172.075, low: 4169.725, close: 4170.475, complete: true },
  ];

  assert.deepEqual(detectEngulfingPatternAt(candles, 2), {
    type: 'T3', direction: 'bearish', candleCount: 3, startIndex: 0, endIndex: 2,
  });
});

test('bearish confirmation uses its lower wick and accepts a wick equal to the body', () => {
  const bearish: StructureCandle[] = [
    { time: 1, open: 10, high: 13, low: 9, close: 12, complete: true },
    { time: 2, open: 12, high: 12.5, low: 5, close: 8.5, complete: true },
  ];

  assert.equal(
    detectEngulfingPatternAt(bearish, 1)?.direction,
    'bearish',
    'a lower wick equal to the bearish body remains valid',
  );

  bearish[1].low = 4.99;
  assert.equal(
    detectEngulfingPatternAt(bearish, 1),
    undefined,
    'a lower wick larger than the bearish body must be rejected',
  );
});

test('zone engulfing requires A+ FIB, active-zone contact, the band-specific touch, and matching direction', () => {
  const candles: StructureCandle[] = [
    { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 2, open: 10, high: 12, low: 8, close: 11, complete: true },
    { time: 3, open: 9, high: 14, low: 8.5, close: 13.5, complete: true },
  ];
  const eligible = zone({
    isBuy: true,
    startTime: 0,
    activeFromTime: 1,
    bottom: 7.5,
    top: 8.5,
    fibStatus: 'a-plus',
    fibLevel50: 9,
  });

  assert.equal(findZoneEngulfingPattern(candles, eligible)?.type, 'T2');
  assert.equal(findZoneEngulfingPattern(candles, { ...eligible, isBuy: false }), undefined);
  assert.equal(findZoneEngulfingPattern(candles, { ...eligible, fibStatus: 'not-valid' }), undefined);
  assert.equal(
    findZoneEngulfingPattern(candles, {
      ...eligible,
      status: 'invalidated',
      active: false,
      invalidatedAt: 4,
    }),
    undefined,
    'an invalidated zone must not retain an engulfing type found before invalidation',
  );
  assert.equal(findZoneEngulfingPattern(candles, { ...eligible, bottom: 20, top: 21 }), undefined);
  assert.equal(
    findZoneEngulfingPattern(candles, { ...eligible, fibLevel50: 8 })?.type,
    'T2',
    'an earlier candle in the confirmed pattern can satisfy the minimum 0.5 touch',
  );
  assert.equal(findZoneEngulfingPattern(candles, { ...eligible, fibLevel50: undefined }), undefined);
  assert.equal(
    findZoneEngulfingPattern(candles, {
      ...eligible,
      fibBand: 'DB/DT',
      fibLevel50: undefined,
    })?.type,
    'T2',
    'an originating DB/DT FIB zone qualifies from direct zone contact',
  );
  assert.equal(
    findZoneEngulfingPattern(candles, {
      ...eligible,
      fibBand: 'deep',
      fibLevel50: undefined,
    })?.type,
    'T2',
    'a valid FIB deep-discount zone can show its engulfing type without a 0.5 touch',
  );
  assert.equal(
    findZoneEngulfingPattern(candles, {
      ...eligible,
      fibBand: '0.71-0.79',
      fibLevel50: undefined,
    })?.type,
    'T2',
    'the direct 0.71-0.79 deep band can also show its engulfing type from zone contact',
  );

  const markedType4: StructureCandle[] = [
    { time: 10, open: 4187.785, high: 4189.375, low: 4183.55, close: 4183.975, complete: true },
    { time: 11, open: 4184.025, high: 4187.79, low: 4184.025, close: 4185.385, complete: true },
    { time: 12, open: 4185.29, high: 4188.765, low: 4184.09, close: 4185.385, complete: true },
    { time: 13, open: 4185.44, high: 4187.29, low: 4184.65, close: 4186.35, complete: true },
    { time: 14, open: 4186.28, high: 4186.705, low: 4181.76, close: 4183.02, complete: true },
  ];
  assert.equal(findZoneEngulfingPattern(markedType4, zone({
    name: 'QML',
    isBuy: false,
    startTime: 0,
    activeFromTime: 1,
    bottom: 4188.08755,
    top: 4190.86,
    fibStatus: 'a-plus',
    fibBand: '0.5-0.618',
    fibLevel50: 4187.19,
  }))?.type, 'T4', 'the marked tap-inside-breakout sequence qualifies through its first-candle 0.5 touch');

  const markedDbDtType4: StructureCandle[] = [
    { time: 20, open: 4187.74, high: 4196.475, low: 4187.475, close: 4194.15, complete: true },
    { time: 21, open: 4194.215, high: 4194.255, low: 4187.58, close: 4188.77, complete: true },
    { time: 22, open: 4188.755, high: 4189.555, low: 4183.565, close: 4185.555, complete: true },
  ];
  assert.equal(findZoneEngulfingPattern(markedDbDtType4, zone({
    name: 'DT',
    isBuy: false,
    startTime: 0,
    activeFromTime: 1,
    bottom: 4194.68445,
    top: 4196.895,
    fibStatus: 'a-plus',
    fibBand: 'DB/DT',
    fibLevel50: undefined,
  }))?.type, 'T4', 'a green DT tap, one inside candle, and red close below the tap low is bearish T4');
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

test('a converted QML ignores stale TJL1 directional metadata', () => {
  const qml = zone({
    name: 'QML',
    isBuy: false,
    invalidationDirection: 'down',
    bottom: 100,
    top: 110,
  });

  assert.equal(doesInvalidateZone(qml, {
    time: 300, open: 95, high: 105, low: 90, close: 92, complete: true,
  }), false, 'a sell QML must remain valid while price is below it');
  assert.equal(doesInvalidateZone(qml, {
    time: 400, open: 111, high: 114, low: 105, close: 112, complete: true,
  }), true, 'a sell QML invalidates only when the completed body is above it');
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
    { name: 'Internal TJL1', category: 'internal' },
    { name: 'Internal TJL2', category: 'internal' },
    { name: 'Internal QML', category: 'internal' },
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

test('pending ISS Level 3 and Internal TJL1 cannot tap before higher-timeframe validation', () => {
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
    name: 'Internal TJL1',
    category: 'internal',
  }), -1);
  assert.equal(findFirstZoneTapIndex(candles, {
    ...level3,
    status: 'valid',
    confirmationTime: 300,
    activeFromTime: 300,
  }), 2);
});

test('completed ISS delays internal TJLs until continuation and accepts both direct and post-BOS CHoCH', () => {
  const candles: StructureCandle[] = [
    { time: 0, open: 101, high: 102, low: 100, close: 101 },
    { time: 100, open: 101, high: 112, low: 101, close: 110 },
    { time: 200, open: 110, high: 111, low: 107, close: 108 },
    { time: 300, open: 108, high: 109, low: 104, close: 105 },
    { time: 400, open: 105, high: 110, low: 105, close: 109 },
    { time: 500, open: 109, high: 115, low: 108, close: 114 },
    { time: 600, open: 114, high: 120, low: 114, close: 118 },
    { time: 700, open: 118, high: 119, low: 115, close: 116 },
    { time: 800, open: 116, high: 117, low: 112, close: 113 },
    { time: 900, open: 113, high: 120, low: 113, close: 119 },
    { time: 1000, open: 119, high: 123, low: 118, close: 122 },
    { time: 1100, open: 122, high: 125, low: 121, close: 124 },
    { time: 1200, open: 124, high: 125, low: 120, close: 121 },
    { time: 1300, open: 121, high: 122, low: 117, close: 118 },
    { time: 1400, open: 118, high: 119, low: 114, close: 115 },
    { time: 1500, open: 115, high: 119, low: 114, close: 118 },
    { time: 1600, open: 118, high: 127, low: 117, close: 126 }, // post-ISS internal BOS
    { time: 1700, open: 121, high: 122, low: 115, close: 116 },
    { time: 1800, open: 116, high: 117, low: 111, close: 112 },
    { time: 1900, open: 112, high: 120, low: 112, close: 119 },
    { time: 2000, open: 119, high: 125, low: 118, close: 124 },
    { time: 2100, open: 124, high: 124, low: 109, close: 110 },
    { time: 2200, open: 110, high: 111, low: 107, close: 108 },
  ];
  const anchor = {
    direction: 'bullish' as const,
    start: { index: 0, time: 0, price: 100 },
    boundary: { index: 0, time: 0, price: 200 },
  };

  const justCompleted = findIssFiveWaves(candles.slice(0, 14), [anchor], 100, 30, 400);
  assert.ok(justCompleted.zones.some((item) => item.name === 'ISS L3'));
  assert.ok(justCompleted.zones.some((item) => item.name === 'ISS L4'));
  assert.equal(justCompleted.zones.some((item) => item.name === 'Internal TJL1'), false);
  assert.equal(justCompleted.zones.some((item) => item.name === 'Internal TJL2'), false,
    'ISS completion must not duplicate L3/L4 as internal TJL zones');

  const firstLegChoch = findIssFiveWaves([
    ...candles.slice(0, 17),
    { time: 1700, open: 116, high: 118, low: 112, close: 113 },
    { time: 1800, open: 113, high: 114, low: 108, close: 110 },
  ], [anchor], 100, 30, 400);
  const firstQml = firstLegChoch.zones.find((item) => item.name === 'Internal QML');
  const firstSbr = firstLegChoch.zones.find((item) => item.name === 'Internal SBR');
  const firstDt = firstLegChoch.zones.find((item) => item.name === 'Internal DT');
  assert.ok(firstLegChoch.lines.some((line) => (
    line.type === 'internal-bos' && line.toTime === 1600
  )), 'a post-ISS internal BOS must establish the reversal structure first');
  assert.equal(firstQml?.startTime, 1100, 'the BOS-confirmed internal high must become QML');
  assert.equal(firstSbr?.startTime, 1400, 'the BOS-confirmed internal low must become SBR');
  assert.equal(firstDt?.startTime, 1600, 'the reversal extreme must become Internal DT');
  assert.equal(firstQml?.chochClass, 'pending');
  assert.equal(firstSbr?.chochClass, 'pending');
  assert.equal(firstDt?.chochClass, 'pending');
  assert.equal(firstQml?.tradeable, false);
  assert.ok(firstLegChoch.lines.some((line) => line.label === 'INT CHoCH · WAIT'));
  assert.ok(firstLegChoch.lines.some((line) => (
    line.type === 'internal-choch' && line.fromTime === 1400 && line.toTime === 1700
  )), 'internal CHoCH must follow and break the pair established by internal BOS');

  const noPostIssBos = findIssFiveWaves([
    ...candles.slice(0, 16),
    { time: 1600, open: 118, high: 122, low: 117, close: 121 },
    { time: 1700, open: 116, high: 118, low: 112, close: 113 },
    { time: 1800, open: 113, high: 114, low: 108, close: 110 },
  ], [anchor], 100, 30, 400);
  assert.equal(noPostIssBos.lines.some((line) => line.type === 'internal-choch'), true,
    'a direct Point-5 reversal through Point 4 is a valid internal CHoCH');
  assert.ok(noPostIssBos.zones.some((item) => item.name === 'Internal QML'));
  assert.ok(noPostIssBos.zones.some((item) => item.name === 'Internal SBR'));

  const continued = findIssFiveWaves(candles.slice(0, 17), [anchor], 100, 30, 400);
  assert.ok(continued.zones.some((item) => item.name === 'ISS L3'));
  assert.ok(continued.zones.some((item) => item.name === 'ISS L4'));
  assert.ok(continued.zones.some((item) => item.name === 'Internal TJL1'));
  assert.ok(continued.zones.some((item) => item.name === 'Internal TJL2' && item.status === 'valid'));

  const running = findIssFiveWaves(candles, [anchor], 100, 30, 400);
  assert.ok(running.lines.some((line) => line.type === 'internal-choch'));
  assert.ok(running.zones.some((item) => item.name === 'Internal QML'));
  assert.ok(running.zones.some((item) => item.name === 'Internal SBR'));
  assert.ok(running.zones.some((item) => item.name === 'Internal DT'));
  assert.ok(running.internalMarkers.some((marker) => marker.text === 'I PH'));

  const stopped = findIssFiveWaves(candles, [anchor], 100, 30, 400, [1400]);
  assert.equal(stopped.lines.some((line) => line.type.startsWith('internal-')), false);
  assert.equal(stopped.zones.some((item) => item.name === 'Internal QML'), false);
  assert.equal(stopped.zones.some((item) => item.name === 'Internal TJL1'), false);
  assert.equal(stopped.zones.some((item) => item.name === 'Internal TJL2'), false);
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
