import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMarketStructure, type StructureCandle } from '../src/services/marketStructure';
import { prepareStructureAnalysis, type PreparedStructureAnalysis, type StructureAnalysisTask } from '../src/services/structureAnalysis';

function history(): StructureCandle[] {
  return Array.from({ length: 120 }, (_, index) => {
    const open = 100 + Math.sin(index / 3) * 12;
    const close = 100 + Math.sin((index + 1) / 3) * 12;
    return { time: index * 900, open, close, high: Math.max(open, close) + 2,
      low: Math.min(open, close) - 2, complete: index !== 119 };
  });
}

test('background chart and support analysis matches the synchronous trading result', () => {
  const candles = history();
  const supportOptions = { sourceBarSeconds: 900, confirmationBarSeconds: 3600, zoneVisualBars: 30 };
  const chartOptions = { ...supportOptions, allowSupplyDemand: false };
  const tasks: StructureAnalysisTask[] = [
    { key: 'support', candles: candles.slice(0, 100), options: supportOptions },
    { key: 'chart', candles, options: chartOptions, support: [{ key: 'support', timeframe: '1h' }] },
  ];
  const updates = prepareStructureAnalysis(structuredClone(tasks));
  const support = analyzeMarketStructure(tasks[0].candles, supportOptions);
  assert.deepEqual(updates[0].result, support);
  assert.deepEqual(updates[1].result, analyzeMarketStructure(candles, {
    ...chartOptions, vipSupport: [{ timeframe: '1h', zones: support.zones }],
  }));
});

test('worker reuses unchanged feeds and invalidates support dependencies and historical corrections', () => {
  const tasks: StructureAnalysisTask[] = [
    { key: 'support', candles: history(), options: { sourceBarSeconds: 900, confirmationBarSeconds: 3600 } },
    { key: 'chart', candles: history(), options: { sourceBarSeconds: 900, confirmationBarSeconds: 3600 },
      support: [{ key: 'support', timeframe: '1h' }] },
  ];
  const cache = new Map<string, PreparedStructureAnalysis>();
  assert.equal(prepareStructureAnalysis(structuredClone(tasks), cache).length, 2);
  assert.deepEqual(prepareStructureAnalysis(structuredClone(tasks), cache), []);
  tasks[0].candles[20].high += 25;
  const correction = prepareStructureAnalysis(structuredClone(tasks), cache);
  assert.deepEqual(correction.map(({ key }) => key), ['support', 'chart']);
  assert.equal(cache.get('chart')!.revision, 2);
  tasks[1].candles[119].complete = true;
  assert.deepEqual(prepareStructureAnalysis(structuredClone(tasks), cache).map(({ key }) => key), ['chart']);
  tasks[1].options.confirmationBarSeconds = -1;
  assert.deepEqual(prepareStructureAnalysis(structuredClone(tasks), cache).map(({ key }) => key), ['chart']);
});
