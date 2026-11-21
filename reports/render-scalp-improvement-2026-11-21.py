"""Render the offline study and check its accounting. No trading calls."""
import hashlib
import html
import json
import random
from pathlib import Path

root = Path(__file__).resolve().parent
stem = 'scalp-improvement-study-2026-11-21'
data = json.loads((root / (stem + '.json')).read_text())
selected = {r['id']: r for r in data['selected']}
baseline = selected[data['baselineId']]
alternative = selected[data['historyPick']]
money = lambda n: f'{n:+,.2f}'
esc = lambda v: html.escape(str(v))

def table(headers, rows):
    return '<table><thead><tr>' + ''.join('<th>'+esc(x)+'</th>' for x in headers) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table>'

for r in selected.values():
    for bucket in ['monthly', 'fallbackMonthly']:
        expected = r['overall'] if bucket == 'monthly' else r['fallbackCosts'][0]
        assert abs(sum(m['netDollars'] for m in r[bucket].values())-expected['netDollars']) < 1e-6
        assert sum(m['closed'] for m in r[bucket].values()) == expected['closed']
    for costs in ['costSensitivity', 'fallbackCosts']:
        assert r[costs][1]['netDollars'] <= r[costs][0]['netDollars']

# Paired resampling by signal UTC date, on setups resolved for both rules.
daily = {}
for a, b in zip(alternative['rows'], baseline['rows']):
    assert a['signalUTC'] == b['signalUTC']
    if a['outcome'] not in ['tp','sl','mixed'] or b['outcome'] not in ['tp','sl','mixed']:
        continue
    day = a['signalUTC'][:10]
    daily[day] = daily.get(day, 0) + (a['netR']-b['netR'])*50
rng = random.Random(20261121)
values = list(daily.values())
samples = sorted(sum(rng.choices(values, k=len(values))) for _ in range(5000))
resampling = {'days':len(values), 'iterations':5000, 'seed':20261121,
              'matchedDifference':sum(values), 'descriptive95PercentInterval':[samples[125], samples[4874]],
              'limitation':'Exploratory descriptive interval on matched resolved setups only. Does not correct for 70-rule selection, serial dependence across days, excluded uncertainty, or prior reuse of data. Not independent significance evidence.'}
hashes = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'scalp-validation-model-2026-11-20.ts', root/'scalp-improvement-study-2026-11-21.ts', root/'scalp-selected-rule-validation-2026-11-20.json']}
(root/(stem+'-audit.json')).write_text(json.dumps({'accounting':'passed', 'hashes':hashes, 'pairedDayResampling':resampling},indent=2)+'\n')

body = '<h1>Scalp improvement research — $50 risk, $5,000 starting balance</h1>'
body += '<p><strong>Finding:</strong> 70 focused variants did not establish a reliably better replacement. Keeping 0%/10% entries, 30%/70% allocation and a 30-minute deadline but moving the common reference target from 1.25R to 1.5R slightly increased idealized total profit, while reducing win rate and increasing realized drawdown.</p>'
body += '<p class="note">All results are hypothetical. August–November 20 data have already been used for research. The former fresh sample is now reused, not a new validation set. No live strategy, account settings, or orders were changed. Fixed $50 setup risk; no compounding. No margin, concurrent-risk limit or daily-loss limit simulation.</p>'
body += '<h2>Ideal fractional lots, before costs</h2>'
rows = []
for month in baseline['monthly']:
    for label, r in [('1.25R baseline',baseline),('1.5R alternative',alternative)]:
        s=r['monthly'][month]
        rows.append([month,label,s['closed'],s['wins'],s['losses'],f"{s['winPercent']:.2f}%",money(s['netDollars']),f"{s['returnPercent']:.2f}%"])
for label,r in [('1.25R overall',baseline),('1.5R overall',alternative)]:
    s=r['overall'];rows.append(['Overall',label,s['closed'],s['wins'],s['losses'],f"{s['winPercent']:.2f}%",money(s['netDollars']),f"{s['returnPercent']:.2f}%"])
body += table(['Period','Rule','Closed setups','Wins','Losses','Win rate','P&L $','Return on $5,000'],rows)
body += '<p>1.25R realized exit-bar drawdown: $380 (7.60%). 1.5R: $500 (10.00%). These exclude floating losses and uncertain outcomes. 31 baseline setups and 35 alternative setups remain uncertain. P&L excludes these outcomes; differing exclusions affect rankings.</p>'
body += '<h2>Selection and chronological checks</h2>'
body += '<p>Grid: first entry 0%; second 0%, 10%, or 25% body; first risk share 30%, 50%, or 70%; deadline 30 or 60 minutes; targets 1, 1.25, 1.5, 1.75, or 2R. Redundant shares for identical entries were removed, leaving 70 variants. Qualification and original SL unchanged. Common targets measured from original reference, not each entry. No BE or early close.</p>'
body += '<p>The highest August–September ideal profit selected 0%/25%, 30%/70%, 30 minutes, 1R. Its later historical October–November profit was $1,137.40 versus $1,729.30 for the baseline. Thus selecting the early winner did not improve the later period. All dates have nevertheless been previously inspected.</p>'
body += '<p>For the 1.5R alternative, the previously separate November 18–20 sample returned $503.33 versus $519.70 for baseline. Its ideal full-history advantage is therefore not consistent across periods.</p>'
body += '<h2>Minimum-lot and cost sensitivity</h2>'
body += '<p>Assumed 100 oz contract, .01 lot minimum/step, rounding volume down. Strict mode skips a setup if either entry cannot fit its share. Fallback mode instead assigns up to the entire $50 budget to the second entry when a split cannot fit. This is a sizing approximation, not a complete broker execution replay. Spread, executable quote, price rounding and fallback qualification still require live verification.</p>'
rows=[]
for r in selected.values():
    for mode,key in [('Strict two entries','costSensitivity'),('Second-only fallback','fallbackCosts')]:
        s=r[key][0]
        rows.append([r['id'],r['spec']['profile']['name'],mode,s['closed'],s['wins'],s['losses'],money(s['netDollars']),f"{s['realizedExitBarDrawdown']:.2f}",s['noSize']])
body += table(['ID','Rule','Sizing policy','Closed','Wins','Losses','P&L $','Drawdown $','Skipped size/invalid'],rows)
body += '<p>Cost scenario: 0.20 gold price units round trip plus $7 per lot. These are sensitivity assumptions, not observed current broker costs. At 0.50 units plus $7/lot, baseline fallback returns $2,180.76 and 1.5R fallback $2,277.45. Costs are applied only to fully resolved setups. Rounded lots often use less than the $50 allowance.</p>'
body += '<p>The apparent strict-sizing improvement from other allocations weakened or reversed after including second-only fallback. Policy assumptions materially change the ranking.</p>'
body += '<h2>Matched-outcome uncertainty check</h2>'
body += f'<p>On setups resolved by both rules, the ideal difference is ${resampling["matchedDifference"]:.2f}. A descriptive 5,000-resample paired-day interval is ${samples[125]:.2f} to ${samples[4874]:.2f}. {esc(resampling["limitation"])}</p>'
body += '<h2>Conclusion</h2><p>Retain the 1.25R baseline for further research. Treat 1.5R as an exploratory alternative; its small extra modeled profit does not compensate clearly for lower accuracy and higher drawdown. A frozen rule tested on new, unseen prices with actual broker costs is needed before claiming improvement.</p>'
body += f'<p><a href="{stem}.csv">Summary CSV</a> · <a href="{stem}.json">Complete results and per-entry records</a> · <a href="{stem}-audit.json">Accounting and reproducibility audit</a></p>'
css='body{font:16px/1.55 system-ui;max-width:1400px;margin:30px auto;padding:0 20px;color:#172438;background:#fafbfd}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;text-align:right;border-bottom:1px solid #dce1e8}th:first-child,td:first-child{text-align:left}th{background:#eaf0f8}.note{padding:16px;background:#fff2d8}h2{margin-top:30px}'
(root/(stem+'.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scalp improvement research</title><style>'+css+'</style><body>'+body+'</body></html>',encoding='utf-8')
print(json.dumps({'report':stem+'.html','audit':resampling},indent=2))
