"""Fixed 40/60 versus 50/50 allocation on the same Abhi Scalp Logic paths."""
import csv
import hashlib
import html
import json
import math
from collections import Counter
from pathlib import Path

root=Path(__file__).resolve().parent;stem='abhi-scalp-risk-split-comparison-2026-11-21'
source=root/'scalp-confirmation-close-comparison-2026-11-21.json'
study=json.loads(source.read_text());baseline=next(r for r in study['results'] if r['id']=='full-proposal')
rows=baseline['rows'];resolved=lambda r:r['outcome'] in ['tp','sl','mixed']

def evaluate(rows,first_share,budget=100,price=None):
    cash={};net=fees=0;closed=wins=losses=no_size=0;ledger=[]
    for r in rows:
        shares={0:first_share,1:1-first_share}
        sizes={l['slot']:math.floor((budget*shares[l['slot']]/(l['risk']*100)+1e-12)/.01)*.01 for l in r['legs']}
        if price is not None and (len(r['legs'])!=2 or any(lot<.01-1e-10 for lot in sizes.values())):
            no_size+=1;continue
        if not resolved(r):continue
        pnl=allocated=0
        for l in r['legs']:
            assert abs(l['rr']-1.25)<1e-7
            share=shares[l['slot']]
            lot=budget*share/(l['risk']*100) if price is None else sizes[l['slot']]
            risk=lot*100*l['risk'];allocated+=risk
            if l['outcome'] not in ['tp','sl']:continue
            fee=0 if price is None else lot*(price*100+7)
            value=risk*(l['rr'] if l['outcome']=='tp' else -1)-fee
            cash[l['closedAt']]=cash.get(l['closedAt'],0)+value;pnl+=value;fees+=fee
        assert allocated<=budget+1e-7
        net+=pnl;closed+=1;wins+=pnl>1e-8;losses+=pnl< -1e-8
        ledger.append({'signalUTC':r['signalUTC'],'direction':r['direction'],'netDollars':pnl})
    equity=peak=dd=0
    for t,value in sorted(cash.items()):equity+=value;peak=max(peak,equity);dd=max(dd,peak-equity)
    assert abs(equity-net)<1e-6
    return {'setups':len(rows),'closed':closed,'wins':wins,'losses':losses,'winPercent':wins/closed*100 if closed else 0,'netDollars':net,'returnPercent':net/5000*100,'drawdown':dd,'fees':fees,'noSizeOrInvalid':no_size},ledger

results=[]
for share in [.4,.5]:
    gross,_=evaluate(rows,share)
    cost,_=evaluate(rows,share,100,.2)
    stress,_=evaluate(rows,share,100,.5)
    monthly={month:evaluate([r for r in rows if r['signalUTC'].startswith(month)],share)[0] for month in ['2026-08','2026-09','2026-10','2026-11']}
    assert abs(sum(s['netDollars'] for s in monthly.values())-gross['netDollars'])<1e-6
    results.append({'firstShare':share,'secondShare':1-share,'grossAt100':gross,'grossAt50':evaluate(rows,share,50)[0],'costAt100':cost,'stressAt100':stress,'monthlyAt100':monthly})
assert abs(results[1]['grossAt100']['netDollars']-baseline['risk100']['netDollars'])<1e-6
assert abs(results[1]['grossAt100']['netDollars']-results[0]['grossAt100']['netDollars']-62.5)<1e-6
outcomes=Counter(tuple(l['outcome'] for l in sorted(r['legs'],key=lambda l:l['slot'])) for r in rows if resolved(r))
assert sum(outcomes.values())==192
output={'method':{'strategy':'Abhi Scalp Logic','period':'Aug3-Nov20 2026','balance':5000,'baselineBudget':100,'scope':'Same confirmation-close10%/25% pullbacks, original SL, each-entry exact1.25R TP,60min expiry,body>=30%,same T1/T2/T3 qualification. Only cash-risk allocation changes. No live code changes. No rerun of price paths is needed because allocation has no effect on fills/SL/TP/timing in this model; per-leg outcomes are reweighted.','limitations':'Reused historical simulations, not future forecasts. Gross assumes ideal fractional lots before costs and excludes uncertain/open setups. Drawdown resolved cash only, no floating risk. No daily/open-risk/margin constraints.','costs':'Optional sensitivity only:100oz contract,.01 min/step,floor lots,.20/.50 total gold price units plus$7/lot round trip. Both orders required: skip whole setup if split cannot fit. No second-only fallback. Costs not observed current broker charges. No tick/quote/slippage validation.'},'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'resolvedOutcomeCounts':{' / '.join(k):v for k,v in outcomes.items()},'results':results}
(root/(stem+'.json')).write_text(json.dumps(output,indent=2)+'\n')
with (root/(stem+'-monthly.csv')).open('w',newline='') as f:
    w=csv.writer(f);w.writerow(['splitFirstSecond','month','closed','wins','losses','grossAt100','returnOn5000'])
    for r in results:
        for month,s in r['monthlyAt100'].items():w.writerow([f"{r['firstShare']:.0%}/{r['secondShare']:.0%}",month,s['closed'],s['wins'],s['losses'],s['netDollars'],s['returnPercent']])
esc=lambda x:html.escape(str(x));money=lambda x:f'{x:+,.2f}'
def table(headers,rs):return '<table><thead><tr>'+''.join('<th>'+esc(x)+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in r)+'</tr>' for r in rs)+'</tbody></table>'
body='<h1>Abhi Scalp Logic:40/60 versus50/50</h1><p><strong>Finding:</strong>50% first/50% second earned $62.50 more gross profit than40% first/60% second at fixed$100 setup risk in the archived Aug3–Nov20 sample. Entry geometry, targets, qualification and expiration are identical.</p>'
body+=table(['Metric','40% first /60% second','50% /50%'],[[label,*[fmt(r['grossAt100'][key]) for r in results]] for label,key,fmt in [('Gross P&L $','netDollars',money),('Return on initial$5,000','returnPercent',lambda x:f'{x:.2f}%'),('Closed setups','closed',str),('Wins','wins',str),('Losses','losses',str),('Win rate','winPercent',lambda x:f'{x:.2f}%'),('Resolved drawdown $','drawdown',lambda x:f'{x:.2f}')]])
body+='<h2>Monthly gross at$100 risk</h2>'+table(['Signal month UTC','40/60 $','50/50 $'],[[m,*[money(r['monthlyAt100'][m]['netDollars']) for r in results]] for m in results[0]['monthlyAt100']])
body+='<p>When both orders hit TP, both splits earn$125; when both stop, both lose$100 before costs. Differences come from partial fills and different outcomes on the two tickets. Across resolved setups there were102 both-TP,73 both-SL,12 first-only TP,2 first-only SL,and3 first-SL/second-TP cases.</p>'
body+='<p>Relative to50/50,40/60 lost$150 on the12 first-only winners, saved$20 on the2 first-only losers and gained$67.50 on the3 mixed cases: net−$62.50. It is a small historical advantage, not proof of future superiority.</p>'
body+='<h2>Illustrative sizing/cost sensitivity at$100 allowance</h2>'+table(['Scenario','40/60 $','50/50 $'],[[label,*[money(r[key]['netDollars']) for r in results]] for label,key in [('Rounded lots +.20 price-unit round-trip cost +$7/lot','costAt100'),('Rounded lots +.50 price-unit round-trip cost +$7/lot','stressAt100')]])
body+='<p><strong>The ranking reverses after lot rounding:</strong>40/60 earned$120.79 more in the .20-cost scenario and$120.19 more in the .50-cost scenario. These are sizing/cost sensitivities, not measured broker execution. Therefore50/50 has the higher ideal gross result, while40/60 has the higher rounded-size modeled result. Neither is a proven future winner.</p>'
body+='<p>These costs are assumptions, not broker observations. Assumed100oz contract,.01 lot minimum/step,round down. Strictly two orders; never fall back to one. Stop-risk allowance excludes costs/slippage. No margin,daily-loss or aggregate-open-risk constraints. Gross rows use ideal fractional lots,not rounded broker sizing. All unresolved cases remain excluded; drawdown omits floating losses. All dates reused; no live settings or protected code changed.</p>'
body+=f'<p><a href="{stem}-monthly.csv">Monthly CSV</a> · <a href="{stem}.json">Full methods and results</a></p>'
css='body{font:16px/1.55 system-ui;max-width:1200px;margin:30px auto;padding:0 20px;color:#18283b}table{border-collapse:collapse;width:100%}th,td{padding:10px;border-bottom:1px solid #dbe3ed;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#eaf0f8}'
(root/(stem+'.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Abhi Scalp Logic risk split</title><style>'+css+'</style><body>'+body+'</body></html>',encoding='utf-8')
print(json.dumps({'report':stem+'.html','results':results},indent=2))
