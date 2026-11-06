import type { StructureCandle } from './marketStructure';

export interface AutoTrendline {
  firstIndex: number;
  secondIndex: number;
  firstPrice: number;
  slope: number;
  direction: 'up' | 'down';
  kind: 'continuation' | 'breakout';
  touches: number;
  lastTouchIndex: number;
  thirdTouchIndex?: number;
}

export function detectAutoTrendlines(candles: StructureCandle[], pipSize: number,
  allowLiveTouches = false): AutoTrendline[] {
  const lastClosedIndex = candles.length - (candles.at(-1)?.complete === false ? 2 : 1);
  if (lastClosedIndex < 8) return [];
  const firstSearchIndex = Math.max(2, lastClosedIndex - 320);
  const tolerance = Math.max(pipSize * 2, 1e-8);
  const candidates: AutoTrendline[] = [];
  const candleRangeSums = [0];
  for (const candle of candles) {
    candleRangeSums.push(candleRangeSums[candleRangeSums.length - 1] + candle.high - candle.low);
  }
  const clearanceDistances = candles.map((_, index) => {
    const recentStart = Math.max(0, index - 19);
    const averageRange = (candleRangeSums[index + 1] - candleRangeSums[recentStart])
      / (index + 1 - recentStart);
    return Math.max(pipSize * 3, averageRange * 1.5);
  });

  for (const direction of ['up', 'down'] as const) {
    const isUp = direction === 'up';
    const pivots: number[] = [];
    for (let index = firstSearchIndex; index <= lastClosedIndex - 2; index += 1) {
      const value = isUp ? candles[index].low : candles[index].high;
      const neighbors = [index - 2, index - 1, index + 1, index + 2];
      if (neighbors.every((neighbor) => isUp
        ? value <= candles[neighbor].low : value >= candles[neighbor].high)) pivots.push(index);
    }
    for (let first = 0; first < pivots.length; first += 1) {
      const firstIndex = pivots[first];
      const firstPrice = isUp ? candles[firstIndex].low : candles[firstIndex].high;
      for (let secondIndex = firstIndex + 5;
        secondIndex <= Math.min(lastClosedIndex, firstIndex + 240); secondIndex += 1) {
        const candle = candles[secondIndex];
        // The first anchor is always the wick tip. The second contact can be
        // either the wick tip or the nearest edge of the candle body.
        for (const secondPrice of new Set([
          isUp ? candle.low : candle.high,
          isUp ? Math.min(candle.open, candle.close) : Math.max(candle.open, candle.close),
          (candle.open + candle.close) / 2,
        ])) {
          if (isUp ? secondPrice <= firstPrice + tolerance : secondPrice >= firstPrice - tolerance) continue;
          const slope = (secondPrice - firstPrice) / (secondIndex - firstIndex);
          const priceAt = (index: number) => firstPrice + slope * (index - firstIndex);
          const whollyBeyond = (index: number) => isUp
            ? candles[index].high < priceAt(index)
            : candles[index].low > priceAt(index);
          const clearlyAway = (index: number, breakout = false) => index <= lastClosedIndex && (
            isUp !== breakout
              ? candles[index].low - priceAt(index) >= clearanceDistances[index]
              : priceAt(index) - candles[index].high >= clearanceDistances[index]
          );
          let brokenBeforeSecond = false;
          let firstLegMovedAway = false;
          for (let index = firstIndex + 1; index < secondIndex; index += 1) {
            const contact = candles[index].low <= priceAt(index) + tolerance
              && candles[index].high >= priceAt(index) - tolerance;
            const earlierContact = index - firstIndex >= 5 && firstLegMovedAway && contact;
            if (whollyBeyond(index) || earlierContact) { brokenBeforeSecond = true; break; }
            if (contact) firstLegMovedAway = false;
            if (clearlyAway(index)) firstLegMovedAway = true;
          }
          if (brokenBeforeSecond || !firstLegMovedAway) continue;

          let breakIndex = -1;
          let retestIndex = -1;
          let firstRetestIndex = -1;
          let touches = 2;
          let lastTouchIndex = secondIndex;
          let thirdTouchIndex: number | undefined;
          let movedAwayFromLine = false;
          const lastScanIndex = allowLiveTouches ? candles.length - 1 : lastClosedIndex;
          for (let index = secondIndex + 1; index <= lastScanIndex; index += 1) {
            const linePrice = priceAt(index);
            const candleAtIndex = candles[index];
            const touchesLine = candleAtIndex.low <= linePrice + tolerance
              && candleAtIndex.high >= linePrice - tolerance;
            const hasTouchSpacing = touches >= 6 || index - lastTouchIndex >= 5;
            if (breakIndex < 0) {
              if (index <= lastClosedIndex && whollyBeyond(index)) {
                breakIndex = index;
                movedAwayFromLine = clearlyAway(index, true);
                continue;
              }
              if (hasTouchSpacing && movedAwayFromLine && touchesLine) {
                touches += 1;
                lastTouchIndex = index;
                if (thirdTouchIndex === undefined) thirdTouchIndex = index;
              }
              if (touchesLine) movedAwayFromLine = false;
              if (touches < 6 ? clearlyAway(index)
                : isUp ? candleAtIndex.low > linePrice + tolerance
                  : candleAtIndex.high < linePrice - tolerance) movedAwayFromLine = true;
            } else {
              if (touchesLine) {
                if (firstRetestIndex < 0) firstRetestIndex = index;
                if (hasTouchSpacing && movedAwayFromLine) {
                  retestIndex = index;
                  break;
                }
                movedAwayFromLine = false;
              }
              if (clearlyAway(index, true)) movedAwayFromLine = true;
            }
          }
          if (breakIndex >= 0 && retestIndex < 0) continue;
          if (retestIndex >= 0) {
            if (thirdTouchIndex === undefined) thirdTouchIndex = retestIndex;
            let invalidated = false;
            for (let index = firstRetestIndex; index <= lastClosedIndex; index += 1) {
              if (isUp ? candles[index].close >= priceAt(index)
                : candles[index].close <= priceAt(index)) {
                invalidated = true;
                break;
              }
            }
            if (invalidated) continue;
          }
          if (thirdTouchIndex === undefined) continue;
          candidates.push({
            firstIndex, secondIndex, firstPrice, slope, direction,
            kind: breakIndex < 0 ? 'continuation' : 'breakout',
            touches,
            lastTouchIndex: retestIndex >= 0 ? retestIndex : lastTouchIndex,
            thirdTouchIndex,
          });
        }
      }
    }
  }

  const selected: AutoTrendline[] = [];
  for (const kind of ['continuation', 'breakout'] as const) {
    for (const direction of ['up', 'down'] as const) {
      const ranked = candidates.filter((line) => line.kind === kind && line.direction === direction)
        .sort((a, b) => b.touches - a.touches || b.lastTouchIndex - a.lastTouchIndex
          || b.secondIndex - a.secondIndex);
      for (const line of ranked) {
        if (selected.filter((chosen) => chosen.kind === kind && chosen.direction === direction).length >= 2) break;
        const linePrice = line.firstPrice + line.slope * (lastClosedIndex - line.firstIndex);
        if (selected.some((chosen) => chosen.kind === kind && chosen.direction === direction
          && ((chosen.firstIndex === line.firstIndex && chosen.secondIndex === line.secondIndex)
            || Math.abs((chosen.firstPrice + chosen.slope * (lastClosedIndex - chosen.firstIndex)) - linePrice)
              < tolerance * 3))) continue;
        selected.push(line);
      }
    }
  }
  return selected;
}
