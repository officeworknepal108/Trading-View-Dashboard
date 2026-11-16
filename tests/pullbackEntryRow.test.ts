import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TradeDetailsRow, ScalpOutcomeRow } from '../src/components/OandaProChart';
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

test('buy display preserves the existing original-entry cap when next candle gaps up', () => {
  const row = text(render({ trade: { ...trade, entry: 3010, stopLoss: 2990, takeProfit: 3050,
    riskFree: 3030, riskPips: 200, signal: { ...trade.signal, direction: 'bullish' } },
    entryCandles: [
      { ...candles[0], open: 3000, high: 3011, low: 2992, close: 3010 },
      { ...candles[1], open: 3012, high: 3014, low: 3008, close: 3013 },
    ] }));
  assert.match(row, /1st ENTRY 3,010\.000SL 200\.00 PIPS/);
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
