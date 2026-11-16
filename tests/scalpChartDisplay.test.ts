import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScalpChartDisplays, scalpDisplayOutcome } from '../src/services/scalpChartDisplay';
import type { Mt5AutomationStatus, Mt5StoredSignal } from '../src/services/mt5Automation';

const connection = { account: 'test-account', server: 'test-server', brokerSymbol: 'GOLD', connected: true };
const signal: Mt5StoredSignal = { id: 'scalp-10', setupId: 'SCALP_1_1:M15:900:BUY:P10',
  ...connection, symbol: 'XAUUSD', direction: 'BUY', orderType: 'LIMIT', source: 'ENGULFING',
  tradeStyle: 'SCALP_1_1', zoneName: 'SCALP 1:1', zoneTimeframe: 'M15', signalTimeframe: 'M15',
  engulfingType: 'T1', signalAt: 900, calculatedAt: 1800, expiresAt: 2700,
  entry: 3009, stopLoss: 2990, takeProfit: 3030, riskFree: 3030, rewardRisk: 21 / 19, riskPips: 190,
  status: 'PLACED', createdAt: 1800, updatedAt: 1800, brokerTicket: 100,
  scalpEntry: { version: 1, leg: 10, riskShare: 0.6, referenceEntry: 3010, nextOpen: 3010, confirmationBody: 10 } };
const position: Mt5AutomationStatus['positions'][number] = {
  ticket: 100, symbol: 'GOLD', direction: 'BUY', volume: 0.1, priceOpen: 3008.9,
  priceCurrent: 3015, stopLoss: 2990, takeProfit: 3030, profit: 61, swap: 0,
  openedAt: 1850, signalAt: 900, signalTimeframe: 'M15', zoneTimeframe: 'M15', setupId: signal.setupId,
};
const options = { marketSymbol: 'XAUUSD', timeframe: 'M15' as const, asOf: 2000, connection,
  signals: [signal], positions: [position] };

test('live Scalp uses actual broker prices and fill time without waiting for journal status', () => {
  const [item] = buildScalpChartDisplays(options);
  assert.equal(item.kind, 'live'); assert.equal(item.referenceOnly, false);
  assert.equal(item.trade.entry, position.priceOpen);
  assert.equal(item.trade.stopLoss, position.stopLoss); assert.equal(item.trade.takeProfit, position.takeProfit);
  assert.equal(item.trade.filledAt, 1850); assert.equal(item.markerTime, 1850);
  assert.equal(item.trade.calculatedAt, 1850); assert.equal(item.trade.signal.time, 900);
  assert.equal(item.alwaysVisible, true); assert.match(item.markerText, /#100.*P10/);
});

test('two positions on one candle with identical prices retain distinct tickets and label offsets', () => {
  const items = buildScalpChartDisplays({ ...options, positions: [position, { ...position, ticket: 101 }] });
  assert.deepEqual(items.map(i => i.id), ['MT5:100', 'MT5:101']);
  assert.deepEqual(items.map(i => i.displayOffset), [0, 1]);
});

test('live position survives missing recent journal metadata, breakeven SL and elapsed setup expiry', () => {
  const [item] = buildScalpChartDisplays({ ...options, asOf: 100000, signals: [],
    positions: [{ ...position, stopLoss: position.priceOpen }] });
  assert.equal(item.kind, 'live'); assert.equal(item.trade.stopLoss, position.priceOpen);
  assert.ok(Number.isFinite(item.trade.rewardRisk));
});

test('rejected order draws its original setup with no filled timestamp or execution arrow provenance', () => {
  const [item] = buildScalpChartDisplays({ ...options, positions: [],
    signals: [{ ...signal, scalpEntry: undefined, entry: 3010, status: 'REJECTED' }] });
  assert.equal(item.kind, 'rejected'); assert.equal(item.referenceOnly, true);
  assert.equal(item.trade.entry, 3010); assert.equal(item.trade.filledAt, undefined);
  assert.match(item.statusText, /NO FILL/); assert.match(item.markerText, /SETUP.*REJECTED/);
});

test('pending leg remains a reference while filled sibling draws its own actual execution', () => {
  const second = { ...signal, id: 'scalp-25', setupId: signal.setupId!.replace('P10', 'P25'), brokerTicket: 101,
    entry: 3007.5, scalpEntry: { ...signal.scalpEntry!, leg: 25 as const, riskShare: 0.4 } };
  const items = buildScalpChartDisplays({ ...options, signals: [signal, second] });
  assert.deepEqual(items.map(i => i.kind), ['live', 'pending']);
  assert.equal(items[1].trade.filledAt, undefined);
  assert.match(items[1].statusText, /NOT FILLED/);
});

test('cancelled, closed and expired signals cannot be revived as preview setups', () => {
  for (const status of ['CANCELLED', 'EXPIRED', 'TP', 'SL'] as const) {
    const items = buildScalpChartDisplays({ ...options, positions: [],
      signals: [{ ...signal, status }], previews: [signal] });
    assert.deepEqual(items, [], status);
  }
});

test('expired pending references and stale rejected setups disappear', () => {
  assert.deepEqual(buildScalpChartDisplays({ ...options, asOf: 2800, positions: [] }), []);
  assert.deepEqual(buildScalpChartDisplays({ ...options, asOf: 100000, positions: [],
    signals: [{ ...signal, status: 'REJECTED' }] }), []);
});

test('display isolates replay, timeframe, instrument and selected account', () => {
  assert.deepEqual(buildScalpChartDisplays({ ...options, replay: true }), []);
  assert.deepEqual(buildScalpChartDisplays({ ...options, timeframe: 'H1' }), []);
  assert.deepEqual(buildScalpChartDisplays({ ...options, marketSymbol: 'EURUSD' }), []);
  assert.deepEqual(buildScalpChartDisplays({ ...options, positions: [],
    signals: [{ ...signal, account: 'other-account' }] }), []);
  assert.deepEqual(buildScalpChartDisplays({ ...options, positions: [{ ...position, symbol: 'OTHER' }], signals: [] }), []);
});

test('disconnected heartbeat identifies last known positions and does not claim a live connection', () => {
  const [item] = buildScalpChartDisplays({ ...options, connection: { ...connection, connected: false } });
  assert.match(item.statusText, /LAST KNOWN/);
});

test('ordinary Scalp projects actual lower timeframe execution to its source chart', () => {
  const [item] = buildScalpChartDisplays({ ...options,
    signals: [{ ...signal, tradeStyle: 'SCALPING', signalTimeframe: 'M1', scalpEntry: undefined }],
    positions: [{ ...position, signalTimeframe: 'M1' }] });
  assert.equal(item.style, 'SCALPING'); assert.equal(item.trade.signal.timeframe, 'M1');
  assert.equal(item.markerTime, position.openedAt);
});

const hitBar = { time: 1800, open: 3010, high: 3031, low: 3000, close: 3015, complete: true };

test('rejected setup retires its drawing and setup marker after TP even when price retraces', () => {
  const rejected = { ...signal, status: 'REJECTED' as const };
  const candles = [hitBar, { ...hitBar, time: 2700, high: 3015, close: 3010 }];
  const outcome = scalpDisplayOutcome(rejected, candles, 3600);
  assert.deepEqual(outcome, { level: 'tp', at: 1800, label: 'TP REACHED · NO FILL', noFill: true });
  assert.deepEqual(buildScalpChartDisplays({ ...options, signals: [rejected], positions: [], candles, asOf: 3600 }), []);
});

test('sell setup detects the correct SL and TP sides without inventing a fill', () => {
  const sell = { ...signal, direction: 'SELL' as const, stopLoss: 3030, takeProfit: 2990, status: 'REJECTED' as const };
  assert.equal(scalpDisplayOutcome(sell, [hitBar], 2700)?.label, 'SL REACHED · NO FILL');
  assert.equal(scalpDisplayOutcome(sell, [{ ...hitBar, high: 3020, low: 2989 }], 2700)?.label, 'TP REACHED · NO FILL');
});

test('broker-confirmed exits show HIT while active positions are never closed by chart OHLC', () => {
  assert.deepEqual(scalpDisplayOutcome({ ...signal, status: 'TP', closedAt: 2100 }, [], 2700),
    { level: 'tp', at: 2100, label: 'TP HIT', noFill: false });
  assert.equal(scalpDisplayOutcome({ ...signal, status: 'SL', closedAt: 2100 }, [], 2700)?.label, 'SL HIT');
  assert.equal(scalpDisplayOutcome({ ...signal, status: 'TP', closedAt: 3000 }, [], 2700), undefined);
  assert.equal(scalpDisplayOutcome({ ...signal, status: 'ACTIVE' }, [hitBar], 2700), undefined);
  assert.equal(scalpDisplayOutcome({ ...signal, status: 'RISK_FREE' }, [hitBar], 2700), undefined);
  assert.equal(scalpDisplayOutcome(signal, [hitBar], 2700, true), undefined);
  const displays = buildScalpChartDisplays({ ...options, asOf: 2700, candles: [hitBar] });
  assert.equal(displays.length, 1); assert.equal(displays[0].kind, 'live');
});

test('reference exit checks ignore confirmation wicks and future candle data', () => {
  const rejected = { ...signal, status: 'REJECTED' as const };
  assert.equal(scalpDisplayOutcome(rejected, [{ ...hitBar, time: 900 }], 2700), undefined);
  assert.equal(scalpDisplayOutcome(rejected, [hitBar], 2000), undefined);
  assert.equal(scalpDisplayOutcome(rejected, [{ ...hitBar, time: 2700 }], 2000), undefined);
  assert.equal(scalpDisplayOutcome(rejected, [{ ...hitBar, complete: false }], 2000)?.level, 'tp');
});

test('same-bar ambiguous reference exits do not invent which level was reached first', () => {
  assert.equal(scalpDisplayOutcome(signal, [{ ...hitBar, low: 2980 }], 2700)?.label, 'SL / TP REACHED · NO FILL');
});

test('legacy rejected drawings use the same corrected prices as the table without broker fills', () => {
  const signals = ([10, 25] as const).map(leg => ({ ...signal, id: `legacy:P${leg}`, setupId: `SCALP_1_1:900:P${leg}`,
    direction: 'SELL' as const, status: 'REJECTED' as const, entry: 3847.790, stopLoss: 3867.790, takeProfit: 3827.790,
    scalpEntry: { version: 1 as const, leg, riskShare: leg === 10 ? 0.6 : 0.4,
      referenceEntry: 3847.790, nextOpen: 3842.020, confirmationBody: 9.175 } }));
  const displays = buildScalpChartDisplays({ ...options, positions: [], signals, asOf: 3600 });
  assert.equal(displays.length, 2);
  assert.ok(Math.abs(displays[0].trade.entry - 3842.9375) < 1e-7);
  assert.ok(Math.abs(displays[1].trade.entry - 3844.31375) < 1e-7);
  assert.ok(displays.every(display => display.referenceOnly && display.trade.filledAt === undefined));
  assert.ok(displays.every(display => display.statusText.includes('UPDATED PLAN') && display.statusText.includes('NO FILL')));
});
