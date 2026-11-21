// Exploratory offline study. All dates were already inspected; no unseen-data claim.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {replay,setups,cutoff,bars,type Spec} from './scalp-validation-model-2026-11-20';
const root=new URL('./',import.meta.url),stem='scalp-broader-research-2026-11-21';
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const fresh=read('scalp-selected-rule-validation-2026-11-20-fresh-qualified-setups.json');
const old=read('scalp-selected-rule-validation-2026-11-20.json');
const latest=read('scalp-fresh-data-2026-11-20-M15.json');
const map=new Map<number,any>(bars.map(b=>[b.time,b]));
for(const b of latest)if(!map.has(b.time)&&b.complete!==false)map.set(b.time,b);
const allSetups=[...setups,...fresh.setups];
const features=allSetups.map((r:any)=>{
  const c=map.get(r.time),prev=map.get(r.time-900);
  if(!c)throw new Error('Missing confirmation candle');
  assert.ok(c.time+900<=r.confirmed);
  const ranges=[];const volumes=[];const closes=[];
  for(let j=0;j<20;j++){
    const b=map.get(r.time-j*900),p=map.get(r.time-(j+1)*900);
    if(b)assert.ok(b.time+900<=r.confirmed);
    ranges.push(b&&p?Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close)):NaN);
    if(j>0)volumes.push(b?b.volume:NaN);
    closes.push(b?b.close:NaN);
  }
  const avg=(a:number[])=>a.reduce((a,b)=>a+b,0)/a.length;
  const atr=ranges.slice(0,14).every(Number.isFinite)?avg(ranges.slice(0,14)):NaN;
  const range=c.high-c.low;
  return {signalUTC:r.signalUTC,confirmed:r.confirmed,type:r.type,direction:r.direction,hour:new Date(r.confirmed*1000).getUTCHours(),
    riskAtr:Math.abs(r.reference-r.stop)/atr,bodyFraction:range>0?Math.abs(c.close-c.open)/range:0,
    closeStrength:range>0?(r.sign===1?c.close-c.low:c.high-c.close)/range:0,
    volumeDrop:prev?.volume>0?(prev.volume-c.volume)/prev.volume:NaN,
    relativeVolume:volumes.every(Number.isFinite)?c.volume/avg(volumes):NaN,
    trendAligned:closes.every(Number.isFinite)?r.sign*(c.close-avg(closes))>=0:false,
    contextBars:ranges.filter(Number.isFinite).length};
});
type Filter={name:string;fn:(f:any)=>boolean};
const filters:Filter[]=[{name:'All qualified setups',fn:()=>true}];
for(const type of ['T1','T2','T3']){filters.push({name:`Only ${type}`,fn:f=>f.type===type});filters.push({name:`Exclude ${type}`,fn:f=>f.type!==type});}
for(const [start,end] of [[0,7],[7,13],[13,21],[7,21],[0,13]])filters.push({name:`Confirmation UTC ${start}-${end}`,fn:f=>f.hour>=start&&f.hour<end});
for(const value of [1.5,2,2.5,3])filters.push({name:`Reference SL <=${value} ATR14`,fn:f=>f.riskAtr<=value});
for(const value of [1,1.5])filters.push({name:`Reference SL >=${value} ATR14`,fn:f=>f.riskAtr>=value});
for(const value of [.3,.5,.7])filters.push({name:`Confirmation body >=${value*100}% range`,fn:f=>f.bodyFraction>=value});
filters.push({name:'Confirmation body <=50% range',fn:f=>f.bodyFraction<=.5});
for(const value of [.1,.2,.3,.4])filters.push({name:`Final volume drop >=${value*100}%`,fn:f=>f.volumeDrop>=value});
for(const value of [1,1.5])filters.push({name:`Confirmation relative volume >=${value}`,fn:f=>f.relativeVolume>=value});
for(const value of [.6,.8])filters.push({name:`Directional close strength >=${value*100}%`,fn:f=>f.closeStrength>=value});
filters.push({name:'M15 close aligned with SMA20',fn:f=>f.trendAligned});
filters.push({name:'UTC 7-21 and M15 SMA20 aligned',fn:f=>f.hour>=7&&f.hour<21&&f.trendAligned});
filters.push({name:'Body >=50% and close strength >=80%',fn:f=>f.bodyFraction>=.5&&f.closeStrength>=.8});
filters.push({name:'SL <=2.5 ATR and close strength >=60%',fn:f=>f.riskAtr<=2.5&&f.closeStrength>=.6});
filters.push({name:'Only BUY',fn:f=>f.direction==='bullish'});
filters.push({name:'Only SELL',fn:f=>f.direction==='bearish'});
const masks=filters.map(f=>features.map(f.fn));
const targetPairs=[[1,1],[1.25,1.25],[1.5,1.5],[1.75,1.75],[2,2],[1,1.5],[1,2],[1.25,2],[1.5,1],[2,1]];
const profiles:Spec[]=[];
for(const second of [0,10,25,50])for(const share of [.3,.5,.7])for(const expiry of [15,30,60])for(const targets of targetPairs){
  profiles.push({profile:{name:`0/${second}; ${Math.round(share*100)}/${Math.round((1-share)*100)}; ${expiry}m; TP ${targets.join('/')}`,first:0,second,share,expiry},targets:targets as [number,number],cancel:'new-target'});
}
const baselineProfile=profiles.findIndex(s=>s.profile.second===10&&s.profile.share===.3&&s.profile.expiry===30&&s.targets[0]===1.25&&s.targets[1]===1.25);
const m1=read('scalp-fresh-data-2026-11-20-M1.json').filter((b:any)=>b.complete!==false);
const execution={bars:m1,index:new Map<number,number>(m1.map((b:any,i:number)=>[b.time,i])),seconds:60};
const oct=Date.parse('2026-10-01T00:00:00Z')/1000,nov=Date.parse('2026-11-01T00:00:00Z')/1000;
type Row=ReturnType<typeof replay>;
const known=(r:Row)=>['tp','sl','mixed'].includes(r.outcome);
function metric(rows:Row[]){
  const closed=rows.filter(known);const cash=new Map<number,number>();let grossWin=0,grossLoss=0;
  for(const r of closed)for(const l of r.legs){
    const pnl=l.outcome==='tp'?l.share*l.rr*50:l.outcome==='sl'?-l.share*50:0;
    if(pnl===0)continue;
    assert.ok(l.closedAt);cash.set(l.closedAt!,(cash.get(l.closedAt!)||0)+pnl);
    grossWin+=Math.max(0,pnl);grossLoss+=Math.max(0,-pnl);
  }
  let equity=0,peak=0,dd=0;
  for(const [t,pnl] of [...cash].sort((a,b)=>a[0]-b[0])){equity+=pnl;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}
  const wins=closed.filter(r=>r.netR>1e-8).length,losses=closed.filter(r=>r.netR< -1e-8).length;
  const net=closed.reduce((a,r)=>a+r.netR*50,0);assert.ok(Math.abs(equity-net)<1e-6);
  return {setups:rows.length,closed:closed.length,wins,losses,winPercent:closed.length?wins/closed.length*100:0,netDollars:net,returnPercent:net/50,drawdown:dd,lowerDollars:rows.reduce((a,r)=>a+r.lowerR*50,0),uncertain:rows.filter(r=>r.outcome==='uncertain').length,unfilled:rows.filter(r=>r.outcome==='not-filled').length,invalid:rows.filter(r=>r.outcome==='no-valid-entry').length,open:rows.filter(r=>r.outcome==='open'||r.outcome==='pending').length,profitFactor:grossLoss>0?grossWin/grossLoss:null};
}
const cache=new Map<number,{history:Row[];train1:Row[];train2:Row[];fresh:Row[]}>();
const grid:any[]=[];
console.log(JSON.stringify({phase:'Fixed grid',profiles:profiles.length,filters:filters.length,trials:profiles.length*filters.length,selection:'Training rank: net profit minus half realized drawdown. Require >=40 resolved training setups, >=12 resolved in each training month, and >=50% resolved win rate. Refit before October and November; assess the next month. All data previously inspected, so exploratory only.'}));
for(let pi=0;pi<profiles.length;pi++){
  const s=profiles[pi];
  const history=setups.map((r:any)=>replay(r,s,cutoff));
  const train1=setups.map((r:any)=>replay(r,s,Math.min(oct,cutoff)));
  const train2=setups.map((r:any)=>replay(r,s,Math.min(nov,cutoff)));
  const recent=fresh.setups.map((r:any)=>replay(r,s,fresh.to,execution));
  cache.set(pi,{history,train1,train2,fresh:recent});
  const rows=[...history,...recent];
  for(let fi=0;fi<filters.length;fi++){
    const mask=masks[fi],chosen=rows.filter((r,i)=>mask[i]);
    const trainMetric=(source:Row[],end:number)=>{
      const a=source.filter((r,i)=>mask[i]&&r.confirmed<end);const m=metric(a);
      const months=[...new Set(a.map(r=>r.signalUTC.slice(0,7)))];
      const minMonthlyClosed=months.length?Math.min(...months.map(month=>a.filter(r=>r.signalUTC.startsWith(month)&&known(r)).length)):0;
      return {...m,minMonthlyClosed};
    };
    const training=trainMetric(train1,oct),training2=trainMetric(train2,nov);
    grid.push({id:grid.length,profile:pi,filter:fi,training,training2,overall:metric(chosen),history:metric(history.filter((r,i)=>mask[i])),later:metric(history.filter((r,i)=>mask[i]&&r.confirmed>=oct)),october:metric(train2.filter((r,i)=>mask[i]&&r.confirmed>=oct&&r.confirmed<nov)),november:metric(history.filter((r,i)=>mask[i]&&r.confirmed>=nov)),fresh:metric(recent.filter((r,i)=>mask[i+history.length]))});
  }
  if(pi%60===0)console.log(`Computed ${pi+1}/${profiles.length} profiles`);
}
const eligible=(r:any,key:string)=>r[key].closed>=40&&r[key].minMonthlyClosed>=12&&r[key].winPercent>=50;
const choose=(key:string)=>[...grid].filter(r=>eligible(r,key)).sort((a,b)=>(b[key].netDollars-.5*b[key].drawdown)-(a[key].netDollars-.5*a[key].drawdown))[0];
const pickOct=choose('training'),pickNov=choose('training2');
const baselineId=grid.find(r=>r.profile===baselineProfile&&r.filter===0)!.id;
const maxFull=[...grid].filter(r=>r.overall.closed>=100).sort((a,b)=>b.overall.netDollars-a.overall.netDollars)[0];
const maxBaselineFilter=[...grid].filter(r=>r.profile===baselineProfile&&r.overall.closed>=80).sort((a,b)=>b.overall.netDollars-a.overall.netDollars)[0];
const stable=[...grid].filter(r=>r.overall.closed>=100&&r.overall.drawdown<=grid[baselineId].overall.drawdown).sort((a,b)=>b.overall.netDollars-a.overall.netDollars)[0];
const bothDirections=[...grid].filter(r=>r.overall.closed>=100&&r.training.minMonthlyClosed>=12&&r.training2.minMonthlyClosed>=12&& !['Only BUY','Only SELL'].includes(filters[r.filter].name)).sort((a,b)=>b.overall.netDollars-a.overall.netDollars)[0];
const selectedIds=[...new Set([baselineId,pickOct?.id,pickNov?.id,maxFull.id,maxBaselineFilter.id,stable.id,bothDirections.id].filter((id):id is number=>id!==undefined))];
function costMetric(input:Row[],price:number){
  const transformed=input.map(r=>{
    const fits=(l:any,share=l.share)=>l&&Math.floor((50*share/(l.risk*100)+1e-12)/.01)*.01>=.01-1e-10;
    let legs=r.legs;
    if(legs.length!==2||!legs.every(l=>fits(l))){const second=legs.find(l=>l.slot===1);if(!second||!fits(second,1))return {...r,outcome:'no-size',legs:[]};legs=[{...second,share:1}];}
    const state=legs.length===1?legs[0].outcome:r.outcome;
    let allocatedRisk=0;
    const net=legs.reduce((sum,l)=>{const lot=Math.floor((50*l.share/(l.risk*100)+1e-12)/.01)*.01;allocatedRisk+=lot*100*l.risk;return sum+lot*100*l.risk*(l.outcome==='tp'?l.rr:l.outcome==='sl'?-1:0)-(['tp','sl'].includes(l.outcome)?lot*(price*100+7):0);},0);
    assert.ok(allocatedRisk<=50+1e-7);
    return {...r,outcome:state,legs,netDollars:net};
  });
  const resolved=transformed.filter(r=>['tp','sl','mixed'].includes(r.outcome));
  return {closed:resolved.length,wins:resolved.filter((r:any)=>r.netDollars>0).length,losses:resolved.filter((r:any)=>r.netDollars<0).length,netDollars:resolved.reduce((a,r:any)=>a+r.netDollars,0),uncertain:transformed.filter(r=>r.outcome==='uncertain').length,noSize:transformed.filter(r=>r.outcome==='no-size').length};
}
const selected=selectedIds.map(id=>{
  const g=grid[id],c=cache.get(g.profile)!,mask=masks[g.filter];
  const rows=[...c.history,...c.fresh].filter((r,i)=>mask[i]);
  const monthly=Object.fromEntries(['2026-08','2026-09','2026-10','2026-11'].map(m=>[m,metric(rows.filter(r=>r.signalUTC.startsWith(m)))]));
  const costMonthly=Object.fromEntries(Object.keys(monthly).map(m=>[m,costMetric(rows.filter(r=>r.signalUTC.startsWith(m)),.2)]));
  return {...g,spec:profiles[g.profile],filterName:filters[g.filter].name,roles:[id===baselineId?'baseline':'',id===pickOct?.id?'selected-before-October':'',id===pickNov?.id?'selected-before-November':'',id===maxFull.id?'maximum-total-hindsight':'',id===maxBaselineFilter.id?'baseline-filter-hindsight':'',id===stable.id?'max-profit-with-baseline-drawdown-hindsight':'',id===bothDirections.id?'highest-profit-two-direction-hindsight':''].filter(Boolean),monthly,costMonthly,costSensitivity:[.2,.5].map(price=>({price,...costMetric(rows,price)})),rows};
});
const baseline=selected.find(r=>r.id===baselineId)!;
assert.equal(allSetups.length,249);assert.equal(profiles.length,360);
assert.ok(Math.abs(baseline.overall.netDollars-3186.2001581700495)<1e-5);
assert.equal(baseline.overall.wins,119);assert.equal(baseline.overall.losses,87);
for(const d of selected)assert.ok(Math.abs((Object.values(d.monthly) as any[]).reduce((a:number,s:any)=>a+s.netDollars,0)-d.overall.netDollars)<1e-6);
const walkForward={octoberChoice:pickOct?.id,novemberChoice:pickNov?.id,october:pickOct?.october,november:pickNov?.november,candidateNet:(pickOct?.october.netDollars??0)+(pickNov?.november.netDollars??0),baselineNet:grid[baselineId].october.netDollars+grid[baselineId].november.netDollars};
const output={method:{risk:50,startingBalance:5000,profiles:profiles.length,filters:filters.length,trials:grid.length,limits:'All dates reused. Full-period winners explicitly hindsight. No unseen validation. Features use candles closed by confirmation. ATR14 here is simple mean TR, not Wilder. Relative volume compares with 19 prior candles; SMA20 includes confirmation. Missing indicator context rejects relevant filters. Dollar results exclude uncertain/open outcomes and costs except labeled sensitivity. Fixed risk; no compounding or daily/concurrent-risk/margin simulation. DD is resolved exit-bar cash only, excludes floating risk. Period grouping uses signal UTC date. Historical reference reconstruction inherited from archived study.',costs:'Assumed 100oz contract and .01 lot min/step, second-only fallback, rounded lots downward, illustrative round-trip price costs .20/.50 plus $7/lot. Not broker executions. No-size includes invalid geometry.',selection:'Highest training net minus half realized drawdown, >=40 closed, >=12 closed in each training month, >=50% win rate. Train Aug-Sep for Oct; train Aug-Oct for Nov. Exploratory retrospective walk-forward.',managementReview:'Prior 101-management-variant study: max historical result at 1.5R/75% close-second+first-BE was $2716.96 over Aug3-Nov18, versus $2666.51 hold1.25R. Previously selected management rule earned $1503.92 in later Oct-Nov versus $1729.30 hold. This study therefore focuses on setup filters and asymmetric exits rather than claiming a management upgrade.'},featureHashes:{features:crypto.createHash('sha256').update(JSON.stringify(features)).digest('hex')},features,profiles,filters:filters.map(f=>f.name),baselineId,walkForward,selected,grid};
fs.writeFileSync(new URL(stem+'.json',root),JSON.stringify(output)+'\n');
const csv=['id,profile,filter,trainNet,trainDD,overallClosed,wins,losses,winPercent,netDollars,drawdown,uncertain'];
for(const g of grid)csv.push([g.id,g.profile,g.filter,g.training.netDollars,g.training.drawdown,g.overall.closed,g.overall.wins,g.overall.losses,g.overall.winPercent,g.overall.netDollars,g.overall.drawdown,g.overall.uncertain].join(','));
fs.writeFileSync(new URL(stem+'.csv',root),csv.join('\n')+'\n');
console.log(JSON.stringify({baselineId,walkForward,selected:selected.map(({rows,...d})=>d)},null,2));
