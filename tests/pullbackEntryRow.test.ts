import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TradeDetailsRow, ScalpOutcomeRow, PullbackSetupRows, findZoneTablePullbackSetup,
  ZonePullbackTradeStatus, ZonePullbackDetailsRow } from '../src/components/OandaProChart';
import { buildPullbackChartSetups } from '../src/services/pullbackChartSetup';
import { tradeToMt5Signal } from '../src/services/mt5Automation';
import { buildIntradayPullbackSignals } from '../src/services/intradayPullback';
import type { TradeLevels } from '../src/services/tradeLevels';

const trade: TradeLevels = {
  intradayReference: true, entry: 3888.385, stopLoss: 3903.370, takeProfit: 3858.415,
  riskFree: 3873.400, riskFreeEnabled: false, riskPips: 149.85, rewardRisk: 2,
  status: 'active', pendingAtCreation: false, calculatedAt: 1800,
  signal: { type: 'T1', direction: 'bearish', time: 900, candleCount: 2, timeframe: 'M15' },
};
const candles = [
  { time: 900, open: 3892.385, high: 3893, low: 3887, close: 3888.385, volume: 1000, complete: true },
  { time: 1800, open: 3888.385, high: 3891, low: 3884, close: 3885, volume: 900, complete: false },
];
const render = (props: Partial<React.ComponentProps<typeof TradeDetailsRow>> = {}) => renderToStaticMarkup(
  React.createElement(TradeDetailsRow, { trade, colSpan: 5, zoneTimeframe: 'M15', entryCandles: candles, ...props }));
const text = (html: string) => html.replace(/<[^>]*>/g, '');

function mergedZoneFixture() {
  const zoneId = 'TJL1-1794492000-3890.29265';
  const base = tradeToMt5Signal({ source: 'ENGULFING', setupId: `DIRECT:M15:${zoneId}`,
    zoneName: 'QML A+', zoneTimeframe: 'M15', trade, now: 1800, pendingExpiryMinutes: 15 });
  const signals = buildIntradayPullbackSignals({ ...base, tradeStyle: 'INTRADAY' }, candles)
    .map(entry => ({ ...entry, status: 'REJECTED' as const, createdAt: 1800, updatedAt: 1800 }));
  const bars = [candles[0], { ...candles[1], high: 3889 }];
  const [setup] = buildPullbackChartSetups({ signals, asOf: 2000, candles: { M15: bars } });
  assert.ok(setup);
  return { zoneId, setup, signals, bars };
}

test('merged zone shows ACTIVE TRADE and puts execution and both entry details in its tooltip', () => {
  const { setup } = mergedZoneFixture();
  const status = renderToStaticMarkup(React.createElement(ZonePullbackTradeStatus, { setup }));
  assert.equal(text(status), 'ACTIVE TRADE');
  assert.match(status, /title="CHART: Filled · MT5: Not executed/);
  assert.match(status, /1st Entry: 3,888\.785 — ✓ Filled/);
  assert.match(status, /2nd Entry: 3,889\.385 — Waiting/);
  assert.match(status, /SL: 145\.85 pips/);
  assert.match(status, /SL: 139\.85 pips/);
  assert.match(status, /Fixed SL: 3,903\.370/);
  assert.match(status, /Fixed TP: 3,858\.415/);
  const details = renderToStaticMarkup(React.createElement(ZonePullbackDetailsRow, { setup }));
  assert.equal((details.match(/<tr /g) ?? []).length, 1);
  assert.equal((details.match(/aria-label="Entry filled"/g) ?? []).length, 1);
  assert.match(text(details), /1st ENTRY✓ 3,888\.785/);
  assert.match(text(details), /2nd ENTRY 3,889\.385/);
  assert.doesNotMatch(text(details), /CHART:|MT5:/);
});

test('merge matches the source origin, market, direction, timeframe and original entry event', () => {
  const { zoneId, setup } = mergedZoneFixture();
  const options = { zoneIds: [zoneId], symbol: 'XAUUSD', zoneTimeframe: 'M15', direction: 'bearish' as const, trade };
  assert.equal(findZoneTablePullbackSetup([setup], options), setup);
  assert.equal(findZoneTablePullbackSetup([setup], { ...options, zoneIds: ['merged', 'TJL1-1794492000-3890.3'] }), setup);
  for (const change of [{ symbol: 'EURUSD' }, { zoneTimeframe: 'M30' }, { direction: 'bullish' as const },
    { zoneIds: ['TJL1-1794492900-3890.29265'] }, { trade: { ...trade, signal: { ...trade.signal, time: 2700 } } }]) {
    assert.equal(findZoneTablePullbackSetup([setup], { ...options, ...change }), undefined);
  }
});

test('a represented Intraday setup omits its standalone row while other setups and Scalp remain visible', () => {
  const { setup, signals, bars } = mergedZoneFixture();
  const props = { signals, style: 'INTRADAY' as const, asOf: 2000,
    entryCandles: { M15: bars }, timeZone: 'Asia/Kathmandu' as const };
  assert.match(renderToStaticMarkup(React.createElement(PullbackSetupRows, props)), /INTRADAY/);
  assert.equal(renderToStaticMarkup(React.createElement(PullbackSetupRows, { ...props, representedSetups: [setup] })), '');
  assert.match(renderToStaticMarkup(React.createElement(PullbackSetupRows, { ...props,
    representedSetups: [{ ...setup, memberIds: ['unrelated'], setupId: 'unrelated' }] })), /INTRADAY/);
  assert.match(renderToStaticMarkup(React.createElement(PullbackSetupRows, { ...props,
    style: 'SCALP_1_1', representedSetups: [setup] })), /SCALP 1:1/);
});

test('merged details retain second-only skips, chart-only ticks and completed result handling', () => {
  const { setup } = mergedZoneFixture();
  const skipped = { ...setup, secondOnly: true, legs: setup.legs.map(leg => ({ ...leg,
    chartConfirmed: leg.leg === 25, executed: leg.leg === 25 })) };
  const details = renderToStaticMarkup(React.createElement(ZonePullbackDetailsRow, { setup: skipped }));
  assert.match(details, /SKIPPED/);
  assert.equal((details.match(/aria-label="Entry filled"/g) ?? []).length, 1);
  assert.match(renderToStaticMarkup(React.createElement(ZonePullbackTradeStatus, { setup: skipped })), /Skipped — split lot below minimum/);
  for (const result of ['tp', 'sl'] as const) {
    const completed = { ...setup, trade: { ...setup.trade, result, status: result === 'tp' ? 'tp-hit' as const : 'sl-hit' as const } };
    assert.equal(renderToStaticMarkup(React.createElement(ZonePullbackDetailsRow, { setup: completed })), '');
    assert.equal(text(renderToStaticMarkup(React.createElement(ZonePullbackTradeStatus, { setup: completed }))), `${result.toUpperCase()} HIT`);
  }
});

test('zone table does not label an unresolved old fill as an active trade', () => {
  const { setup } = mergedZoneFixture();
  const uncertain = { ...setup, chartFilled: true, alwaysVisible: false };
  assert.equal(text(renderToStaticMarkup(React.createElement(ZonePullbackTradeStatus, { setup: uncertain }))),
    'OUTCOME UNCONFIRMED');
  assert.equal(text(renderToStaticMarkup(React.createElement(ZonePullbackTradeStatus,
    { setup: { ...uncertain, alwaysVisible: true } }))), 'ACTIVE TRADE');
});

test('completed Scalp retains type, price and engulfing while omitting the entry-details line', () => {
  for (const label of ['TP HIT', 'SL HIT', 'TP REACHED · NO FILL', 'SL REACHED · NO FILL']) {
    const row = renderToStaticMarkup(React.createElement(ScalpOutcomeRow, {
      signal: { ...tradeToMt5Signal({ source: 'ENGULFING', zoneName: 'Scalp 1:1', zoneTimeframe: 'M15', trade, now: 1800, pendingExpiryMinutes: 15 }), status: 'TP', createdAt: 1800, updatedAt: 2700 },
      outcome: { level: label.startsWith('TP') ? 'tp' : 'sl', at: 1800, label, noFill: label.includes('NO FILL') },
    }));
    assert.ok(text(row).includes(label));
    assert.match(row, /SELL/); assert.match(row, /3,888\.385/); assert.match(row, /T1/);
    assert.doesNotMatch(row, /ENTRY|R:R|pips|3,903|3,858/);
  }
});

test('reference row displays both derived sell prices, per-entry SL pips and original fixed exits', () => {
  const original = JSON.stringify({ trade, candles });
  const html = render(), row = text(html);
  assert.match(row, /1st ENTRY 3,888\.785SL 145\.85 PIPS/);
  assert.match(row, /2nd ENTRY 3,889\.385SL 139\.85 PIPS/);
  assert.match(row, /SL 3,903\.370.*TP 3,858\.415/);
  assert.match(html, /flex-nowrap.*whitespace-nowrap.*text-\[9px\].*font-black/);
  assert.match(html, /text-blue-700/); assert.match(html, /text-rose-700/); assert.match(html, /text-emerald-700/);
  assert.match(html, /tabular-nums font-bold text-slate-700/);
  assert.doesNotMatch(html, /ORIGINAL REFERENCE|Execution:/);
  assert.equal(JSON.stringify({ trade, candles }), original);
});

test('reference row waits for confirmation and next opening data instead of inventing entries', () => {
  for (const entryCandles of [[], candles.slice(0, 1), [{ ...candles[0], complete: false }, candles[1]]]) {
    const row = text(render({ entryCandles }));
    assert.match(row, /1st ENTRY —SL — PIPS/);
    assert.match(row, /2nd ENTRY —SL — PIPS/);
    assert.match(row, /SL 3,903\.370.*TP 3,858\.415/);
  }
});

test('MTF reference row uses its higher timeframe route for entry details', () => {
  const row = text(render({ mtf: true, zoneTimeframe: 'H4', trade: { ...trade, rewardRisk: 5, takeProfit: 3813.460 } }));
  assert.match(row, /1st ENTRY 3,888\.785SL 145\.85 PIPS/);
  assert.match(row, /2nd ENTRY 3,889\.385SL 139\.85 PIPS/);
  assert.match(row, /TP 3,813\.460/);
});

test('buy display skips an over-limit exact entry instead of moving it back to the original price', () => {
  const row = text(render({ trade: { ...trade, entry: 3010, stopLoss: 2990, takeProfit: 3050,
    riskFree: 3030, riskPips: 200, signal: { ...trade.signal, direction: 'bullish' } },
    entryCandles: [
      { ...candles[0], open: 3000, high: 3011, low: 2992, close: 3010 },
      { ...candles[1], open: 3012, high: 3014, low: 3008, close: 3013 },
    ] }));
  assert.match(row, /1st ENTRY —SL — PIPS/);
  assert.match(row, /2nd ENTRY 3,009\.500SL 195\.00 PIPS/);
});

test('each Intraday entry gets an independent green fill tick; pending sibling remains unticked', () => {
  const base = tradeToMt5Signal({ source: 'ENGULFING', zoneName: 'TJL1', zoneTimeframe: 'M15', trade,
    now: 1800, pendingExpiryMinutes: 15 });
  const signals = buildIntradayPullbackSignals({ ...base, tradeStyle: 'INTRADAY' }, candles)
    .map(signal => ({ ...signal, status: 'PLACED' as const, createdAt: 1800, updatedAt: 1800 }));
  const one = render({ entryCandles: [candles[0], { ...candles[1], high: 3889 }], fillEvidence: { asOf: 2000, replay: false,
    signals: [{ ...signals[0], status: 'ACTIVE', openedAt: 1900 }, signals[1]] } });
  assert.equal((one.match(/aria-label="Entry filled"/g) ?? []).length, 1);
  assert.match(one, /text-emerald-600/);
  const both = render({ fillEvidence: { asOf: 2000, replay: false,
    signals: signals.map(signal => ({ ...signal, status: 'ACTIVE', openedAt: 1900 })) } });
  assert.equal((both.match(/aria-label="Entry filled"/g) ?? []).length, 2);
});

test('Scalp live entry label identifies the leg and ticks only confirmed fills', () => {
  const base = tradeToMt5Signal({ source: 'ENGULFING', zoneName: 'Scalp', zoneTimeframe: 'M15', trade,
    now: 1800, pendingExpiryMinutes: 15 });
  const signal = { ...base, tradeStyle: 'SCALP_1_1' as const, status: 'PLACED' as const,
    createdAt: 1800, updatedAt: 1800, scalpEntry: { version: 1 as const, leg: 25 as const,
      riskShare: 0.4, referenceEntry: trade.entry, nextOpen: trade.entry, confirmationBody: 4 } };
  const pending = render({ entryCandles: [], mt5Signal: signal, fillEvidence: { asOf: 2000, replay: false } });
  assert.match(pending, /2nd ENTRY/); assert.doesNotMatch(pending, /aria-label="Entry filled"/);
  const active = render({ entryCandles: candles, mt5Signal: { ...signal, status: 'ACTIVE', openedAt: 1900 },
    fillEvidence: { asOf: 2000, replay: false } });
  assert.equal((active.match(/aria-label="Entry filled"/g) ?? []).length, 1);
});

test('Scalp and Intraday each render one setup header and one line for both entry legs', () => {
  const base = tradeToMt5Signal({ source: 'ENGULFING', setupId: 'zone-one', zoneName: 'TJL1',
    zoneTimeframe: 'M15', trade, now: 1800, pendingExpiryMinutes: 15 });
  const entries = buildIntradayPullbackSignals({ ...base, tradeStyle: 'INTRADAY' }, candles);
  for (const style of ['INTRADAY', 'SCALP_1_1'] as const) {
    const signals = entries.map((entry, i) => ({ ...entry, tradeStyle: style,
      intradayEntry: style === 'INTRADAY' ? entry.intradayEntry : undefined,
      scalpEntry: style === 'SCALP_1_1' ? entry.intradayEntry : undefined,
      status: i === 0 ? 'ACTIVE' as const : 'REJECTED' as const,
      openedAt: i === 0 ? 1900 : undefined, createdAt: 1800, updatedAt: 1900 }));
    const html = renderToStaticMarkup(React.createElement(PullbackSetupRows, {
      signals: [...signals].reverse(), style, asOf: 2000, entryCandles: { M15: [candles[0], { ...candles[1], high: 3889 }] }, timeZone: 'Asia/Kathmandu',
    }));
    assert.equal((html.match(/<tr /g) ?? []).length, 2);
    assert.equal((html.match(/aria-label="Entry filled"/g) ?? []).length, 1);
    assert.equal((text(html).match(/1st ENTRY/g) ?? []).length, 1);
    assert.equal((text(html).match(/2nd ENTRY/g) ?? []).length, 1);
    assert.match(html, /3,888\.785/); assert.match(html, /3,889\.385/);
    assert.match(html, /SL 145\.85 PIPS/); assert.match(html, /SL 139\.85 PIPS/);
  }
});

test('completed grouped setup retains five columns and hides entry details until it expires', () => {
  const base = tradeToMt5Signal({ source: 'ENGULFING', setupId: 'zone-one', zoneName: 'TJL1',
    zoneTimeframe: 'M15', trade, now: 1800, pendingExpiryMinutes: 15 });
  const signals = buildIntradayPullbackSignals({ ...base, tradeStyle: 'INTRADAY' }, candles)
    .map(entry => ({ ...entry, status: 'TP' as const, openedAt: 1900, closedAt: 2700, createdAt: 1800, updatedAt: 2700 }));
  const bars = [3600, 4500, 5400, 6300, 7200].map(time => ({ ...candles[0], time }));
  const props = { signals, style: 'INTRADAY' as const, asOf: 8099, entryCandles: { M15: bars }, timeZone: 'Asia/Kathmandu' as const };
  const html = renderToStaticMarkup(React.createElement(PullbackSetupRows, props));
  assert.equal((html.match(/<tr /g) ?? []).length, 1);
  assert.equal((html.match(/<td /g) ?? []).length, 5);
  assert.match(text(html), /SELL/); assert.match(text(html), /3,888\.385/); assert.match(text(html), /T1/);
  assert.match(text(html), /TP HIT/); assert.doesNotMatch(text(html), /1st ENTRY|2nd ENTRY|PIPS/);
  assert.equal(renderToStaticMarkup(React.createElement(PullbackSetupRows, { ...props, asOf: 8100 })), '');
});

test('the saved rejected setup visibly shows the updated 10/25 plan, correct pips and no fill ticks', () => {
  const base = tradeToMt5Signal({ source: 'ENGULFING', setupId: 'SCALP_1_1:900', zoneName: 'Scalp 1:1',
    zoneTimeframe: 'M15', trade, now: 1800, pendingExpiryMinutes: 15 });
  const signals = ([10, 25] as const).map(leg => ({ ...base, id: `${base.id}:P${leg}`, setupId: `${base.setupId}:P${leg}`,
    tradeStyle: 'SCALP_1_1' as const, orderType: 'LIMIT' as const, direction: 'SELL' as const, entry: 3847.790, stopLoss: 3867.790, takeProfit: 3827.790,
    status: 'REJECTED' as const, createdAt: 1800, updatedAt: 1800, expiresAt: 2700,
    scalpEntry: { version: 1 as const, leg, riskShare: leg === 10 ? 0.6 : 0.4,
      referenceEntry: 3847.790, nextOpen: 3842.020, confirmationBody: 9.175 } }));
  const html = renderToStaticMarkup(React.createElement(PullbackSetupRows, {
    signals, style: 'SCALP_1_1', asOf: 3600, entryCandles: {}, timeZone: 'Asia/Kathmandu',
  }));
  const visible = text(html);
  assert.match(visible, /1st ENTRY 3,842\.938/); assert.match(visible, /2nd ENTRY 3,844\.314/);
  assert.match(visible, /SL 248\.53 PIPS/); assert.match(visible, /SL 234\.76 PIPS/);
  assert.match(visible, /SL 3,867\.790/); assert.match(visible, /TP 3,827\.790/);
  assert.doesNotMatch(visible, /3,847\.790/);
  assert.match(visible, /CHART: Waiting for candle data.*MT5: Not executed/);
  assert.doesNotMatch(html, /aria-label="Entry filled"/);
});

test('chart-filled Scalp entries tick despite MT5 rejection and status uses 10px bold text', () => {
  const base = tradeToMt5Signal({ source: 'ENGULFING', setupId: 'SCALP_1_1:900', zoneName: 'Scalp 1:1',
    zoneTimeframe: 'M15', trade, now: 1800, pendingExpiryMinutes: 15 });
  const signals = ([10, 25] as const).map(leg => ({ ...base, id: `${base.id}:P${leg}`, setupId: `${base.setupId}:P${leg}`,
    tradeStyle: 'SCALP_1_1' as const, orderType: 'LIMIT' as const, direction: 'SELL' as const,
    entry: 3847.790, stopLoss: 3867.790, takeProfit: 3827.790, status: 'REJECTED' as const,
    createdAt: 1800, updatedAt: 1800, expiresAt: 2700,
    scalpEntry: { version: 1 as const, leg, riskShare: leg === 10 ? 0.6 : 0.4,
      referenceEntry: 3847.790, nextOpen: 3842.020, confirmationBody: 9.175 } }));
  const html = renderToStaticMarkup(React.createElement(PullbackSetupRows, {
    signals, style: 'SCALP_1_1', asOf: 2700, timeZone: 'Asia/Kathmandu',
    entryCandles: { M15: [{ time: 1800, open: 3842.020, high: 3850, low: 3830, close: 3840, volume: 1000, complete: true }] },
  }));
  assert.equal((html.match(/aria-label="Entry filled"/g) ?? []).length, 2);
  assert.match(text(html), /CHART: Filled · MT5: Not executed/);
  assert.match(html, /text-\[10px\] font-bold/);
});

test('old single-entry Scalp shows its chart result, then disappears after five completed candles', () => {
  const signal = { ...tradeToMt5Signal({ source: 'ENGULFING', zoneName: 'Scalp 1:1', zoneTimeframe: 'M15',
    trade, now: 1800, pendingExpiryMinutes: 240 }), tradeStyle: 'SCALP_1_1' as const,
    direction: 'SELL' as const, orderType: 'MARKET' as const, status: 'REJECTED' as const,
    entry: 3874.620, stopLoss: 3890.765, takeProfit: 3858.475, createdAt: 1800, updatedAt: 1800 };
  const bars = [
    { time: 1800, open: 3874.620, high: 3880, low: 3870, close: 3872, volume: 1000, complete: true },
    { time: 2700, open: 3872, high: 3875, low: 3858, close: 3860, volume: 1000, complete: true },
    ...[3600, 4500, 5400, 6300, 7200].map(time => ({ time, open: 3860, high: 3861, low: 3859, close: 3860, volume: 1000, complete: true })),
  ];
  const props = { signals: [signal], style: 'SCALP_1_1' as const, asOf: 8099,
    entryCandles: { M15: bars }, timeZone: 'Asia/Kathmandu' as const };
  const html = renderToStaticMarkup(React.createElement(PullbackSetupRows, props));
  assert.equal((html.match(/<tr /g) ?? []).length, 1);
  assert.match(text(html), /CHART: TP HIT · MT5: Not executed/);
  assert.doesNotMatch(text(html), /ENTRY|Waiting for candle data/);
  assert.equal(renderToStaticMarkup(React.createElement(PullbackSetupRows, { ...props, asOf: 8100 })), '');
});
