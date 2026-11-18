import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fetchTradingViewCandles } from '../src/services/tradingViewDatafeed';
import { analyzeMarketStructure, DISABLED_HIGHER_TIMEFRAME_CONFIRMATION, type StructureCandle, type StructureZone } from '../src/services/marketStructure';
import { prepareGoldOpposingZones, goldAutomationOpposingZoneBlocked, goldOpposingZoneBeforeOneR, goldAutomationRepeatAreaBlocked } from '../src/services/mt5Automation';
import { buildAlternatingSwingFibs, buildOneHourSwingFibs } from '../src/services/swingFib';
import { applySwingFibConfluence, applyPostChochH1SwingFibConfluence } from '../src/services/swingFibConfluence';
import { applyDayFibConfluence } from '../src/services/dayFibConfluence';
import { buildDayFibs, selectDayFibForTime } from '../src/services/dayFib';
import type { TradeTimeframe } from '../src/services/tradeLevels';

// Entry-time reconstruction only. No application/server import or order access.
const root=new URL('./',import.meta.url),stem='november-scalp-zone-review-2026-11-18';
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const save=(name:string,value:unknown)=>fs.writeFileSync(new URL(name,root),JSON.stringify(value,null,2)+'\n');
const review=read('november-scalp-sl-review-2026-11-18.json');
const sources:Partial<Record<TradeTimeframe,StructureCandle[]>>=read('november-scalp-sl-review-2026-11-18-candles.json');
const frames:TradeTimeframe[]=['M15','M30','H1','H4','D'];
const seconds:Record<string,number>={M5:300,M15:900,M30:1800,H1:3600,H4:14400,D:86400};
const confirmations:Record<string,number>={M5:DISABLED_HIGHER_TIMEFRAME_CONFIRMATION,M15:3600,M30:3600,H1:14400,H4:86400,D:604800};
const supports:Partial<Record<TradeTimeframe,TradeTimeframe[]>>={M15:['H1','H4'],M30:['H1','H4'],H1:['H4','D'],M5:['H1']};
// Preserve earlier cached context where available. Never use current zones as
// evidence of a historical obstacle: every analysis receives its own cutoff.
for(const [tf,file] of [['M15','five-month-m15-history-older.json'],['H1','h1-filter-history.json'],['H4','h4-regime-history.json']] as const){
  const merged=new Map<number,StructureCandle>();
  for(const c of [...read(file),...sources[tf]!])if(!merged.has(c.time)||c.complete!==false)merged.set(c.time,c);
  sources[tf]=[...merged.values()].sort((a,b)=>a.time-b.time);
}
for(const tf of ['M30','D','M5'] as TradeTimeframe[]){
  const file=`${stem}-${tf}.json`;
  sources[tf]=fs.existsSync(new URL(file,root))?read(file):await fetchTradingViewCandles({symbol:'XAUUSD',exchange:'OANDA',granularity:tf,count:5000,timeoutMs:20000});
  if(!fs.existsSync(new URL(file,root)))save(file,sources[tf]);
  console.log(tf,'history',sources[tf]!.length);
}
const cutoff=Date.parse(review.method.throughUTC)/1000;
const cache=new Map<string,ReturnType<typeof analyzeMarketStructure>>();
function rawAnalysis(tf:TradeTimeframe,candles:StructureCandle[],vip?:Array<{timeframe:string;zones:StructureZone[]}>){
  const key=JSON.stringify([tf,candles[0]?.time,candles.at(-1)?.time,candles.length,vip?.map(v=>[v.timeframe,v.zones.map(z=>[z.id,z.status,z.active,z.top,z.bottom])])]);
  let value=cache.get(key);
  if(!value){value=analyzeMarketStructure(candles,{allowSupplyDemand:['H1','H4','D'].includes(tf),sourceBarSeconds:seconds[tf],
    confirmationBarSeconds:confirmations[tf],zoneVisualBars:30,...(vip?{vipSupport:vip}:{})});cache.set(key,value);}
  return value;
}
function fibAligned(z:StructureZone){return z.fibStatus==='a-plus'&&z.fibDeepInvalidatedAt===undefined
  ||z.swingFibStatus==='a-plus'||z.dayFibStatus==='a-plus'||z.h1SwingFibStatus==='aligned';}
const rows=[];
const simulatedPriorLosses:any[]=[];
for(const trade of review.rows.filter((r:any)=>['sl','tp'].includes(r.outcome))){
  const signalAt=Date.parse(trade.signalUTC)/1000,asOf=signalAt+900;
  console.log('Reconstructing',trade.signalNepal,trade.outcome);
  const candles:Partial<Record<TradeTimeframe,StructureCandle[]>>={};
  const raw:Partial<Record<TradeTimeframe,ReturnType<typeof analyzeMarketStructure>>>={};
  for(const tf of [...frames,'M5'] as TradeTimeframe[]){
    // Match dashboard feed limits. Only bars closed by the entry are available.
    candles[tf]=sources[tf]!.filter(c=>c.complete!==false&&c.time+seconds[tf]<=asOf).slice(-(['M5','M15','M30'].includes(tf)?5000:1500));
    assert.ok(candles[tf]!.every(c=>c.time+seconds[tf]<=asOf));
    if(candles[tf]!.length>=12)raw[tf]=rawAnalysis(tf,candles[tf]!);
  }
  const seed=raw.H4!.lines.filter(l=>l.type==='swing'&&l.fromTime!==l.toTime&&l.fromPrice!==l.toPrice).sort((a,b)=>a.toTime-b.toTime)[0];
  const swing=seed?buildAlternatingSwingFibs(candles.H4!,{sourceTime:seed.fromTime,sourcePrice:seed.fromPrice,zeroTime:seed.toTime,zeroPrice:seed.toPrice}):[];
  const h1Swing=buildOneHourSwingFibs(candles.H1!,raw.H1!.markers);
  const analyzed:Partial<Record<TradeTimeframe,ReturnType<typeof analyzeMarketStructure>>>={};
  const aligned:Partial<Record<TradeTimeframe,StructureZone[]>>={};
  for(const tf of [...frames,'M5'] as TradeTimeframe[]){
    if(!raw[tf])continue;
    analyzed[tf]=rawAnalysis(tf,candles[tf]!, (supports[tf]??[]).filter(s=>raw[s]).map(s=>({timeframe:s,zones:raw[s]!.zones})));
    let zones=applySwingFibConfluence(candles[tf]!,analyzed[tf]!.zones,tf==='M5'?undefined:swing).zones;
    if(tf==='M15'||tf==='M30')zones=applyDayFibConfluence(candles[tf]!,zones,selectDayFibForTime(buildDayFibs(candles[tf]!),asOf),10,asOf).zones;
    if(tf==='M15')zones=applyPostChochH1SwingFibConfluence(candles[tf]!,zones,raw.M15!.lines,h1Swing);
    aligned[tf]=zones;
  }
  const entry=trade.legs[0].entry,stop=trade.stopLoss,target=trade.takeProfit,buy=trade.direction==='bullish';
  const risk=Math.abs(entry-stop),reward=Math.abs(target-entry);
  const resolution=Date.parse(trade.resolvedUTC)/1000,filled=Date.parse(trade.filledUTC)/1000;
  const evolution=sources.M15!.filter(c=>c.time>filled&&c.time<resolution&&c.complete!==false&&c.time+900<=cutoff);
  const zones=[];
  for(const tf of [...frames,'M5'] as TradeTimeframe[]){
    if(!aligned[tf])continue;
    const confirmed=new Map(prepareGoldOpposingZones(aligned[tf]!,tf,candles,{m15Structure:raw.M15,requireLtfFib:false}).map(z=>[z.id,z]));
    for(const z of aligned[tf]!){
      if(!z.active||!['valid','pending'].includes(z.status)||z.startTime>signalAt||(z.activeFromTime??z.startTime)>asOf)continue;
      const opposite=z.isBuy!==buy,overlapEntry=z.bottom<=entry&&z.top>=entry;
      const inForwardPath=opposite&&(buy?z.top>=entry&&z.bottom<=target:z.bottom<=entry&&z.top>=target);
      const nearDistance=overlapEntry?0:Math.min(Math.abs(z.top-entry),Math.abs(z.bottom-entry));
      if(!inForwardPath&&!overlapEntry&&nearDistance>risk)continue;
      const conf=confirmed.get(z.id),distance=inForwardPath?(buy?Math.max(0,z.bottom-entry):Math.max(0,entry-z.top)):nearDistance;
      const touches=evolution.filter(c=>c.high>=z.bottom&&c.low<=z.top);
      const first=touches[0];
      const rejected=first?evolution.filter(c=>c.time>=first.time).some(c=>c.high>=z.bottom&&c.low<=z.top&&(buy?c.close<z.bottom:c.close>z.top)):false;
      const confirmedBefore=conf?.opposingEngulfingConfirmedAt!==undefined&&conf.opposingEngulfingConfirmedAt<=asOf;
      zones.push({timeframe:tf,id:z.id,name:z.name,side:z.isBuy?'BUY':'SELL',status:z.status,tradeable:z.tradeable!==false,
        startUTC:new Date(z.startTime*1000).toISOString(),activeFromUTC:z.activeFromTime?new Date(z.activeFromTime*1000).toISOString():undefined,
        bottom:z.bottom,top:z.top,opposite,overlapEntry,inForwardPath,beforeTP:inForwardPath&&distance<reward,
        distanceR:distance/risk,fibAligned:fibAligned(z),fib:z.fibBand,swingFib:z.swingFibBand,dayFib:z.dayFibBand,h1SwingFib:z.h1SwingFibBand,
        engulfingConfirmedBeforeEntry:confirmedBefore,confirmationTimeframe:conf?.opposingEngulfingTimeframe,confirmationType:conf?.opposingEngulfingType,
        touchedBeforeExitExcludingEntryAndExitBars:!!first,rejectionCloseBeforeExit:rejected,
        firstTouchUTC:first?new Date(first.time*1000).toISOString():undefined});
    }
  }
  const signal={direction:buy?'BUY' as const:'SELL' as const,entry,stopLoss:stop,signalAt,calculatedAt:asOf};
  const policyZones=frames.flatMap(tf=>prepareGoldOpposingZones(aligned[tf]!,tf,candles,{m15Structure:raw.M15,requireLtfFib:false}));
  const policyBlock=goldOpposingZoneBeforeOneR(signal,policyZones);
  const repeatCandidate={...signal,symbol:'XAUUSD',tradeStyle:'INTRADAY'} as any;
  const repeatedLossArea=goldAutomationRepeatAreaBlocked(repeatCandidate,simulatedPriorLosses,raw.M15!.lines);
  const valid=zones.filter(z=>z.status==='valid'&&z.opposite&&z.beforeTP);
  rows.push({signalNepal:trade.signalNepal,signalUTC:trade.signalUTC,outcome:trade.outcome,type:trade.type,direction:trade.direction,
    entry,stopLoss:stop,takeProfit:target,insideMother:trade.insideMother,
    trends:Object.fromEntries(frames.map(tf=>[tf,analyzed[tf]!.trend])),
    features:{opposingM15BeforeTP:valid.some(z=>z.timeframe==='M15'),opposingHTFBeforeTP:valid.some(z=>z.timeframe!=='M15'&&z.timeframe!=='M5'),
      opposingM5BeforeTP:valid.some(z=>z.timeframe==='M5'),opposingFibBeforeTP:valid.some(z=>z.fibAligned),
      opposingConfirmedBeforeTP:valid.some(z=>z.engulfingConfirmedBeforeEntry),
      opposingFibConfirmedBeforeTP:valid.some(z=>z.fibAligned&&z.engulfingConfirmedBeforeEntry),
      entryInsideOpposing:valid.some(z=>z.overlapEntry),
      opposingZoneRejectionBeforeExit:valid.some(z=>z.touchedBeforeExitExcludingEntryAndExitBars&&z.rejectionCloseBeforeExit),
      m15TrendAgainst:analyzed.M15!.trend!=='neutral'&&analyzed.M15!.trend!==trade.direction,
      h1TrendAgainst:analyzed.H1!.trend!=='neutral'&&analyzed.H1!.trend!==trade.direction},
    otherGoldStrategyWouldBlock:!!policyBlock,
    chartLossAreaWouldBlockUnderOtherStyles:repeatedLossArea,
    scalpRepeatAreaActuallyBlocked:goldAutomationRepeatAreaBlocked({...repeatCandidate,tradeStyle:'SCALP_1_1'},simulatedPriorLosses,raw.M15!.lines),
    scalpOneToOneActuallyBlocked:goldAutomationOpposingZoneBlocked({...signal,tradeStyle:'SCALP_1_1'} as any,policyZones),
    nearestConfirmedPolicyBlock:policyBlock?{timeframe:policyBlock.zone.opposingZoneTimeframe,name:policyBlock.zone.name,
      bottom:policyBlock.zone.bottom,top:policyBlock.zone.top,distanceR:policyBlock.rewardRisk}:undefined,
    zones:zones.sort((a,b)=>Number(b.beforeTP)-Number(a.beforeTP)||a.distanceR-b.distanceR)});
  if(trade.outcome==='sl')simulatedPriorLosses.push({symbol:'XAUUSD',direction:signal.direction,entry,stopLoss:stop,status:'SL',closedAt:resolution+900});
}
const keys=Object.keys(rows[0].features),comparison=Object.fromEntries(keys.map(k=>[k,Object.fromEntries(['sl','tp'].map(o=>[o,
  {matching:rows.filter(r=>r.outcome===o&&r.features[k]).length,total:rows.filter(r=>r.outcome===o).length}]))]));
const result={method:{source:'TradingView OANDA XAUUSD',entrySnapshot:'Closed candles only, cutoff at confirmation close; rolling 5000 bars M5/M15/M30 and 1500 H1/H4/D. Historical M1 unavailable for all entries, so no M1 claims.',
  analysis:'Same market structure engine, mapped confirmation timing, VIP support, H4 Swing Fib, current-day Nepal Fib and post-CHoCH H1 Fib functions as the dashboard/server. Only active valid zones count as obstacles; pending zones are listed separately. All price obstacles are measured against actual first-leg entry and fixed TP.',
  limitations:'Reconstruction depends on available OHLC and rolling history. Zones are as known at entry, not hindsight-created zones. Reaction checks exclude both fill and exit candles and cannot prove causation. Plain, Fib-aligned and engulfing-confirmed zones are distinct. M5 context has shorter warmup than M15. Spread, slippage, historical news and account-specific execution constraints are not resolved by OHLC.',
  scope:'Research only; trading code and settings unchanged.'},comparison,policyComparison:Object.fromEntries(['sl','tp'].map(o=>[o,{otherGoldWouldBlock:rows.filter(r=>r.outcome===o&&r.otherGoldStrategyWouldBlock).length,scalpActuallyBlocked:rows.filter(r=>r.outcome===o&&r.scalpOneToOneActuallyBlocked).length}])),rows};
assert.equal(rows.length,23);assert.ok(rows.every(r=>!r.scalpOneToOneActuallyBlocked));
save(`${stem}.json`,result);
console.log(JSON.stringify({comparison,policyComparison:result.policyComparison,losses:rows.filter(r=>r.outcome==='sl').map(({zones,...r})=>({...r,obstacles:zones.filter(z=>z.status==='valid'&&z.opposite&&z.beforeTP)}))},null,2));
