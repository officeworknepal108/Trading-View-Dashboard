import { analyzeMarketStructure, classifyMoveFibZone, type StructureCandle, type StructureLine, type StructureZone } from './marketStructure';
import { buildDayFibs, selectDayFibForTime } from './dayFib';
import { applyDayFibConfluence } from './dayFibConfluence';
import { buildAlternatingSwingFibs, buildOneHourSwingFibs } from './swingFib';
import { applyPostChochH1SwingFibConfluence, applySwingFibConfluence } from './swingFibConfluence';
import type { TradeTimeframe, ZoneEngulfingFibSource } from './tradeLevels';

export type FibBadgeTiming = Partial<Record<ZoneEngulfingFibSource, boolean>>;

/** Display evidence only. Unknown history never means that alignment happened later. */
export function fibBadgeTiming(options: {
  zone: StructureZone; observedTime?: number; timeframe: TradeTimeframe;
  candles: StructureCandle[]; h4Candles?: StructureCandle[]; h1Candles?: StructureCandle[];
  lines?: StructureLine[];
}): FibBadgeTiming {
  const { zone, observedTime, timeframe, candles } = options;
  if (observedTime === undefined || !candles.some(candle => candle.time === observedTime)) return {};
  const historical = candles.filter(candle => candle.time <= observedTime);
  const seconds = timeframe === 'D' ? 86400 : Number(timeframe.slice(1)) * (timeframe.startsWith('H') ? 3600 : 60);
  const closedAt = observedTime + seconds;
  const result: FibBadgeTiming = {};
  if (zone.fibStatus === 'a-plus' && zone.fibSourceTime !== undefined && zone.fibSourcePrice !== undefined) {
    if (zone.fibSourceTime > observedTime) result.structure = true;
    else {
      const move = historical.filter(candle => candle.complete !== false && candle.time >= zone.fibSourceTime!);
      if (move[0]?.time === zone.fibSourceTime) {
        const zero = move.reduce((best, candle) => (zone.isBuy ? candle.high > best.high : candle.low < best.low) ? candle : best);
        result.structure = classifyMoveFibZone(historical, zone, zone.fibSourcePrice,
          zone.isBuy ? zero.high : zero.low, zero.time) === undefined;
      }
    }
  }
  if (zone.dayFibStatus === 'a-plus') {
    const move = selectDayFibForTime(buildDayFibs(historical), observedTime);
    result.day = applyDayFibConfluence(historical, [zone], move, 10, observedTime).zones[0].dayFibStatus !== 'a-plus';
  }
  if (zone.swingFibStatus === 'a-plus') {
    const h4 = options.h4Candles?.filter(candle => candle.complete !== false && candle.time + 14400 <= closedAt);
    if (h4 && h4.length >= 12) {
      const structure = analyzeMarketStructure(h4, { allowSupplyDemand: true, sourceBarSeconds: 14400,
        confirmationBarSeconds: 86400, zoneVisualBars: 30 });
      const seed = structure.lines.filter(line => line.type === 'swing' && line.fromTime !== line.toTime
        && line.fromPrice !== line.toPrice).sort((a, b) => a.toTime - b.toTime)[0];
      const moves = seed ? buildAlternatingSwingFibs(h4, { sourceTime: seed.fromTime, sourcePrice: seed.fromPrice,
        zeroTime: seed.toTime, zeroPrice: seed.toPrice }) : [];
      result.swing = applySwingFibConfluence(historical, [zone], moves).zones[0].swingFibStatus !== 'a-plus';
    }
  }
  if (zone.h1SwingFibStatus === 'aligned') {
    const h1 = options.h1Candles?.filter(candle => candle.complete !== false && candle.time + 3600 <= closedAt);
    if (h1 && h1.length >= 12 && options.lines) {
      const structure = analyzeMarketStructure(h1, { allowSupplyDemand: true, sourceBarSeconds: 3600,
        confirmationBarSeconds: 14400, zoneVisualBars: 30 });
      const moves = buildOneHourSwingFibs(h1, structure.markers);
      const lines = options.lines.filter(line => line.toTime <= observedTime);
      result.h1Swing = applyPostChochH1SwingFibConfluence(historical, [zone], lines, moves)[0].h1SwingFibStatus !== 'aligned';
    }
  }
  return result;
}
