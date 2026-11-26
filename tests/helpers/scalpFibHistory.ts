import type { StudyCandles } from '../../src/services/trendlineStudyHistory';

/** Flat, closed pre-signal context for tests about entry geometry and exit accounting. */
export function withScalpFibHistory(candles: StudyCandles): StudyCandles {
  const first = candles.M15?.[0]?.time ?? 900;
  const history = (seconds: number) => Array.from({ length: 20 }, (_, index) => ({
    time: Math.floor(first / seconds) * seconds - (20 - index) * seconds,
    open: 50, high: 50, low: 50, close: 50, volume: 1000, complete: true,
  }));
  return { ...candles,
    M15: [...history(900), ...(candles.M15 ?? [])],
    H1: candles.H1 ?? history(3600), H4: candles.H4 ?? history(14400),
  };
}
