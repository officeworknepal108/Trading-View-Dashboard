import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scalpOneToOneVolumePasses } from '../src/services/mt5Automation';
import { scalpOneToOneChartRecord } from '../src/services/scalpOneToOne';

const study = JSON.parse(fs.readFileSync(new URL('volume-gap-study-2026-11-15.json', import.meta.url), 'utf8'));
const chartRows = [];
let accepted = 0;
for (const row of study.rows) {
  const passes = scalpOneToOneVolumePasses(row.type, row.volume1, row.volume2, row.volume3);
  assert.equal(passes, row.gap >= 250, `threshold parity ${row.time}`);
  if (passes) accepted++;
  const chart = scalpOneToOneChartRecord({ ...row, signal: row.levels.signal,
    confirmedAt: row.levels.calculatedAt, bias: row.direction,
    v1: row.volume1, v2: row.volume2, v3: row.volume3,
    group: row.type === 'T1' ? 'V2 < V1' : 'V3 < V2 only' });
  const expected = passes && row.filledAt !== undefined && ['active', 'tp', 'sl'].includes(row.outcome);
  assert.equal(Boolean(chart), expected, `chart parity ${row.time}`);
  if (chart) chartRows.push(chart);
}
const result = { checked: study.rows.length, accepted, rejected: study.rows.length - accepted,
  chartRows: chartRows.length, tp: chartRows.filter(row => row.result === 'tp').length,
  sl: chartRows.filter(row => row.result === 'sl').length };
assert.equal(result.accepted, 227);
assert.equal(result.tp, 131); assert.equal(result.sl, 88);
fs.writeFileSync(new URL('volume-gap-implementation-parity-2026-11-15.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
