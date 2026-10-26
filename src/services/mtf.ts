import {
  detectEngulfingPatternAt,
  isGoldZoneEntryBlocked,
  type EngulfingDirection,
  type EngulfingType,
  type MarketStructureResult,
  type StructureCandle,
  type StructureZone,
} from './marketStructure';
import {
  goldScalpingConfirmationWickPasses,
  goldScalpingZoneWidthPips,
  isGoldScalpingChochZone,
  isGoldScalpingEngulfingType,
} from './goldScalping';
import { isZoneEngulfingFibQualified } from './tradeLevels';

export type MtfGranularity = 'M1' | 'M5' | 'M15' | 'H1' | 'H4' | 'D';
export type MtfConfirmationKind = 'choch' | 'iss';
export type MtfStructureScope = 'external' | 'internal';

export interface MtfTimeframeData {
  candles: StructureCandle[];
  structure: MarketStructureResult;
}

export interface MtfRow {
  higherZone?: StructureZone;
  entryZone?: StructureZone;
  id: string;
  higherTimeframe: MtfGranularity;
  lowerTimeframe: MtfGranularity;
  confirmationKind: MtfConfirmationKind;
  structureScope: MtfStructureScope;
  direction: EngulfingDirection;
  confirmationTime: number;
  confirmationBarsAgo: number;
  higherTimeframeZoneId: string;
  higherTimeframeZone: StructureZone['name'];
  higherTimeframeMajorLiquidity?: boolean;
  higherTimeframeTapTime: number;
  higherTimeframeTapBarsAgo: number;
  tappedZone?: StructureZone['name'];
  tapTime?: number;
  tapBarsAgo?: number;
  engulfingType?: EngulfingType;
  engulfingTime?: number;
  engulfingCandleCount?: number;
  engulfingBarsAgo?: number;
  engulfingDeepDiscount?: boolean;
  engulfingFibBand?: '0.5-0.618' | '0.71-0.79';
  goldScalping?: boolean;
  sourcePairOverlapsHigherZone?: boolean;
  chochSequence?: number;
}

export function mtfChochSequenceLabel(sequence: number): string {
  const lastTwo = sequence % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th'
    : sequence % 10 === 1 ? 'st' : sequence % 10 === 2 ? 'nd'
      : sequence % 10 === 3 ? 'rd' : 'th';
  return `${sequence}${suffix} CHOCH${sequence > 1 ? ' IN SAME ZONE · NO NEW ENTRY' : ''}`;
}

interface MtfMapping {
  higher: MtfGranularity;
  lower: MtfGranularity;
  confirmations: MtfConfirmationKind[];
}

export const MTF_MAPPINGS: MtfMapping[] = [
  { higher: 'M15', lower: 'M1', confirmations: ['choch'] },
  { higher: 'M15', lower: 'M5', confirmations: ['choch'] },
  { higher: 'H1', lower: 'M5', confirmations: ['choch'] },
  { higher: 'H4', lower: 'M15', confirmations: ['choch'] },
  { higher: 'D', lower: 'H1', confirmations: ['choch'] },
];

const GOLD_SCALPING_MTF_MAPPINGS: MtfMapping[] = [
  { higher: 'M15', lower: 'M1', confirmations: ['choch'] },
  { higher: 'H1', lower: 'M1', confirmations: ['choch'] },
];

const GOLD_INTRADAY_MTF_MAPPINGS: MtfMapping[] = [
  { higher: 'H1', lower: 'M5', confirmations: ['choch'] },
  { higher: 'H4', lower: 'M15', confirmations: ['choch'] },
];

const CHOCH_ZONE_NAMES = new Set<StructureZone['name']>(['QML', 'SBR', 'RBS', 'DT', 'DB']);
const CHOCH_SOURCE_ZONE_NAMES = new Set<StructureZone['name']>(['QML', 'SBR', 'RBS']);
const INTERNAL_CHOCH_ZONE_NAMES = new Set<StructureZone['name']>([
  'Internal QML',
  'Internal SBR',
  'Internal RBS',
  'Internal DT',
  'Internal DB',
]);
const INTERNAL_CHOCH_SOURCE_ZONE_NAMES = new Set<StructureZone['name']>([
  'Internal QML',
  'Internal SBR',
  'Internal RBS',
]);

interface ConfirmationEvent {
  kind: MtfConfirmationKind;
  structureScope: MtfStructureScope;
  time: number;
  isBuy: boolean;
  zones: StructureZone[];
  sourceStructureTime?: number;
  fibSourcePrice?: number;
  fibZeroPrice?: number;
}

function zoneWasUsableAt(zone: StructureZone, time: number): boolean {
  const activeFrom = zone.activeFromTime ?? zone.startTime;
  return zone.status !== 'rejected'
    && zone.startTime < time
    && activeFrom <= time
    // endTime limits only the 30-bar drawing. The level remains eligible for
    // MTF context for as long as market structure keeps it active and valid.
    && (zone.confirmationTime === undefined || zone.confirmationTime <= time)
    && (zone.invalidatedAt === undefined || zone.invalidatedAt > time);
}

function candleTouchesZone(candle: StructureCandle, zone: StructureZone): boolean {
  return candle.high >= zone.bottom && candle.low <= zone.top;
}

function latestHigherTimeframeTouch(
  candles: readonly StructureCandle[],
  zones: readonly StructureZone[],
  event: ConfirmationEvent,
  includeOriginOnly = false,
): { zone: StructureZone; time: number; sourcePairOverlaps: boolean } | undefined {
  let latest: { zone: StructureZone; time: number; sourcePairOverlaps: boolean } | undefined;
  for (const zone of zones) {
    if (!zone.active || zone.status !== 'valid' || zone.isBuy !== event.isBuy) continue;
    if ((zone.category === 'supplyDemand' || zone.name === 'SUPPLY' || zone.name === 'DEMAND')
      && !(['structure', 'swing', 'day'] as const).some((source) => (
        isZoneEngulfingFibQualified(zone, source)
      ))) continue;
    // MTF is a location-specific reversal. The exact LTF TJL pair converted by
    // this CHOCH must have formed in/overlapping the tapped HTF zone. Merely
    // finding any same-direction CHOCH after an older HTF tap is not enough.
    // The CHOCH break candle itself may close after price has left the HTF zone.
    const sourcePairIsInZone = event.zones.some((sourceZone) => (
      (event.structureScope === 'internal'
        ? INTERNAL_CHOCH_SOURCE_ZONE_NAMES
        : CHOCH_SOURCE_ZONE_NAMES).has(sourceZone.name)
      && sourceZone.tjlPairTime === event.sourceStructureTime
      && overlaps(sourceZone.bottom, sourceZone.top, zone.bottom, zone.top)
    ));
    const chochOriginIsInZone = event.zones.some((sourceZone) => (
      (sourceZone.name === 'DB' || sourceZone.name === 'DT')
      && overlaps(sourceZone.bottom, sourceZone.top, zone.bottom, zone.top)
    ));
    if (!sourcePairIsInZone && !(includeOriginOnly && chochOriginIsInZone)) continue;
    let insideZone = false;
    let latestTapTime: number | undefined;
    for (const candle of candles) {
      // The candle that confirms the LTF CHOCH can also be the candle that
      // reaches the mapped HTF zone. CHOCH is known only after that candle is
      // complete, so treating its completed range as the HTF tap does not use
      // future information. Candles after the CHOCH still cannot arm it.
      if (candle.time > event.time) break;
      const overlaps = candle.complete !== false
        && zoneWasUsableAt(zone, candle.time)
        && candleTouchesZone(candle, zone);
      // The HTF tap establishes directional context first. The matching LTF
      // structure and CHOCH may form afterward; they do not require a second
      // HTF retap once price has already visited this valid level.
      if (overlaps && !insideZone) {
        latestTapTime = candle.time;
      }
      insideZone = overlaps;
    }
    if (latestTapTime !== undefined && (latest === undefined
      || (sourcePairIsInZone && !latest.sourcePairOverlaps)
      || (sourcePairIsInZone === latest.sourcePairOverlaps && (latestTapTime > latest.time
        || (latestTapTime === latest.time && zone.majorLiquidity === true
          && latest.zone.majorLiquidity !== true))))) {
      latest = { zone, time: latestTapTime, sourcePairOverlaps: sourcePairIsInZone };
    }
  }
  return latest;
}

function buildChochEvents(zones: readonly StructureZone[]): ConfirmationEvent[] {
  const eventKeys = new Set(zones
    .filter((zone) => zone.chochTime !== undefined && (
      (zone.category === 'mg' && CHOCH_ZONE_NAMES.has(zone.name))
      || (zone.category === 'internal' && INTERNAL_CHOCH_ZONE_NAMES.has(zone.name))
    ))
    .map((zone) => `${zone.category}:${zone.chochTime!}`));

  return [...eventKeys].map((key) => {
    const [category, rawTime] = key.split(':');
    const time = Number(rawTime);
    const structureScope: MtfStructureScope = category === 'internal' ? 'internal' : 'external';
    const allowedNames = structureScope === 'internal'
      ? INTERNAL_CHOCH_ZONE_NAMES
      : CHOCH_ZONE_NAMES;
    const eventZones = zones.filter((zone) => zone.category === category
      && zone.chochTime === time
      && allowedNames.has(zone.name));
    const isBuy = eventZones[0]?.isBuy ?? true;
    // A bullish CHOCH converts the preceding selling TJL1/TJL2 into QML/RBS;
    // a bearish CHOCH converts the preceding buying pair into QML/SBR. Their
    // shared pair time is the identity of the exact structure that changed.
    const qmlName: StructureZone['name'] = structureScope === 'internal'
      ? 'Internal QML'
      : 'QML';
    const secondSourceName: StructureZone['name'] = structureScope === 'internal'
      ? (isBuy ? 'Internal RBS' : 'Internal SBR')
      : (isBuy ? 'RBS' : 'SBR');
    const sourceTjl1 = eventZones.find((zone) => zone.name === qmlName
      && zone.tjlPairTime !== undefined);
    const sourceTjl2 = eventZones.find((zone) => zone.name === secondSourceName
      && zone.tjlPairTime !== undefined);
    const hasMatchingSourcePair = sourceTjl1?.tjlPairTime !== undefined
      && sourceTjl1.tjlPairTime === sourceTjl2?.tjlPairTime;
    const anchor = eventZones.find((zone) => (
      structureScope === 'internal'
        ? zone.name === 'Internal DB' || zone.name === 'Internal DT'
        : zone.name === 'DB' || zone.name === 'DT'
    ));
    const fibZone = eventZones.find((zone) => (
      zone.fibSourcePrice !== undefined && zone.fibZeroPrice !== undefined
    ));
    return {
      kind: 'choch' as const,
      structureScope,
      time,
      isBuy,
      zones: eventZones,
      sourceStructureTime: hasMatchingSourcePair ? sourceTjl1.tjlPairTime : undefined,
      fibSourcePrice: fibZone?.fibSourcePrice ?? (anchor?.isBuy ? anchor.bottom : anchor?.top),
      fibZeroPrice: fibZone?.fibZeroPrice,
    };
  }).filter((event) => event.zones.length > 0 && event.sourceStructureTime !== undefined);
}

export function matchMtfChochEvents(
  lowerCandles: readonly StructureCandle[],
  lowerZones: readonly StructureZone[],
  higherZones: readonly StructureZone[],
  includeOriginOnly = false,
) {
  const timesByZone = new Map<string, number[]>();
  return buildChochEvents(lowerZones).sort((first, second) => first.time - second.time)
    .flatMap((event) => {
      const higherTimeframeTouch = latestHigherTimeframeTouch(
        lowerCandles, higherZones, event, includeOriginOnly,
      );
      if (!higherTimeframeTouch) return [];
      // Count the whole loaded history before trimming table/history rows.
      // Retaps and invalidation of the earlier LTF zones never reset this HTF zone.
      const times = timesByZone.get(higherTimeframeTouch.zone.id) ?? [];
      if (!times.includes(event.time)) times.push(event.time);
      timesByZone.set(higherTimeframeTouch.zone.id, times);
      const chochSequence = times.indexOf(event.time) + 1;
      return [{ event, higherTimeframeTouch, chochSequence }];
    });
}

function latestTappedZone(event: ConfirmationEvent): StructureZone | undefined {
  return event.zones
    .filter((zone) => zone.active && zone.status === 'valid'
      && zone.tapTime !== undefined && zone.tapTime >= event.time)
    .sort((first, second) => second.tapTime! - first.tapTime!)[0];
}

function overlaps(firstLow: number, firstHigh: number, secondLow: number, secondHigh: number): boolean {
  return firstLow <= Math.max(secondLow, secondHigh) && firstHigh >= Math.min(secondLow, secondHigh);
}

function fibBandForZone(
  event: ConfirmationEvent,
  zone: StructureZone,
): { range: [number, number]; deepDiscount: boolean } | undefined {
  // CHOCH DB/DT is the originating A+ level in the existing MG Fib model.
  if (event.kind === 'choch' && (
    zone.name === 'DB'
    || zone.name === 'DT'
    || zone.name === 'Internal DB'
    || zone.name === 'Internal DT'
  )) {
    return { range: [zone.bottom, zone.top], deepDiscount: false };
  }
  if (event.fibSourcePrice === undefined || event.fibZeroPrice === undefined
    || event.fibSourcePrice === event.fibZeroPrice) return undefined;
  const level = (ratio: number) => (
    event.fibZeroPrice! + (event.fibSourcePrice! - event.fibZeroPrice!) * ratio
  );
  const bands: Array<{ range: [number, number]; deepDiscount: boolean }> = [
    { range: [level(0.5), level(0.618)], deepDiscount: false },
    { range: [level(0.71), level(0.79)], deepDiscount: true },
  ];
  return bands.find(({ range: [first, second] }) => (
    overlaps(zone.bottom, zone.top, first, second)
  ));
}

function displayMtfFibBand(
  event: ConfirmationEvent,
  zone: StructureZone,
): '0.5-0.618' | '0.71-0.79' | undefined {
  const recordedBand = zone.fibStatus === 'a-plus' ? zone.fibBand : undefined;
  if (recordedBand === '0.5-0.618') return '0.5-0.618';
  if (recordedBand === '0.71-0.79' || recordedBand === 'deep') return '0.71-0.79';
  if (zone.name === 'DB' || zone.name === 'DT'
    || zone.name === 'Internal DB' || zone.name === 'Internal DT') return undefined;
  const mappedBand = fibBandForZone(event, zone);
  return mappedBand ? mappedBand.deepDiscount ? '0.71-0.79' : '0.5-0.618' : undefined;
}

function findMtfEngulfing(
  candles: StructureCandle[],
  event: ConfirmationEvent,
  zone: StructureZone,
  goldScalping = false,
  requireLtfFib = false,
  goldZoneTimeframe?: MtfGranularity,
): { type: EngulfingType; time: number; candleCount: number; deepDiscount: boolean } | undefined {
  if (zone.tapTime === undefined) return undefined;
  const requiredDirection: EngulfingDirection = event.isBuy ? 'bullish' : 'bearish';
  const validFrom = Math.max(event.time, zone.tapTime, zone.activeFromTime ?? zone.startTime);
  const originatingDbDt = zone.name === 'DB' || zone.name === 'DT'
    || zone.name === 'Internal DB' || zone.name === 'Internal DT';
  if (requireLtfFib && !originatingDbDt && (event.fibSourcePrice === undefined
    || event.fibZeroPrice === undefined
    || event.fibSourcePrice === event.fibZeroPrice)) return undefined;
  const zoneMidline = (zone.top + zone.bottom) / 2;
  const midlineTouchTime = event.kind === 'choch'
    ? candles.find((candle) => candle.complete !== false
      && candle.time >= validFrom
      && (zone.invalidatedAt === undefined || candle.time < zone.invalidatedAt)
      && candle.low <= zoneMidline && candle.high >= zoneMidline)?.time
    : validFrom;
  if (midlineTouchTime === undefined) return undefined;
  // Fib qualification and engulfing confirmation are historical facts. The
  // structure engine stores the first qualified pattern on the zone. Prefer
  // that record so a later extension of the CHOCH Fib zero cannot move the
  // bands and retroactively turn a confirmed MTF entry back into "Waiting".
  if (zone.engulfingType !== undefined
    && zone.engulfingTime !== undefined
    && zone.engulfingDirection === requiredDirection
    && (!goldScalping || isGoldScalpingEngulfingType(zone.engulfingType))
    && (!goldScalping || candles.some((candle) => candle.time === zone.engulfingTime
      && goldScalpingConfirmationWickPasses(candle, requiredDirection)))
    && zone.engulfingTime >= validFrom
    && zone.engulfingTime >= midlineTouchTime
    && (!goldZoneTimeframe || !isGoldZoneEntryBlocked(
      zone, candles, goldZoneTimeframe, 0.1, zone.engulfingTime,
    ))
    && (zone.invalidatedAt === undefined || zone.engulfingTime < zone.invalidatedAt)) {
    return {
      type: zone.engulfingType,
      time: zone.engulfingTime,
      candleCount: zone.engulfingCandleCount ?? 2,
      deepDiscount: zone.fibBand === '0.71-0.79' || zone.fibBand === 'deep',
    };
  }

  const fibBand = fibBandForZone(event, zone);
  if (requireLtfFib && !fibBand) return undefined;

  for (let endIndex = 1; endIndex < candles.length; endIndex += 1) {
    const finalCandle = candles[endIndex];
    if (finalCandle.complete === false || finalCandle.time < midlineTouchTime) continue;
    if (zone.invalidatedAt !== undefined && finalCandle.time >= zone.invalidatedAt) break;
    const pattern = detectEngulfingPatternAt(candles, endIndex);
    if (!pattern || pattern.direction !== requiredDirection
      || (goldScalping && (!isGoldScalpingEngulfingType(pattern.type)
        || !goldScalpingConfirmationWickPasses(finalCandle, requiredDirection)))) continue;
    if (goldZoneTimeframe && isGoldZoneEntryBlocked(
      zone, candles, goldZoneTimeframe, 0.1, finalCandle.time,
    )) continue;
    const patternCandles = candles.slice(pattern.startIndex, pattern.endIndex + 1);
    const touchesTappedZone = patternCandles.some((candle) => (
      candle.time >= validFrom
      && candleTouchesZone(candle, zone)
    ));
    const touchesTappedZoneInsideFib = fibBand !== undefined && patternCandles.some((candle) => (
      candle.time >= validFrom
      && candleTouchesZone(candle, zone)
      && overlaps(candle.low, candle.high, fibBand.range[0], fibBand.range[1])
    ));
    if (touchesTappedZone && (!requireLtfFib || touchesTappedZoneInsideFib)) {
      return {
        type: pattern.type,
        time: finalCandle.time,
        candleCount: pattern.candleCount,
        deepDiscount: touchesTappedZoneInsideFib && fibBand?.deepDiscount === true,
      };
    }
  }
  return undefined;
}

function eventToRow(
  mapping: MtfMapping,
  event: ConfirmationEvent,
  lowerCandles: StructureCandle[],
  higherCandles: StructureCandle[],
  higherTimeframeTouch: { zone: StructureZone; time: number; sourcePairOverlaps: boolean },
  goldScalping = false,
  requireLtfFib = false,
  goldZoneRules = false,
  chochSequence?: number,
): MtfRow {
  const entry = !higherTimeframeTouch.sourcePairOverlaps || (chochSequence ?? 1) > 1
    ? undefined : event.zones
    .filter((zone) => zone.status !== 'rejected'
      && zone.tapTime !== undefined && zone.tapTime >= event.time
      && (zone.invalidatedAt === undefined || zone.tapTime < zone.invalidatedAt))
    .map((zone) => ({ zone, engulfing: findMtfEngulfing(
      lowerCandles, event, zone, goldScalping, requireLtfFib,
      goldZoneRules ? mapping.lower : undefined,
    ) }))
    .filter((candidate): candidate is {
      zone: StructureZone;
      engulfing: {
        type: EngulfingType;
        time: number;
        candleCount: number;
        deepDiscount: boolean;
      };
    } => candidate.engulfing !== undefined)
    .sort((first, second) => second.engulfing.time - first.engulfing.time)[0];
  // A valid entry takes precedence over a newer unqualified tap. Without an
  // entry, show the freshest tapped CHOCH/ISS level as the live status.
  const tappedZone = entry?.zone ?? latestTappedZone(event);
  const engulfing = entry?.engulfing;
  const engulfingFibBand = entry ? displayMtfFibBand(event, entry.zone) : undefined;
  const confirmationIndex = lowerCandles.findIndex((candle) => candle.time === event.time);
  const engulfingIndex = engulfing
    ? lowerCandles.findIndex((candle) => candle.time === engulfing.time)
    : -1;
  let higherTimeframeTapIndex = -1;
  for (let index = higherCandles.length - 1; index >= 0; index -= 1) {
    if (higherCandles[index].time <= higherTimeframeTouch.time) {
      higherTimeframeTapIndex = index;
      break;
    }
  }
  return {
    id: `${mapping.higher}-${mapping.lower}-${event.structureScope}-${event.kind}-${event.time}`,
    higherTimeframe: mapping.higher,
    lowerTimeframe: mapping.lower,
    confirmationKind: event.kind,
    structureScope: event.structureScope,
    direction: event.isBuy ? 'bullish' : 'bearish',
    confirmationTime: event.time,
    confirmationBarsAgo: confirmationIndex < 0
      ? 0
      : lowerCandles.length - 1 - confirmationIndex,
    higherTimeframeZoneId: higherTimeframeTouch.zone.id,
    higherTimeframeZone: higherTimeframeTouch.zone.name,
    higherTimeframeMajorLiquidity: higherTimeframeTouch.zone.majorLiquidity === true,
    higherTimeframeTapTime: higherTimeframeTouch.time,
    higherTimeframeTapBarsAgo: higherTimeframeTapIndex < 0
      ? 0
      : higherCandles.length - 1 - higherTimeframeTapIndex,
    tappedZone: tappedZone?.name,
    higherZone: higherTimeframeTouch.zone,
    entryZone: entry?.zone,
    tapTime: tappedZone?.tapTime,
    tapBarsAgo: tappedZone?.lastTapBarsAgo ?? tappedZone?.tapBarsAgo,
    engulfingType: engulfing?.type,
    engulfingTime: engulfing?.time,
    engulfingCandleCount: engulfing?.candleCount,
    engulfingDeepDiscount: engulfing?.deepDiscount,
    engulfingFibBand,
    goldScalping: goldScalping || undefined,
    sourcePairOverlapsHigherZone: higherTimeframeTouch.sourcePairOverlaps,
    chochSequence,
    engulfingBarsAgo: engulfingIndex < 0
      ? undefined
      : lowerCandles.length - 1 - engulfingIndex,
  };
}

/**
 * Builds the compact MTF table. Higher-timeframe zone identity and both Fib
 * checks intentionally remain internal; only the mapped confirmation, tapped
 * lower-timeframe level, and qualified entry are returned for display.
 */
function buildMtfRowsInternal(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
  maximumEventsToInspect: number,
  maximumRowsPerMapping: number,
  goldScalping = false,
  goldIntraday = false,
  requireLtfFib = false,
): MtfRow[] {
  const rows: MtfRow[] = [];
  const mappings = goldScalping ? GOLD_SCALPING_MTF_MAPPINGS
    : goldIntraday ? GOLD_INTRADAY_MTF_MAPPINGS : MTF_MAPPINGS;
  for (const mapping of mappings) {
    const higher = data[mapping.higher];
    const lower = data[mapping.lower];
    if (!higher || !lower) continue;
    const matchedEvents = matchMtfChochEvents(
      lower.candles, lower.structure.zones, higher.structure.zones,
      goldScalping && mapping.higher === 'M15' && mapping.lower === 'M1',
    );

    for (const kind of mapping.confirmations) {
      const candidates = matchedEvents
        .filter(({ event }) => event.kind === kind)
        .sort((first, second) => second.event.time - first.event.time)
        .slice(0, maximumEventsToInspect)
        .filter((item) => !goldScalping || isGoldScalpingChochZone(
          mapping.higher,
          goldScalpingZoneWidthPips(item.higherTimeframeTouch.zone),
        ));
      const selected = candidates.slice(0, maximumRowsPerMapping);
      // Keep the first setup available when a newer, blocked CHOCH is displayed.
      for (const candidate of [...selected]) {
        if ((candidate.chochSequence ?? 1) <= 1) continue;
        const first = matchedEvents.find((item) => item.chochSequence === 1
          && item.higherTimeframeTouch.zone.id === candidate.higherTimeframeTouch.zone.id);
        if (first && !selected.includes(first)) selected.push(first);
      }
      for (const candidate of selected) {
        rows.push(eventToRow(
          mapping,
          candidate.event,
          lower.candles,
          higher.candles,
          candidate.higherTimeframeTouch,
          goldScalping,
          requireLtfFib,
          goldScalping || goldIntraday,
          candidate.chochSequence,
        ));
      }
    }
  }
  return rows.sort((first, second) => second.confirmationTime - first.confirmationTime);
}

export function buildMtfRows(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
  requireLtfFib = false,
): MtfRow[] {
  return buildMtfRowsInternal(data, Number.POSITIVE_INFINITY, 1, false, false, requireLtfFib);
}

export function buildMtfHistoryRows(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
  requireLtfFib = false,
): MtfRow[] {
  // The five mappings contribute up to sixty recent candidates before direct
  // engulfing trades are merged, enough for the combined newest-50 sample
  // while keeping the optional browser-side backfill bounded.
  return buildMtfRowsInternal(data, 12, 12, false, false, requireLtfFib);
}

export function buildGoldScalpingMtfRows(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
  requireLtfFib = false,
): MtfRow[] {
  return buildMtfRowsInternal(data, Number.POSITIVE_INFINITY, 1, true, false, requireLtfFib);
}

export function buildGoldIntradayMtfRows(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
  requireLtfFib = false,
): MtfRow[] {
  return buildMtfRowsInternal(data, Number.POSITIVE_INFINITY, 1, false, true, requireLtfFib);
}

export function buildGoldIntradayMtfHistoryRows(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
  requireLtfFib = false,
): MtfRow[] {
  return buildMtfRowsInternal(data, 12, 12, false, true, requireLtfFib);
}

export function buildGoldScalpingMtfHistoryRows(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
  requireLtfFib = false,
): MtfRow[] {
  return buildMtfRowsInternal(data, 12, 12, true, false, requireLtfFib);
}

/** Recheck a saved chart-generated MTF entry against the current setup rules. */
export function getSavedMtfEntryQualification(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
  entry: {
    id: string;
    signalTime: number;
    direction: EngulfingDirection;
    engulfingType: EngulfingType;
    zoneName: StructureZone['name'];
    goldScalping?: boolean;
    goldIntraday?: boolean;
    requireLtfFib?: boolean;
  },
): { fibBand?: '0.5-0.618' | '0.71-0.79'; context?: MtfRow } | undefined {
  const parts = entry.id.split(':');
  if (parts.length < 4 || parts[0] !== 'MTF' || Number(parts[2]) !== entry.signalTime) {
    return undefined;
  }
  const rowId = parts[1];
  const idParts = rowId.split('-');
  if (idParts.length !== 5 || idParts[3] !== 'choch') return undefined;
  const higherTimeframe = idParts[0] as MtfGranularity;
  const lowerTimeframe = idParts[1] as MtfGranularity;
  const structureScope = idParts[2];
  const confirmationTime = Number(idParts[4]);
  const mappings = entry.goldScalping ? GOLD_SCALPING_MTF_MAPPINGS
    : entry.goldIntraday ? GOLD_INTRADAY_MTF_MAPPINGS : MTF_MAPPINGS;
  if (!Number.isFinite(confirmationTime) || !mappings.some((mapping) => (
    mapping.higher === higherTimeframe && mapping.lower === lowerTimeframe
    && mapping.confirmations.includes('choch')
  ))) return undefined;
  const higher = data[higherTimeframe];
  const lower = data[lowerTimeframe];
  if (!higher || !lower?.candles.some((candle) => candle.time === entry.signalTime
    && candle.complete !== false)) return undefined;
  const matched = matchMtfChochEvents(
    lower.candles, lower.structure.zones, higher.structure.zones.map((zone) => (
      zone.invalidatedAt !== undefined && zone.invalidatedAt > entry.signalTime
        ? { ...zone, active: true, status: 'valid' as const } : zone
    )),
    entry.goldScalping === true && higherTimeframe === 'M15' && lowerTimeframe === 'M1',
  ).find(({ event }) => (
    event.time === confirmationTime
    && event.structureScope === structureScope
    && (event.isBuy ? 'bullish' : 'bearish') === entry.direction
  ));
  if (!matched || matched.chochSequence !== 1
    || !matched.higherTimeframeTouch.sourcePairOverlaps) return undefined;
  const { event, higherTimeframeTouch: higherTouch } = matched;
  if (entry.goldScalping && !isGoldScalpingChochZone(
    higherTimeframe, goldScalpingZoneWidthPips(higherTouch.zone),
  )) return undefined;
  for (const zone of event.zones) {
    if (zone.name !== entry.zoneName || zone.status === 'rejected'
      || zone.tapTime === undefined || zone.tapTime < event.time
      || zone.tapTime > entry.signalTime
      || (zone.invalidatedAt !== undefined && zone.tapTime >= zone.invalidatedAt)) {
      continue;
    }
    const engulfing = findMtfEngulfing(
      lower.candles, event, zone, entry.goldScalping, entry.requireLtfFib,
    );
    if (engulfing?.time === entry.signalTime && engulfing.type === entry.engulfingType) {
      return {
        fibBand: displayMtfFibBand(event, zone),
        context: {
          ...eventToRow(mappings.find(mapping => mapping.higher === higherTimeframe
            && mapping.lower === lowerTimeframe)!, event, lower.candles, higher.candles,
          higherTouch, entry.goldScalping, entry.requireLtfFib,
          entry.goldScalping || entry.goldIntraday, matched.chochSequence),
          entryZone: zone, tappedZone: zone.name,
          engulfingType: engulfing.type, engulfingTime: engulfing.time,
        },
      };
    }
  }
  return undefined;
}

export function isSavedMtfEntryQualified(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
  entry: Parameters<typeof getSavedMtfEntryQualification>[1],
): boolean {
  return getSavedMtfEntryQualification(data, entry) !== undefined;
}
