import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedPullbackFill, filledPullbackLegs, scalpReplayTableSignals } from '../src/services/pullbackEntryDisplay';
import { scalpOutcomeExpired } from '../src/services/scalpChartDisplay';
import type { Mt5StoredSignal, Mt5AutomationStatus } from '../src/services/mt5Automation';
import type { JournalTradeRecord } from '../src/components/TradeJournal';

const signal: Mt5StoredSignal = { id: 'entry10', setupId: 'setup:P10', symbol: 'XAUUSD', source: 'ENGULFING',
  tradeStyle: 'INTRADAY', direction: 'BUY', orderType: 'LIMIT', zoneName: 'TJL1', zoneTimeframe: 'M15',
  signalTimeframe: 'M15', signalAt: 900, calculatedAt: 1800, engulfingType: 'T1',
  entry: 3009, stopLoss: 2990, takeProfit: 3050, riskFree: 3030, riskPips: 190, rewardRisk: 41 / 19,
  expiresAt: 2700, status: 'PLACED', createdAt: 1800, updatedAt: 1800, brokerSymbol: 'GOLD', brokerTicket: 100,
  intradayEntry: { version: 1, leg: 10, riskShare: 0.6, referenceEntry: 3010, nextOpen: 3010, confirmationBody: 10, setupKey: 'setup' } };
const base = { ...signal, entry: 3010 };
const position: Mt5AutomationStatus['positions'][number] = { ticket: 100, symbol: 'GOLD', direction: 'BUY',
  volume: 0.1, priceOpen: 3009, priceCurrent: 3010, stopLoss: 2990, takeProfit: 3050,
  profit: 10, swap: 0, openedAt: 1900, setupId: signal.setupId };
const record: JournalTradeRecord = { id: 'chart10', source: 'ENGULFING', symbol: 'XAUUSD', zoneName: 'TJL1',
  zoneTimeframe: 'M15', signalTimeframe: 'M15', signalAt: 900, engulfingType: 'T1', direction: 'bullish',
  entry: 3009, stopLoss: 2990, takeProfit: 3050, riskPips: 190, rewardRisk: 41 / 19,
  openedAt: 1900, completedAt: 1900, result: 'open', tradeStyle: 'INTRADAY', intradayEntry: signal.intradayEntry };

test('pending-order placement and ticket allocation do not count as a fill', () => {
  for (const status of ['QUEUED', 'CLAIMED', 'PLACED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SIMULATED'] as const)
    assert.equal(confirmedPullbackFill({ ...signal, status }, 2000), false, status);
  assert.equal(confirmedPullbackFill({ ...signal, preview: true, status: 'ACTIVE' }, 2000), false);
});

test('actual position proves a fill before signal status catches up, with symbol and time isolation', () => {
  assert.equal(confirmedPullbackFill(signal, 2000, [position]), true);
  assert.equal(confirmedPullbackFill(signal, 1850, [position]), false);
  assert.equal(confirmedPullbackFill(signal, 2000, [{ ...position, symbol: 'OTHER' }]), false);
  assert.equal(confirmedPullbackFill(signal, 2000, [{ ...position, ticket: 101, setupId: 'other' }]), false);
});

test('broker-confirmed filled lifecycles remain ticked but future fills do not', () => {
  for (const status of ['ACTIVE', 'RISK_FREE', 'TP', 'SL', 'RF'] as const) {
    assert.equal(confirmedPullbackFill({ ...signal, status, openedAt: 1900 }, 2000), true);
    assert.equal(confirmedPullbackFill({ ...signal, status, openedAt: 2100 }, 2000), false);
  }
});

test('live and replay evidence are isolated and each entry is scoped to its fixed-exit setup', () => {
  assert.deepEqual([...filledPullbackLegs(base, { asOf: 2000, replay: true, records: [record] })], [10]);
  assert.equal(filledPullbackLegs(base, { asOf: 1850, replay: true, records: [record] }).size, 0);
  assert.equal(filledPullbackLegs(base, { asOf: 2000, replay: false, records: [record] }).size, 0);
  assert.equal(filledPullbackLegs(base, { asOf: 2000, replay: true,
    records: [{ ...record, mt5Managed: true, brokerTicket: 100 }], signals: [{ ...signal, status: 'ACTIVE' }] }).size, 0);
  assert.equal(filledPullbackLegs(base, { asOf: 2000, replay: true,
    records: [{ ...record, intradayEntry: { ...record.intradayEntry!, referenceEntry: 3020 } }] }).size, 0);
  assert.equal(filledPullbackLegs(base, { asOf: 2000, replay: true, records: [{ ...record, zoneTimeframe: 'H1' }] }).size, 0);
});

test('Scalp replay rows include simulated filled legs, exclude broker/future fills and preserve future exit timing', () => {
  const scalp = { ...record, tradeStyle: 'SCALP_1_1' as const, intradayEntry: undefined,
    scalpEntry: signal.intradayEntry, result: 'tp' as const, completedAt: 3000 };
  assert.equal(scalpReplayTableSignals([scalp], 1850).length, 0);
  assert.equal(scalpReplayTableSignals([{ ...scalp, brokerTicket: 100 }], 4000).length, 0);
  const [open] = scalpReplayTableSignals([scalp], 2000);
  assert.equal(open.status, 'ACTIVE'); assert.equal(open.simulatedFill, true);
  assert.equal(confirmedPullbackFill(open, 2000), false, 'simulation must not become a broker fill');
  assert.equal(scalpReplayTableSignals([scalp], 4000)[0].status, 'TP');
});

test('NO FILL outcomes expire at the fifth completed M15 candle, ignoring unfinished bars and duplicates', () => {
  const outcome = { level: 'tp' as const, at: 1800, label: 'TP REACHED · NO FILL', noFill: true };
  const candles = [1800, 2700, 3600, 4500, 5400, 6300].map(time =>
    ({ time, open: 3000, high: 3010, low: 2995, close: 3005, complete: true }));
  assert.equal(scalpOutcomeExpired(outcome, candles, 'M15', 7199), false);
  assert.equal(scalpOutcomeExpired(outcome, candles, 'M15', 7200), true);
  assert.equal(scalpOutcomeExpired(outcome, candles.map(c => c.time === 6300 ? { ...c, complete: false } : c), 'M15', 7200), false);
  assert.equal(scalpOutcomeExpired(outcome, [candles[1], candles[1], candles[1], candles[1], candles[1]], 'M15', 7200), false);
});
