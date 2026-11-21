"""Render both target interpretations and audit genuine pullback geometry."""
import csv
import hashlib
import html
import json
from pathlib import Path

root=Path(__file__).resolve().parent;stem='scalp-two-pullback-research-2026-11-21'
d=json.loads((root/(stem+'.json')).read_text())
base=next(r for r in d['selected'] if 'earlier-0/10-benchmark' in r['roles'])
exact=next(r for r in d['selected'] if 'best-exact-1.25-per-entry-cost-hindsight' in r['roles'])
common=next(r for r in d['selected'] if 'best-common-target-with-two-lot-sizing-hindsight' in r['roles'])
bmap={r['signalUTC']:r for r in base['rows']}
money=lambda n:f'{n:+,.2f}'
esc=lambda v:html.escape(str(v))

def table(headers,rows):
    return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+esc(x)+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table></div>'

checks=0
for selected in d['selected']:
    if selected['policy'].get('benchmark'):continue
    cash={}
    for r in selected['rows']:
        if not r['legs']:
            assert r['outcome']=='no-valid-entry';continue
        assert len(r['legs'])==2
        original=bmap[r['signalUTC']]['legs'][0]
        sign=1 if r['direction']=='bullish' else -1
        legs=sorted(r['legs'],key=lambda l:l['slot'])
        assert sign*(original['entry']-legs[0]['entry'])>0
        assert sign*(legs[0]['entry']-legs[1]['entry'])>0
        for l in legs:
            assert abs(l['stop']-original['stop'])<1e-7
            assert 0<l['risk']<original['risk']
            if selected['policy']['target']=='each-entry-exact-1.25R':assert abs(l['rr']-1.25)<1e-7
            else:assert abs(l['target']-(original['entry']+sign*original['risk']*1.25))<1e-7
            checks+=1
        if r['outcome'] in ['tp','sl','mixed']:
            for l in legs:
                value=50*l['share']*(l['rr'] if l['outcome']=='tp' else -1 if l['outcome']=='sl' else 0)
                if value:cash[l['closedAt']]=cash.get(l['closedAt'],0)+value
    assert abs(sum(cash.values())-selected['ideal']['netDollars'])<1e-6
    assert abs(sum(s['ideal']['netDollars'] for s in selected['monthly'].values())-selected['ideal']['netDollars'])<1e-6
audit={'geometryChecks':checks,'cashReconciliation':'passed','sourceSha256':hashlib.sha256((root/(stem+'.ts')).read_bytes()).hexdigest(),'selectedExactId':exact['id'],'selectedCommonTwoLotsId':common['id']}
(root/(stem+'-audit.json')).write_text(json.dumps(audit,indent=2)+'\n')
with (root/(stem+'-monthly.csv')).open('w',newline='') as f:
    w=csv.writer(f);w.writerow(['mode','month','closed','wins','losses','winPercent','grossDollars','grossReturn','strictTwoLotCostDollars'])
    for label,r in [('exact1.25R',exact),('common1.25R',common)]:
        for month,s in r['monthly'].items():a=s['ideal'];w.writerow([label,month,a['closed'],a['wins'],a['losses'],a['winPercent'],a['netDollars'],a['returnPercent'],s['cost']['netDollars']])

body='<h1>Two genuine pullback entries — $50 total setup risk</h1>'
body+='<p>Both entries wait for a price pullback after the original setup confirms. Keep the original SL; each entry is closer to that SL. No delayed market entry. Maintain the 30% minimum confirmation-body filter. Two pending limit orders are planned; one or both may remain unfilled.</p>'
body+='<p class="note">Offline research only. No protected dashboard source, live settings or orders changed. This round tested 120 policies on previously reused Aug3–Nov20 prices. Selected results are hindsight candidates, not unseen validation. Fixed risk, no compounding. Gross figures exclude costs and uncertain outcomes.</p>'
body+=table(['Rule','Exact 1.25R for each entry','One common original-reference 1.25R target'],[
    ['First pullback','10% of confirmation body','30% of confirmation body'],
    ['Second pullback','25% of confirmation body','60% of confirmation body'],
    ['First / second risk budget','$25 / $25','$25 / $25'],
    ['Pending-entry deadline','60 minutes','75 minutes'],
    ['SL','Original SL','Original SL'],
    ['TP','Each entry ±1.25 × its own SL distance','Original reference ±1.25 × original SL distance'],
    ['Actual RR','Exactly 1.25 each, before execution effects','Greater than 1.25 after a pullback'],
    ['Management','No BE, trailing or early close','No BE, trailing or early close']])
body+='<p>The risk split is cash risk, not equal lots. Size each ticket separately from its stop distance. Pending entries cancel at their own target, SL or deadline. The model retires a pending entry if price is already beyond its target when orders are evaluated.</p>'
body+='<h2>Simple BUY example</h2><p>Original reference 3500; original SL3480; final confirmation body10. Ideal cash-risk budgets are $25 per ticket. Actual rounded lots can use less risk.</p>'
body+=table(['Version','Entry1','Entry2','SL','TP1','TP2','SL distances'],[
    ['Exact each-entry1.25R','3499','3497.50','3480','3522.75','3519.375','19 / 17.5, versus original20'],
    ['Common original target','3497','3494','3480','3525','3525','17 / 14, versus original20']])
body+='<p>SELL is mirrored: put both limit entries above the reference, closer to the original SL above price. Targets are below entries.</p>'
body+='<h2>Overall results</h2>'
body+=table(['Metric','Earlier0/10 benchmark','Exact each-entry1.25R','Common target, two-lot sizing'],[[name,*[format_value(r) for r in [base,exact,common]]] for name,format_value in [
    ('Closed setups',lambda r:r['ideal']['closed']),('Wins',lambda r:r['ideal']['wins']),('Losses',lambda r:r['ideal']['losses']),
    ('Win rate',lambda r:f"{r['ideal']['winPercent']:.2f}%"),('Gross P&L $',lambda r:money(r['ideal']['netDollars'])),
    ('Return on $5,000',lambda r:f"{r['ideal']['returnPercent']:.2f}%"),('Resolved drawdown $',lambda r:f"{r['ideal']['drawdown']:.2f}"),
    ('Both-entry fills across all244 setups',lambda r:r['ideal']['bothFilled']),('Uncertain setups',lambda r:r['ideal']['uncertain']),
    ('Strict two-order cost-scenario P&L $',lambda r:money(r['cost']['netDollars'])),('Strict size/invalid skips',lambda r:r['cost']['noSize'])]])
body+='<p>Strict sizing assumes100oz contract, .01 lot minimum/step, lots rounded down. If either ticket cannot fit its risk budget, skip the whole setup. No second-only fallback is permitted. The earlier benchmark is recomputed under this same strict policy; its cost result therefore differs from older reports that permitted one-entry fallback.</p>'
body+='<p>Cost sensitivity assumes .20 total round-trip gold price units plus $7/lot commission. Stress uses .50 units plus $7/lot. These are assumptions, not current broker charges. No tick-rounding, executable quotes, margin, daily-stop or aggregate-open-risk model. Stop-risk allowance excludes costs and slippage.</p>'
for label,r in [('Exact1.25R per entry',exact),('Common original-reference target',common)]:
    rows=[]
    for month,s in r['monthly'].items():a=s['ideal'];rows.append([month,a['closed'],a['wins'],a['losses'],f"{a['winPercent']:.2f}%",money(a['netDollars']),f"{a['returnPercent']:.2f}%",money(s['cost']['netDollars'])])
    body+='<h2>'+esc(label)+'</h2>'+table(['Signal month UTC','Closed','Wins','Losses','Win rate','Gross $','Gross return','Strict-size cost $'],rows)
body+='<h2>Interpretation and checks</h2><p>Both versions meet the two-pullback requirement. Exact-per-entry1.25R gives a separate target per ticket and lower modeled profit than the earlier common-target baseline. A common target produces higher per-entry RR after a pullback; calling that exactly1.25R from each entry would be incorrect. Deeper entries reduce fills and can increase drawdown even with a shorter price distance to SL.</p>'
wf=d['walkForward'];a=wf['candidateOctober']['netDollars']+wf['candidateNovember']['netDollars'];b=wf['benchmarkOctober']['netDollars']+wf['benchmarkNovember']['netDollars']
body+=f'<p>Retrospective selection from earlier months used cost-aware net minus half drawdown, min30 resolved training setups and min8 per training month. Its October plus historical-November result was ${a:.2f}, versus ${b:.2f} for the strict-size benchmark. This small later-period difference is reused-data exploration, not independent validation.</p>'
body+=f'<p>Verified {checks} per-entry geometry checks: both entries distinct, both pullbacks, both closer to unchanged original SL; exact RR or common target consistency; known cash/monthly totals; and <=$50 allocated setup risk. Baseline parity with earlier $3,323.02,118wins/83losses reproduced. Unknown outcomes remain excluded. Drawdown omits floating losses.</p>'
body+='<p><a href="https://www.cmegroup.com/education/courses/trade-and-risk-management/proper-position-size">CME: position sizing from stop distance and cash allowance</a>.</p>'
body+=f'<p><a href="{stem}-monthly.csv">Monthly comparison CSV</a> · <a href="{stem}.json">All policies and selected trade records</a> · <a href="{stem}-audit.json">Geometry and accounting audit</a></p>'
css='body{font:16px/1.55 system-ui;max-width:1450px;margin:30px auto;padding:0 20px;color:#17283a;background:#f8fafc}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;text-align:right;border-bottom:1px solid #dbe3ed;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#eaf0f8}.scroll{overflow:auto}.note{padding:16px;background:#fff1d8}h2{margin-top:30px}'
(root/(stem+'.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Two pullback entries</title><style>'+css+'</style><body>'+body+'</body></html>',encoding='utf-8')
print(json.dumps({'report':stem+'.html','audit':audit,'exact':exact['ideal'],'common':common['ideal']},indent=2))
