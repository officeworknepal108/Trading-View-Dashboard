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
import { compactZoneTableStatus, explainZoneEntry, findZoneTablePullbackSetup, ZonePullbackTradeStatus, ZonePullbackDetailsRow } from '../src/components/OandaProChart';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/tjl1-future-fib-2026-11-25.json', import.meta.url), 'utf8')) as {
  candles: StructureCandle[]; records: JournalTradeRecord[];
};
const original = fixture.records[0];

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
