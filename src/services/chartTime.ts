import { TickMarkType, type Time } from 'lightweight-charts';

export type ChartTimeZone = 'Asia/Kathmandu' | 'UTC';

function timeToDate(time: Time): Date {
  if (typeof time === 'number') return new Date(time * 1000);
  if (typeof time === 'string') return new Date(`${time}T00:00:00Z`);
  return new Date(Date.UTC(time.year, time.month - 1, time.day));
}

export function formatChartTime(time: Time, timeZone: ChartTimeZone): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(timeToDate(time));
  const value = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ''
  );
  return `${value('weekday')} ${value('day')} ${value('month')} '${value('year')} ${value('hour')}:${value('minute')} ${value('dayPeriod')}`;
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
