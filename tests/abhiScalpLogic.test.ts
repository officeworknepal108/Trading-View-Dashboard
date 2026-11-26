import { buildChartPullbackSetups } from '../src/services/chartEntryData';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scalpOneToOnePullbackSignals as pullbackSignals, scalpOneToOneChartHistory as chartHistory } from '../src/services/scalpOneToOne';
import { withScalpFibHistory } from './helpers/scalpFibHistory';
import { scalpPullbackSignalError, selectSecondOnlyPullback, type Mt5StoredSignal } from '../src/services/mt5Automation';
import { buildPullbackChartSetups, chartSignalFromHistoryFill } from '../src/services/pullbackChartSetup';
import { groupPullbackTableSignals } from '../src/services/pullbackEntryDisplay';
import { pullbackTelegramAlerts } from '../src/services/pullbackTelegram';
import { formatTelegramTradeMessage, telegramAlertEventKey, validAbhiLegResult } from '../src/services/telegramMessages';
import { pullbackExpirySeconds } from '../src/services/pullbackExpiry';
import type { VolumeStudyRecord } from '../src/services/volumeEngulfingStudy';

const scalpOneToOnePullbackSignals: typeof pullbackSignals = (record, candles, ...args) => pullbackSignals(record, withScalpFibHistory(candles), ...args);
const scalpOneToOneChartHistory: typeof chartHistory = (record, candles, ...args) => chartHistory(record, withScalpFibHistory(candles), ...args);

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
  assert.match(text,/ABHI SCALP LOGIC/);assert.match(text,/TP: 110.250/);assert.match(text,/TP: 106.875/);
  const result=alerts.find(a=>a.kind==='tp')!;
  assert.match(formatTelegramTradeMessage(result,{tradeNumber:1,tradeDate:'2026-11-21'}),/SETUP CLOSED[\s\S]*\+0.35R/);
});


test('Abhi v4 chart marker and both entry outcomes match across roles despite broker fills', () => {
  const chartSignals = signals().map(s => ({ ...s, status: 'SIMULATED' as const, preview: true, createdAt: 1800, updatedAt: 1800 }));
  const brokerSignals = stored().map((s, i) => ({ ...s, id: `MT5:${i}`, brokerTicket: i + 1,
    status: 'SL' as const, openedAt: 1800, closedAt: 2700 }));
  for (const asOf of [2700, 3600, 4500]) {
    const client = buildChartPullbackSetups({ signals: chartSignals, candles: { M15: [confirmation, ...bars] }, asOf });
    const admin = buildChartPullbackSetups({ signals: [...chartSignals, ...brokerSignals],
      candles: { M15: [confirmation, ...bars] }, asOf, context: { account: 'test', server: 'demo', brokerSymbol: 'GOLD' } });
    assert.equal(client.length, 1); assert.equal(client[0].abhi, true);
    assert.deepEqual(admin, client);
    assert.deepEqual(client[0].legs.map(leg => leg.entry), [99, 97.5]);
    assert.deepEqual(client[0].legs.map(leg => leg.takeProfit), [110.25, 106.875]);
  }
});


test('Abhi entry blocks keep each SL, bracketed pips, target and risk share together', () => {
  const history = scalpOneToOneChartHistory(record, { M15: [confirmation, ...bars] }, 2700);
  const setup = buildPullbackChartSetups({ signals: history.fills.map(chartSignalFromHistoryFill).filter(s => !!s),
    asOf: 2700, candles: { M15: [confirmation, ...bars] } })[0];
  const initial = pullbackTelegramAlerts(setup, 2700).find(a => a.kind === 'entry')!;
  const text = formatTelegramTradeMessage(initial, { tradeNumber: 8, tradeDate: '2026-11-21' });
  const [firstBlock, secondBlock] = text.slice(text.indexOf('1st Entry:')).split('\n\n');
  assert.match(firstBlock, /1st Entry: 99.000/); assert.match(firstBlock, /SL: 90.000 \(90.00 pips\)/);
  assert.match(firstBlock, /TP: 110.250/); assert.match(firstBlock, /Risk: 40%/);
  assert.match(secondBlock, /2nd Entry: 97.500/); assert.match(secondBlock, /SL: 90.000 \(75.00 pips\)/);
  assert.match(secondBlock, /TP: 106.875/); assert.match(secondBlock, /Risk: 60%/);
});

test('Abhi sends the closed leg result while its sibling remains open and keeps distinct event identities', () => {
  const candles = { M15: [confirmation, ...bars] };
  const history = scalpOneToOneChartHistory(record, candles, 3600);
  const setup = buildPullbackChartSetups({ signals: history.fills.map(chartSignalFromHistoryFill).filter(s => !!s), asOf: 3600, candles })[0];
  const partial = pullbackTelegramAlerts(setup, 3600).filter(a => a.kind === 'leg-result');
  assert.equal(partial.length, 1); assert.equal(partial[0].legResult!.leg, 25);
  assert.equal(validAbhiLegResult(partial[0]), true);
  const text = formatTelegramTradeMessage(partial[0], { tradeNumber: 8, tradeDate: '2026-11-21' });
  assert.match(text, /2nd Entry:.*TP HIT/); assert.match(text, /Result: \+1.25R/);
  assert.match(text, /Setup contribution: \+0.75R/); assert.match(text, /1st Entry:.*Still open/);
  assert.doesNotMatch(text, /Entry: [0-9]|TP: [0-9]|SL: [0-9]/);
  const firstResult = { ...partial[0], legResult: { leg: 10 as const, outcome: 'tp' as const },
    pullback: { ...partial[0].pullback!, firstStatus: 'tp' as const, secondStatus: 'open' as const } };
  assert.notEqual(telegramAlertEventKey(firstResult), telegramAlertEventKey(partial[0]));
  const firstText = formatTelegramTradeMessage(firstResult, { tradeNumber: 8, tradeDate: '2026-11-21' });
  assert.match(firstText, /1st Entry:.*TP HIT/); assert.match(firstText, /Setup contribution: \+0.50R/);
  assert.match(firstText, /2nd Entry:.*Still open/);
  assert.equal(validAbhiLegResult({ ...firstResult, returnR: 2 }), false);
  const fallback = { ...partial[0], pullback: { ...partial[0].pullback!, secondOnly: true, firstStatus: 'skipped' as const } };
  assert.match(formatTelegramTradeMessage(fallback, { tradeNumber: 8, tradeDate: '2026-11-21' }), /Setup contribution: \+1.25R/);
});


test('an unfilled Abhi sibling stays waiting until expiry, while the first result sends immediately', () => {
  const candles = { M15: [confirmation, ...bars] };
  const history = scalpOneToOneChartHistory(record, candles, 3600);
  const setup = buildPullbackChartSetups({ signals: history.fills.map(chartSignalFromHistoryFill).filter(s => !!s), asOf: 3600, candles })[0];
  const firstOnly = { ...setup, netReturnR: .5, legs: setup.legs.map(leg => leg.leg === 10
    ? { ...leg, filled: true, chartConfirmed: true, chartOutcome: 'tp' as const, chartResolvedAt: 2700 }
    : { ...leg, filled: false, chartConfirmed: false, chartOutcome: undefined, chartResolvedAt: undefined, uncertain: false }) };
  const partial = pullbackTelegramAlerts(firstOnly, 3600);
  assert.equal(partial.filter(a => a.kind === 'leg-result').length, 1);
  assert.ok(!partial.some(a => a.kind === 'tp' || a.kind === 'sl'));
  assert.equal(partial.find(a => a.kind === 'leg-result')!.pullback!.secondStatus, 'waiting');
  const closed = pullbackTelegramAlerts(firstOnly, 5400).find(a => a.kind === 'tp')!;
  assert.ok(closed); assert.equal(closed.pullback!.secondStatus, 'expired');
  assert.equal(closed.returnR, .5);
});
