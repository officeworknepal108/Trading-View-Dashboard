import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { StructureCandle } from '../services/marketStructure';
import { studyCloseTime, STUDY_SECONDS, type StudyTimeframe } from '../services/trendlineStudy';
import { loadVolumeStudyHistory, volumeStudyCsv, volumeStudyRule, volumeStudyStats, volumeStudyMonthlyStats,
  VOLUME_STUDY_GROUPS, VOLUME_STUDY_TIMEFRAMES, VOLUME_STUDY_MAX_LOOKBACK, type VolumeStudyGroup, type VolumeStudyInput,
  type VolumeStudyRecord, type VolumeStudyResult, type VolumeStudyTimeframe, type VolumeStudyType,
} from '../services/volumeEngulfingStudy';
import { TRADE_PIP_SIZE } from '../services/tradeLevels';
import type { StudyCandles } from '../services/trendlineStudyHistory';

interface Props {
  symbol: string;
  timeframe: StudyTimeframe;
  chartCandles: StructureCandle[];
  candles: StudyCandles;
  chartRef: React.RefObject<any>;
  seriesRef: React.RefObject<any>;
  onClose: () => void;
}
const labels: Record<VolumeStudyTimeframe, string> = {
  M1: '1 minute', M5: '5 minutes', M15: '15 minutes', M30: '30 minutes',
  H1: '1 hour', H4: '4 hours', D: '1 day', W: '1 week',
};
const button = 'rounded border border-teal-300 bg-white px-2 py-1 text-xs text-teal-900 hover:bg-teal-50 disabled:opacity-50';
const date = (time?: number) => time === undefined ? '—' : new Date(time * 1000).toLocaleString();
const price = (value: number) => Number(value.toFixed(5)).toString();
const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export function VolumeEngulfingStudy(props: Props) {
  const [timeframe, setTimeframe] = useState<VolumeStudyTimeframe>('M15');
  const [biasTimeframe, setBiasTimeframe] = useState<VolumeStudyTimeframe | 'none'>('H4');
  const [h4EmaFilter, setH4EmaFilter] = useState(true);
  const [h1TrendlineFilter, setH1TrendlineFilter] = useState(true);
  const [lookback, setLookback] = useState(VOLUME_STUDY_MAX_LOOKBACK);
  const [result, setResult] = useState<VolumeStudyResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [minimized, setMinimized] = useState(false);
  const [type, setType] = useState<VolumeStudyType | 'All'>('All');
  const [group, setGroup] = useState<VolumeStudyGroup | 'All'>('All');
  const [selected, setSelected] = useState<VolumeStudyRecord | null>(null);
  const [positions, setPositions] = useState<Array<{ record: VolumeStudyRecord; x: number; y: number }>>([]);
  const worker = useRef<Worker | null>(null);
  const request = useRef<AbortController | null>(null);
  const runCutoff = useRef<number | null>(null);
  const last = props.chartCandles.at(-1);
  const cutoff = last ? last.complete === false ? last.time : studyCloseTime(last.time, props.timeframe) : 0;
  const rule = volumeStudyRule(timeframe);
  const visible = useMemo(() => (result?.records ?? []).filter(r => (type === 'All' || r.signal.type === type)
    && (group === 'All' || r.group === group)), [result, type, group]);
  const stats = volumeStudyStats(visible);
  const monthlyStats = useMemo(() => volumeStudyMonthlyStats(visible), [visible]);
  const cancel = () => {
    request.current?.abort(); request.current = null;
    worker.current?.terminate(); worker.current = null; setRunning(false);
  };
  useEffect(() => () => { request.current?.abort(); worker.current?.terminate(); }, []);
  useEffect(() => {
    cancel(); setResult(null); setSelected(null); setError(''); runCutoff.current = null;
  }, [props.symbol]);
  useEffect(() => {
    if (runCutoff.current !== null && cutoff < runCutoff.current) {
      cancel(); setResult(null); setSelected(null); runCutoff.current = null;
    }
  }, [cutoff]);

  const run = async () => {
    cancel(); setResult(null); setSelected(null); setError(''); setPositions([]);
    setType('All'); setGroup('All'); setRunning(true); setProgress('Preparing study…');
    const controller = new AbortController(); request.current = controller;
    const input: VolumeStudyInput = { symbol: props.symbol, timeframe, biasTimeframe, h4EmaFilter,
      h1TrendlineFilter, lookback, cutoff,
      candles: { ...props.candles, [props.timeframe]: props.chartCandles } };
    runCutoff.current = cutoff;
    try {
      input.candles = await loadVolumeStudyHistory(input, controller.signal, setProgress);
      if (controller.signal.aborted || request.current !== controller) return;
      const task = new Worker(new URL('../services/volumeEngulfingStudy.worker.ts', import.meta.url), { type: 'module' });
      worker.current = task;
      task.onmessage = (event: MessageEvent<{ progress?: { done: number; total: number };
        result?: VolumeStudyResult; error?: string }>) => {
        if (worker.current !== task) return;
        if (event.data.progress) setProgress(`Checking candles ${event.data.progress.done} / ${event.data.progress.total}`);
        if (event.data.result) { setResult(event.data.result); cancel(); }
        if (event.data.error) { setError(event.data.error); cancel(); }
      };
      task.onerror = () => { if (worker.current === task) { setError('The study could not finish. Try again.'); cancel(); } };
      task.postMessage(input);
    } catch (failure) {
      if (controller.signal.aborted || request.current !== controller) return;
      setError(failure instanceof Error ? failure.message : 'Could not load study history.'); cancel();
    }
  };

  useEffect(() => {
    const chart = props.chartRef.current;
    const series = props.seriesRef.current;
    if (!chart || !series || result?.settings.timeframe !== props.timeframe) { setPositions([]); return; }
    const update = () => {
      const next = visible.flatMap(record => {
        const x = chart.timeScale().timeToCoordinate(record.filledAt ?? record.levels.calculatedAt);
        const y = series.priceToCoordinate(record.levels.entry);
        return x === null || y === null ? [] : [{ record, x, y }];
      });
      setPositions(next);
    };
    update();
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    const timer = window.setInterval(update, 500);
    return () => {
      window.clearInterval(timer);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(update); } catch { /* Chart disposed. */ }
    };
  }, [visible, result, props.timeframe, props.chartCandles, props.chartRef, props.seriesRef]);

  const exportCsv = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF', volumeStudyCsv(result, visible)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `Volume-Engulfing-Study-${result.settings.symbol}-${result.settings.timeframe}.csv`;
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const select = (record: VolumeStudyRecord) => {
    setSelected(record); setMinimized(false);
    if (record.signal.timeframe === props.timeframe) {
      const width = STUDY_SECONDS[record.signal.timeframe] * 15;
      props.chartRef.current?.timeScale().setVisibleRange({ from: record.signal.time - width,
        to: (record.resolvedAt ?? record.confirmedAt) + width });
    }
  };
  const settingsChanged = result && (result.settings.timeframe !== timeframe
    || result.settings.biasTimeframe !== biasTimeframe || result.settings.lookback !== lookback
    || (result.settings.h4EmaFilter === true) !== h4EmaFilter
    || (result.settings.h1TrendlineFilter === true) !== h1TrendlineFilter);
  return <>
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-label="Volume study entries">
      {positions.map(({ record, x, y }) => <button key={record.id} type="button"
        className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 text-xl font-black ${record.signal.direction === 'bullish' ? 'text-teal-600' : 'text-orange-600'}`}
        style={{ left: x, top: y }} onClick={() => select(record)}
        title={`Volume study ${record.signal.type} · ${record.group} · ${record.outcome}`}
        aria-label={`Volume study ${record.signal.direction} ${record.signal.type}`}>
        {record.signal.direction === 'bullish' ? '▲' : '▼'}
      </button>)}
    </div>
    <section aria-label="Volume engulfing study" className="absolute bottom-8 right-3 z-50 w-[min(860px,calc(100%_-_24px))] rounded-xl border-2 border-teal-300 bg-white text-slate-800 shadow-xl">
      <header className="flex items-center justify-between gap-2 rounded-t-xl bg-teal-50 p-3">
        <strong className="text-sm text-teal-900">VOLUME ENGULFING STUDY · {props.symbol}</strong>
        <div className="flex gap-2"><button className={button} onClick={() => setMinimized(v => !v)}>{minimized ? 'Expand' : 'Minimize'}</button>
          <button className={button} onClick={props.onClose}>Close</button></div>
      </header>
      {!minimized && <div className="max-h-[65vh] space-y-3 overflow-auto p-3 text-xs">
        <p>Study T1, T2 and T3 engulfing with valid volume. T1 requires V2 &lt; V1. T2/T3 require V3 &lt; V2 and show separately whether V3 is also below V1. V1 is the first candle. T4 is excluded.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className={button} disabled={running} onClick={() => {
            setTimeframe('M15'); setBiasTimeframe('H4'); setH4EmaFilter(true);
            setH1TrendlineFilter(true); setLookback(VOLUME_STUDY_MAX_LOOKBACK);
            setType('All'); setGroup('All'); setSelected(null);
          }}>Apply M15 / H4 single-entry setup</button>
          <span>M15 · H4 bias + EMA agreement · H1 continuation/Far · 30-pip buffer · 1:1 TP</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label>Study timeframe <select aria-label="Volume study timeframe" className="rounded border p-1" value={timeframe} disabled={running}
            onChange={e => setTimeframe(e.target.value as VolumeStudyTimeframe)}>
            {VOLUME_STUDY_TIMEFRAMES.map(tf => <option key={tf} value={tf}>{labels[tf]}</option>)}
          </select></label>
          <label>Bias timeframe <select aria-label="Volume study bias timeframe" className="rounded border p-1" value={biasTimeframe} disabled={running}
            onChange={e => setBiasTimeframe(e.target.value as VolumeStudyTimeframe | 'none')}>
            <option value="none">No bias filter</option>
            {VOLUME_STUDY_TIMEFRAMES.map(tf => <option key={tf} value={tf}>{labels[tf]}</option>)}
          </select></label>
          <label>Study candles <input aria-label="Volume study lookback" type="number" min={1} max={VOLUME_STUDY_MAX_LOOKBACK} step={1}
            className="w-20 rounded border p-1" value={lookback} disabled={running}
            onChange={e => setLookback(Number(e.target.value))} /></label>
          <button className={button} disabled={running || !cutoff || !Number.isInteger(lookback) || lookback < 1 || lookback > VOLUME_STUDY_MAX_LOOKBACK}
            onClick={run}>Run study</button>
          {running && <button className={button} onClick={cancel}>Cancel</button>}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" aria-label="H4 EMA20 EMA50 agreement filter"
          checked={h4EmaFilter} disabled={running} onChange={e => setH4EmaFilter(e.target.checked)} />
          H4 EMA20/EMA50 agreement</label>
        <p className="text-slate-600">When enabled, BUY requires H4 EMA20 above EMA50; SELL requires EMA20 below EMA50. This is an additional H4 check alongside the selected structure bias. Only H4 candles already closed at confirmation count. Turn it off to compare with the original study.</p>
        <label className="flex items-center gap-2"><input type="checkbox" aria-label="H1 continuation Far trendline filter"
          checked={h1TrendlineFilter} disabled={running} onChange={e => setH1TrendlineFilter(e.target.checked)} />
          H1 continuation trendline · Far</label>
        <p className="text-slate-600">Requires a green H1 continuation line for BUY or red for SELL. At confirmation, the planned entry must be more than 0.5 × the study timeframe’s ATR14 from at least one matching line. No line touch is required. Only already-confirmed lines and closed candles count. Turn it off to compare with EMA alone.</p>
        <p className="text-slate-600">Bias uses the existing market structure trend from closed candles at each confirmation: bullish allows BUY, bearish allows SELL, neutral skips. Without a bias filter, both directions qualify.</p>
        <p className="text-slate-600">Existing engulfing confirmation and entry calculation: entry at the next candle open, or a pending entry at the existing risk cap. SL is beyond the pattern wick plus the study buffer: 10 pips for M1/M5, 30 pips for M15, 20 pips for M30 and higher. Fixed TP = 1R; no risk-free exit.</p>
        <p>SL buffer: <b>{rule.stopBufferPips}</b> · Risk cap: <b>{rule.maximumRiskPips}</b> (existing code units; buffer price distance {price(rule.stopBufferPips * TRADE_PIP_SIZE)}).
          {['H1', 'H4', 'D', 'W'].includes(timeframe) && ' Higher timeframes inherit the study M30 buffer and existing risk cap.'}</p>
        {running && <p role="status">{progress}</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {result && <>
          <p className="rounded bg-teal-50 p-2">Results: <b>{result.settings.symbol} · {labels[result.settings.timeframe]}</b> · Bias: <b>{result.settings.biasTimeframe === 'none' ? 'None' : labels[result.settings.biasTimeframe]}</b>
            {' '}· H4 EMA filter: <b>{result.settings.h4EmaFilter ? 'ON' : 'OFF'}</b>
            {' '}· H1 continuation/Far: <b>{result.settings.h1TrendlineFilter ? 'ON' : 'OFF'}</b>
            {' '}· {date(result.from)} → {date(result.to)}. {result.scanned} T1/T2/T3 patterns checked; {result.volumeRejected} rejected by volume; {result.biasRejected} rejected by bias; {result.emaRejected} rejected by EMA agreement; {result.trendlineRejected} rejected by H1 continuation/Far.
            {settingsChanged && <strong className="block text-orange-800">Settings changed. Run again to apply them.</strong>}</p>
          {result.warnings.map(warning => <p key={warning} className="text-orange-800">{warning}</p>)}
          <div className="flex flex-wrap items-center gap-3">
            <label>Type <select aria-label="Volume study type filter" className="rounded border p-1" value={type} onChange={e => { setType(e.target.value as typeof type); setSelected(null); }}>
              {['All', 'T1', 'T2', 'T3'].map(t => <option key={t}>{t}</option>)}
            </select></label>
            <label>Volume group <select aria-label="Volume study group filter" className="rounded border p-1" value={group} onChange={e => { setGroup(e.target.value as typeof group); setSelected(null); }}>
              {['All', ...VOLUME_STUDY_GROUPS].map(g => <option key={g}>{g}</option>)}
            </select></label>
            <button className={button} onClick={exportCsv} disabled={!visible.length}>Export CSV</button>
          </div>
          <p><b>{stats.total}</b> qualifying entries · <b>{stats.tp}</b> TP · <b>{stats.sl}</b> SL · Win rate <b>{stats.winRate === undefined ? '—' : `${stats.winRate.toFixed(1)}%`}</b> · Net <b>{stats.netR}R</b> · {stats.unresolved} other outcomes.</p>
          <p aria-label="Volume study dollar result">At $50 fixed risk per setup: <b>{dollars(stats.netR * 50)}</b> PnL · Balance from $5,000: <b>{dollars(5000 + stats.netR * 50)}</b>. Before costs, without compounding; TP/SL outcomes only, using the current type and volume filters. This is a study calculation.</p>
          <p className="text-slate-500">Win rate includes TP and SL only. A candle touching both SL and TP is ambiguous and excluded. Each qualifying pattern is studied independently; trades may overlap. Results use the loaded history and remain a snapshot until you run again.</p>
          <div className="overflow-x-auto"><table aria-label="Volume study comparison" className="w-full text-left">
            <thead className="bg-teal-50"><tr>{['Type', 'Volume condition', 'Entries', 'TP', 'SL', 'Win rate', 'Net R'].map(h => <th key={h} className="p-1">{h}</th>)}</tr></thead>
            <tbody>{(['T1', 'T2', 'T3'] as const).flatMap(t => (t === 'T1' ? [VOLUME_STUDY_GROUPS[0]] : VOLUME_STUDY_GROUPS.slice(1)).map(g => {
              const s = volumeStudyStats(visible.filter(r => r.signal.type === t && r.group === g));
              return <tr key={`${t}:${g}`} className="border-b"><td className="p-1">{t}</td><td>{g}</td><td>{s.total}</td><td>{s.tp}</td><td>{s.sl}</td><td>{s.winRate === undefined ? '—' : `${s.winRate.toFixed(1)}%`}</td><td>{s.netR}</td></tr>;
            }))}</tbody>
          </table></div>
          <div className="overflow-x-auto"><table aria-label="Volume study monthly results" className="w-full text-left">
            <caption className="py-2 text-left font-bold text-teal-900">Monthly results · signal month in UTC · current type and volume filters</caption>
            <thead className="bg-teal-50"><tr>{['Month', 'Entries', 'TP', 'SL', 'Other', 'Win rate', 'Net R'].map(h => <th key={h} className="p-1">{h}</th>)}</tr></thead>
            <tbody>{monthlyStats.map(m => <tr key={m.month} className="border-b"><td className="p-1">{m.month}</td><td>{m.total}</td><td>{m.tp}</td><td>{m.sl}</td><td>{m.unresolved}</td><td>{m.winRate === undefined ? '—' : `${m.winRate.toFixed(2)}%`}</td><td>{m.netR}</td></tr>)}</tbody>
          </table></div>
          <p className="text-slate-500">“V3 &lt; V2 only” means V3 ≥ V1. Missing volume is excluded. Select a journal row for details. Entry arrows appear when the chart matches the study timeframe.</p>
          <div className="max-h-60 overflow-auto"><table aria-label="Volume study journal" className="w-full min-w-[850px] text-left">
            <thead className="sticky top-0 bg-teal-50"><tr>{['Signal time', 'Type', 'Side', 'Volume condition', 'V1', 'V2', 'V3', 'Entry', 'SL', 'TP', 'Outcome'].map(h => <th key={h} className="p-1">{h}</th>)}</tr></thead>
            <tbody>{visible.map(r => <tr key={r.id} className={`border-b ${selected?.id === r.id ? 'bg-teal-100' : ''}`}>
              <td className="p-1"><button className="text-left text-teal-800 underline" onClick={() => select(r)}>{date(r.signal.time)}</button></td>
              <td>{r.signal.type}</td><td>{r.signal.direction === 'bullish' ? 'BUY' : 'SELL'}</td><td>{r.group}</td>
              <td>{r.v1 ?? '—'}</td><td>{r.v2 ?? '—'}</td><td>{r.v3 ?? '—'}</td>
              <td>{price(r.levels.entry)}</td><td>{price(r.levels.stopLoss)}</td><td>{price(r.levels.takeProfit)}</td><td>{r.outcome.toUpperCase()}</td>
            </tr>)}</tbody>
          </table></div>
          {!visible.length && <p>No qualifying entries in this selection. Try another timeframe, bias, or volume group.</p>}
          {selected && <div aria-label="Volume study entry details" className="space-y-1 rounded border border-teal-300 p-2">
            <b>{selected.signal.type} · {selected.signal.direction === 'bullish' ? 'BUY' : 'SELL'} · {selected.group}</b>
            <p>Confirmed: {date(selected.confirmedAt)} · Bias at confirmation: {selected.bias}</p>
            {selected.h4Ema && <p>H4 bar opened: {date(selected.h4Ema.time)} · EMA20: {price(selected.h4Ema.ema20)} · EMA50: {price(selected.h4Ema.ema50)}</p>}
            {selected.h1Trendline && <p>H1 continuation confirmed: {date(selected.h1Trendline.confirmedAt)} · {selected.h1Trendline.color} · Line price: {selected.h1Trendline.distance ? price(selected.h1Trendline.distance.linePrice) : '—'} · Distance: {selected.h1Trendline.distance?.pips.toFixed(2)} pips · {selected.h1Trendline.distance?.atrRatio?.toFixed(2)} × ATR · Far</p>}
            <p>V1: {selected.v1 ?? '—'} · V2: {selected.v2 ?? '—'} · V3: {selected.v3 ?? '—'}</p>
            <p>Entry {price(selected.levels.entry)} · SL {price(selected.levels.stopLoss)} · TP {price(selected.levels.takeProfit)} · RR 1:1</p>
            <p>{selected.levels.pendingAtCreation ? 'Capped pending entry' : 'Next candle open entry'} · Filled: {date(selected.filledAt)} · Resolved: {date(selected.resolvedAt)} · {selected.outcome.toUpperCase()}</p>
          </div>}
        </>}
      </div>}
    </section>
  </>;
}
