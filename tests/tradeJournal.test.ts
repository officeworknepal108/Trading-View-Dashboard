import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateJournalCashSummary,
  calculateJournalPerformance,
  inferTradingSession,
  journalDateKey,
  type JournalTradeRecord,
} from '../src/components/TradeJournal';

function unixTime(isoTime: string): number {
  return Date.parse(isoTime) / 1000;
}

test('journal infers sessions from Nepal-local trade time', () => {
  assert.equal(inferTradingSession(unixTime('2024-07-09T04:00:00Z')), 'ASIAN');
  assert.equal(inferTradingSession(unixTime('2024-07-03T08:15:00Z')), 'LONDON');
  assert.equal(inferTradingSession(unixTime('2024-07-10T14:15:00Z')), 'LON + NYC');
  assert.equal(inferTradingSession(unixTime('2024-07-10T18:00:00Z')), 'NEW YORK');
});

test('journal calendar groups trades by the selected chart timezone', () => {
  const timestamp = unixTime('2024-07-09T19:00:00Z');
  assert.equal(journalDateKey(timestamp, 'Asia/Kathmandu'), '2024-07-10');
  assert.equal(journalDateKey(timestamp, 'UTC'), '2024-07-09');
});

test('journal calendar totals only completed trades with actual broker cash results', () => {
  const base: JournalTradeRecord = {
    id: 'mt5-1', zoneName: 'DB', zoneTimeframe: 'M15', result: 'tp',
    completedAt: unixTime('2024-07-09T10:00:00Z'), source: 'ENGULFING',
    direction: 'bullish', signalTimeframe: 'M15', engulfingType: 'T1',
    entry: 100, stopLoss: 99, takeProfit: 102, rewardRisk: 2, riskPips: 10,
    realizedProfit: 125,
  };
  const summary = calculateJournalCashSummary([
    base,
    { ...base, id: 'mt5-2', result: 'sl', realizedProfit: -50 },
    { ...base, id: 'chart-only', result: 'tp', realizedProfit: undefined },
    { ...base, id: 'running', result: 'open', realizedProfit: 10 },
  ]);

  assert.deepEqual(summary, { tradeCount: 2, realizedProfit: 75 });
});

test('journal overview keeps broker cash and normalized R analytics separate', () => {
  const base: JournalTradeRecord = {
    id: 'trade-1', zoneName: 'DB', zoneTimeframe: 'M15', result: 'tp',
    completedAt: unixTime('2024-07-09T10:00:00Z'), source: 'ENGULFING',
    direction: 'bullish', signalTimeframe: 'M15', engulfingType: 'T1',
    entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10,
    realizedProfit: 100,
  };
  const performance = calculateJournalPerformance([
    base,
    { ...base, id: 'trade-2', result: 'sl', realizedProfit: -50 },
    { ...base, id: 'trade-3', result: 'rf', realizedProfit: undefined },
    { ...base, id: 'trade-4', result: 'open', realizedProfit: undefined },
  ]);

  assert.equal(performance.completed, 3);
  assert.equal(Math.round(performance.winRate * 100) / 100, 33.33);
  assert.equal(performance.profitFactor, 2);
  assert.equal(performance.averageWinLoss, 2);
  assert.equal(performance.totalR, 1);
  assert.equal(performance.realizedProfit, 50);
  assert.equal(performance.realizedTradeCount, 2);
});

test('Gold intraday journal uses full-position R while scalping keeps half-at-1R R', () => {
  const base: JournalTradeRecord = {
    id: 'intraday-tp', zoneName: 'TJL2', zoneTimeframe: 'M15', result: 'tp',
    completedAt: unixTime('2024-07-09T10:00:00Z'), source: 'ENGULFING',
    direction: 'bullish', signalTimeframe: 'M15', engulfingType: 'T2',
    entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10,
    tradeStyle: 'INTRADAY',
  };
  const performance = calculateJournalPerformance([
    base,
    { ...base, id: 'intraday-sl', result: 'sl' },
    { ...base, id: 'scalp-tp', tradeStyle: 'SCALPING' },
  ]);
  assert.equal(performance.totalR, 4);
});
