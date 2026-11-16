"""Compare two equal-risk pullback entries using the prior offline study engine."""
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEM = 'fixed-exit-two-pullbacks-2026-11-16'
engine_path = ROOT / 'fixed-exit-three-pullbacks-2026-11-16.py'
# Load definitions and the original synthetic checks without executing the old
# report-writing block. Generalize ONLY the equal-risk denominator for two legs.
source = engine_path.read_text(encoding='utf-8')
assert source.count('\nvariants = {}\n') == 1
definitions = source.split('\nvariants = {}\n', 1)[0]
assert definitions.count('SETUP_RISK / 3') == 2
definitions = definitions.replace('SETUP_RISK / 3', 'SETUP_RISK / len(FRACTIONS)')
engine = {'__file__': str(engine_path)}
exec(compile(definitions, str(engine_path), 'exec'), engine)
records = engine['records']
old = json.loads((ROOT / 'fixed-exit-three-pullbacks-2026-11-16.json').read_text())
baseline = old['baseline']
money = lambda n: f'{"-" if n < 0 else "+"}${abs(n):,.2f}'
variants, evidence = {}, {}

def add_metrics(s):
    s['returnPercent'] = s['pnlUSD'] / 5000 * 100
    s['winRatePercent'] = s['tp'] / (s['tp'] + s['sl']) * 100 if s['tp'] + s['sl'] else None
    return s

# First verify the generalized engine exactly reproduces BOTH saved three-entry
# variants and both dollar bounds. This catches risk-denominator/regression errors.
engine['FRACTIONS'] = [0.1, 0.25, 0.5]
for mode, preserve in [('exact_10_25_50', False), ('preserve_original_risk_cap', True)]:
    replay = [engine['simulate'](r, preserve) for r in records]
    for which in ['worst', 'best']:
        summary = engine['summarize'](replay, which)
        expected = old['variants'][mode]['all'][which]
        assert abs(summary['pnlUSD'] - expected['pnlUSD']) < 1e-8
        assert all(summary[k] == expected[k] for k in ['tp', 'sl', 'unfilled', 'filledLegs'])

for fractions in [[0.1, 0.25], [0.1, 0.5], [0.25, 0.5]]:
    engine['FRACTIONS'] = fractions
    label = '/'.join(str(round(f * 100)) for f in fractions)
    variants[label], evidence[label] = {}, {}
    for cap_mode, preserve in [('exact', False), ('cap_preserved', True)]:
        rows = [engine['simulate'](r, preserve) for r in records]
        for record in rows:
            assert len(record['legs']) == 2
            assert all(abs(leg['riskUSD'] - 25) < 1e-8 for leg in record['legs'])
            assert all(s['pnlUSD'] >= -50 - 1e-8 for s in record['scenarios'])
        evidence[label][cap_mode] = rows
        groups = {side: {which: add_metrics(engine['summarize'](
            [r for r in rows if side == 'all' or r['side'] == side], which))
            for which in ['worst', 'best']} for side in ['all', 'buy', 'sell']}
        groups['hybrid_original_sells_layered_buys'] = {}
        for which in ['worst', 'best']:
            buy, sell = groups['buy'][which], baseline['sell']
            pnl = buy['pnlUSD'] + sell['pnlUSD']
            tp, sl = buy['tp'] + sell['tp'], buy['sl'] + sell['sl']
            groups['hybrid_original_sells_layered_buys'][which] = {
                'pnlUSD': pnl, 'returnPercent': pnl / 5000 * 100,
                'endingBalanceUSD': 5000 + pnl, 'tp': tp, 'sl': sl,
                'unfilled': buy['unfilled'] + sell['unfilledOrOther'],
                'winRatePercent': tp / (tp + sl) * 100,
                'differenceFromOriginalUSD': pnl - baseline['all']['pnlUSD']}
            all_summary = groups['all'][which]
            assert abs(all_summary['pnlUSD'] - buy['pnlUSD'] - groups['sell'][which]['pnlUSD']) < 1e-8
            assert abs(sum(all_summary['monthly'].values()) - all_summary['pnlUSD']) < 1e-8
        variants[label][cap_mode] = groups

method = dict(old['method'])
method.update(allocation='Two entries; $25 planned risk per entry, $50 total setup risk. No reallocation when an entry misses.',
              entry='Test pairs: 10%/25%, 10%/50%, 25%/50% of confirming candle body from next M15 open. BUY below open, SELL above.',
              comparison='Same 227 archived setups and frozen SL/TP as prior three-entry study; same next-candle-only fill window and TP/SL cancellation. Exact and cap-preserving results separate.',
              selection='Three pair candidates examined retrospectively. Best observed combination is exploratory, not independent validation. Hybrid buys/sells selected after inspecting outcomes.',
              validation='Generalized equal-risk engine reproduces saved 3-entry PnL bounds and counts exactly for both cap policies. All 2-entry legs risk $25, total planned loss <=$50; side and monthly totals reconcile.',
              engineSHA256=hashlib.sha256(engine_path.read_bytes()).hexdigest())
output = {'method': method, 'baseline': baseline, 'threeEntries': old['variants'], 'twoEntries': variants,
          'evidence': evidence}
(ROOT / f'{STEM}.json').write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
with (ROOT / f'{STEM}-trades.csv').open('w', newline='', encoding='utf-8') as stream:
    columns = ['pair', 'capPolicy', 'signalUTC', 'side', 'entry1', 'entry2', 'stopLoss', 'takeProfit',
               'worstPnlUSD', 'bestPnlUSD', 'worstOutcome', 'bestOutcome', 'worstFills', 'bestFills', 'uncertain']
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    for label, policies in evidence.items():
        for policy, rows in policies.items():
            for r in rows:
                writer.writerow(dict(pair=label, capPolicy=policy, signalUTC=r['signalUTC'], side=r['side'],
                    entry1=r['legs'][0]['entry'], entry2=r['legs'][1]['entry'], stopLoss=r['stopLoss'],
                    takeProfit=r['takeProfit'], worstPnlUSD=r['worst']['pnlUSD'], bestPnlUSD=r['best']['pnlUSD'],
                    worstOutcome=r['worst']['outcome'], bestOutcome=r['best']['outcome'],
                    worstFills=r['worst']['fills'], bestFills=r['best']['fills'], uncertain=r['uncertain']))
lines = ['# Two-entry fixed-exit comparison', '',
         '$5,000 illustrative starting balance. $50 fixed setup risk: $25 per entry. Same original SL and TP. 227 matched archived setups, August 3-November 11, 2026. Gross PnL, no compounding.', '',
         f"Original single entry: {money(baseline['all']['pnlUSD'])}, 43.00% return; 131 TP / 88 SL / 8 unfilled, 59.82% completed-setup win rate.", '']
for policy in ['exact', 'cap_preserved']:
    lines += [f'## {policy}', '',
              '| Entry pair | All-trade PnL | Return on $5,000 | Completed setup win rate | Buy PnL | Sell PnL | Original sells + layered buys |',
              '|---|---:|---:|---:|---:|---:|---:|']
    for label, policies in variants.items():
        g = policies[policy]
        bounds = lambda side, key: (g[side]['worst'][key], g[side]['best'][key])
        fmt_money = lambda side: ' to '.join(money(v) for v in bounds(side, 'pnlUSD'))
        fmt_pct = lambda key: ' to '.join(f'{v:.2f}%' for v in bounds('all', key))
        lines.append(f"| {label}% | {fmt_money('all')} | {fmt_pct('returnPercent')} | {fmt_pct('winRatePercent')} | {fmt_money('buy')} | {fmt_money('sell')} | {fmt_money('hybrid_original_sells_layered_buys')} |")
lines += ['', '## Assumptions and validation', ''] + [f'- **{k}:** {v}' for k, v in method.items()]
lines += ['', 'Dollar bounds reflect unknown intrabar event ordering, not statistical confidence intervals. Setup win rate excludes unfilled orders. Partial-fill winners do not necessarily use the full $50 risk budget. Exact pairs may breach the existing stop-distance cap; cap-preserved prices are clamped to the old capped entry and can coincide.', '',
          'No live trading rules, dashboard source or settings were changed. Fresh-data testing with spread, commissions, slippage, overlapping-position limits and lot rounding is needed before applying an exploratory winner.', '',
          f'Reproduce: python reports/{STEM}.py', '']
(ROOT / f'{STEM}.md').write_text('\n'.join(lines), encoding='utf-8')
print(json.dumps({'baseline': baseline['all'], 'twoEntries': variants}, indent=2))
