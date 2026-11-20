import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BOLLINGER_M5_RULE, BOLLINGER_STUDY_DEFAULTS, runBollingerStudy, bollingerStats,
  bollingerMonthly, bollingerCsv } from '../src/services/bollingerM5';
import type { StructureCandle } from '../src/services/marketStructure';

async function main() {
  const [m5Path, m15Path, output = 'reports/m5-bollinger-native-replay-2026-11-19', fromDate = '2026-07-10', toDate = '2026-10-27'] = process.argv.slice(2);
  if (!m5Path || !m15Path) throw new Error('Usage: npx tsx scripts/study-bollinger-m5.ts M5.json M15.json [output-prefix] [start ISO date] [end ISO date exclusive]');
  const [m5Raw, m15Raw] = await Promise.all([readFile(m5Path, 'utf8'), readFile(m15Path, 'utf8')]);
  const m5: StructureCandle[] = JSON.parse(m5Raw).bars, m15: StructureCandle[] = JSON.parse(m15Raw).bars;
  if (!Array.isArray(m5) || !Array.isArray(m15)) throw new Error('Both inputs need a bars array of OHLC candle objects.');
  const from = Date.parse(fromDate + 'T00:00:00Z') / 1000, cutoff = Date.parse(toDate + 'T00:00:00Z') / 1000;
  const groups = new Map<number, StructureCandle[]>();
  for (const b of m15) { const time = Math.floor(b.time / 14400) * 14400; groups.set(time, [...groups.get(time) ?? [], b]); }
  const h4 = [...groups].flatMap(([time, raw]) => {
    const group = [...new Map(raw.map(b => [b.time, b])).values()].sort((a, b) => a.time - b.time);
    if (group.length !== 16 || group.some((b, i) => b.time !== time + i * 900 || b.complete === false)) return [];
    return [{ time, open: group[0].open, close: group.at(-1)!.close, high: Math.max(...group.map(b => b.high)),
      low: Math.min(...group.map(b => b.low)), complete: true }];
  }).sort((a, b) => a.time - b.time);
  const result = runBollingerStudy({ ...BOLLINGER_STUDY_DEFAULTS, m5, h4, from, cutoff });
  const stats = bollingerStats(result.records, result.settings.capital), monthly = bollingerMonthly(result.records, result.settings.capital);
  const notes = [
    'Independent native replay, not a reproduction of the earlier 34-trade source-dashboard result.',
    'Frozen rules; no search or parameter optimization in this script. Not an independent out-of-sample validation.',
    'H4 bars are aggregated from 16 contiguous M15 bars on 14400-second epoch boundaries. Broker H4 chart boundaries may differ.',
    'Input timestamps are retained as supplied. ISO dates are epoch representations, not a verified broker timezone conversion.',
    'Study assumes mid-price candles, constant 0.30 price-unit spread, $7 round-trip commission per lot, contract 100, minimum/step 0.01 lot.',
    'MT5 bars may be bid-based. The mid-price assumption is a modelling limitation, not a verified bid/ask replay.',
    'Risk allowance $50 per entry, initial capital $5000, no compounding, no slippage. Lots rounded down including commission in the allowance.',
    'Uncertain/open trades do not contribute to realized P&L or win rate. Unknown exits can make realized totals incomplete.',
    'No live orders, account updates, Telegram messages or production data writes are performed.',
  ];
  const provenance = { m5Sha256: createHash('sha256').update(m5Raw).digest('hex'), m15Sha256: createHash('sha256').update(m15Raw).digest('hex'), notes };
  const dollars = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output + '.json', JSON.stringify({ provenance, rule: BOLLINGER_M5_RULE, stats, monthly, result }, null, 2) + '\n');
  await writeFile(output + '-trades.csv', bollingerCsv(result));
  await writeFile(output + '.md', `# Native Bollinger M5 replay\n\n${BOLLINGER_M5_RULE}\n\nPeriod: ${fromDate} to ${toDate} (exclusive), feed epochs.\n\n`
    + `| Trades | TP | SL | Open | Uncertain | Win rate | Realized P&L | Capital return | Net R | Cash drawdown |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`
    + `| ${stats.trades} | ${stats.tp} | ${stats.sl} | ${stats.open} | ${stats.uncertain} | ${stats.winPercent?.toFixed(1) ?? 'N/A'}% | ${dollars(stats.pnl)} | ${stats.percent.toFixed(2)}% | ${stats.r.toFixed(2)}R | ${dollars(stats.drawdown)} |\n\n`
    + '| Exit month | TP | SL | Open | Uncertain | Win rate | Realized P&L | Capital return |\n|---|---:|---:|---:|---:|---:|---:|---:|\n'
    + monthly.map(m => `| ${m.month} | ${m.tp} | ${m.sl} | ${m.open} | ${m.uncertain} | ${m.winPercent?.toFixed(1) ?? 'N/A'}% | ${dollars(m.pnl)} | ${m.percent.toFixed(2)}% |`).join('\n')
    + '\n\n' + notes.map(n => '- ' + n).join('\n') + '\n');
  console.log(JSON.stringify({ stats, monthly, output }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
