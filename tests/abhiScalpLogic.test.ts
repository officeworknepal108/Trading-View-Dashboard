import test from 'node:test';
import assert from 'node:assert/strict';
import { scalpOneToOnePullbackSignals, scalpOneToOneChartHistory } from '../src/services/scalpOneToOne';
import { scalpPullbackSignalError, selectSecondOnlyPullback, type Mt5StoredSignal } from '../src/services/mt5Automation';
import { buildPullbackChartSetups, chartSignalFromHistoryFill } from '../src/services/pullbackChartSetup';
import { groupPullbackTableSignals } from '../src/services/pullbackEntryDisplay';
import { pullbackTelegramAlerts } from '../src/services/pullbackTelegram';
import { formatTelegramTradeMessage } from '../src/services/telegramMessages';
import { pullbackExpirySeconds } from '../src/services/pullbackExpiry';
import type { VolumeStudyRecord } from '../src/services/volumeEngulfingStudy';

const record: VolumeStudyRecord={id:'fixture',signal:{type:'T1',direction:'bullish',time:900,timeframe:'M15',candleCount:2},
  confirmedAt:1800,bias:'bullish',group:'V2 < V1',v1:1300,v2:1000,v3:750,
  outcome:'active',filledAt:1800,levels:{entry:100,stopLoss:90,takeProfit:110,riskFree:110,rewardRisk:1,riskPips:100,
    riskFreeEnabled:false,status:'active',pendingAtCreation:false,calculatedAt:1800,filledAt:1800,
    signal:{type:'T1',direction:'bullish',time:900,timeframe:'M15',candleCount:2}}};
const confirmation={time:900,open:90,close:100,high:101,low:89,volume:750,complete:true};
const bars=[{time:1800,open:100,high:101,low:97,close:100,complete:true},
  {time:2700,open:100,high:108,low:99,close:107,complete:true},
  {time:3600,open:107,high:111,low:100,close:110.5,complete:true}];
const signals=()=>scalpOneToOnePullbackSignals(record,{M15:[confirmation]},1800,15);
const stored=():Mt5StoredSignal[]=>signals().map((s,i)=>({...s,account:'test',server:'demo',brokerSymbol:'GOLD',bridgeId:'bridge',
  status:i===0?'CLAIMED':'QUEUED',createdAt:1800,updatedAt:1800,scalpSetupRiskBudget:100}));

test('T1/T2/T3 anchor both Abhi entries to their final confirmation close, never the next open',()=>{
  for(const type of ['T1','T2','T3'] as const)for(const direction of ['bullish','bearish'] as const){
    const sell=direction==='bearish';
    const r={...record,signal:{...record.signal,type,direction,candleCount:type==='T1'?2 as const:3 as const},
      levels:{...record.levels,stopLoss:sell?110:90,takeProfit:sell?90:110}};
    const c=sell?{...confirmation,open:110,high:111,low:99}:confirmation;
    const a=scalpOneToOnePullbackSignals(r,{M15:[c]},1800,15);
    const b=scalpOneToOnePullbackSignals(r,{M15:[c,{...bars[0],open:140}]},1800,15);
    assert.deepEqual(a,b);assert.deepEqual(a.map(s=>s.entry),sell?[101,102.5]:[99,97.5]);
    assert.deepEqual(a.map(s=>s.takeProfit),sell?[89.75,93.125]:[110.25,106.875]);
    assert.deepEqual(a.map(s=>s.scalpEntry!.riskShare),[.4,.6]);
    assert.ok(a.every(s=>s.expiresAt===5400&&s.rewardRisk===1.25&&s.stopLoss===(sell?110:90)&&scalpPullbackSignalError(s)===undefined));
  }
  assert.deepEqual(scalpOneToOnePullbackSignals(record,{M15:[confirmation]},1799,15),[]);
});

test('the closed confirmation body filter is inclusive at 30% and rejects forming candles',()=>{
  const c={...confirmation,open:97,high:105,low:95};
  assert.equal(scalpOneToOnePullbackSignals(record,{M15:[c]},1800,15).length,2);
  for(const changed of [{...c,open:97.001},{...c,complete:false},{...c,open:100}])
    assert.deepEqual(scalpOneToOnePullbackSignals(record,{M15:[changed]},1800,15),[]);
});

test('Abhi validation rejects wrong anchors, targets, budgets, pip distances and deadlines',()=>{
  const s=signals()[0];
  for(const changed of [{...s,takeProfit:110},{...s,riskPips:1},{...s,expiresAt:6300},
    {...s,scalpEntry:{...s.scalpEntry!,nextOpen:101}},
    {...s,scalpEntry:{...s.scalpEntry!,confirmationClose:101}},
    {...s,scalpEntry:{...s.scalpEntry!,confirmationRange:100}},
    {...s,scalpEntry:{...s.scalpEntry!,riskShare:.6}}]) assert.ok(scalpPullbackSignalError(changed));
  assert.equal(pullbackExpirySeconds(3,900),4500);assert.equal(pullbackExpirySeconds(4,900),3600);
});

test('minimum-lot fallback joins different Abhi targets atomically and cannot touch accepted orders',()=>{
  const a=stored();assert.notEqual(a[0].takeProfit,a[1].takeProfit);
  selectSecondOnlyPullback(a,a[0].id,'test','demo','bridge',1801);
  assert.equal(a[0].status,'CANCELLED');assert.ok(a.every(s=>s.pullbackFallback==='SECOND_ONLY'));
  assert.equal(a[1].scalpSetupRiskBudget,100);assert.equal(a[1].takeProfit,106.875);
  for(const fields of [{brokerTicket:123},{openedAt:1800},{status:'PLACED' as const}]){
    const b=stored();Object.assign(b[1],fields);
    assert.throws(()=>selectSecondOnlyPullback(b,b[0].id,'test','demo','bridge',1801));
    assert.ok(b.every(s=>!s.pullbackFallback));
  }
});

test('Abhi history and chart keep the first trade open after the deeper entry hits its own target',()=>{
  const candles={M15:[confirmation,...bars]};
  const early=scalpOneToOneChartHistory(record,candles,3600);
  assert.deepEqual(early.records.map(r=>r.result),['open','tp']);
  assert.deepEqual(early.records.map(r=>r.takeProfit),[110.25,106.875]);
  const sigs=early.fills.map(chartSignalFromHistoryFill).filter(s=>!!s);
  assert.equal(groupPullbackTableSignals(sigs).length,1);
  const setup=buildPullbackChartSetups({signals:sigs,asOf:3600,candles})[0];
  assert.equal(setup.abhi,true);assert.equal(setup.drawing,true);assert.equal(setup.netReturnR,undefined);
  assert.ok(!pullbackTelegramAlerts(setup,3600).some(a=>a.kind==='tp'||a.kind==='sl'));
  const final=scalpOneToOneChartHistory(record,candles,4500);
  assert.deepEqual(final.records.map(r=>r.result),['tp','tp']);
});

test('Abhi chart messages show individual targets and classify a mixed setup by weighted risk',()=>{
  const candles={M15:[confirmation,...bars.slice(0,2),{...bars[2],high:108,low:89,close:90}]};
  const history=scalpOneToOneChartHistory(record,candles,4500);
  const setup=buildPullbackChartSetups({signals:history.fills.map(chartSignalFromHistoryFill).filter(s=>!!s),asOf:4500,candles})[0];
  assert.ok(Math.abs(setup.netReturnR!-.35)<1e-7);
  const alerts=pullbackTelegramAlerts(setup,4500),entry=alerts.find(a=>a.kind==='entry')!;
  const text=formatTelegramTradeMessage(entry,{tradeNumber:1,tradeDate:'2026-11-21'});
  assert.match(text,/ABHI SCALP LOGIC/);assert.match(text,/1st TP: 110.250/);assert.match(text,/2nd TP: 106.875/);
  const result=alerts.find(a=>a.kind==='tp')!;
  assert.match(formatTelegramTradeMessage(result,{tradeNumber:1,tradeDate:'2026-11-21'}),/SETUP CLOSED.*\+0.35R/);
});
