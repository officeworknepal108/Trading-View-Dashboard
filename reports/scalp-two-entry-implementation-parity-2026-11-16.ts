import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scalpOneToOnePullbackSignals, scalpOneToOneChartRecords, scalpPullbackBarStates } from '../src/services/scalpOneToOne';
import { scalpPullbackSignalError } from '../src/services/mt5Automation';
import type { VolumeStudyRecord } from '../src/services/volumeEngulfingStudy';
import type { StructureCandle } from '../src/services/marketStructure';

// Read-only production adapters against archived offline evidence. No server/orders.
const read = (file: string) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const archive = read('volume-gap-study-2026-11-15.json');
const research = read('fixed-exit-two-pullbacks-2026-11-16.json');
const evidence = research.evidence['10/25'].cap_preserved;
const byTime = new Map<number, StructureCandle>();
for (const file of ['five-month-m15-history-older.json', 'five-month-m15-history-latest.json']) {
  for (const c of read(file)) if (!byTime.has(c.time) || c.complete !== false) byTime.set(c.time, c);
}
const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
const asOf = candles.at(-1)!.time + 900;
let checkedLegs = 0, checkedChartRows = 0, weightedLow = 0, weightedHigh = 0, chartRiskUnits = 0;
for (const expected of evidence) {
  const raw = archive.rows.find((r: any) => r.signalUTC === expected.signalUTC);
  assert.ok(raw);
  const record: VolumeStudyRecord = { ...raw, signal: raw.levels.signal, confirmedAt: raw.time + 900,
    bias: raw.direction, group: raw.type === 'T1' ? 'V2 < V1' : 'V3 < V2 only',
    v1: raw.volume1, v2: raw.volume2, v3: raw.volume3 };
  const signals = scalpOneToOnePullbackSignals(record, { M15: candles }, record.confirmedAt, 240);
  assert.equal(signals.length, 2);
  const next = byTime.get(record.confirmedAt)!;
  const states = scalpPullbackBarStates(next, signals);
  assert.ok(states.length);
  const chart = scalpOneToOneChartRecords(record, { M15: candles }, asOf);
  for (let i = 0; i < 2; i++) {
    const signal = signals[i], leg = expected.legs[i];
    assert.equal(scalpPullbackSignalError(signal), undefined);
    assert.ok(Math.abs(signal.entry - leg.entry) < 1e-7);
    assert.equal(signal.stopLoss, expected.stopLoss);
    assert.equal(signal.takeProfit, expected.takeProfit);
    assert.ok(Math.abs(signal.rewardRisk - leg.rewardRisk) < 1e-7);
    assert.equal(signal.scalpEntry!.riskShare, i === 0 ? 0.6 : 0.4);
    assert.equal(signal.expiresAt, record.confirmedAt + 900);
    checkedLegs++;
    const possibilities = new Set(expected.scenarios.map((s: any) => !(s.mask & (1 << i)) ? 'unfilled' : s.outcome));
    const shouldExist = possibilities.size === 1 && (possibilities.has('tp') || possibilities.has('sl') || possibilities.has('active'));
    const row = chart.find(r => r.scalpEntry?.leg === signal.scalpEntry!.leg);
    assert.equal(Boolean(row), shouldExist, `chart qualification ${expected.signalUTC}:P${signal.scalpEntry!.leg}`);
    if (row) {
      assert.equal(row.result, possibilities.has('active') ? 'open' : [...possibilities][0]);
      assert.equal(row.entry, signal.entry);
      checkedChartRows++;
      chartRiskUnits += (row.result === 'tp' ? row.rewardRisk : row.result === 'sl' ? -1 : 0) * signal.scalpEntry!.riskShare;
    }
  }
  const cashOutcomes = expected.scenarios.map((s: any) => signals.reduce((total, signal, i) => total
    + (!(s.mask & (1 << i)) ? 0 : 50 * signal.scalpEntry!.riskShare
      * (s.outcome === 'tp' ? signal.rewardRisk : s.outcome === 'sl' ? -1 : 0)), 0));
  weightedLow += Math.min(...cashOutcomes); weightedHigh += Math.max(...cashOutcomes);
}
assert.equal(evidence.length, 227); assert.equal(checkedLegs, 454);
assert.ok(Math.abs(weightedLow - 2257.20) < 0.005);
assert.ok(Math.abs(weightedHigh - 2403.20) < 0.005);
const result = { checkedSetups: evidence.length, checkedLegs, checkedChartRows,
  fixedRiskUSD: 50, allocationUSD: [30, 20], grossPnlRange: [weightedLow, weightedHigh],
  unambiguousChartRiskUnits: chartRiskUnits,
  message: 'All production entry prices, fixed exits, RR, risk shares, expiry and chart outcomes match archived research. Broker operations were not invoked.' };
fs.writeFileSync(new URL('scalp-two-entry-implementation-parity-2026-11-16.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
