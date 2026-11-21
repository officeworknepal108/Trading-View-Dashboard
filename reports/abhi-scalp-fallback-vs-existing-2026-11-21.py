"""Same pre-placement minimum-lot fallback for existing code and Abhi40/60."""
import csv
import hashlib
import html
import json
import math
from pathlib import Path

root=Path(__file__).resolve().parent;stem='abhi-scalp-fallback-vs-existing-2026-11-21'
source=root/'scalp-confirmation-close-comparison-2026-11-21.json'
d=json.loads(source.read_text());existing=next(r for r in d['results'] if r['id']=='existing');abhi=next(r for r in d['results'] if r['id']=='full-proposal')

def volume(allowance,distance):
    return math.floor((allowance/(distance*100)+1e-12)/.01)*.01

def allocation(legs,first,budget,allow_fallback=True):
    if len(legs)!=2:return {'mode':'invalid','legs':[]}
    planned=[{**l,'allocationShare':first if l['slot']==0 else 1-first} for l in legs]
    if all(volume(budget*l['allocationShare'],l['risk'])>=.01-1e-10 for l in planned):
        return {'mode':'two-entries','legs':planned}
    if not allow_fallback:return {'mode':'strict-skip','legs':[]}
    second=next(l for l in planned if l['slot']==1)
    if volume(budget,second['risk'])<.01-1e-10:return {'mode':'fallback-still-too-small','legs':[]}
    return {'mode':'second-only','legs':[{**second,'allocationShare':1.0}]}

# Concrete sizing fixtures: cancel first; preserve second geometry; never force minimum.
fixture=[{'slot':0,'risk':18,'entry':100,'stop':82,'target':122.5},{'slot':1,'risk':14,'entry':96,'stop':82,'target':113.5}]
assert allocation(fixture,.4,100)['mode']=='two-entries'
fallback=allocation(fixture,.4,25);assert fallback['mode']=='second-only'
assert fallback['legs'][0]['slot']==1 and fallback['legs'][0]['allocationShare']==1
for key in ['entry','stop','target']:assert fallback['legs'][0][key]==fixture[1][key]
assert allocation(fixture,.4,10)['mode']=='fallback-still-too-small'
assert allocation(fixture,.4,25,False)['mode']=='strict-skip'

def evaluate(rows,first,budget,price=.2,allow_fallback=True):
    counters={k:0 for k in ['twoEntrySetups','secondOnlySetups','fallbackStillTooSmall','strictSizeSkips','invalid','closed','wins','losses','uncertain','unfilled','open','fallbackClosed','fallbackWins','fallbackLosses']}
    cash={};net=fees=0;ledger=[]
    for r in rows:
        plan=allocation(r['legs'],first,budget,allow_fallback)
        mode=plan['mode'];legs=plan['legs']
        if mode=='invalid':counters['invalid']+=1;continue
        if mode=='strict-skip':counters['strictSizeSkips']+=1;continue
        if mode=='fallback-still-too-small':counters['fallbackStillTooSmall']+=1;continue
        counters['secondOnlySetups' if mode=='second-only' else 'twoEntrySetups']+=1
        # Removing leg one changes only exposure, not the retained second entry's path.
        outcome=legs[0]['outcome'] if mode=='second-only' else r['outcome']
        if outcome=='uncertain':counters['uncertain']+=1;continue
        if outcome=='not-filled':counters['unfilled']+=1;continue
        if outcome in ['pending','open']:counters['open']+=1;continue
        assert outcome in ['tp','sl','mixed'],outcome
        pnl=allocated=0
        for l in legs:
            lot=volume(budget*l['allocationShare'],l['risk']);assert lot>=.01-1e-10
            risk=lot*100*l['risk'];allocated+=risk
            if l['outcome'] not in ['tp','sl']:continue
            cost=lot*(price*100+7)
            value=risk*(l['rr'] if l['outcome']=='tp' else -1)-cost
            assert l['closedAt'];cash[l['closedAt']]=cash.get(l['closedAt'],0)+value;pnl+=value;fees+=cost
        assert allocated<=budget+1e-7
        counters['closed']+=1;counters['wins']+=pnl>1e-8;counters['losses']+=pnl< -1e-8
        if mode=='second-only':
            counters['fallbackClosed']+=1;counters['fallbackWins']+=pnl>1e-8;counters['fallbackLosses']+=pnl< -1e-8
        net+=pnl;ledger.append({'signalUTC':r['signalUTC'],'direction':r['direction'],'mode':mode,'netDollars':pnl,'allocatedRisk':allocated})
    assert len(rows)==sum(counters[k] for k in ['invalid','fallbackStillTooSmall','strictSizeSkips','closed','uncertain','unfilled','open'])
    equity=peak=dd=0
    for t,value in sorted(cash.items()):equity+=value;peak=max(peak,equity);dd=max(dd,peak-equity)
    assert abs(equity-net)<1e-6
    return {'setups':len(rows),**counters,'winPercent':counters['wins']/counters['closed']*100 if counters['closed'] else 0,'netDollars':net,'returnOn5000':net/50,'endingBalance':5000+net,'drawdown':dd,'fees':fees},ledger

results=[]
for budget in [100,50,25]:
    scenarios=[]
    for label,original,first in [('Existing code60/40',existing,.6),('Abhi Scalp Logic40/60',abhi,.4)]:
        rows=original['rows'];cost,ledger=evaluate(rows,first,budget)
        stress,_=evaluate(rows,first,budget,.5)
        strict,_=evaluate(rows,first,budget,allow_fallback=False)
        monthly={m:evaluate([r for r in rows if r['signalUTC'].startswith(m)],first,budget)[0] for m in ['2026-08','2026-09','2026-10','2026-11']}
        for key in ['netDollars','closed','secondOnlySetups']:
            assert abs(sum(s[key] for s in monthly.values())-cost[key])<1e-6
        scenarios.append({'label':label,'firstShare':first,'secondShare':1-first,'cost':cost,'stress':stress,'strictWithoutFallback':strict,'fallbackProfitEffect':cost['netDollars']-strict['netDollars'],'monthly':monthly})
        if budget==100:
            with (root/(stem+('-existing-ledger.csv' if first==.6 else '-abhi-ledger.csv'))).open('w',newline='') as f:
                w=csv.DictWriter(f,fieldnames=list(ledger[0]));w.writeheader();w.writerows(ledger)
    results.append({'budget':budget,'strategies':scenarios,'abhiProfitAdvantage':scenarios[1]['cost']['netDollars']-scenarios[0]['cost']['netDollars']})

previous=json.loads((root/'abhi-scalp-selected-40-60-vs-existing-2026-11-21.json').read_text())['results']
for i,r in enumerate(results[0]['strategies']):
    assert r['cost']['secondOnlySetups']==0
    assert abs(r['cost']['netDollars']-previous[i]['cost']['netDollars'])<1e-6
    assert abs(r['cost']['netDollars']-r['strictWithoutFallback']['netDollars'])<1e-6
output={'selection':{'strategy':'Abhi Scalp Logic','riskSplitFirstSecond':[.4,.6],'minimumLotPolicy':'Use second entry alone with full setup allowance if either split falls below minimum; otherwise normal40/60. Skip if full allowance cannot size second entry. Preserve second entry,SL,and1.25R TP. Only before any broker submission.','status':'Offline research update only; protected bridge/server code and live settings remain unchanged.'},'method':{'period':'Aug3-Nov20 2026','startingBalance':5000,'budgets':[100,50,25],'costs':'Same100oz gold contract,.01 minimum/step,round lots down,.20 total round-trip gold price units plus$7/lot commission. Stress:.50 plus$7/lot. Assumptions,not observed broker quotes. Budget is planned SL allowance before fees/slippage.','comparison':'Existing60/40 next-open10/25 pullbacks,original exits,75min,versus Abhi40/60 confirmation-close10/25 pullbacks,each-entry1.25R,60min,body>=30%. Identical sizing/fallback/cost assumptions.','limitations':'Per-leg event outcomes inherited from verified archived OHLC engine. Fallback is selected using geometry before observing outcomes. First entry discarded,second path retained; original uncertain setup can resolve if only discarded first leg caused uncertainty. No new data or independent validation. No broker tick/quote/margin,daily-loss or aggregate-open-risk modeling. DD resolved cash only,excludes floating losses. Atomic live fallback authorization and separate-target peer grouping are not implemented or tested by this research.'},'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'results':results}
(root/(stem+'.json')).write_text(json.dumps(output,indent=2)+'\n')
with (root/(stem+'-monthly.csv')).open('w',newline='') as f:
    w=csv.writer(f);w.writerow(['setupRisk','strategy','month','closed','wins','losses','profitAfterModeledCosts','returnOn5000','secondOnlySetups'])
    for result in results:
        for r in result['strategies']:
            for month,s in r['monthly'].items():w.writerow([result['budget'],r['label'],month,s['closed'],s['wins'],s['losses'],s['netDollars'],s['returnOn5000'],s['secondOnlySetups']])
esc=lambda x:html.escape(str(x));money=lambda x:f'{x:+,.2f}'
def table(headers,rows):return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+esc(x)+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table></div>'
body='<h1>Abhi40/60 with minimum-lot fallback versus existing code</h1><p>Requested research update:if either entry is below broker minimum,cancel first and allocate up to the full setup budget to second alone. If second still cannot fit,skip. Never transfer risk after an order reaches the broker. Original second-entry price,SL and own1.25R target remain fixed.</p>'
body+='<p><strong>At$100 setup risk,the fallback is never triggered in this dataset.</strong> Both tickets already meet the assumed .01 minimum at their normal risk shares. Therefore the previously reported comparison remains unchanged.</p>'
main=results[0]['strategies']
body+=table(['Metric at$100 total risk','Existing code','Abhi40/60 + fallback'],[[label,*[fmt(r['cost'][key]) for r in main]] for label,key,fmt in [('Closed setups','closed',str),('Wins','wins',str),('Losses','losses',str),('Win rate','winPercent',lambda x:f'{x:.2f}%'),('Modeled profit after sizing/costs $','netDollars',money),('Return on initial$5,000','returnOn5000',lambda x:f'{x:.2f}%'),('Resolved cash drawdown $','drawdown',lambda x:f'{x:.2f}'),('Second-only fallback setups','secondOnlySetups',str)]])
body+='<h2>Monthly at$100 risk</h2>'+table(['Signal month UTC','Existing modeled profit $','Abhi modeled profit $','Abhi wins/losses'],[[m,money(main[0]['monthly'][m]['netDollars']),money(main[1]['monthly'][m]['netDollars']),f"{main[1]['monthly'][m]['wins']}/{main[1]['monthly'][m]['losses']}"] for m in main[0]['monthly']])
body+='<h2>Smaller bridge budgets show when fallback matters</h2>'+table(['Setup allowance','Strategy','Two-entry setups','Second-only setups','Still too small','Closed','Wins/losses','Modeled profit $','Change versus strict skip $'],[[result['budget'],r['label'],r['cost']['twoEntrySetups'],r['cost']['secondOnlySetups'],r['cost']['fallbackStillTooSmall'],r['cost']['closed'],f"{r['cost']['wins']}/{r['cost']['losses']}",money(r['cost']['netDollars']),money(r['fallbackProfitEffect'])] for result in results for r in result['strategies']])
body+='<p>Fallback counts are plan decisions across all qualifying setups,including orders that later remain unfilled or uncertain. They are not counts of completed fallback trades. Smaller-budget results are independently resized; they do not simply scale the$100 profit.</p>'
body+='<h2>Assumptions and verification</h2><p>Same100oz contract,.01 minimum/step,rounding down,.20 round-trip gold price-unit cost plus$7/lot for both strategies. These are illustrative assumptions,not actual broker observations. Fees apply to fully resolved retained legs. Unknown outcomes are excluded; DD excludes floating losses. Data previously reused. No compounding,margin,daily loss cap or aggregate-open-risk limit simulation.</p>'
body+='<p>Concrete fixtures cover normal two-entry sizing,second-only fallback preserving entry/SL/TP,strict-skip control,and rejection when even the full allowance is below minimum. Checks enforce <=setup-risk allocation,cash/monthly reconciliation,and exact reproduction of the prior$100 comparison. Source/live bridge remains unchanged; this does not test live claim synchronization or support for grouping Abhi tickets with separate targets.</p>'
body+=f'<p><a href="{stem}-monthly.csv">Monthly comparison CSV</a> · <a href="{stem}.json">All assumptions,counts and smaller-budget results</a> · <a href="{stem}-abhi-ledger.csv">Abhi$100 ledger</a></p>'
css='body{font:16px/1.55 system-ui;max-width:1450px;margin:30px auto;padding:0 20px;color:#17283b}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;border-bottom:1px solid #dbe3ed;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#eaf0f8}.scroll{overflow:auto}'
(root/(stem+'.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Abhi fallback comparison</title><style>'+css+'</style><body>'+body+'</body></html>',encoding='utf-8')
print(json.dumps({'report':stem+'.html','results':results},indent=2))
