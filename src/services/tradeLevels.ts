import type {
  EngulfingDirection,
  EngulfingType,
  StructureCandle,
  StructureZone,
} from './marketStructure';

export type TradeTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D';
export type TradeStatus = 'pending' | 'active' | 'risk-free' | 'tp-hit' | 'sl-hit';

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
  signal: EngulfingTradeSignal;
}

export const TRADE_PIP_SIZE = 0.1;

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
  return undefined;
}

function roundPips(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateTradeLevels(options: {
  sourceCandles: StructureCandle[];
  executionCandles: StructureCandle[];
  signal: EngulfingTradeSignal;
  rule: TradeRule;
}): TradeLevels | undefined {
  const { sourceCandles, executionCandles, signal, rule } = options;
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
  const buffer = rule.stopBufferPips * TRADE_PIP_SIZE;
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

  for (let index = entryIndex; index < executionCandles.length; index += 1) {
    const candle = executionCandles[index];
    if (!filled) {
      const entryTouched = isBuy ? candle.low <= entry : candle.high >= entry;
      if (!entryTouched) continue;
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
      break;
    }
    reachedRiskFree = reachedRiskFree || riskFreeHit;
    if (slHit) {
      status = reachedRiskFree ? 'risk-free' : 'sl-hit';
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
    signal,
  };
}
