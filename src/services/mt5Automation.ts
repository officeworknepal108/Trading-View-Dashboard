import type { TradeLevels, TradeTimeframe } from './tradeLevels';

export const MT5_RISK_PERCENT_OPTIONS = [
  0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
] as const;

export function normalizeMt5RiskPercent(value: unknown, fallback = 0.25): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return MT5_RISK_PERCENT_OPTIONS.reduce((nearest, option) => (
    Math.abs(option - numeric) < Math.abs(nearest - numeric) ? option : nearest
  ));
}

export function calculateXauUsdLotSize(cashRisk: number, stopLossPips: number): number {
  if (!Number.isFinite(cashRisk) || cashRisk <= 0) throw new Error('Cash risk must be positive.');
  if (!Number.isFinite(stopLossPips) || stopLossPips <= 0) {
    throw new Error('SL pip distance must be positive.');
  }
  return cashRisk / (stopLossPips * 10);
}

export type Mt5SignalStatus = 'QUEUED' | 'CLAIMED' | 'PLACED' | 'ACTIVE'
  | 'RISK_FREE' | 'TP' | 'SL' | 'RF' | 'CANCELLED' | 'REJECTED' | 'EXPIRED' | 'SIMULATED';

export interface Mt5AutomationConfig {
  enabled: boolean;
  dryRun: boolean;
  symbol: string;
  brokerSymbol: string;
  riskPercent: number;
  maximumOpenTrades: number;
  maximumDailyLossPercent: number;
  maximumSpreadPoints: number;
  signalMaxAgeSeconds: number;
  pendingExpiryMinutes: number;
  moveStopToBreakEvenAtR: number;
}

export interface Mt5SignalInput {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  source: 'ENGULFING' | 'MTF';
  zoneName: string;
  zoneTimeframe: TradeTimeframe;
  signalTimeframe: TradeTimeframe;
  engulfingType: string;
  signalAt: number;
  calculatedAt: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskFree: number;
  rewardRisk: number;
  riskPips: number;
  expiresAt: number;
  confluenceZones?: string[];
}

export interface Mt5StoredSignal extends Mt5SignalInput {
  status: Mt5SignalStatus;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  bridgeId?: string;
  brokerTicket?: number;
  brokerPosition?: number;
  executionPrice?: number;
  volume?: number;
  message?: string;
}

export interface Mt5AutomationStatus {
  ok: boolean;
  config: Mt5AutomationConfig;
  bridge: {
    connected: boolean;
    bridgeId?: string;
    processId?: number;
    managedByServer?: boolean;
    processRunning?: boolean;
    processStartedAt?: number;
    processExitCode?: number | null;
    account?: string;
    server?: string;
    balance?: number;
    equity?: number;
    freeMargin?: number;
    currency?: string;
    brokerSymbol?: string;
    lastHeartbeatAt?: number;
    message?: string;
    logs?: string[];
  };
  counts: Record<string, number>;
  recentSignals: Mt5StoredSignal[];
}

function stablePrice(value: number): string {
  return Number(value).toFixed(3);
}

export function buildMt5SignalId(options: {
  source: Mt5SignalInput['source'];
  signalTimeframe: TradeTimeframe;
  signalAt: number;
  direction: Mt5SignalInput['direction'];
  entry: number;
  stopLoss: number;
  takeProfit: number;
}): string {
  return [
    options.signalTimeframe,
    Math.floor(options.signalAt),
    options.direction,
    stablePrice(options.entry),
    stablePrice(options.stopLoss),
    stablePrice(options.takeProfit),
  ].join(':');
}

export function tradeToMt5Signal(options: {
  source: Mt5SignalInput['source'];
  zoneName: string;
  zoneTimeframe: TradeTimeframe;
  trade: TradeLevels;
  now: number;
  pendingExpiryMinutes: number;
  confluenceZones?: string[];
}): Mt5SignalInput {
  const { trade } = options;
  const direction = trade.signal.direction === 'bullish' ? 'BUY' : 'SELL';
  const orderType = trade.status === 'pending' ? 'LIMIT' : 'MARKET';
  const id = buildMt5SignalId({
    source: options.source,
    signalTimeframe: trade.signal.timeframe,
    signalAt: trade.signal.time,
    direction,
    entry: trade.entry,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
  });
  return {
    id,
    symbol: 'XAUUSD',
    direction,
    orderType,
    source: options.source,
    zoneName: options.zoneName,
    zoneTimeframe: options.zoneTimeframe,
    signalTimeframe: trade.signal.timeframe,
    engulfingType: trade.signal.type,
    signalAt: trade.signal.time,
    calculatedAt: trade.calculatedAt,
    entry: trade.entry,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    riskFree: trade.riskFree,
    rewardRisk: trade.rewardRisk,
    riskPips: trade.riskPips,
    expiresAt: options.now + options.pendingExpiryMinutes * 60,
    confluenceZones: options.confluenceZones,
  };
}

export function isExecutableTrade(trade: TradeLevels): boolean {
  return trade.status === 'pending' || trade.status === 'active';
}
