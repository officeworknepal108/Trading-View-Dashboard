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
