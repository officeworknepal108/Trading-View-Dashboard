import { detectAutoTrendlines, type AutoTrendline } from './autoTrendlines';
import { analyzeMarketStructure, detectEngulfingPatternAt, isZoneEligibleForEngulfingEntry,
  isGoldZoneEntryBlocked, type StructureCandle, type StructureZone } from './marketStructure';
import { calculateTradeLevels, getDirectTradeRule, isDeepDiscountTradeSignal,
  resolveDirectEntryPolicy, type EngulfingTradeSignal, type TradeLevels,
  type TradeRule, type TradeTimeframe } from './tradeLevels';
import { isGoldIntradayCandleRoute } from './goldScalping';
import { buildAlternatingSwingFibs, buildOneHourSwingFibs } from './swingFib';
import { buildDayFibs } from './dayFib';
import { applySwingFibConfluence, applyPostChochH1SwingFibConfluence } from './swingFibConfluence';
import { applyDayFibConfluence } from './dayFibConfluence';
import { applyOneMinuteGenesisQml } from './oneMinuteGenesis';
import { redundantStandaloneLiquidityZoneIds, selectExtremeAPlusTjl2Zones } from './zoneConfluence';
import { goldOpposingZoneBeforeOneR } from './mt5Automation';
import { isNepalTradingTime } from './tradingTime';

export const STUDY_SECONDS = { M1: 60, M5: 300, M15: 900, M30: 1800,
  H1: 3600, H4: 14400, D: 86400, W: 604800, MO: 2592000 } as const;
export type StudyTimeframe = keyof typeof STUDY_SECONDS;
export const STUDY_TIMEFRAMES = Object.keys(STUDY_SECONDS) as StudyTimeframe[];
export const STUDY_MAX_LOOKBACK = 2000;
export function studyTimeframes(zoneTimeframe: TradeTimeframe): StudyTimeframe[] {
  return STUDY_TIMEFRAMES.filter(tf => tf !== 'MO' && STUDY_SECONDS[tf] >= STUDY_SECONDS[zoneTimeframe]);
}

export function studyEntryTimeframes(symbol: string, zoneTimeframe: TradeTimeframe): TradeTimeframe[] {
  return (['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D'] as TradeTimeframe[]).filter(tf => (
    STUDY_SECONDS[tf] >= STUDY_SECONDS[zoneTimeframe] && getDirectTradeRule(zoneTimeframe, tf)
    && (symbol !== 'XAUUSD' || isGoldIntradayCandleRoute(zoneTimeframe, tf))
  ));
}
const CONFIRMATION = { M1: 300, M5: 900, M15: 3600, M30: 3600, H1: 14400,
  H4: 86400, D: 604800, W: 2419200, MO: undefined };
const SUPPORT: Record<StudyTimeframe, StudyTimeframe[]> = {
  M1: ['M5', 'M15'], M5: ['H1'], M15: ['H1', 'H4'], M30: ['H1', 'H4'],
  H1: ['H4', 'D'], H4: ['D', 'W'], D: ['W', 'MO'], W: ['MO'], MO: [],
};
export type StudyOutcome = 'pending' | 'active' | 'tp' | 'sl' | 'rf' | 'ambiguous' | 'cancelled';
export type StudyDistanceBand = 'Near' | 'Medium' | 'Far' | 'Unknown' | 'No trendline';
export const STUDY_DISTANCE_BANDS: StudyDistanceBand[] = ['Near', 'Medium', 'Far', 'Unknown', 'No trendline'];
export interface StudyDistanceContext {
  timeframe: TradeTimeframe;
  measuredAt?: number;
  atrPips?: number;
  nearPips?: number;
  mediumPips?: number;
}
export interface StudySupport {
  timeframe: StudyTimeframe;
  kind: AutoTrendline['kind'];
  color: 'green' | 'red';
  firstTime: number;
  secondTime: number;
  confirmedAt: number;
  geometry?: { time: number; price: number; slope: number };
  distance?: { linePrice: number; pips: number; atrRatio?: number; band: StudyDistanceBand };
}
export type StudyTrendlineType = 'all' | StudySupport['kind'];
export interface TrendlineStudyRecord {
  id: string;
  symbol: string;
  zoneId: string;
  zoneName: string;
  zoneTimeframe: TradeTimeframe;
  signal: EngulfingTradeSignal;
  fibGroup: 'With FIB' | 'No FIB' | 'FIB only' | 'No recorded support';
  fibSources: string[];
  support: StudySupport[];
  style: 'INTRADAY' | 'SCALPING';
  levels: TradeLevels;
  outcome: StudyOutcome;
  filledAt?: number;
  resolvedAt?: number;
  returnR?: number;
  distanceContext?: StudyDistanceContext;
  arrowDetails?: { source: string; mainZone: string; entryZone: string; fib: string; style: string;
    tradingTimeBlocked: boolean; unavailable: StudyTimeframe[] };
}
export interface EntryArrowStudyEntry {
  id: string;
  trade: TradeLevels;
  zoneTimeframe: TradeTimeframe;
  mainZone: string;
  entryZone: string;
  source: string;
  fib: string;
  style: string;
  tradingTimeBlocked: boolean;
}
export interface EntryArrowStudyInput {
  kind: 'entry-arrows';
  symbol: string;
  pipSize: number;
  cutoff: number;
  candles: Partial<Record<StudyTimeframe, StructureCandle[]>>;
  entries: EntryArrowStudyEntry[];
}

/** Study the arrow's recorded levels and outcome without running a new simulation. */
export function runEntryArrowStudy(input: EntryArrowStudyInput,
  progress: (done: number, total: number) => void = () => undefined): TrendlineStudyResult {
  const records: TrendlineStudyRecord[] = [];
  const cache = new Map<string, AutoTrendline[]>();
  const seen = new Set<string>();
  for (const [index, entry] of input.entries.entries()) {
    progress(index + 1, input.entries.length);
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const { trade } = entry;
    const confirmedAt = studyCloseTime(trade.signal.time, trade.signal.timeframe);
    if (confirmedAt > input.cutoff || (trade.filledAt ?? confirmedAt) > input.cutoff) continue;
    const support = collectStudySupport(input.candles, entry.zoneTimeframe,
      trade.signal.direction === 'bullish', confirmedAt, input.pipSize, cache);
    const unavailable = studyTimeframes(entry.zoneTimeframe).filter(tf => (
      studyClosedCandles(input.candles[tf] ?? [], tf, confirmedAt).length < 9
    ));
    const fibSources = entry.fib && !/^(not recorded|no fib|none)$/i.test(entry.fib.trim()) ? [entry.fib] : [];
    // RF status can describe a still-open position. Only a final result closes it.
    const outcome: StudyOutcome = trade.result ?? (trade.status === 'tp-hit' ? 'tp'
      : trade.status === 'sl-hit' ? 'sl' : trade.status === 'pending' ? 'pending' : 'active');
    records.push({ id: entry.id, symbol: input.symbol, zoneId: entry.id,
      zoneName: entry.mainZone, zoneTimeframe: entry.zoneTimeframe,
      signal: { ...trade.signal }, levels: { ...trade, signal: { ...trade.signal } },
      style: entry.style === 'SCALPING' ? 'SCALPING' : 'INTRADAY',
      fibGroup: studyComparisonGroup(fibSources, support) ?? 'No recorded support', fibSources, support,
      outcome, filledAt: trade.filledAt, resolvedAt: trade.resolvedAt,
      returnR: outcome === 'tp' ? trade.rewardRisk : outcome === 'sl' ? -1 : outcome === 'rf' ? 0 : undefined,
      arrowDetails: { source: entry.source, mainZone: entry.mainZone, entryZone: entry.entryZone,
        fib: entry.fib, style: entry.style, tradingTimeBlocked: entry.tradingTimeBlocked, unavailable } });
  }
  return { records: records.map(record => measureStudyRecordDistance(record, input.candles, input.pipSize)), scanned: input.entries.length,
    from: records.length ? Math.min(...records.map(r => r.signal.time)) : undefined,
    to: input.cutoff, missingTimeframes: [...new Set(records.flatMap(r => r.arrowDetails!.unavailable))] };
}
export interface TrendlineStudyInput {
  symbol: string;
  pipSize: number;
  zoneTimeframe: TradeTimeframe;
  candles: Partial<Record<StudyTimeframe, StructureCandle[]>>;
  cutoff: number;
  lookback: number;
  fromTime?: number;
  historyWarnings?: string[];
  tradingTimeEnabled: boolean;
}
export interface TrendlineStudyResult {
  records: TrendlineStudyRecord[];
  scanned: number;
  from?: number;
  to: number;
  missingTimeframes: StudyTimeframe[];
  historyWarnings?: string[];
}
export type StudySnapshot = Pick<TrendlineStudyInput, 'symbol' | 'zoneTimeframe' | 'lookback' | 'tradingTimeEnabled' | 'fromTime'>
  & { version: 3; result: TrendlineStudyResult };

/** Validate locally saved journal data before it reaches chart coordinate APIs. */
export function readStudySnapshot(raw: string | null, symbol: string): StudySnapshot | undefined {
  try {
    const saved = JSON.parse(raw ?? 'null');
    const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
    const optionalTime = (value: unknown) => value === undefined || finite(value);
    const tf = (value: unknown) => typeof value === 'string' && Object.hasOwn(STUDY_SECONDS, value);
    const result = saved?.result;
    if (saved?.version !== 3 || saved.symbol !== symbol || !['M1', 'M5', 'M15', 'H1'].includes(saved.zoneTimeframe)
      || !finite(saved.lookback) || typeof saved.tradingTimeEnabled !== 'boolean'
      || !optionalTime(saved.fromTime)
      || !result || !finite(result.to) || !optionalTime(result.from) || !finite(result.scanned)
      || (result.historyWarnings !== undefined && (!Array.isArray(result.historyWarnings)
        || !result.historyWarnings.every((s: unknown) => typeof s === 'string')))
      || !Array.isArray(result.records) || result.records.length > 10000
      || !Array.isArray(result.missingTimeframes) || !result.missingTimeframes.every(tf)) return undefined;
    for (const r of result.records) {
      if (!r || typeof r.id !== 'string' || r.symbol !== symbol || typeof r.zoneId !== 'string'
        || typeof r.zoneName !== 'string' || r.zoneTimeframe !== saved.zoneTimeframe
        || !['With FIB', 'No FIB', 'FIB only'].includes(r.fibGroup) || !['INTRADAY', 'SCALPING'].includes(r.style)
        || !Array.isArray(r.fibSources) || !r.fibSources.every((s: unknown) => typeof s === 'string')
        || !r.signal || !tf(r.signal.timeframe) || !finite(r.signal.time) || !finite(r.signal.candleCount)
        || STUDY_SECONDS[r.signal.timeframe as StudyTimeframe] < STUDY_SECONDS[r.zoneTimeframe as StudyTimeframe]
        || !['T1', 'T2', 'T3', 'T4'].includes(r.signal.type) || !['bullish', 'bearish'].includes(r.signal.direction)
        || !r.levels || !['entry', 'stopLoss', 'takeProfit', 'riskFree', 'riskPips', 'rewardRisk', 'calculatedAt']
          .every(key => finite(r.levels[key])) || typeof r.levels.pendingAtCreation !== 'boolean'
        || !['pending', 'active', 'tp', 'sl', 'rf', 'ambiguous', 'cancelled'].includes(r.outcome)
        || !optionalTime(r.returnR) || !optionalTime(r.filledAt) || !optionalTime(r.resolvedAt)
        || (r.distanceContext !== undefined && (!r.distanceContext || !tf(r.distanceContext.timeframe)
          || !['measuredAt', 'atrPips', 'nearPips', 'mediumPips'].every(key => optionalTime(r.distanceContext[key]))))
        || !Array.isArray(r.support) || studyComparisonGroup(r.fibSources, r.support) !== r.fibGroup
        || !r.support.every((s: StudySupport) => s
          && tf(s.timeframe) && ['green', 'red'].includes(s.color) && ['continuation', 'breakout'].includes(s.kind)
          && finite(s.firstTime) && finite(s.secondTime) && finite(s.confirmedAt)
          && (s.geometry === undefined || s.geometry && finite(s.geometry.time) && finite(s.geometry.price) && finite(s.geometry.slope))
          && (s.distance === undefined || s.distance && finite(s.distance.linePrice) && finite(s.distance.pips)
            && s.distance.pips >= 0 && optionalTime(s.distance.atrRatio)
            && s.distance.band === studyDistanceBand(s.distance.atrRatio)))) return undefined;
    }
    return saved;
  } catch { return undefined; }
}

export function studyCloseTime(time: number, timeframe: StudyTimeframe): number {
  if (timeframe !== 'MO') return time + STUDY_SECONDS[timeframe];
  const date = new Date(time * 1000);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.getTime() / 1000;
}

export function studyClosedCandles(candles: StructureCandle[], timeframe: StudyTimeframe,
  cutoff: number): StructureCandle[] {
  return candles.filter(c => c.complete !== false && studyCloseTime(c.time, timeframe) <= cutoff);
}

// Shared by the selection preview and worker so both use the same actual dates,
// including gaps, unfinished bars and replay's historical cutoff.
export function studyLookbackWindow(candles: StructureCandle[], timeframe: StudyTimeframe,
  cutoff: number, lookback: number) {
  const requested = Math.max(1, Math.min(STUDY_MAX_LOOKBACK, Math.floor(lookback) || 200));
  const completed = studyClosedCandles(candles, timeframe, cutoff);
  const bars = Math.min(requested, completed.length);
  return { from: bars ? completed[completed.length - bars].time : undefined,
    to: cutoff, bars, requested, available: completed.length };
}

export function studyDateWindow(candles: StructureCandle[], timeframe: StudyTimeframe,
  cutoff: number, fromTime: number) {
  const completed = studyClosedCandles(candles, timeframe, cutoff);
  const selected = completed.filter(c => c.time >= fromTime);
  return { from: fromTime, to: cutoff, bars: selected.length, firstBar: selected[0]?.time,
    availableFrom: completed[0]?.time,
    needsHistory: !completed.length || completed[0].time > fromTime };
}

/** The date picker uses local midnight, matching the dates shown in the panel. */
export function studyLocalDateStart(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.getTime() / 1000;
}

export function studyLocalDateValue(time: number): string {
  const date = new Date(time * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Breakout colors reverse the original slope's directional meaning.
export function trendlineSupportsBuy(line: Pick<AutoTrendline, 'direction' | 'kind'>): boolean {
  return (line.direction === 'up') === (line.kind === 'continuation');
}

export function collectStudySupport(candles: Partial<Record<StudyTimeframe, StructureCandle[]>>,
  zoneTimeframe: TradeTimeframe, isBuy: boolean, at: number, pipSize: number,
  cache = new Map<string, AutoTrendline[]>()): StudySupport[] {
  const support: StudySupport[] = [];
  for (const tf of STUDY_TIMEFRAMES.filter(tf => tf !== 'MO'
    && STUDY_SECONDS[tf] >= STUDY_SECONDS[zoneTimeframe])) {
    const history = studyClosedCandles(candles[tf] ?? [], tf, at);
    const key = `${tf}:${history.at(-1)?.time}`;
    let lines = cache.get(key);
    if (!lines) { lines = detectAutoTrendlines(history, pipSize); cache.set(key, lines); }
    for (const line of lines.filter(l => trendlineSupportsBuy(l) === isBuy)) {
      support.push({ timeframe: tf, kind: line.kind, color: isBuy ? 'green' : 'red',
        firstTime: history[line.firstIndex].time, secondTime: history[line.secondIndex].time,
        confirmedAt: studyCloseTime(history[line.thirdTouchIndex!].time, tf),
        geometry: { time: history.at(-1)!.time, slope: line.slope,
          price: line.firstPrice + line.slope * (history.length - 1 - line.firstIndex) } });
    }
  }
  return support;
}

/** Wilder ATR(14), using only candles closed at the measurement time. */
export function studyEntryAtr(candles: StructureCandle[], timeframe: TradeTimeframe, at: number): number | undefined {
  const closed = studyClosedCandles(candles, timeframe, at);
  if (closed.length < 15) return undefined;
  let atr = 0;
  for (let i = 1; i < closed.length; i++) {
    const c = closed[i];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - closed[i - 1].close), Math.abs(c.low - closed[i - 1].close));
    if (!Number.isFinite(tr) || tr < 0) return undefined;
    atr = i <= 14 ? atr + tr : (atr * 13 + tr) / 14;
    if (i === 14) atr /= 14;
  }
  return atr > 0 && Number.isFinite(atr) ? atr : undefined;
}

export function studyDistanceBand(atrRatio: number | undefined): StudyDistanceBand {
  return atrRatio === undefined || !Number.isFinite(atrRatio) || atrRatio < 0 ? 'Unknown'
    : atrRatio <= .25 + 1e-12 ? 'Near' : atrRatio <= .5 + 1e-12 ? 'Medium' : 'Far';
}

/** Project the line frozen at confirmation to entry time in actual candle steps.
 * Only timestamps after confirmation are used; gaps do not become phantom bars. */
export function studySupportPriceAt(support: StudySupport, candles: StructureCandle[], at: number): number | undefined {
  const base = support.geometry;
  if (!base || at < base.time || at < support.confirmedAt) return undefined;
  const bars = candles.filter(c => c.time >= base.time && c.time <= at);
  const last = bars.at(-1);
  if (bars[0]?.time !== base.time || !last || at > studyCloseTime(last.time, support.timeframe)) return undefined;
  const fraction = (at - last.time) / (studyCloseTime(last.time, support.timeframe) - last.time);
  const price = base.price + base.slope * (bars.length - 1 + fraction);
  return Number.isFinite(price) ? price : undefined;
}

export function measureStudySupportDistance(support: StudySupport[],
  candles: Partial<Record<StudyTimeframe, StructureCandle[]>>, trade: TradeLevels, pipSize: number,
  filledAt = trade.filledAt): { support: StudySupport[]; distanceContext: StudyDistanceContext } {
  const at = filledAt ?? (trade.pendingAtCreation ? undefined
    : Math.max(trade.calculatedAt, studyCloseTime(trade.signal.time, trade.signal.timeframe)));
  const atr = at === undefined ? undefined : studyEntryAtr(candles[trade.signal.timeframe] ?? [], trade.signal.timeframe, at);
  const validPip = Number.isFinite(pipSize) && pipSize > 0;
  const atrPips = validPip && atr !== undefined ? atr / pipSize : undefined;
  return { distanceContext: { timeframe: trade.signal.timeframe, measuredAt: at, atrPips,
    nearPips: atrPips === undefined ? undefined : atrPips * .25,
    mediumPips: atrPips === undefined ? undefined : atrPips * .5 },
    support: support.map(line => {
      const { distance: _previous, ...original } = line;
      const linePrice = at === undefined ? undefined : studySupportPriceAt(line, candles[line.timeframe] ?? [], at);
      if (linePrice === undefined || !validPip) return original;
      const pips = Math.abs(trade.entry - linePrice) / pipSize;
      const atrRatio = atrPips === undefined ? undefined : pips / atrPips;
      return { ...original, distance: { linePrice, pips, atrRatio, band: studyDistanceBand(atrRatio) } };
    }) };
}

function measureStudyRecordDistance(record: TrendlineStudyRecord,
  candles: Partial<Record<StudyTimeframe, StructureCandle[]>>, pipSize: number): TrendlineStudyRecord {
  return { ...record, ...measureStudySupportDistance(record.support, candles, record.levels, pipSize, record.filledAt) };
}

/** Nearest measured supporting line; one trade contributes once to the summary. */
export function studyRecordDistanceBand(record: TrendlineStudyRecord): StudyDistanceBand {
  if (!record.support.length) return 'No trendline';
  const distances = record.support.flatMap(line => line.distance?.atrRatio === undefined ? [] : [line.distance.atrRatio]);
  return studyDistanceBand(distances.length ? Math.min(...distances) : undefined);
}

export function filterStudyDistance(records: TrendlineStudyRecord[], band: StudyDistanceBand | 'All'): TrendlineStudyRecord[] {
  return band === 'All' ? records : records.filter(record => studyRecordDistanceBand(record) === band);
}

export function studyDistanceBreakdown(records: TrendlineStudyRecord[], byTimeframe = false) {
  const buckets = new Map<string, { key: string; band: StudyDistanceBand; timeframe?: StudyTimeframe;
    kind?: StudySupport['kind']; records: Map<string, TrendlineStudyRecord> }>();
  for (const record of records) {
    const pairs: Array<{ timeframe?: StudyTimeframe; kind?: StudySupport['kind'] }> = byTimeframe ? [...new Map(record.support.map(line => [
      `${line.timeframe}:${line.kind}`, { timeframe: line.timeframe, kind: line.kind },
    ])).values()] : [{}];
    if (!pairs.length) pairs.push({});
    for (const pair of pairs) {
      const subset = pair.timeframe ? record.support.filter(line => line.timeframe === pair.timeframe && line.kind === pair.kind) : record.support;
      const band = studyRecordDistanceBand({ ...record, support: subset });
      const key = `${pair.timeframe ? `${pair.timeframe}:${pair.kind}` : 'all'}:${band}`;
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { key, band, ...pair, records: new Map() }; buckets.set(key, bucket); }
      bucket.records.set(record.id, record);
    }
  }
  return [...buckets.values()].map(({ records: trades, ...row }) => ({ ...row,
    recordIds: [...trades.keys()], stats: studyAccuracy([...trades.values()]) })).sort((a, b) => (
    (a.timeframe ? STUDY_SECONDS[a.timeframe] : 0) - (b.timeframe ? STUDY_SECONDS[b.timeframe] : 0)
    || (a.kind ?? '').localeCompare(b.kind ?? '') || STUDY_DISTANCE_BANDS.indexOf(a.band) - STUDY_DISTANCE_BANDS.indexOf(b.band)
  ));
}

export function studyFibSources(zone: StructureZone, pattern: StructureCandle[]): string[] {
  const sources: string[] = [];
  const touches50 = zone.fibLevel50 !== undefined
    && pattern.some(c => c.low <= zone.fibLevel50! && c.high >= zone.fibLevel50!);
  // DB/DT and Major Liquidity exemptions are not numerical FIB alignment.
  if (zone.fibStatus === 'a-plus' && zone.fibBand
    && (zone.fibBand !== '0.5-0.618' || touches50)) sources.push(`Structure ${zone.fibBand}`);
  if (zone.swingFibStatus === 'a-plus' && zone.swingFibBand) sources.push(`4H Swing ${zone.swingFibBand}`);
  if (zone.h1SwingFibStatus === 'aligned' && zone.h1SwingFibBand) sources.push(`1H Swing ${zone.h1SwingFibBand}`);
  if (zone.dayFibStatus === 'a-plus' && zone.dayFibBand) sources.push(`Day ${zone.dayFibBand}`);
  return sources;
}

export function studyComparisonGroup(fibSources: readonly string[], support: readonly StudySupport[]): TrendlineStudyRecord['fibGroup'] | undefined {
  if (support.length) return fibSources.length ? 'With FIB' : 'No FIB';
  return fibSources.length ? 'FIB only' : undefined;
}

export function studyCandleRule(symbol: string, zone: StructureZone, zoneTf: TradeTimeframe,
  signalTf: TradeTimeframe): { rule: TradeRule; style: 'INTRADAY' } | undefined {
  if (STUDY_SECONDS[signalTf] < STUDY_SECONDS[zoneTf]) return undefined;
  if (symbol === 'XAUUSD' && !isGoldIntradayCandleRoute(zoneTf, signalTf)) return undefined;
  const rule = getDirectTradeRule(zoneTf, signalTf);
  return rule ? { rule, style: 'INTRADAY' } : undefined;
}

// Reuse the production level calculation with an open-only entry candle. Outcomes
// are evaluated separately so a future TP never suppresses a pending setup.
export function studyEntryLevels(sourceCandles: StructureCandle[], entryCandle: StructureCandle,
  signal: EngulfingTradeSignal, rule: TradeRule, omitStopBuffer = false): TradeLevels | undefined {
  const levels = calculateTradeLevels({ sourceCandles, signal, rule, omitStopBuffer,
    executionCandles: [{ ...entryCandle, high: entryCandle.open, low: entryCandle.open,
      close: entryCandle.open }], riskFreeEnabled: false });
  return levels && { ...levels, status: levels.pendingAtCreation ? 'pending' : 'active',
    result: undefined, resolvedAt: undefined };
}

export function evaluateStudyOutcome(levels: TradeLevels, execution: StructureCandle[],
  mode: 'fixed' | 'half-at-1r' | 'risk-free', tradingTimeEnabled = false,
  pendingZoneValid: (at: number) => boolean = () => true): Pick<TrendlineStudyRecord,
  'outcome' | 'returnR' | 'filledAt' | 'resolvedAt'> {
  const buy = levels.signal.direction === 'bullish';
  let filled = !levels.pendingAtCreation;
  let filledAt = filled ? levels.calculatedAt : undefined;
  let reachedOneR = false;
  for (const candle of execution) {
    if (candle.complete === false || candle.time < levels.calculatedAt) continue;
    const target = buy ? candle.high >= levels.takeProfit : candle.low <= levels.takeProfit;
    const stop = buy ? candle.low <= levels.stopLoss : candle.high >= levels.stopLoss;
    const oneR = buy ? candle.high >= levels.riskFree : candle.low <= levels.riskFree;
    let newlyFilled = false;
    if (!filled) {
      if (!pendingZoneValid(candle.time)) return { outcome: 'cancelled', resolvedAt: candle.time };
      const touched = buy ? candle.low <= levels.entry : candle.high >= levels.entry;
      if (!touched) {
        if (target) return { outcome: 'cancelled', resolvedAt: candle.time };
        continue;
      }
      if (tradingTimeEnabled && !isNepalTradingTime(candle.time)) {
        return { outcome: 'cancelled', resolvedAt: candle.time };
      }
      filled = true;
      newlyFilled = true;
      filledAt = candle.time;
    }
    // OHLC cannot determine intrabar order. Exclude unresolved ordering from
    // accuracy instead of inheriting the normal simulator's TP-first ordering.
    if ((target && stop) || (stop && oneR && !reachedOneR && mode !== 'fixed')
      || (newlyFilled && (target || oneR && mode !== 'fixed'))) {
      return { outcome: 'ambiguous', filledAt, resolvedAt: candle.time };
    }
    if (target) return { outcome: 'tp', filledAt, resolvedAt: candle.time,
      returnR: mode === 'half-at-1r' ? (1 + levels.rewardRisk) / 2 : levels.rewardRisk };
    if (stop) return { outcome: reachedOneR && mode !== 'fixed' ? 'rf' : 'sl',
      filledAt, resolvedAt: candle.time, returnR: reachedOneR && mode !== 'fixed' ? 0 : -1 };
    reachedOneR ||= oneR;
  }
  return { outcome: filled ? 'active' : 'pending', filledAt };
}

export function studyAccuracy(records: TrendlineStudyRecord[]) {
  const tp = records.filter(r => r.outcome === 'tp').length;
  const sl = records.filter(r => r.outcome === 'sl').length;
  const rf = records.filter(r => r.outcome === 'rf').length;
  const completed = tp + sl + rf;
  const totalR = records.reduce((sum, r) => sum + (r.returnR ?? 0), 0);
  return { total: records.length, tp, sl, rf, completed,
    accuracy: completed ? tp / completed * 100 : undefined,
    totalR, averageR: completed ? totalR / completed : undefined,
    pending: records.filter(r => r.outcome === 'pending' || r.outcome === 'active').length,
    ambiguous: records.filter(r => r.outcome === 'ambiguous').length,
    cancelled: records.filter(r => r.outcome === 'cancelled').length };
}

/** Filter recorded entry evidence without changing prices, outcomes or groups. */
export function filterStudyTrendlineType(records: TrendlineStudyRecord[], kind: StudyTrendlineType): TrendlineStudyRecord[] {
  if (kind === 'all') return records;
  return records.flatMap(record => {
    const support = record.support.filter(line => line.kind === kind);
    return support.length ? [{ ...record, support }] : [];
  });
}

export interface StudyTrendlineBreakdown {
  key: string;
  timeframe?: StudyTimeframe;
  kind?: StudySupport['kind'];
  fibGroup: TrendlineStudyRecord['fibGroup'];
  recordIds: string[];
  stats: ReturnType<typeof studyAccuracy>;
}

/** Rows overlap when one trade has several supporting timeframe/type pairs.
 * Deduplicate anchors and record IDs within each row; never sum rows as trades. */
export function studyTrendlineBreakdown(records: TrendlineStudyRecord[]): StudyTrendlineBreakdown[] {
  const buckets = new Map<string, Omit<StudyTrendlineBreakdown, 'stats' | 'recordIds'>
    & { records: Map<string, TrendlineStudyRecord> }>();
  for (const record of records) {
    const matches: Array<{ timeframe?: StudyTimeframe; kind?: StudySupport['kind'] }> = record.support.length
      ? record.support.map(({ timeframe, kind }) => ({ timeframe, kind }))
      : record.fibGroup === 'FIB only' || record.fibGroup === 'No recorded support' ? [{}] : [];
    for (const match of matches) {
      const key = `${match.timeframe ?? 'none'}:${match.kind ?? 'none'}:${record.fibGroup}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, ...match, fibGroup: record.fibGroup, records: new Map() };
        buckets.set(key, bucket);
      }
      bucket.records.set(record.id, record);
    }
  }
  const groups = ['With FIB', 'No FIB', 'FIB only', 'No recorded support'];
  return [...buckets.values()].sort((a, b) => (
    (a.timeframe ? STUDY_SECONDS[a.timeframe] : Infinity) - (b.timeframe ? STUDY_SECONDS[b.timeframe] : Infinity)
    || (a.kind === b.kind ? 0 : a.kind === 'continuation' ? -1 : 1)
    || groups.indexOf(a.fibGroup) - groups.indexOf(b.fibGroup)
  )).map(({ records: trades, ...row }) => ({ ...row,
    recordIds: [...trades.keys()], stats: studyAccuracy([...trades.values()]) }));
}

export function runTrendlineStudy(input: TrendlineStudyInput,
  progress: (done: number, total: number) => void = () => undefined): TrendlineStudyResult {
  const { zoneTimeframe, symbol, cutoff } = input;
  if (input.fromTime !== undefined && (!Number.isFinite(input.fromTime) || input.fromTime >= cutoff)) {
    throw new Error('Choose a start date before the study end time.');
  }
  const gold = symbol === 'XAUUSD';
  const allowed = new Set(studyTimeframes(zoneTimeframe));
  const all = Object.fromEntries(STUDY_TIMEFRAMES.map(tf => [tf,
    allowed.has(tf) ? studyClosedCandles(input.candles[tf] ?? [], tf, cutoff) : []])) as Record<StudyTimeframe, StructureCandle[]>;
  const snapshots = new Map<string, ReturnType<typeof analyzeMarketStructure>>();
  const prefixes = (tf: StudyTimeframe, at: number) => studyClosedCandles(all[tf], tf, at);
  const analyze = (tf: StudyTimeframe, at: number, withSupport = false): ReturnType<typeof analyzeMarketStructure> => {
    const candles = prefixes(tf, at);
    const key = `${tf}:${candles.at(-1)?.time}:${withSupport}`;
    let result = snapshots.get(key);
    if (!result) {
      result = analyzeMarketStructure(candles, {
        allowSupplyDemand: ['H1', 'H4', 'D', 'W', 'MO'].includes(tf),
        sourceBarSeconds: STUDY_SECONDS[tf], confirmationBarSeconds: CONFIRMATION[tf], zoneVisualBars: 30,
        ...(withSupport ? { vipSupport: SUPPORT[tf].map(s => ({ timeframe: s,
          zones: analyze(s, at).zones })) } : {}),
      });
      snapshots.set(key, result);
      // Historical analyses contain many zones/lines; keep a bounded working cache.
      if (snapshots.size > 64) snapshots.delete(snapshots.keys().next().value!);
    }
    return result;
  };
  const zonesAt = (at: number) => {
    const candles = prefixes(zoneTimeframe, at);
    const base = analyze(zoneTimeframe, at, true);
    const h4 = prefixes('H4', at);
    const seed = analyze('H4', at).lines.filter(l => l.type === 'swing'
      && l.fromTime !== l.toTime && l.fromPrice !== l.toPrice).sort((a, b) => a.toTime - b.toTime)[0];
    const moves = seed ? buildAlternatingSwingFibs(h4, { sourceTime: seed.fromTime,
      sourcePrice: seed.fromPrice, zeroTime: seed.toTime, zeroPrice: seed.toPrice }) : [];
    let zones = applySwingFibConfluence(candles, base.zones,
      ['M15', 'M30', 'H1'].includes(zoneTimeframe) ? moves : undefined).zones;
    const dayMoves = ['M15', 'M30'].includes(zoneTimeframe) ? buildDayFibs(candles) : [];
    zones = applyDayFibConfluence(candles, zones, dayMoves.at(-1)).zones;
    if (gold && zoneTimeframe === 'M15') zones = applyPostChochH1SwingFibConfluence(candles,
      zones, base.lines, buildOneHourSwingFibs(prefixes('H1', at), analyze('H1', at).markers));
    if (zoneTimeframe === 'M1') zones = applyOneMinuteGenesisQml(zones, candles, prefixes('D', at));
    return zones;
  };
  const routeTfs = studyEntryTimeframes(symbol, zoneTimeframe);
  const from = input.fromTime ?? studyLookbackWindow(all[zoneTimeframe], zoneTimeframe, cutoff, input.lookback).from;
  const events = routeTfs.flatMap(tf => all[tf].flatMap((c, i) => {
    const at = studyCloseTime(c.time, tf);
    if (from === undefined || (input.fromTime === undefined ? c.time : at) < from) return [];
    const pattern = detectEngulfingPatternAt(all[tf], i);
    return pattern ? [{ tf, index: i, pattern, at }] : [];
  })).sort((a, b) => a.at - b.at || STUDY_SECONDS[a.tf] - STUDY_SECONDS[b.tf]);
  const records: TrendlineStudyRecord[] = [];
  const usedZones = new Set<string>();
  const trendCache = new Map<string, AutoTrendline[]>();
  let scanned = 0;
  for (const event of events) {
    scanned++;
    progress(scanned, events.length);
    if (input.tradingTimeEnabled && !isNepalTradingTime(event.at)) continue;
    // Missing FIB source history must never be counted as a No FIB result.
    const required = new Set<StudyTimeframe>([zoneTimeframe, ...SUPPORT[zoneTimeframe],
      ...(['M15', 'M30', 'H1'].includes(zoneTimeframe) ? ['H4' as const] : [])]);
    if ([...required].some(tf => prefixes(tf, event.at).length < 12)) continue;
    const source = all[event.tf].slice(0, event.index + 1);
    const signal: EngulfingTradeSignal = { type: event.pattern.type, direction: event.pattern.direction,
      time: source.at(-1)!.time, candleCount: event.pattern.candleCount, timeframe: event.tf };
    const patternCandles = source.slice(-signal.candleCount);
    const zones = zonesAt(event.at);
    const blocked = selectExtremeAPlusTjl2Zones(zones, input.pipSize).blockedZoneIds;
    const redundant = redundantStandaloneLiquidityZoneIds(zones, input.pipSize);
    for (const zone of zones) {
      if (usedZones.has(zone.id) || blocked.has(zone.id) || redundant.has(zone.id)
        || !isZoneEligibleForEngulfingEntry(zone) || zone.isBuy !== (signal.direction === 'bullish')) continue;
      const validFrom = Math.max(zone.startTime, zone.activeFromTime ?? 0, zone.confirmationTime ?? 0);
      if (signal.time < validFrom) continue;
      const route = studyCandleRule(symbol, zone, zoneTimeframe, event.tf);
      if (!route) continue;
      if (!patternCandles.some(c => c.time > zone.startTime && c.time >= validFrom
        && c.high >= zone.bottom && c.low <= zone.top)) continue;
      if (gold && isGoldZoneEntryBlocked(zone, prefixes(zoneTimeframe, event.at), zoneTimeframe,
        input.pipSize, signal.time)) continue;
      if (gold && zoneTimeframe === 'M15' && event.tf === 'M15' && zones.some(db => db.name === 'DB'
        && db.active && db.m15H1ChochClosePending && db.isBuy === zone.isBuy
        && signal.time >= (db.chochTime ?? db.startTime) && zone.bottom <= db.top && db.bottom <= zone.top
        && source.at(-1)!.low <= db.top && source.at(-1)!.high >= db.bottom)) continue;
      const policy = resolveDirectEntryPolicy({ zoneTimeframe, signal, sourceCandles: source, baseRule: route.rule });
      if (!policy.allowed || !policy.rule) continue;
      const support = collectStudySupport(all, zoneTimeframe, zone.isBuy, event.at, input.pipSize, trendCache);
      const fibSources = studyFibSources(zone, patternCandles);
      const fibGroup = studyComparisonGroup(fibSources, support);
      if (!fibGroup) continue;
      const executionTf = STUDY_SECONDS[event.tf] < STUDY_SECONDS[zoneTimeframe] ? event.tf : zoneTimeframe;
      const execution = all[executionTf].filter(c => c.time >= event.at);
      const entryCandle = execution[0];
      if (!entryCandle) continue;
      if (input.tradingTimeEnabled && !isNepalTradingTime(entryCandle.time)) continue;
      const levels = studyEntryLevels(source, entryCandle, signal, policy.rule,
        !gold && isDeepDiscountTradeSignal(zone, signal));
      if (!levels) continue;
      if (gold && goldOpposingZoneBeforeOneR({ direction: zone.isBuy ? 'BUY' : 'SELL',
        entry: levels.entry, stopLoss: levels.stopLoss, signalAt: signal.time },
      (['M15', 'H1', 'H4'] as const).filter(tf => allowed.has(tf))
        .flatMap(tf => tf === zoneTimeframe ? zones : analyze(tf, event.at).zones))) continue;
      usedZones.add(zone.id);
      records.push({ id: `TL:${symbol}:${zoneTimeframe}:${zone.id}:${signal.time}:${event.tf}`,
        symbol, zoneId: zone.id, zoneName: zone.name, zoneTimeframe, signal,
        fibGroup, fibSources, support, style: route.style,
        levels, ...evaluateStudyOutcome(levels, execution,
          !gold ? 'risk-free' : 'fixed', input.tradingTimeEnabled,
          at => {
            const current = analyze(zoneTimeframe, at, true).zones.find(z => z.id === zone.id);
            return !!current && isZoneEligibleForEngulfingEntry(current)
              && (!gold || !isGoldZoneEntryBlocked(current, prefixes(zoneTimeframe, at),
                zoneTimeframe, input.pipSize, at));
          }) });
    }
  }
  return { records: records.map(record => measureStudyRecordDistance(record, all, input.pipSize)), scanned, from, to: cutoff,
    ...(input.historyWarnings?.length ? { historyWarnings: input.historyWarnings } : {}),
    missingTimeframes: studyTimeframes(zoneTimeframe).filter(tf => all[tf].length < 12) };
}

export function studyJournalCsv(records: TrendlineStudyRecord[]): string {
  const header = ['Study ID', 'Symbol', 'Zone', 'Zone TF', 'Engulfing TF', 'Engulfing type', 'Direction',
    'Signal UTC', 'FIB group', 'FIB sources', 'Trendline support', 'Style', 'Entry', 'SL', 'TP', 'RR',
    'Outcome', 'Return R', 'Filled UTC', 'Resolved UTC', 'Source', 'Main zone', 'Entry zone',
    'Recorded FIB', 'Risk-free price', 'Risk pips', 'Arrow status', 'Confirmation UTC',
    'Outside trading hours', 'Insufficient trendline history', 'Risk-free enabled',
    'Nearest measured trendline distance group', 'Distance measured UTC', 'ATR timeframe', 'ATR14 pips',
    'Near limit pips', 'Medium limit pips', 'Trendline distances'];
  const iso = (t?: number) => t === undefined ? '' : new Date(t * 1000).toISOString();
  const rows = records.map(r => [r.id, r.symbol, r.zoneName, r.zoneTimeframe, r.signal.timeframe,
    r.signal.type, r.signal.direction, iso(r.signal.time), r.fibGroup, r.fibSources.join('; '),
    r.support.length ? r.support.map(s => `${s.timeframe} ${s.color} ${s.kind} confirmed ${iso(s.confirmedAt)}`).join('; ')
      : 'No matching trendline',
    r.arrowDetails?.style ?? r.style, r.levels.entry, r.levels.stopLoss, r.levels.takeProfit, r.levels.rewardRisk,
    r.outcome, r.returnR ?? '', iso(r.filledAt), iso(r.resolvedAt),
    r.arrowDetails?.source ?? 'Historical study', r.arrowDetails?.mainZone ?? r.zoneName,
    r.arrowDetails?.entryZone ?? '', r.arrowDetails?.fib ?? r.fibSources.join('; '),
    r.levels.riskFree, r.levels.riskPips, r.levels.status, iso(studyCloseTime(r.signal.time, r.signal.timeframe)),
    r.arrowDetails?.tradingTimeBlocked ?? '', r.arrowDetails?.unavailable.join('; ') ?? '', r.levels.riskFreeEnabled !== false,
    studyRecordDistanceBand(r), iso(r.distanceContext?.measuredAt), r.distanceContext?.timeframe ?? '',
    r.distanceContext?.atrPips ?? '', r.distanceContext?.nearPips ?? '', r.distanceContext?.mediumPips ?? '',
    r.support.map(s => `${s.timeframe} ${s.kind}: ${s.distance ? `${s.distance.pips.toFixed(2)} pips, ${s.distance.band}, line price ${s.distance.linePrice}, ATR ratio ${s.distance.atrRatio ?? 'unknown'}` : 'distance unknown'}`).join('; ')]);
  return [header, ...rows].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
