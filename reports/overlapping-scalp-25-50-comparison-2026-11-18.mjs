// Offline research only. No order submission or live strategy configuration.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scalpPullbackBarStates } from '../src/services/scalpOneToOne.ts';
const candidatePair=process.argv.length>2?process.argv.slice(2).map(Number):[25,50];
assert.ok(candidatePair.length===2&&candidatePair.every(Number.isFinite)&&candidatePair[0]>0&&candidatePair[1]>candidatePair[0]);
const candidateLabel=`${candidatePair[0]}% / ${candidatePair[1]}%`;
const root=new URL('./',import.meta.url),stem=`overlapping-scalp-${candidatePair.join('-')}-comparison-2026-11-18`;
const read=name=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const archive=read('inside-mother-scalp-study-2026-11-18.json');
const overlap=read('overlapping-scalp-pullback-depth-2026-11-18.json');
const stamp=iso=>Date.parse(iso)/1000,asOf=stamp(archive.method.throughUTC);
const bars=new Map();
for(const name of ['five-month-m15-history-older.json','five-month-m15-history-latest.json','inside-mother-scalp-study-2026-11-18-M15.json'])
  for(const b of read(name))if(!bars.has(b.time)||b.complete!==false)bars.set(b.time,b);
function simulate(signals,start){
  if(!signals.length)return {outcome:'no-valid-entry',minimumR:0,maximumR:0,legs:[],scenarios:[]};
  let states=[{mask:0,exit:0}];
  const expiry=start+4500;
  for(let time=start;time+900<=asOf;time+=900){
    const bar=bars.get(time);
    if(!bar||bar.complete===false){states=states.map(s=>s.exit?s:{...s,exit:2});break;}
    const next=states.flatMap(previous=>previous.exit?[previous]:
      scalpPullbackBarStates(bar,signals,previous.mask,time<expiry).map(s=>({mask:s.mask,exit:s.exit})));
    states=[...new Map(next.map(s=>[`${s.mask}:${s.exit}`,s])).values()];
    if(states.every(s=>s.exit||!s.mask&&time+900>=expiry))break;
  }
  const legs=signals.map((signal,i)=>{
    const possibilities=[...new Set(states.map(s=>!(s.mask&(1<<i))?'not-filled':s.exit===1?'tp':s.exit===-1?'sl':s.exit===0?'active':'uncertain'))];
    return {...signal,outcome:possibilities.length===1?possibilities[0]:'uncertain',possibilities};
  });
  const outcomes=states.map(s=>!s.mask?'not-filled':s.exit===1?'tp':s.exit===-1?'sl':s.exit===0?'active':'uncertain');
  const outcome=new Set(outcomes).size===1?outcomes[0]:'uncertain';
  const pnl=states.map(s=>signals.reduce((sum,signal,i)=>{
    if(!(s.mask&(1<<i)))return sum;
    const rr=Math.abs(signal.takeProfit-signal.entry)/Math.abs(signal.entry-signal.stopLoss);
    return sum+(s.exit===1?signal.riskShare*rr:s.exit===-1?-signal.riskShare:0);
  },0));
  assert.ok(states.every(s=>!s.mask||[1,-1].includes(s.exit)), 'Comparison needs terminal outcomes for every potentially filled leg');
  return {outcome,minimumR:Math.min(...pnl),maximumR:Math.max(...pnl),legs,scenarios:states};
}
const rows=[];
for(const selected of overlap.rows){
  const saved=archive.rows.find(r=>r.signalUTC===selected.signalUTC);
  assert.ok(saved&&saved.legs.length===2);
  const time=stamp(saved.signalUTC),start=time+900,confirmation=bars.get(time),next=bars.get(start);
  const body=Math.abs(confirmation.close-confirmation.open),sign=saved.direction==='bullish'?1:-1;
  function signals(levels){
    return levels.flatMap((percent,i)=>{
      const entry=next.open-sign*body*percent/100,stopLoss=saved.legs[0].stopLoss,takeProfit=saved.legs[0].takeProfit;
      const risk=sign*(entry-stopLoss),reward=sign*(takeProfit-entry);
      if(!(risk>0&&risk<=30.000001&&reward>0))return [];
      return [{percent,entry,stopLoss,takeProfit,direction:sign===1?'BUY':'SELL',riskShare:i===0?.6:.4}];
    });
  }
  const baseline=simulate(signals([10,25]),start),candidate=simulate(signals(candidatePair),start);
  assert.equal(baseline.outcome,saved.outcome,'Replay must reproduce saved baseline setup outcome');
  for(const leg of baseline.legs){
    const original=saved.legs.find(l=>l.leg===leg.percent);
    assert.ok(Math.abs(original.entry-leg.entry)<1e-7);
    assert.equal(leg.outcome,original.outcome,'Replay must reproduce each baseline leg');
  }
  rows.push({signalUTC:saved.signalUTC,signalNepal:selected.signalNepal,direction:saved.direction,
    confirmationBody:body,nextOpen:next.open,baseline,candidate,
    minimumDeltaR:candidate.minimumR-baseline.maximumR,maximumDeltaR:candidate.maximumR-baseline.minimumR});
}
function summarize(field){
  const group=rows.map(r=>r[field]),legs=group.flatMap(r=>r.legs);
  return {setups:group.length,setupOutcomes:Object.fromEntries(['tp','sl','not-filled','uncertain','active','no-valid-entry'].map(o=>[o,group.filter(r=>r.outcome===o).length])),
    legs:legs.length,legOutcomes:Object.fromEntries(['tp','sl','not-filled','uncertain','active'].map(o=>[o,legs.filter(r=>r.outcome===o).length])),
    minimumR:group.reduce((s,r)=>s+r.minimumR,0),maximumR:group.reduce((s,r)=>s+r.maximumR,0),
    fullRiskStopLossSetups:group.filter(r=>r.outcome==='sl'&&Math.abs(r.minimumR+1)<1e-7).length};
}
const baseline=summarize('baseline'),candidate=summarize('candidate');
const delta={minimumR:candidate.minimumR-baseline.maximumR,maximumR:candidate.maximumR-baseline.minimumR,
  improved:rows.filter(r=>r.minimumDeltaR>1e-8).length,worse:rows.filter(r=>r.maximumDeltaR< -1e-8).length,
  unchanged:rows.filter(r=>Math.abs(r.minimumDeltaR)<1e-8&&Math.abs(r.maximumDeltaR)<1e-8).length,
  missedBaselineTp:rows.filter(r=>r.baseline.outcome==='tp'&&r.candidate.outcome==='not-filled').length};
const method={
 period:archive.method,
 scope:'Paired counterfactual on the same 34 baseline-identified overlapping later setups, including 2 originally unfilled setups. All 34 had a same-direction earlier trade open by the strict known-fill/known-exit rule. All other setups are outside this paired comparison.',
 entries:`Baseline 10%/25%, candidate ${candidateLabel} of later setup final confirmation body, measured from immediate next M15 open. Risk weights stay 60% first leg / 40% second; unused allocation is not transferred.`,
 exits:'Original common stop and target remain fixed. 75-minute limit-entry window, cancellation at original exit, maximum entry-to-stop 30 price units. Outcome paths replayed with production scalpPullbackBarStates over continuous completed M15 candles.',
 accounting:'1R is one fixed full-setup cash-risk allowance. Filled positions sized to their own entry-to-stop distance; TP earns risk share times actual entry-to-fixed-target RR, SL loses its risk share. No compounding, fees, spread, slippage, lot rounding, margin or daily risk restrictions.',
 selection:'Overlap membership is held fixed from the baseline study, not dynamically recomputed under the candidate. A complete conditional portfolio replay must check whether altered fill times change which future signals count as overlapping. Same-exit-bar timing and uncertain earlier trades were excluded from the original cohort.',
 uncertainty:'Enumerates OHLC-consistent paths; reports min/max gross R when fill order is ambiguous. No assumption that high or low happened first.',
 interpretation:'In-sample comparison selected after observing these data; not evidence of future or cost-adjusted profitability. Trading code/settings remain unchanged.'
};
const auditGroups=[
  ['Both proposed entries filled and won',rows.filter(r=>r.candidate.legs.every(l=>l.outcome==='tp'))],
  [`Only proposed ${candidatePair[0]}% entry filled and won`,rows.filter(r=>r.candidate.outcome==='tp'&&r.candidate.legs[1].outcome==='not-filled')],
  ['Original winner entirely missed',rows.filter(r=>r.baseline.outcome==='tp'&&r.candidate.outcome==='not-filled')],
  ['Both variants stopped out',rows.filter(r=>r.baseline.outcome==='sl')],
  ['Both variants unfilled',rows.filter(r=>r.baseline.outcome==='not-filled')],
].map(([name,group])=>{
  const baselineR=group.reduce((s,r)=>s+r.baseline.minimumR,0),candidateR=group.reduce((s,r)=>s+r.candidate.minimumR,0);
  return {name,setups:group.length,baselineR,candidateR,deltaR:candidateR-baselineR,
    baselineUSD50:baselineR*50,candidateUSD50:candidateR*50,deltaUSD50:(candidateR-baselineR)*50};
});
assert.equal(auditGroups.reduce((s,g)=>s+g.setups,0),rows.length);
assert.ok(Math.abs(auditGroups.reduce((s,g)=>s+g.deltaR,0)-delta.minimumR)<1e-8);
const example=rows.find(r=>r.signalNepal==='2026-10-22 14:30');
const rrExample={signalNepal:example.signalNepal,variants:Object.fromEntries(['baseline','candidate'].map(field=>[field,
  example[field].legs.map(l=>({...l,actualRR:Math.abs(l.takeProfit-l.entry)/Math.abs(l.entry-l.stopLoss),
    cashRiskUSD50:50*l.riskShare,tpProfitUSD50:50*l.riskShare*Math.abs(l.takeProfit-l.entry)/Math.abs(l.entry-l.stopLoss)}))]))};
fs.writeFileSync(new URL(`${stem}.json`,root),JSON.stringify({method,baseline,candidate,delta,rrAudit:{auditGroups,rrExample},rows},null,2)+'\n');
const columns=['signalNepal','direction','baselineOutcome','candidateOutcome','baselineMinR','baselineMaxR','candidateMinR','candidateMaxR','minimumDeltaR','maximumDeltaR'];
const csvRows=rows.map(r=>({...r,baselineOutcome:r.baseline.outcome,candidateOutcome:r.candidate.outcome,
  baselineMinR:r.baseline.minimumR,baselineMaxR:r.baseline.maximumR,candidateMinR:r.candidate.minimumR,candidateMaxR:r.candidate.maximumR}));
fs.writeFileSync(new URL(`${stem}.csv`,root),[columns.join(','),...csvRows.map(r=>columns.map(k=>r[k]).join(','))].join('\n')+'\n');
const f=n=>n.toFixed(4);
const md=`# Overlapping Scalp 1:1: 10% / 25% versus ${candidateLabel} entries\n\nPaired comparison on 34 baseline overlapping setups, 3 August–18 November 2026 through 07:45 Nepal. All other trades retain existing settings in the proposed scope; their results are not included in this table.\n\n| Measure | Current 10% / 25% | Proposed ${candidateLabel} |\n|---|---:|---:|\n| TP setups | ${baseline.setupOutcomes.tp} | ${candidate.setupOutcomes.tp} |\n| SL setups | ${baseline.setupOutcomes.sl} | ${candidate.setupOutcomes.sl} |\n| Unfilled setups | ${baseline.setupOutcomes['not-filled']} | ${candidate.setupOutcomes['not-filled']} |\n| Uncertain setups | ${baseline.setupOutcomes.uncertain} | ${candidate.setupOutcomes.uncertain} |\n| TP legs | ${baseline.legOutcomes.tp} | ${candidate.legOutcomes.tp} |\n| SL legs | ${baseline.legOutcomes.sl} | ${candidate.legOutcomes.sl} |\n| Gross R | ${f(baseline.minimumR)} to ${f(baseline.maximumR)} | ${f(candidate.minimumR)} to ${f(candidate.maximumR)} |\n\nCandidate gross delta: ${f(delta.minimumR)} to ${f(delta.maximumR)}R. ${delta.missedBaselineTp} baseline winners become entirely unfilled. Improved setups: ${delta.improved}; worse: ${delta.worse}; unchanged: ${delta.unchanged}.\n\n## Method and limits\n\n${Object.entries(method).filter(([k])=>k!=='period').map(([k,v])=>`- **${k}:** ${v}`).join('\n')}\n\nHypothetical historical performance does not reflect actual executions; see [SEC investor bulletin](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins-47).\n\nValidation: every baseline setup and leg outcome and entry price reproduced from archived evidence. Production path enumeration reused for both variants. Setup-level details in [CSV](${stem}.csv) and [JSON](${stem}.json).\n`;
fs.writeFileSync(new URL(`${stem}.md`,root),md);
const auditMd=`\n## Higher-RR and cash-profit audit\n\nEach TP leg uses its actual entry-to-target distance divided by entry-to-stop distance. Deeper entries therefore earn a higher RR when filled; position size increases to keep that leg's allocated dollar risk constant. No winning leg is assigned a flat 1R.\n\nFixed $50 total setup risk ($30 first entry, $20 second), no costs or compounding:\n\n| Group | Setups | Current gross PnL | Proposed gross PnL | Difference |\n|---|---:|---:|---:|---:|\n${auditGroups.map(g=>`| ${g.name} | ${g.setups} | $${g.baselineUSD50.toFixed(2)} | $${g.candidateUSD50.toFixed(2)} | $${g.deltaUSD50.toFixed(2)} |`).join('\n')}\n\nExample: 22 October 2026 14:30 Nepal SELL. Same stop 4097.02, target 4069.26.\n\n| Variant | Pullback | Entry | Actual RR | Allocated risk | TP profit |\n|---|---:|---:|---:|---:|---:|\n${Object.entries(rrExample.variants).flatMap(([name,legs])=>legs.map(l=>`| ${name} | ${l.percent}% | ${l.entry.toFixed(5)} | 1:${l.actualRR.toFixed(4)} | $${l.cashRiskUSD50.toFixed(2)} | $${l.tpProfitUSD50.toFixed(2)} |`)).join('\n')}\n\nOverall gross PnL at $50 setup risk: $${(baseline.minimumR*50).toFixed(2)} versus $${(candidate.minimumR*50).toFixed(2)}. Change: $${(delta.minimumR*50).toFixed(2)} using unrounded values. Rounded component amounts can differ by one cent when added.\n`;
fs.appendFileSync(new URL(`${stem}.md`,root),auditMd);
console.log(JSON.stringify({baseline,candidate,delta},null,2));
