import type { ChartTimeZone } from './chartTime';
import type { TradeResult, TradeTimeframe } from './tradeLevels';

export interface FilterableTradeRecord {
  completedAt: number;
  signalTimeframe: TradeTimeframe;
  source: 'ENGULFING' | 'MTF';
  direction: 'bullish' | 'bearish';
  result: TradeResult;
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
