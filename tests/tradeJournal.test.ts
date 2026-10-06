import assert from 'node:assert/strict';
import test from 'node:test';
import { inferTradingSession } from '../src/components/TradeJournal';

function unixTime(isoTime: string): number {
  return Date.parse(isoTime) / 1000;
}

test('journal infers sessions from Nepal-local trade time', () => {
  assert.equal(inferTradingSession(unixTime('2024-07-09T04:00:00Z')), 'ASIAN');
  assert.equal(inferTradingSession(unixTime('2024-07-03T08:15:00Z')), 'LONDON');
  assert.equal(inferTradingSession(unixTime('2024-07-10T14:15:00Z')), 'LON + NYC');
  assert.equal(inferTradingSession(unixTime('2024-07-10T18:00:00Z')), 'NEW YORK');
});
