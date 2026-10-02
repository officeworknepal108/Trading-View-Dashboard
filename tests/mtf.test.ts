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

test('MTF CHOCH row hides HTF details and promotes only an A+ engulfing', () => {
  const lowerCandles = [
    candle(100, 104, 105, 101, 102),
    candle(200, 103, 104, 101, 102),
    candle(300, 102, 108, 101, 107),
    candle(400, 107, 108, 103, 104),
    candle(500, 104, 110, 103, 109),
  ];
  const higherZone = zone({ id: 'h1-demand', name: 'DEMAND', category: 'supplyDemand', bottom: 101, top: 105 });
  const qml = zone({
    id: 'm5-qml', chochTime: 300, startTime: 100, activeFromTime: 300,
    bottom: 103, top: 105, tapTime: 400, tapBarsAgo: 1,
    fibSourcePrice: 100, fibZeroPrice: 110,
  });
  const db = zone({
    id: 'm5-db', name: 'DB', chochTime: 300, startTime: 100,
    activeFromTime: 300, bottom: 99, top: 100,
  });
  const data: Partial<Record<'H1' | 'M5', MtfTimeframeData>> = {
    H1: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([qml, db]) },
  };

  const row = buildMtfRows(data).find((candidate) => candidate.higherTimeframe === 'H1');
  assert.equal(row?.lowerTimeframe, 'M5');
  assert.equal(row?.higherTimeframeZone, 'DEMAND');
  assert.equal(row?.confirmationKind, 'choch');
  assert.equal(row?.tappedZone, 'QML');
  assert.equal(row?.tapBarsAgo, 1);
  assert.equal(row?.engulfingType, 'T4');
});

test('ISS is absent until formed, then uses its own Fib and L3/L4 levels', () => {
  const lowerCandles = [
    candle(100, 104, 105, 101, 102),
    candle(200, 102, 108, 101, 107),
    candle(300, 107, 108, 103, 104),
    candle(400, 104, 110, 103, 109),
  ];
  const higherZone = zone({ id: 'h1-demand', name: 'DEMAND', category: 'supplyDemand', bottom: 101, top: 105 });
  const incompleteIss = zone({ id: 'l3-incomplete', name: 'ISS L3', category: 'iss' });
  const base = {
    H1: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([incompleteIss]) },
  };
  assert.equal(buildMtfRows(base).some((row) => row.confirmationKind === 'iss'), false);

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
    H1: base.H1,
    M5: { candles: lowerCandles, structure: structure([level3, level4]) },
  });
  const iss = rows.find((row) => row.confirmationKind === 'iss');
  assert.equal(iss?.tappedZone, 'ISS L3');
  assert.equal(iss?.engulfingType, 'T4');
});

test('an engulfing outside the silent Fib A+ bands is not an MTF entry', () => {
  const lowerCandles = [
    candle(100, 104, 105, 101, 102),
    candle(200, 103, 104, 101, 102),
    candle(300, 102, 108, 101, 107),
    candle(400, 107, 108, 106, 106.5),
    candle(500, 106.5, 110, 106, 109),
  ];
  const higherZone = zone({ id: 'h1-demand', name: 'DEMAND', category: 'supplyDemand', bottom: 101, top: 105 });
  const qml = zone({
    id: 'm5-qml', chochTime: 300, startTime: 100, activeFromTime: 300,
    bottom: 106, top: 108, tapTime: 400,
    fibSourcePrice: 100, fibZeroPrice: 110,
  });
  const db = zone({ id: 'm5-db', name: 'DB', chochTime: 300, bottom: 99, top: 100 });
  const row = buildMtfRows({
    H1: { candles: lowerCandles, structure: structure([higherZone]) },
    M5: { candles: lowerCandles, structure: structure([qml, db]) },
  }).find((candidate) => candidate.confirmationKind === 'choch');
  assert.equal(row?.tappedZone, 'QML');
  assert.equal(row?.engulfingType, undefined);
});
