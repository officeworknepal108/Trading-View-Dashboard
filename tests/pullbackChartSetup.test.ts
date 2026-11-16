import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPullbackChartSetups, belongsToPullbackSetup, chartSignalFromRecord, chartSignalFromHistoryFill } from '../src/services/pullbackChartSetup';
import type { ScalpOneToOneChartFill } from '../src/services/scalpOneToOne';
import type { PullbackTableSignal } from '../src/services/pullbackEntryDisplay';
import type { StructureCandle } from '../src/services/marketStructure';

const first: PullbackTableSignal = { id: 'setup:P10', setupId: 'setup:P10', symbol: 'XAUUSD',
  source: 'ENGULFING', tradeStyle: 'INTRADAY', direction: 'BUY', orderType: 'LIMIT', zoneName: 'TJL1',
  zoneTimeframe: 'M15', signalTimeframe: 'M15', signalAt: 900, calculatedAt: 1800, engulfingType: 'T1',
  entry: 3009, stopLoss: 2990, takeProfit: 3050, riskFree: 3030, riskPips: 190, rewardRisk: 41 / 19,
  expiresAt: 2700, status: 'REJECTED', createdAt: 1800, updatedAt: 1800,
  intradayEntry: { version: 2, leg: 10, riskShare: .6, referenceEntry: 3010,
    nextOpen: 3010, confirmationBody: 10, setupKey: 'setup' } };
const second: PullbackTableSignal = { ...first, id: 'setup:P25', setupId: 'setup:P25',
  entry: 3007.5, riskPips: 175, rewardRisk: 42.5 / 17.5,
  intradayEntry: { ...first.intradayEntry!, leg: 25, riskShare: .4 } };
const candle = (time: number, low: number, high = 3012, open = 3010): StructureCandle =>
  ({ time, open, high, low, close: 3011, complete: true });
const build = (signals: PullbackTableSignal[], bars: StructureCandle[], asOf = 3600) =>
  buildPullbackChartSetups({ signals, candles: { M15: bars }, asOf });

for (const style of ['INTRADAY', 'SCALP_1_1'] as const) test(`${style}: one setup anchored to first fill with two distinct entries and fixed exits`, () => {
  const signals = [first, second].map(s => style === 'INTRADAY' ? s : ({ ...s, tradeStyle: style,
    scalpEntry: s.intradayEntry, intradayEntry: undefined }));
  const setups = build(signals, [candle(1800, 3007), candle(2700, 3008)]);
  assert.equal(setups.length, 1);
  const [setup] = setups;
  assert.equal(setup.trade.entry, 3009); assert.equal(setup.trade.calculatedAt, 1800);
  assert.equal(setup.trade.stopLoss, 2990); assert.equal(setup.trade.takeProfit, 3050);
  assert.deepEqual(setup.legs.map(s => s.entry), [3009, 3007.5]);
  assert.deepEqual(setup.legs.map(s => s.riskPips), [190, 175]);
  assert.deepEqual(setup.legs.map(s => s.filled), [true, true]);
  assert.deepEqual(setup.legs.map(s => s.executed), [false, false]);
  assert.equal(setup.markerTime, 1800); assert.equal(setup.markerText, ''); assert.equal(setup.drawing, true);
  assert.ok(belongsToPullbackSetup(setup, { ...setup.trade, entry: 3007.5 }, style));
});

test('only first entry fills; sibling remains not filled after its window expires', () => {
  const [setup] = build([first, second], [candle(1800, 3008), candle(2700, 3006)]);
  assert.deepEqual(setup.legs.map(s => s.filled), [true, false]);
  assert.equal(setup.legs[1].uncertain, false);
  assert.equal(setup.markerTime, 1800); assert.equal(setup.drawing, true);
});

test('completed setup keeps one historical TP arrow while removing the drawing', () => {
  const bars = [candle(1800, 3007), candle(2700, 3008, 3051)];
  const [closed] = build([second, first], bars);
  assert.equal(closed.markerText, 'TP'); assert.equal(closed.drawing, false);
  assert.equal(closed.markerTime, 1800); assert.equal(closed.alwaysVisible, false);
  const [replay] = build([first, second], bars, 2700);
  assert.equal(replay.markerText, ''); assert.equal(replay.drawing, true);
});

test('SL result labels the single arrow without retaining the risk box', () => {
  const [setup] = build([first, second], [candle(1800, 3007), candle(2700, 2989)]);
  assert.equal(setup.markerText, 'SL'); assert.equal(setup.drawing, false);
});

test('original TP reached at the opening before either limit cancels the drawing and arrow', () => {
  const [setup] = build([first, second], [candle(1800, 3050, 3052, 3051)], 2700);
  assert.equal(setup.markerTime, undefined); assert.equal(setup.drawing, false);
});

test('moving a broker SL to breakeven does not move the original shared display stop', () => {
  const [setup] = build([{ ...first, stopLoss: 3009, initialStopLoss: 2990, brokerTicket: 123 }], [candle(1800, 3008)]);
  assert.equal(setup.trade.stopLoss, 2990); assert.equal(setup.legs[0].riskPips, 190);
  assert.ok(belongsToPullbackSetup(setup, { ...setup.trade, stopLoss: 3009 }, undefined, { id: 'MT5:123' }),
    'the known broker position must use the shared drawing even after its live SL moves');
  assert.equal(belongsToPullbackSetup(setup, { ...setup.trade, stopLoss: 3009 }, undefined, { id: 'MT5:999' }), false);
});

test('no entry arrow before confirmed fill, or for an expired unfilled setup', () => {
  const bars = [candle(1800, 3010), candle(2700, 3007)];
  const [pending] = build([first, second], bars, 2000);
  assert.equal(pending.markerTime, undefined); assert.equal(pending.drawing, true);
  const [expired] = build([first, second], bars);
  assert.equal(expired.markerTime, undefined); assert.equal(expired.drawing, false);
});

test('missing sibling plan is reconstructed without claiming a broker execution or a fill', () => {
  const [setup] = build([{ ...first, status: 'ACTIVE', openedAt: 1850 }], []);
  assert.deepEqual(setup.legs.map(s => s.entry), [3009, 3007.5]);
  assert.deepEqual(setup.legs.map(s => s.executed), [true, false]);
  assert.deepEqual(setup.legs.map(s => s.filled), [true, false]);
  assert.equal(setup.legs[1].uncertain, true);
  assert.equal(setup.trade.calculatedAt, 1850);
});

test('separate setups and exits never merge even on the same candle', () => {
  const other = { ...first, intradayEntry: { ...first.intradayEntry!, setupKey: 'different' } };
  assert.equal(build([first, second, other], [candle(1800, 3007)]).length, 2);
  assert.equal(build([first, { ...second, takeProfit: 3040 }], [candle(1800, 3007)]).length, 2);
});

test('selected account filters stale broker signals', () => {
  const setups = buildPullbackChartSetups({ signals: [{ ...first, account: 'other' }],
    candles: { M15: [candle(1800, 3007)] }, asOf: 3600, context: { account: 'current' } });
  assert.equal(setups.length, 0);
});

test('saved simulation remains chart only and a future close does not leak into replay', () => {
  const signal = chartSignalFromRecord({ id: first.id, setupId: first.setupId, symbol: 'XAUUSD',
    source: 'ENGULFING', tradeStyle: 'INTRADAY', zoneName: 'TJL1', zoneTimeframe: 'M15',
    signalTimeframe: 'M15', signalAt: 900, engulfingType: 'T1', direction: 'bullish',
    entry: 3009, stopLoss: 2990, takeProfit: 3050, riskPips: 190, rewardRisk: 41 / 19,
    intradayEntry: first.intradayEntry, result: 'tp', openedAt: 1800, completedAt: 5000 })!;
  const [setup] = build([signal], [], 3000);
  assert.equal(setup.legs[0].filled, true); assert.equal(setup.legs[0].executed, false);
  assert.equal(setup.markerText, ''); assert.equal(setup.drawing, false, 'old fill proof cannot establish a currently running trade without candles');
});

test('old fills survive data gaps as arrows without creating chart-wide active boxes', () => {
  const gap = [candle(1800, 3007), candle(5400, 3007)];
  const [missingMiddle] = build([first, second], gap, 6300);
  assert.deepEqual(missingMiddle.legs.map(s => s.filled), [true, true]);
  assert.equal(missingMiddle.markerTime, 1800);
  assert.equal(missingMiddle.markerText, '', 'unknown exit must not become TP or SL');
  assert.equal(missingMiddle.drawing, false); assert.equal(missingMiddle.alwaysVisible, false);
  const [staleTail] = build([first, second], [candle(1800, 3007)], 100000);
  assert.equal(staleTail.markerTime, 1800); assert.equal(staleTail.drawing, false);
});

test('a matched open broker position retains its drawing when chart candles are missing', () => {
  const signal = { ...first, status: 'ACTIVE' as const, brokerTicket: 123, brokerSymbol: 'GOLD', openedAt: 1850 };
  const position = { ticket: 123, symbol: 'GOLD', direction: 'BUY' as const, volume: .01, priceOpen: 3009,
    priceCurrent: 3010, stopLoss: 2990, takeProfit: 3050, profit: 1, swap: 0, openedAt: 1850 };
  const options = { signals: [signal], candles: {}, asOf: 100000, context: { brokerSymbol: 'GOLD' } };
  assert.equal(buildPullbackChartSetups({ ...options, positions: [position] })[0].drawing, true);
  assert.equal(buildPullbackChartSetups({ ...options, positions: [{ ...position, ticket: 999 }] })[0].drawing, false);
});

test('known historical TP/SL survives conversion, reload and missing candle history', () => {
  for (const outcome of ['tp', 'sl'] as const) {
    const active = build([first], [candle(1800, 3008)], 2700)[0];
    const signal = { ...first, tradeStyle: 'SCALP_1_1' as const, intradayEntry: undefined, scalpEntry: first.intradayEntry };
    const fill: ScalpOneToOneChartFill = { id: 'old-fill', signal, setupId: signal.setupId, leg: 10, outcome,
      trade: { ...active.trade, filledAt: 1800, resolvedAt: 2700, result: outcome,
        status: outcome === 'tp' ? 'tp-hit' : 'sl-hit' } };
    const evidence = chartSignalFromHistoryFill(fill)!;
    const [completed] = build([evidence], [], 100000);
    assert.equal(completed.markerTime, 1800); assert.equal(completed.markerText, outcome.toUpperCase());
    assert.equal(completed.drawing, false); assert.equal(completed.legs[0].executed, false);
    const [withRejection] = build([evidence, { ...signal, status: 'REJECTED' }], [], 100000);
    assert.equal(withRejection.markerText, outcome.toUpperCase(), 'broker rejection must not erase chart result evidence');
    assert.equal(withRejection.drawing, false); assert.equal(withRejection.legs[0].executed, false);
    const [beforeExitClose] = build([evidence], [], 3000);
    assert.equal(beforeExitClose.markerText, '', 'future exit candle must not leak into replay');
    const [beforeFillClose] = build([evidence], [], 2000);
    assert.equal(beforeFillClose.markerTime, undefined, 'an unfinished historical fill candle must not create an arrow');
  }
});
