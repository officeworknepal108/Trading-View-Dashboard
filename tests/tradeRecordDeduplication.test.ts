import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateTradeRecords, tradeExecutionKey } from '../src/services/tradeRecordDeduplication';

const base = {
  completedAt: 2000,
  direction: 'bullish',
  signalTimeframe: 'M5',
  signalAt: 1000,
  entry: 4108.555,
  stopLoss: 4099.855,
};

test('deduplicates one execution found through direct and MTF routes', () => {
  const records = deduplicateTradeRecords([
    { ...base, id: 'MTF:H1-M5', source: 'MTF', zoneTimeframe: 'H1', takeProfit: 4117.255 },
    { ...base, id: 'DIRECT:RBS', source: 'ENGULFING', zoneTimeframe: 'M5', takeProfit: 4125.955 },
    { ...base, id: 'MTF:M15-M5', source: 'MTF', zoneTimeframe: 'M15', takeProfit: 4125.955 },
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'DIRECT:RBS');
  assert.equal(records[0].takeProfit, 4125.955);
});

test('keeps distinct entries and stops as separate trades', () => {
  const records = deduplicateTradeRecords([
    { ...base, id: 'one', source: 'ENGULFING' },
    { ...base, id: 'two', source: 'ENGULFING', entry: 4108.556 },
    { ...base, id: 'three', source: 'ENGULFING', stopLoss: 4099.854 },
  ]);

  assert.equal(records.length, 3);
});

test('falls back to record id when execution identity is incomplete', () => {
  assert.equal(tradeExecutionKey({ id: 'legacy', completedAt: 100 }), 'ID:legacy');
});

test('identical price and signal numbers on different symbols are different executions', () => {
  assert.equal(deduplicateTradeRecords([
    { ...base, id: 'gold', symbol: 'XAUUSD' },
    { ...base, id: 'forex', symbol: 'EURUSD' },
  ]).length, 2);
});

test('distinct broker tickets are separate actual executions even at identical prices', () => {
  assert.equal(deduplicateTradeRecords([
    { ...base, id: 'mt5-1', mt5Managed: true, brokerTicket: 1 },
    { ...base, id: 'mt5-2', mt5Managed: true, brokerTicket: 2 },
  ]).length, 2);
});
