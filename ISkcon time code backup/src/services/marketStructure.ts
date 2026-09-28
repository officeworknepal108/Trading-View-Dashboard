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
  name: 'TJL1' | 'TJL2' | 'QML' | 'QML A+' | 'QML A++' | 'SBR' | 'RBS' | 'DT' | 'DB' | 'DBD' | 'DTD' | '3rd wave' | '4th wave' | 'Internal QML' | 'Internal SBR' | 'Internal RBS' | 'Internal DT' | 'Internal DB' | 'Internal TJL1' | 'Internal TJL2' | 'SUPPLY' | 'DEMAND';
  category: 'mg' | 'iss' | 'supplyDemand';
  isBuy: boolean;
  startTime: number;
  endTime: number;
  activeFromTime?: number;
  top: number;
  bottom: number;
  active: boolean;
  status: 'pending' | 'valid' | 'rejected' | 'invalidated';
  // TJL1 gets two completed higher-timeframe candles to validate.  These
  // fields keep that validation state separate from normal zone invalidation.
  tjl1ConfirmationAttempts?: number;
  confirmationTime?: number;
  invalidatedAt?: number;
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
}): Pick<StructureZone, 'status' | 'tjl1ConfirmationAttempts' | 'confirmationTime'> {
  const confirmationSeconds = options.confirmationBarSeconds;
  if (!confirmationSeconds || confirmationSeconds <= options.sourceBarSeconds) {
    return { status: 'valid', tjl1ConfirmationAttempts: 0, confirmationTime: options.formationTime };
  }

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

  // The latest aggregate bar may still be forming. A TJL1 may use the next
  // two completed higher-timeframe candles only. A failed first close stays
  // pending; only after the second failed close is it rejected.
  const confirmationBars = bars
    .slice(0, -1)
    .filter((bar) => bar.time + confirmationSeconds > options.formationTime)
    .slice(0, 2);

  for (let index = 0; index < confirmationBars.length; index += 1) {
    const bar = confirmationBars[index];
    const confirmed = options.isBuy ? bar.close > options.top : bar.close < options.bottom;
    if (confirmed) {
      return {
        status: 'valid',
        tjl1ConfirmationAttempts: index + 1,
        confirmationTime: bar.time + confirmationSeconds,
      };
    }
  }

  return confirmationBars.length >= 2
    ? { status: 'rejected', tjl1ConfirmationAttempts: 2 }
    : { status: 'pending', tjl1ConfirmationAttempts: confirmationBars.length };
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
  const issAnchors: { direction: 'bullish' | 'bearish'; start: StructurePoint; boundary: StructurePoint }[] = [];
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
  let currentTrendTjl1: StructureZone | null = null;
  let currentTrendTjl2: StructureZone | null = null;
  let pendingDouble: { direction: 'bullish' | 'bearish'; qml: StructureZone; secondary: StructureZone; extreme: StructureZone; startedAt: number } | null = null;

  const sourceBarSeconds = options.sourceBarSeconds || 60;
  const zoneVisualBars = options.zoneVisualBars || 30;
  const addZone = (zone: Omit<StructureZone, 'id' | 'active' | 'endTime' | 'status'> & Partial<Pick<StructureZone, 'endTime' | 'status'>>) => {
    const status = zone.status || 'valid';
    const created: StructureZone = {
      ...zone,
      id: `${zone.name}-${zone.startTime}-${zone.top}`,
      endTime: zone.endTime || zone.startTime + sourceBarSeconds * zoneVisualBars,
      activeFromTime: zone.activeFromTime ?? zone.startTime,
      status,
      active: status === 'valid' || status === 'pending',
    };
    zones.push(created);
    return created;
  };

  const convertZone = (
    source: StructureZone,
    name: Extract<StructureZone['name'], 'QML' | 'QML A+' | 'QML A++' | 'SBR' | 'RBS'>,
    isBuy: boolean,
    convertedAt: number,
  ) => {
    // MG creates a fresh valid conversion zone at CHoCH. We rename the same
    // object to avoid showing both TJL and its conversion, but reset validity
    // here so only candles after the CHoCH can invalidate QML/SBR/RBS.
    source.name = name;
    source.isBuy = isBuy;
    source.status = 'valid';
    source.active = true;
    source.activeFromTime = convertedAt;
    source.tapTime = undefined;
    source.tapBarsAgo = undefined;
    source.invalidatedAt = undefined;
    return source;
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
      : { status: 'valid' as const };
    return addZone({
      name, category: 'mg', isBuy, startTime: point.time,
      bottom, top,
      status: confirmation.status,
      tjl1ConfirmationAttempts: confirmation.tjl1ConfirmationAttempts,
      confirmationTime: confirmation.confirmationTime,
      // A pending TJL1 is drawn from formation, but a VALID TJL1 only starts
      // looking for its first trade tap after the confirming higher-TF close.
      activeFromTime: confirmation.status === 'valid'
        ? confirmation.confirmationTime ?? formationTime
        : formationTime,
    });
  };

  const addDbDtZone = (point: StructurePoint, name: 'DB' | 'DT', isBuy: boolean) => {
    const source = candles[point.index];
    const buffer = Math.abs(source.close - source.open) * 0.01;
    const bottomWick = Math.min(source.open, source.close) - source.low;
    const topWick = source.high - Math.max(source.open, source.close);
    return addZone({
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

  const removeStandaloneSwingMarker = (point: StructurePoint) => {
    const markerIndex = markers.findIndex((marker) => (
      Number(marker.time) === point.time && (marker.text === 'SL' || marker.text === 'SH')
    ));
    if (markerIndex >= 0) markers.splice(markerIndex, 1);
  };

  for (let index = genesis.index + 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];

    for (const zone of zones) {
      if (!zone.active) continue;
      // A pending TJL1 is waiting for its two higher-timeframe confirmation
      // chances. Price crossing it during that waiting window does not cancel
      // it: a later qualifying higher-TF close may still make it tradeable.
      if (zone.name === 'TJL1' && zone.status === 'pending') continue;
      // For a confirmed TJL1, invalidation starts only after the confirming
      // higher-timeframe candle has completed. This prevents an earlier price
      // move from invalidating a zone that was not tradeable yet.
      // A source candle whose timestamp equals activeFromTime is the first
      // candle after the completed higher-timeframe confirmation. It must be
      // checked for invalidation, not skipped.
      if (candle.time < (zone.activeFromTime ?? zone.startTime)) continue;
      // A wick may cross a zone without cancelling it. But once any part of a
      // completed candle body crosses the invalid side, the active zone fails.
      if (zone.isBuy && Math.max(candle.open, candle.close) > zone.top) {
        zone.active = false;
        zone.status = 'invalidated';
        zone.invalidatedAt = candle.time;
      }
      if (!zone.isBuy && Math.min(candle.open, candle.close) < zone.bottom) {
        zone.active = false;
        zone.status = 'invalidated';
        zone.invalidatedAt = candle.time;
      }
    }

    const twoRed = candle.close < candle.open
      && previous.close < previous.open
      && candle.close < previous.low;
    const twoGreen = candle.close > candle.open
      && previous.close > previous.open
      && candle.close > previous.high;

    if (trend === 'bullish') {
      if (pendingDouble?.direction === 'bullish'
        && candle.time > pendingDouble.startedAt
        && candle.close < pendingDouble.extreme.bottom) {
        const startIndex = candles.findIndex((item) => item.time === pendingDouble!.startedAt);
        const doubleHigh = extreme(candles, Math.max(0, startIndex), index, 'high');
        addLevel('choch', 'bearish', protectedPoint, index, 'DOUBLE CHoCH');
        markers.push(makeMarker(candles[doubleHigh.index], 'SH / PH', 'aboveBar', '#b91c1c'));
        convertZone(pendingDouble.qml, 'QML A+', false, candle.time);
        convertZone(pendingDouble.secondary, 'QML A++', false, candle.time);
        convertZone(pendingDouble.extreme, 'SBR', false, candle.time);
        const dtd = addDbDtZone(doubleHigh, 'DT', false);
        dtd.name = 'DTD';
        pendingDouble = null;
        trend = 'bearish';
        protectedPoint = doubleHigh;
        currentTrendTjl1 = null;
        currentTrendTjl2 = null;
        pathStart = doubleHigh;
        activeHigh = null;
        activeLow = null;
        bearishBreakCount = 0;
        lastLHConfirmIndex = null;
        continue;
      }
      if (twoRed && activeHigh === null) {
        const leftBound = bullishBreakCount === 0
          ? protectedPoint.index
          : (lastHLConfirmIndex ?? protectedPoint.index);
        activeHigh = extreme(candles, leftBound, index, 'high');
        // This SH is the same candidate point that later becomes HH.
        markers.push(makeMarker(candles[activeHigh.index], 'SH', 'aboveBar', '#64748b', 'circle', 1));
        // External SH is Point 0 for a bearish internal ISS, bounded by PL.
        issAnchors.push({ direction: 'bearish', start: activeHigh, boundary: protectedPoint });
      }

      if (activeHigh && candle.close > activeHigh.price) {
        const confirmedHigh = activeHigh;
        const confirmedLow = extreme(
          candles, confirmedHigh.index, index, 'low', lastHLConfirmIndex,
        );
        removeStandaloneSwingMarker(confirmedHigh);
        markers.push(
          makeMarker(candles[confirmedHigh.index], 'HH / SH', 'aboveBar', '#059669'),
          makeMarker(candles[confirmedLow.index], 'HL / PL', 'belowBar', '#059669'),
        );
        addSwing(confirmedHigh, 'bullish');
        addSwing(confirmedLow, 'bullish');
        addLevel('bos', 'bullish', confirmedHigh, index, 'BOS');

        currentTrendTjl1 = addTjlZone(confirmedHigh, 'TJL1', false, candle.time + sourceBarSeconds);
        currentTrendTjl2 = addTjlZone(confirmedLow, 'TJL2', true, candle.time + sourceBarSeconds);
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
        if (pendingDouble?.direction === 'bullish') pendingDouble = null;
      }

      if (index > 1
        && candle.close < protectedPoint.price
        && previous.close < protectedPoint.price) {
        addLevel('choch', 'bearish', protectedPoint, index, 'CHoCH');
        const newProtectedHigh = extreme(candles, protectedPoint.index, index, 'high');
        markers.push(makeMarker(candles[newProtectedHigh.index], 'SH / PH', 'aboveBar', '#b91c1c'));
        // Confirmed uptrend → downtrend: HH/TJL1 becomes QML, HL/TJL2 becomes
        // SBR, and the newly identified PH becomes the DT zone.
        const lastTjl1 = currentTrendTjl1;
        const lastTjl2 = currentTrendTjl2;
        const qml = lastTjl1 ? convertZone(lastTjl1, 'QML', false, candle.time) : null;
        const sbr = lastTjl2 ? convertZone(lastTjl2, 'SBR', false, candle.time) : null;
        const dt = addDbDtZone(newProtectedHigh, 'DT', false);
        pendingDouble = qml && sbr ? { direction: 'bearish', qml, secondary: sbr, extreme: dt, startedAt: candle.time } : null;
        trend = 'bearish';
        protectedPoint = newProtectedHigh;
        currentTrendTjl1 = null;
        currentTrendTjl2 = null;
        pathStart = newProtectedHigh;
        activeHigh = null;
        activeLow = null;
        bearishBreakCount = 0;
        lastLHConfirmIndex = null;
      }
    } else {
      if (pendingDouble?.direction === 'bearish'
        && candle.time > pendingDouble.startedAt
        && candle.close > pendingDouble.extreme.top) {
        const startIndex = candles.findIndex((item) => item.time === pendingDouble!.startedAt);
        const doubleLow = extreme(candles, Math.max(0, startIndex), index, 'low');
        addLevel('choch', 'bullish', protectedPoint, index, 'DOUBLE CHoCH');
        markers.push(makeMarker(candles[doubleLow.index], 'SL / PL', 'belowBar', '#047857'));
        convertZone(pendingDouble.qml, 'QML A+', true, candle.time);
        convertZone(pendingDouble.secondary, 'QML A++', true, candle.time);
        convertZone(pendingDouble.extreme, 'RBS', true, candle.time);
        const dbd = addDbDtZone(doubleLow, 'DB', true);
        dbd.name = 'DBD';
        pendingDouble = null;
        trend = 'bullish';
        protectedPoint = doubleLow;
        currentTrendTjl1 = null;
        currentTrendTjl2 = null;
        pathStart = doubleLow;
        activeHigh = null;
        activeLow = null;
        bullishBreakCount = 0;
        lastHLConfirmIndex = null;
        continue;
      }
      if (twoGreen && activeLow === null) {
        const leftBound = bearishBreakCount === 0
          ? protectedPoint.index
          : (lastLHConfirmIndex ?? protectedPoint.index);
        activeLow = extreme(candles, leftBound, index, 'low');
        // This SL is the same candidate point that later becomes LL.
        markers.push(makeMarker(candles[activeLow.index], 'SL', 'belowBar', '#64748b', 'circle', 1));
        // External SL is Point 0 for a bullish internal ISS, bounded by PH.
        issAnchors.push({ direction: 'bullish', start: activeLow, boundary: protectedPoint });
      }

      if (activeLow && candle.close < activeLow.price) {
        const confirmedLow = activeLow;
        const confirmedHigh = extreme(
          candles, confirmedLow.index, index, 'high', lastLHConfirmIndex,
        );
        removeStandaloneSwingMarker(confirmedLow);
        markers.push(
          makeMarker(candles[confirmedLow.index], 'LL / SL', 'belowBar', '#dc2626'),
          makeMarker(candles[confirmedHigh.index], 'LH / PH', 'aboveBar', '#dc2626'),
        );
        addSwing(confirmedLow, 'bearish');
        addSwing(confirmedHigh, 'bearish');
        addLevel('bos', 'bearish', confirmedLow, index, 'BOS');

        currentTrendTjl1 = addTjlZone(confirmedLow, 'TJL1', true, candle.time + sourceBarSeconds);
        currentTrendTjl2 = addTjlZone(confirmedHigh, 'TJL2', false, candle.time + sourceBarSeconds);
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
        if (pendingDouble?.direction === 'bearish') pendingDouble = null;
      }

      if (index > 1
        && candle.close > protectedPoint.price
        && previous.close > protectedPoint.price) {
        addLevel('choch', 'bullish', protectedPoint, index, 'CHoCH');
        const newProtectedLow = extreme(candles, protectedPoint.index, index, 'low');
        markers.push(makeMarker(candles[newProtectedLow.index], 'SL / PL', 'belowBar', '#047857'));
        // Confirmed downtrend → uptrend: LL/TJL1 becomes QML, LH/TJL2 becomes
        // RBS, and the newly identified PL becomes the DB zone.
        const lastTjl1 = currentTrendTjl1;
        const lastTjl2 = currentTrendTjl2;
        const qml = lastTjl1 ? convertZone(lastTjl1, 'QML', true, candle.time) : null;
        const rbs = lastTjl2 ? convertZone(lastTjl2, 'RBS', true, candle.time) : null;
        const db = addDbDtZone(newProtectedLow, 'DB', true);
        pendingDouble = qml && rbs ? { direction: 'bullish', qml, secondary: rbs, extreme: db, startedAt: candle.time } : null;
        trend = 'bullish';
        protectedPoint = newProtectedLow;
        currentTrendTjl1 = null;
        currentTrendTjl2 = null;
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
  const iss = findIssFiveWaves(candles, issAnchors, sourceBarSeconds, zoneVisualBars);
  issMarkers.push(...iss.markers);
  zones.push(...iss.zones);
  lines.push(...iss.lines);
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

  // TJL1 confirmation is calculated from completed higher-timeframe candles,
  // so make one final pass after the whole structure is known. This guarantees
  // that a confirmed TJL1 cannot remain active when a later source candle body
  // has already closed beyond its invalidation boundary.
  for (const zone of zones) {
    if (zone.name !== 'TJL1' || !zone.active || zone.status !== 'valid') continue;
    const activeFrom = zone.activeFromTime ?? zone.startTime;
    const invalidatingCandle = candles.find((candle) => (
      candle.time >= activeFrom
      && (zone.isBuy
        ? Math.max(candle.open, candle.close) > zone.top
        : Math.min(candle.open, candle.close) < zone.bottom)
    ));
    if (invalidatingCandle) {
      zone.active = false;
      zone.status = 'invalidated';
      zone.invalidatedAt = invalidatingCandle.time;
    }
  }

  // MG Bhai tap rule: after a zone's creation candle, its first candle whose
  // high/low overlaps the complete price range is the one recorded as the tap.
  for (const zone of zones) {
    const tapIndex = candles.findIndex((candle) => (
      candle.time >= (zone.activeFromTime ?? zone.startTime)
      && (!zone.invalidatedAt || candle.time < zone.invalidatedAt)
      && candle.high >= zone.bottom && candle.low <= zone.top
    ));
    if (tapIndex >= 0) {
      zone.tapTime = candles[tapIndex].time;
      zone.tapBarsAgo = candles.length - 1 - tapIndex;
    }

    // TJL1 must remain visible while it is awaiting higher-timeframe
    // validation and after it becomes valid. A first tap is recorded for the
    // table, but it must not shorten or remove the valid zone from the chart.
    // The other zone drawings keep the 30-bar visual limit for a clean chart.
    if (zone.name === 'TJL1' && zone.active) {
      zone.endTime = candles[candles.length - 1].time;
    } else {
      zone.endTime = endTimeForZone(zone.startTime);
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

function findIssFiveWaves(
  candles: StructureCandle[],
  anchors: { direction: 'bullish' | 'bearish'; start: StructurePoint; boundary: StructurePoint }[],
  sourceBarSeconds: number,
  zoneVisualBars: number,
): {
  markers: SeriesMarker<UTCTimestamp>[];
  lines: StructureLine[];
  zones: StructureZone[];
} {
  // ISS uses only the current chart timeframe. Point 0 is an external SL/SH,
  // and the five internal points must remain inside its PH/PL boundary.
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  const lines: StructureLine[] = [];
  const zones: StructureZone[] = [];
  const patterns: { direction: 'bullish' | 'bearish'; points: StructurePoint[]; confirmedAt: number; anchor: typeof anchors[number]; wave3: StructureZone; wave4: StructureZone }[] = [];

  const complete = (
    points: StructurePoint[],
    direction: 'bullish' | 'bearish',
    confirmedAt: number,
    anchor: typeof anchors[number],
  ) => {
    const isBullish = direction === 'bullish';
    points.forEach((point, index) => {
      const text = `(${index})`;
      const isHighPoint = isBullish ? index % 2 === 1 : index % 2 === 0;
      markers.push(makeMarker(
        candles[point.index], text, isHighPoint ? 'aboveBar' : 'belowBar', '#2563eb',
        'circle', 2,
      ));
      if (index > 0) lines.push({
        id: `iss-${direction}-${points[index - 1].time}-${point.time}`,
        type: 'iss', direction,
        fromTime: points[index - 1].time, fromPrice: points[index - 1].price,
        toTime: point.time, toPrice: point.price,
      });
    });
    const wave3 = points[3]; // second TJL1
    const wave4 = points[4]; // second TJL2
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
    const wave3Zone: StructureZone = {
        id: `iss-wave3-${wave3.time}`, name: '3rd wave', category: 'iss', isBuy: isBullish,
        startTime: wave3.time,
        endTime: wave3.time + sourceBarSeconds * zoneVisualBars,
        activeFromTime: confirmedAt,
        bottom: isBullish ? wave3.price - (wick3 + buffer3) : wave3.price,
        top: isBullish ? wave3.price : wave3.price + (wick3 + buffer3), active: true, status: 'valid',
      };
    const wave4Zone: StructureZone = {
        id: `iss-wave4-${wave4.time}`, name: '4th wave', category: 'iss', isBuy: isBullish,
        startTime: wave4.time,
        endTime: wave4.time + sourceBarSeconds * zoneVisualBars,
        activeFromTime: confirmedAt,
        bottom: isBullish ? wave4.price : wave4.price - (wick4 + buffer4),
        top: isBullish ? wave4.price + (wick4 + buffer4) : wave4.price, active: true, status: 'valid',
      };
    zones.push(wave3Zone, wave4Zone);
    patterns.push({ direction, points, confirmedAt, anchor, wave3: wave3Zone, wave4: wave4Zone });
  };

  const withinBoundary = (point: StructurePoint, anchor: typeof anchors[number]) => (
    anchor.direction === 'bullish'
      ? point.price <= anchor.boundary.price
      : point.price >= anchor.boundary.price
  );

  for (const anchor of anchors) {
    const points: StructurePoint[] = [anchor.start];
    let state = 1;
    for (let index = anchor.start.index + 2; index < candles.length; index += 1) {
      const candle = candles[index];
      const previous = candles[index - 1];
      const twoRed = candle.close < candle.open && previous.close < previous.open;
      const twoGreen = candle.close > candle.open && previous.close > previous.open;
      const reversal = anchor.direction === 'bullish' ? twoRed : twoGreen;
      const highOrLow = anchor.direction === 'bullish' ? 'high' : 'low';
      const lowOrHigh = anchor.direction === 'bullish' ? 'low' : 'high';
      const bodyBreaks = (point: StructurePoint) => (
        anchor.direction === 'bullish'
          ? candle.close > point.price
          : candle.close < point.price
      );

      // Point 0 is the external SL/SH. A body-close through it invalidates the
      // complete ISS immediately; the next external swing starts a fresh ISS.
      const pointZeroBroken = anchor.direction === 'bullish'
        ? candle.close < points[0].price
        : candle.close > points[0].price;
      if (pointZeroBroken) break;

      if (state === 1 && reversal) {
        // Same wick selection as TJL1: after the two-candle retracement, use
        // the full highest/lowest wick that formed the internal Swing 1.
        const point1 = extreme(candles, points[0].index, index - 2, highOrLow);
        if (withinBoundary(point1, anchor)) {
          points.push(point1);
          state = 2;
        }
      } else if (state === 2 && bodyBreaks(points[1])) {
        // Point 2 is the full pullback extreme between Point 1 and its
        // BOS-style body close, not merely the first two-green candle low.
        const point2 = extreme(candles, points[1].index + 1, index, lowOrHigh);
        if (withinBoundary(point2, anchor)) {
          points.push(point2);
          state = 3;
        }
      } else if (state === 2 && reversal) {
        // Like TJL1, Point 1 stays provisional until its BOS body-close. If a
        // later two-candle retracement makes a higher/lower wick, use that
        // latest extreme as Point 1.
        const replacement = extreme(candles, points[0].index, index - 2, highOrLow);
        const isMoreExtreme = anchor.direction === 'bullish'
          ? replacement.price > points[1].price
          : replacement.price < points[1].price;
        if (isMoreExtreme && withinBoundary(replacement, anchor)) points[1] = replacement;
      } else if (state === 3 && reversal) {
        const point3 = extreme(candles, points[2].index, index - 2, highOrLow);
        if (withinBoundary(point3, anchor)) {
          points.push(point3);
          state = 4;
        }
      } else if (state === 4 && bodyBreaks(points[3])) {
        // Point 4 mirrors Point 2: use the extreme wick between Point 3 and
        // the body-close that breaks Point 3.
        const point4 = extreme(candles, points[3].index, index, lowOrHigh);
        if (withinBoundary(point4, anchor)) {
          points.push(point4);
          state = 5;
        }
      } else if (state === 4 && reversal) {
        // Point 3 follows the same TJL1 rule. Keep the highest bullish (or
        // lowest bearish) post-Point-2 wick after each two-candle retracement.
        const replacement = extreme(candles, points[2].index, index - 2, highOrLow);
        const isMoreExtreme = anchor.direction === 'bullish'
          ? replacement.price > points[3].price
          : replacement.price < points[3].price;
        if (isMoreExtreme && withinBoundary(replacement, anchor)) points[3] = replacement;
      } else if (state === 5 && reversal) {
        const point5 = extreme(candles, points[4].index, index - 2, highOrLow);
        if (withinBoundary(point5, anchor)) {
          complete([...points, point5], anchor.direction, candle.time, anchor);
        }
        break;
      }
    }
  }

  const activateInternalZone = (
    zone: StructureZone,
    name: Extract<StructureZone['name'], 'Internal QML' | 'Internal SBR' | 'Internal RBS'>,
    isBuy: boolean,
    activeFromTime: number,
  ) => {
    zone.name = name;
    zone.isBuy = isBuy;
    zone.active = true;
    zone.status = 'valid';
    zone.activeFromTime = activeFromTime;
    zone.invalidatedAt = undefined;
    zone.tapTime = undefined;
    zone.tapBarsAgo = undefined;
  };
  const addInternalZone = (
    point: StructurePoint,
    name: Extract<StructureZone['name'], 'Internal TJL1' | 'Internal TJL2' | 'Internal DT' | 'Internal DB'>,
    isBuy: boolean,
    activeFromTime: number,
  ) => {
    const candle = candles[point.index];
    const bodyLow = Math.min(candle.open, candle.close);
    const bodyHigh = Math.max(candle.open, candle.close);
    const buffer = Math.abs(candle.close - candle.open) * 0.01;
    const bottom = isBuy ? point.price : point.price - (candle.high - bodyHigh + buffer);
    const top = isBuy ? point.price + (bodyLow - candle.low + buffer) : point.price;
    const created: StructureZone = {
      id: `${name}-${point.time}-${point.price}`, name, category: 'iss', isBuy,
      startTime: point.time, activeFromTime,
      endTime: point.time + sourceBarSeconds * zoneVisualBars,
      bottom, top, active: true, status: 'valid',
    };
    zones.push(created);
    return created;
  };

  for (const pattern of patterns) {
    const confirmedIndex = candles.findIndex((candle) => candle.time === pattern.confirmedAt);
    if (confirmedIndex < 0) continue;
    const point4 = pattern.points[4];
    const point5 = pattern.points[5];
    const isBullishIss = pattern.direction === 'bullish';

    for (let index = confirmedIndex + 1; index < candles.length; index += 1) {
      const candle = candles[index];
      const previous = candles[index - 1];
      const crossesPoint4 = isBullishIss
        ? candle.close < point4.price && previous.close < point4.price
        : candle.close > point4.price && previous.close > point4.price;
      if (crossesPoint4) {
        const direction = isBullishIss ? 'bearish' : 'bullish';
        lines.push({
          id: `internal-choch-${point4.time}-${candle.time}`, type: 'choch', direction,
          fromTime: point4.time, fromPrice: point4.price, toTime: candle.time, toPrice: point4.price,
          label: 'INTERNAL CHoCH',
        });
        if (isBullishIss) {
          activateInternalZone(pattern.wave3, 'Internal QML', false, candle.time);
          activateInternalZone(pattern.wave4, 'Internal SBR', false, candle.time);
          addInternalZone(point5, 'Internal DT', false, candle.time);
          markers.push(makeMarker(candles[point5.index], 'I PH', 'aboveBar', '#b91c1c'));
        } else {
          activateInternalZone(pattern.wave3, 'Internal QML', true, candle.time);
          activateInternalZone(pattern.wave4, 'Internal RBS', true, candle.time);
          addInternalZone(point5, 'Internal DB', true, candle.time);
          markers.push(makeMarker(candles[point5.index], 'I PL', 'belowBar', '#047857'));
        }
        break;
      }
    }
  }

  for (const zone of zones) {
    for (const candle of candles) {
      if (candle.time <= (zone.activeFromTime ?? zone.startTime)) continue;
      if (zone.isBuy && Math.max(candle.open, candle.close) > zone.top) {
        zone.active = false;
        zone.status = 'invalidated';
        zone.invalidatedAt = candle.time;
      }
      if (!zone.isBuy && Math.min(candle.open, candle.close) < zone.bottom) {
        zone.active = false;
        zone.status = 'invalidated';
        zone.invalidatedAt = candle.time;
      }
      if (!zone.active) break;
    }
  }
  return { markers: markers.slice(-36), lines: lines.slice(-30), zones: zones.slice(-12) };
}
