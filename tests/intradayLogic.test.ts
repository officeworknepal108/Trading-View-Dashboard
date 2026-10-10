import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateIntradayLogic } from '../src/services/intradayLogic';

const base = {
  setupTimeframe: 'M15' as const,
  entryTimeframe: 'M5' as const,
  signalDirection: 'bullish' as const,
  h4Trend: 'bullish' as const,
  h1Trend: 'bullish' as const,
  m15Trend: 'bullish' as const,
};

test('Intraday Logic accepts aligned M5 and M15 continuation entries', () => {
  const m5 = evaluateIntradayLogic(base);
  assert.equal(m5.allowed, true);
  assert.equal(m5.action, 'BUY');
  assert.equal(m5.setup, 'continuation');
  assert.equal(m5.entryTimeframe, 'M5');

  const m15 = evaluateIntradayLogic({
    ...base,
    setupTimeframe: 'H1',
    entryTimeframe: 'M15',
  });
  assert.equal(m15.allowed, true);
  assert.equal(m15.entryTimeframe, 'M15');
});

test('Intraday Logic accepts an H1 pullback only after M15 realigns with H4', () => {
  const confirmed = evaluateIntradayLogic({ ...base, h1Trend: 'bearish' });
  assert.equal(confirmed.allowed, true);
  assert.equal(confirmed.setup, 'pullback');

  const unconfirmed = evaluateIntradayLogic({
    ...base,
    h1Trend: 'bearish',
    m15Trend: 'bearish',
  });
  assert.equal(unconfirmed.allowed, false);
  assert.equal(unconfirmed.reason, 'm15-setup-mismatch');
});

test('Intraday Logic blocks neutral and conflicting H4/H1 conditions', () => {
  assert.equal(evaluateIntradayLogic({ ...base, h4Trend: 'neutral' }).reason, 'h4-neutral');
  assert.equal(evaluateIntradayLogic({ ...base, h4Trend: 'bearish' }).reason, 'h4-bias-mismatch');
  assert.equal(evaluateIntradayLogic({ ...base, h1Trend: 'neutral' }).reason, 'h1-neutral');
});

test('Intraday Logic supports bearish entries and ignores unrelated routes', () => {
  const sell = evaluateIntradayLogic({
    ...base,
    setupTimeframe: 'H4',
    entryTimeframe: 'M15',
    signalDirection: 'bearish',
    h4Trend: 'bearish',
    h1Trend: 'bullish',
    m15Trend: 'bearish',
  });
  assert.equal(sell.allowed, true);
  assert.equal(sell.action, 'SELL');
  assert.equal(sell.setup, 'pullback');

  const nativeM1 = evaluateIntradayLogic({ ...base, setupTimeframe: 'M1', entryTimeframe: 'M1' });
  assert.equal(nativeM1.applicable, false);
});
