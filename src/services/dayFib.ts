import type { StructureCandle } from './marketStructure';

const NEPAL_UTC_OFFSET_SECONDS = 5 * 3600 + 45 * 60;
const DAY_SECONDS = 24 * 3600;
const SESSION_START_SECONDS = 9 * 3600 + 15 * 60;

export interface DayFibMove {
  sessionDate: string;
  direction: 'up' | 'down';
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
 * Builds one FIB per Nepal calendar day. Level 1 is the 9:15 candle open and
 * level 0 follows the day's high when price finishes above that open, or the
 * day's low when it finishes below it. A completed day remains frozen.
 */
export function buildDayFibs(candles: StructureCandle[]): DayFibMove[] {
  const ordered = [...candles].sort((first, second) => first.time - second.time);
  const candlesByDay = new Map<number, StructureCandle[]>();

  for (const candle of ordered) {
    const dayStart = nepalDayStartUtc(candle.time);
    const sessionStart = dayStart + SESSION_START_SECONDS;
    if (candle.time < sessionStart || candle.time >= dayStart + DAY_SECONDS) continue;
    const sessionCandles = candlesByDay.get(dayStart) ?? [];
    sessionCandles.push(candle);
    candlesByDay.set(dayStart, sessionCandles);
  }

  const moves: DayFibMove[] = [];
  for (const [dayStart, sessionCandles] of candlesByDay) {
    const sessionStart = dayStart + SESSION_START_SECONDS;
    const source = sessionCandles.find((candle) => candle.time === sessionStart);
    if (!source) continue;

    let highCandle = source;
    let lowCandle = source;
    for (const candle of sessionCandles) {
      if (candle.high > highCandle.high) highCandle = candle;
      if (candle.low < lowCandle.low) lowCandle = candle;
    }

    const latest = sessionCandles[sessionCandles.length - 1];
    const highDistance = highCandle.high - source.open;
    const lowDistance = source.open - lowCandle.low;
    const direction = latest.close > source.open
      ? 'up'
      : latest.close < source.open
        ? 'down'
        : highDistance >= lowDistance ? 'up' : 'down';
    const extreme = direction === 'up' ? highCandle : lowCandle;

    moves.push({
      sessionDate: nepalDateLabel(dayStart),
      direction,
      sourceTime: source.time,
      sourcePrice: source.open,
      zeroTime: extreme.time,
      zeroPrice: direction === 'up' ? extreme.high : extreme.low,
    });
  }

  return moves;
}
