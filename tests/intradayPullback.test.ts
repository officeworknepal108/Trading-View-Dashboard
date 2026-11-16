import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntradayPullbackSignals, intradayPullbackSignalError,
  intradayPullbackChartRecords, sameIntradayPullbackSetup, intradayReferenceRule } from '../src/services/intradayPullback';
import { applySignalOppositePositionTarget, priorGoldMt5ZoneExecution, mt5SignalDisabledReason,
  type Mt5SignalInput, type Mt5SignalStatus } from '../src/services/mt5Automation';
import type { StructureCandle } from '../src/services/marketStructure';
import { calculateJournalPerformance, type JournalTradeRecord } from '../src/components/TradeJournal';
import { buildCanonicalTradeRecords } from '../src/services/tradeRecordFilters';
import { deduplicateTradeRecords } from '../src/services/tradeRecordDeduplication';
import { isGoldTradeRecordRoute } from '../src/services/goldScalping';

const base: Mt5SignalInput = { id: 'ENGULFING:M15:900:BUY:3010', setupId: 'DIRECT:M15:zone-one', zoneId: 'zone-one',
  symbol: 'XAUUSD', direction: 'BUY', orderType: 'MARKET', source: 'ENGULFING', tradeStyle: 'INTRADAY',
  zoneName: 'TJL1', zoneTimeframe: 'M15', signalTimeframe: 'M15', engulfingType: 'T1',
  signalAt: 900, calculatedAt: 1800, entry: 3010, stopLoss: 2990, takeProfit: 3050,
  riskFree: 3030, rewardRisk: 2, riskPips: 200, expiresAt: 9999 };
const candles: StructureCandle[] = [
  { time: 900, open: 3000, high: 3011, low: 2992, close: 3010, complete: true },
  { time: 1800, open: 3010, high: 3012, low: 3007, close: 3011, complete: true },
  { time: 2700, open: 3011, high: 3051, low: 3009, close: 3050, complete: true },
];
const reference: JournalTradeRecord = { id: 'DIRECT:zone-one:900:3010', zoneId: 'zone-one',
  symbol: 'XAUUSD', zoneName: 'TJL1', zoneTimeframe: 'M15', source: 'ENGULFING', tradeStyle: 'INTRADAY',
  signalAt: 900, signalTimeframe: 'M15', engulfingType: 'T1', engulfingCandleCount: 2,
  direction: 'bullish', entry: 3010, stopLoss: 2990, takeProfit: 3050, riskPips: 200, rewardRisk: 2,
  openedAt: 1800, completedAt: 2700, result: 'tp' };

test('Intraday admits a later in-window fill and cancels untouched entries at the 75-minute deadline', () => {
  const quiet = [1800, 2700, 3600, 4500, 5400].map(time => ({ time, open: 3010, high: 3012, low: 3009.5, close: 3010, complete: true }));
  const within = [candles[0], ...quiet.map(c => c.time === 5400 ? { ...c, low: 3007 } : c),
    { time: 6300, open: 3010, high: 3051, low: 3009.5, close: 3050, complete: true }];
  const rows = intradayPullbackChartRecords(reference, within, within, 7200);
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.openedAt === 5400 && r.result === 'tp'));
  const late = [candles[0], ...quiet, { time: 6300, open: 3010, high: 3012, low: 3007, close: 3010, complete: true }];
  assert.deepEqual(intradayPullbackChartRecords(reference, late, late, 7200), []);
});

test('Intraday limits preserve original 1:2 exits and split the existing risk 60/40', () => {
  const snapshot = JSON.stringify(base), entries = buildIntradayPullbackSignals(base, candles);
  assert.deepEqual(entries.map(s => s.entry), [3009, 3007.5]);
  assert.deepEqual(entries.map(s => s.intradayEntry?.riskShare), [0.6, 0.4]);
  assert.equal(new Set(entries.map(s => s.id)).size, 2);
  assert.equal(new Set(entries.map(s => s.setupId)).size, 2);
  assert.ok(sameIntradayPullbackSetup(entries[0], entries[1]));
  for (const signal of entries) {
    assert.equal(signal.orderType, 'LIMIT');
    assert.equal(signal.stopLoss, 2990); assert.equal(signal.takeProfit, 3050);
    assert.equal(signal.expiresAt, 6300);
    assert.equal(signal.zoneId, base.zoneId, 'the original zone remains consumed across routes');
    assert.equal(intradayPullbackSignalError(signal), undefined);
    assert.deepEqual(applySignalOppositePositionTarget(signal, [{ direction: 'SELL' }]), signal);
  }
  assert.equal(JSON.stringify(base), snapshot);
});

test('all Intraday routes retain reference ratios and use the same 75-minute expiry', () => {
  const routes = [ ['ENGULFING', 'M15', 'M15', 2, 20, 900], ['ENGULFING', 'M15', 'M30', 1, 30, 1800],
    ['ENGULFING', 'H1', 'M15', 2, 20, 900], ['ENGULFING', 'H1', 'M30', 2, 30, 1800],
    ['MTF', 'H1', 'M5', 3, 8, 300], ['MTF', 'H4', 'M15', 5, 20, 900] ] as const;
  for (const [source, zoneTimeframe, signalTimeframe, rr, distance, seconds] of routes) {
    const original = { ...base, source, zoneTimeframe, signalTimeframe, signalAt: 3600,
      calculatedAt: 3600 + seconds, stopLoss: 3010 - distance, takeProfit: 3010 + distance * rr,
      riskPips: distance * 10, rewardRisk: rr };
    const sourceCandles = candles.slice(0, 2).map((c, i) => ({ ...c, time: 3600 + i * seconds,
      ...(i === 0 ? { open: 3008, close: 3010 } : {}) }));
    const entries = buildIntradayPullbackSignals(original, sourceCandles);
    assert.equal(entries.length, 2, `${source} ${zoneTimeframe}/${signalTimeframe}`);
    assert.equal(intradayReferenceRule(original)?.rewardRisk, rr);
    for (const s of entries) {
      assert.equal(s.takeProfit, original.takeProfit);
      assert.equal(s.expiresAt, 3600 + seconds + 4500);
      assert.equal(intradayPullbackSignalError(s), undefined);
    }
  }
});

test('SELL entries mirror BUY and pullbacks never clamp to the original reference entry', () => {
  const sell = { ...base, direction: 'SELL' as const, stopLoss: 3030, takeProfit: 2970 };
  const source = candles.map(c => ({ ...c, open: 6020 - c.open, high: 6020 - c.low,
    low: 6020 - c.high, close: 6020 - c.close }));
  const entries = buildIntradayPullbackSignals(sell, source);
  assert.deepEqual(entries.map(s => s.entry), [3011, 3012.5]);
  assert.ok(entries.every(s => !intradayPullbackSignalError(s)));
  const capped = { ...base, entry: 3005, stopLoss: 2990, takeProfit: 3035 };
  const capEntries = buildIntradayPullbackSignals(capped, candles);
  assert.deepEqual(capEntries.map(s => s.entry), [3009, 3007.5]);
  assert.ok(capEntries.every(s => s.intradayEntry?.version === 3));
  assert.equal(new Set(capEntries.map(s => s.id)).size, 2);
});

test('forming/missing confirmation cannot create entries, and other strategies pass through', () => {
  assert.deepEqual(buildIntradayPullbackSignals(base, []), []);
  assert.deepEqual(buildIntradayPullbackSignals(base, [{ ...candles[0], complete: false }, candles[1]]), []);
  const scalping = { ...base, tradeStyle: 'SCALPING' as const };
  assert.deepEqual(buildIntradayPullbackSignals(scalping, []), [scalping]);
  const scalp11 = { ...base, tradeStyle: 'SCALP_1_1' as const };
  assert.deepEqual(buildIntradayPullbackSignals(scalp11, []), [scalp11]);
});

test('rejects modified allocation, target, duration, risk cap and unsupported route', () => {
  const signal = buildIntradayPullbackSignals(base, candles)[0];
  for (const changed of [ { ...signal, intradayEntry: { ...signal.intradayEntry!, riskShare: 1 } },
    { ...signal, takeProfit: 3040 }, { ...signal, expiresAt: 9999 }, { ...signal, entry: 3010 },
    { ...signal, source: 'MTF' as const }, { ...signal, riskPips: 999 },
    { ...signal, orderType: 'MARKET' as const }, { ...signal, rewardRisk: 2 } ]) {
    assert.match(intradayPullbackSignalError(changed)!, /Invalid Intraday/);
  }
  assert.equal(mt5SignalDisabledReason({ enabledTimeframes: ['M15'], intradayEnabled: true, scalpingEnabled: true }, signal), undefined);
  assert.match(mt5SignalDisabledReason({ enabledTimeframes: ['M15'], intradayEnabled: false, scalpingEnabled: true }, signal)!, /Intraday/);
});

test('zone single-use permits the planned sibling, never a later setup or another strategy', () => {
  const [first, second] = buildIntradayPullbackSignals(base, candles);
  const statuses = new Set<Mt5SignalStatus>(['QUEUED', 'ACTIVE', 'TP', 'SL']);
  assert.equal(priorGoldMt5ZoneExecution(second, [{ ...first, status: 'ACTIVE' }], statuses), undefined);
  assert.ok(priorGoldMt5ZoneExecution(first, [{ ...first, status: 'ACTIVE' }], statuses));
  assert.ok(priorGoldMt5ZoneExecution(second, [{ ...first, status: 'TP' }], statuses));
  assert.ok(priorGoldMt5ZoneExecution({ ...second, intradayEntry: { ...second.intradayEntry!, setupKey: 'later' } }, [{ ...first, status: 'ACTIVE' }], statuses));
  assert.ok(priorGoldMt5ZoneExecution({ ...base, tradeStyle: 'SCALPING' }, [{ ...first, status: 'ACTIVE' }], statuses));
});

test('two filled winners share fixed exits and contribute setup-weighted dollar/R results', () => {
  const rows = intradayPullbackChartRecords(reference, candles, candles, 3600);
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.result === 'tp'));
  const expected = 0.6 * 41 / 19 + 0.4 * 42.5 / 17.5;
  assert.ok(Math.abs(calculateJournalPerformance(rows).totalR - expected) < 1e-8);
  assert.ok(rows.every(r => isGoldTradeRecordRoute(r)));
  const options = { marketSymbol: 'XAUUSD', pipSize: 0.1, requireLtfFib: false,
    timeframeData: {}, qualifyMtf: () => undefined };
  assert.equal(buildCanonicalTradeRecords([], rows, options).length, 2);
  assert.equal(buildCanonicalTradeRecords(rows, [], options).length, 0);
});

test('original TP before any fill prevents later pullback entries; ambiguous fill ordering is excluded', () => {
  const noFill = [candles[0], { ...candles[1], high: 3051, low: 3010, close: 3050 },
    { ...candles[2], low: 3000 }];
  assert.deepEqual(intradayPullbackChartRecords(reference, noFill, noFill, 3600), []);
  const ambiguous = [candles[0], { ...candles[1], high: 3051, low: 3007, close: 3040 }, candles[2]];
  assert.deepEqual(intradayPullbackChartRecords(reference, ambiguous, ambiguous, 3600), []);
  const missing = [candles[0], candles[2]];
  assert.deepEqual(intradayPullbackChartRecords(reference, candles, missing, 3600), []);
});

test('M30 replay tracks each M15 fill and excludes a sibling with ambiguous fill-before-TP ordering', () => {
  const original = { ...reference, signalAt: 1800, signalTimeframe: 'M30' as const,
    takeProfit: 3030, rewardRisk: 1, openedAt: 3600, completedAt: 5400 };
  const source = [{ ...candles[0], time: 1800 }, { ...candles[1], time: 3600 }];
  const execution = [{ ...candles[1], time: 3600, low: 3008.5 },
    { ...candles[1], time: 4500 }, { ...candles[2], time: 5400, high: 3031, low: 3008 }];
  const rows = intradayPullbackChartRecords(original, source, execution, 6300);
  assert.deepEqual(rows.map(r => r.openedAt), [3600, 4500]);
  assert.ok(rows.every(r => r.result === 'tp' && r.completedAt === 5400));
  const lateDip = execution.map(c => c.time === 4500 ? { ...c, low: 3008.5 } : c.time === 5400 ? { ...c, low: 3007 } : c);
  const expired = intradayPullbackChartRecords(original, source, lateDip, 6300);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].intradayEntry?.leg, 10);
});

test('same-price legs stay distinct and broker replacements suppress only the matching leg', () => {
  const rows = intradayPullbackChartRecords(reference, candles, candles, 3600).map(r => ({ ...r, entry: 3005 }));
  assert.equal(deduplicateTradeRecords(rows).length, 2);
  const broker = { ...rows[0], id: 'MT5:first', brokerTicket: 55, mt5Managed: true };
  assert.equal(deduplicateTradeRecords([...rows, broker]).length, 2);
  assert.equal(deduplicateTradeRecords([...rows, { ...broker, intradayEntry: undefined }]).length, 1,
    'a legacy real single execution replaces both hypothetical layered entries');
});
