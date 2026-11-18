import { getDirectTradeRule, type TradeRule, type TradeTimeframe } from './tradeLevels';
import { goldIntradayMtfTradeRule, isGoldIntradayCandleRoute } from './goldScalping';
import type { Mt5SignalInput, ScalpPullbackEntry } from './mt5Automation';
import type { StructureCandle } from './marketStructure';
import type { JournalTradeRecord } from '../components/TradeJournal';
import { scalpPullbackBarStates } from './scalpOneToOne';
import { isNepalTradingTime } from './tradingTime';
import { PULLBACK_EXPIRY_SECONDS, pullbackExpirySeconds } from './pullbackExpiry';

export interface IntradayPullbackEntry extends ScalpPullbackEntry {
  /** Original zone/confirmation identity, shared only by its two planned legs. */
  setupKey: string;
}

export function entryTimeframeSeconds(timeframe: TradeTimeframe): number {
  return timeframe === 'D' ? 86400 : Number(timeframe.slice(1)) * (timeframe.startsWith('H') ? 3600 : 60);
}

export function intradayReferenceRule(signal: Pick<Mt5SignalInput, 'source' | 'zoneTimeframe' | 'signalTimeframe'>): TradeRule | undefined {
  return signal.source === 'MTF' ? goldIntradayMtfTradeRule(signal.zoneTimeframe, signal.signalTimeframe)
    : isGoldIntradayCandleRoute(signal.zoneTimeframe, signal.signalTimeframe)
      ? getDirectTradeRule(signal.zoneTimeframe, signal.signalTimeframe) : undefined;
}

export function sameIntradayPullbackSetup(a: Pick<Mt5SignalInput,
  'intradayEntry' | 'tradeStyle' | 'symbol' | 'direction' | 'signalAt' | 'signalTimeframe'>,
  b: Pick<Mt5SignalInput, 'intradayEntry' | 'tradeStyle' | 'symbol' | 'direction' | 'signalAt' | 'signalTimeframe'>): boolean {
  return a.tradeStyle === 'INTRADAY' && b.tradeStyle === 'INTRADAY' && !!a.intradayEntry && !!b.intradayEntry
    && a.intradayEntry.setupKey === b.intradayEntry.setupKey && a.symbol === b.symbol
    && a.direction === b.direction && a.signalAt === b.signalAt && a.signalTimeframe === b.signalTimeframe;
}

export function intradayPullbackSignalError(signal: Mt5SignalInput): string | undefined {
  const leg = signal.intradayEntry;
  if (!leg) return undefined;
  const rule = intradayReferenceRule(signal), seconds = entryTimeframeSeconds(signal.signalTimeframe);
  const sign = signal.direction === 'BUY' ? 1 : -1;
  const share = leg.leg === 10 ? 0.6 : leg.leg === 25 ? 0.4 : 0;
  const raw = leg.nextOpen - sign * leg.confirmationBody * leg.leg / 100;
  const expected = leg.version >= 2 ? raw : sign === 1 ? Math.min(raw, leg.referenceEntry) : Math.max(raw, leg.referenceEntry);
  const risk = sign * (signal.entry - signal.stopLoss), reward = sign * (signal.takeProfit - signal.entry);
  const referenceRisk = sign * (leg.referenceEntry - signal.stopLoss);
  const referenceReward = sign * (signal.takeProfit - leg.referenceEntry);
  if (!rule || signal.tradeStyle !== 'INTRADAY' || signal.symbol !== 'XAUUSD' || signal.scalpEntry
    || ![1, 2, 3].includes(leg.version) || !share || leg.riskShare !== share
    || typeof leg.setupKey !== 'string' || !leg.setupKey || leg.setupKey.length > 400
    || ![signal.entry, signal.stopLoss, signal.takeProfit, signal.rewardRisk, signal.riskPips,
      signal.signalAt, signal.calculatedAt, signal.expiresAt, leg.referenceEntry, leg.nextOpen,
      leg.confirmationBody].every(v => Number.isFinite(v) && v > 0)
    || signal.orderType !== 'LIMIT' || Math.abs(expected - signal.entry) > 1e-6
    || referenceRisk <= 0 || referenceRisk * 10 > rule.maximumRiskPips + 1e-5
    || Math.abs(referenceReward - referenceRisk * rule.rewardRisk) > 1e-6
    || risk <= 0 || risk * 10 > rule.maximumRiskPips + 1e-5 || reward <= 0
    || Math.abs(signal.rewardRisk - reward / risk) > 1e-6
    || Math.abs(signal.riskPips - risk * 10) > 1e-5
    || signal.calculatedAt !== signal.signalAt + seconds
    || signal.expiresAt !== signal.calculatedAt + pullbackExpirySeconds(leg.version, seconds)) {
    return 'Invalid Intraday pullback entry, risk split or original fixed SL/TP.';
  }
  return undefined;
}

/** Called only after the original Intraday setup passes its existing qualification. */
export function buildIntradayPullbackSignals(base: Mt5SignalInput, candles: readonly StructureCandle[]): Mt5SignalInput[] {
  if (base.tradeStyle !== 'INTRADAY' || base.symbol !== 'XAUUSD') return [base];
  const rule = intradayReferenceRule(base), seconds = entryTimeframeSeconds(base.signalTimeframe);
  const confirmation = candles.find(c => c.time === base.signalAt);
  const confirmedAt = base.signalAt + seconds;
  const next = candles.find(c => c.time === confirmedAt);
  if (!rule || !confirmation || confirmation.complete === false || !next) return [];
  const body = Math.abs(confirmation.close - confirmation.open);
  if (!(body > 0)) return [];
  const sign = base.direction === 'BUY' ? 1 : -1;
  const parent = base.setupId ?? `${base.source}:${base.zoneTimeframe}:${base.zoneId ?? base.id}`;
  const setupKey = `${parent}:${base.signalTimeframe}:${base.signalAt}:${base.direction}`;
  return ([10, 25] as const).flatMap(leg => {
    const entry = next.open - sign * body * leg / 100;
    const risk = sign * (entry - base.stopLoss), reward = sign * (base.takeProfit - entry);
    if (!(risk > 0 && reward > 0)) return [];
    const signal: Mt5SignalInput = { ...base, id: `${base.id}:INTRA:P${leg}`,
      setupId: `${parent}:P${leg}`, orderType: 'LIMIT', entry, riskPips: risk * 10,
      rewardRisk: reward / risk, normalRewardRisk: reward / risk,
      calculatedAt: confirmedAt, expiresAt: confirmedAt + PULLBACK_EXPIRY_SECONDS,
      intradayEntry: { version: 3, leg, riskShare: leg === 10 ? 0.6 : 0.4,
        referenceEntry: base.entry, nextOpen: next.open, confirmationBody: body, setupKey },
      journalContext: base.journalContext && { ...base.journalContext,
        autoReason: `${base.journalContext.autoReason} ${leg}% body pullback; ${leg === 10 ? 60 : 40}% of setup risk. Original SL/TP fixed.` },
    };
    return intradayPullbackSignalError(signal) ? [] : [signal];
  });
}

/** Replay fill windows without assuming that the next candle's low was known in advance. */
export function intradayPullbackChartRecords(reference: JournalTradeRecord,
  sourceCandles: readonly StructureCandle[], executionCandles: readonly StructureCandle[], asOf: number): JournalTradeRecord[] {
  if ((reference.symbol && reference.symbol !== 'XAUUSD') || reference.tradeStyle !== 'INTRADAY' || reference.intradayEntry || reference.mt5Managed
    || reference.brokerTicket !== undefined) return [reference];
  const seconds = entryTimeframeSeconds(reference.signalTimeframe), confirmedAt = (reference.signalAt ?? 0) + seconds;
  const parent = reference.setupId ?? (reference.source === 'ENGULFING'
    ? `DIRECT:${reference.zoneTimeframe}:${reference.zoneId ?? reference.id}` : reference.id);
  const base: Mt5SignalInput = { id: reference.id, setupId: parent, zoneId: reference.zoneId,
    symbol: reference.symbol ?? 'XAUUSD', tradeStyle: 'INTRADAY', source: reference.source,
    direction: reference.direction === 'bullish' ? 'BUY' : 'SELL', orderType: 'MARKET',
    zoneName: reference.zoneName, zoneTimeframe: reference.zoneTimeframe, signalTimeframe: reference.signalTimeframe,
    engulfingType: reference.engulfingType, signalAt: reference.signalAt ?? 0, calculatedAt: confirmedAt,
    entry: reference.entry, stopLoss: reference.stopLoss, takeProfit: reference.takeProfit,
    rewardRisk: reference.rewardRisk, riskPips: reference.riskPips, riskFree: reference.takeProfit,
    expiresAt: confirmedAt + seconds };
  const signals = buildIntradayPullbackSignals(base, sourceCandles);
  return replayIntradayPullbackSignals(reference, signals, executionCandles, asOf);
}

/** Replay either newly calculated limits or a saved leg with its original prices and expiry. */
export function replayIntradayPullbackSignals(reference: JournalTradeRecord,
  signals: Mt5SignalInput[], executionCandles: readonly StructureCandle[], asOf: number): JournalTradeRecord[] {
  if (!signals.length) return [];
  const seconds = entryTimeframeSeconds(reference.signalTimeframe);
  const confirmedAt = (reference.signalAt ?? 0) + seconds;
  // The bar-state engine is direction-independent. Carry filled masks between
  // smaller execution bars until the entry-timeframe candle closes.
  type Scenario = { mask: number; exit: number; filledAt: number[]; resolvedAt?: number };
  let active: Scenario[] = [{ mask: 0, exit: 0, filledAt: [] }];
  const closed: Scenario[] = [];
  const executionSeconds = reference.zoneTimeframe === 'M15' && reference.signalTimeframe === 'M30' ? 900 : seconds;
  let expectedTime = confirmedAt;
  for (const bar of executionCandles) {
    if (bar.complete === false || bar.time < confirmedAt || bar.time + executionSeconds > asOf) continue;
    if (bar.time !== expectedTime) return []; // Missing bars cannot prove a fill or the first exit.
    expectedTime += executionSeconds;
    const next: Scenario[] = [];
    for (const previous of active) {
      const allowFills = bar.time < signals[0].expiresAt;
      if (!allowFills && !previous.mask) { closed.push(previous); continue; }
      if (!allowFills) {
        const buy = reference.direction === 'bullish';
        const target = buy ? bar.high >= reference.takeProfit : bar.low <= reference.takeProfit;
        const stop = buy ? bar.low <= reference.stopLoss : bar.high >= reference.stopLoss;
        const openingTarget = buy ? bar.open >= reference.takeProfit : bar.open <= reference.takeProfit;
        const openingStop = buy ? bar.open <= reference.stopLoss : bar.open >= reference.stopLoss;
        const exits = openingTarget ? [1] : openingStop ? [-1] : target && stop ? [1, -1] : target ? [1] : stop ? [-1] : [];
        if (!exits.length) next.push(previous);
        else for (const exit of exits) closed.push({ ...previous, exit, resolvedAt: bar.time });
        continue;
      }
      const fillModes = allowFills && bar.time + executionSeconds > signals[0].expiresAt ? [true, false] : [allowFills];
      for (const state of fillModes.flatMap(allow => scalpPullbackBarStates(bar, signals, previous.mask, allow))) {
        const filledAt = [...previous.filledAt];
        signals.forEach((_, i) => { if ((state.mask & (1 << i)) && !(previous.mask & (1 << i))) filledAt[i] = bar.time; });
        const result = { ...state, filledAt, resolvedAt: state.exit ? bar.time : undefined };
        if (state.exit) closed.push(result); else next.push(result);
      }
    }
    active = [...new Map(next.map(s => [`${s.mask}:${s.filledAt.join(',')}`, s])).values()];
    if (!active.length) break;
  }
  const scenarios = [...closed, ...active];
  return signals.flatMap((signal, i) => {
    const outcomes = new Set(scenarios.map(s => !(s.mask & (1 << i)) ? 'unfilled' : String(s.exit)));
    if (outcomes.size !== 1 || outcomes.has('unfilled')) return [];
    const state = scenarios[0], result = state.exit === 1 ? 'tp' as const : state.exit === -1 ? 'sl' as const : 'open' as const;
    return [{ ...reference, id: signal.id,
      setupId: signal.setupId, intradayEntry: signal.intradayEntry, result,
      entry: signal.entry, riskPips: signal.riskPips, rewardRisk: signal.rewardRisk,
      openedAt: state.filledAt[i], completedAt: state.resolvedAt ?? state.filledAt[i],
      outsideTradingTime: !isNepalTradingTime(confirmedAt) || !isNepalTradingTime(state.filledAt[i]),
      autoReason: `CHART ONLY. Intraday ${signal.intradayEntry!.leg}% pullback, ${signal.intradayEntry!.riskShare * 100}% setup risk; original SL/TP fixed.` }];
  });
}
