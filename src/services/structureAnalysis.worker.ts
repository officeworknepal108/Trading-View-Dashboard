import { prepareStructureAnalysis, type PreparedStructureAnalysis, type StructureAnalysisTask } from './structureAnalysis';

const cache = new Map<string, PreparedStructureAnalysis>();
self.onmessage = (event: MessageEvent<{ id: number; tasks: StructureAnalysisTask[] }>) => {
  try {
    self.postMessage({ id: event.data.id, updates: prepareStructureAnalysis(event.data.tasks, cache) });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
