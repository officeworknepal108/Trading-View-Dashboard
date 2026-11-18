import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fetchTradingViewCandles } from '../src/services/tradingViewDatafeed';
import { runVolumeStudy, volumeStudyAtrAt } from '../src/services/volumeEngulfingStudy';
import { scalpOneToOneVolumePasses } from '../src/services/mt5Automation';
import { scalpOneToOnePullbackSignals, scalpOneToOneChartHistory } from '../src/services/scalpOneToOne';
import { chartPullbackState } from '../src/services/pullbackEntryDisplay';
import type { StructureCandle } from '../src/services/marketStructure';

// Read-only trading research; only research artifacts are written.
const root = new URL('./', import.meta.url), stem = 'november-scalp-sl-review-2026-11-18';
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const save = (name: string,value: unknown) => fs.writeFileSync(new URL(name,root),JSON.stringify(value,null,2)+'\n');
const iso = (t: number) => new Date(t*1000).toISOString();
const npt = (t: number) => new Date((t+20700)*1000).toISOString().slice(0,16).replace('T',' ');
const since = Date.parse('2026-11-01T00:00:00+05:45')/1000;
const now = Math.floor(Date.now()/1000), inputFile = `${stem}-candles.json`;
let inputs: Record<string,StructureCandle[]>;
if (fs.existsSync(new URL(inputFile,root))) inputs=read(inputFile);
else {
  inputs={};
  for (const tf of ['M15','H1','H4']) {
    const fresh=await fetchTradingViewCandles({symbol:'XAUUSD',exchange:'OANDA',granularity:tf,count:5000,timeoutMs:20000});
    const prior=read(`inside-mother-scalp-study-2026-11-18-${tf}.json`);
    const merged=new Map<number,StructureCandle>();
    for (const c of [...prior,...fresh]) if (!merged.has(c.time)||c.complete!==false) merged.set(c.time,c);
    inputs[tf]=[...merged.values()].sort((a,b)=>a.time-b.time);
    console.log(tf,inputs[tf].length,'bars through',iso(inputs[tf].at(-1)!.time));
  }
  save(inputFile,inputs);
}
const bars=inputs.M15,cutoff=Math.min(now,bars.at(-1)!.time+(bars.at(-1)!.complete===false?0:900));
const lookback=bars.filter(b=>b.time>=since).length+3;
const study=runVolumeStudy({symbol:'XAUUSD',timeframe:'M15',biasTimeframe:'H4',h4EmaFilter:true,h1TrendlineFilter:true,
  cutoff,lookback,candles:inputs});
const byTime=new Map(bars.map((b,i)=>[b.time,i]));
const median=(values:number[])=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?(v[Math.floor((v.length-1)/2)]+v[Math.ceil((v.length-1)/2)])/2:null;};
const rows=study.records.filter(r=>r.signal.time>=since&&scalpOneToOneVolumePasses(r.signal.type,r.v1,r.v2,r.v3)).map(r=>{
  const i=byTime.get(r.signal.time)!,count=r.signal.candleCount,pattern=bars.slice(i-count+1,i+1),c=bars[i];
  const sign=r.signal.direction==='bullish'?1:-1;
  const signals=scalpOneToOnePullbackSignals(r,inputs,r.confirmedAt,240);
  const history=scalpOneToOneChartHistory(r,inputs,cutoff);
  const legs=signals.map(s=>{const f=history.fills.find(f=>f.leg===s.scalpEntry!.leg),chart=chartPullbackState(s,bars,cutoff);
    return {leg:s.scalpEntry!.leg,entry:s.entry,risk:Math.abs(s.entry-s.stopLoss),rr:s.rewardRisk,
      outcome:f?.outcome??(['filled','unavailable','ambiguous'].includes(chart.status)?'uncertain':chart.status==='waiting'?'pending':'not-filled'),
      filledAt:f?.trade.filledAt,resolvedAt:f?.trade.resolvedAt};});
  const actual=legs.filter(l=>['tp','sl','active'].includes(l.outcome)),outcomes=new Set(actual.map(l=>l.outcome));
  const outcome=!legs.length?'no-valid-entry':legs.some(l=>l.outcome==='uncertain')?'uncertain':outcomes.size>1?'mixed':actual.length?actual[0].outcome:legs.some(l=>l.outcome==='pending')?'pending':'not-filled';
  let mother:StructureCandle|undefined;
  let high=Math.max(...pattern.map(b=>b.high)),low=Math.min(...pattern.map(b=>b.low));
  for(let j=i-count;j>=0;j--){const m=bars[j];if(bars[j+1].time!==m.time+900)break;
    if(high<=m.high&&low>=m.low&&(high<m.high||low>m.low)){mother=m;break;}
    high=Math.max(high,m.high);low=Math.min(low,m.low);}
  const h1=inputs.H1.filter(b=>b.complete!==false&&b.time+3600<=r.confirmedAt);
  const m15=bars.filter(b=>b.complete!==false&&b.time+900<=r.confirmedAt);
  const atr=volumeStudyAtrAt(bars,'M15',r.confirmedAt)!;
  const filledAt=actual.length?Math.min(...actual.map(l=>l.filledAt!)):undefined;
  const resolvedAt=actual.length&&actual.every(l=>l.resolvedAt!==undefined)?Math.max(...actual.map(l=>l.resolvedAt!)):undefined;
  const entry=actual[0]?.entry??legs[0]?.entry??r.levels.entry;
  // Exclude both the fill and exit candles when measuring favorable excursion:
  // OHLC alone cannot sequence their wicks against the entry/exit event.
  const between=filledAt===undefined||resolvedAt===undefined?[]:bars.filter(b=>b.time>filledAt&&b.time<resolvedAt&&b.complete!==false);
  const favorable=between.length?Math.max(0,...between.map(b=>sign*(sign>0?b.high-entry:b.low-entry))):0;
  const after=resolvedAt===undefined?[]:bars.filter(b=>b.time>resolvedAt&&b.time<=resolvedAt+8*900&&b.time+900<=cutoff&&b.complete!==false);
  const recoveryKnown=after.length===8&&after.every((b,j)=>b.time===resolvedAt!+(j+1)*900);
  const next=bars[i+1];
  const priorSwing=bars.slice(Math.max(0,i-8),i-count+1);
  const stopInsideRecentSwing=priorSwing.length>0&&(sign>0?r.levels.stopLoss>Math.min(...priorSwing.map(b=>b.low))
    :r.levels.stopLoss<Math.max(...priorSwing.map(b=>b.high)));
  return {signalUTC:iso(r.signal.time),signalNepal:npt(r.signal.time),direction:r.signal.direction,type:r.signal.type,outcome,
    insideMother:!!mother,motherUTC:mother?iso(mother.time):undefined,
    volumeGap:(r.signal.type==='T1'?r.v1!:r.v2!)-(r.signal.type==='T1'?r.v2!:r.v3!),
    volumeGapPercent:((r.signal.type==='T1'?r.v1!:r.v2!)-(r.signal.type==='T1'?r.v2!:r.v3!))/(r.signal.type==='T1'?r.v1!:r.v2!)*100,
    atr,patternRangeATR:(Math.max(...pattern.map(b=>b.high))-Math.min(...pattern.map(b=>b.low)))/atr,
    confirmationRangeATR:(c.high-c.low)/atr,bodyFraction:Math.abs(c.close-c.open)/(c.high-c.low),
    closeStrength:sign>0?(c.close-c.low)/(c.high-c.low):(c.high-c.close)/(c.high-c.low),
    h1MomentumAgainst:h1.length>=4?sign*(h1.at(-1)!.close-h1.at(-4)!.open)<0:null,
    m15MomentumAgainst:m15.length>=4?sign*(m15.at(-1)!.close-m15.at(-4)!.open)<0:null,
    lastH1CandleAgainst:h1.length?sign*(h1.at(-1)!.close-h1.at(-1)!.open)<0:null,
    h4Bias:r.bias,h4EmaAligned:r.h4Ema?sign*(r.h4Ema.ema20-r.h4Ema.ema50)>0:false,
    h1SupportATR:r.h1Trendline?.distance?.atrRatio,h1SupportPips:r.h1Trendline?.distance?.pips,
    stopLoss:r.levels.stopLoss,takeProfit:r.levels.takeProfit,stopInsideRecentSwing,
    riskATR:legs[0]?.risk/atr,fillDelayBars:filledAt===undefined?null:(filledAt-r.confirmedAt)/900,
    exitAfterBars:resolvedAt===undefined||filledAt===undefined?null:(resolvedAt-filledAt)/900,
    firstExecutionCandleAgainst:next&&next.complete!==false?sign*(next.close-next.open)<0:null,
    knownFavorableBeforeExitR:legs[0]?favorable/legs[0].risk:null,
    recoveryKnown,targetReachedWithin2hAfterExit:recoveryKnown?after.some(b=>sign>0?b.high>=r.levels.takeProfit:b.low<=r.levels.takeProfit):null,
    filledUTC:filledAt===undefined?undefined:iso(filledAt),resolvedUTC:resolvedAt===undefined?undefined:iso(resolvedAt),legs};
});
const losses=rows.filter(r=>r.outcome==='sl'),wins=rows.filter(r=>r.outcome==='tp');
const features={insideMother:(r:any)=>r.insideMother,h1MomentumAgainst:(r:any)=>r.h1MomentumAgainst,
  m15MomentumAgainst:(r:any)=>r.m15MomentumAgainst,lastH1CandleAgainst:(r:any)=>r.lastH1CandleAgainst,
  stopInsideRecentSwing:(r:any)=>r.stopInsideRecentSwing,firstExecutionCandleAgainst:(r:any)=>r.firstExecutionCandleAgainst,
  stopWithinOneATR:(r:any)=>r.riskATR<1,stopHitWithin30min:(r:any)=>r.exitAfterBars!==null&&r.exitAfterBars<=2,
  closeStrengthBelow60pct:(r:any)=>r.closeStrength<.6,delayedFill:(r:any)=>r.fillDelayBars>0,
  returnedToOriginalTargetWithin2h:(r:any)=>r.targetReachedWithin2hAfterExit};
const comparison=Object.fromEntries(Object.entries(features).map(([key,test])=>[key,{sl:losses.filter(test).length,slTotal:losses.length,tp:wins.filter(test).length,tpTotal:wins.length}]));
const distributions=Object.fromEntries(['riskATR','h1SupportATR','volumeGapPercent','confirmationRangeATR','closeStrength','fillDelayBars','exitAfterBars'].map(key=>[key,
  {slMedian:median(losses.map(r=>r[key])),tpMedian:median(wins.map(r=>r[key]))}]));
const byType=Object.fromEntries(['T1','T2','T3'].map(type=>[type,{sl:losses.filter(r=>r.type===type).length,tp:wins.filter(r=>r.type===type).length}]));
const result={method:{fromNepal:npt(since),throughNepal:npt(cutoff),throughUTC:iso(cutoff),
  strategy:'Current Scalp 1:1, same production filters and split-entry history functions; chart simulations, not a reconstruction of MT5 fills.',
  limitations:'Descriptive comparisons, overlapping features and small sample. No causal attribution to news/spread/slippage without broker ticks and archived event timestamps. Post-entry measurements are diagnostic, not pre-entry filters. Prior-swing comparison uses the 8 candles ending before the pattern, not a confirmed pivot. Recovery check requires 8 consecutive completed candles strictly after exit.',
  scope:'Only report artifacts written; trading settings/code unchanged.'},counts:rows.reduce((a,r)=>(a[r.outcome]=(a[r.outcome]??0)+1,a),{} as Record<string,number>),comparison,distributions,byType,rows};
assert.equal(Object.values(result.counts).reduce((a,b)=>a+b,0),rows.length);
save(`${stem}.json`,result);
const cols=['signalNepal','direction','type','outcome','insideMother','h1MomentumAgainst','m15MomentumAgainst','stopInsideRecentSwing','riskATR','volumeGapPercent','fillDelayBars','exitAfterBars','firstExecutionCandleAgainst','targetReachedWithin2hAfterExit'];
fs.writeFileSync(new URL(`${stem}.csv`,root),[cols.join(','),...rows.map(r=>cols.map(k=>r[k]??'').join(','))].join('\n')+'\n');
console.log(JSON.stringify({method:result.method,counts:result.counts,comparison,distributions,byType,losses},null,2));
