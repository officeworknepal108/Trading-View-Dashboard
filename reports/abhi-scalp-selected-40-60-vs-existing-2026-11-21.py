"""Selected research allocation:40% first/60% second, versus existing60/40."""
import csv
import hashlib
import html
import json
import math
from pathlib import Path

root=Path(__file__).resolve().parent;stem='abhi-scalp-selected-40-60-vs-existing-2026-11-21'
source=root/'scalp-confirmation-close-comparison-2026-11-21.json'
d=json.loads(source.read_text());existing=next(r for r in d['results'] if r['id']=='existing');proposed=next(r for r in d['results'] if r['id']=='full-proposal')
budget=100

def evaluate(rows,first,rounded=False,price=.2):
    cash={};net=fees=0;closed=wins=losses=0;invalid=uncertain=unfilled=0
    for r in rows:
        if r['outcome']=='no-valid-entry':invalid+=1;continue
        if r['outcome']=='uncertain':uncertain+=1;continue
        if r['outcome']=='not-filled':unfilled+=1;continue
        if r['outcome'] not in ['tp','sl','mixed']:continue
        assert len(r['legs'])==2
        pnl=allocated=0
        for l in r['legs']:
            share=first if l['slot']==0 else 1-first
            raw=budget*share/(l['risk']*100)
            lot=math.floor((raw+1e-12)/.01)*.01 if rounded else raw
            if rounded:assert lot>=.01-1e-10 # every valid order fits at this $100 budget
            allocated+=lot*100*l['risk']
            if l['outcome'] not in ['tp','sl']:continue
            fee=lot*(price*100+7) if rounded else 0
            value=lot*100*l['risk']*(l['rr'] if l['outcome']=='tp' else -1)-fee
            cash[l['closedAt']]=cash.get(l['closedAt'],0)+value;pnl+=value;fees+=fee
        assert allocated<=budget+1e-7
        net+=pnl;closed+=1;wins+=pnl>1e-8;losses+=pnl< -1e-8
    equity=peak=dd=0
    for t,value in sorted(cash.items()):equity+=value;peak=max(peak,equity);dd=max(dd,peak-equity)
    assert abs(equity-net)<1e-6
    assert len(rows)==closed+invalid+uncertain+unfilled
    return {'setups':len(rows),'closed':closed,'wins':wins,'losses':losses,'winPercent':wins/closed*100 if closed else 0,'netDollars':net,'returnOn5000':net/50,'endingBalance':5000+net,'drawdown':dd,'fees':fees,'invalid':invalid,'uncertain':uncertain,'unfilled':unfilled}

results=[]
for label,original,share in [('Existing code',existing,.6),('Abhi Scalp Logic40/60',proposed,.4)]:
    rows=original['rows']
    monthly={m:{'gross':evaluate([r for r in rows if r['signalUTC'].startswith(m)],share),'cost':evaluate([r for r in rows if r['signalUTC'].startswith(m)],share,True)} for m in ['2026-08','2026-09','2026-10','2026-11']}
    results.append({'label':label,'firstShare':share,'secondShare':1-share,'gross':evaluate(rows,share),'cost':evaluate(rows,share,True),'stress':evaluate(rows,share,True,.5),'monthly':monthly})
    for key in ['gross','cost']:assert abs(sum(s[key]['netDollars'] for s in monthly.values())-results[-1][key]['netDollars'])<1e-6
assert abs(results[0]['gross']['netDollars']-5301.701339238501)<1e-6
assert abs(results[1]['gross']['netDollars']-6075)<1e-6
prior=json.loads((root/'abhi-scalp-risk-split-comparison-2026-11-21.json').read_text())['results'][0]
assert abs(results[1]['cost']['netDollars']-prior['costAt100']['netDollars'])<1e-6
output={'selection':{'strategyName':'Abhi Scalp Logic','firstEntryRiskFraction':.4,'secondEntryRiskFraction':.6,'status':'User-selected research allocation; bridge/live code not modified','setupRisk':'Selected through bridge when implemented. $100 here is comparison allowance only, not a fixed strategy amount.'},'method':{'period':'Aug3-Nov20 2026','balance':5000,'setupRisk':100,'existingRules':'10/25 body pullbacks from next M15 open,60/40 allocation,original SL/common original target,75min expiry,original qualification.','newRules':'T1/T2/T3 final confirmation-close10/25 body pullbacks,40/60 allocation,original SL,each-entry exact1.25R target,60min expiry,body>=30% range. Two valid orders.','costs':'Same100oz contract,.01 min/step,floor lots for both. .20 price-unit round trip +$7/lot commission; stress.50+$7/lot. Illustrative assumptions, not broker observations. All valid orders fit individual budgets at$100; no one-entry fallback needed.','limitations':'Previously reused historical data,not future forecasts. Gross ideal lots before costs; other rows rounded-size sensitivities. No executable quotes/tick rounding/swaps/margin/daily or aggregate-open-risk limits. Unknown outcomes excluded; DD resolved cash only,excludes floating losses. No protected code/live settings changed.'},'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'results':results}
(root/(stem+'.json')).write_text(json.dumps(output,indent=2)+'\n')
with (root/(stem+'-monthly.csv')).open('w',newline='') as f:
    w=csv.writer(f);w.writerow(['rule','month','closed','wins','losses','gross','costScenario','returnGross','returnCost'])
    for r in results:
        for month,s in r['monthly'].items():g=s['gross'];w.writerow([r['label'],month,g['closed'],g['wins'],g['losses'],g['netDollars'],s['cost']['netDollars'],g['returnOn5000'],s['cost']['returnOn5000']])
esc=lambda x:html.escape(str(x));money=lambda x:f'{x:+,.2f}'
def table(headers,rows):return '<table><thead><tr>'+''.join('<th>'+esc(x)+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table>'
body='<h1>Selected Abhi Scalp Logic40/60 versus existing code</h1><p><strong>Selected research allocation:</strong>40% risk on first entry,60% on the deeper second entry. The bridge controls the total allowance when implemented. This comparison uses fixed$100 total setup risk and a$5,000 starting balance. Existing code remains unchanged.</p>'
body+=table(['Rule','Existing code','Abhi Scalp Logic'],[['Pullbacks','10%/25% confirmation body','Same10%/25%'],['Entry anchor','Next candle open','Final confirmation candle close'],['Risk split first/second','60%/40%','40%/60%'],['At$100 total risk','$60/$40','$40/$60'],['TP','Original common target','Separate exact1.25R per entry'],['SL','Original SL','Unchanged'],['Expiry','75min','60min'],['Extra body filter','None','Body >=30% of full range']])
body+='<h2>Overall</h2>'+table(['Metric','Existing code','Abhi40/60'],[[label,*[fmt(r[k][v]) for r in results]] for label,k,v,fmt in [('Gross profit $','gross','netDollars',money),('Gross return on$5,000','gross','returnOn5000',lambda x:f'{x:.2f}%'),('Closed setups','gross','closed',str),('Wins','gross','wins',str),('Losses','gross','losses',str),('Win rate','gross','winPercent',lambda x:f'{x:.2f}%'),('Gross resolved drawdown $','gross','drawdown',lambda x:f'{x:.2f}'),('Rounded-size cost-scenario profit $','cost','netDollars',money),('Cost-scenario return','cost','returnOn5000',lambda x:f'{x:.2f}%'),('Cost-scenario drawdown $','cost','drawdown',lambda x:f'{x:.2f}')]])
body+='<h2>Monthly</h2>'+table(['Signal month UTC','Existing gross $','Abhi gross $','Existing cost $','Abhi cost $'],[[m,money(results[0]['monthly'][m]['gross']['netDollars']),money(results[1]['monthly'][m]['gross']['netDollars']),money(results[0]['monthly'][m]['cost']['netDollars']),money(results[1]['monthly'][m]['cost']['netDollars'])] for m in results[0]['monthly']])
body+='<p>Same cost assumptions for both:.20 total round-trip gold price units plus$7/lot,100oz contract,.01 minimum/step,round down. These are not current observed broker costs. Rounded lots often use less than the allowance. At this$100 budget,all valid entry pairs fit without single-entry fallback. Invalid and uncertain setups remain excluded.</p>'
body+='<p>The gross improvement is$773.30; the modeled rounded-size/cost improvement is$874.05. These compare whole strategies,not allocation alone. Target,anchor,expiry and filter also differ. No independent unseen validation has been performed; the data were reused for research.</p>'
body+='<p>Audit reproduced existing$5,301.70 and selected Abhi$6,075 gross results,independently reconciled cash/monthly totals,and reproduced the prior40/60 cost result. Allocated stop risk never exceeds$100 before fees/slippage. No margin,daily-stop,aggregate-open-risk,actual quote or tick-rounding model. Drawdown excludes floating losses. No live source/settings/orders changed.</p>'
body+=f'<p><a href="{stem}-monthly.csv">Monthly CSV</a> · <a href="{stem}.json">Selected policy,assumptions and results</a></p>'
css='body{font:16px/1.55 system-ui;max-width:1300px;margin:30px auto;padding:0 20px;color:#17283b}table{border-collapse:collapse;width:100%}th,td{padding:9px;border-bottom:1px solid #dbe3ed;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#eaf0f8}'
(root/(stem+'.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Abhi40/60 versus existing</title><style>'+css+'</style><body>'+body+'</body></html>',encoding='utf-8')
print(json.dumps({'report':stem+'.html','selection':output['selection'],'results':results},indent=2))
