// Offline research: archived prices in, study reports out. No trading calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scalpPullbackBarStates } from '../src/services/scalpOneToOne';

const root=new URL('./',import.meta.url), stem='scalp-entry-percentage-study-2026-11-20';
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
  return {...r,time,confirmed,sign,stop,reference,target,body:Math.abs(candle.close-candle.open)};
});

type Pair={first:number;second:number};
function replay(r:any,p:Pair,until:number,brokerLots=false){
  const base={signalUTC:r.signalUTC,direction:r.direction,confirmed:r.confirmed};
  if(r.missing||r.confirmed>=until)return {...base,outcome:'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0,validLegs:0};
  let signals=[p.first,p.second].flatMap((percent,i)=>{
    const entry=r.reference-r.sign*r.body*percent/100,risk=r.sign*(entry-r.stop),reward=r.sign*(r.target-entry);
    if(!(risk>1e-8&&risk<=30.000001&&reward>0))return [];
    assert.ok(reward/risk>=1-1e-8);
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
const evaluate=(p:Pair,group:any[],until:number,broker=false)=>summarize(group.map(r=>replay(r,p,until,broker)));
const train=setups.filter((r:any)=>r.confirmed<split),validation=setups.filter((r:any)=>r.confirmed>=split);
const baselinePair={first:10,second:25};
const baselineFull=evaluate(baselinePair,setups,cutoff);
for(const key of ['tp','sl','uncertain','notFilled','noValidEntry','netR'] as const)assert.ok(Math.abs(baselineFull[key]-prior.corrected[key])<1e-7,`10/25 baseline ${key}`);
const baselineTrain=evaluate(baselinePair,train,split);
const pairs:Pair[]=[];
for(let first=0;first<=50;first+=5)for(let second=first+5;second<=100;second+=5)pairs.push({first,second});
assert.equal(pairs.length,165);
const minimumClosed=Math.ceil(baselineTrain.closed*.7),minimumTwoValid=Math.ceil(train.filter((r:any)=>!r.missing).length*.9);
console.log(JSON.stringify({phase:'selection rules fixed before grid',trainingSetups:train.length,validationSetups:validation.length,candidates:pairs.length,minimumClosed,minimumTwoValid}));
const training=pairs.map((p,i)=>{
  const stats=evaluate(p,train,split);
  if(i%20===0)console.log(`Training ${i+1}/${pairs.length}`);
  return {...p,training:stats,eligible:stats.closed>=minimumClosed&&stats.twoValidEntries>=minimumTwoValid};
});
const eligible=training.filter(r=>r.eligible);
assert.ok(eligible.length>2);
const percentile=(value:number,key:'netR'|'winPercent'|'lowerR')=>eligible.filter(r=>r.training[key]<=value).length/eligible.length;
const ranked=eligible.map(r=>({...r,score:(percentile(r.training.lowerR,'lowerR')+percentile(r.training.winPercent,'winPercent'))/2}));
const selectedProfit=[...ranked].sort((a,b)=>b.training.netR-a.training.netR)[0];
const selectedWin=[...ranked].sort((a,b)=>b.training.winPercent-a.training.winPercent||b.training.netR-a.training.netR)[0];
const selectedBalanced=[...ranked].sort((a,b)=>b.score-a.score||b.training.lowerR-a.training.lowerR)[0];
// Freeze all candidate choices using August/September only, then evaluate later prices.
const selections=[{label:'Current corrected 10/25',...baselinePair},
  {label:'Highest training profit',first:selectedProfit.first,second:selectedProfit.second},
  {label:'Highest training win rate',first:selectedWin.first,second:selectedWin.second},
  {label:'Balanced training score',first:selectedBalanced.first,second:selectedBalanced.second}];
console.log(JSON.stringify({phase:'choices frozen before validation',selections}));
const results=training.map((r,i)=>{
  const val=evaluate(r,validation,cutoff),full=evaluate(r,setups,cutoff);
  if(i%30===0)console.log(`Validation ${i+1}/${training.length}`);
  return {...r,validation:val,full};
});
// Full-history winner is descriptive hindsight, separate from training choices.
const hindsight=[...results].sort((a,b)=>b.full.netR-a.full.netR)[0];
const reportedSelections=[...selections,{label:'Highest full-history profit (hindsight)',first:hindsight.first,second:hindsight.second}];
const selected=reportedSelections.map(s=>{
  const match=results.find(r=>r.first===s.first&&r.second===s.second)!;
  const allRows=setups.map((r:any)=>replay(r,s,cutoff));
  return {...s,training:match.training,validation:match.validation,full:match.full,
    bySide:Object.fromEntries(['bullish','bearish'].map(side=>[side,summarize(allRows.filter(r=>r.direction===side))])),
    monthly:Object.fromEntries([...new Set(allRows.map(r=>r.signalUTC.slice(0,7)))].map(month=>[month,summarize(allRows.filter(r=>r.signalUTC.startsWith(month)))])),
    minimumLotSensitivity:evaluate(s,setups,cutoff,true),rows:allRows};
});
const method={
  source:archive.method.source,firstCandleUTC:archive.method.firstCandleUTC,throughUTC:archive.method.throughUTC,
  training:'August 3 through September 30, 2026; training outcomes truncated at October 1 00:00 UTC',
  validation:'October 1 through November 18 02:00 UTC, 2026; no training setups carried into validation',
  candidates:'165 pairs. First entry 0–50%, second entry greater than first through 100%, both in 5-percentage-point increments. Percent of confirmation body measured from original reference. 0% means reference entry.',
  unchanged:'Original fixed SL/TP, BUY lower and SELL higher, 60/40 total-risk allocation, 75-minute entry window, archived qualifying signals, 300-pip per-leg maximum. Invalid entries beyond SL are skipped; unused risk is not transferred in ideal sizing.',
  selection:`Before grid results: at least ${minimumClosed} resolved training setups (70% of baseline), at least ${minimumTwoValid} training setups with both geometrically valid entries (90% of available setups). Profit winner maximizes certain-result net R. Win winner maximizes setup win rate. Balanced score averages training percentile rank for conservative lower-bound net R and win rate.`,
  counting:'One signal is one setup. TP/SL needs at least one definitely filled leg and no uncertain leg outcome. Percentages exclude uncertain/open/unfilled/no-entry setups. Whole uncertain/open setups excluded from main dollar totals. Also report loose pessimistic/optimistic R bounds for unresolved OHLC paths.',
  dollars:'Illustrative $200 capital, fixed $4 setup risk, no compounding. Ideal fractional lots; no spreads, fees, slippage, margin, daily-loss limits, concurrent-trade caps or half-risk overlap adjustments. Cash is gross research P&L, not executable account returns.',
  minimumLotSensitivity:'Separate sizing-only sensitivity uses current Exness XAUUSDm contract 100 oz, .01 minimum/step, fixed $4 budget. If either split lot is too small, skip first and try second with full budget, rounded down. Not a broker replay: bid/ask, tick rounding, commissions, margin and account-level controls are not modeled.',
  limits:'Exploratory historical tuning on one instrument and 235 archived qualified setups. Later-period validation is a chronological check, not pristine independent unseen data: the baseline was already reviewed. Many parameter comparisons increase selection bias. No future performance guarantee or live strategy change.',
  inputHashes:Object.fromEntries(files.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex')]))};
fs.writeFileSync(new URL(`${stem}.json`,root),JSON.stringify({method,baselineFull,eligibleCandidates:eligible.length,selected,grid:results},null,2)+'\n');
const columns=['first','second','eligible','trainTP','trainSL','trainWinPercent','trainNetDollars','trainLowerR','validationTP','validationSL','validationWinPercent','validationNetDollars','fullTP','fullSL','fullWinPercent','fullGrossProfitDollars','fullGrossLossDollars','fullNetDollars','fullUncertain','fullNotFilled','fullNoValidEntry','fullLowerR','fullUpperR'];
const csv=[columns.join(','),...results.map(r=>[r.first,r.second,r.eligible,r.training.tp,r.training.sl,r.training.winPercent,r.training.netDollars,r.training.lowerR,r.validation.tp,r.validation.sl,r.validation.winPercent,r.validation.netDollars,r.full.tp,r.full.sl,r.full.winPercent,r.full.grossProfitDollars,r.full.grossLossDollars,r.full.netDollars,r.full.uncertain,r.full.notFilled,r.full.noValidEntry,r.full.lowerR,r.full.upperR].join(','))].join('\n')+'\n';
fs.writeFileSync(new URL(`${stem}.csv`,root),csv);
const selectedCsv=['label,firstPercent,secondPercent,signalUTC,direction,slot,entryPercent,entry,sl,tp,rr,outcome,setupR',...selected.flatMap(s=>s.rows.flatMap(r=>r.legs.map(l=>[s.label,s.first,s.second,r.signalUTC,r.direction,l.slot+1,l.percent,l.entry,l.stopLoss,l.takeProfit,l.rr,l.outcome,l.setupR].join(','))))].join('\n')+'\n';
fs.writeFileSync(new URL(`${stem}-selected-trades.csv`,root),selectedCsv);
console.log(JSON.stringify({eligibleCandidates:eligible.length,selected:selected.map(s=>({label:s.label,first:s.first,second:s.second,full:s.full,validation:s.validation}))},null,2));
