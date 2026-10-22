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

export function isTradeOverlayTerminated(
  setupKey: string,
  entryEventKey: string,
  tradeCompleted: boolean,
  completedSetupKeys: ReadonlySet<string>,
  completedEntryEventKeys: ReadonlySet<string>,
): boolean {
  return tradeCompleted
    || completedSetupKeys.has(setupKey)
    || completedEntryEventKeys.has(entryEventKey);
}
