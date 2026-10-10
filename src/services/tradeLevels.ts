import type {
  EngulfingDirection,
  EngulfingType,
  StructureCandle,
  StructureZone,
} from './marketStructure';
import {
  evaluateScalpingLogic,
  type ScalpingDecision,
} from './scalpingLogic';
import {
  evaluateIntradayLogic,
  type IntradayDecision,
} from './intradayLogic';

export type TradeTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D';
export type TradeStatus = 'pending' | 'active' | 'risk-free' | 'tp-hit' | 'sl-hit';
export type TradeResult = 'sl' | 'rf' | 'tp';

export function calculateHalfAtOneRResult(result: TradeResult, rewardRisk: number): number {
  if (result === 'sl') return -1;
  if (result === 'rf') return 0;
  return (1 + rewardRisk) / 2;
}

export interface TradeRule {
  zoneTimeframe: TradeTimeframe;
  engulfingTimeframe: TradeTimeframe;
  rewardRisk: number;
  stopBufferPips: number;
  maximumRiskPips: number;
}

export interface EngulfingTradeSignal {
  type: EngulfingType;
  direction: EngulfingDirection;
  time: number;
  candleCount: number;
  timeframe: TradeTimeframe;
}

export type MarketTrend = 'bullish' | 'bearish' | 'neutral';

export interface EngulfingVolumeAssessment {
  applicable: boolean;
  passes: boolean;
  bestQuality: boolean;
  firstVolume?: number;
  secondVolume?: number;
  thirdVolume?: number;
}

export type EngulfingVolumeStatus = 'not-applicable' | 'unavailable' | 'failed' | 'valid' | 'best';

export interface DirectEntryPolicyDecision {
  allowed: boolean;
  reason: 'unchanged' | 'volume-confirmed' | 'volume-failed'
    | 'volume-unavailable' | 'volume-not-applicable'
    | 'scalping-confirmed' | 'scalping-bias-neutral' | 'scalping-bias-mismatch'
    | 'intraday-confirmed' | 'intraday-bias-neutral' | 'intraday-bias-mismatch';
  rule?: TradeRule;
  volume: EngulfingVolumeAssessment;
  scalping?: ScalpingDecision;
  intraday?: IntradayDecision;
}

export interface OpenPositionDirection {
  direction: 'BUY' | 'SELL';
}

export interface TradeLevels {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskFree: number;
  riskPips: number;
  rewardRisk: number;
  status: TradeStatus;
  pendingAtCreation: boolean;
  calculatedAt: number;
  filledAt?: number;
  result?: TradeResult;
  resolvedAt?: number;
  signal: EngulfingTradeSignal;
}

export const TRADE_PIP_SIZE = 0.1;

function validVolume(candle: StructureCandle | undefined): number | undefined {
  return candle && Number.isFinite(candle.volume) && candle.volume! >= 0
    ? candle.volume
    : undefined;
}

/**
 * Evaluate only the agreed engulfing-volume relationships.
 * T1: V2 < V1.
 * T2/T3: V3 < V2; best quality additionally requires V3 < V1.
 * T4 is intentionally outside this rule.
 */
export function assessEngulfingVolumeLogic(
  candles: StructureCandle[],
  signal: EngulfingTradeSignal,
): EngulfingVolumeAssessment {
  if (!['T1', 'T2', 'T3'].includes(signal.type)) {
    return { applicable: false, passes: false, bestQuality: false };
  }

  const endIndex = candles.findIndex((candle) => candle.time === signal.time);
  if (endIndex < 0) return { applicable: true, passes: false, bestQuality: false };

  if (signal.type === 'T1') {
    const firstVolume = validVolume(candles[endIndex - 1]);
    const secondVolume = validVolume(candles[endIndex]);
    const passes = firstVolume !== undefined
      && secondVolume !== undefined
      && secondVolume < firstVolume;
    return {
      applicable: true,
      passes,
      bestQuality: false,
      firstVolume,
      secondVolume,
    };
  }

  const firstVolume = validVolume(candles[endIndex - 2]);
  const secondVolume = validVolume(candles[endIndex - 1]);
  const thirdVolume = validVolume(candles[endIndex]);
  const passes = secondVolume !== undefined
    && thirdVolume !== undefined
    && thirdVolume < secondVolume;
  return {
    applicable: true,
    passes,
    bestQuality: passes
      && firstVolume !== undefined
      && thirdVolume !== undefined
      && thirdVolume < firstVolume,
    firstVolume,
    secondVolume,
    thirdVolume,
  };
}

export function getEngulfingVolumeStatus(
  assessment: EngulfingVolumeAssessment,
  type: EngulfingType,
): EngulfingVolumeStatus {
  if (!assessment.applicable) return 'not-applicable';
  const requiredVolumesAvailable = type === 'T1'
    ? assessment.firstVolume !== undefined && assessment.secondVolume !== undefined
    : assessment.secondVolume !== undefined && assessment.thirdVolume !== undefined;
  if (!requiredVolumesAvailable) return 'unavailable';
  if (assessment.bestQuality) return 'best';
  return assessment.passes ? 'valid' : 'failed';
}

/**
 * Native M1 entries require their agreed engulfing-volume relationship. The
 * existing M1-structure/M5-engulfing route and every other direct route pass
 * through unchanged.
 */
export function resolveDirectEntryPolicy(options: {
  zoneTimeframe: TradeTimeframe;
  signal: EngulfingTradeSignal;
  sourceCandles: StructureCandle[];
  baseRule: TradeRule;
  m5Trend?: MarketTrend;
  m15Trend?: MarketTrend;
  h1Trend?: MarketTrend;
  h4Trend?: MarketTrend;
}): DirectEntryPolicyDecision {
  const { zoneTimeframe, signal, sourceCandles, baseRule } = options;
  const volume = assessEngulfingVolumeLogic(sourceCandles, signal);
  const scalping = evaluateScalpingLogic({
    zoneTimeframe,
    signalTimeframe: signal.timeframe,
    signalDirection: signal.direction,
    m5Trend: options.m5Trend ?? 'neutral',
    m15Trend: options.m15Trend ?? 'neutral',
  });
  const intraday = evaluateIntradayLogic({
    setupTimeframe: zoneTimeframe,
    entryTimeframe: signal.timeframe,
    signalDirection: signal.direction,
    h4Trend: options.h4Trend ?? 'neutral',
    h1Trend: options.h1Trend ?? 'neutral',
    m15Trend: options.m15Trend ?? 'neutral',
  });
  if (scalping.applicable) {
    if (!scalping.allowed) {
      return {
        allowed: false,
        reason: scalping.reason === 'm15-neutral'
          ? 'scalping-bias-neutral'
          : 'scalping-bias-mismatch',
        volume,
        scalping,
      };
    }
  }
  if (intraday.applicable && !intraday.allowed && !scalping.applicable) {
    const neutral = ['h4-neutral', 'h1-neutral', 'm15-neutral'].includes(intraday.reason);
    return {
      allowed: false,
      reason: neutral ? 'intraday-bias-neutral' : 'intraday-bias-mismatch',
      volume,
      scalping,
      intraday,
    };
  }
  if (zoneTimeframe === 'M1' && signal.timeframe === 'M1') {
    if (volume.passes) {
      return { allowed: true, reason: 'volume-confirmed', rule: baseRule, volume, scalping };
    }
    const status = getEngulfingVolumeStatus(volume, signal.type);
    const reason = status === 'unavailable'
      ? 'volume-unavailable'
      : status === 'not-applicable' ? 'volume-not-applicable' : 'volume-failed';
    return { allowed: false, reason, volume, scalping };
  }
  if (scalping.applicable) {
    return {
      allowed: true, reason: 'scalping-confirmed', rule: baseRule, volume, scalping, intraday,
    };
  }
  if (intraday.applicable) {
    return {
      allowed: true, reason: 'intraday-confirmed', rule: baseRule, volume, scalping, intraday,
    };
  }
  if (zoneTimeframe !== 'M1' || signal.timeframe !== 'M1') {
    return { allowed: true, reason: 'unchanged', rule: baseRule, volume };
  }
  return { allowed: true, reason: 'unchanged', rule: baseRule, volume };
}

export function hasOppositeOpenPosition(
  positions: readonly OpenPositionDirection[] | undefined,
  signalDirection: EngulfingDirection,
): boolean {
  const opposite = signalDirection === 'bullish' ? 'SELL' : 'BUY';
  return (positions ?? []).some((position) => position.direction === opposite);
}

export function applyOppositePositionRewardRisk(
  rule: TradeRule,
  positions: readonly OpenPositionDirection[] | undefined,
  signalDirection: EngulfingDirection,
): { rule: TradeRule; oppositePositionOpen: boolean } {
  const oppositePositionOpen = hasOppositeOpenPosition(positions, signalDirection);
  return {
    rule: oppositePositionOpen ? { ...rule, rewardRisk: 1 } : rule,
    oppositePositionOpen,
  };
}

const TIMEFRAME_SECONDS: Record<TradeTimeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D: 86400,
};

const DIRECT_RULES: Record<string, Omit<TradeRule, 'zoneTimeframe' | 'engulfingTimeframe'>> = {
  'M1:M1': { rewardRisk: 3, stopBufferPips: 10, maximumRiskPips: 50 },
  'M1:M5': { rewardRisk: 2, stopBufferPips: 10, maximumRiskPips: 100 },
  'M5:M5': { rewardRisk: 2, stopBufferPips: 10, maximumRiskPips: 100 },
  'M5:M15': { rewardRisk: 1, stopBufferPips: 20, maximumRiskPips: 200 },
  'M15:M15': { rewardRisk: 2, stopBufferPips: 20, maximumRiskPips: 200 },
  'M15:M30': { rewardRisk: 1, stopBufferPips: 20, maximumRiskPips: 300 },
  'H1:M15': { rewardRisk: 2, stopBufferPips: 20, maximumRiskPips: 200 },
  'H1:M30': { rewardRisk: 2, stopBufferPips: 20, maximumRiskPips: 300 },
};

const MTF_ENGULFING_RULES: Partial<Record<TradeTimeframe,
Omit<TradeRule, 'zoneTimeframe' | 'engulfingTimeframe'>>> = {
  M1: { rewardRisk: 3, stopBufferPips: 10, maximumRiskPips: 50 },
  M5: { rewardRisk: 2, stopBufferPips: 10, maximumRiskPips: 100 },
  M15: { rewardRisk: 2, stopBufferPips: 20, maximumRiskPips: 200 },
  M30: { rewardRisk: 1, stopBufferPips: 20, maximumRiskPips: 300 },
};

export function getDirectTradeRule(
  zoneTimeframe: TradeTimeframe,
  engulfingTimeframe: TradeTimeframe,
): TradeRule | undefined {
  const rule = DIRECT_RULES[`${zoneTimeframe}:${engulfingTimeframe}`];
  return rule ? { zoneTimeframe, engulfingTimeframe, ...rule } : undefined;
}

export function getMtfTradeRule(
  zoneTimeframe: TradeTimeframe,
  engulfingTimeframe: TradeTimeframe,
): TradeRule | undefined {
  const exactRule = getDirectTradeRule(zoneTimeframe, engulfingTimeframe);
  const rule = exactRule ?? MTF_ENGULFING_RULES[engulfingTimeframe];
  return rule ? { zoneTimeframe, engulfingTimeframe, ...rule } : undefined;
}

export function formatTradeTimeframe(timeframe: string): string {
  if (timeframe.startsWith('M')) return `${timeframe.slice(1)}M`;
  return timeframe;
}

export function resolveZoneEngulfingSignal(
  zone: StructureZone,
  chartTimeframe: TradeTimeframe,
): EngulfingTradeSignal | undefined {
  // A fallback can intentionally be preferred even when the zone also has a
  // chart-timeframe engulfing (for example, 1H entries confirmed on 15M/30M).
  if (zone.fallbackEngulfingType && zone.fallbackEngulfingDirection
    && zone.fallbackEngulfingTime !== undefined && zone.fallbackEngulfingTimeframe) {
    return {
      type: zone.fallbackEngulfingType,
      direction: zone.fallbackEngulfingDirection,
      time: zone.fallbackEngulfingTime,
      candleCount: zone.fallbackEngulfingCandleCount ?? 2,
      timeframe: zone.fallbackEngulfingTimeframe as TradeTimeframe,
    };
  }
  if (zone.engulfingType && zone.engulfingDirection && zone.engulfingTime !== undefined) {
    return {
      type: zone.engulfingType,
      direction: zone.engulfingDirection,
      time: zone.engulfingTime,
      candleCount: zone.engulfingCandleCount ?? 2,
      timeframe: chartTimeframe,
    };
  }
  if (zone.swingEngulfingType && zone.swingEngulfingDirection
    && zone.swingEngulfingTime !== undefined) {
    return {
      type: zone.swingEngulfingType,
      direction: zone.swingEngulfingDirection,
      time: zone.swingEngulfingTime,
      candleCount: zone.swingEngulfingCandleCount ?? 2,
      timeframe: chartTimeframe,
    };
  }
  if (zone.dayEngulfingType && zone.dayEngulfingDirection && zone.dayEngulfingTime !== undefined) {
    return {
      type: zone.dayEngulfingType,
      direction: zone.dayEngulfingDirection,
      time: zone.dayEngulfingTime,
      candleCount: zone.dayEngulfingCandleCount ?? 2,
      timeframe: chartTimeframe,
    };
  }
  return undefined;
}

function isDeepFibBand(band: StructureZone['fibBand'] | StructureZone['swingFibBand']
  | StructureZone['dayFibBand']): boolean {
  return band === '0.71-0.79' || band === 'deep';
}

export function isDeepDiscountTradeSignal(
  zone: StructureZone,
  signal: EngulfingTradeSignal,
): boolean {
  if (signal.time === zone.engulfingTime && signal.type === zone.engulfingType) {
    return isDeepFibBand(zone.fibBand);
  }
  if (signal.time === zone.swingEngulfingTime && signal.type === zone.swingEngulfingType) {
    return isDeepFibBand(zone.swingFibBand);
  }
  if (signal.time === zone.dayEngulfingTime && signal.type === zone.dayEngulfingType) {
    return isDeepFibBand(zone.dayFibBand);
  }
  return isDeepFibBand(zone.fibBand);
}

function roundPips(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateTradeLevels(options: {
  sourceCandles: StructureCandle[];
  executionCandles: StructureCandle[];
  signal: EngulfingTradeSignal;
  rule: TradeRule;
  omitStopBuffer?: boolean;
}): TradeLevels | undefined {
  const { sourceCandles, executionCandles, signal, rule, omitStopBuffer = false } = options;
  const signalIndex = sourceCandles.findIndex((candle) => candle.time === signal.time);
  if (signalIndex < 0) return undefined;
  const startIndex = signalIndex - signal.candleCount + 1;
  if (startIndex < 0) return undefined;
  const patternCandles = sourceCandles.slice(startIndex, signalIndex + 1);
  if (patternCandles.length !== signal.candleCount) return undefined;

  const isBuy = signal.direction === 'bullish';
  const liquidity = isBuy
    ? Math.min(...patternCandles.map((candle) => candle.low))
    : Math.max(...patternCandles.map((candle) => candle.high));
  const buffer = (omitStopBuffer ? 0 : rule.stopBufferPips) * TRADE_PIP_SIZE;
  const maximumRisk = rule.maximumRiskPips * TRADE_PIP_SIZE;
  const stopLoss = isBuy ? liquidity - buffer : liquidity + buffer;
  const confirmationClose = signal.time + TIMEFRAME_SECONDS[signal.timeframe];
  const entryIndex = executionCandles.findIndex((candle) => candle.time >= confirmationClose);
  if (entryIndex < 0) return undefined;
  const entryCandle = executionCandles[entryIndex];
  const openRisk = isBuy ? entryCandle.open - stopLoss : stopLoss - entryCandle.open;
  const immediate = openRisk > 0 && openRisk <= maximumRisk;
  const entry = immediate
    ? entryCandle.open
    : isBuy ? stopLoss + maximumRisk : stopLoss - maximumRisk;
  const risk = Math.abs(entry - stopLoss);
  const takeProfit = isBuy ? entry + risk * rule.rewardRisk : entry - risk * rule.rewardRisk;
  const riskFree = isBuy ? entry + risk : entry - risk;

  let filled = immediate;
  let filledAt = immediate ? entryCandle.time : undefined;
  let reachedRiskFree = false;
  let status: TradeStatus = immediate ? 'active' : 'pending';
  let result: TradeResult | undefined;
  let resolvedAt: number | undefined;

  for (let index = entryIndex; index < executionCandles.length; index += 1) {
    const candle = executionCandles[index];
    if (!filled) {
      const entryTouched = isBuy ? candle.low <= entry : candle.high >= entry;
      if (!entryTouched) {
        // A capped order that misses entry must not remain pending forever
        // after price has already completed the projected move to target.
        const targetReachedWithoutEntry = isBuy
          ? candle.high >= takeProfit
          : candle.low <= takeProfit;
        if (targetReachedWithoutEntry) return undefined;
        continue;
      }
      filled = true;
      filledAt = candle.time;
      status = 'active';
    }

    const tpHit = isBuy ? candle.high >= takeProfit : candle.low <= takeProfit;
    const riskFreeHit = isBuy ? candle.high >= riskFree : candle.low <= riskFree;
    const slHit = isBuy ? candle.low <= stopLoss : candle.high >= stopLoss;
    if (tpHit) {
      status = 'tp-hit';
      reachedRiskFree = true;
      result = 'tp';
      resolvedAt = candle.time;
      break;
    }
    reachedRiskFree = reachedRiskFree || riskFreeHit;
    if (slHit) {
      status = reachedRiskFree ? 'risk-free' : 'sl-hit';
      result = reachedRiskFree ? 'rf' : 'sl';
      resolvedAt = candle.time;
      break;
    }
    if (reachedRiskFree) status = 'risk-free';
  }

  return {
    entry,
    stopLoss,
    takeProfit,
    riskFree,
    riskPips: roundPips(risk / TRADE_PIP_SIZE),
    rewardRisk: rule.rewardRisk,
    status,
    pendingAtCreation: !immediate,
    calculatedAt: entryCandle.time,
    filledAt,
    result,
    resolvedAt,
    signal,
  };
}
