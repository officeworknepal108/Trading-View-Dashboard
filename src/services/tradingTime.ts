export const NEPAL_TRADING_SESSIONS = [
  { startMinute: 5 * 60 + 45, endMinute: 8 * 60 + 15, label: '5:45 AM–8:15 AM' },
  { startMinute: 11 * 60 + 45, endMinute: 14 * 60 + 45, label: '11:45 AM–2:45 PM' },
  { startMinute: 17 * 60 + 45, endMinute: 20 * 60 + 45, label: '5:45 PM–8:45 PM' },
] as const;

const nepalClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kathmandu',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function nepalMinuteOfDay(epochSeconds: number): number {
  const parts = nepalClock.formatToParts(new Date(epochSeconds * 1000));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return hour * 60 + minute;
}

export function isNepalTradingTime(epochSeconds: number): boolean {
  if (!Number.isFinite(epochSeconds)) return false;
  const minute = nepalMinuteOfDay(epochSeconds);
  return NEPAL_TRADING_SESSIONS.some((session) => (
    minute >= session.startMinute && minute <= session.endMinute
  ));
}
