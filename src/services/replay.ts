export interface TimedValue {
  time: number;
}

/**
 * Finds the candle that contains (or immediately precedes) a replay timestamp.
 * Returning null instead of silently clamping prevents Replay from jumping to a
 * different date when a newly selected timeframe has not loaded that date.
 */
export function findReplayIndexAtOrBefore<T extends TimedValue>(
  candles: readonly T[],
  replayTime: number,
): number | null {
  if (candles.length === 0 || replayTime < candles[0].time) return null;

  let low = 0;
  let high = candles.length - 1;
  let match = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time <= replayTime) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}
