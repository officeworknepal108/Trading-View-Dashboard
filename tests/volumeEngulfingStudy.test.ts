import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructureCandle } from '../src/services/marketStructure';
import { calculateTradeLevels, getMtfTradeRule } from '../src/services/tradeLevels';
import { evaluateStudyOutcome, STUDY_SECONDS, type StudySupport } from '../src/services/trendlineStudy';
import { loadVolumeStudyHistory, runVolumeStudy, volumeStudyBias, volumeStudyCsv, volumeStudyGroup,
  volumeStudyH4EmaSeries, volumeStudyH4EmaAt, volumeStudyEmaAllows, volumeStudyMonthlyStats,
  volumeStudyAtrAt, selectVolumeStudyH1FarSupport,
  volumeStudyLevels, volumeStudyRule, volumeStudyStats, VOLUME_STUDY_TIMEFRAMES,
  type VolumeStudyInput, type VolumeStudySignal } from '../src/services/volumeEngulfingStudy';

const candle = (time: number, open: number, high: number, low: number, close: number, volume = 100): StructureCandle =>
  ({ time, open, high, low, close, volume, complete: true });
const t1 = [candle(0, 103, 104, 100, 101, 1000), candle(300, 101, 107, 99, 106, 700)];
const t2 = [candle(0, 103, 104, 100, 101, 1000), candle(300, 101, 103, 99, 102, 1200),
  candle(600, 102, 108, 101, 107, 900)];
const t3 = [candle(0, 105, 110, 100, 101, 1000), candle(300, 101, 104, 99, 103, 1200),
  candle(600, 103, 107, 102, 106, 1100)];
const signal = (type: VolumeStudySignal['type'] = 'T1'): VolumeStudySignal => ({ type,
  direction: 'bullish', timeframe: 'M5', time: type === 'T1' ? 300 : 600, candleCount: type === 'T1' ? 2 : 3 });
const input = (source = t1): VolumeStudyInput => ({ symbol: 'XAUUSD', timeframe: 'M5', biasTimeframe: 'none',
  lookback: 2000, cutoff: 1500, candles: { M5: [...source, candle(source.at(-1)!.time + 300, 106, 115, 105, 110)] } });

const h4Seed = () => Array.from({ length: 50 }, (_, i) => candle(i * 14400, 100,
  i === 49 ? 151 : 101, 99, i === 49 ? 150 : 100));

test('entry ATR uses Wilder smoothing and excludes incomplete and future bars, including weekly', () => {
  for (const tf of ['M15', 'W'] as const) {
    const seconds = STUDY_SECONDS[tf];
    const source = Array.from({ length: 17 }, (_, i) => candle(i * seconds, 100,
      i === 15 ? 104 : i === 16 ? 150 : 102, i === 15 ? 96 : 98, 100));
    assert.equal(volumeStudyAtrAt(source, tf, 14 * seconds), undefined);
    assert.equal(volumeStudyAtrAt(source, tf, 15 * seconds), 4);
    assert.ok(Math.abs(volumeStudyAtrAt(source, tf, 16 * seconds)! - 60 / 14) < 1e-9);
    assert.equal(volumeStudyAtrAt(source.map((c, i) => i === 15 ? { ...c, complete: false } : c), tf, 16 * seconds), 4);
  }
});

test('H1 Far selector requires matching continuation colour, closed confirmation and distance above half ATR', () => {
  const h1 = Array.from({ length: 3 }, (_, i) => candle(i * 3600, 100, 102, 98, 100));
  const line: StudySupport = { timeframe: 'H1', kind: 'continuation', color: 'green', firstTime: 0,
    secondTime: 3600, confirmedAt: 7200, geometry: { time: 7200, price: 100, slope: 0 } };
  const pick = (support: StudySupport[], entry = 102.1, atr: number | undefined = 4,
    direction: 'bullish' | 'bearish' = 'bullish') => selectVolumeStudyH1FarSupport(support, h1, direction, 10800, entry, atr, .1);
  assert.equal(pick([line], 102), undefined);
  const result = pick([line])!;
  assert.equal(result.distance?.band, 'Far');
  assert.ok(Math.abs(result.distance!.pips - 21) < 1e-9);
  assert.ok(Math.abs(result.distance!.atrRatio! - .525) < 1e-9);
  assert.equal(line.distance, undefined, 'the original line is not mutated');
  assert.equal(pick([{ ...line, kind: 'breakout' }]), undefined);
  assert.equal(pick([{ ...line, timeframe: 'H4' }]), undefined);
  assert.equal(pick([{ ...line, color: 'red' }]), undefined);
  assert.equal(pick([{ ...line, confirmedAt: 10801 }]), undefined);
  assert.equal(pick([line], 102.1, 0), undefined);
  assert.equal(selectVolumeStudyH1FarSupport([line], h1, 'bullish', 10800, 102.1, undefined, .1), undefined);
  assert.ok(pick([{ ...line, color: 'red' }], 97.9, 4, 'bearish'));
  assert.equal(pick([{ ...line, geometry: undefined }]), undefined);
});

test('H1 filter fails safely without history or ATR and does not affect the original run when off', () => {
  const offset = 9 * 3600 - 600;
  const source = input().candles.M5!.map(c => ({ ...c, time: c.time + offset }));
  const h1 = Array.from({ length: 9 }, (_, i) => candle(i * 3600, 100, 102, 98, 100));
  const settings: VolumeStudyInput = { ...input(), cutoff: 9 * 3600 + 900, candles: { M5: source, H1: h1 } };
  assert.equal(runVolumeStudy(settings).records.length, 1);
  assert.throws(() => runVolumeStudy({ ...settings, h1TrendlineFilter: true, candles: { M5: source } }), /9 closed H1 candles/);
  const rejected = runVolumeStudy({ ...settings, h1TrendlineFilter: true });
  assert.equal(rejected.records.length, 0);
  assert.equal(rejected.trendlineRejected, 1);
  assert.ok(rejected.warnings.some(w => /ATR14 was unavailable/.test(w)));
});

test('H1 filter loads its own history and deduplicates the selected H1 structure bias', async () => {
  const requested: string[] = [];
  const fetcher: typeof fetch = async url => {
    const tf = new URL(String(url), 'http://localhost').searchParams.get('granularity')!;
    requested.push(tf);
    return new Response(JSON.stringify({ ok: true, symbol: 'XAUUSD', granularity: tf, candles: t1 }));
  };
  const loaded = await loadVolumeStudyHistory({ ...input(), h1TrendlineFilter: true }, new AbortController().signal, () => {}, fetcher);
  assert.ok(loaded.H1);
  assert.equal(requested.filter(tf => tf === 'H1').length, 1);
  requested.length = 0;
  await loadVolumeStudyHistory({ ...input(), biasTimeframe: 'H1', h1TrendlineFilter: true }, new AbortController().signal, () => {}, fetcher);
  assert.equal(requested.filter(tf => tf === 'H1').length, 1);
});

test('CSV includes H1 filter setting and selected line evidence', () => {
  const result = runVolumeStudy(input());
  result.settings.h1TrendlineFilter = true;
  result.records[0].h1Trendline = { timeframe: 'H1', kind: 'continuation', color: 'green',
    firstTime: 0, secondTime: 3600, confirmedAt: 7200,
    distance: { linePrice: 100, pips: 21, atrRatio: .525, band: 'Far' } };
  const csv = volumeStudyCsv(result);
  assert.match(csv, /H1 continuation Far filter/);
  assert.match(csv, /H1 line confirmed UTC/);
  assert.match(csv, /"on","1970-01-01T02:00:00.000Z","100","21","0.525","Far"/);
});

test('H4 EMA uses SMA seeds and only candles closed at the historical confirmation', () => {
  const source = [...h4Seed(), candle(50 * 14400, 100, 101, 0, 1)];
  const series = volumeStudyH4EmaSeries(source, 51 * 14400);
  assert.equal(volumeStudyH4EmaAt(series, 50 * 14400 - 1), undefined);
  const at = volumeStudyH4EmaAt(series, 50 * 14400)!;
  assert.equal(at.time, 49 * 14400);
  assert.ok(Math.abs(at.ema20 - (100 + 100 / 21)) < 1e-9);
  assert.equal(at.ema50, 101);
  assert.ok(volumeStudyEmaAllows(at, 'bullish'));
  assert.equal(volumeStudyEmaAllows(at, 'bearish'), false);
  const next = volumeStudyH4EmaAt(series, 51 * 14400)!;
  assert.ok(volumeStudyEmaAllows(next, 'bearish'));
  assert.equal(volumeStudyEmaAllows(undefined, 'bullish'), false);
  assert.equal(volumeStudyEmaAllows({ time: 0, ema20: 100, ema50: 100 }, 'bullish'), false);
  assert.equal(volumeStudyEmaAllows({ time: 0, ema20: 100, ema50: 100 }, 'bearish'), false);
  assert.equal(volumeStudyH4EmaSeries(h4Seed().map(c => ({ ...c, complete: false })), 51 * 14400).length, 0);
});

test('EMA filter preserves allowed entry levels, rejects opposite signals and exports evidence', () => {
  const offset = 50 * 14400 - 600;
  const source = input().candles.M5!.map(c => ({ ...c, time: c.time + offset }));
  const settings: VolumeStudyInput = { ...input(), cutoff: 50 * 14400 + 900,
    candles: { M5: source, H4: [...h4Seed(), candle(50 * 14400, 100, 101, 0, 1)] } };
  const original = runVolumeStudy(settings);
  const filtered = runVolumeStudy({ ...settings, h4EmaFilter: true });
  assert.equal(filtered.records.length, 1);
  assert.deepEqual(filtered.records[0].levels, original.records[0].levels);
  assert.deepEqual(filtered.records[0].h4Ema, volumeStudyH4EmaAt(volumeStudyH4EmaSeries(h4Seed(), settings.cutoff), 50 * 14400));
  assert.match(volumeStudyCsv(filtered), /H4 EMA filter/);
  assert.match(volumeStudyCsv(filtered), /"on"/);
  assert.match(volumeStudyCsv(original), /"off"/);
  const sell = source.map(c => ({ ...c, open: 220 - c.open, high: 220 - c.low, low: 220 - c.high, close: 220 - c.close }));
  const rejected = runVolumeStudy({ ...settings, h4EmaFilter: true, candles: { ...settings.candles, M5: sell } });
  assert.equal(rejected.records.length, 0);
  assert.equal(rejected.emaRejected, 1);
  assert.throws(() => runVolumeStudy({ ...settings, h4EmaFilter: true, candles: { M5: source, H4: h4Seed().slice(0, 49) } }), /50 closed H4/);
});

test('EMA cannot use a future historical snapshot to approve an earlier entry', () => {
  const offset = 49 * 14400 - 600;
  const source = input().candles.M5!.map(c => ({ ...c, time: c.time + offset }));
  const result = runVolumeStudy({ ...input(), cutoff: 50 * 14400 + 900,
    h4EmaFilter: true, candles: { M5: source, H4: h4Seed() } });
  assert.equal(result.records.length, 0);
  assert.equal(result.emaRejected, 1);
  assert.ok(result.warnings.some(w => /50 closed H4 candles were not yet available/.test(w)));
});

test('enabling H4 EMA loads H4 candles even without a structure bias', async () => {
  const requested: string[] = [];
  const fetcher: typeof fetch = async url => {
    const query = new URL(String(url), 'http://localhost').searchParams;
    const tf = query.get('granularity')!; requested.push(tf);
    return new Response(JSON.stringify({ ok: true, symbol: 'XAUUSD', granularity: tf,
      candles: tf === 'H4' ? h4Seed() : t1 }));
  };
  const loaded = await loadVolumeStudyHistory({ ...input(), h4EmaFilter: true },
    new AbortController().signal, () => {}, fetcher);
  assert.ok(requested.includes('H4'));
  assert.equal(loaded.H4?.length, 50);
});

test('monthly summary groups by UTC signal month and excludes open outcomes from win rate', () => {
  const record = runVolumeStudy(input()).records[0];
  const rows = [
    { ...record, signal: { ...record.signal, time: Date.parse('2026-01-31T23:45:00Z') / 1000 }, outcome: 'tp' as const },
    { ...record, signal: { ...record.signal, time: Date.parse('2026-02-01T00:00:00Z') / 1000 }, outcome: 'sl' as const },
    { ...record, signal: { ...record.signal, time: Date.parse('2026-02-01T00:15:00Z') / 1000 }, outcome: 'active' as const },
  ];
  const monthly = volumeStudyMonthlyStats(rows);
  assert.deepEqual(monthly.map(m => m.month), ['2026-01', '2026-02']);
  assert.equal(monthly[0].tp, 1);
  assert.equal(monthly[1].total, 2);
  assert.equal(monthly[1].sl, 1);
  assert.equal(monthly[1].unresolved, 1);
  assert.equal(monthly[1].winRate, 0);
});

test('8,000-bar study includes older patterns outside the 5,000-bar window and rejects larger limits', () => {
  const source = Array.from({ length: 8010 }, (_, i) => candle(i * 300, 103, 104, 102, 103));
  source[20] = { ...t1[0], time: 20 * 300 };
  source[21] = { ...t1[1], time: 21 * 300 };
  const settings: VolumeStudyInput = { ...input(), cutoff: 8010 * 300, candles: { M5: source }, lookback: 8000 };
  const extended = runVolumeStudy(settings);
  assert.equal(extended.from, source[10].time);
  assert.ok(extended.records.some(r => r.signal.time === source[21].time));
  assert.equal(runVolumeStudy({ ...settings, lookback: 5000 }).records.length, 0);
  assert.throws(() => runVolumeStudy({ ...settings, lookback: 8001 }), /Invalid study settings/);
});

test('5,000-bar lookback still loads extra pattern context', async () => {
  const source = Array.from({ length: 5010 }, (_, i) => candle(i * 300, 103, 104, 102, 103));
  const requests: URLSearchParams[] = [];
  const fetcher: typeof fetch = async url => {
    const query = new URL(String(url), 'http://localhost').searchParams;
    requests.push(query);
    return new Response(JSON.stringify({ ok: true, symbol: 'XAUUSD', granularity: 'M5',
      candles: query.get('count') === '10' ? source.slice(0, 10) : source.slice(10) }));
  };
  const loaded = await loadVolumeStudyHistory({ ...input(), candles: {}, cutoff: 5010 * 300, lookback: 5000 },
    new AbortController().signal, () => {}, fetcher);
  assert.equal(loaded.M5?.length, 5010);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].get('endTime'), String(source[10].time - 1));
  assert.equal(requests[1].get('count'), '10');
});

test('8,000-bar history pages backward below the feed limit and deduplicates overlaps', async () => {
  const source = Array.from({ length: 8010 }, (_, i) => candle(i * 300, 103, 104, 102, 103));
  const requests: URLSearchParams[] = [];
  const fetcher: typeof fetch = async url => {
    const query = new URL(String(url), 'http://localhost').searchParams;
    requests.push(query);
    return new Response(JSON.stringify({ ok: true, symbol: 'XAUUSD', granularity: 'M5',
      candles: requests.length === 1 ? source.slice(3010) : source.slice(0, 3020) }));
  };
  const loaded = await loadVolumeStudyHistory({ ...input(), candles: {}, cutoff: 8010 * 300, lookback: 8000 },
    new AbortController().signal, () => {}, fetcher);
  assert.equal(loaded.M5?.length, 8010);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].get('endTime'), String(source[3010].time - 1));
  assert.equal(requests[1].get('count'), '3010');
  assert.ok(requests.every(q => Number(q.get('count')) <= 5000));
});

test('history stops when the provider repeats a page and reports a shorter available window', async () => {
  const source = Array.from({ length: 5000 }, (_, i) => candle(i * 300, 103, 104, 102, 103));
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ ok: true, symbol: 'XAUUSD', granularity: 'M5', candles: source }));
  };
  const settings: VolumeStudyInput = { ...input(), candles: {}, cutoff: 5000 * 300, lookback: 8000 };
  const candles = await loadVolumeStudyHistory(settings, new AbortController().signal, () => {}, fetcher);
  assert.equal(requests, 2);
  assert.equal(candles.M5?.length, 5000);
  assert.ok(runVolumeStudy({ ...settings, candles }).warnings.some(w => /Requested 8000.*5000/.test(w)));
});

test('provider history limit retains usable candles while cancellation still aborts pagination', async () => {
  const source = Array.from({ length: 5000 }, (_, i) => candle(i * 300, 103, 104, 102, 103));
  const settings: VolumeStudyInput = { ...input(), candles: {}, cutoff: 5000 * 300, lookback: 8000 };
  let requests = 0;
  const fetcher: typeof fetch = async () => ++requests === 1
    ? new Response(JSON.stringify({ ok: true, symbol: 'XAUUSD', granularity: 'M5', candles: source }))
    : new Response(JSON.stringify({ ok: false, error: 'No earlier history.' }), { status: 400 });
  const loaded = await loadVolumeStudyHistory(settings, new AbortController().signal, () => {}, fetcher);
  assert.equal(loaded.M5?.length, 5000);
  const controller = new AbortController();
  requests = 0;
  await assert.rejects(loadVolumeStudyHistory(settings, controller.signal, () => {}, async () => {
    if (++requests > 1) { controller.abort(); throw new DOMException('Aborted', 'AbortError'); }
    return new Response(JSON.stringify({ ok: true, symbol: 'XAUUSD', granularity: 'M5', candles: source }));
  }), { name: 'AbortError' });
});

test('T1 volume requires a strict decrease; equality and unavailable data are excluded', () => {
  assert.equal(volumeStudyGroup(t1, signal())?.group, 'V2 < V1');
  for (const volume of [1000, 1100, undefined, NaN]) {
    assert.equal(volumeStudyGroup([t1[0], { ...t1[1], volume }], signal()), undefined);
  }
});

test('T2 and T3 split V3 below V2 only from V3 below both, including equal V1 boundary', () => {
  for (const type of ['T2', 'T3'] as const) {
    for (const [v3, expected] of [[1100, 'V3 < V2 only'], [1000, 'V3 < V2 only'], [900, 'V3 < V2 and V1']] as const) {
      assert.equal(volumeStudyGroup([...t2.slice(0, 2), { ...t2[2], volume: v3 }], signal(type))?.group, expected);
    }
    assert.equal(volumeStudyGroup([...t2.slice(0, 2), { ...t2[2], volume: 1200 }], signal(type)), undefined);
    assert.equal(volumeStudyGroup([{ ...t2[0], volume: undefined }, ...t2.slice(1)], signal(type)), undefined);
  }
});

test('study recognizes existing T1/T2/T3 confirmation patterns and excludes T4', () => {
  for (const [type, candles] of [['T1', t1], ['T2', t2], ['T3', t3]] as const) {
    const result = runVolumeStudy(input([...candles]));
    assert.equal(result.records[0]?.signal.type, type);
    assert.equal(result.records[0]?.levels.rewardRisk, 1);
  }
  const t4 = [candle(0, 101, 104, 100, 103, 1000), candle(300, 102, 103, 101, 102.5, 900),
    candle(600, 103, 109, 102, 108, 700)];
  assert.equal(runVolumeStudy(input(t4)).records.length, 0);
});

test('study uses the approved M15 buffer without changing other buffers, production rules or risk caps', () => {
  for (const tf of VOLUME_STUDY_TIMEFRAMES) {
    const baseTf = ['M1', 'M5', 'M15', 'M30'].includes(tf) ? tf as 'M1' | 'M5' | 'M15' | 'M30' : 'M30';
    const before = getMtfTradeRule(baseTf, baseTf)!;
    const study = volumeStudyRule(tf);
    assert.equal(study.stopBufferPips, tf === 'M1' || tf === 'M5' ? 10 : tf === 'M15' ? 30 : 20);
    assert.equal(study.maximumRiskPips, before.maximumRiskPips);
    assert.equal(study.rewardRisk, 1);
    assert.deepEqual(getMtfTradeRule(baseTf, baseTf), before);
    assert.equal(before.stopBufferPips, baseTf === 'M1' || baseTf === 'M5' ? 10 : 20);
  }
});

test('entry, buffered SL, and capped pending orders match production calculation with study buffer and 1R overrides', () => {
  for (const timeframe of ['M1', 'M5', 'M15', 'M30'] as const) {
    const seconds = STUDY_SECONDS[timeframe];
    const source = t1.map((c, i) => ({ ...c, time: i * seconds }));
    for (const sell of [false, true]) for (const open of [106, 150]) {
      const prices = sell ? source.map(c => ({ ...c, open: 220 - c.open, high: 220 - c.low,
        low: 220 - c.high, close: 220 - c.close })) : source;
      const s: VolumeStudySignal = { ...signal(), timeframe, time: seconds, direction: sell ? 'bearish' : 'bullish' };
      const execution = candle(2 * seconds, sell ? 220 - open : open, sell ? 220 - open : open,
        sell ? 220 - open : open, sell ? 220 - open : open);
      const actual = volumeStudyLevels(prices, s, execution);
      const production = calculateTradeLevels({ sourceCandles: prices, executionCandles: [execution],
        signal: { ...s, timeframe }, rule: volumeStudyRule(timeframe), riskFreeEnabled: false })!;
      if (!production) { assert.equal(actual, undefined, 'already missed capped targets are excluded'); continue; }
      for (const key of ['entry', 'stopLoss', 'takeProfit', 'pendingAtCreation', 'riskPips'] as const) {
        assert.equal(actual[key], production[key], `${timeframe} ${sell ? 'SELL' : 'BUY'} ${key}`);
      }
      assert.equal(Math.abs(actual.takeProfit - actual.entry), Math.abs(actual.entry - actual.stopLoss));
    }
  }
});

test('all eight chart timeframes support studies, including weekly', () => {
  for (const timeframe of VOLUME_STUDY_TIMEFRAMES) {
    const seconds = STUDY_SECONDS[timeframe];
    const candles = [...t1, candle(600, 106, 115, 105, 110)].map((c, i) => ({ ...c, time: i * seconds }));
    const result = runVolumeStudy({ ...input(), timeframe, cutoff: 3 * seconds, candles: { [timeframe]: candles } });
    assert.equal(result.records[0]?.signal.timeframe, timeframe);
    assert.equal(result.records[0]?.levels.rewardRisk, 1);
  }
});

test('forming engulfing candles cannot qualify; next forming entry candle uses only its open', () => {
  const formingPattern = runVolumeStudy({ ...input(), candles: { M5: [t1[0], { ...t1[1], complete: false }, candle(600, 106, 108, 105, 107)] } });
  assert.equal(formingPattern.records.length, 0);
  const next = candle(600, 106, 500, 0, 200);
  const active = runVolumeStudy({ ...input(), cutoff: 600, candles: { M5: [...t1, next] } });
  assert.equal(active.records[0]?.outcome, 'active');
  assert.equal(active.records[0]?.levels.entry, 106);
  assert.equal(active.records[0]?.resolvedAt, undefined);
});

test('bias ignores future and incomplete candles and skips neutral historical bias', () => {
  const bias = Array.from({ length: 20 }, (_, i) => candle(i * 3600, 100 + i * 2, 104 + i * 2, 99 + i * 2, 103 + i * 2));
  const at = 15 * 3600;
  const expected = volumeStudyBias(bias.slice(0, 15), 'H1', at);
  assert.equal(volumeStudyBias(bias, 'H1', at), expected);
  const changedFuture = bias.map((c, i) => i < 15 ? c : candle(c.time, 900, 1000, 0, 1));
  assert.equal(volumeStudyBias(changedFuture, 'H1', at), expected);
  assert.equal(volumeStudyBias(bias.map(c => ({ ...c, complete: false })), 'H1', at), 'neutral');
  // There is ample later bias history, but less than 12 closed bars at entry.
  const result = runVolumeStudy({ ...input(), cutoff: 20 * 3600, biasTimeframe: 'H1', candles: { ...input().candles, H1: bias } });
  assert.equal(result.records.length, 0);
  assert.equal(result.biasRejected, 1);
});

test('historical bias admits aligned direction and rejects opposite direction', () => {
  const bias = Array.from({ length: 20 }, (_, i) => candle(i * 3600, 100 + i * 2, 104 + i * 2, 99 + i * 2, 103 + i * 2));
  const at = 15 * 3600;
  const direction = volumeStudyBias(bias, 'H1', at);
  assert.notEqual(direction, 'neutral');
  for (const aligned of [true, false]) {
    const buy = aligned ? direction === 'bullish' : direction !== 'bullish';
    const shifted = input().candles.M5!.map(c => ({ ...c, time: c.time + at - 600 }));
    const source = buy ? shifted : shifted.map(c => ({ ...c, open: 220 - c.open, high: 220 - c.low,
      low: 220 - c.high, close: 220 - c.close }));
    const result = runVolumeStudy({ ...input(), cutoff: 20 * 3600, biasTimeframe: 'H1', candles: { M5: source, H1: bias } });
    assert.equal(result.records.length, aligned ? 1 : 0);
    if (aligned) assert.equal(result.records[0].bias, direction);
  }
});

test('same-bar SL and TP stays ambiguous and is excluded from win rate', () => {
  const levels = volumeStudyLevels(t1, signal(), candle(600, 106, 106, 106, 106))!;
  const outcome = evaluateStudyOutcome(levels, [candle(600, 106, 120, 90, 108)], 'fixed');
  assert.equal(outcome.outcome, 'ambiguous');
  const record = runVolumeStudy(input()).records[0];
  const stats = volumeStudyStats([{ ...record, ...outcome }, { ...record, outcome: 'tp', returnR: 1 },
    { ...record, outcome: 'sl', returnR: -1 }]);
  assert.equal(stats.winRate, 50);
  assert.equal(stats.netR, 0);
  assert.equal(stats.unresolved, 1);
});

test('history loads only requested timeframes and pins pages to the replay cutoff', async () => {
  const requests: URLSearchParams[] = [];
  const settings = { ...input(), biasTimeframe: 'H1' as const };
  const fetcher: typeof fetch = async url => {
    const query = new URL(String(url), 'http://localhost').searchParams;
    requests.push(query);
    return new Response(JSON.stringify({ ok: true, symbol: 'XAUUSD', granularity: query.get('granularity'), candles: t1 }));
  };
  const loaded = await loadVolumeStudyHistory(settings, new AbortController().signal, () => {}, fetcher);
  assert.deepEqual(Object.keys(loaded).sort(), ['H1', 'M5']);
  const initialRequests = requests.filter(q => q.get('count') === '5000');
  assert.equal(initialRequests.length, 2);
  assert.ok(initialRequests.every(q => q.get('endTime') === String(settings.cutoff - 1)));
  assert.ok(requests.every(q => Number(q.get('endTime')) < settings.cutoff));
  await assert.rejects(loadVolumeStudyHistory(settings, new AbortController().signal, () => {}, async () =>
    new Response(JSON.stringify({ ok: true, symbol: 'EURUSD', granularity: 'M5', candles: t1 }))), /Invalid/);
});

test('CSV contains volume groups, bias and fixed reward risk', () => {
  const csv = volumeStudyCsv(runVolumeStudy(input(t3)));
  assert.match(csv, /Bias at confirmation/);
  assert.match(csv, /V3 < V2 only/);
  assert.match(csv, /"V1","V2","V3"/);
  assert.match(csv, /"1","tp"/);
});
