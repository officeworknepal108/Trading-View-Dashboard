// Offline exploratory research only. No server, settings, or trading API calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {replay, stats, setups, cutoff, type Spec} from './scalp-validation-model-2026-11-20';

const root=new URL('./',import.meta.url);
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const prior=read('scalp-selected-rule-validation-2026-11-20.json');
const fresh=read('scalp-selected-rule-validation-2026-11-20-fresh-qualified-setups.json');
const m1=read('scalp-fresh-data-2026-11-20-M1.json').filter((b:any)=>b.complete!==false);
const execution={bars:m1,index:new Map<number,number>(m1.map((b:any,i:number)=>[b.time,i])),seconds:60};
const trainEnd=Date.parse('2026-10-01T00:00:00Z')/1000;
const spec=(second:number,share:number,expiry:number,target:number):Spec=>({profile:{name:`0/${second}, ${share*100}/${(1-share)*100}, ${expiry}m, ${target}R`,first:0,second,share,expiry},targets:[target,target],cancel:'new-target'});
const specs:Spec[]=[];
for(const second of [0,10,25])for(const share of [.3,.5,.7])for(const expiry of [30,60])for(const target of [1,1.25,1.5,1.75,2]){
  // Identical entry levels make share variations redundant.
  if(second===0&&share!==.3)continue;
  specs.push(spec(second,share,expiry,target));
}
const baseline=spec(10,.3,30,1.25);
type Row=ReturnType<typeof replay>;
const resolved=(r:any)=>['tp','sl','mixed'].includes(r.outcome);
function summary(rows:any[],broker=false,costPrice=0){
  const cash=new Map<number,number>();let grossProfit=0,grossLoss=0,net=0,closed=0,wins=0,losses=0,fees=0,noSize=0,lotTotal=0;
  for(const r of rows){
    if(r.outcome==='no-size'){noSize++;continue;}
    if(!resolved(r))continue;
    let pnl=0;
    for(const l of r.legs){
      if(!['tp','sl'].includes(l.outcome))continue;
      const idealVolume=50*l.share/(l.risk*100);
      const volume=broker?Math.floor((idealVolume+1e-12)/.01)*.01:idealVolume;
      const allowance=volume*100*l.risk;
      const value=l.outcome==='tp'?allowance*l.rr:-allowance;
      const cost=volume*(costPrice*100+(costPrice>0?7:0));
      pnl+=value-cost;fees+=cost;lotTotal+=volume;
      if(value>0)grossProfit+=value;else grossLoss-=value;
      const t=l.closedAt;assert.ok(Number.isFinite(t));cash.set(t,(cash.get(t)||0)+value-cost);
    }
    net+=pnl;closed++;if(pnl>1e-8)wins++;else if(pnl< -1e-8)losses++;
  }
  let equity=0,peak=0,dd=0;
  for(const [t,pnl] of [...cash].sort((a,b)=>a[0]-b[0])){equity+=pnl;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}
  assert.ok(Math.abs(equity-net)<1e-6);
  return {setups:rows.length,closed,wins,losses,winPercent:closed?wins/closed*100:0,netDollars:net,returnPercent:net/5000*100,realizedExitBarDrawdown:dd,profitFactor:grossLoss?grossProfit/grossLoss:null,fees,lotTotal,noSize,uncertain:rows.filter(r=>r.outcome==='uncertain').length,unfilled:rows.filter(r=>r.outcome==='not-filled').length,invalid:rows.filter(r=>r.outcome==='no-valid-entry').length};
}
function brokerRows(rows:Row[]){
  // Strict two-entry sizing: skip a setup if either intended entry is invalid or below min lot.
  return rows.map(r=>r.legs.length!==2||r.legs.some(l=>Math.floor((50*l.share/(l.risk*100)+1e-12)/.01)*.01<.01-1e-10)?{...r,outcome:'no-size',legs:[]}:r);
}
function fallbackRows(rows:Row[]){
  const fits=(l:any,share=l.share)=>l&&Math.floor((50*share/(l.risk*100)+1e-12)/.01)*.01>=.01-1e-10;
  return rows.map(r=>{
    if(r.legs.length===2&&r.legs.every(l=>fits(l)))return r;
    const second=r.legs.find(l=>l.slot===1);
    if(!second||!fits(second,1))return {...r,outcome:'no-size',legs:[]};
    return {...r,outcome:second.outcome,legs:[{...second,share:1}]};
  });
}
const all=specs.map((s,id)=>{
  const history=setups.map((r:any)=>replay(r,s,cutoff));
  const training=setups.filter((r:any)=>r.confirmed<trainEnd).map((r:any)=>replay(r,s,trainEnd));
  const later=history.filter(r=>r.confirmed>=trainEnd);
  return {id,spec:s,training:summary(training),later:summary(later),history:summary(history),brokerTraining:summary(brokerRows(training),true,.2),brokerHistory:summary(brokerRows(history),true,.2)};
});
const trainingPick=[...all].sort((a,b)=>b.training.netDollars-a.training.netDollars||a.training.realizedExitBarDrawdown-b.training.realizedExitBarDrawdown)[0];
const historyPick=[...all].sort((a,b)=>b.history.netDollars-a.history.netDollars)[0];
const baselineId=all.find(r=>JSON.stringify(r.spec)===JSON.stringify(baseline))!.id;
const brokerTrainingPick=[...all].sort((a,b)=>b.brokerTraining.netDollars-a.brokerTraining.netDollars)[0];
const brokerHistoryPick=[...all].sort((a,b)=>b.brokerHistory.netDollars-a.brokerHistory.netDollars)[0];
const equalSplitId=all.find(r=>r.spec.profile.second===10&&r.spec.profile.share===.5&&r.spec.profile.expiry===30&&r.spec.targets[0]===1.25)!.id;
const selectedIds=[...new Set([baselineId,trainingPick.id,historyPick.id,brokerTrainingPick.id,brokerHistoryPick.id,equalSplitId,...[...all].sort((a,b)=>b.history.netDollars-a.history.netDollars).slice(0,5).map(r=>r.id)])];
const details=selectedIds.map(id=>{
  const candidate=all[id],s=candidate.spec;
  const history=setups.map((r:any)=>replay(r,s,cutoff));
  const recent=fresh.setups.map((r:any)=>replay(r,s,fresh.to,execution));
  const rows=[...history,...recent];
  const monthly=Object.fromEntries(['2026-08','2026-09','2026-10','2026-11'].map(m=>[m,summary(rows.filter(r=>r.signalUTC.startsWith(m)))]));
  const sized=brokerRows(rows);
  const fallback=fallbackRows(rows);
  for(const group of [sized,fallback])for(const r of group){let risk=0;for(const l of r.legs)risk+=Math.floor((50*l.share/(l.risk*100)+1e-12)/.01)*.01*100*l.risk;assert.ok(risk<=50+1e-7);}
  return {...candidate,roles:[id===baselineId?'baseline':'',id===trainingPick.id?'selected-on-Aug-Sep-only':'',id===historyPick.id?'best-historical-hindsight':'',id===brokerTrainingPick.id?'broker-training-selection':'',id===brokerHistoryPick.id?'broker-historical-hindsight':'',id===equalSplitId?'equal-split-control':''].filter(Boolean),fresh:summary(recent),overall:summary(rows),monthly,brokerMonthly:Object.fromEntries(Object.keys(monthly).map(m=>[m,summary(sized.filter(r=>r.signalUTC.startsWith(m)),true,.2)])),fallbackMonthly:Object.fromEntries(Object.keys(monthly).map(m=>[m,summary(fallback.filter(r=>r.signalUTC.startsWith(m)),true,.2)])),fallbackCosts:[.2,.5].map(price=>({roundTripPriceCost:price,commissionPerLot:7,...summary(fallback,true,price)})),brokerStrict:summary(sized,true),costSensitivity:[.2,.5].map(price=>({roundTripPriceCost:price,commissionPerLot:7,...summary(sized,true,price)})),rows};
});
const base=details.find(r=>r.id===baselineId)!;
assert.equal(specs.length,70);
assert.ok(Math.abs(base.history.netDollars-prior.results.find((r:any)=>r.id==='primary').history.netDollars*12.5)<1e-6);
assert.ok(Math.abs(base.fresh.netDollars-prior.results.find((r:any)=>r.id==='primary').freshM1.netDollars*12.5)<1e-6);
assert.equal(base.overall.closed,206);assert.equal(base.overall.wins,119);
const matched=details.map(d=>{
  const indices=d.rows.map((r,i)=>resolved(r)&&resolved(base.rows[i])?i:-1).filter(i=>i>=0);
  const a=summary(indices.map(i=>d.rows[i])),b=summary(indices.map(i=>base.rows[i]));
  return {id:d.id,setups:indices.length,candidate:a,baseline:b,difference:a.netDollars-b.netDollars};
});
const output={method:{date:'2026-11-21',risk:50,balance:5000,gridCount:specs.length,selection:'Highest August-September net profit; outcomes cut off October 1. Also report full-history winner as explicitly hindsight. No selection on November 18-20 outcomes.',limitations:'All dates, including the former fresh sample, have already been inspected. This is exploratory reused-data evidence, not independent validation. Original reference reconstruction and exhaustive OHLC engine are inherited from archived study. Unknown outcomes excluded; DD excludes floating losses. No new market data. All setups simulated independently, without margin, concurrent-risk, or daily-loss limits.',sizing:'Historical contract assumption: 100 oz, .01 lot minimum/step. Strict two-leg sizing skips whole setup if either leg cannot be sized. This differs from second-only fallback and is not a broker-fill replay.',costs:'Sensitivity only: 0.20 or 0.50 total round-trip gold price-unit cost plus $7 per lot round trip. Not observed broker spreads/fees. Costs applied to known resolved legs only.'},baselineId,trainingPick:trainingPick.id,historyPick:historyPick.id,grid:all,selected:details,matched};
fs.writeFileSync(new URL('scalp-improvement-study-2026-11-21.json',root),JSON.stringify(output,null,2)+'\n');
const csv=['id,name,role,period,setups,closed,wins,losses,winPercent,netDollars,returnPercent,drawdown,uncertain,noSize'];
for(const d of details)for(const [period,s] of Object.entries({history:d.history,fresh:d.fresh,overall:d.overall,...d.monthly,brokerStrict:d.brokerStrict}))csv.push([d.id,JSON.stringify(d.spec.profile.name),d.roles.join(';'),period,s.setups,s.closed,s.wins,s.losses,s.winPercent,s.netDollars,s.returnPercent,s.realizedExitBarDrawdown,s.uncertain,s.noSize].join(','));
fs.writeFileSync(new URL('scalp-improvement-study-2026-11-21.csv',root),csv.join('\n')+'\n');
console.log(JSON.stringify({grid:specs.length,baselineId,trainingPick:trainingPick.id,historyPick:historyPick.id,results:details.map(({rows,...d})=>d),matched},null,2));
