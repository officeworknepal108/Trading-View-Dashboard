import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseBollingerArchive, archiveCoverage, selectBollingerArchive, loadBollingerArchive } from '../src/services/bollingerArchive';
import { runBollingerStudy, bollingerStats, bollingerCsv, BOLLINGER_STUDY_DEFAULTS } from '../src/services/bollingerM5';

const raw = JSON.parse(readFileSync(new URL('../src/studyAssets/bollingerBrokerHistory.json', import.meta.url), 'utf8'));
const archive = parseBollingerArchive(raw), coverage = archiveCoverage(archive);

test('saved dataset contains 40,000 real M5 candles and only market-price fields', () => {
  assert.equal(coverage.m5Candles, 40000); assert.ok(coverage.h4Candles >= 500);
  assert.equal(new Date(coverage.first * 1000).toISOString().slice(0, 10), '2026-04-30');
  assert.equal(new Date(coverage.through * 1000).toISOString().slice(0, 10), '2026-11-19');
  for (const bars of Object.values(archive.candles)) for (const bar of bars) {
    assert.deepEqual(Object.keys(bar).sort(), ['time', 'open', 'high', 'low', 'close', 'volume', 'complete'].sort());
  }
  assert.equal(archive.candles.M5.at(-1)!.complete, false, 'a final potentially forming export bar is not declared closed');
});

test('105-day selection retains all warmup, counts study candles and excludes future H4 evidence', () => {
  const from = Math.floor(coverage.through / 86400) * 86400 - 104 * 86400;
  const selected = selectBollingerArchive(archive, from, coverage.through);
  assert.ok(selected.studiedCandles > 20_000);
  assert.ok(selected.warmupCandles >= 500);
  assert.equal(selected.candles.M5![0], archive.candles.M5[0]);
  assert.ok(selected.candles.M5!.every(b => b.time < coverage.through));
  assert.ok(selected.candles.H4!.every(b => b.complete !== false && b.time + 14400 <= coverage.through));
  assert.equal(selected.studiedCandles, selected.candles.M5!.filter(b => b.time >= from && b.time + 300 <= coverage.through && b.complete !== false).length);
});

test('saved July–October replay reproduces the earlier native 26-trade result', () => {
  const from = Date.parse('2026-07-10T00:00:00Z') / 1000, cutoff = Date.parse('2026-10-27T00:00:00Z') / 1000;
  const selected = selectBollingerArchive(archive, from, cutoff);
  const result = runBollingerStudy({ ...BOLLINGER_STUDY_DEFAULTS, from, cutoff,
    m5: selected.candles.M5!, h4: selected.candles.H4!, dataSource: 'ARCHIVE', datasetId: archive.id });
  const stats = bollingerStats(result.records, 5000);
  assert.equal(stats.trades, 26); assert.equal(stats.tp, 14); assert.equal(stats.sl, 12);
  assert.ok(Math.abs(stats.pnl - 395.6208634679943) < 1e-7);
  assert.equal(result.settings.datasetId, archive.id);
  const csv = bollingerCsv(result);
  assert.ok(csv.includes('dataSource,datasetId,studyCandleCount,warmupCandleCount'));
  assert.ok(csv.includes(`"ARCHIVE","${archive.id}"`));
});

test('out-of-coverage requests fail instead of shortening a historical study', () => {
  assert.throws(() => selectBollingerArchive(archive, coverage.availableFrom - 86400, coverage.through), /within the saved history/);
  assert.throws(() => selectBollingerArchive(archive, coverage.availableFrom, coverage.through + 300), /within the saved history/);
  assert.throws(() => selectBollingerArchive(archive, coverage.through, coverage.through), /valid historical date/);
});

test('invalid price assets, duplicate timestamps and broken OHLC are rejected', () => {
  assert.throws(() => parseBollingerArchive({}), /invalid or incomplete/);
  const candles = archive.candles.M5.map(b => ({ ...b })); candles[1].time = candles[0].time;
  assert.throws(() => parseBollingerArchive({ ...archive, candles: { ...archive.candles, M5: candles } }), /invalid or incomplete/);
  candles[1] = { ...archive.candles.M5[1], high: 1 };
  assert.throws(() => parseBollingerArchive({ ...archive, candles: { ...archive.candles, M5: candles } }), /invalid or incomplete/);
});

test('asset loader validates data, reports missing files and respects cancellation', async () => {
  const controller = new AbortController();
  const loaded = await loadBollingerArchive(controller.signal, async (_url, init) => {
    assert.equal(init?.signal, controller.signal); return Response.json(raw);
  });
  assert.equal(loaded.id, archive.id);
  await assert.rejects(loadBollingerArchive(controller.signal, async () => new Response('', { status: 404 })), /could not load/);
  await assert.rejects(loadBollingerArchive(controller.signal, async () => { controller.abort(); return Response.json(raw); }), { name: 'AbortError' });
});
