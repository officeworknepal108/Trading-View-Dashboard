// Offline research: archived prices in, study reports out. No trading calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scalpPullbackBarStates } from '../src/services/scalpOneToOne';

const root=new URL('./',import.meta.url), stem='scalp-both-entry-fill-study-2026-11-20';
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
  return {...r,time,confirmed,sign,stop,reference,nextOpen:next.open,target,body:Math.abs(candle.close-candle.open)};
});

type Pair={first:number;second:number};
function replay(r:any,p:Pair,until:number,brokerLots=false,anchor:'reference'|'next-open'='reference'){
  const base={signalUTC:r.signalUTC,direction:r.direction,confirmed:r.confirmed};
  if(r.missing||r.confirmed>=until)return {...base,outcome:'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0,validLegs:0};
  let signals=[p.first,p.second].flatMap((percent,i)=>{
    const entry=(anchor==='reference'?r.reference:r.nextOpen)-r.sign*r.body*percent/100,risk=r.sign*(entry-r.stop),reward=r.sign*(r.target-entry);
    if(!(risk>1e-8&&risk<=30.000001&&reward>0))return [];
    if(anchor==='reference')assert.ok(reward/risk>=1-1e-8);
    return [{direction:r.sign===1?'BUY':'SELL',entry,stopLoss:r.stop,takeProfit:r.target,
      percent,slot:i,riskShare:i===0?.6:.4,rr:reward/risk,risk,volume:null as number|null}];
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
    const paths=states.flatMap(s=>s.exit?[s]:scalpPullbackBarStates(b,signals as any,s.mask,b.time<r.confirmed+4500));
    states=[...new Map(paths.map(s=>[`${s.mask}:${s.exit}`,s])).values()];
    if(states.every(s=>s.exit||!s.mask&&b.time+900>=r.confirmed+4500))break;
  }
  const legs=signals.map((s,i)=>{
    const options=[...new Set(states.map(p=>p.exit===2?'uncertain':!(p.mask&(1<<i))?'not-filled':p.exit===1?'tp':p.exit===-1?'sl':'open'))];
    const outcome=options.length===1?options[0]:'uncertain';
    const fillState=states.every(p=>(p.mask&(1<<i))!==0)?'filled':states.every(p=>!(p.mask&(1<<i))&&p.exit!==2&&(p.exit!==0||until>=r.confirmed+4500))?'not-filled':'uncertain';
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
  return {...base,outcome,validLegs,legs,
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
  const fillUncertain=rows.filter(r=>r.legs.some(l=>l.fillState==='uncertain')).length;
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
const evaluate=(p:Pair,group:any[],until:number,anchor:'reference'|'next-open'='reference',broker=false)=>stats(group.map(r=>replay(r,p,until,broker,anchor)));
const train=setups.filter((r:any)=>r.confirmed<split),validation=setups.filter((r:any)=>r.confirmed>=split);
const currentPair={first:10,second:25};
const currentTraining=evaluate(currentPair,train,split),currentFull=evaluate(currentPair,setups,cutoff);
const oldFull=evaluate(currentPair,setups,cutoff,'next-open');
for(const [computed,saved] of [[oldFull,prior.original],[currentFull,prior.corrected]] as const){
  for(const k of ['tp','sl','uncertain','notFilled','noValidEntry','netR'] as const)assert.ok(Math.abs(computed[k]-saved[k])<1e-7,`Prior parity ${k}`);
}
assert.equal(oldFull.secondFilled,199);assert.equal(currentFull.secondFilled,193);
const pairs:Pair[]=[];
for(let first=0;first<=25;first+=2.5)for(let second=first+2.5;second<=50;second+=2.5)pairs.push({first,second});
assert.equal(pairs.length,165);
const minimumClosed=Math.ceil(currentTraining.closed*.7);
console.log(JSON.stringify({phase:'Predeclared training selection',pairs:pairs.length,
  rules:'For each 85%, 90%, 95% both-fill threshold, maximize training net R subject to training win rate at least corrected 10/25, positive pessimistic training R, and at least 70% of its closed trades. Freeze choices before later-period evaluation.',
  minimumClosed,baselineTraining:currentTraining}));
const training=pairs.map((p,i)=>{
  const t=evaluate(p,train,split);
  if(i%30===0)console.log(`Train ${i+1}/${pairs.length}`);
  return {...p,training:t,eligible:t.closed>=minimumClosed&&t.winPercent>=currentTraining.winPercent-1e-8&&t.lowerR>0};
});
const candidates=training.filter(r=>r.eligible);
const selections:{label:string;first:number;second:number;anchor:'reference'|'next-open'}[]=[
  {label:'Old next-open 10/25',...currentPair,anchor:'next-open'},
  {label:'Corrected reference 10/25',...currentPair,anchor:'reference'},
  {label:'Earlier reference 0/70 candidate',first:0,second:70,anchor:'reference'}];
const targets=[85,90,95].map(target=>{
  const eligible=candidates.filter(r=>r.training.bothFillPercent>=target);
  const winner=[...eligible].sort((a,b)=>b.training.netR-a.training.netR||b.training.bothFillPercent-a.training.bothFillPercent)[0];
  if(winner)selections.push({label:`Training choice: at least ${target}% both filled`,first:winner.first,second:winner.second,anchor:'reference'});
  return {target,eligible:eligible.length,pair:winner?{first:winner.first,second:winner.second}:null};
});
const maxFill=[...candidates].sort((a,b)=>b.training.bothFillPercent-a.training.bothFillPercent||b.training.netR-a.training.netR)[0];
if(maxFill)selections.push({label:'Training choice: maximum both-entry fill',first:maxFill.first,second:maxFill.second,anchor:'reference'});
console.log(JSON.stringify({phase:'Training selections frozen',targets,selections}));
const grid=training.map((r,i)=>{
  if(i%30===0)console.log(`Later-period check ${i+1}/${training.length}`);
  return {...r,validation:evaluate(r,validation,cutoff),full:evaluate(r,setups,cutoff)};
});
// Descriptive compromise uses all dates and must not be described as an unseen test.
const compromise=[...grid].filter(r=>r.full.bothFilled>=oldFull.bothFilled)
  .sort((a,b)=>b.full.netR-a.full.netR)[0];
if(compromise)selections.push({label:'Full-history compromise (hindsight)',first:compromise.first,second:compromise.second,anchor:'reference'});
const selected=selections.map(s=>{
  const rows=setups.map((r:any)=>replay(r,s,cutoff,false,s.anchor));
  const full=stats(rows);
  const training=evaluate(s,train,split,s.anchor),val=evaluate(s,validation,cutoff,s.anchor);
  const bySide=Object.fromEntries(['bullish','bearish'].map(side=>[side,stats(rows.filter(r=>r.direction===side))]));
  const monthly=Object.fromEntries([...new Set(rows.map(r=>r.signalUTC.slice(0,7)))].map(month=>[month,stats(rows.filter(r=>r.signalUTC.startsWith(month)))]));
  return {...s,training,validation:val,full,bySide,monthly,minimumLotSensitivity:evaluate(s,setups,cutoff,s.anchor,true),rows};
});
const method={source:archive.method.source,firstCandleUTC:archive.method.firstCandleUTC,throughUTC:archive.method.throughUTC,
  grid:'165 reference-anchored pairs; first 0–25%, second greater than first through 50%, at 2.5 percentage-point steps. Percentage of final confirmation candle BODY, not whole pattern/wicks.',
  invariant:'Original fixed SL/TP, 60/40 risk split, 75-minute entry deadline, same 235 qualified setups. BUY entries below and SELL above reference. Old method is retained as next-open-anchored comparator.',
  fills:'Both-filled requires both entries confirmed on every allowed OHLC path. Fill certainty is separate from exit certainty. Denominator is every eligible archived setup, including missing-data setups, not only winning or filled trades.',
  selection:'August–September training only. For 85%, 90%, 95% both-fill targets, maximize known-result net R, requiring at least baseline training win rate, positive pessimistic training R bound and 70% of baseline closed-trade count. Also report maximum training fill rate under those safeguards.',
  validation:'October 1–November 18 chronological comparison, 111 setups; training 124 setups ends at October 1. The same later-period data were reviewed in earlier studies, so this is reused validation and not independent unseen evidence.',
  cash:'Illustrative fixed $4 total risk per setup, 60/40 allocation, ideal fractional lots, no compounding. Entire uncertain/open setup outcomes excluded from main P&L. No spread, fees, slippage, margin, overlap risk reductions, daily limits or concurrent-order constraints. Current Exness minimum/step .01 and contract 100 oz are checked separately with second-only fallback.',
  pips:'1 gold pip=.10 price units; unweighted sum over filled legs in entirely resolved setups. Dollar totals use risk-based sizing, so pips and dollars are different measures.',
  uncertainty:'TP/SL and win rate exclude uncertain exits, unfilled and invalid entries. Lower/upper R bounds retain unresolved outcomes conservatively. Trades sharing candles can be correlated; bounds are loose rather than jointly executable price paths.',
  limits:'One instrument, one historical sample, repeated percentage searches. Full-history compromise is picked after seeing all dates, maximizing profit among pairs with at least the old method both-fill count; it is hindsight and not independent validation. More fills also include more losing trades. No reliable future optimum is established. No trading source or settings changed.',
  hashes:Object.fromEntries(files.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex')]))};
fs.writeFileSync(new URL(`${stem}.json`,root),JSON.stringify({method,targets,selected,grid},null,2)+'\n');
const header=['firstPercent','secondPercent','trainingEligible','trainBothFilled','trainBothFillPercent','trainNetDollars','trainWinPercent','laterBothFilled','laterBothFillPercent','laterNetDollars','laterWinPercent','fullBothFilled','fullBothFillPercent','fullSecondFilled','fullSecondNotFilled','fullSecondFillUncertain','fullInvalidPair','fullTP','fullSL','fullWinPercent','fullNetDollars','fullNetPips','fullExitUncertain'];
fs.writeFileSync(new URL(`${stem}.csv`,root),[header.join(','),...grid.map(r=>[r.first,r.second,r.eligible,r.training.bothFilled,r.training.bothFillPercent,r.training.netDollars,r.training.winPercent,r.validation.bothFilled,r.validation.bothFillPercent,r.validation.netDollars,r.validation.winPercent,r.full.bothFilled,r.full.bothFillPercent,r.full.secondFilled,r.full.secondNotFilled,r.full.secondFillUncertain,r.full.invalidPair,r.full.tp,r.full.sl,r.full.winPercent,r.full.netDollars,r.full.netPips,r.full.uncertain].join(','))].join('\n')+'\n');
const trades=['label,firstPercent,secondPercent,signalUTC,direction,entrySlot,entry,sl,tp,rr,fillState,outcome,setupR',...selected.flatMap(s=>s.rows.flatMap(r=>r.legs.map(l=>[s.label,s.first,s.second,r.signalUTC,r.direction,l.slot+1,l.entry,l.stopLoss,l.takeProfit,l.rr,l.fillState,l.outcome,l.setupR].join(','))))];
fs.writeFileSync(new URL(`${stem}-selected-trades.csv`,root),trades.join('\n')+'\n');
console.log(JSON.stringify({targets,selected:selected.map(s=>({label:s.label,first:s.first,second:s.second,training:{bothFillPercent:s.training.bothFillPercent,netDollars:s.training.netDollars},validation:{bothFillPercent:s.validation.bothFillPercent,netDollars:s.validation.netDollars},full:s.full}))},null,2));
