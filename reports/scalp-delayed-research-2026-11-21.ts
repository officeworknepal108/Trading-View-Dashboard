// Offline causal delayed-entry research. No trading/settings APIs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {replay,setups,cutoff,bars,type Spec} from './scalp-validation-model-2026-11-20';
const root=new URL('./',import.meta.url),stem='scalp-delayed-research-2026-11-21';
const read=(n:string)=>JSON.parse(fs.readFileSync(new URL(n,root),'utf8'));
const fresh=read('scalp-selected-rule-validation-2026-11-20-fresh-qualified-setups.json');
const broad=read('scalp-broader-research-2026-11-21.json');
const features=new Map<string,any>(broad.features.map((r:any)=>[r.signalUTC,r]));
const byTime=new Map<number,any>(bars.map(b=>[b.time,b]));
for(const b of read('scalp-fresh-data-2026-11-20-M15.json'))if(!byTime.has(b.time)&&b.complete!==false)byTime.set(b.time,b);
const m1=read('scalp-fresh-data-2026-11-20-M1.json').filter((b:any)=>b.complete!==false);
const execution={bars:m1,index:new Map<number,number>(m1.map((b:any,i:number)=>[b.time,i])),seconds:60};
const oct=Date.parse('2026-10-01T00:00:00Z')/1000,nov=Date.parse('2026-11-01T00:00:00Z')/1000;
type Row=ReturnType<typeof replay>;
type Policy={id:number;delay:number;target:number;originalTarget:boolean;second:number;share:number;gate:'any'|'same-direction';filter:boolean};
const policies:Policy[]=[];
for(const delay of [0,15,30])for(const target of [0,1,1.25,1.5,2])for(const second of [0,10])for(const share of [.3,.5])for(const gate of ['any','same-direction'] as const)for(const filter of [false,true])policies.push({id:policies.length,delay,target:target===0?1.25:target,originalTarget:target===0,second,share,gate,filter});
function transform(r:any,p:Policy){
  const confirmed=r.confirmed+p.delay*60,bar=byTime.get(confirmed);
  let missing=r.missing||!bar;
  const oldRisk=Math.abs(r.reference-r.stop),guard=r.reference+r.sign*oldRisk*1.25;
  // A boundary touched during the wait cancels the setup, before any order exists.
  for(let t=r.confirmed;t<confirmed;t+=900){
    const b=byTime.get(t);
    if(!b||b.complete===false){missing=true;break;}
    assert.ok(b.time+900<=confirmed);
    if(r.sign===1?(b.low<=r.stop||b.high>=guard):(b.high>=r.stop||b.low<=guard)){missing=true;break;}
  }
  if(p.gate==='same-direction'&&p.delay>0){
    const b=byTime.get(confirmed-900);
    if(!b||r.sign*(b.close-b.open)<=0)missing=true;
  }
  const reference=p.delay===0?r.reference:bar?.open;
  const risk=r.sign*(reference-r.stop);
  if(!Number.isFinite(risk)||risk<=0)missing=true;
  const factor=p.originalTarget?r.sign*(guard-reference)/risk:p.target;
  if(!Number.isFinite(factor)||factor<=0)missing=true;
  const target=reference+r.sign*risk*factor;
  if(!missing&&p.originalTarget)assert.ok(Math.abs(target-guard)<1e-7);
  const spec:Spec={profile:{name:'delayed study',first:0,second:p.second,share:p.share,expiry:30},targets:[factor,factor],cancel:'new-target'};
  return {changed:{...r,confirmed,reference,missing,target},spec,originalConfirmed:r.confirmed};
}
function summarize(rows:any[],broker=false,price=0){
  let net=0,closed=0,wins=0,losses=0,unknown=0,invalid=0,unfilled=0,open=0,noSize=0,fees=0;
  const cash=new Map<number,number>();
  for(const r of rows){
    let legs=r.legs,outcome=r.outcome;
    if(broker){
      const fits=(l:any,share=l.share)=>l&&Math.floor((50*share/(l.risk*100)+1e-12)/.01)*.01>=.01-1e-10;
      if(legs.length!==2||!legs.every((l:any)=>fits(l))){const second=legs.find((l:any)=>l.slot===1);if(!second||!fits(second,1)){noSize++;continue;}legs=[{...second,share:1}];outcome=second.outcome;}
    }
    if(outcome==='uncertain'){unknown++;continue;}
    if(outcome==='no-valid-entry'){invalid++;continue;}
    if(outcome==='not-filled'){unfilled++;continue;}
    if(['open','pending'].includes(outcome)){open++;continue;}
    if(!['tp','sl','mixed'].includes(outcome))throw new Error('Unexpected outcome');
    let pnl=0,budget=0;
    for(const l of legs){
      const lot=broker?Math.floor((50*l.share/(l.risk*100)+1e-12)/.01)*.01:50*l.share/(l.risk*100);
      budget+=lot*100*l.risk;
      if(!['tp','sl'].includes(l.outcome))continue;
      const cost=price>0?lot*(price*100+7):0;
      const value=lot*100*l.risk*(l.outcome==='tp'?l.rr:-1)-cost;
      assert.ok(l.closedAt);cash.set(l.closedAt,(cash.get(l.closedAt)||0)+value);pnl+=value;fees+=cost;
    }
    assert.ok(budget<=50+1e-7);closed++;net+=pnl;if(pnl>1e-8)wins++;else if(pnl< -1e-8)losses++;
  }
  let balance=0,peak=0,drawdown=0;
  for(const [t,pnl] of [...cash].sort((a,b)=>a[0]-b[0])){balance+=pnl;peak=Math.max(peak,balance);drawdown=Math.max(drawdown,peak-balance);}
  assert.ok(Math.abs(balance-net)<1e-6);assert.equal(rows.length,closed+unknown+invalid+unfilled+open+noSize);
  return {setups:rows.length,closed,wins,losses,winPercent:closed?wins/closed*100:0,netDollars:net,returnPercent:net/50,drawdown,uncertain:unknown,invalid,unfilled,open,noSize,fees};
}
const cache=new Map<string,any>(),grid:any[]=[];
console.log(JSON.stringify({phase:'Frozen timing grid',policies:policies.length,selection:'Max training net minus half drawdown. Min40 resolved and min12 per training month; at least45% wins. No selection based on future outcomes; all dates nevertheless reused from prior research.'}));
for(const p of policies){
  const key=JSON.stringify({...p,id:0,filter:false});
  if(!cache.has(key)){
    const run=(input:any[],until:number,exec?:any)=>input.map(r=>{const t=transform(r,p);return {...replay(t.changed,t.spec,until,exec),originalConfirmed:t.originalConfirmed};});
    cache.set(key,{history:run(setups,cutoff),train1:run(setups,oct),train2:run(setups,nov),recent:run(fresh.setups,fresh.to,execution)});
  }
  const c=cache.get(key),filter=(a:any[])=>a.filter(r=>!p.filter||features.get(r.signalUTC).bodyFraction>=.3);
  const history=filter(c.history),recent=filter(c.recent),rows=[...history,...recent];
  const train=(source:any[],boundary:number,broker=false)=>{
    const rows=filter(source.filter(r=>r.originalConfirmed<boundary)),s=summarize(rows,broker,broker?.2:0);
    const months=[...new Set(rows.map(r=>r.signalUTC.slice(0,7)))];
    const minMonthlyClosed=months.length?Math.min(...months.map(m=>summarize(rows.filter(r=>r.signalUTC.startsWith(m)),broker,broker?.2:0).closed)):0;
    return {...s,minMonthlyClosed};
  };
  grid.push({id:p.id,policy:p,training:train(c.train1,oct),training2:train(c.train2,nov),costTraining:train(c.train1,oct,true),costTraining2:train(c.train2,nov,true),overall:summarize(rows),costOverall:summarize(rows,true,.2),fresh:summarize(recent)});
  if(p.id%100===0)console.log(`Evaluated ${p.id+1}/${policies.length}`);
}
const baselineId=policies.find(p=>p.delay===0&&!p.originalTarget&&p.target===1.25&&p.second===10&&p.share===.3&&p.gate==='any'&&!p.filter)!.id;
const base=grid[baselineId];
assert.equal(policies.length,240);assert.equal(base.overall.wins,119);assert.equal(base.overall.losses,87);assert.ok(Math.abs(base.overall.netDollars-3186.20015817005)<1e-6);
const choose=(key:string)=>[...grid].filter(r=>r[key].closed>=40&&r[key].minMonthlyClosed>=12&&r[key].winPercent>=45).sort((a,b)=>(b[key].netDollars-.5*b[key].drawdown)-(a[key].netDollars-.5*a[key].drawdown))[0];
const octPick=choose('training'),novPick=choose('training2'),costOctPick=choose('costTraining'),costNovPick=choose('costTraining2');
const best=[...grid].filter(r=>r.overall.closed>=100&&r.training.minMonthlyClosed>=12).sort((a,b)=>b.overall.netDollars-a.overall.netDollars)[0];
const bestCost=[...grid].filter(r=>r.costOverall.closed>=100&&r.costTraining.minMonthlyClosed>=12).sort((a,b)=>b.costOverall.netDollars-a.costOverall.netDollars)[0];
const balanced=[...grid].filter(r=>r.overall.closed>=100&&r.overall.winPercent>=base.overall.winPercent&&r.overall.drawdown<=base.overall.drawdown).sort((a,b)=>b.overall.netDollars-a.overall.netDollars)[0];
const ids=[...new Set([baselineId,octPick.id,novPick.id,costOctPick.id,costNovPick.id,best.id,bestCost.id,balanced.id])];
const selected=ids.map(id=>{
  const g=grid[id],p=g.policy,c=cache.get(JSON.stringify({...p,id:0,filter:false}));
  const rows=[...c.history,...c.recent].filter((r:any)=>!p.filter||features.get(r.signalUTC).bodyFraction>=.3);
  const monthly=Object.fromEntries(['2026-08','2026-09','2026-10','2026-11'].map(m=>[m,summarize(rows.filter((r:any)=>r.signalUTC.startsWith(m)))]));
  const costMonthly=Object.fromEntries(Object.keys(monthly).map(m=>[m,summarize(rows.filter((r:any)=>r.signalUTC.startsWith(m)),true,.2)]));
  assert.ok(Math.abs(Object.values(monthly).reduce((a,s)=>a+s.netDollars,0)-g.overall.netDollars)<1e-6);
  return {...g,roles:[id===baselineId?'baseline':'',id===best.id?'highest-ideal-hindsight':'',id===bestCost.id?'highest-cost-adjusted-hindsight':'',id===balanced.id?'max-profit-with-baseline-win-and-DD-hindsight':'',id===octPick.id?'selected-October':'',id===novPick.id?'selected-November':'',id===costOctPick.id?'cost-selected-October':'',id===costNovPick.id?'cost-selected-November':''].filter(Boolean),monthly,costMonthly,costStress:summarize(rows,true,.5),rows};
});
const month=(id:number,month:'oct'|'nov',broker=false)=>{
  const p=policies[id],c=cache.get(JSON.stringify({...p,id:0,filter:false}));
  const rows=(month==='oct'?c.train2.filter((r:any)=>r.originalConfirmed>=oct&&r.originalConfirmed<nov):c.history.filter((r:any)=>r.originalConfirmed>=nov)).filter((r:any)=>!p.filter||features.get(r.signalUTC).bodyFraction>=.3);
  return summarize(rows,broker,broker?.2:0);
};
const walkForward={ideal:{october:month(octPick.id,'oct'),november:month(novPick.id,'nov'),baselineOctober:month(baselineId,'oct'),baselineNovember:month(baselineId,'nov')},cost:{october:month(costOctPick.id,'oct',true),november:month(costNovPick.id,'nov',true),baselineOctober:month(baselineId,'oct',true),baselineNovember:month(baselineId,'nov',true)}};
fs.writeFileSync(new URL(stem+'.json',root),JSON.stringify({method:{risk:50,balance:5000,policies:policies.length,rules:'Same original qualifications and original SL. Wait 0,15,30min. Cancel if original SL or original-reference1.25R touched during wait, or wait has a history gap. At delayed decision use that M15 open as reference; zero-delay control retains original reference. Optional same-direction preceding closed candle gate. First at reference, second at 0/10% original confirmation body. Pending entries expire 30min after delayed decision, not original confirmation. TP either original-reference1.25R unchanged or new-reference risk multiple1/1.25/1.5/2. Both directions. No BE or compounding.',limitations:'All data reused; hindsight winners labeled. Same OHLC/path-uncertainty engine, M15 history and formerly fresh M1. Exclude unresolved. DD excludes floating losses. No daily/concurrent risk limits or margin. Execution at candle open is idealized, not a guaranteed market fill.',costs:'Historical contract100oz, min/step.01, floor lots, second-only fallback when split fails. .20/.50 total gold price-unit cost plus $7/lot illustrative round trip. No observed current costs, tick rounding, executable bid/ask or broker-fill validation.'},baselineId,walkForward,selected,grid})+'\n');
console.log(JSON.stringify({baselineId,walkForward,selected:selected.map(({rows,...r})=>r)},null,2));
