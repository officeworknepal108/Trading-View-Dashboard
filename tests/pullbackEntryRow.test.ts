import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TradeDetailsRow, ScalpOutcomeRow } from '../src/components/OandaProChart';
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

test('completed Scalp row shows only its outcome without entry prices, exits, RR or pips', () => {
  for (const label of ['TP HIT', 'SL HIT', 'TP REACHED · NO FILL', 'SL REACHED · NO FILL']) {
    const row = renderToStaticMarkup(React.createElement(ScalpOutcomeRow, {
      outcome: { level: label.startsWith('TP') ? 'tp' : 'sl', at: 1800, label, noFill: label.includes('NO FILL') },
    }));
    assert.ok(text(row).includes(label));
    assert.doesNotMatch(row, /ENTRY|R:R|pips|3,888|3,903|3,858/);
  }
});

test('reference row displays both derived sell prices, per-entry SL pips and original fixed exits', () => {
  const original = JSON.stringify({ trade, candles });
  const html = render(), row = text(html);
  assert.match(row, /1st ENTRY 3,888\.785SL 145\.85 pips/);
  assert.match(row, /2nd ENTRY 3,889\.385SL 139\.85 pips/);
  assert.match(row, /SL 3,903\.370.*TP 3,858\.415/);
  assert.match(html, /flex-nowrap.*whitespace-nowrap.*text-\[8px\].*font-normal/);
  assert.match(html, /text-\[6px\] font-normal/);
  assert.doesNotMatch(html, /font-bold|font-black|font-semibold|ORIGINAL REFERENCE|Execution:/);
  assert.equal(JSON.stringify({ trade, candles }), original);
});

test('reference row waits for confirmation and next opening data instead of inventing entries', () => {
  for (const entryCandles of [[], candles.slice(0, 1), [{ ...candles[0], complete: false }, candles[1]]]) {
    const row = text(render({ entryCandles }));
    assert.match(row, /1st ENTRY —SL — pips/);
    assert.match(row, /2nd ENTRY —SL — pips/);
    assert.match(row, /SL 3,903\.370.*TP 3,858\.415/);
  }
});

test('MTF reference row uses its higher timeframe route for entry details', () => {
  const row = text(render({ mtf: true, zoneTimeframe: 'H4', trade: { ...trade, rewardRisk: 5, takeProfit: 3813.460 } }));
  assert.match(row, /1st ENTRY 3,888\.785SL 145\.85 pips/);
  assert.match(row, /2nd ENTRY 3,889\.385SL 139\.85 pips/);
  assert.match(row, /TP 3,813\.460/);
});

test('buy display preserves the existing original-entry cap when next candle gaps up', () => {
  const row = text(render({ trade: { ...trade, entry: 3010, stopLoss: 2990, takeProfit: 3050,
    riskFree: 3030, riskPips: 200, signal: { ...trade.signal, direction: 'bullish' } },
    entryCandles: [
      { ...candles[0], open: 3000, high: 3011, low: 2992, close: 3010 },
      { ...candles[1], open: 3012, high: 3014, low: 3008, close: 3013 },
    ] }));
  assert.match(row, /1st ENTRY 3,010\.000SL 200\.00 pips/);
  assert.match(row, /2nd ENTRY 3,009\.500SL 195\.00 pips/);
});
