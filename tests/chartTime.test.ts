import assert from 'node:assert/strict';
import test from 'node:test';
import { TickMarkType, type UTCTimestamp } from 'lightweight-charts';
import { formatChartTick, formatChartTime } from '../src/services/chartTime';

const timestamp = (Date.UTC(2026, 9, 2, 20, 0) / 1000) as UTCTimestamp;

test('chart time can be rendered in Nepal, Indian, or UTC time', () => {
  assert.equal(formatChartTime(timestamp, 'UTC'), "Fri 02 Oct '26 08:00 PM");
  assert.equal(formatChartTime(timestamp, 'Asia/Kathmandu'), "Sat 03 Oct '26 01:45 AM");
  assert.equal(formatChartTime(timestamp, 'Asia/Kolkata'), "Sat 03 Oct '26 01:30 AM");
});

test('chart tick formatter applies the selected timezone', () => {
  assert.equal(formatChartTick(timestamp, TickMarkType.Time, 'UTC'), '20:00');
  assert.equal(formatChartTick(timestamp, TickMarkType.Time, 'Asia/Kathmandu'), '01:45');
  assert.equal(formatChartTick(timestamp, TickMarkType.Time, 'Asia/Kolkata'), '01:30');
  assert.equal(formatChartTick(timestamp, TickMarkType.DayOfMonth, 'Asia/Kathmandu'), '03 Oct');
});

test('repeated chart movement keeps labels correct across tick types, dates and timezone switches', () => {
  const tickOptions = [
    [TickMarkType.Year, { year: 'numeric' }],
    [TickMarkType.Month, { month: 'short' }],
    [TickMarkType.DayOfMonth, { day: '2-digit', month: 'short' }],
    [TickMarkType.Time, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }],
    [TickMarkType.TimeWithSeconds, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }],
  ] as const;
  for (const offset of [0, 61, 86400, 86400 * 100, 0]) {
    const time = (timestamp + offset) as UTCTimestamp;
    for (const timeZone of ['UTC', 'Asia/Kathmandu', 'Asia/Kolkata', 'UTC'] as const) {
      for (const [tickType, options] of tickOptions) {
        assert.equal(formatChartTick(time, tickType, timeZone),
          new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(new Date(time * 1000)));
      }
    }
  }
  const nextDay = (timestamp + 86400) as UTCTimestamp;
  assert.equal(formatChartTime(nextDay, 'Asia/Kathmandu'), "Sun 04 Oct '26 01:45 AM");
  assert.equal(formatChartTime(timestamp, 'UTC'), "Fri 02 Oct '26 08:00 PM");
});
