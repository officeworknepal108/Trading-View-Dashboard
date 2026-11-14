import { runVolumeStudy, type VolumeStudyInput } from './volumeEngulfingStudy';

self.onmessage = (event: MessageEvent<VolumeStudyInput>) => {
  try {
    const result = runVolumeStudy(event.data, (done, total) => self.postMessage({ progress: { done, total } }));
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'The volume study could not finish.' });
  }
};
