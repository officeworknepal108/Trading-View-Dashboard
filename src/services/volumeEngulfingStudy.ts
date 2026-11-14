import { analyzeMarketStructure, detectEngulfingPatternAt, type StructureCandle,
  type EngulfingDirection } from './marketStructure';
import { assessEngulfingVolumeLogic, getMtfTradeRule, TRADE_PIP_SIZE,
  type TradeLevels, type TradeRule } from './tradeLevels';
import { collectStudySupport, evaluateStudyOutcome, studyCloseTime, studySupportPriceAt, STUDY_SECONDS,
  type StudySupport, type StudyTimeframe, type StudyOutcome } from './trendlineStudy';
import type { AutoTrendline } from './autoTrendlines';
import { normalizeOandaMarketSymbol, oandaMarketSymbolConfig } from './marketSymbols';
import { mergeStudyCandles, type StudyCandles } from './trendlineStudyHistory';

export const VOLUME_STUDY_TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D', 'W'] as const;
export const VOLUME_STUDY_MAX_LOOKBACK = 8000;
export type VolumeStudyTimeframe = typeof VOLUME_STUDY_TIMEFRAMES[number];
export type VolumeStudyType = 'T1' | 'T2' | 'T3';
export type VolumeStudyGroup = 'V2 < V1' | 'V3 < V2 only' | 'V3 < V2 and V1';
export const VOLUME_STUDY_GROUPS: VolumeStudyGroup[] = ['V2 < V1', 'V3 < V2 only', 'V3 < V2 and V1'];
export interface VolumeStudySignal {
  type: VolumeStudyType;
  direction: EngulfingDirection;
  timeframe: VolumeStudyTimeframe;
  time: number;
  candleCount: number;
}
export type VolumeStudyLevels = Omit<TradeLevels, 'signal'> & { signal: VolumeStudySignal };
export interface VolumeStudyEma {
  time: number;
  ema20: number;
  ema50: number;
}
export interface VolumeStudyRecord {
  id: string;
  signal: VolumeStudySignal;
  confirmedAt: number;
  bias: EngulfingDirection | 'none';
  h4Ema?: VolumeStudyEma;
  h1Trendline?: StudySupport;
  group: VolumeStudyGroup;
  v1?: number;
  v2?: number;
  v3?: number;
  levels: VolumeStudyLevels;
  outcome: StudyOutcome;
  filledAt?: number;
  resolvedAt?: number;
  returnR?: number;
}
export interface VolumeStudyInput {
  symbol: string;
  timeframe: VolumeStudyTimeframe;
  biasTimeframe: VolumeStudyTimeframe | 'none';
  cutoff: number;
  lookback: number;
  h4EmaFilter?: boolean;
  h1TrendlineFilter?: boolean;
  candles: StudyCandles;
}
export interface VolumeStudyResult {
  records: VolumeStudyRecord[];
  scanned: number;
  volumeRejected: number;
  biasRejected: number;
  emaRejected: number;
  trendlineRejected: number;
  from?: number;
  to: number;
  warnings: string[];
  settings: Omit<VolumeStudyInput, 'candles'>;
}

// Existing rules cover M1/M5/M15/M30. Higher study timeframes explicitly
// inherit M30's settings. M15 uses the approved study-only 30-pip buffer.
export function volumeStudyRule(tf: VolumeStudyTimeframe): TradeRule {
  const ruleTf = ['M1', 'M5', 'M15', 'M30'].includes(tf) ? tf as 'M1' | 'M5' | 'M15' | 'M30' : 'M30';
  const base = getMtfTradeRule(ruleTf, ruleTf)!;
  return { ...base, stopBufferPips: tf === 'M15' ? 30 : base.stopBufferPips, rewardRisk: 1 };
}

export function volumeStudyGroup(candles: StructureCandle[], signal: VolumeStudySignal) {
  const assessment = assessEngulfingVolumeLogic(candles, signal);
  if (!assessment.passes) return undefined;
  // A three-candle row needs all three volumes to distinguish the two groups.
  if (signal.type !== 'T1' && assessment.firstVolume === undefined) return undefined;
  const group: VolumeStudyGroup = signal.type === 'T1' ? 'V2 < V1'
    : assessment.bestQuality ? 'V3 < V2 and V1' : 'V3 < V2 only';
  return { group, v1: assessment.firstVolume, v2: assessment.secondVolume, v3: assessment.thirdVolume };
}

/** Same entry, pattern-wick SL and capped-order calculation as
 * calculateTradeLevels, with the selected timeframe's study buffer. Extended to
 * weekly study signals. TP is always 1R.
 * Use only the next candle's open; outcomes are evaluated separately. */
export function volumeStudyLevels(source: StructureCandle[], signal: VolumeStudySignal,
  entryCandle: StructureCandle): VolumeStudyLevels | undefined {
  if (entryCandle.time < studyCloseTime(signal.time, signal.timeframe)) return undefined;
  const end = source.findIndex(c => c.time === signal.time);
  if (end < signal.candleCount - 1) return undefined;
  const pattern = source.slice(end - signal.candleCount + 1, end + 1);
  const buy = signal.direction === 'bullish';
  const rule = volumeStudyRule(signal.timeframe);
  const liquidity = buy ? Math.min(...pattern.map(c => c.low)) : Math.max(...pattern.map(c => c.high));
  const stopLoss = liquidity + (buy ? -1 : 1) * rule.stopBufferPips * TRADE_PIP_SIZE;
  const maximumRisk = rule.maximumRiskPips * TRADE_PIP_SIZE;
  const openRisk = buy ? entryCandle.open - stopLoss : stopLoss - entryCandle.open;
  const immediate = openRisk > 0 && openRisk <= maximumRisk;
  const entry = immediate ? entryCandle.open : stopLoss + (buy ? 1 : -1) * maximumRisk;
  const risk = Math.abs(entry - stopLoss);
  const target = entry + (buy ? 1 : -1) * risk;
  // Match the production open-only calculation: a capped setup is already
  // missed when the next open is at or beyond its projected target.
  if (!immediate && (buy ? entryCandle.open >= target : entryCandle.open <= target)) return undefined;
  return { entry, stopLoss, takeProfit: target, riskFree: target, riskFreeEnabled: false,
    riskPips: Math.round(risk / TRADE_PIP_SIZE * 100) / 100, rewardRisk: 1, pendingAtCreation: !immediate,
    status: immediate ? 'active' : 'pending', calculatedAt: entryCandle.time,
    filledAt: immediate ? entryCandle.time : undefined, signal };
}

const confirmationSeconds: Partial<Record<StudyTimeframe, number>> = {
  M1: 300, M5: 900, M15: 3600, M30: 3600, H1: 14400, H4: 86400, D: 604800, W: 2419200,
};

/** SMA-seeded EMAs, using only completed H4 bars available by cutoff. */
export function volumeStudyH4EmaSeries(candles: StructureCandle[], cutoff: number): VolumeStudyEma[] {
  const closed = mergeStudyCandles(candles).filter(c => c.complete !== false
    && studyCloseTime(c.time, 'H4') <= cutoff);
  let sum20 = 0, sum50 = 0;
  let ema20: number | undefined, ema50: number | undefined;
  const snapshots: VolumeStudyEma[] = [];
  for (let i = 0; i < closed.length; i++) {
    const close = closed[i].close;
    if (i < 20) sum20 += close;
    if (i < 50) sum50 += close;
    if (i === 19) ema20 = sum20 / 20;
    else if (i > 19) ema20 = close * (2 / 21) + ema20! * (1 - 2 / 21);
    if (i === 49) ema50 = sum50 / 50;
    else if (i > 49) ema50 = close * (2 / 51) + ema50! * (1 - 2 / 51);
    if (ema20 !== undefined && ema50 !== undefined) snapshots.push({ time: closed[i].time, ema20, ema50 });
  }
  return snapshots;
}

export function volumeStudyH4EmaAt(series: VolumeStudyEma[], at: number): VolumeStudyEma | undefined {
  let low = 0, high = series.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (studyCloseTime(series[mid].time, 'H4') <= at) low = mid + 1;
    else high = mid;
  }
  return series[low - 1];
}

export function volumeStudyEmaAllows(snapshot: VolumeStudyEma | undefined, direction: EngulfingDirection): boolean {
  return !!snapshot && (direction === 'bullish' ? snapshot.ema20 > snapshot.ema50 : snapshot.ema20 < snapshot.ema50);
}

/** Wilder ATR for all study timeframes, including weekly study entries. */
export function volumeStudyAtrAt(candles: StructureCandle[], timeframe: VolumeStudyTimeframe, at: number): number | undefined {
  const closed = candles.filter(c => c.complete !== false && studyCloseTime(c.time, timeframe) <= at);
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

export function selectVolumeStudyH1FarSupport(support: StudySupport[], h1Candles: StructureCandle[],
  direction: EngulfingDirection, at: number, entry: number, atr: number | undefined,
  pipSize: number): StudySupport | undefined {
  if (atr === undefined || !Number.isFinite(atr) || atr <= 0 || !Number.isFinite(pipSize)
    || pipSize <= 0 || !Number.isFinite(entry)) return undefined;
  const matches: StudySupport[] = [];
  for (const line of support) {
    if (line.timeframe !== 'H1' || line.kind !== 'continuation' || line.confirmedAt > at
      || line.color !== (direction === 'bullish' ? 'green' : 'red')) continue;
    const linePrice = studySupportPriceAt(line, h1Candles, at);
    if (linePrice === undefined) continue;
    const distance = Math.abs(entry - linePrice);
    const ratio = distance / atr;
    if (ratio <= .5 + 1e-12) continue;
    matches.push({ ...line, distance: { linePrice, pips: distance / pipSize, atrRatio: ratio, band: 'Far' } });
  }
  // Any matching Far line qualifies; retain the nearest qualifying line as evidence.
  return matches.sort((a, b) => a.distance!.pips - b.distance!.pips)[0];
}
export function volumeStudyBias(candles: StructureCandle[], tf: VolumeStudyTimeframe,
  at: number): 'bullish' | 'bearish' | 'neutral' {
  const closed = candles.filter(c => c.complete !== false && studyCloseTime(c.time, tf) <= at);
  return analyzeMarketStructure(closed, { sourceBarSeconds: STUDY_SECONDS[tf],
    confirmationBarSeconds: confirmationSeconds[tf], allowSupplyDemand: ['H1', 'H4', 'D', 'W'].includes(tf),
    zoneVisualBars: 30 }).trend;
}

export function runVolumeStudy(input: VolumeStudyInput,
  progress: (done: number, total: number) => void = () => undefined): VolumeStudyResult {
  if (!VOLUME_STUDY_TIMEFRAMES.includes(input.timeframe)
    || input.biasTimeframe !== 'none' && !VOLUME_STUDY_TIMEFRAMES.includes(input.biasTimeframe)
    || !Number.isFinite(input.cutoff) || !Number.isInteger(input.lookback)
    || input.h4EmaFilter !== undefined && typeof input.h4EmaFilter !== 'boolean'
    || input.h1TrendlineFilter !== undefined && typeof input.h1TrendlineFilter !== 'boolean'
    || input.lookback < 1 || input.lookback > VOLUME_STUDY_MAX_LOOKBACK) throw new Error('Invalid study settings.');
  const available = mergeStudyCandles(input.candles[input.timeframe] ?? [])
    .filter(c => c.time <= input.cutoff)
    .map(c => studyCloseTime(c.time, input.timeframe) > input.cutoff ? { ...c, complete: false } : c);
  const source = available
    // Retain incomplete interior bars so detection cannot bridge across them.
    .filter(c => studyCloseTime(c.time, input.timeframe) <= input.cutoff);
  const biasCandles = input.biasTimeframe === 'none' ? []
    : mergeStudyCandles(input.candles[input.biasTimeframe] ?? []).filter(c => c.complete !== false
      && studyCloseTime(c.time, input.biasTimeframe as VolumeStudyTimeframe) <= input.cutoff);
  if (source.length < 2) throw new Error('Not enough closed study candles. Load history and try again.');
  if (input.biasTimeframe !== 'none' && biasCandles.length < 12) {
    throw new Error('At least 12 closed bias candles are required. Choose a different timeframe or load more history.');
  }
  const emaSeries = input.h4EmaFilter ? volumeStudyH4EmaSeries(input.candles.H4 ?? [], input.cutoff) : [];
  if (input.h4EmaFilter && !emaSeries.length) throw new Error('The H4 EMA filter needs at least 50 closed H4 candles. Load more history or turn the EMA filter off.');
  const h1Candles = input.h1TrendlineFilter ? mergeStudyCandles(input.candles.H1 ?? []) : [];
  if (input.h1TrendlineFilter && h1Candles.filter(c => c.complete !== false
    && studyCloseTime(c.time, 'H1') <= input.cutoff).length < 9) {
    throw new Error('The H1 continuation/Far filter needs at least 9 closed H1 candles. Load more history or turn it off.');
  }
  const symbol = normalizeOandaMarketSymbol(input.symbol);
  const pipSize = symbol ? oandaMarketSymbolConfig(symbol).pipSize : TRADE_PIP_SIZE;
  const trendlineCache = new Map<string, AutoTrendline[]>();
  const start = Math.max(1, source.length - input.lookback);
  const records: VolumeStudyRecord[] = [];
  const warnings: string[] = [];
  if (source.length < input.lookback + 2) warnings.push(`Requested ${input.lookback} study candles; only ${source.length} closed candles are available, including pattern context. Results use the available history.`);
  if (['H1', 'H4', 'D', 'W'].includes(input.timeframe)) {
    warnings.push('This timeframe uses the study M30 buffer (20 pips) and the existing M30 maximum risk.');
  }
  const biasCache = new Map<number, ReturnType<typeof volumeStudyBias>>();
  let volumeRejected = 0;
  let biasRejected = 0;
  let emaRejected = 0;
  let emaUnavailable = 0;
  let trendlineRejected = 0;
  let atrUnavailable = 0;
  let scanned = 0;
  for (let i = start; i < source.length; i++) {
    if (i % 25 === 0) progress(i - start, source.length - start);
    const pattern = detectEngulfingPatternAt(source, i);
    if (!pattern || pattern.type === 'T4') continue;
    scanned++;
    const signal: VolumeStudySignal = { type: pattern.type, direction: pattern.direction,
      timeframe: input.timeframe, time: source[i].time, candleCount: pattern.candleCount };
    const volume = volumeStudyGroup(source, signal);
    if (!volume) { volumeRejected++; continue; }
    const confirmedAt = studyCloseTime(signal.time, input.timeframe);
    let bias: VolumeStudyRecord['bias'] = 'none';
    if (input.biasTimeframe !== 'none') {
      // Cache by the newest CLOSED bias candle. Never inspect a forming bar.
      let end = biasCandles.length - 1;
      while (end >= 0 && studyCloseTime(biasCandles[end].time, input.biasTimeframe) > confirmedAt) end--;
      let trend = biasCache.get(end);
      if (!trend) {
        trend = volumeStudyBias(biasCandles.slice(0, end + 1), input.biasTimeframe, confirmedAt);
        biasCache.set(end, trend);
      }
      if (trend !== signal.direction) { biasRejected++; continue; }
      bias = trend;
    }
    const execution = available.filter(c => c.time >= confirmedAt);
    if (!execution.length) continue;
    const levels = volumeStudyLevels(source, signal, execution[0]);
    if (!levels) continue;
    const h4Ema = input.h4EmaFilter ? volumeStudyH4EmaAt(emaSeries, confirmedAt) : undefined;
    if (input.h4EmaFilter && !volumeStudyEmaAllows(h4Ema, signal.direction)) {
      emaRejected++;
      if (!h4Ema) emaUnavailable++;
      continue;
    }
    let h1Trendline: StudySupport | undefined;
    if (input.h1TrendlineFilter) {
      const atr = volumeStudyAtrAt(available, input.timeframe, confirmedAt);
      const support = collectStudySupport({ H1: h1Candles }, 'M15', signal.direction === 'bullish',
        confirmedAt, pipSize, trendlineCache);
      h1Trendline = selectVolumeStudyH1FarSupport(support, h1Candles, signal.direction,
        confirmedAt, levels.entry, atr, pipSize);
      if (!h1Trendline) {
        trendlineRejected++;
        if (atr === undefined) atrUnavailable++;
        continue;
      }
    }
    records.push({ id: `VE:${input.symbol}:${input.timeframe}:${signal.time}`, signal, confirmedAt,
      bias, h4Ema, h1Trendline, ...volume, levels, ...evaluateStudyOutcome(levels, execution, 'fixed') });
  }
  progress(source.length - start, source.length - start);
  const { candles: _, ...settings } = input;
  if (emaUnavailable) warnings.push(`${emaUnavailable} setups excluded because 50 closed H4 candles were not yet available at their confirmation.`);
  if (atrUnavailable) warnings.push(`${atrUnavailable} setups excluded because entry-timeframe ATR14 was unavailable at confirmation.`);
  return { records, scanned, volumeRejected, biasRejected, emaRejected, trendlineRejected, from: source[start]?.time,
    to: input.cutoff, warnings, settings: { ...settings, h4EmaFilter: input.h4EmaFilter === true,
      h1TrendlineFilter: input.h1TrendlineFilter === true } };
}

export function volumeStudyStats(records: VolumeStudyRecord[]) {
  const tp = records.filter(r => r.outcome === 'tp').length;
  const sl = records.filter(r => r.outcome === 'sl').length;
  return { total: records.length, tp, sl, winRate: tp + sl ? tp / (tp + sl) * 100 : undefined,
    netR: tp - sl, unresolved: records.filter(r => r.outcome !== 'tp' && r.outcome !== 'sl').length };
}

export function volumeStudyMonthlyStats(records: VolumeStudyRecord[]) {
  const months = new Map<string, VolumeStudyRecord[]>();
  for (const record of records) {
    const month = new Date(record.signal.time * 1000).toISOString().slice(0, 7);
    const group = months.get(month) ?? [];
    group.push(record); months.set(month, group);
  }
  return [...months].sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => ({ month, ...volumeStudyStats(rows) }));
}

export function volumeStudyCsv(result: VolumeStudyResult, records = result.records): string {
  const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows: unknown[][] = [['Symbol', 'Study TF', 'Bias TF', 'Bias at confirmation', 'Type', 'Direction',
    'Signal UTC', 'Volume group', 'V1', 'V2', 'V3', 'Entry', 'SL', 'TP', 'RR', 'Outcome',
    'Filled UTC', 'Resolved UTC', 'Return R', 'H4 EMA filter', 'H4 EMA bar UTC', 'H4 EMA20', 'H4 EMA50',
    'H1 continuation Far filter', 'H1 line confirmed UTC', 'H1 line price', 'H1 distance pips', 'H1 distance ATR ratio', 'H1 distance band']];
  const utc = (t?: number) => t === undefined ? '' : new Date(t * 1000).toISOString();
  for (const r of records) rows.push([result.settings.symbol, r.signal.timeframe, result.settings.biasTimeframe,
    r.bias, r.signal.type, r.signal.direction, utc(r.signal.time), r.group, r.v1, r.v2, r.v3,
    r.levels.entry, r.levels.stopLoss, r.levels.takeProfit, 1, r.outcome, utc(r.filledAt), utc(r.resolvedAt), r.returnR,
    result.settings.h4EmaFilter ? 'on' : 'off', utc(r.h4Ema?.time), r.h4Ema?.ema20, r.h4Ema?.ema50,
    result.settings.h1TrendlineFilter ? 'on' : 'off', utc(r.h1Trendline?.confirmedAt), r.h1Trendline?.distance?.linePrice,
    r.h1Trendline?.distance?.pips, r.h1Trendline?.distance?.atrRatio, r.h1Trendline?.distance?.band]);
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}

/** Fetch only the selected study and bias series, including pre-study context. */
export async function loadVolumeStudyHistory(input: VolumeStudyInput, signal: AbortSignal,
  progress: (message: string) => void, fetcher: typeof fetch = fetch): Promise<StudyCandles> {
  const needed = [...new Set<VolumeStudyTimeframe>([input.timeframe,
    ...(input.biasTimeframe === 'none' ? [] : [input.biasTimeframe]), ...(input.h4EmaFilter ? ['H4' as const] : []),
    ...(input.h1TrendlineFilter ? ['H1' as const] : [])])];
  const entries = await Promise.all(needed.map(async tf => {
    progress(`Loading ${tf} candles…`);
    const loadPage = async (endTime: number, count: number): Promise<StructureCandle[]> => {
      const query = new URLSearchParams({ symbol: input.symbol, granularity: tf, count: String(count),
        endTime: String(Math.floor(endTime)) });
      const response = await fetcher(`/api/tradingview/market-data?${query}`, { signal, cache: 'no-store' });
      const payload = await response.json();
      signal.throwIfAborted();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Could not load ${tf} history.`);
      if (payload.symbol !== input.symbol || payload.granularity !== tf || !Array.isArray(payload.candles)
        || payload.candles.some((c: StructureCandle) => !c
          || ![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)
          || c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close))) {
        throw new Error(`Invalid ${tf} history returned by the feed.`);
      }
      return payload.candles;
    };
    let history = mergeStudyCandles(await loadPage(input.cutoff - 1, 5000), input.candles[tf] ?? []);
    // The feed permits 5,000 bars per request. Page backward for larger
    // windows, reserving ten earlier bars as pattern calculation context.
    if (tf === input.timeframe) {
      const target = input.lookback + 10;
      const closedCount = () => history.filter(c => c.complete !== false
        && studyCloseTime(c.time, tf) <= input.cutoff).length;
      for (let page = 0; page < 4 && history.length && closedCount() < target; page++) {
        signal.throwIfAborted();
        progress(`Loading older ${tf} candles (${closedCount()} / ${target})…`);
        const previousFirst = history[0].time;
        try {
          const older = await loadPage(previousFirst - 1, Math.min(5000, target - closedCount()));
          history = mergeStudyCandles(older, history);
        } catch {
          signal.throwIfAborted();
          // Keep the usable history; the runner reports any shortfall.
          break;
        }
        if (history[0].time >= previousFirst) break;
      }
    }
    return [tf, history] as const;
  }));
  return Object.fromEntries(entries);
}
