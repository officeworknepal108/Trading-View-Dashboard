import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MultiTimeframeEntryTable, mtfTableHitExpired, isSlTpTradeDisplayFinished,
  tradeDisplayExpired, tradeDrawingExpired, tradeDrawingFromRecord, resolveArrowTradeZones } from '../src/components/OandaProChart';
import type { JournalTradeRecord } from '../src/components/TradeJournal';
import type { MtfRow } from '../src/services/mtf';

const bar = (time: number, complete = true) => ({ time, open: 100, high: 102, low: 99, close: 101, volume: 1, complete });

test('arrow details recover a missing journal main zone from its original broker signal', () => {
  const record: JournalTradeRecord = {
    id: 'MT5:original', symbol: 'XAUUSD', source: 'MTF', zoneName: 'SBR',
    zoneTimeframe: 'H1', signalTimeframe: 'M1', signalAt: 1000, direction: 'bearish',
    engulfingType: 'T3', entry: 100, stopLoss: 101, takeProfit: 97,
    riskPips: 10, rewardRisk: 3, completedAt: 1200, result: 'sl',
  };
  const original = { id: 'original', symbol: 'XAUUSD', signalAt: 1000,
    direction: 'SELL' as const, zoneTimeframe: 'H1' as const, signalTimeframe: 'M1' as const,
    zoneId: 'SUPPLY-1792659600-4090.14' };
  const before = JSON.stringify(record);
  assert.deepEqual(resolveArrowTradeZones(record, [original], () => undefined),
    { mainZone: 'SUPPLY', entryZone: 'SBR' });
  assert.equal(resolveArrowTradeZones(record, [{ ...original, symbol: 'EURUSD' }], () => undefined).mainZone,
    undefined, 'another market must not supply the main zone');
  assert.equal(resolveArrowTradeZones(record, [original, { ...original, id: 'other', zoneId: 'DB-1792659600-4090' }],
    () => undefined).mainZone, 'SUPPLY', 'the original execution wins over a same-candle candidate');
  assert.equal(JSON.stringify(record), before, 'display lookup must not rewrite history');
});

test('arrow details reconstruct modern and legacy MTF setup IDs and reject ambiguous zones', () => {
  const record: JournalTradeRecord = {
    id: 'MTF:M15-M1-external-choch-900:1000:100', symbol: 'XAUUSD', source: 'MTF',
    zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1', signalAt: 1000,
    direction: 'bullish', engulfingType: 'T1', entry: 100, stopLoss: 99, takeProfit: 103,
    riskPips: 10, rewardRisk: 3, completedAt: 1200, result: 'tp',
  };
  const context = { higherTimeframe: 'M15', lowerTimeframe: 'M1', direction: 'bullish',
    engulfingTime: 1000, engulfingType: 'T1', higherTimeframeZone: 'DB',
    higherTimeframeZoneId: 'DB-original', tappedZone: 'QML' } as MtfRow;
  assert.deepEqual(resolveArrowTradeZones(record, [], id => id === record.id ? context : undefined),
    { mainZone: 'DB', entryZone: 'QML' });
  const legacy = { ...record, id: 'MTF:M15-M1-choch-900:1000:100' };
  assert.equal(resolveArrowTradeZones(legacy, [], id => id === record.id ? context : undefined).mainZone, 'DB');
  assert.equal(resolveArrowTradeZones(legacy, [], id => id.includes('-internal-')
    ? { ...context, higherTimeframeZone: 'DT', higherTimeframeZoneId: 'DT-other' } : context).mainZone,
    undefined, 'conflicting historical matches must not produce a guessed zone');
  assert.equal(resolveArrowTradeZones(record, [], () => undefined).mainZone, undefined);
  assert.equal(resolveArrowTradeZones({ ...record, zoneId: 'TJL1-1791983700-4088.8021' }, [],
    () => { throw new Error('saved names do not require reconstruction'); }).mainZone, 'TJL1');
});

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

test('entry/SL/TP drawings stay visible through RF while the position remains open', () => {
  const candles = Array.from({ length: 31 }, (_, index) => bar(1000 + index * 60));
  for (const direction of ['bullish', 'bearish'] as const) {
    for (const status of ['active', 'risk-free', 'RISK_FREE'] as const) {
      const trade = { status, partialClosedAt: 1000, updatedAt: 1000,
        signal: { timeframe: 'M1' as const, direction } };
      assert.equal(tradeDrawingExpired(trade, candles, 2860), false, `${direction} ${status}`);
    }
  }
  const record: JournalTradeRecord = {
    id: 'MT5:rf-open', source: 'MTF', zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1',
    direction: 'bullish', engulfingType: 'T1', signalAt: 800, openedAt: 900,
    completedAt: 1000, partialClosedAt: 1000, result: 'risk-free',
    entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10,
  };
  assert.equal(tradeDrawingExpired(record, candles, 2860), false, 'reload retains an open RF record');
  assert.equal(tradeDrawingExpired(tradeDrawingFromRecord(record), candles, 2860), false);
});

test('RF followed by SL or TP starts drawing expiry at the final hit, not the partial close', () => {
  const candles = Array.from({ length: 16 }, (_, index) => bar(1000 + index * 60));
  for (const result of ['sl', 'tp', 'rf'] as const) {
    const record: JournalTradeRecord = {
      id: `MT5:rf-${result}`, source: 'MTF', zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1',
      direction: 'bullish', engulfingType: 'T1', signalAt: 800, openedAt: 900,
      partialClosedAt: 1000, completedAt: 1600, closedAt: 1600, result,
      entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10,
    };
    const drawing = tradeDrawingFromRecord(record);
    assert.equal(tradeDrawingExpired(record, candles, 1900), false, `${result}: four completed bars`);
    assert.equal(tradeDrawingExpired(drawing, candles, 1900), false);
    assert.equal(tradeDrawingExpired(record, candles, 1960), true, `${result}: fifth completed bar`);
    assert.equal(tradeDrawingExpired(drawing, candles, 1960), true);
    assert.equal(tradeDrawingExpired(drawing, [...candles.slice(0, -1), bar(1900, false)], 1960), false);
    assert.equal(tradeDrawingExpired(drawing, candles, 1900), false, 'rewinding restores the retention window');
  }
  const brokerRf = { status: 'RF', signalTimeframe: 'M1' as const, partialClosedAt: 1000, updatedAt: 1600 };
  assert.equal(tradeDrawingExpired(brokerRf, candles, 1900), false);
  assert.equal(tradeDrawingExpired(brokerRf, candles, 1960), true);
  assert.equal(tradeDrawingExpired({ status: 'sl-hit', signalTimeframe: 'M1' }, candles, 9999), false,
    'an unknown final hit time cannot start a countdown');
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


function reloadMtfRecord(result: JournalTradeRecord['result'] = 'tp'): JournalTradeRecord {
  return { id: 'reload-record', brokerTicket: 12345, setupId: 'MTF:reload', source: 'MTF',
    zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1', direction: 'bullish',
    engulfingType: 'T1', signalAt: 800, openedAt: 900, completedAt: 1000,
    partialClosedAt: result === 'rf' ? 1000 : undefined,
    result, entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10 };
}

function reloadMtfProps(): React.ComponentProps<typeof MultiTimeframeEntryTable> {
  return { rows: [], liveTrades: [], records: [], timeZone: 'UTC', entryCandles: {}, asOf: 1360 };
}

const renderReloadTable = (props: React.ComponentProps<typeof MultiTimeframeEntryTable>) =>
  renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, props));

test('reload with delayed entry candles never flashes old SL, TP or RF records', () => {
  for (const result of ['sl', 'tp', 'rf'] as const) {
    const record = reloadMtfRecord(result);
    const original = structuredClone(record);
    const props = { ...reloadMtfProps(), records: [record] };
    const loading = renderReloadTable(props);
    assert.ok(loading.includes('Loading MTF data'));
    assert.ok(!loading.includes('ENTRY 100.000'), 'closed trade prices stay hidden during loading');
    assert.ok(!loading.includes('No active MTF setup'), 'missing data is not an empty table');
    const loaded = renderReloadTable({ ...props,
      entryCandles: { M1: [1060,1120,1180,1240,1300].map(time => bar(time)) } });
    assert.ok(loaded.includes('No active MTF setup'));
    assert.ok(!loaded.includes('ENTRY 100.000'), 'expired trades never flash back after loading');
    assert.deepEqual(record, original, 'table loading must not rewrite saved trades');
  }
});

test('loaded recent results retain exactly five completed candles and ignore other timeframes', () => {
  const props = { ...reloadMtfProps(), records: [reloadMtfRecord()] };
  assert.ok(renderReloadTable({ ...props, entryCandles: { M15: [bar(1000)] } }).includes('Loading MTF data'));
  const candles = [1060,1120,1180,1240,1300].map(time => bar(time));
  const retained = renderReloadTable({ ...props, asOf: 1300, entryCandles: { M1: candles } });
  assert.ok(retained.includes('TP HIT'));
  assert.ok(retained.includes('ENTRY 100.000'));
  assert.ok(!retained.includes('Loading MTF data'));
  assert.ok(renderReloadTable({ ...props, asOf: 1360, entryCandles: { M1: candles } }).includes('No active MTF setup'));
});

test('initial MTF loading and failed feeds show status with retry instead of a false empty table', () => {
  let retries = 0;
  const props = { ...reloadMtfProps(), requiredTimeframes: ['M1'] as const, onRetry: () => { retries++; } };
  assert.ok(renderReloadTable(props).includes('Loading MTF data'));
  const failed = renderReloadTable({ ...props, records: [reloadMtfRecord()], candleErrors: { M1: 'Feed unavailable' } });
  assert.ok(failed.includes('Unable to load MTF candle data (M1)'));
  assert.ok(failed.includes('Retry'));
  assert.ok(!failed.includes('ENTRY 100.000'));
  assert.equal(retries, 0, 'rendering an error must not trigger reload loops');
  const recovered = renderReloadTable({ ...props, records: [reloadMtfRecord()],
    entryCandles: { M1: [1060,1120,1180,1240,1300].map(time => bar(time)) } });
  assert.ok(!recovered.includes('Unable to load'));
  assert.ok(!recovered.includes('Loading MTF data'));
});

test('open and risk-free positions remain visible alongside loading or failure status', () => {
  for (const result of ['open','risk-free'] as const) {
    const record = reloadMtfRecord(result);
    const props = { ...reloadMtfProps(), records: [record], requiredTimeframes: ['M1'] as const };
    assert.ok(renderReloadTable(props).includes('ENTRY 100.000'), result);
    assert.ok(renderReloadTable({ ...props, candleErrors: { M1: 'Missing feed' } }).includes('ENTRY 100.000'), result);
    const trade = { ...tradeDrawingFromRecord(record), status: result === 'open' ? 'active' as const : 'risk-free' as const };
    const live: React.ComponentProps<typeof MultiTimeframeEntryTable>['liveTrades'] = [{ trade,
      position: { ticket: 12345, symbol: 'XAUUSD', direction: 'BUY', volume: 1,
        priceOpen: 100, priceCurrent: 102, stopLoss: 99, takeProfit: 103, profit: 2, swap: 0,
        openedAt: 900, source: 'MTF', zoneTimeframe: 'M15', signalTimeframe: 'M1',
        signalStatus: result === 'open' ? 'ACTIVE' : 'RISK_FREE' } }];
    const liveMarkup = renderReloadTable({ ...props, liveTrades: live });
    assert.ok(liveMarkup.includes('MT5 #12345'));
    assert.ok(liveMarkup.includes('Loading MTF data'));
  }
});
