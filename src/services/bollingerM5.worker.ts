import { runBollingerStudy, type BollingerInput } from './bollingerM5';
self.onmessage = (event: MessageEvent<BollingerInput>) => {
  try { self.postMessage({ result: runBollingerStudy(event.data,
    (done, total) => self.postMessage({ progress: `${done} / ${total} M5 candles` })) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Bollinger scan failed.' }); }
};
