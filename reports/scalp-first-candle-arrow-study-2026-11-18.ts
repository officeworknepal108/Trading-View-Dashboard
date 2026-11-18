import fs from 'node:fs';
import assert from 'node:assert/strict';
import { detectEngulfingPatternAt, type StructureCandle } from '../src/services/marketStructure';
import { volumeStudyLevels, volumeStudyGroup, type VolumeStudyRecord } from '../src/services/volumeEngulfingStudy';
import { scalpOneToOneChartHistory } from '../src/services/scalpOneToOne';
import { scalpHistoryFillDisplays } from '../src/services/scalpChartDisplay';
import { scalpOneToOneVolumePasses } from '../src/services/mt5Automation';

// Research artifacts only. Approved setup identities are reused from the full
// history study, then fills/arrows are replayed through the production functions.
const root=new URL('./',import.meta.url),stem='scalp-first-candle-arrow-study-2026-11-18';
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const save=(name:string,value:unknown)=>fs.writeFileSync(new URL(name,root),JSON.stringify(value,null,2)+'\n');
const archive=read('inside-mother-scalp-study-2026-11-18.json');
const asOf=Date.parse(archive.method.throughUTC)/1000;
const byTime=new Map<number,StructureCandle>();
for(const file of ['five-month-m15-history-older.json','five-month-m15-history-latest.json','inside-mother-scalp-study-2026-11-18-M15.json'])
  for(const c of read(file))if(!byTime.has(c.time)||c.complete!==false)byTime.set(c.time,c);
const bars=[...byTime.values()].sort((a,b)=>a.time-b.time),indices=new Map(bars.map((b,i)=>[b.time,i]));
const iso=(t:number)=>new Date(t*1000).toISOString();
const nepal=(t:number)=>new Date((t+20700)*1000).toISOString().slice(0,16).replace('T',' ');
function candleDirection(b:StructureCandle,buy:boolean){return b.close===b.open?'doji':(buy?b.close<b.open:b.close>b.open)?'opposite':'same';}
assert.equal(candleDirection({open:100,close:99} as StructureCandle,true),'opposite');
assert.equal(candleDirection({open:100,close:101} as StructureCandle,false),'opposite');
assert.equal(candleDirection({open:100,close:100} as StructureCandle,true),'doji');
const rows:any[]=[],excluded:any[]=[];
for(const approved of archive.rows){
  const time=Date.parse(approved.signalUTC)/1000,i=indices.get(time)!;
  const pattern=detectEngulfingPatternAt(bars,i);
  assert.ok(pattern&&pattern.type===approved.type&&pattern.direction===approved.direction,'Approved confirmation must match archived OHLC');
  const signal={type:approved.type,direction:approved.direction,timeframe:'M15' as const,time,candleCount:pattern.candleCount};
  const next=byTime.get(time+900);
  if(!next){excluded.push({signalUTC:approved.signalUTC,reason:'No consecutive next candle / no arrow'});continue;}
  const levels=volumeStudyLevels(bars,signal,next),volume=volumeStudyGroup(bars,signal);
  assert.ok(volume&&scalpOneToOneVolumePasses(signal.type,volume.v1,volume.v2,volume.v3));
  if(!levels){excluded.push({signalUTC:approved.signalUTC,reason:'No valid reference entry / no arrow'});continue;}
  const record:VolumeStudyRecord={id:`VE:XAUUSD:M15:${time}`,signal,confirmedAt:time+900,
    bias:signal.direction,...volume,levels,outcome:'active',filledAt:time+900};
  const history=scalpOneToOneChartHistory(record,{M15:bars},asOf);
  const displays=scalpHistoryFillDisplays(history.fills,asOf);
  for(const display of displays){
    const leg=display.entryLeg!,fill=history.fills.find(f=>f.leg===leg)!;
    const stored=approved.legs.find((l:any)=>l.leg===leg);
    assert.ok(stored?.filledUTC,'Displayed arrow needs archived confirmed-fill evidence');
    assert.equal(iso(display.markerTime),stored.filledUTC);
    assert.equal(fill.outcome,stored.outcome);
    assert.ok(Math.abs(display.trade.entry-stored.entry)<1e-7);
    assert.equal(display.markerOnly,true);
    const fillCandle=byTime.get(display.markerTime)!;
    assert.ok(fillCandle.complete!==false&&fillCandle.time+900<=asOf);
    assert.ok(next.complete!==false&&next.time+900<=asOf);
    const buy=signal.direction==='bullish';
    rows.push({id:display.id,setupUTC:iso(time),setupNepal:nepal(time),direction:signal.direction,type:signal.type,leg,
      nextCandleUTC:iso(next.time),nextCandleOpen:next.open,nextCandleClose:next.close,
      firstAfterEngulfing:candleDirection(next,buy),
      filledUTC:iso(display.markerTime),filledNepal:nepal(display.markerTime),fillDelayBars:(display.markerTime-next.time)/900,
      actualFillCandle:candleDirection(fillCandle,buy),outcome:fill.outcome,entry:display.trade.entry,
      stopLoss:display.trade.stopLoss,takeProfit:display.trade.takeProfit,
      rewardRisk:display.trade.rewardRisk,resolvedUTC:fill.trade.resolvedAt===undefined?undefined:iso(fill.trade.resolvedAt)});
  }
}
function summarize(group:typeof rows){
  const counts={tp:group.filter(r=>r.outcome==='tp').length,sl:group.filter(r=>r.outcome==='sl').length,
    active:group.filter(r=>r.outcome==='active').length,uncertain:group.filter(r=>r.outcome==='uncertain').length};
  const setups=[...new Set(group.map(r=>r.setupUTC))];
  const setupOutcomes={tp:0,sl:0,active:0,uncertain:0,mixed:0};
  for(const id of setups){const states=new Set(group.filter(r=>r.setupUTC===id).map(r=>r.outcome));
    setupOutcomes[states.size===1?[...states][0]:'mixed']++;}
  return {arrows:group.length,uniqueSetups:setups.length,...counts,closedArrows:counts.tp+counts.sl,
    winRate:counts.tp+counts.sl?counts.tp/(counts.tp+counts.sl)*100:null,
    firstEntryArrows:group.filter(r=>r.leg===10).length,secondEntryArrows:group.filter(r=>r.leg===25).length,setupOutcomes};
}
const groups=(field:string)=>Object.fromEntries(['opposite','same','doji'].map(key=>[key,summarize(rows.filter(r=>r[field]===key))]));
const result={method:{firstCandle:'The first M15 candle immediately after the completed engulfing confirmation. BUY+red, SELL+green = opposite. A doji is neither direction.',
  scope:'All available approved Scalp 1:1 historical entry arrows, 3 August–18 November 2026 through 07:45 Nepal. The two entry legs are counted separately, with a second unique-setup count. Chart simulations, not MT5 executions.',
  productionParity:'All known fills replayed through scalpOneToOneChartHistory and scalpHistoryFillDisplays; arrow identity, marker time, outcome and entry price checked against archived evidence.',
  delayedEntry:'The first post-engulfing candle and actual limit-fill candle can differ. Both definitions are reported separately. No unfilled or uncertain-fill order is counted as a confirmed arrow.',
  uncertainty:'An entry can be proven while its final result remains uncertain. Those arrows are included in the arrow count and excluded from TP/SL win rate. No outcome or candle close is treated as knowable before its own candle finishes.',
  limitations:'Reuses the approved setup universe of the full history study. No spread, commission, slippage or account execution restrictions. It does not establish that waiting for the next candle would preserve the original entry or improve returns.'},
  total:summarize(rows),firstAfterEngulfing:groups('firstAfterEngulfing'),actualFillCandle:groups('actualFillCandle'),
  delayedFillArrows:rows.filter(r=>r.fillDelayBars>0).length,
  candleClassificationDiffers:rows.filter(r=>r.firstAfterEngulfing!==r.actualFillCandle).length,
  byDirection:Object.fromEntries(['bullish','bearish'].map(d=>[d,Object.fromEntries(['opposite','same','doji'].map(k=>[k,summarize(rows.filter(r=>r.direction===d&&r.firstAfterEngulfing===k))]))])),
  bySignalMonth:Object.fromEntries([...new Set(rows.map(r=>r.setupUTC.slice(0,7)))].map(m=>[m,Object.fromEntries(['opposite','same','doji'].map(k=>[k,summarize(rows.filter(r=>r.setupUTC.startsWith(m)&&r.firstAfterEngulfing===k))]))])),excluded,rows};
assert.equal(rows.length,archive.rows.flatMap((r:any)=>r.legs).filter((l:any)=>l.filledUTC).length);
assert.equal(rows.length,new Set(rows.map(r=>r.id)).size);
assert.equal(rows.length,Object.values(result.firstAfterEngulfing).reduce((n,g)=>n+g.arrows,0));
assert.equal(rows.length,result.total.tp+result.total.sl+result.total.active+result.total.uncertain);
save(`${stem}.json`,result);
const columns=['setupNepal','direction','type','leg','firstAfterEngulfing','nextCandleOpen','nextCandleClose','filledNepal','fillDelayBars','actualFillCandle','outcome','entry','stopLoss','takeProfit'];
fs.writeFileSync(new URL(`${stem}.csv`,root),[columns.join(','),...rows.map(r=>columns.map(k=>r[k]??'').join(','))].join('\n')+'\n');
console.log(JSON.stringify({total:result.total,firstAfterEngulfing:result.firstAfterEngulfing,actualFillCandle:result.actualFillCandle,
  byDirection:result.byDirection,delayedFillArrows:result.delayedFillArrows,candleClassificationDiffers:result.candleClassificationDiffers},null,2));
