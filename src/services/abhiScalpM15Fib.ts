import { analyzeMarketStructure, type StructureCandle, type StructureZone } from './marketStructure';
import { buildAlternatingSwingFibs, buildOneHourSwingFibs } from './swingFib';
import { applySwingFibConfluence, applyPostChochH1SwingFibConfluence } from './swingFibConfluence';
import { buildDayFibs, selectDayFibForTime } from './dayFib';
import { applyDayFibConfluence } from './dayFibConfluence';
import type { StudyCandles } from './trendlineStudyHistory';
import type { Mt5SignalInput } from './mt5Automation';

type Frame = 'M15' | 'H1' | 'H4';
const seconds: Record<Frame, number> = { M15: 900, H1: 3600, H4: 14400 };
const confirmationSeconds: Record<Frame, number> = { M15: 3600, H1: 14400, H4: 86400 };
type Analysis = { candles: StructureCandle[]; structure: ReturnType<typeof analyzeMarketStructure> };
const higherCache = new WeakMap<StructureCandle[], Map<string, Analysis>>();
const zoneCache = new WeakMap<StructureCandle[], {
  h1: StructureCandle[]; h4: StructureCandle[]; snapshots: Map<string, StructureZone[]>;
}>();

function closedHistory(tf: Frame, source: StructureCandle[], asOf: number): StructureCandle[] {
  return source.filter(c => c.complete !== false && c.time + seconds[tf] <= asOf)
    .slice(-(tf === 'M15' ? 5000 : 1500));
}

function rawAnalysis(tf: Frame, source: StructureCandle[], candles: StructureCandle[]): Analysis {
  const last = candles.at(-1);
  const key = JSON.stringify([tf, candles[0]?.time, candles.length, last]);
  const cache = higherCache.get(source) ?? new Map<string, Analysis>();
  const existing = tf !== 'M15' ? cache.get(key) : undefined;
  if (existing) return existing;
  const result = { candles, structure: analyzeMarketStructure(candles, {
    allowSupplyDemand: tf !== 'M15', sourceBarSeconds: seconds[tf],
    confirmationBarSeconds: confirmationSeconds[tf], zoneVisualBars: 30,
  }) };
  if (tf !== 'M15') {
    cache.set(key, result);
    if (cache.size > 16) cache.delete(cache.keys().next().value!);
    higherCache.set(source, cache);
  }
  return result;
}

/** Rebuild the same M15 Fib context as the study using only confirmation-time closed bars. */
export function abhiScalpM15FibZones(candles: StudyCandles, confirmedAt: number): StructureZone[] | undefined {
  const sourceM15 = candles.M15, sourceH1 = candles.H1, sourceH4 = candles.H4;
  if (!sourceM15 || !sourceH1 || !sourceH4 || !Number.isFinite(confirmedAt)) return undefined;
  const m15 = closedHistory('M15', sourceM15, confirmedAt);
  const h1 = closedHistory('H1', sourceH1, confirmedAt);
  const h4 = closedHistory('H4', sourceH4, confirmedAt);
  if ([m15, h1, h4].some(history => history.length < 12)) return undefined;
  if (m15.at(-1)?.time !== confirmedAt - 900) return undefined;
  let cache = zoneCache.get(sourceM15);
  if (!cache || cache.h1 !== sourceH1 || cache.h4 !== sourceH4) {
    cache = { h1: sourceH1, h4: sourceH4, snapshots: new Map() };
    zoneCache.set(sourceM15, cache);
  }
  const key = JSON.stringify([confirmedAt, m15.length, m15[0].time, m15.at(-1), h1.at(-1), h4.at(-1)]);
  const existing = cache.snapshots.get(key);
  if (existing) return existing;
  const rawM15 = rawAnalysis('M15', sourceM15, m15).structure;
  const rawH1 = rawAnalysis('H1', sourceH1, h1).structure;
  const rawH4 = rawAnalysis('H4', sourceH4, h4).structure;
  const seed = rawH4.lines.filter(l => l.type === 'swing' && l.fromTime !== l.toTime && l.fromPrice !== l.toPrice)
    .sort((a, b) => a.toTime - b.toTime)[0];
  const swing = seed ? buildAlternatingSwingFibs(h4, { sourceTime: seed.fromTime, sourcePrice: seed.fromPrice,
    zeroTime: seed.toTime, zeroPrice: seed.toPrice }) : [];
  const supported = analyzeMarketStructure(m15, {
    allowSupplyDemand: false, sourceBarSeconds: 900, confirmationBarSeconds: 3600, zoneVisualBars: 30,
    vipSupport: [{ timeframe: 'H1', zones: rawH1.zones }, { timeframe: 'H4', zones: rawH4.zones }],
  });
  let zones = applySwingFibConfluence(m15, supported.zones, swing).zones;
  zones = applyDayFibConfluence(m15, zones, selectDayFibForTime(buildDayFibs(m15), confirmedAt), 10, confirmedAt).zones;
  zones = applyPostChochH1SwingFibConfluence(m15, zones, rawM15.lines, buildOneHourSwingFibs(h1, rawH1.markers));
  cache.snapshots.set(key, zones);
  if (cache.snapshots.size > 64) cache.snapshots.delete(cache.snapshots.keys().next().value!);
  return zones;
}

export interface AbhiScalpFibPathEntry {
  direction: 'BUY' | 'SELL'; signalAt: number; calculatedAt: number;
  entry: number; takeProfit: number; leg: 10 | 25;
}

export interface AbhiScalpFibPathBlock {
  zone: StructureZone;
  entryLeg: 10 | 25;
  distance: number;
}

/** A valid opposing M15 Fib zone before either TP vetoes the entire two-entry setup. */
export function abhiScalpM15FibPathBlock(entries: readonly AbhiScalpFibPathEntry[], zones: readonly StructureZone[]): AbhiScalpFibPathBlock | undefined {
  for (const entry of entries) {
    const buy = entry.direction === 'BUY', reward = Math.abs(entry.takeProfit - entry.entry);
    for (const zone of zones) {
      const aligned = (zone.fibStatus === 'a-plus' && zone.fibDeepInvalidatedAt === undefined)
        || zone.swingFibStatus === 'a-plus' || zone.dayFibStatus === 'a-plus' || zone.h1SwingFibStatus === 'aligned';
      if (!aligned || !zone.active || zone.status !== 'valid' || zone.isBuy === buy
        || zone.startTime > entry.signalAt || (zone.activeFromTime ?? zone.startTime) > entry.calculatedAt
        || (zone.confirmationTime ?? zone.startTime) > entry.calculatedAt
        || zone.invalidatedAt !== undefined && zone.invalidatedAt <= entry.calculatedAt) continue;
      const forward = buy ? zone.top >= entry.entry : zone.bottom <= entry.entry;
      const distance = buy ? Math.max(0, zone.bottom - entry.entry) : Math.max(0, entry.entry - zone.top);
      if (forward && distance < reward) return { zone, entryLeg: entry.leg, distance };
    }
  }
  return undefined;
}

export type AbhiScalpM15FibDecision = { status: 'allowed' | 'unavailable' } | { status: 'blocked'; block: AbhiScalpFibPathBlock };

/** Reconstruct both planned legs, including when a broker order uses the second-only sizing fallback. */
export function abhiScalpM15FibDecision(
  signal: Pick<Mt5SignalInput, 'tradeStyle' | 'scalpEntry' | 'signalAt' | 'direction' | 'stopLoss'>,
  candles: StudyCandles,
): AbhiScalpM15FibDecision {
  if (signal.tradeStyle !== 'SCALP_1_1' || signal.scalpEntry?.version !== 4) return { status: 'allowed' };
  const confirmedAt = signal.signalAt + 900, metadata = signal.scalpEntry;
  if (![metadata.confirmationClose, metadata.confirmationBody, signal.stopLoss].every(Number.isFinite)) return { status: 'unavailable' };
  const zones = abhiScalpM15FibZones(candles, confirmedAt);
  if (!zones) return { status: 'unavailable' };
  const sign = signal.direction === 'BUY' ? 1 : -1;
  const entries: AbhiScalpFibPathEntry[] = ([10, 25] as const).map(leg => {
    const entry = metadata.confirmationClose! - sign * metadata.confirmationBody * leg / 100;
    const risk = sign * (entry - signal.stopLoss);
    return { direction: signal.direction, signalAt: signal.signalAt, calculatedAt: confirmedAt,
      leg, entry, takeProfit: entry + sign * risk * 1.25 };
  });
  const block = abhiScalpM15FibPathBlock(entries, zones);
  return block ? { status: 'blocked', block } : { status: 'allowed' };
}
