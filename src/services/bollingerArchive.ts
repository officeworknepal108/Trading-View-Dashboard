import type { StructureCandle } from './marketStructure';
import type { StudyCandles } from './trendlineStudyHistory';

export interface BollingerArchive {
  version: 1; id: string; symbol: 'XAUUSD'; label: string; savedOn: string;
  timestampNote: string; h4Method: string;
  sourceHashes: { m5: string; m15: string };
  candles: { M5: StructureCandle[]; H4: StructureCandle[] };
}
export interface ArchiveCoverage {
  id: string; label: string; savedOn: string; first: number; through: number;
  availableFrom: number; m5Candles: number; h4Candles: number;
}

function validBars(value: unknown, seconds: number): value is StructureCandle[] {
  if (!Array.isArray(value) || !value.length || value.length > 100_000) return false;
  return value.every((b, i) => b && [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite)
    && b.time > 0 && Math.min(b.open, b.high, b.low, b.close) > 0
    && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close)
    && (i === 0 || b.time > value[i - 1].time && (b.time - value[i - 1].time) % seconds === 0));
}

export function parseBollingerArchive(raw: unknown): BollingerArchive {
  const a = raw as BollingerArchive;
  if (!a || a.version !== 1 || a.symbol !== 'XAUUSD' || typeof a.id !== 'string'
    || typeof a.label !== 'string' || typeof a.savedOn !== 'string'
    || !validBars(a.candles?.M5, 300) || !validBars(a.candles?.H4, 14400)
    || a.candles.M5.length < 501 || a.candles.H4.length < 7) throw new Error('The saved historical dataset is invalid or incomplete.');
  return a;
}

export function archiveCoverage(a: BollingerArchive): ArchiveCoverage {
  const last = a.candles.M5.at(-1)!;
  return { id: a.id, label: a.label, savedOn: a.savedOn, first: a.candles.M5[0].time,
    through: last.time + (last.complete === false ? 0 : 300),
    availableFrom: Math.ceil(a.candles.M5[500].time / 86400) * 86400,
    m5Candles: a.candles.M5.length, h4Candles: a.candles.H4.length };
}

/** Retain the full earlier prefix so indicators reproduce the frozen native replay. */
export function selectBollingerArchive(a: BollingerArchive, from: number, cutoff: number): {
  candles: StudyCandles; studiedCandles: number; warmupCandles: number; coverage: ArchiveCoverage;
} {
  const coverage = archiveCoverage(a);
  if (!Number.isFinite(from) || !Number.isFinite(cutoff) || from >= cutoff) throw new Error('Choose a valid historical date range.');
  if (from < coverage.availableFrom || cutoff > coverage.through) throw new Error(
    `Choose dates within the saved history: ${new Date(coverage.availableFrom * 1000).toISOString().slice(0, 10)} through ${new Date((coverage.through - 1) * 1000).toISOString().slice(0, 10)}.`);
  const m5 = a.candles.M5.filter(b => b.time < cutoff).map(b => b.time + 300 <= cutoff ? b
    : { ...b, high: b.open, low: b.open, close: b.open, volume: 0, complete: false });
  const h4 = a.candles.H4.filter(b => b.complete !== false && b.time + 14400 <= cutoff);
  const studiedCandles = m5.filter(b => b.time >= from && b.complete !== false && b.time + 300 <= cutoff).length;
  if (!studiedCandles || !h4.length) throw new Error('No complete candles are available in this historical date range.');
  return { candles: { M5: m5, H4: h4 }, studiedCandles,
    warmupCandles: m5.filter(b => b.time < from && b.complete !== false).length, coverage };
}

/** A sanitized market-price asset: no login, account balance, order or credential data. */
export async function loadBollingerArchive(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BollingerArchive> {
  const response = await fetcher(new URL('../studyAssets/bollingerBrokerHistory.json', import.meta.url), { signal });
  if (!response.ok) throw new Error('Saved historical prices could not load. Refresh the dashboard and try again.');
  const raw: unknown = await response.json(); signal.throwIfAborted();
  return parseBollingerArchive(raw);
}
