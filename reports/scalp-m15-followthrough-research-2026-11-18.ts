import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fetchTradingViewCandles } from '../src/services/tradingViewDatafeed';
import { analyzeMarketStructure, detectEngulfingPatternAt, type StructureCandle, type StructureZone } from '../src/services/marketStructure';
import { volumeStudyLevels, volumeStudyGroup, type VolumeStudyRecord } from '../src/services/volumeEngulfingStudy';
import { scalpOneToOnePullbackSignals, scalpOneToOneChartHistory, scalpPullbackBarStates } from '../src/services/scalpOneToOne';
import { prepareGoldOpposingZones, type Mt5SignalInput } from '../src/services/mt5Automation';
import { buildAlternatingSwingFibs, buildOneHourSwingFibs } from '../src/services/swingFib';
import { applySwingFibConfluence, applyPostChochH1SwingFibConfluence } from '../src/services/swingFibConfluence';
import { applyDayFibConfluence } from '../src/services/dayFibConfluence';
import { buildDayFibs, selectDayFibForTime } from '../src/services/dayFib';
import type { TradeTimeframe } from '../src/services/tradeLevels';

// Offline cohort comparison, plus one read-only historical market-data request.
// No dashboard/server imports, config mutations, bridge calls or order access.
const root=new URL('./',import.meta.url),stem='scalp-m15-followthrough-research-2026-11-18';
const read=(f:string)=>JSON.parse(fs.readFileSync(new URL(f,root),'utf8'));
const save=(f:string,v:unknown)=>fs.writeFileSync(new URL(f,root),JSON.stringify(v,null,2)+'\n');
const archive=read('inside-mother-scalp-study-2026-11-18.json');
const cutoff=Date.parse(archive.method.throughUTC)/1000;
const iso=(t:number)=>new Date(t*1000).toISOString();
const merge=(batches:StructureCandle[][])=>{
  const m=new Map<number,StructureCandle>();for(const a of batches)for(const c of a)if(!m.has(c.time)||c.complete!==false)m.set(c.time,c);
  return [...m.values()].sort((a,b)=>a.time-b.time);
};
const originalM15=merge(['five-month-m15-history-older.json','five-month-m15-history-latest.json','inside-mother-scalp-study-2026-11-18-M15.json'].map(read));
const warmFile=`${stem}-m15-warmup.json`;
if(!fs.existsSync(new URL(warmFile,root))){
  console.log('Loading preceding M15 history for entry-time zone warmup...');
  try { save(warmFile,await fetchTradingViewCandles({symbol:'XAUUSD',exchange:'OANDA',granularity:'M15',count:5000,endTime:originalM15[0].time-1,timeoutMs:45000})); }
  catch(error){
    if(!String(error).includes('history does not reach'))throw error;
    save(warmFile,[]);save(`${stem}-coverage.json`,{unavailableEarlierM15:String(error),policy:'Under 500 M15 bars is unknown; retain original setup and report assessed-only sensitivity separately.'});
  }
}
const sources:Partial<Record<TradeTimeframe,StructureCandle[]>>={
  M15:merge([read(warmFile),originalM15]),
  M30:read('november-scalp-zone-review-2026-11-18-M30.json'),
  H1:merge([read('h1-filter-history.json'),read('inside-mother-scalp-study-2026-11-18-H1.json')]),
  H4:merge([read('h4-regime-history.json'),read('inside-mother-scalp-study-2026-11-18-H4.json')]),
  D:read('november-scalp-zone-review-2026-11-18-D.json'),
};
const seconds:Record<string,number>={M15:900,M30:1800,H1:3600,H4:14400,D:86400};
const confirmation:Record<string,number>={M15:3600,M30:3600,H1:14400,H4:86400,D:604800};
const cohorts=archive.rows as any[];
const indices=new Map(originalM15.map((b,i)=>[b.time,i]));
const cache=new Map<string,{key:string;result:ReturnType<typeof analyzeMarketStructure>}>();
function analyze(tf:TradeTimeframe,bars:StructureCandle[],vip?:Array<{timeframe:string;zones:StructureZone[]}>){
  const slot=tf+(vip?':vip':':raw');
  const key=JSON.stringify([bars[0]?.time,bars.at(-1)?.time,bars.length,vip?.map(v=>[v.timeframe,v.zones.map(z=>[z.id,z.active,z.status,z.top,z.bottom])])]);
  const prior=cache.get(slot);if(prior?.key===key)return prior.result;
  const result=analyzeMarketStructure(bars,{sourceBarSeconds:seconds[tf],confirmationBarSeconds:confirmation[tf],
    allowSupplyDemand:['H1','H4','D'].includes(tf),zoneVisualBars:30,...(vip?{vipSupport:vip}:{})});
  cache.set(slot,{key,result});return result;
}
const zoneFile=`${stem}-zone-snapshots.json`;
const zoneSnapshots:Record<string,any>=fs.existsSync(new URL(zoneFile,root))?read(zoneFile):{};
const fib=(z:StructureZone)=>z.fibStatus==='a-plus'&&z.fibDeepInvalidatedAt===undefined||z.swingFibStatus==='a-plus'||z.dayFibStatus==='a-plus'||z.h1SwingFibStatus==='aligned';
function getZoneSnapshot(time:number,signals:Mt5SignalInput[]){
  const id=iso(time);if(zoneSnapshots[id])return zoneSnapshots[id];
  const at=time+900,candles:Partial<Record<TradeTimeframe,StructureCandle[]>>={},raw:Partial<Record<TradeTimeframe,ReturnType<typeof analyzeMarketStructure>>>={};
  const m15Bars=sources.M15!.filter(b=>b.complete!==false&&b.time+900<=at).length;
  if(m15Bars<500){const unknown={at:iso(at),m15Bars,coverage:'unknown-under-500-bars',obstacles:[],plain:false,fib:false,confirmed:false,fibConfirmed:false};zoneSnapshots[id]=unknown;return unknown;}
  for(const tf of ['D','H4','H1','M15'] as TradeTimeframe[]){
    candles[tf]=sources[tf]!.filter(b=>b.complete!==false&&b.time+seconds[tf]<=at).slice(-(tf==='M15'?5000:1500));
    assert.ok(candles[tf]!.every(b=>b.time+seconds[tf]<=at));
    raw[tf]=analyze(tf,candles[tf]!);
  }
  candles.M30=sources.M30!.filter(b=>b.complete!==false&&b.time+1800<=at).slice(-5000);
  assert.ok(candles.M15!.length>=500,'Insufficient prior M15 zone warmup');
  const enriched=analyze('M15',candles.M15!,['H1','H4'].map(tf=>({timeframe:tf,zones:raw[tf]!.zones})));
  const seed=raw.H4!.lines.filter(l=>l.type==='swing'&&l.fromTime!==l.toTime&&l.fromPrice!==l.toPrice).sort((a,b)=>a.toTime-b.toTime)[0];
  const swing=seed?buildAlternatingSwingFibs(candles.H4!,{sourceTime:seed.fromTime,sourcePrice:seed.fromPrice,zeroTime:seed.toTime,zeroPrice:seed.toPrice}):[];
  let zones=applySwingFibConfluence(candles.M15!,enriched.zones,swing).zones;
  zones=applyDayFibConfluence(candles.M15!,zones,selectDayFibForTime(buildDayFibs(candles.M15!),at),10,at).zones;
  zones=applyPostChochH1SwingFibConfluence(candles.M15!,zones,raw.M15!.lines,buildOneHourSwingFibs(candles.H1!,raw.H1!.markers));
  const confirmations=new Map(prepareGoldOpposingZones(zones,'M15',candles).map(z=>[z.id,z]));
  const buy=signals[0].direction==='BUY';
  const obstacles=zones.filter(z=>z.active&&z.status==='valid'&&z.isBuy!==buy&&z.startTime<=time&&(z.activeFromTime??z.startTime)<=at
    &&(z.invalidatedAt===undefined||z.invalidatedAt>at)&&signals.some(s=>buy?z.top>=s.entry&&z.bottom<s.takeProfit:z.bottom<=s.entry&&z.top>s.takeProfit))
    .map(z=>({id:z.id,name:z.name,bottom:z.bottom,top:z.top,tradeable:z.tradeable!==false,fibAligned:fib(z),
      confirmedAt:confirmations.get(z.id)?.opposingEngulfingConfirmedAt,
      confirmed:confirmations.get(z.id)?.opposingEngulfingConfirmedAt!==undefined&&confirmations.get(z.id)!.opposingEngulfingConfirmedAt!<=at}));
  const snapshot={at:iso(at),m15Bars:candles.M15!.length,coverage:'assessed',obstacles,plain:obstacles.length>0,
    fib:obstacles.some(z=>z.fibAligned),confirmed:obstacles.some(z=>z.confirmed),fibConfirmed:obstacles.some(z=>z.fibAligned&&z.confirmed)};
  zoneSnapshots[id]=snapshot;return snapshot;
}

type Leg={leg:number;share:number;entry:number;risk:number;rr:number;outcome:string;filledAt?:number;resolvedAt?:number};
function baselineLegs(r:VolumeStudyRecord,signals:Mt5SignalInput[],approved:any):Leg[]{
  const history=scalpOneToOneChartHistory(r,{M15:originalM15},cutoff);
  return signals.map(s=>{const f=history.fills.find(f=>f.leg===s.scalpEntry!.leg);
    return {leg:s.scalpEntry!.leg,share:s.scalpEntry!.riskShare,entry:s.entry,risk:Math.abs(s.entry-s.stopLoss),rr:s.rewardRisk,
      outcome:f?.outcome??(approved.legs.find((p:any)=>p.leg===s.scalpEntry!.leg)?.outcome==='uncertain'?'uncertain-fill':'not-filled'),filledAt:f?.trade.filledAt,resolvedAt:f?.trade.resolvedAt};});
}
/** Same OHLC event enumerator as production; activate original limits one bar later. */
function delayedLegs(signals:Mt5SignalInput[],source=originalM15,asOf=cutoff):Leg[]{
  const activation=signals[0].calculatedAt+900,expiry=signals[0].expiresAt;
  type State={mask:number;exit:number;filledAt:number[];resolvedAt?:number};
  let states:State[]=[{mask:0,exit:0,filledAt:[]}],expected=activation;
  for(const b of source.filter(b=>b.time>=activation&&b.complete!==false&&b.time+900<=asOf)){
    if(b.time!==expected){states=states.map(s=>s.exit?s:{...s,exit:2});break;}
    expected+=900;
    const paths=states.flatMap(s=>s.exit?[s]:scalpPullbackBarStates(b,signals,s.mask,b.time<expiry).map(p=>{
      const fills=[...s.filledAt];signals.forEach((_,i)=>{if(p.mask&(1<<i)&&!(s.mask&(1<<i)))fills[i]=b.time;});
      return {...p,filledAt:fills,resolvedAt:p.exit?b.time:undefined};}));
    states=[...new Map(paths.map(s=>[`${s.mask}:${s.exit}:${s.filledAt.join(',')}:${s.resolvedAt}`,s])).values()];
    if(states.every(s=>s.exit||!s.mask&&b.time+900>=expiry))break;
  }
  return signals.map((s,i)=>{
    const filled=states.every(p=>!!(p.mask&(1<<i)));
    const exits=new Set(states.map(p=>p.exit));
    const exit=filled&&exits.size===1?[...exits][0]:undefined;
    return {leg:s.scalpEntry!.leg,share:s.scalpEntry!.riskShare,entry:s.entry,risk:Math.abs(s.entry-s.stopLoss),rr:s.rewardRisk,
      outcome:!filled?(states.some(p=>!!(p.mask&(1<<i))||p.exit===2)?'uncertain-fill':'not-filled'):exit===1?'tp':exit===-1?'sl':exit===0?'active':'uncertain',
      filledAt:filled?Math.max(...states.map(p=>p.filledAt[i])):undefined,
      resolvedAt:filled&&states.every(p=>p.resolvedAt!==undefined)?Math.max(...states.map(p=>p.resolvedAt!)):undefined};
  });
}
// Verify that delayed orders cannot fill before activation or after expiry,
// and that missing candles remain unknown rather than becoming no-fill wins.
const testSignals=[99,97.5].map((entry,i)=>({direction:'BUY',entry,stopLoss:90,takeProfit:110,
  rewardRisk:(110-entry)/(entry-90),calculatedAt:1800,expiresAt:6300,
  scalpEntry:{leg:i===0?10:25,riskShare:i===0?.6:.4}} as Mt5SignalInput));
const testBar=(time:number,low:number,high=101,close=100):StructureCandle=>({time,open:100,high,low,close,complete:true});
const delayedTP=delayedLegs(testSignals,[testBar(1800,97),testBar(2700,97),testBar(3600,99,111,110)],4500);
assert.ok(delayedTP.every(l=>l.outcome==='tp'&&l.filledAt===2700));
const tooLate=delayedLegs(testSignals,[testBar(1800,97),...[2700,3600,4500,5400].map(t=>testBar(t,99.5)),testBar(6300,97)],7200);
assert.ok(tooLate.every(l=>l.outcome==='not-filled'&&l.filledAt===undefined));
assert.ok(delayedLegs(testSignals,[testBar(3600,97)],4500).every(l=>l.outcome==='uncertain-fill'));
const variants=['baseline','skipPlainM15','skipFibM15','skipConfirmedM15','skipFibConfirmedM15','delayAnyCandle','delaySameDirection','marketAfterAnyCandle','marketAfterSameDirection','skipPlainAndDelaySame','skipConfirmedAndDelaySame'] as const;
const data:any[]=[];
for(const [n,approved] of cohorts.entries()){
  const time=Date.parse(approved.signalUTC)/1000,i=indices.get(time)!,next=originalM15[i+1];
  const detected=detectEngulfingPatternAt(originalM15,i);
  assert.ok(detected&&detected.type===approved.type&&detected.direction===approved.direction);
  if(!next||next.time!==time+900){data.push({signalUTC:iso(time),direction:approved.direction,originalOutcome:approved.outcome,variants:Object.fromEntries(variants.map(v=>[v,{reason:'no-valid-entry',legs:[]}]))});continue;}
  const signal={type:approved.type,direction:approved.direction,timeframe:'M15' as const,time,candleCount:detected.candleCount};
  const levels=volumeStudyLevels(originalM15,signal,next),volume=volumeStudyGroup(originalM15,signal);
  assert.ok(levels&&volume);
  const record:VolumeStudyRecord={id:`VE:XAUUSD:M15:${time}`,signal,confirmedAt:time+900,bias:signal.direction,...volume,levels,outcome:'active',filledAt:time+900};
  const signals=scalpOneToOnePullbackSignals(record,{M15:originalM15},record.confirmedAt,240);
  if(!signals.length){data.push({signalUTC:iso(time),direction:approved.direction,originalOutcome:approved.outcome,variants:Object.fromEntries(variants.map(v=>[v,{reason:'no-valid-entry',legs:[]}]))});continue;}
  assert.ok(signals.every(s=>s.expiresAt<=cutoff),'Pending deadlines must be past for this frozen cohort');
  const base=baselineLegs(record,signals,approved);
  for(const l of base){const prior=approved.legs.find((p:any)=>p.leg===l.leg);assert.ok(prior&&Math.abs(prior.entry-l.entry)<1e-7);if(l.filledAt!==undefined){assert.equal(iso(l.filledAt),prior.filledUTC);assert.equal(l.outcome,prior.outcome);}}
  const zone=getZoneSnapshot(time,signals);
  const sign=signal.direction==='bullish'?1:-1;
  const direction=next.close===next.open?'doji':sign*(next.close-next.open)>0?'same':'opposite';
  const firstBarExit=sign>0?next.low<=levels.stopLoss||next.high>=levels.takeProfit:next.high>=levels.stopLoss||next.low<=levels.takeProfit;
  const waited=firstBarExit?[]:delayedLegs(signals);
  const nextOpen=originalM15.find(b=>b.time===record.confirmedAt+900)?.open;
  const marketRisk=nextOpen===undefined?NaN:sign*(nextOpen-levels.stopLoss);
  const marketReward=nextOpen===undefined?NaN:sign*(levels.takeProfit-nextOpen);
  const marketValid=Number.isFinite(marketRisk)&&marketRisk>0&&marketRisk<=30.000001&&marketReward>0;
  const market=!firstBarExit&&marketValid?delayedLegs(signals.map(s=>({...s,entry:nextOpen!,riskPips:marketRisk*10,rewardRisk:marketReward/marketRisk}))):[];
  const per:any={};
  for(const v of variants){
    if(v==='marketAfterAnyCandle'||v==='marketAfterSameDirection'){
      const reason=firstBarExit?'original-exit-reached-during-wait':v==='marketAfterSameDirection'&&direction!=='same'?'no-followthrough':!marketValid?'next-open-outside-risk-or-exit-boundaries':'delayed-market-entry';
      per[v]={reason,legs:reason==='delayed-market-entry'?market:[]};continue;
    }
    const block=v==='skipPlainM15'||v==='skipPlainAndDelaySame'?zone.plain:v==='skipFibM15'?zone.fib:v==='skipConfirmedM15'||v==='skipConfirmedAndDelaySame'?zone.confirmed:v==='skipFibConfirmedM15'?zone.fibConfirmed:false;
    const delayed=v==='delayAnyCandle'||v==='delaySameDirection'||v==='skipPlainAndDelaySame'||v==='skipConfirmedAndDelaySame';
    const same=v!=='delayAnyCandle'&&delayed;
    const reason=block?'zone-filter':delayed&&firstBarExit?'original-exit-reached-during-wait':same&&direction!=='same'?'no-followthrough':delayed?'delayed-entry':'original-entry';
    per[v]={reason,legs:block||delayed&&firstBarExit||same&&direction!=='same'?[]:delayed?waited:base};
  }
  data.push({signalUTC:iso(time),direction:signal.direction,type:signal.type,originalOutcome:approved.outcome,firstCandle:direction,zone,variants:per});
  if((n+1)%10===0){console.log('entry snapshots',n+1,'/',cohorts.length);save(zoneFile,zoneSnapshots);}
}
save(zoneFile,zoneSnapshots);
function summarize(variant:string,group:any[]){
  const fills=group.flatMap(r=>r.variants[variant].legs.map((l:Leg)=>({...l,signalUTC:r.signalUTC}))).filter(l=>l.filledAt!==undefined);
  const tp=fills.filter(l=>l.outcome==='tp'),sl=fills.filter(l=>l.outcome==='sl');
  const gross=tp.reduce((n,l)=>n+l.share*l.rr,0)-sl.reduce((n,l)=>n+l.share,0);
  const cost=(price:number)=>fills.filter(l=>l.outcome==='tp'||l.outcome==='sl').reduce((n,l)=>n+price*l.share/l.risk,0);
  const series=[...tp.map(l=>({...l,pnl:l.share*l.rr})),...sl.map(l=>({...l,pnl:-l.share}))].sort((a,b)=>a.resolvedAt-b.resolvedAt);
  let equity=0,peak=0,drawdown=0;for(const leg of series){equity+=leg.pnl;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity);}
  const setupOutcome=(r:any)=>{const ls=r.variants[variant].legs as Leg[];if(!ls.length)return'skipped';
    const proven=ls.filter(l=>l.filledAt!==undefined),outcomes=new Set(proven.map(l=>l.outcome));
    if(!proven.length)return'no-proven-fill';if(outcomes.has('uncertain'))return'uncertain';return outcomes.size===1?[...outcomes][0]:'mixed';};
  const unknown=group.flatMap(r=>r.variants[variant].legs).filter(l=>['uncertain','uncertain-fill','active'].includes(l.outcome));
  return {consideredSetups:group.length,unknownZoneContext:group.filter(r=>r.zone?.coverage==='unknown-under-500-bars').length,activatedSetups:group.filter(r=>r.variants[variant].legs.length).length,
    provenFillSetups:new Set(fills.map(l=>l.signalUTC)).size,setupTP:group.filter(r=>setupOutcome(r)==='tp').length,setupSL:group.filter(r=>setupOutcome(r)==='sl').length,
    filledArrows:fills.length,tp:tp.length,sl:sl.length,uncertain:fills.filter(l=>l.outcome==='uncertain').length,open:fills.filter(l=>l.outcome==='active').length,
    unprovenLegFills:group.flatMap(r=>r.variants[variant].legs).filter(l=>l.filledAt===undefined).length,
    unknownFillLegs:group.flatMap(r=>r.variants[variant].legs).filter(l=>l.outcome==='uncertain-fill').length,
    broadGrossRLow:gross-unknown.reduce((n,l)=>n+l.share,0),broadGrossRHigh:gross+unknown.reduce((n,l)=>n+l.share*l.rr,0),
    winRate:tp.length+sl.length?tp.length/(tp.length+sl.length)*100:null,grossR:gross,
    modeledNetR030:gross-cost(.30),modeledNetR060:gross-cost(.60),grossUSDAt50Risk:gross*50,modeledNetUSDAt50Risk030:(gross-cost(.30))*50,
    confirmedClosedEquityMaxDrawdownR:drawdown,
    knownOriginalWinnersSkipped:group.filter(r=>r.originalOutcome==='tp'&&r.variants[variant].legs.length===0).length,
    knownOriginalLosersSkipped:group.filter(r=>r.originalOutcome==='sl'&&r.variants[variant].legs.length===0).length};
}
const summary=Object.fromEntries(variants.map(v=>[v,summarize(v,data)]));
assert.equal(summary.baseline.tp,216);assert.equal(summary.baseline.sl,150);assert.equal(summary.baseline.filledArrows,416);
assert.ok(Math.abs(summary.baseline.grossR-45.83474317349684)<1e-7);
const byMonth=Object.fromEntries([...new Set(data.map(r=>r.signalUTC.slice(0,7)))].map(m=>[m,Object.fromEntries(variants.map(v=>[v,summarize(v,data.filter(r=>r.signalUTC.startsWith(m)))]))]));
const determinate=(r:any,v:string)=>r.variants[v].legs.every((l:Leg)=>['tp','sl','not-filled'].includes(l.outcome));
const commonDeterminate=Object.fromEntries(variants.map(v=>{const eligible=data.filter(r=>determinate(r,'baseline')&&determinate(r,v));
  return [v,{setups:eligible.length,baseline:summarize('baseline',eligible),variant:summarize(v,eligible)}];}));
const result={method:{period:archive.method.throughUTC,cohort:'235 previously approved setups, 3 August–18 November 2026 through 07:45 Nepal; fixed cohort, not requalified using the added zone warmup history.',
  zones:'M15 active valid opposing structural zone known at confirmation close, before the original TP for either planned leg. Plain, Fib, completed engulfing confirmation, and Fib+confirmation variants fixed before viewing results. M15 zone analysis has up to 5000 prior closed bars; H1/H4/D support has up to 1500. Under 500 M15 bars is unknown, not no-zone; those setups are retained unchanged by zone filters. Assessed-only, 2000-bar and 5000-bar sensitivities are separate.',
  delay:'Orders activate at the second candle open after confirmation, only after the first candle closes; retain original two limit prices, fixed exits, 60/40 budget and original expiry (60 minutes remain). Cancel if the first waiting candle touched an original SL/TP. Same-direction variant rejects dojis and opposite closes. Original limit-price fills are used consistently, without credit for favorable opening-gap improvement. Separate market variants enter at that next open with original fixed SL/TP, resize to the same 60/40 full-setup risk and require a positive stop/target geometry with stop <=300 pips; the two legs have the same market price.',
  costs:'Fixed full-setup risk; returns weighted 60/40. Gross and illustrative 0.30 / 0.60 Gold price-unit round-trip cost deductions per closed leg, scaled by its planned stop distance. Not observed spreads/commission; does not resimulate bid/ask execution or lot rounding.',
  uncertainty:'Known closed-leg returns only; uncertain outcomes and unproven fills are reported separately, not treated as known wins/losses. Broad gross bounds allow each uncertain filled/unproven leg to lose its allocated share or gain its planned share*RR, so they are conservative scenario bounds, not confidence intervals. Common-determinate pairs exclude uncertainty from both versions. Closed-equity drawdown excludes uncertain/open positions and overlapping intratrade exposure; it is not live portfolio drawdown.',
  validation:'Production baseline reconciles all 416 entry arrows, 216 TP, 150 SL and +45.834743R. Earlier/later and monthly comparisons below are retrospective robustness checks, not untouched holdouts. No live code/settings changed.'},summary,byMonth,
  commonDeterminate,bySide:Object.fromEntries(['bullish','bearish'].map(d=>[d,Object.fromEntries(variants.map(v=>[v,summarize(v,data.filter(r=>r.direction===d))]))])),
  coverageSensitivity:Object.fromEntries([500,2000,5000].map(min=>[min,Object.fromEntries(variants.map(v=>[v,summarize(v,data.filter(r=>r.zone?.coverage==='assessed'&&r.zone.m15Bars>=min))]))])),
  chronological:Object.fromEntries(['beforeOct','fromOct'].map(p=>[p,Object.fromEntries(variants.map(v=>[v,summarize(v,data.filter(r=>p==='beforeOct'?r.signalUTC<'2026-10-01':r.signalUTC>='2026-10-01'))]))])),data};
save(`${stem}.json`,result);
console.log(JSON.stringify({summary,byMonth:Object.fromEntries(Object.entries(byMonth).map(([m,vs]:any)=>[m,Object.fromEntries(Object.entries(vs).map(([v,s]:any)=>[v,{grossR:s.grossR,tp:s.tp,sl:s.sl,netR030:s.modeledNetR030}]))]))},null,2));
