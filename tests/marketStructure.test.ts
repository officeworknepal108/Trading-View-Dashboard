import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateZoneAfterChoch,
  analyzeMarketStructure,
  applyFibConfluence,
  applyIssLevel3Lifecycle,
  applySingleChochMetadataToZone,
  applyTradeableZoneEngulfingFallback,
  applyIssFibAnchors,
  classifyChoch,
  classifyDoubleChoch,
  classifyFibOverlap,
  detectEngulfingPatternAt,
  deduplicateStructureZones,
  doesInvalidateZone,
  findDeepFibInvalidationTime,
  findTjlFibSource,
  findZoneEngulfingPattern,
  findTradeableZoneEngulfingPattern,
  isZoneEligibleForEngulfingEntry,
  isGoldZoneEntryBlocked,
  isGoldZoneOpportunityExpired,
  isM15H1ChochClosePending,
  isDoubleChochZoneTradeable,
  findIssFiveWaves,
  findFirstZoneTapIndex,
  findZoneTapIndices,
  getGoldZoneTapState,
  findVipSupportTap,
  findVipSupportTapAcrossContexts,
  getConfirmationBucketStart,
  invalidateTjlFibBeforeLatestStructureReset,
  isTjl2LiquiditySweep,
  isTjl2LiquidityCoverage,
  markMajorLiquidityZone,
  promoteTjl2ToMajorLiquidity,
  resolveTjl1Confirmation,
  rejectPendingIssLevel3OnExternalReset,
  DISABLED_HIGHER_TIMEFRAME_CONFIRMATION,
  selectFreshVipSupportTap,
  selectTwoCandleRetracementPivot,
  supersedePendingIssLevel3,
  supersedePendingTjl1,
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

test('Gold zone opportunity remains eligible after 50 completed bars without the pip move', () => {
  const tappedZone = zone({ isBuy: true, startTime: -1, activeFromTime: 0,
    tapTime: 0, top: 101, bottom: 100 });
  const candles = [candle(0, 100.5, 101, 100),
    ...Array.from({ length: 75 }, (_, index) => candle(index + 1, 101, 102, 100.5))];
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1), false);
  candles.push(candle(76, 110, 130, 100.5));
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1), true);
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1, 76), false);
});

test('Gold zone opportunity expires at each timeframe move limit before a later signal', () => {
  for (const [timeframe, limit] of [['M1', 60], ['M5', 150], ['M15', 300], ['M30', 350], ['H1', 700], ['H4', 1000]] as const) {
    const tappedZone = zone({ isBuy: true, startTime: -1, activeFromTime: 0,
      tapTime: 0, top: 101, bottom: 100 });
    const candles = [candle(0, 100.5, 101, 100), candle(1, 102, 100 + limit * 0.1, 101)];
    assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, timeframe, 0.1), true);
    assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, timeframe, 0.1, 1), false);
  }
});

test('a second tap measures its own distance but never allows another entry', () => {
  const tappedZone = zone({ isBuy: true, startTime: 0, activeFromTime: 1,
    tapTime: 1, top: 101, bottom: 100 });
  const candles = [candle(0, 102, 103, 101.5),
    candle(1, 100.5, 101, 100),
    candle(2, 102, 103, 101.5),
    candle(3, 108, 108, 102),
    candle(4, 102, 103, 101.5),
    candle(5, 100.5, 101, 100)];
  assert.deepEqual(findZoneTapIndices(candles, tappedZone), [1, 5]);
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M1', 0.1, 5), true);
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M1', 0.1), false);
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M1', 0.1,
    Infinity, { price: 102, filledAt: 2, stopLoss: 101 }), false);
  assert.equal(isGoldZoneEntryBlocked(tappedZone, candles, 'M1', 0.1), true);
  candles.push(candle(6, 108, 108, 102));
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M1', 0.1), true);
});

test('Gold returns stay in the same tap until its timeframe limit is reached', () => {
  const tappedZone = zone({ isBuy: true, startTime: -1, activeFromTime: 0,
    tapTime: 0, top: 101, bottom: 100 });
  const candles = [candle(0, 100.5, 101, 100), candle(1, 110, 120, 102),
    candle(2, 100.5, 101, 100), candle(3, 120, 129, 102)];
  assert.deepEqual(getGoldZoneTapState(tappedZone, candles, 'M15', 0.1).tapIndices, [0]);
  assert.equal(isGoldZoneEntryBlocked(tappedZone, candles, 'M15', 0.1), false);
  candles.push(candle(4, 125, 130, 102));
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1), true);
  candles.push(candle(5, 100.5, 101, 100), candle(6, 110, 115, 102),
    candle(7, 100.5, 101, 100));
  assert.deepEqual(getGoldZoneTapState(tappedZone, candles, 'M15', 0.1).tapIndices, [0, 5]);
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1), false);
  assert.equal(isGoldZoneEntryBlocked(tappedZone, candles, 'M15', 0.1), true);
  candles.push(candle(8, 125, 130, 102), candle(9, 100.5, 101, 100));
  assert.deepEqual(getGoldZoneTapState(tappedZone, candles, 'M15', 0.1).tapIndices, [0, 5, 9]);
});

test('a first-tap entry keeps later returns on tap one until 1R', () => {
  const tappedZone = zone({ isBuy: true, startTime: -1, activeFromTime: 0,
    tapTime: 0, top: 101, bottom: 100 });
  const entry = { price: 105, filledAt: 3, stopLoss: 87 };
  const candles = [candle(0, 100.5, 101, 100), candle(1, 110, 120, 102),
    candle(2, 100.5, 101, 100), candle(3, 105, 110, 102),
    candle(4, 120, 122, 110), candle(5, 100.5, 110, 100)];
  assert.deepEqual(getGoldZoneTapState(tappedZone, candles, 'M15', 0.1,
    Infinity, entry).tapIndices, [0]);
  assert.equal(isGoldZoneEntryBlocked(tappedZone, candles, 'M15', 0.1,
    Infinity, entry), false);
  candles.push(candle(6, 120, 123, 102), candle(7, 100.5, 101, 100));
  assert.deepEqual(getGoldZoneTapState(tappedZone, candles, 'M15', 0.1,
    Infinity, entry).tapIndices, [0, 7]);
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1,
    Infinity, entry), false);
});

test('first tap uses 1R from a filled entry, otherwise the timeframe limit from the tap', () => {
  const tappedZone = zone({ isBuy: true, startTime: -1, activeFromTime: 0,
    tapTime: 0, top: 101, bottom: 100 });
  const candles = [candle(0, 100.5, 101, 100), candle(1, 110, 120, 102),
    candle(2, 105, 110, 104), candle(3, 120, 122, 110)];
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1), false);
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1,
    Infinity, { price: 105, filledAt: 2, stopLoss: 87 }), false);
  candles.push(candle(4, 122, 123, 121));
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1,
    Infinity, { price: 105, filledAt: 2, stopLoss: 87 }), true);
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1), false);
  assert.equal(isGoldZoneEntryBlocked(tappedZone, candles, 'M15', 0.1, 5,
    { price: 105, filledAt: 2, stopLoss: 87 }), true);
  candles.push(candle(5, 123, 130, 122));
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M15', 0.1), true);
});

test('Gold sell zone uses favorable downward movement and ignores unfinished bars', () => {
  const tappedZone = zone({ startTime: -1, activeFromTime: 0,
    tapTime: 0, top: 110, bottom: 100 });
  const candles = [candle(0, 105, 110, 100),
    { ...candle(1, 100, 101, 90), complete: false },
    candle(2, 106, 107, 105)];
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M1', 0.1), false);
  candles.push(candle(3, 105, 106, 104));
  assert.equal(isGoldZoneOpportunityExpired(tappedZone, candles, 'M1', 0.1), true);
});

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

test('a recent M15 CHoCH cannot trade any of its zones before the mapped H1 confirmation', () => {
  assert.equal(isM15H1ChochClosePending(900, 3600, 'pending'), true);
  assert.equal(isM15H1ChochClosePending(900, 3600, 'valid'), false);
  assert.equal(isM15H1ChochClosePending(300, 900, 'pending'), false);

  const pendingContext = {
    chochClass: 'pending' as const,
    tradeable: false,
    chochTime: 0,
    chochConfirmationTime: undefined,
    m15H1ChochClosePending: true,
  };
  const entryCandles: StructureCandle[] = [
    { time: 1, open: 96, high: 97, low: 93, close: 94, complete: true },
    { time: 2, open: 94, high: 99, low: 92, close: 98, complete: true },
  ];
  for (const name of ['QML', 'SBR', 'DB'] as const) {
    const candidate = zone({
      name, isBuy: true, startTime: 0, activeFromTime: 1,
      bottom: 90, top: 100, tapTime: 2,
      fibStatus: 'a-plus', fibBand: '0.5-0.618', fibLevel50: 95,
    });
    applySingleChochMetadataToZone(candidate, pendingContext);
    assert.equal(candidate.tradeable, false, `${name} must remain NO TRADE`);
    assert.equal(isZoneEligibleForEngulfingEntry(candidate), false);
    assert.equal(findZoneEngulfingPattern(entryCandles, candidate), undefined);

    applySingleChochMetadataToZone(candidate, {
      ...pendingContext,
      chochClass: 'valid',
      tradeable: true,
      chochConfirmationTime: 3600,
      m15H1ChochClosePending: false,
    });
    assert.equal(isZoneEligibleForEngulfingEntry(candidate), true);
    assert.equal(findZoneEngulfingPattern(entryCandles, candidate)?.type, 'T1');
  }

  const airQml = zone({
    name: 'QML', chochClass: 'air', tradeable: false, tapTime: 2,
    fibStatus: 'a-plus', fibBand: '0.5-0.618', fibLevel50: 95,
  });
  assert.equal(isZoneEligibleForEngulfingEntry(airQml), true,
    'the existing AIR QML route is unchanged');
});

test('overlapping ISS paths emit one canonical zone per structure ID', () => {
  const first = zone({ id: 'same-internal-qml', name: 'Internal QML', tapTime: 100 });
  const latest = zone({ id: 'same-internal-qml', name: 'Internal QML', tapTime: 200 });
  const distinct = zone({ id: 'distinct-zone', name: 'Internal SBR' });
  const result = deduplicateStructureZones([first, latest, distinct]);
  assert.equal(result.length, 2);
  assert.equal(result.find((item) => item.id === 'same-internal-qml')?.tapTime, 200);
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

test('an external zone can qualify against any of the latest four CHoCH FIB moves', () => {
  const candles: StructureCandle[] = [
    { time: -10, open: -100, high: -95, low: -100, close: -96, complete: true },
    { time: 0, open: 0, high: 5, low: 0, close: 4, complete: true },
    { time: 10, open: 100, high: 105, low: 100, close: 104, complete: true },
    { time: 20, open: 104, high: 220, low: 103, close: 210, complete: true },
    { time: 30, open: 210, high: 220, low: 180, close: 190, complete: true },
    { time: 40, open: 190, high: 220, low: 185, close: 215, complete: true },
  ];
  const zones: StructureZone[] = [
    zone({ id: 'fifth-db', name: 'DB', isBuy: true, startTime: -10, bottom: -100, top: -95, chochTime: -10 }),
    zone({ id: 'fifth-qml', name: 'QML', isBuy: true, startTime: -10, bottom: -22, top: -18, chochTime: -10 }),
    zone({ id: 'oldest-db', name: 'DB', isBuy: true, startTime: 0, bottom: 0, top: 5, chochTime: 0 }),
    zone({ id: 'oldest-qml', name: 'QML', isBuy: true, startTime: 0, bottom: 48, top: 52, chochTime: 0 }),
    zone({ id: 'old-db', name: 'DB', isBuy: true, startTime: 10, bottom: 100, top: 105, chochTime: 10 }),
    zone({ id: 'old-qml', name: 'QML', isBuy: true, startTime: 10, bottom: 128, top: 132, chochTime: 10 }),
    zone({ id: 'middle-dt', name: 'DT', isBuy: false, startTime: 20, bottom: 215, top: 220, chochTime: 20 }),
    zone({ id: 'middle-qml', name: 'QML', isBuy: false, startTime: 20, bottom: 205, top: 210, chochTime: 20 }),
    zone({ id: 'latest-db', name: 'DB', isBuy: true, startTime: 30, bottom: 180, top: 185, chochTime: 30 }),
    zone({ id: 'latest-qml', name: 'QML', isBuy: true, startTime: 30, bottom: 128, top: 132, chochTime: 30 }),
    zone({ id: 'fourth-fib-only', name: 'QML', isBuy: true, startTime: 30, bottom: 48, top: 52, chochTime: 30 }),
    zone({ id: 'fifth-fib-only', name: 'QML', isBuy: true, startTime: 30, bottom: -22, top: -18, chochTime: 30 }),
  ];

  applyFibConfluence(candles, zones);

  const latestQml = zones.find((candidate) => candidate.id === 'latest-qml')!;
  assert.equal(latestQml.fibStatus, 'a-plus');
  assert.equal(latestQml.fibBand, '0.71-0.79');
  assert.equal(latestQml.fibSourceTime, 10, 'the matching previous CHoCH anchors the accepted FIB');
  const fourthFibZone = zones.find((candidate) => candidate.id === 'fourth-fib-only')!;
  assert.equal(fourthFibZone.fibStatus, 'a-plus');
  assert.equal(fourthFibZone.fibSourceTime, 0, 'the fourth CHoCH FIB remains eligible');
  assert.equal(
    zones.find((candidate) => candidate.id === 'fifth-fib-only')!.fibStatus,
    'not-valid',
    'a fifth, older CHoCH FIB is outside the active four-move window',
  );
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

test('FIB history lookup keeps the earliest equal extreme and excludes the live candle', () => {
  for (const isBuy of [true, false]) {
    const source = zone({ id: 'source', name: 'TJL2', isBuy, startTime: 100,
      bottom: 100, top: 120, tjlPairTime: 300 });
    const target = zone({ id: 'target', name: 'TJL1', isBuy, startTime: 200,
      bottom: 108, top: 112, tjlPairTime: 300 });
    const candles = [
      { time: 100, open: 110, close: 111, high: 115, low: 105 },
      { time: 200, open: 110, close: 111, high: 120, low: 100 },
      { time: 300, open: 110, close: 111, high: 120, low: 100 },
      { time: 400, open: 110, close: 111, high: 200, low: 50, complete: false },
    ];
    applyFibConfluence(candles, [source, target]);
    assert.equal(target.fibSourceTime, 100);
    assert.equal(target.fibZeroTime, 200);
    assert.equal(target.fibZeroPrice, isBuy ? 120 : 100);
    candles[3].complete = true;
    applyFibConfluence(candles, [source, target]);
    assert.equal(target.fibZeroTime, 400, 'the next completed update must invalidate the old lookup');
    assert.equal(target.fibZeroPrice, isBuy ? 200 : 50);
  }
});

test('DBD and DTD are Major Liquidity while ordinary TJL2 is not', () => {
  const dbd = zone({ id: 'dbd-major', name: 'DBD', isBuy: true });
  const dtd = zone({ id: 'dtd-major', name: 'DTD', isBuy: false });
  const tjl2 = zone({ id: 'ordinary-tjl2', name: 'TJL2', isBuy: true });

  assert.equal(markMajorLiquidityZone(dbd, 400), true);
  assert.deepEqual({ major: dbd.majorLiquidity, bosTime: dbd.majorLiquidityBosTime }, {
    major: true, bosTime: 400,
  });
  assert.equal(markMajorLiquidityZone(dtd, 800), true);
  assert.equal(dtd.majorLiquidity, true);
  assert.equal(markMajorLiquidityZone(tjl2, 900), false);
  assert.equal(tjl2.majorLiquidity, undefined);
});

test('the second-structure TJL2 becomes Major Liquidity after the first TJL2 sweep and second BOS', () => {
  const bullishFirst = zone({
    id: 'bull-first-tjl2', name: 'TJL2', isBuy: true,
    startTime: 100, activeFromTime: 200, bottom: 100, top: 102,
  });
  const bullishSweep: StructureCandle = {
    time: 300, open: 103, high: 104, low: 99, close: 101, complete: true,
  };
  assert.equal(isTjl2LiquiditySweep(bullishFirst, bullishSweep), true);
  assert.equal(isTjl2LiquiditySweep(bullishFirst, {
    ...bullishSweep, time: 301, low: 100.5,
  }), false, 'a candle that does not take the first TJL2 extreme is not a sweep');
  assert.equal(isTjl2LiquiditySweep(bullishFirst, {
    ...bullishSweep, time: 302, open: 99.5, close: 99,
  }), false, 'a body invalidation is not a preserved liquidity sweep');
  assert.equal(isTjl2LiquidityCoverage(bullishFirst, {
    ...bullishSweep, low: 100.8,
  }), true, 'the buy wick reaches 60% down through the first TJL2');
  assert.equal(isTjl2LiquidityCoverage(bullishFirst, {
    ...bullishSweep, low: 100.81,
  }), false, 'less than 60% coverage does not qualify');

  const bullishSecond = zone({
    id: 'bull-second-tjl2', name: 'TJL2', isBuy: true,
    startTime: 350, activeFromTime: 401, bottom: 104, top: 106,
  });
  assert.equal(promoteTjl2ToMajorLiquidity(bullishSecond, bullishFirst, 300, 400), true);
  assert.deepEqual({
    major: bullishSecond.majorLiquidity,
    source: bullishSecond.majorLiquiditySourceZoneId,
    sweep: bullishSecond.majorLiquiditySweepTime,
    bos: bullishSecond.majorLiquidityBosTime,
  }, {
    major: true, source: 'bull-first-tjl2', sweep: 300, bos: 400,
  });

  const bearishFirst = zone({
    id: 'bear-first-tjl2', name: 'TJL2', isBuy: false,
    startTime: 500, activeFromTime: 600, bottom: 108, top: 110,
  });
  const bearishSweep: StructureCandle = {
    time: 700, open: 107, high: 111, low: 106, close: 109, complete: true,
  };
  const bearishSecond = zone({
    id: 'bear-second-tjl2', name: 'TJL2', isBuy: false,
    startTime: 750, activeFromTime: 801, bottom: 104, top: 106,
  });
  assert.equal(isTjl2LiquiditySweep(bearishFirst, bearishSweep), true);
  assert.equal(isTjl2LiquidityCoverage(bearishFirst, {
    ...bearishSweep, high: 109.2,
  }), true, 'the sell wick reaches 60% up through the first TJL2');
  assert.equal(isTjl2LiquidityCoverage(bearishFirst, {
    ...bearishSweep, high: 109.19,
  }), false);
  assert.equal(isTjl2LiquidityCoverage(bearishFirst, {
    ...bearishSweep, high: 109.2, complete: false,
  }), false, 'an unfinished candle cannot qualify coverage');
  assert.equal(promoteTjl2ToMajorLiquidity(bearishSecond, bearishFirst, 700, 800), true);
  assert.equal(bearishSecond.majorLiquidity, true);

  const coverageSecond = zone({
    id: 'bear-coverage-tjl2', name: 'TJL2', isBuy: false,
    startTime: 750, activeFromTime: 801,
  });
  assert.equal(promoteTjl2ToMajorLiquidity(
    coverageSecond, bearishFirst, 700, 800, 'coverage',
  ), true);
  assert.equal(coverageSecond.majorLiquidity, true);
  assert.equal(coverageSecond.majorLiquidityCoverageTime, 700);
  assert.equal(coverageSecond.majorLiquiditySweepTime, undefined,
    '60% coverage must not be recorded as a full sweep');

  const picturedFirst = zone({
    id: 'pictured-first', name: 'TJL2', isBuy: false,
    bottom: 4148.96535, top: 4149.895,
  });
  assert.equal(isTjl2LiquidityCoverage(picturedFirst, {
    time: 900, open: 4146, high: 4149.545, low: 4145, close: 4146, complete: true,
  }), true, 'the pictured 62.35% retest qualifies under the requested 60% threshold');

  const prematureSecond = zone({ id: 'premature', name: 'TJL2', isBuy: true });
  assert.equal(promoteTjl2ToMajorLiquidity(prematureSecond, bullishFirst, 400, 400), false,
    'the confirming second BOS must happen after the sweep');
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

test('Type 1 requires a close beyond the first candle while the wick sweep remains optional', () => {
  const bullish: StructureCandle[] = [
    { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 2, open: 10, high: 14, low: 8.5, close: 13.5, complete: true },
  ];
  const bearish: StructureCandle[] = [
    { time: 1, open: 10, high: 13, low: 9, close: 12, complete: true },
    { time: 2, open: 12, high: 13.5, low: 8, close: 8.5, complete: true },
  ];

  assert.equal(detectEngulfingPatternAt(bullish, 1)?.type, 'T1');
  assert.equal(detectEngulfingPatternAt(bullish, 1)?.direction, 'bullish');
  assert.equal(detectEngulfingPatternAt(bearish, 1)?.direction, 'bearish');
  assert.equal(detectEngulfingPatternAt([
    bullish[0],
    { ...bullish[1], low: 9.5 },
  ], 1)?.type, 'T1', 'a bullish T1 does not require a lower-wick sweep');
  assert.equal(detectEngulfingPatternAt([
    bearish[0],
    { ...bearish[1], high: 12.5 },
  ], 1)?.type, 'T1', 'a bearish T1 does not require an upper-wick sweep');
  assert.equal(detectEngulfingPatternAt([
    bullish[0],
    { ...bullish[1], close: 12.5 },
  ], 1), undefined, 'a bullish T1 must close above the first candle high');
  assert.equal(detectEngulfingPatternAt([
    bearish[0],
    { ...bearish[1], close: 9.5 },
  ], 1), undefined, 'a bearish T1 must close below the first candle low');
  bullish[1].complete = false;
  assert.equal(detectEngulfingPatternAt(bullish, 1), undefined);
});

test('tradeable-zone fallback uses 30m engulfing only when the chart timeframe has none', () => {
  const thirtyMinuteCandles: StructureCandle[] = [
    { time: 1800, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 3600, open: 10, high: 14, low: 8.5, close: 13.5, complete: true },
  ];
  const buyZone = zone({
    isBuy: true,
    startTime: 0,
    activeFromTime: 1800,
    bottom: 9,
    top: 13,
    tradeable: true,
    fibStatus: 'a-plus',
    fibBand: '0.5-0.618',
    fibLevel50: 11,
  });

  assert.equal(findTradeableZoneEngulfingPattern(thirtyMinuteCandles, buyZone)?.type, 'T1');
  const [fallback] = applyTradeableZoneEngulfingFallback(thirtyMinuteCandles, [buyZone], '30M');
  assert.equal(fallback.fallbackEngulfingType, 'T1');
  assert.equal(fallback.fallbackEngulfingDirection, 'bullish');
  assert.equal(fallback.fallbackEngulfingTime, 3600);
  assert.equal(fallback.fallbackEngulfingTimeframe, '30M');

  const [nativeWins] = applyTradeableZoneEngulfingFallback(thirtyMinuteCandles, [{
    ...buyZone,
    engulfingType: 'T2',
    engulfingDirection: 'bullish',
    engulfingTime: 2700,
  }], '30M');
  assert.equal(nativeWins.engulfingType, 'T2');
  assert.equal(nativeWins.fallbackEngulfingType, undefined);

  const [lowerTimeframePreferred] = applyTradeableZoneEngulfingFallback(thirtyMinuteCandles, [{
    ...buyZone,
    engulfingType: 'T2',
    engulfingDirection: 'bullish',
    engulfingTime: 2700,
  }], 'M15', true);
  assert.equal(lowerTimeframePreferred.fallbackEngulfingType, 'T1');
  assert.equal(lowerTimeframePreferred.fallbackEngulfingTimeframe, 'M15');

  const [firstFallbackWins] = applyTradeableZoneEngulfingFallback(
    thirtyMinuteCandles,
    [lowerTimeframePreferred],
    'M30',
    true,
  );
  assert.equal(firstFallbackWins.fallbackEngulfingTimeframe, 'M15');

  const [secondFallbackUsed] = applyTradeableZoneEngulfingFallback([], [buyZone], 'M15', true);
  const [thirtyMinuteUsed] = applyTradeableZoneEngulfingFallback(
    thirtyMinuteCandles,
    [secondFallbackUsed],
    'M30',
    true,
  );
  assert.equal(thirtyMinuteUsed.fallbackEngulfingTimeframe, 'M30');
  assert.equal(
    findTradeableZoneEngulfingPattern(thirtyMinuteCandles, { ...buyZone, tradeable: false }),
    undefined,
  );

  const airQmlAfterTap = {
    ...buyZone,
    name: 'QML' as const,
    chochClass: 'air' as const,
    tradeable: false,
    tapTime: 1800,
  };
  assert.equal(isZoneEligibleForEngulfingEntry(airQmlAfterTap), true);
  assert.equal(findTradeableZoneEngulfingPattern(thirtyMinuteCandles, airQmlAfterTap)?.type, 'T1');
  assert.equal(isZoneEligibleForEngulfingEntry({
    ...airQmlAfterTap,
    name: 'SBR',
  }), false, 'the engulfing promotion is limited to QML');

  const outsideFib = {
    ...buyZone,
    name: 'SBR' as const,
    fibStatus: 'not-valid' as const,
    fibBand: undefined,
    fibLevel50: undefined,
  };
  assert.equal(
    findTradeableZoneEngulfingPattern(thirtyMinuteCandles, outsideFib),
    undefined,
    'a mapped engulfing cannot bypass the numerical FIB requirement for SBR',
  );

  const majorLiquidity = {
    ...outsideFib,
    name: 'DTD' as const,
    majorLiquidity: true,
  };
  assert.equal(
    findTradeableZoneEngulfingPattern(thirtyMinuteCandles, majorLiquidity)?.type,
    'T1',
    'designated Major Liquidity remains exempt from structure FIB alignment',
  );
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

  assert.notEqual(detectEngulfingPatternAt([
    bullish[0], { ...bullish[1], low: bullish[0].low }, bullish[2],
  ], 2)?.type, 'T3', 'an equal second low is not a bullish sweep');
  assert.notEqual(detectEngulfingPatternAt([
    bearish[0], { ...bearish[1], high: bearish[0].high }, bearish[2],
  ], 2)?.type, 'T3', 'an equal second high is not a bearish sweep');
  assert.notEqual(detectEngulfingPatternAt([
    bearish[0], { ...bearish[1], high: bearish[0].high - 0.1 }, bearish[2],
  ], 2)?.type, 'T3', 'a lower second high is not a bearish sweep');

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
        { time: 2, open: 10, high: 14, low: 8.5, close: 13.5, complete: true },
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
    { time: 2, open: 12, high: 13.5, low: 5, close: 8.5, complete: true },
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
    fibBand: '0.5-0.618',
    fibLevel50: 9,
  });

  assert.equal(findZoneEngulfingPattern(candles, eligible)?.type, 'T2');
  assert.equal(
    findZoneEngulfingPattern(candles, {
      ...eligible,
      name: 'Internal QML',
      category: 'internal',
    })?.type,
    'T2',
    'internal structure uses the same qualified direct-entry confirmation',
  );
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
    }),
    undefined,
    'a DB/DT band label cannot make a different zone type inherently tradeable',
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
  }))?.type, 'T4', 'an ordinary DT is inherently deep-discount and needs only its zone-touching engulfing');
});

test('single CHoCH DB/DT anchors are inherently deep-discount and tradeable', () => {
  const candles: StructureCandle[] = [
    { time: 0, open: 118, high: 120, low: 117, close: 119, complete: true },
    { time: 10, open: 119, high: 119, low: 100, close: 102, complete: true },
  ];
  const zones: StructureZone[] = [
    zone({
      id: 'unaligned-dt',
      name: 'DT',
      isBuy: false,
      startTime: 0,
      bottom: 118,
      top: 120,
      chochTime: 10,
    }),
  ];

  applyFibConfluence(candles, zones);

  assert.equal(zones[0].fibStatus, 'a-plus');
  assert.equal(zones[0].fibBand, 'DB/DT');
  assert.equal(zones[0].fibLevel50, 110);
});

test('single CHoCH DB/DT stays valid without inheriting the HTF confirmation lock', () => {
  const pendingContext = {
    chochClass: 'pending' as const,
    tradeable: false,
    chochTime: 500,
    chochConfirmationTime: undefined,
    confirmationRouteDisabled: true,
  };
  const db = zone({
    name: 'DB', isBuy: true, status: 'valid', active: true,
  });
  applySingleChochMetadataToZone(db, pendingContext);

  assert.equal(db.status, 'valid');
  assert.equal(db.active, true);
  assert.equal(db.chochTime, 500, 'the CHoCH origin remains available for normal FIB anchoring');
  assert.equal(db.chochClass, undefined);
  assert.equal(db.tradeable, undefined);
  assert.equal(db.confirmationRouteDisabled, undefined);

  const qml = zone({ name: 'QML', status: 'valid', active: true });
  applySingleChochMetadataToZone(qml, pendingContext);
  assert.equal(qml.chochClass, 'pending', 'non-extreme CHoCH zones keep the existing confirmation rule');
  assert.equal(qml.tradeable, false);
  assert.equal(qml.confirmationRouteDisabled, true);
});

test('Major Liquidity accepts a zone-touching engulfing without any FIB alignment', () => {
  const candles: StructureCandle[] = [
    { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 2, open: 10, high: 14, low: 8.5, close: 13.5, complete: true },
  ];
  const majorLiquidity = zone({
    id: 'major-liquidity', name: 'DBD', isBuy: true, majorLiquidity: true,
    startTime: 0, activeFromTime: 1, bottom: 9, top: 10,
    fibRelevant: false, fibStatus: undefined, fibBand: undefined, fibLevel50: undefined,
  });

  assert.equal(findZoneEngulfingPattern(candles, majorLiquidity)?.type, 'T1');
  assert.equal(findZoneEngulfingPattern(candles, {
    ...majorLiquidity, id: 'major-tjl2', name: 'TJL2',
  })?.type, 'T1', 'a qualified second-structure TJL2 uses the same Fib-independent entry rule');
  assert.equal(findZoneEngulfingPattern(candles, {
    ...majorLiquidity, majorLiquidity: false,
  }), undefined, 'a zone without Major Liquidity status still requires its existing A+ FIB qualification');
  assert.equal(findZoneEngulfingPattern(candles, {
    ...majorLiquidity, status: 'invalidated', active: false,
  }), undefined, 'Major Liquidity still obeys normal zone invalidation');
});

test('Major Liquidity accepts every engulfing type without FIB alignment', () => {
  const patterns: Array<{ type: 'T1' | 'T2' | 'T3' | 'T4'; candles: StructureCandle[] }> = [
    {
      type: 'T1',
      candles: [
        { time: 1, open: 12, high: 13, low: 9, close: 10, complete: true },
        { time: 2, open: 10, high: 14, low: 8.5, close: 13.5, complete: true },
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

  for (const pattern of patterns) {
    const majorTjl2 = zone({
      id: `major-${pattern.type}`,
      name: 'TJL2',
      isBuy: true,
      majorLiquidity: true,
      startTime: 0,
      activeFromTime: 1,
      bottom: 8,
      top: 10,
      fibRelevant: false,
      fibStatus: undefined,
      fibBand: undefined,
      fibLevel50: undefined,
    });
    assert.equal(findZoneEngulfingPattern(pattern.candles, majorTjl2)?.type, pattern.type);
  }
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

test('Double CHoCH accepts every structural CHoCH origin and waits for its own mapped HTF confirmation', () => {
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
  assert.deepEqual(classifyDoubleChoch('pending', false), {
    doubleChochStatus: 'pending',
    doubleChochOriginClass: 'pending',
    tradeable: false,
  });
  assert.deepEqual(classifyDoubleChoch('pending', true), {
    doubleChochStatus: 'valid',
    doubleChochOriginClass: 'pending',
    tradeable: true,
  });
  assert.equal(classifyDoubleChoch(undefined, true), undefined);
});

test('a Double CHoCH from Pending permits QML A+, QML A++, and its new DTD or DBD', () => {
  assert.equal(isDoubleChochZoneTradeable('pending', 'pending', 'DTD'), false);
  assert.equal(isDoubleChochZoneTradeable('pending', 'valid', 'DTD'), true);
  assert.equal(isDoubleChochZoneTradeable('pending', 'valid', 'DBD'), true);
  assert.equal(isDoubleChochZoneTradeable('pending', 'valid', 'QML A+'), true);
  assert.equal(isDoubleChochZoneTradeable('pending', 'valid', 'QML A++'), true);
  assert.equal(isDoubleChochZoneTradeable('pending', 'valid', 'SBR'), false);
  assert.equal(isDoubleChochZoneTradeable('pending', 'valid', 'RBS'), false);
  assert.equal(isDoubleChochZoneTradeable('valid', 'valid', 'QML A+'), true);
});

test('a QML A+ from Pending becomes an engulfing entry only after the Double CHoCH is valid', () => {
  const candles: StructureCandle[] = [
    { time: 200, open: 108, high: 109, low: 102, close: 103, complete: true },
    { time: 300, open: 103, high: 112, low: 102.5, close: 111, complete: true },
  ];
  const qmlAPlus = zone({
    name: 'QML A+',
    isBuy: true,
    startTime: 100,
    activeFromTime: 200,
    bottom: 100,
    top: 110,
    tapTime: 200,
    doubleChochOriginClass: 'pending',
    doubleChochStatus: 'valid',
    tradeable: isDoubleChochZoneTradeable('pending', 'valid', 'QML A+'),
    fibStatus: 'a-plus',
    fibBand: '0.5-0.618',
    fibLevel50: 105,
  });

  assert.equal(findTradeableZoneEngulfingPattern(candles, qmlAPlus)?.type, 'T1');
  assert.equal(findTradeableZoneEngulfingPattern(candles, {
    ...qmlAPlus,
    doubleChochStatus: 'pending',
    tradeable: isDoubleChochZoneTradeable('pending', 'pending', 'QML A+'),
  }), undefined, 'an unconfirmed Double CHoCH cannot trade');
  assert.equal(findTradeableZoneEngulfingPattern(candles, {
    ...qmlAPlus,
    fibStatus: 'not-valid',
    fibBand: undefined,
    fibLevel50: undefined,
  }), undefined, 'QML A+ still requires numerical A+ FIB alignment');
});

test('partial-body breaks after pending CHoCH start fresh normal structures', () => {
  const prices = [
    [100, 101, 102, 90], [107, 110, 112, 106], [110, 108, 111, 107],
    [108, 106, 109, 105], [106, 113, 114, 106], [113, 110, 114, 109],
    [110, 107, 111, 106], [107, 104, 108, 103], [104, 102, 105, 101],
    [102, 108, 109, 101], [108, 111, 112, 107], [111, 100, 112, 99],
    [100, 106, 107, 99], [106, 109, 110, 105], [109, 114, 116, 108],
    [114, 117, 120, 113], [117, 112, 118, 110], [112, 108, 113, 106],
    [108, 98, 110, 97],
  ];
  const candles = prices.map(([open, close, high, low], index) => ({
    time: index * 900, open, close, high, low,
  }));
  const result = analyzeMarketStructure(candles, {
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  });
  const beforeNewBos = analyzeMarketStructure(candles.slice(0, -1), {
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  });
  assert.ok(result.lines.some((line) => line.label === 'CHoCH' && line.direction === 'bullish'));
  const priorDb = beforeNewBos.zones.find((item) => item.name === 'DB'
    && item.startTime === 11 * 900 && item.chochClass === 'pending');
  assert.ok(priorDb);
  assert.ok(result.lines.some((line) => line.label === 'BOS' && line.direction === 'bearish'
    && line.toTime === 18 * 900), 'the close through PL is a new bearish BOS');
  assert.equal(result.lines.some((line) => line.label === 'DOUBLE CHoCH'
    && line.toTime === 18 * 900), false);
  const newSellTjl1 = result.zones.find((item) => item.name === 'TJL1' && !item.isBuy
    && item.tjlPairTime === 19 * 900);
  assert.ok(newSellTjl1);
  assert.equal(newSellTjl1.startTime, priorDb.startTime);
  assert.equal(newSellTjl1.bottom, priorDb.bottom);
  assert.equal(newSellTjl1.top, priorDb.top);
  assert.ok(result.zones.some((item) => item.name === 'TJL2' && !item.isBuy
    && item.tjlPairTime === 19 * 900));
  assert.equal(result.zones.some((item) => item.name === 'DB'
    && item.startTime === 11 * 900), false, 'the PL zone becomes TJL1, not a remaining DB');

  const forming = analyzeMarketStructure([
    ...candles.slice(0, -1), { ...candles.at(-1)!, complete: false },
  ], {
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  });
  assert.equal(forming.lines.some((line) => line.label === 'BOS'
    && line.toTime === 18 * 900), false, 'a forming candle cannot start the new structure');

  const doubleChoch = analyzeMarketStructure([
    ...candles.slice(0, -1),
    { time: 18 * 900, open: 98, high: 99, low: 95, close: 96 },
  ], {
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  });
  assert.ok(doubleChoch.lines.some((line) => line.label === 'DOUBLE CHoCH'
    && line.toTime === 18 * 900), 'the existing full-body Double CHoCH still takes precedence');
  assert.equal(doubleChoch.lines.some((line) => line.label === 'BOS'
    && line.toTime === 18 * 900), false);

  const mirrored = analyzeMarketStructure([
    ...candles.slice(0, 11),
    { time: 11 * 900, open: 111, high: 116, low: 110, close: 115 },
  ], {
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  });
  assert.ok(mirrored.lines.some((line) => line.label === 'BOS' && line.direction === 'bullish'
    && line.toTime === 11 * 900), 'the close through PH is a new bullish BOS');
  assert.equal(mirrored.lines.some((line) => line.label === 'DOUBLE CHoCH'
    && line.toTime === 11 * 900), false);
  assert.ok(mirrored.zones.some((item) => item.name === 'TJL1' && item.isBuy
    && item.tjlPairTime === 12 * 900));
  assert.ok(mirrored.zones.some((item) => item.name === 'TJL2' && item.isBuy
    && item.tjlPairTime === 12 * 900));
  assert.equal(mirrored.zones.some((item) => item.name === 'DT'
    && item.startTime === 4 * 900), false, 'the PH zone becomes TJL1, not a remaining DT');
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
    { time: 0, open: 105, high: 106, low: 104, close: 105 },
    candle(900, 106),
    candle(1800, 108),
    { time: 2700, open: 109, high: 112, low: 108, close: 111 },
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

test('mapped confirmation requires the completed candle color, not a wick-only break', () => {
  const bullishWickOnly = resolveTjl1Confirmation([
    { time: 0, open: 105, high: 112, low: 104, close: 109 },
    candle(3600, 109),
  ], {
    confirmationDirection: 'up',
    bottom: 100,
    top: 110,
    formationTime: 0,
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  });
  assert.equal(bullishWickOnly.status, 'pending');

  const oppositeColorClose = resolveTjl1Confirmation([
    { time: 0, open: 112, high: 113, low: 110, close: 111 },
    candle(3600, 109),
  ], {
    confirmationDirection: 'up',
    bottom: 100,
    top: 110,
    formationTime: 0,
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  });
  assert.equal(oppositeColorClose.status, 'pending');
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

test('a completed HTF body beyond the invalidation side rejects a pending zone permanently', () => {
  for (const [direction, invalidOpen, invalidClose, confirmOpen, confirmClose] of [
    ['up', 99, 98, 105, 111],
    ['down', 111, 112, 105, 99],
  ] as const) {
    const result = resolveTjl1Confirmation([
      { time: 0, open: invalidOpen, high: Math.max(invalidOpen, invalidClose), low: Math.min(invalidOpen, invalidClose), close: invalidClose },
      { time: 3600, open: confirmOpen, high: Math.max(confirmOpen, confirmClose), low: Math.min(confirmOpen, confirmClose), close: confirmClose },
      candle(7200, confirmClose),
    ], {
      confirmationDirection: direction,
      bottom: 100,
      top: 110,
      formationTime: 0,
      sourceBarSeconds: 900,
      confirmationBarSeconds: 3600,
    });
    assert.equal(result.status, 'rejected');
    assert.equal(result.tjl1ConfirmationAttempts, 1);
    assert.equal(result.confirmationTime, undefined);
  }
});

test('wick and partial-body breaks leave HTF confirmation pending without a candle deadline', () => {
  const priorBars = [
    { time: 0, open: 105, high: 108, low: 98, close: 104 },
    { time: 3600, open: 99, high: 103, low: 98, close: 101 },
    { time: 7200, open: 105, high: 109, low: 101, close: 106 },
  ];
  const options = {
    confirmationDirection: 'up' as const,
    bottom: 100,
    top: 110,
    formationTime: 0,
    sourceBarSeconds: 900,
    confirmationBarSeconds: 3600,
  };
  const pending = resolveTjl1Confirmation([...priorBars, candle(10800, 106)], options);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.tjl1ConfirmationAttempts, 3);

  const confirmed = resolveTjl1Confirmation([
    ...priorBars,
    { time: 10800, open: 105, high: 112, low: 104, close: 111 },
    candle(14400, 111),
  ], options);
  assert.equal(confirmed.status, 'valid');
  assert.equal(confirmed.tjl1ConfirmationAttempts, 4);
  assert.equal(confirmed.confirmationTime, 14400);
});

test('a newer same-direction TJL1 structurally supersedes only zones still pending at replacement time', () => {
  const pending = zone({
    status: 'pending',
    tapTime: 300,
    tapBarsAgo: 2,
  });
  assert.equal(supersedePendingTjl1(pending, 400), true);
  assert.equal(pending.status, 'superseded');
  assert.equal(pending.active, false);
  assert.equal(pending.supersededAt, 400);
  assert.equal(pending.tapTime, undefined);

  const confirmsLater = zone({ status: 'valid', confirmationTime: 500 });
  assert.equal(supersedePendingTjl1(confirmsLater, 400), true);
  assert.equal(confirmsLater.status, 'superseded', 'a future confirmation cannot revive an older zone');

  const alreadyConfirmed = zone({ status: 'valid', confirmationTime: 300 });
  assert.equal(supersedePendingTjl1(alreadyConfirmed, 400), false);
  assert.equal(alreadyConfirmed.status, 'valid', 'confirmed zones retain their normal lifecycle');

  const internalPending = zone({ name: 'Internal TJL1', category: 'internal', status: 'pending' });
  assert.equal(supersedePendingTjl1(internalPending, 400), true);
  assert.equal(internalPending.status, 'superseded');

  const tjl2 = zone({ name: 'TJL2', status: 'pending' });
  assert.equal(supersedePendingTjl1(tjl2, 400), false);
});

test('a newer ISS Level 3 supersedes an older pending Level 3 regardless of direction', () => {
  const newerBuy = zone({
    id: 'new-buy-l3', name: 'ISS L3', category: 'iss', isBuy: true, status: 'pending',
  });
  const pendingBuy = zone({
    id: 'old-buy-l3', name: 'ISS L3', category: 'iss', isBuy: true, status: 'pending',
    tapTime: 300, tapBarsAgo: 2,
  });
  assert.equal(supersedePendingIssLevel3(pendingBuy, newerBuy, 400), true);
  assert.equal(pendingBuy.status, 'superseded');
  assert.equal(pendingBuy.active, false);
  assert.equal(pendingBuy.supersededAt, 400);
  assert.equal(pendingBuy.tapTime, undefined);

  const confirmsLater = zone({
    id: 'future-buy-l3', name: 'ISS L3', category: 'iss', isBuy: true,
    status: 'valid', confirmationTime: 500,
  });
  assert.equal(supersedePendingIssLevel3(confirmsLater, newerBuy, 400), true);
  assert.equal(confirmsLater.status, 'superseded');

  const alreadyConfirmed = zone({
    id: 'confirmed-buy-l3', name: 'ISS L3', category: 'iss', isBuy: true,
    status: 'valid', confirmationTime: 300,
  });
  assert.equal(supersedePendingIssLevel3(alreadyConfirmed, newerBuy, 400), false);
  assert.equal(alreadyConfirmed.status, 'valid');

  const oppositeSell = zone({
    id: 'old-sell-l3', name: 'ISS L3', category: 'iss', isBuy: false, status: 'pending',
  });
  assert.equal(supersedePendingIssLevel3(oppositeSell, newerBuy, 400), true);
  assert.equal(oppositeSell.status, 'superseded');

  const level4 = zone({ name: 'ISS L4', category: 'iss', isBuy: true, status: 'pending' });
  assert.equal(supersedePendingIssLevel3(level4, newerBuy, 400), false);
});

test('external CHoCH rejects pending ISS Level 3 while internal CHoCH leaves it intact', () => {
  const pending = zone({
    id: 'pending-l3', name: 'ISS L3', category: 'iss', status: 'pending',
    issCompletionTime: 300, tapTime: 350, tapBarsAgo: 2,
  });

  // Internal CHoCH times are not external reset inputs.
  applyIssLevel3Lifecycle([pending], 100, []);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.active, true);

  applyIssLevel3Lifecycle([pending], 100, [500]);
  assert.equal(pending.status, 'rejected');
  assert.equal(pending.active, false);
  assert.equal(pending.structureResetAt, 600);
  assert.equal(pending.tapTime, undefined);
});

test('ISS Level 3 confirmed before an external CHoCH keeps its normal lifecycle', () => {
  const confirmedBeforeReset = zone({
    id: 'confirmed-l3', name: 'ISS L3', category: 'iss', status: 'valid',
    issCompletionTime: 300, confirmationTime: 550,
  });
  assert.equal(rejectPendingIssLevel3OnExternalReset(confirmedBeforeReset, 600), false);
  assert.equal(confirmedBeforeReset.status, 'valid');

  const confirmsAtReset = zone({
    id: 'same-close-l3', name: 'ISS L3', category: 'iss', status: 'valid',
    issCompletionTime: 300, confirmationTime: 600,
  });
  assert.equal(rejectPendingIssLevel3OnExternalReset(confirmsAtReset, 600), true);
  assert.equal(confirmsAtReset.status, 'rejected');
});

test('a removed higher-timeframe confirmation route can never validate structure', () => {
  const result = resolveTjl1Confirmation([
    candle(0, 105), candle(300, 106), candle(600, 112), candle(900, 114),
  ], {
    confirmationDirection: 'up',
    bottom: 100,
    top: 110,
    formationTime: 300,
    sourceBarSeconds: 300,
    confirmationBarSeconds: DISABLED_HIGHER_TIMEFRAME_CONFIRMATION,
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.confirmationTime, undefined);
  assert.equal(result.confirmationWindowCloseTime, undefined);
  assert.equal(isZoneEligibleForEngulfingEntry(zone({
    confirmationRouteDisabled: true,
    tradeable: true,
  })), false);
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

  const crossingBodyOnly = findIssFiveWaves([
    ...candles.slice(0, 17),
    { time: 1700, open: 116, high: 118, low: 112, close: 113 },
  ], [anchor], 100, 30, 400);
  assert.equal(crossingBodyOnly.lines.some((line) => line.type === 'internal-choch'), false,
    'a body that crosses the protected level is not an internal CHoCH');

  const firstLegChoch = findIssFiveWaves([
    ...candles.slice(0, 17),
    { time: 1700, open: 113, high: 118, low: 108, close: 110 },
    { time: 1800, open: 110, high: 114, low: 108, close: 109 },
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
  const replacedIssLevel3 = firstLegChoch.zones.find((item) => item.name === 'ISS L3');
  assert.equal(replacedIssLevel3?.status, 'superseded',
    'an internal CHoCH must replace its still-pending ISS Level 3 with Internal QML');
  assert.equal(replacedIssLevel3?.active, false);
  assert.ok(firstLegChoch.lines.some((line) => line.label === 'INT CHoCH · WAIT'));
  assert.ok(firstLegChoch.lines.some((line) => (
    line.type === 'internal-choch' && line.fromTime === 1400 && line.toTime === 1700
  )), 'internal CHoCH must follow and break the pair established by internal BOS');

  const noPostIssBos = findIssFiveWaves([
    ...candles.slice(0, 16),
    { time: 1600, open: 118, high: 122, low: 117, close: 121 },
    { time: 1700, open: 110, high: 118, low: 108, close: 109 },
    { time: 1800, open: 109, high: 114, low: 107, close: 108 },
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

  const matchingExternalBos = {
    id: 'same-break', type: 'bos' as const, direction: 'bullish' as const,
    fromTime: 1100, fromPrice: 125, toTime: 1600, toPrice: 125,
  };
  const externalWins = findIssFiveWaves(candles.slice(0, 17), [anchor], 100, 30, 400,
    [], undefined, [matchingExternalBos]);
  assert.equal(externalWins.lines.some((line) => line.type === 'internal-bos'), false);
  assert.equal(externalWins.internalMarkers.some((marker) => marker.text === 'I HH'), false);
  assert.equal(externalWins.zones.some((item) => item.name === 'Internal TJL2'), false);
  assert.ok(externalWins.zones.some((item) => item.name === 'ISS L3'),
    'the external BOS must not reset the separate ISS L3 lifecycle');

  const differentPivotWinsInternally = findIssFiveWaves(candles.slice(0, 17), [anchor],
    100, 30, 400, [], undefined, [{ ...matchingExternalBos, fromTime: 1200 }]);
  assert.ok(differentPivotWinsInternally.lines.some((line) => line.type === 'internal-bos'),
    'an external BOS on the same candle but a different swing cannot hide this internal break');

  const bearishCandles = candles.slice(0, 17).map((item) => ({
    ...item, open: 250 - item.open, high: 250 - item.low,
    low: 250 - item.high, close: 250 - item.close,
  }));
  const bearishAnchor = {
    direction: 'bearish' as const,
    start: { index: 0, time: 0, price: 150 },
    boundary: { index: 0, time: 0, price: 50 },
  };
  const matchingBearishBos = {
    ...matchingExternalBos, direction: 'bearish' as const,
    fromPrice: 125, toPrice: 125,
  };
  const bearishWithoutExternalBos = findIssFiveWaves(bearishCandles, [bearishAnchor],
    100, 30, 400);
  assert.ok(bearishWithoutExternalBos.lines.some((line) => line.type === 'internal-bos'
    && line.toTime === 1600), 'the mirrored bearish break must exist before precedence applies');
  const bearishExternalWins = findIssFiveWaves(bearishCandles, [bearishAnchor],
    100, 30, 400, [], undefined, [matchingBearishBos]);
  assert.equal(bearishExternalWins.lines.some((line) => line.type === 'internal-bos'), false);
  assert.equal(bearishExternalWins.internalMarkers.some((marker) => marker.text === 'I LL'), false);
  assert.equal(bearishExternalWins.zones.some((item) => item.name === 'Internal TJL2'), false);

  const formingBreak = findIssFiveWaves([
    ...candles.slice(0, 16), { ...candles[16], complete: false },
  ], [anchor], 100, 30, 400);
  assert.equal(formingBreak.lines.some((line) => line.type === 'internal-bos'), false,
    'an unfinished candle cannot confirm internal BOS');

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


function internalDoubleFixture(mirror = false): StructureCandle[] {
  const bars = [
    [101,102,100,101], [101,112,101,110], [110,111,107,108], [108,109,104,105],
    [105,110,105,109], [109,115,108,114], [114,120,114,118], [118,119,115,116],
    [116,117,112,113], [113,120,113,119], [119,123,118,122], [122,125,121,124],
    [124,125,120,121], [121,122,117,118], [118,119,114,115], [115,119,114,118],
    [118,127,117,126], [113,118,108,110], [128,131,126,130], [130,145,129,144], [144,145,142,143],
  ];
  return bars.map(([open,high,low,close], index) => mirror
    ? { time: index * 100, open: 300-open, high: 300-low, low: 300-high, close: 300-close }
    : { time: index * 100, open, high, low, close });
}

function internalDoubleResult(candles: StructureCandle[], mirror = false, resets: number[] = []) {
  return findIssFiveWaves(candles, [{ direction: mirror ? 'bearish' : 'bullish',
    start: { index: 0, time: 0, price: mirror ? 200 : 100 },
    boundary: { index: 0, time: 0, price: mirror ? 100 : 200 },
  }], 100, 30, 400, resets);
}

test('internal Double CHoCH mirrors bullish and bearish external conversions and its own HTF confirmation', () => {
  for (const mirror of [false, true]) {
    const candles = internalDoubleFixture(mirror);
    const before = internalDoubleResult(candles.slice(0, 18), mirror);
    assert.ok(before.lines.some(line => line.label?.startsWith('INT CHoCH')));
    assert.ok(!before.zones.some(zone => zone.doubleChochTime !== undefined));
    const pending = internalDoubleResult(candles.slice(0, 19), mirror);
    const expectedNames = ['Internal QML A+', 'Internal QML A++',
      mirror ? 'Internal SBR' : 'Internal RBS', mirror ? 'Internal DTD' : 'Internal DBD'];
    const pendingZones = pending.zones.filter(zone => zone.doubleChochTime === 1800);
    assert.deepEqual(pendingZones.map(zone => zone.name), expectedNames);
    assert.ok(pending.lines.some(line => line.label === 'INT DOUBLE CHoCH'
      && line.direction === (mirror ? 'bearish' : 'bullish') && line.toTime === 1800));
    for (const zone of pendingZones) {
      assert.equal(zone.category, 'internal');
      assert.equal(zone.doubleChochStatus, 'pending');
      assert.equal(zone.tradeable, false);
      assert.equal(isZoneEligibleForEngulfingEntry(zone), false);
    }
    const confirmed = internalDoubleResult(candles, mirror);
    const confirmedZones = confirmed.zones.filter(zone => zone.doubleChochTime === 1800);
    for (const zone of confirmedZones) {
      assert.equal(zone.doubleChochStatus, 'valid');
      assert.equal(zone.doubleChochConfirmationTime, 2000);
      assert.equal(zone.doubleChochOriginClass, 'pending');
      assert.equal(zone.tradeable, zone.name !== (mirror ? 'Internal SBR' : 'Internal RBS'),
        'the Pending-origin SBR/RBS exception matches external Double CHoCH');
    }
    assert.equal(confirmedZones.at(-1)?.majorLiquidity, true);
    applyFibConfluence(candles, confirmed.zones);
    const qml = confirmedZones.find(zone => zone.name === 'Internal QML A+')!;
    assert.equal(qml.fibSourcePrice, mirror ? 192 : 108);
    assert.equal(qml.fibZeroPrice, mirror ? 155 : 145);
    assert.equal(qml.fibStatus, 'a-plus');
  }
});

test('internal Double CHoCH rejects wicks and live bars, and a close-only break becomes BOS', () => {
  const candles = internalDoubleFixture();
  for (const replacement of [
    { time: 1800, open: 125, high: 131, low: 124, close: 126 },
    { ...candles[18], complete: false },
  ]) {
    const result = internalDoubleResult([...candles.slice(0,18), replacement]);
    assert.ok(!result.lines.some(line => line.label === 'INT DOUBLE CHoCH'));
  }
  const crossed = internalDoubleResult([...candles.slice(0,18),
    { time: 1800, open: 126, high: 131, low: 125, close: 130 }, candles[19]]);
  assert.ok(crossed.lines.some(line => line.type === 'internal-bos' && line.toTime === 1800));
  assert.ok(!crossed.lines.some(line => line.label === 'INT DOUBLE CHoCH'),
    'a later full-body break cannot revive a candidate already replaced by BOS');
  const reset = internalDoubleResult(candles, false, [1800]);
  assert.ok(!reset.lines.some(line => line.label === 'INT DOUBLE CHoCH'),
    'an internal Double CHoCH cannot continue beyond its parent external reset');
});

test('internal and external Double CHoCH on one candle keep independent Fib anchors', () => {
  const candles = internalDoubleFixture();
  const internal = internalDoubleResult(candles).zones;
  const external = zone({ id: 'external-double', name: 'DBD', isBuy: true, bottom: 50, top: 51,
    startTime: 1700, doubleChochTime: 1800 });
  applyFibConfluence(candles, [external, ...internal]);
  assert.equal(external.fibSourcePrice, 50);
  assert.equal(internal.find(zone => zone.name === 'Internal QML A+')?.fibSourcePrice, 108);
});

test('internal Double CHoCH resets only its older internal TJL Fib and keeps external Fib intact', () => {
  const internalTjl = zone({ id: 'internal-old', category: 'internal', name: 'Internal TJL2',
    fibRelevant: true, fibStatus: 'a-plus', fibSourcePrice: 100 });
  const externalTjl = zone({ id: 'external-kept', fibRelevant: true, fibStatus: 'a-plus' });
  const reset = zone({ id: 'internal-reset', category: 'internal', name: 'Internal QML A+', doubleChochTime: 400 });
  invalidateTjlFibBeforeLatestStructureReset([internalTjl, externalTjl, reset]);
  assert.equal(internalTjl.fibRelevant, false);
  assert.equal(internalTjl.fibSourcePrice, undefined);
  assert.equal(externalTjl.fibStatus, 'a-plus');
  const freshTjl = zone({ id: 'internal-new', category: 'internal', name: 'Internal TJL1',
    startTime: 500, tjlPairTime: 600 });
  assert.equal(findTjlFibSource(freshTjl, [internalTjl, reset, freshTjl]), undefined);
});


test('all internal Double CHoCH origin classes and converted zones follow external eligibility', () => {
  for (const origin of ['valid', 'air', 'vip', 'pending'] as const) {
    for (const status of ['pending', 'valid'] as const) {
      for (const name of ['QML A+', 'QML A++', 'SBR', 'RBS', 'DTD', 'DBD'] as const) {
        const internalName = `Internal ${name}` as StructureZone['name'];
        assert.equal(isDoubleChochZoneTradeable(origin, status, internalName),
          isDoubleChochZoneTradeable(origin, status, name), `${origin} ${status} ${name}`);
      }
    }
  }
});
