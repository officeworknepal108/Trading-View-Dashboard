import type { StructureCandle } from './marketStructure';

export interface SwingFibSeed {
  sourceTime: number;
  sourcePrice: number;
  zeroTime: number;
  zeroPrice: number;
}

export interface SwingFibMove extends SwingFibSeed {
  direction: 'up' | 'down';
  startedAt: number;
}

/** Seed the hourly swing from the latest H1 structure turn and its nearest
 * opposite H1 candle pivot. The 4H swing keeps its existing seed and rules. */
export function buildOneHourSwingFibs(
  candles: StructureCandle[],
  markers: Array<{ time: number; text?: string }>,
): SwingFibMove[] {
  const completed = candles.filter((candle) => candle.complete !== false);
  const marker = markers.filter((item) => item.text === 'SH' || item.text === 'SL')
    .sort((first, second) => Number(first.time) - Number(second.time)).at(-1);
  const turnIndex = marker ? completed.findIndex((candle) => candle.time === Number(marker.time)) : -1;
  if (turnIndex < 4 || turnIndex < completed.length - 120) return [];
  const sourceIsHigh = marker?.text === 'SL';
  const first = Math.max(2, turnIndex - 36);
  for (let index = turnIndex - 3; index >= first; index -= 1) {
    const candle = completed[index];
    const left = completed.slice(index - 2, index);
    const right = completed.slice(index + 1, index + 3);
    const pivot = sourceIsHigh
      ? left.every((item) => candle.high > item.high)
        && right.every((item) => candle.high >= item.high)
      : left.every((item) => candle.low < item.low)
        && right.every((item) => candle.low <= item.low);
    if (!pivot) continue;
    return buildAlternatingSwingFibs(completed, {
      sourceTime: candle.time,
      sourcePrice: sourceIsHigh ? candle.high : candle.low,
      zeroTime: completed[turnIndex].time,
      zeroPrice: sourceIsHigh ? completed[turnIndex].low : completed[turnIndex].high,
    });
  }
  return [];
}

/**
 * Builds an alternating swing FIB chain. Level 1 stays at the move origin and
 * level 0 follows the continuation extreme. A completed candle crossing 0.5
 * from the level-0 side starts the opposite move from that extreme.
 */
export function buildAlternatingSwingFibs(
  candles: StructureCandle[],
  seed: SwingFibSeed,
): SwingFibMove[] {
  // A Swing FIB measures momentum across an H4 range. High-to-low movement
  // contained inside one candle is not a swing, regardless of its size.
  if (seed.sourceTime === seed.zeroTime || seed.sourcePrice === seed.zeroPrice) return [];

  const initial: SwingFibMove = {
    ...seed,
    direction: seed.zeroPrice > seed.sourcePrice ? 'up' : 'down',
    startedAt: seed.sourceTime,
  };
  const moves: SwingFibMove[] = [initial];
  let active = initial;

  for (const candle of candles) {
    if (candle.time <= active.zeroTime) continue;

    if (active.direction === 'up') {
      if (candle.high > active.zeroPrice) {
        active.zeroPrice = candle.high;
        active.zeroTime = candle.time;
        continue;
      }
      // The live H4 candle may extend level 0 to the latest high, but it cannot
      // confirm a new opposite Swing FIB until that candle is complete.
      if (candle.complete === false) continue;
      const midpoint = active.zeroPrice + (active.sourcePrice - active.zeroPrice) * 0.5;
      if (candle.open <= midpoint || candle.low > midpoint) continue;
      active = {
        direction: 'down',
        sourceTime: active.zeroTime,
        sourcePrice: active.zeroPrice,
        zeroTime: candle.time,
        zeroPrice: candle.low,
        startedAt: candle.time,
      };
      moves.push(active);
      continue;
    }

    if (candle.low < active.zeroPrice) {
      active.zeroPrice = candle.low;
      active.zeroTime = candle.time;
      continue;
    }
    // Apply the mirrored rule to a live downward Swing FIB: track its latest
    // low immediately, while waiting for a completed candle to reverse it.
    if (candle.complete === false) continue;
    const midpoint = active.zeroPrice + (active.sourcePrice - active.zeroPrice) * 0.5;
    if (candle.open >= midpoint || candle.high < midpoint) continue;
    active = {
      direction: 'up',
      sourceTime: active.zeroTime,
      sourcePrice: active.zeroPrice,
      zeroTime: candle.time,
      zeroPrice: candle.high,
      startedAt: candle.time,
    };
    moves.push(active);
  }

  return moves.slice(-2);
}
