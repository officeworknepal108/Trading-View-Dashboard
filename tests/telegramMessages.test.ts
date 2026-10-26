import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTelegramTradeMessage, formatDailyTradeSummary, countDailyTrades, previousNepalDay,
  telegramDemoMessages, type TelegramTradeAlert } from '../src/services/telegramMessages';

const alert: TelegramTradeAlert = { id: 'sample', kind: 'entry', symbol: 'XAUUSD', direction: 'SELL',
  source: 'MTF', higherZoneName: 'Internal DT', entryZoneName: 'QML', zoneName: 'QML',
  zoneTimeframe: 'M15', signalTimeframe: 'M1', engulfingType: 'T3', tradeStyle: 'SCALPING',
  entry: 4021.48, stopLoss: 4024.05, takeProfit: 4014.01, riskFree: 4018.91,
  riskPips: 25.700000000001637, rewardRisk: 3, openedAt: 1793034182 };
const number = { tradeNumber: 1, tradeDate: '2026-10-26' };

test('MTF entries name both source zones and round risk pips', () => {
  const text = formatTelegramTradeMessage(alert, number);
  assert.ok(text.includes('Main zone: 15-minute Internal DT'));
  assert.ok(text.includes('Entry zone: 1-minute QML'));
  assert.ok(text.includes('Confirmation: 1-minute bearish engulfing T3'));
  assert.ok(text.includes('25.7 pips'));
  assert.ok(!text.includes('0000000000'));
  assert.ok(!text.includes('Main zone: 15-minute QML'));
});

test('direct candle entries do not invent a lower-timeframe zone', () => {
  const text = formatTelegramTradeMessage({ ...alert, source: 'ENGULFING', higherZoneName: 'QML',
    entryZoneName: undefined, zoneTimeframe: 'H1', signalTimeframe: 'M15', tradeStyle: 'INTRADAY' }, number);
  assert.ok(text.includes('Main zone: 1-hour QML'));
  assert.ok(text.includes('Confirmation: 15-minute bearish engulfing T3'));
  assert.ok(!text.includes('Entry zone:'));
  assert.ok(!text.includes('Risk-free at'));
  assert.ok(formatTelegramTradeMessage({ ...alert, higherZoneName: undefined }, number)
    .includes('Main zone: 15-minute zone not recorded'));
});

test('TP and SL use only the two requested lines', () => {
  assert.equal(formatTelegramTradeMessage({ ...alert, kind: 'tp' }, number),
    'Trade #1 — TAKE PROFIT HIT\nXAUUSD SELL · SCALPING');
  assert.equal(formatTelegramTradeMessage({ ...alert, kind: 'sl' }, number),
    'Trade #1 — STOP LOSS HIT\nXAUUSD SELL · SCALPING');
});

test('RF uses exactly the requested short format', () => {
  assert.equal(formatTelegramTradeMessage({ ...alert, kind: 'rf' }, number),
    'Trade #1 — RISK-FREE HIT\nXAUUSD SELL · SCALPING\n\n1R reached: 4,018.910\n\n✅ Partial position closed\n⏳ Remaining position is still open\nSL: 4,024.050 · TP: 4,014.010');
});

test('daily counts use Nepal closing day, current account and one final outcome per execution', () => {
  const now = Date.parse('2026-10-26T18:16:00Z') / 1000;
  const day = previousNepalDay(now);
  const base = { id: 'one', account: '538197', server: 'Broker', status: 'SL',
    closedAt: day.end - 1, updatedAt: day.end, brokerTicket: 1 };
  const counts = countDailyTrades([base, { ...base, id: 'slipped-copy' },
    { ...base, brokerTicket: 2, status: 'TP' }, { ...base, brokerTicket: 3, status: 'RF' },
    { ...base, brokerTicket: 4, status: 'RISK_FREE', closedAt: undefined },
    { ...base, brokerTicket: 5, status: 'SIMULATED' },
    { ...base, brokerTicket: 6, account: 'another' }, { ...base, brokerTicket: 7, server: 'another' },
    { ...base, brokerTicket: 8, closedAt: day.end }, { ...base, brokerTicket: 9, closedAt: day.start - 1 },
  ], '538197', 'Broker', now);
  assert.deepEqual(counts, { date: '2026-10-26', total: 3, wins: 1, losses: 1, riskFree: 1 });
  assert.equal(formatDailyTradeSummary(counts),
    'DAILY TRADE SUMMARY — 26 Oct 2026\n\nTotal trades: 3\n✅ Wins: 1\n❌ Losses: 1\n🟡 Risk-free: 1');
  assert.ok(!formatDailyTradeSummary(counts).includes('$'));
});

test('all demo messages are labelled and use the same production formatters', () => {
  const messages = telegramDemoMessages();
  assert.equal(messages.length, 10);
  assert.ok(messages.every(text => text.includes('NOT A LIVE TRADE')));
  assert.ok(messages[1].includes('Risk/reward: 1:3'), 'H1/M5 MTF intraday stays at 1:3');
  assert.ok(messages[2].includes('Risk/reward: 1:2'), 'H1/M15 candle intraday uses 1:2');
  assert.ok(messages[2].includes('Take profit: 4,020.000'), 'candle demo TP matches its 1:2 RR');
  assert.ok(messages[0].endsWith(formatTelegramTradeMessage({ ...alert, openedAt: Date.parse('2026-10-26T17:03:00Z') / 1000 }, number)));
});
