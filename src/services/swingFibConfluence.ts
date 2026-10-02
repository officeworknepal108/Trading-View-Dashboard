import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import {
  detectEngulfingPatternAt,
  type EngulfingDirection,
  type FibBand,
  type StructureCandle,
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
 * Applies the active 4H Swing FIB to lower-timeframe zones. Both golden bands
 * are valid, but only zones matching the swing direction qualify. Engulfing
 * can form anywhere inside the qualifying band; touching the exact 0.5 line
 * is not required.
 */
export function applySwingFibConfluence(
  candles: StructureCandle[],
  zones: StructureZone[],
  move: SwingFibMove | undefined,
  type4MaxCandles = 10,
): SwingFibConfluenceResult {
  const nextZones = zones.map(clearSwingConfluence);
  if (!move || move.sourcePrice === move.zeroPrice) {
    return { zones: nextZones, engulfingMarkers: [] };
  }

  const level = (ratio: number) => (
    move.zeroPrice + (move.sourcePrice - move.zeroPrice) * ratio
  );
  const primary = [level(0.5), level(0.618)] as const;
  const deep = [level(0.71), level(0.79)] as const;
  const requiredDirection: EngulfingDirection = move.direction === 'up' ? 'bullish' : 'bearish';
  const requiredIsBuy = move.direction === 'up';
  const markerKeys = new Set<string>();
  const engulfingMarkers: SeriesMarker<UTCTimestamp>[] = [];

  for (const zone of nextZones) {
    if (!zone.active || zone.status !== 'valid' || zone.isBuy !== requiredIsBuy) continue;
    const band: SwingFibBand | undefined = overlaps(zone.bottom, zone.top, ...primary)
      ? '0.5-0.618'
      : overlaps(zone.bottom, zone.top, ...deep) ? '0.71-0.79' : undefined;
    if (!band) continue;

    zone.swingFibBand = band;
    zone.swingFibStatus = 'a-plus';
    const [bandFirst, bandSecond] = band === '0.5-0.618' ? primary : deep;
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
      if (!overlaps(finalCandle.low, finalCandle.high, bandFirst, bandSecond)) continue;
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
