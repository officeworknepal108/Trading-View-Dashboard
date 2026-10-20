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
