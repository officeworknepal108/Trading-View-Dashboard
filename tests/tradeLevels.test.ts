import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessEngulfingVolumeLogic,
  calculateHalfAtOneRResult,
  calculateTradeLevels,
  getDirectTradeRule,
  getEngulfingVolumeStatus,
  getMtfTradeRule,
  isDeepDiscountTradeSignal,
  resolveDirectEntryPolicy,
  type EngulfingTradeSignal,
} from '../src/services/tradeLevels';
import type { StructureCandle, StructureZone } from '../src/services/marketStructure';

const bullishSignal: EngulfingTradeSignal = {
  type: 'T1',
  direction: 'bullish',
  time: 60,
  candleCount: 2,
  timeframe: 'M1',
};

test('half-at-1R management reports the correct net R outcome', () => {
  assert.equal(calculateHalfAtOneRResult('sl', 3), -1);
  assert.equal(calculateHalfAtOneRResult('rf', 3), 0);
  assert.equal(calculateHalfAtOneRResult('tp', 1), 1);
  assert.equal(calculateHalfAtOneRResult('tp', 2), 1.5);
  assert.equal(calculateHalfAtOneRResult('tp', 3), 2);
});

function volumeCandle(time: number, volume?: number): StructureCandle {
  return { time, open: 10, high: 12, low: 9, close: 11, volume, complete: true };
}

test('Type 1 volume logic requires the second volume to be strictly smaller than the first', () => {
  assert.deepEqual(
    assessEngulfingVolumeLogic(
      [volumeCandle(0, 120), volumeCandle(60, 80)],
      bullishSignal,
    ),
    {
      applicable: true,
      passes: true,
      bestQuality: false,
      firstVolume: 120,
      secondVolume: 80,
    },
  );
  assert.equal(assessEngulfingVolumeLogic(
    [volumeCandle(0, 120), volumeCandle(60, 120)],
    bullishSignal,
  ).passes, false);
  assert.equal(assessEngulfingVolumeLogic(
    [volumeCandle(0, 80), volumeCandle(60, 120)],
    bullishSignal,
  ).passes, false);
});

test('Type 2 and Type 3 require V3 below V2 and mark V3 below V1 as best quality', () => {
  for (const type of ['T2', 'T3'] as const) {
    const signal: EngulfingTradeSignal = {
      ...bullishSignal,
      type,
      time: 120,
      candleCount: 3,
    };
    const valid = assessEngulfingVolumeLogic(
      [volumeCandle(0, 50), volumeCandle(60, 120), volumeCandle(120, 80)],
      signal,
    );
    assert.equal(valid.passes, true);
    assert.equal(valid.bestQuality, false);

    const best = assessEngulfingVolumeLogic(
      [volumeCandle(0, 100), volumeCandle(60, 120), volumeCandle(120, 40)],
      signal,
    );
    assert.equal(best.passes, true);
    assert.equal(best.bestQuality, true);

    assert.equal(assessEngulfingVolumeLogic(
      [volumeCandle(0, 100), volumeCandle(60, 80), volumeCandle(120, 80)],
      signal,
    ).passes, false);
  }
});

test('volume logic excludes Type 4 and fails safely when required volume is missing', () => {
  assert.deepEqual(assessEngulfingVolumeLogic([], {
    ...bullishSignal,
    type: 'T4',
  }), { applicable: false, passes: false, bestQuality: false });
  assert.equal(assessEngulfingVolumeLogic(
    [volumeCandle(0, 120), volumeCandle(60)],
    bullishSignal,
  ).passes, false);
});

test('volume assessment reports valid, best, failed, unavailable, and not-applicable states', () => {
  assert.equal(getEngulfingVolumeStatus({ applicable: true, passes: true, bestQuality: false, firstVolume: 2, secondVolume: 1 }, 'T1'), 'valid');
  assert.equal(getEngulfingVolumeStatus({ applicable: true, passes: true, bestQuality: true, firstVolume: 3, secondVolume: 2, thirdVolume: 1 }, 'T2'), 'best');
  assert.equal(getEngulfingVolumeStatus({ applicable: true, passes: false, bestQuality: false, firstVolume: 1, secondVolume: 2 }, 'T1'), 'failed');
  assert.equal(getEngulfingVolumeStatus({ applicable: true, passes: false, bestQuality: false, firstVolume: 1, secondVolume: 2 }, 'T3'), 'unavailable');
  assert.equal(getEngulfingVolumeStatus({ applicable: false, passes: false, bestQuality: false }, 'T4'), 'not-applicable');
});

test('direct M1 policy uses volume as observation only and never changes normal entry rules', () => {
  const baseRule = getDirectTradeRule('M1', 'M1')!;
  const validVolume = [volumeCandle(0, 120), volumeCandle(60, 80)];
  const invalidVolume = [volumeCandle(0, 80), volumeCandle(60, 120)];

  const aligned = resolveDirectEntryPolicy({
    zoneTimeframe: 'M1',
    signal: bullishSignal,
    sourceCandles: invalidVolume,
    baseRule,
    m5Trend: 'bullish',
    m15Trend: 'bullish',
  });
  assert.equal(aligned.allowed, true);
  assert.equal(aligned.rule?.rewardRisk, 3);

  const validCounterTrendVolume = resolveDirectEntryPolicy({
    zoneTimeframe: 'M1',
    signal: bullishSignal,
    sourceCandles: validVolume,
    baseRule,
    m5Trend: 'bearish',
    m15Trend: 'bearish',
  });
  assert.equal(validCounterTrendVolume.allowed, false);
  assert.equal(validCounterTrendVolume.reason, 'blocked');
  assert.equal(validCounterTrendVolume.rule, undefined);
  assert.equal(validCounterTrendVolume.volume.passes, true);

  const blocked = resolveDirectEntryPolicy({
    zoneTimeframe: 'M1',
    signal: bullishSignal,
    sourceCandles: invalidVolume,
    baseRule,
    m5Trend: 'bearish',
    m15Trend: 'bearish',
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.rule, undefined);

  const bearishCounterTrendVolume = resolveDirectEntryPolicy({
    zoneTimeframe: 'M1',
    signal: { ...bullishSignal, direction: 'bearish' },
    sourceCandles: validVolume,
    baseRule,
    m5Trend: 'bullish',
    m15Trend: 'bullish',
  });
  assert.equal(bearishCounterTrendVolume.allowed, false);
  assert.equal(bearishCounterTrendVolume.volume.passes, true);

  const disagreementWithoutVolume = resolveDirectEntryPolicy({
    zoneTimeframe: 'M1',
    signal: bullishSignal,
    sourceCandles: invalidVolume,
    baseRule,
    m5Trend: 'bullish',
    m15Trend: 'neutral',
  });
  assert.equal(disagreementWithoutVolume.allowed, false);
});

test('direct M5 entries remain unchanged by the M1 policy', () => {
  const baseRule = getDirectTradeRule('M5', 'M5')!;
  const decision = resolveDirectEntryPolicy({
    zoneTimeframe: 'M5',
    signal: { ...bullishSignal, timeframe: 'M5' },
    sourceCandles: [],
    baseRule,
    m5Trend: 'bearish',
    m15Trend: 'bearish',
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'unchanged');
  assert.equal(decision.rule?.rewardRisk, 2);
});

test('finalized direct trade matrix returns the agreed R:R, buffer, and risk caps', () => {
  assert.deepEqual(getDirectTradeRule('M1', 'M1'), {
    zoneTimeframe: 'M1', engulfingTimeframe: 'M1', rewardRisk: 3,
    stopBufferPips: 10, maximumRiskPips: 50,
  });
  assert.equal(getDirectTradeRule('M1', 'M5')?.rewardRisk, 2);
  assert.equal(getDirectTradeRule('M5', 'M15')?.rewardRisk, 1);
  assert.equal(getDirectTradeRule('M15', 'M30')?.maximumRiskPips, 300);
  assert.deepEqual(getDirectTradeRule('H1', 'M15'), {
    zoneTimeframe: 'H1', engulfingTimeframe: 'M15', rewardRisk: 2,
    stopBufferPips: 20, maximumRiskPips: 200,
  });
  assert.deepEqual(getDirectTradeRule('H1', 'M30'), {
    zoneTimeframe: 'H1', engulfingTimeframe: 'M30', rewardRisk: 2,
    stopBufferPips: 20, maximumRiskPips: 300,
  });
});

test('immediate entry calculates SL, 1R, 3R TP, and actual risk pips', () => {
  const sourceCandles: StructureCandle[] = [
    { time: 0, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 60, open: 10, high: 14, low: 9.5, close: 13.5, complete: true },
  ];
  const executionCandles: StructureCandle[] = [
    ...sourceCandles,
    { time: 120, open: 11, high: 12, low: 10.5, close: 11.5, complete: false },
  ];
  const trade = calculateTradeLevels({
    sourceCandles,
    executionCandles,
    signal: bullishSignal,
    rule: getDirectTradeRule('M1', 'M1')!,
  });

  assert.equal(trade?.stopLoss, 8);
  assert.equal(trade?.entry, 11);
  assert.equal(trade?.riskPips, 30);
  assert.equal(trade?.riskFree, 14);
  assert.equal(trade?.takeProfit, 20);
  assert.equal(trade?.status, 'active');
});

test('deep-discount entry places SL at liquidity without the timeframe buffer', () => {
  const sourceCandles: StructureCandle[] = [
    { time: 0, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 60, open: 10, high: 14, low: 9.5, close: 13.5, complete: true },
  ];
  const trade = calculateTradeLevels({
    sourceCandles,
    executionCandles: [
      ...sourceCandles,
      { time: 120, open: 11, high: 12, low: 10.5, close: 11.5, complete: false },
    ],
    signal: bullishSignal,
    rule: getDirectTradeRule('M1', 'M1')!,
    omitStopBuffer: true,
  });

  assert.equal(trade?.stopLoss, 9);
  assert.equal(trade?.riskPips, 20);
  assert.equal(trade?.takeProfit, 17);
});

test('only the FIB source that produced the entry controls the deep-discount buffer rule', () => {
  const zone = {
    fibBand: '0.5-0.618',
    swingFibBand: '0.71-0.79',
    engulfingType: 'T1',
    engulfingTime: 60,
    swingEngulfingType: 'T2',
    swingEngulfingTime: 120,
  } as StructureZone;
  assert.equal(isDeepDiscountTradeSignal(zone, bullishSignal), false);
  assert.equal(isDeepDiscountTradeSignal(zone, {
    ...bullishSignal,
    type: 'T2',
    time: 120,
  }), true);
});

test('oversized setup creates a capped pending entry and becomes risk-free at 1R', () => {
  const sourceCandles: StructureCandle[] = [
    { time: 0, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 60, open: 10, high: 14, low: 9.5, close: 13.5, complete: true },
  ];
  const executionCandles: StructureCandle[] = [
    ...sourceCandles,
    { time: 120, open: 20, high: 20, low: 14, close: 15, complete: true },
    { time: 180, open: 14, high: 18, low: 12, close: 17, complete: true },
  ];
  const trade = calculateTradeLevels({
    sourceCandles,
    executionCandles,
    signal: bullishSignal,
    rule: getDirectTradeRule('M1', 'M1')!,
  });

  assert.equal(trade?.entry, 13);
  assert.equal(trade?.riskPips, 50);
  assert.equal(trade?.pendingAtCreation, true);
  assert.equal(trade?.filledAt, 180);
  assert.equal(trade?.status, 'risk-free');
  assert.equal(trade?.result, undefined, 'reaching 1R alone is not a completed RF result');
});

test('pending capped entry expires when target is reached before entry is filled', () => {
  const sourceCandles: StructureCandle[] = [
    { time: 0, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 60, open: 10, high: 14, low: 9.5, close: 13.5, complete: true },
  ];
  const trade = calculateTradeLevels({
    sourceCandles,
    executionCandles: [
      ...sourceCandles,
      // Entry is capped at 13. The candle reaches the 28 target while its
      // low stays above entry, so no trade was filled and the setup expires.
      { time: 120, open: 20, high: 29, low: 14, close: 28.5, complete: true },
    ],
    signal: bullishSignal,
    rule: getDirectTradeRule('M1', 'M1')!,
  });

  assert.equal(trade, undefined);
});

test('completed outcomes classify SL, protected RF exit, and same-candle TP priority', () => {
  const sourceCandles: StructureCandle[] = [
    { time: 0, open: 12, high: 13, low: 9, close: 10, complete: true },
    { time: 60, open: 10, high: 14, low: 9.5, close: 13.5, complete: true },
  ];
  const calculate = (futureCandles: StructureCandle[]) => calculateTradeLevels({
    sourceCandles,
    executionCandles: [...sourceCandles, ...futureCandles],
    signal: bullishSignal,
    rule: getDirectTradeRule('M1', 'M1')!,
  });

  const slTrade = calculate([
    { time: 120, open: 11, high: 12, low: 7, close: 8, complete: true },
  ]);
  assert.equal(slTrade?.result, 'sl');
  assert.equal(slTrade?.resolvedAt, 120);
  const rfTrade = calculate([
    { time: 120, open: 11, high: 15, low: 10, close: 14, complete: true },
    { time: 180, open: 14, high: 14, low: 7, close: 8, complete: true },
  ]);
  assert.equal(rfTrade?.result, 'rf');
  assert.equal(rfTrade?.resolvedAt, 180);
  const tpTrade = calculate([
    { time: 120, open: 11, high: 21, low: 7, close: 18, complete: true },
  ]);
  assert.equal(tpTrade?.result, 'tp');
  assert.equal(tpTrade?.resolvedAt, 120);
});

test('MTF entry uses the actual engulfing timeframe rule when the pair has no direct rule', () => {
  const rule = getMtfTradeRule('H1', 'M5');
  assert.equal(rule?.rewardRisk, 2);
  assert.equal(rule?.stopBufferPips, 10);
  assert.equal(rule?.maximumRiskPips, 100);
});
