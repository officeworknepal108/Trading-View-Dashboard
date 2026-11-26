import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { abhiScalpM15FibDecision, abhiScalpM15FibPathBlock, abhiScalpM15FibZones, type AbhiScalpFibPathEntry } from '../src/services/abhiScalpM15Fib';
import { scalpOneToOnePullbackSignals, scalpOneToOneChartHistory, scalpOneToOneChartRecord } from '../src/services/scalpOneToOne';
import { buildChartEntryHistory } from '../src/services/chartEntryData';
import { buildCanonicalTradeRecords, selectAccuracyChartEntries } from '../src/services/tradeRecordFilters';
import { mergeTradeRecordAnnotations } from '../src/services/tradeRecordDeduplication';
import { combineJournalTradeSetups } from '../src/components/TradeJournal';
import type { StructureZone } from '../src/services/marketStructure';
import type { Mt5SignalInput } from '../src/services/mt5Automation';
import type { StudyCandles } from '../src/services/trendlineStudyHistory';
import type { VolumeStudyRecord } from '../src/services/volumeEngulfingStudy';

const buy: AbhiScalpFibPathEntry = { direction: 'BUY', signalAt: 900, calculatedAt: 1800, entry: 100, takeProfit: 112.5, leg: 10 };
const sell: AbhiScalpFibPathEntry = { ...buy, direction: 'SELL', takeProfit: 87.5 };
const zone = (fields: Partial<StructureZone> = {}): StructureZone => ({ id: 'opposing', name: 'DB', category: 'mg',
  isBuy: true, startTime: 0, endTime: 900, active: true, status: 'valid', bottom: 91, top: 94,
  fibStatus: 'a-plus', ...fields });

test('M15 Fib path veto mirrors supply/demand and blocks a whole setup when just one leg is obstructed', () => {
  assert.equal(abhiScalpM15FibPathBlock([sell], [zone()])?.entryLeg, 10);
  const supply = zone({ isBuy: false, name: 'DT', bottom: 106, top: 109 });
  assert.ok(abhiScalpM15FibPathBlock([buy], [supply]));
  const entries: AbhiScalpFibPathEntry[] = [{ ...buy, entry: 99, takeProfit: 110.25 },
    { ...buy, entry: 97.5, takeProfit: 106.875, leg: 25 }];
  assert.equal(abhiScalpM15FibPathBlock(entries, [zone({ isBuy: false, bottom: 108, top: 109 })])?.entryLeg, 10);
  assert.equal(abhiScalpM15FibPathBlock([entries[1]], [zone({ isBuy: false, bottom: 108, top: 109 })]), undefined);
});

test('touching entry blocks; a zone at or beyond TP, behind entry, or same-side does not block', () => {
  assert.ok(abhiScalpM15FibPathBlock([sell], [zone({ bottom: 99, top: 101 })]));
  for (const candidate of [zone({ bottom: 85, top: 87.5 }), zone({ bottom: 70, top: 80 }),
    zone({ bottom: 101, top: 105 }), zone({ isBuy: false })])
    assert.equal(abhiScalpM15FibPathBlock([sell], [candidate]), undefined);
  assert.equal(abhiScalpM15FibPathBlock([buy], [zone({ isBuy: false, bottom: 112.5, top: 115 })]), undefined);
});

test('only active valid Fib zones available at confirmation can veto an entry', () => {
  for (const candidate of [zone({ active: false }), zone({ status: 'pending' }), zone({ status: 'invalidated' }),
    zone({ fibStatus: undefined }), zone({ fibDeepInvalidatedAt: 1000 }), zone({ startTime: 901 }),
    zone({ activeFromTime: 1801 }), zone({ confirmationTime: 1801 }), zone({ invalidatedAt: 1800 })])
    assert.equal(abhiScalpM15FibPathBlock([sell], [candidate]), undefined);
  for (const confluence of [{ swingFibStatus: 'a-plus' as const }, { dayFibStatus: 'a-plus' as const },
    { h1SwingFibStatus: 'aligned' as const }])
    assert.ok(abhiScalpM15FibPathBlock([sell], [zone({ fibStatus: undefined, ...confluence })]));
});

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/abhi-m15-fib-path-2026-11-25.json', import.meta.url), 'utf8')) as {
  candles: StudyCandles;
  cases: Array<{ time: string; blocked: boolean; signal: Mt5SignalInput; record: VolumeStudyRecord }>;
};

test('real Nov25 snapshots reproduce the chosen M15 Fib filter: 02:00 clear, 06:00/08:30/12:30 blocked', () => {
  for (const entry of fixture.cases) {
    assert.equal(abhiScalpM15FibDecision(entry.signal, fixture.candles).status,
      entry.blocked ? 'blocked' : 'allowed', entry.time);
    const pair = scalpOneToOnePullbackSignals(entry.record, fixture.candles, entry.record.confirmedAt, 60);
    assert.equal(pair.length, entry.blocked ? 0 : 2, `${entry.time}: both planned entries share the veto`);
    if (entry.blocked) {
      const history = scalpOneToOneChartHistory(entry.record, fixture.candles, entry.record.confirmedAt + 14400);
      assert.deepEqual(history, { records: [], fills: [] }, `${entry.time}: no replay outcomes or entry-arrow fills`);
    }
  }
});

test('future candles and unfinished higher bars cannot change an original entry decision', () => {
  const entry = fixture.cases.find(c => c.time === '06:00')!;
  const asOf = entry.record.confirmedAt;
  const seconds = { M15: 900, H1: 3600, H4: 14400 };
  const truncated: StudyCandles = {}, poisoned: StudyCandles = {};
  for (const tf of ['M15', 'H1', 'H4'] as const) {
    truncated[tf] = fixture.candles[tf]!.filter(c => c.complete !== false && c.time + seconds[tf] <= asOf);
    poisoned[tf] = fixture.candles[tf]!.map(c => c.time + seconds[tf] > asOf
      ? { ...c, high: 100000, low: 1, close: 50000, volume: 999999, complete: true } : c);
  }
  const expected = abhiScalpM15FibDecision(entry.signal, truncated);
  assert.equal(expected.status, 'blocked');
  assert.deepEqual(abhiScalpM15FibDecision(entry.signal, fixture.candles), expected);
  assert.deepEqual(abhiScalpM15FibDecision(entry.signal, poisoned), expected);
});

test('missing history waits instead of admitting a setup, and legacy/other strategies are unchanged', () => {
  const entry = fixture.cases[0];
  assert.equal(abhiScalpM15FibDecision(entry.signal, {}).status, 'unavailable');
  assert.equal(abhiScalpM15FibZones({ M15: fixture.candles.M15 }, entry.record.confirmedAt), undefined);
  assert.deepEqual(scalpOneToOnePullbackSignals(entry.record, { M15: fixture.candles.M15 }, entry.record.confirmedAt, 60), []);
  assert.equal(abhiScalpM15FibDecision({ ...entry.signal, tradeStyle: 'INTRADAY' }, {}).status, 'allowed');
  assert.equal(abhiScalpM15FibDecision({ ...entry.signal, scalpEntry: { ...entry.signal.scalpEntry!, version: 3 } }, {}).status, 'allowed');
});

test('blocked saved chart outcomes cannot reappear in accuracy, journal notes, arrows or replay; broker facts survive', () => {
  const entry = fixture.cases.find(c => c.time === '12:30')!;
  const history = scalpOneToOneChartHistory(entry.record, fixture.candles, entry.record.confirmedAt + 14400);
  const stale = scalpOneToOneChartRecord({ ...entry.record, outcome: 'tp', resolvedAt: entry.record.confirmedAt + 1800 })!;
  assert.ok(stale);
  const options = { marketSymbol: 'XAUUSD', pipSize: .1, requireLtfFib: false,
    timeframeData: {}, qualifyMtf: () => undefined };
  const canonical = buildChartEntryHistory([stale], history.records, options);
  assert.deepEqual(canonical, []);
  assert.deepEqual(selectAccuracyChartEntries(canonical, undefined, 'M15'), []);
  assert.deepEqual(combineJournalTradeSetups(mergeTradeRecordAnnotations(canonical, [{ ...stale, reason: 'Old saved note' }])), []);
  const broker = { ...stale, id: 'MT5:actual-execution', mt5Managed: true, brokerTicket: 123 };
  assert.equal(buildCanonicalTradeRecords([broker], [], options).length, 1);
});
