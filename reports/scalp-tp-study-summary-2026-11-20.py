"""Make the offline TP-extension report and day-resampling sensitivity."""
import collections
import datetime
import html
import json
from pathlib import Path
import random

root = Path(__file__).resolve().parent
stem = 'scalp-tp-extension-study-2026-11-20'
path = root / (stem + '.json')
data = json.loads(path.read_text(encoding='utf-8'))
prior = json.loads((root / 'scalp-reference-entry-comparison-2026-11-20.json').read_text(encoding='utf-8'))
selected = {r['id']: r for r in data['selected']}
tuned = [r for r in data['grid'] if r['spec']['profile']['name'] == 'Previous profit 0/10' and r['spec']['targets'][0] == r['spec']['targets'][1] and r['spec']['cancel'] == 'new-target']
tuned.sort(key=lambda r: r['spec']['targets'][0])
best = next(r for r in data['selected'] if 'bestFullHistoryHindsight' in r['roles'])
balanced = next(r for r in data['selected'] if 'bestBalancedFullHistoryHindsight' in r['roles'])
split = selected[data['choices']['profitOctober']]

def resample(candidate):
    daily = collections.defaultdict(lambda: [0.0, 0.0])
    for i, rows in enumerate([prior['originalRows'], candidate['rows']]):
        for row in rows:
            at = datetime.datetime.fromisoformat(row['signalUTC'].replace('Z', '+00:00')) + datetime.timedelta(minutes=15)
            pnl = sum(l['setupR'] * 4 for l in row['legs']) if row['outcome'] in ['tp', 'sl', 'mixed'] else 0
            daily[at.date().isoformat()][i] += pnl
    differences = [v[1] - v[0] for v in daily.values()]
    rng = random.Random(20261120)
    draws = sorted(sum(rng.choices(differences, k=len(differences))) for _ in range(10000))
    return {'variantId': candidate['id'], 'days': len(differences), 'differenceDollars': sum(differences),
            'interval95Dollars': [draws[249], draws[9749]], 'positiveReplicatePercent': sum(v > 0 for v in draws) / 100}

data['dayResampling'] = {'method': 'Paired resampling by confirmation UTC calendar day, Python random seed 20261120, 10,000 replicates. Uses ideal known-outcome P&L; does not resolve OHLC uncertainty or correct for repeated strategy selection. Not independent significance evidence.',
                         'comparisons': [resample(r) for r in [best, balanced, split]]}
path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')

assert len(data['grid']) == 156
for row in data['grid']:
    for period in ['training', 'training2', 'october', 'november', 'full']:
        s = row[period]
        assert s['tp'] + s['sl'] + s['mixed'] == s['closed']
        assert s['profitable'] + s['losing'] + s['flat'] == s['closed']
        assert abs(s['grossProfitDollars'] - s['grossLossDollars'] - s['netDollars']) < 1e-7
        assert s['bothFilled'] <= s['firstFilled'] and s['bothFilled'] <= s['secondFilled']

esc = lambda value: html.escape(str(value))
money = lambda value: ('+$' if value >= 0 else '-$') + f'{abs(value):,.2f}'

def table(headers, rows):
    return '<table><thead><tr>' + ''.join('<th>' + esc(v) + '</th>' for v in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td>' + esc(v) + '</td>' for v in row) + '</tr>' for row in rows) + '</tbody></table>'

def result_row(label, s):
    return [label, s['tp'], s['sl'], s['mixed'], f"{s['winPercent']:.2f}%", f"{s['bothFilled']}/235 ({s['bothFillPercent']:.2f}%)", s['uncertain'], s['open'], f"{s['netPips']:,.2f}", money(s['netDollars'])]

headers = ['Target', 'TP setups', 'SL setups', 'Mixed setups', 'Profitable setups %', 'Both filled', 'Uncertain exits', 'Open', 'Net pips', 'Net dollars']
controlled_rows = [result_row(f"{r['spec']['targets'][0]:g}R", r['full']) for r in data['controlled']]
tuned_rows = [result_row('Old method 1R', data['old']['full'])] + [result_row(f"Tuned {r['spec']['targets'][0]:g}R", r['full']) for r in tuned]

split_rows = []
for row in [balanced, best, split]:
    s, spec = row['full'], row['spec']
    split_rows.append([row['id'], f"{spec['targets'][0]:g}R / {spec['targets'][1]:g}R", s['tp'], s['sl'], s['mixed'], s['profitable'], s['losing'], f"{s['winPercent']:.2f}%", s['bothFilled'], money(s['netDollars'])])

monthly_rows = []
for policy in ['profit', 'balanced']:
    for month in ['october', 'november']:
        row = selected[data['choices'][policy + month.title()]]
        spec, s = row['spec'], row[month]
        monthly_rows.append([policy.title(), month.title(), f"{spec['profile']['first']:g}% / {spec['profile']['second']:g}%", f"{spec['targets'][0]:g}R / {spec['targets'][1]:g}R", f"{spec['profile']['share']*100:g}% / {(1-spec['profile']['share'])*100:g}%", s['bothFilled'], f"{s['winPercent']:.2f}%", money(s['netDollars']), money(data['old'][month]['netDollars'])])

css = 'body{font:16px/1.55 system-ui,sans-serif;max-width:1500px;margin:32px auto;padding:0 22px;background:#f5f7fb;color:#172638}h1,h2{line-height:1.2}.panel{padding:20px;margin:22px 0;background:white;border:1px solid #dce4ee;border-radius:12px;overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;border-bottom:1px solid #e1e7ef;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#edf2f8}.note{background:#fff5dc;border-left:4px solid #be8617;padding:16px}li{margin:9px 0}a{color:#155cb4}'
body = '<h1>Scalp TP-extension and split-exit study</h1><p>156 experimental variants on the same 235 archived XAUUSD setups, August 3–November 18, 2026. Original stop-loss and fixed $4 total setup risk remain unchanged.</p><p><strong>Finding:</strong> modest TP extension produced stronger historical gross profit, with lower win rates. The full-history higher-profit candidate used 1.5R for both targets: +$220.57, 51.05% profitable resolved setups, 208 both-entry fills. A 1.25R target gave +$213.32 with 56.19% wins and the same 208 fills. These are hindsight comparisons, not independent future-performance evidence.</p>'
body += '<div class="note"><strong>Simulation assumptions:</strong> fixed $4 setup-risk allowance, ideal fractional lots, no compounding, spread, fees, slippage, margin, daily-loss limits or concurrent-position limits. Whole uncertain/open setups are excluded from main P&L; bounds are in JSON. Your current $200 Exness minimum-lot constraint still prevents these from being executable returns. No live settings, SL/TP, orders or trading source were changed.</div>'
body += '<section class="panel"><h2>Controlled experiment: increase TP only</h2><p>Corrected reference-anchored 10%/25% body entries, 60%/40% risk split, 75-minute entry deadline. Pending entries still cancel at the original 1R target; already-filled positions can continue to the experimental TP. Entry fills therefore remain unchanged.</p>' + table(headers, controlled_rows) + '<p>Increasing TP alone from 1R to 1.5R raised net from +$179.28 to +$184.31, while win rate fell from 59.78% to 48.33%. Doubling or tripling TP performed worse. The larger gains in the next table depend on the changed entry/allocation/deadline profile as well.</p></section>'
body += '<section class="panel"><h2>Tuned profile with larger common targets</h2><p>First entry = original reference (0% body); second entry = 10% final confirmation body below reference for BUY or above for SELL. Risk allocation 30% first / 70% second, total still $4. Entry deadline 30 minutes. Unfilled entries cancel at their experimental target, SL or deadline, so they may remain eligible after original 1R.</p>' + table(headers, tuned_rows) + '<p>TP multiples measure distance from the ORIGINAL reference, using original reference-to-SL distance. They do not assert that both actual entry tickets have exactly that RR. Each ticket RR uses its own entry, original SL and experimental TP.</p></section>'
body += '<section class="panel"><h2>Split exits and chronology-selected candidates</h2>' + table(['Variant', 'First / second TP', 'All TP setups', 'All SL setups', 'Mixed TP/SL', 'Profitable setups', 'Losing setups', 'Profitable %', 'Both filled', 'Net dollars'], split_rows) + '<p>Variant ' + str(split['id']) + ' was selected from earlier training at both monthly boundaries: first entry takes profit at 1R, second at 1.5R, with 30%/70% risk. A mixed setup may earn a first-leg profit while losing more on the larger second leg; mixed does not automatically mean a win.</p></section>'
body += '<section class="panel"><h2>Apply earlier selections to the next month</h2>' + table(['Policy', 'Month', 'Entry body %', 'TP pair', 'Risk shares', 'Both filled', 'Profitable %', 'Selected net', 'Old net'], monthly_rows)
for policy, wf in data['walkForward'].items():
    pct = (wf['netDollars'] / wf['oldNetDollars'] - 1) * 100
    body += f'<p><strong>{policy.title()} policy:</strong> {money(wf["netDollars"])} versus old {money(wf["oldNetDollars"])} ({pct:.2f}% higher); {wf["bothFilled"]} both-filled setups versus {wf["oldBothFilled"]} out of {wf["eligibleSetups"]}. {wf["uncertain"]} uncertain setup exits and {wf["open"]} open setups excluded from its main result.</p>'
body += '<p>These later dates were reviewed in previous studies. Monthly chronological scoring is a useful check, but this is reused history, not pristine unseen validation. Cross-month positions are not carried between folds.</p></section>'
body += '<section class="panel"><h2>Sensitivity to which trading days occur</h2>'
for comparison in data['dayResampling']['comparisons']:
    lo, hi = comparison['interval95Dollars']
    body += f'<p>Variant {comparison["variantId"]}: full-period advantage over old {money(comparison["differenceDollars"])}; paired day-resampling 95% interval {money(lo)} to {money(hi)}.</p>'
body += '<p>' + esc(data['dayResampling']['method']) + '</p></section>'
body += '<section class="panel"><h2>Example target prices</h2><p>For BUY reference 3500 and original SL 3480, original reference risk = 20 price units. Targets are 3520 at 1R, 3525 at 1.25R, 3530 at 1.5R and 3540 at 2R. If the second entry fills at 3499, its RR to 3530 is 31/19 = 1.63, despite the target being labeled 1.5R from the reference. SELL directions are mirrored.</p></section>'
body += '<section class="panel"><h2>Method and limitations</h2><ul>' + ''.join('<li><strong>' + esc(k) + ':</strong> ' + esc(v) + '</li>' for k, v in data['method'].items() if k != 'hashes') + '</ul><p>The simulator matches both earlier old-method and corrected 1R results. Focused fixtures cover BUY/SELL symmetry, independent split exits, first-TP/second-SL outcomes, pending cancellation at original target, continuation of filled positions past original 1R, and correct actual entry RR. All 156 variants reconcile TP/SL/mixed counts, positive/negative setup counts and dollar totals. The lock check flags existing protected workspace changes; the study did not edit protected trading sources. All sections remain locked.</p></section>'
body += f'<p><a href="{stem}.csv">All 156 experimental variants</a> · <a href="{stem}-selected-trades.csv">Selected-candidate trade ledger</a> · <a href="{stem}.json">Full methods, uncertainty bounds, monthly results and input hashes</a></p>'
(root / (stem + '.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scalp TP-extension study</title><style>' + css + '</style><body>' + body + '</body></html>', encoding='utf-8')
print(json.dumps({'report': stem + '.html', 'resampling': data['dayResampling'], 'walkForward': data['walkForward']}, indent=2))
