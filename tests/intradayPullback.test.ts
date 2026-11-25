import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntradayPullbackSignals, intradayPullbackSignalError,
  intradayPullbackChartRecords, sameIntradayPullbackSetup, intradayReferenceRule } from '../src/services/intradayPullback';
import { applySignalOppositePositionTarget, priorGoldMt5ZoneExecution, mt5SignalDisabledReason,
  type Mt5SignalInput, type Mt5SignalStatus } from '../src/services/mt5Automation';
import type { StructureCandle } from '../src/services/marketStructure';
import type { ZoneEntryQualification } from '../src/services/tradeLevels';
import { calculateJournalPerformance, type JournalTradeRecord } from '../src/components/TradeJournal';
import { buildCanonicalTradeRecords, DEFAULT_TRADE_RECORD_FILTERS, filterAccuracyTradeRecords,
  selectTradeChartRecords, selectTwoMonthAccuracyRecords, selectTwoMonthJournalRecords,
  type TradeRecordVerification } from '../src/services/tradeRecordFilters';
import { deduplicateTradeRecords, mergeTradeRecordAnnotations } from '../src/services/tradeRecordDeduplication';
import { isGoldTradeRecordRoute } from '../src/services/goldScalping';
import { buildChartEntryHistory } from '../src/services/chartEntryData';

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
const entryQualification: ZoneEntryQualification = { version: 1, zoneTimeframe: 'M15',
  signal: { type: 'T1', direction: 'bullish', time: 900, candleCount: 2, timeframe: 'M15' },
  zone: { id: 'zone-one', name: 'TJL1', category: 'mg', isBuy: true,
    startTime: 0, endTime: 9000, bottom: 2990, top: 3000, active: true, status: 'valid',
    fibStatus: 'a-plus', fibBand: '0.71-0.79', fibSourcePrice: 2990, fibZeroPrice: 3020,
    engulfingType: 'T1', engulfingDirection: 'bullish', engulfingTime: 900, engulfingCandleCount: 2 } };
const reference: JournalTradeRecord = { id: 'DIRECT:zone-one:900:3010', zoneId: 'zone-one', entryQualification,
  symbol: 'XAUUSD', zoneName: 'TJL1', zoneTimeframe: 'M15', source: 'ENGULFING', tradeStyle: 'INTRADAY',
  signalAt: 900, signalTimeframe: 'M15', engulfingType: 'T1', engulfingCandleCount: 2,
  direction: 'bullish', entry: 3010, stopLoss: 2990, takeProfit: 3050, riskPips: 200, rewardRisk: 2,
  openedAt: 1800, completedAt: 2700, result: 'tp' };

test('TJL1 pullbacks require the same Fib evidence in saved/current history, arrows, accuracy and journal', () => {
  const rows = intradayPullbackChartRecords(reference, candles, candles, 3600);
  const unverified: JournalTradeRecord[] = rows.map(row => ({ ...row, entryQualification: undefined,
    fibSource: 'ZONE FIB', fibBand: '0.71-0.79' }));
  const noFib = { ...entryQualification.zone, fibStatus: 'not-valid' as const, fibBand: undefined };
  const options: TradeRecordVerification = { marketSymbol: 'XAUUSD', pipSize: 0.1,
    requireLtfFib: false, qualifyMtf: () => undefined,
    timeframeData: { M15: { candles, structure: { zones: [noFib] } } } };
  for (const [saved, current] of [[unverified, []], [[], unverified], [unverified, unverified]]) {
    const canonical = buildCanonicalTradeRecords(saved, current, options);
    assert.deepEqual(canonical, [], 'neither an old fill nor a bare Fib badge proves qualification');
    assert.deepEqual(buildChartEntryHistory(saved, current, options), []);
    assert.deepEqual(selectTradeChartRecords(canonical, 'M15', candles), []);
    assert.deepEqual(selectTwoMonthAccuracyRecords(canonical, 3600), []);
    const journal = mergeTradeRecordAnnotations(canonical, rows);
    assert.deepEqual(journal, [], 'saved annotations cannot restore rejected trades');
    assert.equal(calculateJournalPerformance(journal).completed, 0);
    assert.equal(calculateJournalPerformance(journal).totalR, 0);
  }
  assert.deepEqual(buildCanonicalTradeRecords(unverified, [], { ...options, timeframeData: {} }), [],
    'missing feeds cannot promote an unverified entry');
  const recovered = buildCanonicalTradeRecords(unverified, [], { ...options,
    timeframeData: { M15: { candles, structure: { zones: [entryQualification.zone] } } } });
  assert.equal(recovered.length, 2, 'matching loaded qualification can recover a legacy entry');
  assert.ok(recovered.every(row => row.entryQualification?.signal.time === row.signalAt));
  assert.equal(buildCanonicalTradeRecords(recovered, [], { ...options, timeframeData: {} }).length, 2,
    'recovered entry evidence survives refresh');
  assert.equal(buildCanonicalTradeRecords(rows, [], options).length, 2,
    'later Fib changes cannot erase a qualified entry-time snapshot');
  const badProof = rows.map(row => ({ ...row, entryQualification: { ...entryQualification,
    zone: noFib } }));
  assert.deepEqual(buildCanonicalTradeRecords(badProof, [], options), []);
  const wrongSignal = rows.map(row => ({ ...row, entryQualification: { ...entryQualification,
    signal: { ...entryQualification.signal, time: 0 } } }));
  assert.deepEqual(buildCanonicalTradeRecords(wrongSignal, [], options), []);
  const broker = { ...unverified[0], id: 'MT5:actual-fill', brokerTicket: 77, mt5Managed: true };
  assert.deepEqual(buildCanonicalTradeRecords([broker], [], options), [broker],
    'actual broker executions remain recorded even when their setup was unqualified');
});

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
  assert.equal(buildCanonicalTradeRecords(rows, [], options).length, 2,
    'saved completed entries survive a refresh before candle feeds load');
});

test('saved Intraday legs survive missing and shifted feeds in monthly totals, journal and arrows', () => {
  const rows = intradayPullbackChartRecords(reference, candles, candles, 3600);
  const snapshot = JSON.stringify(rows);
  const options: TradeRecordVerification = { marketSymbol: 'XAUUSD', pipSize: 0.1,
    requireLtfFib: false, timeframeData: {}, qualifyMtf: () => undefined };
  for (const version of [1, 2, 3] as const) {
    const saved = rows.map(row => ({ ...row, intradayEntry: { ...row.intradayEntry!, version } }));
    for (const loaded of [undefined, candles.map(c => ({ ...c, time: c.time + 10000 })), candles.slice(0, 2)]) {
      const canonical = buildCanonicalTradeRecords(saved, [], { ...options,
        timeframeData: loaded ? { M15: { candles: loaded, structure: { zones: [] } } } : {} });
      assert.deepEqual(canonical, saved);
      const monthly = filterAccuracyTradeRecords(selectTwoMonthAccuracyRecords(canonical, 3600), {
        ...DEFAULT_TRADE_RECORD_FILTERS, datePeriod: 'MONTH', date: '1970-01-01', tradeStyle: ['INTRADAY'],
      }, 'UTC', 'XAUUSD');
      const journal = selectTwoMonthJournalRecords(mergeTradeRecordAnnotations(canonical, saved), 3600);
      assert.deepEqual(new Set(monthly.map(r => r.id)), new Set(journal.map(r => r.id)));
      assert.equal(monthly.length, 2);
      assert.equal(filterAccuracyTradeRecords(monthly, { ...DEFAULT_TRADE_RECORD_FILTERS,
        timeframes: ['H1'] }, 'UTC', 'XAUUSD').length, 2, 'H1 totals include the Intraday arrows projected onto H1');
      assert.equal(selectTradeChartRecords(canonical, 'M15', candles).length, 2);
      assert.equal(selectTradeChartRecords(canonical, 'M15', candles.map(c => ({ ...c, time: c.time + 10000 }))).length, 0);
      assert.equal(calculateJournalPerformance(journal).totalR, calculateJournalPerformance(rows).totalR);
    }
  }
  assert.equal(JSON.stringify(rows), snapshot, 'display reconciliation never rewrites stored history');
});

test('saved history validates actual fills and outcomes without requiring a regenerated zone', () => {
  const rows = intradayPullbackChartRecords(reference, candles, candles, 3600);
  const options: TradeRecordVerification = { marketSymbol: 'XAUUSD', pipSize: 0.1,
    requireLtfFib: false, timeframeData: {}, qualifyMtf: () => undefined };
  for (const row of [
    { ...rows[0], intradayEntry: { ...rows[0].intradayEntry!, riskShare: 1 } },
    { ...rows[0], entry: 3010 }, { ...rows[0], riskPips: 1 },
    { ...rows[0], openedAt: 900 }, { ...rows[0], result: 'rf' as const },
    { ...rows[0], result: 'open' as const },
  ]) assert.deepEqual(buildCanonicalTradeRecords([row], [], options), []);
  const fullOptions = { ...options, timeframeData: { M15: { candles, structure: { zones: [] } } } };
  assert.deepEqual(buildCanonicalTradeRecords(rows, [], fullOptions), rows,
    'full replay proves saved entries even though the original zone is absent');
  for (const version of [1, 2, 3] as const) {
    const saved = rows.map(row => ({ ...row, intradayEntry: { ...row.intradayEntry!, version } }));
    assert.deepEqual(buildCanonicalTradeRecords(saved, [], fullOptions), saved);
  }
  for (const row of [{ ...rows[0], result: 'sl' as const },
    { ...rows[0], openedAt: 2700 }, { ...rows[0], completedAt: 1800 }]) {
    assert.deepEqual(buildCanonicalTradeRecords([row], [], fullOptions), [], 'reject disproven fill/result timing');
  }
  for (const changed of [
    candles.map(c => c.time === 1800 ? { ...c, high: 3051 } : c),
    candles.map(c => c.time === 1800 ? { ...c, low: 2980 } : c),
    candles.map(c => c.time === 1800 ? { ...c, low: 3010 } : c),
    candles.map(c => c.time === 900 ? { ...c, close: 3010.1 } : c),
  ]) {
    assert.deepEqual(buildCanonicalTradeRecords(rows, [], { ...options,
      timeframeData: { M15: { candles: changed, structure: { zones: [] } } } }), [],
      'reject ambiguous, stopped-first, unfilled or changed confirmations');
  }
  const corrected = { ...rows[0], result: 'sl' as const };
  const canonical = buildCanonicalTradeRecords(rows, [corrected], options);
  assert.equal(canonical.length, 2);
  assert.equal(canonical.find(r => r.id === corrected.id)?.result, 'sl');
  const broker = { ...rows[0], id: 'MT5:history-first-leg', brokerTicket: 55, mt5Managed: true };
  assert.deepEqual(new Set(buildCanonicalTradeRecords([...rows, broker], [], options).map(r => r.id)),
    new Set([broker.id, rows[1].id]), 'broker execution replaces only its matching leg');
});

test('saved legacy Intraday versions retain their shorter expiry when candle history is loaded', () => {
  const quiet = [1800, 2700, 3600, 4500, 5400].map(time => ({ time,
    open: 3010, high: 3012, low: 3009.5, close: 3010, complete: true }));
  const late = [candles[0], ...quiet.map(c => c.time === 5400 ? { ...c, low: 3007 } : c),
    { time: 6300, open: 3010, high: 3051, low: 3009.5, close: 3050, complete: true }];
  const rows = intradayPullbackChartRecords(reference, late, late, 7200);
  const options: TradeRecordVerification = { marketSymbol: 'XAUUSD', pipSize: 0.1,
    requireLtfFib: false, qualifyMtf: () => undefined,
    timeframeData: { M15: { candles: late, structure: { zones: [] } } } };
  assert.equal(buildCanonicalTradeRecords(rows, [], options).length, 2);
  for (const version of [1, 2] as const) {
    const saved = rows.map(row => ({ ...row, intradayEntry: { ...row.intradayEntry!, version } }));
    assert.deepEqual(buildCanonicalTradeRecords(saved, [], options), [], 'a newer deadline cannot validate a legacy fill');
  }
});

test('an old SELL without matching Fib evidence is withheld from arrows, accuracy and journal', () => {
  const history: StructureCandle[] = [
    [1794796200, 3885.425, 3887.765, 3877.525, 3878.935],
    [1794797100, 3879.05, 3880.02, 3871.86, 3874.67],
    [1794798000, 3874.62, 3875.675, 3867.68, 3871.38],
    [1794798900, 3871.33, 3873.125, 3866.185, 3870.675],
    [1794799800, 3870.61, 3873.065, 3862.775, 3872.355],
    [1794800700, 3872.345, 3875.345, 3870.205, 3874.33],
    [1794801600, 3874.28, 3877.45, 3869.765, 3872.93],
    [1794802500, 3872.92, 3874.92, 3868.67, 3873.88],
    [1794803400, 3873.875, 3874.615, 3871.37, 3872.675],
    [1794804300, 3872.68, 3874.16, 3866.645, 3867.78],
    [1794805200, 3867.73, 3870.64, 3863.72, 3868.375],
    [1794806100, 3868.42, 3878.635, 3868.325, 3873.32],
    [1794807000, 3873.37, 3873.73, 3862.3, 3867.03],
    [1794807900, 3867.015, 3867.175, 3832.46, 3837.215],
  ].map(([time, open, high, low, close]) => ({ time, open, high, low, close, complete: true }));
  const saved: JournalTradeRecord = { ...reference,
    id: 'DIRECT:Internal TJL1-1794569400-3886.58:1794796200:3879.05:INTRA:P10',
    zoneId: undefined, entryQualification: undefined, zoneName: 'Internal QML A+', direction: 'bearish',
    signalAt: 1794796200, openedAt: 1794797100, completedAt: 1794807900,
    entry: 3879.699, stopLoss: 3889.765, takeProfit: 3857.620000000001,
    rewardRisk: 2.193423405523515, riskPips: 100.65999999999804,
    outsideTradingTime: true, volumeLogicStatus: 'failed',
    intradayEntry: { version: 3, leg: 10, riskShare: 0.6, referenceEntry: 3879.05,
      nextOpen: 3879.05, confirmationBody: 6.4900000000002365,
      setupKey: 'DIRECT:M15:DIRECT:Internal TJL1-1794569400-3886.58:1794796200:3879.05:M15:1794796200:SELL' } };
  const before = JSON.stringify(saved);
  const canonical = buildCanonicalTradeRecords([saved], [], { marketSymbol: 'XAUUSD', pipSize: 0.1,
    requireLtfFib: false, qualifyMtf: () => undefined,
    timeframeData: { M15: { candles: history, structure: { zones: [] } } } });
  assert.deepEqual(canonical, []);
  const asOf = Date.parse('2026-11-18T12:00:00Z') / 1000;
  const filters = { ...DEFAULT_TRADE_RECORD_FILTERS, datePeriod: 'MONTH' as const,
    date: '2026-11-01', tradeStyle: ['INTRADAY'] as ['INTRADAY'] };
  for (const timeframe of ['M15', 'H1'] as const) {
    const accuracy = filterAccuracyTradeRecords(selectTwoMonthAccuracyRecords(canonical, asOf),
      { ...filters, timeframes: [timeframe] }, 'Asia/Kathmandu', 'XAUUSD');
    const journal = filterAccuracyTradeRecords(selectTwoMonthJournalRecords(
      mergeTradeRecordAnnotations(canonical, [saved]), asOf), { ...filters, timeframes: [timeframe] },
      'Asia/Kathmandu', 'XAUUSD');
    assert.deepEqual(accuracy, []);
    assert.deepEqual(journal, accuracy);
    assert.equal(calculateJournalPerformance(journal).completed, 0);
  }
  assert.deepEqual(selectTradeChartRecords(canonical, 'M15', history), []);
  assert.equal(JSON.stringify(saved), before, 'the saved trade is not rewritten');
});

test('filled active Intraday legs appear in the journal and arrows without counting as completed outcomes', () => {
  const rows = intradayPullbackChartRecords(reference, candles, candles, 2700);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.result === 'open'));
  const options: TradeRecordVerification = { marketSymbol: 'XAUUSD', pipSize: 0.1,
    requireLtfFib: false, timeframeData: {}, qualifyMtf: () => undefined };
  const canonical = buildCanonicalTradeRecords(rows, rows, options);
  assert.equal(canonical.length, 2);
  assert.equal(selectTwoMonthJournalRecords(canonical, 2700).length, 2);
  assert.equal(selectTradeChartRecords(canonical, 'M15', candles, false, { includeActive: true }).length, 2);
  assert.equal(selectTwoMonthAccuracyRecords(canonical, 2700).length, 0);
  assert.equal(calculateJournalPerformance(canonical).completed, 0);
  assert.deepEqual(buildCanonicalTradeRecords(rows, [], options), [], 'stale open simulations require current fill evidence');
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
    entryQualification: { ...entryQualification,
      signal: { ...entryQualification.signal, time: 1800, timeframe: 'M30' as const },
      zone: { ...entryQualification.zone, fallbackEngulfingType: 'T1' as const,
        fallbackEngulfingDirection: 'bullish' as const, fallbackEngulfingTime: 1800,
        fallbackEngulfingTimeframe: 'M30', fallbackEngulfingCandleCount: 2 } },
    takeProfit: 3030, rewardRisk: 1, openedAt: 3600, completedAt: 5400 };
  const source = [{ ...candles[0], time: 1800 }, { ...candles[1], time: 3600 }];
  const execution = [{ ...candles[1], time: 3600, low: 3008.5 },
    { ...candles[1], time: 4500 }, { ...candles[2], time: 5400, high: 3031, low: 3008 }];
  const rows = intradayPullbackChartRecords(original, source, execution, 6300);
  assert.deepEqual(rows.map(r => r.openedAt), [3600, 4500]);
  assert.ok(rows.every(r => r.result === 'tp' && r.completedAt === 5400));
  assert.deepEqual(buildCanonicalTradeRecords(rows, [], { marketSymbol: 'XAUUSD', pipSize: 0.1,
    requireLtfFib: false, qualifyMtf: () => undefined, timeframeData: {
      M30: { candles: source, structure: { zones: [] } },
      M15: { candles: execution, structure: { zones: [] } },
    } }), rows, 'saved M30 legs keep their separate M15 fill times without their zone');
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
