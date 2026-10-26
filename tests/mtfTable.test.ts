import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MultiTimeframeEntryTable, mtfTableHitExpired, isSlTpTradeDisplayFinished,
  tradeDisplayExpired, tradeDrawingFromRecord } from '../src/components/OandaProChart';
import type { JournalTradeRecord } from '../src/components/TradeJournal';

const bar = (time: number, complete = true) => ({ time, open: 100, high: 102, low: 99, close: 101, volume: 1, complete });

test('MTF display expires after five complete entry-timeframe bars, excluding the hit candle', () => {
  const candles = [1000, 1060, 1120, 1180, 1240, 1300].map(time => bar(time));
  assert.equal(mtfTableHitExpired(1000, candles, 1300, 'M1'), false);
  assert.equal(mtfTableHitExpired(1000, candles, 1360, 'M1'), true);
  assert.equal(mtfTableHitExpired(1000, [...candles.slice(0, -1), bar(1300, false)], 1360, 'M1'), false);
  assert.equal(mtfTableHitExpired(undefined, candles, 99999, 'M1'), false, 'open trades stay visible');
  const gaps = [1300, 1600, 1900, 10000, 10300].map(time => bar(time));
  assert.equal(mtfTableHitExpired(1000, gaps, 10300, 'M5'), false, 'market gaps are not candles');
  assert.equal(mtfTableHitExpired(1000, gaps, 10600, 'M5'), true);
});

test('SL, TP and risk-free stay five candles without resurrecting an expired setup', () => {
  for (const result of ['sl', 'tp', 'rf', 'risk-free'] as const) {
    const record: JournalTradeRecord = {
      id: 'MT5:expiry', setupId: 'MTF:original', source: 'MTF',
      zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1',
      direction: 'bullish', engulfingType: 'T1', signalAt: 800, openedAt: 900,
      completedAt: result === 'risk-free' ? 900 : 1000, partialClosedAt: result === 'rf' || result === 'risk-free' ? 1000 : undefined,
      result, entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10,
    };
    const props: React.ComponentProps<typeof MultiTimeframeEntryTable> = {
      rows: [{ id: 'original', setupId: 'MTF-1', higherTimeframe: 'M15', lowerTimeframe: 'M1',
        confirmationKind: 'choch', structureScope: 'external', direction: 'bullish', confirmationTime: 700,
        confirmationBarsAgo: 1, higherTimeframeZoneId: 'parent', higherTimeframeZone: 'DB',
        higherTimeframeTapTime: 700, higherTimeframeTapBarsAgo: 1, engulfingTime: 800 }],
      liveTrades: [], records: [record], timeZone: 'UTC',
      entryCandles: { M1: [1060, 1120, 1180, 1240, 1300].map(time => bar(time)) }, asOf: 1300,
    };
    const before = JSON.stringify(record);
    const immediate = renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, { ...props, asOf: 1000, entryCandles: {} }));
    assert.equal(immediate.includes('No active MTF setup'), false, result);
    assert.equal(renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, props)).includes('No active MTF setup'),
      false, result);
    const expired = renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, { ...props, asOf: 1360 }));
    assert.ok(expired.includes('No active MTF setup'), result);
    assert.ok(!expired.includes('MTF-1'), 'expired execution must not reappear as a setup');
    assert.equal(JSON.stringify(record), before, 'display filtering must leave journal history intact');
    const drawing = tradeDrawingFromRecord(record);
    assert.equal(tradeDisplayExpired(record, props.entryCandles.M1!, 1300), false);
    assert.equal(tradeDisplayExpired(drawing, props.entryCandles.M1!, 1300), false, 'chart matches table during retention');
    assert.equal(tradeDisplayExpired(drawing, props.entryCandles.M1!, 1360), true, 'chart expires with table');
    assert.equal(tradeDisplayExpired(drawing, props.entryCandles.M1!, 1300), false, 'replay rewind restores the same window');
  }
});

test('a live risk-free position hides after five bars while an ordinary open position remains visible', () => {
  const props: React.ComponentProps<typeof MultiTimeframeEntryTable> = {
    rows: [], records: [], timeZone: 'UTC', asOf: 1360,
    entryCandles: { M1: [1000, 1060, 1120, 1180, 1240, 1300].map(time => bar(time)) },
    liveTrades: [{
      position: { ticket: 1, symbol: 'XAUUSD', direction: 'BUY', volume: 1, priceOpen: 100,
        priceCurrent: 102, stopLoss: 100, takeProfit: 103, profit: 2, swap: 0, openedAt: 900,
        source: 'MTF', zoneTimeframe: 'M15', signalTimeframe: 'M1', signalStatus: 'RISK_FREE' },
      trade: { entry: 100, stopLoss: 99, takeProfit: 103, riskFree: 101, riskFreeEnabled: true,
        riskPips: 10, rewardRisk: 3, status: 'active', pendingAtCreation: false, calculatedAt: 900, filledAt: 900,
        signal: { type: 'T1', direction: 'bullish', timeframe: 'M1', time: 800, candleCount: 2 } },
    }],
  };
  const render = () => renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, props));
  assert.ok(render().includes('No active MTF setup'));
  props.asOf = 1300;
  assert.ok(!render().includes('No active MTF setup'), 'risk-free stays visible through four completed candles');
  props.asOf = 1360;
  props.liveTrades[0].position.signalStatus = 'ACTIVE';
  assert.ok(!render().includes('No active MTF setup'), 'an active trade without an RF event has no expiry');
});

test('an unresolved MTF execution retains its source and prices without an active setup', () => {
  const record: JournalTradeRecord = {
    id: 'MT5:original', brokerTicket: 101033888, source: 'MTF',
    zoneId: 'Internal DT-1793004300-4022.31', setupId: 'MTF:M15-M1-external-choch-1793029860',
    symbol: 'XAUUSD', zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1',
    direction: 'bearish', engulfingType: 'T3', tradeStyle: 'SCALPING',
    signalAt: 1793034120, openedAt: 1793034182, completedAt: 1793034301,
    result: 'open', entry: 4021.48, stopLoss: 4024.05, takeProfit: 4014.01,
    rewardRisk: 3, riskPips: 25.7,
  };
  const render = (rows: React.ComponentProps<typeof MultiTimeframeEntryTable>['rows']) => renderToStaticMarkup(
    React.createElement(MultiTimeframeEntryTable, { rows, liveTrades: [], records: [record], timeZone: 'Asia/Kathmandu',
      entryCandles: {}, asOf: record.completedAt }),
  );
  const html = render([]);
  for (const text of ['Internal DT', 'M1 QML', 'OPEN', '4,021.480', '4,024.050', '4,014.010']) {
    assert.ok(html.includes(text), `missing ${text}`);
  }
  assert.ok(!html.includes('No active MTF setup'));
  assert.ok(html.includes('Original entry-zone drawing not saved'), 'legacy records must not invent a zone');
  const duplicate = render([{
    id: 'M15-M1-external-choch-1793029860', setupId: 'MTF-1',
    higherTimeframe: 'M15', lowerTimeframe: 'M1', confirmationKind: 'choch', structureScope: 'external',
    direction: 'bearish', confirmationTime: 1793029860, confirmationBarsAgo: 1,
    higherTimeframeZoneId: record.zoneId!, higherTimeframeZone: 'Internal DT',
    higherTimeframeTapTime: 1793029860, higherTimeframeTapBarsAgo: 1,
    engulfingTime: record.signalAt, engulfingType: 'T3',
  }]);
  assert.ok(!duplicate.includes('MTF-1'), 'the recalculated setup must not duplicate the saved execution');
});

test('the display filter recognizes chart and broker SL/TP without hiding open or risk-free trades', () => {
  for (const status of ['SL', 'TP', 'sl-hit', 'tp-hit']) assert.equal(isSlTpTradeDisplayFinished({ status }), true);
  for (const result of ['sl', 'tp']) assert.equal(isSlTpTradeDisplayFinished({ result }), true);
  for (const status of ['active', 'pending', 'risk-free', 'RISK_FREE']) assert.equal(isSlTpTradeDisplayFinished({ status }), false);
  assert.equal(isSlTpTradeDisplayFinished({ result: 'rf' }), false);
  assert.equal(isSlTpTradeDisplayFinished(undefined), false);
});
