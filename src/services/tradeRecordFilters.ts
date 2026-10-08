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

export interface TradeRecordFilters {
  timeframes: 'ALL' | TradeTimeframe[];
  date: string;
  source: 'ALL' | FilterableTradeRecord['source'];
  side: 'ALL' | 'BUY' | 'SELL';
  result: 'ALL' | TradeResult;
  zones: 'ALL' | string[];
}

export const DEFAULT_TRADE_RECORD_FILTERS: TradeRecordFilters = {
  timeframes: 'ALL',
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

export function filterTradeRecords<T extends FilterableTradeRecord>(
  records: T[],
  filters: TradeRecordFilters,
  timeZone: ChartTimeZone,
): T[] {
  return records.filter((record) => (
    (filters.timeframes === 'ALL' || filters.timeframes.includes(record.signalTimeframe))
    && (filters.date === 'ALL' || tradeRecordDateKey(record.completedAt, timeZone) === filters.date)
    && (filters.source === 'ALL' || record.source === filters.source)
    && (filters.side === 'ALL'
      || (filters.side === 'BUY' ? record.direction === 'bullish' : record.direction === 'bearish'))
    && (filters.result === 'ALL' || record.result === filters.result)
    && (filters.zones === 'ALL' || filters.zones.includes(record.zoneName))
  ));
}
