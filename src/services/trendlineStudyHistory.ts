import type { StructureCandle } from './marketStructure';
import type { TradeTimeframe } from './tradeLevels';
import { studyTimeframes, type StudyTimeframe } from './trendlineStudy';

export type StudyCandles = Partial<Record<StudyTimeframe, StructureCandle[]>>;
const WARMUP_BARS = 500;
const MAX_HISTORY_BARS = 100000;

export function mergeStudyCandles(...sources: StructureCandle[][]): StructureCandle[] {
  const byTime = new Map<number, StructureCandle>();
  for (const source of sources) for (const c of source) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function studyHistoryRequirements(symbol: string, zoneTimeframe: TradeTimeframe) {
  const required: Record<string, StudyTimeframe[]> = {
    M1: ['M1', 'M5', 'M15', 'D'], M5: ['M5', 'H1'],
    M15: ['M15', 'M30', 'H1', 'H4'], H1: ['H1', 'H4', 'D'],
  };
  const mandatory = new Set<StudyTimeframe>(required[zoneTimeframe] ?? [zoneTimeframe]);
  const optional = studyTimeframes(zoneTimeframe).filter(tf => !mandatory.has(tf));
  return { mandatory: [...mandatory], optional };
}

interface HistoryOptions {
  symbol: string;
  zoneTimeframe: TradeTimeframe;
  fromTime: number;
  cutoff: number;
  candles: StudyCandles;
  signal: AbortSignal;
  progress?: (message: string) => void;
  fetcher?: typeof fetch;
}

/** Fetch older study-only pages; never replace the chart feed or trading inputs. */
export async function loadStudyDateHistory(options: HistoryOptions): Promise<{ candles: StudyCandles; warnings: string[] }> {
  const { symbol, fromTime, cutoff, signal, progress = () => undefined, fetcher = fetch } = options;
  if (!Number.isFinite(fromTime) || fromTime >= cutoff) throw new Error('Choose a start date before the study end time.');
  const requirements = studyHistoryRequirements(symbol, options.zoneTimeframe);
  const candles: StudyCandles = Object.fromEntries(studyTimeframes(options.zoneTimeframe)
    .map(tf => [tf, options.candles[tf] ?? []]));
  const warnings: string[] = [];
  const load = async (tf: StudyTimeframe, mandatory: boolean) => {
    let history = mergeStudyCandles(candles[tf] ?? []).filter(c => c.time <= cutoff);
    const beforeStart = () => history.filter(c => c.complete !== false && c.time < fromTime).length;
    const coversDate = () => !!history.length && history[0].time <= fromTime;
    let loadLatest = !!history.length && history.at(-1)!.time < fromTime;
    let pages = 0;
    try {
      while (loadLatest || !coversDate() || beforeStart() < WARMUP_BARS) {
        signal.throwIfAborted();
        if (history.length >= MAX_HISTORY_BARS || pages >= 30) throw new Error('The study history limit was reached. Choose a later start date.');
        progress(`Loading ${tf} history for ${new Date(fromTime * 1000).toLocaleDateString()} (page ${pages + 1})…`);
        const query = new URLSearchParams({ symbol, granularity: tf, count: '5000' });
        if (history.length && !loadLatest) query.set('endTime', String(Math.floor(history[0].time - 1)));
        const response = await fetcher(`/api/tradingview/market-data?${query}`, { signal, cache: 'no-store' });
        const payload = await response.json();
        signal.throwIfAborted();
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? `History request failed (${response.status}).`);
        if (payload.symbol !== symbol || payload.granularity !== tf || !Array.isArray(payload.candles)) {
          throw new Error('The history feed returned a different symbol or timeframe.');
        }
        const page: StructureCandle[] = payload.candles;
        if (page.some(c => !c || ![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)
          || c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close))) {
          throw new Error('The history feed returned invalid candle prices.');
        }
        const previousFirst = history[0]?.time ?? Infinity;
        // Keep the already loaded live feed's completeness flags on overlaps.
        const merged = mergeStudyCandles(page.filter(c => c.time <= cutoff), history);
        if (!merged.length || (loadLatest ? merged.at(-1)!.time <= history.at(-1)!.time
          : merged[0].time >= previousFirst)) throw new Error('No additional candles are available from the feed.');
        history = merged;
        loadLatest = false;
        pages++;
      }
    } catch (error) {
      signal.throwIfAborted();
      const message = `${tf}: ${error instanceof Error ? error.message : 'History unavailable.'}`;
      if (mandatory && (!coversDate() || (history.at(-1)?.time ?? -Infinity) < fromTime)) {
        throw new Error(`Cannot study the full selected period. ${message}`);
      }
      warnings.push(`${message} ${coversDate() ? `Only ${beforeStart()} earlier candles are available for calculation context.` : 'Trendline evidence on this timeframe may be incomplete.'}`);
    }
    candles[tf] = history;
  };
  // Two sockets at a time avoids starving the dashboard's live feed.
  const queue = [...requirements.mandatory.map(tf => ({ tf, mandatory: true })),
    ...requirements.optional.map(tf => ({ tf, mandatory: false }))];
  for (let i = 0; i < queue.length; i += 2) {
    const batch = await Promise.allSettled(queue.slice(i, i + 2).map(({ tf, mandatory }) => load(tf, mandatory)));
    const failed = batch.find(r => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  signal.throwIfAborted();
  return { candles, warnings };
}
