// Validation of predeclared research candidates. No trading/server/settings calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {runVolumeStudy} from '../src/services/volumeEngulfingStudy';
import {scalpOneToOneVolumePasses} from '../src/services/mt5Automation';
import {replay,stats,setups,cutoff as oldCutoff, type Spec} from './scalp-validation-model-2026-11-20';

const root=new URL('./',import.meta.url),stem='scalp-selected-rule-validation-2026-11-20';
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const write=(name:string,value:any)=>fs.writeFileSync(new URL(name,root),JSON.stringify(value,null,2)+'\n');
const freshStem='scalp-fresh-data-2026-11-20';
const coverage=read(`${freshStem}-coverage.json`),candles:any={};
for(const tf of ['M1','M15','H1','H4']){
  const rows=read(`${freshStem}-${tf}.json`);
  for(const b of rows)assert.ok([b.time,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close,b.high));
  assert.equal(new Set(rows.map((b:any)=>b.time)).size,rows.length);
  candles[tf]=rows;
}
const freshM1=candles.M1.filter((b:any)=>b.complete!==false),freshEnd=freshM1.at(-1).time+60;
const m1Index=new Map<number,number>(freshM1.map((b:any,i:number)=>[b.time,i]));
const freshExecution={bars:freshM1,index:m1Index,seconds:60};
const freshM15=candles.M15.filter((b:any)=>b.complete!==false&&b.time+900<=freshEnd);
const m15Index=new Map<number,number>(freshM15.map((b:any,i:number)=>[b.time,i]));
const m15Execution={bars:freshM15,index:m15Index,seconds:900};
const m15ByTime=new Map<number,any>(candles.M15.map((b:any)=>[b.time,b]));

// Candidates frozen in commentary before inspecting fresh qualified trade outcomes.
const profile=(name:string,first:number,second:number,share:number,expiry:number,anchor?:'next-open'):Spec['profile']=>({name,first,second,share,expiry,anchor});
const candidates:{id:string;role:string;spec:Spec}[]=[
  {id:'old',role:'Existing-method comparator',spec:{profile:profile('Old next-open 10/25',10,25,.6,75,'next-open'),targets:[1,1],cancel:'original-target'}},
  {id:'corrected',role:'Corrected-reference control',spec:{profile:profile('Corrected reference 10/25',10,25,.6,75),targets:[1,1],cancel:'original-target'}},
  {id:'entry-only',role:'Entry/deadline/allocation control',spec:{profile:profile('Reference 0/10, 30/70',0,10,.3,30),targets:[1,1],cancel:'new-target'}},
  {id:'primary',role:'Primary candidate fixed before fresh outcomes',spec:{profile:profile('Reference 0/10, 30/70',0,10,.3,30),targets:[1.25,1.25],cancel:'new-target'}},
  {id:'larger-target',role:'Higher-target control, not eligible to replace primary using fresh outcomes',spec:{profile:profile('Reference 0/10, 30/70',0,10,.3,30),targets:[1.5,1.5],cancel:'new-target'}},
];
const planName=`${stem}-frozen-plan.json`;
if(fs.existsSync(new URL(planName,root))){
  const saved=read(planName);
  assert.equal(JSON.stringify(saved.candidates),JSON.stringify(candidates),'Verification reruns cannot alter the frozen candidate set');
  assert.equal(saved.primary,'primary');
}else write(planName,{createdUTC:new Date().toISOString(),primary:'primary',freshStartUTC:new Date(oldCutoff*1000).toISOString(),freshEndUTC:new Date(freshEnd*1000).toISOString(),candidates,
  rule:'Primary was announced in conversation before first fresh qualification. This file records the plan, not independent timestamp proof. No choice of a new winning setting based on fresh outcomes. Report primary even if it loses. Same strategy qualification filters. Compare frozen historical, fresh M1 and fresh M15 outcomes; retain uncertain and open cases.'});
console.log(JSON.stringify({phase:'Candidates frozen; qualify fresh setups only',freshStart:new Date(oldCutoff*1000).toISOString(),freshEnd:new Date(freshEnd*1000).toISOString()}));

const lookup=Math.min(8000,candles.M15.filter((b:any)=>b.complete!==false&&b.time+900>=oldCutoff).length+5);
const study=runVolumeStudy({symbol:'XAUUSD',timeframe:'M15',biasTimeframe:'H4',h4EmaFilter:true,h1TrendlineFilter:true,
  cutoff:freshEnd,lookback:lookup,candles},(done,total)=>{if(done%100===0)console.log(`Fresh qualification ${done}/${total}`);});
const freshRecords=study.records.filter(r=>r.confirmedAt>=oldCutoff&&scalpOneToOneVolumePasses(r.signal.type,r.v1,r.v2,r.v3));
const freshSetups=freshRecords.map(r=>{
  const confirmation=m15ByTime.get(r.signal.time),next=m15ByTime.get(r.confirmedAt);
  assert.ok(confirmation&&confirmation.complete!==false&&confirmation.time+900<=freshEnd);
  const common={signalUTC:new Date(r.signal.time*1000).toISOString(),time:r.signal.time,confirmed:r.confirmedAt,direction:r.signal.direction,type:r.signal.type,
    v1:r.v1,v2:r.v2,v3:r.v3,group:r.group};
  if(!next)return {...common,missing:true};
  return {...common,sign:r.signal.direction==='bullish'?1:-1,reference:r.levels.entry,stop:r.levels.stopLoss,target:r.levels.takeProfit,nextOpen:next.open,
    body:Math.abs(confirmation.close-confirmation.open),confirmationRange:confirmation.high-confirmation.low};
});
assert.equal(new Set(freshSetups.map(r=>r.signalUTC)).size,freshSetups.length);
assert.ok(freshSetups.every(r=>r.confirmed>=oldCutoff));
assert.ok(freshSetups.every(r=>!setups.some((old:any)=>old.signalUTC===r.signalUTC)),'Fresh setup dates cannot duplicate old study setups');
let causalChecks=0;
for(const record of freshRecords){
  const asOf=record.confirmedAt+1;
  const truncated:any={};
  for(const [tf,seconds] of [['M15',900],['H1',3600],['H4',14400]] as const){
    truncated[tf]=candles[tf].filter((b:any)=>b.time<=asOf).map((b:any)=>b.time+seconds<=asOf?{...b,complete:true}:
      {...b,high:b.open,low:b.open,close:b.open,volume:0,complete:false});
  }
  const atSignal=runVolumeStudy({symbol:'XAUUSD',timeframe:'M15',biasTimeframe:'H4',h4EmaFilter:true,h1TrendlineFilter:true,cutoff:asOf,lookback:2,candles:truncated});
  const matching=atSignal.records.find(r=>r.signal.time===record.signal.time&&r.signal.direction===record.signal.direction&&r.signal.type===record.signal.type);
  assert.ok(matching,'A fresh qualification must exist without any later candle data');
  for(const key of ['entry','stopLoss','takeProfit'] as const)assert.ok(Math.abs(matching!.levels[key]-record.levels[key])<1e-7,'Qualified original levels cannot depend on future candles');
  causalChecks++;
}
write(`${stem}-fresh-qualified-setups.json`,{source:'TradingView OANDA:XAUUSD',from:oldCutoff,to:freshEnd,records:freshRecords,setups:freshSetups,warnings:study.warnings});
console.log(JSON.stringify({phase:'Fresh setup qualification complete',setups:freshSetups.length,causalChecks,warnings:study.warnings}));

// Check M1 aggregation against matching closed M15 bars rather than mixing providers.
const agreement=[];
for(const b of freshM15.filter((b:any)=>b.time>=oldCutoff)){
  const rows=[];
  for(let t=b.time;t<b.time+900;t+=60){const i=m1Index.get(t);if(i!==undefined)rows.push(freshM1[i]);}
  if(rows.length!==15){agreement.push({time:b.time,complete:false});continue;}
  const aggregate={open:rows[0].open,high:Math.max(...rows.map(r=>r.high)),low:Math.min(...rows.map(r=>r.low)),close:rows.at(-1).close};
  const maxDifference=Math.max(...(['open','high','low','close'] as const).map(k=>Math.abs(aggregate[k]-b[k])));
  agreement.push({time:b.time,complete:true,maxDifference,withinTolerance:maxDifference<=.02});
}
const disagreements=agreement.filter(r=>r.complete&&!r.withinTolerance);
const priceAgreement={checked:agreement.length,complete:agreement.filter(r=>r.complete).length,incomplete:agreement.filter(r=>!r.complete).length,disagreements:disagreements.length,
  maxDifference:Math.max(0,...agreement.map(r=>r.maxDifference??0)),tolerance:.02,rows:agreement};
console.log(JSON.stringify({phase:'Price resolution check',...priceAgreement,rows:undefined}));

function metrics(rows:ReturnType<typeof replay>[]){
  const summary=stats(rows),resolved=rows.filter(r=>['tp','sl','mixed'].includes(r.outcome));
  const pnlByExit=new Map<number,number>(),tradeReturns:number[]=[],holdingMinutes:number[]=[];
  for(const row of resolved){
    tradeReturns.push(row.netR*4);
    for(const leg of row.legs){
      if(!['tp','sl'].includes(leg.outcome))continue;
      assert.ok(leg.closedAt!==undefined,'Resolved legs require known close-bar time');
      pnlByExit.set(leg.closedAt!, (pnlByExit.get(leg.closedAt!)??0)+leg.setupR*4);
      if(leg.openedAt!==undefined)holdingMinutes.push((leg.closedAt!-leg.openedAt)/60);
    }
  }
  let equity=0,peak=0,drawdown=0,maxLosingBars=0,losingBars=0;
  const equityCurve=[...pnlByExit.entries()].sort((a,b)=>a[0]-b[0]).map(([time,pnl])=>{
    equity+=pnl;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity);
    losingBars=pnl<0?losingBars+1:pnl>0?0:losingBars;maxLosingBars=Math.max(maxLosingBars,losingBars);
    return {time,pnl,equity};
  });
  assert.ok(Math.abs(equity-summary.netDollars)<1e-7,'Exit-bar cash curve reconciles with headline net');
  const profitFactor=summary.grossLossDollars?summary.grossProfitDollars/summary.grossLossDollars:null;
  return {...summary,realizedExitBarDrawdownDollars:drawdown,maxConsecutiveLosingExitBars:maxLosingBars,profitFactor,
    maxSetupLoss:tradeReturns.length?Math.min(...tradeReturns):null,maxSetupProfit:tradeReturns.length?Math.max(...tradeReturns):null,
    netAfterRemovingBestSetup:tradeReturns.length?summary.netDollars-Math.max(...tradeReturns):summary.netDollars,
    meanHoldingMinutes:holdingMinutes.length?holdingMinutes.reduce((a,b)=>a+b,0)/holdingMinutes.length:null,
    maxHoldingMinutes:holdingMinutes.length?Math.max(...holdingMinutes):null,equityCurve};
}
function sizing(spec:Spec,rows:any[],budget=4){
  let splitFits=0,secondOnlyFits=0,noneFits=0,invalid=0;
  const lot=(cash:number,risk:number)=>Math.floor((cash/(100*risk)+1e-10)/.01)*.01;
  for(const r of rows){
    if(r.missing){invalid++;continue;}
    const risks=[spec.profile.first,spec.profile.second].map(p=>r.sign*((spec.profile.anchor==='next-open'?r.nextOpen:r.reference)-r.sign*r.body*p/100-r.stop));
    if(risks.some(v=>v<=0)){invalid++;continue;}
    const first=lot(budget*spec.profile.share,risks[0]),second=lot(budget*(1-spec.profile.share),risks[1]);
    if(first>=.01-1e-9&&second>=.01-1e-9)splitFits++;
    else if(lot(budget,risks[1])>=.01-1e-9)secondOnlyFits++;
    else noneFits++;
  }return {budget,splitFits,secondOnlyFits,noneFits,invalid,contractOz:100,minLot:.01,lotStep:.01};
}
const results=candidates.map(c=>{
  const historyRows=setups.map((r:any)=>replay(r,c.spec,oldCutoff));
  const m1Rows=freshSetups.map(r=>replay(r,c.spec,freshEnd,freshExecution));
  const m15Rows=freshSetups.map(r=>replay(r,c.spec,Math.floor(freshEnd/900)*900,m15Execution));
  const resolutionAgreement={setups:freshSetups.length,sameSetupOutcome:m1Rows.filter((r,i)=>r.outcome===m15Rows[i].outcome).length,
    sameNetR:m1Rows.filter((r,i)=>Math.abs(r.netR-m15Rows[i].netR)<1e-7).length};
  return {...c,history:metrics(historyRows),freshM1:metrics(m1Rows),freshM15:metrics(m15Rows),
    historyMonthly:Object.fromEntries([...new Set(historyRows.map(r=>r.signalUTC.slice(0,7)))].map(month=>[month,metrics(historyRows.filter(r=>r.signalUTC.startsWith(month)))])),
    historyBySide:Object.fromEntries(['bullish','bearish'].map(side=>[side,metrics(historyRows.filter(r=>r.direction===side))])),
    resolutionAgreement,freshSizing:sizing(c.spec,freshSetups),historicalSizing:sizing(c.spec,setups),historyRows,freshM1Rows:m1Rows,freshM15Rows:m15Rows};
});
const primary=results.find(r=>r.id==='primary')!,old=results.find(r=>r.id==='old')!;
assert.ok(Math.abs(primary.history.netDollars-213.3204096538497)<1e-7);
assert.equal(primary.history.bothFilled,208);
assert.ok(Math.abs(old.history.netDollars-183.33897269398727)<1e-7);
const primaryFresh=primary.freshM1;
const method={freeze:'Primary 0/10 body, 30/70 risk, 30-minute entry deadline, common original-reference 1.25R TP, original SL, no BE or early close. Frozen in commentary and plan before inspecting fresh qualified outcomes. Controls cannot replace primary based on fresh results.',
  periods:{historicalFrom:'2026-08-03',historicalThrough:new Date(oldCutoff*1000).toISOString(),freshFrom:new Date(oldCutoff*1000).toISOString(),freshThrough:new Date(freshEnd*1000).toISOString()},
  qualification:'Fresh-only dates requalified using unchanged runVolumeStudy M15 volume >=250 decrease, H4 structure and EMA20/50, H1 continuation/Far. All indicators use closed data at confirmation. Recent native OANDA M15/H1/H4 snapshots supply context.',
  execution:'Same verified exhaustive OHLC event-order engine, new data replayed primarily at M1 and separately at M15. Stops/targets exact ideal levels, no spread, commission, slippage, swaps or gap execution costs. Missing and conflicting paths stay uncertain; open/unfilled outcomes excluded from resolved win rate.',
  timing:'For closed legs, openedAt is first candle where every path confirms a fill; closedAt is first candle end where every path confirms closure. Exit cash flows grouped at that bar end. Holding durations use those bar timestamps.',
  risk:'Fixed $4 total setup risk, no compounding, ideal fractional lots. Realized drawdown uses known closed-setup cash flows only, grouped by exit candle. It excludes floating losses and uncertain outcomes, and is not a live-account drawdown estimate. Consecutive losing counts refer to exit bars, not individual trade order within the same bar.',
  sizing:'Current Exness XAUUSDm contract100 oz, .01 minimum and step checked independently. Two-leg split may be impossible at $200 balance and 2% risk. No risk increase to force orders.',
  limitations:'Fresh period is only about 2.5 days and may contain very few independent setups. It was not used for earlier parameter fitting, but one current signal was discussed in chat. The old historical data underwent repeated selection and cannot serve as independent proof. No parameter re-selection from the fresh outcomes. No live code, settings or orders changed.',
  sourceHashes:Object.fromEntries(['M1','M15','H1','H4'].map(tf=>[tf,crypto.createHash('sha256').update(fs.readFileSync(new URL(`${freshStem}-${tf}.json`,root))).digest('hex')]))};
const outcome={method,coverage,priceAgreement,causalChecks,freshQualifiedCount:freshSetups.length,primaryFreshVerdict:{resolved:primaryFresh.closed,profitable:primaryFresh.profitable,losing:primaryFresh.losing,netDollars:primaryFresh.netDollars,
  sufficientForPerformanceClaim:false,reason:primaryFresh.closed<30?'Fewer than 30 resolved setups; descriptive check only, not established performance.':'Further independent forward validation and executable cost/risk modeling are required.'},results};
write(`${stem}.json`,outcome);
const columns=['candidate','role','period','setups','closed','TPsetups','SLsetups','winPercent','bothFilled','uncertain','open','notFilled','netDollars','netPips','realizedExitBarDrawdownDollars','profitFactor','meanHoldingMinutes'];
fs.writeFileSync(new URL(`${stem}.csv`,root),[columns.join(','),...results.flatMap(r=>(['history','freshM1','freshM15'] as const).map(period=>{
  const d=r[period];return [r.id,r.role,period,d.setups,d.closed,d.tp,d.sl,d.winPercent,d.bothFilled,d.uncertain,d.open,d.notFilled,d.netDollars,d.netPips,d.realizedExitBarDrawdownDollars,d.profitFactor,d.meanHoldingMinutes].join(',');
}))].join('\n')+'\n');
fs.writeFileSync(new URL(`${stem}-fresh-trades.csv`,root),['candidate,signalUTC,direction,slot,entry,sl,tp,rr,riskShare,openedAtUTC,closedAtUTC,fillState,outcome,setupR',...results.flatMap(r=>r.freshM1Rows.flatMap(row=>row.legs.map(l=>[r.id,row.signalUTC,row.direction,l.slot+1,l.entry,l.stop,l.target,l.rr,l.share,l.openedAt===undefined?'':new Date(l.openedAt*1000).toISOString(),l.closedAt===undefined?'':new Date(l.closedAt*1000).toISOString(),l.fillState,l.outcome,l.setupR].join(','))))].join('\n')+'\n');
console.log(JSON.stringify({freshQualifiedCount:freshSetups.length,priceAgreement:{...priceAgreement,rows:undefined},primaryFreshVerdict:outcome.primaryFreshVerdict,results:results.map(r=>({id:r.id,history:{net:r.history.netDollars,win:r.history.winPercent,drawdown:r.history.realizedExitBarDrawdownDollars,profitFactor:r.history.profitFactor},fresh:r.freshM1,sizing:r.freshSizing}))},null,2));
