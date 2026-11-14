import { buildScalpOneToOneSignals } from './scalpOneToOne';
import type { StudyCandles } from './trendlineStudyHistory';

self.onmessage = (event: MessageEvent<{ candles: StudyCandles; now: number; pendingExpiryMinutes: number }>) => {
  try {
    self.postMessage({ signals: buildScalpOneToOneSignals(event.data.candles,
      event.data.now, event.data.pendingExpiryMinutes, 1800) });
  } catch {
    self.postMessage({ signals: [] });
  }
};
