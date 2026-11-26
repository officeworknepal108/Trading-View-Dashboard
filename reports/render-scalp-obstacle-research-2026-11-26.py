"""Render offline research outputs. Never accesses trading APIs or account settings."""
import csv
import html
import json
import random
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parent
stem = 'scalp-obstacle-research-2026-11-26'
read = lambda name: json.loads((root / name).read_text(encoding='utf-8'))
raw = read(f'{stem}-v2-rows.json')
short = read(f'{stem}-1500-v2-rows.json')
plan = read(f'{stem}-plan.json')
assert raw['sourceHash'] == short['sourceHash'] == plan['sourceHash']
rows = raw['rows']
assert len({r['key'] for r in rows}) == len(rows) == 87
abhi = [r for r in rows if r['style'] == 'SCALP_1_1']
assert len(abhi) == 85
rules = plan['rules']
periods = [
    ('Oct 7–31', lambda r: r['day'] < '2026-11-01'),
    ('Nov 1–24', lambda r: '2026-11-01' <= r['day'] < '2026-11-25'),
    ('Nov 25', lambda r: r['day'] == '2026-11-25'),
    ('All 85 setups', lambda r: True),
]


def metrics(selected, key, saved=False):
    values = [r['savedR'] if saved else r['results'][key]['low'] for r in selected]
    assert all(v is not None for v in values)
    kept = [r for r in selected if not r['results'][key].get('skipped')]
    blocked = [r for r in selected if r['results'][key].get('skipped')]
    net = sum(r['savedR'] for r in kept) if saved else sum(values)
    return dict(setups=len(selected), retained=len(kept), skipped=len(blocked), netR=net,
                skippedRecordedLosses=sum(r['savedR'] < -1e-8 for r in blocked),
                skippedRecordedWinners=sum(r['savedR'] > 1e-8 for r in blocked),
                fullReplayStops=sum(v <= -.999 for v in values) if not saved else None,
                cost20R=sum(r['results'][key]['cost20'] for r in selected) if not saved else None,
                cost50R=sum(r['results'][key]['cost50'] for r in selected) if not saved else None,
                ambiguous=sum(r['results'][key].get('ambiguous', False) for r in selected))


pre_entry, replay = [], []
for label, predicate in periods:
    selected = [r for r in abhi if predicate(r)]
    base = sum(r['savedR'] for r in selected)
    for rule in rules:
        replay.append(dict(period=label, rule=rule['id'], label=rule['label'], **metrics(selected, rule['id'])))
        if rule['id'].startswith('skip_'):
            item = metrics(selected, rule['id'], saved=True)
            daily_delta = defaultdict(float)
            for r in selected:
                daily_delta[r['day']] += -r['savedR'] if r['results'][rule['id']].get('skipped') else 0
            daily = list(daily_delta.values())
            rng = random.Random(20261126)
            samples = sorted(sum(rng.choice(daily) for _ in daily) for _ in range(10000))
            pre_entry.append(dict(period=label, rule=rule['id'], label=rule['label'], baselineSavedR=base,
                                  pairedDifferenceR=item['netR'] - base,
                                  dayBootstrapDifference95=[samples[250], samples[9750]], **item))

short_index = {r['key']: r for r in short['rows']}
window_changes = {rule['id']: sum(abs(r['results'][rule['id']]['low'] - short_index[r['key']]['results'][rule['id']]['low']) > 1e-8
                                for r in rows) for rule in rules}
reconciled = [r for r in abhi if abs(r['savedR'] - r['results']['baseline']['low']) < 1e-8]
assert len(reconciled) == 77
assert window_changes['skip_same_fib_tp'] == window_changes['cap_same_fib'] == 0
assert all(not r['results'][rule['id']].get('open') for r in rows for rule in rules)
assert all(abs(sum(l['share'] for l in r['legs']) - 1) < 1e-8 for r in abhi)
for r in rows:
    for z in r['obstacles']:
        assert z['startTime'] <= r['signalAt']
        assert z.get('activeFromTime', r['signalAt']) <= r['decisionAt']
        assert any(d['beforeTP'] for d in z['distances'])

summary = dict(sourceHash=raw['sourceHash'], sample=dict(abhi=85, legacyNov25=2,
               originalVsReplayExactMatches=77, originalVsReplayMismatches=8),
               preEntrySavedOutcomeComparisons=pre_entry, brokerReplayComparisons=replay,
               reconciledReplayComparisons=[dict(rule=rule['id'], **metrics(reconciled, rule['id'])) for rule in rules],
               historyWindowSensitivityChangedOutcomes=window_changes,
               yesterday=[r for r in rows if r['day'] == '2026-11-25'])
(root / f'{stem}-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
with (root / f'{stem}-comparison.csv').open('w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=list(replay[0]))
    writer.writeheader()
    writer.writerows(replay)

esc = lambda s: html.escape(str(s))
fmt = lambda n: f'{n:+.2f}R'


def table(headers, values):
    tr = lambda row: '<tr>' + ''.join('<td>' + esc(c) + '</td>' for c in row) + '</tr>'
    return '<div class="scroll"><table><thead>' + tr(headers) + '</thead><tbody>' + ''.join(tr(r) for r in values) + '</tbody></table></div>'


def lookup(items, period, rule):
    return next(r for r in items if r['period'] == period and r['rule'] == rule)


body = '''<h1>Can opposing zones protect a scalp from SL?</h1>
<p class="sub">Research dated 26 November 2026 · XAUUSD · Both entry legs count as one setup · All clock times Nepal</p>
<p class="lead">Your proposed M15 Fib-zone filter is a reasonable candidate to test. In 85 saved Abhi Scalp setups, it removes 15 losing setups and 10 winners. Gross saved return changes from +34.70R to +38.10R, with 60 setups retained. October was essentially flat; November improved. This is promising exploratory evidence, not proof of a reliable improvement.</p>
<h2>The rule tested</h2><ol>
<li>At the engulfing candle’s confirmation, reconstruct only fully closed candles and zones already active and valid.</li>
<li>For a sell, find opposing demand below/overlapping the planned entry. For a buy, find opposing supply above/overlapping it.</li>
<li>Use the current M15 chart’s zones with structure Fib, H4 swing Fib, day Fib or H1 swing-Fib confluence. A+ structure Fib must not be deep-invalidated.</li>
<li>Measure the distance to the zone’s near edge against each entry’s planned TP distance. If either entry must pass the zone to reach TP, skip the whole setup.</li>
</ol><p>A zone is a potential obstacle. It does not establish that TP is unreachable: yesterday’s winning sell passed through the same M15 demand zone that would have blocked entry.</p>
<h2>Pre-entry filter: original saved outcomes</h2><p>This table retains original recorded chart/MT5 outcomes and applies only the entry veto. Returns are gross normalized setup R, not account cash.</p>'''
body += table(['Period / eligible setups', 'Original saved result', 'With M15 Fib veto', 'SL setups skipped', 'Winners skipped', 'Setups retained'], [
    [f"{label} / {lookup(pre_entry, label, 'skip_same_fib_tp')['setups']}",
     fmt(lookup(pre_entry, label, 'skip_same_fib_tp')['baselineSavedR']),
     fmt(lookup(pre_entry, label, 'skip_same_fib_tp')['netR']),
     lookup(pre_entry, label, 'skip_same_fib_tp')['skippedRecordedLosses'],
     lookup(pre_entry, label, 'skip_same_fib_tp')['skippedRecordedWinners'],
     lookup(pre_entry, label, 'skip_same_fib_tp')['retained']] for label, _ in periods])
body += '<p>The overall +3.40R difference is uncertain. A descriptive 95% day-block bootstrap spans −8.50R to +14.65R. All periods were previously inspected, and 13 variants were explored; this is not an untouched validation sample.</p>'
body += '<h2>Alternative: take profit before the obstacle</h2><p>Keep the original protective SL. If an M15 Fib zone lies before TP, put TP 0.10R before its near edge. Skip the setup if either adjusted reward would fall below 0.75R. Otherwise retain both entries and their original 40/60 risk shares.</p>'
body += '<h2>Other solutions: paired broker-candle replay</h2><p>These are separate simulations using the same broker M1 candles and reconstructed planned entries for every variant. Compare against the replay baseline in this table, not the saved-outcome baseline above. Eight of 85 baseline simulations differ from the original saved result because price feeds, fill ordering and plans differ; all are retained and disclosed.</p>'
featured = ['baseline', 'skip_same_fib_tp', 'cap_same_fib', 'skip_all_fib_tp', 'skip_confirmed_tp', 'exit_m5_fib_rejection', 'exit_m5_opposite', 'exit_m15_failure', 'be_05', 'partial_05']
labels = {r['id']: r['label'] for r in rules}
body += table(['Rule', 'Oct 7–31 / 48 setups', 'Nov 1–24 / 33', 'Nov 25 / 4', 'All 85 / gross R', 'All 85 / cost sensitivity'], [
    [labels[key], *[fmt(lookup(replay, label, key)['netR']) for label in ['Oct 7–31', 'Nov 1–24', 'Nov 25', 'All 85 setups']],
     fmt(lookup(replay, 'All 85 setups', key)['cost50R'])] for key in featured])
body += '''<p>Cost sensitivity deducts 0.50 gold price units per filled leg divided by its original stop distance, weighted by risk share. It is an assumption, not measured spread or commission.</p>
<ul><li>The M15 Fib veto and target-before-zone alternatives improve the aggregate replay and both earlier comparison periods.</li>
<li>Vetoing every timeframe’s Fib zone removes too many winners. The narrower M15 rule is the stronger candidate here.</li>
<li>Exiting on every opposite M5 engulfing cuts many full stops but destroys too much profit.</li>
<li>Exiting on an opposite M5 engulfing only when its pattern touches a known opposing Fib zone improves yesterday and November, but underperforms in October.</li>
<li>Blanket breakeven and taking half at +0.5R reduce yesterday’s loss but reduce the overall replay return substantially.</li></ul>
<h2>Yesterday: the four Abhi setups</h2>'''
yesterday = [r for r in rows if r['day'] == '2026-11-25' and r['style'] == 'SCALP_1_1']
body += table(['Signal / confirmed', 'Original result', 'M15 Fib veto', 'TP before M15 Fib', 'Exit on Fib-zone M5 rejection'], [
    [r['signalNepal'] + ' / ' + f"{(r['decisionAt'] + 20700) // 3600 % 24:02.0f}:{(r['decisionAt'] + 20700) // 60 % 60:02.0f}",
     fmt(r['savedR']), 'SKIP' if r['results']['skip_same_fib_tp'].get('skipped') else fmt(r['results']['skip_same_fib_tp']['low']),
     'SKIP' if r['results']['cap_same_fib'].get('skipped') else fmt(r['results']['cap_same_fib']['low']),
     fmt(r['results']['exit_m5_fib_rejection']['low'])] for r in yesterday])
body += '''<p>At 06:00 the M15 QML Fib zone was about 1.20R from the first entry and 1.39R from the second. Only the first entry’s 1.25R TP was obstructed; the strict “either leg” rule skips the whole setup. At 08:30 the same zone was 1.05R/1.12R away, but price broke through and both entries won. At 12:30 the M15 DB Fib zone was only 0.65R/0.75R away. At 02:00 no studied opposing zone was in the path, so this filter could not protect that loss.</p>
<p>A zone being in the path does not prove it caused the later SL; price can reverse before touching it. These are entry filters and management hypotheses, not causal diagnoses.</p>'''
market = read(f'{stem}-market-data.json')['candles']['M15']
charts = []
for i, r in enumerate(yesterday):
    bars = [b for b in market if r['signalAt'] - 7200 <= b['time'] <= r['signalAt'] + 14400 and b.get('complete') is not False]
    zones = [z for z in r['obstacles'] if z['timeframe'] == 'M15' and z['fib']]
    charts.append(dict(id=f'chart-{i}', signalAt=r['signalAt'], bars=bars, legs=r['legs'], zones=zones))
    body += '<details open><summary>' + esc(r['signalNepal'] + ' sell · original ' + fmt(r['savedR'])) + '</summary><div class="chart" id="chart-' + str(i) + '"></div>'
    body += '<p class="sub">Blue: planned entries. Red: original SL. Green: original TPs. Purple: M15 Fib-zone edges fixed as known at confirmation. Later candles are shown for review and were not used to create the entry veto.</p></details>'
body += '''<h2>What to test next</h2><p>Freeze the M15 Fib veto and the target-before-zone alternative as two demo comparison rules, keeping total setup risk and original SL placement unchanged. Record every fresh eligible signal, including skipped, unfilled and losing trades, with the pre-entry zone/Fib snapshot. Judge net R after actual broker costs, loss streaks, drawdown and winners sacrificed. Do not tune the thresholds again after inspecting the new results.</p>
<p>The filter does not eliminate all SLs. It attempts to reject poor room-to-target entries. A protective SL remains the backstop for entries that pass.</p>
<h2>Scope and verification</h2><ul>
<li>Universe: 85 saved v4 Abhi setups with both recorded entry legs, October 7–November 25. Incomplete one-leg histories are excluded; this is not an exhaustive reconstruction of all eligible signals.</li>
<li>Both terminal copies and entry legs are deduplicated by signal/direction. Planned entry levels are reconstructed from the stored confirmation close and body before the outcome is used.</li>
<li>Zone engines see only candles fully closed at confirmation. Structure, H4 swing, current-day Fib and H1 swing confluence use existing production analysis functions.</li>
<li>Longer 5,000-bar lower-timeframe history and shorter 1,500-bar history produced identical outcomes for the proposed M15 Fib veto and M15 target-cap rules across all 87 cases. Two alternatives were sensitive: the confirmed-opposing-zone veto changed two cases and the all-timeframe Fib target-cap changed one case.</li>
<li>M1 replay considers high-first and low-first OHLC paths, limit fill/expiry, pre-fill target cancellation, gaps, stop/TP ordering and next-open execution of closed-candle exit signals. The two simple OHLC paths do not cover every possible intraminute oscillation. No path differences occurred in the reported scenarios; this does not establish tick-level certainty.</li>
<li>Research assertions check duplicate setup identity, risk shares, zone availability, source hashes, candle cutoffs, partial-profit accounting, pending-order cancellation and history-window sensitivity.</li>
<li>The two separate M1 zone-scalp losses on November 25 are case studies only. Abhi rules and the 85-setup tables must not be treated as validation for the separate M1 strategy.</li>
<li>Only research scripts and artifacts were added. Application source and trading settings were not changed. Repository lock check detects the three earlier uncommitted dashboard/journal edits under locked sections; this research does not unlock or alter them.</li>
</ul><h2>Reference material</h2><p>Support/resistance and Fib describe potential obstacles; measured results above come from local data. See <a href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/support-and-resistance">Fidelity: support and resistance</a> and <a href="https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/">TradingView: Fibonacci retracement</a>.</p>
<p class="sub">Raw results: scalp-obstacle-research-2026-11-26-v2-rows.json · Summary: scalp-obstacle-research-2026-11-26-summary.json · Comparison: scalp-obstacle-research-2026-11-26-comparison.csv</p>'''

library = (root.parent / 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js').read_text(encoding='utf-8')
payload = json.dumps(charts).replace('</', '<\\/')
js = '''const researchCharts=PAYLOAD;
for(const item of researchCharts){
 const el=document.getElementById(item.id); const chart=LightweightCharts.createChart(el,{height:300,width:Math.max(300,el.clientWidth),layout:{background:{color:'#ffffff'},textColor:'#334155'},grid:{vertLines:{color:'#edf1f7'},horzLines:{color:'#edf1f7'}},timeScale:{timeVisible:true,secondsVisible:false},rightPriceScale:{borderColor:'#d5deeb'}});
 const candles=chart.addSeries(LightweightCharts.CandlestickSeries,{upColor:'#059669',downColor:'#dc2626',borderVisible:false,wickUpColor:'#059669',wickDownColor:'#dc2626'});
 candles.setData(item.bars.map(b=>({time:b.time+20700,open:b.open,high:b.high,low:b.low,close:b.close})));
 for(const [i,leg] of item.legs.entries()){
  candles.createPriceLine({price:leg.entry,color:'#2563eb',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'Entry '+(i+1)});
  candles.createPriceLine({price:leg.takeProfit,color:'#059669',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'TP '+(i+1)});
 }
 candles.createPriceLine({price:item.legs[0].stopLoss,color:'#dc2626',lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'Original SL'});
 for(const zone of item.zones){for(const [edge,label] of [[zone.top,'near'],[zone.bottom,'far']])candles.createPriceLine({price:edge,color:'#9333ea',lineWidth:2,lineStyle:1,axisLabelVisible:true,title:zone.name+' Fib '+label});}
 if(LightweightCharts.createSeriesMarkers)LightweightCharts.createSeriesMarkers(candles,[{time:item.signalAt+20700,position:'aboveBar',color:'#111827',shape:'arrowDown',text:'SELL signal'}]);
 chart.timeScale().fitContent();new ResizeObserver(()=>chart.applyOptions({width:Math.max(300,el.clientWidth)})).observe(el);
}
'''.replace('PAYLOAD', payload)
page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scalp protection: opposing zones and Fib</title>
<style>body{font:16px/1.65 system-ui,sans-serif;color:#172438;background:#f6f8fc;max-width:1200px;margin:32px auto;padding:0 22px 65px}h1{font-size:34px;line-height:1.2}h2{margin-top:35px;font-size:23px}.sub{font-size:13px;color:#5f6f84}.lead{font-size:19px;background:#fff;border-left:5px solid #365bb2;padding:18px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;background:white;font-size:14px}td{padding:10px 12px;border:1px solid #dbe3ef;white-space:nowrap}td:first-child{white-space:normal;min-width:180px}thead{font-weight:700;background:#e8eef8}details{margin:18px 0;background:#fff;border:1px solid #dbe3ef;padding:15px}summary{font-weight:700;cursor:pointer}.chart{width:100%;height:300px;margin-top:12px}li{margin:9px 0}a{color:#2151a6}@media print{body{background:white;margin:0;max-width:none}.scroll{overflow:visible}table{font-size:10px}td{white-space:normal;padding:6px}details{break-inside:avoid}}</style></head><body>'''
page += body + '<script>' + library + '</script><script>' + js + '</script></body></html>'
(root / f'{stem}.html').write_text(page, encoding='utf-8')
print(json.dumps(dict(report=str(root / f'{stem}.html'), setups=len(abhi), exactBaselineMatches=len(reconciled),
                     m15FibFilterAll=lookup(pre_entry, 'All 85 setups', 'skip_same_fib_tp'),
                     historyWindowChangedOutcomes=sum(window_changes.values())), indent=2))
