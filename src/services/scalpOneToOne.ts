import { runVolumeStudy, type VolumeStudyRecord } from './volumeEngulfingStudy';
import type { StudyCandles } from './trendlineStudyHistory';
import { tradeToMt5Signal, scalpOneToOneVolumePasses, type Mt5SignalInput } from './mt5Automation';
import type { MarketTrend, TradeLevels, TradeTimeframe } from './tradeLevels';
import type { JournalTradeRecord } from '../components/TradeJournal';

/** Chart results are simulations, never broker fills. Pending/ambiguous rows are not results. */
export function scalpOneToOneChartRecord(r: VolumeStudyRecord): JournalTradeRecord | undefined {
  if (!scalpOneToOneVolumePasses(r.signal.type, r.v1, r.v2, r.v3)
    || r.filledAt === undefined || !['active', 'tp', 'sl'].includes(r.outcome)) return undefined;
  return {
    id: `SCALP_1_1:CHART:${r.signal.time}`, setupId: `SCALP_1_1:${r.signal.time}`,
    symbol: 'XAUUSD', zoneName: 'Scalp 1:1', zoneTimeframe: 'M15',
    source: 'ENGULFING', tradeStyle: 'SCALP_1_1',
    result: r.outcome === 'active' ? 'open' : r.outcome as 'tp' | 'sl',
    completedAt: r.resolvedAt ?? r.filledAt, openedAt: r.filledAt,
    signalAt: r.signal.time, signalTimeframe: 'M15', direction: r.signal.direction,
    engulfingType: r.signal.type, engulfingCandleCount: r.signal.candleCount,
    entry: r.levels.entry, stopLoss: r.levels.stopLoss, takeProfit: r.levels.takeProfit,
    rewardRisk: 1, riskPips: r.levels.riskPips,
    volumeLogicStatus: r.group === 'V3 < V2 and V1' ? 'best' : 'valid',
    volume1: r.v1, volume2: r.v2, volume3: r.v3, biasAtEntry: { H4: r.bias === 'none' ? 'neutral' : r.bias },
    autoReason: 'CHART ONLY result. Scalp 1:1: M15 volume confirmation with minimum 250-unit decrease, H4 bias and EMA20/50, H1 continuation/Far; fixed 1:1 SL/TP.',
  };
}

/** Live adapter for the approved study. No zone/Fib requirement or altered exit rule. */
export function buildScalpOneToOneSignals(candles: StudyCandles, now: number,
  pendingExpiryMinutes: number, maximumAgeSeconds = 120): Mt5SignalInput[] {
  if (!candles.M15?.length || !candles.H1?.length || !candles.H4?.length) return [];
  const result = runVolumeStudy({ symbol: 'XAUUSD', timeframe: 'M15', biasTimeframe: 'H4',
    h4EmaFilter: true, h1TrendlineFilter: true, cutoff: now, lookback: 2, candles });
  return result.records.filter(r => scalpOneToOneVolumePasses(r.signal.type, r.v1, r.v2, r.v3)
    && r.confirmedAt >= now - maximumAgeSeconds
    && r.confirmedAt <= now && r.outcome !== 'tp' && r.outcome !== 'sl'
    && r.outcome !== 'cancelled' && r.outcome !== 'ambiguous')
    .map(r => scalpOneToOneSignal(r, candles, now, pendingExpiryMinutes));
}

/** Convert an already-qualified study record without changing entry, SL or TP. */
export function scalpOneToOneSignal(r: VolumeStudyRecord, candles: StudyCandles,
  now: number, pendingExpiryMinutes: number): Mt5SignalInput {
    if (!scalpOneToOneVolumePasses(r.signal.type, r.v1, r.v2, r.v3)) {
      throw new Error('Scalp 1:1 requires a minimum 250-unit candle-volume decrease.');
    }
    const trade: TradeLevels = { ...r.levels, signal: { ...r.signal, timeframe: 'M15' } };
    const signal = tradeToMt5Signal({ source: 'ENGULFING', setupId: `SCALP_1_1:${r.signal.time}`,
      zoneName: 'Scalp 1:1', zoneTimeframe: 'M15', trade, now, pendingExpiryMinutes });
    // Namespace the strategy so an existing intraday signal cannot consume this setup.
    signal.id = `SCALP_1_1:${signal.id}`;
    signal.tradeStyle = 'SCALP_1_1';
    signal.zoneId = `SCALP_1_1-${r.signal.time}`;
    const biasAtEntry = Object.fromEntries(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D']
      .map(tf => [tf, tf === 'H4' ? r.bias : 'neutral'])) as Record<TradeTimeframe, MarketTrend>;
    signal.journalContext = { biasAtEntry,
      autoReason: 'Scalp 1:1: M15 T1/T2/T3 + minimum 250-unit volume decrease, closed H4 structure and EMA20/50 agreement, confirmed H1 continuation/Far. 30-pip pattern buffer; fixed 1:1 target.',
      volumeLogicStatus: r.group === 'V3 < V2 and V1' ? 'best' : 'valid',
      volume1: r.v1, volume2: r.v2, volume3: r.v3,
      entrySnapshotCandles: (candles.M15 ?? []).filter(c => c.time <= r.signal.time).slice(-25) };
    return signal;
}
