import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructureZone } from '../src/services/marketStructure';
import {
  consolidateZonesForDisplay,
  displayZoneMembers,
  redundantStandaloneLiquidityZoneIds,
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
