// Offline research only. No broker, server, settings or trading-source writes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scalpPullbackBarStates } from '../src/services/scalpOneToOne';

const root = new URL('./', import.meta.url);
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, root), 'utf8'));
const archive = read('inside-mother-scalp-study-2026-11-18.json');
const cutoff = Date.parse(archive.method.throughUTC) / 1000;
const byTime = new Map<number, any>();
for (const name of ['five-month-m15-history-older.json', 'five-month-m15-history-latest.json', 'inside-mother-scalp-study-2026-11-18-M15.json']) {
  for (const c of read(name)) if (!byTime.has(c.time) || c.complete !== false) byTime.set(c.time, c);
}
const bars = [...byTime.values()].filter(c => c.complete !== false && c.time + 900 <= cutoff).sort((a,b) => a.time-b.time);
const indices = new Map(bars.map((b,i) => [b.time,i]));

function replay(row: any, corrected: boolean) {
  const time = Date.parse(row.signalUTC)/1000, confirmed = time+900;
  const candle = byTime.get(time), next = byTime.get(confirmed);
  assert.ok(candle, 'Confirmation candle required');
  if (!next) {
    assert.equal(row.legs.length,0, 'No next-open data cannot support archived entries');
    return {signalUTC:row.signalUTC,direction:row.direction,reference:null,outcome:'no-valid-entry',legs:[]};
  }
  const sign = row.direction === 'bullish' ? 1 : -1;
  const stop = row.legs[0]?.stopLoss ?? (sign === 1 ? row.patternLow-3 : row.patternHigh+3);
  const openRisk = sign*(next.open-stop);
  const reference = openRisk>0 && openRisk<=20 ? next.open : stop+sign*20;
  const target = reference+sign*Math.abs(reference-stop);
  for (const leg of row.legs) {
    assert.ok(Math.abs(leg.stopLoss-stop)<1e-7 && Math.abs(leg.takeProfit-target)<1e-7, 'Reconstruct original fixed exits');
  }
  const body = Math.abs(candle.close-candle.open);
  const signals = [10,25].flatMap(leg => {
    const entry = (corrected ? reference : next.open)-sign*body*leg/100;
    const risk = sign*(entry-stop), reward = sign*(target-entry);
    if (!(risk>0 && risk<=30.000001 && reward>0)) return [];
    if (corrected) assert.ok(reward/risk>=1-1e-8, 'Corrected entries cannot degrade original 1:1');
    return [{direction: sign===1?'BUY':'SELL',entry,stopLoss:stop,takeProfit:target,
      leg,riskShare:leg===10?.6:.4,rr:reward/risk,expiresAt:confirmed+4500}];
  });
  if (!signals.length) return {signalUTC:row.signalUTC,direction:row.direction,reference,outcome:'no-valid-entry',legs:[]};
  if (!corrected) {
    assert.equal(signals.length,row.legs.length);
    signals.forEach(s => assert.ok(Math.abs(s.entry-row.legs.find((l:any)=>l.leg===s.leg).entry)<1e-7));
  }
  let states = [{mask:0,exit:0}], expected=confirmed;
  for (let i=indices.get(confirmed)!;i<bars.length;i++) {
    const bar=bars[i];
    if (bar.time!==expected) { states=states.map(s=>s.exit?s:{...s,exit:2}); break; }
    expected+=900;
    const paths=states.flatMap(s=>s.exit?[s]:scalpPullbackBarStates(bar,signals as any,s.mask,bar.time<confirmed+4500));
    states=[...new Map(paths.map(s=>[`${s.mask}:${s.exit}`,s])).values()];
    if (states.every(s=>s.exit || !s.mask && bar.time+900>=confirmed+4500)) break;
  }
  const legs=signals.map((s,i)=>{
    const options=[...new Set(states.map(p=>p.exit===2?'uncertain':!(p.mask&(1<<i))?'not-filled':p.exit===1?'tp':p.exit===-1?'sl':p.exit===0?'open':'uncertain'))];
    const outcome=options.length===1?options[0]:'uncertain';
    const setupR=outcome==='tp'?s.riskShare*s.rr:outcome==='sl'?-s.riskShare:0;
    const fillState=states.every(p=>(p.mask&(1<<i))!==0)?'filled':states.every(p=>!(p.mask&(1<<i))&&p.exit!==2&&(p.exit!==0||cutoff>=s.expiresAt))?'not-filled':'uncertain';
    return {...s,outcome,fillState,possibleOutcomes:options,setupR};
  });
  const closed=legs.filter(l=>l.outcome==='tp'||l.outcome==='sl');
  const outcome=legs.some(l=>l.outcome==='uncertain')?'uncertain':legs.some(l=>l.outcome==='open')?'open':
    new Set(closed.map(l=>l.outcome)).size>1?'mixed':closed[0]?.outcome??'not-filled';
  return {signalUTC:row.signalUTC,direction:row.direction,reference,outcome,legs};
}
function summary(rows: ReturnType<typeof replay>[]) {
  const count=(v:string)=>rows.filter(r=>r.outcome===v).length;
  const tp=count('tp'),sl=count('sl'),closed=tp+sl;
  const legs=rows.flatMap(r=>r.legs);
  // Whole uncertain/open setups are excluded from resolved-setup dollar totals.
  const resolved=rows.filter(r=>r.outcome==='tp'||r.outcome==='sl'||r.outcome==='mixed');
  const grossProfitR=resolved.flatMap(r=>r.legs).filter(l=>l.outcome==='tp').reduce((a,l)=>a+l.setupR,0);
  const grossLossR=-resolved.flatMap(r=>r.legs).filter(l=>l.outcome==='sl').reduce((a,l)=>a+l.setupR,0);
  return {setups:rows.length,tp,sl,tpPercent:tp/closed*100,slPercent:sl/closed*100,
    uncertain:count('uncertain'),open:count('open'),mixed:count('mixed'),notFilled:count('not-filled'),noValidEntry:count('no-valid-entry'),
    legOutcomes:Object.fromEntries(['tp','sl','uncertain','open','not-filled'].map(o=>[o,legs.filter(l=>l.outcome===o).length])),
    grossProfitR,grossLossR,netR:grossProfitR-grossLossR,
    cashExamples:[4,100].map(risk=>({fixedSetupRiskDollars:risk,grossProfit:grossProfitR*risk,grossLoss:grossLossR*risk,net:(grossProfitR-grossLossR)*risk}))};
}
const originalRows=archive.rows.map((r:any)=>replay(r,false));
const correctedRows=archive.rows.map((r:any)=>replay(r,true));
const original=summary(originalRows),corrected=summary(correctedRows);
for (let i=0;i<originalRows.length;i++) assert.equal(originalRows[i].outcome,archive.rows[i].outcome,archive.rows[i].signalUTC);
// Reproduce the independent archived study before accepting the comparison.
for (const key of ['setups','tp','sl','uncertain','notFilled','noValidEntry'] as const) assert.equal(original[key],archive.all[key],key);
const method={period:archive.method,correction:'10% and 25% of confirmation body measured from original reference; BUY subtracts, SELL adds. Original SL/TP fixed.',
  execution:'Existing exhaustive OHLC-path helper, 75-minute entry window, gaps and same-candle ordering remain uncertain. Each leg retains its 60/40 share of a fixed setup risk allowance.',
  dollars:'Illustrative fixed-dollar risk, no compounding. Unfilled shares are unused. Whole uncertain/open setups excluded. No minimum-lot fallback, lot rounding, margin, spread, fees, slippage, half-risk overlap adjustment, daily-loss or concurrent-position controls. Not account-executable P&L.',
  scope:'Offline comparison on the same archived qualified setups; no source strategy, broker settings, or open positions changed.'};
const output={method,original,corrected,originalRows,correctedRows};
const stem='scalp-reference-entry-comparison-2026-11-20';
fs.writeFileSync(new URL(`${stem}.json`,root),JSON.stringify(output,null,2)+'\n');
const csv=['variant,signalUTC,direction,reference,leg,entry,stopLoss,takeProfit,rr,outcome,setupR',
  ...[['original',originalRows],['corrected',correctedRows]].flatMap(([variant,rows]:any)=>(rows as any[]).flatMap(r=>r.legs.map((l:any)=>[variant,r.signalUTC,r.direction,r.reference,l.leg,l.entry,l.stopLoss,l.takeProfit,l.rr,l.outcome,l.setupR].join(','))))];
fs.writeFileSync(new URL(`${stem}.csv`,root),csv.join('\n')+'\n');
console.log(JSON.stringify({method,original,corrected},null,2));
