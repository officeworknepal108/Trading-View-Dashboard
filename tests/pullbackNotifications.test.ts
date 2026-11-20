import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSecondOnlyPullback, type Mt5StoredSignal } from '../src/services/mt5Automation';
import { buildPullbackChartSetups } from '../src/services/pullbackChartSetup';
import { pullbackTelegramAlerts } from '../src/services/pullbackTelegram';
import { formatTelegramTradeMessage, countTelegramSetups, formatDailyTradeSummary, previousNepalDay } from '../src/services/telegramMessages';
import { bindTelegramAlertAliases, reserveTelegramTradeNumber, type SentTelegramAlerts } from '../src/services/telegramTradeNumbers';

const first: Mt5StoredSignal = { id: 'setup:P10', setupId: 'setup:P10', account: 'A', server: 'B', brokerSymbol: 'GOLD',
  bridgeId: 'bridge', status: 'CLAIMED', createdAt: 1800, updatedAt: 1800,
  symbol: 'XAUUSD', tradeStyle: 'SCALP_1_1', source: 'ENGULFING', zoneName: 'Scalp 1:1',
  zoneTimeframe: 'M15', signalTimeframe: 'M15', signalAt: 900, calculatedAt: 1800, expiresAt: 6300,
  direction: 'BUY', orderType: 'LIMIT', engulfingType: 'T1', entry: 99, stopLoss: 90, takeProfit: 110,
  riskFree: 110, riskPips: 90, rewardRisk: 11 / 9, scalpSetupRiskBudget: 50,
  scalpEntry: { version: 3, leg: 10, riskShare: .6, nextOpen: 100, confirmationBody: 10, referenceEntry: 100 } };
const second: Mt5StoredSignal = { ...first, id: 'setup:P25', setupId: 'setup:P25', status: 'QUEUED',
  entry: 97.5, riskPips: 75, rewardRisk: 12.5 / 7.5, scalpEntry: { ...first.scalpEntry!, leg: 25, riskShare: .4 } };
const bars = [
  { time: 1800, open: 100, high: 101, low: 98, close: 100, complete: true },
  { time: 2700, open: 100, high: 101, low: 97, close: 100, complete: true },
  { time: 3600, open: 100, high: 111, low: 99, close: 110, complete: true },
];
const setup = (asOf: number, signals = [first, second]) => buildPullbackChartSetups({ signals, asOf, candles: { M15: bars } })[0];

test('first chart fill creates one numbered alert; second fill is only the requested line', () => {
  const [entry] = pullbackTelegramAlerts(setup(2700), 2700);
  assert.equal(entry.kind, 'entry');
  const message = formatTelegramTradeMessage(entry, { tradeNumber: 7, tradeDate: '2026-11-16' });
  assert.match(message, /TRADE #7/); assert.match(message, /1st Entry: 99.000 ✓ Filled/);
  assert.match(message, /2nd Entry: 97.500 ⏳ Waiting/); assert.ok(!message.includes('MT5'));
  const update = pullbackTelegramAlerts(setup(3600), 3600).find(a => a.kind === 'entry2')!;
  assert.equal(update.tradeKey, entry.tradeKey);
  assert.equal(formatTelegramTradeMessage(update, { tradeNumber: 7, tradeDate: '2026-11-16' }), '2nd Entry: 97.500 ✓ Filled');
  const sent: SentTelegramAlerts = {};
  const aliases = bindTelegramAlertAliases(sent, entry.id, entry.tradeKey);
  const n = reserveTelegramTradeNumber(sent, entry.id, aliases[0], 2700);
  assert.equal(reserveTelegramTradeNumber(sent, update.id, update.tradeKey, 3600).tradeNumber, n.tradeNumber);
});

test('minimum-lot allocation is recorded atomically and second-only chart alert uses full setup risk', () => {
  const signals = structuredClone([first, second]);
  selectSecondOnlyPullback(signals, first.id, 'A', 'B', 'bridge', 1801);
  assert.equal(signals[0].status, 'CANCELLED');
  assert.ok(signals.every(s => s.pullbackFallback === 'SECOND_ONLY'));
  assert.equal(signals[1].scalpSetupRiskBudget, 50);
  assert.equal(pullbackTelegramAlerts(setup(2700, signals), 2700).length, 0, 'first touched price cannot alert for skipped entry');
  const model = setup(3600, signals);
  assert.equal(model.trade.entry, 97.5); assert.equal(model.markerTime, 2700);
  const alerts = pullbackTelegramAlerts(model, 3600);
  assert.deepEqual(alerts.map(a => a.kind), ['entry']);
  const text = formatTelegramTradeMessage(alerts[0], { tradeNumber: 1, tradeDate: '2026-11-16' });
  assert.match(text, /1st Entry: Skipped/); assert.match(text, /2nd Entry: 97.500 ✓ Filled/);
  assert.match(text, /100% of setup risk/);
});

test('allocation refuses accepted orders, foreign claims, expired setups and missing second legs', () => {
  for (const signals of [[{ ...first, brokerTicket: 123 }, second], [{ ...first, openedAt: 1800 }, second],
    [{ ...first, status: 'PLACED' as const }, second], [first]]) {
    const copy = structuredClone(signals);
    assert.throws(() => selectSecondOnlyPullback(copy, first.id, 'A', 'B', 'bridge', 1801));
    assert.deepEqual(copy, signals);
  }
  assert.throws(() => selectSecondOnlyPullback(structuredClone([first, second]), first.id, 'other', 'B', 'bridge', 1801));
  assert.throws(() => selectSecondOnlyPullback(structuredClone([first, second]), first.id, 'A', 'B', 'bridge', 6300));
});

test('chart notifications retain identity across accounts and report a single final setup outcome', () => {
  const one = setup(4500);
  const two = setup(4500, [first, second].map(s => ({ ...s, account: 'other', id: `${s.id}:secondary` })));
  assert.equal(one.telegramKey, two.telegramKey);
  const alerts = pullbackTelegramAlerts(one, 4500);
  assert.deepEqual(alerts.map(a => a.kind), ['entry', 'entry2', 'tp']);
});

test('daily setup summary deduplicates aliases, includes all styles, and excludes future closes', () => {
  const now = Date.parse('2026-11-16T18:16:00Z') / 1000, day = previousNepalDay(now);
  const one = { tradeNumber: 1, tradeDate: day.date, tradeStyle: 'SCALP_1_1' as const, entry: true, entry2: true, result: 'tp' as const, closedAt: day.end - 1 };
  const sent: SentTelegramAlerts = { one, alias: { ...one },
    two: { ...one, tradeNumber: 2, tradeStyle: 'INTRADAY', result: 'sl', closedAt: day.end + 60 },
    three: { ...one, tradeNumber: 3, tradeStyle: 'SCALPING', result: 'sl' },
    pending: { ...one, tradeNumber: 4, entry: false },
    yesterday: { ...one, tradeNumber: 5, tradeDate: '2026-11-14' } };
  const counts = countTelegramSetups(sent, now)!;
  assert.equal(counts.total, 3); assert.equal(counts.wins, 1); assert.equal(counts.losses, 1); assert.equal(counts.open, 1);
  assert.equal(counts.strategies!.SCALP_1_1.total, 1); assert.equal(counts.strategies!.INTRADAY.open, 1);
  const text = formatDailyTradeSummary(counts);
  assert.ok(['SCALP 1:1', 'INTRADAY', 'SCALPING'].every(name => text.includes(name)));
  const zero = countTelegramSetups({}, now);
  assert.equal(zero.total, 0); assert.equal(Object.keys(zero.strategies!).length, 4);
  assert.equal(zero.strategies!.BOLLINGER_M5.total, 0);
  const rf = countTelegramSetups({ live: { ...one, tradeNumber: 8, result: undefined,
    tradeStyle: 'SCALPING', rf: true, rfAt: day.end - 1 } }, now);
  assert.equal(rf.total, 1); assert.equal(rf.open, 1); assert.equal(rf.riskFree, 1, 'partially closed Scalping setup remains open');
});
