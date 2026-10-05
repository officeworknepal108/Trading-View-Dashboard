import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMtfRows, type MtfTimeframeData } from '../src/services/mtf';
import type { MarketStructureResult, StructureCandle, StructureZone } from '../src/services/marketStructure';

function candle(time: number, open: number, high: number, low: number, close: number): StructureCandle {
  return { time, open, high, low, close, complete: true };
}

function structure(zones: StructureZone[]): MarketStructureResult {
  return {
    markers: [], issMarkers: [], internalMarkers: [], engulfingMarkers: [],
    zones, lines: [], trend: 'neutral',
  };
}

function zone(overrides: Partial<StructureZone> = {}): StructureZone {
  return {
    id: 'zone', name: 'QML', category: 'mg', isBuy: true,
    startTime: 0, endTime: 10_000, activeFromTime: 0,
    bottom: 100, top: 102, active: true, status: 'valid',
    ...overrides,
  };
}

test('MTF row follows the selected LTF CHOCH and promotes only an A+ engulfing', () => {
  const lowerCandles = [
    candle(100, 104, 105, 101, 102),
    candle(200, 103, 104, 101, 102),
    candle(300, 102, 108, 101, 107),
    candle(400, 107, 108, 103, 104),
    candle(500, 104, 110, 103, 109),
  ];
  const higherZone = zone({ id: 'h1-demand', name: 'DEMAND', category: 'supplyDemand', bottom: 101, top: 104 });
  const qml = zone({
    id: 'm5-qml', chochTime: 300, startTime: 100, activeFromTime: 300,
    tjlPairTime: 50,
    bottom: 103, top: 105, tapTime: 400, tapBarsAgo: 1,
    fibSourcePrice: 100, fibZeroPrice: 110,
  });
  const rbs = zone({
    id: 'm5-rbs', name: 'RBS', chochTime: 300, startTime: 150,
    activeFromTime: 300, tjlPairTime: 50, bottom: 106, top: 107,
  });
  const db = zone({
    id: 'm5-db', name: 'DB', chochTime: 300, startTime: 100,
    activeFromTime: 300, bottom: 99, top: 100,
  });
  const data: Partial<Record<'H1' | 'M5', MtfTimeframeData>> = {
    H1: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([qml, rbs, db]) },
  };

  const row = buildMtfRows(data).find((candidate) => candidate.higherTimeframe === 'H1');
  assert.equal(row?.lowerTimeframe, 'M5');
  assert.equal(row?.higherTimeframeZoneId, 'h1-demand');
  assert.equal(row?.higherTimeframeZone, 'DEMAND');
  assert.equal(row?.higherTimeframeTapBarsAgo, 4);
  assert.equal(row?.confirmationKind, 'choch');
  assert.equal(row?.confirmationBarsAgo, 2);
  assert.equal(row?.tappedZone, 'QML');
  assert.equal(row?.tapBarsAgo, 1);
  assert.equal(row?.engulfingType, 'T4');
  assert.equal(row?.engulfingBarsAgo, 0);
});

test('MTF prefers and identifies Major Liquidity when the mapped HTF TJL2 is tapped', () => {
  const lowerCandles = [
    candle(100, 104, 105, 101, 102),
    candle(200, 103, 104, 101, 102),
    candle(300, 102, 108, 101, 107),
    candle(400, 107, 108, 103, 104),
  ];
  const ordinary = zone({
    id: 'ordinary-demand', name: 'DEMAND', category: 'supplyDemand', bottom: 101, top: 104,
  });
  const majorLiquidity = zone({
    id: 'major-tjl2', name: 'TJL2', isBuy: true, majorLiquidity: true,
    bottom: 101, top: 104,
  });
  const qml = zone({
    id: 'm5-qml', chochTime: 300, startTime: 100, activeFromTime: 300,
    tjlPairTime: 50, bottom: 103, top: 105,
  });
  const rbs = zone({
    id: 'm5-rbs', name: 'RBS', chochTime: 300, startTime: 150,
    activeFromTime: 300, tjlPairTime: 50, bottom: 102, top: 104,
  });
  const db = zone({
    id: 'm5-db', name: 'DB', chochTime: 300, startTime: 100,
    activeFromTime: 300, bottom: 99, top: 100,
  });

  const row = buildMtfRows({
    H1: { candles: lowerCandles, structure: structure([ordinary, majorLiquidity]) },
    M5: { candles: lowerCandles, structure: structure([qml, rbs, db]) },
  }).find((candidate) => candidate.higherTimeframe === 'H1');

  assert.equal(row?.higherTimeframeZoneId, 'major-tjl2');
  assert.equal(row?.higherTimeframeZone, 'TJL2');
  assert.equal(row?.higherTimeframeMajorLiquidity, true);
});

test('ISS does not replace the required same-structure CHOCH in an MTF setup', () => {
  const lowerCandles = [
    candle(100, 104, 105, 101, 102),
    candle(200, 102, 108, 101, 107),
    candle(300, 107, 108, 103, 104),
    candle(400, 104, 110, 103, 109),
  ];
  const higherZone = zone({ id: 'h1-demand', name: 'DEMAND', category: 'supplyDemand', bottom: 101, top: 105 });
  const level3 = zone({
    id: 'l3', name: 'ISS L3', category: 'iss', startTime: 100,
    activeFromTime: 200, bottom: 103, top: 105, tapTime: 300,
    issDirection: 'bullish', issCompletionTime: 200,
    issPoint0Price: 100, issPoint5Price: 110,
    fibSourcePrice: 100, fibZeroPrice: 110,
  });
  const level4 = zone({
    id: 'l4', name: 'ISS L4', category: 'iss', startTime: 100,
    activeFromTime: 200, bottom: 101, top: 102,
    issDirection: 'bullish', issCompletionTime: 200,
  });
  const rows = buildMtfRows({
    H1: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([level3, level4]) },
  });
  assert.equal(rows.some((row) => row.confirmationKind === 'iss'), false);
});

test('an engulfing outside the silent Fib A+ bands is not an MTF entry', () => {
  const lowerCandles = [
    candle(100, 104, 105, 101, 102),
    candle(200, 103, 104, 101, 102),
    candle(300, 102, 108, 101, 107),
    candle(400, 107, 108, 106, 106.5),
    candle(500, 106.5, 110, 106, 109),
  ];
  const higherZone = zone({ id: 'h1-demand', name: 'DEMAND', category: 'supplyDemand', bottom: 101, top: 107 });
  const qml = zone({
    id: 'm5-qml', chochTime: 300, startTime: 100, activeFromTime: 300,
    tjlPairTime: 50,
    bottom: 106, top: 108, tapTime: 400,
    fibSourcePrice: 100, fibZeroPrice: 110,
  });
  const rbs = zone({
    id: 'm5-rbs', name: 'RBS', chochTime: 300, startTime: 150,
    activeFromTime: 300, tjlPairTime: 50, bottom: 104, top: 105,
  });
  const db = zone({ id: 'm5-db', name: 'DB', chochTime: 300, bottom: 99, top: 100 });
  const row = buildMtfRows({
    H1: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([qml, rbs, db]) },
  }).find((candidate) => candidate.confirmationKind === 'choch');
  assert.equal(row?.tappedZone, 'QML');
  assert.equal(row?.engulfingType, undefined);
});

test('an active valid HTF level remains eligible after its 30-bar drawing ends', () => {
  const lowerCandles = [
    candle(100, 104, 105, 101, 102),
    candle(200, 103, 104, 101, 102),
    candle(300, 102, 108, 101, 107),
    candle(400, 107, 108, 103, 104),
  ];
  const hiddenHigherZone = zone({
    id: 'hidden-h1-demand', name: 'DEMAND', category: 'supplyDemand',
    bottom: 101, top: 105, endTime: 50,
  });
  const qml = zone({
    id: 'm5-qml', chochTime: 300, startTime: 100, activeFromTime: 300,
    tjlPairTime: 50,
    bottom: 103, top: 105, tapTime: 400,
    fibSourcePrice: 100, fibZeroPrice: 110,
  });
  const rbs = zone({
    id: 'm5-rbs', name: 'RBS', chochTime: 300, startTime: 150,
    activeFromTime: 300, tjlPairTime: 50, bottom: 106, top: 107,
  });
  const db = zone({ id: 'm5-db', name: 'DB', chochTime: 300, bottom: 99, top: 100 });

  const rows = buildMtfRows({
    H1: { candles: lowerCandles, structure: structure([hiddenHigherZone]) },
    M5: { candles: lowerCandles, structure: structure([qml, rbs, db]) },
  });
  assert.equal(rows.some((row) => row.higherTimeframe === 'H1'), true);
});

test('an old HTF tap does not qualify an unrelated LTF CHOCH outside that zone', () => {
  const lowerCandles = [
    candle(100, 101, 103, 99, 102),
    candle(200, 106, 108, 105, 107),
    // The CHOCH candle does not revisit the HTF zone, leaving only the stale
    // tap at 100 that predates the exact TJL pair created at 150.
    candle(300, 104, 108, 104, 107),
  ];
  const higherZone = zone({
    id: 'h1-demand', name: 'DEMAND', category: 'supplyDemand',
    bottom: 99, top: 103,
  });
  const qml = zone({
    id: 'converted-selling-tjl1', name: 'QML', chochTime: 300,
    tjlPairTime: 150, bottom: 104, top: 105,
  });
  const rbs = zone({
    id: 'converted-selling-tjl2', name: 'RBS', chochTime: 300,
    tjlPairTime: 150, bottom: 106, top: 108,
  });
  const db = zone({ id: 'db', name: 'DB', chochTime: 300, bottom: 99, top: 100 });

  const rows = buildMtfRows({
    H1: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([qml, rbs, db]) },
  });
  assert.equal(rows.some((row) => row.confirmationKind === 'choch'), false);
});

test('a later LTF structure outside the HTF zone is not an MTF CHOCH', () => {
  const lowerCandles = [
    candle(100, 106, 108, 105, 107),
    candle(200, 101, 103, 99, 102),
    // The CHOCH candle stays outside the HTF zone. Context comes from the
    // earlier valid HTF tap at 200, before this TJL pair formed.
    candle(300, 104, 108, 104, 107),
  ];
  const higherZone = zone({
    id: 'h1-demand', name: 'DEMAND', category: 'supplyDemand',
    bottom: 99, top: 103,
  });
  const qml = zone({
    id: 'new-selling-tjl1', name: 'QML', chochTime: 300,
    tjlPairTime: 250, bottom: 104, top: 105,
  });
  const rbs = zone({
    id: 'new-selling-tjl2', name: 'RBS', chochTime: 300,
    tjlPairTime: 250, bottom: 106, top: 108,
  });
  const db = zone({ id: 'db', name: 'DB', chochTime: 300, bottom: 99, top: 100 });

  const rows = buildMtfRows({
    H1: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([qml, rbs, db]) },
  });
  assert.equal(rows.some((row) => row.confirmationKind === 'choch'), false);
});

test('the completed LTF CHOCH candle can also provide the HTF zone tap', () => {
  const lowerCandles = [
    candle(100, 106, 108, 105, 107),
    candle(200, 105, 107, 104, 106),
    // This completed bullish CHOCH candle reaches the HTF demand zone.
    candle(300, 104, 108, 101, 107),
  ];
  const higherZone = zone({
    id: 'm15-tjl1', name: 'TJL1', category: 'mg', isBuy: true,
    bottom: 101, top: 103, confirmationTime: 150,
  });
  const qml = zone({
    id: 'converted-selling-tjl1', name: 'QML', chochTime: 300,
    tjlPairTime: 250, bottom: 103, top: 105,
  });
  const rbs = zone({
    id: 'converted-selling-tjl2', name: 'RBS', chochTime: 300,
    tjlPairTime: 250, bottom: 106, top: 108,
  });
  const db = zone({ id: 'db', name: 'DB', chochTime: 300, bottom: 99, top: 100 });

  const row = buildMtfRows({
    M15: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([qml, rbs, db]) },
  }).find((candidate) => candidate.higherTimeframe === 'M15'
    && candidate.lowerTimeframe === 'M5');

  assert.equal(row?.confirmationKind, 'choch');
  assert.equal(row?.higherTimeframeZoneId, 'm15-tjl1');
  assert.equal(row?.higherTimeframeTapTime, 300);
  assert.equal(row?.direction, 'bullish');
});

test('the LTF source pair must overlap the HTF zone even when the CHOCH break candle does not', () => {
  const lowerCandles = [
    candle(100, 106, 108, 105, 107),
    // Price taps the HTF sell zone while building the bullish LTF structure.
    candle(200, 108, 112, 107, 111),
    // The bearish CHOCH confirms below the HTF zone; this remains valid because
    // its source QML came from inside the HTF zone.
    candle(300, 108, 109, 101, 102),
    candle(400, 109, 112, 108, 111),
    candle(500, 111, 112.2, 110, 110.5),
    candle(600, 110.6, 110.7, 108.5, 109.8),
  ];
  const higherZone = zone({
    id: 'm15-tjl2', name: 'TJL2', category: 'mg', isBuy: false,
    bottom: 110, top: 112,
  });
  const qml = zone({
    id: 'm1-qml', name: 'QML', isBuy: false, chochTime: 300,
    tjlPairTime: 200, bottom: 110, top: 111, activeFromTime: 300,
    tapTime: 400, fibSourcePrice: 112, fibZeroPrice: 104,
  });
  const sbr = zone({
    id: 'm1-sbr', name: 'SBR', isBuy: false, chochTime: 300,
    tjlPairTime: 200, bottom: 106, top: 108,
  });
  const dt = zone({
    id: 'm1-dt', name: 'DT', isBuy: false, chochTime: 300,
    bottom: 111, top: 112,
  });

  const row = buildMtfRows({
    M15: { candles: lowerCandles, structure: structure([higherZone]) },
    M1: { candles: lowerCandles, structure: structure([qml, sbr, dt]) },
  }).find((candidate) => candidate.higherTimeframe === 'M15'
    && candidate.lowerTimeframe === 'M1');

  assert.equal(row?.direction, 'bearish');
  assert.equal(row?.higherTimeframeZoneId, 'm15-tjl2');
  assert.equal(row?.higherTimeframeTapTime, 200);
  assert.equal(row?.confirmationTime, 300);
  assert.equal(row?.engulfingType, 'T3');
  assert.equal(row?.engulfingTime, 600);

  const extendedFibQml = {
    ...qml,
    // A later move extension shifts the live Fib bands away from this QML,
    // but it must not erase the Type 3 that qualified at candle 600.
    fibZeroPrice: 80,
    engulfingType: 'T3' as const,
    engulfingDirection: 'bearish' as const,
    engulfingTime: 600,
  };
  const persistedRow = buildMtfRows({
    M15: { candles: lowerCandles, structure: structure([higherZone]) },
    M1: { candles: lowerCandles, structure: structure([extendedFibQml, sbr, dt]) },
  }).find((candidate) => candidate.higherTimeframe === 'M15'
    && candidate.lowerTimeframe === 'M1');
  assert.equal(persistedRow?.engulfingType, 'T3');
  assert.equal(persistedRow?.engulfingTime, 600);
});

test('sell flow tracks the preceding buying TJL pair into its bearish CHOCH', () => {
  const lowerCandles = [
    candle(100, 103, 104, 102, 103),
    candle(200, 108, 111, 107, 109),
    candle(300, 109, 110, 101, 102),
  ];
  const higherZone = zone({
    id: 'h1-supply', name: 'SUPPLY', category: 'supplyDemand', isBuy: false,
    bottom: 110, top: 112,
  });
  const qml = zone({
    id: 'converted-buying-tjl1', name: 'QML', isBuy: false, chochTime: 300,
    tjlPairTime: 150, bottom: 110, top: 111,
  });
  const sbr = zone({
    id: 'converted-buying-tjl2', name: 'SBR', isBuy: false, chochTime: 300,
    tjlPairTime: 150, bottom: 103, top: 105,
  });
  const dt = zone({
    id: 'dt', name: 'DT', isBuy: false, chochTime: 300,
    bottom: 111, top: 112,
  });

  const row = buildMtfRows({
    H1: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([qml, sbr, dt]) },
  }).find((candidate) => candidate.confirmationKind === 'choch');
  assert.equal(row?.direction, 'bearish');
  assert.equal(row?.higherTimeframeZoneId, 'h1-supply');
  assert.equal(row?.higherTimeframeTapTime, 200);
});
