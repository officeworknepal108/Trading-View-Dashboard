import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findGoldScalpingCandleSignal,
  goldScalpingCandleTimeframe,
  goldScalpingChochTradeRule,
  goldScalpingConfirmationWickPasses,
  goldScalpingTradeRule,
  goldIntradayMtfTradeRule,
  isGoldIntradayCandleRoute,
  isGoldIntradayMtfRoute,
  isGoldScalpingChochZone,
  isGoldScalpingEngulfingType,
  isGoldScalpingZone,
  savedGoldScalpMatchesReversal,
} from '../src/services/goldScalping';
import type { StructureCandle, StructureZone } from '../src/services/marketStructure';
import { calculateTradeLevels } from '../src/services/tradeLevels';

test('Gold scalp zone width routes follow only M15 and H1', () => {
  assert.equal(goldScalpingCandleTimeframe('M15', 20), 'M1');
  assert.equal(goldScalpingCandleTimeframe('M15', 40), 'M1');
  assert.equal(goldScalpingCandleTimeframe('M15', 40.1), 'M5');
  assert.equal(goldScalpingCandleTimeframe('M15', 100), 'M5');
  assert.equal(goldScalpingCandleTimeframe('H1', 20), 'M5');
  assert.equal(goldScalpingCandleTimeframe('H1', 40), 'M5');
  assert.equal(goldScalpingCandleTimeframe('H1', 41), undefined);
  assert.equal(goldScalpingCandleTimeframe('H4', 30), undefined);
  assert.equal(isGoldScalpingChochZone('M15', 41), true);
  assert.equal(isGoldScalpingChochZone('H1', 100), true);
  assert.equal(isGoldScalpingChochZone('H1', 40), false);
  assert.equal(isGoldScalpingZone('M15', 30), true);
  assert.equal(isGoldScalpingZone('D', 30), false);
});

test('Gold scalp confirms T1-T3, directional wick and specified stop limits', () => {
  assert.deepEqual(['T1', 'T2', 'T3', 'T4'].map(isGoldScalpingEngulfingType),
    [true, true, true, false]);
  assert.equal(goldScalpingConfirmationWickPasses({
    time: 0, open: 100, close: 101, high: 102, low: 99,
  }, 'bullish'), true);
  assert.equal(goldScalpingConfirmationWickPasses({
    time: 0, open: 100, close: 101, high: 102.1, low: 99,
  }, 'bullish'), false);
  assert.equal(goldScalpingConfirmationWickPasses({
    time: 0, open: 101, close: 100, high: 102, low: 98.9,
  }, 'bearish'), false);
  assert.deepEqual(goldScalpingTradeRule('M15', 'M1'), {
    zoneTimeframe: 'M15', engulfingTimeframe: 'M1',
    rewardRisk: 3, stopBufferPips: 5, maximumRiskPips: 40,
  });
  assert.deepEqual(goldScalpingTradeRule('H1', 'M5'), {
    zoneTimeframe: 'H1', engulfingTimeframe: 'M5',
    rewardRisk: 3, stopBufferPips: 8, maximumRiskPips: 80,
  });
  assert.equal(goldScalpingTradeRule('M15', 'M5')?.rewardRisk, 3);
  assert.equal(goldScalpingChochTradeRule('M15', 'M1')?.rewardRisk, 3);
  assert.equal(goldScalpingChochTradeRule('H1', 'M1')?.rewardRisk, 3);
  assert.deepEqual(goldScalpingChochTradeRule('H1', 'M1'), {
    zoneTimeframe: 'H1', engulfingTimeframe: 'M1',
    rewardRisk: 3, stopBufferPips: 5, maximumRiskPips: 40,
  });
});

test('Gold intraday accepts only the four candle pairs and two MTF pairs', () => {
  const candlePairs = [
    ['M15', 'M15'], ['M15', 'M30'], ['H1', 'M15'], ['H1', 'M30'],
  ] as const;
  for (const [zone, entry] of candlePairs) {
    assert.equal(isGoldIntradayCandleRoute(zone, entry), true);
  }
  assert.equal(isGoldIntradayCandleRoute('M1', 'M1'), false);
  assert.equal(isGoldIntradayCandleRoute('M5', 'M5'), false);
  assert.equal(isGoldIntradayCandleRoute('M15', 'M5'), false);
  assert.equal(isGoldIntradayMtfRoute('H1', 'M5'), true);
  assert.equal(isGoldIntradayMtfRoute('H4', 'M15'), true);
  assert.equal(isGoldIntradayMtfRoute('M15', 'M1'), false);
  assert.equal(isGoldIntradayMtfRoute('D', 'H1'), false);
  assert.deepEqual(goldIntradayMtfTradeRule('H1', 'M5'), {
    zoneTimeframe: 'H1', engulfingTimeframe: 'M5',
    rewardRisk: 3, stopBufferPips: 8, maximumRiskPips: 80,
  });
  assert.deepEqual(goldIntradayMtfTradeRule('H4', 'M15'), {
    zoneTimeframe: 'H4', engulfingTimeframe: 'M15',
    rewardRisk: 5, stopBufferPips: 20, maximumRiskPips: 200,
  });
});

test('Gold candle confirmation waits for zone midline and a qualified Fib zone', () => {
  const zone: StructureZone = {
    id: 'gold-zone', name: 'TJL1', category: 'mg', isBuy: true,
    startTime: 0, endTime: 1000, activeFromTime: 0,
    top: 103, bottom: 100, active: true, status: 'valid',
    fibStatus: 'a-plus', fibBand: '0.71-0.79',
  };
  const noMidline: StructureCandle[] = [
    { time: 60, open: 102.8, close: 102.3, high: 103, low: 102.1, complete: true },
    { time: 120, open: 102.2, close: 103.2, high: 103.4, low: 102, complete: true },
  ];
  assert.equal(findGoldScalpingCandleSignal(zone, 'M15', noMidline), undefined);
  const withMidline: StructureCandle[] = [
    { time: 60, open: 102, close: 101.7, high: 102.2, low: 101.4, complete: true },
    { time: 120, open: 101.6, close: 102.4, high: 102.5, low: 101.2, complete: true },
  ];
  assert.equal(findGoldScalpingCandleSignal(zone, 'M15', withMidline)?.type, 'T1');
  assert.equal(findGoldScalpingCandleSignal({ ...zone, fibStatus: undefined },
    'M15', withMidline), undefined);
});

test('Gold M15 sell scalp accepts engulfing at the M1 wick high beyond the zone', () => {
  const zone: StructureZone = {
    id: 'sell-wick', name: 'TJL2', category: 'mg', isBuy: false,
    startTime: 0, endTime: 1000, activeFromTime: 0,
    top: 103, bottom: 100, active: true, status: 'valid',
    fibStatus: 'a-plus', fibBand: '0.5-0.618',
  };
  const candles: StructureCandle[] = [
    { time: 60, open: 101, close: 102, high: 102.2, low: 100.8, complete: true },
    { time: 120, open: 104, close: 105, high: 105.2, low: 103.8, complete: true },
    { time: 180, open: 105.1, close: 103.7, high: 105.3, low: 103.5, complete: true },
  ];
  const signal = findGoldScalpingCandleSignal(zone, 'M15', candles);
  assert.equal(signal?.time, 180);
  assert.equal(signal?.direction, 'bearish');
  assert.equal(signal?.timeframe, 'M1');
});

test('Gold M15 scalp rejects a later zone engulfing below the sell reversal high', () => {
  const zone: StructureZone = {
    id: 'late-sell', name: 'TJL2', category: 'mg', isBuy: false,
    startTime: 0, endTime: 1000, activeFromTime: 0,
    top: 103, bottom: 100, active: true, status: 'valid',
    fibStatus: 'a-plus', fibBand: '0.5-0.618',
  };
  const candles: StructureCandle[] = [
    { time: 60, open: 101, close: 102, high: 102.2, low: 100.8, complete: true },
    { time: 120, open: 104, close: 105, high: 105.2, low: 103.8, complete: true },
    { time: 180, open: 105.1, close: 105.05, high: 105.3, low: 104.8, complete: true },
    { time: 240, open: 103.2, close: 102.8, high: 103.3, low: 100.5, complete: true },
    { time: 300, open: 102.5, close: 102.9, high: 103, low: 102.4, complete: true },
    { time: 360, open: 103, close: 102.2, high: 103.1, low: 102.1, complete: true },
  ];
  assert.equal(findGoldScalpingCandleSignal(zone, 'M15', candles), undefined);
});

test('Gold M15 buy scalp accepts engulfing at the M1 wick low beyond the zone', () => {
  const zone: StructureZone = {
    id: 'buy-wick', name: 'TJL2', category: 'mg', isBuy: true,
    startTime: 0, endTime: 1000, activeFromTime: 0,
    top: 103, bottom: 100, active: true, status: 'valid',
    fibStatus: 'a-plus', fibBand: '0.5-0.618',
  };
  const candles: StructureCandle[] = [
    { time: 60, open: 102, close: 101, high: 102.2, low: 100.8, complete: true },
    { time: 120, open: 99, close: 98, high: 99.2, low: 97.8, complete: true },
    { time: 180, open: 97.9, close: 99.3, high: 99.5, low: 97.7, complete: true },
  ];
  const signal = findGoldScalpingCandleSignal(zone, 'M15', candles);
  assert.equal(signal?.time, 180);
  assert.equal(signal?.direction, 'bullish');
  assert.equal(signal?.timeframe, 'M1');
});

test('saved Gold scalp arrows exclude a later zone engulfing but retain a wick reversal', () => {
  const zone: StructureZone = {
    id: 'source-zone', name: 'TJL2', category: 'mg', isBuy: false,
    startTime: 0, endTime: 1000, activeFromTime: 0,
    top: 103, bottom: 100, active: false, status: 'superseded',
  };
  const candles: StructureCandle[] = [
    { time: 60, open: 101, close: 102, high: 102.2, low: 100.8, complete: true },
    { time: 120, open: 104, close: 105, high: 105.2, low: 103.8, complete: true },
    { time: 180, open: 105.1, close: 103.7, high: 105.3, low: 103.5, complete: true },
    { time: 240, open: 102.5, close: 102.9, high: 103, low: 102.4, complete: true },
    { time: 300, open: 103, close: 102.2, high: 103.1, low: 102.1, complete: true },
  ];
  const saved = (signalAt: number) => ({
    id: `GOLD_SCALP:M15:source-zone:${signalAt}:102.2`,
    source: 'ENGULFING', tradeStyle: 'SCALPING', zoneTimeframe: 'M15' as const,
    signalAt, engulfingType: 'T1',
  });
  assert.equal(savedGoldScalpMatchesReversal(saved(180), [zone], candles), true);
  assert.equal(savedGoldScalpMatchesReversal(saved(180), [{ ...zone,
    status: 'invalidated', invalidatedAt: 240 }], candles), true,
  'a later source-zone invalidation must not erase a verified historical entry');
  assert.equal(savedGoldScalpMatchesReversal(saved(300), [zone], candles), false);
});

test('57.75-pip M15 TJL2 accepts its M5 Type 3 after a midline touch', () => {
  const zone: StructureZone = {
    id: 'TJL2-1790597700-4171.42', name: 'TJL2', category: 'mg', isBuy: false,
    startTime: 1790597700, endTime: 1790700000, activeFromTime: 1790604900,
    top: 4171.42, bottom: 4165.6454, active: true, status: 'valid',
    fibStatus: 'a-plus', fibBand: '0.5-0.618', fibLevel50: 4155.6,
  };
  const candles: StructureCandle[] = [
    { time: 1790691600, open: 4170.47, high: 4175.155, low: 4167.66, close: 4174.525, complete: true },
    { time: 1790691900, open: 4174.6, high: 4175.21, low: 4171.805, close: 4172.76, complete: true },
    { time: 1790692200, open: 4172.68, high: 4174.675, low: 4167.89, close: 4168.19, complete: true },
    { time: 1790692500, open: 4168.135, high: 4169.185, low: 4162.855, close: 4165.115, complete: true },
  ];
  const signal = findGoldScalpingCandleSignal(zone, 'M15', candles);
  assert.equal(signal?.type, 'T3');
  assert.equal(signal?.timeframe, 'M5');
  const rule = goldScalpingTradeRule('M15', 'M5');
  assert.ok(signal && rule);
  const trade = calculateTradeLevels({
    sourceCandles: candles, executionCandles: candles, signal, rule,
  });
  assert.ok(trade);
  assert.ok(Math.abs(trade.stopLoss - 4176.01) < 0.00001);
  assert.equal(trade.riskPips, 78.75);
  assert.equal(trade.rewardRisk, 3);
  assert.ok(Math.abs(trade.takeProfit - 4144.51) < 0.00001);
});
