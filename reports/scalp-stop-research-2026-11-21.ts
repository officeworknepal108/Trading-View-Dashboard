// Offline stop/target research. Never submits orders or changes dashboard settings.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {replay,setups,cutoff,bars,type Spec} from './scalp-validation-model-2026-11-20';
const root=new URL('./',import.meta.url),stem='scalp-stop-research-2026-11-21';
const read=(n:string)=>JSON.parse(fs.readFileSync(new URL(n,root),'utf8'));
const broad=read('scalp-broader-research-2026-11-21.json');
const featureMap=new Map<string,any>(broad.features.map((f:any)=>[f.signalUTC,f]));
const fresh=read('scalp-selected-rule-validation-2026-11-20-fresh-qualified-setups.json');
const candles=new Map<number,any>(bars.map(b=>[b.time,b]));
for(const b of read('scalp-fresh-data-2026-11-20-M15.json'))if(!candles.has(b.time)&&b.complete!==false)candles.set(b.time,b);
const inputs=[...setups,...fresh.setups];
const m1=read('scalp-fresh-data-2026-11-20-M1.json').filter((b:any)=>b.complete!==false);
const exec={bars:m1,index:new Map<number,number>(m1.map((b:any,i:number)=>[b.time,i])),seconds:60};
const oct=Date.parse('2026-10-01T00:00:00Z')/1000,nov=Date.parse('2026-11-01T00:00:00Z')/1000;
type Row=ReturnType<typeof replay>;
type Stop={name:string;kind:'original'|'fraction'|'atr'|'confirmation';value:number};
const stops:Stop[]=[{name:'Original pattern SL',kind:'original',value:1}];
for(const value of [.5,.75,1.25])stops.push({name:`${value} x original reference SL distance`,kind:'fraction',value});
for(const value of [.75,1,1.25,1.5,2])stops.push({name:`${value} ATR14 from reference`,kind:'atr',value});
for(const value of [.1,.25,.5])stops.push({name:`Confirmation extreme + ${value} ATR14`,kind:'confirmation',value});
type Policy={id:number;stop:Stop;targetMode:'original-distance'|'new-risk';target:number;second:number;share:number;filter:string};
const policies:Policy[]=[];
for(const stop of stops)for(const target of [0,1,1.25,1.5,2,2.5,3])for(const second of [10,25])for(const share of [.3,.5])for(const filter of ['all','body>=30%'])policies.push({id:policies.length,stop,targetMode:target===0?'original-distance':'new-risk',target:target===0?1.25:target,second,share,filter});
function geometry(r:any,p:Policy){
  const f=featureMap.get(r.signalUTC),originalRisk=Math.abs(r.reference-r.stop);
  const atr=f.riskAtr>0?originalRisk/f.riskAtr:NaN,c=candles.get(r.time);
  assert.ok(c.time+900<=r.confirmed);
  const newStop=p.stop.kind==='original'?r.stop:p.stop.kind==='fraction'?r.reference-r.sign*originalRisk*p.stop.value:p.stop.kind==='atr'?r.reference-r.sign*atr*p.stop.value:(r.sign===1?c.low:c.high)-r.sign*atr*p.stop.value;
  const newRisk=r.sign*(r.reference-newStop);
  const invalid=r.missing||!Number.isFinite(newRisk)||newRisk<=0;
  const factor=p.targetMode==='original-distance'?originalRisk*p.target/newRisk:p.target;
  const spec:Spec={profile:{name:'stop research',first:0,second:p.second,share:p.share,expiry:30},targets:[factor,factor],cancel:'new-target'};
  const changed={...r,missing:invalid,stop:newStop,target:r.reference+r.sign*newRisk*factor};
  if(!invalid){assert.ok(Math.abs(Math.abs(changed.reference-changed.stop)-newRisk)<1e-7);assert.ok(r.sign*(changed.target-r.reference)>0);}
  return {changed,spec};
}
const selectedByFilter=(r:any,p:Policy)=>p.filter==='all'||featureMap.get(r.signalUTC).bodyFraction>=.3;
const known=(r:any)=>['tp','sl','mixed'].includes(r.outcome);
function metric(rows:Row[],broker=false,price=0){
  const cash=new Map<number,number>();let net=0,wins=0,losses=0,closed=0,gain=0,loss=0,costs=0,noSize=0,uncertain=0,invalid=0,unfilled=0,open=0,lower=0;
  for(const r of rows){
    lower+=r.lowerR*50;
    let legs=r.legs,outcome=r.outcome;
    if(broker){
      const fits=(l:any,share=l.share)=>l&&Math.floor((50*share/(l.risk*100)+1e-12)/.01)*.01>=.01-1e-10;
      if(legs.length!==2||!legs.every(l=>fits(l))){const second=legs.find(l=>l.slot===1);if(!second||!fits(second,1)){noSize++;continue;}legs=[{...second,share:1}];outcome=second.outcome;}
    }
    if(outcome==='uncertain'){uncertain++;continue;}
    if(outcome==='no-valid-entry'){invalid++;continue;}
    if(outcome==='not-filled'){unfilled++;continue;}
    if(outcome==='open'||outcome==='pending'){open++;continue;}
    if(!['tp','sl','mixed'].includes(outcome))continue;
    let pnl=0,budget=0;
    for(const l of legs){
      const lot=broker?Math.floor((50*l.share/(l.risk*100)+1e-12)/.01)*.01:50*l.share/(l.risk*100);
      budget+=lot*100*l.risk;
      if(!['tp','sl'].includes(l.outcome))continue;
      const gross=lot*100*l.risk*(l.outcome==='tp'?l.rr:-1),fee=price>0?lot*(price*100+7):0;
      const value=gross-fee;pnl+=value;costs+=fee;gain+=Math.max(0,value);loss+=Math.max(0,-value);
      assert.ok(l.closedAt);cash.set(l.closedAt!,(cash.get(l.closedAt!)||0)+value);
    }
    assert.ok(budget<=50+1e-7);
    net+=pnl;closed++;if(pnl>1e-8)wins++;else if(pnl< -1e-8)losses++;
  }
  let equity=0,peak=0,dd=0;
  for(const [t,pnl] of [...cash].sort((a,b)=>a[0]-b[0])){equity+=pnl;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}
  assert.ok(Math.abs(equity-net)<1e-6);
  assert.equal(closed+uncertain+invalid+unfilled+open+noSize,rows.length);
  return {setups:rows.length,closed,wins,losses,winPercent:closed?wins/closed*100:0,netDollars:net,returnPercent:net/50,drawdown:dd,costs,noSize,uncertain,invalid,unfilled,open,lowerDollars:broker?null:lower,profitFactor:loss>0?gain/loss:null};
}
const cache=new Map<string,{history:Row[];train1:Row[];train2:Row[];recent:Row[]}>();
const grid:any[]=[];
console.log(JSON.stringify({phase:'Fixed stop-policy grid',count:policies.length,selection:'Training ideal net minus 0.5 realized drawdown, >=40 closed and >=12 per training month, >=45% win rate. Also report cost-aware selection using $50 lots, fallback, .20 price cost plus $7/lot. All outcomes reused; exploratory, no unseen-data claim.'}));
for(const p of policies){
  const key=JSON.stringify({...p,id:0,filter:'all'});
  if(!cache.has(key)){
    const run=(source:any[],until:number,execution?:any)=>source.map(r=>{const {changed,spec}=geometry(r,p);return replay(changed,spec,until,execution);});
    cache.set(key,{history:run(setups,cutoff),train1:run(setups,oct),train2:run(setups,nov),recent:run(fresh.setups,fresh.to,exec)});
  }
  const c=cache.get(key)!;
  const select=(rows:Row[])=>rows.filter(r=>selectedByFilter(r,p));
  const history=select(c.history),recent=select(c.recent),all=[...history,...recent];
  const training=(rows:Row[],boundary:number,broker=false)=>{
    const chosen=select(rows.filter(r=>r.confirmed<boundary)),s=metric(chosen,broker,broker?.2:0);
    const months=[...new Set(chosen.map(r=>r.signalUTC.slice(0,7)))];
    const minMonthlyClosed=months.length?Math.min(...months.map(m=>metric(chosen.filter(r=>r.signalUTC.startsWith(m)),broker,broker?.2:0).closed)):0;
    return {...s,minMonthlyClosed};
  };
  grid.push({id:p.id,policy:p,training:training(c.train1,oct),training2:training(c.train2,nov),brokerTraining:training(c.train1,oct,true),brokerTraining2:training(c.train2,nov,true),history:metric(history),fresh:metric(recent),overall:metric(all),brokerOverall:metric(all,true,.2),october:metric(select(c.train2.filter(r=>r.confirmed>=oct&&r.confirmed<nov))),november:metric(history.filter(r=>r.confirmed>=nov))});
  if(p.id%100===0)console.log(`Evaluated ${p.id+1}/${policies.length}`);
}
const baselineId=policies.find(p=>p.stop.kind==='original'&&p.targetMode==='new-risk'&&p.target===1.25&&p.second===10&&p.share===.3&&p.filter==='all')!.id;
const baseline=grid[baselineId];
assert.equal(policies.length,672);assert.equal(baseline.overall.wins,119);assert.equal(baseline.overall.losses,87);assert.ok(Math.abs(baseline.overall.netDollars-3186.20015817005)<1e-6);
const eligible=(r:any,key:string)=>r[key].closed>=40&&r[key].minMonthlyClosed>=12&&r[key].winPercent>=45;
const choose=(key:string)=>[...grid].filter(r=>eligible(r,key)).sort((a,b)=>(b[key].netDollars-.5*b[key].drawdown)-(a[key].netDollars-.5*a[key].drawdown))[0];
const pickOct=choose('training'),pickNov=choose('training2'),brokerPickOct=choose('brokerTraining'),brokerPickNov=choose('brokerTraining2');
const maxProfit=[...grid].filter(r=>r.overall.closed>=100&&r.training.minMonthlyClosed>=12).sort((a,b)=>b.overall.netDollars-a.overall.netDollars)[0];
const maxCost=[...grid].filter(r=>r.brokerOverall.closed>=100&&r.brokerTraining.minMonthlyClosed>=12).sort((a,b)=>b.brokerOverall.netDollars-a.brokerOverall.netDollars)[0];
const dominance=[...grid].filter(r=>r.overall.closed>=100&&r.overall.winPercent>=baseline.overall.winPercent&&r.overall.drawdown<=baseline.overall.drawdown).sort((a,b)=>b.overall.netDollars-a.overall.netDollars)[0];
const ids=[...new Set([baselineId,pickOct?.id,pickNov?.id,brokerPickOct?.id,brokerPickNov?.id,maxProfit.id,maxCost.id,dominance.id].filter((id):id is number=>id!==undefined))];
const selected=ids.map(id=>{
  const g=grid[id],p=g.policy,c=cache.get(JSON.stringify({...p,id:0,filter:'all'}))!;
  const rows=[...c.history,...c.recent].filter(r=>selectedByFilter(r,p));
  const monthly=Object.fromEntries(['2026-08','2026-09','2026-10','2026-11'].map(m=>[m,metric(rows.filter(r=>r.signalUTC.startsWith(m)))]));
  const costMonthly=Object.fromEntries(Object.keys(monthly).map(m=>[m,metric(rows.filter(r=>r.signalUTC.startsWith(m)),true,.2)]));
  assert.ok(Math.abs(Object.values(monthly).reduce((a,s)=>a+s.netDollars,0)-g.overall.netDollars)<1e-6);
  assert.ok(Math.abs(Object.values(costMonthly).reduce((a,s)=>a+s.netDollars,0)-g.brokerOverall.netDollars)<1e-6);
  return {...g,roles:[id===baselineId?'baseline':'',id===maxProfit.id?'highest-ideal-hindsight':'',id===maxCost.id?'highest-cost-adjusted-hindsight':'',id===dominance.id?'max-profit-with-baseline-win-and-drawdown-hindsight':'',id===pickOct?.id?'train-selected-October':'',id===pickNov?.id?'train-selected-November':'',id===brokerPickOct?.id?'cost-train-selected-October':'',id===brokerPickNov?.id?'cost-train-selected-November':''].filter(Boolean),monthly,costMonthly,costStress:metric(rows,true,.5),rows};
});
function monthResult(id:number,month:'october'|'november',broker=false){
  const p=policies[id],c=cache.get(JSON.stringify({...p,id:0,filter:'all'}))!;
  const rows=(month==='october'?c.train2.filter(r=>r.confirmed>=oct&&r.confirmed<nov):c.history.filter(r=>r.confirmed>=nov)).filter(r=>selectedByFilter(r,p));
  return metric(rows,broker,broker?.2:0);
}
const walkForward={ideal:{octoberChoice:pickOct.id,novemberChoice:pickNov.id,october:monthResult(pickOct.id,'october'),november:monthResult(pickNov.id,'november'),baselineOctober:monthResult(baselineId,'october'),baselineNovember:monthResult(baselineId,'november')},cost:{octoberChoice:brokerPickOct.id,novemberChoice:brokerPickNov.id,october:monthResult(brokerPickOct.id,'october',true),november:monthResult(brokerPickNov.id,'november',true),baselineOctober:monthResult(baselineId,'october',true),baselineNovember:monthResult(baselineId,'november',true)}};
const output={method:{risk:50,balance:5000,policies:policies.length,period:'Aug3-Nov20 2026',stopDefinition:'Original reference stays fixed. Alter only stop using fraction of original reference risk, closed-candle ATR14 or final confirmation high/low plus ATR buffer. ATR14 is simple mean of contiguous true ranges. Missing ATR rejects that setup. Fixed-original-distance target stays at original 1.25R; new-risk targets are multiples of the revised reference-to-stop distance. Common target across both entries. Pending orders retire at experimental target/SL or 30min.',qualification:'Same archived qualified setups, both directions, original confirmation filters. Changes to stop deliberately define a different research strategy. No BE, early close or compounding.',execution:'Existing exhaustive OHLC engine, historical M15 and Nov18-20 M1. Same per-leg 300-pip validity cap inherited. Unknown/open outcomes excluded, and uncertainty exclusions can vary with stop. Dollar risk covers both entries. No margin/daily/concurrent-risk modeling; drawdown excludes floating losses.',costs:'Illustrative .20/.50 gold-price-unit total round-trip cost plus $7/lot. Assumed contract100oz, min/step.01, rounded down. If split cannot fit, second-only with up to full $50 budget. Not actual broker quotes/fills; entry/stop prices not tick rounded. Risk assertions <=$50, cash/monthly reconciliation, baseline parity.',selection:'Train score net - half drawdown, min40 resolved, min12 in each training month, min45% resolved wins. Train AugSep for Oct and AugOct for historical Nov. Cost-aware selection scored separately. Full-period winners explicitly hindsight. Entire history reused from earlier research. No claim of independent validation.'},sourceHash:crypto.createHash('sha256').update(fs.readFileSync(new URL('scalp-validation-model-2026-11-20.ts',root))).digest('hex'),baselineId,walkForward,selected,grid};
fs.writeFileSync(new URL(stem+'.json',root),JSON.stringify(output)+'\n');
const csv=['id,stop,targetMode,target,second,firstShare,filter,closed,wins,losses,net,drawdown,uncertain,costNet'];
for(const g of grid){const p=g.policy;csv.push([g.id,JSON.stringify(p.stop.name),p.targetMode,p.target,p.second,p.share,p.filter,g.overall.closed,g.overall.wins,g.overall.losses,g.overall.netDollars,g.overall.drawdown,g.overall.uncertain,g.brokerOverall.netDollars].join(','));}
fs.writeFileSync(new URL(stem+'.csv',root),csv.join('\n')+'\n');
console.log(JSON.stringify({baselineId,walkForward,selected:selected.map(({rows,...r})=>r)},null,2));
