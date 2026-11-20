// Offline research: archived prices in, study reports out. No trading calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scalpPullbackBarStates } from '../src/services/scalpOneToOne';

const root=new URL('./',import.meta.url), stem='scalp-validation-model-2026-11-20';
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
function replay(r:any,s:Spec,until:number,execution={bars,index,seconds:900}){
  const replayBars=execution.bars,replayIndex=execution.index,replaySeconds=execution.seconds;
  const base={signalUTC:r.signalUTC,confirmed:r.confirmed,direction:r.direction};
  if(r.missing||r.confirmed>=until)return {...base,outcome:'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0};
  const legs=levels(r,s);
  if(!legs.length)return {...base,outcome:'no-valid-entry',legs:[],netR:0,lowerR:0,upperR:0};
  let states:State[]=[legs.map(()=>0)],expected=r.confirmed;
  const openedAt:(number|undefined)[]=[],closedAt:(number|undefined)[]=[];
  const expiry=r.confirmed+s.profile.expiry*60;
  for(let i=replayIndex.get(r.confirmed)!;i<replayBars.length&&replayBars[i].time+replaySeconds<=until;i++){
    const bar=replayBars[i];
    if(bar.time!==expected){
      states=states.map(state=>state.map(value=>value===1?6:value===0?(expected>=expiry?4:5):value));break;
    }
    expected+=replaySeconds;
    const paths=states.flatMap(state=>state.every(v=>v>=2)?[state]:barStates(bar,legs,r.sign,state,bar.time<expiry));
    states=[...new Map(paths.map(state=>[state.join(','),state])).values()];
    legs.forEach((_,i)=>{
      if(openedAt[i]===undefined&&states.every(state=>[1,2,3,6].includes(state[i])))openedAt[i]=bar.time;
      if(closedAt[i]===undefined&&states.every(state=>[2,3,4].includes(state[i])))closedAt[i]=bar.time+replaySeconds;
    });
    if(states.every(state=>state.every(v=>v>=2)))break;
  }
  const outcomes=legs.map((leg,i)=>{
    const possibilities=[...new Set(states.map(state=>state[i]))];
    const fillState=states.every(state=>[1,2,3,6].includes(state[i]))?'filled':states.every(state=>state[i]===4)?'not-filled':'uncertain';
    const values=possibilities.map(v=>v===2?'tp':v===3?'sl':v===4?'not-filled':v===1?'open':v===0?'pending':'uncertain');
    const outcome=new Set(values).size===1?values[0]:'uncertain';
    return {...leg,openedAt:openedAt[i],closedAt:closedAt[i],fillState,outcome,possibleOutcomes:values,setupR:outcome==='tp'?leg.share*leg.rr:outcome==='sl'?-leg.share:0};
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

export {replay,stats,setups,cutoff,bars,index};
export type {Spec,Profile};
