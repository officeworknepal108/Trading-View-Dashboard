import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TRADE_RECORD_FILTERS,
  filterTradeRecords,
  tradeRecordDateKey,
  type FilterableTradeRecord,
} from '../src/services/tradeRecordFilters';

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

test('trade filters combine timeframe, date, source, side, result and zone', () => {
  const filtered = filterTradeRecords(records, {
    ...DEFAULT_TRADE_RECORD_FILTERS,
    timeframes: ['M5'],
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
