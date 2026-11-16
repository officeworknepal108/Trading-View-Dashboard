import type { JournalTradeRecord } from '../components/TradeJournal';
import { scalpPullbackSignalError, type Mt5AutomationStatus, type Mt5SignalInput, type Mt5StoredSignal } from './mt5Automation';
import { intradayPullbackSignalError } from './intradayPullback';
import { scalpPullbackBarStates } from './scalpOneToOne';
import type { StructureCandle } from './marketStructure';
import { pullbackExpirySeconds } from './pullbackExpiry';

export interface ChartPullbackState {
  continuityLost?: boolean;
  observedThrough?: number;
  status: 'filled' | 'waiting' | 'expired' | 'ambiguous' | 'unavailable';
  filledAt?: number;
  outcome?: { level: 'tp' | 'sl' | 'both'; at: number };
  beforeEntryExit?: { level: 'tp' | 'sl' | 'both'; at: number };
}

/** Chart simulation only; independent of rejection, lot size and broker execution. */
export function chartPullbackState(signal: Mt5SignalInput, candles: readonly StructureCandle[], asOf: number): ChartPullbackState {
  const seconds = signal.signalTimeframe === 'D' ? 86400
    : Number(signal.signalTimeframe.slice(1)) * (signal.signalTimeframe.startsWith('H') ? 3600 : 60);
  if (signal.calculatedAt > asOf) return { status: 'waiting' };
  if (!(signal.expiresAt > signal.calculatedAt)
    || ![signal.entry, signal.stopLoss, signal.takeProfit].every(value => Number.isFinite(value) && value > 0)) return { status: 'unavailable' };
  const sign = signal.direction === 'BUY' ? 1 : -1;
  if (sign * (signal.entry - signal.stopLoss) <= 0 || sign * (signal.takeProfit - signal.entry) <= 0) return { status: 'unavailable' };
  const bars = [...new Map(candles.filter(c => c.time >= signal.calculatedAt && c.time <= asOf
    && (c.complete === false || c.time + seconds <= asOf)).map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
  if (!bars.length || bars[0].time !== signal.calculatedAt) return { status: 'unavailable' };
  if (sign * (bars[0].open - signal.stopLoss) <= 0 || sign * (signal.takeProfit - bars[0].open) <= 0)
    return { status: 'expired', beforeEntryExit: {
      level: sign * (bars[0].open - signal.stopLoss) <= 0 ? 'sl' : 'tp', at: bars[0].time } };
  type Path = { mask: number; exit: number; filledAt?: number; exitAt?: number };
  // Saved single-entry market setups filled at their entry candle's open on the chart.
  const immediate = signal.orderType === 'MARKET' && !(signal.scalpEntry || signal.intradayEntry);
  let paths: Path[] = [{ mask: immediate ? 1 : 0, exit: 0, filledAt: immediate ? signal.calculatedAt : undefined }];
  let previousTime: number | undefined;
  for (const bar of bars) {
    // A data gap cannot prove a new fill or establish which exit happened first.
    if (previousTime !== undefined && bar.time > previousTime + seconds && paths.some(path => !path.exit)) {
      if (paths.every(path => path.mask)) return { status: 'filled', filledAt: Math.max(...paths.map(path => path.filledAt!)),
        continuityLost: true, observedThrough: previousTime + seconds };
      if (paths.some(path => path.mask)) return { status: 'ambiguous' };
      return { status: previousTime + seconds >= signal.expiresAt ? 'expired' : 'unavailable' };
    }
    previousTime = bar.time;
    const modes = bar.time < signal.expiresAt && bar.time + seconds > signal.expiresAt && asOf > signal.expiresAt
      ? [true, false] : [bar.time < signal.expiresAt];
    const next = paths.flatMap(path => path.exit ? [path] : modes.flatMap(allow => scalpPullbackBarStates(bar, [signal], path.mask,
      allow)).map(state => ({ ...state,
      filledAt: path.filledAt ?? (state.mask ? bar.time : undefined), exitAt: state.exit ? bar.time : undefined })));
    paths = [...new Map(next.map(path => [`${path.mask}:${path.exit}:${path.filledAt}:${path.exitAt}`, path])).values()];
    if (!paths.length) return { status: 'unavailable' };
    if (paths.every(path => path.exit)) break;
  }
  const allFilled = paths.every(path => path.mask !== 0), anyFilled = paths.some(path => path.mask !== 0);
  const exit = paths.every(path => path.exit !== 0) ? {
    level: new Set(paths.map(path => path.exit)).size > 1 ? 'both' as const : paths[0].exit === 1 ? 'tp' as const : 'sl' as const,
    at: Math.max(...paths.map(path => path.exitAt!)),
  } : undefined;
  if (allFilled) return { status: 'filled', filledAt: Math.max(...paths.map(path => path.filledAt!)), outcome: exit,
    observedThrough: Math.min(asOf, previousTime! + seconds), continuityLost: !exit && previousTime! + seconds < asOf };
  if (anyFilled) return { status: 'ambiguous' };
  if (!exit && asOf >= signal.expiresAt && (previousTime! + seconds < signal.expiresAt
    || bars.some(bar => bar.time < signal.expiresAt && bar.complete === false))) return { status: 'unavailable' };
  return { status: asOf >= signal.expiresAt || exit ? 'expired' : 'waiting', beforeEntryExit: exit };
}

export function chartExecutionStatus(chart: ChartPullbackState, executed: boolean, brokerStatus?: Mt5StoredSignal['status']): string {
  const level = chart.outcome?.level ?? chart.beforeEntryExit?.level;
  const name = level === 'tp' ? 'TP' : level === 'sl' ? 'SL' : 'SL/TP';
  const state = chart.outcome ? `${name} HIT` : chart.beforeEntryExit ? `${name} reached before entry`
    : chart.status === 'filled' ? 'Filled' : chart.status === 'waiting' ? 'Waiting'
      : chart.status === 'expired' ? 'Entry expired' : chart.status === 'ambiguous' ? 'Fill uncertain' : 'Waiting for candle data';
  const broker = executed ? brokerStatus === 'TP' || brokerStatus === 'SL' ? `${brokerStatus} HIT` : 'Executed' : 'Not executed';
  return `CHART: ${state} · MT5: ${broker}`;
}

type Positions = readonly Mt5AutomationStatus['positions'][number][];
export type PullbackTableSignal = Mt5StoredSignal & { preview?: boolean; simulatedFill?: boolean;
  chartEvidence?: { observedAt: number; outcome: 'active' | 'tp' | 'sl' | 'uncertain'; resolvedAt?: number; outcomeObservedAt?: number };
  displayPlan?: { previousEntry: number; expired: boolean; error?: string } };

/** Display projection only. Never enqueue it or overwrite a broker execution record. */
export function currentPullbackDisplay(signal: PullbackTableSignal, asOf: number, positions: Positions = []): PullbackTableSignal {
  const leg = signal.scalpEntry ?? signal.intradayEntry;
  if (!leg || leg.version !== 1 || signal.simulatedFill || signal.openedAt !== undefined
    || signal.executionPrice !== undefined || signal.closedAt !== undefined
    || !['REJECTED', 'EXPIRED', 'CANCELLED', 'SIMULATED'].includes(signal.status)
    || confirmedPullbackFill(signal, asOf, positions)) return signal;
  if (![leg.nextOpen, leg.confirmationBody].every(value => Number.isFinite(value) && value > 0)) return signal;
  const sign = signal.direction === 'BUY' ? 1 : -1;
  const entry = leg.nextOpen - sign * leg.confirmationBody * leg.leg / 100;
  if (Math.abs(entry - signal.entry) < 1e-6) return signal;
  const risk = sign * (entry - signal.stopLoss), reward = sign * (signal.takeProfit - entry);
  const updated = { ...leg, version: 2 as const };
  const plan: PullbackTableSignal = { ...signal, entry, riskPips: risk * 10,
    rewardRisk: risk > 0 ? reward / risk : 0, normalRewardRisk: risk > 0 ? reward / risk : 0,
    ...(signal.scalpEntry ? { scalpEntry: updated } : { intradayEntry: { ...signal.intradayEntry!, version: 2 } }),
    displayPlan: { previousEntry: signal.entry, expired: signal.expiresAt <= asOf } };
  plan.displayPlan!.error = signal.scalpEntry ? scalpPullbackSignalError(plan) : intradayPullbackSignalError(plan);
  return plan;
}

export function pullbackPlanStatus(signal: PullbackTableSignal): string | undefined {
  return !signal.displayPlan ? undefined : signal.displayPlan.error ? 'UPDATED PLAN OUTSIDE LIMITS · NO ORDER'
    : signal.displayPlan.expired ? 'UPDATED PLAN · ENTRY WINDOW EXPIRED · NO FILL' : 'UPDATED PLAN · NOT PLACED';
}

/** Group by setup identity, not entry price: capped legs can have identical prices. */
export function groupPullbackTableSignals(signals: readonly PullbackTableSignal[],
  context: Pick<Mt5StoredSignal, 'account' | 'server' | 'brokerSymbol'> = {}): Array<{ key: string; entries: PullbackTableSignal[] }> {
  const groups = new Map<string, Map<number, PullbackTableSignal>>();
  for (const signal of signals) {
    const leg = signal.intradayEntry ?? signal.scalpEntry;
    const parent = signal.intradayEntry?.setupKey ?? signal.setupId?.replace(/:P(?:10|25)$/, '') ?? signal.id.replace(/:P(?:10|25)$/, '');
    const key = JSON.stringify([signal.account ?? context.account, signal.server ?? context.server,
      signal.brokerSymbol ?? context.brokerSymbol, signal.symbol, signal.tradeStyle, signal.source,
      signal.zoneTimeframe, signal.signalTimeframe, signal.signalAt, signal.direction,
      leg ? parent : signal.id, leg?.referenceEntry, signal.initialStopLoss ?? signal.stopLoss, signal.takeProfit]);
    let entries = groups.get(key);
    if (!entries) { entries = new Map(); groups.set(key, entries); }
    const slot = leg?.leg ?? 0, prior = entries.get(slot);
    const selected = !prior || prior.preview && !signal.preview || prior.preview === signal.preview && signal.updatedAt > prior.updatedAt ? signal : prior;
    const other = selected === signal ? prior : signal;
    const compatible = other && selected.entry === other.entry && selected.expiresAt === other.expiresAt
      && (selected.intradayEntry ?? selected.scalpEntry)?.version === (other.intradayEntry ?? other.scalpEntry)?.version;
    const evidence = compatible ? [selected.chartEvidence, other.chartEvidence].filter(e => e !== undefined)
      .sort((a, b) => (b.outcome === 'tp' || b.outcome === 'sl' ? 1 : 0) - (a.outcome === 'tp' || a.outcome === 'sl' ? 1 : 0)
        || (b.outcomeObservedAt ?? b.observedAt) - (a.outcomeObservedAt ?? a.observedAt))[0] : selected.chartEvidence;
    entries.set(slot, evidence ? { ...selected, chartEvidence: evidence,
      openedAt: selected.openedAt ?? other?.openedAt } : selected);
  }
  return [...groups].map(([key, entries]) => ({ key, entries: [...entries.values()]
    .sort((a, b) => (a.intradayEntry?.leg ?? a.scalpEntry?.leg ?? 0) - (b.intradayEntry?.leg ?? b.scalpEntry?.leg ?? 0)) }))
    .sort((a, b) => b.entries[0].signalAt - a.entries[0].signalAt);
}
export interface PullbackFillEvidence {
  asOf: number;
  replay: boolean;
  records?: readonly JournalTradeRecord[];
  signals?: readonly Mt5StoredSignal[];
  positions?: Positions;
}

/** A placed pending order is not an executed position. */
export function confirmedPullbackFill(signal: Mt5StoredSignal & { preview?: boolean }, asOf: number,
  positions: Positions = []): boolean {
  if (signal.preview || signal.status === 'SIMULATED') return false;
  if (positions.some(position => position.symbol === signal.brokerSymbol && position.openedAt <= asOf
    && position.volume > 0 && (position.ticket === signal.brokerPosition || position.ticket === signal.brokerTicket
      || position.identifier !== undefined && position.identifier === signal.brokerPosition
      || signal.setupId !== undefined && position.setupId === signal.setupId))) return true;
  return ['ACTIVE', 'RISK_FREE', 'TP', 'SL', 'RF'].includes(signal.status)
    && (signal.openedAt ?? signal.updatedAt) <= asOf;
}

/** Scope ticks to the same fixed-exit setup and resolve each leg independently. */
export function filledPullbackLegs(base: Mt5SignalInput, evidence?: PullbackFillEvidence): Set<10 | 25> {
  const filled = new Set<10 | 25>();
  if (!evidence) return filled;
  const matches = (candidate: Pick<Mt5SignalInput, 'signalAt' | 'signalTimeframe' | 'zoneTimeframe' | 'direction' | 'takeProfit' | 'tradeStyle' | 'source'>,
    referenceEntry: number) => candidate.signalAt === base.signalAt && candidate.signalTimeframe === base.signalTimeframe
    && candidate.zoneTimeframe === base.zoneTimeframe && candidate.direction === base.direction
    && candidate.tradeStyle === base.tradeStyle && candidate.source === base.source
    && Math.abs(referenceEntry - base.entry) < 1e-6 && Math.abs(candidate.takeProfit - base.takeProfit) < 1e-6;
  if (!evidence.replay) for (const signal of evidence.signals ?? []) {
    const leg = signal.intradayEntry ?? signal.scalpEntry;
    if (leg && signal.symbol === 'XAUUSD' && matches(signal, leg.referenceEntry)
      && confirmedPullbackFill(signal, evidence.asOf, evidence.positions)) filled.add(leg.leg);
  }
  if (!evidence.replay) return filled;
  for (const record of evidence.records ?? []) {
    const leg = record.intradayEntry ?? record.scalpEntry;
    const broker = record.mt5Managed === true || record.brokerTicket !== undefined;
    if (!leg || broker === evidence.replay || record.openedAt === undefined || record.openedAt > evidence.asOf
      || (record.symbol ?? 'XAUUSD') !== 'XAUUSD' || !['open', 'risk-free', 'tp', 'sl', 'rf'].includes(record.result)) continue;
    if (matches({ ...record, signalAt: record.signalAt ?? -1, direction: record.direction === 'bullish' ? 'BUY' : 'SELL' }, leg.referenceEntry)) filled.add(leg.leg);
  }
  return filled;
}

export function scalpReplayTableSignals(records: readonly JournalTradeRecord[], asOf: number):
  Array<Mt5StoredSignal & { preview: true; simulatedFill: true }> {
  return records.filter(record => record.tradeStyle === 'SCALP_1_1' && !record.mt5Managed
    && record.brokerTicket === undefined && record.signalAt !== undefined && record.openedAt !== undefined
    && record.openedAt <= asOf).map(record => {
    const closed = ['tp', 'sl'].includes(record.result) && record.completedAt <= asOf;
    return { id: record.id, setupId: record.setupId, symbol: 'XAUUSD', source: 'ENGULFING',
      tradeStyle: 'SCALP_1_1', zoneName: record.zoneName, zoneTimeframe: record.zoneTimeframe,
      signalTimeframe: record.signalTimeframe, signalAt: record.signalAt!, calculatedAt: record.signalAt! + 900,
      direction: record.direction === 'bullish' ? 'BUY' : 'SELL', engulfingType: record.engulfingType,
      orderType: 'LIMIT', entry: record.entry, stopLoss: record.stopLoss, takeProfit: record.takeProfit,
      riskFree: record.takeProfit, riskPips: record.riskPips, rewardRisk: record.rewardRisk, scalpEntry: record.scalpEntry, pullbackFallback: record.pullbackFallback,
      expiresAt: record.signalAt! + 900 + pullbackExpirySeconds(record.scalpEntry?.version ?? 1, 900), status: closed ? record.result === 'tp' ? 'TP' : 'SL' : 'ACTIVE',
      openedAt: record.openedAt, closedAt: closed ? record.completedAt : undefined,
      createdAt: record.signalAt! + 900, updatedAt: closed ? record.completedAt : record.openedAt!,
      preview: true, simulatedFill: true };
  });
}
