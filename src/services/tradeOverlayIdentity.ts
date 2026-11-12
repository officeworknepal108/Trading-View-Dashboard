const DASHBOARD_TIMEFRAMES = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D']);

/**
 * MT5 stores direct setup IDs as DIRECT:<timeframe>:<zone-id>, while chart
 * overlays use DIRECT:<zone-id>:<signal-time>:<entry>. Normalize both forms
 * to DIRECT:<zone-id> so execution slippage cannot create a second drawing.
 */
export function normalizeTradeSetupId(setupId: string): string {
  const parts = setupId.split(':');
  if (parts[0] === 'DIRECT' && parts.length >= 3 && DASHBOARD_TIMEFRAMES.has(parts[1])) {
    return ['DIRECT', ...parts.slice(2)].join(':');
  }
  return setupId;
}

export function resolveTradeOverlaySetupKey(id: string, setupId?: string): string {
  if (setupId) return normalizeTradeSetupId(setupId);
  const parts = id.split(':');
  const derived = parts.length > 3 ? parts.slice(0, -2).join(':') : id;
  return normalizeTradeSetupId(derived);
}

export function isDirectTradeOverlay(id: string, setupId?: string): boolean {
  return resolveTradeOverlaySetupKey(id, setupId).startsWith('DIRECT:');
}

/** Missing feeds and older history are unknown, but a missing timestamp inside
 * loaded coverage proves that this signal did not belong to these candles.
 */
export function chartSignalMatchesLoadedCandles(signalTime: number | undefined,
  candles: readonly { time: number }[] | undefined): boolean {
  if (signalTime === undefined || !candles?.length) return true;
  if (signalTime < candles[0].time || signalTime > candles[candles.length - 1].time) return true;
  return candles.some(candle => candle.time === signalTime);
}

/** Keep a saved chart trade only when its loaded source zone was tapped before the signal. */
export function retainedDirectTradeHasSource(
  overlay: {
    id: string;
    setupId?: string;
    label?: string;
    signalTime: number;
    direction: 'bullish' | 'bearish';
  },
  signalCandles: readonly { time: number }[] | undefined,
  sourceZoneSets: readonly (readonly {
    id: string;
    name: string;
    isBuy: boolean;
    tapTime?: number;
  }[] | undefined)[],
): boolean {
  if (overlay.id.startsWith('DIRECT:') && !chartSignalMatchesLoadedCandles(overlay.signalTime, signalCandles)) return false;
  if (!overlay.id.startsWith('DIRECT:')
    || !signalCandles?.some((candle) => candle.time === overlay.signalTime)
    || sourceZoneSets.length === 0 || sourceZoneSets.some((zones) => zones === undefined)) return true;
  const setupKey = resolveTradeOverlaySetupKey(overlay.id, overlay.setupId);
  const zoneId = setupKey.startsWith('DIRECT:') ? setupKey.slice('DIRECT:'.length) : '';
  const zoneLabel = tradeOverlayZoneLabel(overlay.label);
  return sourceZoneSets.some((zones) => zones?.some((zone) => (
    zone.id === zoneId
    && (zoneLabel === undefined || zone.name === zoneLabel
      || (zoneLabel === '1MG QML' && zone.name === 'QML'))
    && zone.isBuy === (overlay.direction === 'bullish')
    && zone.tapTime !== undefined && zone.tapTime <= overlay.signalTime
  )));
}

export function tradeOverlayZoneLabel(label: string | undefined): string | undefined {
  const zoneLabel = label?.split(' · ')[0]?.trim();
  return zoneLabel || undefined;
}

export function hasIdentifiedDirectZoneLabel(
  id: string,
  setupId: string | undefined,
  label: string | undefined,
): boolean {
  if (!isDirectTradeOverlay(id, setupId)) return true;
  const zoneLabel = tradeOverlayZoneLabel(label);
  return Boolean(zoneLabel && zoneLabel !== 'CHART' && zoneLabel !== 'OPEN CHART TRADE');
}

export function isTradeOverlayVisibleOnTimeframe(
  entryTimeframe: string | undefined,
  chartTimeframe: string,
): boolean {
  return entryTimeframe === chartTimeframe;
}

export function tradeOverlayEntryEventKey(signal: {
  timeframe: string;
  direction: string;
  time: number;
}): string {
  return `${signal.timeframe}:${signal.direction}:${Math.floor(signal.time)}`;
}

type DirectZoneTableTrade = {
  signal: { timeframe: string; direction: string; time: number };
  filledAt?: number;
};

/** Price recalculation can revise a zone ID's suffix while preserving its type and origin candle. */
export function tradeOverlayZoneOriginKey(id: string): string {
  const match = /^(.+)-(\d{10})-(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i.exec(id);
  return match ? `${match[1]}:${match[2]}` : id;
}

/** Inputs already belong to the selected market and chart timeframe. Match an entry, not just its prices. */
export function isRetainedDirectZoneTableEntry(
  zoneIds: readonly string[],
  candidate: DirectZoneTableTrade | undefined,
  retainedZoneId: string | undefined,
  retained: DirectZoneTableTrade,
): boolean {
  if (!candidate || !retainedZoneId
    || !zoneIds.some(id => tradeOverlayZoneOriginKey(id) === tradeOverlayZoneOriginKey(retainedZoneId))
    || candidate.signal.timeframe !== retained.signal.timeframe
    || candidate.signal.direction !== retained.signal.direction) return false;
  const candidateFilled = Number.isFinite(candidate.filledAt) && candidate.filledAt! > 0;
  const retainedFilled = Number.isFinite(retained.filledAt) && retained.filledAt! > 0;
  return tradeOverlayEntryEventKey(candidate.signal) === tradeOverlayEntryEventKey(retained.signal)
    || (candidateFilled && retainedFilled && candidate.filledAt === retained.filledAt);
}

interface ZoneTableSignal {
  timeframe: string;
  direction: string;
  time: number;
  type: string;
}

export interface ZoneTableConfirmation {
  sourceZoneId: string;
  symbol: string;
  signal: ZoneTableSignal;
  confirmedAt: number;
}

export function directZoneTableGroupKey(zoneId: string, symbol: string, direction: string): string {
  return JSON.stringify([symbol, tradeOverlayZoneOriginKey(zoneId), direction]);
}

/** Display only: one original entry per zone; later engulfings are annotations, never replacement trades. */
export function groupDirectZoneTableRows<T extends {
  overlay: { id: string; symbol?: string };
  sourceZoneId?: string;
  trade: { signal: ZoneTableSignal; filledAt?: number };
  confirmedAt: number;
}>(rows: readonly T[], confirmations: readonly ZoneTableConfirmation[], asOf: number): Array<T & {
  additionalConfirmations: ZoneTableConfirmation[];
}> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (row.confirmedAt > asOf || (row.trade.filledAt !== undefined && row.trade.filledAt > asOf)) continue;
    const key = row.sourceZoneId
      ? directZoneTableGroupKey(row.sourceZoneId, row.overlay.symbol ?? 'XAUUSD', row.trade.signal.direction)
      : `unidentified:${row.overlay.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const ordered = [...members].sort((a, b) => {
      const aFilled = Number.isFinite(a.trade.filledAt), bFilled = Number.isFinite(b.trade.filledAt);
      return Number(bFilled) - Number(aFilled)
        || (a.trade.filledAt ?? a.confirmedAt) - (b.trade.filledAt ?? b.confirmedAt)
        || a.confirmedAt - b.confirmedAt || a.overlay.id.localeCompare(b.overlay.id);
    });
    const original = ordered[0];
    const later = [
      ...members.filter(row => row !== original && row.sourceZoneId).map(row => ({
        sourceZoneId: row.sourceZoneId!, symbol: row.overlay.symbol ?? 'XAUUSD',
        signal: row.trade.signal, confirmedAt: row.confirmedAt,
      })),
      ...confirmations.filter(c => directZoneTableGroupKey(c.sourceZoneId, c.symbol, c.signal.direction) === key),
    ].filter(c => c.confirmedAt > original.confirmedAt
      && c.confirmedAt >= (original.trade.filledAt ?? original.confirmedAt) && c.confirmedAt <= asOf)
      .sort((a, b) => a.confirmedAt - b.confirmedAt);
    const seen = new Set([`${original.trade.signal.timeframe}:${original.trade.signal.type}`]);
    const additionalConfirmations = later.filter(c => {
      const signature = `${c.signal.timeframe}:${c.signal.type}`;
      if (seen.has(signature)) return false;
      seen.add(signature); return true;
    });
    return { ...original, additionalConfirmations };
  });
}

/** The same chart trade can be attributed to two nearby source zones. */
export function tradeOverlayExecutionKey(trade: {
  signal: { timeframe: string; direction: string; time: number };
  entry: number;
  stopLoss: number;
  takeProfit: number;
}): string {
  return [trade.signal.timeframe, trade.signal.direction, trade.entry, trade.stopLoss, trade.takeProfit]
    .map((value) => typeof value === 'number' ? value.toFixed(5) : value)
    .join(':');
}

/** MT5 and chart feeds can name one MTF setup differently while confirming the same entry. */
export function liveMtfPositionMatchesChartRow(
  position: {
    setupId?: string;
    source?: string;
    zoneTimeframe?: string;
    signalTimeframe?: string;
    signalAt?: number;
    direction: 'BUY' | 'SELL';
  },
  row: {
    id: string;
    higherTimeframe: string;
    lowerTimeframe: string;
    direction: 'bullish' | 'bearish';
    engulfingTime?: number;
  },
): boolean {
  if (position.setupId === `MTF:${row.id}`) return true;
  return (position.source === 'MTF' || position.setupId?.startsWith('MTF:') === true)
    && row.engulfingTime !== undefined
    && position.signalAt === row.engulfingTime
    && position.zoneTimeframe === row.higherTimeframe
    && position.signalTimeframe === row.lowerTimeframe
    && position.direction === (row.direction === 'bullish' ? 'BUY' : 'SELL');
}

/** Keep separate entries from one zone distinct, including recalculated prices. */
export function tradeOverlaySetupEntryKey(setupKey: string, entryEventKey: string): string {
  return `${setupKey}:${entryEventKey}`;
}

export function isTradeOverlayTerminated(
  setupKey: string,
  entryEventKey: string,
  tradeCompleted: boolean,
  completedSetupEntryKeys: ReadonlySet<string>,
  completedEntryEventKeys: ReadonlySet<string>,
): boolean {
  return tradeCompleted
    || completedSetupEntryKeys.has(tradeOverlaySetupEntryKey(setupKey, entryEventKey))
    || completedEntryEventKeys.has(entryEventKey);
}
