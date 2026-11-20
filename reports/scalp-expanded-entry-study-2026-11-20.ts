// Offline research: archived prices in, study reports out. No trading calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scalpPullbackBarStates } from '../src/services/scalpOneToOne';

const root=new URL('./',import.meta.url), stem='scalp-expanded-entry-study-2026-11-20';
const files=['inside-mother-scalp-study-2026-11-18.json','five-month-m15-history-older.json','five-month-m15-history-latest.json','inside-mother-scalp-study-2026-11-18-M15.json'];
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const archive=read(files[0]), prior=read('scalp-reference-entry-comparison-2026-11-20.json');
const cutoff=Date.parse(archive.method.throughUTC)/1000, split=Date.parse('2026-10-01T00:00:00Z')/1000;
const byTime=new Map<number,any>();
for(const name of files.slice(1)) for(const b of read(name)) if(!byTime.has(b.time)||b.complete!==false) byTime.set(b.time,b);
const bars=[...byTime.values()].filter(b=>b.complete!==false&&b.time+900<=cutoff).sort((a,b)=>a.time-b.time);
const index=new Map(bars.map((b,i)=>[b.time,i]));
const setups=archive.rows.map((r:any)=>{
  const time=Date.parse(r.signalUTC)/1000, confirmed=time+900, candle=byTime.get(time),next=byTime.get(confirmed);
  assert.ok(candle);
  if(!next)return {...r,time,confirmed,missing:true};
  const sign=r.direction==='bullish'?1:-1, stop=r.legs[0]?.stopLoss??(sign===1?r.patternLow-3:r.patternHigh+3);
  const openRisk=sign*(next.open-stop), reference=openRisk>0&&openRisk<=20?next.open:stop+sign*20;
  const target=reference+sign*Math.abs(reference-stop);
  for(const leg of r.legs)assert.ok(Math.abs(leg.stopLoss-stop)<1e-7&&Math.abs(leg.takeProfit-target)<1e-7);
  return {...r,time,confirmed,sign,stop,reference,nextOpen:next.open,target,body:Math.abs(candle.close-candle.open),confirmationRange:candle.high-candle.low,patternRange:r.patternHigh-r.patternLow};
});

type Pair={first:number;second:number;unit?:'body'|'confirmation-range'|'pattern-range'|'risk';expiry?:number;firstShare?:number};
function replay(r:any,p:Pair,until:number,brokerLots=false,anchor:'reference'|'next-open'='reference'){
  const base={signalUTC:r.signalUTC,direction:r.direction,confirmed:r.confirmed};
  if(r.missing||r.confirmed>=until)return {...base,outcome:'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0,validLegs:0};
  const distanceBase=p.unit==='risk'?Math.abs(r.reference-r.stop):p.unit==='confirmation-range'?r.confirmationRange:p.unit==='pattern-range'?r.patternRange:r.body;
  let signals=[p.first,p.second].flatMap((percent,i)=>{
    const entry=(anchor==='reference'?r.reference:r.nextOpen)-r.sign*distanceBase*percent/100,risk=r.sign*(entry-r.stop),reward=r.sign*(r.target-entry);
    if(!(risk>1e-8&&risk<=30.000001&&reward>0))return [];
    if(anchor==='reference')assert.ok(reward/risk>=1-1e-8);
    return [{direction:r.sign===1?'BUY':'SELL',entry,stopLoss:r.stop,takeProfit:r.target,
      percent,slot:i,riskShare:i===0?(p.firstShare??.6):1-(p.firstShare??.6),rr:reward/risk,risk,volume:null as number|null}];
  });
  const validLegs=signals.length;
  if(brokerLots){
    // Secondary Exness XAUUSDm snapshot: contract=100 oz, min/step=.01 lot.
    // Isolated sizing sensitivity only; does not simulate executable bid/ask.
    const volume=(budget:number,risk:number)=>Math.floor((budget/(risk*100)+1e-10)/.01)*.01;
    const fallback=signals.length===2&&signals.some(s=>volume(4*s.riskShare,s.risk)<.01-1e-9);
    signals=signals.flatMap(s=>{
      if(fallback&&s.slot===0)return [];
      const vol=volume(fallback?4:4*s.riskShare,s.risk);
      if(vol<.01-1e-9)return [];
      return [{...s,volume:vol,riskShare:vol*100*s.risk/4}];
    });
  }
  if(!signals.length)return {...base,outcome:brokerLots?'no-size':'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0,validLegs};
  let states=[{mask:0,exit:0}],expected=r.confirmed;
  for(let i=index.get(r.confirmed)!;i<bars.length&&bars[i].time+900<=until;i++){
    const b=bars[i];
    if(b.time!==expected){states=states.map(s=>s.exit?s:{...s,exit:2});break;}
    expected+=900;
    const paths=states.flatMap(s=>s.exit?[s]:scalpPullbackBarStates(b,signals as any,s.mask,b.time<r.confirmed+(p.expiry??75)*60));
    states=[...new Map(paths.map(s=>[`${s.mask}:${s.exit}`,s])).values()];
    if(states.every(s=>s.exit||!s.mask&&b.time+900>=r.confirmed+(p.expiry??75)*60))break;
  }
  const legs=signals.map((s,i)=>{
    const options=[...new Set(states.map(p=>p.exit===2?'uncertain':!(p.mask&(1<<i))?'not-filled':p.exit===1?'tp':p.exit===-1?'sl':'open'))];
    const outcome=options.length===1?options[0]:'uncertain';
    const fillState=states.every(state=>(state.mask&(1<<i))!==0)?'filled':states.every(state=>!(state.mask&(1<<i))&&state.exit!==2&&(state.exit!==0||until>=r.confirmed+(p.expiry??75)*60))?'not-filled':'uncertain';
    return {...s,outcome,fillState,setupR:outcome==='tp'?s.riskShare*s.rr:outcome==='sl'?-s.riskShare:0};
  });
  const closed=legs.filter(l=>l.outcome==='tp'||l.outcome==='sl');
  const outcome=legs.some(l=>l.outcome==='uncertain')?'uncertain':legs.some(l=>l.outcome==='open')?'open':
    new Set(closed.map(l=>l.outcome)).size>1?'mixed':closed[0]?.outcome??'not-filled';
  // Bound every unresolved path instead of assuming uncertain setups earned zero.
  const pathBounds=states.map(s=>{
    let low=0,high=0;
    signals.forEach((l,i)=>{
      if(s.exit===2){low-=l.riskShare;high+=l.riskShare*l.rr;}
      else if(s.mask&(1<<i)){
        if(s.exit===1){low+=l.riskShare*l.rr;high+=l.riskShare*l.rr;}
        else if(s.exit===-1){low-=l.riskShare;high-=l.riskShare;}
        else{low-=l.riskShare;high+=l.riskShare*l.rr;}
      }
    });
    return {low,high};
  });
  const boundComponents=states.map(s=>signals.map((l,i)=>s.exit===2?{low:-1,high:l.rr}:!(s.mask&(1<<i))?{low:0,high:0}:s.exit===1?{low:l.rr,high:l.rr}:s.exit===-1?{low:-1,high:-1}:{low:-1,high:l.rr}));
  return {...base,outcome,validLegs,legs,boundComponents,
    netR:['tp','sl','mixed'].includes(outcome)?legs.reduce((a,l)=>a+l.setupR,0):0,
    lowerR:Math.min(...pathBounds.map(p=>p.low)),upperR:Math.max(...pathBounds.map(p=>p.high))};
}
function summarize(rows:ReturnType<typeof replay>[]){
  const count=(outcome:string)=>rows.filter(r=>r.outcome===outcome).length;
  const tp=count('tp'),sl=count('sl'),closed=tp+sl;
  const resolved=rows.filter(r=>['tp','sl','mixed'].includes(r.outcome));
  const grossProfitR=resolved.flatMap(r=>r.legs).filter(l=>l.outcome==='tp').reduce((a,l)=>a+l.setupR,0);
  const grossLossR=-resolved.flatMap(r=>r.legs).filter(l=>l.outcome==='sl').reduce((a,l)=>a+l.setupR,0);
  const netR=grossProfitR-grossLossR;
  const legOutcomes=Object.fromEntries(['tp','sl','uncertain','open','not-filled'].map(o=>[o,rows.flatMap(r=>r.legs).filter(l=>l.outcome===o).length]));
  assert.equal(rows.length,['tp','sl','mixed','uncertain','open','not-filled','no-valid-entry','no-size'].reduce((a,o)=>a+count(o),0));
  return {setups:rows.length,tp,sl,closed,winPercent:closed?tp/closed*100:0,lossPercent:closed?sl/closed*100:0,
    uncertain:count('uncertain'),open:count('open'),notFilled:count('not-filled'),noValidEntry:count('no-valid-entry'),noSize:count('no-size'),
    twoValidEntries:rows.filter(r=>r.validLegs===2).length,legOutcomes,grossProfitR,grossLossR,netR,
    lowerR:rows.reduce((a,r)=>a+r.lowerR,0),upperR:rows.reduce((a,r)=>a+r.upperR,0),
    grossProfitDollars:grossProfitR*4,grossLossDollars:grossLossR*4,netDollars:netR*4,
    meanR:closed?netR/closed:0};
}
function stats(rows:ReturnType<typeof replay>[]){
  const s=summarize(rows), legs=rows.flatMap(r=>r.legs);
  const slot=(r:ReturnType<typeof replay>,i:number)=>r.legs.find(l=>l.slot===i);
  const filled=(i:number)=>rows.filter(r=>slot(r,i)?.fillState==='filled').length;
  const notFilled=(i:number)=>rows.filter(r=>slot(r,i)?.fillState==='not-filled').length;
  const uncertain=(i:number)=>rows.filter(r=>slot(r,i)?.fillState==='uncertain').length;
  const absent=(i:number)=>rows.filter(r=>!slot(r,i)).length;
  const bothFilled=rows.filter(r=>slot(r,0)?.fillState==='filled'&&slot(r,1)?.fillState==='filled').length;
  const neitherFilled=rows.filter(r=>slot(r,0)?.fillState==='not-filled'&&slot(r,1)?.fillState==='not-filled').length;
  const firstOnly=rows.filter(r=>slot(r,0)?.fillState==='filled'&&slot(r,1)?.fillState==='not-filled').length;
  const secondOnly=rows.filter(r=>slot(r,1)?.fillState==='filled'&&slot(r,0)?.fillState==='not-filled').length;
  const fillUncertain=rows.filter(r=>r.legs.length===2&&r.legs.some(l=>l.fillState==='uncertain')).length;
  const invalidPair=rows.filter(r=>r.legs.length!==2).length;
  assert.equal(bothFilled+neitherFilled+firstOnly+secondOnly+fillUncertain+invalidPair,rows.length);
  assert.ok(bothFilled<=filled(0)&&bothFilled<=filled(1));
  for(const i of [0,1])assert.equal(filled(i)+notFilled(i)+uncertain(i)+absent(i),rows.length);
  const resolved=rows.filter(r=>['tp','sl','mixed'].includes(r.outcome)).flatMap(r=>r.legs);
  const wonPips=resolved.filter(l=>l.outcome==='tp').reduce((a,l)=>a+Math.abs(l.takeProfit-l.entry)/.1,0);
  const lostPips=resolved.filter(l=>l.outcome==='sl').reduce((a,l)=>a+Math.abs(l.stopLoss-l.entry)/.1,0);
  return {...s,firstFilled:filled(0),secondFilled:filled(1),firstNotFilled:notFilled(0),secondNotFilled:notFilled(1),
    firstFillUncertain:uncertain(0),secondFillUncertain:uncertain(1),firstUnavailable:absent(0),secondUnavailable:absent(1),
    bothFilled,bothFillPercent:rows.length?bothFilled/rows.length*100:0,neitherFilled,firstOnly,secondOnly,fillUncertain,invalidPair,
    wonPips,lostPips,netPips:wonPips-lostPips};
}
const october=Date.parse('2026-10-01T00:00:00Z')/1000,november=Date.parse('2026-11-01T00:00:00Z')/1000;
const group=(start:number,end:number)=>setups.filter((r:any)=>r.confirmed>=start&&r.confirmed<end);
const earlier=group(0,october),throughOctober=group(0,november),oct=group(october,november),nov=group(november,cutoff);
const oldSpec:Pair={first:10,second:25,unit:'body',expiry:75,firstShare:.6};
const evaluateOld=(g:any[],until:number)=>stats(g.map(r=>replay(r,oldSpec,until,false,'next-open')));
const old={training:evaluateOld(earlier,october),training2:evaluateOld(throughOctober,november),october:evaluateOld(oct,november),november:evaluateOld(nov,cutoff),full:evaluateOld(setups,cutoff)};
for(const k of ['tp','sl','uncertain','notFilled','noValidEntry','netR'] as const)assert.ok(Math.abs(old.full[k]-prior.original[k])<1e-7);
assert.equal(old.full.bothFilled,199);
const geometries:Pair[]=[];
const units=['body','confirmation-range','pattern-range','risk'] as const;
for(const unit of units)for(const first of [0,2.5,5,10,15,20])for(const second of [5,10,15,20,25,35,50]){
  if(second<=first)continue;
  for(const expiry of [30,75,150])geometries.push({unit,first,second,expiry});
}
const splits=[.3,.5,.6,.8];
const minFill=85,meaningful=1.2;
console.log(JSON.stringify({phase:'Rules fixed',geometries:geometries.length,variants:geometries.length*splits.length,
  selection:'At least 85% both-entry fills, win rate at least old method in training, positive conservative training R, at least 70% old resolved count; maximize training net R. A material result additionally needs 20% greater training profit at unchanged total risk. Refit on data ending October 1 and November 1, apply each choice to next month.',oldTraining:old.training.netDollars}));
function reweight(rows:ReturnType<typeof replay>[],share:number):ReturnType<typeof replay>[] {
  return rows.map((r:any)=>{
    if(!r.legs.length)return r;
    const legs=r.legs.map((l:any)=>{
      const riskShare=l.slot===0?share:1-share;
      return {...l,riskShare,setupR:l.outcome==='tp'?riskShare*l.rr:l.outcome==='sl'?-riskShare:0};
    });
    const bounds=r.boundComponents.map((components:any[])=>({low:components.reduce((a,c,i)=>a+c.low*legs[i].riskShare,0),high:components.reduce((a,c,i)=>a+c.high*legs[i].riskShare,0)}));
    return {...r,legs,netR:['tp','sl','mixed'].includes(r.outcome)?legs.reduce((a:number,l:any)=>a+l.setupR,0):0,
      lowerR:Math.min(...bounds.map((p:any)=>p.low)),upperR:Math.max(...bounds.map((p:any)=>p.high))};
  });
}
const cache=new Map<string,{first:ReturnType<typeof replay>[];second:ReturnType<typeof replay>[];full:ReturnType<typeof replay>[]}>();
const geometryKey=(p:Pair)=>[p.unit,p.first,p.second,p.expiry].join(':');
function geometry(p:Pair){
  const key=geometryKey(p),saved=cache.get(key);if(saved)return saved;
  const first=earlier.map((r:any)=>replay(r,p,october));
  const second=throughOctober.map((r:any)=>replay(r,p,november));
  const full=setups.map((r:any)=>replay(r,p,cutoff));
  const out={first,second,full};cache.set(key,out);return out;
}
const eligible=(s:ReturnType<typeof stats>,base:ReturnType<typeof stats>)=>s.bothFillPercent>=minFill&&s.winPercent>=base.winPercent-1e-8&&s.lowerR>0&&s.closed>=Math.ceil(base.closed*.7);
const compact=(s:ReturnType<typeof stats>)=>Object.fromEntries(['setups','tp','sl','closed','winPercent','netR','lowerR','upperR','netDollars','grossProfitDollars','grossLossDollars','netPips','bothFilled','bothFillPercent','firstFilled','secondFilled','secondNotFilled','secondFillUncertain','uncertain','notFilled','noValidEntry'].map(k=>[k,(s as any)[k]]));
const grid:any[]=[];
for(let i=0;i<geometries.length;i++){
  const p=geometries[i],g=geometry(p);
  if(i%25===0)console.log(`Geometry ${i+1}/${geometries.length}`);
  for(const firstShare of splits){
    const t=stats(reweight(g.first,firstShare)),t2=stats(reweight(g.second,firstShare));
    grid.push({...p,firstShare,training:compact(t),training2:compact(t2),eligible:eligible(t,old.training),eligible2:eligible(t2,old.training2),
      material:t.netR>=old.training.netR*meaningful,material2:t2.netR>=old.training2.netR*meaningful});
  }
}
function choose(second=false,requireMaterial=false,bodyOnly=false){
  const e=second?'eligible2':'eligible',m=second?'material2':'material',period=second?'training2':'training';
  return [...grid].filter(r=>r[e]&&(!requireMaterial||r[m])&&(!bodyOnly||r.unit==='body'))
    .sort((a,b)=>b[period].netR-a[period].netR||b[period].bothFillPercent-a[period].bothFillPercent||a.expiry-b.expiry)[0]??null;
}
const firstChoice=choose(),secondChoice=choose(true);
const firstMaterial=choose(false,true),secondMaterial=choose(true,true);
const bodyChoice=choose(false,false,true);
console.log(JSON.stringify({phase:'Choices frozen before monthly outcomes',firstChoice:firstChoice&&{unit:firstChoice.unit,first:firstChoice.first,second:firstChoice.second,expiry:firstChoice.expiry,share:firstChoice.firstShare},secondChoice:secondChoice&&{unit:secondChoice.unit,first:secondChoice.first,second:secondChoice.second,expiry:secondChoice.expiry,share:secondChoice.firstShare},materialFirst:!!firstMaterial,materialSecond:!!secondMaterial}));
for(let i=0;i<grid.length;i++){
  const r=grid[i],g=geometry(r),fullRows=reweight(g.full,r.firstShare);
  r.full=compact(stats(fullRows));
  // October prices end at November 1; never use November exits for October scoring.
  r.october=compact(stats(reweight(g.second.filter((row:any)=>row.confirmed>=october),r.firstShare)));
  r.november=compact(stats(fullRows.filter((row:any)=>row.confirmed>=november)));
  if(i%250===0)console.log(`Monthly evaluation ${i+1}/${grid.length}`);
}
const selectedSpecs:{label:string;spec:Pair}[]=[
  {label:'Corrected body 10/25',spec:oldSpec},
  {label:'Previous high-fill body 0/2.5',spec:{first:0,second:2.5,unit:'body',expiry:75,firstShare:.6}}];
if(firstChoice)selectedSpecs.push({label:'August\u2013September selected candidate',spec:firstChoice});
if(bodyChoice)selectedSpecs.push({label:'August\u2013September selected body-only candidate',spec:bodyChoice});
if(secondChoice)selectedSpecs.push({label:'August\u2013October selected candidate',spec:secondChoice});
const hindsight=[...grid].filter(r=>r.full.bothFillPercent>=85).sort((a,b)=>b.full.netR-a.full.netR)[0];
if(hindsight)selectedSpecs.push({label:'Full-history profit-and-fill winner (hindsight)',spec:hindsight});
const selected=selectedSpecs.map(({label,spec})=>{
  const g=geometry(spec),rows=reweight(g.full,spec.firstShare??.6),firstRows=reweight(g.first,spec.firstShare??.6),secondRows=reweight(g.second,spec.firstShare??.6);
  return {label,spec:{unit:spec.unit,first:spec.first,second:spec.second,expiry:spec.expiry,firstShare:spec.firstShare},
    training:stats(firstRows),training2:stats(secondRows),full:stats(rows),october:stats(secondRows.filter(r=>r.confirmed>=october)),november:stats(rows.filter(r=>r.confirmed>=november)),
    monthly:Object.fromEntries([...new Set(rows.map(r=>r.signalUTC.slice(0,7)))].map(month=>[month,stats(rows.filter(r=>r.signalUTC.startsWith(month)))])),
    bySide:Object.fromEntries(['bullish','bearish'].map(side=>[side,stats(rows.filter(r=>r.direction===side))])),
    minimumLotSensitivity:stats(setups.map((r:any)=>replay(r,spec,cutoff,true))),rows};
});
const selectedFirst=firstChoice&&selected.find(s=>s.label==='August\u2013September selected candidate');
const selectedSecond=secondChoice&&selected.find(s=>s.label==='August\u2013October selected candidate');
const walkForward={octoberChoice:selectedFirst?.spec,novemberChoice:selectedSecond?.spec,
  netDollars:(selectedFirst?.october.netDollars??0)+(selectedSecond?.november.netDollars??0),
  oldNetDollars:old.october.netDollars+old.november.netDollars,
  bothFilled:(selectedFirst?.october.bothFilled??0)+(selectedSecond?.november.bothFilled??0),
  oldBothFilled:old.october.bothFilled+old.november.bothFilled,eligibleSetups:oct.length+nov.length};
const baseline=stats(setups.map((r:any)=>replay(r,oldSpec,cutoff)));
assert.ok(Math.abs(baseline.netR-prior.corrected.netR)<1e-7);assert.equal(baseline.bothFilled,193);
// Cached reweighting must equal a direct replay with the same allocation.
for(const row of selected.slice(0,3)){
  const direct=stats(setups.map((r:any)=>replay(r,row.spec as Pair,cutoff)));
  assert.ok(Math.abs(direct.netR-row.full.netR)<1e-7);assert.ok(Math.abs(direct.lowerR-row.full.lowerR)<1e-7);assert.equal(direct.bothFilled,row.full.bothFilled);
}
const method={period:'August 3\u2013November 18, 2026; 235 archived qualified XAUUSD setups',
  unitDefinitions:'body=absolute final confirmation close-open; confirmation-range=its high-low including wicks; pattern-range=entire engulfing pattern high-low; risk=distance from original reference to original SL. All percentage entries are measured from original reference, BUY subtracts and SELL adds.',
  search:`${geometries.length} geometries \u00d7 4 risk splits = ${grid.length} variants. First 0/2.5/5/10/15/20%, second 5/10/15/20/25/35/50% and greater than first. Four units. Entry deadlines 30/75/150 minutes. First risk share 30/50/60/80%, remainder second. Original SL/TP and fixed $4 total setup risk unchanged.`,
  selection:'Maximize training net R among candidates with >=85% both-filled setups, win rate >= old training win rate, positive pessimistic training R bound, and >=70% old resolved count. Material threshold=at least 20% more training profit than old. Choices frozen at October 1 and November 1 and evaluated on the next month.',
  chronology:'Training outcomes are truncated at each boundary; only closed candles available by that boundary are used. Open trades are not carried between monthly folds. This expanding-window strategy comparison reuses previously reviewed historical data; it is not a pristine unseen test.',
  dollarModel:'Ideal fractional lots, fixed $4 total setup risk with specified allocation, no compounding. Changing allocation never increases total risk. Excludes fees, spread, slippage, margin, daily-loss restrictions, half-risk overlap adjustments and maximum-open-trade limits. Entire uncertain/open setups excluded from main P&L; pessimistic and optimistic bounds also retained.',
  brokerSizing:'Separate sensitivity: current Exness XAUUSDm contract 100 oz, .01-lot minimum and step, rounded down; if split cannot fit, skip first and retry second with full $4 budget. It is sizing sensitivity, not executable broker P&L.',
  fillModel:'Existing exhaustive OHLC ordering helper. A fill needs agreement across possible paths; fills and exits have separate uncertainty. Original TP/SL touch retires unfilled orders even before entry deadline. Missing history stays uncertain.',
  counting:'Both-fill percentage divides by all archived qualifying setups, including invalid/missing-data setups. TP/SL percentages divide by resolved setups only. 1 gold pip=.10 price units, pips are unweighted totals of filled legs in fully resolved setups.',
  limitations:'Repeated selection across many variants increases overfitting. Some variants can alter which ambiguous setups are excluded, so gross profit alone can mislead. One instrument and a short, SELL-heavy sample. No live source, account settings, or positions changed.',
  hashes:Object.fromEntries(files.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex')]))};
fs.writeFileSync(new URL(`${stem}.json`,root),JSON.stringify({method,old,walkForward,eligibleFirst:grid.filter(r=>r.eligible).length,materialFirst:grid.filter(r=>r.eligible&&r.material).length,eligibleSecond:grid.filter(r=>r.eligible2).length,materialSecond:grid.filter(r=>r.eligible2&&r.material2).length,selected,grid},null,2)+'\n');
const head=['unit','first','second','expiryMinutes','firstRiskShare','eligibleTraining1','materialTraining1','eligibleTraining2','materialTraining2','train1BothFillPercent','train1NetDollars','train2BothFillPercent','train2NetDollars','octoberBothFillPercent','octoberNetDollars','novemberBothFillPercent','novemberNetDollars','fullBothFillPercent','fullTP','fullSL','fullWinPercent','fullNetDollars','fullNetPips','fullExitUncertain'];
fs.writeFileSync(new URL(`${stem}.csv`,root),[head.join(','),...grid.map(r=>[r.unit,r.first,r.second,r.expiry,r.firstShare,r.eligible,r.material,r.eligible2,r.material2,r.training.bothFillPercent,r.training.netDollars,r.training2.bothFillPercent,r.training2.netDollars,r.october.bothFillPercent,r.october.netDollars,r.november.bothFillPercent,r.november.netDollars,r.full.bothFillPercent,r.full.tp,r.full.sl,r.full.winPercent,r.full.netDollars,r.full.netPips,r.full.uncertain].join(','))].join('\n')+'\n');
fs.writeFileSync(new URL(`${stem}-selected-trades.csv`,root),['label,signalUTC,direction,slot,entry,sl,tp,rr,riskShare,fillState,outcome,setupR',...selected.flatMap(s=>s.rows.flatMap(r=>r.legs.map(l=>[s.label,r.signalUTC,r.direction,l.slot+1,l.entry,l.stopLoss,l.takeProfit,l.rr,l.riskShare,l.fillState,l.outcome,l.setupR].join(','))))].join('\n')+'\n');
console.log(JSON.stringify({variants:grid.length,walkForward,selected:selected.map(s=>({label:s.label,spec:s.spec,full:compact(s.full),october:compact(s.october),november:compact(s.november),minimumLot:s.minimumLotSensitivity.closed}))},null,2));
