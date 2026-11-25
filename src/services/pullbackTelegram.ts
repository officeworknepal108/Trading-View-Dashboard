import type { PullbackChartSetup } from './pullbackChartSetup';
import type { AbhiEntryStatus, TelegramTradeAlert } from './telegramMessages';

/** Live chart facts only; second fills and exits share the first fill's identity. */
export function pullbackTelegramAlerts(setup: PullbackChartSetup, now: number): TelegramTradeAlert[] {
  if (setup.markerTime === undefined || setup.markerTime > now) return [];
  const second = setup.legs.find(leg => leg.leg === 25)!;
  const first = setup.legs.find(leg => leg.leg === 10)!;
  const firstFilled = first.chartConfirmed ?? first.filled, secondFilled = second.chartConfirmed ?? second.filled;
  const confirmation = setup.trade.signal.time + (setup.chartTimeframe === 'D' ? 86400
    : Number(setup.chartTimeframe.slice(1)) * (setup.chartTimeframe.startsWith('H') ? 3600 : 60));
  const status = (leg: typeof first): AbhiEntryStatus => {
    if (setup.secondOnly && leg.leg === 10) return 'skipped';
    if (leg.chartConfirmed ?? leg.filled) {
      if ((leg.chartOutcome === 'tp' || leg.chartOutcome === 'sl') && leg.chartResolvedAt !== undefined && leg.chartResolvedAt <= now) return leg.chartOutcome;
      return leg.uncertain || leg.chartOutcome === 'both' ? 'uncertain' : 'open';
    }
    if (leg.uncertain) return 'uncertain';
    return now >= confirmation + (setup.abhi ? 3600 : 4500) ? 'expired' : 'waiting';
  };
  const base: TelegramTradeAlert = { id: setup.telegramKey, tradeKey: setup.telegramKey,
    kind: 'entry', chartSetup: true, symbol: setup.symbol, tradeStyle: setup.style,
    direction: setup.trade.signal.direction === 'bullish' ? 'BUY' : 'SELL', zoneName: setup.abhi ? 'Abhi Scalp Logic' : 'Pullback setup',
    zoneTimeframe: setup.zoneTimeframe, signalTimeframe: setup.chartTimeframe, engulfingType: setup.trade.signal.type,
    entry: setup.trade.entry, stopLoss: setup.trade.stopLoss, takeProfit: setup.trade.takeProfit,
    riskPips: setup.trade.riskPips, rewardRisk: setup.trade.rewardRisk, openedAt: setup.markerTime,
    pullback: { firstEntry: first.entry, firstRiskPips: first.riskPips,
      secondEntry: second.entry, secondRiskPips: second.riskPips, secondOnly: setup.secondOnly,
      abhi: setup.abhi, firstTarget: first.takeProfit, secondTarget: second.takeProfit, netReturnR: setup.netReturnR,
      ...(setup.abhi ? { firstStatus: status(first), secondStatus: status(second) } : {}) } };
  const alerts: TelegramTradeAlert[] = [];
  // Do not replay an old day's entry alerts when opening or refreshing the dashboard.
  if (now <= confirmation + (setup.abhi ? 3600 : 4500) && (firstFilled || setup.secondOnly && secondFilled)) alerts.push(base);
  if (!setup.secondOnly && firstFilled && secondFilled) alerts.push({ ...base, kind: 'entry2' });
  const confirmed = setup.legs.filter(leg => leg.chartConfirmed ?? leg.filled);
  if (setup.abhi) for (const leg of confirmed) {
    const outcome = status(leg);
    if (outcome !== 'tp' && outcome !== 'sl') continue;
    alerts.push({ ...base, kind: 'leg-result', legResult: { leg: leg.leg, outcome },
      closedAt: leg.chartResolvedAt, exitPrice: outcome === 'tp' ? leg.takeProfit : setup.trade.stopLoss,
      returnR: outcome === 'tp' ? 1.25 : -1 });
  }
  const result = confirmed[0]?.chartOutcome;
  if (setup.abhi && setup.netReturnR !== undefined && confirmed.length > 0
    && confirmed.length === setup.legs.filter(leg=>leg.filled).length
    && setup.legs.every(leg => ['tp', 'sl', 'expired', 'skipped'].includes(status(leg)))
    && confirmed.every(leg=>leg.chartOutcome==='tp'||leg.chartOutcome==='sl')) {
    alerts.push({ ...base, kind: setup.netReturnR >= 0 ? 'tp' : 'sl',
      closedAt: Math.max(...confirmed.map(leg=>leg.chartResolvedAt!)), returnR: setup.netReturnR });
    return alerts;
  }
  if (!setup.abhi && (result === 'tp' || result === 'sl') && confirmed.every(leg => leg.chartOutcome === result)) alerts.push({ ...base,
    kind: result, closedAt: Math.max(...confirmed.map(leg => leg.chartResolvedAt!)),
    exitPrice: result === 'tp' ? setup.trade.takeProfit : setup.trade.stopLoss, returnR: result === 'tp' ? setup.trade.rewardRisk : -1 });
  return alerts;
}
