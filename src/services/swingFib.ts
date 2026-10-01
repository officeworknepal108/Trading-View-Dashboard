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

/**
 * Builds an alternating swing FIB chain. Level 1 stays at the move origin and
 * level 0 follows the continuation extreme. A completed candle touching 0.5
 * starts the next move in the opposite direction from that level-0 extreme.
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
    if (candle.complete === false || candle.time <= active.zeroTime) continue;

    if (active.direction === 'up') {
      if (candle.high > active.zeroPrice) {
        active.zeroPrice = candle.high;
        active.zeroTime = candle.time;
        continue;
      }
      const midpoint = active.zeroPrice + (active.sourcePrice - active.zeroPrice) * 0.5;
      if (candle.low > midpoint) continue;
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
    const midpoint = active.zeroPrice + (active.sourcePrice - active.zeroPrice) * 0.5;
    if (candle.high < midpoint) continue;
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
