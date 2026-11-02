import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import {
  detectEngulfingPatternAt,
  type EngulfingDirection,
  type FibBand,
  type StructureCandle,
  type StructureLine,
  type StructureZone,
} from './marketStructure';
import type { SwingFibMove } from './swingFib';

export type SwingFibBand = Extract<FibBand, '0.5-0.618' | '0.71-0.79'>;

export interface SwingFibConfluenceResult {
  zones: StructureZone[];
  engulfingMarkers: SeriesMarker<UTCTimestamp>[];
}

function overlaps(bottom: number, top: number, first: number, second: number): boolean {
  return bottom <= Math.max(first, second) && top >= Math.min(first, second);
}

function clearSwingConfluence(zone: StructureZone): StructureZone {
  return {
    ...zone,
    swingFibBand: undefined,
    swingFibStatus: undefined,
    swingEngulfingType: undefined,
    swingEngulfingDirection: undefined,
    swingEngulfingTime: undefined,
    swingEngulfingCandleCount: undefined,
  };
}

/**
 * Applies the active 4H Swing FIB to external and internal lower-timeframe
 * structure zones. Both golden bands of the latest move are valid. Once an
 * opposite move activates, the previous move remains eligible only in its
 * 0.5-0.618 band. In every case, the zone must match the move direction.
 */
export function applySwingFibConfluence(
  candles: StructureCandle[],
  zones: StructureZone[],
  moveOrMoves: SwingFibMove | SwingFibMove[] | undefined,
  type4MaxCandles = 10,
): SwingFibConfluenceResult {
  const nextZones = zones.map(clearSwingConfluence);
  const moves = (Array.isArray(moveOrMoves)
    ? moveOrMoves
    : moveOrMoves ? [moveOrMoves] : [])
    .filter((move) => move.sourcePrice !== move.zeroPrice)
    .slice(-2);
  if (moves.length === 0) {
    return { zones: nextZones, engulfingMarkers: [] };
  }
  const contexts = [...moves].reverse().map((move, index) => {
    const level = (ratio: number) => (
      move.zeroPrice + (move.sourcePrice - move.zeroPrice) * ratio
    );
    return {
      move,
      primary: [level(0.5), level(0.618)] as const,
      deep: [level(0.71), level(0.79)] as const,
      allowDeep: index === 0,
      requiredDirection: (move.direction === 'up' ? 'bullish' : 'bearish') as EngulfingDirection,
      requiredIsBuy: move.direction === 'up',
    };
  });
  const markerKeys = new Set<string>();
  const engulfingMarkers: SeriesMarker<UTCTimestamp>[] = [];

  for (const zone of nextZones) {
    if (!zone.active || zone.status !== 'valid') continue;
    const match = contexts.flatMap((context) => {
      if (zone.isBuy !== context.requiredIsBuy) return [];
      const band: SwingFibBand | undefined = overlaps(zone.bottom, zone.top, ...context.primary)
        ? '0.5-0.618'
        : context.allowDeep && overlaps(zone.bottom, zone.top, ...context.deep)
          ? '0.71-0.79'
          : undefined;
      return band ? [{ ...context, band }] : [];
    })[0];
    if (!match) continue;
    const { band, move, requiredDirection } = match;

    zone.swingFibBand = band;
    zone.swingFibStatus = 'a-plus';
    const validFrom = Math.max(
      move.zeroTime,
      zone.startTime,
      zone.activeFromTime ?? zone.startTime,
      zone.confirmationTime ?? zone.startTime,
    );

    for (let endIndex = 1; endIndex < candles.length; endIndex += 1) {
      const finalCandle = candles[endIndex];
      if (finalCandle.complete === false || finalCandle.time < validFrom) continue;
      const pattern = detectEngulfingPatternAt(candles, endIndex, type4MaxCandles);
      if (!pattern || pattern.direction !== requiredDirection) continue;
      const touchesZone = candles
        .slice(pattern.startIndex, pattern.endIndex + 1)
        .some((candle) => (
          candle.time > zone.startTime
          && candle.time >= validFrom
          && candle.high >= zone.bottom
          && candle.low <= zone.top
        ));
      if (!touchesZone) continue;

      zone.swingEngulfingType = pattern.type;
      zone.swingEngulfingDirection = pattern.direction;
      zone.swingEngulfingTime = finalCandle.time;
      zone.swingEngulfingCandleCount = pattern.candleCount;
      const markerKey = `${pattern.direction}:${pattern.type}:${finalCandle.time}`;
      if (!markerKeys.has(markerKey)) {
        markerKeys.add(markerKey);
        const bullish = pattern.direction === 'bullish';
        engulfingMarkers.push({
          time: finalCandle.time as UTCTimestamp,
          position: bullish ? 'belowBar' : 'aboveBar',
          color: bullish ? '#7c3aed' : '#c026d3',
          shape: bullish ? 'arrowUp' : 'arrowDown',
          text: `SW ${bullish ? 'B' : 'S'} ${pattern.type}`,
          size: 0.7,
        });
      }
      break;
    }
  }

  return {
    zones: nextZones,
    engulfingMarkers: engulfingMarkers.sort((a, b) => Number(a.time) - Number(b.time)).slice(-120),
  };
}

/** Adds an independent H1 swing route only to pre-existing M15 TJL1/TJL2
 * zones after the opposite M15 CHoCH. The 4H fields are left untouched. */
export function applyPostChochH1SwingFibConfluence(
  candles: StructureCandle[],
  zones: StructureZone[],
  lines: StructureLine[],
  moves: SwingFibMove[],
  type4MaxCandles = 10,
): StructureZone[] {
  const nextZones = zones.map((zone) => ({
    ...zone,
    h1SwingFibBand: undefined,
    h1SwingFibStatus: undefined,
    h1SwingSourcePrice: undefined,
    h1SwingZeroPrice: undefined,
    h1SwingEngulfingType: undefined,
    h1SwingEngulfingDirection: undefined,
    h1SwingEngulfingTime: undefined,
    h1SwingEngulfingCandleCount: undefined,
  }));
  const latestCandle = candles[candles.length - 1];
  const choch = lines.filter((line) => line.type === 'choch' && line.label === 'CHoCH'
    && line.toTime < (latestCandle?.time ?? 0))
    .sort((first, second) => first.toTime - second.toTime).at(-1);
  if (!choch || moves.length === 0) return nextZones;
  const contexts = [...moves].slice(-2).reverse().map((move) => {
    const level = (ratio: number) => move.zeroPrice + (move.sourcePrice - move.zeroPrice) * ratio;
    return {
      move,
      primary: [level(0.5), level(0.618)] as const,
      deep: [level(0.71), level(0.79)] as const,
      // The post-CHoCH M15 setup can revisit either band of the prior H1 swing.
      allowDeep: true,
    };
  });
  for (const zone of nextZones) {
    if ((zone.name !== 'TJL1' && zone.name !== 'TJL2') || zone.category !== 'mg'
      || !zone.active || zone.status !== 'valid' || zone.startTime >= choch.toTime
      || zone.isBuy === (choch.direction === 'bullish')) continue;
    const match = contexts.flatMap((context) => {
      if (zone.isBuy !== (context.move.direction === 'up')) return [];
      const band: SwingFibBand | undefined = overlaps(zone.bottom, zone.top, ...context.primary)
        ? '0.5-0.618'
        : context.allowDeep && overlaps(zone.bottom, zone.top, ...context.deep)
          ? '0.71-0.79' : undefined;
      return band ? [{ ...context, band }] : [];
    })[0];
    if (!match) continue;
    const { band, move } = match;
    zone.h1SwingFibBand = band;
    zone.h1SwingFibStatus = 'aligned';
    zone.h1SwingSourcePrice = move.sourcePrice;
    zone.h1SwingZeroPrice = move.zeroPrice;
    const validFrom = Math.max(
      choch.toTime + 900,
      move.zeroTime + 3600,
      zone.activeFromTime ?? zone.startTime,
      zone.confirmationTime ?? zone.startTime,
    );
    const startIndex = candles.findIndex((candle) => candle.time >= validFrom);
    if (startIndex < 0) continue;
    for (let endIndex = Math.max(1, startIndex); endIndex < candles.length; endIndex += 1) {
      const candle = candles[endIndex];
      if (candle.complete === false || candle.time < validFrom) continue;
      const pattern = detectEngulfingPatternAt(candles, endIndex, type4MaxCandles);
      if (!pattern || pattern.direction !== (zone.isBuy ? 'bullish' : 'bearish')) continue;
      const touchesZone = candles.slice(pattern.startIndex, pattern.endIndex + 1)
        .some((item) => item.time >= validFrom && item.time > zone.startTime
          && item.high >= zone.bottom && item.low <= zone.top);
      if (!touchesZone) continue;
      zone.h1SwingEngulfingType = pattern.type;
      zone.h1SwingEngulfingDirection = pattern.direction;
      zone.h1SwingEngulfingTime = candle.time;
      zone.h1SwingEngulfingCandleCount = pattern.candleCount;
      break;
    }
  }
  return nextZones;
}
