import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';

export interface StructureCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  complete?: boolean;
}

export type ChochClass = 'pending' | 'valid' | 'air' | 'vip';
export type DoubleChochStatus = 'pending' | 'valid';
export type DoubleChochOriginClass = Extract<ChochClass, 'valid' | 'air' | 'vip'>;
export type FibBand = '0.5-0.618' | '0.71-0.79' | 'deep' | 'DB/DT';
export type EngulfingType = 'T1' | 'T2' | 'T3' | 'T4';
export type EngulfingDirection = 'bullish' | 'bearish';

export interface EngulfingPattern {
  type: EngulfingType;
  direction: EngulfingDirection;
  candleCount: number;
  startIndex: number;
  endIndex: number;
}

export interface VipSupportContext {
  timeframe: string;
  zones: StructureZone[];
}

export interface StructureZone {
  id: string;
  name: 'TJL1' | 'TJL2' | 'QML' | 'QML A+' | 'QML A++' | 'SBR' | 'RBS' | 'DT' | 'DB' | 'DBD' | 'DTD' | 'ISS L3' | 'ISS L4' | 'Internal QML' | 'Internal SBR' | 'Internal RBS' | 'Internal DT' | 'Internal DB' | 'Internal TJL1' | 'Internal TJL2' | 'SUPPLY' | 'DEMAND';
  category: 'mg' | 'iss' | 'internal' | 'supplyDemand';
  isBuy: boolean;
  startTime: number;
  endTime: number;
  activeFromTime?: number;
  top: number;
  bottom: number;
  active: boolean;
  status: 'pending' | 'valid' | 'rejected' | 'invalidated';
  // TJL1 confirmation is evaluated on the mapped higher timeframe. Before its
  // first higher-timeframe candle closes, normal invalidation is paused.
  tjl1ConfirmationAttempts?: number;
  confirmationTime?: number;
  confirmationWindowCloseTime?: number;
  // A confirmed TJL1 invalidates only through the side that faces its paired
  // TJL2, rather than from a hard-coded buy/sell side.
  invalidationDirection?: 'up' | 'down';
  // TJL1 and TJL2 created by the same BOS share this timestamp. It lets the
  // TJL1 FIB anchor to its current paired TJL2 even when that pivot is newer.
  tjlPairTime?: number;
  invalidatedAt?: number;
  tapTime?: number;
  tapBarsAgo?: number;
  // Zones converted/created by one CHoCH share this classification. It affects
  // trade eligibility only; normal zone invalidation continues unchanged.
  chochClass?: ChochClass;
  tradeable?: boolean;
  chochTime?: number;
  chochConfirmationTime?: number;
  vipSupportTimeframe?: string;
  vipSupportZone?: StructureZone['name'];
  vipSupportTapTime?: number;
  doubleChochStatus?: DoubleChochStatus;
  doubleChochOriginClass?: DoubleChochOriginClass;
  doubleChochTime?: number;
  doubleChochConfirmationTime?: number;
  doubleChochConfirmationDirection?: 'up' | 'down';
  // FIB is an independent confluence layer. It never creates, validates, or
  // invalidates a structure zone.
  fibRelevant?: boolean;
  fibBand?: FibBand;
  fibStatus?: 'a-plus' | 'not-valid';
  // A deep 0.71-0.79 setup remains usable until a completed candle closes
  // through 0.79 toward the originating DB/DT side. Wicks do not invalidate it.
  fibDeepInvalidatedAt?: number;
  // Anchors for the visible Fibonacci retracement overlay. The originating
  // structure price is level 1 and the completed move extreme is level 0.
  fibSourceTime?: number;
  fibSourcePrice?: number;
  fibZeroTime?: number;
  fibZeroPrice?: number;
  // Completed ISS anchors. Its FIB runs from Point 0 to Point 5 and keeps
  // extending level 0 when continuation makes a newer extreme.
  issPoint0Time?: number;
  issPoint0Price?: number;
  issPoint5Time?: number;
  issPoint5Price?: number;
  issDirection?: 'bullish' | 'bearish';
  issCompletionTime?: number;
  // Exact 0.5 retracement used as the minimum engulfing-pattern gate. A zone
  // can be A+ from band overlap, but at least one candle in the confirmed
  // engulfing sequence must trade through this price.
  fibLevel50?: number;
  // The first confirmed, direction-matching engulfing pattern that touches
  // this active zone. Primary FIB setups additionally require the pattern to
  // touch 0.5; a valid deep-discount setup qualifies from its own zone.
  engulfingType?: EngulfingType;
  engulfingDirection?: EngulfingDirection;
  engulfingTime?: number;
  engulfingCandleCount?: number;
  // Direction-matched confluence from the active 4H Swing FIB. This is kept
  // separate from the zone's own FIB classification so both can coexist.
  swingFibBand?: Extract<FibBand, '0.5-0.618' | '0.71-0.79'>;
  swingFibStatus?: 'a-plus';
  swingEngulfingType?: EngulfingType;
  swingEngulfingDirection?: EngulfingDirection;
  swingEngulfingTime?: number;
  swingEngulfingCandleCount?: number;
  // Direction-matched confluence from the current 9:15 Nepal Day FIB.
  dayFibBand?: Extract<FibBand, '0.5-0.618' | '0.71-0.79'>;
  dayFibStatus?: 'a-plus';
  dayEngulfingType?: EngulfingType;
  dayEngulfingDirection?: EngulfingDirection;
  dayEngulfingTime?: number;
  dayEngulfingCandleCount?: number;
}

type ChochMetadata = Pick<StructureZone,
  'chochClass' | 'tradeable' | 'chochTime' | 'chochConfirmationTime'
  | 'vipSupportTimeframe' | 'vipSupportZone' | 'vipSupportTapTime'>;

type DoubleChochMetadata = Pick<StructureZone,
  'doubleChochStatus' | 'doubleChochOriginClass' | 'doubleChochTime'
  | 'doubleChochConfirmationTime' | 'doubleChochConfirmationDirection' | 'tradeable'>;

export interface StructureLine {
  id: string;
  type: 'swing' | 'bos' | 'choch' | 'iss' | 'internal-swing' | 'internal-bos' | 'internal-choch';
  direction: 'bullish' | 'bearish';
  fromTime: number;
  fromPrice: number;
  toTime: number;
  toPrice: number;
  label?: string;
}

export type IssMarker = SeriesMarker<UTCTimestamp> & {
  // The precise wave vertex. Rendering from this value keeps the label tied to
  // the ISS line through every zoom level instead of inferring a candle wick.
  pivotPrice?: number;
};

export interface MarketStructureResult {
  markers: SeriesMarker<UTCTimestamp>[];
  issMarkers: IssMarker[];
  internalMarkers: SeriesMarker<UTCTimestamp>[];
  engulfingMarkers: SeriesMarker<UTCTimestamp>[];
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

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const WEEK_SECONDS = 7 * DAY_SECONDS;

function newYorkUtcOffsetSeconds(timestamp: number): number {
  const date = new Date(timestamp * 1000);
  const year = date.getUTCFullYear();
  const marchFirst = new Date(Date.UTC(year, 2, 1));
  const novemberFirst = new Date(Date.UTC(year, 10, 1));
  const secondSundayInMarch = 8 + ((7 - marchFirst.getUTCDay()) % 7);
  const firstSundayInNovember = 1 + ((7 - novemberFirst.getUTCDay()) % 7);
  const daylightStart = Date.UTC(year, 2, secondSundayInMarch, 7) / 1000;
  const daylightEnd = Date.UTC(year, 10, firstSundayInNovember, 6) / 1000;
  return timestamp >= daylightStart && timestamp < daylightEnd ? -4 * HOUR_SECONDS : -5 * HOUR_SECONDS;
}

function newYorkLocalToUtc(year: number, month: number, day: number, hour: number): number {
  const localAsUtc = Date.UTC(year, month, day, hour) / 1000;
  let timestamp = localAsUtc - newYorkUtcOffsetSeconds(localAsUtc);
  // Re-evaluate at the resulting instant because the initial UTC estimate can
  // sit on the other side of a daylight-saving transition.
  timestamp = localAsUtc - newYorkUtcOffsetSeconds(timestamp);
  return timestamp;
}

function forexSessionDayStart(timestamp: number): number {
  const localTimestamp = timestamp + newYorkUtcOffsetSeconds(timestamp);
  const local = new Date(localTimestamp * 1000);
  let localDate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 17) / 1000;
  if (localTimestamp < localDate) localDate -= DAY_SECONDS;
  const date = new Date(localDate * 1000);
  return newYorkLocalToUtc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 17);
}

/**
 * TradingView's OANDA H4, daily, and weekly bars are anchored to the 5 p.m.
 * New York forex session, including its daylight-saving shift. Intraday bars
 * below H4 remain aligned to ordinary Unix/UTC intervals.
 */
export function getConfirmationBucketStart(timestamp: number, confirmationSeconds: number): number {
  if (confirmationSeconds < 4 * HOUR_SECONDS) {
    return Math.floor(timestamp / confirmationSeconds) * confirmationSeconds;
  }

  const sessionStart = forexSessionDayStart(timestamp);
  if (confirmationSeconds === 4 * HOUR_SECONDS) {
    return sessionStart + Math.floor((timestamp - sessionStart) / confirmationSeconds) * confirmationSeconds;
  }
  if (confirmationSeconds === DAY_SECONDS) return sessionStart;
  if (confirmationSeconds === WEEK_SECONDS) {
    const localTimestamp = sessionStart + newYorkUtcOffsetSeconds(sessionStart);
    const local = new Date(localTimestamp * 1000);
    return newYorkLocalToUtc(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() - local.getUTCDay(),
      17,
    );
  }
  return Math.floor(timestamp / confirmationSeconds) * confirmationSeconds;
}

function getConfirmationBucketEnd(bucketStart: number, confirmationSeconds: number): number {
  if (confirmationSeconds !== DAY_SECONDS && confirmationSeconds !== WEEK_SECONDS) {
    return bucketStart + confirmationSeconds;
  }
  const localTimestamp = bucketStart + newYorkUtcOffsetSeconds(bucketStart);
  const local = new Date(localTimestamp * 1000);
  return newYorkLocalToUtc(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + (confirmationSeconds === WEEK_SECONDS ? 7 : 1),
    17,
  );
}

function makeMarker(
  candle: StructureCandle,
  text: string,
  position: 'aboveBar' | 'belowBar',
  color: string,
  shape: 'arrowUp' | 'arrowDown' | 'circle' = 'circle',
  size = 0.55,
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

/**
 * Select the swing extreme once a two-candle retracement is confirmed.
 * The first retracement candle can itself set the final high/low, while the
 * second candle only confirms the retracement and must not move the pivot.
 */
export function selectTwoCandleRetracementPivot(
  candles: StructureCandle[],
  from: number,
  confirmationIndex: number,
  kind: 'high' | 'low',
): StructurePoint {
  return extreme(candles, from, confirmationIndex - 1, kind);
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

export function resolveTjl1Confirmation(candles: StructureCandle[], options: {
  confirmationDirection: 'up' | 'down';
  bottom: number;
  top: number;
  formationTime: number;
  sourceBarSeconds: number;
  confirmationBarSeconds?: number;
}): Pick<StructureZone, 'status' | 'tjl1ConfirmationAttempts' | 'confirmationTime' | 'confirmationWindowCloseTime'> {
  const confirmationSeconds = options.confirmationBarSeconds;
  if (!confirmationSeconds || confirmationSeconds <= options.sourceBarSeconds) {
    return {
      status: 'valid',
      tjl1ConfirmationAttempts: 0,
      confirmationTime: options.formationTime,
      confirmationWindowCloseTime: options.formationTime,
    };
  }

  const grouped = new Map<number, StructureCandle[]>();
  for (const candle of candles) {
    const bucket = getConfirmationBucketStart(candle.time, confirmationSeconds);
    const list = grouped.get(bucket) || [];
    list.push(candle);
    grouped.set(bucket, list);
  }
  const bars = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, list]) => ({
      time,
      closeTime: getConfirmationBucketEnd(time, confirmationSeconds),
      open: list[0].open,
      high: Math.max(...list.map((candle) => candle.high)),
      low: Math.min(...list.map((candle) => candle.low)),
      close: list[list.length - 1].close,
    }));

  // Ignore the still-forming aggregate candle. A BUY TJL1 confirms only on a
  // completed higher-timeframe close through the structure-confirmation side.
  const confirmationBars = bars
    .slice(0, -1)
    .filter((bar) => bar.closeTime > options.formationTime);
  const firstCompletedBar = confirmationBars[0];
  const confirmationIndex = confirmationBars.findIndex((bar) => (
    options.confirmationDirection === 'up'
      ? bar.close > options.top
      : bar.close < options.bottom
  ));
  if (confirmationIndex >= 0) {
    const completedBar = confirmationBars[confirmationIndex];
    return {
      status: 'valid',
      tjl1ConfirmationAttempts: confirmationIndex + 1,
      confirmationTime: completedBar.closeTime,
      confirmationWindowCloseTime: firstCompletedBar.closeTime,
    };
  }

  return {
    status: 'pending',
    tjl1ConfirmationAttempts: confirmationBars.length,
    confirmationWindowCloseTime: firstCompletedBar?.closeTime,
  };
}

export function doesInvalidateZone(zone: StructureZone, candle: StructureCandle): boolean {
  // No zone can be invalidated by the live candle. Its temporary close can move
  // beyond a boundary before returning inside the zone when the bar completes.
  if (candle.complete === false) return false;

  const bodyLow = Math.min(candle.open, candle.close);
  const bodyHigh = Math.max(candle.open, candle.close);

  if (requiresMappedConfirmation(zone) && zone.invalidationDirection) {
    // TJL1 and ISS Level 3 use the boundary facing their paired Level 2/4.
    // Wick re-entry does not preserve the zone once a completed candle's
    // entire body is outside.
    return zone.invalidationDirection === 'up'
      ? bodyLow > zone.top
      : bodyHigh < zone.bottom;
  }

  // Apply the same completed-body rule to every other MG, ISS, and S/D zone.
  return zone.isBuy
    ? bodyHigh < zone.bottom
    : bodyLow > zone.top;
}

export function findFirstZoneTapIndex(candles: StructureCandle[], zone: StructureZone): number {
  // Confirmation-controlled zones cannot record a trade tap while pending.
  if (requiresMappedConfirmation(zone) && zone.status !== 'valid') return -1;
  const activeFromTime = zone.activeFromTime ?? zone.startTime;
  return candles.findIndex((candle) => (
    // The source candle that defines a zone is its origin, not a revisit.
    candle.time > zone.startTime
    && candle.time >= activeFromTime
    && (!zone.invalidatedAt || candle.time < zone.invalidatedAt)
    && candle.high >= zone.bottom
    && candle.low <= zone.top
  ));
}

function requiresMappedConfirmation(zone: StructureZone): boolean {
  return zone.name === 'TJL1' || zone.name === 'ISS L3' || zone.name === 'Internal TJL1';
}

export function activateZoneAfterChoch(
  zone: StructureZone,
  chochTime: number,
  sourceBarSeconds: number,
): void {
  // A CHoCH creates or converts the zone on its break candle. Historical
  // overlaps and the break candle itself are formation, not a trade revisit.
  zone.activeFromTime = chochTime + sourceBarSeconds;
  zone.tapTime = undefined;
  zone.tapBarsAgo = undefined;
}

export function classifyChoch(options: {
  tjl1Confirmed: boolean;
  tjl2Confirmed: boolean;
  vipZoneTapped: boolean;
}): { chochClass: ChochClass; tradeable: boolean } {
  if (!options.tjl2Confirmed) return { chochClass: 'pending', tradeable: false };
  if (options.vipZoneTapped) return { chochClass: 'vip', tradeable: true };
  if (options.tjl1Confirmed) return { chochClass: 'valid', tradeable: true };
  return { chochClass: 'air', tradeable: false };
}

export function classifyFibOverlap(options: {
  zoneBottom: number;
  zoneTop: number;
  level50: number;
  level618: number;
  level71: number;
  level79: number;
  acceptDeep: boolean;
  sourcePrice?: number;
  deepBandValid?: boolean;
}): FibBand | undefined {
  const overlaps = (first: number, second: number) => (
    options.zoneBottom <= Math.max(first, second)
    && options.zoneTop >= Math.min(first, second)
  );
  if (overlaps(options.level50, options.level618)) return '0.5-0.618';
  if (options.acceptDeep && options.deepBandValid !== false) {
    if (overlaps(options.level71, options.level79)) return '0.71-0.79';
    // A QML can sit deeper than 0.79 without overlapping the band itself. It
    // remains A+ while it is between 0.79 and the originating DB/DT and the
    // completed-close invalidation below/above 0.79 has not occurred.
    if (options.sourcePrice !== undefined && overlaps(options.level79, options.sourcePrice)) {
      return 'deep';
    }
  }
  return undefined;
}

export function findDeepFibInvalidationTime(
  candles: StructureCandle[],
  zeroTime: number,
  level79: number,
  isSell: boolean,
): number | undefined {
  return candles.find((candle) => (
    candle.time > zeroTime
    && candle.complete !== false
    && (isSell ? candle.close > level79 : candle.close < level79)
  ))?.time;
}

function candleIsBullish(candle: StructureCandle): boolean {
  return candle.close > candle.open;
}

function candleIsBearish(candle: StructureCandle): boolean {
  return candle.close < candle.open;
}

/**
 * The final confirmation candle must have enough directional body strength.
 * For a bullish confirmation only its upper wick is relevant; for a bearish
 * confirmation only its lower wick is relevant. An equal body and wick passes.
 */
function confirmationCandleHasDirectionalBodyStrength(candle: StructureCandle): boolean {
  if (candleIsBullish(candle)) {
    const body = candle.close - candle.open;
    const upperWick = Math.max(0, candle.high - candle.close);
    return body >= upperWick;
  }
  if (candleIsBearish(candle)) {
    const body = candle.open - candle.close;
    const lowerWick = Math.max(0, candle.close - candle.low);
    return body >= lowerWick;
  }
  return false;
}

/**
 * Detect the strongest confirmed engulfing pattern ending at one candle.
 * T4 is checked first because its 3–10 candle containment can also satisfy a
 * shorter T1 pattern. T2 is checked before T1 for the same reason.
 */
export function detectEngulfingPatternAt(
  candles: StructureCandle[],
  endIndex: number,
  type4MaxCandles = 10,
): EngulfingPattern | undefined {
  const current = candles[endIndex];
  if (!current || current.complete === false) return undefined;
  if (!confirmationCandleHasDirectionalBodyStrength(current)) return undefined;

  const maximumType4Count = Math.max(3, Math.min(10, Math.floor(type4MaxCandles)));
  // Prefer the longest valid sequence so the original tap candle is retained
  // when its final candles also form a shorter nested Type 4.
  for (let candleCount = maximumType4Count; candleCount >= 3; candleCount -= 1) {
    const startIndex = endIndex - candleCount + 1;
    if (startIndex < 0) continue;
    const first = candles[startIndex];
    const patternCandles = candles.slice(startIndex, endIndex + 1);
    if (patternCandles.some((candle) => candle.complete === false)) continue;
    const middleInsideFirst = candles.slice(startIndex + 1, endIndex).every((candle) => (
      candle.high <= first.high && candle.low >= first.low
    ));
    if (!middleInsideFirst) continue;
    // The tap candle may have either color. Type 4 is defined by containment
    // followed by the final candle's body crossing and closing beyond the tap
    // candle's wick, in the breakout direction.
    if (candleIsBullish(current) && current.open <= first.high && current.close > first.high) {
      return { type: 'T4', direction: 'bullish', candleCount, startIndex, endIndex };
    }
    if (candleIsBearish(current) && current.open >= first.low && current.close < first.low) {
      return { type: 'T4', direction: 'bearish', candleCount, startIndex, endIndex };
    }
  }

  const second = candles[endIndex - 1];
  const first = candles[endIndex - 2];
  if (first && second && first.complete !== false && second.complete !== false) {
    // Type 2 BUY: red first candle, green second candle whose lower wick
    // sweeps the first low, then a third green body closes above the FIRST
    // candle's high. SELL is the exact inverse.
    if (candleIsBearish(first) && candleIsBullish(second)
      && second.low <= first.low && candleIsBullish(current) && current.close > first.high) {
      return { type: 'T2', direction: 'bullish', candleCount: 3, startIndex: endIndex - 2, endIndex };
    }
    if (candleIsBullish(first) && candleIsBearish(second)
      && second.high >= first.high && candleIsBearish(current) && current.close < first.low) {
      return { type: 'T2', direction: 'bearish', candleCount: 3, startIndex: endIndex - 2, endIndex };
    }

    // Type 3 uses the same mixed-direction sweep, but its third continuation
    // candle closes through only the MIDDLE candle's extreme. Type 2 is checked
    // first so a close through the first candle is never mislabeled Type 3.
    if (candleIsBearish(first) && candleIsBullish(second)
      && second.low <= first.low && candleIsBullish(current) && current.close > second.high) {
      return { type: 'T3', direction: 'bullish', candleCount: 3, startIndex: endIndex - 2, endIndex };
    }
    if (candleIsBullish(first) && candleIsBearish(second)
      && second.high >= first.high && candleIsBearish(current) && current.close < second.low) {
      return { type: 'T3', direction: 'bearish', candleCount: 3, startIndex: endIndex - 2, endIndex };
    }
  }

  if (!second || second.complete === false) return undefined;
  if (candleIsBearish(second) && candleIsBullish(current) && current.close > second.high) {
    return { type: 'T1', direction: 'bullish', candleCount: 2, startIndex: endIndex - 1, endIndex };
  }
  if (candleIsBullish(second) && candleIsBearish(current) && current.close < second.low) {
    return { type: 'T1', direction: 'bearish', candleCount: 2, startIndex: endIndex - 1, endIndex };
  }
  return undefined;
}

export function findZoneEngulfingPattern(
  candles: StructureCandle[],
  zone: StructureZone,
  type4MaxCandles = 10,
): EngulfingPattern | undefined {
  const isDeepFib = zone.fibBand === '0.71-0.79' || zone.fibBand === 'deep';
  const isDbDtFib = zone.fibBand === 'DB/DT';
  if (zone.fibStatus !== 'a-plus'
    || (!isDeepFib && !isDbDtFib && zone.fibLevel50 === undefined)
    || zone.status !== 'valid') {
    return undefined;
  }
  const validFrom = Math.max(
    zone.startTime,
    zone.activeFromTime ?? zone.startTime,
    zone.confirmationTime ?? zone.startTime,
  );
  const requiredDirection: EngulfingDirection = zone.isBuy ? 'bullish' : 'bearish';

  for (let endIndex = 1; endIndex < candles.length; endIndex += 1) {
    const finalCandle = candles[endIndex];
    if (finalCandle.complete === false || finalCandle.time < validFrom) continue;
    const pattern = detectEngulfingPatternAt(candles, endIndex, type4MaxCandles);
    if (!pattern || pattern.direction !== requiredDirection) continue;
    const patternCandles = candles.slice(pattern.startIndex, pattern.endIndex + 1);
    if (!isDeepFib && !isDbDtFib) {
      const patternTouchesFib50 = patternCandles.some((candle) => (
        candle.low <= zone.fibLevel50! && candle.high >= zone.fibLevel50!
      ));
      if (!patternTouchesFib50) continue;
    }
    const touchesActiveZone = patternCandles
      .some((candle) => (
        candle.time > zone.startTime
        && candle.time >= validFrom
        && candle.high >= zone.bottom
        && candle.low <= zone.top
      ));
    if (touchesActiveZone) return pattern;
  }
  return undefined;
}

function applyEngulfingConfluence(
  candles: StructureCandle[],
  zones: StructureZone[],
): SeriesMarker<UTCTimestamp>[] {
  const markerKeys = new Set<string>();
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  for (const zone of zones) {
    zone.engulfingType = undefined;
    zone.engulfingDirection = undefined;
    zone.engulfingTime = undefined;
    zone.engulfingCandleCount = undefined;
    const pattern = findZoneEngulfingPattern(candles, zone);
    if (!pattern) continue;
    const finalCandle = candles[pattern.endIndex];
    zone.engulfingType = pattern.type;
    zone.engulfingDirection = pattern.direction;
    zone.engulfingTime = finalCandle.time;
    zone.engulfingCandleCount = pattern.candleCount;
    const markerKey = `${pattern.direction}:${pattern.type}:${finalCandle.time}`;
    if (markerKeys.has(markerKey)) continue;
    markerKeys.add(markerKey);
    const bullish = pattern.direction === 'bullish';
    markers.push(makeMarker(
      finalCandle,
      `${bullish ? 'B' : 'S'} ${pattern.type}`,
      bullish ? 'belowBar' : 'aboveBar',
      bullish ? '#059669' : '#e11d48',
      bullish ? 'arrowUp' : 'arrowDown',
      0.7,
    ));
  }
  return markers.sort((a, b) => Number(a.time) - Number(b.time)).slice(-120);
}

function applyFibConfluence(candles: StructureCandle[], zones: StructureZone[]): void {
  const completed = candles.filter((candle) => candle.complete !== false);
  const zoneNames = (names: StructureZone['name'][]) => new Set<StructureZone['name']>(names);
  const tjl1Names = zoneNames(['TJL1', 'Internal TJL1']);
  const tjl2Names = zoneNames(['TJL2', 'Internal TJL2']);
  const singleChochNames = zoneNames([
    'QML', 'SBR', 'RBS', 'DT', 'DB',
    'Internal QML', 'Internal SBR', 'Internal RBS', 'Internal DT', 'Internal DB',
  ]);
  const doubleChochNames = zoneNames(['QML A+', 'QML A++', 'SBR', 'RBS', 'DTD', 'DBD']);

  const classifyFromMove = (
    zone: StructureZone,
    sourceTime: number,
    sourcePrice: number,
    isSell: boolean,
    acceptDeep: boolean,
  ) => {
    const moveCandles = completed.filter((candle) => candle.time >= sourceTime);
    if (moveCandles.length === 0) return;
    const zeroCandle = moveCandles.reduce((selected, candle) => (
      isSell
        ? candle.low < selected.low ? candle : selected
        : candle.high > selected.high ? candle : selected
    ));
    const zeroPrice = isSell ? zeroCandle.low : zeroCandle.high;
    const validMove = isSell ? sourcePrice > zeroPrice : zeroPrice > sourcePrice;
    zone.fibRelevant = true;
    if (!validMove) {
      zone.fibStatus = 'not-valid';
      return;
    }
    zone.fibSourceTime = sourceTime;
    zone.fibSourcePrice = sourcePrice;
    zone.fibZeroTime = zeroCandle.time;
    zone.fibZeroPrice = zeroPrice;
    const move = Math.abs(zeroPrice - sourcePrice);
    const level = (ratio: number) => (
      isSell ? zeroPrice + move * ratio : zeroPrice - move * ratio
    );
    zone.fibLevel50 = level(0.5);
    zone.fibDeepInvalidatedAt = findDeepFibInvalidationTime(
      candles,
      zeroCandle.time,
      level(0.79),
      isSell,
    );
    zone.fibBand = classifyFibOverlap({
      zoneBottom: zone.bottom,
      zoneTop: zone.top,
      level50: level(0.5),
      level618: level(0.618),
      level71: level(0.71),
      level79: level(0.79),
      acceptDeep,
      sourcePrice,
      deepBandValid: zone.fibDeepInvalidatedAt === undefined,
    });
    zone.fibStatus = zone.fibBand ? 'a-plus' : 'not-valid';
  };

  for (const zone of zones) {
    zone.fibRelevant = false;
    zone.fibBand = undefined;
    zone.fibStatus = undefined;
    zone.fibLevel50 = undefined;
    zone.fibDeepInvalidatedAt = undefined;
    zone.fibSourceTime = undefined;
    zone.fibSourcePrice = undefined;
    zone.fibZeroTime = undefined;
    zone.fibZeroPrice = undefined;
  }

  const sorted = [...zones].sort((a, b) => a.startTime - b.startTime);
  for (const zone of sorted) {
    const isTjl1 = tjl1Names.has(zone.name);
    const isTjl2 = tjl2Names.has(zone.name);
    if (!isTjl1 && !isTjl2) continue;
    const source = findTjlFibSource(zone, sorted);
    if (!source) continue;
    classifyFromMove(
      zone,
      source.startTime,
      zone.isBuy ? source.bottom : source.top,
      !zone.isBuy,
      // TJL1 accepts the primary band only. TJL2 always accepts both primary
      // and deep bands, matching the supplied Pine reference.
      isTjl2,
    );
  }

  const applyChochGroup = (
    group: StructureZone[],
    isDouble: boolean,
  ) => {
    const eligible = isDouble ? doubleChochNames : singleChochNames;
    const anchor = group.find((zone) => (
      isDouble
        ? zone.name === 'DTD' || zone.name === 'DBD'
        : zone.name === 'DT' || zone.name === 'DB'
          || zone.name === 'Internal DT' || zone.name === 'Internal DB'
    ));
    if (!anchor) return;
    const isSell = !anchor.isBuy;
    const sourcePrice = isSell ? anchor.top : anchor.bottom;
    for (const zone of group) {
      if (!eligible.has(zone.name)) continue;
      if (!isDouble && (zone.name === 'DT' || zone.name === 'DB')) {
        zone.fibRelevant = true;
        zone.fibBand = 'DB/DT';
        zone.fibStatus = 'a-plus';
        continue;
      }
      classifyFromMove(zone, anchor.startTime, sourcePrice, isSell, true);
    }
  };

  const singleKeys = new Set(zones
    .filter((zone) => zone.chochTime !== undefined)
    .map((zone) => `${zone.category}:${zone.chochTime}`));
  for (const key of singleKeys) {
    const [category, timeText] = key.split(':');
    const eventTime = Number(timeText);
    applyChochGroup(zones.filter((zone) => (
      zone.category === category && zone.chochTime === eventTime
    )), false);
  }
  const doubleTimes = new Set(zones
    .filter((zone) => zone.doubleChochTime !== undefined)
    .map((zone) => zone.doubleChochTime!));
  for (const eventTime of doubleTimes) {
    applyChochGroup(zones.filter((zone) => zone.doubleChochTime === eventTime), true);
  }
  invalidateTjlFibBeforeLatestStructureReset(zones);
  applyIssFibAnchors(candles, zones);
}

export function applyIssFibAnchors(
  candles: StructureCandle[],
  zones: StructureZone[],
): void {
  const completed = candles.filter((candle) => candle.complete !== false);
  for (const zone of zones) {
    if (zone.name !== 'ISS L3'
      || zone.issPoint0Time === undefined || zone.issPoint0Price === undefined
      || zone.issPoint5Time === undefined || zone.issPoint5Price === undefined
      || zone.issDirection === undefined) continue;
    const continuation = completed.filter((candle) => candle.time >= zone.issPoint5Time!);
    const extreme = continuation.reduce<StructureCandle | undefined>((selected, candle) => {
      if (!selected) return candle;
      return zone.issDirection === 'bullish'
        ? candle.high > selected.high ? candle : selected
        : candle.low < selected.low ? candle : selected;
    }, undefined);
    const zeroTime = extreme?.time ?? zone.issPoint5Time;
    const zeroPrice = extreme
      ? zone.issDirection === 'bullish' ? extreme.high : extreme.low
      : zone.issPoint5Price;
    zone.fibRelevant = true;
    zone.fibSourceTime = zone.issPoint0Time;
    zone.fibSourcePrice = zone.issPoint0Price;
    zone.fibZeroTime = zeroTime;
    zone.fibZeroPrice = zeroPrice;
    zone.fibLevel50 = zeroPrice + (zone.issPoint0Price - zeroPrice) * 0.5;
  }
}

export function findTjlFibSource(
  zone: StructureZone,
  zones: StructureZone[],
): StructureZone | undefined {
  const internal = zone.category === 'internal';
  const structureTime = zone.tjlPairTime ?? zone.startTime;
  const resetTime = Math.max(-Infinity, ...zones
    .filter((candidate) => candidate.category === zone.category
      && candidate.chochTime !== undefined
      && candidate.chochTime < structureTime)
    .map((candidate) => candidate.chochTime!));
  return [...zones]
    .sort((first, second) => first.startTime - second.startTime)
    .filter((candidate) => candidate !== zone
      && candidate.category === zone.category
      && candidate.name === (internal ? 'Internal TJL2' : 'TJL2')
      && candidate.isBuy === zone.isBuy
      // A TJL pivot can precede the BOS/formation candle that confirms its
      // pair. Structure-reset eligibility therefore follows the shared pair
      // time, while the actual FIB anchor remains the TJL2 pivot wick/time.
      && (candidate.tjlPairTime ?? candidate.startTime) > resetTime
      && ((zone.name === 'TJL1' || zone.name === 'Internal TJL1')
        && zone.tjlPairTime !== undefined
        ? candidate.tjlPairTime === zone.tjlPairTime
        : candidate.startTime < zone.startTime))
    .at(-1);
}

export function invalidateTjlFibBeforeLatestStructureReset(zones: StructureZone[]): void {
  const resetTimes = zones
    .filter((zone) => zone.category === 'mg')
    .flatMap((zone) => [zone.chochTime, zone.doubleChochTime])
    .filter((time): time is number => time !== undefined);
  if (resetTimes.length === 0) return;

  const latestResetTime = Math.max(...resetTimes);
  for (const zone of zones) {
    if (zone.category !== 'mg'
      || (zone.name !== 'TJL1' && zone.name !== 'TJL2')
      || (zone.tjlPairTime ?? zone.startTime) > latestResetTime) continue;
    zone.fibRelevant = false;
    zone.fibBand = undefined;
    zone.fibStatus = undefined;
    zone.fibDeepInvalidatedAt = undefined;
    zone.fibLevel50 = undefined;
    zone.fibSourceTime = undefined;
    zone.fibSourcePrice = undefined;
    zone.fibZeroTime = undefined;
    zone.fibZeroPrice = undefined;
  }
}

export function classifyDoubleChoch(
  originClass: ChochClass | undefined,
  higherTimeframeConfirmed: boolean,
): Pick<DoubleChochMetadata, 'doubleChochStatus' | 'doubleChochOriginClass' | 'tradeable'> | undefined {
  // Double CHoCH is a same-timeframe structural event. Any already-confirmed
  // first CHoCH (Valid, AIR, or VIP) can form it; mapped HTF confirmation is
  // evaluated separately and only controls whether its zones are tradeable.
  if (originClass !== 'valid' && originClass !== 'air' && originClass !== 'vip') return undefined;
  return {
    doubleChochStatus: higherTimeframeConfirmed ? 'valid' : 'pending',
    doubleChochOriginClass: originClass,
    tradeable: higherTimeframeConfirmed,
  };
}

export function wasTjl1ConfirmedBy(
  tjl1: StructureZone | null,
  formationTime: number,
): boolean {
  // Confirmation is historical evidence. A later invalidation can retire the
  // source zone, but it cannot retroactively turn a confirmed TJL1 into AIR.
  return Boolean(
    tjl1?.confirmationTime !== undefined
    && tjl1.confirmationTime <= formationTime
  );
}

export function findVipSupportTap(
  candles: StructureCandle[],
  zones: StructureZone[],
  chochTime: number,
  requiredIsBuy: boolean,
): { zone: StructureZone; tapTime: number } | undefined {
  let selected: { zone: StructureZone; tapTime: number } | undefined;
  for (const zone of zones) {
    // VIP support must agree with the direction after CHoCH. A bearish CHoCH
    // can use only sell zones; a bullish CHoCH can use only buy zones.
    if (zone.isBuy !== requiredIsBuy) continue;
    const activeFromTime = zone.activeFromTime ?? zone.startTime;
    const wasUsableAtChoch = zone.status !== 'rejected'
      && activeFromTime <= chochTime
      && zone.startTime < chochTime
      && (!zone.invalidatedAt || zone.invalidatedAt > chochTime)
      && (!requiresMappedConfirmation(zone) || (
        zone.confirmationTime !== undefined && zone.confirmationTime <= chochTime
      ));
    if (!wasUsableAtChoch) continue;

    // A visit can span several overlapping candles, but it is still one tap.
    // Leaving the zone and returning later creates a fresh tap event.
    let insideZone = false;
    let latestTapTime: number | undefined;
    for (const candle of candles) {
      const inEligibleWindow = candle.time > zone.startTime
        && candle.time >= activeFromTime
        && candle.time <= chochTime
        && (!zone.invalidatedAt || candle.time < zone.invalidatedAt);
      const overlaps = inEligibleWindow
        && candle.high >= zone.bottom
        && candle.low <= zone.top;
      if (overlaps && !insideZone) latestTapTime = candle.time;
      insideZone = overlaps;
    }
    if (latestTapTime !== undefined && (!selected || latestTapTime > selected.tapTime)) {
      selected = { zone, tapTime: latestTapTime };
    }
  }
  return selected;
}

export function findVipSupportTapAcrossContexts(
  candles: StructureCandle[],
  contexts: VipSupportContext[],
  chochTime: number,
  requiredIsBuy: boolean,
): { zone: StructureZone; tapTime: number; timeframe: string } | undefined {
  return contexts.reduce<{
    zone: StructureZone;
    tapTime: number;
    timeframe: string;
  } | undefined>((latest, context) => {
    const candidate = findVipSupportTap(candles, context.zones, chochTime, requiredIsBuy);
    if (!candidate) return latest;
    const withTimeframe = { ...candidate, timeframe: context.timeframe };
    return !latest || withTimeframe.tapTime > latest.tapTime ? withTimeframe : latest;
  }, undefined);
}

export function selectFreshVipSupportTap<T extends { tapTime: number }>(
  candidate: T | undefined,
  lastUsedTapTime: number | undefined,
): T | undefined {
  if (!candidate) return undefined;
  return lastUsedTapTime === undefined || candidate.tapTime > lastUsedTapTime
    ? candidate
    : undefined;
}

export function analyzeMarketStructure(candles: StructureCandle[], options: {
  allowSupplyDemand?: boolean;
  sourceBarSeconds?: number;
  confirmationBarSeconds?: number;
  zoneVisualBars?: number;
  vipSupport?: VipSupportContext | VipSupportContext[];
} = {}): MarketStructureResult {
  if (candles.length < 12) {
    return { markers: [], issMarkers: [], internalMarkers: [], engulfingMarkers: [], zones: [], lines: [], trend: 'neutral' };
  }

  // MG Bhai: initialize on the lowest wick in the first 500 loaded bars.
  const genesisWindowEnd = Math.min(499, candles.length - 1);
  const genesis = extreme(candles, 0, genesisWindowEnd, 'low');
  const markers: SeriesMarker<UTCTimestamp>[] = [
    makeMarker(candles[genesis.index], 'GENESIS LOW', 'belowBar', '#7c3aed', 'arrowUp', 2),
  ];
  const lines: StructureLine[] = [];
  const zones: StructureZone[] = [];
  const issMarkers: IssMarker[] = [];
  const internalMarkers: SeriesMarker<UTCTimestamp>[] = [];
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
  let lastVipSupportTapTimeUsed: number | undefined;
  let pendingDouble: {
    direction: 'bullish' | 'bearish';
    qml: StructureZone;
    secondary: StructureZone;
    extreme: StructureZone;
    startedAt: number;
    context: ChochMetadata;
  } | null = null;

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

  const buildChochContext = (
    direction: 'bullish' | 'bearish',
    tjl1: StructureZone | null,
    tjl2: StructureZone | null,
    sourceChochTime: number,
  ): ChochMetadata => {
    const formationTime = sourceChochTime + sourceBarSeconds;
    const tjl1Confirmed = wasTjl1ConfirmedBy(tjl1, formationTime);
    const tjl2Confirmation = tjl2
      ? resolveTjl1Confirmation(candles, {
        confirmationDirection: direction === 'bullish' ? 'up' : 'down',
        bottom: tjl2.bottom,
        top: tjl2.top,
        formationTime,
        sourceBarSeconds,
        confirmationBarSeconds: options.confirmationBarSeconds,
      })
      : { status: 'pending' as const };
    const vipSupportContexts = !options.vipSupport
      ? []
      : Array.isArray(options.vipSupport) ? options.vipSupport : [options.vipSupport];
    const candidateVipTap = tjl2
      ? findVipSupportTapAcrossContexts(
        candles,
        vipSupportContexts,
        sourceChochTime,
        direction === 'bullish',
      )
      : undefined;
    const vipTap = selectFreshVipSupportTap(candidateVipTap, lastVipSupportTapTimeUsed);
    // Reserve a tap for the first proper CHoCH after it, even while the TJL2
    // higher-timeframe close is pending. A later CHoCH needs a fresh retap.
    if (vipTap) lastVipSupportTapTimeUsed = vipTap.tapTime;
    const classification = classifyChoch({
      tjl1Confirmed,
      tjl2Confirmed: tjl2Confirmation.status === 'valid',
      vipZoneTapped: vipTap !== undefined,
    });
    return {
      ...classification,
      chochTime: sourceChochTime,
      chochConfirmationTime: tjl2Confirmation.confirmationTime,
      vipSupportTimeframe: vipTap?.timeframe,
      vipSupportZone: vipTap?.zone.name,
      vipSupportTapTime: vipTap?.tapTime,
    };
  };

  const applyChochContext = (context: ChochMetadata, ...contextZones: Array<StructureZone | null>) => {
    for (const zone of contextZones) {
      if (zone) {
        Object.assign(zone, context);
        if (context.chochTime !== undefined) {
          activateZoneAfterChoch(zone, context.chochTime, sourceBarSeconds);
        }
      }
    }
  };

  const buildDoubleChochContext = (
    originContext: ChochMetadata,
    brokenZone: StructureZone,
    direction: 'bullish' | 'bearish',
    sourceDoubleChochTime: number,
  ): DoubleChochMetadata | undefined => {
    const confirmationDirection = direction === 'bullish' ? 'up' : 'down';
    const confirmation = resolveTjl1Confirmation(candles, {
      confirmationDirection,
      bottom: brokenZone.bottom,
      top: brokenZone.top,
      formationTime: sourceDoubleChochTime + sourceBarSeconds,
      sourceBarSeconds,
      confirmationBarSeconds: options.confirmationBarSeconds,
    });
    const classification = classifyDoubleChoch(
      originContext.chochClass,
      confirmation.status === 'valid',
    );
    if (!classification) return undefined;
    return {
      ...classification,
      doubleChochTime: sourceDoubleChochTime,
      doubleChochConfirmationTime: confirmation.confirmationTime,
      doubleChochConfirmationDirection: confirmationDirection,
    };
  };

  const applyDoubleChochContext = (
    context: DoubleChochMetadata,
    ...contextZones: Array<StructureZone | null>
  ) => {
    for (const zone of contextZones) {
      if (zone) {
        Object.assign(zone, context);
        if (context.doubleChochTime !== undefined) {
          activateZoneAfterChoch(zone, context.doubleChochTime, sourceBarSeconds);
        }
      }
    }
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

  const addTjlZone = (
    point: StructurePoint,
    name: 'TJL1' | 'TJL2',
    isBuy: boolean,
    pivotSide: 'high' | 'low',
    formationTime: number,
  ) => {
    const source = candles[point.index];
    const buffer = Math.abs(source.close - source.open) * 0.01;
    const lowerBody = Math.min(source.open, source.close);
    const upperBody = Math.max(source.open, source.close);
    const bottomWick = lowerBody - source.low;
    const topWick = source.high - upperBody;
    // Pivot geometry and trade direction are independent. A bullish TJL1 is
    // a BUY zone at a high pivot (extending below the high), while a bearish
    // TJL1 is a SELL zone at a low pivot (extending above the low).
    const highPivot = pivotSide === 'high';
    const bottom = highPivot ? point.price - (topWick + buffer) : point.price;
    const top = highPivot ? point.price : point.price + (bottomWick + buffer);
    const confirmation = name === 'TJL1'
      ? resolveTjl1Confirmation(candles, {
        confirmationDirection: isBuy ? 'up' : 'down', bottom, top, formationTime,
        sourceBarSeconds,
        confirmationBarSeconds: options.confirmationBarSeconds,
      })
      : { status: 'valid' as const };
    return addZone({
      name, category: 'mg', isBuy, startTime: point.time,
      tjlPairTime: formationTime,
      bottom, top,
      status: confirmation.status,
      tjl1ConfirmationAttempts: confirmation.tjl1ConfirmationAttempts,
      confirmationTime: confirmation.confirmationTime,
      confirmationWindowCloseTime: confirmation.confirmationWindowCloseTime,
      // A pending TJL1 is drawn from formation, but a VALID TJL1 only starts
      // looking for its first trade tap after the confirming higher-TF close.
      activeFromTime: confirmation.status === 'valid'
        ? confirmation.confirmationTime ?? formationTime
        : formationTime,
    });
  };

  const linkTjlPair = (tjl1: StructureZone, tjl2: StructureZone) => {
    const tjl1Midpoint = (tjl1.top + tjl1.bottom) / 2;
    const tjl2Midpoint = (tjl2.top + tjl2.bottom) / 2;
    tjl1.invalidationDirection = tjl2Midpoint > tjl1Midpoint ? 'up' : 'down';
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
  const hasStructureMarkerAt = (point: StructurePoint, position: 'aboveBar' | 'belowBar') => (
    markers.some((marker) => Number(marker.time) === point.time && marker.position === position)
  );

  for (let index = genesis.index + 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];

    for (const zone of zones) {
      if (!zone.active) continue;
      // TJL1 is protected until its first mapped higher-timeframe candle has
      // closed. Before that close, a source-chart move cannot mark it invalid.
      const invalidationStart = zone.name === 'TJL1'
        ? zone.confirmationWindowCloseTime
        : zone.activeFromTime ?? zone.startTime;
      if (invalidationStart === undefined || candle.time < invalidationStart) continue;
      // Unfinished candles do not cancel zones. The shared rule invalidates
      // when a completed candle's full body is outside the invalid side.
      if (doesInvalidateZone(zone, candle)) {
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
        const originContext = pendingDouble.context;
        const doubleContext = buildDoubleChochContext(
          originContext,
          pendingDouble.extreme,
          'bearish',
          candle.time,
        );
        const startIndex = candles.findIndex((item) => item.time === pendingDouble!.startedAt);
        const doubleHigh = extreme(candles, Math.max(0, startIndex), index, 'high');
        addLevel('choch', 'bearish', protectedPoint, index, 'DOUBLE CHoCH');
        removeStandaloneSwingMarker(doubleHigh);
        markers.push(makeMarker(candles[doubleHigh.index], 'PH', 'aboveBar', '#b91c1c'));
        const qmlA = convertZone(pendingDouble.qml, 'QML A+', false, candle.time);
        const qmlAA = convertZone(pendingDouble.secondary, 'QML A++', false, candle.time);
        const sbr = convertZone(pendingDouble.extreme, 'SBR', false, candle.time);
        const dtd = addDbDtZone(doubleHigh, 'DT', false);
        dtd.name = 'DTD';
        if (doubleContext) applyDoubleChochContext(doubleContext, qmlA, qmlAA, sbr, dtd);
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
        // The first red candle can own the SH wick. The second red candle only
        // confirms the retracement, so it cannot relocate the swing or zone.
        activeHigh = selectTwoCandleRetracementPivot(candles, leftBound, index, 'high');
        // This SH is the same candidate point that later becomes HH.
        if (!hasStructureMarkerAt(activeHigh, 'aboveBar')) {
          markers.push(makeMarker(candles[activeHigh.index], 'SH', 'aboveBar', '#64748b', 'circle', 0.55));
        }
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
          // Once confirmed, the provisional SH/PL role is finished. Keep only
          // the permanent structure label so old candidate labels do not
          // accumulate across the chart.
          makeMarker(candles[confirmedHigh.index], 'HH', 'aboveBar', '#059669'),
          makeMarker(candles[confirmedLow.index], 'HL', 'belowBar', '#059669'),
        );
        addSwing(confirmedHigh, 'bullish');
        addSwing(confirmedLow, 'bullish');
        addLevel('bos', 'bullish', confirmedHigh, index, 'BOS');

        currentTrendTjl1 = addTjlZone(confirmedHigh, 'TJL1', true, 'high', candle.time + sourceBarSeconds);
        currentTrendTjl2 = addTjlZone(confirmedLow, 'TJL2', true, 'low', candle.time + sourceBarSeconds);
        linkTjlPair(currentTrendTjl1, currentTrendTjl2);
        lastBullishHigh = confirmedHigh;
        if (options.allowSupplyDemand) {
          const originIndex = findOrderBlock(candles, confirmedHigh.index, index, true);
          const origin = candles[originIndex];
          addZone({ name: 'DEMAND', category: 'supplyDemand', isBuy: true, startTime: origin.time,
            activeFromTime: candle.time + sourceBarSeconds,
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
        // If the two-red retracement already confirmed an SH, CHoCH must
        // promote that exact wick. Re-scanning through the break candle can
        // move both the protected point and its DT zone to an unconfirmed wick.
        const newProtectedHigh = activeHigh
          ?? extreme(candles, protectedPoint.index, index, 'high');
        removeStandaloneSwingMarker(newProtectedHigh);
        markers.push(makeMarker(candles[newProtectedHigh.index], 'PH', 'aboveBar', '#b91c1c'));
        // Confirmed uptrend → downtrend: HH/TJL1 becomes QML, HL/TJL2 becomes
        // SBR, and the newly identified PH becomes the DT zone.
        const lastTjl1 = currentTrendTjl1;
        const lastTjl2 = currentTrendTjl2;
        const chochContext = buildChochContext('bearish', lastTjl1, lastTjl2, candle.time);
        const qml = lastTjl1 ? convertZone(lastTjl1, 'QML', false, candle.time) : null;
        const sbr = lastTjl2 ? convertZone(lastTjl2, 'SBR', false, candle.time) : null;
        const dt = addDbDtZone(newProtectedHigh, 'DT', false);
        applyChochContext(chochContext, qml, sbr, dt);
        pendingDouble = qml && sbr && classifyDoubleChoch(chochContext.chochClass, false)
          ? { direction: 'bearish', qml, secondary: sbr, extreme: dt, startedAt: candle.time, context: chochContext }
          : null;
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
        const originContext = pendingDouble.context;
        const doubleContext = buildDoubleChochContext(
          originContext,
          pendingDouble.extreme,
          'bullish',
          candle.time,
        );
        const startIndex = candles.findIndex((item) => item.time === pendingDouble!.startedAt);
        const doubleLow = extreme(candles, Math.max(0, startIndex), index, 'low');
        addLevel('choch', 'bullish', protectedPoint, index, 'DOUBLE CHoCH');
        removeStandaloneSwingMarker(doubleLow);
        markers.push(makeMarker(candles[doubleLow.index], 'PL', 'belowBar', '#047857'));
        const qmlA = convertZone(pendingDouble.qml, 'QML A+', true, candle.time);
        const qmlAA = convertZone(pendingDouble.secondary, 'QML A++', true, candle.time);
        const rbs = convertZone(pendingDouble.extreme, 'RBS', true, candle.time);
        const dbd = addDbDtZone(doubleLow, 'DB', true);
        dbd.name = 'DBD';
        if (doubleContext) applyDoubleChochContext(doubleContext, qmlA, qmlAA, rbs, dbd);
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
        // The first green candle can own the SL wick. The second green candle
        // only confirms the retracement, so the derived zone stays on this SL.
        activeLow = selectTwoCandleRetracementPivot(candles, leftBound, index, 'low');
        // This SL is the same candidate point that later becomes LL.
        if (!hasStructureMarkerAt(activeLow, 'belowBar')) {
          markers.push(makeMarker(candles[activeLow.index], 'SL', 'belowBar', '#64748b', 'circle', 0.55));
        }
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
          // The active SL/PH has now been promoted to permanent structure.
          // Display only LL/LH; the next unconfirmed candidate keeps SL/PH.
          makeMarker(candles[confirmedLow.index], 'LL', 'belowBar', '#dc2626'),
          makeMarker(candles[confirmedHigh.index], 'LH', 'aboveBar', '#dc2626'),
        );
        addSwing(confirmedLow, 'bearish');
        addSwing(confirmedHigh, 'bearish');
        addLevel('bos', 'bearish', confirmedLow, index, 'BOS');

        currentTrendTjl1 = addTjlZone(confirmedLow, 'TJL1', false, 'low', candle.time + sourceBarSeconds);
        currentTrendTjl2 = addTjlZone(confirmedHigh, 'TJL2', false, 'high', candle.time + sourceBarSeconds);
        linkTjlPair(currentTrendTjl1, currentTrendTjl2);
        lastBearishLow = confirmedLow;
        if (options.allowSupplyDemand) {
          const originIndex = findOrderBlock(candles, confirmedLow.index, index, false);
          const origin = candles[originIndex];
          addZone({ name: 'SUPPLY', category: 'supplyDemand', isBuy: false, startTime: origin.time,
            activeFromTime: candle.time + sourceBarSeconds,
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
        // If the two-green retracement already confirmed an SL, CHoCH must
        // promote that exact wick. The DB zone therefore starts at the same
        // valid retracement point instead of a later arbitrary lower wick.
        const newProtectedLow = activeLow
          ?? extreme(candles, protectedPoint.index, index, 'low');
        removeStandaloneSwingMarker(newProtectedLow);
        markers.push(makeMarker(candles[newProtectedLow.index], 'PL', 'belowBar', '#047857'));
        // Confirmed downtrend → uptrend: LL/TJL1 becomes QML, LH/TJL2 becomes
        // RBS, and the newly identified PL becomes the DB zone.
        const lastTjl1 = currentTrendTjl1;
        const lastTjl2 = currentTrendTjl2;
        const chochContext = buildChochContext('bullish', lastTjl1, lastTjl2, candle.time);
        const qml = lastTjl1 ? convertZone(lastTjl1, 'QML', true, candle.time) : null;
        const rbs = lastTjl2 ? convertZone(lastTjl2, 'RBS', true, candle.time) : null;
        const db = addDbDtZone(newProtectedLow, 'DB', true);
        applyChochContext(chochContext, qml, rbs, db);
        pendingDouble = qml && rbs && classifyDoubleChoch(chochContext.chochClass, false)
          ? { direction: 'bullish', qml, secondary: rbs, extreme: db, startedAt: candle.time, context: chochContext }
          : null;
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
  const iss = findIssFiveWaves(
    candles,
    issAnchors,
    sourceBarSeconds,
    zoneVisualBars,
    options.confirmationBarSeconds,
    // An external BOS continues the current structure. Only an external CHoCH
    // starts a new external structure and terminates the post-ISS internal run.
    lines.filter((line) => line.type === 'choch').map((line) => line.toTime),
    options.vipSupport,
  );
  issMarkers.push(...iss.markers);
  internalMarkers.push(...iss.internalMarkers);
  zones.push(...iss.zones);
  lines.push(...iss.lines);
  applyFibConfluence(candles, zones);
  const engulfingMarkers = applyEngulfingConfluence(candles, zones);
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
    const tapIndex = findFirstZoneTapIndex(candles, zone);
    if (tapIndex >= 0) {
      zone.tapTime = candles[tapIndex].time;
      zone.tapBarsAgo = candles.length - 1 - tapIndex;
    }

    // TJL1 uses the same fixed visual width as every other zone.
    zone.endTime = endTimeForZone(zone.startTime);
  }

  const visibleZones = [...zones].sort((a, b) => a.startTime - b.startTime);

  return {
    markers: visibleMarkers,
    issMarkers: issMarkers.slice(-36),
    internalMarkers: internalMarkers.slice(-80),
    engulfingMarkers,
    zones: visibleZones,
    lines: visibleLines,
    trend,
    genesis: { time: genesis.time, price: genesis.price },
  };
}

export function findIssFiveWaves(
  candles: StructureCandle[],
  anchors: { direction: 'bullish' | 'bearish'; start: StructurePoint; boundary: StructurePoint }[],
  sourceBarSeconds: number,
  zoneVisualBars: number,
  confirmationBarSeconds?: number,
  externalStructureTimes: number[] = [],
  vipSupport?: VipSupportContext | VipSupportContext[],
): {
  markers: IssMarker[];
  internalMarkers: SeriesMarker<UTCTimestamp>[];
  lines: StructureLine[];
  zones: StructureZone[];
} {
  // ISS uses only the current chart timeframe. Point 0 is an external SL/SH,
  // and the five internal points must remain inside its PH/PL boundary.
  const markers: IssMarker[] = [];
  const internalMarkers: SeriesMarker<UTCTimestamp>[] = [];
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
      const text = index === 5 ? '⑤ ISS' : ['⓪', '①', '②', '③', '④'][index];
      const isHighPoint = isBullish ? index % 2 === 1 : index % 2 === 0;
      markers.push({
        ...makeMarker(
          candles[point.index], text, isHighPoint ? 'aboveBar' : 'belowBar', '#d97706',
          'circle', 2,
        ),
        pivotPrice: point.price,
      });
      if (index > 0) lines.push({
        id: `iss-${direction}-${points[index - 1].time}-${point.time}`,
        type: 'iss', direction,
        fromTime: points[index - 1].time, fromPrice: points[index - 1].price,
        toTime: point.time, toPrice: point.price,
      });
    });
    const point0 = points[0];
    const wave3 = points[3]; // second TJL1
    const wave4 = points[4]; // second TJL2
    const point5 = points[5];
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
    const wave3Bottom = isBullish ? wave3.price - (wick3 + buffer3) : wave3.price;
    const wave3Top = isBullish ? wave3.price : wave3.price + (wick3 + buffer3);
    // Level 3 is the ISS equivalent of TJL1. The completed five-wave pattern
    // creates it, then the mapped higher timeframe must close through its
    // confirmation side before it becomes valid/tradeable.
    const wave3FormationTime = confirmedAt + sourceBarSeconds;
    const wave3Confirmation = resolveTjl1Confirmation(candles, {
      confirmationDirection: isBullish ? 'up' : 'down',
      bottom: wave3Bottom,
      top: wave3Top,
      formationTime: wave3FormationTime,
      sourceBarSeconds,
      confirmationBarSeconds,
    });
    const wave3Zone: StructureZone = {
        id: `iss-l3-${wave3.time}`, name: 'ISS L3', category: 'iss', isBuy: isBullish,
        startTime: wave3.time,
        endTime: wave3.time + sourceBarSeconds * zoneVisualBars,
        activeFromTime: wave3Confirmation.status === 'valid'
          ? wave3Confirmation.confirmationTime ?? wave3FormationTime
          : wave3FormationTime,
        bottom: wave3Bottom,
        top: wave3Top,
        active: true,
        status: wave3Confirmation.status,
        tjl1ConfirmationAttempts: wave3Confirmation.tjl1ConfirmationAttempts,
        confirmationTime: wave3Confirmation.confirmationTime,
        confirmationWindowCloseTime: wave3Confirmation.confirmationWindowCloseTime,
        invalidationDirection: isBullish ? 'down' : 'up',
        issPoint0Time: point0.time,
        issPoint0Price: point0.price,
        issPoint5Time: point5.time,
        issPoint5Price: point5.price,
        issDirection: direction,
        issCompletionTime: confirmedAt,
      };
    const wave4Zone: StructureZone = {
        id: `iss-l4-${wave4.time}`, name: 'ISS L4', category: 'iss', isBuy: isBullish,
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
      // An ISS reversal needs two same-colour candles and a wick break by the
      // second close. Without the wick break, tiny continuation candles can
      // replace a valid wave pivot (for example Point 1) too early.
      const twoRed = candle.close < candle.open
        && previous.close < previous.open
        && candle.close < previous.low;
      const twoGreen = candle.close > candle.open
        && previous.close > previous.open
        && candle.close > previous.high;
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
        // the full highest/lowest wick through its first candle. The second
        // retracement candle confirms the turn but is not part of the pivot.
        const point1 = selectTwoCandleRetracementPivot(candles, points[0].index + 1, index, highOrLow);
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
        const replacement = selectTwoCandleRetracementPivot(candles, points[0].index + 1, index, highOrLow);
        const isMoreExtreme = anchor.direction === 'bullish'
          ? replacement.price > points[1].price
          : replacement.price < points[1].price;
        if (isMoreExtreme && withinBoundary(replacement, anchor)) points[1] = replacement;
      } else if (state === 3 && reversal) {
        const point3 = selectTwoCandleRetracementPivot(candles, points[2].index + 1, index, highOrLow);
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
      } else if (state === 5 && reversal) {
        const point5 = selectTwoCandleRetracementPivot(candles, points[4].index + 1, index, highOrLow);
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
    zone.category = 'internal';
    zone.isBuy = isBuy;
    zone.active = true;
    zone.status = 'valid';
    zone.activeFromTime = activeFromTime + sourceBarSeconds;
    zone.invalidationDirection = undefined;
    zone.invalidatedAt = undefined;
    zone.tapTime = undefined;
    zone.tapBarsAgo = undefined;
  };
  const addInternalExtremeZone = (
    point: StructurePoint,
    name: Extract<StructureZone['name'], 'Internal DT' | 'Internal DB'>,
    isBuy: boolean,
    activeFromTime: number,
  ) => {
    const candle = candles[point.index];
    const bodyLow = Math.min(candle.open, candle.close);
    const bodyHigh = Math.max(candle.open, candle.close);
    const buffer = Math.abs(candle.close - candle.open) * 0.01;
    const bottom = name === 'Internal DB'
      ? point.price
      : point.price - (candle.high - bodyHigh + buffer);
    const top = name === 'Internal DB'
      ? point.price + (bodyLow - candle.low + buffer)
      : point.price;
    const created: StructureZone = {
      id: `${name}-${point.time}-${point.price}`, name, category: 'internal', isBuy,
      startTime: point.time, activeFromTime,
      endTime: point.time + sourceBarSeconds * zoneVisualBars,
      bottom, top, active: true, status: 'valid',
    };
    zones.push(created);
    return created;
  };

  const addInternalTjlZone = (
    point: StructurePoint,
    name: 'Internal TJL1' | 'Internal TJL2',
    isBuy: boolean,
    pivotSide: 'high' | 'low',
    formationTime: number,
  ) => {
    const source = candles[point.index];
    const buffer = Math.abs(source.close - source.open) * 0.01;
    const lowerBody = Math.min(source.open, source.close);
    const upperBody = Math.max(source.open, source.close);
    const bottomWick = lowerBody - source.low;
    const topWick = source.high - upperBody;
    const highPivot = pivotSide === 'high';
    const bottom = highPivot ? point.price - (topWick + buffer) : point.price;
    const top = highPivot ? point.price : point.price + (bottomWick + buffer);
    const confirmation = name === 'Internal TJL1'
      ? resolveTjl1Confirmation(candles, {
        confirmationDirection: isBuy ? 'up' : 'down',
        bottom,
        top,
        formationTime,
        sourceBarSeconds,
        confirmationBarSeconds,
      })
      : { status: 'valid' as const };
    const created: StructureZone = {
      id: `${name}-${point.time}-${point.price}`,
      name,
      category: 'internal',
      isBuy,
      startTime: point.time,
      tjlPairTime: formationTime,
      endTime: point.time + sourceBarSeconds * zoneVisualBars,
      activeFromTime: confirmation.status === 'valid'
        ? confirmation.confirmationTime ?? formationTime
        : formationTime,
      bottom,
      top,
      active: true,
      status: confirmation.status,
      tjl1ConfirmationAttempts: confirmation.tjl1ConfirmationAttempts,
      confirmationTime: confirmation.confirmationTime,
      confirmationWindowCloseTime: confirmation.confirmationWindowCloseTime,
    };
    zones.push(created);
    return created;
  };

  const linkInternalTjlPair = (tjl1: StructureZone, tjl2: StructureZone) => {
    const tjl1Midpoint = (tjl1.top + tjl1.bottom) / 2;
    const tjl2Midpoint = (tjl2.top + tjl2.bottom) / 2;
    tjl1.invalidationDirection = tjl2Midpoint > tjl1Midpoint ? 'up' : 'down';
  };

  const addInternalLine = (
    type: Extract<StructureLine['type'], 'internal-swing' | 'internal-bos' | 'internal-choch'>,
    direction: 'bullish' | 'bearish',
    from: StructurePoint,
    to: StructurePoint,
    label?: string,
  ) => {
    if (type === 'internal-swing' && from.time === to.time && from.price === to.price) return;
    lines.push({
      id: `${type}-${from.time}-${to.time}-${to.price}`,
      type,
      direction,
      fromTime: from.time,
      fromPrice: from.price,
      toTime: to.time,
      toPrice: to.price,
      label,
    });
  };

  const internalVipSupportContexts = !vipSupport
    ? []
    : Array.isArray(vipSupport) ? vipSupport : [vipSupport];
  let lastInternalVipSupportTapTimeUsed: number | undefined;
  const buildInternalChochContext = (
    direction: 'bullish' | 'bearish',
    tjl1: StructureZone | null,
    tjl2: StructureZone | null,
    sourceChochTime: number,
  ): ChochMetadata => {
    const formationTime = sourceChochTime + sourceBarSeconds;
    const tjl1Confirmed = wasTjl1ConfirmedBy(tjl1, formationTime);
    const tjl2Confirmation = tjl2
      ? resolveTjl1Confirmation(candles, {
        confirmationDirection: direction === 'bullish' ? 'up' : 'down',
        bottom: tjl2.bottom,
        top: tjl2.top,
        formationTime,
        sourceBarSeconds,
        confirmationBarSeconds,
      })
      : { status: 'pending' as const };
    const candidateVipTap = tjl2
      ? findVipSupportTapAcrossContexts(
        candles,
        internalVipSupportContexts,
        sourceChochTime,
        direction === 'bullish',
      )
      : undefined;
    const vipTap = selectFreshVipSupportTap(
      candidateVipTap,
      lastInternalVipSupportTapTimeUsed,
    );
    if (vipTap) lastInternalVipSupportTapTimeUsed = vipTap.tapTime;
    return {
      ...classifyChoch({
        tjl1Confirmed,
        tjl2Confirmed: tjl2Confirmation.status === 'valid',
        vipZoneTapped: vipTap !== undefined,
      }),
      chochTime: sourceChochTime,
      chochConfirmationTime: tjl2Confirmation.confirmationTime,
      vipSupportTimeframe: vipTap?.timeframe,
      vipSupportZone: vipTap?.zone.name,
      vipSupportTapTime: vipTap?.tapTime,
    };
  };
  const applyInternalChochContext = (
    context: ChochMetadata,
    ...contextZones: Array<StructureZone | null>
  ) => {
    for (const zone of contextZones) {
      if (zone) Object.assign(zone, context);
    }
  };
  const internalChochLabel = (context: ChochMetadata) => (
    `INT CHoCH · ${context.chochClass === 'pending' ? 'WAIT' : context.chochClass.toUpperCase()}`
  );

  for (const pattern of patterns) {
    const confirmedIndex = candles.findIndex((candle) => candle.time === pattern.confirmedAt);
    if (confirmedIndex < 0) continue;
    const point3 = pattern.points[3];
    const point4 = pattern.points[4];
    const point5 = pattern.points[5];
    const isBullishIss = pattern.direction === 'bullish';
    const stopTime = externalStructureTimes.find((time) => time > pattern.confirmedAt) ?? Infinity;
    // ISS L3/L4 remain the only visible zones at completion. Internal TJL1/2
    // begin only after price confirms continuation beyond Point 5. Point 3/4
    // are retained as a hidden seed pair solely for a direct Point-5 CHoCH.
    let internalTrend: 'bullish' | 'bearish' = pattern.direction;
    let protectedPoint = point4;
    let pathStart = point5;
    let activeHigh: StructurePoint | null = null;
    let activeLow: StructurePoint | null = null;
    let currentTjl1: StructureZone | null = null;
    let currentTjl2: StructureZone | null = null;
    let initialIssPairAvailable = true;
    const seedDirectChochPair = () => {
      if (!initialIssPairAvailable || currentTjl1 || currentTjl2) return;
      currentTjl1 = addInternalTjlZone(
        point3,
        'Internal TJL1',
        isBullishIss,
        isBullishIss ? 'high' : 'low',
        pattern.confirmedAt + sourceBarSeconds,
      );
      currentTjl2 = addInternalTjlZone(
        point4,
        'Internal TJL2',
        isBullishIss,
        isBullishIss ? 'low' : 'high',
        pattern.confirmedAt + sourceBarSeconds,
      );
      linkInternalTjlPair(currentTjl1, currentTjl2);
    };
    let lastBullishConfirmIndex: number | null = isBullishIss ? point5.index : null;
    let lastBearishConfirmIndex: number | null = isBullishIss ? null : point5.index;
    // Internal reversal structure is not established by ISS completion alone.
    // At least one continuation BOS after Point 5 must confirm the working
    // internal HH/HL or LL/LH pair before an opposite close can be CHoCH.
    let hasPostIssInternalBos = false;

    for (let index = point5.index + 1; index < candles.length; index += 1) {
      const candle = candles[index];
      const previous = candles[index - 1];
      if (candle.time >= stopTime) break;
      const twoRed = candle.close < candle.open
        && previous.close < previous.open
        && candle.close < previous.low;
      const twoGreen = candle.close > candle.open
        && previous.close > previous.open
        && candle.close > previous.high;

      if (internalTrend === 'bullish') {
        if (twoRed && activeHigh === null) {
          const from = lastBullishConfirmIndex ?? protectedPoint.index;
          activeHigh = selectTwoCandleRetracementPivot(candles, from, index, 'high');
        }
        if (activeHigh && candle.close > activeHigh.price) {
          const confirmedHigh = activeHigh;
          const confirmedLow = extreme(candles, confirmedHigh.index, index, 'low', lastBullishConfirmIndex);
          internalMarkers.push(
            makeMarker(candles[confirmedHigh.index], 'I HH', 'aboveBar', '#0d9488'),
            makeMarker(candles[confirmedLow.index], 'I HL', 'belowBar', '#0d9488'),
          );
          addInternalLine('internal-swing', 'bullish', pathStart, confirmedHigh);
          addInternalLine('internal-swing', 'bullish', confirmedHigh, confirmedLow);
          addInternalLine('internal-bos', 'bullish', confirmedHigh, {
            index, time: candle.time, price: confirmedHigh.price,
          }, 'INT BOS');
          currentTjl1 = addInternalTjlZone(
            confirmedHigh, 'Internal TJL1', true, 'high', candle.time + sourceBarSeconds,
          );
          currentTjl2 = addInternalTjlZone(
            confirmedLow, 'Internal TJL2', true, 'low', candle.time + sourceBarSeconds,
          );
          linkInternalTjlPair(currentTjl1, currentTjl2);
          protectedPoint = confirmedLow;
          pathStart = confirmedLow;
          activeHigh = null;
          lastBullishConfirmIndex = index;
          hasPostIssInternalBos = true;
          initialIssPairAvailable = false;
        }
        // Internal CHoCH is confirmed by the first body close through the
        // protected Point-4 level. Requiring a second close can miss the true
        // displacement candle when price immediately retests the broken level.
        if ((hasPostIssInternalBos || initialIssPairAvailable)
          && candle.close < protectedPoint.price) {
          seedDirectChochPair();
          const newProtectedHigh = activeHigh ?? extreme(candles, protectedPoint.index, index, 'high');
          const lastTjl1 = currentTjl1;
          const lastTjl2 = currentTjl2;
          const chochContext = buildInternalChochContext('bearish', lastTjl1, lastTjl2, candle.time);
          addInternalLine('internal-choch', 'bearish', protectedPoint, {
            index, time: candle.time, price: protectedPoint.price,
          }, internalChochLabel(chochContext));
          if (lastTjl1) activateInternalZone(lastTjl1, 'Internal QML', false, candle.time);
          if (lastTjl2) activateInternalZone(lastTjl2, 'Internal SBR', false, candle.time);
          internalMarkers.push(makeMarker(candles[newProtectedHigh.index], 'I PH', 'aboveBar', '#be123c'));
          const dt = addInternalExtremeZone(
            newProtectedHigh, 'Internal DT', false, candle.time + sourceBarSeconds,
          );
          applyInternalChochContext(chochContext, lastTjl1, lastTjl2, dt);
          internalTrend = 'bearish';
          protectedPoint = newProtectedHigh;
          pathStart = newProtectedHigh;
          currentTjl1 = null;
          currentTjl2 = null;
          activeHigh = null;
          activeLow = null;
          lastBearishConfirmIndex = null;
          hasPostIssInternalBos = false;
          initialIssPairAvailable = false;
        }
      } else {
        if (twoGreen && activeLow === null) {
          const from = lastBearishConfirmIndex ?? protectedPoint.index;
          activeLow = selectTwoCandleRetracementPivot(candles, from, index, 'low');
        }
        if (activeLow && candle.close < activeLow.price) {
          const confirmedLow = activeLow;
          const confirmedHigh = extreme(candles, confirmedLow.index, index, 'high', lastBearishConfirmIndex);
          internalMarkers.push(
            makeMarker(candles[confirmedLow.index], 'I LL', 'belowBar', '#e11d48'),
            makeMarker(candles[confirmedHigh.index], 'I LH', 'aboveBar', '#e11d48'),
          );
          addInternalLine('internal-swing', 'bearish', pathStart, confirmedLow);
          addInternalLine('internal-swing', 'bearish', confirmedLow, confirmedHigh);
          addInternalLine('internal-bos', 'bearish', confirmedLow, {
            index, time: candle.time, price: confirmedLow.price,
          }, 'INT BOS');
          currentTjl1 = addInternalTjlZone(
            confirmedLow, 'Internal TJL1', false, 'low', candle.time + sourceBarSeconds,
          );
          currentTjl2 = addInternalTjlZone(
            confirmedHigh, 'Internal TJL2', false, 'high', candle.time + sourceBarSeconds,
          );
          linkInternalTjlPair(currentTjl1, currentTjl2);
          protectedPoint = confirmedHigh;
          pathStart = confirmedHigh;
          activeLow = null;
          lastBearishConfirmIndex = index;
          hasPostIssInternalBos = true;
          initialIssPairAvailable = false;
        }
        if ((hasPostIssInternalBos || initialIssPairAvailable)
          && candle.close > protectedPoint.price) {
          seedDirectChochPair();
          const newProtectedLow = activeLow ?? extreme(candles, protectedPoint.index, index, 'low');
          const lastTjl1 = currentTjl1;
          const lastTjl2 = currentTjl2;
          const chochContext = buildInternalChochContext('bullish', lastTjl1, lastTjl2, candle.time);
          addInternalLine('internal-choch', 'bullish', protectedPoint, {
            index, time: candle.time, price: protectedPoint.price,
          }, internalChochLabel(chochContext));
          if (lastTjl1) activateInternalZone(lastTjl1, 'Internal QML', true, candle.time);
          if (lastTjl2) activateInternalZone(lastTjl2, 'Internal RBS', true, candle.time);
          internalMarkers.push(makeMarker(candles[newProtectedLow.index], 'I PL', 'belowBar', '#047857'));
          const db = addInternalExtremeZone(
            newProtectedLow, 'Internal DB', true, candle.time + sourceBarSeconds,
          );
          applyInternalChochContext(chochContext, lastTjl1, lastTjl2, db);
          internalTrend = 'bullish';
          protectedPoint = newProtectedLow;
          pathStart = newProtectedLow;
          currentTjl1 = null;
          currentTjl2 = null;
          activeHigh = null;
          activeLow = null;
          lastBullishConfirmIndex = null;
          hasPostIssInternalBos = false;
          initialIssPairAvailable = false;
        }
      }
    }
  }

  for (const zone of zones) {
    for (const candle of candles) {
      const invalidationStart = requiresMappedConfirmation(zone)
        ? zone.confirmationWindowCloseTime
        : zone.activeFromTime ?? zone.startTime;
      if (invalidationStart === undefined || candle.time < invalidationStart) continue;
      if (doesInvalidateZone(zone, candle)) {
        zone.active = false;
        zone.status = 'invalidated';
        zone.invalidatedAt = candle.time;
      }
      if (!zone.active) break;
    }
  }
  return {
    markers: markers.slice(-36),
    internalMarkers: internalMarkers.slice(-80),
    lines: lines.slice(-120),
    zones: zones.slice(-60),
  };
}
