import { runTrendlineStudy, runEntryArrowStudy, type EntryArrowStudyInput, type TrendlineStudyInput } from './trendlineStudy';

self.onmessage = (event: MessageEvent<TrendlineStudyInput | EntryArrowStudyInput>) => {
  try {
    const progress = (done: number, total: number) => {
      if (done === 1 || done % 10 === 0 || done === total) self.postMessage({ progress: { done, total } });
    };
    const result = 'kind' in event.data && event.data.kind === 'entry-arrows'
      ? runEntryArrowStudy(event.data, progress) : runTrendlineStudy(event.data as TrendlineStudyInput, progress);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Study calculation failed' });
  }
};
