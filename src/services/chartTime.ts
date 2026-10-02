import { TickMarkType, type Time } from 'lightweight-charts';

export type ChartTimeZone = 'Asia/Kathmandu' | 'UTC';

function timeToDate(time: Time): Date {
  if (typeof time === 'number') return new Date(time * 1000);
  if (typeof time === 'string') return new Date(`${time}T00:00:00Z`);
  return new Date(Date.UTC(time.year, time.month - 1, time.day));
}

export function formatChartTime(time: Time, timeZone: ChartTimeZone): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(timeToDate(time)).replace(',', '');
}

export function formatChartTick(
  time: Time,
  tickMarkType: TickMarkType,
  timeZone: ChartTimeZone,
): string {
  const date = timeToDate(time);
  if (tickMarkType === TickMarkType.Year) {
    return new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }).format(date);
  }
  if (tickMarkType === TickMarkType.Month) {
    return new Intl.DateTimeFormat('en-GB', { timeZone, month: 'short' }).format(date);
  }
  if (tickMarkType === TickMarkType.DayOfMonth) {
    return new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: 'short' }).format(date);
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: tickMarkType === TickMarkType.TimeWithSeconds ? '2-digit' : undefined,
    hourCycle: 'h23',
  }).format(date);
}
