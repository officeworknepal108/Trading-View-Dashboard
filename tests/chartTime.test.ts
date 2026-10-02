import assert from 'node:assert/strict';
import test from 'node:test';
import { TickMarkType, type UTCTimestamp } from 'lightweight-charts';
import { formatChartTick, formatChartTime } from '../src/services/chartTime';

const timestamp = (Date.UTC(2026, 9, 2, 20, 0) / 1000) as UTCTimestamp;

test('chart time can be rendered in Nepal time or UTC', () => {
  assert.equal(formatChartTime(timestamp, 'UTC'), '02/10/2026 20:00');
  assert.equal(formatChartTime(timestamp, 'Asia/Kathmandu'), '03/10/2026 01:45');
});

test('chart tick formatter applies the selected timezone', () => {
  assert.equal(formatChartTick(timestamp, TickMarkType.Time, 'UTC'), '20:00');
  assert.equal(formatChartTick(timestamp, TickMarkType.Time, 'Asia/Kathmandu'), '01:45');
  assert.equal(formatChartTick(timestamp, TickMarkType.DayOfMonth, 'Asia/Kathmandu'), '03 Oct');
});
