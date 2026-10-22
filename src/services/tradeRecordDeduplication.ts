export interface DeduplicableTradeRecord {
  id: string;
  completedAt: number;
  source?: string;
  direction?: string;
  signalTimeframe?: string;
  zoneTimeframe?: string;
  signalAt?: number;
  entry?: number;
  stopLoss?: number;
  mt5Managed?: boolean;
  brokerTicket?: number;
  symbol?: string;
  zoneName?: string;
  tradeStyle?: string;
  riskPips?: number;
}

function exactPriceKey(value: unknown): string | undefined {
  const price = Number(value);
  return Number.isFinite(price) ? price.toFixed(6) : undefined;
}

/** Identifies one execution independently of which setup route found it. */
export function tradeExecutionKey(record: DeduplicableTradeRecord): string {
  if (record.brokerTicket !== undefined && Number.isFinite(record.brokerTicket)) {
    return `BROKER:${record.symbol ?? 'XAUUSD'}:${record.brokerTicket}`;
  }
  const signalAt = Number(record.signalAt);
  const entry = exactPriceKey(record.entry);
  const stopLoss = exactPriceKey(record.stopLoss);
  if (!Number.isFinite(signalAt) || signalAt <= 0 || !entry || !stopLoss
    || !record.direction || !record.signalTimeframe) {
    return `ID:${record.id}`;
  }
  // TP is intentionally omitted. Overlapping routes may calculate different
  // targets for the same entry and stop, but the execution is still one trade.
  return [
    'EXECUTION', record.symbol ?? 'XAUUSD', Math.trunc(signalAt), record.signalTimeframe,
    record.direction, entry, stopLoss,
  ].join(':');
}

function recordPriority(record: DeduplicableTradeRecord): number {
  let priority = 0;
  if (record.mt5Managed || record.brokerTicket !== undefined) priority += 100;
  if (record.source === 'ENGULFING') priority += 20;
  if (record.zoneTimeframe && record.zoneTimeframe === record.signalTimeframe) priority += 5;
  return priority;
}

function preferredRecord<T extends DeduplicableTradeRecord>(first: T, second: T): T {
  const firstPriority = recordPriority(first);
  const secondPriority = recordPriority(second);
  if (secondPriority !== firstPriority) return secondPriority > firstPriority ? second : first;
  return second.completedAt > first.completedAt ? second : first;
}

export function deduplicateTradeRecords<T extends DeduplicableTradeRecord>(records: T[]): T[] {
  const unique = new Map<string, T>();
  for (const record of records) {
    const key = tradeExecutionKey(record);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, record);
      continue;
    }
    const preferred = preferredRecord(existing, record);
    const secondary = preferred === existing ? record : existing;
    // Keep notes/screenshots from either copy while retaining the preferred
    // route's identity and execution fields.
    unique.set(key, { ...secondary, ...preferred });
  }
  const values = Array.from(unique.values());
  const brokerTrades = values.filter((record) => record.mt5Managed || record.brokerTicket !== undefined);
  return values.filter((record) => record.mt5Managed || record.brokerTicket !== undefined
    || !brokerTrades.some((broker) => {
      if (!record.signalAt || !record.zoneName || !record.zoneTimeframe
        || (record.symbol ?? 'XAUUSD') !== (broker.symbol ?? 'XAUUSD')
        || record.signalAt !== broker.signalAt || record.signalTimeframe !== broker.signalTimeframe
        || record.direction !== broker.direction || record.source !== broker.source
        || record.zoneName !== broker.zoneName || record.zoneTimeframe !== broker.zoneTimeframe
        || record.tradeStyle !== broker.tradeStyle) return false;
      const risk = Math.abs(Number(record.entry) - Number(record.stopLoss));
      const pipSize = record.riskPips && record.riskPips > 0 ? risk / record.riskPips : 0;
      const tolerance = Math.max(pipSize * 3, risk * 0.03, 0.000001);
      return Math.abs(Number(record.entry) - Number(broker.entry)) <= tolerance
        && Math.abs(Number(record.stopLoss) - Number(broker.stopLoss)) <= tolerance;
    }))
    .sort((first, second) => second.completedAt - first.completedAt);
}

/** Recalculated chart facts replace the same saved ID; broker executions retain priority. */
export function reconcileTradeRecords<T extends DeduplicableTradeRecord>(
  saved: readonly T[],
  current: readonly T[],
  accepts: (record: T) => boolean,
): T[] {
  const byId = new Map(saved.map((record) => [record.id, record]));
  for (const record of current) {
    byId.set(record.id, { ...byId.get(record.id), ...record });
  }
  return deduplicateTradeRecords([...byId.values()].filter(accepts));
}

/** The journal may add notes and images, but cannot reintroduce rejected trades or old prices. */
export function mergeTradeRecordAnnotations<T extends DeduplicableTradeRecord>(
  canonical: readonly T[],
  stored: readonly T[],
): T[] {
  const byId = new Map(stored.map((record) => [record.id, record]));
  const fields = ['session', 'reason', 'mistake', 'lesson', 'screenshotDataUrl',
    'entryScreenshotDataUrl', 'exitScreenshotDataUrl', 'entrySnapshotCandles', 'exitSnapshotCandles'] as const;
  return canonical.map((record) => {
    const notes = byId.get(record.id);
    const annotations: Record<string, unknown> = {};
    for (const field of fields) {
      const value = notes && (notes as Record<string, unknown>)[field];
      if (value !== undefined && value !== '') annotations[field] = value;
    }
    return { ...record, ...annotations };
  }).sort((first, second) => second.completedAt - first.completedAt);
}
