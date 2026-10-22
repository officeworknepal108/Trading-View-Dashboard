import {
  detectEngulfingPatternAt,
  isZoneEligibleForEngulfingEntry,
  type EngulfingDirection,
  type StructureCandle,
  type StructureZone,
} from './marketStructure';
import {
  TRADE_PIP_SIZE,
  getDirectTradeRule,
  getMtfTradeRule,
  isZoneEngulfingFibQualified,
  type EngulfingTradeSignal,
  type TradeRule,
  type TradeTimeframe,
} from './tradeLevels';

export type GoldScalpingRoute = 'CANDLE' | 'MTF_CHOCH';

export function goldScalpingZoneWidthPips(zone: Pick<StructureZone, 'top' | 'bottom'>): number {
  return Math.round(Math.abs(zone.top - zone.bottom) / TRADE_PIP_SIZE * 100) / 100;
}

export function isGoldScalpingZone(
  zoneTimeframe: TradeTimeframe,
  widthPips: number,
): boolean {
  return (zoneTimeframe === 'M15' || zoneTimeframe === 'H1')
    && widthPips >= 20 && widthPips <= 100;
}

export function goldScalpingCandleTimeframe(
  zoneTimeframe: TradeTimeframe,
  widthPips: number,
): 'M1' | 'M5' | undefined {
  if (widthPips < 20 || widthPips > 100) return undefined;
  if (zoneTimeframe === 'M15') return widthPips <= 40 ? 'M1' : 'M5';
  if (zoneTimeframe === 'H1' && widthPips <= 40) return 'M5';
  return undefined;
}

export function isGoldScalpingChochZone(
  zoneTimeframe: TradeTimeframe,
  widthPips: number,
): boolean {
  return (zoneTimeframe === 'M15' || zoneTimeframe === 'H1')
    && widthPips > 40 && widthPips <= 100;
}

export function isGoldScalpingEngulfingType(type: string | undefined): boolean {
  return type === 'T1' || type === 'T2' || type === 'T3';
}

export function goldScalpingConfirmationWickPasses(
  candle: StructureCandle,
  direction: EngulfingDirection,
): boolean {
  if (direction === 'bullish') {
    return candle.close > candle.open
      && candle.high - candle.close <= candle.close - candle.open;
  }
  return candle.close < candle.open
    && candle.close - candle.low <= candle.open - candle.close;
}

export function goldScalpingTradeRule(
  zoneTimeframe: TradeTimeframe,
  signalTimeframe: 'M1' | 'M5',
): TradeRule | undefined {
  const base = getMtfTradeRule(zoneTimeframe, signalTimeframe);
  if (!base) return undefined;
  return {
    ...base,
    rewardRisk: 3,
    stopBufferPips: signalTimeframe === 'M1' ? 5 : 8,
    maximumRiskPips: signalTimeframe === 'M1' ? 40 : 80,
  };
}

export function goldScalpingChochTradeRule(
  zoneTimeframe: TradeTimeframe,
  signalTimeframe: TradeTimeframe,
): TradeRule | undefined {
  const base = getMtfTradeRule(zoneTimeframe, signalTimeframe);
  return base ? {
    ...base,
    rewardRisk: 3,
    stopBufferPips: 5,
    maximumRiskPips: 40,
  } : undefined;
}

export function isGoldIntradayCandleRoute(
  zoneTimeframe: TradeTimeframe,
  signalTimeframe: TradeTimeframe,
): boolean {
  return (zoneTimeframe === 'M15' || zoneTimeframe === 'H1')
    && (signalTimeframe === 'M15' || signalTimeframe === 'M30');
}

export function isGoldIntradayMtfRoute(
  zoneTimeframe: TradeTimeframe,
  signalTimeframe: TradeTimeframe,
): boolean {
  return (zoneTimeframe === 'H1' && signalTimeframe === 'M5')
    || (zoneTimeframe === 'H4' && signalTimeframe === 'M15');
}

export function goldIntradayMtfTradeRule(
  zoneTimeframe: TradeTimeframe,
  signalTimeframe: TradeTimeframe,
): TradeRule | undefined {
  if (!isGoldIntradayMtfRoute(zoneTimeframe, signalTimeframe)) return undefined;
  const base = getMtfTradeRule(zoneTimeframe, signalTimeframe);
  if (!base) return undefined;
  return {
    ...base,
    rewardRisk: zoneTimeframe === 'H4' ? 5 : 3,
    stopBufferPips: zoneTimeframe === 'H4' ? 20 : 8,
    maximumRiskPips: zoneTimeframe === 'H4' ? 200 : 80,
  };
}

/** Use the same route policy when a chart trade becomes accuracy/journal history. */
export function isGoldTradeRecordRoute(record: {
  source: string;
  tradeStyle?: string;
  zoneTimeframe: TradeTimeframe;
  signalTimeframe: TradeTimeframe;
  rewardRisk: number;
  fibSource?: string;
}, requireLtfFib = false): boolean {
  if (record.tradeStyle === 'SCALPING') {
    return record.rewardRisk === 3 && (
      (record.source === 'MTF' && record.signalTimeframe === 'M1'
        && (!requireLtfFib || record.fibSource === 'MTF FIB')
        && (record.zoneTimeframe === 'M15' || record.zoneTimeframe === 'H1'))
      || (record.source === 'ENGULFING'
        && ((record.zoneTimeframe === 'M15'
          && (record.signalTimeframe === 'M1' || record.signalTimeframe === 'M5'))
          || (record.zoneTimeframe === 'H1' && record.signalTimeframe === 'M5')))
    );
  }
  const rule = record.source === 'ENGULFING'
    ? getDirectTradeRule(record.zoneTimeframe, record.signalTimeframe)
    : goldIntradayMtfTradeRule(record.zoneTimeframe, record.signalTimeframe);
  return rule !== undefined && record.rewardRisk === rule.rewardRisk
    && (record.source !== 'ENGULFING'
      || isGoldIntradayCandleRoute(record.zoneTimeframe, record.signalTimeframe));
}

export function findGoldScalpingCandleSignal(
  zone: StructureZone,
  zoneTimeframe: TradeTimeframe,
  candles: StructureCandle[],
): EngulfingTradeSignal | undefined {
  if (!isZoneEligibleForEngulfingEntry(zone)) return undefined;
  if (!(['structure', 'swing', 'day'] as const).some((source) => (
    isZoneEngulfingFibQualified(zone, source)
  ))) return undefined;
  return findGoldScalpingReversalSignal(zone, zoneTimeframe, candles);
}

/** Recheck a historical scalp without requiring its source zone to remain active now. */
export function findGoldScalpingReversalSignal(
  zone: StructureZone,
  zoneTimeframe: TradeTimeframe,
  candles: StructureCandle[],
): EngulfingTradeSignal | undefined {
  const signalTimeframe = goldScalpingCandleTimeframe(
    zoneTimeframe,
    goldScalpingZoneWidthPips(zone),
  );
  if (!signalTimeframe) return undefined;
  const validFrom = Math.max(
    zone.startTime,
    zone.activeFromTime ?? zone.startTime,
    zone.confirmationTime ?? zone.startTime,
  );
  const midline = (zone.top + zone.bottom) / 2;
  const requiredDirection = zone.isBuy ? 'bullish' : 'bearish';
  let midlineTouched = false;
  let reversalExtreme = zone.isBuy ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (let endIndex = 0; endIndex < candles.length; endIndex += 1) {
    const candle = candles[endIndex];
    if (candle.complete === false || candle.time < validFrom) continue;
    if (candle.low <= midline && candle.high >= midline) midlineTouched = true;
    if (!midlineTouched) continue;
    reversalExtreme = zone.isBuy
      ? Math.min(reversalExtreme, candle.low)
      : Math.max(reversalExtreme, candle.high);
    const pattern = detectEngulfingPatternAt(candles, endIndex);
    if (!pattern || pattern.direction !== requiredDirection
      || !isGoldScalpingEngulfingType(pattern.type)
      || !goldScalpingConfirmationWickPasses(candle, pattern.direction)) continue;
    // The HTF midline starts the search. Its wick can extend beyond the zone
    // on the lower timeframe, so only the pattern at the reversal extreme
    // qualifies; a later engulfing back inside the zone does not.
    const patternAtReversal = candles.slice(pattern.startIndex, pattern.endIndex + 1)
      .some((item) => item.time >= validFrom && (zone.isBuy
        ? item.low <= reversalExtreme : item.high >= reversalExtreme));
    if (!patternAtReversal) continue;
    return {
      type: pattern.type,
      direction: pattern.direction,
      time: candle.time,
      candleCount: pattern.candleCount,
      timeframe: signalTimeframe,
    };
  }
  return undefined;
}

/** Keep saved scalp arrows only when the loaded candles still confirm that reversal. */
export function savedGoldScalpMatchesReversal(
  record: {
    id: string;
    source: string;
    tradeStyle?: string;
    zoneTimeframe: TradeTimeframe;
    signalAt?: number;
    engulfingType: string;
  },
  sourceZones: readonly StructureZone[] | undefined,
  signalCandles: readonly StructureCandle[] | undefined,
): boolean {
  const prefix = `GOLD_SCALP:${record.zoneTimeframe}:`;
  if (record.tradeStyle !== 'SCALPING' || record.source !== 'ENGULFING'
    || !record.id.startsWith(prefix) || record.signalAt === undefined) return true;
  if (!sourceZones || !signalCandles?.some((candle) => candle.time === record.signalAt)) return true;
  const signalPosition = record.id.lastIndexOf(`:${record.signalAt}:`);
  if (signalPosition <= prefix.length) return false;
  const zoneId = record.id.slice(prefix.length, signalPosition);
  const zone = sourceZones.find((candidate) => candidate.id === zoneId);
  if (!zone) return false;
  const signal = findGoldScalpingReversalSignal(
    zone.invalidatedAt !== undefined && zone.invalidatedAt > record.signalAt
      ? { ...zone, active: true, status: 'valid' } : zone, record.zoneTimeframe,
    signalCandles.filter((candle) => candle.time <= record.signalAt!),
  );
  return signal?.time === record.signalAt && signal.type === record.engulfingType;
}
