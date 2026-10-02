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
  higherTimeframeTapTime: number;
  higherTimeframeTapBarsAgo: number;
  tappedZone?: StructureZone['name'];
  tapTime?: number;
  tapBarsAgo?: number;
  engulfingType?: EngulfingType;
  engulfingTime?: number;
  engulfingBarsAgo?: number;
}

interface MtfMapping {
  higher: MtfGranularity;
  lower: MtfGranularity;
  confirmations: MtfConfirmationKind[];
}

export const MTF_MAPPINGS: MtfMapping[] = [
  { higher: 'M15', lower: 'M1', confirmations: ['choch'] },
  { higher: 'M15', lower: 'M5', confirmations: ['choch', 'iss'] },
  { higher: 'H1', lower: 'M5', confirmations: ['choch', 'iss'] },
  { higher: 'H4', lower: 'M15', confirmations: ['choch', 'iss'] },
  { higher: 'D', lower: 'H1', confirmations: ['choch', 'iss'] },
];

const CHOCH_ZONE_NAMES = new Set<StructureZone['name']>(['QML', 'SBR', 'RBS', 'DT', 'DB']);
const ISS_ZONE_NAMES = new Set<StructureZone['name']>(['ISS L3', 'ISS L4']);

interface ConfirmationEvent {
  kind: MtfConfirmationKind;
  time: number;
  isBuy: boolean;
  zones: StructureZone[];
  fibSourcePrice?: number;
  fibZeroPrice?: number;
}

function zoneWasUsableAt(zone: StructureZone, time: number): boolean {
  const activeFrom = zone.activeFromTime ?? zone.startTime;
  return zone.status !== 'rejected'
    && zone.startTime < time
    && activeFrom <= time
    // An MTF context must come from a level that is actually present on the
    // HTF chart at the tap. Normal structure validity may remain stored after
    // the fixed 30-bar drawing ends, but that hidden history is not an MTF tap.
    && time <= zone.endTime
    && (zone.confirmationTime === undefined || zone.confirmationTime <= time)
    && (zone.invalidatedAt === undefined || zone.invalidatedAt > time);
}

function candleTouchesZone(candle: StructureCandle, zone: StructureZone): boolean {
  return candle.high >= zone.bottom && candle.low <= zone.top;
}

function latestHigherTimeframeTouch(
  candles: StructureCandle[],
  zones: StructureZone[],
  confirmationTime: number,
  isBuy: boolean,
): { zone: StructureZone; time: number } | undefined {
  let latest: { zone: StructureZone; time: number } | undefined;
  for (const zone of zones) {
    if (!zone.active || zone.status !== 'valid' || zone.isBuy !== isBuy) continue;
    let insideZone = false;
    let latestTapTime: number | undefined;
    for (const candle of candles) {
      if (candle.time > confirmationTime) break;
      const overlaps = candle.complete !== false
        && zoneWasUsableAt(zone, candle.time)
        && candleTouchesZone(candle, zone);
      if (overlaps && !insideZone) latestTapTime = candle.time;
      insideZone = overlaps;
    }
    if (latestTapTime !== undefined && (latest === undefined || latestTapTime > latest.time)) {
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
    const anchor = eventZones.find((zone) => zone.name === 'DB' || zone.name === 'DT');
    const fibZone = eventZones.find((zone) => (
      zone.fibSourcePrice !== undefined && zone.fibZeroPrice !== undefined
    ));
    return {
      kind: 'choch' as const,
      time,
      isBuy: eventZones[0]?.isBuy ?? true,
      zones: eventZones,
      fibSourcePrice: fibZone?.fibSourcePrice ?? (anchor?.isBuy ? anchor.bottom : anchor?.top),
      fibZeroPrice: fibZone?.fibZeroPrice,
    };
  }).filter((event) => event.zones.length > 0);
}

function buildIssEvents(zones: StructureZone[]): ConfirmationEvent[] {
  return zones
    .filter((zone) => zone.name === 'ISS L3'
      && zone.issCompletionTime !== undefined
      && zone.issDirection !== undefined)
    .map((level3) => ({
      kind: 'iss' as const,
      time: level3.issCompletionTime!,
      isBuy: level3.issDirection === 'bullish',
      zones: zones.filter((zone) => zone.category === 'iss'
        && ISS_ZONE_NAMES.has(zone.name)
        && zone.issCompletionTime === level3.issCompletionTime
        && zone.isBuy === level3.isBuy),
      fibSourcePrice: level3.fibSourcePrice ?? level3.issPoint0Price,
      fibZeroPrice: level3.fibZeroPrice ?? level3.issPoint5Price,
    }))
    .filter((event) => event.zones.length > 0);
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
): [number, number] | undefined {
  // CHOCH DB/DT is the originating A+ level in the existing MG Fib model.
  if (event.kind === 'choch' && (zone.name === 'DB' || zone.name === 'DT')) {
    return [zone.bottom, zone.top];
  }
  if (event.fibSourcePrice === undefined || event.fibZeroPrice === undefined
    || event.fibSourcePrice === event.fibZeroPrice) return undefined;
  const level = (ratio: number) => (
    event.fibZeroPrice! + (event.fibSourcePrice! - event.fibZeroPrice!) * ratio
  );
  const bands: Array<[number, number]> = [
    [level(0.5), level(0.618)],
    [level(0.71), level(0.79)],
  ];
  return bands.find(([first, second]) => overlaps(zone.bottom, zone.top, first, second));
}

function findMtfEngulfing(
  candles: StructureCandle[],
  event: ConfirmationEvent,
  zone: StructureZone,
): { type: EngulfingType; time: number } | undefined {
  const fibBand = fibBandForZone(event, zone);
  if (!fibBand || zone.tapTime === undefined) return undefined;
  const requiredDirection: EngulfingDirection = event.isBuy ? 'bullish' : 'bearish';
  const validFrom = Math.max(event.time, zone.tapTime, zone.activeFromTime ?? zone.startTime);

  for (let endIndex = 1; endIndex < candles.length; endIndex += 1) {
    const finalCandle = candles[endIndex];
    if (finalCandle.complete === false || finalCandle.time < validFrom) continue;
    const pattern = detectEngulfingPatternAt(candles, endIndex);
    if (!pattern || pattern.direction !== requiredDirection) continue;
    const patternCandles = candles.slice(pattern.startIndex, pattern.endIndex + 1);
    const touchesTappedZoneInsideFib = patternCandles.some((candle) => (
      candle.time >= validFrom
      && candleTouchesZone(candle, zone)
      && overlaps(candle.low, candle.high, fibBand[0], fibBand[1])
    ));
    if (touchesTappedZoneInsideFib) return { type: pattern.type, time: finalCandle.time };
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
    .filter((zone) => zone.active && zone.status === 'valid'
      && zone.tapTime !== undefined && zone.tapTime >= event.time)
    .map((zone) => ({ zone, engulfing: findMtfEngulfing(lowerCandles, event, zone) }))
    .filter((candidate): candidate is {
      zone: StructureZone;
      engulfing: { type: EngulfingType; time: number };
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
    higherTimeframeTapTime: higherTimeframeTouch.time,
    higherTimeframeTapBarsAgo: higherTimeframeTapIndex < 0
      ? 0
      : higherCandles.length - 1 - higherTimeframeTapIndex,
    tappedZone: tappedZone?.name,
    tapTime: tappedZone?.tapTime,
    tapBarsAgo: tappedZone?.tapBarsAgo,
    engulfingType: engulfing?.type,
    engulfingTime: engulfing?.time,
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
    const allEvents = [
      ...buildChochEvents(lower.structure.zones),
      ...buildIssEvents(lower.structure.zones),
    ];

    for (const kind of mapping.confirmations) {
      const candidate = allEvents
        .filter((event) => event.kind === kind)
        .map((event) => ({
          event,
          higherTimeframeTouch: latestHigherTimeframeTouch(
            lower.candles,
            higher.structure.zones,
            event.time,
            event.isBuy,
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
