// Run the production qualifier/adapter on an actual demo price snapshot; never enqueue.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {runVolumeStudy} from '../src/services/volumeEngulfingStudy';
import {buildScalpOneToOneSignals,scalpOneToOnePullbackSignals} from '../src/services/scalpOneToOne';
import {scalpPullbackSignalError} from '../src/services/mt5Automation';
const root=new URL('./',import.meta.url);
const snapshot=JSON.parse(fs.readFileSync(new URL('abhi-demo-market-snapshot-2026-11-21.json',root),'utf8'));
assert.equal(snapshot.demoVerified,true);
const now=Math.floor(Date.now()/1000);
const current=buildScalpOneToOneSignals(snapshot.candles,now,60,120);
const study=runVolumeStudy({symbol:'XAUUSD',timeframe:'M15',biasTimeframe:'H4',h4EmaFilter:true,h1TrendlineFilter:true,
  cutoff:now,lookback:5000,candles:snapshot.candles});
const pairs=study.records.map(r=>scalpOneToOnePullbackSignals(r,snapshot.candles,r.confirmedAt,60)).filter(p=>p.length===2).slice(-5);
assert.ok(pairs.length>0,'Need real historical demo setups for sizing verification');
for(const pair of pairs){
  assert.deepEqual(pair.map(s=>s.scalpEntry!.riskShare),[.4,.6]);
  for(const signal of pair)assert.equal(scalpPullbackSignalError(signal),undefined);
}
const result={demoVerified:true,newEligiblePairsNow:current.length/2,qualifyingHistoricalRecords:study.records.length,
  historicalSamplePairs:pairs,source:'Actual demo XAUUSDm M15/H1/H4 prices; no execution requests'};
fs.writeFileSync(new URL('abhi-demo-plans-2026-11-21.json',root),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({newEligiblePairsNow:result.newEligiblePairsNow,qualifyingHistoricalRecords:result.qualifyingHistoricalRecords,historicalPairs:pairs.length}));
