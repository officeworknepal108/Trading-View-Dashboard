import type { JournalTradeRecord } from '../components/TradeJournal';
import type { Mt5SignalInput, Mt5StoredSignal } from './mt5Automation';
import type { StructureCandle } from './marketStructure';
import type { TradeLevels, TradeTimeframe } from './tradeLevels';
import { entryTimeframeSeconds } from './intradayPullback';
import { pullbackExpirySeconds } from './pullbackExpiry';
import { chartPullbackState, confirmedPullbackFill, currentPullbackDisplay, groupPullbackTableSignals, type PullbackTableSignal } from './pullbackEntryDisplay';

export interface PullbackChartLeg {
  leg: 10 | 25; entry: number; riskPips: number;
  filled: boolean; filledAt?: number; uncertain: boolean; executed: boolean;
  chartConfirmed?: boolean;
  chartOutcome?: 'tp' | 'sl' | 'both';
  chartResolvedAt?: number;
  outcome?: 'tp' | 'sl' | 'both';
}
export interface PullbackChartSetup {
  secondOnly: boolean;
  telegramKey: string;
  id: string; symbol: 'XAUUSD'; style: 'SCALP_1_1' | 'INTRADAY';
  setupId?: string; trade: TradeLevels; legs: PullbackChartLeg[];
  chartTimeframe: TradeTimeframe; zoneTimeframe: TradeTimeframe;
  referenceOnly: boolean; chartFilled: boolean; alwaysVisible: boolean;
  drawing: boolean; markerTime?: number; markerText: string; label: string;
  memberIds: string[];
}

export function chartSignalFromRecord(record: JournalTradeRecord): PullbackTableSignal | undefined {
  if (!(record.scalpEntry || record.intradayEntry) || record.signalAt === undefined) return;
  const seconds = entryTimeframeSeconds(record.signalTimeframe);
  const closed = record.result === 'tp' || record.result === 'sl';
  return { id: record.id, setupId: record.setupId, symbol: record.symbol ?? 'XAUUSD',
    source: record.source, tradeStyle: record.tradeStyle, zoneName: record.zoneName, brokerTicket: record.brokerTicket,
    zoneTimeframe: record.zoneTimeframe, signalTimeframe: record.signalTimeframe,
    signalAt: record.signalAt, calculatedAt: record.signalAt + seconds,
    direction: record.direction === 'bullish' ? 'BUY' : 'SELL', orderType: 'LIMIT',
    engulfingType: record.engulfingType, entry: record.entry, stopLoss: record.stopLoss,
    takeProfit: record.takeProfit, riskFree: record.takeProfit, rewardRisk: record.rewardRisk,
    riskPips: record.riskPips, expiresAt: record.signalAt + seconds + pullbackExpirySeconds((record.scalpEntry ?? record.intradayEntry)!.version, seconds),
    scalpEntry: record.scalpEntry, intradayEntry: record.intradayEntry, pullbackFallback: record.pullbackFallback,
    status: closed ? record.result === 'tp' ? 'TP' : 'SL' : 'ACTIVE',
    openedAt: record.openedAt, closedAt: closed ? record.completedAt : undefined,
    createdAt: record.signalAt + seconds, updatedAt: record.completedAt,
    preview: !(record.mt5Managed || record.brokerTicket !== undefined),
    simulatedFill: !(record.mt5Managed || record.brokerTicket !== undefined) && record.openedAt !== undefined };
}

/** Presentation only: a single fixed-exit drawing and marker, with independent leg facts. */
export function buildPullbackChartSetups(options: {
  signals: readonly PullbackTableSignal[]; asOf: number;
  candles: Partial<Record<TradeTimeframe, readonly StructureCandle[]>>;
  positions?: Parameters<typeof confirmedPullbackFill>[2];
  context?: Pick<Mt5StoredSignal, 'account' | 'server' | 'brokerSymbol'>;
}): PullbackChartSetup[] {
  const { asOf, context = {}, positions = [] } = options;
  const signals = options.signals.filter(s => s.symbol === 'XAUUSD' && (s.scalpEntry || s.intradayEntry)
    && s.calculatedAt <= asOf && (!s.account || !context.account || s.account === context.account)
    && (!s.server || !context.server || s.server === context.server)
    && (!s.brokerSymbol || !context.brokerSymbol || s.brokerSymbol === context.brokerSymbol))
    .map(s => {
      const projected = currentPullbackDisplay(s, asOf, positions);
      return { ...projected, stopLoss: projected.initialStopLoss ?? projected.stopLoss };
    });
  return groupPullbackTableSignals(signals, context).map(({ key, entries }): PullbackChartSetup => {
    const base = entries[0], meta = (base.scalpEntry ?? base.intradayEntry)!;
    const secondOnly = entries.some(s => s.pullbackFallback === 'SECOND_ONLY');
    const buy = base.direction === 'BUY', sign = buy ? 1 : -1;
    const candles = options.candles[base.signalTimeframe] ?? [];
    const states = ([10, 25] as const).map(leg => {
      const saved = entries.find(s => (s.scalpEntry ?? s.intradayEntry)!.leg === leg);
      const raw = meta.nextOpen - sign * meta.confirmationBody * leg / 100;
      const entry = saved?.entry ?? (meta.version >= 2 ? raw : buy ? Math.min(raw, meta.referenceEntry) : Math.max(raw, meta.referenceEntry));
      const signal: Mt5SignalInput = saved ?? { ...base, entry, riskPips: Math.abs(entry - base.stopLoss) * 10,
        rewardRisk: Math.abs(base.takeProfit - entry) / Math.abs(entry - base.stopLoss),
        ...(base.scalpEntry ? { scalpEntry: { ...meta, leg, riskShare: leg === 10 ? .6 : .4 } }
          : { intradayEntry: { ...base.intradayEntry!, leg, riskShare: leg === 10 ? .6 : .4 } }) };
      const chart = chartPullbackState(signal, candles, asOf);
      const known = saved?.openedAt !== undefined && saved.openedAt <= asOf
        && (saved.simulatedFill || confirmedPullbackFill(saved, asOf, positions));
      const executed = !!saved && confirmedPullbackFill(saved, asOf, positions);
      const filled = !(secondOnly && leg === 10) && (chart.status === 'filled' || !!known);
      const brokerExit = saved?.closedAt !== undefined && saved.closedAt <= asOf
        && (saved.status === 'TP' || saved.status === 'SL') ? saved.status.toLowerCase() as 'tp' | 'sl' : undefined;
      return { leg, entry, riskPips: Math.abs(entry - base.stopLoss) * 10, filled,
        chartConfirmed: !(secondOnly && leg === 10) && chart.status === 'filled',
        chartOutcome: chart.outcome?.level, chartResolvedAt: chart.outcome?.at,
        filledAt: filled ? chart.filledAt ?? saved?.openedAt : undefined,
        uncertain: chart.status === 'ambiguous' || chart.status === 'unavailable', executed,
        outcome: chart.outcome?.level ?? brokerExit,
        resolvedAt: chart.outcome?.at ?? (brokerExit ? saved?.closedAt : undefined),
        expired: chart.status === 'expired' };
    });
    const filled = states.filter(s => s.filled);
    const exits = filled.filter(s => s.outcome);
    const result = filled.length && exits.length === filled.length && exits.every(s => s.outcome === exits[0].outcome)
      && (exits[0].outcome === 'tp' || exits[0].outcome === 'sl') ? exits[0].outcome : undefined;
    const markerTime = filled.length ? states[0].filledAt ?? Math.min(...filled.map(s => s.filledAt!)) : undefined;
    const entry = states[secondOnly ? 1 : 0].entry, risk = Math.abs(entry - base.stopLoss);
    const resolvedAt = exits.length ? Math.max(...exits.map(s => s.resolvedAt ?? 0)) : undefined;
    const parent = (base.intradayEntry?.setupKey ?? base.setupId ?? '').replace(/:secondary$/, '').replace(/:P(?:10|25)$/, '');
    const identity = [base.tradeStyle, base.symbol, base.source, base.zoneTimeframe, base.signalTimeframe,
      base.signalAt, base.direction, parent, meta.referenceEntry, base.stopLoss, base.takeProfit].join(':');
    let hash = 14695981039346656037n;
    for (const ch of identity) hash = BigInt.asUintN(64, (hash ^ BigInt(ch.charCodeAt(0))) * 1099511628211n);
    return { id: `PULLBACK_SETUP:${key}`, telegramKey: `CHART_SETUP:${base.tradeStyle}:${base.signalAt}:${hash.toString(16)}`,
      secondOnly, symbol: 'XAUUSD', style: base.scalpEntry ? 'SCALP_1_1' : 'INTRADAY',
      memberIds: entries.flatMap(s => [s.id, s.setupId,
        s.brokerTicket === undefined ? undefined : `MT5:${s.brokerTicket}`,
        s.brokerPosition === undefined ? undefined : `MT5:${s.brokerPosition}`].filter((id): id is string => !!id)),
      setupId: base.setupId, legs: states, chartTimeframe: base.signalTimeframe, zoneTimeframe: base.zoneTimeframe,
      referenceOnly: !filled.length, chartFilled: !!filled.length, alwaysVisible: !!filled.length && !exits.length,
      drawing: !exits.length && (filled.length > 0 || asOf < base.expiresAt && states.some(s => !s.expired)),
      markerTime, markerText: result?.toUpperCase() ?? '', label: '',
      trade: { entry, stopLoss: base.stopLoss, takeProfit: base.takeProfit,
        riskFree: base.takeProfit, riskFreeEnabled: false, riskPips: risk * 10,
        rewardRisk: Math.abs(base.takeProfit - entry) / risk,
        calculatedAt: markerTime ?? base.calculatedAt, filledAt: markerTime,
        status: result === 'tp' ? 'tp-hit' : result === 'sl' ? 'sl-hit' : filled.length ? 'active' : 'pending',
        pendingAtCreation: true, result, resolvedAt,
        signal: { direction: buy ? 'bullish' : 'bearish', time: base.signalAt, timeframe: base.signalTimeframe,
          type: base.engulfingType as TradeLevels['signal']['type'], candleCount: base.engulfingType === 'T1' ? 2 : 3 } } };
  });
}

export function belongsToPullbackSetup(setup: PullbackChartSetup, trade: TradeLevels, style?: string,
  identity?: { id?: string; setupId?: string }): boolean {
  if (style && style !== setup.style) return false;
  if (identity && [identity.id, identity.setupId].some(id => id && setup.memberIds.includes(id))) return true;
  return (!style || style === setup.style) && trade.signal.time === setup.trade.signal.time
    && trade.signal.timeframe === setup.trade.signal.timeframe && trade.signal.direction === setup.trade.signal.direction
    && Math.abs(trade.stopLoss - setup.trade.stopLoss) < 1e-6 && Math.abs(trade.takeProfit - setup.trade.takeProfit) < 1e-6;
}
