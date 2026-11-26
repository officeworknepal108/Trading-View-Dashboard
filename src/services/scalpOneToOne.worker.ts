import { buildScalpOneToOneSignals, scalpOneToOneChartHistory } from './scalpOneToOne';
import { runVolumeStudy, VOLUME_STUDY_MAX_LOOKBACK } from './volumeEngulfingStudy';
import type { StudyCandles } from './trendlineStudyHistory';

self.onmessage = (event: MessageEvent<{ taskId: number;
  input: { candles: StudyCandles; now: number; pendingExpiryMinutes: number } }>) => {
  const { taskId, input } = event.data;
  const post = (result: object) => self.postMessage({ taskId, now: input.now, ...result });
  try {
    const { candles, now, pendingExpiryMinutes } = input;
    if (!candles.M15?.length || !candles.H1?.length || !candles.H4?.length) {
      post({ signals: [], records: [], fills: [], error: 'Waiting for M15, H1 and H4 history.' });
      return;
    }
    // Publish recent confirmations before the longer historical scan.
    post({ signals: buildScalpOneToOneSignals(candles, now, pendingExpiryMinutes, 1800), progress: 0 });
    const study = runVolumeStudy({ symbol: 'XAUUSD', timeframe: 'M15', biasTimeframe: 'H4',
      h4EmaFilter: true, h1TrendlineFilter: true, cutoff: now,
      lookback: Math.min(VOLUME_STUDY_MAX_LOOKBACK, candles.M15.length), candles },
      (done, total) => post({ progress: Math.round(done / Math.max(1, total) * 70) }));
    const history = study.records.map((record, index) => {
      const row = scalpOneToOneChartHistory(record, candles, now);
      if (index % 10 === 0) post({ progress: 70 + Math.round((index + 1) / Math.max(1, study.records.length) * 30) });
      return row;
    });
    post({ records: history.flatMap(row => row.records), fills: history.flatMap(row => row.fills) });
  } catch (error) {
    post({ signals: [], records: [], fills: [], error: error instanceof Error ? error.message : 'Scalp 1:1 history unavailable.' });
  } finally {
    post({ done: true });
  }
};
