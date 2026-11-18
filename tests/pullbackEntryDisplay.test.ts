import test from 'node:test';
import assert from 'node:assert/strict';
import { chartExecutionStatus, chartPullbackState, confirmedPullbackFill, currentPullbackDisplay, filledPullbackLegs, groupPullbackTableSignals, pullbackPlanStatus, scalpReplayTableSignals } from '../src/services/pullbackEntryDisplay';
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

test('replay labels use simulated outcomes without suggesting a broker execution', () => {
  for (const [chart, expected] of [
    [{ status: 'waiting' }, 'REPLAY: Waiting'],
    [{ status: 'filled', filledAt: 1800 }, 'REPLAY: Filled'],
    [{ status: 'filled', outcome: { level: 'tp', at: 2700 } }, 'REPLAY: TP HIT'],
    [{ status: 'filled', outcome: { level: 'sl', at: 2700 } }, 'REPLAY: SL HIT'],
    [{ status: 'filled', outcome: { level: 'both', at: 2700 } }, 'REPLAY: SL/TP HIT'],
  ] as const) {
    assert.equal(chartExecutionStatus(chart, false, undefined, true), expected);
    assert.match(chartExecutionStatus(chart, false), /MT5: Not executed$/);
  }
});

test('a 75-minute deadline inside an M30 bar cannot prove a post-deadline dip filled in time', () => {
  const s = { ...signal, signalTimeframe: 'M30' as const, signalAt: 1800, calculatedAt: 3600,
    expiresAt: 8100, intradayEntry: { ...signal.intradayEntry!, version: 3 as const } };
  const bars = [3600, 5400, 7200].map(time => ({ time, open: 3010, high: 3012,
    low: time === 7200 ? 3008 : 3009.5, close: 3010, complete: true }));
  assert.equal(chartPullbackState(s, bars, 9000).status, 'ambiguous');
  assert.equal(chartPullbackState(s, bars.slice(0, 2), 7200).status, 'waiting');
});

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

test('grouping keeps equal-price legs together and sorts the first entry before the second', () => {
  const second = { ...signal, id: 'entry25', setupId: 'setup:P25',
    intradayEntry: { ...signal.intradayEntry!, leg: 25 as const, riskShare: 0.4 } };
  const groups = groupPullbackTableSignals([second, signal]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].entries.map(s => s.intradayEntry?.leg), [10, 25]);
  assert.equal(groups[0].entries[0].entry, groups[0].entries[1].entry);
});

test('grouping isolates different setup identities, accounts, strategies and exit levels', () => {
  for (const other of [
    { ...signal, account: 'other' },
    { ...signal, intradayEntry: { ...signal.intradayEntry!, setupKey: 'other-setup' } },
    { ...signal, stopLoss: 2980 }, { ...signal, takeProfit: 3060 },
    { ...signal, tradeStyle: 'SCALP_1_1' as const, intradayEntry: undefined, scalpEntry: signal.intradayEntry },
  ]) assert.equal(groupPullbackTableSignals([signal, other]).length, 2);
});

test('real broker leg wins over preview duplicates while a preview sibling joins its selected account', () => {
  const actual = { ...signal, account: 'account-one', server: 'server-one' };
  const preview = { ...signal, preview: true, updatedAt: 3000 };
  const second = { ...preview, id: 'entry25', setupId: 'setup:P25',
    intradayEntry: { ...signal.intradayEntry!, leg: 25 as const, riskShare: 0.4 } };
  const [group] = groupPullbackTableSignals([preview, second, actual], { account: 'account-one', server: 'server-one', brokerSymbol: 'GOLD' });
  assert.equal(group.entries.length, 2); assert.equal(group.entries[0], actual);
});

test('legacy unfilled setup displays the current exact plan without rewriting its saved rejection', () => {
  const saved = { ...signal, tradeStyle: 'SCALP_1_1' as const, status: 'REJECTED' as const, direction: 'SELL' as const,
    entry: 3847.790, stopLoss: 3867.790, takeProfit: 3827.790, intradayEntry: undefined,
    scalpEntry: { ...signal.intradayEntry!, referenceEntry: 3847.790, nextOpen: 3842.020, confirmationBody: 9.175 } };
  const snapshot = JSON.stringify(saved);
  const projected = currentPullbackDisplay(saved, 3600);
  assert.ok(Math.abs(projected.entry - 3842.9375) < 1e-7);
  assert.ok(Math.abs(projected.riskPips - 248.525) < 1e-7);
  assert.equal(projected.stopLoss, saved.stopLoss); assert.equal(projected.takeProfit, saved.takeProfit);
  assert.equal(projected.scalpEntry?.version, 2); assert.equal(projected.status, 'REJECTED');
  assert.equal(projected.displayPlan?.previousEntry, saved.entry);
  assert.equal(projected.displayPlan?.error, undefined);
  assert.match(pullbackPlanStatus(projected)!, /ENTRY WINDOW EXPIRED/);
  assert.equal(confirmedPullbackFill(projected, 3600), false);
  assert.equal(JSON.stringify(saved), snapshot);
  for (const status of ['PLACED', 'QUEUED', 'CLAIMED', 'ACTIVE', 'RISK_FREE', 'TP', 'SL', 'RF'] as const)
    assert.equal(currentPullbackDisplay({ ...saved, status }, 3600).entry, saved.entry, status);
  assert.equal(currentPullbackDisplay({ ...saved, openedAt: 1900 }, 3600).entry, saved.entry);
  assert.equal(currentPullbackDisplay(saved, 3600, [position]).entry, saved.entry, 'broker position must retain actual prices');
});

test('over-limit corrected plan cannot be displayed as an eligible entry', () => {
  const saved = { ...signal, status: 'REJECTED' as const,
    intradayEntry: { ...signal.intradayEntry!, nextOpen: 3020 } };
  const projected = currentPullbackDisplay(saved, 2000);
  assert.ok(projected.displayPlan?.error);
  assert.match(pullbackPlanStatus(projected)!, /OUTSIDE LIMITS.*NO ORDER/);
});

const chartBar = { time: 1800, open: 3010, high: 3015, low: 3008, close: 3012, complete: true };

test('chart touch fills independently of broker rejection and each leg gets its own state', () => {
  const rejected = { ...signal, status: 'REJECTED' as const };
  const first = chartPullbackState(rejected, [chartBar], 2700);
  assert.equal(first.status, 'filled'); assert.equal(first.filledAt, 1800);
  assert.equal(chartExecutionStatus(first, false), 'CHART: Filled · MT5: Not executed');
  assert.equal(confirmedPullbackFill(rejected, 2700), false);
  const second = chartPullbackState({ ...rejected, entry: 3007.5 }, [chartBar], 2700);
  assert.equal(second.status, 'expired'); assert.equal(second.filledAt, undefined);
});

test('both chart levels fill if touched during the window despite neither order executing', () => {
  for (const entry of [3009, 3007.5]) {
    const chart = chartPullbackState({ ...signal, entry, status: 'REJECTED' } as Mt5StoredSignal,
      [{ ...chartBar, low: 3007 }], 2700);
    assert.equal(chart.status, 'filled'); assert.equal(chart.outcome, undefined);
  }
});

test('a late touch after expiry cannot become a chart fill', () => {
  const chart = chartPullbackState(signal, [{ ...chartBar, low: 3009.5 },
    { ...chartBar, time: 2700, low: 3000 }], 3600);
  assert.equal(chart.status, 'expired'); assert.equal(chart.filledAt, undefined);
});

test('chart fills survive expiry until an actual chart exit is reached', () => {
  const chart = chartPullbackState(signal, [chartBar, { ...chartBar, time: 2700, high: 3051, low: 3010 }], 3600);
  assert.equal(chart.status, 'filled'); assert.deepEqual(chart.outcome, { level: 'tp', at: 2700 });
});

test('exit before entry and ambiguous same-bar ordering never generate false fill ticks', () => {
  const before = chartPullbackState(signal, [{ ...chartBar, open: 3050, high: 3051, low: 3010, close: 3015 }], 2700);
  assert.equal(before.status, 'expired'); assert.equal(before.beforeEntryExit?.level, 'tp');
  const ambiguous = chartPullbackState(signal, [{ ...chartBar, high: 3051, low: 3008 }], 2700);
  assert.equal(ambiguous.status, 'ambiguous'); assert.equal(ambiguous.filledAt, undefined);
});

test('future candle OHLC and missing window data cannot prove chart fills', () => {
  assert.equal(chartPullbackState(signal, [chartBar], 2000).status, 'unavailable');
  assert.equal(chartPullbackState(signal, [{ ...chartBar, complete: false }], 2000).status, 'filled');
  assert.equal(chartPullbackState(signal, [{ ...chartBar, time: 2700 }], 3600).status, 'unavailable');
});

test('a data gap preserves a proven fill without inventing a later winning outcome', () => {
  const chart = chartPullbackState(signal, [chartBar, { ...chartBar, time: 3600, high: 3051 }], 4500);
  assert.equal(chart.status, 'filled'); assert.equal(chart.filledAt, 1800); assert.equal(chart.outcome, undefined);
});

test('legacy single-entry market setup resolves its chart exit despite MT5 rejection', () => {
  const legacy = { ...signal, intradayEntry: undefined, scalpEntry: undefined,
    orderType: 'MARKET' as const, direction: 'SELL' as const, status: 'REJECTED' as const,
    entry: 3874.620, stopLoss: 3890.765, takeProfit: 3858.475 };
  const bars = [
    { time: 1800, open: 3874.620, high: 3880, low: 3870, close: 3872, complete: true },
    { time: 2700, open: 3872, high: 3875, low: 3858, close: 3860, complete: true },
  ];
  const chart = chartPullbackState(legacy, bars, 3600);
  assert.equal(chart.status, 'filled'); assert.equal(chart.filledAt, 1800);
  assert.deepEqual(chart.outcome, { level: 'tp', at: 2700 });
  assert.equal(chartExecutionStatus(chart, false), 'CHART: TP HIT · MT5: Not executed');
});

test('legacy single-entry limit requires an in-window chart fill before reporting a result', () => {
  const legacy = { ...signal, intradayEntry: undefined, scalpEntry: undefined };
  assert.equal(chartPullbackState(legacy, [chartBar], 2700).status, 'filled');
  assert.equal(chartPullbackState(legacy, [{ ...chartBar, low: 3009.5 },
    { ...chartBar, time: 2700, low: 3000 }], 3600).status, 'expired');
});
