import { buildScalpOneToOneSignals, scalpOneToOneChartRecord } from './scalpOneToOne';
import { runVolumeStudy, VOLUME_STUDY_MAX_LOOKBACK } from './volumeEngulfingStudy';
import type { StudyCandles } from './trendlineStudyHistory';

self.onmessage = (event: MessageEvent<{ candles: StudyCandles; now: number; pendingExpiryMinutes: number }>) => {
  try {
    const { candles, now, pendingExpiryMinutes } = event.data;
    if (!candles.M15?.length || !candles.H1?.length || !candles.H4?.length) {
      self.postMessage({ signals: [], records: [], error: 'Waiting for M15, H1 and H4 history.' });
      return;
    }
    // Publish recent confirmations before the longer historical scan.
    self.postMessage({ signals: buildScalpOneToOneSignals(candles, now, pendingExpiryMinutes, 1800), progress: 0 });
    const study = runVolumeStudy({ symbol: 'XAUUSD', timeframe: 'M15', biasTimeframe: 'H4',
      h4EmaFilter: true, h1TrendlineFilter: true, cutoff: now,
      lookback: Math.min(VOLUME_STUDY_MAX_LOOKBACK, candles.M15.length), candles },
      (done, total) => self.postMessage({ progress: Math.round(done / Math.max(1, total) * 100) }));
    self.postMessage({
      records: study.records.map(scalpOneToOneChartRecord).filter(Boolean),
    });
  } catch (error) {
    self.postMessage({ signals: [], records: [], error: error instanceof Error ? error.message : 'Scalp 1:1 history unavailable.' });
  }
};
