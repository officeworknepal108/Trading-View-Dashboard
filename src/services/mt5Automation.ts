import {
  hasOppositeOpenPosition,
  type EngulfingVolumeStatus,
  type MarketTrend,
  type TradeLevels,
  type TradeTimeframe,
} from './tradeLevels';
import type { StructureCandle } from './marketStructure';

export const MT5_RISK_PERCENT_OPTIONS = [
  0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
] as const;

export const MT5_ENTRY_TIMEFRAME_OPTIONS = ['M1', 'M5', 'M15', 'M30', 'H1'] as const;
export type Mt5EntryTimeframe = typeof MT5_ENTRY_TIMEFRAME_OPTIONS[number];
export const MT5_DEFAULT_ENABLED_TIMEFRAMES: readonly Mt5EntryTimeframe[] = ['M5', 'M15', 'M30', 'H1'];

export function normalizeMt5EnabledTimeframes(
  value: unknown,
  fallback: readonly Mt5EntryTimeframe[] = MT5_DEFAULT_ENABLED_TIMEFRAMES,
): Mt5EntryTimeframe[] {
  if (!Array.isArray(value)) return [...fallback];
  const selected = new Set(value.map(String));
  return MT5_ENTRY_TIMEFRAME_OPTIONS.filter((timeframe) => selected.has(timeframe));
}

export function isMt5EntryTimeframeEnabled(
  enabledTimeframes: readonly Mt5EntryTimeframe[] | undefined,
  signalTimeframe: string,
): boolean {
  return (enabledTimeframes ?? MT5_DEFAULT_ENABLED_TIMEFRAMES)
    .includes(signalTimeframe as Mt5EntryTimeframe);
}

export function isMt5SignalAllowedByTimeframes(
  enabledTimeframes: readonly Mt5EntryTimeframe[] | undefined,
  signal: Pick<Mt5SignalInput, 'zoneTimeframe' | 'signalTimeframe'>,
): boolean {
  const enabled = enabledTimeframes ?? MT5_DEFAULT_ENABLED_TIMEFRAMES;
  const controlled = new Set<string>(MT5_ENTRY_TIMEFRAME_OPTIONS);
  return (!controlled.has(signal.zoneTimeframe) || enabled.includes(signal.zoneTimeframe as Mt5EntryTimeframe))
    && (!controlled.has(signal.signalTimeframe) || enabled.includes(signal.signalTimeframe as Mt5EntryTimeframe));
}

export function mt5SignalDisabledReason(
  config: {
    enabledTimeframes: readonly Mt5EntryTimeframe[];
    scalpingEnabled: boolean;
    intradayEnabled: boolean;
  },
  signal: Pick<Mt5SignalInput, 'zoneTimeframe' | 'signalTimeframe' | 'tradeStyle'>,
): string | undefined {
  if (!isMt5SignalAllowedByTimeframes(config.enabledTimeframes, signal)) {
    return `${signal.zoneTimeframe} setup / ${signal.signalTimeframe} entry automatic trading is disabled.`;
  }
  if (signal.tradeStyle === 'SCALPING') {
    return config.scalpingEnabled ? undefined : 'Scalping automatic trading is disabled.';
  }
  if (signal.tradeStyle === 'INTRADAY') {
    return config.intradayEnabled ? undefined : 'Intraday automatic trading is disabled.';
  }
  // M5 entries can belong to either route. The setup timeframe identifies it.
  if (signal.zoneTimeframe === 'M1' || signal.zoneTimeframe === 'M5') {
    return config.scalpingEnabled ? undefined : 'Scalping automatic trading is disabled.';
  }
  return config.intradayEnabled ? undefined : 'Intraday automatic trading is disabled.';
}

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

const MT5_PRE_EXECUTION_STATUSES = new Set<Mt5SignalStatus>(['QUEUED', 'CLAIMED', 'PLACED']);
const MT5_TERMINAL_WITHOUT_RESULT_STATUSES = new Set<Mt5SignalStatus>([
  'CANCELLED', 'REJECTED', 'EXPIRED', 'SIMULATED',
]);

export function canMt5SignalExpireBeforeExecution(status: Mt5SignalStatus): boolean {
  return MT5_PRE_EXECUTION_STATUSES.has(status);
}

export function shouldRemoveOpenMt5JournalRecord(status: Mt5SignalStatus): boolean {
  return MT5_TERMINAL_WITHOUT_RESULT_STATUSES.has(status);
}

export interface Mt5AutomationConfig {
  enabled: boolean;
  tradingTimeEnabled: boolean;
  dryRun: boolean;
  scalpingEnabled: boolean;
  intradayEnabled: boolean;
  symbol: string;
  brokerSymbol: string;
  enabledTimeframes: Mt5EntryTimeframe[];
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
  setupId?: string;
  zoneId?: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  source: 'ENGULFING' | 'MTF';
  tradeStyle?: 'SCALPING' | 'INTRADAY';
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
  normalRewardRisk?: number;
  riskPips: number;
  expiresAt: number;
  confluenceZones?: string[];
  journalContext?: {
    biasAtEntry: Record<TradeTimeframe, MarketTrend>;
    autoReason: string;
    fibSource?: string;
    fibBand?: string;
    fibLevels?: Array<{ label: string; price: number }>;
    volumeLogicStatus: EngulfingVolumeStatus;
    volume1?: number;
    volume2?: number;
    volume3?: number;
    entrySnapshotCandles: StructureCandle[];
  };
}

/** The same Gold HTF zone may create separate scalp and intraday chart entries. */
export function goldMt5ZoneExecutionKey(signal: Pick<Mt5SignalInput,
  'symbol' | 'zoneTimeframe' | 'zoneId' | 'setupId'>): string | undefined {
  if (signal.symbol !== 'XAUUSD') return undefined;
  const legacyDirectZone = signal.setupId?.match(/^(?:GOLD_SCALP|DIRECT):(M15|H1):(.+)$/);
  const zoneId = signal.zoneId ?? legacyDirectZone?.[2];
  const zoneTimeframe = legacyDirectZone?.[1] ?? signal.zoneTimeframe;
  return zoneId ? `${signal.symbol}:${zoneTimeframe}:${zoneId}` : undefined;
}

export function priorGoldMt5ZoneExecution<T extends Pick<Mt5SignalInput,
  'symbol' | 'zoneTimeframe' | 'zoneId' | 'setupId'> & { status: Mt5SignalStatus }>(
  candidate: Pick<Mt5SignalInput, 'symbol' | 'zoneTimeframe' | 'zoneId' | 'setupId'>,
  signals: readonly T[],
  consumedStatuses: ReadonlySet<Mt5SignalStatus>,
): T | undefined {
  const zoneKey = goldMt5ZoneExecutionKey(candidate);
  return zoneKey === undefined ? undefined : signals.find((signal) => (
    signal.setupId !== candidate.setupId
    && consumedStatuses.has(signal.status)
    && goldMt5ZoneExecutionKey(signal) === zoneKey
  ));
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
  initialStopLoss?: number;
  volume?: number;
  initialVolume?: number;
  partialClosedVolume?: number;
  remainingVolume?: number;
  partialClosePrice?: number;
  partialCloseTicket?: number;
  partialClosedAt?: number;
  openedAt?: number;
  closedAt?: number;
  closePrice?: number;
  realizedProfit?: number;
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
  positions: Array<{
    ticket: number;
    symbol: string;
    direction: 'BUY' | 'SELL';
    volume: number;
    priceOpen: number;
    priceCurrent: number;
    stopLoss: number;
    takeProfit: number;
    profit: number;
    swap: number;
    openedAt: number;
    comment?: string;
    magic?: number;
    signalTimeframe?: TradeTimeframe;
    zoneTimeframe?: TradeTimeframe;
    source?: Mt5SignalInput['source'];
    zoneName?: string;
    engulfingType?: string;
    signalAt?: number;
    setupId?: string;
    rewardRisk?: number;
    riskFree?: number;
    signalStatus?: Mt5SignalStatus;
  }>;
  marketData: {
    source: 'MT5_BROKER';
    fresh: boolean;
    lastUpdateAt: number;
    timeframes: Partial<Record<TradeTimeframe, {
      updatedAt?: number;
      count: number;
      latestCandleTime?: number;
      latestCompletedTime?: number;
    }>>;
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

export function applySignalOppositePositionTarget(
  signal: Mt5SignalInput,
  positions: readonly { direction: 'BUY' | 'SELL' }[] | undefined,
): Mt5SignalInput {
  const requestedNormalRewardRisk = signal.normalRewardRisk ?? signal.rewardRisk;
  const normalRewardRisk = Number.isFinite(requestedNormalRewardRisk)
    && requestedNormalRewardRisk > 0
    ? requestedNormalRewardRisk
    : signal.rewardRisk;
  const signalDirection = signal.direction === 'BUY' ? 'bullish' : 'bearish';
  const oppositePositionOpen = signal.tradeStyle === undefined
    && hasOppositeOpenPosition(positions, signalDirection);
  const rewardRisk = oppositePositionOpen ? 1 : normalRewardRisk;
  const riskDistance = Math.abs(signal.entry - signal.stopLoss);
  const takeProfit = signal.direction === 'BUY'
    ? signal.entry + riskDistance * rewardRisk
    : signal.entry - riskDistance * rewardRisk;
  const adjusted = { ...signal, normalRewardRisk, rewardRisk, takeProfit };
  return {
    ...adjusted,
    id: buildMt5SignalId(adjusted),
  };
}

export function tradeToMt5Signal(options: {
  source: Mt5SignalInput['source'];
  setupId?: string;
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
    setupId: options.setupId,
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
    normalRewardRisk: trade.rewardRisk,
    riskPips: trade.riskPips,
    expiresAt: options.now + options.pendingExpiryMinutes * 60,
    confluenceZones: options.confluenceZones,
  };
}

export function isExecutableTrade(trade: TradeLevels): boolean {
  return trade.status === 'pending' || trade.status === 'active';
}

export function canQueueSingleSlReentry(
  priorAttempts: Array<{ status: Mt5SignalStatus; signalAt: number }>,
  candidateSignalAt: number,
): boolean {
  return priorAttempts.length === 1
    && priorAttempts[0].status === 'SL'
    && candidateSignalAt > priorAttempts[0].signalAt;
}
