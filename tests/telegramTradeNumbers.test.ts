import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nepalTradeDate, reserveTelegramTradeNumber, telegramTradeNumberLabel, bindTelegramAlertAliases,
  type SentTelegramAlerts,
  mergeTelegramAlertHistories,
} from '../src/services/telegramTradeNumbers';

const beforeMidnight = Date.parse('2026-10-26T18:14:59Z') / 1000;
const afterMidnight = beforeMidnight + 1;

test('shared Telegram history retains delivery flags and numbering from both accounts', () => {
  const key = 'XAUUSD:bullish:M15:1793034120';
  const primary = { [key]: { tradeNumber: 2, tradeDate: '2026-10-26', pending: true, entry: true } };
  const secondary = { [key]: { tradeNumber: 4, tradeDate: '2026-10-26', entry: false, rf: true, result: 'tp' as const },
    secondaryOnly: { tradeNumber: 5, tradeDate: '2026-10-26', entry: true },
    'DAILY:2026-10-26': { summarySent: true } };
  const merged = mergeTelegramAlertHistories([primary, secondary]);
  assert.equal(merged[key].tradeNumber, 2);
  assert.equal(merged[key].pending, true);
  assert.equal(merged[key].entry, true);
  assert.equal(merged[key].rf, true);
  assert.equal(merged[key].result, 'tp');
  assert.equal(merged.secondaryOnly.entry, true);
  assert.equal(merged['DAILY:2026-10-26'].summarySent, true);
  assert.equal(reserveTelegramTradeNumber(merged, 'next', undefined, beforeMidnight).tradeNumber, 6);
  assert.equal(primary[key].tradeNumber, 2);
  assert.equal(secondary[key].entry, false, 'merging does not alter saved source objects');
});

test('legacy price aliases share sent flags and preserve the first assigned number', () => {
  const prefix = 'XAUUSD:bearish:M1:1793034120';
  const sent: SentTelegramAlerts = {
    [`${prefix}:4021.54000`]: { tradeNumber: 1, tradeDate: '2026-10-26', entry: true },
    [`${prefix}:4021.48000`]: { tradeNumber: 2, tradeDate: '2026-10-26', result: 'sl' },
  };
  const aliases = bindTelegramAlertAliases(sent, `${prefix}:4021.49000`);
  assert.equal(aliases[0], prefix);
  assert.equal(sent[prefix].tradeNumber, 1);
  assert.equal(sent[prefix].entry, true);
  assert.equal(sent[prefix].result, 'sl');
  assert.equal(sent[`${prefix}:4021.49000`], sent[prefix]);
  bindTelegramAlertAliases(sent, `${prefix.replace('1793034120', '1793034180')}:4021.49000`);
  assert.equal(sent[prefix.replace('1793034120', '1793034180')].entry, false, 'different signals stay independent');
});

test('all trade styles, routes and symbols share one daily sequence', () => {
  const sent: SentTelegramAlerts = {};
  for (const [index, id] of ['intraday', 'scalping', 'mtf-intraday', 'mtf-scalping', 'forex'].entries()) {
    assert.equal(reserveTelegramTradeNumber(sent, id, id, beforeMidnight).tradeNumber, index + 1);
  }
});

test('daily sequence resets exactly at Nepal midnight, not UTC midnight', () => {
  assert.equal(nepalTradeDate(beforeMidnight), '2026-10-26');
  assert.equal(nepalTradeDate(afterMidnight), '2026-10-27');
  const sent: SentTelegramAlerts = {};
  reserveTelegramTradeNumber(sent, 'today-1', undefined, beforeMidnight);
  reserveTelegramTradeNumber(sent, 'today-2', undefined, beforeMidnight);
  assert.equal(reserveTelegramTradeNumber(sent, 'tomorrow-1', undefined, afterMidnight).tradeNumber, 1);
  assert.equal(reserveTelegramTradeNumber(sent, 'tomorrow-2', undefined, afterMidnight + 60).tradeNumber, 2);
});

test('pending, filled, RF, cancellation and exit IDs retain their trade number across midnight', () => {
  const sent: SentTelegramAlerts = {};
  const pending = reserveTelegramTradeNumber(sent, 'broker-order', 'canonical-trade', beforeMidnight);
  sent['broker-order'].pending = true;
  for (const id of ['canonical-trade', 'broker-order']) {
    const update = reserveTelegramTradeNumber(sent, id, 'canonical-trade', afterMidnight);
    assert.equal(update.tradeNumber, pending.tradeNumber);
    assert.equal(update.tradeDate, '2026-10-26');
    assert.equal(update.changed, false);
  }
  assert.equal(sent['broker-order'].pending, true);
  assert.equal(reserveTelegramTradeNumber(sent, 'new-trade', undefined, afterMidnight).tradeNumber, 1);
});

test('saved reservations survive restart and failed-send retries without reusing numbers', () => {
  let sent: SentTelegramAlerts = {};
  reserveTelegramTradeNumber(sent, 'first', undefined, beforeMidnight);
  sent = JSON.parse(JSON.stringify(sent));
  assert.equal(reserveTelegramTradeNumber(sent, 'first', undefined, beforeMidnight).changed, false);
  assert.equal(reserveTelegramTradeNumber(sent, 'second', undefined, beforeMidnight).tradeNumber, 2);
  assert.equal(sent.first.entry, undefined, 'reserving a number must not mark the alert as delivered');
});

test('legacy delivery flags are preserved and ID aliases do not consume extra numbers', () => {
  const sent: SentTelegramAlerts = { legacy: { entry: true, result: 'tp' } };
  assert.equal(reserveTelegramTradeNumber(sent, 'legacy', undefined, beforeMidnight).tradeNumber, 1);
  assert.equal(sent.legacy.entry, true);
  assert.equal(sent.legacy.result, 'tp');
  reserveTelegramTradeNumber(sent, 'alias', 'legacy', beforeMidnight);
  assert.equal(reserveTelegramTradeNumber(sent, 'next', undefined, beforeMidnight).tradeNumber, 2);
});

test('number label includes the original Nepal date for overnight updates', () => {
  assert.equal(telegramTradeNumberLabel({ tradeNumber: 4, tradeDate: '2026-10-26' }),
    'Trade #4 | 2026-10-26 (Nepal)');
});


test('result R survives legacy history merges and alias binding without applying the wrong outcome', () => {
  const prefix = 'XAUUSD:bullish:M15:1793034120';
  const entry = { tradeNumber: 1, tradeDate: '2026-10-26', entry: true };
  const closed = { ...entry, result: 'tp' as const, returnR: .35, closedAt: beforeMidnight };
  const sent = mergeTelegramAlertHistories([{ [prefix]: entry }, { [prefix]: closed }]);
  assert.equal(sent[prefix].returnR, .35);
  const restarted = JSON.parse(JSON.stringify(sent));
  restarted[prefix + ':4000.00'] = { ...entry };
  bindTelegramAlertAliases(restarted, prefix + ':4000.00', prefix);
  assert.equal(restarted[prefix + ':4000.00'].returnR, .35);
  assert.equal(restarted[prefix + ':4000.00'].closedAt, beforeMidnight);
  const conflict = mergeTelegramAlertHistories([{ [prefix]: closed }, { [prefix]: { ...closed, result: 'sl', returnR: -1 } }]);
  assert.equal(conflict[prefix].result, 'tp'); assert.equal(conflict[prefix].returnR, .35);
});


test('each Abhi leg result keeps its delivery evidence through alias merging and restarts', () => {
  const prefix = 'CHART_SETUP:SCALP_1_1:example';
  const one: SentTelegramAlerts = { [prefix]: { tradeNumber: 1, tradeDate: '2026-11-21', entry: true, legResults: { 10: 'sl' } } };
  const two: SentTelegramAlerts = { [prefix]: { tradeNumber: 1, tradeDate: '2026-11-21', entry: true, legResults: { 25: 'tp' } } };
  const merged = JSON.parse(JSON.stringify(mergeTelegramAlertHistories([one, two])));
  bindTelegramAlertAliases(merged, prefix, prefix);
  assert.deepEqual(merged[prefix].legResults, { 10: 'sl', 25: 'tp' });
  assert.equal(merged[prefix].result, undefined); assert.equal(merged[prefix].returnR, undefined);
});
