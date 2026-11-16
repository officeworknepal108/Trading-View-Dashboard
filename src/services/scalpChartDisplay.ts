import type { Mt5AutomationStatus, Mt5SignalInput, Mt5StoredSignal } from './mt5Automation';
import type { TradeLevels, TradeTimeframe } from './tradeLevels';

export interface ScalpChartDisplay {
  id: string;
  symbol: 'XAUUSD';
  setupId?: string;
  trade: TradeLevels;
  chartTimeframe: TradeTimeframe;
  zoneTimeframe?: TradeTimeframe;
  referenceOnly: boolean;
  kind: 'live' | 'pending' | 'rejected' | 'preview';
  style: 'SCALPING' | 'SCALP_1_1';
  label: string;
  markerTime: number;
  markerText: string;
  statusText: string;
  brokerTicket?: number;
  alwaysVisible: true;
  displayOffset: number;
}

type Position = Mt5AutomationStatus['positions'][number];
type Connection = { account?: string; server?: string; brokerSymbol?: string; connected?: boolean };
const scalpStyle = (signal: { tradeStyle?: string; setupId?: string }) => signal.tradeStyle === 'SCALP_1_1'
  ? 'SCALP_1_1' as const : signal.tradeStyle === 'SCALPING' ? 'SCALPING' as const
  : signal.tradeStyle ? undefined : signal.setupId?.startsWith('SCALP_1_1:') ? 'SCALP_1_1' as const
  : signal.setupId?.startsWith('GOLD_SCALP:') ? 'SCALPING' as const : undefined;

function matchesAccount(signal: Mt5StoredSignal, connection: Connection) {
  return !!connection.account && !!connection.server && !!connection.brokerSymbol
    && signal.account === connection.account && signal.server === connection.server
    && signal.brokerSymbol === connection.brokerSymbol;
}

export function scalpPositionSignal(position: Position, signals: readonly Mt5StoredSignal[], connection: Connection): Mt5StoredSignal | undefined {
  return signals.find(signal => matchesAccount(signal, connection)
    && (signal.brokerPosition === position.ticket || signal.brokerTicket === position.ticket
      || position.identifier !== undefined && (signal.brokerPosition === position.identifier || signal.brokerTicket === position.identifier)
      || position.setupId !== undefined && signal.setupId === position.setupId
        && ['ACTIVE', 'RISK_FREE', 'PLACED'].includes(signal.status)));
}

/** Display only: broker positions prove fills; pending/rejected signals never do. */
export function buildScalpChartDisplays(options: {
  marketSymbol: string;
  timeframe: TradeTimeframe;
  asOf: number;
  replay?: boolean;
  connection: Connection;
  positions: readonly Position[];
  signals: readonly Mt5StoredSignal[];
  previews?: readonly Mt5SignalInput[];
}): ScalpChartDisplay[] {
  const { marketSymbol, timeframe, asOf, connection, positions, signals } = options;
  if (marketSymbol !== 'XAUUSD' || options.replay || !connection.account || !connection.server || !connection.brokerSymbol) return [];
  const result: ScalpChartDisplay[] = [];
  const representedIds = new Set<string>(), representedSetups = new Set<string>();
  for (const position of positions) {
    if (position.symbol !== connection.brokerSymbol) continue;
    const signal = scalpPositionSignal(position, signals, connection);
    const style = scalpStyle(signal ?? position);
    if (!style) continue;
    if (signal) representedIds.add(signal.id);
    if (position.setupId ?? signal?.setupId) representedSetups.add((position.setupId ?? signal?.setupId)!);
    const entryTimeframe = position.signalTimeframe ?? signal?.signalTimeframe ?? (style === 'SCALP_1_1' ? 'M15' : undefined);
    const zoneTimeframe = position.zoneTimeframe ?? signal?.zoneTimeframe;
    if (!entryTimeframe || !(timeframe === entryTimeframe || style === 'SCALPING' && timeframe === zoneTimeframe)) continue;
    const openedAt = position.openedAt;
    if (![position.priceOpen, position.stopLoss, position.takeProfit, openedAt].every(v => Number.isFinite(v) && v > 0) || openedAt > asOf) continue;
    const buy = position.direction === 'BUY';
    const signalAt = position.signalAt ?? signal?.signalAt ?? openedAt;
    const referenceRisk = Math.abs(position.priceOpen - (signal?.initialStopLoss ?? signal?.stopLoss ?? position.stopLoss));
    const rr = referenceRisk > 0 ? Math.abs(position.takeProfit - position.priceOpen) / referenceRisk : 0;
    const leg = signal?.scalpEntry?.leg;
    const name = style === 'SCALP_1_1' ? 'SCALP 1:1' : 'SCALP';
    const statusText = connection.connected === false ? 'MT5 LAST KNOWN OPEN POSITION' : 'MT5 LIVE OPEN POSITION';
    result.push({ id: `MT5:${position.ticket}`, symbol: 'XAUUSD', setupId: position.setupId ?? signal?.setupId,
      chartTimeframe: timeframe, zoneTimeframe, referenceOnly: false, kind: 'live', style,
      alwaysVisible: true, displayOffset: 0, brokerTicket: position.ticket,
      label: `${name} · ${statusText} · #${position.ticket}${leg ? ` · ${leg}% PULLBACK` : ''}`,
      markerTime: openedAt, markerText: `${name} ${position.direction} #${position.ticket}${leg ? ` P${leg}` : ''}`,
      statusText,
      trade: { entry: position.priceOpen, stopLoss: position.stopLoss, takeProfit: position.takeProfit,
        riskFree: position.riskFree ?? signal?.riskFree ?? position.priceOpen + (buy ? 1 : -1) * referenceRisk,
        riskFreeEnabled: style === 'SCALPING', rewardRisk: rr, riskPips: referenceRisk * 10,
        status: position.signalStatus === 'RISK_FREE' || signal?.status === 'RISK_FREE' ? 'risk-free' : 'active',
        pendingAtCreation: false, calculatedAt: openedAt, filledAt: openedAt,
        signal: { type: (signal?.engulfingType ?? position.engulfingType ?? 'T1') as TradeLevels['signal']['type'],
          direction: buy ? 'bullish' : 'bearish', timeframe: entryTimeframe, time: signalAt,
          candleCount: signal?.engulfingType === 'T1' || position.engulfingType === 'T1' ? 2 : 3 } },
    });
  }
  const current = signals.filter(s => matchesAccount(s, connection) && s.tradeStyle === 'SCALP_1_1'
    && s.signalTimeframe === timeframe && s.calculatedAt <= asOf
    && (['QUEUED', 'CLAIMED', 'PLACED'].includes(s.status) && s.expiresAt > asOf
      || ['REJECTED', 'SIMULATED'].includes(s.status) && asOf - s.calculatedAt <= 86400));
  const newest = Math.max(-Infinity, ...current.map(s => s.signalAt),
    ...(options.previews ?? []).filter(s => s.tradeStyle === 'SCALP_1_1'
      && s.signalTimeframe === timeframe && s.expiresAt > asOf && s.calculatedAt <= asOf).map(s => s.signalAt));
  const pending = current.filter(s => s.signalAt === newest);
  const candidates: Array<Mt5SignalInput & { displayState: string }> = [
    ...pending.map(s => ({ ...s, displayState: s.status })),
    ...(options.previews ?? []).filter(s => s.tradeStyle === 'SCALP_1_1' && s.signalAt === newest
      && s.signalTimeframe === timeframe && s.calculatedAt <= asOf && s.expiresAt > asOf
      && !signals.some(stored => matchesAccount(stored, connection) && stored.signalAt === s.signalAt
        && stored.tradeStyle === 'SCALP_1_1' && (stored.scalpEntry?.leg === s.scalpEntry?.leg || !stored.scalpEntry)))
      .map(s => ({ ...s, displayState: 'PREVIEW' })),
  ];
  const seen = new Set<string>();
  for (const signal of candidates) {
    if (representedIds.has(signal.id) || signal.setupId && representedSetups.has(signal.setupId) || seen.has(signal.id)) continue;
    if (![signal.entry, signal.stopLoss, signal.takeProfit].every(v => Number.isFinite(v) && v > 0)) continue;
    seen.add(signal.id);
    const rejected = signal.displayState === 'REJECTED';
    const preview = signal.displayState === 'PREVIEW' || signal.displayState === 'SIMULATED';
    const statusText = rejected ? 'ORDER REJECTED · NO FILL' : preview ? 'CHART SETUP ONLY · NO BROKER FILL' : 'MT5 PENDING LIMIT · NOT FILLED';
    const leg = signal.scalpEntry?.leg;
    result.push({ id: `SCALP_SETUP:${signal.id}`, symbol: 'XAUUSD', setupId: signal.setupId,
      chartTimeframe: timeframe, zoneTimeframe: signal.zoneTimeframe, referenceOnly: true,
      kind: rejected ? 'rejected' : preview ? 'preview' : 'pending', style: 'SCALP_1_1',
      alwaysVisible: true, displayOffset: 0, statusText,
      label: `SCALP 1:1 · ${statusText}${leg ? ` · ${leg}% PULLBACK` : ''}`,
      markerTime: signal.signalAt, markerText: `SCALP ${signal.direction} SETUP${leg ? ` P${leg}` : ''}${rejected ? ' · REJECTED' : ''}`,
      trade: { entry: signal.entry, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit,
        riskFree: signal.takeProfit, riskFreeEnabled: false, rewardRisk: signal.rewardRisk,
        riskPips: signal.riskPips, status: 'pending', pendingAtCreation: true, calculatedAt: signal.calculatedAt,
        signal: { type: signal.engulfingType as TradeLevels['signal']['type'], time: signal.signalAt,
          timeframe: signal.signalTimeframe, direction: signal.direction === 'BUY' ? 'bullish' : 'bearish',
          candleCount: signal.engulfingType === 'T1' ? 2 : 3 } },
    });
  }
  const offsets = new Map<string, number>();
  for (const item of result) {
    const key = `${item.trade.entry}:${item.trade.stopLoss}:${item.trade.takeProfit}`;
    item.displayOffset = offsets.get(key) ?? 0;
    offsets.set(key, item.displayOffset + 1);
  }
  return result;
}
