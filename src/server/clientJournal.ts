export function clientVisibleTrades<T extends { id: string; mt5Managed?: unknown; mt5SignalId?: unknown;
  brokerTicket?: unknown; realizedProfit?: unknown }>(trades: T[]): T[] {
  return trades.filter(trade => !trade.mt5Managed && !trade.mt5SignalId
    && trade.brokerTicket === undefined && trade.realizedProfit === undefined && !trade.id.startsWith('MT5:'));
}
