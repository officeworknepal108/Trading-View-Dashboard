import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMarketStructure, detectEngulfingPatternAt, type StructureCandle } from '../src/services/marketStructure';
import { matchingChartCandles, prepareStructureAnalysis, type PreparedStructureAnalysis, type StructureAnalysisTask } from '../src/services/structureAnalysis';

test('timeframe switching never interprets the preceding candle batch using the new timeframe', () => {
  // These are the actual one-minute T3 candles behind the incorrectly saved M15 entry.
  const oneMinute = [
    { time: 1794493200, open: 3903.825, high: 3907.655, low: 3903.825, close: 3906.825, complete: true },
    { time: 1794493260, open: 3906.83, high: 3909.285, low: 3904.78, close: 3906.24, complete: true },
    { time: 1794493320, open: 3906.19, high: 3907.155, low: 3904.025, close: 3904.09, complete: true },
  ];
  assert.equal(detectEngulfingPatternAt(oneMinute, 2)?.type, 'T3');
  const snapshot = { granularity: 'M1', symbol: 'XAUUSD', dataSource: 'OANDA', candles: oneMinute };
  const selected = { granularity: 'M15', symbol: 'XAUUSD', dataSource: 'OANDA' };
  const loading = matchingChartCandles(snapshot, selected);
  assert.deepEqual(loading, []);
  assert.equal(detectEngulfingPatternAt(loading, 2), undefined);
  assert.deepEqual(analyzeMarketStructure(loading, { sourceBarSeconds: 900 }).zones, []);
  const fifteenMinute = [{ time: 1794492900, open: 3891.075, high: 3909.285, low: 3890.805,
    close: 3903.565, complete: true }];
  const loaded = { ...selected, candles: fifteenMinute };
  assert.equal(matchingChartCandles(loaded, selected), fifteenMinute);
  assert.deepEqual(matchingChartCandles(snapshot, selected), [], 'a late old response is still rejected');
  assert.equal(matchingChartCandles(snapshot, { ...selected, granularity: 'M1' }), oneMinute,
    'switching back can use only the batch matching that selection');
  assert.deepEqual(matchingChartCandles(loaded, { ...selected, symbol: 'EURUSD' }), []);
  assert.deepEqual(matchingChartCandles(loaded, { ...selected, dataSource: 'MT5' }), []);
  assert.deepEqual(matchingChartCandles<StructureCandle>(null, selected), []);
});

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
