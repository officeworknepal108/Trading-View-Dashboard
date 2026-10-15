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
}

function exactPriceKey(value: unknown): string | undefined {
  const price = Number(value);
  return Number.isFinite(price) ? price.toFixed(6) : undefined;
}

/** Identifies one execution independently of which setup route found it. */
export function tradeExecutionKey(record: DeduplicableTradeRecord): string {
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
    'EXECUTION', Math.trunc(signalAt), record.signalTimeframe,
    record.direction, entry, stopLoss,
  ].join(':');
}

function recordPriority(record: DeduplicableTradeRecord): number {
  let priority = 0;
  if (record.mt5Managed) priority += 100;
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
  return Array.from(unique.values())
    .sort((first, second) => second.completedAt - first.completedAt);
}
