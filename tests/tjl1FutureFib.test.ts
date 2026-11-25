import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeMarketStructure, detectEngulfingPatternAt, findZoneEngulfingPattern, type StructureCandle } from '../src/services/marketStructure';
import { inspectZoneEntryEvidence, resolveZoneEngulfingSignal } from '../src/services/tradeLevels';
import { buildCanonicalTradeRecords, selectTradeChartRecords, selectTwoMonthAccuracyRecords, selectTwoMonthJournalRecords } from '../src/services/tradeRecordFilters';
import { buildChartEntryHistory, buildZoneTablePullbackSetups } from '../src/services/chartEntryData';
import { chartSignalFromRecord } from '../src/services/pullbackChartSetup';
import { calculateJournalPerformance, type JournalTradeRecord } from '../src/components/TradeJournal';
import { compactZoneTableStatus, FibZoneBadge, explainZoneEntry, findZoneTablePullbackSetup, ZonePullbackTradeStatus, ZonePullbackDetailsRow } from '../src/components/OandaProChart';
import { fibBadgeTiming } from '../src/services/fibBadgeTiming';
import { applyDayFibConfluence } from '../src/services/dayFibConfluence';
import { buildDayFibs, selectDayFibForTime } from '../src/services/dayFib';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/tjl1-future-fib-2026-11-25.json', import.meta.url), 'utf8')) as {
  candles: StructureCandle[]; records: JournalTradeRecord[];
};
const original = fixture.records[0];

test('Day Fib badge labels alignment after the observed T4 with a six-pixel note', () => {
  const asOf = fixture.candles.at(-1)!.time;
  const structure = analyzeMarketStructure(fixture.candles, {
    sourceBarSeconds: 900, confirmationBarSeconds: 3600, zoneVisualBars: 30,
  });
  const move = selectDayFibForTime(buildDayFibs(fixture.candles), asOf);
  const zone = applyDayFibConfluence(fixture.candles, structure.zones, move, 10, asOf)
    .zones.find(zone => zone.id === original.zoneId)!;
  assert.equal(zone.dayFibStatus, 'a-plus');
  const render = (observedTime?: number) => renderToStaticMarkup(React.createElement(FibZoneBadge,
    { label: `DAY FIB A+ ${zone.dayFibBand}`, tone: 'sky', alignedLater: fibBadgeTiming({
      zone, candles: fixture.candles, timeframe: 'M15', observedTime }).day }));
  assert.match(render(original.signalAt), /ALIGNED LATER/);
  assert.match(render(original.signalAt), /text-\[6px\]/);
  assert.doesNotMatch(render(asOf), /ALIGNED LATER/, 'alignment already existed at this observation');
  assert.doesNotMatch(render(), /ALIGNED LATER/, 'no timing claim without an observed pattern');
});

test('all Fib badges use the same six-pixel annotation without changing their eight-pixel label', () => {
  for (const label of ['A+ FIB 0.5-0.618', 'FIB DEEP DISCOUNT', 'DEEP DISCOUNT',
    'SWING A+ FIB 0.71-0.79', '1H SWING FIB ALIGNED 0.5-0.618', 'DAY FIB A+ 0.71-0.79']) {
    const render = (alignedLater: boolean) => renderToStaticMarkup(React.createElement(FibZoneBadge, { label, alignedLater }));
    assert.match(render(true), /text-\[8px\]/);
    assert.match(render(true), /text-\[6px\]/);
    assert.match(render(true), /ALIGNED LATER/);
    assert.doesNotMatch(render(false), /ALIGNED LATER/);
  }
});

test('Fib timing uses each source separately and never treats missing H1/H4 history as later alignment', () => {
  const zone = { ...original.entryQualification!.zone,
    swingFibStatus: 'a-plus' as const, swingFibBand: '0.5-0.618' as const,
    h1SwingFibStatus: 'aligned' as const, h1SwingFibBand: '0.5-0.618' as const };
  const options = { zone, candles: fixture.candles, timeframe: 'M15' as const, observedTime: original.signalAt };
  const early = fibBadgeTiming(options);
  assert.equal(early.structure, true, 'the structure Fib was absent at the actual T4');
  assert.equal(early.swing, undefined);
  assert.equal(early.h1Swing, undefined);
  assert.deepEqual(fibBadgeTiming({ ...options, observedTime: undefined }), {});
  assert.equal(fibBadgeTiming({ ...options, observedTime: original.completedAt }).structure, false,
    'the structure Fib is aligned by the later observation');
  const flatHistory = (seconds: number) => Array.from({ length: 20 }, (_, i) => ({
    time: original.signalAt! - (20 - i) * seconds, open: 100, high: 101, low: 99, close: 100, complete: true,
  }));
  const known = fibBadgeTiming({ ...options, h4Candles: flatHistory(14400), h1Candles: flatHistory(3600), lines: [] });
  assert.equal(known.swing, true, 'the captured earlier H4 feed had no aligned swing');
  assert.equal(known.h1Swing, true, 'the captured earlier H1 feed had no post-CHoCH swing');
});

test('the exact November 25 TJL1 T4 cannot borrow a Fib low formed 150 minutes later', () => {
  assert.equal(original.entry, 3525.7110000000002);
  assert.equal(original.stopLoss, 3542.5);
  assert.equal(original.entryQualification!.zone.fibZeroTime! - original.signalAt!, 150 * 60);
  const index = fixture.candles.findIndex(c => c.time === original.signalAt);
  assert.equal(detectEngulfingPatternAt(fixture.candles, index)?.type, 'T4');
  const futureZone = original.entryQualification!.zone;
  assert.equal(resolveZoneEngulfingSignal(futureZone, 'M15'), undefined,
    'reject the saved snapshot even though its Fib status says A+');
  assert.equal(findZoneEngulfingPattern(fixture.candles.slice(0, index + 1), futureZone), undefined,
    'a future numerical Fib cannot approve the earlier four-candle pattern');
  for (const asOf of [original.signalAt!, original.signalAt! + 3600, original.completedAt]) {
    const candles = fixture.candles.filter(c => c.time <= asOf);
    const structure = analyzeMarketStructure(candles, {
      sourceBarSeconds: 900, confirmationBarSeconds: 3600, zoneVisualBars: 30,
    });
    const zone = structure.zones.find(z => z.id === original.zoneId)!;
    assert.ok(zone, 'the same TJL1 origin is reconstructed');
    assert.equal(resolveZoneEngulfingSignal(zone, 'M15'), undefined);
    if (asOf < original.completedAt) assert.equal(zone.fibStatus, 'not-valid');
    else assert.equal(zone.fibStatus, 'a-plus', 'later Fib alignment is allowed without retroactive entry');
    const readiness = explainZoneEntry({ zone, timeframe: 'M15', confirmationLabel: '1H', replay: true,
      now: asOf, evidence: inspectZoneEntryEvidence(zone, candles, 'M15') });
    assert.match(compactZoneTableStatus(readiness), /NO TRADE/,
      'waiting for Fib or a qualifying engulfing must never be abbreviated to TRADE');
    const options = { marketSymbol: 'XAUUSD', pipSize: 0.1, requireLtfFib: false,
      timeframeData: { M15: { candles, structure } }, qualifyMtf: () => undefined };
    const canonical = buildCanonicalTradeRecords(fixture.records, [], options);
    assert.deepEqual(canonical, []);
    assert.deepEqual(buildChartEntryHistory(fixture.records, [], options), []);
    assert.deepEqual(selectTradeChartRecords(canonical, 'M15', candles, true, { includeActive: true, asOf }), []);
    assert.deepEqual(selectTwoMonthAccuracyRecords(canonical, asOf), []);
    assert.deepEqual(selectTwoMonthJournalRecords(canonical, asOf), []);
    assert.equal(calculateJournalPerformance(canonical).completed, 0);
    assert.equal(calculateJournalPerformance(canonical).totalR, 0);
    const setups = buildZoneTablePullbackSetups({ replay: true,
      chartSignals: canonical.flatMap(record => { const s = chartSignalFromRecord(record); return s ? [s] : []; }),
      brokerSignals: [], asOf, candles: { M15: candles } });
    assert.equal(findZoneTablePullbackSetup(setups, { zoneIds: [zone.id], symbol: 'XAUUSD',
      zoneTimeframe: 'M15', direction: 'bearish' }), undefined,
    'the observed T4 row cannot obtain ACTIVE TRADE, entry ticks or a risk box');
  }
  assert.deepEqual(buildCanonicalTradeRecords(fixture.records, [], {
    marketSymbol: 'XAUUSD', pipSize: 0.1, requireLtfFib: false, timeframeData: {}, qualifyMtf: () => undefined,
  }), [], 'future-dated stored evidence remains invalid before candle feeds load');
});

test('live broker pullbacks cannot populate the replay Zone Table', () => {
  const brokerSignals = fixture.records.flatMap(record => {
    const signal = chartSignalFromRecord({ ...record, result: 'open', brokerTicket: 77, mt5Managed: true });
    return signal ? [signal] : [];
  });
  const options = { asOf: original.signalAt! + 3600, candles: { M15: fixture.candles },
    chartSignals: [], brokerSignals };
  const live = buildZoneTablePullbackSetups({ ...options, replay: false });
  assert.equal(live.length, 1, 'the live broker view retains its actual setup');
  assert.match(renderToStaticMarkup(React.createElement(ZonePullbackTradeStatus, { setup: live[0] })), /ACTIVE TRADE/);
  assert.match(renderToStaticMarkup(React.createElement(ZonePullbackDetailsRow, { setup: live[0] })), /1st ENTRY/);
  assert.deepEqual(buildZoneTablePullbackSetups({ ...options, replay: true }), [],
    'replay must not simulate fills from a live broker plan');
});
