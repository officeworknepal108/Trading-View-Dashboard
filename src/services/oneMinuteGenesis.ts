import type { StructureCandle, StructureZone } from './marketStructure';

function priceMatches(first: number, second: number): boolean {
  return Math.abs(first - second) <= 0.000_001;
}

function dailySessionIndex(dailyCandles: StructureCandle[], timestamp: number): number {
  for (let index = dailyCandles.length - 1; index >= 0; index -= 1) {
    if (dailyCandles[index].time <= timestamp) return index;
  }
  return -1;
}

/**
 * Mark native M1 QMLs that originate at their broker daily-session extreme.
 * M1 candles, rather than the final D candle OHLC, are used for the extreme so
 * replay never sees future candles from the remainder of that daily session.
 */
export function applyOneMinuteGenesisQml(
  zones: StructureZone[],
  m1Candles: StructureCandle[],
  dailyCandles: StructureCandle[],
): StructureZone[] {
  if (m1Candles.length === 0 || dailyCandles.length === 0) return zones;
  const orderedDaily = [...dailyCandles].sort((first, second) => first.time - second.time);
  const sessionExtremes = new Map<number, { high: number; low: number }>();

  for (const candle of m1Candles) {
    const index = dailySessionIndex(orderedDaily, candle.time);
    if (index < 0) continue;
    const nextStart = orderedDaily[index + 1]?.time ?? Number.POSITIVE_INFINITY;
    if (candle.time >= nextStart) continue;
    const existing = sessionExtremes.get(index);
    sessionExtremes.set(index, existing
      ? { high: Math.max(existing.high, candle.high), low: Math.min(existing.low, candle.low) }
      : { high: candle.high, low: candle.low });
  }

  return zones.map((zone) => {
    if (zone.name !== 'QML' || zone.category !== 'mg') return zone;
    const index = dailySessionIndex(orderedDaily, zone.startTime);
    const extremes = sessionExtremes.get(index);
    if (!extremes) return zone;
    const classification = zone.isBuy
      ? priceMatches(zone.bottom, extremes.low) ? 'day-low' as const : undefined
      : priceMatches(zone.top, extremes.high) ? 'day-high' as const : undefined;
    if (!classification) return zone;
    return { ...zone, oneMinuteGenesisQml: classification };
  });
}

export function executionZoneName(zone: StructureZone): string {
  return zone.oneMinuteGenesisQml ? '1MG QML' : zone.name;
}
