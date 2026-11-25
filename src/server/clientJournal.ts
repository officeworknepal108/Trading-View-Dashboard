import { chartOnlyTradeRecords } from '../services/chartEntryData';

export function clientVisibleTrades<T extends { id: string; mt5Managed?: unknown; mt5SignalId?: unknown;
  brokerTicket?: unknown; realizedProfit?: unknown }>(trades: T[]): T[] {
  return chartOnlyTradeRecords(trades);
}
