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

test('a broker fill replaces all recalculated chart prices for the same identified signal', () => {
  const signal = { ...base, source: 'ENGULFING', zoneName: 'DB', zoneTimeframe: 'M15',
    signalTimeframe: 'M15', tradeStyle: 'INTRADAY', signalAt: 1792647900 };
  const broker = { ...signal, id: 'MT5:59002375235', mt5Managed: true, brokerTicket: 59002375235,
    entry: 4084.530, stopLoss: 4064.530 };
  const chart = { ...signal, id: 'DIRECT:db:4086.125', entry: 4086.125, stopLoss: 4066.125 };
  const olderChart = { ...chart, id: 'DIRECT:db:4084.8', entry: 4084.8, stopLoss: 4064.8 };
  assert.deepEqual(deduplicateTradeRecords([chart, broker, olderChart]), [broker]);
  assert.deepEqual(deduplicateTradeRecords([broker, olderChart, chart]), [broker]);
  assert.deepEqual(deduplicateTradeRecords([chart, olderChart]), [chart, olderChart],
    'this change only replaces chart calculations when an actual broker record exists');
  for (const change of [
    { signalAt: signal.signalAt + 900 }, { zoneName: 'QML' }, { zoneTimeframe: 'H1' },
    { signalTimeframe: 'M5' }, { direction: 'bearish' }, { tradeStyle: 'SCALPING' },
    { source: 'MTF' }, { symbol: 'EURUSD' },
  ]) {
    assert.equal(deduplicateTradeRecords([broker, { ...chart, ...change }]).length, 2,
      'other identified signals must remain separate');
  }
  assert.equal(deduplicateTradeRecords([chart, broker,
    { ...broker, id: 'MT5:another-ticket', brokerTicket: 59002375236 }]).length, 2);
});
