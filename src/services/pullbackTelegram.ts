import type { PullbackChartSetup } from './pullbackChartSetup';
import type { TelegramTradeAlert } from './telegramMessages';

/** Live chart facts only; second fills and exits share the first fill's identity. */
export function pullbackTelegramAlerts(setup: PullbackChartSetup, now: number): TelegramTradeAlert[] {
  if (setup.markerTime === undefined || setup.markerTime > now) return [];
  const second = setup.legs.find(leg => leg.leg === 25)!;
  const first = setup.legs.find(leg => leg.leg === 10)!;
  const firstFilled = first.chartConfirmed ?? first.filled, secondFilled = second.chartConfirmed ?? second.filled;
  const base: TelegramTradeAlert = { id: setup.telegramKey, tradeKey: setup.telegramKey,
    kind: 'entry', chartSetup: true, symbol: setup.symbol, tradeStyle: setup.style,
    direction: setup.trade.signal.direction === 'bullish' ? 'BUY' : 'SELL', zoneName: 'Pullback setup',
    zoneTimeframe: setup.zoneTimeframe, signalTimeframe: setup.chartTimeframe, engulfingType: setup.trade.signal.type,
    entry: setup.trade.entry, stopLoss: setup.trade.stopLoss, takeProfit: setup.trade.takeProfit,
    riskPips: setup.trade.riskPips, rewardRisk: setup.trade.rewardRisk, openedAt: setup.markerTime,
    pullback: { firstEntry: first.entry, firstRiskPips: first.riskPips,
      secondEntry: second.entry, secondRiskPips: second.riskPips, secondOnly: setup.secondOnly } };
  const alerts: TelegramTradeAlert[] = [];
  const confirmation = setup.trade.signal.time + (setup.chartTimeframe === 'D' ? 86400
    : Number(setup.chartTimeframe.slice(1)) * (setup.chartTimeframe.startsWith('H') ? 3600 : 60));
  // Do not replay an old day's entry alerts when opening or refreshing the dashboard.
  if (now <= confirmation + 4500 && (firstFilled || setup.secondOnly && secondFilled)) alerts.push(base);
  if (!setup.secondOnly && firstFilled && secondFilled) alerts.push({ ...base, kind: 'entry2' });
  const confirmed = setup.legs.filter(leg => leg.chartConfirmed ?? leg.filled);
  const result = confirmed[0]?.chartOutcome;
  if ((result === 'tp' || result === 'sl') && confirmed.every(leg => leg.chartOutcome === result)) alerts.push({ ...base,
    kind: result, closedAt: Math.max(...confirmed.map(leg => leg.chartResolvedAt!)),
    exitPrice: result === 'tp' ? setup.trade.takeProfit : setup.trade.stopLoss, returnR: result === 'tp' ? setup.trade.rewardRisk : -1 });
  return alerts;
}
