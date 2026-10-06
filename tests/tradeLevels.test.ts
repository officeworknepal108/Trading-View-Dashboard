import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateTradeLevels,
  getDirectTradeRule,
  getMtfTradeRule,
  isDeepDiscountTradeSignal,
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

test('finalized direct trade matrix returns the agreed R:R, buffer, and risk caps', () => {
  assert.deepEqual(getDirectTradeRule('M1', 'M1'), {
    zoneTimeframe: 'M1', engulfingTimeframe: 'M1', rewardRisk: 3,
    stopBufferPips: 10, maximumRiskPips: 50,
  });
  assert.equal(getDirectTradeRule('M1', 'M5')?.rewardRisk, 2);
  assert.equal(getDirectTradeRule('M5', 'M15')?.rewardRisk, 1);
  assert.equal(getDirectTradeRule('M15', 'M30')?.maximumRiskPips, 300);
  assert.equal(getDirectTradeRule('H1', 'M15'), undefined);
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

  assert.equal(calculate([
    { time: 120, open: 11, high: 12, low: 7, close: 8, complete: true },
  ])?.result, 'sl');
  assert.equal(calculate([
    { time: 120, open: 11, high: 15, low: 10, close: 14, complete: true },
    { time: 180, open: 14, high: 14, low: 7, close: 8, complete: true },
  ])?.result, 'rf');
  assert.equal(calculate([
    { time: 120, open: 11, high: 21, low: 7, close: 18, complete: true },
  ])?.result, 'tp');
});

test('MTF entry uses the actual engulfing timeframe rule when the pair has no direct rule', () => {
  const rule = getMtfTradeRule('H1', 'M5');
  assert.equal(rule?.rewardRisk, 2);
  assert.equal(rule?.stopBufferPips, 10);
  assert.equal(rule?.maximumRiskPips, 100);
});
