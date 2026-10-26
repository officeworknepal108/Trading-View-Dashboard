import { TickMarkType, type Time } from 'lightweight-charts';

export type ChartTimeZone = 'Asia/Kathmandu' | 'Asia/Kolkata' | 'UTC';

// Reuse the ICU formatters while the chart pans and the crosshair moves.
// Cache formatters, not labels: every timestamp still gets formatted normally.
const timeFormatters = new Map<ChartTimeZone, Intl.DateTimeFormat>();
const tickFormatters = new Map<string, Intl.DateTimeFormat>();

function timeToDate(time: Time): Date {
  if (typeof time === 'number') return new Date(time * 1000);
  if (typeof time === 'string') return new Date(`${time}T00:00:00Z`);
  return new Date(Date.UTC(time.year, time.month - 1, time.day));
}

export function formatChartTime(time: Time, timeZone: ChartTimeZone): string {
  let formatter = timeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    timeFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(timeToDate(time));
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
  const key = `${timeZone}:${tickMarkType}`;
  let formatter = tickFormatters.get(key);
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = tickMarkType === TickMarkType.Year
      ? { year: 'numeric' }
      : tickMarkType === TickMarkType.Month
        ? { month: 'short' }
        : tickMarkType === TickMarkType.DayOfMonth
          ? { day: '2-digit', month: 'short' }
          : {
            hour: '2-digit',
            minute: '2-digit',
            second: tickMarkType === TickMarkType.TimeWithSeconds ? '2-digit' : undefined,
            hourCycle: 'h23',
          };
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, ...options });
    tickFormatters.set(key, formatter);
  }
  return formatter.format(timeToDate(time));
}
