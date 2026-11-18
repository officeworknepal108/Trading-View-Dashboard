// Offline descriptive research only: reads archives and writes report artifacts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
const stem = 'overlapping-scalp-pullback-depth-2026-11-18';
const read = name => JSON.parse(fs.readFileSync(new URL(name, root), 'utf8'));
const archive = read('inside-mother-scalp-study-2026-11-18.json');
const seconds = iso => Date.parse(iso) / 1000;
const nepal = t => new Date((t + 20700) * 1000).toISOString().slice(0, 16).replace('T', ' ');
const byTime = new Map();
for (const name of ['five-month-m15-history-older.json', 'five-month-m15-history-latest.json', 'inside-mother-scalp-study-2026-11-18-M15.json']) {
  for (const c of read(name)) if (!byTime.has(c.time) || c.complete !== false) byTime.set(c.time, c);
}
const rows = [];
for (const setup of archive.rows) {
  const time = seconds(setup.signalUTC), confirmed = time + 900;
  const parents = archive.rows.filter(prior => seconds(prior.signalUTC) < time && prior.legs.some(leg =>
    leg.filledUTC && leg.resolvedUTC && seconds(leg.filledUTC) < confirmed && seconds(leg.resolvedUTC) > confirmed));
  if (!parents.length) continue;
  const row = { signalUTC: setup.signalUTC, signalNepal: nepal(time), direction: setup.direction,
    outcome: setup.outcome, parents: parents.map(p => p.signalUTC),
    sameDirectionParent: parents.some(p => p.direction === setup.direction) };
  if (!['tp', 'sl'].includes(setup.outcome)) { rows.push(row); continue; }
  const candle = byTime.get(time), next = byTime.get(confirmed);
  assert.ok(candle && next && candle.complete !== false);
  const body = Math.abs(candle.close - candle.open), buy = setup.direction === 'bullish';
  const depth = price => Math.max(0, (buy ? next.open - price : price - next.open) / body * 100);
  assert.ok(body > 0);
  const filled = setup.legs.filter(l => l.filledUTC && l.resolvedUTC);
  assert.ok(filled.length);
  const exits = [...new Set(filled.map(l => l.resolvedUTC))];
  assert.equal(exits.length, 1, 'All filled legs must have a shared exit candle');
  const exit = seconds(exits[0]), stop = filled[0].stopLoss, target = filled[0].takeProfit;
  for (const leg of setup.legs) {
    assert.ok(Math.abs(depth(leg.entry) - leg.leg) < 1e-6, 'Archived entry must match current 10/25 body geometry');
    assert.equal(leg.stopLoss, stop); assert.equal(leg.takeProfit, target);
  }
  function measure(expiry) {
    const end = Math.min(exit, expiry - 900);
    let lower = 0, upper = 0;
    for (let t = confirmed; t <= end; t += 900) {
      const bar = byTime.get(t);
      assert.ok(bar && bar.complete !== false && t + 900 <= seconds(archive.method.throughUTC), 'Need continuous complete candles');
      const adverse = buy ? bar.low : bar.high;
      if (t < exit) { lower = Math.max(lower, depth(adverse)); upper = Math.max(upper, depth(adverse)); }
      else {
        const atTarget = buy ? bar.open >= target : bar.open <= target;
        const atStop = buy ? bar.open <= stop : bar.open >= stop;
        if (atTarget || atStop) {
          assert.equal(setup.outcome, atStop ? 'sl' : 'tp', 'Gap opening must match established outcome');
          lower = Math.max(lower, depth(bar.open)); upper = Math.max(upper, depth(bar.open));
        } else if (setup.outcome === 'sl') {
          // Terminal wick beyond SL occurs after the trade has already stopped.
          lower = Math.max(lower, depth(stop)); upper = Math.max(upper, depth(stop));
        } else {
          // TP candle's adverse extreme may have happened after the TP touch.
          lower = Math.max(lower, depth(bar.open)); upper = Math.max(upper, Math.min(depth(adverse), depth(stop)));
        }
      }
    }
    for (const leg of filled) if (seconds(leg.filledUTC) < expiry) lower = Math.max(lower, depth(leg.entry));
    upper = Math.max(upper, lower);
    assert.ok(lower <= upper + 1e-7);
    return { minimumPercent: lower, maximumPercent: upper, exact: Math.abs(lower - upper) < 1e-7 };
  }
  Object.assign(row, { confirmationBody: body, nextOpen: next.open, stopLoss: stop, takeProfit: target,
    stopDepthPercent: depth(stop), exitUTC: exits[0],
    entryWindow: measure(confirmed + 4500), beforeExit: measure(Infinity) });
  rows.push(row);
}
const median = values => { const a = values.toSorted((a,b) => a-b), n = a.length; return n ? (a[Math.floor((n-1)/2)] + a[Math.floor(n/2)]) / 2 : null; };
function summarize(group, field) {
  const measured = group.filter(r => r[field]);
  return { setups: group.length, measured: measured.length,
    exact: measured.filter(r => r[field].exact).length,
    medianMinimumPercent: median(measured.map(r => r[field].minimumPercent)),
    medianMaximumPercent: median(measured.map(r => r[field].maximumPercent)),
    minimumPercent: measured.length ? Math.min(...measured.map(r => r[field].minimumPercent)) : null,
    maximumPercent: measured.length ? Math.max(...measured.map(r => r[field].maximumPercent)) : null,
    thresholds: [10,25,40,50,60,75,100,150,200].map(percent => ({ percent,
      definitelyReached: measured.filter(r => r[field].minimumPercent >= percent - 1e-7).length,
      possiblyReached: measured.filter(r => r[field].maximumPercent >= percent - 1e-7).length })) };
}
assert.equal(rows.length, 34);
assert.equal(rows.filter(r => r.outcome === 'tp').length, 23);
assert.equal(rows.filter(r => r.outcome === 'sl').length, 9);
assert.equal(rows.filter(r => r.outcome === 'not-filled').length, 2);
const summary = Object.fromEntries(['entryWindow', 'beforeExit'].map(field => [field,
  Object.fromEntries(['tp','sl'].map(outcome => [outcome, summarize(rows.filter(r => r.outcome === outcome), field)]))]));
const method = {
  period: archive.method, reference: '100% = absolute body of the later setup final engulfing confirmation candle. Pullback starts at next M15 open; SELL uses upward movement, BUY downward movement. Values can exceed 100%.',
  overlap: 'A separate earlier setup has at least one confirmed filled leg strictly before the later confirmation and a known exit candle strictly after it. Both intrabar boundary equality cases and unresolved earlier exits are excluded. This is temporal overlap, not containment inside the earlier trade price range. All qualifying later signals are counted, including third or subsequent signals.',
  entryWindow: 'Maximum adverse depth from next open over the first 75 minutes, stopping at existing setup exit if earlier.',
  beforeExit: 'Maximum adverse depth from next open through the existing common TP/SL. Does not imply an unfilled order remains eligible beyond 75 minutes.',
  bounds: 'All complete candles before the exit candle are observed. On a TP candle, opening price and established fills provide guaranteed depth; the adverse wick provides possible depth because OHLC cannot place it before/after TP. On SL candles, depth stops at SL (or gap open).',
  limitations: 'Offline chart simulations. Existing 10/25 entries and original exits define outcomes. Not a backtest of alternative entries; deeper entries would alter fills and risk/reward. No fees, spread, slippage or broker executions. Two unfilled setups remain in the overlap census but are not assigned trade-life depth. Earlier uncertain exits may hide additional overlaps.'
};
const result = { method, counts: { total: rows.length, sameDirection: rows.filter(r => r.sameDirectionParent).length, tp:23, sl:9, unfilled:2 }, summary, rows };
fs.writeFileSync(new URL(`${stem}.json`, root), JSON.stringify(result,null,2)+'\n');
const columns = ['signalNepal','direction','outcome','sameDirectionParent','confirmationBody','nextOpen','stopDepthPercent','entryWindowMin','entryWindowMax','beforeExitMin','beforeExitMax'];
const csvRows = rows.map(r => ({ ...r, entryWindowMin:r.entryWindow?.minimumPercent,entryWindowMax:r.entryWindow?.maximumPercent,
  beforeExitMin:r.beforeExit?.minimumPercent,beforeExitMax:r.beforeExit?.maximumPercent }));
fs.writeFileSync(new URL(`${stem}.csv`,root), [columns.join(','), ...csvRows.map(r => columns.map(k => r[k] ?? '').join(','))].join('\n')+'\n');
const f = n => n.toFixed(1);
const table = field => ['| Outcome | Setups measured | Median depth, bounded | Full depth range |','|---|---:|---:|---:|',
  ...['tp','sl'].map(o => {const s=summary[field][o];return `| ${o.toUpperCase()} | ${s.measured} | ${f(s.medianMinimumPercent)}–${f(s.medianMaximumPercent)}% | ${f(s.minimumPercent)}–${f(s.maximumPercent)}% |`;})].join('\n');
const thresholds = summary.entryWindow.tp.thresholds;
const md = `# Overlapping Scalp 1:1 pullback-depth study\n\n34 later setups: 23 TP, 9 SL, 2 unfilled. ${result.counts.sameDirection} have a same-direction earlier open setup. Uses the saved 3 August–18 November 2026 sample, through 07:45 Nepal.\n\n${method.reference}\n\n## First 75 minutes, or existing exit if earlier\n\n${table('entryWindow')}\n\n## Full lifetime before existing exit\n\n${table('beforeExit')}\n\n## TP setups reaching each depth within entry window\n\n| Depth | Definitely reached | Possibly reached, including definite |\n|---|---:|---:|\n${thresholds.map(t=>`| ${t.percent}% | ${t.definitelyReached}/23 | ${t.possiblyReached}/23 |`).join('\n')}\n\n## Method and limits\n\n${Object.entries(method).filter(([k])=>k!=='period').map(([k,v])=>`- **${k}:** ${v}`).join('\n')}\n\nThe two existing pullback legs count as one setup. No trading code or settings changed. Detailed setup rows are in [CSV](${stem}.csv) and [JSON](${stem}.json).\n\nValidation: reproduces the 34-setup overlap census and 23/9/2 outcomes; validates archived 10/25 entry geometry, common exits, continuous completed M15 coverage, and depth bounds for every measured setup.\n`;
fs.writeFileSync(new URL(`${stem}.md`,root),md);
console.log(JSON.stringify({counts:result.counts,summary,report:fileURLToPath(new URL(`${stem}.md`,root))},null,2));
