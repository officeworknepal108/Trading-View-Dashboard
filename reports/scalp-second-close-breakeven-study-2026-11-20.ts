// Offline research: archived prices in, study reports out. No trading calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scalpPullbackBarStates } from '../src/services/scalpOneToOne';

const root=new URL('./',import.meta.url), stem='scalp-second-close-breakeven-study-2026-11-20';
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

type Spec={id:number;name:string;targetR:number;progress:number;origin:'reference'|'second-entry';eligibility:'second-filled'|'any-filled';closeSecond:boolean;moveBE:boolean;runnerR:number};
type Leg={slot:number;entry:number;stop:number;target:number;runnerTarget:number;risk:number;share:number;rr:number;runnerRR:number;earlyRR:number};
// Pending=0, active original stop=1, TP=2, SL=3, unfilled retired=4,
// unknown fill=5, unknown exit=6, second closed at trigger=7,
// runner active with entry SL=8, runner BE exit=9, unknown protected exit=10.
type Scenario={status:number[];triggered:boolean};
function makeLevels(r:any,s:Spec){
  const referenceRisk=Math.abs(r.reference-r.stop),target=r.reference+r.sign*referenceRisk*s.targetR;
  const secondEntry=r.reference-r.sign*r.body*.1;
  const triggerOrigin=s.origin==='reference'?r.reference:secondEntry;
  const trigger=triggerOrigin+s.progress*(target-triggerOrigin);
  const legs:Leg[]=[0,10].flatMap((percent,slot)=>{
    const entry=r.reference-r.sign*r.body*percent/100,risk=r.sign*(entry-r.stop);
    if(!(risk>1e-8&&risk<=30.000001&&r.sign*(target-entry)>0))return [];
    const runnerTarget=slot===0?r.reference+r.sign*referenceRisk*s.runnerR:target;
    return [{slot,entry,stop:r.stop,target,runnerTarget,risk,share:slot===0?.3:.7,
      rr:r.sign*(target-entry)/risk,runnerRR:r.sign*(runnerTarget-entry)/risk,earlyRR:r.sign*(trigger-entry)/risk}];
  });return {legs,trigger,referenceRisk};
}
function terminal(v:number){return ![0,1,8].includes(v);}
function pathStates(bar:any,legs:Leg[],triggerPrice:number,sign:number,initial:Scenario,allowFills:boolean,s:Spec):Scenario[]{
  const stop=legs[0].stop,x=(price:number)=>sign*(price-stop);
  const open=x(bar.open),close=x(bar.close),low=Math.min(x(bar.low),x(bar.high)),high=Math.max(x(bar.low),x(bar.high));
  const entries=legs.map(l=>x(l.entry)),targets=legs.map(l=>x(l.target)),runnerTargets=legs.map(l=>x(l.runnerTarget)),trigger=x(triggerPrice);
  const prices=[...new Set([open,close,low,high,...[0,trigger,...entries,...targets,...runnerTargets].filter(p=>p>=low&&p<=high)])].sort((a,b)=>a-b);
  type Node={position:number;state:Scenario;seen:number};
  const arrive=(position:number,n:Node):Node=>{
    const price=prices[position],status=[...n.state.status];let triggered=n.state.triggered,seen=n.seen;
    if(price===high)seen|=1;if(price===low)seen|=2;
    legs.forEach((l,i)=>{
      if(status[i]===0&&(!allowFills||price<=0||price>=targets[i]))status[i]=4;
      if(status[i]===0&&price<=entries[i]+1e-8)status[i]=1;
      if(status[i]===1&&price<=0)status[i]=3;
      if(status[i]===8&&price<=entries[i])status[i]=9;
    });
    const secondIndex=legs.findIndex(l=>l.slot===1);
    const eligible=s.eligibility==='second-filled'?secondIndex>=0&&status[secondIndex]===1:status.some(v=>v===1||v===8);
    if((s.closeSecond||s.moveBE)&&!triggered&&price>=trigger&&eligible){
      triggered=true;
      legs.forEach((l,i)=>{
        if(l.slot===1&&status[i]===1&&s.closeSecond)status[i]=7;
        if(l.slot===0&&status[i]===1&&s.moveBE)status[i]=8;
        // Once management activates, no later second/first entry is allowed.
        if(status[i]===0)status[i]=4;
      });
    }
    legs.forEach((l,i)=>{
      if(status[i]===1&&price>=targets[i])status[i]=2;
      if(status[i]===8&&price>=runnerTargets[i])status[i]=2;
    });
    return {position,state:{status,triggered},seen};
  };
  const start=arrive(prices.indexOf(open),{position:0,state:initial,seen:0});
  const key=(n:Node)=>`${n.position}:${n.state.status.join(',')}:${Number(n.state.triggered)}:${n.seen}`;
  const visited=new Set([key(start)]),queue=[start],out=new Map<string,Scenario>();
  for(let head=0;head<queue.length;head++){
    const n=queue[head];
    if(prices[n.position]===close&&n.seen===3)out.set(`${n.state.status.join(',')}:${Number(n.state.triggered)}`,n.state);
    for(const position of [n.position-1,n.position+1]){
      if(position<0||position>=prices.length)continue;
      const next=arrive(position,n),id=key(next);
      if(!visited.has(id)){visited.add(id);queue.push(next);}
    }
  }return [...out.values()];
}
function stateCash(v:number,l:Leg,state:Scenario,s:Spec){
  if(v===2)return l.share*(state.triggered&&l.slot===0&&s.moveBE?l.runnerRR:l.rr);
  if(v===3)return -l.share;
  if(v===7)return l.share*l.earlyRR;
  return 0;
}
function replay(r:any,s:Spec,until:number){
  const base={signalUTC:r.signalUTC,confirmed:r.confirmed,direction:r.direction};
  if(r.missing||r.confirmed>=until)return {...base,outcome:'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0,triggered:false,triggerUncertain:false};
  const {legs,trigger}=makeLevels(r,s);
  if(!legs.length)return {...base,outcome:'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0,triggered:false,triggerUncertain:false};
  let states:Scenario[]=[{status:legs.map(()=>0),triggered:false}],expected=r.confirmed;
  const expiry=r.confirmed+1800;
  for(let i=index.get(r.confirmed)!;i<bars.length&&bars[i].time+900<=until;i++){
    const bar=bars[i];
    if(bar.time!==expected){
      states=states.map(state=>({...state,status:state.status.map(v=>v===1?6:v===8?10:v===0?(expected>=expiry?4:5):v)}));break;
    }
    expected+=900;
    const paths=states.flatMap(state=>state.status.every(terminal)?[state]:pathStates(bar,legs,trigger,r.sign,state,bar.time<expiry,s));
    states=[...new Map(paths.map(state=>[`${state.status.join(',')}:${Number(state.triggered)}`,state])).values()];
    if(states.every(state=>state.status.every(terminal)))break;
  }
  const outcomes=legs.map((leg,i)=>{
    const values=states.map(state=>{
      const v=state.status[i],kind=v===2?'tp':v===3?'sl':v===4?'not-filled':v===7?'early-profit':v===9?'breakeven':v===0?'pending':[1,8].includes(v)?'open':'uncertain';
      return {kind,cash:stateCash(v,leg,state,s)};
    });
    const outcomes=[...new Set(values.map(v=>v.kind))];
    const sameCash=values.every(v=>Math.abs(v.cash-values[0].cash)<1e-8);
    const outcome=outcomes.length===1&&sameCash?outcomes[0]:'uncertain';
    const fillState=states.every(state=>[1,2,3,6,7,8,9,10].includes(state.status[i]))?'filled':states.every(state=>state.status[i]===4)?'not-filled':'uncertain';
    const exitPips=outcome==='tp'?r.sign*((states[0].triggered&&leg.slot===0&&s.moveBE?leg.runnerTarget:leg.target)-leg.entry)/.1:
      outcome==='sl'?-leg.risk/.1:outcome==='early-profit'?r.sign*(trigger-leg.entry)/.1:0;
    return {...leg,fillState,outcome,possibleOutcomes:outcomes,setupR:['tp','sl','early-profit','breakeven'].includes(outcome)?values[0].cash:0,exitPips};
  });
  const hasFill=outcomes.some(l=>['tp','sl','early-profit','breakeven'].includes(l.outcome));
  const outcome=outcomes.some(l=>l.outcome==='uncertain')?'uncertain':outcomes.some(l=>l.outcome==='open')?'open':outcomes.some(l=>l.outcome==='pending')?'pending':hasFill?'closed':'not-filled';
  const bounds=states.map(state=>{
    let low=0,high=0;
    legs.forEach((l,i)=>{
      const v=state.status[i];
      if([2,3,4,7,9].includes(v)){const cash=stateCash(v,l,state,s);low+=cash;high+=cash;}
      else{
        low-=[8,10].includes(v)?0:l.share;
        const best=l.slot===1&&s.closeSecond?l.earlyRR:Math.max(l.rr,l.slot===0&&s.moveBE?l.runnerRR:l.rr);
        high+=l.share*Math.max(0,best);
      }
    });return {low,high};
  });
  return {...base,outcome,legs:outcomes,triggerPrice:trigger,netR:outcome==='closed'?outcomes.reduce((a,l)=>a+l.setupR,0):0,
    lowerR:Math.min(...bounds.map(b=>b.low)),upperR:Math.max(...bounds.map(b=>b.high)),triggered:states.every(state=>state.triggered),triggerUncertain:states.some(state=>state.triggered)&&!states.every(state=>state.triggered)};
}
function stats(rows:ReturnType<typeof replay>[]){
  const count=(v:string)=>rows.filter(r=>r.outcome===v).length,closed=rows.filter(r=>r.outcome==='closed');
  const profitable=closed.filter(r=>r.netR>1e-8).length,losing=closed.filter(r=>r.netR<-1e-8).length,flat=closed.length-profitable-losing;
  const slot=(r:ReturnType<typeof replay>,i:number)=>r.legs.find(l=>l.slot===i);
  const firstFilled=rows.filter(r=>slot(r,0)?.fillState==='filled').length,secondFilled=rows.filter(r=>slot(r,1)?.fillState==='filled').length;
  const bothFilled=rows.filter(r=>slot(r,0)?.fillState==='filled'&&slot(r,1)?.fillState==='filled').length;
  const legCounts=(i:number)=>Object.fromEntries(['tp','sl','early-profit','breakeven','uncertain','open','pending','not-filled'].map(o=>[o,rows.filter(r=>slot(r,i)?.outcome===o).length]));
  const resolvedLegs=closed.flatMap(r=>r.legs),grossProfitR=resolvedLegs.reduce((a,l)=>a+Math.max(0,l.setupR),0),grossLossR=-resolvedLegs.reduce((a,l)=>a+Math.min(0,l.setupR),0);
  assert.equal(rows.length,['closed','uncertain','open','pending','not-filled','no-valid-entry'].reduce((a,v)=>a+count(v),0));
  assert.ok(bothFilled<=firstFilled&&bothFilled<=secondFilled);
  return {setups:rows.length,closed:closed.length,profitable,losing,flat,winPercent:closed.length?profitable/closed.length*100:0,lossPercent:closed.length?losing/closed.length*100:0,
    uncertain:count('uncertain'),open:count('open'),pending:count('pending'),notFilled:count('not-filled'),noValidEntry:count('no-valid-entry'),
    firstFilled,secondFilled,bothFilled,bothFillPercent:rows.length?bothFilled/rows.length*100:0,
    firstOutcomes:legCounts(0),secondOutcomes:legCounts(1),triggered:rows.filter(r=>r.triggered).length,triggerUncertain:rows.filter(r=>r.triggerUncertain).length,
    grossProfitR,grossLossR,netR:grossProfitR-grossLossR,grossProfitDollars:grossProfitR*4,grossLossDollars:grossLossR*4,netDollars:(grossProfitR-grossLossR)*4,
    lowerR:rows.reduce((a,r)=>a+r.lowerR,0),upperR:rows.reduce((a,r)=>a+r.upperR,0),netPips:resolvedLegs.reduce((a,l)=>a+l.exitPips,0)};
}
const baseline:Spec={id:0,name:'Hold both to original 1.25R TP',targetR:1.25,progress:.8,origin:'reference',eligibility:'second-filled',closeSecond:false,moveBE:false,runnerR:1.25};
const oldStudy=read('scalp-tp-extension-study-2026-11-20.json');
const oldVariant=oldStudy.grid.find((r:any)=>r.spec.profile.name==='Previous profit 0/10'&&r.spec.targets[0]===1.25&&r.spec.targets[1]===1.25&&r.spec.cancel==='new-target');
const baselineRows=setups.map((r:any)=>replay(r,baseline,cutoff)),baseStats=stats(baselineRows);
for(const key of ['closed','profitable','losing','winPercent','bothFilled','uncertain','open','notFilled','netR','netPips'] as const)assert.ok(Math.abs(baseStats[key]-oldVariant.full[key])<1e-7,`1.25R hold baseline parity ${key}`);
// Example: BUY reference 100, SL 90, final TP 112.5; 80% reference trigger=110.
const priceFixture=makeLevels({reference:100,stop:90,target:110,body:10,sign:1},baseline);
assert.equal(priceFixture.trigger,110);assert.equal(priceFixture.legs[1].entry,99);
const rule80:Spec={...baseline,id:1,name:'80% close second + first BE',closeSecond:true,moveBE:true};
const mirrored=priceFixture.legs.map(l=>({...l,entry:200-l.entry,stop:200-l.stop,target:200-l.target,runnerTarget:200-l.runnerTarget}));
const start:Scenario={status:[1,1],triggered:false};
const buy=pathStates({open:105,high:111,low:99,close:105},priceFixture.legs,110,1,start,true,rule80);
const sell=pathStates({open:95,high:101,low:89,close:95},mirrored,90,-1,start,true,rule80);
const stateKey=(p:Scenario)=>`${p.status.join(',')}:${Number(p.triggered)}`;
assert.deepEqual(new Set(buy.map(stateKey)),new Set(sell.map(stateKey)),'BUY/SELL management symmetry');
assert.ok(buy.some(p=>p.status[0]===9&&p.status[1]===7),'Trigger then retrace must close second for profit and runner at BE');
assert.ok(buy.some(p=>p.status[0]===8&&p.status[1]===7),'Low before trigger may leave runner active; OHLC ordering stays ambiguous');
assert.deepEqual(pathStates({open:110,high:113,low:101,close:113},priceFixture.legs,110,1,start,true,rule80).map(stateKey),['2,7:1'],'Runner reaches TP after second closes early');
assert.deepEqual(pathStates({open:100,high:105,low:89,close:90},priceFixture.legs,110,1,start,true,rule80).map(stateKey),['3,3:0'],'Never reaching trigger retains original stops');
const beforeTrigger=pathStates({open:105,high:109,low:99,close:105},priceFixture.legs,110,1,start,true,rule80);
assert.ok(beforeTrigger.every(p=>p.status[0]===1&&p.status[1]===1&&!p.triggered),'SL cannot move before trigger');
const specs:Spec[]=[baseline];
for(const targetR of [1.25,1.5,2])for(const progress of [.6,.7,.75,.8,.85,.9,.95])for(const origin of ['reference','second-entry'] as const)for(const eligibility of ['second-filled','any-filled'] as const){
  specs.push({id:specs.length,name:'Close second + move first BE',targetR,progress,origin,eligibility,closeSecond:true,moveBE:true,runnerR:targetR});
}
for(const action of ['close-only','BE-only'] as const)for(const origin of ['reference','second-entry'] as const)for(const eligibility of ['second-filled','any-filled'] as const){
  specs.push({...baseline,id:specs.length,name:action,origin,eligibility,closeSecond:action==='close-only',moveBE:action==='BE-only'});
}
for(const runnerR of [1.5,2])for(const origin of ['reference','second-entry'] as const)for(const eligibility of ['second-filled','any-filled'] as const){
  specs.push({...rule80,id:specs.length,name:'80% close second + BE + extended runner',origin,eligibility,runnerR});
}
const october=Date.parse('2026-10-01T00:00:00Z')/1000,november=Date.parse('2026-11-01T00:00:00Z')/1000;
const before=(t:number)=>setups.filter((r:any)=>r.confirmed<t),evaluate=(s:Spec,group:any[],until:number)=>stats(group.map(r=>replay(r,s,until)));
const referenceTrain=evaluate(baseline,before(october),october),referenceTrain2=evaluate(baseline,before(november),november);
function paired(rows:ReturnType<typeof replay>[],baselineRows:ReturnType<typeof replay>[]){
  const certain=(r:ReturnType<typeof replay>)=>['closed','not-filled'].includes(r.outcome);
  const matched=rows.map((r,i)=>({r,b:baselineRows[i]})).filter(({r,b})=>certain(r)&&certain(b));
  const candidateClosed=matched.filter(p=>p.r.outcome==='closed'),baselineClosed=matched.filter(p=>p.b.outcome==='closed');
  const candidateWins=candidateClosed.filter(p=>p.r.netR>1e-8).length,baselineWins=baselineClosed.filter(p=>p.b.netR>1e-8).length;
  return {setups:matched.length,candidateClosed:candidateClosed.length,baselineClosed:baselineClosed.length,candidateWins,baselineWins,
    candidateWinPercent:candidateClosed.length?candidateWins/candidateClosed.length*100:0,baselineWinPercent:baselineClosed.length?baselineWins/baselineClosed.length*100:0,
    candidateNetDollars:matched.reduce((a,p)=>a+p.r.netR*4,0),baselineNetDollars:matched.reduce((a,p)=>a+p.b.netR*4,0),
    differenceDollars:matched.reduce((a,p)=>a+(p.r.netR-p.b.netR)*4,0)};
}
console.log(JSON.stringify({phase:'Baseline and management path fixtures passed; selection rules fixed',variants:specs.length,
  selection:'At each month boundary require >=85% both fills, >=50% positive-net resolved setup rate, at least 70% baseline resolved count, and positive conservative R. Maximize conservative lower R, then known-outcome R. Fit before October/November and score next month. Compare candidates with baseline on setups whose outcome is certain for both.'}));
const training=specs.map((spec,i)=>{
  if(i%15===0)console.log(`Training ${i+1}/${specs.length}`);
  return {id:spec.id,spec,training:evaluate(spec,before(october),october),training2:evaluate(spec,before(november),november)};
});
function choose(second=false){
  const key=second?'training2':'training',base=second?referenceTrain2:referenceTrain;
  return [...training].filter(r=>r[key].bothFillPercent>=85&&r[key].winPercent>=50&&r[key].closed>=Math.ceil(base.closed*.7)&&r[key].lowerR>0)
    .sort((a,b)=>b[key].lowerR-a[key].lowerR||b[key].netR-a[key].netR)[0]??null;
}
const choices={october:choose()?.id??null,november:choose(true)?.id??null};
console.log(JSON.stringify({phase:'Choices frozen before later results',choices,choiceSpecs:Object.fromEntries(Object.entries(choices).map(([key,id])=>[key,id===null?null:specs[id]]))}));
const baselineOctoberRows=setups.filter((r:any)=>r.confirmed>=october&&r.confirmed<november).map((r:any)=>replay(r,baseline,november));
const baselineNovemberRows=baselineRows.filter(r=>r.confirmed>=november);
const holdRows=new Map<number,ReturnType<typeof replay>[]>([[1.25,baselineRows]]);
for(const targetR of [1.5,2])holdRows.set(targetR,setups.map((r:any)=>replay(r,{...baseline,targetR,runnerR:targetR},cutoff)));
const holdBaselines=Object.fromEntries([...holdRows].map(([targetR,rows])=>[String(targetR),{full:stats(rows),rows}]));
const grid=training.map((r,i)=>{
  if(i%15===0)console.log(`Later results ${i+1}/${training.length}`);
  const rows=setups.map((s:any)=>replay(s,r.spec,cutoff));
  const octRows=setups.filter((s:any)=>s.confirmed>=october&&s.confirmed<november).map((s:any)=>replay(s,r.spec,november));
  const novRows=rows.filter(s=>s.confirmed>=november);
  return {...r,full:stats(rows),october:stats(octRows),november:stats(novRows),matched:paired(rows,baselineRows),matchedSameTarget:paired(rows,holdRows.get(r.spec.targetR)!),matchedOctober:paired(octRows,baselineOctoberRows),matchedNovember:paired(novRows,baselineNovemberRows)};
});
const exact=grid.filter(r=>r.spec.targetR===1.25&&r.spec.progress===.8&&r.spec.closeSecond&&r.spec.moveBE&&r.spec.runnerR===1.25);
const sweep=grid.filter(r=>r.spec.targetR===1.25&&r.spec.origin==='reference'&&r.spec.eligibility==='second-filled'&&r.spec.closeSecond&&r.spec.moveBE&&r.spec.runnerR===1.25);
const best=[...grid].filter(r=>r.full.bothFillPercent>=85&&r.full.winPercent>=50).sort((a,b)=>b.full.netR-a.full.netR)[0];
const selectedIds=[...new Set([0,...exact.map(r=>r.id),...grid.filter(r=>r.spec.name==='close-only'||r.spec.name==='BE-only').map(r=>r.id),choices.october,choices.november,best?.id].filter((id):id is number=>id!==null&&id!==undefined))];
const selected=selectedIds.map(id=>{
  const r=grid[id],rows=setups.map((s:any)=>replay(s,r.spec,cutoff));
  return {...r,roles:[...(id===0?['baseline']:[]),...(exact.some(r=>r.id===id)?['exact80']:[]),...(id===choices.october?['selectedOctober']:[]),...(id===choices.november?['selectedNovember']:[]),...(id===best?.id?['bestFullHistoryHindsight']:[])],
    bySide:Object.fromEntries(['bullish','bearish'].map(side=>[side,stats(rows.filter(r=>r.direction===side))])),
    monthly:Object.fromEntries([...new Set(rows.map(r=>r.signalUTC.slice(0,7)))].map(month=>[month,stats(rows.filter(r=>r.signalUTC.startsWith(month)))])),rows};
});
const a=choices.october===null?null:grid[choices.october],b=choices.november===null?null:grid[choices.november];
const baseOctober=stats(baselineOctoberRows),baseNovember=stats(baselineNovemberRows);
const walkForward={choices,candidateNetDollars:(a?.october.netDollars??0)+(b?.november.netDollars??0),baselineNetDollars:baseOctober.netDollars+baseNovember.netDollars,
  candidateBothFilled:(a?.october.bothFilled??0)+(b?.november.bothFilled??0),baselineBothFilled:baseOctober.bothFilled+baseNovember.bothFilled,
  matchedSetups:(a?.matchedOctober.setups??0)+(b?.matchedNovember.setups??0),matchedDifferenceDollars:(a?.matchedOctober.differenceDollars??0)+(b?.matchedNovember.differenceDollars??0),
  eligibleSetups:baselineOctoberRows.length+baselineNovemberRows.length};
const method={period:'235 archived qualified XAUUSD setups, August 3–November 18, 2026',
  baseline:'The cited +$213.32 case: reference-anchored first 0%, second 10% final-confirmation body, fixed 30%/70% setup risk split, 30-minute entry deadline, common 1.25R reference target, new-target pending cancellation. Original SL unchanged until an experimental BE event.',
  trigger:'Both definitions are simulated: progress from original reference to common TP, or from second-entry price to TP. At 80% of a 1.25R reference target the reference trigger is exactly original 1R. Same fixed $4 total setup risk.',
  management:'At trigger, close entire filled second leg, move active first leg SL to its own entry, retain first TP unless explicitly extending runner. Cancel any pending entries when management activates. second-filled mode activates only if second is active; any-filled mode can protect a lone first fill and cancels unfilled second. If neither leg filled, no management event.',
  variants:'1.25R/1.5R/2R targets; 60/70/75/80/85/90/95% progress; reference and second-entry origins; second-filled and any-filled eligibility. Separate close-only and BE-only attribution. Also 80% trigger with 1.5R/2R runner after a 1.25R setup.',
  accounting:'Positive-net setup win rate, not runner TP rate. First-leg BE and second-leg early profit reported separately. A BE runner plus second-leg profit is a winning setup. Outcomes must agree across all OHLC paths; entire uncertain/open setups excluded from main P&L. Matched-cohort P&L compares only setups whose outcomes are certain in both candidate and baseline.',
  execution:'Exhaustive M15 OHLC event-order state machine, dynamic BE stop applies only after trigger, BUY/SELL symmetry. Same-candle trigger/BE/TP conflicts stay uncertain. Missing history stays uncertain; known protected runners have zero ideal gross-loss lower bound after BE. Stops, targets, early closes and BE fills are ideal exact levels, with no gap slippage or costs.',
  cash:'Fixed $4 total setup risk, no compounding, ideal fractional lots. No spread, commission, financing, slippage, minimum-lot sizing, margin, maximum-open-trade limits, daily loss cap or overlap half-risk adjustments. BE means entry price before costs; it is not a guarantee of zero actual loss. Current $200 Exness min-lot constraint remains.',
  validation:'Simulator matches the prior 1.25R baseline $213.32 and all its major counts. Fixtures cover pre-trigger stop immutability, original-SL losses without trigger, trigger then BE, trigger then runner TP, BUY/SELL symmetry, and ambiguous low-before/high-before ordering. All price distances are measured without later candles.',
  selection:'Earlier outcomes truncated at October 1 and November 1. Require >=85% both fills, >=50% profitable resolved setups, >=70% baseline resolved count, positive conservative R; maximize conservative R, then known-outcome R. Choices frozen before later-month scoring.',
  limits:'Reused historical sample, multiple searches and a SELL-heavy instrument period. Chronological comparisons are not independent unseen validation. More ambiguous management exits can distort headline results through exclusion; matched-cohort results and conservative bounds are essential. Higher-target variants must also be compared against HOLD at their same target, not just the cited 1.25R baseline. No live strategy, exits, account settings or orders changed.',
  hashes:Object.fromEntries(files.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex')]))};
fs.writeFileSync(new URL(`${stem}.json`,root),JSON.stringify({method,walkForward,holdBaselines,exact80:exact,sweep,selected,grid},null,2)+'\n');
const head=['id','name','targetR','triggerPercent','triggerOrigin','activationEligibility','closeSecond','moveFirstBE','runnerR','trainingNet','trainingLowerR','octoberNet','novemberNet','fullNet','fullLowerR','fullWinPercent','fullProfitable','fullLosing','fullFlat','fullBothFilled','fullUncertain','fullOpen','firstTP','firstSL','firstBE','secondEarlyProfit','secondSL','fullNetPips','matchedSetups','matchedDifference'];
fs.writeFileSync(new URL(`${stem}.csv`,root),[head.join(','),...grid.map(r=>[r.id,r.spec.name,r.spec.targetR,r.spec.progress*100,r.spec.origin,r.spec.eligibility,r.spec.closeSecond,r.spec.moveBE,r.spec.runnerR,r.training.netDollars,r.training.lowerR,r.october.netDollars,r.november.netDollars,r.full.netDollars,r.full.lowerR,r.full.winPercent,r.full.profitable,r.full.losing,r.full.flat,r.full.bothFilled,r.full.uncertain,r.full.open,r.full.firstOutcomes.tp,r.full.firstOutcomes.sl,r.full.firstOutcomes.breakeven,r.full.secondOutcomes['early-profit'],r.full.secondOutcomes.sl,r.full.netPips,r.matched.setups,r.matched.differenceDollars].join(','))].join('\n')+'\n');
fs.writeFileSync(new URL(`${stem}-selected-trades.csv`,root),['variantId,signalUTC,direction,slot,entry,initialSL,TP,triggerPrice,fillState,outcome,setupR,exitPips',...selected.flatMap(s=>s.rows.flatMap(r=>r.legs.map(l=>[s.id,r.signalUTC,r.direction,l.slot+1,l.entry,l.stop,l.target,(r as any).triggerPrice,l.fillState,l.outcome,l.setupR,l.exitPips].join(','))))].join('\n')+'\n');
console.log(JSON.stringify({variants:specs.length,baseline:baseStats,walkForward,exact80:exact.map(r=>({id:r.id,spec:r.spec,full:r.full,matched:r.matched})),best:best&&{id:best.id,spec:best.spec,full:best.full,matched:best.matched}},null,2));
