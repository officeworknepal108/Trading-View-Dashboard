import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateScalpingLogic } from '../src/services/scalpingLogic';

const base = {
  zoneTimeframe: 'M5' as const,
  signalTimeframe: 'M5' as const,
  signalDirection: 'bullish' as const,
  m5Trend: 'bullish' as const,
  m15Trend: 'bullish' as const,
};

test('Scalping Logic accepts an M5 confirmation aligned with M15 bias', () => {
  const continuation = evaluateScalpingLogic(base);
  assert.equal(continuation.allowed, true);
  assert.equal(continuation.action, 'BUY');
  assert.equal(continuation.setup, 'continuation');

  const pullback = evaluateScalpingLogic({ ...base, m5Trend: 'bearish' });
  assert.equal(pullback.allowed, true);
  assert.equal(pullback.action, 'BUY');
  assert.equal(pullback.setup, 'pullback');
});

test('Scalping Logic waits when M15 is neutral or opposes the M5 signal', () => {
  const neutral = evaluateScalpingLogic({ ...base, m15Trend: 'neutral' });
  assert.equal(neutral.allowed, false);
  assert.equal(neutral.reason, 'm15-neutral');

  const mismatch = evaluateScalpingLogic({ ...base, m15Trend: 'bearish' });
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.reason, 'm15-bias-mismatch');
});

test('Scalping Logic supports bearish M5 entries and both M1 and M5 zones', () => {
  const sell = evaluateScalpingLogic({
    ...base,
    zoneTimeframe: 'M1',
    signalDirection: 'bearish',
    m5Trend: 'bullish',
    m15Trend: 'bearish',
  });
  assert.equal(sell.allowed, true);
  assert.equal(sell.action, 'SELL');
  assert.equal(sell.setup, 'pullback');
});

test('Scalping Logic applies M15 bias and M5 context to native M1 entries', () => {
  const nativeM1 = evaluateScalpingLogic({
    ...base,
    zoneTimeframe: 'M1',
    signalTimeframe: 'M1',
  });
  assert.equal(nativeM1.applicable, true);
  assert.equal(nativeM1.allowed, true);
  assert.equal(nativeM1.entryTimeframe, 'M1');

  const blockedM1 = evaluateScalpingLogic({
    ...base,
    zoneTimeframe: 'M1',
    signalTimeframe: 'M1',
    m15Trend: 'bearish',
  });
  assert.equal(blockedM1.allowed, false);
  assert.equal(blockedM1.reason, 'm15-bias-mismatch');
});

test('Scalping Logic does not alter intraday routes', () => {
  const intraday = evaluateScalpingLogic({
    ...base,
    zoneTimeframe: 'H1',
    signalTimeframe: 'M15',
  });
  assert.equal(intraday.applicable, false);
});
