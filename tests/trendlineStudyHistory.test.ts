import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStudyDateHistory, mergeStudyCandles, studyHistoryRequirements, type StudyCandles } from '../src/services/trendlineStudyHistory';
import { STUDY_SECONDS, STUDY_TIMEFRAMES, type StudyTimeframe } from '../src/services/trendlineStudy';
import type { StructureCandle } from '../src/services/marketStructure';

const fromTime = 1800000000;
const cutoff = fromTime + 10000;
const candle = (time: number, complete = true): StructureCandle => ({ time, open: 100, high: 102, low: 99, close: 101, complete });
const context = (tf: StudyTimeframe) => Array.from({ length: 601 }, (_, i) => (
  candle(fromTime + (i - 600) * STUDY_SECONDS[tf])
));
const seed = (): StudyCandles => Object.fromEntries(STUDY_TIMEFRAMES.map(tf => [tf, context(tf)]));
const options = () => ({ symbol: 'EURUSD', zoneTimeframe: 'M15' as const, fromTime, cutoff,
  signal: new AbortController().signal, candles: seed() });
const response = (tf: string, candles: StructureCandle[], symbol = 'EURUSD') => Response.json({ ok: true, symbol, granularity: tf, candles });

test('history requirements include only the selected timeframe and higher for every market', () => {
  assert.deepEqual(studyHistoryRequirements('EURUSD', 'M15').mandatory, ['M15', 'M30', 'H1', 'H4']);
  assert.deepEqual(studyHistoryRequirements('XAUUSD', 'M15'), studyHistoryRequirements('EURUSD', 'M15'));
  for (const selected of ['M1', 'M5', 'M15', 'H1'] as const) {
    const { mandatory, optional } = studyHistoryRequirements('XAUUSD', selected);
    assert.ok([...mandatory, ...optional].every(tf => STUDY_SECONDS[tf] >= STUDY_SECONDS[selected]));
  }
  assert.ok(studyHistoryRequirements('EURUSD', 'M1').mandatory.includes('D'));
  assert.ok(studyHistoryRequirements('EURUSD', 'M15').optional.includes('W'));
});

test('Gold M15 date loading succeeds when M1/M5 history is unavailable and never requests it', async () => {
  const opts = options(); opts.candles.M15 = [candle(fromTime + 900)];
  delete opts.candles.M1; delete opts.candles.M5;
  const requested: string[] = [];
  const result = await loadStudyDateHistory({ ...opts, symbol: 'XAUUSD', fetcher: async url => {
    const tf = new URL(String(url), 'http://test').searchParams.get('granularity')!;
    requested.push(tf);
    assert.ok(tf !== 'M1' && tf !== 'M5', 'M15 study must not request lower-timeframe history');
    return response(tf, context(tf as StudyTimeframe), 'XAUUSD');
  } });
  assert.deepEqual(requested, ['M15']);
  assert.equal(result.candles.M1, undefined);
  assert.equal(result.candles.M5, undefined);
  assert.deepEqual(result.warnings, []);
});

test('sufficient history reuses loaded candles without extra network requests', async () => {
  const opts = options();
  const result = await loadStudyDateHistory({ ...opts, fetcher: async () => { throw new Error('Unexpected fetch'); } });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.candles.M15, opts.candles.M15);
});

test('older pages merge without changing the live candle or mutating chart data', async () => {
  const opts = options();
  const live = candle(fromTime + 900, false);
  opts.candles.M15 = [live];
  const original = JSON.stringify(opts.candles);
  const calls: URL[] = [];
  const messages: string[] = [];
  const result = await loadStudyDateHistory({ ...opts, progress: m => messages.push(m),
    fetcher: async (url, init) => {
      calls.push(new URL(String(url), 'http://test'));
      assert.equal(init?.signal, opts.signal);
      return response('M15', [...context('M15'), candle(live.time), candle(cutoff + 100000)]);
    } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('endTime'), String(live.time - 1));
  assert.equal(result.candles.M15!.find(c => c.time === live.time)!.complete, false);
  assert.ok(result.candles.M15!.every(c => c.time <= cutoff));
  assert.equal(new Set(result.candles.M15!.map(c => c.time)).size, result.candles.M15!.length);
  assert.equal(JSON.stringify(opts.candles), original);
  assert.ok(messages.some(m => m.includes('M15')));
});

test('pagination continues until enough pre-date context is available', async () => {
  const opts = options(); opts.candles.M15 = [candle(fromTime + 900)];
  let pages = 0;
  const result = await loadStudyDateHistory({ ...opts, fetcher: async () => {
    pages++;
    return response('M15', pages === 1 ? [candle(fromTime - 900), candle(fromTime)] : context('M15'));
  } });
  assert.equal(pages, 2);
  assert.equal(result.candles.M15![0].time, context('M15')[0].time);
});

test('a stale feed ending before the selected period refreshes its latest page first', async () => {
  const opts = options(); opts.candles.M15 = context('M15').slice(0, -1);
  let calls = 0;
  const result = await loadStudyDateHistory({ ...opts, fetcher: async url => {
    calls++;
    assert.equal(new URL(String(url), 'http://test').searchParams.has('endTime'), false);
    return response('M15', [...context('M15'), candle(fromTime + 900)]);
  } });
  assert.equal(calls, 1);
  assert.equal(result.candles.M15!.at(-1)!.time, fromTime + 900);
});

test('missing mandatory coverage fails explicitly instead of silently shortening the selected dates', async () => {
  const opts = options(); opts.candles.M15 = [candle(fromTime + 900)];
  await assert.rejects(loadStudyDateHistory({ ...opts, fetcher: async () => response('M15', []) }), /Cannot study the full selected period.*M15/);
  await assert.rejects(loadStudyDateHistory({ ...opts, fetcher: async () => response('M15', context('M15'), 'GBPUSD') }), /different symbol or timeframe/);
});

test('limited warm-up history and unavailable optional lines are reported as coverage notes', async () => {
  const opts = options(); opts.candles.M15 = [candle(fromTime - 900), candle(fromTime)]; opts.candles.W = [];
  const result = await loadStudyDateHistory({ ...opts, fetcher: async url => {
    const tf = new URL(String(url), 'http://test').searchParams.get('granularity')!;
    return response(tf, []);
  } });
  assert.ok(result.warnings.some(m => m.includes('M15') && m.includes('Only 1 earlier candles')));
  assert.ok(result.warnings.some(m => m.includes('W') && m.includes('incomplete')));
});

test('cancelling history loading aborts the run and invalid date ranges never fetch', async () => {
  const opts = options(); const controller = new AbortController(); opts.candles.M15 = [];
  await assert.rejects(loadStudyDateHistory({ ...opts, signal: controller.signal, fetcher: async () => {
    controller.abort(); return response('M15', context('M15'));
  } }), { name: 'AbortError' });
  await assert.rejects(loadStudyDateHistory({ ...opts, fromTime: cutoff }), /start date/);
});

test('overlapping candle histories remain sorted and latest input wins', () => {
  const current = candle(200, false);
  assert.deepEqual(mergeStudyCandles([candle(200), candle(100)], [current, candle(300)]), [candle(100), current, candle(300)]);
});
