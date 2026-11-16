"""Offline matched-setup research. Writes reports only; no trading connections."""
import csv
import hashlib
import json
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEM = 'fixed-exit-three-pullbacks-2026-11-16'
STARTING_BALANCE, SETUP_RISK = 5000.0, 50.0
FRACTIONS = [0.10, 0.25, 0.50]
EPS = 1e-8

def read(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))

prior = read('next-candle-pullback-study-2026-11-16.json')
for item in prior['method']['inputs']:
    assert hashlib.sha256((ROOT / item['file']).read_bytes()).hexdigest() == item['sha256']
archive = read('volume-gap-study-2026-11-15.json')
times = {r['signalUTC'] for r in prior['rows']}
records = [r for r in archive['rows'] if r['signalUTC'] in times]
assert len(records) == 227
merged = {}
for name in ['five-month-m15-history-older.json', 'five-month-m15-history-latest.json']:
    for c in read(name):
        if c['time'] not in merged or c.get('complete') is not False:
            merged[c['time']] = c
candles = sorted((c for c in merged.values() if c.get('complete') is not False), key=lambda c: c['time'])
indices = {c['time']: i for i, c in enumerate(candles)}

def next_bar_states(o, h, l, c, entries, target):
    """All continuous OHLC-consistent event orders, not just O-H-L-C/O-L-H-C.

    Work in a mirrored long coordinate: common SL=0, TP>0. Terminal common
    barriers cancel remaining orders. Moving between adjacent event prices can
    reverse arbitrarily, allowing partial fills before a target and later lows.
    The visited high/low flags require consistency with the entire known bar.
    """
    assert l <= min(o, c) + EPS and h >= max(o, c) - EPS
    assert 0 < o < target
    prices = sorted(set([o, h, l, c] + [x for x in [0, target, *entries] if l <= x <= h]))
    loc = {x: i for i, x in enumerate(prices)}
    def arrive(position, mask, terminal, seen):
        x = prices[position]
        seen |= (1 if x == h else 0) | (2 if x == l else 0)
        if not terminal:
            for i, entry in enumerate(entries):
                if x <= entry + EPS:
                    mask |= 1 << i
            if x <= EPS:
                terminal = 'sl'
            elif x >= target - EPS:
                terminal = 'tp'
        return position, mask, terminal, seen
    initial = arrive(loc[o], 0, '', 0)
    todo, visited, final = deque([initial]), {initial}, set()
    while todo:
        state = todo.popleft()
        position, mask, terminal, seen = state
        if position == loc[c] and seen == 3:
            final.add((mask, terminal))
        for next_position in [position - 1, position + 1]:
            if not 0 <= next_position < len(prices):
                continue
            updated = arrive(next_position, mask, terminal, seen)
            if updated not in visited:
                visited.add(updated)
                todo.append(updated)
    assert final
    return final

# Meaningful synthetic checks: exact fill count, expiry, cancellation, partial
# fill before TP even when both OHLC extremes occur after it, SL and mirroring.
assert next_bar_states(10, 11, 9.5, 10, [9, 7.5, 5], 20) == {(0, '')}
assert next_bar_states(10, 11, 7, 10, [9, 7.5, 5], 20) == {(3, '')}
assert next_bar_states(10, 11, -1, 5, [9, 7.5, 5], 20) == {(7, 'sl')}
possible = next_bar_states(10, 21, 4, 10, [9, 7.5, 5], 20)
assert possible == {(0, 'tp'), (1, 'tp'), (3, 'tp'), (7, 'tp')}
possible_both = next_bar_states(10, 21, -1, 10, [9, 7.5, 5], 20)
assert (7, 'sl') in possible_both and (7, 'tp') in possible_both
assert (0, 'tp') in possible_both and (3, 'tp') in possible_both

def future_exit(start, sign, stop, target):
    for bar in candles[start:]:
        low, high = sorted([sign * (bar['low'] - stop), sign * (bar['high'] - stop)])
        opening = sign * (bar['open'] - stop)
        # Exits are credited at planned levels, matching the cost-free baseline.
        if opening <= 0:
            return [('sl', bar['time'])]
        if opening >= target:
            return [('tp', bar['time'])]
        outcomes = ([('sl', bar['time'])] if low <= 0 else []) + ([('tp', bar['time'])] if high >= target else [])
        if outcomes:
            return outcomes
    return [('active', None)]

def simulate(record, preserve_cap):
    index = indices[record['time']]
    confirmation, bar = candles[index], candles[index + 1]
    assert bar['time'] == record['time'] + 900
    sign = 1 if record['direction'] == 'bullish' else -1
    stop, target_price = record['levels']['stopLoss'], record['levels']['takeProfit']
    original_entry = record['levels']['entry']
    target = sign * (target_price - stop)
    opening = sign * (bar['open'] - stop)
    body = abs(confirmation['close'] - confirmation['open'])
    cap_adjustments, omitted, over_cap = 0, 0, 0
    legs = []
    for fraction in FRACTIONS:
        requested = bar['open'] - sign * fraction * body
        entry = requested
        if preserve_cap and record['levels']['pendingAtCreation']:
            entry = min(entry, original_entry) if sign == 1 else max(entry, original_entry)
        cap_adjustments += abs(entry - requested) > EPS
        distance = sign * (entry - stop)
        if not 0 < distance < target:
            omitted += 1
            continue
        over_cap += distance > 20 + EPS  # Existing M15 200-pip maximum at 0.1/pip.
        legs.append({'fraction': fraction, 'entry': entry, 'distance': distance,
                     'riskUSD': SETUP_RISK / 3,
                     'quantityGoldUnits': (SETUP_RISK / 3) / distance,
                     'rewardRisk': (target - distance) / distance})
    if not legs:
        return {'signalUTC': record['signalUTC'], 'side': 'buy' if sign == 1 else 'sell',
                'scenarios': [{'outcome': 'omitted', 'pnlUSD': 0, 'fills': 0, 'resolvedAt': bar['time']}],
                'legs': [], 'capAdjustedLegs': cap_adjustments, 'omittedLegs': omitted, 'overCapLegs': over_cap}
    entries = [leg['distance'] for leg in legs]
    low, high = sorted([sign * (bar['low'] - stop), sign * (bar['high'] - stop)])
    close = sign * (bar['close'] - stop)
    states = next_bar_states(opening, high, low, close, entries, target)
    later = future_exit(index + 2, sign, stop, target)
    scenarios = []
    for mask, terminal in states:
        filled = [leg for i, leg in enumerate(legs) if mask & (1 << i)]
        outcomes = [(terminal, bar['time'])] if terminal else later
        if not filled:
            outcomes = [('unfilled', bar['time'] + 900)]
        for outcome, resolved in outcomes:
            pnl = sum(leg['riskUSD'] * leg['rewardRisk'] if outcome == 'tp'
                      else -leg['riskUSD'] if outcome == 'sl' else 0 for leg in filled)
            assert pnl >= -SETUP_RISK - EPS
            scenarios.append({'outcome': outcome, 'pnlUSD': pnl, 'fills': len(filled),
                              'mask': mask, 'resolvedAt': resolved})
    scenarios = list({(s['outcome'], s.get('mask'), s['resolvedAt']): s for s in scenarios}.values())
    worst = min(scenarios, key=lambda s: (s['pnlUSD'], s['fills']))
    best = max(scenarios, key=lambda s: (s['pnlUSD'], s['fills']))
    return {'signalUTC': record['signalUTC'], 'side': 'buy' if sign == 1 else 'sell',
            'type': record['type'], 'originalOutcome': record['outcome'],
            'originalEntry': original_entry, 'nextOpen': bar['open'], 'confirmationBody': body,
            'stopLoss': stop, 'takeProfit': target_price, 'legs': legs,
            'capAdjustedLegs': cap_adjustments, 'omittedLegs': omitted, 'overCapLegs': over_cap,
            'uncertain': abs(worst['pnlUSD'] - best['pnlUSD']) > EPS,
            'worst': worst, 'best': best, 'scenarios': scenarios}

def baseline(input_records):
    tp = sum(r['outcome'] == 'tp' for r in input_records)
    sl = sum(r['outcome'] == 'sl' for r in input_records)
    pnl = (tp - sl) * SETUP_RISK
    monthly = {}
    for r in input_records:
        if r['outcome'] not in ['tp', 'sl']:
            continue
        month = datetime.fromtimestamp(r['resolvedAt'], timezone.utc).strftime('%Y-%m')
        monthly[month] = monthly.get(month, 0) + (SETUP_RISK if r['outcome'] == 'tp' else -SETUP_RISK)
    return {'setups': len(input_records), 'tp': tp, 'sl': sl,
            'unfilledOrOther': len(input_records) - tp - sl, 'netR': tp - sl,
            'pnlUSD': pnl, 'endingBalanceUSD': STARTING_BALANCE + pnl, 'monthly': monthly}

def summarize(rows, which):
    scenarios = [r[which] for r in rows]
    pnl = sum(s['pnlUSD'] for s in scenarios)
    counts = {outcome: sum(s['outcome'] == outcome for s in scenarios)
              for outcome in ['tp', 'sl', 'unfilled', 'active', 'omitted']}
    monthly = {}
    for s in scenarios:
        if s['outcome'] not in ['tp', 'sl']:
            continue
        month = datetime.fromtimestamp(s['resolvedAt'], timezone.utc).strftime('%Y-%m')
        monthly[month] = monthly.get(month, 0) + s['pnlUSD']
    return {'setups': len(rows), **counts, 'pnlUSD': pnl, 'netSetupRiskUnits': pnl / SETUP_RISK,
            'endingBalanceUSD': STARTING_BALANCE + pnl, 'monthly': monthly,
            'filledLegs': sum(s['fills'] for s in scenarios),
            'fillCountDistribution': {str(n): sum(s['fills'] == n for s in scenarios) for n in range(4)},
            'uncertainSetups': sum(r['uncertain'] for r in rows),
            'capAdjustedLegs': sum(r['capAdjustedLegs'] for r in rows),
            'omittedLegs': sum(r['omittedLegs'] for r in rows),
            'overCapLegs': sum(r['overCapLegs'] for r in rows)}

variants = {}
all_evidence = {}
for name, cap in [('exact_10_25_50', False), ('preserve_original_risk_cap', True)]:
    evidence = [simulate(r, cap) for r in records]
    all_evidence[name] = evidence
    assert all('worst' in r and 'best' in r for r in evidence)
    variants[name] = {side: {which: summarize([r for r in evidence if side == 'all' or r['side'] == side], which)
                           for which in ['worst', 'best']}
                      for side in ['all', 'buy', 'sell']}
baseline_results = {side: baseline([r for r in records if side == 'all'
                    or (r['direction'] == 'bullish') == (side == 'buy')])
                    for side in ['all', 'buy', 'sell']}
assert baseline_results['all']['tp'] == 131 and baseline_results['all']['sl'] == 88
assert baseline_results['all']['pnlUSD'] == 2150
for name, sides in variants.items():
    for which in ['worst', 'best']:
        assert abs(sides['all'][which]['pnlUSD'] - sum(sides[side][which]['pnlUSD'] for side in ['buy', 'sell'])) < EPS
        assert abs(sum(sides['all'][which]['monthly'].values()) - sides['all'][which]['pnlUSD']) < EPS
    assert sides['all']['worst']['pnlUSD'] <= sides['all']['best']['pnlUSD'] + EPS

method = {
    'startingBalanceUSD': STARTING_BALANCE, 'fixedRiskUSDPerSetup': SETUP_RISK,
    'allocation': 'One third of the $50 setup risk per leg; size each leg from its own entry-to-SL distance. No redistribution for unfilled/omitted legs.',
    'entry': 'Next M15 open minus 10%, 25%, 50% of final confirming candle body for BUY; plus for SELL. No immediate/open entry.',
    'exits': 'Exact original archived SL and TP frozen for every leg; individual entry reward/risk therefore varies.',
    'expiry': 'Pending legs expire at the end of the immediate next M15 candle, or earlier at the first common TP/SL touch. Filled legs remain until common SL/TP.',
    'capVariants': 'Primary exact levels do not apply the old maximum price-risk cap. Sensitivity clamps pending-entry setups to an entry no worse than the original capped entry. Both retain the same fixed-dollar risk budget.',
    'intrabar': 'Enumerates all continuous event orders consistent with next-bar OHLC, including partial fills before TP. Not restricted to two monotonic OHLC paths. Later double-touch bars branch to SL and TP. Dollar range is the sum of per-setup extremes, not a confidence interval or guaranteed realizable portfolio path.',
    'costs': 'Gross USD; no spread, commission, financing, lot rounding, slippage or gap execution loss. Planned fill and exit prices assumed.',
    'portfolio': 'No compounding, no simultaneous-position or shared-margin limits; independent setup risk can overlap. Starting balance is illustrative, not the actual account balance.',
    'data': '227 matched previously qualified setups, 46 buys/181 sells; Aug 3-Nov 11, 2026; completed OANDA M15 history through Nov 13. Existing filters inherited, not recomputed at changed entry prices; not a fresh signal scan.',
    'validation': 'Prior source SHA256 hashes verified; original 131TP/88SL/$2150 baseline asserted; synthetic event-order, partial-fill, expiry and stop checks passed; side and monthly PnL reconcile; each setup planned SL loss <=$50.',
    'changes': 'Research artifacts only. No dashboard source, live settings or broker orders changed.',
}
output = {'method': method, 'baseline': baseline_results, 'variants': variants, 'evidence': all_evidence}
(ROOT / f'{STEM}.json').write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
with (ROOT / f'{STEM}-trades.csv').open('w', newline='', encoding='utf-8') as stream:
    columns = ['variant', 'signalUTC', 'side', 'type', 'originalEntry', 'nextOpen', 'entry1', 'entry2', 'entry3',
               'stopLoss', 'takeProfit', 'worstPnlUSD', 'bestPnlUSD', 'worstOutcome', 'bestOutcome',
               'worstFills', 'bestFills', 'uncertain', 'capAdjustedLegs', 'overCapLegs']
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    for name, evidence in all_evidence.items():
        for r in evidence:
            row = {k: r[k] for k in columns if k in r}
            row.update(variant=name, worstPnlUSD=r['worst']['pnlUSD'], bestPnlUSD=r['best']['pnlUSD'],
                       worstOutcome=r['worst']['outcome'], bestOutcome=r['best']['outcome'],
                       worstFills=r['worst']['fills'], bestFills=r['best']['fills'])
            row.update({f'entry{i+1}': leg['entry'] for i, leg in enumerate(r['legs'])})
            writer.writerow(row)

money = lambda n: f'{"-" if n < 0 else "+"}${abs(n):,.2f}'
lines = ['# Three pullback entries with original fixed SL and TP', '',
         'Illustrative $5,000 starting balance, fixed $50 total risk per setup, split equally by risk across 10%/25%/50% body pullback entries. Original exit prices are frozen. No compounding; gross before trading costs.', '',
         '| Side | Original single-entry PnL | Exact three-entry PnL range | Cap-preserving PnL range |',
         '|---|---:|---:|---:|']
for side in ['all', 'buy', 'sell']:
    exact, capped = variants['exact_10_25_50'][side], variants['preserve_original_risk_cap'][side]
    lines.append(f"| {side} | {money(baseline_results[side]['pnlUSD'])} | {money(exact['worst']['pnlUSD'])} to {money(exact['best']['pnlUSD'])} | {money(capped['worst']['pnlUSD'])} to {money(capped['best']['pnlUSD'])} |")
lines += ['', '## Monthly PnL by UTC exit date', '',
          '| Month | Original | Exact lower | Exact upper | Cap-preserving lower | Cap-preserving upper |',
          '|---|---:|---:|---:|---:|---:|']
for month in sorted(baseline_results['all']['monthly']):
    values = [baseline_results['all']['monthly'].get(month, 0)] + [variants[name]['all'][which]['monthly'].get(month, 0)
              for name in ['exact_10_25_50', 'preserve_original_risk_cap'] for which in ['worst', 'best']]
    lines.append('| ' + month + ' | ' + ' | '.join(money(v) for v in values) + ' |')
lines += ['', '## Fill and outcome counts', '',
          '| Variant / ordering | TP setups | SL setups | Unfilled | Filled legs | Uncertain setups | PnL | Ending illustrative balance |',
          '|---|---:|---:|---:|---:|---:|---:|---:|']
for name in variants:
    for which in ['worst', 'best']:
        s = variants[name]['all'][which]
        lines.append(f"| {name} / {which} | {s['tp']} | {s['sl']} | {s['unfilled']} | {s['filledLegs']} | {s['uncertainSetups']} | {money(s['pnlUSD'])} | ${s['endingBalanceUSD']:,.2f} |")
lines += ['', 'A TP setup may have only one or two filled entries. TP/SL counts are setup counts, not three full-size trades. Remaining legs are cancelled when the common target or stop is hit. Unfilled setups earn zero.', '',
          '## Assumptions and validation', '']
lines += [f'- **{key}:** {value}' for key, value in method.items()]
lines += ['', 'The exact-level variant may exceed the existing maximum allowed price-distance risk; this is counted in JSON/CSV. The cap-preserving variant retains that restriction, potentially putting multiple legs at the same capped entry. Neither variant changes the account risk allowance.', '',
          'The range reflects unresolved candle ordering. It is not a measured live profit or a statistically estimated future return. Dollar results scale linearly with the fixed risk budget in this cost-free model: halve all PnL for $25 risk; double it for $100 risk.', '',
          f'Reproduce: python reports/{STEM}.py', '']
(ROOT / f'{STEM}.md').write_text('\n'.join(lines), encoding='utf-8')
print(json.dumps({'baseline': baseline_results, 'variants': variants}, indent=2))
