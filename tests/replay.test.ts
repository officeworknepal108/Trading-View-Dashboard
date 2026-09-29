import assert from 'node:assert/strict';
import test from 'node:test';
import { findReplayIndexAtOrBefore } from '../src/services/replay';

const candles = [100, 200, 300, 400].map((time) => ({ time }));

test('keeps an exact replay timestamp on the matching candle', () => {
  assert.equal(findReplayIndexAtOrBefore(candles, 300), 2);
});

test('maps a replay timestamp to the containing lower-timeframe candle', () => {
  assert.equal(findReplayIndexAtOrBefore(candles, 350), 2);
});

test('does not silently jump when the replay date is outside loaded history', () => {
  assert.equal(findReplayIndexAtOrBefore(candles, 50), null);
  assert.equal(findReplayIndexAtOrBefore([], 300), null);
});
