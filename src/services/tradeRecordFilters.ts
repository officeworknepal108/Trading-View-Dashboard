import type { ChartTimeZone } from './chartTime';
import type { TradeResult, TradeTimeframe } from './tradeLevels';
import { detectEngulfingPatternAt, type StructureCandle, type StructureZone } from './marketStructure';
import { reconcileTradeRecords } from './tradeRecordDeduplication';
import { isGoldTradeRecordRoute, savedGoldScalpMatchesReversal } from './goldScalping';
import { isNepalTradingTime } from './tradingTime';

function tradeTimeframeSeconds(timeframe: TradeTimeframe): number {
  return timeframe === 'D' ? 86400 : Number(timeframe.slice(1)) * (timeframe.startsWith('H') ? 3600 : 60);
}

export interface CanonicalTradeRecord extends FilterableTradeRecord {
  id: string; symbol?: string; zoneTimeframe: TradeTimeframe;
  signalAt?: number; openedAt?: number; engulfingType: string; engulfingCandleCount?: number;
  entry: number; stopLoss: number; takeProfit: number; rewardRisk: number; riskPips: number;
  tradeStyle?: 'SCALPING' | 'INTRADAY'; fibSource?: string; fibBand?: string;
  brokerTicket?: number; mt5Managed?: boolean;
}

export interface TradeRecordVerification {
  marketSymbol: string;
  pipSize: number;
  requireLtfFib: boolean;
  timeframeData: Partial<Record<TradeTimeframe, {
    candles: StructureCandle[]; structure: { zones: StructureZone[] };
  }>>;
  qualifyMtf: (entry: {
    id: string; signalTime: number; direction: 'bullish' | 'bearish';
    engulfingType: 'T1' | 'T2' | 'T3' | 'T4'; zoneName: string; goldScalping?: boolean;
  }) => { fibBand?: string } | undefined;
}

export interface FilterableTradeRecord {
  completedAt: number;
  signalTimeframe: TradeTimeframe;
  source: 'ENGULFING' | 'MTF';
  direction: 'bullish' | 'bearish';
  result: TradeResult | 'open' | 'risk-free';
  zoneName: string;
  tradeStyle?: string;
  openedAt?: number;
  signalAt?: number;
  outsideTradingTime?: boolean;
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
  tradeStyle?: 'ALL' | 'SCALPING' | 'INTRADAY';
  tradingTime?: 'ALL' | 'TRADING' | 'NON_TRADING';
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

/** A rolling two-calendar-month window, clamped at the target month's last day. */
export function twoMonthAccuracyWindow(asOf: number): { from: number; to: number } {
  const start = new Date(asOf * 1000);
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 2);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(day, lastDay));
  return { from: start.getTime() / 1000, to: asOf };
}

/** Count outcomes by completion time; open trades and future replay results are excluded. */
export function selectTwoMonthAccuracyRecords<T extends FilterableTradeRecord>(
  records: readonly T[], asOf: number,
): T[] {
  const { from, to } = twoMonthAccuracyWindow(asOf);
  return records.filter((record) => (
    (record.result === 'tp' || record.result === 'sl' || record.result === 'rf')
    && record.completedAt >= from && record.completedAt <= to
  ));
}

/** Match completed accuracy history while retaining running positions visible at the reference time. */
export function selectTwoMonthJournalRecords<T extends FilterableTradeRecord>(
  records: readonly T[], asOf: number,
): T[] {
  const completed = new Set(selectTwoMonthAccuracyRecords(records, asOf));
  return records.filter((record) => completed.has(record)
    || ((record.result === 'open' || record.result === 'risk-free')
      && (record.openedAt ?? record.signalAt ?? record.completedAt) <= asOf));
}

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
    && (!filters.tradeStyle || filters.tradeStyle === 'ALL' || record.tradeStyle === filters.tradeStyle)
    && (!filters.tradingTime || filters.tradingTime === 'ALL'
      || tradeRecordOutsideTradingTime(record) === (filters.tradingTime === 'NON_TRADING'))
  ));
}

export function tradeRecordOutsideTradingTime(record: FilterableTradeRecord): boolean {
  if (record.outsideTradingTime !== undefined) return record.outsideTradingTime;
  const confirmedAt = record.signalAt === undefined ? undefined
    : record.signalAt + tradeTimeframeSeconds(record.signalTimeframe);
  return (confirmedAt !== undefined && !isNepalTradingTime(confirmedAt))
    || (record.openedAt !== undefined && !isNepalTradingTime(record.openedAt));
}

/** Accuracy groups Gold scalps with their setup timeframe as well as their entry timeframe. */
export function filterAccuracyTradeRecords<T extends FilterableTradeRecord & { zoneTimeframe: TradeTimeframe }>(
  records: T[], filters: TradeRecordFilters, timeZone: ChartTimeZone, marketSymbol: string,
): T[] {
  return filterTradeRecords(records, { ...filters, timeframes: 'ALL' }, timeZone).filter((record) => (
    filters.timeframes === 'ALL'
    || filters.timeframes.includes(record.signalTimeframe)
    || (marketSymbol === 'XAUUSD' && record.tradeStyle === 'SCALPING'
      && (record.signalTimeframe === 'M1' || record.signalTimeframe === 'M5')
      && (record.zoneTimeframe === 'M15' || record.zoneTimeframe === 'H1')
      && filters.timeframes.includes(record.zoneTimeframe))
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

/** Project a later intraday entry onto M1 when that same M15 Gold zone had a scalp. */
export function selectGoldIntradayAfterScalp<T extends FilterableTradeRecord & {
  id: string;
  zoneTimeframe: TradeTimeframe;
  tradeStyle?: string;
  signalAt?: number;
}>(records: readonly T[]): T[] {
  const zoneId = (record: T, prefix: string): string | undefined => {
    if (!record.id.startsWith(prefix) || record.signalAt === undefined) return undefined;
    const signalPosition = record.id.lastIndexOf(`:${record.signalAt}:`);
    return signalPosition > prefix.length ? record.id.slice(prefix.length, signalPosition) : undefined;
  };
  const scalpTimes = new Map<string, number>();
  for (const record of records) {
    if (record.tradeStyle !== 'SCALPING' || record.zoneTimeframe !== 'M15'
      || record.source !== 'ENGULFING') continue;
    const id = zoneId(record, 'GOLD_SCALP:M15:');
    if (id && record.signalAt !== undefined) {
      scalpTimes.set(id, Math.min(scalpTimes.get(id) ?? Infinity, record.signalAt));
    }
  }
  return records.filter((record) => {
    if (record.tradeStyle !== 'INTRADAY' || record.zoneTimeframe !== 'M15'
      || (record.signalTimeframe !== 'M15' && record.signalTimeframe !== 'M30')
      || record.source !== 'ENGULFING'
      || record.signalAt === undefined) return false;
    const id = zoneId(record, 'DIRECT:');
    return id !== undefined && (scalpTimes.get(id) ?? Infinity) < record.signalAt;
  });
}

/** Accuracy uses completed rows; entry arrows can also include filled active trades. */
export function selectTradeChartRecords<T extends FilterableTradeRecord & {
  id: string; zoneTimeframe: TradeTimeframe; tradeStyle?: string;
  signalAt?: number; openedAt?: number;
}>(records: readonly T[], chartTimeframe: TradeTimeframe,
  candles: readonly { time: number }[], projectGoldEntries = false,
  options: { includeActive?: boolean; asOf?: number } = {}): T[] {
  const eligible = records.filter((record) => {
    const active = record.result === 'open' || record.result === 'risk-free';
    if (active && (!options.includeActive || !Number.isFinite(record.signalAt)
      || !Number.isFinite(record.openedAt) || record.openedAt! < record.signalAt!)) return false;
    return options.asOf === undefined
      || (active ? record.openedAt! : record.completedAt) <= options.asOf;
  });
  const selected = selectAccuracyChartEntries(eligible, null, chartTimeframe);
  if (options.includeActive) selected.push(...eligible.filter((record) => (
    (record.result === 'open' || record.result === 'risk-free')
    && record.signalTimeframe === chartTimeframe
  )));
  if (projectGoldEntries && chartTimeframe === 'M1') {
    selected.push(...selectGoldIntradayAfterScalp(eligible));
  }
  if (projectGoldEntries && (chartTimeframe === 'M15' || chartTimeframe === 'H1')) {
    selected.push(...eligible.filter((record) => ((record.tradeStyle === 'SCALPING'
      && (record.signalTimeframe === 'M1' || record.signalTimeframe === 'M5'))
      || (chartTimeframe === 'H1' && record.tradeStyle === 'INTRADAY'
        && record.signalTimeframe !== 'H1'))
      && (record.result === 'tp' || record.result === 'sl' || record.result === 'rf'
        || (options.includeActive && (record.result === 'open' || record.result === 'risk-free')))
      && typeof record.openedAt === 'number' && Number.isFinite(record.openedAt)));
  }
  // The old per-record candle scan made each live chart refresh proportional
  // to every saved trade multiplied by every loaded candle.
  const candleTimes = new Set(candles.map((candle) => candle.time));
  const projectedTimes = chartTimeframe === 'M15' || chartTimeframe === 'H1'
    ? [...candleTimes].sort((first, second) => first - second) : [];
  const containsProjectedEntry = (openedAt: number | undefined): boolean => {
    if (openedAt === undefined || !Number.isFinite(openedAt)) return false;
    let low = 0;
    let high = projectedTimes.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (projectedTimes[middle] <= openedAt) low = middle + 1;
      else high = middle;
    }
    return low > 0 && openedAt < projectedTimes[low - 1] + tradeTimeframeSeconds(chartTimeframe);
  };
  const byId = new Map(selected.filter((record) => (
    record.signalTimeframe === chartTimeframe
      ? record.signalAt !== undefined && Number.isFinite(record.signalAt) && candleTimes.has(record.signalAt)
      : chartTimeframe !== 'M15' && chartTimeframe !== 'H1'
        ? record.openedAt !== undefined && Number.isFinite(record.openedAt) && candleTimes.has(record.openedAt)
        : containsProjectedEntry(record.openedAt)
  )).map((record) => [record.id, record]));
  return [...byId.values()].sort((first, second) => second.completedAt - first.completedAt);
}

export interface AccuracyVerificationCandle {
  time: number;
  high: number;
  low: number;
}

/** Loaded chart candles are chronological; locate one without scanning the full history. */
function candleIndexAtTime(candles: readonly { time: number }[], time: number, seconds?: number): number {
  if (!Number.isFinite(time)) return -1;
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  let index = low - 1;
  if (index < 0 || (seconds === undefined
    ? candles[index].time !== time : time >= candles[index].time + seconds)) return -1;
  while (index > 0 && candles[index - 1].time === candles[index].time) index -= 1;
  return index;
}

/** A saved chart signal must still be a completed engulfing when its candles are loaded. */
export function tradeSignalMatchesCandles(record: {
  signalAt?: number;
  engulfingType: string;
  direction: 'bullish' | 'bearish';
  engulfingCandleCount?: number;
}, candles: readonly StructureCandle[] | undefined): boolean {
  if (!candles?.length || record.signalAt === undefined) return true;
  const index = candleIndexAtTime(candles, record.signalAt);
  if (index < 0) return record.signalAt < candles[0].time
    || record.signalAt > candles[candles.length - 1].time;
  if (candles[index].complete === false) return false;
  // Engulfing patterns inspect at most ten bars ending at this candle.
  const localCandles = candles.slice(Math.max(0, index - 9), index + 1);
  const pattern = detectEngulfingPatternAt(localCandles, localCandles.length - 1);
  return pattern?.type === record.engulfingType && pattern.direction === record.direction
    && (record.engulfingCandleCount === undefined || pattern.candleCount === record.engulfingCandleCount);
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
  if (record.signalAt === undefined || !signalCandles
    || candleIndexAtTime(signalCandles, record.signalAt) < 0
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
    tradeStyle?: string;
  },
  candles: readonly AccuracyVerificationCandle[] | undefined,
  timeframeSeconds: number,
  priceTolerance = 0,
  signalBarSeconds = timeframeSeconds,
): boolean {
  if (!candles?.length || record.signalAt === undefined
    || !Number.isFinite(record.signalAt) || !Number.isFinite(record.completedAt)) return true;

  const signalIsLoaded = candleIndexAtTime(candles, record.signalAt) >= 0;
  const signalFallsInsideLoadedCandle = candleIndexAtTime(candles, record.signalAt, timeframeSeconds) >= 0;
  // A signal inside the loaded chart must have a verifiable fill and result.
  // A timestamp between candle opens is not a confirmation on this timeframe.
  // Records entirely before the loaded window remain in the saved history.
  if (signalFallsInsideLoadedCandle && !signalIsLoaded) return false;
  if (!signalIsLoaded) return true;

  const firstExecutionTime = record.signalAt + signalBarSeconds;
  const firstIndex = candleIndexAtTime(candles, firstExecutionTime, timeframeSeconds);
  const lastIndex = candleIndexAtTime(candles, record.completedAt, timeframeSeconds);
  if (firstIndex < 0 || lastIndex < 0 || lastIndex < firstIndex) return false;

  const buy = record.direction === 'bullish';
  const entryTime = record.openedAt ?? firstExecutionTime;
  let filled = false;
  let reachedOneR = false;
  const risk = Math.abs(record.entry - record.stopLoss);
  const oneR = buy ? record.entry + risk : record.entry - risk;
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const candle = candles[index];
    if (candle.time + timeframeSeconds <= entryTime) continue;
    if (!filled) {
      filled = candle.low <= record.entry + priceTolerance
        && candle.high >= record.entry - priceTolerance;
    }
    if (!filled) continue;
    const tpHit = buy ? candle.high >= record.takeProfit - priceTolerance
      : candle.low <= record.takeProfit + priceTolerance;
    const slHit = buy ? candle.low <= record.stopLoss + priceTolerance
      : candle.high >= record.stopLoss - priceTolerance;
    reachedOneR ||= buy ? candle.high >= oneR : candle.low <= oneR;
    // Match the existing trade engine's TP priority when both exits share a candle.
    if (tpHit) return index === lastIndex && record.result === 'tp';
    if (slHit) {
      const result = record.tradeStyle !== 'INTRADAY' && reachedOneR ? 'rf' : 'sl';
      return index === lastIndex && record.result === result;
    }
  }
  return false;
}

/** Shared validated record set for the journal, accuracy rows and historical entry arrows. */
export function buildCanonicalTradeRecords<T extends CanonicalTradeRecord>(
  saved: readonly T[], current: readonly T[], options: TradeRecordVerification,
): T[] {
  const { marketSymbol, pipSize, requireLtfFib, timeframeData, qualifyMtf } = options;
  const belongsToSelectedMarket = (record: T): boolean => {
    if (record.symbol) return record.symbol === marketSymbol;
    if (marketSymbol === 'XAUUSD') return record.entry >= 1000;
    if (record.entry >= 1000) return false;
    const entryTime = record.openedAt;
    const signalCandles = timeframeData[record.signalTimeframe]?.candles;
    const candleIndex = signalCandles && entryTime !== undefined
      ? candleIndexAtTime(signalCandles, entryTime, tradeTimeframeSeconds(record.signalTimeframe)) : -1;
    const candle = candleIndex >= 0 ? signalCandles?.[candleIndex] : undefined;
    return candle !== undefined && record.entry >= candle.low - pipSize * 3
      && record.entry <= candle.high + pipSize * 3;
  };
  const brokerRecord = (record: T) => (
    record.mt5Managed === true || record.brokerTicket !== undefined
  );
  const candidates = reconcileTradeRecords(saved, current, (record) => {
    if (!belongsToSelectedMarket(record)
      || ![record.entry, record.stopLoss, record.takeProfit, record.completedAt, record.signalAt,
        record.openedAt].every((value) => typeof value === 'number' && Number.isFinite(value))
      || record.openedAt! < record.signalAt!) return false;
    if (brokerRecord(record)) return ['open', 'risk-free', 'tp', 'sl', 'rf'].includes(record.result);
    if (!['tp', 'sl', 'rf'].includes(record.result) || record.completedAt < record.openedAt!
      || record.openedAt! < record.signalAt! + tradeTimeframeSeconds(record.signalTimeframe)
      || (record.direction === 'bullish'
        ? record.stopLoss >= record.entry || record.takeProfit <= record.entry
        : record.stopLoss <= record.entry || record.takeProfit >= record.entry)
      || !Number.isFinite(record.riskPips) || record.riskPips <= 0) return false;
    return marketSymbol !== 'XAUUSD' || isGoldTradeRecordRoute(record, requireLtfFib);
  });
  return candidates.flatMap((record): T[] => {
    // Broker executions are facts; another feed must not rewrite their fill or result.
    if (brokerRecord(record)) return [record];
    const signalCandles = timeframeData[record.signalTimeframe]?.candles;
    let verified = { ...record,
      tradeStyle: record.tradeStyle ?? (marketSymbol === 'XAUUSD' ? 'INTRADAY' : undefined) };
    if (record.source === 'MTF' && signalCandles && record.signalAt !== undefined
      && candleIndexAtTime(signalCandles, record.signalAt) >= 0) {
      if (record.signalAt === undefined || !['T1', 'T2', 'T3', 'T4'].includes(record.engulfingType)) return [];
      const qualification = qualifyMtf({
        id: record.id, signalTime: record.signalAt, direction: record.direction,
        engulfingType: record.engulfingType as 'T1' | 'T2' | 'T3' | 'T4',
        zoneName: record.zoneName, goldScalping: record.tradeStyle === 'SCALPING',
      });
      if (!qualification) return [];
      verified = { ...verified, fibSource: qualification.fibBand ? 'MTF FIB' : undefined,
        fibBand: qualification.fibBand };
    }
    const executionTimeframe = tradeTimeframeSeconds(verified.zoneTimeframe)
      < tradeTimeframeSeconds(verified.signalTimeframe) ? verified.zoneTimeframe : verified.signalTimeframe;
    const executionCandles = timeframeData[executionTimeframe]?.candles;
    if (!tradeSignalMatchesCandles(verified, signalCandles)
      || !accuracyResultMatchesCandles(verified, executionCandles,
        tradeTimeframeSeconds(executionTimeframe), 0,
        tradeTimeframeSeconds(verified.signalTimeframe))
      || !savedDirectZoneMatchesStructure(verified, signalCandles,
        timeframeData[verified.zoneTimeframe]?.structure.zones)
      || !savedGoldScalpMatchesReversal(verified,
        timeframeData[verified.zoneTimeframe]?.structure.zones, signalCandles)) return [];
    return [verified];
  });
}
