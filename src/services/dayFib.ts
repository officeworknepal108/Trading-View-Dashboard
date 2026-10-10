import type { StructureCandle } from './marketStructure';

const NEPAL_UTC_OFFSET_SECONDS = 5 * 3600 + 45 * 60;
const DAY_SECONDS = 24 * 3600;
const SESSION_START_SECONDS = 9 * 3600 + 15 * 60;

export interface DayFibMove {
  sessionDate: string;
  direction: 'up' | 'down';
  activationTime: number;
  sourceTime: number;
  sourcePrice: number;
  zeroTime: number;
  zeroPrice: number;
}

function nepalDayStartUtc(timestamp: number): number {
  return Math.floor((timestamp + NEPAL_UTC_OFFSET_SECONDS) / DAY_SECONDS) * DAY_SECONDS
    - NEPAL_UTC_OFFSET_SECONDS;
}

function nepalDateLabel(dayStart: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(dayStart * 1000));
}

/**
 * Builds one FIB per Nepal calendar day. The exact 9:15 candle activates the
 * FIB and provides the direction reference, but it is not automatically the
 * source. An upward day starts at the lowest wick formed since Nepal midnight
 * and extends to the day's highest wick; a downward day starts at the highest
 * wick and extends to the day's lowest wick. A completed day remains frozen.
 */
export function buildDayFibs(candles: StructureCandle[]): DayFibMove[] {
  const ordered = [...candles].sort((first, second) => first.time - second.time);
  const candlesByDay = new Map<number, StructureCandle[]>();

  for (const candle of ordered) {
    const dayStart = nepalDayStartUtc(candle.time);
    if (candle.time < dayStart || candle.time >= dayStart + DAY_SECONDS) continue;
    const dayCandles = candlesByDay.get(dayStart) ?? [];
    dayCandles.push(candle);
    candlesByDay.set(dayStart, dayCandles);
  }

  const moves: DayFibMove[] = [];
  for (const [dayStart, dayCandles] of candlesByDay) {
    const sessionStart = dayStart + SESSION_START_SECONDS;
    const activation = dayCandles.find((candle) => candle.time === sessionStart);
    if (!activation) continue;

    let highCandle = dayCandles[0];
    let lowCandle = dayCandles[0];
    for (const candle of dayCandles) {
      if (candle.high > highCandle.high) highCandle = candle;
      if (candle.low < lowCandle.low) lowCandle = candle;
    }

    const latest = dayCandles[dayCandles.length - 1];
    const highDistance = highCandle.high - activation.open;
    const lowDistance = activation.open - lowCandle.low;
    const direction = latest.close > activation.open
      ? 'up'
      : latest.close < activation.open
        ? 'down'
        : highDistance >= lowDistance ? 'up' : 'down';
    const source = direction === 'up' ? lowCandle : highCandle;
    const zero = direction === 'up' ? highCandle : lowCandle;

    moves.push({
      sessionDate: nepalDateLabel(dayStart),
      direction,
      activationTime: activation.time,
      sourceTime: source.time,
      sourcePrice: direction === 'up' ? source.low : source.high,
      zeroTime: zero.time,
      zeroPrice: direction === 'up' ? zero.high : zero.low,
    });
  }

  return moves;
}
