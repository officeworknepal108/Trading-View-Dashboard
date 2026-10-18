import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TRADE_RECORD_FILTERS,
  accuracyResultMatchesCandles,
  filterTradeRecords,
  savedDirectZoneMatchesStructure,
  selectAccuracyChartEntries,
  tradeRecordDateKey,
  tradeRecordDatePeriodKey,
  tradeRecordPeriodKey,
  type FilterableTradeRecord,
} from '../src/services/tradeRecordFilters';

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

test('replay entry arrows wait until the trade result has occurred', () => {
  const rows = [
    { ...records[0], id: 'resolved', signalAt: 100, completedAt: 200, signalTimeframe: 'M15' as const },
    { ...records[0], id: 'future-result', signalAt: 110, completedAt: 400, signalTimeframe: 'M15' as const },
  ];
  assert.deepEqual(selectAccuracyChartEntries(rows, null, 'M15', 250).map((row) => row.id), ['resolved']);
  assert.deepEqual(selectAccuracyChartEntries(rows, null, 'M15', 400).map((row) => row.id), ['resolved', 'future-result']);
});
