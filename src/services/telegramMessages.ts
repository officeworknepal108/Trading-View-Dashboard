import type { TradeTimeframe } from './tradeLevels';
import type { TelegramTradeNumber } from './telegramTradeNumbers';

export interface TelegramTradeAlert {
  id: string; tradeKey?: string;
  kind: 'pending' | 'cancelled' | 'entry' | 'rf' | 'tp' | 'sl';
  outsideTradingTime?: boolean;
  symbol: string; direction: 'BUY' | 'SELL'; zoneName: string;
  zoneTimeframe: TradeTimeframe; signalTimeframe: TradeTimeframe; engulfingType: string;
  source?: 'MTF' | 'ENGULFING'; higherZoneName?: string; entryZoneName?: string;
  entry: number; stopLoss: number; takeProfit: number; riskPips: number; rewardRisk: number;
  tradeStyle?: 'SCALPING' | 'INTRADAY'; riskFree?: number; openedAt: number;
  rfAt?: number; partialClosedVolume?: number; remainingVolume?: number;
  closedAt?: number; exitPrice?: number; returnR?: number;
}

const timeframes: Record<TradeTimeframe, string> = {
  M1: '1-minute', M5: '5-minute', M15: '15-minute', M30: '30-minute',
  H1: '1-hour', H4: '4-hour', D: '1-day',
};
const zoneName = (name: string) => name.replace(/^Int\.?\s+/i, 'Internal ');
const price = (value: number) => value.toLocaleString('en-US', {
  minimumFractionDigits: Math.abs(value) < 10 ? 5 : 3,
  maximumFractionDigits: Math.abs(value) < 10 ? 5 : 3,
});
const entryTime = (seconds: number) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kathmandu', day: 'numeric', month: 'short', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
}).format(seconds * 1000) + ' Nepal';

export function formatTelegramTradeMessage(alert: TelegramTradeAlert, number: TelegramTradeNumber): string {
  const style = alert.tradeStyle ?? (['M1', 'M5'].includes(alert.zoneTimeframe) ? 'SCALPING' : 'INTRADAY');
  const identity = `${alert.symbol} ${alert.direction} · ${style}`;
  const heading = (event: string) => `Trade #${number.tradeNumber} — ${event}\n${identity}`;
  if (alert.kind === 'tp' || alert.kind === 'sl') {
    return heading(alert.kind === 'tp' ? 'TAKE PROFIT HIT' : 'STOP LOSS HIT');
  }
  if (alert.kind === 'rf') return [heading('RISK-FREE HIT'), '',
    `1R reached: ${price(alert.riskFree!)}`, '',
    '✅ Partial position closed', '⏳ Remaining position is still open',
    `SL: ${price(alert.stopLoss)} · TP: ${price(alert.takeProfit)}`].join('\n');

  const mtf = alert.source === 'MTF' || alert.entryZoneName !== undefined;
  const setup = [
    `Main zone: ${timeframes[alert.zoneTimeframe]} ${zoneName(alert.higherZoneName ?? (mtf ? 'zone not recorded' : alert.zoneName))}`,
    ...(mtf ? [`Entry zone: ${timeframes[alert.signalTimeframe]} ${zoneName(alert.entryZoneName ?? alert.zoneName)}`] : []),
    `Confirmation: ${timeframes[alert.signalTimeframe]} ${alert.direction === 'BUY' ? 'bullish' : 'bearish'} engulfing ${alert.engulfingType}`,
    ...(!mtf ? ['Entry method: Candle confirmation at the main zone'] : []),
  ];
  if (alert.kind === 'cancelled') return [heading('PENDING ORDER CANCELLED'), '', ...setup, '',
    'Price moved beyond 1.5R before entry. The unfilled order was removed.',
    `Time: ${entryTime(alert.closedAt!)}`].join('\n');
  return [heading(alert.kind === 'pending' ? 'PENDING LIMIT ORDER' : 'NEW ENTRY'),
    ...(alert.outsideTradingTime ? ['⚠️ Outside trading hours'] : []), '',
    '📍 Trade setup', ...setup, '', '💰 Trade levels',
    `${alert.kind === 'pending' ? 'Limit entry' : 'Entry'}: ${price(alert.entry)}`,
    `Stop loss: ${price(alert.stopLoss)} · ${Number(alert.riskPips.toFixed(1))} pips`,
    ...(style === 'SCALPING' && alert.riskFree !== undefined ? [`Risk-free at 1R: ${price(alert.riskFree)}`] : []),
    `Take profit: ${price(alert.takeProfit)}`, `Risk/reward: 1:${alert.rewardRisk}`,
    ...(alert.kind === 'pending' ? ['This order has not filled yet.'] : []),
    '', `🕒 ${entryTime(alert.openedAt)}`].join('\n');
}

export interface DailyTradeCounts { date: string; total: number; wins: number; losses: number; riskFree: number }

export function previousNepalDay(nowSeconds: number): { date: string; start: number; end: number } {
  const offset = 20700;
  const end = Math.floor((nowSeconds + offset) / 86400) * 86400 - offset;
  return { start: end - 86400, end, date: new Date((end - 1 + offset) * 1000).toISOString().slice(0, 10) };
}

export function countDailyTrades(signals: readonly {
  id: string; account?: string; server?: string; status: string; closedAt?: number; updatedAt: number;
  brokerTicket?: number; brokerPosition?: number;
}[], account: string, server: string, nowSeconds: number): DailyTradeCounts {
  const day = previousNepalDay(nowSeconds);
  const unique = new Map<number, typeof signals[number]>();
  for (const signal of signals) {
    const ticket = signal.brokerPosition || signal.brokerTicket;
    if (signal.account !== account || signal.server !== server || !ticket || !['TP', 'SL', 'RF'].includes(signal.status)
      || signal.closedAt === undefined || signal.closedAt < day.start || signal.closedAt >= day.end) continue;
    const prior = unique.get(ticket);
    if (!prior || prior.updatedAt < signal.updatedAt) unique.set(ticket, signal);
  }
  const rows = [...unique.values()];
  return { date: day.date, total: rows.length, wins: rows.filter(row => row.status === 'TP').length,
    losses: rows.filter(row => row.status === 'SL').length, riskFree: rows.filter(row => row.status === 'RF').length };
}

export function formatDailyTradeSummary(summary: DailyTradeCounts): string {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${summary.date}T12:00:00Z`));
  return [`DAILY TRADE SUMMARY — ${date}`, '', `Total trades: ${summary.total}`,
    `✅ Wins: ${summary.wins}`, `❌ Losses: ${summary.losses}`, `🟡 Risk-free: ${summary.riskFree}`].join('\n');
}

export function telegramDemoMessages(): string[] {
  const base: TelegramTradeAlert = { id: 'demo', kind: 'entry', symbol: 'XAUUSD', direction: 'SELL',
    source: 'MTF', tradeStyle: 'SCALPING', zoneName: 'QML', higherZoneName: 'Internal DT', entryZoneName: 'QML',
    zoneTimeframe: 'M15', signalTimeframe: 'M1', engulfingType: 'T3', entry: 4021.48, stopLoss: 4024.05,
    takeProfit: 4014.01, riskFree: 4018.91, riskPips: 25.700000000001637, rewardRisk: 3,
    openedAt: Date.parse('2026-10-26T17:03:00Z') / 1000 };
  const number = { tradeNumber: 1, tradeDate: '2026-10-26' };
  const entries: TelegramTradeAlert[] = [base,
    { ...base, tradeStyle: 'INTRADAY', higherZoneName: 'DT', zoneTimeframe: 'H1', signalTimeframe: 'M5', engulfingType: 'T2' },
    { ...base, direction: 'BUY', source: 'ENGULFING', higherZoneName: 'QML', entryZoneName: undefined,
      zoneTimeframe: 'H1', signalTimeframe: 'M15', tradeStyle: 'INTRADAY', engulfingType: 'T1',
      entry: 4000, stopLoss: 3990, takeProfit: 4020, riskFree: undefined, riskPips: 100, rewardRisk: 2 },
    { ...base, direction: 'BUY', source: 'ENGULFING', higherZoneName: 'QML', entryZoneName: undefined,
      zoneTimeframe: 'H1', signalTimeframe: 'M5', engulfingType: 'T2',
      entry: 4000, stopLoss: 3998, takeProfit: 4006, riskFree: 4002, riskPips: 20 },
    ...(['rf', 'tp', 'sl', 'pending', 'cancelled'] as const).map(kind => ({ ...base, kind, closedAt: base.openedAt + 120 })),
  ];
  return [...entries.map(alert => formatTelegramTradeMessage(alert, number)),
    formatDailyTradeSummary({ date: '2026-10-26', total: 1, wins: 0, losses: 1, riskFree: 0 })]
    .map((message, index) => `DEMO ${index + 1}/10 — NOT A LIVE TRADE\n\n${message}`);
}
