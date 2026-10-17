import assert from 'node:assert/strict';
import test from 'node:test';
import { isNepalTradingTime } from '../src/services/tradingTime';

const nepalTime = (hour: number, minute: number) => (
  Date.UTC(2026, 9, 17, hour - 5, minute - 45) / 1000
);

test('Nepal trading time accepts all three revised sessions and their boundaries', () => {
  for (const [hour, minute] of [[5, 45], [8, 15], [11, 45], [14, 45], [17, 45], [20, 45]]) {
    assert.equal(isNepalTradingTime(nepalTime(hour, minute)), true, `${hour}:${minute}`);
  }
});

test('Nepal trading time rejects minutes outside the three sessions', () => {
  for (const [hour, minute] of [[5, 44], [8, 16], [11, 44], [14, 46], [17, 44], [20, 46]]) {
    assert.equal(isNepalTradingTime(nepalTime(hour, minute)), false, `${hour}:${minute}`);
  }
});
