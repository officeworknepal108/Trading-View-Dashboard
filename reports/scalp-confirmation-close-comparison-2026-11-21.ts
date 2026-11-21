// Fixed-rule offline comparison. No optimization, live API, or source changes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {replay,setups,cutoff,bars,type Spec} from './scalp-validation-model-2026-11-20';
const root=new URL('./',import.meta.url),stem='scalp-confirmation-close-comparison-2026-11-21';
const read=(n:string)=>JSON.parse(fs.readFileSync(new URL(n,root),'utf8'));
const fresh=read('scalp-selected-rule-validation-2026-11-20-fresh-qualified-setups.json');
const candles=new Map<number,any>(bars.map(b=>[b.time,b]));
for(const b of read('scalp-fresh-data-2026-11-20-M15.json'))if(!candles.has(b.time)&&b.complete!==false)candles.set(b.time,b);
const m1=read('scalp-fresh-data-2026-11-20-M1.json').filter((b:any)=>b.complete!==false);
const execution={bars:m1,index:new Map<number,number>(m1.map((b:any,i:number)=>[b.time,i])),seconds:60};
const original=read('scalp-selected-rule-validation-2026-11-20.json');
const policies=[{id:'existing',label:'Existing code',closeAnchor:false,full:false},{id:'close-only',label:'Only change anchor to confirmation close',closeAnchor:true,full:false},{id:'full-proposal',label:'Confirmation close plus proposed 1.25R rules',closeAnchor:true,full:true}];
function build(r:any,p:typeof policies[number]){
  const confirmation=candles.get(r.time);assert.ok(confirmation&&confirmation.complete!==false&&confirmation.time+900<=r.confirmed);
  const body=Math.abs(confirmation.close-confirmation.open),range=confirmation.high-confirmation.low;
  const anchor=p.closeAnchor?confirmation.close:r.nextOpen;
  const share=p.full?.5:.6,expiry=p.full?60:75;
  const sign=r.direction==='bullish'?1:-1;
  const entries=[.1,.25].map(v=>anchor-sign*body*v);
  const risks=entries.map(entry=>sign*(entry-r.stop));
  const originalRisk=Math.abs(r.reference-r.stop);
  const targets=p.full?entries.map((entry,i)=>entry+sign*risks[i]*1.25):[r.target,r.target];
  const factors=targets.map(target=>sign*(target-r.reference)/originalRisk) as [number,number];
  const spec:Spec={profile:{name:p.label,first:10,second:25,share,expiry,anchor:'next-open'},targets:factors,cancel:p.full?'new-target':'original-target'};
  const changed={...r,nextOpen:anchor,body};
  if(p.full&&!risks.every(risk=>risk>0&&risk<=30.000001))changed.missing=true; // require two valid limit levels
  if(!changed.missing){
    assert.ok(entries[0]!==entries[1]);
    entries.forEach((entry,i)=>{
      assert.ok(Math.abs(entry-(anchor-sign*body*[.1,.25][i]))<1e-8);
      if(p.closeAnchor){assert.ok(sign*(confirmation.close-entry)>0);assert.ok(risks[i]<sign*(confirmation.close-r.stop));}
      if(p.full)assert.ok(Math.abs(sign*(targets[i]-entry)/risks[i]-1.25)<1e-7);
      else assert.ok(Math.abs(targets[i]-r.target)<1e-7);
    });
  }
  return {changed,spec,filterPass:!p.full||(range>0&&body/range>=.3),confirmation,entries,risks,targets};
}
type Row=ReturnType<typeof replay>;
const closed=(r:Row)=>['tp','sl','mixed'].includes(r.outcome);
function summary(rows:Row[],budget:number){
  const finished=rows.filter(closed),wins=finished.filter(r=>r.netR>1e-8).length,losses=finished.filter(r=>r.netR< -1e-8).length;
  const cash=new Map<number,number>();
  for(const r of finished)for(const l of r.legs){
    const value=budget*(l.outcome==='tp'?l.share*l.rr:l.outcome==='sl'?-l.share:0);
    if(!value)continue;assert.ok(l.closedAt);cash.set(l.closedAt!,(cash.get(l.closedAt!)||0)+value);
  }
  let equity=0,peak=0,dd=0;
  for(const [t,value] of [...cash].sort((a,b)=>a[0]-b[0])){equity+=value;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}
  const net=finished.reduce((sum,r)=>sum+r.netR*budget,0);assert.ok(Math.abs(equity-net)<1e-6);
  const bothFilled=rows.filter(r=>r.legs.length===2&&r.legs.every(l=>l.fillState==='filled')).length;
  return {setups:rows.length,closed:finished.length,wins,losses,winPercent:finished.length?wins/finished.length*100:0,netDollars:net,returnPercent:net/5000*100,endingBalance:5000+net,drawdown:dd,bothFilled,uncertain:rows.filter(r=>r.outcome==='uncertain').length,unfilled:rows.filter(r=>r.outcome==='not-filled').length,invalid:rows.filter(r=>r.outcome==='no-valid-entry').length,open:rows.filter(r=>['open','pending'].includes(r.outcome)).length};
}
const results=policies.map(p=>{
  const run=(source:any[],until:number,exec?:any)=>source.flatMap(r=>{const b=build(r,p);if(!b.filterPass)return [];return [{...replay(b.changed,b.spec,until,exec),type:r.type}];});
  const history=run(setups,cutoff),recent=run(fresh.setups,fresh.to,execution),rows=[...history,...recent];
  const monthly=Object.fromEntries(['2026-08','2026-09','2026-10','2026-11'].map(month=>{const a=rows.filter(r=>r.signalUTC.startsWith(month));return [month,{risk50:summary(a,50),risk100:summary(a,100)}];}));
  const byType=Object.fromEntries(['T1','T2','T3'].map(type=>[type,summary(rows.filter(r=>r.type===type),100)]));
  assert.ok(Math.abs(Object.values(monthly).reduce((sum,s)=>sum+s.risk100.netDollars,0)-summary(rows,100).netDollars)<1e-6);
  return {...p,risk50:summary(rows,50),risk100:summary(rows,100),monthly,byType,rows};
});
const old=original.results.find((r:any)=>r.id==='old'),oldTotal=(old.history.netDollars+old.freshM1.netDollars)*25;
assert.ok(Math.abs(results[0].risk100.netDollars-oldTotal)<1e-6);assert.equal(results[0].risk100.wins,124);assert.equal(results[0].risk100.losses,77);
const changed=[];
for(const r of [...setups,...fresh.setups]){
  const c=candles.get(r.time);if(r.missing)continue;
  if(Math.abs(c.close-r.nextOpen)>1e-8)changed.push({signalUTC:r.signalUTC,type:r.type,direction:r.direction,confirmationClose:c.close,nextOpen:r.nextOpen,difference:c.close-r.nextOpen});
}
const compared=results[0].rows.map((r,i)=>({existing:r,proposed:results[1].rows[i]}));
for(const {existing:a,proposed:b} of compared)assert.equal(a.signalUTC,b.signalUTC);
const known=(r:Row)=>closed(r)||r.outcome==='not-filled'||r.outcome==='no-valid-entry';
const paired=compared.filter(p=>known(p.existing)&&known(p.proposed));
const differences=compared.filter(p=>p.existing.outcome!==p.proposed.outcome||Math.abs(p.existing.netR-p.proposed.netR)>1e-8).map(p=>({signalUTC:p.existing.signalUTC,existingOutcome:p.existing.outcome,newOutcome:p.proposed.outcome,existingR:p.existing.netR,newR:p.proposed.netR}));
const output={method:{riskBudgets:[50,100],balance:5000,period:'Aug3-Nov20 2026',fixedRules:'No parameter optimization in this comparison. Existing10/25 measured from next M15 open; close-only10/25 measured from final completed confirmation candle close, using its body for T1/T2/T3. Anchor-only retains original SL/common target,60/40 risk,75min expiry,all original filters. Full proposal also changes50/50 split,60min expiry,body>=30% and separate exactly1.25R targets. Two valid legs required in full version.',execution:'Archived qualified universe, unchanged OHLC event-order engine; historicalM15/former freshM1. Next candle open is used only for observed execution paths in new versions, never to calculate the entry levels. Still requires execution candle history. Per-leg300-pip risk cap inherited.',limitations:'Ideal fractional lots before spread/commission/slippage/swaps, no compounding/margin/daily-stop/aggregate-risk limits. Unknown outcomes excluded and may differ. DD resolved cash only, excludes floating risk. Previously reused data, not independent future validation. Source/live settings unchanged.'},hashes:Object.fromEntries(['scalp-validation-model-2026-11-20.ts','../src/services/scalpOneToOne.ts'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex')])),changedAnchorCount:changed.length,changedAnchors:changed,pairedKnown:{setups:paired.length,differenceDollarsAt100:paired.reduce((sum,p)=>sum+(p.proposed.netR-p.existing.netR)*100,0)},outcomeOrProfitDifferences:differences,results};
fs.writeFileSync(new URL(stem+'.json',root),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({changedAnchorCount:changed.length,maxAnchorDifference:Math.max(...changed.map(r=>Math.abs(r.difference))),results:results.map(({rows,...r})=>r),pairedKnown:output.pairedKnown},null,2));
