import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TradeDetailsRow, ScalpOutcomeRow, PullbackSetupRows } from '../src/components/OandaProChart';
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
  assert.match(html, /tabular-nums font-normal text-slate-700/);
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
  const one = render({ fillEvidence: { asOf: 2000, replay: false,
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
  const pending = render({ mt5Signal: signal, fillEvidence: { asOf: 2000, replay: false } });
  assert.match(pending, /2nd ENTRY/); assert.doesNotMatch(pending, /aria-label="Entry filled"/);
  const active = render({ mt5Signal: { ...signal, status: 'ACTIVE', openedAt: 1900 },
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
      signals: [...signals].reverse(), style, asOf: 2000, entryCandles: { M15: candles }, timeZone: 'Asia/Kathmandu',
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
  assert.match(visible, /UPDATED PLAN.*ENTRY WINDOW EXPIRED.*NO FILL/);
  assert.doesNotMatch(html, /aria-label="Entry filled"/);
});
