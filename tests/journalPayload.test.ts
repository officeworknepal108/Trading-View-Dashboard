import assert from 'node:assert/strict';
import test from 'node:test';
import type { JournalTradeRecord } from '../src/components/TradeJournal';
import { journalDashboardTrades, journalPendingImageTrades } from '../src/services/journalPayload';

const trade: JournalTradeRecord = {
  id: 'mt5-1', zoneName: 'DB', zoneTimeframe: 'M15', result: 'tp',
  completedAt: 2000, source: 'ENGULFING', direction: 'bullish', signalTimeframe: 'M5',
  engulfingType: 'T1', entry: 100, stopLoss: 99, takeProfit: 102, rewardRisk: 2, riskPips: 10,
  mt5Managed: true, mt5SignalId: 'signal-1', lifecycleStatus: 'closed', realizedProfit: 125,
};

test('dashboard payload excludes image archives while preserving trade facts and stored originals', () => {
  const candles = [{ time: 1000, open: 100, high: 102, low: 99, close: 101 }];
  const archived = { ...trade, screenshotDataUrl: 'large-image', entryScreenshotDataUrl: 'entry',
    exitScreenshotDataUrl: 'exit', snapshotCandles: candles,
    entrySnapshotCandles: candles, exitSnapshotCandles: candles };
  const original = structuredClone(archived);
  assert.deepEqual(journalDashboardTrades([archived]), [trade]);
  assert.deepEqual(archived, original);
  // Sending the lightweight facts back must preserve archived screenshots.
  assert.deepEqual({ ...archived, ...journalDashboardTrades([archived])[0] }, original);
});

test('image repair requests include only MT5 records with missing entry or closed exit images', () => {
  const complete = { ...trade, entryScreenshotDataUrl: 'entry', exitScreenshotDataUrl: 'exit' };
  const missingEntry = { ...trade, id: 'missing-entry', exitScreenshotDataUrl: 'exit' };
  const missingExit = { ...trade, id: 'missing-exit', entryScreenshotDataUrl: 'entry' };
  assert.deepEqual(journalPendingImageTrades([
    complete, missingEntry, missingExit,
    { ...missingExit, id: 'running', lifecycleStatus: 'open' },
    { ...trade, id: 'chart', mt5Managed: false },
    { ...trade, id: 'unlinked', mt5SignalId: undefined },
  ]), [missingEntry, missingExit]);
});
