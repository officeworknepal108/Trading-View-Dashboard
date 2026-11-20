import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BOLLINGER_M5_RULE, BOLLINGER_STUDY_DEFAULTS, bollingerChartRecord, bollingerCsv,
  bollingerMonthly, bollingerStats, type BollingerRecord, type BollingerResult } from '../services/bollingerM5';
import { loadStudyDateHistory, StudyHistoryCoverageError, type StudyCandles } from '../services/trendlineStudyHistory';
import { loadBollingerArchive, archiveCoverage, selectBollingerArchive, type BollingerArchive } from '../services/bollingerArchive';
import type { StructureCandle } from '../services/marketStructure';
import type { JournalTradeRecord } from './TradeJournal';

interface Props {
  open: boolean; enabled: boolean; showArrows: boolean; timeframe: string; symbol: string;
  candles: StudyCandles; cutoff: number;
  historySeed: StudyCandles;
  chartRef: React.RefObject<any>; seriesRef: React.RefObject<any>;
  onClose: () => void; onShowM5: () => void; onRecords: (records: JournalTradeRecord[]) => void;
}
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const date = (n: number) => new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 16);
const day = (n: number) => new Date(n * 1000).toISOString().slice(0, 10);
const button = 'rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-40';
const input = 'mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900';
const percent = (n: number | null) => n === null ? '—' : `${n.toFixed(1)}%`;

/** Uses study-only history so older trades remain inspectable outside the live chart window. */
function TradePreview({ record, candles }: { record: BollingerRecord; candles: StructureCandle[] }) {
  const entryIndex = candles.findIndex(b => b.time === record.entryAt);
  const endIndex = candles.findIndex(b => b.time + 300 >= (record.resolvedAt ?? record.entryAt));
  const start = Math.max(0, entryIndex - 8);
  const end = Math.min(candles.length, start + 120, Math.max(entryIndex + 16, endIndex + 5));
  const bars = entryIndex < 0 ? [] : candles.slice(start, end);
  if (!bars.length) return <p className="p-2 text-slate-500">Price history for this trade is unavailable. Entry, SL and TP are listed above.</p>;
  const min = Math.min(record.entry, record.stopLoss, record.takeProfit, ...bars.map(b => b.low));
  const max = Math.max(record.entry, record.stopLoss, record.takeProfit, ...bars.map(b => b.high));
  const padding = Math.max((max - min) * .12, .1), low = min - padding, high = max + padding;
  const y = (p: number) => 20 + (high - p) / (high - low) * 160;
  const slot = 490 / bars.length, x = (i: number) => 16 + (i + .5) * slot;
  return <svg viewBox="0 0 640 212" className="mt-2 w-full rounded border border-blue-100 bg-white" role="img" aria-label="Selected Bollinger trade price preview">
    {bars.map((b, i) => <g key={b.time} stroke={b.close >= b.open ? '#059669' : '#e11d48'} fill={b.close >= b.open ? '#059669' : '#e11d48'}>
      <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} strokeWidth="1" />
      <rect x={x(i) - Math.max(1, slot * .3)} y={y(Math.max(b.open, b.close))} width={Math.max(2, slot * .6)} height={Math.max(1, Math.abs(y(b.open) - y(b.close)))} />
    </g>)}
    {[[record.entry, '#2563eb', 'ENTRY'], [record.stopLoss, '#dc2626', 'SL'], [record.takeProfit, '#059669', 'TP']].map(([p, color, label]) => <g key={label}>
      <line x1="8" x2="510" y1={y(Number(p))} y2={y(Number(p))} stroke={String(color)} strokeDasharray="5 3" />
      <text x="516" y={y(Number(p)) + 4} fill={String(color)} fontSize="12">{label} {Number(p).toFixed(2)}</text>
    </g>)}
    <line x1={x(entryIndex - start)} x2={x(entryIndex - start)} y1="12" y2="184" stroke="#2563eb" strokeDasharray="2 3" />
    <text x="12" y="204" fontSize="10" fill="#64748b">{date(bars[0].time)} — {date(bars.at(-1)!.time)} · Study candles</text>
  </svg>;
}

/** Study-only history stays local. This component never dispatches trading signals. */
export function BollingerStudy(props: Props) {
  const initialEnd = day(props.cutoff > 0 ? props.cutoff : Date.now() / 1000);
  const [from, setFrom] = useState(() => day(Date.parse(initialEnd + 'T00:00:00Z') / 1000 - 104 * 86400));
  const [to, setTo] = useState(initialEnd);
  const [preset, setPreset] = useState<number | null>(105);
  const [dataSource, setDataSource] = useState<'ARCHIVE' | 'OANDA'>('ARCHIVE');
  const [archive, setArchive] = useState<BollingerArchive | null>(null);
  const [archiveError, setArchiveError] = useState('');
  const [archiveAttempt, setArchiveAttempt] = useState(0);
  const coverage = useMemo(() => archive ? archiveCoverage(archive) : null, [archive]);
  const [costs, setCosts] = useState({ ...BOLLINGER_STUDY_DEFAULTS });
  const [result, setResult] = useState<BollingerResult | null>(null);
  const [studyCandles, setStudyCandles] = useState<StructureCandle[]>([]);
  const [liveHistory, setLiveHistory] = useState<BollingerResult | null>(null);
  const [selected, setSelected] = useState<BollingerRecord | null>(null);
  const [tab, setTab] = useState<'monthly' | 'trades'>('monthly');
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('Choose a period, then press Run Study.');
  const [error, setError] = useState(''), [chartNote, setChartNote] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]), [running, setRunning] = useState(false);
  const [available, setAvailable] = useState<{ from: string; to: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const selectedPreview = useRef<HTMLDivElement | null>(null);
  const resultsPanel = useRef<HTMLDivElement | null>(null);
  const historyNotes = useRef<HTMLDetailsElement | null>(null);
  const [positions, setPositions] = useState<Array<{ record: BollingerRecord; x: number; y: number }>>([]);
  const [lines, setLines] = useState<Array<{ label: string; y: number; color: string }>>([]);
  const worker = useRef<Worker | null>(null), request = useRef<AbortController | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocus = useRef<BollingerRecord | null>(null);
  useEffect(() => {
    if (!props.open || dataSource !== 'ARCHIVE' || archive) return;
    const controller = new AbortController(); let timedOut = false;
    setArchiveError('');
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    void loadBollingerArchive(controller.signal).then(setArchive).catch(e => {
      if (!controller.signal.aborted || timedOut) setArchiveError(timedOut ? 'Loading saved prices timed out. Please retry.'
        : e instanceof Error ? e.message : 'Saved prices could not load.');
    }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [props.open, dataSource, archive, archiveAttempt]);
  useEffect(() => {
    if (dataSource !== 'ARCHIVE' || !coverage || preset === null) return;
    const end = day(Math.min(props.cutoff, coverage.through) - .001);
    setTo(end); setFrom(day(Date.parse(end + 'T00:00:00Z') / 1000 - (preset - 1) * 86400));
  }, [coverage, dataSource, preset, props.cutoff]);
  const historyKey = useMemo(() => JSON.stringify({ m5: (props.candles.M5 ?? []).map(b =>
    b.time + 300 > props.cutoff || b.complete === false ? { ...b, high: b.open, low: b.open, close: b.open, volume: 0, complete: false } : b),
    h4: (props.candles.H4 ?? []).filter(b => b.complete !== false && b.time + 14400 <= props.cutoff),
    cutoff: Math.floor(props.cutoff / 300) * 300 }), [props.candles, props.cutoff]);
  useEffect(() => {
    setLiveHistory(null); props.onRecords([]);
    if (!props.enabled || props.symbol !== 'XAUUSD') return;
    const data = JSON.parse(historyKey);
    if (!data.m5.length || !data.h4.length) return;
    const task = new Worker(new URL('../services/bollingerM5.worker.ts', import.meta.url), { type: 'module' });
    task.onmessage = (event: MessageEvent<{ result?: BollingerResult }>) => {
      if (event.data.result) { setLiveHistory(event.data.result);
        props.onRecords(event.data.result.records.flatMap(r => bollingerChartRecord(r) ?? [])); }
    };
    task.postMessage({ ...data, ...BOLLINGER_STUDY_DEFAULTS, spread: 0, commissionPerLot: 0, from: data.m5[0].time });
    return () => { task.onmessage = null; task.terminate(); };
  }, [historyKey, props.symbol, props.enabled, props.onRecords]);
  const cancel = () => {
    request.current?.abort(); request.current = null; worker.current?.terminate(); worker.current = null;
    if (watchdog.current !== null) clearTimeout(watchdog.current); watchdog.current = null; setRunning(false);
  };
  useEffect(() => () => { request.current?.abort(); worker.current?.terminate(); if (watchdog.current !== null) clearTimeout(watchdog.current); }, []);
  useEffect(() => { cancel(); setResult(null); setSelected(null); setStudyCandles([]); pendingFocus.current = null; }, [props.symbol]);
  useEffect(() => {
    if (result && props.cutoff < result.settings.cutoff) { cancel(); setResult(null); setSelected(null); pendingFocus.current = null; }
  }, [props.cutoff, result]);
  useEffect(() => {
    if (!running) return;
    const started = Date.now(); setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const period = (days: number, source = dataSource) => {
    const endTime = source === 'ARCHIVE' && coverage ? Math.min(props.cutoff, coverage.through) : props.cutoff;
    const end = day(endTime > 0 ? endTime - .001 : Date.now() / 1000);
    setTo(end); setFrom(day(Date.parse(end + 'T00:00:00Z') / 1000 - (days - 1) * 86400)); setPreset(days);
    setError(''); setAvailable(null);
  };
  const run = async (range = { from, to }) => {
    const sourceEnd = dataSource === 'ARCHIVE' && coverage ? Math.min(props.cutoff, coverage.through) : props.cutoff;
    const cutoff = Math.min(sourceEnd, Date.parse(range.to + 'T00:00:00Z') / 1000 + 86400);
    const start = Date.parse(range.from + 'T00:00:00Z') / 1000;
    setError('');
    if (dataSource === 'ARCHIVE' && !archive) { setError('Wait for the saved historical prices to load, then press Run Study.'); return; }
    if (dataSource === 'ARCHIVE' && coverage && range.to > day(coverage.through - .001)) {
      setError(`This saved dataset ends on ${day(coverage.through - .001)}. Choose that date or earlier.`); return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(cutoff) || start >= cutoff) { setError('Choose a start date before the end of your selected period.'); return; }
    if (!(costs.capital > 0) || !(costs.cashRisk > 0)) { setError('Starting balance and risk per trade must both be above $0.'); return; }
    if (!Object.values(costs).every(Number.isFinite) || costs.spread < 0 || costs.commissionPerLot < 0
      || costs.contractSize <= 0 || costs.lotStep <= 0 || costs.minimumLot <= 0) { setError('Check the values in Advanced settings. Costs cannot be negative and lot sizes must be above zero.'); return; }
    cancel(); setAvailable(null); setWarnings([]); setResult(null); setSelected(null); setPage(0); setTab('monthly'); setChartNote('');
    pendingFocus.current = null;
    setRunning(true); setStatus('Loading 5-minute and H4 price history…');
    const controller = new AbortController(); request.current = controller;
    try {
      const archived = dataSource === 'ARCHIVE' && archive ? selectBollingerArchive(archive, start, cutoff) : null;
      const loaded = archived ? { candles: archived.candles, warnings: [] as string[] }
        : await loadStudyDateHistory({ symbol: props.symbol, zoneTimeframe: 'M5',
          requiredTimeframes: ['M5', 'H4'], requestTimeoutMs: 60_000, fromTime: start, cutoff, candles: props.historySeed,
          signal: controller.signal, progress: setStatus });
      if (controller.signal.aborted || request.current !== controller) return;
      setWarnings(loaded.warnings); setStatus('Checking trades…');
      setStudyCandles((loaded.candles.M5 ?? []).filter(b => b.time < cutoff));
      const task = new Worker(new URL('../services/bollingerM5.worker.ts', import.meta.url), { type: 'module' }); worker.current = task;
      const fail = (message: string) => { if (worker.current === task) { setError(message); setStatus('Study stopped. You can try again.'); cancel(); } };
      watchdog.current = setTimeout(() => fail('The calculation took too long. Try a shorter period and run again.'), 60_000);
      task.onmessage = (event: MessageEvent<{ result?: BollingerResult; progress?: string; error?: string }>) => {
        if (worker.current !== task) return;
        if (event.data.progress) setStatus(`Checking ${event.data.progress}…`);
        if (event.data.result) { setResult(event.data.result); setStatus('Study complete.'); cancel(); }
        if (event.data.error) fail(event.data.error);
      };
      task.onerror = () => fail('The calculation could not finish. Press Run Study to try again.');
      const studied = archived?.studiedCandles ?? (loaded.candles.M5 ?? []).filter(b => b.time >= start && b.time + 300 <= cutoff && b.complete !== false).length;
      const warmup = archived?.warmupCandles ?? (loaded.candles.M5 ?? []).filter(b => b.time < start && b.complete !== false).length;
      task.postMessage({ ...costs, m5: loaded.candles.M5 ?? [], h4: loaded.candles.H4 ?? [], from: start, cutoff,
        dataSource, datasetId: archived ? archive!.id : 'OANDA', studyCandleCount: studied, warmupCandleCount: warmup });
    } catch (e) {
      if (!controller.signal.aborted && request.current === controller) {
        if (e instanceof StudyHistoryCoverageError && e.availableFrom !== undefined && e.availableTo !== undefined) {
          const alternative = { from: day(e.availableFrom), to: day(Math.min(e.availableTo, props.cutoff)) };
          setAvailable(alternative); setWarnings([e.message]);
          setError(e.message.includes('timed out') ? 'The history request timed out. Try again or run the available dates below.'
            : `The price feed cannot cover ${range.from} through ${range.to}. You can run the available dates below.`);
        } else setError(e instanceof Error ? e.message : 'Price history could not load. Try again.');
        setStatus('Study stopped. You can try again.'); cancel();
      }
    }
  };
  const records = props.open && result ? result.records : liveHistory?.records ?? [];
  const stats = result ? bollingerStats(result.records, result.settings.capital) : null;
  const monthly = result ? bollingerMonthly(result.records, result.settings.capital) : [];
  const latest = useMemo(() => [...(result?.records ?? [])].reverse(), [result]);
  useEffect(() => { if (result) resultsPanel.current?.scrollIntoView({ block: 'nearest' }); }, [result]);
  const select = (r: BollingerRecord) => { setSelected(r); setChartNote(''); selectedPreview.current?.scrollIntoView({ block: 'nearest' }); };
  useEffect(() => { if (selected) selectedPreview.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const showOnChart = (r?: BollingerRecord) => {
    setChartNote(''); pendingFocus.current = r ?? selected;
    setFocusRequest(n => n + 1);
    props.onShowM5();
    if (!r && !selected) setChartNote('5-minute chart selected. Run the Study, then choose a trade to inspect.');
  };
  useEffect(() => {
    if (props.timeframe !== 'M5' || !pendingFocus.current) return;
    const r = pendingFocus.current;
    if (!(props.candles.M5 ?? []).some(b => b.time === r.entryAt)) {
      setChartNote('This trade is older than the candles on the main chart. Use the price preview in this panel.');
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        props.chartRef.current?.timeScale().setVisibleRange({ from: r.entryAt - 4500, to: (r.resolvedAt ?? r.entryAt) + 4500 });
        pendingFocus.current = null; setChartNote('Entry, SL and TP are marked on the 5-minute chart.');
      } catch { setChartNote('The main chart is still loading. You can use the price preview in this panel.'); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [props.timeframe, props.candles, selected, focusRequest]);
  useEffect(() => {
    const chart = props.chartRef.current, series = props.seriesRef.current;
    if (!chart || !series || props.timeframe !== 'M5') { setPositions([]); setLines([]); return; }
    const update = () => {
      setPositions(props.showArrows || props.open ? records.flatMap(record => {
        const x = chart.timeScale().timeToCoordinate(record.entryAt), y = series.priceToCoordinate(record.entry);
        return x === null || y === null ? [] : [{ record, x, y }];
      }) : []);
      setLines(selected && (props.open || props.showArrows) ? [
        { label: `BB M5 ENTRY ${selected.entry.toFixed(2)}`, price: selected.entry, color: '#2563eb' },
        { label: `SL ${selected.stopLoss.toFixed(2)}`, price: selected.stopLoss, color: '#dc2626' },
        { label: `TP ${selected.takeProfit.toFixed(2)}`, price: selected.takeProfit, color: '#059669' },
      ].flatMap(l => { const y = series.priceToCoordinate(l.price); return y === null ? [] : [{ ...l, y }]; }) : []);
    };
    update(); chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    const timer = window.setInterval(update, 500);
    return () => { window.clearInterval(timer); try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(update); } catch {} };
  }, [records, selected, props.timeframe, props.showArrows, props.open]);
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([bollingerCsv(result)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'Bollinger-M5-native-study.csv'; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const changed = result && (Object.keys(costs).some(k => costs[k] !== result.settings[k])
    || from !== day(result.settings.from) || to !== day(result.settings.cutoff - .001) || dataSource !== result.settings.dataSource);
  return <>
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-label="Bollinger M5 study arrows">
      {positions.map(({ record, x, y }) => <button key={record.id} type="button" title={`Bollinger M5 study · ${record.outcome}`}
        style={{ left: x, top: y, color: record.direction === 'BUY' ? '#2563eb' : '#9333ea' }}
        className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 text-lg font-black" onClick={() => select(record)}>
        {record.direction === 'BUY' ? '▲' : '▼'}<span className="text-[8px]">BB5</span></button>)}
      {lines.map(l => <div key={l.label} className="absolute left-0 right-16 border-t border-dashed text-[10px]" style={{ top: l.y, color: l.color, borderColor: l.color }}>{l.label} · STUDY</div>)}
    </div>
    {props.open && <section className="absolute bottom-2 right-2 top-2 z-50 flex w-[min(760px,calc(100%_-_16px))] flex-col overflow-hidden rounded-xl border border-blue-200 bg-white text-sm text-slate-800 shadow-xl" aria-label="Bollinger M5 Study">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-blue-100 bg-blue-50 px-4 py-3">
        <div><h2 className="font-bold text-blue-950">Bollinger 5-minute Study</h2><p className="text-xs text-blue-700">1 entry · RR 1:1.5 · SL up to 80 pips · Simulation</p></div>
        <button className={button} aria-label="Close Bollinger M5 study" onClick={props.onClose}>Close</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-3 text-slate-600">Choose a period and press Run Study. No trading orders are sent.</p>
        <label className="mb-3 block text-xs font-semibold">Price history
          <select aria-label="Bollinger study price history" className={input} value={dataSource} disabled={running}
            onChange={e => { const source = e.target.value as typeof dataSource; setDataSource(source); setResult(null); setSelected(null); period(source === 'ARCHIVE' ? 105 : 7, source); }}>
            <option value="ARCHIVE">Saved broker history — long date ranges</option><option value="OANDA">Recent OANDA prices — limited history</option>
          </select>
        </label>
        {dataSource === 'ARCHIVE' && <div className="mb-3 rounded-md bg-blue-50 p-2 text-xs text-blue-900" aria-label="Saved history coverage">
          {coverage ? <>{coverage.m5Candles.toLocaleString()} M5 candles · {day(coverage.first)} through {day(coverage.through - .001)}<br />Saved snapshot, ending {date(coverage.through)}. These are historical broker prices.</>
            : archiveError ? <><span role="alert">{archiveError}</span> <button className="underline" onClick={() => setArchiveAttempt(n => n + 1)}>Retry</button></> : 'Loading saved historical prices…'}
        </div>}
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Bollinger study quick periods">
          {[7, 30, 90, 105].map(days => <button key={days} type="button" aria-pressed={preset === days} disabled={running}
            className={`${button} ${preset === days ? 'border-blue-600 bg-blue-100' : ''}`} onClick={() => { if (days === 105) setDataSource('ARCHIVE'); period(days, days === 105 ? 'ARCHIVE' : dataSource); }}>{days === 105 ? '3½ months (105 days)' : `Last ${days} days`}</button>)}
        </div>
        <fieldset disabled={running} className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold">From<input aria-label="Bollinger study start" className={input} type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset(null); }} /></label>
          <label className="text-xs font-semibold">Through<input aria-label="Bollinger study end" className={input} type="date" value={to} onChange={e => { setTo(e.target.value); setPreset(null); }} /></label>
          <label className="text-xs font-semibold">Starting balance ($)<input aria-label="Study starting balance" className={input} type="number" min="1" value={costs.capital} onChange={e => setCosts(c => ({ ...c, capital: Number(e.target.value) }))} /></label>
          <label className="text-xs font-semibold">Risk per trade ($)<input aria-label="Study risk per trade" className={input} type="number" min="0.01" step="any" value={costs.cashRisk} onChange={e => setCosts(c => ({ ...c, cashRisk: Number(e.target.value) }))} /></label>
        </fieldset>
        <p className="mt-2 text-xs text-slate-500">Fixed risk allowance{costs.capital > 0 && costs.cashRisk > 0 ? `: ${percent(costs.cashRisk / costs.capital * 100)} of starting balance per trade` : ''}. Lot size rounds down.</p>
        <div className="mt-3 flex gap-2">
          <button className="flex-1 rounded-md bg-blue-700 px-4 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-50" aria-label="Run Bollinger M5 study" disabled={running || props.symbol !== 'XAUUSD' || dataSource === 'ARCHIVE' && !archive} onClick={() => void run()}>{running ? 'Running…' : 'Run Study'}</button>
          {running && <button className={button} onClick={() => { cancel(); setStatus('Study cancelled. Choose a period and run again.'); }}>Cancel</button>}
        </div>
        <p role="status" aria-live="polite" className="my-3 rounded-md bg-slate-50 p-2 text-xs text-slate-600">{running ? `${status} (${elapsed}s)` : status}</p>
        {error && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {available && !running && <button className={`${button} mb-3 w-full border-blue-500 bg-blue-50`} aria-label="Run available study dates"
          onClick={() => { setFrom(available.from); setTo(available.to); setPreset(null); void run(available); }}>Run available dates: {available.from} through {available.to}</button>}
        {changed && <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800">Settings changed. Press Run Study to update these results.</p>}
        {warnings.length > 0 && <button className="mb-3 w-full rounded bg-amber-50 p-2 text-left text-xs text-amber-800" onClick={() => { if (historyNotes.current) { historyNotes.current.open = true; historyNotes.current.scrollIntoView({ block: 'nearest' }); } }}>Some history is limited. View the history notes before using these results.</button>}
        {result && stats && <div ref={resultsPanel} aria-label="Bollinger study results">
          <p className="mb-2 text-xs text-slate-500">{day(result.settings.from)} through {day(result.settings.cutoff - .001)} · Saved risk {money(result.settings.cashRisk)} · Balance {money(result.settings.capital)}</p>
          <p className="mb-3 text-xs font-semibold text-blue-800" aria-label="Study candle count">{result.settings.studyCandleCount?.toLocaleString()} complete M5 candles in selected dates · {result.settings.warmupCandleCount?.toLocaleString()} earlier candles for calculation context · {result.settings.dataSource === 'ARCHIVE' ? 'Saved broker history' : 'OANDA'}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Trades', String(stats.trades)], ['Win rate', percent(stats.winPercent)], ['Net P&L', money(stats.pnl)], ['Return', `${stats.percent.toFixed(2)}%`]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-lg font-bold tabular-nums">{value}</div></div>)}
          </div>
          <p className="my-3 text-xs"><b className="text-emerald-700">TP {stats.tp}</b> · <b className="text-red-700">SL {stats.sl}</b> · Open {stats.open} · Uncertain {stats.uncertain} · Loss {percent(stats.lossPercent)}</p>
          {stats.trades === 0 && <p className="mb-3 rounded bg-blue-50 p-3">No qualifying trades in this period. Try Last 90 days, or check the history notes below.</p>}
          <div className="mb-3 flex flex-wrap gap-2">
            <button className={button} aria-label="Show monthly study results" aria-pressed={tab === 'monthly'} onClick={() => setTab('monthly')}>Monthly results</button>
            <button className={button} aria-label="Show study trades" aria-pressed={tab === 'trades'} onClick={() => setTab('trades')}>Trades ({stats.trades})</button>
            <button className={button} onClick={download}>Export CSV</button>
          </div>
          {tab === 'monthly' ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-right text-xs" aria-label="Bollinger monthly results"><thead className="bg-slate-100"><tr>{['Month', 'Trades', 'TP', 'SL', 'Win %', 'Net P&L', 'Return %'].map(v => <th className="p-2" key={v}>{v}</th>)}</tr></thead>
            <tbody>{monthly.map(m => <tr className="border-b border-slate-100" key={m.month}><td className="p-2">{m.month}</td><td>{m.trades}</td><td>{m.tp}</td><td>{m.sl}</td><td>{percent(m.winPercent)}</td><td>{money(m.pnl)}</td><td>{m.percent.toFixed(2)}%</td></tr>)}</tbody></table><p className="mt-2 text-xs text-slate-500">Closed trades are grouped by exit month. Open and uncertain trades do not count toward realized P&L or win rate.</p></div>
            : <><p className="mb-2 text-xs text-slate-500">Choose a trade to see its price chart, entry, SL and TP below.</p>
              <div className="space-y-2" aria-label="Bollinger trade list">{latest.slice(page * 20, (page + 1) * 20).map(r => <button key={r.id} className={`flex w-full items-center justify-between rounded-md border p-3 text-left ${selected?.id === r.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`} onClick={() => select(r)}>
                <span><b className={r.direction === 'BUY' ? 'text-emerald-700' : 'text-purple-700'}>{r.direction}</b><span className="ml-2 text-xs text-slate-500">{date(r.entryAt)}</span></span><span className="text-right text-xs"><b>{r.outcome}</b><span className="ml-2">{r.pnl === undefined ? '—' : money(r.pnl)}</span></span>
              </button>)}</div>
              <div className="my-2 flex items-center justify-between text-xs"><button className={button} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1} / {Math.max(1, Math.ceil(latest.length / 20))}</span><button className={button} disabled={(page + 1) * 20 >= latest.length} onClick={() => setPage(p => p + 1)}>Next</button></div>
            </>}
          {selected && <div ref={selectedPreview} className="my-3 rounded-lg border border-blue-200 bg-blue-50 p-3" aria-label="Selected Bollinger trade">
            <div className="flex justify-between gap-2"><b>{selected.direction} · {date(selected.entryAt)}</b><button className="text-xs text-blue-800 underline" onClick={() => { setSelected(null); pendingFocus.current = null; }}>Hide trade</button></div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs"><div>Entry<br /><b>{selected.entry.toFixed(2)}</b></div><div className="text-red-700">SL<br /><b>{selected.stopLoss.toFixed(2)}</b> ({(Math.abs(selected.entry - selected.stopLoss) * 10).toFixed(1)} pips)</div><div className="text-emerald-700">TP<br /><b>{selected.takeProfit.toFixed(2)}</b></div></div>
            <TradePreview record={selected} candles={studyCandles} />
            {selected.reason && <p className="my-2 text-xs text-amber-800">{selected.reason}</p>}
            <button className={`${button} mt-2`} aria-label="Show selected trade on 5m chart" onClick={() => showOnChart(selected)}>Show on 5m chart</button>
            {chartNote && <p className="mt-2 text-xs text-blue-800" role="status">{chartNote}</p>}
          </div>}
          <p className="my-3 text-xs text-slate-500">Drawdown {money(stats.drawdown)} ({stats.drawdownPercent.toFixed(2)}%) · Net {stats.r.toFixed(2)}R. Simulation results include the saved spread and fees.</p>
          <details className="my-3 rounded border border-slate-200 p-2"><summary className="cursor-pointer text-xs font-semibold">Buy / Sell breakdown</summary>{(['BUY', 'SELL'] as const).map(side => {
            const s = bollingerStats(result.records.filter(r => r.direction === side), result.settings.capital);
            return <p key={side} className="mt-2 text-xs">{side}: {s.trades} trades · TP {s.tp} / SL {s.sl} · Win {percent(s.winPercent)} · {money(s.pnl)} ({s.percent.toFixed(2)}%) · {s.r.toFixed(2)}R</p>;
          })}</details>
        </div>}
        {!selected && props.timeframe !== 'M5' && <button className={`${button} mb-3`} onClick={() => showOnChart()}>Switch main chart to 5m</button>}
        <details className="mt-3 rounded-md border border-slate-200 p-3" aria-label="Bollinger advanced settings"><summary className="cursor-pointer text-xs font-semibold">Advanced settings</summary><fieldset disabled={running} className="mt-3 grid grid-cols-2 gap-3">
          {(['spread', 'commissionPerLot', 'contractSize', 'lotStep', 'minimumLot'] as const).map(key => <label key={key} className="text-xs">{{ spread: 'Spread (price units)', commissionPerLot: 'Round-trip fee ($/lot)', contractSize: 'Contract units/lot', lotStep: 'Lot step', minimumLot: 'Minimum lot' }[key]}<input className={input} aria-label={key} type="number" step="any" min="0" value={costs[key]} onChange={e => setCosts(c => ({ ...c, [key]: Number(e.target.value) }))} /></label>)}
        </fieldset><p className="mt-2 text-xs text-slate-500">These assumptions affect the study only. Check them against your broker before comparing with actual executions.</p></details>
        <details ref={historyNotes} className="mt-3 rounded-md border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-semibold">Rules, costs and history notes{warnings.length ? ` (${warnings.length})` : ''}</summary>
          <p className="my-2 text-xs">{BOLLINGER_M5_RULE}</p><p className="my-2 text-xs">Independent native rules; the earlier external 67.6% is not this replay’s result. Candles are assumed mid-price, with half spread each side. No slippage allowance. Both-hit candles remain uncertain. A history gap reserves occupancy until an exit boundary is observed. Fixed cash allowance; rounded lots may risk less than the allowance.</p>
          <p className="my-2 text-xs">History sources are kept separate. Saved broker history is a frozen snapshot; recent OANDA history comes from the price feed. Dates and chart times use the supplied timestamps. Verify the feed clock before comparing sessions. Targets are 1.5R before fees.</p>
          {result?.settings.dataSource === 'ARCHIVE' && archive && <p className="my-2 text-xs">Dataset {result.settings.datasetId}. {archive.timestampNote} {archive.h4Method}</p>}
          {result && <p className="my-2 text-xs">M5 coverage: {result.coverage.first ? date(result.coverage.first) : 'none'} to {result.coverage.last ? date(result.coverage.last) : 'none'}. H4 coverage: {result.coverage.h4First ? date(result.coverage.h4First) : 'none'} to {result.coverage.h4Last ? date(result.coverage.h4Last) : 'none'}. Skipped entries: {result.skipped}; candidates without H4 bias: {result.unknownBias}.</p>}
          {result && <p className="my-2 text-xs">Saved spread: {result.settings.spread} price units; round-trip fee: {money(result.settings.commissionPerLot)}/lot; contract: {result.settings.contractSize}; lot step: {result.settings.lotStep}; minimum lot: {result.settings.minimumLot}.</p>}
          {warnings.map(w => <p key={w} className="my-2 text-xs text-amber-800">{w}</p>)}
        </details>
      </div>
    </section>}
  </>;
}
