// Offline two-limit-entry research. Protected trading code stays unchanged.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {replay,setups,cutoff,type Spec} from './scalp-validation-model-2026-11-20';
const root=new URL('./',import.meta.url),stem='scalp-two-pullback-research-2026-11-21';
const read=(n:string)=>JSON.parse(fs.readFileSync(new URL(n,root),'utf8'));
const features=new Map<string,any>(read('scalp-broader-research-2026-11-21.json').features.map((r:any)=>[r.signalUTC,r]));
const fresh=read('scalp-selected-rule-validation-2026-11-20-fresh-qualified-setups.json');
const m1=read('scalp-fresh-data-2026-11-20-M1.json').filter((b:any)=>b.complete!==false);
const execution={bars:m1,index:new Map<number,number>(m1.map((b:any,i:number)=>[b.time,i])),seconds:60};
const oct=Date.parse('2026-10-01T00:00:00Z')/1000,nov=Date.parse('2026-11-01T00:00:00Z')/1000;
type Row=ReturnType<typeof replay>;
type Policy={id:number;unit:'body'|'reference-risk';first:number;second:number;share:number;expiry:number;target:'common-reference-1.25R'|'each-entry-exact-1.25R';benchmark?:boolean};
const policies:Policy[]=[];
for(const unit of ['body','reference-risk'] as const){
  const pairs=unit==='body'?[[.1,.25],[.2,.4],[.25,.5],[.3,.6],[.4,.7]]:[[.05,.15],[.1,.25],[.2,.4],[.25,.5],[.3,.5]];
  for(const [first,second] of pairs)for(const share of [.3,.5])for(const expiry of [30,60,75])for(const target of ['common-reference-1.25R','each-entry-exact-1.25R'] as const)policies.push({id:policies.length,unit,first,second,share,expiry,target});
}
policies.push({id:policies.length,unit:'body',first:0,second:.1,share:.3,expiry:30,target:'common-reference-1.25R',benchmark:true});
function plan(r:any,p:Policy){
  const originalRisk=Math.abs(r.reference-r.stop),unit=p.unit==='body'?r.body:originalRisk;
  const distances=[p.first,p.second].map(v=>v*unit);
  const entries=distances.map(d=>r.reference-r.sign*d);
  const risks=distances.map(d=>originalRisk-d);
  const targets=entries.map((entry,i)=>p.target==='common-reference-1.25R'?r.reference+r.sign*originalRisk*1.25:entry+r.sign*risks[i]*1.25);
  const valid=!r.missing&&r.body>0&&risks.every(v=>Number.isFinite(v)&&v>0&&v<=30.000001)&&targets.every((t,i)=>r.sign*(t-entries[i])>0);
  if(valid){
    assert.ok(entries[0]!==entries[1]);
    if(!p.benchmark){assert.ok(r.sign*(r.reference-entries[0])>0);assert.ok(risks[0]<originalRisk);assert.ok(risks[1]<risks[0]);}
    if(p.target==='each-entry-exact-1.25R')targets.forEach((t,i)=>assert.ok(Math.abs(r.sign*(t-entries[i])/risks[i]-1.25)<1e-7));
  }
  const factors=targets.map(t=>r.sign*(t-r.reference)/originalRisk) as [number,number];
  const percents=distances.map(d=>d/r.body*100);
  const spec:Spec={profile:{name:'two real pullbacks',first:percents[0],second:percents[1],share:p.share,expiry:p.expiry},targets:factors,cancel:'new-target'};
  return {changed:{...r,missing:!valid},spec,entries,risks,targets,originalRisk};
}
function metrics(rows:Row[],strictLots=false,price=0){
  let closed=0,wins=0,losses=0,net=0,fees=0,noSize=0,invalid=0,uncertain=0,unfilled=0,open=0,bothFilled=0,firstFilled=0,secondFilled=0;
  const cash=new Map<number,number>();
  for(const r of rows){
    const legs=r.legs;
    // Two orders are required: never replace the split with a single-entry fallback.
    const sizes=legs.map(l=>Math.floor((50*l.share/(l.risk*100)+1e-12)/.01)*.01);
    if(strictLots&&(legs.length!==2||sizes.some(lot=>lot<.01-1e-10))){noSize++;continue;}
    firstFilled+=Number(legs.find(l=>l.slot===0)?.fillState==='filled');
    secondFilled+=Number(legs.find(l=>l.slot===1)?.fillState==='filled');
    bothFilled+=Number(legs.length===2&&legs.every(l=>l.fillState==='filled'));
    if(r.outcome==='no-valid-entry'){invalid++;continue;}
    if(r.outcome==='uncertain'){uncertain++;continue;}
    if(r.outcome==='not-filled'){unfilled++;continue;}
    if(['open','pending'].includes(r.outcome)){open++;continue;}
    assert.ok(['tp','sl','mixed'].includes(r.outcome));
    let pnl=0,budget=0;
    legs.forEach((l,i)=>{
      const lot=strictLots?sizes[i]:50*l.share/(l.risk*100);
      budget+=lot*100*l.risk;
      if(!['tp','sl'].includes(l.outcome))return;
      const fee=price>0?lot*(price*100+7):0,value=lot*100*l.risk*(l.outcome==='tp'?l.rr:-1)-fee;
      pnl+=value;fees+=fee;assert.ok(l.closedAt);cash.set(l.closedAt!,(cash.get(l.closedAt!)||0)+value);
    });
    assert.ok(budget<=50+1e-7);closed++;net+=pnl;wins+=Number(pnl>1e-8);losses+=Number(pnl< -1e-8);
  }
  let equity=0,peak=0,dd=0;
  for(const [t,value] of [...cash].sort((a,b)=>a[0]-b[0])){equity+=value;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}
  assert.ok(Math.abs(equity-net)<1e-6);assert.equal(rows.length,closed+invalid+uncertain+unfilled+open+noSize);
  return {setups:rows.length,closed,wins,losses,winPercent:closed?wins/closed*100:0,netDollars:net,returnPercent:net/50,drawdown:dd,firstFilled,secondFilled,bothFilled,noSize,invalid,uncertain,unfilled,open,fees};
}
const cache=new Map<number,any>(),grid:any[]=[];
console.log(JSON.stringify({phase:'Fixed grid',policies:policies.length,notes:'Both entries strictly positive pullbacks and distinct, original SL, fixed total $50, 30% body filter. Two target interpretations tested. No single-entry fallback. Same archived setups, reused-data exploratory research.'}));
for(const p of policies){
  const source=setups.filter((r:any)=>features.get(r.signalUTC).bodyFraction>=.3);
  const recentSource=fresh.setups.filter((r:any)=>features.get(r.signalUTC).bodyFraction>=.3);
  const run=(input:any[],until:number,exec?:any)=>input.map(r=>{const {changed,spec}=plan(r,p);return replay(changed,spec,until,exec);});
  const history=run(source,cutoff),train1=run(source,oct),train2=run(source,nov),recent=run(recentSource,fresh.to,execution),rows=[...history,...recent];
  cache.set(p.id,{history,train1,train2,recent,rows});
  const train=(input:Row[],boundary:number)=>{
    const a=input.filter(r=>r.confirmed<boundary),s=metrics(a,true,.2),months=[...new Set(a.map(r=>r.signalUTC.slice(0,7)))];
    return {...s,minMonthlyClosed:Math.min(...months.map(m=>metrics(a.filter(r=>r.signalUTC.startsWith(m)),true,.2).closed))};
  };
  grid.push({id:p.id,policy:p,training:train(train1,oct),training2:train(train2,nov),ideal:metrics(rows),cost:metrics(rows,true,.2),stress:metrics(rows,true,.5),fresh:metrics(recent)});
  if(p.id%30===0)console.log(`Evaluated ${p.id+1}/${policies.length}`);
}
const benchmark=grid.find(r=>r.policy.benchmark)!;
assert.equal(policies.length,121);assert.equal(benchmark.ideal.wins,118);assert.equal(benchmark.ideal.losses,83);assert.ok(Math.abs(benchmark.ideal.netDollars-3323.016178311785)<1e-6);
const real=grid.filter(r=>!r.policy.benchmark);
const pick=(mode:string)=>[...real].filter(r=>r.policy.target===mode&&r.cost.closed>=80).sort((a,b)=>b.cost.netDollars-a.cost.netDollars)[0];
const common=pick('common-reference-1.25R'),exact=pick('each-entry-exact-1.25R');
const commonFits=[...real].filter(r=>r.policy.target==='common-reference-1.25R'&&r.cost.closed>=80&&r.cost.noSize<=1).sort((a,b)=>b.cost.netDollars-a.cost.netDollars)[0];
const choose=(key:string)=>[...real].filter(r=>r[key].closed>=30&&r[key].minMonthlyClosed>=8).sort((a,b)=>(b[key].netDollars-.5*b[key].drawdown)-(a[key].netDollars-.5*a[key].drawdown))[0];
const october=choose('training'),november=choose('training2');
const ids=[...new Set([benchmark.id,common.id,commonFits.id,exact.id,october?.id,november?.id].filter((id):id is number=>id!==undefined))];
const selected=ids.map(id=>{
  const g=grid[id],c=cache.get(id);
  const monthly=Object.fromEntries(['2026-08','2026-09','2026-10','2026-11'].map(m=>{
    const a=c.rows.filter((r:any)=>r.signalUTC.startsWith(m));return [m,{ideal:metrics(a),cost:metrics(a,true,.2)}];
  }));
  assert.ok(Math.abs(Object.values(monthly).reduce((sum:any,s:any)=>sum+s.ideal.netDollars,0)-g.ideal.netDollars)<1e-6);
  return {...g,roles:[id===benchmark.id?'earlier-0/10-benchmark':'',id===common.id?'best-common-target-cost-hindsight':'',id===commonFits.id?'best-common-target-with-two-lot-sizing-hindsight':'',id===exact.id?'best-exact-1.25-per-entry-cost-hindsight':'',id===october?.id?'selected-before-October':'',id===november?.id?'selected-before-November':''].filter(Boolean),monthly,rows:c.rows};
});
const month=(id:number,m:'oct'|'nov')=>metrics((m==='oct'?cache.get(id).train2.filter((r:any)=>r.confirmed>=oct&&r.confirmed<nov):cache.get(id).history.filter((r:any)=>r.confirmed>=nov)),true,.2);
const walkForward={octoberId:october?.id,novemberId:november?.id,candidateOctober:october?month(october.id,'oct'):null,candidateNovember:november?month(november.id,'nov'):null,benchmarkOctober:month(benchmark.id,'oct'),benchmarkNovember:month(benchmark.id,'nov')};
const exampleInput={reference:3500,stop:3480,body:10,sign:1,confirmed:1};
const examples=[common,exact].map(g=>({id:g.id,policy:g.policy,...plan(exampleInput,g.policy)}));
const output={method:{risk:50,balance:5000,trialCount:120,bodyFilter:.3,scope:'Offline research only, both real pullbacks submitted immediately after original confirmation. No 15min delayed market entry. Same original SL; each entry closer to SL than reference. Two limit orders; either may remain unfilled. Expiry from confirmation; cancel pending at its planned TP/SL/deadline. Fixed setup risk split, not lot split. No BE/trailing/early close.',units:'body fractions multiply final confirmation body; reference-risk fractions multiply original reference-to-SL distance. BUY subtracts distance, SELL adds it.',targetModes:'Common original-reference target is reference +/-1.25 original risk; actual per-entry RR is higher. Exact-per-entry mode sets each target at entry +/-1.25 its own stop distance. Independent target cancellation inherited from path engine; if price is already beyond an entry target at order inception that entry is retired.',sizing:'Assume100oz gold, .01 min/step, floor lots. If either entry cannot fit allocated budget, skip whole setup; never use second-only fallback. Fixed total $50 allowance, ideal model versus strict two-order size/cost sensitivity.',costs:'Illustrative total round-trip price cost .20/.50 gold units plus $7/lot. Not observed broker fees or executable bid/ask. SL risk allocation excludes costs/slippage; no margin/daily/concurrent-risk model.',limitations:'All historical dates reused. Hindsight winners labeled; no independent validation. Historical replay M15, former fresh Nov18-20 M1. Unknown outcomes excluded; DD known resolved cash only, excludes floating losses. Two orders do not guarantee two fills.'},benchmarkId:benchmark.id,walkForward,examples,selected,grid};
fs.writeFileSync(new URL(stem+'.json',root),JSON.stringify(output)+'\n');
console.log(JSON.stringify({benchmarkId:benchmark.id,walkForward,selected:selected.map(({rows,...r})=>r),examples},null,2));
