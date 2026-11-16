import type { JournalTradeRecord } from '../components/TradeJournal';
import type { Mt5AutomationStatus, Mt5SignalInput, Mt5StoredSignal } from './mt5Automation';

type Positions = readonly Mt5AutomationStatus['positions'][number][];
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
      riskFree: record.takeProfit, riskPips: record.riskPips, rewardRisk: record.rewardRisk, scalpEntry: record.scalpEntry,
      expiresAt: record.signalAt! + 1800, status: closed ? record.result === 'tp' ? 'TP' : 'SL' : 'ACTIVE',
      openedAt: record.openedAt, closedAt: closed ? record.completedAt : undefined,
      createdAt: record.signalAt! + 900, updatedAt: closed ? record.completedAt : record.openedAt!,
      preview: true, simulatedFill: true };
  });
}
