import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMt5SignalId,
  isExecutableTrade,
  tradeToMt5Signal,
} from '../src/services/mt5Automation';
import type { TradeLevels } from '../src/services/tradeLevels';

const activeTrade: TradeLevels = {
  entry: 4150,
  stopLoss: 4140,
  takeProfit: 4170,
  riskFree: 4160,
  riskPips: 100,
  rewardRisk: 2,
  status: 'active',
  pendingAtCreation: false,
  calculatedAt: 1_000,
  filledAt: 1_000,
  signal: {
    type: 'T1', direction: 'bullish', time: 900, candleCount: 2, timeframe: 'M15',
  },
};

test('MT5 signal IDs deduplicate overlapping zones with identical execution levels', () => {
  const common = {
    source: 'ENGULFING' as const,
    signalTimeframe: 'M15' as const,
    signalAt: 900,
    direction: 'BUY' as const,
    entry: 4150,
    stopLoss: 4140,
    takeProfit: 4170,
  };
  assert.equal(buildMt5SignalId(common), buildMt5SignalId(common));
  assert.equal(
    buildMt5SignalId(common),
    buildMt5SignalId({ ...common, source: 'MTF' }),
  );
});

test('active trade becomes a market signal and pending trade becomes a limit signal', () => {
  const active = tradeToMt5Signal({
    source: 'ENGULFING', zoneName: 'DB', zoneTimeframe: 'M15', trade: activeTrade,
    now: 1_010, pendingExpiryMinutes: 60,
  });
  const pending = tradeToMt5Signal({
    source: 'ENGULFING', zoneName: 'DB', zoneTimeframe: 'M15',
    trade: { ...activeTrade, status: 'pending' }, now: 1_010, pendingExpiryMinutes: 60,
  });
  assert.equal(active.orderType, 'MARKET');
  assert.equal(pending.orderType, 'LIMIT');
  assert.equal(active.expiresAt, 4_610);
  assert.equal(active.direction, 'BUY');
});

test('only pending and active dashboard trades are executable', () => {
  assert.equal(isExecutableTrade(activeTrade), true);
  assert.equal(isExecutableTrade({ ...activeTrade, status: 'pending' }), true);
  assert.equal(isExecutableTrade({ ...activeTrade, status: 'risk-free' }), false);
  assert.equal(isExecutableTrade({ ...activeTrade, status: 'tp-hit' }), false);
});
