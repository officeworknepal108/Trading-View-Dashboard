"""Create the selected-candidate validation report from archived analysis output."""
import html
import json
from pathlib import Path

root = Path(__file__).resolve().parent
stem = 'scalp-selected-rule-validation-2026-11-20'
data = json.loads((root / (stem + '.json')).read_text(encoding='utf-8'))
results = {r['id']: r for r in data['results']}
primary, old = results['primary'], results['old']
esc = lambda value: html.escape(str(value))
money = lambda value: ('+$' if value >= 0 else '-$') + f'{abs(value):,.2f}'

def table(headers, rows):
    return '<table><thead><tr>' + ''.join('<th>' + esc(v) + '</th>' for v in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td>' + esc(v) + '</td>' for v in row) + '</tr>' for row in rows) + '</tbody></table>'

comparison = []
for period, label in [('history', 'Aug 3–Nov 18'), ('freshM1', 'Fresh Nov 18–20, M1 replay')]:
    for r in [old, primary]:
        s = r[period]
        comparison.append([label, 'Old method' if r['id'] == 'old' else 'Preselected 1.25R candidate', s['tp'], s['sl'], f"{s['winPercent']:.2f}%", f"{s['bothFilled']}/{s['setups']}", s['uncertain'], s['notFilled'], s['noValidEntry'], f"{s['netPips']:,.2f}", money(s['netDollars'])])

risk = []
for r in data['results']:
    h, f = r['history'], r['freshM1']
    risk.append([r['id'], money(h['netDollars']), f"{h['winPercent']:.2f}%", f"${h['realizedExitBarDrawdownDollars']:.2f}", f"{h['profitFactor']:.2f}", h['maxConsecutiveLosingExitBars'], money(h['netAfterRemovingBestSetup']), money(f['netDollars']), f"{f['winPercent']:.2f}%", f"${f['realizedExitBarDrawdownDollars']:.2f}"])
monthly = [[month, s['tp'], s['sl'], f"{s['winPercent']:.2f}%", money(s['netDollars']), f"${s['realizedExitBarDrawdownDollars']:.2f}"] for month, s in primary['historyMonthly'].items()]
fresh_trades = []
for r in primary['freshM1Rows']:
    first = next((l for l in r['legs'] if l['slot'] == 0), None)
    second = next((l for l in r['legs'] if l['slot'] == 1), None)
    fresh_trades.append([r['signalUTC'], 'SELL' if r['direction'] == 'bearish' else 'BUY', f"{first['entry']:.3f}" if first else '', f"{second['entry']:.3f}" if second else '', f"{first['stop']:.3f}" if first else '', f"{first['target']:.3f}" if first else '', r['outcome'], money(r['netR'] * 4) if r['outcome'] in ['tp', 'sl', 'mixed'] else 'Unresolved / unused'])

css = 'body{font:16px/1.55 system-ui,sans-serif;max-width:1550px;margin:32px auto;padding:0 22px;background:#f5f7fb;color:#182638}h1,h2{line-height:1.2}.panel{padding:20px;margin:22px 0;background:white;border:1px solid #dce4ef;border-radius:12px;overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;border-bottom:1px solid #e1e7ef;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#edf2f8}.note{padding:16px;background:#fff5dc;border-left:4px solid #be8416}li{margin:9px 0}a{color:#165db5}'
body = '<h1>Selected scalp rule: historical risk and fresh-data validation</h1><p><strong>Research candidate retained:</strong> 0% first / 10% second confirmation-body entries, measured from original reference; 30%/70% risk split; 30-minute pending-entry window; original SL; common 1.25R target from the reference; no BE move, early close or partial exit. Pending orders retire at their experimental TP, SL or deadline.</p><p>This primary candidate was announced before inspecting newly qualified trade outcomes. The controls were fixed with it and are not allowed to replace it based on fresh results.</p><p><strong>Fresh result:</strong> 14 qualified setups from November 18 02:00 UTC through November 20 16:37 UTC: 10 TP, 2 SL, 1 unfilled and 1 uncertain. Twelve resolved setups gave 83.33% wins and +$41.58 ideal gross profit, versus +$28.73 for the old method. All 14 fresh setups were SELLs. This is encouraging but too small and one-sided to establish future performance.</p>'
body += '<div class="note"><strong>Execution constraint:</strong> these dollar figures use a fixed $4 setup-risk allowance and ideal fractional lots, before costs. Current Exness XAUUSDm contract size 100 oz and minimum/step 0.01 lot mean none of the 14 fresh setups fit the $4 budget as two entries or second-only fallback. The research candidate is not executable on the current $200 account at 2% risk under this model. No risk increase, live settings change, account connection change or order was made.</div>'
body += '<section class="panel"><h2>Concrete rule</h2><ul><li>Body = abs(close - open) of the final confirmation candle.</li><li>SELL: first = original reference, second = reference + 10% body. BUY: first = original reference, second = reference − 10% body.</li><li>Original pattern stop remains unchanged. Target = reference ± 1.25 × original reference-to-SL distance, in the trade direction. Actual per-entry RR differs with entry price.</li><li>First risk budget = 30%, second = 70%, of one fixed total setup allowance. Each ticket uses its own stop distance for sizing. Unfilled shares stay unused.</li><li>Cancel remaining pending entries at TP/SL touch or 30 minutes from confirmation. Filled trades retain SL/TP. No breakeven, early second-leg close, trailing stop or extra filter.</li><li>Keep the existing M15 qualification: volume decrease at least 250, closed H4 structure and EMA20/50 agreement, and H1 continuation/Far filter.</li></ul></section>'
body += '<section class="panel"><h2>Old method versus preselected candidate</h2>' + table(['Period', 'Method', 'TP setups', 'SL setups', 'Resolved win rate', 'Both filled', 'Uncertain', 'Unfilled', 'No valid entry', 'Net pips', 'Ideal net dollars'], comparison) + '<p>Both-filled is measured across every qualified setup in each period. Win rate excludes uncertain/open/unfilled/invalid setups. Net pips are unweighted totals of filled legs in fully resolved setups; 1 pip = 0.10 gold-price units. Risk-based lot sizing means pips and dollars need not rank candidates identically.</p></section>'
body += '<section class="panel"><h2>Risk and control comparisons</h2>' + table(['Candidate', 'History net', 'History win %', 'Realized drawdown', 'Profit factor', 'Max losing exit bars', 'Net without best setup', 'Fresh net', 'Fresh win %', 'Fresh realized drawdown'], risk) + '<p>Drawdown uses only known, fully resolved setup cash flows, grouped by exit-bar time. It excludes floating losses and uncertain outcomes and is not actual account drawdown. Holding durations and equity curves are in JSON. Losing bars are cash-flow bars; order within the same exit candle is not known. The primary candidate still had eight consecutive losing exit bars historically.</p></section>'
body += '<section class="panel"><h2>Monthly history of the primary candidate</h2>' + table(['Month', 'TP', 'SL', 'Win rate', 'Ideal net', 'Realized drawdown'], monthly) + '<p>August was negative. The candidate is not claimed to win each month. The historical set was used repeatedly in earlier tuning and is not independent validation.</p></section>'
body += '<section class="panel"><h2>Every fresh primary-candidate setup</h2>' + table(['Confirmation candle UTC', 'Direction', 'First entry', 'Second entry', 'Initial SL', 'TP', 'Outcome', 'Ideal gross result'], fresh_trades) + '<p>Rows are qualified chart simulations, not broker executions. The unknown result is not counted as zero profit or a loss in win-rate statistics. No fresh setting was selected after seeing these outcomes.</p></section>'
agreement = data['priceAgreement']
body += f'<section class="panel"><h2>Fresh data checks</h2><p>Downloaded native TradingView OANDA M1, M15, H1 and H4 snapshots. {agreement["complete"]} complete M15 bars reconstructed from M1 matched exactly; {agreement["incomplete"]} did not have all 15 minutes and were not used for that aggregation check. Maximum complete-bar OHLC difference was {agreement["maxDifference"]}. All {data["causalChecks"]} new signals reproduced using only candles known at their confirmation, with no later data. There were no duplicate signal dates with the old study.</p><p>For every candidate, fresh M1 and M15 produced identical setup outcomes and net R on all 14 setups. One-minute data did not eliminate the unresolved history-gap case. Baseline historical P&L and fills were reproduced, and the exit-bar cash curve reconciles with headline net.</p></section>'
body += '<section class="panel"><h2>Methods and limitations</h2><ul>' + ''.join('<li><strong>' + esc(k) + ':</strong> ' + esc(v) + '</li>' for k, v in data['method'].items() if k != 'sourceHashes') + '</ul><p>The first announced candidate remains the primary after fresh evaluation; larger-target and other controls have not been promoted based on this small new sample. The required lock check flags existing protected workspace changes. Only offline research files were added or edited; all repository sections remain locked.</p></section>'
body += f'<p><a href="{stem}.csv">Candidate/period comparison CSV</a> · <a href="{stem}-fresh-trades.csv">Fresh per-entry ledger CSV</a> · <a href="{stem}.json">Full methods, risk curves, sizing, data hashes and coverage</a> · <a href="{stem}-frozen-plan.json">Candidate plan</a></p>'
(root / (stem + '.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Selected scalp rule validation</title><style>' + css + '</style><body>' + body + '</body></html>', encoding='utf-8')
assert data['causalChecks'] == data['freshQualifiedCount'] == 14
assert not data['priceAgreement']['disagreements']
for r in data['results']:
    assert r['resolutionAgreement']['sameSetupOutcome'] == r['resolutionAgreement']['setups']
    assert r['resolutionAgreement']['sameNetR'] == r['resolutionAgreement']['setups']
print(json.dumps({'report': stem + '.html', 'primaryHistoricalNet': primary['history']['netDollars'], 'primaryFreshNet': primary['freshM1']['netDollars'], 'freshTP': primary['freshM1']['tp'], 'freshSL': primary['freshM1']['sl'], 'causalChecks': data['causalChecks']}, indent=2))
