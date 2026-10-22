import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructureLine, StructureZone } from '../src/services/marketStructure';
import {
  consolidateZonesForDisplay,
  displayZoneMembers,
  redundantStandaloneLiquidityZoneIds,
  selectLtfChochContext,
  selectRecentComparisonZones,
  selectExtremeAPlusTjl2Zones,
} from '../src/services/zoneConfluence';

function zone(overrides: Partial<StructureZone>): StructureZone {
  return {
    id: 'zone',
    name: 'TJL2',
    category: 'mg',
    isBuy: true,
    startTime: 100,
    endTime: 500,
    bottom: 4154.82,
    top: 4160.491,
    active: true,
    status: 'valid',
    ...overrides,
  };
}

test('comparison shows five recent valid source zones and identifies price overlap', () => {
  const chartZone = zone({ id: 'm15-tjl2', bottom: 4150, top: 4155 });
  const h1IssL4 = zone({
    id: 'h1-iss-l4', name: 'ISS L4', category: 'iss',
    startTime: 600, endTime: 1200, bottom: 4153, top: 4158,
  });
  const recent = [
    zone({ id: 'z1', startTime: 100, tapTime: 800, bottom: 4200, top: 4202 }),
    zone({ id: 'z2', startTime: 200, bottom: 4200, top: 4202 }),
    zone({ id: 'z3', startTime: 300, bottom: 4200, top: 4202 }),
    zone({ id: 'z4', startTime: 400, bottom: 4200, top: 4202 }),
    zone({ id: 'z5', startTime: 500, bottom: 4200, top: 4202 }),
    h1IssL4,
    zone({ id: 'invalid', startTime: 700, active: false, status: 'invalidated' }),
    zone({ id: 'pending', startTime: 750, active: false, status: 'pending' }),
    zone({ id: 'inactive-valid', startTime: 800, active: false, status: 'valid' }),
    zone({ id: 'future', startTime: 2000 }),
  ];
  const selected = selectRecentComparisonZones(recent, [chartZone], 900);
  assert.equal(selected.length, 5);
  assert.equal(selected[0].zone.id, 'h1-iss-l4');
  assert.equal(selected.some((entry) => entry.zone.id === 'z1'), false);
  assert.equal(selected[0].overlapsCurrentZone, true);
  assert.equal(selected[1].overlapsCurrentZone, false);
  assert.equal(selected.some((entry) => entry.zone.id === 'future'), false);
  assert.equal(selected.some((entry) => ['invalid', 'pending', 'inactive-valid'].includes(entry.zone.id)), false);
});

test('comparison keeps the most recent buy and sell zones independently', () => {
  const sourceZones = [
    ...Array.from({ length: 6 }, (_, index) => zone({
      id: `buy-${index}`, startTime: 100 + index * 10, isBuy: true,
    })),
    ...Array.from({ length: 6 }, (_, index) => zone({
      id: `sell-${index}`, startTime: 200 + index * 10, isBuy: false,
    })),
  ];
  const selected = selectRecentComparisonZones(sourceZones, [], 300);
  assert.equal(selected.filter(({ zone: item }) => item.isBuy).length, 5);
  assert.equal(selected.filter(({ zone: item }) => !item.isBuy).length, 5);
  assert.equal(selected.some(({ zone: item }) => item.id === 'buy-0' || item.id === 'sell-0'), false);
});

test('LTF CHoCH waits for an HTF tap and shows both lower TJL zones before confirmation', () => {
  const higher = zone({ id: 'm15-buy', tapTime: 500 });
  const lowerZones = [
    zone({ id: 'm1-tjl1', name: 'TJL1', isBuy: false, status: 'pending' }),
    zone({ id: 'm1-tjl2', name: 'TJL2', isBuy: false }),
    zone({ id: 'other-side', name: 'TJL2', isBuy: true, startTime: 90 }),
  ];
  const lines: StructureLine[] = [
    { id: 'early', type: 'choch', direction: 'bullish', fromTime: 100,
      fromPrice: 4150, toTime: 450, toPrice: 4150 },
    { id: 'confirmed', type: 'choch', direction: 'bullish', fromTime: 500,
      fromPrice: 4150, toTime: 600, toPrice: 4150 },
  ];
  assert.deepEqual(selectLtfChochContext([higher], lowerZones, lines, 499),
    { zones: [], confirmations: [] });
  const waiting = selectLtfChochContext([higher], lowerZones, lines, 550);
  assert.deepEqual(waiting.zones.map(({ zone: item }) => item.id),
    ['m1-tjl1', 'm1-tjl2', 'other-side']);
  assert.equal(waiting.zones[0]?.visibleFromTime, 500);
  assert.equal(waiting.confirmations.length, 0);
  const confirmed = selectLtfChochContext([higher], lowerZones, lines, 650);
  assert.equal(confirmed.confirmations[0]?.line.id, 'confirmed');
});

test('same-direction TJL2 and Internal DB display as one TJL2 confluence zone', () => {
  const tjl2 = zone({ id: 'external-tjl2' });
  const internalDb = zone({
    id: 'internal-db',
    name: 'Internal DB',
    category: 'internal',
    bottom: 4154.87,
    top: 4160.44,
    chochClass: 'vip',
  });

  const displayed = consolidateZonesForDisplay([internalDb, tjl2]);
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].id, tjl2.id);
  assert.equal(displayed[0].name, 'TJL2');
  assert.deepEqual(displayZoneMembers(displayed[0]).map((member) => member.id), [
    'external-tjl2',
    'internal-db',
  ]);
});

test('opposite, materially different, and non-overlapping zones stay separate', () => {
  const base = zone({ id: 'base' });
  const opposite = zone({ id: 'opposite', name: 'Internal DB', category: 'internal', isBuy: false });
  const differentRange = zone({
    id: 'different-range', name: 'Internal DB', category: 'internal', bottom: 4153,
  });
  const later = zone({
    id: 'later', name: 'Internal DB', category: 'internal', startTime: 600, endTime: 900,
  });

  assert.equal(consolidateZonesForDisplay([base, opposite]).length, 2);
  assert.equal(consolidateZonesForDisplay([base, differentRange]).length, 2);
  assert.equal(consolidateZonesForDisplay([base, later]).length, 2);
});

test('forex display consolidation uses the pair pip size instead of the Gold tolerance', () => {
  const base = zone({
    id: 'forex-tjl2',
    bottom: 1.08500,
    top: 1.08600,
  });
  const separateForexZone = zone({
    id: 'forex-internal-db',
    name: 'Internal DB',
    category: 'internal',
    bottom: 1.08550,
    top: 1.08650,
  });
  const matchingForexZone = zone({
    id: 'forex-matching-db',
    name: 'Internal DB',
    category: 'internal',
    bottom: 1.08505,
    top: 1.08605,
  });

  assert.equal(consolidateZonesForDisplay([base, separateForexZone], 0.0001).length, 2);
  assert.equal(consolidateZonesForDisplay([base, matchingForexZone], 0.0001).length, 1);
  assert.equal(consolidateZonesForDisplay([base, separateForexZone]).length, 1);
});

test('standalone DB at a TJL2 and Internal DB pivot is one zone, not a second entry', () => {
  const tjl2 = zone({ id: 'tjl2', startTime: 100, bottom: 4154.82, top: 4160.491 });
  const internalDb = zone({
    id: 'internal-db',
    name: 'Internal DB',
    category: 'internal',
    startTime: 100,
    bottom: 4154.87,
    top: 4160.44,
  });
  const duplicateDb = zone({
    id: 'standalone-db',
    name: 'DB',
    startTime: 100,
    bottom: 4155.95,
    top: 4156.25,
  });
  const independentDb = zone({
    id: 'independent-db',
    name: 'DB',
    startTime: 200,
    bottom: 4155.95,
    top: 4156.25,
  });

  const redundant = redundantStandaloneLiquidityZoneIds([
    tjl2, internalDb, duplicateDb, independentDb,
  ]);
  assert.deepEqual([...redundant], ['standalone-db']);
});

test('Extreme A+ permits only the lower of two structural BUY TJL2 zones within 50 pips', () => {
  const lower = zone({ id: 'lower-tjl2', bottom: 4150, top: 4152 });
  const higher = zone({ id: 'higher-tjl2', bottom: 4156.9, top: 4160 });
  const higherInternalDb = zone({
    id: 'higher-internal-db',
    name: 'Internal DB',
    category: 'internal',
    bottom: 4156.95,
    top: 4160.05,
  });

  const selection = selectExtremeAPlusTjl2Zones([higherInternalDb, higher, lower], 0.1);
  assert.deepEqual([...selection.extremeZoneIds], ['lower-tjl2']);
  assert.deepEqual([...selection.blockedZoneIds].sort(), ['higher-internal-db', 'higher-tjl2']);
});

test('Extreme A+ does not pair TJL2 zones separated by more than 50 pips', () => {
  const lower = zone({ id: 'lower-tjl2', bottom: 4150, top: 4152 });
  const higher = zone({ id: 'higher-tjl2', bottom: 4157.1, top: 4160 });

  const selection = selectExtremeAPlusTjl2Zones([lower, higher], 0.1);
  assert.equal(selection.extremeZoneIds.size, 0);
  assert.equal(selection.blockedZoneIds.size, 0);
});

test('Extreme A+ does not infer an untaught bearish mirror rule', () => {
  const lowerSell = zone({ id: 'lower-sell', isBuy: false, bottom: 4150, top: 4152 });
  const higherSell = zone({ id: 'higher-sell', isBuy: false, bottom: 4156, top: 4160 });

  const selection = selectExtremeAPlusTjl2Zones([lowerSell, higherSell], 0.1);
  assert.equal(selection.extremeZoneIds.size, 0);
  assert.equal(selection.blockedZoneIds.size, 0);
});
