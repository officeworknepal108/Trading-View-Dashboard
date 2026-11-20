import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseBollingerArchive, archiveCoverage, type BollingerArchive } from '../src/services/bollingerArchive';
import type { StructureCandle } from '../src/services/marketStructure';

async function main() {
  const [m5Path, m15Path, output = 'src/studyAssets/bollingerBrokerHistory.json'] = process.argv.slice(2);
  if (!m5Path || !m15Path) throw new Error('Usage: npx tsx scripts/import-bollinger-history.ts M5.json M15.json [output.json]');
  const [m5Text, m15Text] = await Promise.all([readFile(m5Path, 'utf8'), readFile(m15Path, 'utf8')]);
  const m5Raw = JSON.parse(m5Text), m15Raw = JSON.parse(m15Text);
  if (m5Raw.metadata?.timeframe !== 'M5' || m15Raw.metadata?.timeframe !== 'M15'
    || !/XAUUSD|GOLD/i.test(String(m5Raw.metadata?.symbol ?? ''))) throw new Error('Use XAUUSD/Gold M5 and M15 broker snapshots.');
  if (m5Raw.metadata?.symbol !== m15Raw.metadata?.symbol) throw new Error('M5 and M15 snapshots must use the same broker symbol.');
  const clean = (raw: any[]): StructureCandle[] => [...new Map(raw.map(b => [Number(b.time), {
    time: Number(b.time), open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close),
    volume: Number(b.tick_volume ?? b.volume ?? 0), complete: b.complete !== false,
  }])).values()].sort((a, b) => a.time - b.time);
  const m5 = clean(m5Raw.bars), m15 = clean(m15Raw.bars);
  // A rate export's final candle may still have been forming. Do not invent its close.
  m5.at(-1)!.complete = false;
  const through = m5.at(-1)!.time;
  const groups = new Map<number, StructureCandle[]>();
  for (const b of m15) { const t = Math.floor(b.time / 14400) * 14400; groups.set(t, [...groups.get(t) ?? [], b]); }
  const h4 = [...groups].flatMap(([time, bars]) => bars.length === 16 && time + 14400 <= through
    && bars.every((b, i) => b.complete !== false && b.time === time + i * 900)
    ? [{ time, open: bars[0].open, high: Math.max(...bars.map(b => b.high)), low: Math.min(...bars.map(b => b.low)),
      close: bars.at(-1)!.close, volume: bars.reduce((s, b) => s + (b.volume ?? 0), 0), complete: true }] : []);
  const savedOn = new Date(through * 1000).toISOString().slice(0, 10);
  const a: BollingerArchive = parseBollingerArchive({ version: 1, id: `gold-broker-${savedOn}`, symbol: 'XAUUSD',
    label: 'Saved broker history', savedOn,
    timestampNote: 'Broker candle timestamps and OHLC are retained as supplied; no verified timezone conversion. Broker rate bars may be bid-based; the study uses its stated spread model.',
    h4Method: 'H4 aggregated from 16 contiguous M15 bars on 14400-second epoch boundaries. Broker-native H4 boundaries may differ.',
    sourceHashes: { m5: createHash('sha256').update(m5Text).digest('hex'), m15: createHash('sha256').update(m15Text).digest('hex') },
    candles: { M5: m5, H4: h4 } });
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(a) + '\n');
  console.log(JSON.stringify({ output, ...archiveCoverage(a) }, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
