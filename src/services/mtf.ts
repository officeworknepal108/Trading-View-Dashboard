import {
  detectEngulfingPatternAt,
  type EngulfingDirection,
  type EngulfingType,
  type MarketStructureResult,
  type StructureCandle,
  type StructureZone,
} from './marketStructure';

export type MtfGranularity = 'M1' | 'M5' | 'M15' | 'H1' | 'H4' | 'D';
export type MtfConfirmationKind = 'choch' | 'iss';

export interface MtfTimeframeData {
  candles: StructureCandle[];
  structure: MarketStructureResult;
}

export interface MtfRow {
  id: string;
  higherTimeframe: MtfGranularity;
  lowerTimeframe: MtfGranularity;
  confirmationKind: MtfConfirmationKind;
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

const CHOCH_ZONE_NAMES = new Set<StructureZone['name']>(['QML', 'SBR', 'RBS', 'DT', 'DB']);
const CHOCH_SOURCE_ZONE_NAMES = new Set<StructureZone['name']>(['QML', 'SBR', 'RBS']);

interface ConfirmationEvent {
  kind: MtfConfirmationKind;
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
  candles: StructureCandle[],
  zones: StructureZone[],
  event: ConfirmationEvent,
): { zone: StructureZone; time: number } | undefined {
  let latest: { zone: StructureZone; time: number } | undefined;
  for (const zone of zones) {
    if (!zone.active || zone.status !== 'valid' || zone.isBuy !== event.isBuy) continue;
    // MTF is a location-specific reversal. The exact LTF TJL pair converted by
    // this CHOCH must have formed in/overlapping the tapped HTF zone. Merely
    // finding any same-direction CHOCH after an older HTF tap is not enough.
    // The CHOCH break candle itself may close after price has left the HTF zone.
    const sourcePairIsInZone = event.zones.some((sourceZone) => (
      CHOCH_SOURCE_ZONE_NAMES.has(sourceZone.name)
      && sourceZone.tjlPairTime === event.sourceStructureTime
      && overlaps(sourceZone.bottom, sourceZone.top, zone.bottom, zone.top)
    ));
    if (!sourcePairIsInZone) continue;
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
    if (latestTapTime !== undefined && (latest === undefined || latestTapTime > latest.time
      || (latestTapTime === latest.time && zone.majorLiquidity === true
        && latest.zone.majorLiquidity !== true))) {
      latest = { zone, time: latestTapTime };
    }
  }
  return latest;
}

function buildChochEvents(zones: StructureZone[]): ConfirmationEvent[] {
  const eventTimes = new Set(zones
    .filter((zone) => zone.category === 'mg'
      && zone.chochTime !== undefined
      && CHOCH_ZONE_NAMES.has(zone.name))
    .map((zone) => zone.chochTime!));

  return [...eventTimes].map((time) => {
    const eventZones = zones.filter((zone) => zone.category === 'mg'
      && zone.chochTime === time
      && CHOCH_ZONE_NAMES.has(zone.name));
    const isBuy = eventZones[0]?.isBuy ?? true;
    // A bullish CHOCH converts the preceding selling TJL1/TJL2 into QML/RBS;
    // a bearish CHOCH converts the preceding buying pair into QML/SBR. Their
    // shared pair time is the identity of the exact structure that changed.
    const sourceTjl1 = eventZones.find((zone) => zone.name === 'QML'
      && zone.tjlPairTime !== undefined);
    const sourceTjl2 = eventZones.find((zone) => zone.name === (isBuy ? 'RBS' : 'SBR')
      && zone.tjlPairTime !== undefined);
    const hasMatchingSourcePair = sourceTjl1?.tjlPairTime !== undefined
      && sourceTjl1.tjlPairTime === sourceTjl2?.tjlPairTime;
    const anchor = eventZones.find((zone) => zone.name === 'DB' || zone.name === 'DT');
    const fibZone = eventZones.find((zone) => (
      zone.fibSourcePrice !== undefined && zone.fibZeroPrice !== undefined
    ));
    return {
      kind: 'choch' as const,
      time,
      isBuy,
      zones: eventZones,
      sourceStructureTime: hasMatchingSourcePair ? sourceTjl1.tjlPairTime : undefined,
      fibSourcePrice: fibZone?.fibSourcePrice ?? (anchor?.isBuy ? anchor.bottom : anchor?.top),
      fibZeroPrice: fibZone?.fibZeroPrice,
    };
  }).filter((event) => event.zones.length > 0 && event.sourceStructureTime !== undefined);
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
  if (event.kind === 'choch' && (zone.name === 'DB' || zone.name === 'DT')) {
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

function findMtfEngulfing(
  candles: StructureCandle[],
  event: ConfirmationEvent,
  zone: StructureZone,
): { type: EngulfingType; time: number; candleCount: number; deepDiscount: boolean } | undefined {
  if (zone.tapTime === undefined) return undefined;
  const requiredDirection: EngulfingDirection = event.isBuy ? 'bullish' : 'bearish';
  const validFrom = Math.max(event.time, zone.tapTime, zone.activeFromTime ?? zone.startTime);
  // Fib qualification and engulfing confirmation are historical facts. The
  // structure engine stores the first qualified pattern on the zone. Prefer
  // that record so a later extension of the CHOCH Fib zero cannot move the
  // bands and retroactively turn a confirmed MTF entry back into "Waiting".
  if (zone.engulfingType !== undefined
    && zone.engulfingTime !== undefined
    && zone.engulfingDirection === requiredDirection
    && zone.engulfingTime >= validFrom
    && (zone.invalidatedAt === undefined || zone.engulfingTime < zone.invalidatedAt)) {
    return {
      type: zone.engulfingType,
      time: zone.engulfingTime,
      candleCount: zone.engulfingCandleCount ?? 2,
      deepDiscount: zone.fibBand === '0.71-0.79' || zone.fibBand === 'deep',
    };
  }

  const fibBand = fibBandForZone(event, zone);
  if (!fibBand) return undefined;

  for (let endIndex = 1; endIndex < candles.length; endIndex += 1) {
    const finalCandle = candles[endIndex];
    if (finalCandle.complete === false || finalCandle.time < validFrom) continue;
    if (zone.invalidatedAt !== undefined && finalCandle.time >= zone.invalidatedAt) break;
    const pattern = detectEngulfingPatternAt(candles, endIndex);
    if (!pattern || pattern.direction !== requiredDirection) continue;
    const patternCandles = candles.slice(pattern.startIndex, pattern.endIndex + 1);
    const touchesTappedZoneInsideFib = patternCandles.some((candle) => (
      candle.time >= validFrom
      && candleTouchesZone(candle, zone)
      && overlaps(candle.low, candle.high, fibBand.range[0], fibBand.range[1])
    ));
    if (touchesTappedZoneInsideFib) {
      return {
        type: pattern.type,
        time: finalCandle.time,
        candleCount: pattern.candleCount,
        deepDiscount: fibBand.deepDiscount,
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
  higherTimeframeTouch: { zone: StructureZone; time: number },
): MtfRow {
  const entry = event.zones
    .filter((zone) => zone.status !== 'rejected'
      && zone.tapTime !== undefined && zone.tapTime >= event.time
      && (zone.invalidatedAt === undefined || zone.tapTime < zone.invalidatedAt))
    .map((zone) => ({ zone, engulfing: findMtfEngulfing(lowerCandles, event, zone) }))
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
    id: `${mapping.higher}-${mapping.lower}-${event.kind}-${event.time}`,
    higherTimeframe: mapping.higher,
    lowerTimeframe: mapping.lower,
    confirmationKind: event.kind,
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
    tapTime: tappedZone?.tapTime,
    tapBarsAgo: tappedZone?.tapBarsAgo,
    engulfingType: engulfing?.type,
    engulfingTime: engulfing?.time,
    engulfingCandleCount: engulfing?.candleCount,
    engulfingDeepDiscount: engulfing?.deepDiscount,
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
export function buildMtfRows(
  data: Partial<Record<MtfGranularity, MtfTimeframeData>>,
): MtfRow[] {
  const rows: MtfRow[] = [];
  for (const mapping of MTF_MAPPINGS) {
    const higher = data[mapping.higher];
    const lower = data[mapping.lower];
    if (!higher || !lower) continue;
    const allEvents = buildChochEvents(lower.structure.zones);

    for (const kind of mapping.confirmations) {
      const candidate = allEvents
        .filter((event) => event.kind === kind)
        .map((event) => ({
          event,
          higherTimeframeTouch: latestHigherTimeframeTouch(
            lower.candles,
            higher.structure.zones,
            event,
          ),
        }))
        .filter((item): item is {
          event: ConfirmationEvent;
          higherTimeframeTouch: { zone: StructureZone; time: number };
        } => item.higherTimeframeTouch !== undefined)
        .sort((first, second) => second.event.time - first.event.time)[0];
      if (candidate) rows.push(eventToRow(
        mapping,
        candidate.event,
        lower.candles,
        higher.candles,
        candidate.higherTimeframeTouch,
      ));
    }
  }
  return rows.sort((first, second) => second.confirmationTime - first.confirmationTime);
}
