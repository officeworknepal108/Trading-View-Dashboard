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
