"""Independent single-order sizing audit and report for stop/timing research."""
import csv
import hashlib
import html
import json
import math
import random
from pathlib import Path

root=Path(__file__).resolve().parent
stem='scalp-latest-research-2026-11-21'
delayed=json.loads((root/'scalp-delayed-research-2026-11-21.json').read_text())
stops=json.loads((root/'scalp-stop-research-2026-11-21.json').read_text())
base=next(r for r in delayed['selected'] if 'baseline' in r['roles'])
candidate=next(r for r in delayed['selected'] if 'highest-ideal-hindsight' in r['roles'])
best_stop=next(r for r in stops['selected'] if 'highest-ideal-hindsight' in r['roles'])
p=candidate['policy']
assert p['delay']==15 and p['second']==0 and p['originalTarget'] and p['filter'] and p['gate']=='any'
known=lambda r:r['outcome'] in ['tp','sl','mixed']
money=lambda n:f'{n:+,.2f}'
esc=lambda v:html.escape(str(v))

def summarize(rows,price=None):
    cash={};ledger=[];closed=wins=losses=0;net=fees=0
    for r in rows:
        if not known(r):continue
        assert len(r['legs'])==2
        a,b=r['legs']
        for key in ['entry','stop','target','risk','rr']:assert abs(a[key]-b[key])<1e-7
        assert a['outcome']==b['outcome'] and a['outcome'] in ['tp','sl']
        assert a['closedAt']==b['closedAt']
        lot=50/(a['risk']*100) if price is None else math.floor((50/(a['risk']*100)+1e-12)/.01)*.01
        assert lot>=.01-1e-10 if price is not None else lot>0
        risk=lot*100*a['risk'];assert risk<=50+1e-7
        gross=risk*(a['rr'] if a['outcome']=='tp' else -1)
        fee=0 if price is None else lot*(price*100+7)
        pnl=gross-fee
        if price is None:assert abs(pnl-r['netR']*50)<1e-6
        net+=pnl;fees+=fee;closed+=1;wins+=pnl>0;losses+=pnl<0
        cash[a['closedAt']]=cash.get(a['closedAt'],0)+pnl
        ledger.append({'signalUTC':r['signalUTC'],'direction':r['direction'],'entry':a['entry'],'stop':a['stop'],'target':a['target'],'referenceRR':a['rr'],'lot':lot,'allocatedRisk':risk,'outcome':a['outcome'],'netDollars':pnl,'fees':fee,'exitTime':a['closedAt']})
    equity=peak=dd=0
    for t,pnl in sorted(cash.items()):equity+=pnl;peak=max(peak,equity);dd=max(dd,peak-equity)
    assert abs(equity-net)<1e-6
    return {'setups':len(rows),'closed':closed,'wins':wins,'losses':losses,'winPercent':wins/closed*100 if closed else 0,'netDollars':net,'returnPercent':net/50,'drawdown':dd,'drawdownPercent':dd/50,'endingBalance':5000+net,'fees':fees,'uncertain':sum(r['outcome']=='uncertain' for r in rows),'invalidOrCancelled':sum(r['outcome']=='no-valid-entry' for r in rows)},ledger

single,ideal_ledger=summarize(candidate['rows'])
single_cost,cost_ledger=summarize(candidate['rows'],.2)
single_stress,_=summarize(candidate['rows'],.5)
assert abs(single['netDollars']-candidate['overall']['netDollars'])<1e-6
monthly={}
for month in candidate['monthly']:
    rows=[r for r in candidate['rows'] if r['signalUTC'].startswith(month)]
    gross,_=summarize(rows);cost,_=summarize(rows,.2);stress,_=summarize(rows,.5)
    monthly[month]={'gross':gross,'cost':cost,'stress':stress}
assert abs(sum(s['gross']['netDollars'] for s in monthly.values())-single['netDollars'])<1e-6
assert abs(sum(s['cost']['netDollars'] for s in monthly.values())-single_cost['netDollars'])<1e-6

# Compare all mutually known decisions, including cancelled/unfilled candidate setups as no trade.
cmap={r['signalUTC']:r for r in candidate['rows']}
daily={};paired=[]
for b in base['rows']:
    c=cmap.get(b['signalUTC'])
    if b['outcome'] in ['uncertain','open','pending']:continue
    if c and c['outcome'] in ['uncertain','open','pending']:continue
    bp=b['netR']*50 if known(b) else 0
    cp=c['netR']*50 if c and known(c) else 0
    day=b['signalUTC'][:10];daily[day]=daily.get(day,0)+cp-bp
    paired.append({'signalUTC':b['signalUTC'],'candidate':cp,'baseline':bp,'difference':cp-bp})
values=list(daily.values());rng=random.Random(20261121)
samples=sorted(sum(rng.choices(values,k=len(values))) for _ in range(5000))
best_three=sorted(paired,key=lambda r:r['difference'],reverse=True)[:3]
paired_total=sum(r['difference'] for r in paired)
concentration={'matchedSetups':len(paired),'matchedDifference':paired_total,'differenceWithoutThreeLargestImprovements':paired_total-sum(r['difference'] for r in best_three),'threeLargest':best_three,'descriptive95PairedDayInterval':[samples[125],samples[4874]],'limitations':'Descriptive matched-known-outcome calculation only. Does not correct for exclusions, prior reuse, serial dependence between days, or selection from 240 timing and 672 stop variants.'}
hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['scalp-delayed-research-2026-11-21.ts','scalp-stop-research-2026-11-21.ts','scalp-validation-model-2026-11-20.ts']}
output={'candidatePolicy':p,'singleOrderGross':single,'singleOrderCost':single_cost,'singleOrderStress':single_stress,'monthly':monthly,'concentration':concentration,'sourceHashes':hashes,'baseline':base['overall'],'bestStop':{'policy':best_stop['policy'],'overall':best_stop['overall']},'timingWalkForward':delayed['walkForward'],'stopWalkForward':stops['walkForward']}
(root/(stem+'.json')).write_text(json.dumps(output,indent=2)+'\n')
with (root/(stem+'-single-order-trades.csv')).open('w',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=list(cost_ledger[0]));writer.writeheader();writer.writerows(cost_ledger)
with (root/(stem+'-monthly.csv')).open('w',newline='') as f:
    writer=csv.writer(f);writer.writerow(['month','closed','wins','losses','winPercent','grossDollars','grossReturnPercent','costDollars','stressDollars'])
    for month,s in monthly.items():g=s['gross'];writer.writerow([month,g['closed'],g['wins'],g['losses'],g['winPercent'],g['netDollars'],g['returnPercent'],s['cost']['netDollars'],s['stress']['netDollars']])

def table(headers,rows):
    return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+esc(x)+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table></div>'

body='<h1>Latest scalp research: stops and delayed entries</h1>'
body+='<p><strong>Research finding:</strong> Waiting one M15 candle and using a single market entry at the next open produced a higher gross historical profit and win rate, with positive gross results in all four studied months. It also increased drawdown. This is an exploratory candidate, not an established live improvement.</p>'
body+='<p class="note">672 stop-policy combinations and 240 timing-policy combinations were examined in this round, after earlier searches on the same prices. Winners were selected with hindsight. All prices have been reused; no independent unseen evaluation. Fixed $50 risk per setup on an illustrative $5,000 balance, no compounding. Market execution, costs, margin and position limits need separate verification. Live trading settings and strategy source were not changed.</p>'
body+='<h2>Exact delayed-entry rule</h2><ol><li>Retain the original M15 setup qualification. Require the final confirmation body to be at least 30% of its high-to-low range.</li><li>Wait for the next complete M15 candle. At the opening of the following candle (15 minutes after original confirmation), inspect whether the original SL or the original-reference 1.25R target was touched during the wait. Cancel if either was touched or the history has a gap.</li><li>Enter once at that new candle open, any candle colour. Keep the original pattern SL and original-reference 1.25R target unchanged. The target is not recalculated to 1.25R from the later entry; actual reward/risk varies.</li><li>Risk at most $50 total using lot size calculated from the new entry-to-original-stop distance. Skip invalid geometry, risk over the inherited 300-pip entry cap, or below-minimum lot sizing. No second pullback, BE, trailing or early close.</li></ol>'
body+='<p>The search used two orders at identical prices and exits. Their ideal outcomes are mathematically equivalent to one order with total $50 risk. This report independently calculates one-order lot rounding and costs; those values differ from flooring two orders separately. No claim is made that a future live market order fills at candle-open mid price.</p>'
rows=[]
for month,s in monthly.items():
    g=s['gross'];rows.append([month,g['closed'],g['wins'],g['losses'],f"{g['winPercent']:.2f}%",money(g['netDollars']),f"{g['returnPercent']:.2f}%",money(s['cost']['netDollars']),money(s['stress']['netDollars'])])
rows.append(['Overall',single['closed'],single['wins'],single['losses'],f"{single['winPercent']:.2f}%",money(single['netDollars']),f"{single['returnPercent']:.2f}%",money(single_cost['netDollars']),money(single_stress['netDollars'])])
body+='<h2>Monthly delayed-entry results</h2>'+table(['Signal month UTC','Closed setups','Wins','Losses','Win rate','Gross $','Gross return','Cost scenario $','Stress scenario $'],rows)
body+='<p>Cost scenario: .20 total round-trip gold price units plus $7 per lot. Stress: .50 units plus $7 per lot. Contract100oz; minimum and step .01 lot, rounded down. These are sensitivity assumptions, not observed current broker costs. Rounded lots often risk less than $50, so these columns change position sizing as well as subtract fees; a month can improve after rounding if losses shrink more than gains. Costs and profits cover fully resolved setups only; unknown outcomes are excluded, not assumed to be zero.</p>'
body+='<h2>Comparison</h2>'
body+=table(['Metric','Original candidate','Delayed single entry'],[
    ['Gross net profit $',money(base['overall']['netDollars']),money(single['netDollars'])],
    ['Return on initial $5,000',f"{base['overall']['returnPercent']:.2f}%",f"{single['returnPercent']:.2f}%"],
    ['Resolved win rate',f"{base['overall']['winPercent']:.2f}%",f"{single['winPercent']:.2f}%"],
    ['Resolved drawdown $',f"{base['overall']['drawdown']:.2f}",f"{single['drawdown']:.2f}"],
    ['Uncertain setups',base['overall']['uncertain'],single['uncertain']],
    ['Cost scenario P&L $',money(base['costOverall']['netDollars']),money(single_cost['netDollars'])],
    ['Cost scenario drawdown $',f"{base['costOverall']['drawdown']:.2f}",f"{single_cost['drawdown']:.2f}"]])
body+='<p>Drawdown is known resolved cash flow grouped at exit-bar time. It excludes floating losses and unknown results; it is not an actual account worst-case loss. Different rules have different unknown/cancelled cases, so headline differences are not all paired trade improvements.</p>'
body+='<h2>Concentration and chronological checks</h2>'
body+=f'<p>On {concentration["matchedSetups"]} mutually known decisions, the gross difference is ${paired_total:.2f}. Removing the three largest paired improvements changes this to ${concentration["differenceWithoutThreeLargestImprovements"]:.2f}. A descriptive paired-day interval is ${samples[125]:.2f} to ${samples[4874]:.2f}. These checks do not account for repeated selection or reused history.</p>'
body+=table(['Largest paired improvement','Baseline $','Candidate $','Difference $'],[[r['signalUTC'],money(r['baseline']),money(r['candidate']),money(r['difference'])] for r in best_three])
for label,source in [('Timing',delayed),('Stop',stops)]:
    w=source['walkForward']['ideal'];a=w['october']['netDollars']+w['november']['netDollars'];b=w['baselineOctober']['netDollars']+w['baselineNovember']['netDollars']
    body+=f'<p>{label} selection used earlier months only at each retrospective boundary, ranking net minus half drawdown with minimum sample rules. The selected rules earned ${a:.2f} in October plus the historical November portion, versus ${b:.2f} baseline. Thus the broader selection process still failed to beat baseline later. The full-period delayed winner is not independently validated.</p>'
body+='<h2>Stop study result</h2>'
s=best_stop['overall'];body+=f'<p>The highest stop-study profit used 75% of original reference-to-SL distance, target 2R from revised reference risk, 0%/10% entries, 30%/70% allocation and body ≥30%. Gross profit ${s["netDollars"]:.2f}, win rate {s["winPercent"]:.2f}%, resolved drawdown ${s["drawdown"]:.2f}. The higher profit came with lower accuracy and substantially higher drawdown, so it is not the primary candidate.</p>'
body+='<h2>Verification and limits</h2><p>The existing exhaustive OHLC event-order engine preserves unknown paths and gaps. Historical replay uses M15; the former Nov18–20 sample uses M1. Both studies reproduce the original 119 wins, 87 losses and $3,186.20 gross result. Assertions check closed-candle timing, unchanged original targets in delayed fixed-target mode, <=$50 allocated risk, monthly and exit-cash reconciliation, and equivalence of identical-price orders with one ideal order. Independent single-order calculations passed.</p>'
body+='<p>Qualification remains based on the previously archived setup universe. The new rules deliberately change execution timing or stops. No live executable bid/ask or slippage replay, broker tick rounding, margin model, aggregate-open-risk limit or daily-loss limit is included. All-positive gross months do not guarantee future positive months.</p>'
body+='<p><a href="https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf">Bailey et al., The Probability of Backtest Overfitting</a> explains why repeated optimization on finite price history can generate false positives.</p>'
body+=f'<p><a href="{stem}-monthly.csv">Monthly CSV</a> · <a href="{stem}-single-order-trades.csv">Cost-scenario single-order trade ledger</a> · <a href="{stem}.json">Audit and summary JSON</a> · <a href="scalp-stop-research-2026-11-21.csv">All stop-policy summaries</a> · <a href="scalp-delayed-research-2026-11-21.json">All timing-policy results</a></p>'
css='body{font:16px/1.55 system-ui;max-width:1450px;margin:32px auto;padding:0 20px;color:#17283b;background:#f8fafc}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;border-bottom:1px solid #dbe3ed;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#e9f0f8}.scroll{overflow:auto}.note{padding:18px;background:#fff1d8}h2{margin-top:30px}'
(root/(stem+'.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Latest scalp research</title><style>'+css+'</style><body>'+body+'</body></html>',encoding='utf-8')
print(json.dumps({'report':stem+'.html','gross':single,'cost':single_cost,'stress':single_stress,'monthly':monthly,'concentration':concentration},indent=2))
