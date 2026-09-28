import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';

export interface StructureCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface StructureZone {
  id: string;
  name: 'TJL1' | 'TJL2' | 'QML' | 'SBR' | 'RBS' | 'DT' | 'DB' | 'ISS L3' | 'ISS L4' | 'SUPPLY' | 'DEMAND';
  category: 'mg' | 'iss' | 'supplyDemand';
  isBuy: boolean;
  startTime: number;
  endTime: number;
  top: number;
  bottom: number;
  active: boolean;
  status: 'pending' | 'valid' | 'rejected' | 'invalidated';
  tapTime?: number;
  tapBarsAgo?: number;
}

export interface StructureLine {
  id: string;
  type: 'swing' | 'bos' | 'choch' | 'iss';
  direction: 'bullish' | 'bearish';
  fromTime: number;
  fromPrice: number;
  toTime: number;
  toPrice: number;
  label?: string;
}

export interface MarketStructureResult {
  markers: SeriesMarker<UTCTimestamp>[];
  issMarkers: SeriesMarker<UTCTimestamp>[];
  zones: StructureZone[];
  lines: StructureLine[];
  trend: 'bullish' | 'bearish' | 'neutral';
  genesis?: { time: number; price: number };
}

interface StructurePoint {
  index: number;
  time: number;
  price: number;
}

function makeMarker(
  candle: StructureCandle,
  text: string,
  position: 'aboveBar' | 'belowBar',
  color: string,
  shape: 'arrowUp' | 'arrowDown' | 'circle' = 'circle',
  size = 1,
): SeriesMarker<UTCTimestamp> {
  return { time: candle.time as UTCTimestamp, position, color, shape, text, size };
}

function extreme(
  candles: StructureCandle[],
  from: number,
  to: number,
  kind: 'high' | 'low',
  excludedIndex: number | null = null,
): StructurePoint {
  let selected = Math.max(0, Math.min(from, candles.length - 1));
  const end = Math.max(selected, Math.min(to, candles.length - 1));
  for (let index = selected; index <= end; index += 1) {
    if (index === excludedIndex) continue;
    if (kind === 'high' && candles[index].high > candles[selected].high) selected = index;
    if (kind === 'low' && candles[index].low < candles[selected].low) selected = index;
  }
  return {
    index: selected,
    time: candles[selected].time,
    price: kind === 'high' ? candles[selected].high : candles[selected].low,
  };
}

function findOrderBlock(candles: StructureCandle[], from: number, to: number, bullish: boolean): number {
  const start = Math.max(from, to - 12);
  for (let index = to - 1; index >= start; index -= 1) {
    const opposite = bullish
      ? candles[index].close < candles[index].open
      : candles[index].close > candles[index].open;
    if (opposite) return index;
  }
  return Math.max(start, to - 1);
}

function resolveTjl1Confirmation(candles: StructureCandle[], options: {
  isBuy: boolean;
  bottom: number;
  top: number;
  formationTime: number;
  sourceBarSeconds: number;
  confirmationBarSeconds?: number;
}): StructureZone['status'] {
  const confirmationSeconds = options.confirmationBarSeconds;
  if (!confirmationSeconds || confirmationSeconds <= options.sourceBarSeconds) return 'valid';

  const grouped = new Map<number, StructureCandle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.time / confirmationSeconds) * confirmationSeconds;
    const list = grouped.get(bucket) || [];
    list.push(candle);
    grouped.set(bucket, list);
  }
  const bars = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, list]) => ({
      time,
      open: list[0].open,
      high: Math.max(...list.map((candle) => candle.high)),
      low: Math.min(...list.map((candle) => candle.low)),
      close: list[list.length - 1].close,
    }));

  // The latest aggregate bar may still be forming. Only completed higher-TF bars count.
  const completedBars = bars.slice(0, -1);
  const confirmationBar = completedBars.find(
    (bar) => bar.time + confirmationSeconds >= options.formationTime,
  );
  if (!confirmationBar) return 'pending';
  return options.isBuy
    ? confirmationBar.close > options.top ? 'valid' : 'rejected'
    : confirmationBar.close < options.bottom ? 'valid' : 'rejected';
}

export function analyzeMarketStructure(candles: StructureCandle[], options: {
  allowSupplyDemand?: boolean;
  sourceBarSeconds?: number;
  confirmationBarSeconds?: number;
  zoneVisualBars?: number;
} = {}): MarketStructureResult {
  if (candles.length < 12) {
    return { markers: [], issMarkers: [], zones: [], lines: [], trend: 'neutral' };
  }

  // MG Bhai: initialize on the lowest wick in the first 500 loaded bars.
  const genesisWindowEnd = Math.min(499, candles.length - 1);
  const genesis = extreme(candles, 0, genesisWindowEnd, 'low');
  const markers: SeriesMarker<UTCTimestamp>[] = [
    makeMarker(candles[genesis.index], 'GENESIS LOW', 'belowBar', '#7c3aed', 'arrowUp', 2),
  ];
  const lines: StructureLine[] = [];
  const zones: StructureZone[] = [];
  const issMarkers: SeriesMarker<UTCTimestamp>[] = [];
  let trend: 'bullish' | 'bearish' = 'bullish';
  let protectedPoint = genesis;
  let activeHigh: StructurePoint | null = null;
  let activeLow: StructurePoint | null = null;
  let lastHLConfirmIndex: number | null = null;
  let lastLHConfirmIndex: number | null = null;
  let bullishBreakCount = 0;
  let bearishBreakCount = 0;
  let pathStart: StructurePoint = genesis;
  let lastBullishHigh: StructurePoint | null = null;
  let lastBearishLow: StructurePoint | null = null;

  const sourceBarSeconds = options.sourceBarSeconds || 60;
  const zoneVisualBars = options.zoneVisualBars || 30;
  const addZone = (zone: Omit<StructureZone, 'id' | 'active' | 'endTime' | 'status'> & Partial<Pick<StructureZone, 'endTime' | 'status'>>) => {
    const status = zone.status || 'valid';
    zones.push({
      ...zone,
      id: `${zone.name}-${zone.startTime}-${zone.top}`,
      endTime: zone.endTime || zone.startTime + sourceBarSeconds * zoneVisualBars,
      status,
      active: status !== 'rejected',
    });
  };

  const addTjlZone = (point: StructurePoint, name: 'TJL1' | 'TJL2', isBuy: boolean, formationTime: number) => {
    const source = candles[point.index];
    const buffer = Math.abs(source.close - source.open) * 0.01;
    const lowerBody = Math.min(source.open, source.close);
    const upperBody = Math.max(source.open, source.close);
    const bottomWick = lowerBody - source.low;
    const topWick = source.high - upperBody;
    const lowerPivot = (name === 'TJL1' && !isBuy) || (name === 'TJL2' && !isBuy);
    const bottom = lowerPivot ? point.price - (topWick + buffer) : point.price;
    const top = lowerPivot ? point.price : point.price + (bottomWick + buffer);
    const confirmation = name === 'TJL1'
      ? resolveTjl1Confirmation(candles, {
        isBuy, bottom, top, formationTime,
        sourceBarSeconds,
        confirmationBarSeconds: options.confirmationBarSeconds,
      })
      : 'valid';
    addZone({
      name, category: 'mg', isBuy, startTime: point.time,
      bottom, top,
      status: confirmation,
    });
  };

  const addDbDtZone = (point: StructurePoint, name: 'DB' | 'DT', isBuy: boolean) => {
    const source = candles[point.index];
    const buffer = Math.abs(source.close - source.open) * 0.01;
    const bottomWick = Math.min(source.open, source.close) - source.low;
    const topWick = source.high - Math.max(source.open, source.close);
    addZone({
      name, category: 'mg', isBuy, startTime: point.time,
      bottom: name === 'DB' ? point.price : point.price - (topWick + buffer),
      top: name === 'DB' ? point.price + (bottomWick + buffer) : point.price,
    });
  };

  const addSwing = (point: StructurePoint, direction: 'bullish' | 'bearish') => {
    if (pathStart.time !== point.time || pathStart.price !== point.price) {
      lines.push({
        id: `swing-${pathStart.time}-${point.time}-${point.price}`,
        type: 'swing', direction,
        fromTime: pathStart.time, fromPrice: pathStart.price,
        toTime: point.time, toPrice: point.price,
      });
    }
    pathStart = point;
  };

  const addLevel = (
    type: 'bos' | 'choch',
    direction: 'bullish' | 'bearish',
    point: StructurePoint,
    breakIndex: number,
    label: string,
  ) => lines.push({
    id: `${type}-${point.time}-${candles[breakIndex].time}`,
    type, direction,
    fromTime: point.time, fromPrice: point.price,
    toTime: candles[breakIndex].time, toPrice: point.price,
    label,
  });

  for (let index = genesis.index + 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];

    for (const zone of zones) {
      if (!zone.active) continue;
      if (zone.isBuy && candle.open < zone.bottom && candle.close < zone.bottom) {
        zone.active = false;
        zone.status = 'invalidated';
      }
      if (!zone.isBuy && candle.open > zone.top && candle.close > zone.top) {
        zone.active = false;
        zone.status = 'invalidated';
      }
    }

    const twoRed = candle.close < candle.open
      && previous.close < previous.open
      && candle.close < previous.low;
    const twoGreen = candle.close > candle.open
      && previous.close > previous.open
      && candle.close > previous.high;

    if (trend === 'bullish') {
      if (twoRed && activeHigh === null) {
        const leftBound = bullishBreakCount === 0
          ? protectedPoint.index
          : (lastHLConfirmIndex ?? protectedPoint.index);
        activeHigh = extreme(candles, leftBound, index, 'high');
      }

      if (activeHigh && candle.close > activeHigh.price) {
        const confirmedHigh = activeHigh;
        const confirmedLow = extreme(
          candles, confirmedHigh.index, index, 'low', lastHLConfirmIndex,
        );
        markers.push(
          makeMarker(candles[confirmedHigh.index], 'HH', 'aboveBar', '#059669'),
          makeMarker(candles[confirmedLow.index], 'HL', 'belowBar', '#059669'),
        );
        addSwing(confirmedHigh, 'bullish');
        addSwing(confirmedLow, 'bullish');
        addLevel('bos', 'bullish', confirmedHigh, index, 'BOS');

        addTjlZone(confirmedHigh, 'TJL1', false, candle.time + sourceBarSeconds);
        addTjlZone(confirmedLow, 'TJL2', true, candle.time + sourceBarSeconds);
        lastBullishHigh = confirmedHigh;
        if (options.allowSupplyDemand) {
          const originIndex = findOrderBlock(candles, confirmedHigh.index, index, true);
          const origin = candles[originIndex];
          addZone({ name: 'DEMAND', category: 'supplyDemand', isBuy: true, startTime: origin.time,
            top: Math.max(origin.open, origin.close), bottom: origin.low });
        }
        protectedPoint = confirmedLow;
        lastHLConfirmIndex = index;
        activeHigh = null;
        bullishBreakCount += 1;
      }

      if (index > 1
        && candle.close < protectedPoint.price
        && previous.close < protectedPoint.price) {
        addLevel('choch', 'bearish', protectedPoint, index, 'CHoCH');
        const newProtectedHigh = extreme(candles, protectedPoint.index, index, 'high');
        markers.push(makeMarker(candles[newProtectedHigh.index], 'PH', 'aboveBar', '#b91c1c'));
        const lastTjl1 = [...zones].reverse().find((zone) => zone.active && zone.status === 'valid' && zone.category === 'mg' && zone.name === 'TJL1');
        const lastTjl2 = [...zones].reverse().find((zone) => zone.active && zone.category === 'mg' && zone.name === 'TJL2');
        if (lastTjl1) {
          lastTjl1.active = false;
          lastTjl1.status = 'invalidated';
          addZone({ name: 'QML', category: 'mg', isBuy: false, startTime: lastTjl1.startTime, top: lastTjl1.top, bottom: lastTjl1.bottom });
        }
        if (lastTjl2) {
          lastTjl2.active = false;
          lastTjl2.status = 'invalidated';
          addZone({ name: 'SBR', category: 'mg', isBuy: false, startTime: lastTjl2.startTime, top: lastTjl2.top, bottom: lastTjl2.bottom });
        }
        if (lastBullishHigh) addDbDtZone(lastBullishHigh, 'DT', false);
        trend = 'bearish';
        protectedPoint = newProtectedHigh;
        pathStart = newProtectedHigh;
        activeHigh = null;
        activeLow = null;
        bearishBreakCount = 0;
        lastLHConfirmIndex = null;
      }
    } else {
      if (twoGreen && activeLow === null) {
        const leftBound = bearishBreakCount === 0
          ? protectedPoint.index
          : (lastLHConfirmIndex ?? protectedPoint.index);
        activeLow = extreme(candles, leftBound, index, 'low');
      }

      if (activeLow && candle.close < activeLow.price) {
        const confirmedLow = activeLow;
        const confirmedHigh = extreme(
          candles, confirmedLow.index, index, 'high', lastLHConfirmIndex,
        );
        markers.push(
          makeMarker(candles[confirmedLow.index], 'LL', 'belowBar', '#dc2626'),
          makeMarker(candles[confirmedHigh.index], 'LH', 'aboveBar', '#dc2626'),
        );
        addSwing(confirmedLow, 'bearish');
        addSwing(confirmedHigh, 'bearish');
        addLevel('bos', 'bearish', confirmedLow, index, 'BOS');

        addTjlZone(confirmedLow, 'TJL1', true, candle.time + sourceBarSeconds);
        addTjlZone(confirmedHigh, 'TJL2', false, candle.time + sourceBarSeconds);
        lastBearishLow = confirmedLow;
        if (options.allowSupplyDemand) {
          const originIndex = findOrderBlock(candles, confirmedLow.index, index, false);
          const origin = candles[originIndex];
          addZone({ name: 'SUPPLY', category: 'supplyDemand', isBuy: false, startTime: origin.time,
            top: origin.high, bottom: Math.min(origin.open, origin.close) });
        }
        protectedPoint = confirmedHigh;
        lastLHConfirmIndex = index;
        activeLow = null;
        bearishBreakCount += 1;
      }

      if (index > 1
        && candle.close > protectedPoint.price
        && previous.close > protectedPoint.price) {
        addLevel('choch', 'bullish', protectedPoint, index, 'CHoCH');
        const newProtectedLow = extreme(candles, protectedPoint.index, index, 'low');
        markers.push(makeMarker(candles[newProtectedLow.index], 'PL', 'belowBar', '#047857'));
        const lastTjl1 = [...zones].reverse().find((zone) => zone.active && zone.status === 'valid' && zone.category === 'mg' && zone.name === 'TJL1');
        const lastTjl2 = [...zones].reverse().find((zone) => zone.active && zone.category === 'mg' && zone.name === 'TJL2');
        if (lastTjl1) {
          lastTjl1.active = false;
          lastTjl1.status = 'invalidated';
          addZone({ name: 'QML', category: 'mg', isBuy: true, startTime: lastTjl1.startTime, top: lastTjl1.top, bottom: lastTjl1.bottom });
        }
        if (lastTjl2) {
          lastTjl2.active = false;
          lastTjl2.status = 'invalidated';
          addZone({ name: 'RBS', category: 'mg', isBuy: true, startTime: lastTjl2.startTime, top: lastTjl2.top, bottom: lastTjl2.bottom });
        }
        if (lastBearishLow) addDbDtZone(lastBearishLow, 'DB', true);
        trend = 'bullish';
        protectedPoint = newProtectedLow;
        pathStart = newProtectedLow;
        activeHigh = null;
        activeLow = null;
        bullishBreakCount = 0;
        lastHLConfirmIndex = null;
      }
    }
  }

  const sortedMarkers = markers.sort((a, b) => Number(a.time) - Number(b.time));
  const visibleMarkers = sortedMarkers.length > 180
    ? [sortedMarkers[0], ...sortedMarkers.slice(-179)]
    : sortedMarkers;
  const visibleLines = lines.length > 160
    ? [lines[0], ...lines.slice(-159)]
    : lines;
  // MG Bhai's getRightTime first uses the real timestamp at barIndex + width.
  // Using seconds alone crosses weekend/session gaps and can make a box render
  // to the chart edge, so every zone is capped at the actual 30th source bar.
  const endTimeForZone = (startTime: number) => {
    const startIndex = candles.findIndex((candle) => candle.time === startTime);
    if (startIndex < 0) return startTime;
    return candles[Math.min(candles.length - 1, startIndex + zoneVisualBars)].time;
  };

  // MG Bhai tap rule: after a zone's creation candle, its first candle whose
  // high/low overlaps the complete price range is the one recorded as the tap.
  for (const zone of zones) {
    zone.endTime = endTimeForZone(zone.startTime);
    const tapIndex = candles.findIndex((candle) => (
      candle.time > zone.startTime && candle.high >= zone.bottom && candle.low <= zone.top
    ));
    if (tapIndex >= 0) {
      zone.tapTime = candles[tapIndex].time;
      zone.tapBarsAgo = candles.length - 1 - tapIndex;
    }
  }

  const visibleZones = [...zones].sort((a, b) => a.startTime - b.startTime);

  return {
    markers: visibleMarkers,
    issMarkers: issMarkers.slice(-36),
    zones: visibleZones,
    lines: visibleLines,
    trend,
    genesis: { time: genesis.time, price: genesis.price },
  };
}

function findIssFiveWaves(candles: StructureCandle[], sourceBarSeconds: number, zoneVisualBars: number): {
  markers: SeriesMarker<UTCTimestamp>[];
  lines: StructureLine[];
  zones: StructureZone[];
} {
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  const lines: StructureLine[] = [];
  const zones: StructureZone[] = [];
  let bullishState = 0;
  let bearishState = 0;
  let bullish: StructurePoint[] = [];
  let bearish: StructurePoint[] = [];

  const complete = (points: StructurePoint[], direction: 'bullish' | 'bearish') => {
    const isBullish = direction === 'bullish';
    points.forEach((point, index) => {
      const text = index === 5 ? '⑤ ISS' : String(index);
      markers.push(makeMarker(
        candles[point.index], text, index % 2 === 0 ? 'belowBar' : 'aboveBar', '#d97706',
        'circle', 2,
      ));
      if (index > 0) lines.push({
        id: `iss-${direction}-${points[index - 1].time}-${point.time}`,
        type: 'iss', direction,
        fromTime: points[index - 1].time, fromPrice: points[index - 1].price,
        toTime: point.time, toPrice: point.price,
      });
    });
    const wave3 = points[3];
    const wave4 = points[4];
    const candle3 = candles[wave3.index];
    const candle4 = candles[wave4.index];
    const buffer3 = Math.abs(candle3.close - candle3.open) * 0.01;
    const buffer4 = Math.abs(candle4.close - candle4.open) * 0.01;
    const wick3 = isBullish
      ? candle3.high - Math.max(candle3.open, candle3.close)
      : Math.min(candle3.open, candle3.close) - candle3.low;
    const wick4 = isBullish
      ? Math.min(candle4.open, candle4.close) - candle4.low
      : candle4.high - Math.max(candle4.open, candle4.close);
    zones.push(
      {
        id: `iss-l3-${wave3.time}`, name: 'ISS L3', category: 'iss', isBuy: isBullish,
        startTime: wave3.time,
        endTime: wave3.time + sourceBarSeconds * zoneVisualBars,
        bottom: isBullish ? wave3.price - (wick3 + buffer3) : wave3.price,
        top: isBullish ? wave3.price : wave3.price + (wick3 + buffer3), active: true, status: 'valid',
      },
      {
        id: `iss-l4-${wave4.time}`, name: 'ISS L4', category: 'iss', isBuy: isBullish,
        startTime: wave4.time,
        endTime: wave4.time + sourceBarSeconds * zoneVisualBars,
        bottom: isBullish ? wave4.price : wave4.price - (wick4 + buffer4),
        top: isBullish ? wave4.price + (wick4 + buffer4) : wave4.price, active: true, status: 'valid',
      },
    );
  };

  for (let index = 2; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    const twoRed = candle.close < candle.open && previous.close < previous.open && candle.close < previous.low;
    const twoGreen = candle.close > candle.open && previous.close > previous.open && candle.close > previous.high;

    if (bullishState === 0 && twoRed) {
      const anchor = extreme(candles, Math.max(0, index - 100), index, 'low');
      bullish = [anchor, extreme(candles, anchor.index, index, 'high')];
      bullishState = 1;
    } else if (bullishState === 1 && candle.close > bullish[1].price) {
      bullish.push(extreme(candles, bullish[1].index, index, 'low'));
      bullishState = 2;
    } else if (bullishState === 2 && twoRed) {
      const wave3 = extreme(candles, bullish[2].index, index, 'high');
      if (wave3.price > bullish[1].price) {
        bullish.push(wave3);
        bullishState = 3;
      }
    } else if (bullishState === 3 && candle.close > bullish[3].price) {
      bullish.push(extreme(candles, bullish[3].index, index, 'low'));
      bullishState = 4;
    } else if (bullishState === 4 && twoRed) {
      bullish.push(extreme(candles, bullish[4].index, index, 'high'));
      complete(bullish, 'bullish');
      bullish = [];
      bullishState = 0;
    }

    if (bearishState === 0 && twoGreen) {
      const anchor = extreme(candles, Math.max(0, index - 100), index, 'high');
      bearish = [anchor, extreme(candles, anchor.index, index, 'low')];
      bearishState = 1;
    } else if (bearishState === 1 && candle.close < bearish[1].price) {
      bearish.push(extreme(candles, bearish[1].index, index, 'high'));
      bearishState = 2;
    } else if (bearishState === 2 && twoGreen) {
      const wave3 = extreme(candles, bearish[2].index, index, 'low');
      if (wave3.price < bearish[1].price) {
        bearish.push(wave3);
        bearishState = 3;
      }
    } else if (bearishState === 3 && candle.close < bearish[3].price) {
      bearish.push(extreme(candles, bearish[3].index, index, 'high'));
      bearishState = 4;
    } else if (bearishState === 4 && twoGreen) {
      bearish.push(extreme(candles, bearish[4].index, index, 'low'));
      complete(bearish, 'bearish');
      bearish = [];
      bearishState = 0;
    }
  }
  for (const zone of zones) {
    for (const candle of candles) {
      if (candle.time <= zone.startTime) continue;
      if (zone.isBuy && candle.open < zone.bottom && candle.close < zone.bottom) {
        zone.active = false;
        zone.status = 'invalidated';
      }
      if (!zone.isBuy && candle.open > zone.top && candle.close > zone.top) {
        zone.active = false;
        zone.status = 'invalidated';
      }
      if (!zone.active) break;
    }
  }
  return { markers: markers.slice(-36), lines: lines.slice(-30), zones: zones.slice(-12) };
}
