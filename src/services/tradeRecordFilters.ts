import type { ChartTimeZone } from './chartTime';
import type { TradeResult, TradeTimeframe } from './tradeLevels';

export interface FilterableTradeRecord {
  completedAt: number;
  signalTimeframe: TradeTimeframe;
  source: 'ENGULFING' | 'MTF';
  direction: 'bullish' | 'bearish';
  result: TradeResult | 'open' | 'risk-free';
  zoneName: string;
}

export type TradeDatePeriod = 'DAY' | 'WEEK' | 'MONTH';

export interface TradeRecordFilters {
  timeframes: 'ALL' | TradeTimeframe[];
  datePeriod: TradeDatePeriod;
  date: string;
  source: 'ALL' | FilterableTradeRecord['source'];
  side: 'ALL' | 'BUY' | 'SELL';
  result: 'ALL' | TradeResult;
  zones: 'ALL' | string[];
}

export const DEFAULT_TRADE_RECORD_FILTERS: TradeRecordFilters = {
  timeframes: 'ALL',
  datePeriod: 'DAY',
  date: 'ALL',
  source: 'ALL',
  side: 'ALL',
  result: 'ALL',
  zones: 'ALL',
};

export function tradeRecordDateKey(time: number, timeZone: ChartTimeZone): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(time * 1000));
  const value = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ''
  );
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function tradeRecordPeriodKey(
  time: number,
  timeZone: ChartTimeZone,
  period: TradeDatePeriod,
): string {
  const dateKey = tradeRecordDateKey(time, timeZone);
  return tradeRecordDatePeriodKey(dateKey, period);
}

export function tradeRecordDatePeriodKey(dateKey: string, period: TradeDatePeriod): string {
  if (period === 'DAY') return dateKey;
  if (period === 'MONTH') return dateKey.slice(0, 7);
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

export function tradeRecordPeriodLabel(key: string, period: TradeDatePeriod): string {
  if (period === 'WEEK') {
    const start = new Date(`${key}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    const format = (date: Date) => new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
    }).format(date);
    return `${format(start)} – ${format(end)}`;
  }
  const [year, month, parsedDay] = key.split('-').map(Number);
  const day = parsedDay || 1;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: period === 'MONTH' ? 'long' : 'short',
    ...(period === 'DAY' ? { day: '2-digit' as const } : {}),
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function filterTradeRecords<T extends FilterableTradeRecord>(
  records: T[],
  filters: TradeRecordFilters,
  timeZone: ChartTimeZone,
): T[] {
  return records.filter((record) => (
    (filters.timeframes === 'ALL' || filters.timeframes.includes(record.signalTimeframe))
    && (filters.date === 'ALL'
      || tradeRecordPeriodKey(record.completedAt, timeZone, filters.datePeriod)
        === tradeRecordDatePeriodKey(filters.date, filters.datePeriod))
    && (filters.source === 'ALL' || record.source === filters.source)
    && (filters.side === 'ALL'
      || (filters.side === 'BUY' ? record.direction === 'bullish' : record.direction === 'bearish'))
    && (filters.result === 'ALL' || record.result === filters.result)
    && (filters.zones === 'ALL' || filters.zones.includes(record.zoneName))
  ));
}

/** Entry arrows represent only completed accuracy rows on the displayed candle timeframe. */
export function selectAccuracyChartEntries<T extends FilterableTradeRecord & { id: string; signalAt?: number }>(
  records: readonly T[],
  visibleIds: ReadonlySet<string> | null,
  chartTimeframe: TradeTimeframe,
  completedBy?: number,
): T[] {
  return records.filter((record) => (
    (record.result === 'tp' || record.result === 'sl' || record.result === 'rf')
    && record.signalTimeframe === chartTimeframe
    && typeof record.signalAt === 'number' && Number.isFinite(record.signalAt)
    && (completedBy === undefined || record.completedAt <= completedBy)
    && (visibleIds === null || visibleIds.has(record.id))
  ));
}

export interface AccuracyVerificationCandle {
  time: number;
  high: number;
  low: number;
}

export interface AccuracySourceZone {
  id: string;
  name: string;
}

/** Saved direct results may only describe a zone found in the current source timeframe. */
export function savedDirectZoneMatchesStructure(
  record: { id: string; zoneName: string; zoneTimeframe: TradeTimeframe; signalAt?: number },
  signalCandles: readonly AccuracyVerificationCandle[] | undefined,
  sourceZones: readonly AccuracySourceZone[] | undefined,
): boolean {
  if (record.signalAt === undefined || !signalCandles?.some((candle) => candle.time === record.signalAt)
    || !sourceZones) return true;
  const prefix = record.id.startsWith('DIRECT:') ? 'DIRECT:'
    : record.id.startsWith(`GOLD_SCALP:${record.zoneTimeframe}:`)
      ? `GOLD_SCALP:${record.zoneTimeframe}:` : undefined;
  if (!prefix) return true;
  const signalDelimiter = `:${record.signalAt}:`;
  const signalPosition = record.id.lastIndexOf(signalDelimiter);
  if (signalPosition <= prefix.length) return false;
  const zoneId = record.id.slice(prefix.length, signalPosition);
  return sourceZones.some((zone) => zone.id === zoneId
    && (zone.name === record.zoneName
      || (record.zoneName === '1MG QML' && zone.name === 'QML')));
}

/** Reject a saved result when the currently loaded candles disprove its fill or exit. */
export function accuracyResultMatchesCandles(
  record: FilterableTradeRecord & {
    signalAt?: number;
    openedAt?: number;
    entry: number;
    stopLoss: number;
    takeProfit: number;
  },
  candles: readonly AccuracyVerificationCandle[] | undefined,
  timeframeSeconds: number,
  priceTolerance = 0,
): boolean {
  if (!candles?.length || record.signalAt === undefined
    || !Number.isFinite(record.signalAt) || !Number.isFinite(record.completedAt)) return true;

  const signalIsLoaded = candles.some((candle) => candle.time === record.signalAt);
  const signalFallsInsideLoadedCandle = candles.some((candle) => (
    record.signalAt! >= candle.time && record.signalAt! < candle.time + timeframeSeconds
  ));
  // A signal inside the loaded chart must have a verifiable fill and result.
  // A timestamp between candle opens is not a confirmation on this timeframe.
  // Records entirely before the loaded window remain in the saved history.
  if (signalFallsInsideLoadedCandle && !signalIsLoaded) return false;
  if (!signalIsLoaded) return true;

  const firstExecutionTime = record.signalAt + timeframeSeconds;
  const firstIndex = candles.findIndex((candle) => (
    firstExecutionTime >= candle.time && firstExecutionTime < candle.time + timeframeSeconds
  ));
  const lastIndex = candles.findIndex((candle) => (
    record.completedAt >= candle.time && record.completedAt < candle.time + timeframeSeconds
  ));
  if (firstIndex < 0 || lastIndex < 0 || lastIndex < firstIndex) return false;

  const buy = record.direction === 'bullish';
  const entryTime = record.openedAt ?? firstExecutionTime;
  let filled = false;
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const candle = candles[index];
    if (candle.time + timeframeSeconds <= entryTime) continue;
    if (!filled) {
      filled = buy
        ? candle.low <= record.entry + priceTolerance
        : candle.high >= record.entry - priceTolerance;
    }
    if (index !== lastIndex) continue;
    const exitReached = record.result === 'tp'
      ? buy ? candle.high >= record.takeProfit - priceTolerance
        : candle.low <= record.takeProfit + priceTolerance
      : record.result === 'sl' || record.result === 'rf'
        ? buy ? candle.low <= record.stopLoss + priceTolerance
          : candle.high >= record.stopLoss - priceTolerance
        : true;
    return filled && exitReached;
  }
  return false;
}
