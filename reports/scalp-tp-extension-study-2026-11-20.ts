// Offline research: archived prices in, study reports out. No trading calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scalpPullbackBarStates } from '../src/services/scalpOneToOne';

const root=new URL('./',import.meta.url), stem='scalp-tp-extension-study-2026-11-20';
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

type Profile={name:string;first:number;second:number;share:number;expiry:number;anchor?:'next-open'|'reference'};
type Spec={profile:Profile;targets:[number,number];cancel:'original-target'|'new-target'};
type Leg={slot:number;entry:number;stop:number;target:number;guard:number;risk:number;rr:number;share:number};
// Status: 0 pending, 1 active, 2 TP, 3 SL, 4 retired unfilled,
// 5 unknown fill after missing history, 6 confirmed fill with unknown exit.
type State=number[];
function levels(r:any,s:Spec):Leg[]{
  const profile=s.profile,referenceRisk=Math.abs(r.reference-r.stop);
  return [profile.first,profile.second].flatMap((percent,slot)=>{
    const entry=(profile.anchor==='next-open'?r.nextOpen:r.reference)-r.sign*r.body*percent/100;
    const risk=r.sign*(entry-r.stop),target=r.reference+r.sign*referenceRisk*s.targets[slot];
    const reward=r.sign*(target-entry);
    if(!(risk>1e-8&&risk<=30.000001&&reward>0))return [];
    return [{slot,entry,stop:r.stop,target,guard:s.cancel==='original-target'?r.target:target,
      risk,rr:reward/risk,share:slot===0?profile.share:1-profile.share}];
  });
}
function barStates(bar:any,legs:Leg[],sign:number,initial:State,allowFills:boolean):State[]{
  const stop=legs[0].stop,x=(price:number)=>sign*(price-stop);
  const open=x(bar.open),close=x(bar.close),low=Math.min(x(bar.low),x(bar.high)),high=Math.max(x(bar.low),x(bar.high));
  const entries=legs.map(l=>x(l.entry)),targets=legs.map(l=>x(l.target)),guards=legs.map(l=>x(l.guard));
  const prices=[...new Set([open,close,low,high,...[0,...entries,...targets,...guards].filter(p=>p>=low&&p<=high)])].sort((a,b)=>a-b);
  type Node={position:number;status:State;seen:number};
  const arrive=(position:number,previous:Node):Node=>{
    const price=prices[position],status=[...previous.status];let seen=previous.seen;
    if(price===high)seen|=1;if(price===low)seen|=2;
    status.forEach((value,i)=>{
      if(value===0&&(!allowFills||price<=0||price>=guards[i]))status[i]=4;
      if(status[i]===0&&price<=entries[i]+1e-8)status[i]=1;
      if(status[i]===1){if(price<=0)status[i]=3;else if(price>=targets[i])status[i]=2;}
    });
    return {position,status,seen};
  };
  const start=arrive(prices.indexOf(open),{position:0,status:initial,seen:0});
  const key=(n:Node)=>`${n.position}:${n.status.join(',')}:${n.seen}`;
  const visited=new Set([key(start)]),queue=[start],result=new Map<string,State>();
  for(let head=0;head<queue.length;head++){
    const n=queue[head];
    if(prices[n.position]===close&&n.seen===3)result.set(n.status.join(','),n.status);
    for(const position of [n.position-1,n.position+1]){
      if(position<0||position>=prices.length)continue;
      const next=arrive(position,n),id=key(next);
      if(!visited.has(id)){visited.add(id);queue.push(next);}
    }
  }
  return [...result.values()];
}
function replay(r:any,s:Spec,until:number){
  const base={signalUTC:r.signalUTC,confirmed:r.confirmed,direction:r.direction};
  if(r.missing||r.confirmed>=until)return {...base,outcome:'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0};
  const legs=levels(r,s);
  if(!legs.length)return {...base,outcome:'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0};
  let states:State[]=[legs.map(()=>0)],expected=r.confirmed;
  const expiry=r.confirmed+s.profile.expiry*60;
  for(let i=index.get(r.confirmed)!;i<bars.length&&bars[i].time+900<=until;i++){
    const bar=bars[i];
    if(bar.time!==expected){
      states=states.map(state=>state.map(value=>value===1?6:value===0?(expected>=expiry?4:5):value));break;
    }
    expected+=900;
    const paths=states.flatMap(state=>state.every(v=>v>=2)?[state]:barStates(bar,legs,r.sign,state,bar.time<expiry));
    states=[...new Map(paths.map(state=>[state.join(','),state])).values()];
    if(states.every(state=>state.every(v=>v>=2)))break;
  }
  const outcomes=legs.map((leg,i)=>{
    const possibilities=[...new Set(states.map(state=>state[i]))];
    const fillState=states.every(state=>[1,2,3,6].includes(state[i]))?'filled':states.every(state=>state[i]===4)?'not-filled':'uncertain';
    const values=possibilities.map(v=>v===2?'tp':v===3?'sl':v===4?'not-filled':v===1?'open':v===0?'pending':'uncertain');
    const outcome=new Set(values).size===1?values[0]:'uncertain';
    return {...leg,fillState,outcome,possibleOutcomes:values,setupR:outcome==='tp'?leg.share*leg.rr:outcome==='sl'?-leg.share:0};
  });
  const closed=outcomes.filter(l=>l.outcome==='tp'||l.outcome==='sl');
  const outcome=outcomes.some(l=>l.outcome==='uncertain')?'uncertain':outcomes.some(l=>l.outcome==='open')?'open':outcomes.some(l=>l.outcome==='pending')?'pending':
    new Set(closed.map(l=>l.outcome)).size>1?'mixed':closed[0]?.outcome??'not-filled';
  const bounds=states.map(state=>{
    let low=0,high=0;
    legs.forEach((leg,i)=>{
      const v=state[i];
      if(v===2){low+=leg.share*leg.rr;high+=leg.share*leg.rr;}
      else if(v===3){low-=leg.share;high-=leg.share;}
      else if(v!==4){low-=leg.share;high+=leg.share*leg.rr;}
    });return {low,high};
  });
  return {...base,outcome,legs:outcomes,netR:['tp','sl','mixed'].includes(outcome)?outcomes.reduce((a,l)=>a+l.setupR,0):0,
    lowerR:Math.min(...bounds.map(b=>b.low)),upperR:Math.max(...bounds.map(b=>b.high))};
}
function stats(rows:ReturnType<typeof replay>[]){
  const count=(outcome:string)=>rows.filter(r=>r.outcome===outcome).length;
  const closed=rows.filter(r=>['tp','sl','mixed'].includes(r.outcome));
  const won=closed.filter(r=>r.netR>1e-8),lost=closed.filter(r=>r.netR<-1e-8),flat=closed.length-won.length-lost.length;
  const slot=(r:ReturnType<typeof replay>,i:number)=>r.legs.find(l=>l.slot===i);
  const bothFilled=rows.filter(r=>slot(r,0)?.fillState==='filled'&&slot(r,1)?.fillState==='filled').length;
  const firstFilled=rows.filter(r=>slot(r,0)?.fillState==='filled').length,secondFilled=rows.filter(r=>slot(r,1)?.fillState==='filled').length;
  const resolvedLegs=closed.flatMap(r=>r.legs),allLegs=rows.flatMap(r=>r.legs);
  const grossProfitR=resolvedLegs.filter(l=>l.outcome==='tp').reduce((a,l)=>a+l.setupR,0),grossLossR=-resolvedLegs.filter(l=>l.outcome==='sl').reduce((a,l)=>a+l.setupR,0);
  const tpPips=resolvedLegs.filter(l=>l.outcome==='tp').reduce((a,l)=>a+Math.abs(l.target-l.entry)/.1,0),slPips=resolvedLegs.filter(l=>l.outcome==='sl').reduce((a,l)=>a+Math.abs(l.stop-l.entry)/.1,0);
  const totalR=grossProfitR-grossLossR;
  assert.equal(rows.length,['tp','sl','mixed','uncertain','open','pending','not-filled','no-valid-entry'].reduce((a,v)=>a+count(v),0));
  assert.ok(bothFilled<=firstFilled&&bothFilled<=secondFilled);
  return {setups:rows.length,tp:count('tp'),sl:count('sl'),mixed:count('mixed'),closed:closed.length,profitable:won.length,losing:lost.length,flat,
    winPercent:closed.length?won.length/closed.length*100:0,lossPercent:closed.length?lost.length/closed.length*100:0,
    uncertain:count('uncertain'),open:count('open'),pending:count('pending'),notFilled:count('not-filled'),noValidEntry:count('no-valid-entry'),
    firstFilled,secondFilled,bothFilled,bothFillPercent:rows.length?bothFilled/rows.length*100:0,
    secondNotFilled:rows.filter(r=>slot(r,1)?.fillState==='not-filled').length,secondFillUncertain:rows.filter(r=>slot(r,1)?.fillState==='uncertain').length,
    tpLegs:allLegs.filter(l=>l.outcome==='tp').length,slLegs:allLegs.filter(l=>l.outcome==='sl').length,
    grossProfitR,grossLossR,netR:totalR,netDollars:totalR*4,grossProfitDollars:grossProfitR*4,grossLossDollars:grossLossR*4,
    lowerR:rows.reduce((a,r)=>a+r.lowerR,0),upperR:rows.reduce((a,r)=>a+r.upperR,0),netPips:tpPips-slPips,tpPips,slPips};
}
const profiles:Profile[]=[
  {name:'Corrected 10/25',first:10,second:25,share:.6,expiry:75},
  {name:'High-fill 0/2.5',first:0,second:2.5,share:.6,expiry:75},
  {name:'Compromise 10/12.5',first:10,second:12.5,share:.6,expiry:75},
  {name:'Previous profit 0/10',first:0,second:10,share:.3,expiry:30},
  {name:'High-fill 0/5',first:0,second:5,share:.8,expiry:30},
  {name:'Reference 0/10',first:0,second:10,share:.6,expiry:75}];
const oldSpec:Spec={profile:{name:'Old next-open 10/25',first:10,second:25,share:.6,expiry:75,anchor:'next-open'},targets:[1,1],cancel:'original-target'};
const october=Date.parse('2026-10-01T00:00:00Z')/1000,november=Date.parse('2026-11-01T00:00:00Z')/1000;
const before=(t:number)=>setups.filter((r:any)=>r.confirmed<t);
const evaluate=(s:Spec,rows:any[],until:number)=>stats(rows.map(r=>replay(r,s,until)));
const oldRows=setups.map((r:any)=>replay(r,oldSpec,cutoff));
const old={full:stats(oldRows),training:evaluate(oldSpec,before(october),october),training2:evaluate(oldSpec,before(november),november),
  october:evaluate(oldSpec,setups.filter((r:any)=>r.confirmed>=october&&r.confirmed<november),november),november:evaluate(oldSpec,setups.filter((r:any)=>r.confirmed>=november),cutoff)};
for(const key of ['tp','sl','uncertain','notFilled','noValidEntry','netR'] as const)assert.ok(Math.abs(old.full[key]-prior.original[key])<1e-7,`General engine old parity ${key}`);
assert.equal(old.full.bothFilled,199);
const check=evaluate({profile:profiles[0],targets:[1,1],cancel:'original-target'},setups,cutoff);
for(const key of ['tp','sl','uncertain','notFilled','noValidEntry','netR'] as const)assert.ok(Math.abs(check[key]-prior.corrected[key])<1e-7,`General engine corrected parity ${key}`);
assert.equal(check.bothFilled,193);
// Focused path fixtures verify independent targets, mirroring and early pending retirement.
const fixtureLegs:Leg[]=[{slot:0,entry:100,stop:90,target:110,guard:110,risk:10,rr:1,share:.6},{slot:1,entry:98,stop:90,target:120,guard:110,risk:8,rr:2.75,share:.4}];
const fixture={open:100,high:121,low:97,close:120};
const buyStates=barStates(fixture,fixtureLegs,1,[0,0],true);
const mirroredLegs=fixtureLegs.map(l=>({...l,entry:200-l.entry,stop:200-l.stop,target:200-l.target,guard:200-l.guard}));
const sellStates=barStates({open:100,high:103,low:79,close:80},mirroredLegs,-1,[0,0],true);
assert.deepEqual(new Set(buyStates.map(s=>s.join(','))),new Set(sellStates.map(s=>s.join(','))));
assert.ok(buyStates.some(s=>s[0]===2&&s[1]===2));
assert.ok(buyStates.some(s=>s[0]===2&&s[1]===4));
assert.deepEqual(barStates({open:111,high:121,low:97,close:120},fixtureLegs,1,[0,0],true),[[4,4]]);
assert.deepEqual(barStates({open:111,high:121,low:97,close:120},fixtureLegs,1,[1,1],true),[[2,2]],'Original target must not retire already-filled extended-TP positions');
assert.deepEqual(barStates({open:100,high:105,low:89,close:90},fixtureLegs,1,[2,1],true),[[2,3]],'First TP can remain realized while the second leg stops');
const extendedGuard=fixtureLegs.map(l=>({...l,guard:l.target}));
assert.ok(barStates({open:111,high:121,low:97,close:120},extendedGuard,1,[0,0],true).some(s=>s[0]===4&&s[1]===2),'New-target mode must permit later second-leg entry after original 1R');
assert.deepEqual(barStates({open:105,high:112,low:102,close:110},[{...fixtureLegs[0],target:115}],1,[1],true),[[1]],'Touching original 1R cannot count as an extended 1.5R TP hit');
const priceFixture=levels({reference:3500,stop:3480,target:3520,body:10,sign:1,nextOpen:3500},{profile:profiles[3],targets:[1,1.5],cancel:'original-target'});
assert.equal(priceFixture[0].target,3520);assert.equal(priceFixture[1].target,3530);assert.equal(priceFixture[1].entry,3499);
assert.ok(Math.abs(priceFixture[1].rr-31/19)<1e-10,'Per-entry actual RR uses its own entry and stop');
const common=[1,1.25,1.5,1.75,2,2.5,3,4];
const targetPairs:[number,number][]=[...common.map(r=>[r,r] as [number,number]),[1,1.5],[1,2],[1,3],[1.5,2],[1.5,3]];
const specs:Spec[]=[];
for(const profile of profiles)for(const targets of targetPairs)for(const cancel of ['original-target','new-target'] as const)specs.push({profile,targets,cancel});
assert.equal(specs.length,156);
console.log(JSON.stringify({phase:'Baseline parity and path fixtures passed; selection rules fixed',variants:specs.length,
  selection:'At least 85% both-entry fills, at least 60% old resolved training count, positive conservative R; profit choice requires >=45% profitable setups; balanced choice requires >=55%. Maximize conservative R, then known-result net R. Fit through September for October and through October for November.'}));
const training=specs.map((spec,i)=>{
  if(i%15===0)console.log(`Training ${i+1}/${specs.length}`);
  return {id:i,spec,training:evaluate(spec,before(october),october),training2:evaluate(spec,before(november),november)};
});
function select(second=false,minWin=45){
  const key=second?'training2':'training',base=second?old.training2:old.training;
  return [...training].filter(r=>r[key].bothFillPercent>=85&&r[key].winPercent>=minWin&&r[key].closed>=Math.ceil(base.closed*.6)&&r[key].lowerR>0)
    .sort((a,b)=>b[key].lowerR-a[key].lowerR||b[key].netR-a[key].netR)[0]??null;
}
const choices={profitOctober:select(false,45)?.id??null,profitNovember:select(true,45)?.id??null,balancedOctober:select(false,55)?.id??null,balancedNovember:select(true,55)?.id??null};
console.log(JSON.stringify({phase:'Choices frozen before later-month evaluation',choices,choiceSpecs:Object.fromEntries(Object.entries(choices).map(([k,id])=>[k,id===null?null:training[id].spec]))}));
const grid=training.map((r,i)=>{
  if(i%15===0)console.log(`Later outcomes ${i+1}/${training.length}`);
  const rows=setups.map((s:any)=>replay(s,r.spec,cutoff));
  return {...r,full:stats(rows),october:evaluate(r.spec,setups.filter((s:any)=>s.confirmed>=october&&s.confirmed<november),november),november:stats(rows.filter(s=>s.confirmed>=november))};
});
const bestFull=[...grid].filter(r=>r.full.bothFillPercent>=85&&r.full.winPercent>=45).sort((a,b)=>b.full.netR-a.full.netR)[0];
const bestBalanced=[...grid].filter(r=>r.full.bothFillPercent>=85&&r.full.winPercent>=55).sort((a,b)=>b.full.netR-a.full.netR)[0];
const selectedIds=[...new Set([choices.profitOctober,choices.profitNovember,choices.balancedOctober,choices.balancedNovember,bestFull?.id,bestBalanced?.id].filter((id):id is number=>id!==null&&id!==undefined))];
const selected=selectedIds.map(id=>{
  const r=grid[id],rows=setups.map((s:any)=>replay(s,r.spec,cutoff));
  return {...r,roles:[...Object.entries(choices).filter(([,v])=>v===id).map(([k])=>k),...(bestFull?.id===id?['bestFullHistoryHindsight']:[]),...(bestBalanced?.id===id?['bestBalancedFullHistoryHindsight']:[])],
    bySide:Object.fromEntries(['bullish','bearish'].map(side=>[side,stats(rows.filter(r=>r.direction===side))])),
    monthly:Object.fromEntries([...new Set(rows.map(r=>r.signalUTC.slice(0,7)))].map(month=>[month,stats(rows.filter(r=>r.signalUTC.startsWith(month)))])),rows};
});
function walkForward(kind:'profit'|'balanced'){
  const a=choices[`${kind}October`],b=choices[`${kind}November`];
  const oct=a===null?null:grid[a].october,nov=b===null?null:grid[b].november;
  return {octoberId:a,novemberId:b,netDollars:(oct?.netDollars??0)+(nov?.netDollars??0),oldNetDollars:old.october.netDollars+old.november.netDollars,
    bothFilled:(oct?.bothFilled??0)+(nov?.bothFilled??0),oldBothFilled:old.october.bothFilled+old.november.bothFilled,
    eligibleSetups:setups.filter((r:any)=>r.confirmed>=october).length,closed:(oct?.closed??0)+(nov?.closed??0),profitable:(oct?.profitable??0)+(nov?.profitable??0),
    uncertain:(oct?.uncertain??0)+(nov?.uncertain??0),open:(oct?.open??0)+(nov?.open??0)};
}
const controlled=grid.filter(r=>r.spec.profile.name==='Corrected 10/25'&&r.spec.targets[0]===r.spec.targets[1]&&r.spec.cancel==='original-target');
const method={period:'Same 235 archived qualified XAUUSD setups, August 3–November 18, 2026',
  TP:'Targets are multiples of ORIGINAL reference-to-SL distance, measured from original reference. Original stop never moves. Actual per-entry RR differs with pullback entry. Common target multiples 1/1.25/1.5/1.75/2/2.5/3/4. Split targets 1:1.5, 1:2, 1:3, 1.5:2 and 1.5:3 for first/second legs.',
  entries:'Six entry profiles from earlier studies; all reference anchored except old-method comparator. Body percentages mean final confirmation candle body. Risk shares and deadlines are explicit per profile. No increase in fixed $4 setup risk.',
  cancellation:'original-target cancels any pending entries when ORIGINAL 1R TP is touched, but already-filled positions retain their larger experimental TP. new-target lets each pending leg remain eligible until its own experimental TP, SL or entry deadline. New-target can add later fills after the original trade would already have ended.',
  execution:'Offline per-leg state machine enumerates all possible OHLC event orders. Independent TP/SL states support split targets. Buy/sell mirror fixtures and original/corrected baseline parity pass. No breakeven, partial close or stop changes. Gaps and ordering conflicts remain uncertain; open positions are not counted as losses or wins.',
  selection:'Fit only earlier outcomes truncated at October 1 and November 1. Require >=85% both-entry fills, >=60% old resolved training count and positive conservative training R. Profit selection requires >=45% profitable resolved setups; balanced selection >=55%. Maximize conservative training R, then known-outcome R. Apply each choice to next month.',
  counting:'For common TP, TP/SL setup counts behave as previous studies. Split targets can create mixed TP/SL setups. Profitable-setup win rate is positive net R / all fully resolved filled setups; a mixed setup may be profitable or losing. Entry TP/SL counts are separately reported. Whole uncertain/open setups excluded from main P&L; scenario lower/upper bounds retain their risk.',
  cash:'Fixed $4 total setup risk, ideal fractional lots, no compounding. No spread, fees, slippage, margin, min-lot sizing, daily-loss or maximum-open-position limits, and no overlap half-risk adjustment. Higher targets hold trades longer, so these omissions can matter more. Existing $200 Exness minimum-lot constraint remains; results are not executable account returns.',
  history:'Archived qualified setups and historical dates were reused from earlier studies, not regenerated under a new strategy or independently unseen. Multiple searches increase overfitting. Missing bars remain uncertain. Monthly fold boundaries close the scoring window, not actual positions; no cross-fold position carry.',
  scope:'Experimental TP changes in offline research only. Trading source, live exits, account settings and open orders untouched.',
  hashes:Object.fromEntries(files.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex')]))};
fs.writeFileSync(new URL(`${stem}.json`,root),JSON.stringify({method,old,choices,walkForward:{profit:walkForward('profit'),balanced:walkForward('balanced')},controlled,selected,grid},null,2)+'\n');
const head=['id','profile','firstEntryPercent','secondEntryPercent','firstRiskShare','deadlineMinutes','firstTP_R','secondTP_R','pendingCancelAt','trainingNet','trainingLowerR','trainingWinPercent','trainingBothFillPercent','octoberNet','novemberNet','fullNet','fullLowerR','fullWinPercent','fullBothFilled','fullBothFillPercent','fullTPsetups','fullSLsetups','fullMixedSetups','fullTPlegs','fullSLlegs','fullUncertain','fullOpen','fullNetPips'];
fs.writeFileSync(new URL(`${stem}.csv`,root),[head.join(','),...grid.map(r=>[r.id,r.spec.profile.name,r.spec.profile.first,r.spec.profile.second,r.spec.profile.share,r.spec.profile.expiry,...r.spec.targets,r.spec.cancel,r.training.netDollars,r.training.lowerR,r.training.winPercent,r.training.bothFillPercent,r.october.netDollars,r.november.netDollars,r.full.netDollars,r.full.lowerR,r.full.winPercent,r.full.bothFilled,r.full.bothFillPercent,r.full.tp,r.full.sl,r.full.mixed,r.full.tpLegs,r.full.slLegs,r.full.uncertain,r.full.open,r.full.netPips].join(','))].join('\n')+'\n');
fs.writeFileSync(new URL(`${stem}-selected-trades.csv`,root),['variantId,signalUTC,direction,slot,entry,sl,tp,rr,riskShare,fillState,outcome,setupR',...selected.flatMap(s=>s.rows.flatMap(r=>r.legs.map(l=>[s.id,r.signalUTC,r.direction,l.slot+1,l.entry,l.stop,l.target,l.rr,l.share,l.fillState,l.outcome,l.setupR].join(','))))].join('\n')+'\n');
console.log(JSON.stringify({variants:156,walkForward:{profit:walkForward('profit'),balanced:walkForward('balanced')},controlled:controlled.map(r=>({target:r.spec.targets[0],full:r.full})),selected:selected.map(s=>({id:s.id,spec:s.spec,roles:s.roles,full:s.full}))},null,2));
