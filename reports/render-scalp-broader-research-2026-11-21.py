"""Render and independently reconcile the broader offline research."""
import csv
import hashlib
import html
import json
import random
from pathlib import Path

root=Path(__file__).resolve().parent
stem='scalp-broader-research-2026-11-21'
d=json.loads((root/(stem+'.json')).read_text())
base=next(r for r in d['selected'] if 'baseline' in r['roles'])
candidate=next(r for r in d['selected'] if 'baseline-filter-hindsight' in r['roles'])
assert candidate['filterName']=='Confirmation body >=30% range'
features={r['signalUTC']:r for r in d['features']}
known=lambda r:r['outcome'] in ['tp','sl','mixed']
money=lambda n:f'{n:+,.2f}'
esc=lambda v:html.escape(str(v))

def table(headers, rows):
    return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+esc(v)+'</th>' for v in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in row)+'</tr>' for row in rows)+'</tbody></table></div>'

def metric(rows):
    closed=[r for r in rows if known(r)]
    cash={}
    for r in closed:
        for leg in r['legs']:
            value=50*leg['share']*(leg['rr'] if leg['outcome']=='tp' else -1 if leg['outcome']=='sl' else 0)
            if value:
                t=leg['closedAt'];cash[t]=cash.get(t,0)+value
    equity=peak=dd=0
    for t,value in sorted(cash.items()):
        equity+=value;peak=max(peak,equity);dd=max(dd,peak-equity)
    net=sum(r['netR']*50 for r in closed)
    assert abs(equity-net)<1e-6
    return {'closed':len(closed),'wins':sum(r['netR']>0 for r in closed),'losses':sum(r['netR']<0 for r in closed),'netDollars':net,'drawdown':dd,'winPercent':sum(r['netR']>0 for r in closed)/len(closed)*100 if closed else 0}

for r in d['selected']:
    actual=metric(r['rows'])
    for key in actual:assert abs(actual[key]-r['overall'][key])<1e-6,(r['id'],key)
    assert abs(sum(s['netDollars'] for s in r['monthly'].values())-r['overall']['netDollars'])<1e-6
    assert r['costSensitivity'][1]['netDollars']<=r['costSensitivity'][0]['netDollars']

sensitivity=[]
for threshold in [.2,.25,.3,.35,.4,.45,.5]:
    rows=[r for r in base['rows'] if features[r['signalUTC']]['bodyFraction']>=threshold]
    sensitivity.append({'threshold':threshold,**metric(rows)})
excluded=[r for r in base['rows'] if features[r['signalUTC']]['bodyFraction']<.3]
assert len(excluded)==5
assert sum(r['outcome']=='sl' for r in excluded)==4
assert sum(r['outcome']=='tp' for r in excluded)==1
assert abs(base['overall']['netDollars']-sum(r['netR']*50 for r in excluded)-candidate['overall']['netDollars'])<1e-6

daily={}
for r in base['rows']:
    day=r['signalUTC'][:10];daily.setdefault(day,0)
    if known(r) and features[r['signalUTC']]['bodyFraction']<.3:daily[day]-=r['netR']*50
rng=random.Random(20261121);values=list(daily.values())
samples=sorted(sum(rng.choices(values,k=len(values))) for _ in range(5000))
audit={'accounting':'passed','thresholdSensitivity':sensitivity,
       'pairedDayBootstrap':{'days':len(values),'iterations':5000,'seed':20261121,'difference':sum(values),'descriptive95Interval':[samples[125],samples[4874]],'limitations':'Does not account for 12,960-combination selection, previous studies, serial dependence across days, excluded outcomes or unseen future performance.'},
       'sourceHashes':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in [stem+'.ts','scalp-validation-model-2026-11-20.ts','scalp-selected-rule-validation-2026-11-20.json','scalp-selected-rule-validation-2026-11-20-fresh-qualified-setups.json','scalp-fresh-data-2026-11-20-M1.json']}}
(root/(stem+'-audit.json')).write_text(json.dumps(audit,indent=2)+'\n')
with (root/(stem+'-monthly.csv')).open('w',newline='') as f:
    writer=csv.writer(f);writer.writerow(['candidate','month','closed','wins','losses','winPercent','netDollars','returnPercent','drawdown'])
    for r in d['selected']:
        for month,s in r['monthly'].items():writer.writerow([r['id'],month,*[s[k] for k in ['closed','wins','losses','winPercent','netDollars','returnPercent','drawdown']]])

body='<h1>Broader scalp research: $50 setup risk</h1>'
body+='<p><strong>Finding:</strong> A small candle-strength filter improved the baseline backtest across profit and win rate without increasing resolved cash drawdown. This is a candidate for new-data validation, not an established live improvement.</p>'
body+='<p class="note">Exploratory retrospective research. All dates have already been inspected. We tried 360 exit/allocation/deadline configurations with 36 filters: 12,960 combinations, some economically equivalent. Full-period winners are selected with hindsight. No live code, settings or orders were changed. Starting balance $5,000; fixed $50 total setup risk, no compounding. Results exclude unresolved outcomes and trading costs unless explicitly labeled.</p>'
body+='<h2>Candidate to validate next</h2><p>Retain first entry at original reference, second entry at 10% confirmation-body pullback, 30%/70% risk split, 30-minute pending deadline, original SL, common target 1.25R from reference, no BE or early close. Add: <strong>abs(final confirmation close − open) / (high − low) ≥ 0.30</strong>. Zero-range candles fail. Use the final closed confirmation candle for every pattern type. For example a 10.00 candle range requires at least a 3.00 body.</p>'
rows=[]
for month,s in candidate['monthly'].items():
    rows.append([month,s['closed'],s['wins'],s['losses'],f"{s['winPercent']:.2f}%",money(s['netDollars']),f"{s['returnPercent']:.2f}%",money(base['monthly'][month]['netDollars'])])
s=candidate['overall'];rows.append(['Overall',s['closed'],s['wins'],s['losses'],f"{s['winPercent']:.2f}%",money(s['netDollars']),f"{s['returnPercent']:.2f}%",money(base['overall']['netDollars'])])
body+=table(['Signal month UTC','Closed setups','Wins','Losses','Win rate','Candidate P&L $','Return on $5,000','Baseline P&L $'],rows)
body+='<p>The filter removes four $50 losses and one $63.18 win: +$136.82 net. Resolved exit-bar drawdown stays $380 (7.60%); floating losses and uncertain setups are excluded. Both methods retain 31 uncertain setups. Five excluded setups are all resolved, so this particular improvement is not created by changing uncertainty exclusions.</p>'
body+=table(['Excluded signal UTC','Direction','Outcome','Baseline P&L $','Body fraction'],[[r['signalUTC'],r['direction'],r['outcome'],money(r['netR']*50),f"{features[r['signalUTC']]['bodyFraction']:.3f}"] for r in excluded])
body+='<h2>Nearby threshold sensitivity</h2><p>These checks were added after observing the 30% result; they are descriptive, not another unseen test. Keep 30% as the candidate rather than promoting the best nearby value.</p>'
body+=table(['Minimum body/range','Closed','Wins','Losses','Win rate','P&L $','Drawdown $'],[[f"{s['threshold']*100:.0f}%",s['closed'],s['wins'],s['losses'],f"{s['winPercent']:.2f}%",money(s['netDollars']),f"{s['drawdown']:.2f}"] for s in sensitivity])
body+='<h2>Lot rounding and illustrative costs</h2><p>Assume a 100 oz gold contract, .01 lot minimum and step. Round volume down; use the second entry alone with up to the full $50 allowance if the split cannot fit. This approximates sizing behavior, not complete live bridge qualification or broker fills. Total modeled allocated SL risk never exceeds $50; actual loss can differ with execution.</p>'
body+=table(['Rule','Round-trip price cost','Commission / lot','Closed','Wins','Losses','Net $'],[[label,s['price'],'$7',s['closed'],s['wins'],s['losses'],money(s['netDollars'])] for label,r in [('Baseline',base),('Body ≥30%',candidate)] for s in r['costSensitivity']])
body+='<p>These spread/slippage/commission scenarios are assumptions, not observed broker charges. Costs are charged only on fully resolved setups. Price cost is the total round-trip gold price-unit cost. No margin, daily-stop or aggregate-open-risk constraints are modeled.</p>'
body+='<h2>Other selected results and their tradeoffs</h2>'
body+=table(['ID','Role','Entry/allocation/expiry/targets','Filter','Closed','Win rate','P&L $','Drawdown $'],[[r['id'],'; '.join(r['roles']),r['spec']['profile']['name'],r['filterName'],r['overall']['closed'],f"{r['overall']['winPercent']:.2f}%",money(r['overall']['netDollars']),f"{r['overall']['drawdown']:.2f}"] for r in d['selected']])
balanced=next(r for r in d['selected'] if 'highest-profit-two-direction-hindsight' in r['roles'])
body+=f'<p>The maximum-profit result is SELL-only and contains only four resolved August trades. It is exposed to market-direction selection bias. The highest two-direction result uses {esc(balanced["spec"]["profile"]["name"])} with filter {esc(balanced["filterName"])}. It increases drawdown and reduces win rate. Neither is a demonstrated replacement.</p>'
body+='<h2>Chronological selection check</h2>'
wf=d['walkForward']
body+=f'<p>At each boundary choose training net profit minus half realized drawdown, requiring at least 40 resolved training setups, at least 12 in each training month and at least 50% wins. Fit Aug–Sep for October, then Aug–Oct for November. The selected rules earned ${wf["candidateNet"]:.2f} across October and the historical November portion, compared with ${wf["baselineNet"]:.2f} for baseline. Boundary outcomes are truncated to information available at selection. This selection procedure did not improve later profit. It is itself retrospective because the history has been reused.</p>'
body+='<p>The 30% body filter was not the chronological winner. The former Nov18–20 sample excludes no setups under this filter, so it provides no new evidence for the filter. Only four avoided losses and one missed winner explain the gain.</p>'
body+=f'<p>A descriptive paired-day bootstrap for the filter’s incremental profit gives a 95% range of ${samples[125]:.2f} to ${samples[4874]:.2f}; it does not account for the many settings tried or prior reuse of these data.</p>'
body+='<h2>Methods and verification</h2>'
body+='<p>Reused the verified exhaustive OHLC event-order replay. Historical execution uses M15; the former fresh period uses M1. Confirmation features use only candles closed by confirmation; reference geometry inherits the archived next-open model. ATR14 is a simple mean of the latest 14 true ranges, not Wilder smoothing; missing required contiguous bars reject the corresponding filter. Relative volume uses 19 prior bars; M15 SMA20 includes confirmation. Body fraction requires only the final confirmation candle. Per-leg targets are measured from original reference; pending entries retire at their own target, SL or deadline.</p>'
body+='<p>Baseline profit and 119-win/87-loss counts reproduced exactly. Independent Python checks reconcile selected trade cash flows, monthly totals and sensitivity costs. The risk-budget assertions and closed-candle feature checks passed. Full JSON includes every tested combination and selected per-entry records.</p>'
body+='<p><a href="https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/fraudadv_tradingsystem.html">CFTC: limitations of hypothetical trading-system results</a>.</p>'
body+=f'<p><a href="{stem}-monthly.csv">Monthly results CSV</a> · <a href="{stem}.csv">All trial summaries CSV</a> · <a href="{stem}.json">Full methods/results</a> · <a href="{stem}-audit.json">Audit and sensitivity checks</a></p>'
css='body{font:16px/1.55 system-ui;max-width:1450px;margin:32px auto;padding:0 20px;color:#18283b;background:#f8fafc}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;border-bottom:1px solid #dce2ea;text-align:right;white-space:nowrap}th{background:#eaf0f7}th:first-child,td:first-child{text-align:left}.scroll{overflow:auto}.note{padding:18px;background:#fff0d5}h2{margin-top:30px}'
(root/(stem+'.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Broader scalp research</title><style>'+css+'</style><body>'+body+'</body></html>',encoding='utf-8')
print(json.dumps({'report':stem+'.html','candidate':candidate['overall'],'sensitivity':sensitivity,'audit':audit['pairedDayBootstrap']},indent=2))
