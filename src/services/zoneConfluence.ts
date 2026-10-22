import type { StructureCandle, StructureLine, StructureZone } from './marketStructure';
import { getGoldZoneTapState } from './marketStructure';
import { matchMtfChochEvents } from './mtf';

export const ZONE_CONFLUENCE_PRICE_TOLERANCE = 0.1;

export interface DisplayStructureZone extends StructureZone {
  confluenceMembers?: StructureZone[];
}

export interface ExtremeAPlusTjl2Selection {
  extremeZoneIds: Set<string>;
  blockedZoneIds: Set<string>;
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

/** Temporary drawing endpoint for an unexpired pip-distance tap; source zones stay unchanged. */
export function tappedZoneDrawingEndIndex(
  zone: DisplayStructureZone,
  candles: StructureCandle[],
  timeframe: string,
  pipSize: number,
): number | undefined {
  const latest = candles[candles.length - 1];
  if (!latest) return undefined;
  // A drawing can react to the current live wick without changing trading confirmation rules.
  const drawingCandles = latest.complete === false
    ? [...candles.slice(0, -1), { ...latest, complete: true }]
    : candles;
  const extend = displayZoneMembers(zone).some((member) => {
    if (!member.active || member.status !== 'valid') return false;
    // No entry is supplied: drawing length always follows the timeframe's pip limit.
    const state = getGoldZoneTapState(member, drawingCandles, timeframe, pipSize);
    return state.tapIndices.length > 0 && !state.opportunityExpired;
  });
  return extend ? candles.length - 1 + 20 : undefined;
}

function priceRangesOverlap(first: StructureZone, second: StructureZone): boolean {
  return first.bottom <= second.top && second.bottom <= first.top;
}

export interface ComparisonZone {
  zone: StructureZone;
  overlapsCurrentZone: boolean;
  visibleFromTime?: number;
}

/** Keep the five most recent active, valid zones on each side of one timeframe. */
export function selectRecentComparisonZones(
  sourceZones: readonly StructureZone[],
  chartZones: readonly StructureZone[],
  currentTime: number,
  limit = 5,
): ComparisonZone[] {
  const currentChartZones = chartZones.filter((zone) => zone.active && zone.status === 'valid');
  const eligibleZones = [...sourceZones]
    .filter((zone) => zone.active && zone.status === 'valid'
      && zone.startTime <= currentTime
      && zone.top > zone.bottom && Number.isFinite(zone.top) && Number.isFinite(zone.bottom))
    .sort((first, second) => second.startTime - first.startTime || first.id.localeCompare(second.id))
    .filter((zone, index, ordered) => ordered.findIndex((candidate) => candidate.id === zone.id) === index);
  const perSideLimit = Math.max(0, limit);
  return [
    ...eligibleZones.filter((zone) => zone.isBuy).slice(0, perSideLimit),
    ...eligibleZones.filter((zone) => !zone.isBuy).slice(0, perSideLimit),
  ]
    .sort((first, second) => second.startTime - first.startTime || first.id.localeCompare(second.id))
    .map((zone) => ({
      zone,
      overlapsCurrentZone: currentChartZones.some((current) => priceRangesOverlap(zone, current)),
    }));
}

export function selectLtfChochContext(
  chartZones: readonly StructureZone[],
  lowerZones: readonly StructureZone[],
  lowerLines: readonly StructureLine[],
  currentTime: number,
  lowerCandles: readonly StructureCandle[],
  includeOriginOnly = false,
): { zones: ComparisonZone[]; confirmations: Array<{
  zone: StructureZone; line: StructureLine; chochSequence: number;
}> } {
  const tappedZone = chartZones.filter((zone) => zone.active && zone.status === 'valid'
    && zone.tapTime !== undefined && zone.tapTime <= currentTime)
    .sort((first, second) => (second.lastTapTime ?? second.tapTime ?? 0)
      - (first.lastTapTime ?? first.tapTime ?? 0))[0];
  if (!tappedZone) return { zones: [], confirmations: [] };
  const tapTime = tappedZone.tapTime!;
  const display = (zone: StructureZone): ComparisonZone => ({
    zone,
    visibleFromTime: Math.max(zone.startTime, zone.activeFromTime ?? zone.startTime, tapTime),
    overlapsCurrentZone: priceRangesOverlap(zone, tappedZone),
  });
  const matchedEvents = matchMtfChochEvents(lowerCandles, lowerZones, chartZones, includeOriginOnly)
    .filter((item) => item.higherTimeframeTouch.zone.id === tappedZone.id);
  const relatedLines = lowerLines.filter((candidate) => candidate.type === 'choch'
    && candidate.direction === (tappedZone.isBuy ? 'bullish' : 'bearish')
    && candidate.toTime >= tapTime && candidate.toTime <= currentTime
    && (candidate.label === 'DOUBLE CHoCH'
      ? lowerZones.some((zone) => zone.category === 'mg'
        && zone.isBuy === tappedZone.isBuy && zone.doubleChochTime === candidate.toTime
        && priceRangesOverlap(zone, tappedZone))
      : matchedEvents.some((item) => item.event.structureScope === 'external'
        && item.event.time === candidate.toTime)))
    .sort((first, second) => first.toTime - second.toTime)
    .filter((candidate, index, lines) => lines.findIndex((item) => (
      item.toTime === candidate.toTime
    )) === index);
  const line = relatedLines[relatedLines.length - 1];
  if (line) {
    const doubleChoch = line.label === 'DOUBLE CHoCH';
    const zoneNames: StructureZone['name'][] = doubleChoch
      ? ['QML A+', 'QML A++', 'RBS', 'SBR', 'DBD', 'DTD']
      : ['QML', 'RBS', 'SBR', 'DB', 'DT'];
    const chochZones = lowerZones.filter((zone) => zone.category === 'mg'
      && zoneNames.includes(zone.name)
      && zone.isBuy === tappedZone.isBuy && zone.active
      && (zone.status === 'valid' || zone.status === 'pending')
      && (doubleChoch ? zone.doubleChochTime : zone.chochTime) === line.toTime)
      .sort((first, second) => zoneNames.indexOf(first.name) - zoneNames.indexOf(second.name));
    return {
      zones: chochZones.map(display),
      confirmations: relatedLines.map((item) => ({
        zone: tappedZone, line: item,
        chochSequence: matchedEvents.find((event) => event.event.time === item.toTime)
          ?.chochSequence ?? 1,
      })),
    };
  }
  const pairs = new Map<number, { tjl1?: StructureZone; tjl2?: StructureZone }>();
  for (const zone of lowerZones) {
    if (zone.category !== 'mg' || (zone.name !== 'TJL1' && zone.name !== 'TJL2')
      || zone.isBuy === tappedZone.isBuy || !zone.active
      || (zone.status !== 'valid' && zone.status !== 'pending')
      || zone.tjlPairTime === undefined || zone.tjlPairTime > currentTime
      || zone.startTime > currentTime || zone.top <= zone.bottom) continue;
    const pair = pairs.get(zone.tjlPairTime) ?? {};
    if (zone.name === 'TJL1') pair.tjl1 = zone;
    else pair.tjl2 = zone;
    pairs.set(zone.tjlPairTime, pair);
  }
  const latestPair = [...pairs.entries()]
    .filter(([, pair]) => pair.tjl1 && pair.tjl2)
    .sort(([firstTime], [secondTime]) => secondTime - firstTime)[0]?.[1];
  return {
    zones: latestPair ? [display(latestPair.tjl1!), display(latestPair.tjl2!)] : [],
    confirmations: [],
  };
}

function priceRangeGap(first: StructureZone, second: StructureZone): number {
  if (priceRangesOverlap(first, second)) return 0;
  return first.top < second.bottom
    ? second.bottom - first.top
    : first.bottom - second.top;
}

/**
 * Extreme A+ is the taught bullish two-TJL2 rule. When two active structural
 * BUY TJL2 areas are no more than 50 pips apart, only the lower area may
 * produce an entry. The higher area remains visible, including its consolidated
 * Internal DB members, but every member of that area is execution-blocked.
 *
 * No bearish mirror is inferred here: the learned rule explicitly selects the
 * lower TJL2 and is therefore intentionally limited to BUY structure.
 */
export function selectExtremeAPlusTjl2Zones(
  zones: readonly StructureZone[],
  pipSize: number,
  maximumGapPips = 50,
): ExtremeAPlusTjl2Selection {
  const extremeZoneIds = new Set<string>();
  const blockedZoneIds = new Set<string>();
  if (!(pipSize > 0) || !(maximumGapPips >= 0)) return { extremeZoneIds, blockedZoneIds };

  const candidates = consolidateZonesForDisplay(zones, pipSize).flatMap((displayZone) => {
    const members = displayZoneMembers(displayZone);
    const tjl2 = members.find((member) => (
      member.category === 'mg'
      && member.name === 'TJL2'
      && member.isBuy
      && member.active
      && member.status === 'valid'
    ));
    return tjl2 ? [{ tjl2, members }] : [];
  });

  const extremeGroups = new Set<number>();
  const blockedGroups = new Set<number>();
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const first = candidates[firstIndex].tjl2;
      const second = candidates[secondIndex].tjl2;
      const gapPips = priceRangeGap(first, second) / pipSize;
      if (gapPips > maximumGapPips) continue;

      const firstMidpoint = (first.bottom + first.top) / 2;
      const secondMidpoint = (second.bottom + second.top) / 2;
      const lowerIndex = firstMidpoint <= secondMidpoint ? firstIndex : secondIndex;
      const higherIndex = lowerIndex === firstIndex ? secondIndex : firstIndex;
      extremeGroups.add(lowerIndex);
      blockedGroups.add(higherIndex);
    }
  }

  for (const groupIndex of blockedGroups) {
    candidates[groupIndex].members.forEach((member) => blockedZoneIds.add(member.id));
  }
  for (const groupIndex of extremeGroups) {
    if (blockedGroups.has(groupIndex)) continue;
    candidates[groupIndex].members.forEach((member) => extremeZoneIds.add(member.id));
  }
  return { extremeZoneIds, blockedZoneIds };
}

/**
 * A CHoCH can expose a standalone DB/DT at the exact pivot that is already
 * represented by a TJL2 + Internal DB/DT confluence. That is one physical
 * setup, not a second independent entry zone.
 */
export function redundantStandaloneLiquidityZoneIds(
  zones: readonly StructureZone[],
  tolerance = ZONE_CONFLUENCE_PRICE_TOLERANCE,
): Set<string> {
  const consolidated = consolidateZonesForDisplay(zones, tolerance);
  const confluenceAnchors = consolidated.flatMap((zone) => {
    const members = displayZoneMembers(zone);
    const tjl2 = members.find((member) => member.name === 'TJL2');
    const internal = members.find((member) => (
      member.name === 'Internal DB' || member.name === 'Internal DT'
    ));
    return tjl2 && internal ? [{ tjl2, internal }] : [];
  });

  return new Set(zones.flatMap((zone) => {
    if (zone.name !== 'DB' && zone.name !== 'DT') return [];
    const expectedInternalName = zone.name === 'DB' ? 'Internal DB' : 'Internal DT';
    const duplicate = confluenceAnchors.some(({ tjl2, internal }) => (
      internal.name === expectedInternalName
      && zone.isBuy === internal.isBuy
      && zone.isBuy === tjl2.isBuy
      && zone.startTime === internal.startTime
      && priceRangesOverlap(zone, internal)
      && priceRangesOverlap(zone, tjl2)
    ));
    return duplicate ? [zone.id] : [];
  }));
}
