import { buildChartEntryHistory } from '../src/services/chartEntryData';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BOLLINGER_M5_MAX_SL_PIPS, BOLLINGER_STUDY_DEFAULTS, bollingerIndicators, bollingerH4Bias, runBollingerStudy,
  resolveBollingerBar, bollingerStats, bollingerMonthly, bollingerCsv, bollingerChartRecord,
  buildBollingerM5Signals, type BollingerRecord } from '../src/services/bollingerM5';
import { bollingerM5SignalError, isTradeStyleEnabled, mt5SignalDisabledReason, mt5StrategyRiskPercent,
  applySignalOppositePositionTarget } from '../src/services/mt5Automation';
import type { StructureCandle } from '../src/services/marketStructure';
import { buildCanonicalTradeRecords, filterTradeRecords } from '../src/services/tradeRecordFilters';
import { tradeExecutionKey } from '../src/services/tradeRecordDeduplication';

function fixture(sell = false) {
  const bar = (time: number, c: number): StructureCandle => ({ time, open: c - .02, high: c + .25, low: c - .25, close: c, complete: true });
  const mirror = (b: StructureCandle) => sell ? { ...b, open: 8000 - b.open, high: 8000 - b.low, low: 8000 - b.high, close: 8000 - b.close } : b;
  const m5 = Array.from({ length: 800 }, (_, i) => mirror(bar(1440000 + i * 300,
    4000 + i * .03 - (i % 50 === 40 ? 1.2 : i % 50 === 41 ? .3 : 0))));
  const h4 = Array.from({ length: 150 }, (_, i) => mirror(bar(i * 14400, 4000 + i * .3 + Math.sin(i) * 2)));
  return { ...BOLLINGER_STUDY_DEFAULTS, m5, h4, from: m5[0].time, cutoff: m5.at(-1)!.time + 300 };
}
const almost = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const position = (direction: 'BUY' | 'SELL' = 'BUY'): BollingerRecord => ({ id: 'test', signalAt: 300,
  entryAt: 600, direction, entry: 100, stopLoss: direction === 'BUY' ? 90 : 110,
  takeProfit: direction === 'BUY' ? 115 : 85, lot: .05, initialRisk: 50, outcome: 'OPEN' });
const candle = (open: number, high: number, low: number): StructureCandle => ({ time: 600, open, high, low, close: open, complete: true });
const costs = { spread: 0, commissionPerLot: 7, contractSize: 100, cutoff: 900 };

test('Bollinger indicators use population SD, SMA-seeded EMA and Wilder ATR/ADX with warmup', () => {
  const flat = Array.from({ length: 220 }, (_, i) => ({ time: i * 300, open: 100, high: 101, low: 99, close: 100 }));
  const indicators = bollingerIndicators(flat);
  assert.ok(Number.isNaN(indicators[198].ema));
  almost(indicators[199].ema, 100); almost(indicators[219].upper, 100); almost(indicators[219].lower, 100);
  almost(indicators[219].atr, 2); almost(indicators[219].adx, 0);
  const up = flat.map((b, i) => ({ ...b, open: i, close: i, high: i + 1, low: i - 1 }));
  almost(bollingerIndicators(up)[219].ema, 119.5);
  assert.ok(bollingerIndicators(up)[219].adx > 99);
});

test('H4 swing needs all three right-hand bars; future swings cannot change earlier bias', () => {
  const bars = [1, 2, 3, 10, 5, 4, 3, 11].map((high, i) => ({ time: i * 14400, open: high - .5, close: high - .5, high, low: high - 1 }));
  assert.deepEqual(bollingerH4Bias(bars), [0, 0, 0, 0, 0, 0, 0, 1]);
  const input = fixture(); const all = bollingerH4Bias(input.h4);
  for (let i = 7; i < input.h4.length; i++) assert.equal(bollingerH4Bias(input.h4.slice(0, i)).at(-1), all[i - 1]);
});

test('native replay creates both directions, one next-open entry and fixed 1.5R exits with bounded sizing', () => {
  for (const sell of [false, true]) {
    const input = fixture(sell), result = runBollingerStudy(input);
    assert.ok(result.records.length >= 3, 'synthetic fixture must exercise actual entries');
    for (const [i, r] of result.records.entries()) {
      assert.equal(r.direction, sell ? 'SELL' : 'BUY'); assert.equal(r.entryAt, r.signalAt + 300);
      const next = input.m5.find(b => b.time === r.entryAt)!;
      almost(r.entry, next.open + (sell ? -1 : 1) * input.spread / 2);
      almost(Math.abs(r.takeProfit - r.entry), Math.abs(r.entry - r.stopLoss) * 1.5);
      assert.ok(r.initialRisk + r.lot * input.commissionPerLot <= input.cashRisk + 1e-8);
      almost(r.lot / input.lotStep, Math.round(r.lot / input.lotStep));
      if (i) assert.ok(result.records[i - 1].resolvedAt! <= r.entryAt);
    }
    assert.equal(runBollingerStudy({ ...input, cashRisk: .01 }).records.length, 0);
  }
});

test('replay decisions are causal across cutoff and ignore partial confirmation candles', () => {
  const input = fixture(), first = runBollingerStudy(input).records[0], cutoff = first.entryAt + 10;
  const early = runBollingerStudy({ ...input, cutoff }); assert.equal(early.records.length, 1);
  assert.equal(early.records[0].outcome, 'OPEN');
  const mutate = (b: StructureCandle, seconds: number) => b.time + seconds > cutoff ? { ...b, high: b.high + 1000, low: b.low - 1000, close: b.close + 500 } : b;
  assert.deepEqual(runBollingerStudy({ ...input, cutoff, m5: input.m5.map(b => mutate(b, 300)), h4: input.h4.map(b => mutate(b, 14400)) }).records, early.records);
  const m5 = input.m5.map(b => b.time === first.signalAt ? { ...b, complete: false } : b);
  assert.equal(runBollingerStudy({ ...input, m5, cutoff }).records.length, 0);
  assert.equal(runBollingerStudy({ ...input, h4: [], cutoff }).records.length, 0);
});

test('80-pip SL cap skips wide buy/sell setups instead of tightening the original stop', () => {
  assert.equal(BOLLINGER_M5_MAX_SL_PIPS, 80);
  for (const sell of [false, true]) {
    const input = fixture(sell);
    const scale = (b: StructureCandle): StructureCandle => ({ ...b, open: 4000 + (b.open - 4000) * 10,
      high: 4000 + (b.high - 4000) * 10, low: 4000 + (b.low - 4000) * 10, close: 4000 + (b.close - 4000) * 10 });
    assert.ok(runBollingerStudy(input).records.length > 0);
    const wide = { ...input, m5: input.m5.map(scale), h4: input.h4.map(scale) };
    const result = runBollingerStudy(wide);
    assert.equal(result.records.length, 0);
    assert.ok(result.skipped > 0);
    const original = runBollingerStudy({ ...input, spread: 0, commissionPerLot: 0 }).records[0];
    assert.equal(buildBollingerM5Signals(wide.m5, wide.h4, original.entryAt + 10).length, 0);
    const base = buildBollingerM5Signals(input.m5, input.h4, original.entryAt + 10)[0];
    const sign = sell ? -1 : 1;
    for (const pips of [79.9, 80, 80.01]) {
      const risk = pips / 10, boundary = { ...base, stopLoss: base.entry - sign * risk,
        takeProfit: base.entry + sign * risk * 1.5, riskPips: pips };
      const error = bollingerM5SignalError(boundary);
      if (pips <= 80) assert.equal(error, undefined);
      else assert.match(error!, /80-pip/);
    }
  }
});

test('OHLC execution preserves uncertain paths, handles gaps, bid/ask, fees and incomplete bars', () => {
  const both = position(); resolveBollingerBar(both, candle(100, 116, 89), costs);
  assert.equal(both.outcome, 'UNCERTAIN'); assert.equal(both.pnl, undefined);
  const gap = position(); resolveBollingerBar(gap, candle(85, 116, 80), costs);
  assert.equal(gap.outcome, 'SL'); almost(gap.pnl!, -75.35);
  const favorableGap = position(); resolveBollingerBar(favorableGap, candle(120, 122, 89), costs);
  assert.equal(favorableGap.outcome, 'TP'); almost(favorableGap.exit!, 115);
  for (const direction of ['BUY', 'SELL'] as const) {
    const p = position(direction);
    resolveBollingerBar(p, direction === 'BUY' ? candle(100, 115.05, 99) : candle(100, 101, 84.95), { ...costs, spread: .3 });
    assert.equal(p.outcome, 'OPEN', 'mid touch is not necessarily an executable quote touch');
    resolveBollingerBar(p, direction === 'BUY' ? candle(100, 115.2, 99) : candle(100, 101, 84.8), { ...costs, spread: .3 });
    assert.equal(p.outcome, 'TP'); almost(p.pnl!, 74.65);
  }
  const pending = position(); resolveBollingerBar(pending, { ...candle(100, 120, 80), complete: false }, costs);
  assert.equal(pending.outcome, 'OPEN');
});

test('missing entry bar is skipped; an open-position history hole is never scored as a win', () => {
  const input = fixture(), first = runBollingerStudy(input).records[0];
  const missingEntry = runBollingerStudy({ ...input, m5: input.m5.filter(b => b.time !== first.entryAt) });
  assert.ok(!missingEntry.records.some(r => r.id === first.id)); assert.ok(missingEntry.skipped > 0);
  const gap = runBollingerStudy({ ...input, m5: input.m5.filter(b => b.time !== first.entryAt + 300) });
  assert.equal(gap.records[0].outcome, 'UNCERTAIN'); assert.equal(gap.records[0].pnl, undefined);
});

test('monthly cash, percent, R and CSV reconcile; unknown/open results do not inflate win rate', () => {
  const tp = { ...position(), outcome: 'TP' as const, pnl: 75, r: 1.5, resolvedAt: Date.UTC(2026, 0, 31) / 1000 };
  const sl = { ...position(), id: 'sl', outcome: 'SL' as const, pnl: -50, r: -1, resolvedAt: Date.UTC(2026, 1, 1) / 1000 };
  const unknown = { ...position(), id: 'unknown', outcome: 'UNCERTAIN' as const };
  const records = [tp, sl, unknown, position()], stats = bollingerStats(records, 5000), months = bollingerMonthly(records, 5000);
  assert.equal(stats.tp, 1); assert.equal(stats.sl, 1); assert.equal(stats.winPercent, 50);
  assert.equal(stats.pnl, 25); assert.equal(stats.percent, .5); assert.equal(stats.r, .5); assert.equal(stats.drawdown, 50);
  assert.equal(months.reduce((s, m) => s + m.pnl, 0), 25);
  const result = runBollingerStudy(fixture()); assert.equal(bollingerCsv(result).split('\r\n').length, result.records.length + 1);
});

test('live adapter shares replay rules, expires quickly, defaults OFF and has independent risk and exits', () => {
  const input = fixture(), first = runBollingerStudy({ ...input, spread: 0, commissionPerLot: 0 }).records[0];
  const signals = buildBollingerM5Signals(input.m5, input.h4, first.entryAt + 10);
  assert.equal(signals.length, 1); const signal = signals[0];
  assert.equal(signal.entry, first.entry); assert.equal(bollingerM5SignalError(signal), undefined);
  assert.ok(bollingerM5SignalError({ ...signal, takeProfit: signal.entry + 2 }));
  assert.ok(bollingerM5SignalError({ ...signal, orderType: 'LIMIT' }));
  assert.equal(buildBollingerM5Signals(input.m5, input.h4, first.entryAt + 121).length, 0);
  const config = { scalpingEnabled: true, intradayEnabled: true, enabledTimeframes: ['M5'] as const };
  assert.equal(isTradeStyleEnabled(config, signal), false);
  assert.match(mt5SignalDisabledReason(config, signal)!, /disabled/);
  assert.equal(mt5SignalDisabledReason({ ...config, bollingerM5Enabled: true }, signal), undefined);
  assert.equal(mt5StrategyRiskPercent({ riskPercent: 5 }, 'BOLLINGER_M5'), .25);
  assert.equal(mt5StrategyRiskPercent({ riskPercent: 5, bollingerM5RiskPercent: .5 }, 'BOLLINGER_M5'), .5);
  assert.deepEqual(applySignalOppositePositionTarget(signal, { positions: [] } as any), signal);
});

test('Bollinger chart history has its own identity and survives canonical accuracy validation', () => {
  const result = runBollingerStudy(fixture()), records = result.records.flatMap(r => bollingerChartRecord(r) ?? []);
  assert.ok(records.length); assert.equal(records[0].source, 'BOLLINGER'); assert.match(records[0].autoReason!, /not a broker fill/);
  assert.notEqual(tradeExecutionKey(records[0]), tradeExecutionKey({ ...records[0], tradeStyle: 'SCALPING' }));
  const canonical = buildCanonicalTradeRecords([], records, { marketSymbol: 'XAUUSD', pipSize: .1,
    requireLtfFib: false, timeframeData: {}, qualifyMtf: () => undefined });
  assert.equal(canonical.length, records.length);
  assert.equal(filterTradeRecords(canonical, { timeframes: 'ALL', datePeriod: 'MONTH', date: 'ALL', source: 'ALL', side: 'ALL', result: 'ALL', zones: 'ALL', tradeStyle: 'BOLLINGER_M5' }, 'UTC').length, records.length);
});


test('Bollinger chart arrows stay identical when admin history contains conflicting MT5 outcomes', () => {
  const result = runBollingerStudy(fixture());
  const records = result.records.flatMap(r => bollingerChartRecord(r) ?? []);
  assert.ok(records.length);
  const broker = records.map((r, i) => ({ ...r, id: `MT5:${i}`, brokerTicket: i + 1, result: 'sl' as const }));
  const options = { marketSymbol: 'XAUUSD', pipSize: .1, requireLtfFib: false, timeframeData: {}, qualifyMtf: () => undefined };
  assert.deepEqual(buildChartEntryHistory(broker, [...records, ...broker], options), buildChartEntryHistory([], records, options));
});
