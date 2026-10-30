import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TRADE_RECORD_FILTERS,
  accuracyResultMatchesCandles,
  buildCanonicalTradeRecords,
  filterTradeRecords,
  filterAccuracyTradeRecords,
  savedDirectZoneMatchesStructure,
  selectAccuracyChartEntries,
  selectGoldIntradayAfterScalp,
  selectTradeChartRecords,
  selectTwoMonthAccuracyRecords,
  selectTwoMonthJournalRecords,
  twoMonthAccuracyWindow,
  tradeRecordDateKey,
  tradeRecordDatePeriodKey,
  tradeRecordPeriodKey,
  type FilterableTradeRecord,
  type CanonicalTradeRecord,
  type TradeRecordVerification,
  type TradeRecordFilters,
} from '../src/services/tradeRecordFilters';
import { mergeTradeRecordAnnotations } from '../src/services/tradeRecordDeduplication';
import { calculateJournalPerformance, type JournalTradeRecord } from '../src/components/TradeJournal';
import { isTradeStyleEnabled } from '../src/services/mt5Automation';

function synchronizedFixture() {
  const scalp: JournalTradeRecord = {
    id: 'MTF:M15-M1-external-choch-0:60:4094', symbol: 'XAUUSD',
    source: 'MTF', tradeStyle: 'SCALPING', zoneName: 'RBS', zoneTimeframe: 'M15',
    direction: 'bullish', signalTimeframe: 'M1', signalAt: 60, openedAt: 120,
    engulfingType: 'T1', engulfingCandleCount: 2, entry: 4094, stopLoss: 4085,
    takeProfit: 4121, rewardRisk: 3, riskPips: 90, result: 'tp', completedAt: 180,
  };
  const candles = [
    { time: 0, open: 4092, high: 4093, low: 4089, close: 4090, complete: true },
    { time: 60, open: 4090, high: 4095, low: 4089, close: 4094, complete: true },
    { time: 120, open: 4094, high: 4096, low: 4093, close: 4095, complete: true },
    { time: 180, open: 4095, high: 4122, low: 4094, close: 4121, complete: true },
  ];
  const intraday: JournalTradeRecord = {
    ...scalp, id: 'DIRECT:db-zone:900:4094', source: 'ENGULFING', tradeStyle: 'INTRADAY',
    zoneName: 'DB', signalTimeframe: 'M15', signalAt: 900, openedAt: 1800,
    completedAt: 2700, takeProfit: 4112, rewardRisk: 2,
  };
  const options: TradeRecordVerification = {
    marketSymbol: 'XAUUSD', pipSize: 0.1, requireLtfFib: false,
    qualifyMtf: () => ({}),
    timeframeData: {
      M1: { candles, structure: { zones: [] } },
      M15: { candles: candles.map((candle) => ({ ...candle, time: candle.time * 15 })),
        structure: { zones: [{ id: 'db-zone', name: 'DB', category: 'mg', isBuy: true,
          startTime: -900, endTime: 27000, bottom: 4089, top: 4095, active: true, status: 'valid' }] } },
    },
  };
  return { scalp, intraday, options };
}

test('past scalping and intraday arrows, accuracy and journal read identical validated execution records', () => {
  const { scalp, intraday, options } = synchronizedFixture();
  const canonical = buildCanonicalTradeRecords([], [scalp, intraday], options);
  assert.equal(canonical.length, 2, 'Fib-optional scalps must not disappear from history');
  const journal = mergeTradeRecordAnnotations(canonical, [
    { ...scalp, takeProfit: 4999, result: 'sl' as const, reason: 'Saved review' },
    { ...scalp, id: 'rejected-phantom' },
  ]);
  assert.deepEqual(journal.map((record) => [record.id, record.entry, record.stopLoss, record.takeProfit, record.result]),
    canonical.map((record) => [record.id, record.entry, record.stopLoss, record.takeProfit, record.result]));
  assert.equal(calculateJournalPerformance(journal).completed, canonical.length);
  assert.equal(calculateJournalPerformance(journal).winRate, 100);
  for (const timeframe of ['M1', 'M15'] as const) {
    const arrows = selectTradeChartRecords(canonical, timeframe, options.timeframeData[timeframe]!.candles);
    const accuracyRows = canonical.filter((record) => record.signalTimeframe === timeframe);
    assert.deepEqual(arrows, accuracyRows);
  }
  const strictFib = buildCanonicalTradeRecords([], [scalp, intraday], { ...options, requireLtfFib: true });
  assert.deepEqual(strictFib.map((record) => record.id), [intraday.id]);
});

test('a later TP after SL, a false engulfing, an unfilled record and a later CHOCH are excluded everywhere', () => {
  const { scalp, options } = synchronizedFixture();
  const source = options.timeframeData.M1!;
  const stoppedFirst = { ...options, timeframeData: { ...options.timeframeData,
    M1: { ...source, candles: source.candles.map((candle) => candle.time === 120
      ? { ...candle, low: 4080 } : candle) } } };
  assert.deepEqual(buildCanonicalTradeRecords([scalp], [], stoppedFirst), []);
  const falsePattern = { ...options, timeframeData: { ...options.timeframeData,
    M1: { ...source, candles: source.candles.map((candle) => candle.time === 60
      ? { ...candle, close: 4091 } : candle) } } };
  assert.deepEqual(buildCanonicalTradeRecords([scalp], [], falsePattern), []);
  assert.deepEqual(buildCanonicalTradeRecords([], [{ ...scalp, result: 'open', openedAt: undefined }], options), []);
  assert.deepEqual(buildCanonicalTradeRecords([scalp], [], { ...options, qualifyMtf: () => undefined }), []);
  const corrected = buildCanonicalTradeRecords([{ ...scalp, takeProfit: 4999, result: 'sl' }], [scalp], options);
  assert.deepEqual(corrected, [{ ...scalp, fibSource: undefined, fibBand: undefined }]);
});

test('MT5 fill prices and results override a slipped chart duplicate in every completed-trade view', () => {
  const { scalp, options } = synchronizedFixture();
  const broker = { ...scalp, id: 'MT5:123', mt5Managed: true, brokerTicket: 123,
    entry: 4094.1, stopLoss: 4085.1, takeProfit: 4121.1, result: 'sl' as const };
  const canonical = buildCanonicalTradeRecords([broker], [scalp], options);
  assert.deepEqual(canonical, [broker], 'a different feed cannot overwrite an actual broker outcome');
  assert.deepEqual(selectTradeChartRecords(canonical, 'M1', options.timeframeData.M1!.candles), [broker]);
  assert.deepEqual(mergeTradeRecordAnnotations(canonical, [scalp]), [broker]);
  const running = buildCanonicalTradeRecords([{ ...broker, result: 'open' }], [scalp], options);
  assert.equal(running.length, 1);
  assert.equal(running[0].result, 'open');
  assert.deepEqual(selectTradeChartRecords(running, 'M1', options.timeframeData.M1!.candles), []);
  assert.equal(calculateJournalPerformance(running).completed, 0);
});

test('saved past trades survive a chart-window change and regain matching arrows when their candles are loaded', () => {
  const { scalp, options } = synchronizedFixture();
  const laterWindow = { ...options, timeframeData: { ...options.timeframeData,
    M1: { ...options.timeframeData.M1!, candles: options.timeframeData.M1!.candles
      .map((candle) => ({ ...candle, time: candle.time + 10000 })) } } };
  const canonical = buildCanonicalTradeRecords([scalp], [], laterWindow);
  assert.equal(canonical.length, 1);
  assert.deepEqual(selectTradeChartRecords(canonical, 'M1', laterWindow.timeframeData.M1!.candles), []);
  assert.equal(selectTradeChartRecords(canonical, 'M1', options.timeframeData.M1!.candles).length, 1);
});

test('the reported M15 DB duplicate has one broker arrow, accuracy outcome and journal row', () => {
  const { intraday, options } = synchronizedFixture();
  const broker = { ...intraday, id: 'MT5:M15:1792647900:BUY:4084.530:4064.530:4124.530',
    signalAt: 1792647900, openedAt: 1792655712, completedAt: 1792668116,
    entry: 4084.530, stopLoss: 4064.530, takeProfit: 4124.530, riskPips: 200,
    result: 'sl' as const, mt5Managed: true, brokerTicket: 59002375235 };
  const chart = { ...intraday, id: 'DIRECT:DB-1791993600-4077.12905:1792647900:4086.125',
    signalAt: broker.signalAt, openedAt: 1792655340, completedAt: 1792668060,
    entry: 4086.125, stopLoss: 4066.125, takeProfit: 4126.125, riskPips: 200, result: 'sl' as const };
  const saved = [broker, chart];
  const before = JSON.stringify(saved);
  const canonical = buildCanonicalTradeRecords(saved, [], { ...options, timeframeData: {} });
  assert.deepEqual(canonical, [broker]);
  assert.deepEqual(selectTradeChartRecords(canonical, 'M15', [{ time: broker.signalAt }], true), [broker]);
  assert.deepEqual(mergeTradeRecordAnnotations(canonical, saved), [broker]);
  assert.equal(calculateJournalPerformance(canonical).completed, 1);
  assert.equal(calculateJournalPerformance(canonical).totalR, -1);
  assert.equal(JSON.stringify(saved), before, 'saved history is not rewritten or deleted');
});

test('M15 accuracy includes its M1/M5 scalps and intraday results, with matching chart arrows', () => {
  const { scalp, intraday } = synchronizedFixture();
  const m5 = { ...scalp, id: 'm15-m5-scalp', signalTimeframe: 'M5' as const, result: 'sl' as const };
  const hourlyScalp = { ...scalp, id: 'h1-scalp', zoneTimeframe: 'H1' as const };
  const lowerIntraday = { ...intraday, id: 'm5-intraday', signalTimeframe: 'M5' as const };
  const history = [scalp, m5, intraday, hourlyScalp, lowerIntraday];
  const before = JSON.stringify(history);
  const filters = { ...DEFAULT_TRADE_RECORD_FILTERS, timeframes: ['M15'] as const };
  const select = (tradeStyle: 'ALL' | 'SCALPING' | 'INTRADAY') => filterAccuracyTradeRecords(history,
    { ...filters, timeframes: ['M15'], tradeStyle }, 'Asia/Kathmandu', 'XAUUSD');
  const summary = select('ALL');
  assert.deepEqual(summary, [scalp, m5, intraday]);
  assert.deepEqual(select('SCALPING'), [scalp, m5]);
  assert.deepEqual(select('INTRADAY'), [intraday]);
  assert.deepEqual(new Set(selectTradeChartRecords(summary, 'M15', [{ time: 0 }, { time: 900 }], true)
    .map((record) => record.id)), new Set(summary.map((record) => record.id)));
  assert.deepEqual(filterAccuracyTradeRecords(history, { ...filters, timeframes: ['M15'], result: 'sl' },
    'Asia/Kathmandu', 'XAUUSD'), [m5]);
  assert.deepEqual(filterAccuracyTradeRecords(history, { ...filters, timeframes: ['M15'], source: 'ENGULFING' },
    'Asia/Kathmandu', 'XAUUSD'), [intraday]);
  assert.deepEqual(filterAccuracyTradeRecords(history, { ...filters, timeframes: ['H1'] },
    'Asia/Kathmandu', 'XAUUSD'), [hourlyScalp]);
  assert.deepEqual(filterAccuracyTradeRecords(history, { ...filters, timeframes: ['M1'] },
    'Asia/Kathmandu', 'XAUUSD'), [scalp, hourlyScalp]);
  assert.deepEqual(filterAccuracyTradeRecords(history, { ...filters, timeframes: ['M15', 'M1', 'M5'] },
    'Asia/Kathmandu', 'XAUUSD'), history, 'selecting both setup and entry timeframes does not duplicate a trade');
  assert.deepEqual(filterAccuracyTradeRecords(history, DEFAULT_TRADE_RECORD_FILTERS,
    'Asia/Kathmandu', 'XAUUSD'), history);
  assert.deepEqual(filterAccuracyTradeRecords(history, { ...filters, timeframes: [] },
    'Asia/Kathmandu', 'XAUUSD'), []);
  assert.deepEqual(filterAccuracyTradeRecords(history, { ...filters, timeframes: ['M15'] },
    'Asia/Kathmandu', 'EURUSD'), [intraday], 'other markets keep their entry-timeframe selection');
  assert.deepEqual(filterTradeRecords(history, { ...filters, timeframes: ['M15'] },
    'Asia/Kathmandu'), [intraday], 'journal filtering remains unchanged');
  assert.equal(JSON.stringify(history), before);
});

test('M15 can display completed M1/M5 scalps on their filled-entry candles without adding trades', () => {
  const { scalp, intraday } = synchronizedFixture();
  const m1 = { ...scalp, openedAt: 899, completedAt: 2000 };
  const m5 = { ...scalp, id: 'm5-scalp', source: 'ENGULFING' as const,
    signalTimeframe: 'M5' as const, openedAt: 900, completedAt: 2100 };
  const pending = { ...m1, id: 'unfilled', openedAt: undefined };
  const open = { ...m1, id: 'open', result: 'open' as const };
  const outside = { ...m1, id: 'outside-loaded-chart', openedAt: 3600, completedAt: 4000 };
  const rows = [m1, m5, intraday, pending, open, outside];
  const before = JSON.stringify(rows);
  const candles = [{ time: 0 }, { time: 900 }, { time: 1800 }, { time: 2700 }];
  const selected = selectTradeChartRecords(rows, 'M15', candles, true);
  assert.deepEqual(new Set(selected.map((record) => record.id)), new Set([m1.id, m5.id, intraday.id]));
  assert.deepEqual(selectTradeChartRecords(rows, 'M15', [{ time: 0 }], true), [m1],
    'an entry at 899 belongs to the first M15 candle; an entry at 900 belongs to the next');
  assert.deepEqual(selectTradeChartRecords(rows, 'M15', candles), [intraday],
    'projection is enabled explicitly for the Gold chart');
  assert.equal(selectTradeChartRecords(rows, 'M5', [{ time: 60 }, { time: 900 }], true)
    .some((record) => record.id === m1.id), false, 'do not project these scalps onto other charts');
  assert.equal(JSON.stringify(rows), before, 'displaying an extra arrow never alters trade records or results');
  assert.equal(new Set(selected.map((record) => record.id)).size, selected.length);
});

test('projected entries match the same candle with unordered bars and a market gap', () => {
  const { scalp } = synchronizedFixture();
  const inside = { ...scalp, openedAt: 899 };
  const next = { ...scalp, id: 'next-candle', openedAt: 900 };
  const gap = { ...scalp, id: 'gap-entry', openedAt: 1800 };
  const candles = [{ time: 2700 }, { time: 900 }, { time: 0 }];
  const selected = selectTradeChartRecords([inside, next, gap], 'M15', candles, true);
  assert.deepEqual(new Set(selected.map((record) => record.id)), new Set([inside.id, next.id]));
});

test('H1 shows completed M1/M5 scalps on their filled-entry hour alongside native H1 trades', () => {
  const { scalp, intraday } = synchronizedFixture();
  const m1 = { ...scalp, openedAt: 3599, completedAt: 4000 };
  const m5 = { ...scalp, id: 'hourly-m5-scalp', signalTimeframe: 'M5' as const,
    zoneTimeframe: 'H1' as const, openedAt: 3600, completedAt: 4500 };
  const hourly = { ...intraday, id: 'native-h1', signalTimeframe: 'H1' as const,
    zoneTimeframe: 'H1' as const, signalAt: 0, openedAt: 3600, completedAt: 7000 };
  const rows = [m1, m5, hourly,
    { ...m1, id: 'unfilled-h1-scalp', openedAt: undefined },
    { ...m1, id: 'open-h1-scalp', result: 'open' as const },
    { ...m1, id: 'outside-h1-history', openedAt: 7200, completedAt: 8000 }];
  const before = JSON.stringify(rows);
  assert.deepEqual(new Set(selectTradeChartRecords(rows, 'H1', [{ time: 0 }, { time: 3600 }], true)
    .map((record) => record.id)), new Set([m1.id, m5.id, hourly.id]));
  assert.deepEqual(new Set(selectTradeChartRecords(rows, 'H1', [{ time: 0 }], true)
    .map((record) => record.id)), new Set([m1.id, hourly.id]));
  assert.deepEqual(selectTradeChartRecords(rows, 'H1', [{ time: 3600 }], true), [m5]);
  assert.deepEqual(selectTradeChartRecords(rows, 'H1', [{ time: 0 }, { time: 3600 }]), [hourly]);
  assert.equal(JSON.stringify(rows), before);
});

test('H1 projects completed intraday trades by filled entry without changing other chart selections', () => {
  const { intraday } = synchronizedFixture();
  const m15 = { ...intraday, openedAt: 3599, completedAt: 4000 };
  const m30 = { ...intraday, id: 'm30-intraday', signalTimeframe: 'M30' as const,
    openedAt: 3600, completedAt: 5000 };
  const mtf = { ...intraday, id: 'mtf-intraday', source: 'MTF' as const,
    signalTimeframe: 'M5' as const, openedAt: 3650, completedAt: 5500 };
  const hourly = { ...intraday, id: 'h1-intraday', signalTimeframe: 'H1' as const,
    signalAt: 0, openedAt: 3600, completedAt: 6000 };
  const rows = [m15, m30, mtf, hourly,
    { ...m15, id: 'unfilled-intraday', openedAt: undefined },
    { ...m15, id: 'open-intraday', result: 'open' as const },
    { ...m15, id: 'outside-intraday', openedAt: 7200, completedAt: 8000 }];
  const before = JSON.stringify(rows);
  const selected = selectTradeChartRecords(rows, 'H1', [{ time: 0 }, { time: 3600 }], true);
  assert.deepEqual(new Set(selected.map((record) => record.id)), new Set([m15.id, m30.id, mtf.id, hourly.id]));
  assert.equal(selected.length, 4, 'each trade appears once');
  assert.deepEqual(new Set(selectTradeChartRecords(rows, 'H1', [{ time: 0 }], true)
    .map((record) => record.id)), new Set([m15.id, hourly.id]));
  assert.deepEqual(new Set(selectTradeChartRecords(rows, 'H1', [{ time: 3600 }], true)
    .map((record) => record.id)), new Set([m30.id, mtf.id]));
  assert.deepEqual(selectTradeChartRecords(rows, 'H1', [{ time: 0 }]), [hourly]);
  assert.deepEqual(selectTradeChartRecords([m15, m30, mtf, hourly], 'M15', [{ time: 900 }], true), [m15]);
  assert.equal(JSON.stringify(rows), before);
});

test('style switches keep arrows, accuracy and journal on the same records without deleting history', () => {
  const { scalp, intraday, options } = synchronizedFixture();
  const stored = buildCanonicalTradeRecords([], [scalp, intraday], options);
  const before = JSON.stringify(stored);
  for (const scalpingEnabled of [false, true]) {
    for (const intradayEnabled of [false, true]) {
      const config = { scalpingEnabled, intradayEnabled };
      const visible = stored.filter((record) => isTradeStyleEnabled(config, record));
      const ids = new Set([...(scalpingEnabled ? [scalp.id] : []), ...(intradayEnabled ? [intraday.id] : [])]);
      assert.deepEqual(new Set(visible.map((record) => record.id)), ids);
      assert.equal(calculateJournalPerformance(mergeTradeRecordAnnotations(visible, stored)).completed,
        Number(scalpingEnabled) + Number(intradayEnabled));
      for (const timeframe of ['M15', 'H1'] as const) {
        const arrows = selectTradeChartRecords(visible, timeframe, [{ time: 0 }, { time: 900 }], true);
        assert.deepEqual(new Set(arrows.map((record) => record.id)), ids);
      }
    }
  }
  assert.equal(JSON.stringify(stored), before);
  assert.equal(stored.filter((record) => isTradeStyleEnabled({ scalpingEnabled: true, intradayEnabled: true }, record)).length, 2,
    're-enabling both styles restores the original history');
});

test('RF and intraday SL outcomes keep the same prices and results in history and journal', () => {
  const { scalp, intraday, options } = synchronizedFixture();
  const source = options.timeframeData.M1!;
  const rfOptions = { ...options, timeframeData: { ...options.timeframeData,
    M1: { ...source, candles: source.candles.map((candle) => candle.time === 120
      ? { ...candle, high: 4104 } : candle.time === 180 ? { ...candle, high: 4105, low: 4084 } : candle) } } };
  const rf = buildCanonicalTradeRecords([], [{ ...scalp, result: 'rf' }], rfOptions);
  assert.equal(rf.length, 1);
  assert.equal(calculateJournalPerformance(rf).totalR, 0);
  assert.deepEqual(selectTradeChartRecords(rf, 'M1', rfOptions.timeframeData.M1!.candles), rf);
  const intradaySource = options.timeframeData.M15!;
  const slOptions = { ...options, timeframeData: { ...options.timeframeData,
    M15: { ...intradaySource, candles: intradaySource.candles.map((candle) => candle.time === 2700
      ? { ...candle, high: 4110, low: 4084 } : candle) } } };
  const sl = buildCanonicalTradeRecords([], [{ ...intraday, result: 'sl' }], slOptions);
  assert.equal(sl.length, 1);
  assert.equal(calculateJournalPerformance(sl).totalR, -1);
});

test('matching style and session filters select the same canonical records for arrows and journal', () => {
  const { scalp, intraday, options } = synchronizedFixture();
  const canonical = buildCanonicalTradeRecords([], [
    { ...scalp, outsideTradingTime: true }, { ...intraday, outsideTradingTime: false },
  ], options);
  const filters = { ...DEFAULT_TRADE_RECORD_FILTERS, tradeStyle: 'SCALPING' as const,
    tradingTime: 'NON_TRADING' as const };
  const accuracy = filterTradeRecords(canonical, filters, 'Asia/Kathmandu');
  const journal = filterTradeRecords(mergeTradeRecordAnnotations(canonical, []), filters, 'Asia/Kathmandu');
  const arrows = selectTradeChartRecords(accuracy, 'M1', options.timeframeData.M1!.candles);
  assert.deepEqual(accuracy.map((record) => record.id), [scalp.id]);
  assert.deepEqual(arrows, journal);
});

test('a mapped signal waits for its own candle close and validates exits on the finer execution candles', () => {
  const candles = [
    { time: 0, high: 105, low: 99 },
    { time: 900, high: 111, low: 99 },
    { time: 1800, high: 104, low: 99 },
    { time: 2700, high: 104, low: 94 },
    { time: 3600, high: 111, low: 96 },
  ];
  const trade = { ...records[0], signalTimeframe: 'M30' as const, signalAt: 0,
    openedAt: 1800, completedAt: 2700, result: 'sl' as const, tradeStyle: 'INTRADAY',
    entry: 100, stopLoss: 95, takeProfit: 110 };
  assert.equal(accuracyResultMatchesCandles(trade, candles, 900, 0, 1800), true,
    'the pre-confirmation target cannot resolve a trade that has not entered');
  assert.equal(accuracyResultMatchesCandles({ ...trade, result: 'tp', completedAt: 3600 },
    candles, 900, 0, 1800), false, 'a target after the first SL cannot replace that result');
});

test('a later intraday entry from the same M15 Gold zone can also appear on M1', () => {
  const base = {
    completedAt: 1000, zoneTimeframe: 'M15' as const,
    direction: 'bearish' as const, result: 'tp' as const, zoneName: 'TJL2',
    source: 'ENGULFING' as const,
  };
  const scalp = {
    ...base, id: 'GOLD_SCALP:M15:TJL2-123:100:4154',
    tradeStyle: 'SCALPING', signalTimeframe: 'M1' as const, signalAt: 100,
  };
  const intraday = {
    ...base, id: 'DIRECT:TJL2-123:200:4150',
    tradeStyle: 'INTRADAY', signalTimeframe: 'M15' as const, signalAt: 200,
  };
  const otherZone = { ...intraday, id: 'DIRECT:TJL2-456:300:4150', signalAt: 300 };
  const earlier = { ...intraday, id: 'DIRECT:TJL2-123:50:4150', signalAt: 50 };
  assert.deepEqual(selectGoldIntradayAfterScalp([scalp, intraday, otherZone, earlier]),
    [intraday]);
});

test('saved TP needs an entry fill and a target touch on the current candle history', () => {
  const candles = [
    { time: 0, high: 105, low: 98 },
    { time: 900, high: 104, low: 99 },
    { time: 1800, high: 111, low: 101 },
  ];
  const trade = {
    ...records[0], signalAt: 0, completedAt: 1800,
    entry: 100, stopLoss: 95, takeProfit: 110,
  };
  assert.equal(accuracyResultMatchesCandles(trade, candles, 900), true);
  assert.equal(accuracyResultMatchesCandles({ ...trade, signalAt: 300 }, candles, 900), false,
    'an M15 signal at 20:05 cannot attach to the 20:00 M15 candle');
  assert.equal(accuracyResultMatchesCandles({
    ...trade, entry: 50, stopLoss: 45, takeProfit: 60,
  }, candles, 900), false, 'a stale entry below every current candle cannot be a TP');
  assert.equal(accuracyResultMatchesCandles({ ...trade, takeProfit: 115 }, candles, 900), false);
  assert.equal(accuracyResultMatchesCandles(trade, candles.slice(0, 2), 900), false,
    'a result after the loaded candles cannot produce a completed chart trade');
  assert.equal(accuracyResultMatchesCandles(trade, [], 900), true,
    'a saved trade outside the loaded history cannot be disproved');
});

test('saved direct entry needs its named source zone in the current structure', () => {
  const record = {
    id: 'DIRECT:Internal TJL1-1792065600-4144.095:1792080900:4150.955',
    zoneName: 'Internal QML', zoneTimeframe: 'H1' as const, signalAt: 1792080900,
  };
  const signalCandles = [{ time: 1792080900, high: 4153, low: 4144 }];
  assert.equal(savedDirectZoneMatchesStructure(record, signalCandles, [
    { id: 'QML-1792065600-4144.095', name: 'QML' },
  ]), false, 'another QML at the same time is not the saved Internal QML');
  assert.equal(savedDirectZoneMatchesStructure(record, signalCandles, [
    { id: 'Internal TJL1-1792065600-4144.095', name: 'Internal QML' },
  ]), true);
  assert.equal(savedDirectZoneMatchesStructure(record, signalCandles, [
    { id: 'Internal TJL1-1792065600-4144.095', name: 'RBS' },
  ]), false, 'a reused zone ID cannot keep an old zone name');
  assert.equal(savedDirectZoneMatchesStructure(record, [], []), true,
    'unloaded historical signals remain in saved history');
});

const records: FilterableTradeRecord[] = [
  {
    completedAt: Date.UTC(2026, 9, 8, 1, 30) / 1000,
    signalTimeframe: 'M1',
    source: 'ENGULFING',
    direction: 'bullish',
    result: 'tp',
    zoneName: 'QML',
  },
  {
    completedAt: Date.UTC(2026, 9, 7, 18, 30) / 1000,
    signalTimeframe: 'M5',
    source: 'MTF',
    direction: 'bearish',
    result: 'sl',
    zoneName: 'TJL1',
  },
];

test('trade date filtering follows the selected chart timezone', () => {
  assert.equal(tradeRecordDateKey(records[1].completedAt, 'UTC'), '2026-10-07');
  assert.equal(tradeRecordDateKey(records[1].completedAt, 'Asia/Kathmandu'), '2026-10-08');
});

test('trade periods support timezone-aware daily, Sunday-start weekly and monthly keys', () => {
  assert.equal(tradeRecordPeriodKey(records[1].completedAt, 'Asia/Kathmandu', 'DAY'), '2026-10-08');
  assert.equal(tradeRecordPeriodKey(records[1].completedAt, 'Asia/Kathmandu', 'WEEK'), '2026-10-04');
  assert.equal(tradeRecordPeriodKey(records[1].completedAt, 'Asia/Kathmandu', 'MONTH'), '2026-10');
  assert.equal(tradeRecordPeriodKey(Date.UTC(2027, 0, 1) / 1000, 'UTC', 'WEEK'), '2026-12-27');
  assert.equal(tradeRecordDatePeriodKey('2026-10-10', 'WEEK'), '2026-10-04');
});

test('trade filters combine timeframe, date, source, side, result and zone', () => {
  const filtered = filterTradeRecords(records, {
    ...DEFAULT_TRADE_RECORD_FILTERS,
    timeframes: ['M5'],
    datePeriod: 'DAY',
    date: '2026-10-08',
    source: 'MTF',
    side: 'SELL',
    result: 'sl',
    zones: ['TJL1'],
  }, 'Asia/Kathmandu');
  assert.deepEqual(filtered, [records[1]]);
});

test('trade filters accept multiple timeframes and zones', () => {
  const filtered = filterTradeRecords(records, {
    ...DEFAULT_TRADE_RECORD_FILTERS,
    timeframes: ['M1', 'M5', 'M15'],
    zones: ['QML', 'TJL1'],
  }, 'Asia/Kathmandu');
  assert.deepEqual(filtered, records);

  const withoutM1 = filterTradeRecords(records, {
    ...DEFAULT_TRADE_RECORD_FILTERS,
    timeframes: ['M5', 'M15'],
    zones: ['QML', 'TJL1'],
  }, 'Asia/Kathmandu');
  assert.deepEqual(withoutM1, [records[1]]);
});

test('trade filters select complete weeks and months', () => {
  const later = {
    ...records[0],
    completedAt: Date.UTC(2026, 10, 2, 1, 30) / 1000,
  };
  const periodRecords = [...records, later];
  assert.deepEqual(filterTradeRecords(periodRecords, {
    ...DEFAULT_TRADE_RECORD_FILTERS,
    datePeriod: 'WEEK',
    date: '2026-10-06',
  }, 'Asia/Kathmandu'), records);
  assert.deepEqual(filterTradeRecords(periodRecords, {
    ...DEFAULT_TRADE_RECORD_FILTERS,
    datePeriod: 'MONTH',
    date: '2026-11-21',
  }, 'Asia/Kathmandu'), [later]);
});

test('open MT5 journal records stay visible without affecting completed-result filters', () => {
  const openRecord: FilterableTradeRecord = {
    ...records[0],
    result: 'open',
    zoneName: 'RBS',
  };
  const journalRecords = [...records, openRecord];
  assert.deepEqual(filterTradeRecords(journalRecords, DEFAULT_TRADE_RECORD_FILTERS, 'Asia/Kathmandu'), journalRecords);
  assert.deepEqual(filterTradeRecords(journalRecords, {
    ...DEFAULT_TRADE_RECORD_FILTERS,
    result: 'tp',
  }, 'Asia/Kathmandu'), [records[0]]);
});

test('chart entry arrows match only visible completed rows on their confirmation timeframe', () => {
  const rows = [
    { ...records[0], id: 'visible-tp', signalAt: 100, signalTimeframe: 'M15' as const },
    { ...records[0], id: 'hidden-tp', signalAt: 200, signalTimeframe: 'M15' as const },
    { ...records[1], id: 'other-timeframe', signalAt: 300, signalTimeframe: 'M30' as const },
    { ...records[0], id: 'active', signalAt: 400, signalTimeframe: 'M15' as const, result: 'open' as const },
    { ...records[0], id: 'no-candle-time', signalAt: undefined, signalTimeframe: 'M15' as const },
  ];
  assert.deepEqual(
    selectAccuracyChartEntries(rows, new Set(['visible-tp', 'active', 'other-timeframe']), 'M15')
      .map((row) => row.id),
    ['visible-tp'],
  );
});

test('entry arrows retain old results and include filled active trades without changing accuracy', () => {
  const { scalp } = synchronizedFixture();
  const old = { ...scalp, id: 'old', result: 'tp' as const, completedAt: 180 };
  const active = { ...scalp, id: 'active', result: 'open' as const };
  const riskFree = { ...scalp, id: 'risk-free', result: 'risk-free' as const };
  const unfilled = { ...active, id: 'unfilled', openedAt: undefined };
  const rows = [old, active, riskFree, unfilled];
  const candles = [{ time: 60 }, ...Array.from({ length: 20 }, (_, i) => ({ time: 120 + i * 60 }))];
  const before = JSON.stringify(rows);
  assert.deepEqual(new Set(selectTradeChartRecords(rows, 'M1', candles, true,
    { includeActive: true, asOf: 10000 }).map(row => row.id)), new Set(['old', 'active', 'risk-free']));
  assert.deepEqual(selectTradeChartRecords(rows, 'M1', candles), [old], 'accuracy remains completed only');
  assert.equal(JSON.stringify(rows), before, 'arrow display leaves trade records intact');
});

test('active entry arrows wait for the fill in replay and project onto Gold parent candles', () => {
  const { scalp } = synchronizedFixture();
  const active = { ...scalp, id: 'active', result: 'open' as const };
  const options = { includeActive: true, asOf: active.openedAt! - 1 };
  assert.deepEqual(selectTradeChartRecords([active], 'M1', [{ time: active.signalAt! }], true, options), []);
  options.asOf = active.openedAt!;
  assert.deepEqual(selectTradeChartRecords([active], 'M1', [{ time: active.signalAt! }], true, options), [active]);
  for (const timeframe of ['M15', 'H1'] as const) {
    assert.deepEqual(selectTradeChartRecords([active], timeframe, [{ time: 0 }], true, options), [active]);
  }
  assert.deepEqual(selectTradeChartRecords([scalp], 'M1', [{ time: scalp.signalAt! }], true, options), [],
    'a future result is not drawn early');
});

test('replay entry arrows wait until the trade result has occurred', () => {
  const rows = [
    { ...records[0], id: 'resolved', signalAt: 100, completedAt: 200, signalTimeframe: 'M15' as const },
    { ...records[0], id: 'future-result', signalAt: 110, completedAt: 400, signalTimeframe: 'M15' as const },
  ];
  assert.deepEqual(selectAccuracyChartEntries(rows, null, 'M15', 250).map((row) => row.id), ['resolved']);
  assert.deepEqual(selectAccuracyChartEntries(rows, null, 'M15', 400).map((row) => row.id), ['resolved', 'future-result']);
});

test('two-month accuracy uses calendar months and clamps month ends across leap years', () => {
  for (const [end, expectedStart] of [
    ['2026-10-24T09:00:00Z', '2026-08-24T09:00:00Z'],
    ['2026-04-30T09:00:00Z', '2026-02-28T09:00:00Z'],
    ['2024-04-30T09:00:00Z', '2024-02-29T09:00:00Z'],
    ['2026-01-31T09:00:00Z', '2025-11-30T09:00:00Z'],
  ]) {
    const asOf = Date.parse(end) / 1000;
    assert.deepEqual(twoMonthAccuracyWindow(asOf), { from: Date.parse(expectedStart) / 1000, to: asOf });
  }
});

test('journal completed trades match accuracy for the same two-month, setup, style and session filters', () => {
  const asOf = Date.parse('2026-10-24T09:00:00Z') / 1000;
  const { from } = twoMonthAccuracyWindow(asOf);
  const { scalp, intraday } = synchronizedFixture();
  const history: JournalTradeRecord[] = [
    { ...scalp, completedAt: from, outsideTradingTime: false },
    { ...intraday, completedAt: asOf - 100, outsideTradingTime: true, result: 'sl' },
    { ...scalp, id: 'hourly-scalp', zoneTimeframe: 'H1', completedAt: asOf - 200 },
    { ...intraday, id: 'old', completedAt: from - 1 },
    { ...intraday, id: 'future-result', completedAt: asOf + 1 },
    { ...intraday, id: 'running', openedAt: from - 100, result: 'open' },
    { ...scalp, id: 'running-rf', result: 'risk-free' },
    { ...intraday, id: 'future-open', openedAt: asOf + 1, result: 'open' },
  ];
  const before = JSON.stringify(history);
  for (const timeframes of [['M15'], ['H1'], ['M1'], 'ALL'] as const) {
    for (const tradeStyle of ['ALL', 'INTRADAY', 'SCALPING'] as const) {
      for (const tradingTime of ['ALL', 'TRADING', 'NON_TRADING'] as const) {
        const filters: TradeRecordFilters = {
          ...DEFAULT_TRADE_RECORD_FILTERS,
          timeframes: timeframes === 'ALL' ? 'ALL' : [...timeframes], tradeStyle, tradingTime,
        };
        const journal = filterAccuracyTradeRecords(selectTwoMonthJournalRecords(history, asOf), filters, 'Asia/Kathmandu', 'XAUUSD');
        const accuracy = filterAccuracyTradeRecords(selectTwoMonthAccuracyRecords(history, asOf), filters, 'Asia/Kathmandu', 'XAUUSD');
        const completed = journal.filter((record) => ['tp', 'sl', 'rf'].includes(record.result));
        assert.deepEqual(completed, accuracy);
        assert.deepEqual(calculateJournalPerformance(completed), calculateJournalPerformance(accuracy));
      }
    }
  }
  assert.deepEqual(selectTwoMonthJournalRecords(history, asOf).filter((record) => ['open', 'risk-free'].includes(record.result))
    .map((record) => record.id), ['running', 'running-rf'], 'running positions remain visible but future positions do not');
  assert.equal(JSON.stringify(history), before, 'limiting the displayed history does not delete saved trades');
});

test('two-month completed outcomes and verification arrows keep identical IDs through style and timeframe filters', () => {
  const asOf = Date.parse('2026-10-24T09:00:00Z') / 1000;
  const { from } = twoMonthAccuracyWindow(asOf);
  const make = (id: string, completedAt: number, result: FilterableTradeRecord['result']) => ({
    ...records[0], id, signalAt: from - 900, completedAt, result,
    signalTimeframe: 'M15' as const, zoneTimeframe: 'M15' as const, tradeStyle: 'INTRADAY',
  });
  const history = [
    make('old', from - 1, 'tp'),
    make('boundary-tp', from, 'tp'),
    make('sl', asOf - 2, 'sl'),
    make('rf', asOf - 1, 'rf'),
    make('end-tp', asOf, 'tp'),
    make('future', asOf + 1, 'tp'),
    make('open', asOf - 1, 'open'),
    make('risk-free-active', asOf - 1, 'risk-free'),
    { ...make('other-timeframe', asOf - 1, 'tp'), signalTimeframe: 'M5' as const },
    { ...make('scalp', asOf - 1, 'tp'), tradeStyle: 'SCALPING' },
  ];
  const summary = filterTradeRecords(selectTwoMonthAccuracyRecords(history, asOf), {
    ...DEFAULT_TRADE_RECORD_FILTERS, timeframes: ['M15'], tradeStyle: 'INTRADAY',
  }, 'Asia/Kathmandu');
  const ids = summary.map((record) => record.id);
  assert.deepEqual(ids, ['boundary-tp', 'sl', 'rf', 'end-tp']);
  assert.deepEqual(selectTradeChartRecords(summary, 'M15', [{ time: from - 900 }])
    .map((record) => record.id).sort(), [...ids].sort());
  assert.equal(selectTwoMonthAccuracyRecords(history, from - 1).some((record) => record.id === 'boundary-tp'), false,
    'replay must not count outcomes completed after its current time');
});
