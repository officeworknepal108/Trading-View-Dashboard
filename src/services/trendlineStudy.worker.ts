import { runTrendlineStudy, type TrendlineStudyInput } from './trendlineStudy';

self.onmessage = (event: MessageEvent<TrendlineStudyInput>) => {
  try {
    const result = runTrendlineStudy(event.data, (done, total) => {
      if (done === 1 || done % 10 === 0 || done === total) self.postMessage({ progress: { done, total } });
    });
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Study calculation failed' });
  }
};
