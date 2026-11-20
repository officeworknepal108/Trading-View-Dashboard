"""Render management research with matched-cohort comparisons; no trading calls."""
import collections
import datetime
import html
import json
from pathlib import Path
import random

root = Path(__file__).resolve().parent
stem = 'scalp-second-close-breakeven-study-2026-11-20'
path = root / (stem + '.json')
data = json.loads(path.read_text(encoding='utf-8'))
selected = {r['id']: r for r in data['selected']}
baseline = selected[0]
rule80 = next(r for r in data['selected'] if r['spec']['targetR'] == 1.25 and r['spec']['progress'] == .8 and r['spec']['origin'] == 'reference' and r['spec']['eligibility'] == 'second-filled' and r['spec']['closeSecond'] and r['spec']['moveBE'] and r['spec']['runnerR'] == 1.25)
rule90 = next(r for r in data['selected'] if r['spec']['targetR'] == 1.25 and r['spec']['progress'] == .9 and r['spec']['origin'] == 'reference' and r['spec']['eligibility'] == 'second-filled' and r['spec']['closeSecond'] and r['spec']['moveBE'] and r['spec']['runnerR'] == 1.25)
primary = [('Hold both to 1.25R', baseline), ('80% close second + first BE', rule80), ('90% close second + first BE', rule90)]
certain = lambda row: row['outcome'] in ['closed', 'not-filled']
indices = [i for i in range(len(baseline['rows'])) if all(certain(r['rows'][i]) for _, r in primary)]

def summarize(rows):
    closed = [r for r in rows if r['outcome'] == 'closed']
    wins = sum(r['netR'] > 1e-8 for r in closed)
    losses = sum(r['netR'] < -1e-8 for r in closed)
    legs = [l for r in rows for l in r['legs']]
    return {'setups': len(rows), 'closed': len(closed), 'wins': wins, 'losses': losses,
            'flat': len(closed) - wins - losses, 'winPercent': wins / len(closed) * 100 if closed else 0,
            'netDollars': sum(r['netR'] * 4 for r in rows),
            'netPips': sum(l['exitPips'] for r in closed for l in r['legs']),
            'firstOutcomes': {outcome: sum(l['slot'] == 0 and l['outcome'] == outcome for l in legs) for outcome in ['tp', 'sl', 'breakeven']},
            'secondOutcomes': {outcome: sum(l['slot'] == 1 and l['outcome'] == outcome for l in legs) for outcome in ['tp', 'sl', 'early-profit']},
            'notFilled': sum(r['outcome'] == 'not-filled' for r in rows)}

common = [{'label': label, 'id': r['id'], 'result': summarize([r['rows'][i] for i in indices])} for label, r in primary]
common_result = {'definition': 'Identical archived setup indices whose outcomes are known for hold, reference-origin 80%, and reference-origin 90%; second-filled activation, unchanged 1.25R runner target.',
                 'included': len(indices), 'excluded': len(baseline['rows']) - len(indices), 'indices': indices, 'comparison': common}
data['commonCohort'] = common_result

def resample(candidate):
    by_day = collections.defaultdict(lambda: [0.0, 0.0])
    for i in indices:
        a, b = candidate['rows'][i], baseline['rows'][i]
        at = datetime.datetime.fromisoformat(a['signalUTC'].replace('Z', '+00:00')) + datetime.timedelta(minutes=15)
        by_day[at.date().isoformat()][0] += a['netR'] * 4
        by_day[at.date().isoformat()][1] += b['netR'] * 4
    differences = [v[0] - v[1] for v in by_day.values()]
    rng = random.Random(20261120)
    draws = sorted(sum(rng.choices(differences, k=len(differences))) for _ in range(10000))
    return {'id': candidate['id'], 'pairedDays': len(differences), 'differenceDollars': sum(differences),
            'interval95Dollars': [draws[249], draws[9749]]}

data['commonCohortResampling'] = {'method': 'Paired confirmation-calendar-day resampling on the common certain cohort, 10,000 replicates, Python random seed 20261120. Conditional on this restricted cohort; does not resolve omitted OHLC cases or correct for parameter selection. Not independent significance evidence.',
                                   'results': [resample(rule80), resample(rule90)]}
path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
assert len(data['grid']) == 101
for r in data['grid']:
    for period in ['training', 'training2', 'october', 'november', 'full']:
        s = r[period]
        assert s['closed'] == s['profitable'] + s['losing'] + s['flat']
        assert abs(s['grossProfitDollars'] - s['grossLossDollars'] - s['netDollars']) < 1e-7
        assert s['bothFilled'] <= min(s['firstFilled'], s['secondFilled'])

esc = lambda value: html.escape(str(value))
money = lambda value: ('+$' if value >= 0 else '-$') + f'{abs(value):,.2f}'

def table(headers, rows):
    return '<table><thead><tr>' + ''.join('<th>' + esc(v) + '</th>' for v in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td>' + esc(v) + '</td>' for v in row) + '</tr>' for row in rows) + '</tbody></table>'

common_rows = []
for r in common:
    s = r['result']
    common_rows.append([r['label'], s['wins'], s['losses'], f"{s['winPercent']:.2f}%", s['firstOutcomes']['tp'], s['firstOutcomes']['breakeven'], s['firstOutcomes']['sl'], s['secondOutcomes']['early-profit'], f"{s['netPips']:,.2f}", money(s['netDollars'])])
headline = []
for label, r in primary:
    s = r['full']
    headline.append([label, s['closed'], s['profitable'], s['losing'], f"{s['winPercent']:.2f}%", s['uncertain'], s['firstOutcomes']['breakeven'], s['secondOutcomes']['early-profit'], f"{s['bothFilled']}/235", money(s['netDollars'])])
sweep = []
for r in data['sweep']:
    s, p = r['full'], r['matched']
    sweep.append([f"{r['spec']['progress']*100:g}%", f"{s['winPercent']:.2f}%", s['firstOutcomes']['breakeven'], s['secondOutcomes']['early-profit'], s['uncertain'], money(s['netDollars']), p['setups'], money(p['baselineNetDollars']), money(p['candidateNetDollars']), money(p['differenceDollars'])])
definitions = []
for r in data['exact80']:
    s, p = r['full'], r['matched']
    definitions.append([r['spec']['origin'], r['spec']['eligibility'], s['bothFilled'], s['uncertain'], money(s['netDollars']), p['setups'], money(p['differenceDollars'])])
controls = []
for r in data['grid']:
    spec = r['spec']
    if spec['origin'] == 'reference' and spec['eligibility'] == 'second-filled' and spec['name'] in ['close-only', 'BE-only']:
        p = r['matched']
        controls.append([spec['name'], f"{r['full']['winPercent']:.2f}%", r['full']['uncertain'], money(r['full']['netDollars']), p['setups'], money(p['differenceDollars'])])

css = 'body{font:16px/1.55 system-ui,sans-serif;max-width:1550px;margin:32px auto;padding:0 22px;color:#182638;background:#f5f7fb}h1,h2{line-height:1.2}.panel{background:white;border:1px solid #dce4ef;border-radius:12px;padding:20px;margin:22px 0;overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;border-bottom:1px solid #e1e7ef;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#edf2f8}.note{padding:16px;background:#fff5dc;border-left:4px solid #be8416}li{margin:9px 0}a{color:#165db5}'
body = '<h1>Close second entry early and protect the first at breakeven</h1><p>101 offline management variants on the same 235 archived XAUUSD setups, August 3–November 18, 2026.</p><p><strong>Primary interpretation:</strong> measure 80% from original reference to the existing 1.25R TP. At this point, close the entire active second entry, move the first entry SL to its own entry, and keep its 1.25R TP. This primary version activates only when the second entry has filled. If only the first entry filled, leave its original exits; the alternative that protects a lone first fill is reported separately.</p><p>Entry plan stays 0%/10% confirmation body from original reference, 30%/70% risk split and a 30-minute entry window. The second entry carries 70% of the risk allowance, so closing it early trims the larger share of potential winning-trade profit.</p>'
body += '<div class="note"><strong>Central limitation:</strong> M15 OHLC does not show whether trigger, retracement to entry and TP occurred in that order. The simulator enumerates all allowed paths and keeps disagreements uncertain. Moving SL to BE creates additional ambiguous outcomes; comparing headline profits after dropping different trades can mislead. The fair comparison below uses identical setups clear under all three primary rules. Dollar figures use ideal fixed $4 setup risk, before all costs. They do not satisfy the existing $200 Exness minimum-lot constraint.</div>'
body += '<section class="panel"><h2>Fair comparison on the same clear outcomes</h2><p>195 setups have clear outcomes under hold, 80% and 90% rules: 185 resolved filled setups and 10 unfilled. Forty of the original 235 are omitted because at least one policy is uncertain or lacks valid data. On this restricted cohort the old +$213.32 hold result becomes +$166.13.</p>' + table(['Rule', 'Profitable setups', 'Losing setups', 'Win rate', 'First TP', 'First BE', 'First SL', 'Second early-profit close', 'Net pips', 'Net dollars'], common_rows) + '<p>The 80% rule improves positive-setup win rate from 54.05% to 60.00%, but cash changes by -$1.38, from +$166.13 to +$164.75. A first-leg BE plus locked second-leg profit is counted as a profitable setup. The 90% rule retains more of the second entry reward on this cohort, but does not establish an improvement in the later-month check.</p></section>'
body += '<section class="panel"><h2>All-235 headline counts: not directly comparable cash samples</h2>' + table(['Rule', 'Resolved setups', 'Profitable', 'Losing', 'Win rate', 'Uncertain exits', 'First BE', 'Second early close', 'Both filled', 'Known-outcome dollars'], headline) + '<p>Do not read +$167.80 versus +$213.32 as an established $45.52 management loss. The 80% policy leaves 38 uncertain outcomes versus 30 under holding, and the included trades differ. The identical-cohort comparison above is -$1.38. No true full-history net return can be established for the uncertain trades from M15 alone.</p></section>'
body += '<section class="panel"><h2>Different trigger percentages, unchanged 1.25R target</h2><p>Reference-origin trigger, second-filled activation. Each pairwise comparison uses its own matched cohort; cohort sizes differ across rows. The known-outcome dollar column is descriptive, not a comparable all-trades return.</p>' + table(['Trigger', 'Headline win %', 'First BE', 'Second early close', 'Uncertain', 'Known-outcome net', 'Pair-matched setups', 'Matched hold net', 'Matched policy net', 'Matched difference'], sweep) + '</section>'
body += '<section class="panel"><h2>Both interpretations of 80% and lone-first-fill behavior</h2>' + table(['Trigger measured from', 'Activation', 'Both filled', 'Uncertain', 'Known-outcome net', 'Pair-matched setups', 'Matched difference vs hold'], definitions) + '<p>second-filled activates only if entry two is active. any-filled can protect a first-only position and cancels the unfilled second entry. Neither-filled setups are not managed. Management cancels any pending entries once activated.</p></section>'
body += '<section class="panel"><h2>Which part of the rule changes the result?</h2>' + table(['Action at reference 80%', 'Headline win %', 'Uncertain exits', 'Known-outcome net', 'Pair-matched setups', 'Matched difference vs hold'], controls) + '<p>Pairwise differences use different known-outcome cohorts; this table does not isolate effects on one identical subset across all actions. Lower early-exit rewards and BE stop-outs can offset protection from original-stop losses.</p></section>'
wf = data['walkForward']
body += f'<section class="panel"><h2>Later-month check</h2><p>Training through September selected the 90% reference trigger for October; training through October selected the same rule for November. It earned {money(wf["candidateNetDollars"])} versus {money(wf["baselineNetDollars"])} for holding both at 1.25R on the later 111 setups. On the {wf["matchedSetups"]} pair-matched later setups, its difference was {money(wf["matchedDifferenceDollars"])}. Both-entry fills were {wf["candidateBothFilled"]} for each policy. These dates were reused from previous research, so this is not pristine unseen validation.</p></section>'
best = next(r for r in data['selected'] if 'bestFullHistoryHindsight' in r['roles'])
same = best['matchedSameTarget']
body += f'<section class="panel"><h2>Other experimental targets and runners</h2><p>The largest headline management result used target {best["spec"]["targetR"]:g}R and trigger {best["spec"]["progress"]*100:g}%: {money(best["full"]["netDollars"])}. Holding both to that same target gives {money(data["holdBaselines"][str(best["spec"]["targetR"])]["full"]["netDollars"])}. On their {same["setups"]} pair-matched setups, management differed by {money(same["differenceDollars"])}. This is a hindsight candidate with differing uncertainty exclusions, not evidence of a live upgrade. Extended first-runner targets 1.5R and 2R after an 80% trigger are in the CSV/JSON.</p></section>'
body += '<section class="panel"><h2>Example prices</h2><p>BUY reference 3500, SL 3480, TP 3525 (1.25R). At 80% reference progress the trigger is 3520. Close the second entry there, move first SL to 3500 and retain TP 3525. At 90% the trigger is 3522.50. If the second entry is 3499, measuring its own 80% progress gives 3519.80 instead of 3520. SELL is mirrored. BE is entry price before fees, spreads and slippage.</p></section>'
body += '<section class="panel"><h2>Methods and limits</h2><ul>' + ''.join('<li><strong>' + esc(k) + ':</strong> ' + esc(v) + '</li>' for k, v in data['method'].items() if k != 'hashes') + '</ul><p>Checks reconcile all 101 variants across training and later periods. The prior 1.25R hold result is reproduced. Path fixtures cover before-trigger stop behavior, trigger then BE, trigger then TP, same-candle order ambiguity and BUY/SELL symmetry. The required repository lock check flags existing protected changes already present; no protected trading source was changed in this study. All sections remain locked.</p></section>'
body += f'<p><a href="{stem}.csv">All 101 variants</a> · <a href="{stem}-selected-trades.csv">Selected trade ledger</a> · <a href="{stem}.json">Full data, matched cohorts, conservative bounds and methods</a></p>'
(root / (stem + '.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Second-entry close and first-entry BE study</title><style>' + css + '</style><body>' + body + '</body></html>', encoding='utf-8')
print(json.dumps({'report': stem + '.html', 'commonCohort': common_result, 'walkForward': wf}, indent=2))
