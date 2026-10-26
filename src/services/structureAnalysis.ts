import { analyzeMarketStructure, type StructureCandle } from './marketStructure';

export interface StructureAnalysisTask {
  key: string;
  candles: StructureCandle[];
  options: Omit<Parameters<typeof analyzeMarketStructure>[1], 'vipSupport'>;
  support?: Array<{ key: string; timeframe: string }>;
}

export interface PreparedStructureAnalysis {
  key: string;
  candles: StructureCandle[];
  optionsKey: string;
  dependencies: Array<{ key: string; timeframe: string; revision: number }>;
  revision: number;
  result: ReturnType<typeof analyzeMarketStructure>;
}

export function structureSnapshotsMatch(first: StructureCandle[], second: StructureCandle[]): boolean {
  return first.length === second.length && first.every((candle, index) => {
    const other = second[index];
    return candle.time === other.time && candle.open === other.open
      && candle.high === other.high && candle.low === other.low
      && candle.close === other.close && candle.complete === other.complete
      && candle.volume === other.volume;
  });
}

// Tasks are ordered: support timeframes precede the chart that consumes them.
// The cache holds only the latest snapshot for each of the fixed task keys.
export function prepareStructureAnalysis(
  tasks: StructureAnalysisTask[],
  cache = new Map<string, PreparedStructureAnalysis>(),
): PreparedStructureAnalysis[] {
  const updates: PreparedStructureAnalysis[] = [];
  for (const task of tasks) {
    const dependencies = (task.support ?? []).map(({ key, timeframe }) => {
      const support = cache.get(key);
      if (!support) throw new Error(`Missing support analysis: ${key}`);
      return { key, timeframe, revision: support.revision };
    });
    const optionsKey = JSON.stringify(task.options);
    const previous = cache.get(task.key);
    if (previous && previous.optionsKey === optionsKey
      && JSON.stringify(previous.dependencies) === JSON.stringify(dependencies)
      && structureSnapshotsMatch(previous.candles, task.candles)) continue;
    const result = analyzeMarketStructure(task.candles, {
      ...task.options,
      ...(task.support ? { vipSupport: task.support.map(({ key, timeframe }) => ({
        timeframe, zones: cache.get(key)!.result.zones,
      })) } : {}),
    });
    const prepared: PreparedStructureAnalysis = {
      key: task.key, candles: task.candles, optionsKey, dependencies,
      revision: (previous?.revision ?? 0) + 1, result,
    };
    cache.set(task.key, prepared);
    updates.push(prepared);
  }
  return updates;
}
