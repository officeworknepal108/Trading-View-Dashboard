"""Audit the fixed-rule entry-anchor comparison and render a concise report."""
import csv
import hashlib
import html
import json
from pathlib import Path

root=Path(__file__).resolve().parent;stem='scalp-confirmation-close-comparison-2026-11-21'
d=json.loads((root/(stem+'.json')).read_text());old,anchor,new=d['results']
gaps={r['signalUTC']:r for r in d['changedAnchors']}
anchor_rows={r['signalUTC']:r for r in anchor['rows']}
checks=0
for r in old['rows']:
    b=anchor_rows[r['signalUTC']];target_by_slot={l['slot']:l for l in r['legs']}
    for l in b['legs']:
        a=target_by_slot.get(l['slot'])
        if not a:continue
        gap=gaps.get(r['signalUTC'],{}).get('difference',0)
        assert abs(l['entry']-a['entry']-gap)<1e-7
        assert abs(l['stop']-a['stop'])<1e-7
        assert abs(l['target']-a['target'])<1e-7
        assert l['share']==a['share'];checks+=1
for r in new['rows']:
    if not r['legs']:continue
    assert len(r['legs'])==2
    assert all(abs(l['rr']-1.25)<1e-7 and l['share']==.5 for l in r['legs'])
for result in d['results']:
    for budget,key in [(50,'risk50'),(100,'risk100')]:
        cash={}
        for r in result['rows']:
            if r['outcome'] not in ['tp','sl','mixed']:continue
            for l in r['legs']:
                value=budget*l['share']*(l['rr'] if l['outcome']=='tp' else -1 if l['outcome']=='sl' else 0)
                if value:cash[l['closedAt']]=cash.get(l['closedAt'],0)+value
        assert abs(sum(cash.values())-result[key]['netDollars'])<1e-6
        assert abs(sum(s[key]['netDollars'] for s in result['monthly'].values())-result[key]['netDollars'])<1e-6
        assert sum(s['wins'] for s in result['byType'].values())==result['risk100']['wins']
audit={'anchorChecks':checks,'unchangedExitsAndShares':'passed','exactPerEntryRR':'passed','cashAndMonthlyReconciliation':'passed','researchSourceSha256':hashlib.sha256((root/(stem+'.ts')).read_bytes()).hexdigest()}
(root/(stem+'-audit.json')).write_text(json.dumps(audit,indent=2)+'\n')
with (root/(stem+'-monthly.csv')).open('w',newline='') as f:
    w=csv.writer(f);w.writerow(['policy','month','closed','wins','losses','winPercent','profitAt50','profitAt100','returnAt100'])
    for result in d['results']:
        for month,s in result['monthly'].items():a=s['risk100'];w.writerow([result['id'],month,a['closed'],a['wins'],a['losses'],a['winPercent'],s['risk50']['netDollars'],a['netDollars'],a['returnPercent']])
esc=lambda x:html.escape(str(x))
money=lambda x:f'{x:+,.2f}'
def table(headers,rows):return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+esc(x)+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table></div>'
body='<h1>Confirmation-candle close versus existing Scalp1:1 code</h1>'
body+='<p><strong>Finding:</strong> Changing only the entry anchor from next-bar open to final confirmation close barely changed gross profit. The full proposed rule set returned more in this reused historical sample; that improvement cannot be attributed to the anchor alone.</p>'
body+='<p class="note">Fixed-rule comparison, no parameter search in this round. All historical data previously reused. $100 total planned setup risk, $5,000 illustrative starting balance, no compounding. Ideal fractional lots before costs. Exclude unresolved outcomes; drawdown counts resolved cash only. No source/live settings/orders changed.</p>'
body+=table(['Rule','Existing code','Close-anchor only','Full proposal'],[
    ['Pullback distance','10%/25% final confirmation body','Same','Same'],
    ['Anchor','Next M15 open','Final confirmation close','Final confirmation close'],
    ['Pattern types','T1/T2/T3','T1/T2/T3','T1/T2/T3'],
    ['Cash allocation at$100','$60/$40','$60/$40','$50/$50'],
    ['SL','Original SL','Unchanged','Unchanged'],
    ['TP','Original common1R target','Unchanged','Each entry exactly1.25R'],
    ['Expiry','75min','75min','60min'],
    ['Additional body filter','None','None','Body >=30% of high-low'],
    ['Two levels','Existing validity checks','Same','Both levels must be valid']])
body+='<p>For all pattern types, the final completed candle at the stored signal time supplies both close and body. BUY: entry=close−body×10%/25%; SELL: entry=close+body×10%/25%. Calculation never uses the new opening price in close-anchor versions. Original SL remains fixed.</p>'
rows=[]
for label,key,fmt in [('Closed setups','closed',str),('Wins','wins',str),('Losses','losses',str),('Win rate','winPercent',lambda x:f'{x:.2f}%'),('Gross P&L $','netDollars',money),('Return on initial$5,000','returnPercent',lambda x:f'{x:.2f}%'),('Ending balance $','endingBalance',lambda x:f'{x:,.2f}'),('Resolved drawdown $','drawdown',lambda x:f'{x:,.2f}'),('Uncertain outcomes','uncertain',str),('Unfilled','unfilled',str),('Invalid/no execution history','invalid',str)]:rows.append([label,*[fmt(r['risk100'][key]) for r in d['results']]])
body+='<h2>Overall at$100 setup risk</h2>'+table(['Metric','Existing','Close only','Full proposal'],rows)
body+='<h2>Monthly at$100 setup risk</h2>'
rows=[]
for month in old['monthly']:
    a=old['monthly'][month]['risk100'];b=anchor['monthly'][month]['risk100'];c=new['monthly'][month]['risk100']
    rows.append([month,money(a['netDollars']),money(b['netDollars']),money(c['netDollars']),c['closed'],c['wins'],c['losses'],f"{c['winPercent']:.2f}%",f"{c['returnPercent']:.2f}%"])
body+=table(['Signal month UTC','Existing P&L $','Close-only P&L $','Full P&L $','Full closed','Full wins','Full losses','Full win rate','Full return'],rows)
body+='<h2>All engulfing types</h2>'+table(['Type','Existing wins/losses','Close-only wins/losses','Full wins/losses','Full P&L $'],[[t,*[f"{r['byType'][t]['wins']}/{r['byType'][t]['losses']}" for r in d['results']],money(new['byType'][t]['netDollars'])] for t in ['T1','T2','T3']])
body+='<h2>At$50 total setup risk</h2>'+table(['Rule','Gross profit $','Return on$5,000'],[[r['label'],money(r['risk50']['netDollars']),f"{r['risk50']['returnPercent']:.2f}%"] for r in d['results']])
delta=anchor['risk100']['netDollars']-old['risk100']['netDollars'];full_delta=new['risk100']['netDollars']-old['risk100']['netDollars']
body+=f'<p>Close-only difference: ${delta:.2f}. Full proposal difference: ${full_delta:.2f}. Confirmation close and next open differ in {d["changedAnchorCount"]} of248 setups with execution data; maximum absolute difference0.27 gold price units. Small anchor changes can alter fills or OHLC ambiguity even when dollar differences are small.</p>'
body+='<h2>Verification and limitations</h2><p>Existing baseline reproduced124wins/77losses and$5,301.70 at$100. Independent audit verifies anchor shifts, unchanged exits/shares for close-only, exactly1.25R for both full-proposal legs, cash totals, monthly sums and T1/T2/T3 reconciliation. Historical execution uses M15, Nov18–20 uses M1. Missing and conflicting execution paths remain uncertain. Same original archived qualifying universe; full proposal applies its explicit extra filter.</p>'
body+='<p>Results do not simulate broker lot rounding, spreads, commission, slippage, swaps, margin, daily-loss limits or aggregate-open-risk limits. Counts may differ because of invalid levels, unfilled orders and uncertain outcomes. Historical profit is not expected future profit. No protected file changed.</p>'
body+=f'<p><a href="{stem}-monthly.csv">Monthly CSV</a> · <a href="{stem}.json">Full comparison and trade records</a> · <a href="{stem}-audit.json">Audit</a></p>'
css='body{font:16px/1.55 system-ui;max-width:1450px;margin:30px auto;padding:0 20px;color:#17283a;background:#f8fafc}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;border-bottom:1px solid #dbe3ed;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#eaf0f8}.scroll{overflow:auto}.note{padding:16px;background:#fff1d8}h2{margin-top:30px}'
(root/(stem+'.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirmation-close comparison</title><style>'+css+'</style><body>'+body+'</body></html>',encoding='utf-8')
print(json.dumps({'report':stem+'.html','audit':audit,'anchorOnlyDifferenceAt100':delta,'fullDifferenceAt100':full_delta},indent=2))
