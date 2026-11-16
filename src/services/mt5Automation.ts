import { pullbackExpirySeconds } from './pullbackExpiry';
import {
  hasOppositeOpenPosition,
  type EngulfingVolumeStatus,
  type MarketTrend,
  type TradeLevels,
  type TradeTimeframe,
} from './tradeLevels';
import { detectEngulfingPatternAt, isZoneEligibleForEngulfingEntry,
  type MarketStructureResult, type StructureCandle, type StructureLine, type StructureZone } from './marketStructure';
import { buildGoldIntradayMtfHistoryRows } from './mtf';
import { intradayPullbackSignalError, sameIntradayPullbackSetup } from './intradayPullback';

export interface GoldOpposingZone extends StructureZone {
  opposingEngulfingConfirmedAt?: number;
  opposingZoneTimeframe?: TradeTimeframe;
  opposingEngulfingTimeframe?: TradeTimeframe;
  opposingEngulfingType?: string;
  opposingConfirmationRoute?: 'MTF_CHOCH';
}

export interface GoldOpposingConfirmationOptions {
  m15Structure?: MarketStructureResult;
  requireLtfFib?: boolean;
}

const OPPOSING_CONFIRMATION_SECONDS: Record<TradeTimeframe, number> = {
  M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D: 86400,
};

/** An opposing zone needs its own completed reversal, not merely a zone label.
 * Confirmation touches the aligned zone; it need not touch the exact Fib 50% line.
 * Retain the close time so a later reversal cannot veto an earlier entry.
 */
export function prepareGoldOpposingZones(
  zones: readonly StructureZone[],
  zoneTimeframe: TradeTimeframe,
  candles: Partial<Record<TradeTimeframe, StructureCandle[]>>,
  options: GoldOpposingConfirmationOptions = {},
): GoldOpposingZone[] {
  if (zoneTimeframe === 'H4') {
    // An H4 zone is confirmed only by its actual M15 MTF setup, including
    // source-pair overlap, first CHoCH, LTF zone tap and qualified engulfing.
    const lower = candles.M15 ?? [];
    const rows = options.m15Structure ? buildGoldIntradayMtfHistoryRows({
      H4: { candles: candles.H4 ?? [], structure: {
        markers: [], issMarkers: [], internalMarkers: [], engulfingMarkers: [],
        zones: [...zones], lines: [], trend: 'neutral',
      } },
      M15: { candles: lower, structure: options.m15Structure },
    }, options.requireLtfFib, Number.POSITIVE_INFINITY) : [];
    return zones.filter(isZoneEligibleForEngulfingEntry).map(zone => {
      const row = rows.filter(row => row.higherTimeframeZoneId === zone.id
        && row.confirmationKind === 'choch' && (row.chochSequence ?? 1) === 1
        && row.sourcePairOverlapsHigherZone === true
        && row.direction === (zone.isBuy ? 'bullish' : 'bearish')
        && row.engulfingType && row.engulfingTime !== undefined
        && lower.some(candle => candle.time === row.engulfingTime && candle.complete !== false))
        .sort((a, b) => a.engulfingTime! - b.engulfingTime!)[0];
      return { ...zone, opposingZoneTimeframe: zoneTimeframe,
        opposingEngulfingConfirmedAt: row ? row.engulfingTime! + 900 : undefined,
        opposingEngulfingTimeframe: row ? 'M15' as const : undefined,
        opposingEngulfingType: row?.engulfingType,
        opposingConfirmationRoute: row ? 'MTF_CHOCH' as const : undefined };
    });
  }
  const routes: TradeTimeframe[] = zoneTimeframe === 'M15' ? ['M15', 'M30']
    : zoneTimeframe === 'H1' ? ['H1', 'M15', 'M30'] : [zoneTimeframe];
  const eligible = zones.filter(isZoneEligibleForEngulfingEntry);
  if (!eligible.length) return [];
  const earliest = Math.min(...eligible.map(zone => Math.max(zone.startTime,
    zone.activeFromTime ?? zone.startTime, zone.confirmationTime ?? zone.startTime)));
  const patterns = routes.flatMap(timeframe => {
    const source = candles[timeframe] ?? [];
    return source.flatMap((candle, index) => {
      if (candle.complete === false || candle.time < earliest) return [];
      const pattern = detectEngulfingPatternAt(source, index);
      return pattern ? [{ pattern, source, timeframe,
        confirmedAt: candle.time + OPPOSING_CONFIRMATION_SECONDS[timeframe] }] : [];
    });
  });
  return eligible.map(zone => {
    const validFrom = Math.max(zone.startTime, zone.activeFromTime ?? zone.startTime,
      zone.confirmationTime ?? zone.startTime);
    let confirmedAt: number | undefined;
    let confirmation: typeof patterns[number] | undefined;
    for (const candidate of patterns) {
      const { pattern, source } = candidate;
      if (pattern.direction !== (zone.isBuy ? 'bullish' : 'bearish')
        || source[pattern.endIndex].time < validFrom) continue;
      const touchesZone = source.slice(pattern.startIndex, pattern.endIndex + 1).some(candle => (
        candle.time > zone.startTime && candle.time >= validFrom
        && candle.high >= zone.bottom && candle.low <= zone.top
      ));
      if (touchesZone && (confirmedAt === undefined || candidate.confirmedAt < confirmedAt)) {
        confirmedAt = candidate.confirmedAt;
        confirmation = candidate;
      }
    }
    return { ...zone, opposingZoneTimeframe: zoneTimeframe, opposingEngulfingConfirmedAt: confirmedAt,
      opposingEngulfingTimeframe: confirmation?.timeframe, opposingEngulfingType: confirmation?.pattern.type };
  });
}

export function goldOpposingZoneBlockLabel(block: { zone: GoldOpposingZone; rewardRisk: number }): string {
  const zone = block.zone;
  const confirmation = zone.opposingEngulfingTimeframe && zone.opposingEngulfingType
    ? `CONFIRMED BY ${zone.opposingEngulfingTimeframe} ${zone.opposingConfirmationRoute === 'MTF_CHOCH' ? 'MTF CHoCH + ' : ''}${zone.opposingEngulfingType}` : 'ENGULFING CONFIRMED';
  return `NO ENTRY · ${zone.opposingZoneTimeframe ? `${zone.opposingZoneTimeframe} ` : ''}${zone.name} `
    + `${zone.isBuy ? 'BUY' : 'SELL'} ${confirmation} · ${block.rewardRisk.toFixed(2)}R`;
}

export interface Mt5FibProfitEvent {
  ticket: number;
  direction: 'BUY' | 'SELL';
  originalVolume: number;
  remainingVolume: number;
  phase: 'touch' | 'engulfing';
  status: 'partial' | 'closed';
  zoneTimeframe?: TradeTimeframe;
  zoneName?: string;
  updatedAt: number;
}

export function sanitizeMt5FibProfitEvents(value: unknown): Mt5FibProfitEvent[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 25).flatMap(raw => {
    if (!raw || !Number.isInteger(raw.ticket) || raw.ticket <= 0 || !['BUY', 'SELL'].includes(raw.direction)
      || !Number.isFinite(raw.originalVolume) || raw.originalVolume <= 0
      || !Number.isFinite(raw.remainingVolume) || raw.remainingVolume < 0 || raw.remainingVolume >= raw.originalVolume
      || !Number.isFinite(raw.updatedAt) || raw.updatedAt <= 0
      || !['touch', 'engulfing'].includes(raw.phase)
      || (raw.status !== 'partial' || raw.remainingVolume <= 0) && (raw.status !== 'closed' || raw.remainingVolume !== 0)) return [];
    return [{ ticket: raw.ticket, direction: raw.direction, originalVolume: raw.originalVolume,
      remainingVolume: raw.remainingVolume, phase: raw.phase, status: raw.status, updatedAt: raw.updatedAt,
      zoneTimeframe: Object.hasOwn(OPPOSING_CONFIRMATION_SECONDS, raw.zoneTimeframe) ? raw.zoneTimeframe : undefined,
      zoneName: typeof raw.zoneName === 'string' ? raw.zoneName.slice(0, 50) : undefined }];
  });
}

export function mt5FibProfitEventLabel(event: Mt5FibProfitEvent): string {
  if (event.status === 'closed') return event.phase === 'engulfing'
    ? 'FULLY CLOSED · Opposing engulfing confirmed' : 'FULLY CLOSED · Fib zone touch';
  const remaining = Number((event.remainingVolume / event.originalVolume * 100).toFixed(1));
  const closed = Number((100 - remaining).toFixed(1));
  return `${closed}% CLOSED · ${remaining}% RUNNING`;
}

export const MT5_RISK_PERCENT_OPTIONS = [
  0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
] as const;
export const SCALP_ONE_TO_ONE_RISK_OPTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;
export const SCALP_ONE_TO_ONE_MINIMUM_VOLUME_GAP = 250;

/** Raw candle-volume units: T1 compares V1/V2; T2/T3 compare V2/V3. */
export function scalpOneToOneVolumePasses(type: string | undefined,
  v1: number | undefined, v2: number | undefined, v3?: number): boolean {
  if (!type || !['T1', 'T2', 'T3'].includes(type)) return false;
  const volumes = type === 'T1' ? [v1, v2] : [v1, v2, v3];
  if (volumes.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return false;
  const reference = type === 'T1' ? v1! : v2!;
  const confirming = type === 'T1' ? v2! : v3!;
  return reference - confirming >= SCALP_ONE_TO_ONE_MINIMUM_VOLUME_GAP;
}
export function normalizeScalpOneToOneRisk(value: unknown, fallback = 0.25): number {
  return SCALP_ONE_TO_ONE_RISK_OPTIONS.includes(value as typeof SCALP_ONE_TO_ONE_RISK_OPTIONS[number])
    ? value as number : fallback;
}

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

/** The dashboard, alerts and execution use the same trade-style switches. */
export function isTradeStyleEnabled(
  config: { scalpingEnabled: boolean; intradayEnabled: boolean; scalpOneToOneEnabled?: boolean },
  trade: { tradeStyle?: 'SCALPING' | 'INTRADAY' | 'SCALP_1_1'; zoneTimeframe?: TradeTimeframe },
): boolean {
  const style = trade.tradeStyle
    ?? (trade.zoneTimeframe === 'M1' || trade.zoneTimeframe === 'M5' ? 'SCALPING' : 'INTRADAY');
  if (style === 'SCALP_1_1') return config.scalpOneToOneEnabled === true;
  return style === 'SCALPING' ? config.scalpingEnabled : config.intradayEnabled;
}

export function mt5SignalDisabledReason(
  config: {
    enabledTimeframes: readonly Mt5EntryTimeframe[];
    scalpingEnabled: boolean;
    intradayEnabled: boolean;
    scalpOneToOneEnabled?: boolean;
    mtfLtfFibRequired?: boolean;
  },
  signal: Pick<Mt5SignalInput, 'zoneTimeframe' | 'signalTimeframe' | 'tradeStyle'>
    & Partial<Pick<Mt5SignalInput, 'source' | 'mtfLtfFibRequiredAtSignal' | 'engulfingType' | 'journalContext'>>,
): string | undefined {
  if (signal.source === 'MTF' && typeof config.mtfLtfFibRequired === 'boolean'
    && signal.mtfLtfFibRequiredAtSignal !== config.mtfLtfFibRequired) {
    return 'MTF LTF Fib setting changed after this signal was created.';
  }
  if (!isMt5SignalAllowedByTimeframes(config.enabledTimeframes, signal)) {
    return `${signal.zoneTimeframe} setup / ${signal.signalTimeframe} entry automatic trading is disabled.`;
  }
  if (isTradeStyleEnabled(config, signal)) {
    if ('intradayEntry' in signal && signal.intradayEntry) {
      const error = intradayPullbackSignalError(signal as Mt5SignalInput);
      if (error) return error;
    }
    if (signal.tradeStyle === 'SCALP_1_1' && 'scalpEntry' in signal && signal.scalpEntry) {
      const error = scalpPullbackSignalError(signal as Mt5SignalInput);
      if (error) return error;
    }
    if (signal.tradeStyle === 'SCALP_1_1' && !scalpOneToOneVolumePasses(signal.engulfingType,
      signal.journalContext?.volume1, signal.journalContext?.volume2, signal.journalContext?.volume3)) {
      return 'Scalp 1:1 requires a minimum 250-unit candle-volume decrease.';
    }
    return undefined;
  }
  if (signal.tradeStyle === 'SCALP_1_1') return 'Scalp 1:1 automatic trading is disabled.';
  const scalping = signal.tradeStyle === 'SCALPING' || (signal.tradeStyle === undefined
    && (signal.zoneTimeframe === 'M1' || signal.zoneTimeframe === 'M5'));
  return `${scalping ? 'Scalping' : 'Intraday'} automatic trading is disabled.`;
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

export function mt5ClosedReturnR(options: {
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  closePrice: number;
  initialVolume?: number;
  partialClosedVolume?: number;
  partialClosePrice?: number;
}): number {
  const risk = Math.abs(options.entry - options.stopLoss);
  if (risk <= 0) return 0;
  const direction = options.direction === 'BUY' ? 1 : -1;
  const initialVolume = options.initialVolume ?? 0;
  if (initialVolume <= 0) {
    return (options.closePrice - options.entry) * direction / risk;
  }
  const partialVolume = options.partialClosePrice === undefined ? 0
    : Math.min(Math.max(options.partialClosedVolume ?? 0, 0), initialVolume);
  return ((options.partialClosePrice !== undefined
    ? (options.partialClosePrice - options.entry) * direction * partialVolume : 0)
    + (options.closePrice - options.entry) * direction * (initialVolume - partialVolume))
    / (risk * initialVolume);
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
  manualTradeTimeframes?: Record<string, TradeTimeframe>;
  enabled: boolean;
  tradingTimeEnabled: boolean;
  telegramMessagesEnabled: boolean;
  dryRun: boolean;
  scalpingEnabled: boolean;
  intradayEnabled: boolean;
  scalpOneToOneEnabled?: boolean;
  scalpOneToOneRiskPercent?: number;
  mtfLtfFibRequired: boolean;
  symbol: string;
  brokerSymbol: string;
  brokerSymbolAccount?: string;
  brokerSymbolServer?: string;
  enabledTimeframes: Mt5EntryTimeframe[];
  riskPercent: number;
  maximumOpenTrades: number;
  maximumDailyLossPercent: number;
  maximumSpreadPoints: number;
  signalMaxAgeSeconds: number;
  pendingExpiryMinutes: number;
  moveStopToBreakEvenAtR: number;
}

export interface ScalpPullbackEntry {
  /** v1 capped orders, v2 exact entries/one candle, v3 exact entries/75 minutes. */
  version: 1 | 2 | 3;
  leg: 10 | 25;
  riskShare: number;
  referenceEntry: number;
  nextOpen: number;
  confirmationBody: number;
}

/** Validate the two fixed-exit entries independently of the scanner/UI. */
export function scalpPullbackSignalError(signal: Pick<Mt5SignalInput,
  'scalpEntry' | 'entry' | 'stopLoss' | 'takeProfit' | 'direction' | 'orderType'
  | 'signalAt' | 'calculatedAt' | 'expiresAt' | 'rewardRisk'>): string | undefined {
  const leg = signal.scalpEntry;
  if (!leg) return undefined; // Existing single-entry executions retain their exits.
  const expectedShare = leg.leg === 10 ? 0.6 : leg.leg === 25 ? 0.4 : 0;
  const sign = signal.direction === 'BUY' ? 1 : -1;
  const raw = leg.nextOpen - sign * leg.confirmationBody * leg.leg / 100;
  const entry = leg.version >= 2 ? raw : sign === 1 ? Math.min(raw, leg.referenceEntry) : Math.max(raw, leg.referenceEntry);
  const maximumRisk = leg.version >= 2 ? 30 : 20;
  const risk = sign * (signal.entry - signal.stopLoss);
  const reward = sign * (signal.takeProfit - signal.entry);
  if (![1, 2, 3].includes(leg.version) || !expectedShare || leg.riskShare !== expectedShare
    || ![signal.entry, signal.stopLoss, signal.takeProfit, signal.rewardRisk,
      signal.signalAt, signal.calculatedAt, signal.expiresAt].every(v => Number.isFinite(v) && v > 0)
    || ![leg.referenceEntry, leg.nextOpen, leg.confirmationBody].every(v => Number.isFinite(v) && v > 0)
    || signal.orderType !== 'LIMIT' || Math.abs(entry - signal.entry) > 1e-6
    || Math.abs((signal.stopLoss + signal.takeProfit) / 2 - leg.referenceEntry) > 1e-6
    || sign * (leg.referenceEntry - signal.stopLoss) <= 0
    || sign * (leg.referenceEntry - signal.stopLoss) > 20.000001
    || risk <= 0 || risk > maximumRisk + 0.000001 || reward <= 0
    || Math.abs(signal.rewardRisk - reward / risk) > 1e-6
    || signal.calculatedAt !== signal.signalAt + 900
    || signal.expiresAt !== signal.calculatedAt + pullbackExpirySeconds(leg.version, 900)) {
    return 'Invalid Scalp 1:1 pullback entry, risk allocation or original fixed exits.';
  }
  return undefined;
}

export interface Mt5SignalInput {
  id: string;
  setupId?: string;
  zoneId?: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  source: 'ENGULFING' | 'MTF';
  mtfLtfFibRequiredAtSignal?: boolean;
  tradeStyle?: 'SCALPING' | 'INTRADAY' | 'SCALP_1_1';
  scalpEntry?: ScalpPullbackEntry;
  /** Frozen full-setup cash allowance, shared by both broker entries. */
  scalpSetupRiskBudget?: number;
  intradayEntry?: import('./intradayPullback').IntradayPullbackEntry;
  intradaySetupRiskBudget?: number;
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
    mtfContext?: import('./mtf').MtfRow;
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

/** Only a completed higher-timeframe bias may veto a one-minute reversal entry. */
export function goldM1BuyCountertrendBlocked(
  signalTimeframe: TradeTimeframe,
  direction: 'BUY' | 'SELL',
  m15Trend: MarketTrend | undefined,
  h1Trend: MarketTrend | undefined,
): boolean {
  return signalTimeframe === 'M1' && direction === 'BUY'
    && m15Trend === 'bearish' && h1Trend === 'bearish';
}

export function goldM5ScalpingBuyCountertrendBlocked(
  signalTimeframe: TradeTimeframe,
  direction: 'BUY' | 'SELL',
  m15Trend: MarketTrend | undefined,
  h1Trend: MarketTrend | undefined,
): boolean {
  return signalTimeframe === 'M5' && direction === 'BUY'
    && m15Trend === 'bearish' && h1Trend === 'bearish';
}

export function goldAutomationCountertrendBlocked(signal: Mt5SignalInput): boolean {
  const bias = signal.journalContext?.biasAtEntry;
  return goldM1BuyCountertrendBlocked(
    signal.signalTimeframe, signal.direction, bias?.M15, bias?.H1,
  ) || (signal.source === 'ENGULFING' && signal.tradeStyle === 'SCALPING'
    && goldM5ScalpingBuyCountertrendBlocked(
      signal.signalTimeframe, signal.direction, bias?.M15, bias?.H1,
    ));
}

export interface OpposingFibProfitZone {
  id: string; timeframe: TradeTimeframe; isBuy: boolean; bottom: number; top: number;
  name?: string;
  engulfingConfirmedAt?: number;
  confirmationRoute?: 'MTF_CHOCH';
}

export type OpposingFibProfitSnapshot = { available: false; error: string } | {
  available: true; account: string; server: string; brokerSymbol: string; asOf: number;
  zones: OpposingFibProfitZone[];
};

export function opposingFibProfitZones(zones: readonly StructureZone[], timeframe: TradeTimeframe, asOf: number,
  candles: Partial<Record<TradeTimeframe, StructureCandle[]>> = {},
  options: GoldOpposingConfirmationOptions = {}): OpposingFibProfitZone[] {
  const confirmations = new Map(prepareGoldOpposingZones(zones, timeframe, candles, options)
    .map(zone => [zone.id, zone]));
  return zones.filter(zone => zone.active && zone.status === 'valid' && zone.startTime <= asOf
    && (zone.activeFromTime === undefined || zone.activeFromTime <= asOf)
    && (zone.invalidatedAt === undefined || zone.invalidatedAt > asOf)
    && ((zone.fibStatus === 'a-plus' && !!zone.fibBand && zone.fibDeepInvalidatedAt === undefined)
      || (zone.swingFibStatus === 'a-plus' && !!zone.swingFibBand)
      || (zone.h1SwingFibStatus === 'aligned' && !!zone.h1SwingFibBand)
      || (zone.dayFibStatus === 'a-plus' && !!zone.dayFibBand))
    && Number.isFinite(zone.bottom) && Number.isFinite(zone.top) && zone.bottom > 0 && zone.top > zone.bottom)
    .map(zone => {
      const confirmation = confirmations.get(zone.id);
      const confirmedAt = confirmation?.opposingEngulfingConfirmedAt;
      return { id: zone.id, ...(zone.name ? { name: zone.name } : {}), timeframe, isBuy: zone.isBuy, bottom: zone.bottom, top: zone.top,
        ...(confirmedAt !== undefined && confirmedAt <= asOf ? { engulfingConfirmedAt: confirmedAt,
          ...(confirmation?.opposingConfirmationRoute ? { confirmationRoute: confirmation.opposingConfirmationRoute } : {}) } : {}) };
    });
}

/** Only an already-confirmed opposing zone can block entry before one full stop distance. */
export function goldOpposingZoneBeforeOneR(
  signal: Pick<Mt5SignalInput, 'direction' | 'entry' | 'stopLoss' | 'signalAt'> & { calculatedAt?: number },
  zones: readonly GoldOpposingZone[],
): { zone: GoldOpposingZone; rewardRisk: number } | undefined {
  const risk = Math.abs(signal.entry - signal.stopLoss);
  if (!Number.isFinite(risk) || risk <= 0 || !Number.isFinite(signal.entry)) return undefined;
  let nearest: { zone: GoldOpposingZone; rewardRisk: number } | undefined;
  for (const zone of zones) {
    if (!Number.isFinite(zone.opposingEngulfingConfirmedAt)
      || (zone.opposingZoneTimeframe === 'H4' && zone.opposingConfirmationRoute !== 'MTF_CHOCH')
      || zone.opposingEngulfingConfirmedAt! > (signal.calculatedAt ?? signal.signalAt)
      || !zone.active || zone.status !== 'valid' || zone.isBuy === (signal.direction === 'BUY')
      || zone.startTime > signal.signalAt
      || (zone.activeFromTime !== undefined && zone.activeFromTime > signal.signalAt)
      || (zone.invalidatedAt !== undefined && zone.invalidatedAt <= signal.signalAt)) continue;
    const bottom = Math.min(zone.bottom, zone.top);
    const top = Math.max(zone.bottom, zone.top);
    if (!Number.isFinite(bottom) || !Number.isFinite(top)) continue;
    const inTradePath = signal.direction === 'BUY' ? top >= signal.entry : bottom <= signal.entry;
    if (!inTradePath) continue;
    const distance = signal.direction === 'BUY'
      ? Math.max(0, bottom - signal.entry)
      : Math.max(0, signal.entry - top);
    if (distance >= risk) continue;
    const rewardRisk = distance / risk;
    if (!nearest || rewardRisk < nearest.rewardRisk) nearest = { zone, rewardRisk };
  }
  return nearest;
}

export function goldAutomationOpposingZoneBlocked(
  signal: Mt5SignalInput,
  zones: readonly StructureZone[],
): boolean {
  return signal.tradeStyle !== 'SCALP_1_1' && goldOpposingZoneBeforeOneR(signal, zones) !== undefined;
}

/** One unusually large completed minute must not consume the whole planned stop. */
export function goldAutomationFastMoveBlocked(signal: Mt5SignalInput): boolean {
  if (signal.signalTimeframe !== 'M1') return false;
  const candles = (signal.journalContext?.entrySnapshotCandles ?? [])
    .filter((candle) => candle.complete !== false && candle.time + 60 <= signal.calculatedAt)
    .slice(-23);
  if (candles.length < 23) return false;
  const ranges = candles.map((candle) => candle.high - candle.low);
  const baseline = ranges.slice(0, 20).sort((a, b) => a - b);
  const median = (baseline[9] + baseline[10]) / 2;
  const stopDistance = Math.abs(signal.entry - signal.stopLoss);
  return median > 0 && ranges.slice(-3).some((range) => (
    range >= stopDistance && range >= 2 * median
  ));
}

/** A stopped price area stays unavailable until a new completed M15 CHoCH. */
export function goldAutomationRepeatAreaBlocked(
  signal: Mt5SignalInput,
  previous: readonly Mt5StoredSignal[],
  m15Lines: readonly StructureLine[],
): boolean {
  if (signal.tradeStyle === 'SCALP_1_1') return false;
  const lower = Math.min(signal.entry, signal.stopLoss);
  const upper = Math.max(signal.entry, signal.stopLoss);
  return previous.some((prior) => {
    if (prior.status !== 'SL' || prior.symbol !== signal.symbol
      || prior.direction !== signal.direction || !prior.closedAt
      || prior.closedAt >= signal.signalAt) return false;
    const priorLower = Math.min(prior.entry, prior.stopLoss);
    const priorUpper = Math.max(prior.entry, prior.stopLoss);
    if (lower > priorUpper || upper < priorLower) return false;
    const direction = signal.direction === 'BUY' ? 'bullish' : 'bearish';
    return !m15Lines.some((line) => line.type === 'choch' && line.direction === direction
      && line.toTime + 900 > prior.closedAt && line.toTime + 900 <= signal.signalAt);
  });
}

/** Forex Factory weekly export carries timezone offsets in each event date. */
export function goldAutomationHighImpactUsdNewsTimes(payload: unknown): number[] {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Forex Factory calendar is empty or invalid.');
  }
  let datedEvents = 0;
  const events = payload.flatMap((event: unknown) => {
    if (!event || typeof event !== 'object') return [];
    const row = event as Record<string, unknown>;
    if (typeof row.date !== 'string' || !Number.isFinite(Date.parse(row.date))) return [];
    datedEvents += 1;
    return row.country === 'USD' && row.impact === 'High'
      ? [Date.parse(row.date) / 1000] : [];
  });
  if (datedEvents === 0) throw new Error('Forex Factory calendar contains no valid dates.');
  return [...new Set(events)].sort((a, b) => a - b);
}

export function goldAutomationNewsPauseUntil(
  events: readonly number[], now: number, blackoutSeconds = 15 * 60,
): number | undefined {
  const event = events.find((time) => Math.abs(time - now) <= blackoutSeconds);
  return event === undefined ? undefined : event + blackoutSeconds;
}

/** One structure origin stays the same zone when its quoted price is revised. */
export function tradeZoneExecutionKey(signal: {
  symbol?: string; zoneTimeframe: string; zoneId?: string; setupId?: string;
}): string | undefined {
  const direct = signal.setupId?.match(/^(?:GOLD_SCALP|DIRECT):(M1|M5|M15|M30|H1|H4|D):(.+)$/);
  const zoneId = signal.zoneId ?? direct?.[2];
  if (!zoneId) return undefined;
  const origin = zoneId.replace(/^(.+-\d{9,})-\d+(?:\.\d+)?$/, '$1');
  return `${signal.symbol ?? 'XAUUSD'}:${direct?.[1] ?? signal.zoneTimeframe}:${origin}`;
}

export interface ZoneTradeRecord {
  id: string;
  symbol?: string;
  zoneTimeframe?: string;
  zoneId?: string;
  setupId?: string;
  signalAt?: number;
  signalTimeframe?: TradeTimeframe;
  openedAt?: number;
  outsideTradingTime?: boolean;
  mt5Managed?: boolean;
  brokerTicket?: number;
  brokerPosition?: number;
}

/** A simulated chart fill or an MT5 label alone is not proof of broker execution. */
export function confirmedBrokerZoneEntry(record: ZoneTradeRecord): boolean {
  return Number.isFinite(record.openedAt) && record.openedAt! > 0
    && [record.brokerTicket, record.brokerPosition].some(ticket => Number.isSafeInteger(ticket) && ticket! > 0);
}

/** Read explicit zone identity and migrate older direct/scalp journal IDs. */
export function tradeRecordZoneExecutionKey(record: ZoneTradeRecord): string | undefined {
  if (!record.zoneTimeframe) return undefined;
  const parts = record.id.split(':');
  const legacyZoneId = parts[0] === 'DIRECT' ? parts.slice(
    /^(M1|M5|M15|M30|H1|H4|D)$/.test(parts[1]) ? 2 : 1, -2,
  ).join(':')
    : parts[0] === 'GOLD_SCALP' ? parts.slice(2, -2).join(':') : undefined;
  return tradeZoneExecutionKey({
    ...record, zoneTimeframe: record.zoneTimeframe,
    zoneId: record.zoneId ?? legacyZoneId,
  });
}

export function findEarlierZoneEntry(
  candidate: { symbol: string; zoneTimeframe: string; zoneId?: string; setupId?: string; signalAt: number },
  records: readonly ZoneTradeRecord[],
): ZoneTradeRecord | undefined {
  const key = tradeZoneExecutionKey(candidate);
  if (!key) return undefined;
  return records.find((record) => confirmedBrokerZoneEntry(record)
    && Number.isFinite(record.signalAt) && record.signalAt! < candidate.signalAt
    && tradeRecordZoneExecutionKey(record) === key);
}

/** Different confirmation timeframes can describe the same completed entry event. */
export function isSameZoneEntryConfirmation(
  candidate: { symbol: string; zoneTimeframe: string; zoneId: string;
    signalAt: number; signalTimeframe: TradeTimeframe },
  record: ZoneTradeRecord,
): boolean {
  if (!record.signalTimeframe || !Number.isFinite(record.signalAt)) return false;
  const seconds = (timeframe: TradeTimeframe) => timeframe === 'D' ? 86400
    : Number(timeframe.slice(1)) * (timeframe.startsWith('H') ? 3600 : 60);
  return tradeZoneExecutionKey(candidate) === tradeRecordZoneExecutionKey(record)
    && candidate.signalAt + seconds(candidate.signalTimeframe)
      === record.signalAt! + seconds(record.signalTimeframe);
}

/** Scalp, Major Liquidity and intraday routes consume the same Gold zone. */
export function goldMt5ZoneExecutionKey(signal: Pick<Mt5SignalInput,
  'symbol' | 'zoneTimeframe' | 'zoneId' | 'setupId'>): string | undefined {
  if (signal.symbol !== 'XAUUSD') return undefined;
  return tradeZoneExecutionKey(signal);
}

export function priorGoldMt5ZoneExecution<T extends Pick<Mt5SignalInput,
  'symbol' | 'zoneTimeframe' | 'zoneId' | 'setupId'> & Partial<Mt5SignalInput> & { status: Mt5SignalStatus }>(
  candidate: Pick<Mt5SignalInput, 'symbol' | 'zoneTimeframe' | 'zoneId' | 'setupId'> & Partial<Mt5SignalInput>,
  signals: readonly T[],
  consumedStatuses: ReadonlySet<Mt5SignalStatus>,
): T | undefined {
  const zoneKey = goldMt5ZoneExecutionKey(candidate);
  return zoneKey === undefined ? undefined : signals.find((signal) => (
    consumedStatuses.has(signal.status)
    && goldMt5ZoneExecutionKey(signal) === zoneKey
    && !(sameIntradayPullbackSetup(candidate as Mt5SignalInput, signal as Mt5SignalInput)
      && candidate.intradayEntry!.leg !== signal.intradayEntry!.leg
      && ['QUEUED', 'CLAIMED', 'PLACED', 'ACTIVE', 'RISK_FREE'].includes(signal.status))
  ));
}

export interface Mt5StoredSignal extends Mt5SignalInput {
  /** Set only by the server scanner after all strategy and execution prechecks pass. */
  entryQualifiedAt?: number;
  account?: string;
  server?: string;
  brokerSymbol?: string;
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

/** Only a verified, unfilled opportunity can retire a zone as ENTRY MISSED. */
export function findMissedZoneEntry(
  candidate: Pick<Mt5SignalInput, 'symbol' | 'zoneTimeframe' | 'zoneId' | 'setupId'>,
  signals: readonly Mt5StoredSignal[],
  connection: { account?: string; server?: string; brokerSymbol?: string },
): Mt5StoredSignal | undefined {
  const key = tradeZoneExecutionKey(candidate);
  return key === undefined ? undefined : signals.find(signal => signal.status === 'EXPIRED'
    && Number.isFinite(signal.entryQualifiedAt) && signal.entryQualifiedAt! > 0
    && !confirmedBrokerZoneEntry(signal)
    && mt5ConnectionMatches(connection, signal) && tradeZoneExecutionKey(signal) === key);
}

/** Require the exact account, broker server and resolved contract before reusing execution data. */
export function mt5ConnectionMatches(
  expected: { account?: string; server?: string; brokerSymbol?: string } | undefined,
  candidate: { account?: string; server?: string; brokerSymbol?: string },
): boolean {
  return !!expected?.account && !!expected.server && !!expected.brokerSymbol
    && expected.account === candidate.account && expected.server === candidate.server
    && expected.brokerSymbol === candidate.brokerSymbol;
}

export type Mt5DailyRisk = { available: false; error: string } | {
  available: true;
  date: string;
  startingBalance: number;
  limitPercent: number;
  limitMoney: number;
  realizedLossMoney: number;
  floatingLossMoney: number;
  usedMoney: number;
  usedPercent: number;
  remainingMoney: number;
  remainingPercent: number;
  reservedRiskMoney: number;
  availableRiskMoney: number;
  availableRiskPercent: number;
  limitReached: boolean;
  riskUnbounded: boolean;
};

export type Mt5OverallProfit = { available: false; error: string } | {
  available: true;
  realizedProfitMoney: number;
  realizedLossMoney: number;
  netRealizedMoney: number;
  floatingMoney: number;
  netMoney: number;
};

export function sanitizeMt5OverallProfit(value: any): Mt5OverallProfit | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (value.available !== true) return { available: false,
    error: String(value.error || 'Overall profit/loss is unavailable.').slice(0, 300) };
  const fields = ['realizedProfitMoney', 'realizedLossMoney', 'netRealizedMoney', 'floatingMoney', 'netMoney'] as const;
  if (fields.some(key => typeof value[key] !== 'number' || !Number.isFinite(value[key]))
    || value.realizedProfitMoney < 0 || value.realizedLossMoney < 0
    || Math.abs(value.netRealizedMoney - (value.realizedProfitMoney - value.realizedLossMoney)) > 0.01
    || Math.abs(value.netMoney - (value.netRealizedMoney + value.floatingMoney)) > 0.01) {
    return { available: false, error: 'Invalid overall profit/loss data.' };
  }
  return { available: true, ...Object.fromEntries(fields.map(key => [key, value[key]])) } as Mt5OverallProfit;
}

export function normalizeMt5DailyLossPercent(value: unknown, fallback = 2): number {
  const number = Number(value);
  return Math.min(5, Math.max(0.1, Number.isFinite(number) ? number : fallback));
}

export function sanitizeMt5DailyRisk(value: any): Mt5DailyRisk | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (value.available !== true) return { available: false, error: String(value.error || 'Daily risk is unavailable.').slice(0, 300) };
  const fields = ['startingBalance', 'limitPercent', 'limitMoney', 'realizedLossMoney', 'floatingLossMoney',
    'usedMoney', 'usedPercent', 'remainingMoney', 'remainingPercent', 'reservedRiskMoney',
    'availableRiskMoney', 'availableRiskPercent'] as const;
  if (fields.some((key) => typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)
    || value.startingBalance <= 0 || value.limitPercent < 0.1 || value.limitPercent > 5
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    return { available: false, error: 'Invalid daily risk data; new automated trades are paused.' };
  }
  return { available: true, date: value.date, ...Object.fromEntries(fields.map((key) => [key, value[key]])),
    limitReached: value.limitReached === true, riskUnbounded: value.riskUnbounded === true } as Mt5DailyRisk;
}

export function mt5DailyRiskAllowsEntry(risk: Mt5DailyRisk | undefined): boolean {
  return risk?.available === true && !risk.limitReached && !risk.riskUnbounded
    && risk.usedMoney < risk.limitMoney && risk.availableRiskMoney > 1e-8;
}

export interface Mt5AutomationStatus {
  ok: boolean;
  newsCalendar?: { available: boolean; error?: string; pausedUntil?: number };
  entryChecks?: Array<Pick<Mt5SignalInput, 'zoneId' | 'setupId' | 'zoneTimeframe' | 'signalTimeframe'
    | 'signalAt' | 'symbol' | 'direction'> & {
    checkedAt: number; account?: string; server?: string; brokerSymbol?: string;
    mode: 'WAIT' | 'BLOCKED' | 'DISABLED'; reasons: string[];
  }>;
  config: Mt5AutomationConfig;
  bridge: {
    fibProfitEvents?: Mt5FibProfitEvent[];
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
    terminalConnected?: boolean;
    symbolResolved?: boolean;
    symbolCandidates?: string[];
    dailyRisk?: Mt5DailyRisk;
    overallProfit?: Mt5OverallProfit;
    capital?: import('./mt5Capital').CapitalView;
    lastHeartbeatAt?: number;
    message?: string;
    logs?: string[];
  };
  positions: Array<{
    ticket: number;
    identifier?: number;
    openedAtMsc?: number;
    fibExitTimeframe?: TradeTimeframe;
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
  missedEntries?: Mt5StoredSignal[];
}

export const MT5_FIB_EXIT_TIMEFRAMES: readonly TradeTimeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D'];

/** A manual assignment belongs to one exact position, not the currently viewed chart. */
export function manualTradeTimeframeKey(
  connection: { account?: string; server?: string; brokerSymbol?: string },
  position: { ticket: number; symbol: string; identifier?: number; openedAtMsc?: number },
): string | undefined {
  if (!connection.account || !connection.server || !connection.brokerSymbol
    || position.symbol !== connection.brokerSymbol
    || ![position.ticket, position.identifier, position.openedAtMsc].every(value => (
      Number.isSafeInteger(value) && value! > 0
    ))) return undefined;
  return JSON.stringify([connection.account, connection.server, position.symbol,
    position.ticket, position.identifier, position.openedAtMsc]);
}

export function positionFibExitTimeframe(
  connection: { account?: string; server?: string; brokerSymbol?: string },
  position: { ticket: number; symbol: string; magic?: number; identifier?: number; openedAtMsc?: number },
  config: Pick<Mt5AutomationConfig, 'manualTradeTimeframes'>, signals: readonly Mt5StoredSignal[],
): TradeTimeframe | undefined {
  if (position.magic === 0) {
    const key = manualTradeTimeframeKey(connection, position);
    const value = key ? config.manualTradeTimeframes?.[key] : undefined;
    return value && MT5_FIB_EXIT_TIMEFRAMES.includes(value) ? value : undefined;
  }
  const matches = signals.filter(signal => mt5ConnectionMatches(connection, signal)
    && [position.ticket, position.identifier].some(ticket => ticket !== undefined
      && (signal.brokerPosition === ticket || signal.brokerTicket === ticket)));
  const timeframes = new Set(matches.map(signal => signal.zoneTimeframe));
  const value = timeframes.size === 1 ? [...timeframes][0] : undefined;
  return value && MT5_FIB_EXIT_TIMEFRAMES.includes(value) ? value : undefined;
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
  if (signal.tradeStyle === 'SCALP_1_1' || signal.intradayEntry) return signal;
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
