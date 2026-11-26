// Read-only regression against the frozen research universe. No server or trading calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { abhiScalpM15FibDecision } from '../src/services/abhiScalpM15Fib';
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const market = read('reports/scalp-obstacle-research-2026-11-26-market-data.json');
const research = read('reports/scalp-obstacle-research-2026-11-26-v2-rows.json').rows
  .filter((row: any) => row.style === 'SCALP_1_1');
const journals = [...read('data/trade-journal.json').trades, ...read('data/trade-journal.secondary.json').trades];
const mismatches: unknown[] = [];
const unavailable: string[] = [];
let blocked = 0, admitted = 0;
for (const row of research) {
  const candidates = journals.filter((record: any) => record.tradeStyle === 'SCALP_1_1'
    && record.scalpEntry?.version === 4 && record.scalpEntry.leg === 10
    && record.signalAt === row.signalAt && record.direction === row.direction);
  const record = candidates.find((r: any) => !r.mt5Managed && r.brokerTicket === undefined) ?? candidates[0];
  assert.ok(record, `Missing frozen setup metadata ${row.key}`);
  const decision = abhiScalpM15FibDecision({ ...record,
    direction: record.direction === 'bullish' ? 'BUY' : 'SELL' }, market.candles);
  const expected = row.results.skip_same_fib_tp.skipped ? 'blocked' : 'allowed';
  if (decision.status === 'unavailable') { unavailable.push(row.key); continue; }
  if (decision.status === 'blocked') blocked++;
  else admitted++;
  if (decision.status !== expected) mismatches.push({ key: row.key, expected, actual: decision.status });
}
const result = { reviewedSetups: research.length, blockedSetups: blocked,
  admittedSetups: admitted, unavailableForMissingHistory: unavailable, mismatches };
fs.writeFileSync('reports/abhi-m15-fib-implementation-audit-2026-11-26.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
assert.equal(research.length, 85);
assert.deepEqual(mismatches, []);
assert.equal(blocked, 25);
assert.deepEqual(unavailable, ['SCALP_1_1:1793224800:bearish']);
