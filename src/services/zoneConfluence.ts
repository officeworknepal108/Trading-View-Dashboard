import type { StructureZone } from './marketStructure';

export const ZONE_CONFLUENCE_PRICE_TOLERANCE = 0.1;

export interface DisplayStructureZone extends StructureZone {
  confluenceMembers?: StructureZone[];
}

function displayPriority(zone: StructureZone): number {
  if (zone.category === 'mg' && zone.name === 'TJL2') return 0;
  if (zone.category === 'mg') return 10;
  if (zone.category === 'internal') return 20;
  if (zone.category === 'iss') return 30;
  return 40;
}

function timeRangesOverlap(first: StructureZone, second: StructureZone): boolean {
  return first.startTime <= second.endTime && second.startTime <= first.endTime;
}

export function zonesShareDisplayArea(
  first: StructureZone,
  second: StructureZone,
  tolerance = ZONE_CONFLUENCE_PRICE_TOLERANCE,
): boolean {
  return first.id !== second.id
    && first.isBuy === second.isBuy
    && first.active === second.active
    && first.status === second.status
    && first.doubleChochStatus === second.doubleChochStatus
    && timeRangesOverlap(first, second)
    && Math.abs(first.bottom - second.bottom) <= tolerance
    && Math.abs(first.top - second.top) <= tolerance
    && (first.name !== second.name || first.category !== second.category);
}

/**
 * Collapse zones that describe the same physical price area for display only.
 * Every source zone remains attached to the representative so execution,
 * journaling, and confluence evidence can still resolve the original IDs.
 */
export function consolidateZonesForDisplay(
  zones: readonly StructureZone[],
  tolerance = ZONE_CONFLUENCE_PRICE_TOLERANCE,
): DisplayStructureZone[] {
  const groups: StructureZone[][] = [];
  for (const zone of zones) {
    const group = groups.find((candidate) => (
      candidate.some((member) => zonesShareDisplayArea(member, zone, tolerance))
    ));
    if (group) group.push(zone);
    else groups.push([zone]);
  }

  return groups.map((members) => {
    const ordered = [...members].sort((first, second) => (
      displayPriority(first) - displayPriority(second)
      || second.startTime - first.startTime
      || first.id.localeCompare(second.id)
    ));
    const primary = ordered[0];
    return ordered.length === 1
      ? { ...primary }
      : { ...primary, confluenceMembers: ordered };
  });
}

export function displayZoneMembers(zone: DisplayStructureZone): StructureZone[] {
  return zone.confluenceMembers ?? [zone];
}
