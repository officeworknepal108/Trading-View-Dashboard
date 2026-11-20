"""Build the offline report and paired day-resampling sensitivity. No trading calls."""
import collections
import datetime
import html
import json
from pathlib import Path
import random

root = Path(__file__).resolve().parent
stem = 'scalp-expanded-entry-study-2026-11-20'
path = root / (stem + '.json')
data = json.loads(path.read_text(encoding='utf-8'))
prior = json.loads((root / 'scalp-reference-entry-comparison-2026-11-20.json').read_text(encoding='utf-8'))
previous = json.loads((root / 'scalp-both-entry-fill-study-2026-11-20.json').read_text(encoding='utf-8'))
best = next(s for s in data['selected'] if s['label'] == 'Full-history profit-and-fill winner (hindsight)')
body_high_fill = next(s for s in data['selected'] if s['label'].endswith('selected body-only candidate'))
compromise = next(s for s in previous['selected'] if s['label'] == 'Full-history compromise (hindsight)')

by_day = collections.defaultdict(lambda: [0.0, 0.0])
for side, rows in enumerate([prior['originalRows'], best['rows']]):
    for row in rows:
        at = datetime.datetime.fromisoformat(row['signalUTC'].replace('Z', '+00:00')) + datetime.timedelta(minutes=15)
        pnl = sum(leg['setupR'] * 4 for leg in row['legs']) if row['outcome'] in ['tp', 'sl', 'mixed'] else 0
        by_day[at.date().isoformat()][side] += pnl
changes = [value[1] - value[0] for value in by_day.values()]
rng = random.Random(20261120)
samples = sorted(sum(rng.choices(changes, k=len(changes))) for _ in range(10000))
resampling = {
    'method': 'Paired resampling by confirmation UTC calendar day; Python random seed 20261120; 10,000 replicates. Uses published ideal known-outcome P&L. Does not resolve OHLC uncertainty or adjust for selecting among 1,536 variants. Not independent significance evidence.',
    'daysWithSetups': len(changes), 'differenceDollars': sum(changes),
    'interval95Dollars': [samples[249], samples[9749]],
    'positiveReplicatePercent': sum(value > 0 for value in samples) / 100,
}
data['dailyResampling'] = resampling
path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')

esc = lambda value: html.escape(str(value))
money = lambda value: ('+$' if value >= 0 else '-$') + f'{abs(value):,.2f}'

def table(headers, rows):
    return '<table><thead><tr>' + ''.join('<th>' + esc(v) + '</th>' for v in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td>' + esc(v) + '</td>' for v in row) + '</tr>' for row in rows) + '</tbody></table>'

records = [
    ('Old next-open method', '10% / 25% body', '60% / 40%', 75, data['old']['full']),
    ('Previous reference compromise (hindsight)', '10% / 12.5% body', '60% / 40%', 75, compromise['full']),
    ('Highest full-history profit (hindsight)', '0% / 10% body', '30% / 70%', 30, best['full']),
    ('Higher-fill body candidate', '0% / 5% body', '80% / 20%', 30, body_high_fill['full']),
]
summary = []
for label, entries, allocation, expiry, stats in records:
    summary.append([label, entries, allocation, expiry, f"{stats['bothFilled']}/235 ({stats['bothFillPercent']:.2f}%)", stats['tp'], stats['sl'], f"{stats['winPercent']:.2f}%", f"{stats['netPips']:,.2f}", money(stats['netDollars'])])
wf = data['walkForward']
monthly = []
for month in ['october', 'november']:
    unit = 'pattern-range' if month == 'october' else 'risk'
    selected = next(s for s in data['selected'] if s['spec']['unit'] == unit)
    spec, result, old = selected['spec'], selected[month], data['old'][month]
    monthly.append([month.title(), f"{spec['first']:g}% / {spec['second']:g}% {spec['unit']}", f"{spec['firstShare']*100:g}% / {(1-spec['firstShare'])*100:g}%", spec['expiry'], result['bothFilled'], old['bothFilled'], money(result['netDollars']), money(old['netDollars'])])

ablation = []
for expiry, share in [(75, .6), (30, .6), (30, .3)]:
    variant = next(r for r in data['grid'] if (r['unit'], r['first'], r['second'], r['expiry'], r['firstShare']) == ('body', 0, 10, expiry, share))
    d = variant['full']
    ablation.append([expiry, f'{share*100:g}% / {(1-share)*100:g}%', d['bothFilled'], f"{d['winPercent']:.2f}%", money(d['netDollars'])])

css = 'body{font:16px/1.55 system-ui,sans-serif;max-width:1500px;margin:32px auto;padding:0 22px;background:#f5f7fb;color:#182638}h1,h2{line-height:1.2}.panel{background:white;border:1px solid #dbe3ef;border-radius:12px;padding:20px;margin:22px 0;overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;border-bottom:1px solid #e1e7ef;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#edf2f8}.note{background:#fff5dc;border-left:4px solid #bc8111;padding:16px}li{margin:9px 0}a{color:#175bb5}'
body = '<h1>Expanded scalp study: is there a meaningful improvement?</h1><p><strong>Finding: no large, dependable gain was established.</strong> Across 1,536 variants, the strongest full-history candidate earned +$193.61 versus +$183.34 for the old method, a 5.60% increase. Choosing candidates using earlier prices and applying each to the following month earned +$112.30 versus +$110.64, an increase of only 1.50%.</p><p>The search compared confirmation body, confirmation high-low range, whole engulfing-pattern range and original stop distance; 30/75/150-minute entry windows; and 30/70, 50/50, 60/40 and 80/20 risk allocations. Original SL/TP and total setup risk were fixed.</p>'
body += '<div class="note"><strong>Cash model:</strong> fixed $4 total risk per setup, ideal fractional lots, no compounding, spreads, fees, slippage or account restrictions. These are research estimates. Selected candidates fail the current Exness minimum-lot check at $200 capital and 2% risk; they are not achievable account returns. No live source, settings or positions were changed.</div>'
body += '<section class="panel"><h2>Full-history comparison</h2>' + table(['Candidate', 'Entry percentages', 'Risk allocation', 'Deadline minutes', 'Both filled', 'TP', 'SL', 'Win rate', 'Net pips', 'Net dollars'], summary) + '<p>Corrected entries use the original reference. 0% means the reference itself. Body percentages refer only to the final confirmation candle body. Both-fill percentages use all 235 setups. Win rates use resolved TP/SL setups, excluding uncertain exits. Pips sum both filled legs in entirely resolved setups; 1 pip = 0.10 gold-price units. Different sizing means pips and dollars can rank candidates differently.</p></section>'
body += '<section class="panel"><h2>Sequential monthly selection</h2>' + table(['Next month', 'Choice from earlier dates', 'Risk allocation', 'Deadline', 'Both filled: selected', 'Both filled: old', 'Selected net', 'Old net'], monthly) + f'<p>Total over {wf["eligibleSetups"]} later setups: selected {money(wf["netDollars"])}, old {money(wf["oldNetDollars"])}. Both-filled: {wf["bothFilled"]} versus {wf["oldBothFilled"]}. Training closes at each month boundary; future exits are excluded. The later dates have been reviewed in previous studies, so this is reused chronological validation, not independent unseen evidence.</p><p>No candidate achieved the declared 20% training-profit improvement while also retaining at least 85% both-entry fills and the other training safeguards in either selection fold.</p></section>'
body += '<section class="panel"><h2>What changed the 0% / 10% body result?</h2>' + table(['Entry deadline minutes', 'Risk allocation', 'Both filled', 'Win rate', 'Net dollars'], ablation) + '<p>The shorter deadline rejected some later fills and improved the historical net result; more budget on the second leg added another small gain. These choices were identified on the same historical sample and can overfit. A shorter deadline does not guarantee a profitable outcome.</p></section>'
lo, hi = resampling['interval95Dollars']
body += f'<section class="panel"><h2>Sensitivity to sampled trading days</h2><p>The full-history winner beat old by {money(resampling["differenceDollars"])}. Paired resampling of the {resampling["daysWithSetups"]} calendar days with setups produced a 95% resampling interval of {money(lo)} to {money(hi)} for that difference. It includes losses relative to the old method. This sensitivity calculation uses ideal known-outcome P&amp;L, does not account for selecting the best among 1,536 variants and is not independent statistical validation.</p></section>'
side_rows = []
for side, stats in best['bySide'].items():
    side_rows.append(['BUY' if side == 'bullish' else 'SELL', stats['setups'], stats['bothFilled'], f"{stats['winPercent']:.2f}%", money(stats['netDollars'])])
body += '<section class="panel"><h2>Side breakdown of the hindsight winner</h2>' + table(['Side', 'Setups', 'Both filled', 'Win rate', 'Net dollars'], side_rows) + '<p>The sample has 46 BUY and 189 SELL setups. BUY results remained negative for this candidate, while SELL trades drove total profit. That imbalance limits what entry tuning alone can establish; this is not sufficient evidence to disable BUY trading.</p></section>'
body += '<section class="panel"><h2>Method and limitations</h2><ul>' + ''.join('<li><strong>' + esc(k) + ':</strong> ' + esc(v) + '</li>' for k, v in data['method'].items() if k != 'hashes') + '</ul><p>Checks reproduce old/corrected baseline results, compare cached risk reweighting with direct replay, reconcile fill categories, verify all 1,536 unique variants and check dollar totals across all periods. The repository lock check flags existing protected changes already present in the workspace. All sections remain locked.</p></section>'
body += f'<p><a href="{stem}.csv">All 1,536 variants</a> · <a href="{stem}-selected-trades.csv">Selected-candidate trade ledger</a> · <a href="{stem}.json">Full results, methods, input hashes and monthly figures</a></p>'
(root / (stem + '.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Expanded scalp entry study</title><style>' + css + '</style><body>' + body + '</body></html>', encoding='utf-8')
print(json.dumps({'report': stem + '.html', 'resampling': resampling, 'walkForward': wf}, indent=2))
