import { buildCanonicalTradeRecords } from './tradeRecordFilters';
import { buildPullbackChartSetups } from './pullbackChartSetup';

export interface ChartRecordIdentity {
  id: string; mt5Managed?: unknown; mt5SignalId?: unknown;
  brokerTicket?: unknown; realizedProfit?: unknown;
}

export function isBrokerChartRecord(record: ChartRecordIdentity): boolean {
  return !!record.mt5Managed || !!record.mt5SignalId || record.brokerTicket !== undefined
    || record.realizedProfit !== undefined || record.id.startsWith('MT5:');
}

/** Both roles use these facts; broker results must never win chart deduplication. */
export function chartOnlyTradeRecords<T extends ChartRecordIdentity>(records: readonly T[]): T[] {
  return records.filter(record => !isBrokerChartRecord(record));
}

export function buildChartEntryHistory<T extends Parameters<typeof buildCanonicalTradeRecords>[0][number]>(
  saved: readonly T[], current: readonly T[], options: Parameters<typeof buildCanonicalTradeRecords>[2],
): T[] {
  return buildCanonicalTradeRecords(chartOnlyTradeRecords(saved), chartOnlyTradeRecords(current), options);
}

/** Chart fills use candle evidence, never private execution or minimum-lot state. */
export function buildChartPullbackSetups(options: Parameters<typeof buildPullbackChartSetups>[0]) {
  return buildPullbackChartSetups({ ...options,
    signals: chartOnlyTradeRecords(options.signals), positions: [], context: {},
  });
}

/** Replay tables must use the same chart facts as replay drawings and arrows. */
export function buildZoneTablePullbackSetups(options: Omit<Parameters<typeof buildPullbackChartSetups>[0], 'signals'> & {
  replay: boolean;
  chartSignals: Parameters<typeof buildPullbackChartSetups>[0]['signals'];
  brokerSignals: Parameters<typeof buildPullbackChartSetups>[0]['signals'];
}) {
  const { replay, chartSignals, brokerSignals, ...display } = options;
  return buildPullbackChartSetups({ ...display,
    signals: replay ? chartOnlyTradeRecords(chartSignals) : [...chartSignals, ...brokerSignals],
    positions: replay ? [] : display.positions, context: replay ? {} : display.context,
  });
}
