import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { StructureCandle } from '../services/marketStructure';
import type { TradeTimeframe } from '../services/tradeLevels';
import { userStorage } from '../services/userStorage';
import { readStudySnapshot, studyAccuracy, studyCloseTime, studyJournalCsv, studyLookbackWindow,
  studyDateWindow, studyLocalDateStart, studyLocalDateValue, STUDY_MAX_LOOKBACK,
  studyTimeframes, studyEntryTimeframes, studyTrendlineBreakdown, filterStudyTrendlineType,
  studyDistanceBreakdown, filterStudyDistance, studyRecordDistanceBand, STUDY_DISTANCE_BANDS, type StudyDistanceBand,
  type StudyTimeframe, type TrendlineStudyInput, type TrendlineStudyRecord, type EntryArrowStudyEntry,
  type TrendlineStudyResult, type StudySnapshot, type StudySupport, type StudyTrendlineType } from '../services/trendlineStudy';
import { loadStudyDateHistory, mergeStudyCandles, type StudyCandles } from '../services/trendlineStudyHistory';

interface Props {
  symbol: string;
  pipSize: number;
  timeframe: StudyTimeframe;
  chartCandles: StructureCandle[];
  candles: Partial<Record<StudyTimeframe, StructureCandle[]>>;
  tradingTimeEnabled: boolean;
  entryArrows: EntryArrowStudyEntry[];
  chartRef: React.RefObject<any>;
  seriesRef: React.RefObject<any>;
  hostRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}
const when = (time?: number) => time === undefined ? '—' : new Date(time * 1000).toLocaleString();
const number = (value?: number) => value === undefined ? '—' : value.toFixed(2);
const button = 'rounded border border-violet-200 bg-white px-2 py-1 text-xs text-violet-900 hover:bg-violet-50 disabled:opacity-50';
const timeframeLabels: Record<StudyTimeframe, string> = {
  M1: '1m', M5: '5m', M15: '15m', M30: '30m', H1: '1H', H4: '4H', D: '1D', W: '1W', MO: '1 month',
};
const supportLabel = (support: StudySupport) => `${timeframeLabels[support.timeframe]} · ${support.color === 'green' ? 'Green' : 'Red'} · ${support.kind === 'continuation' ? 'Continuation' : 'Breakout'} · ${support.distance ? `${support.distance.pips.toFixed(2)} pips · ${support.distance.band}` : 'Distance unknown'}`;
const supportLabels = (support: StudySupport[]) => [...new Set(support.map(supportLabel))];
const nearestDistance = (record: TrendlineStudyRecord) => {
  const pips = record.support.flatMap(s => s.distance ? [s.distance.pips] : []);
  return `${pips.length ? `${Math.min(...pips).toFixed(2)} pips · ` : ''}${studyRecordDistanceBand(record)}`;
};
const groupLabels = { 'With FIB': 'FIB + trendline', 'No FIB': 'Trendline without FIB', 'FIB only': 'FIB only — no matching trendline',
  'No recorded support': 'No recorded FIB or trendline' };

export function TrendlineStudy(props: Props) {
  const [source, setSource] = useState<'arrows' | 'historical'>('arrows');
  const defaultTf = ['M1', 'M5', 'M15', 'H1'].includes(props.timeframe) ? props.timeframe as TradeTimeframe : 'M15';
  const [zoneTf, setZoneTf] = useState<TradeTimeframe>(defaultTf);
  const [lookback, setLookback] = useState(STUDY_MAX_LOOKBACK);
  const [rangeMode, setRangeMode] = useState<'bars' | 'date'>('bars');
  const [startDate, setStartDate] = useState('');
  const [history, setHistory] = useState<StudyCandles>({});
  const [result, setResult] = useState<TrendlineStudyResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const [minimized, setMinimized] = useState(false);
  const [group, setGroup] = useState('All');
  const [trendlineType, setTrendlineType] = useState<StudyTrendlineType>('all');
  const [distanceFilter, setDistanceFilter] = useState<StudyDistanceBand | 'All'>('All');
  const [breakdownKey, setBreakdownKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<TrendlineStudyRecord | null>(null);
  const [positions, setPositions] = useState<Array<{ record: TrendlineStudyRecord; x: number; y: number }>>([]);
  const worker = useRef<Worker | null>(null);
  const journalRef = useRef<HTMLDivElement | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const completedInput = useRef<(Pick<TrendlineStudyInput, 'cutoff' | 'tradingTimeEnabled'>) | null>(null);
  const restoredKey = useRef('');
  const storageKey = `trendline-study-journal-v3:${props.symbol}`;
  const last = props.chartCandles.at(-1);
  const cutoff = last ? last.complete === false ? last.time : studyCloseTime(last.time, props.timeframe) : 0;
  const fromTime = rangeMode === 'date' ? studyLocalDateStart(startDate) : undefined;
  const validDate = rangeMode !== 'date' || fromTime !== undefined && fromTime < cutoff;
  const studyCandles = useMemo(() => {
    const next: StudyCandles = {};
    for (const tf of studyTimeframes(zoneTf)) {
      next[tf] = mergeStudyCandles(history[tf] ?? [],
        tf === props.timeframe ? props.chartCandles : props.candles[tf] ?? []);
    }
    return next;
  }, [props.candles, props.chartCandles, props.timeframe, history, zoneTf]);
  const preview = useMemo(() => studyLookbackWindow(
    studyCandles[zoneTf] ?? [],
    zoneTf, cutoff, lookback,
  ), [zoneTf, studyCandles, cutoff, lookback]);
  const datePreview = useMemo(() => fromTime === undefined ? undefined
    : studyDateWindow(studyCandles[zoneTf] ?? [], zoneTf, cutoff, fromTime),
  [fromTime, studyCandles, zoneTf, cutoff]);
  const typeRecords = useMemo(() => filterStudyTrendlineType(result?.records ?? [], trendlineType), [result, trendlineType]);
  const distanceRecords = useMemo(() => filterStudyDistance(typeRecords, distanceFilter), [typeRecords, distanceFilter]);
  const groupRecords = useMemo(() => distanceRecords.filter(r => group === 'All' || r.fibGroup === group), [distanceRecords, group]);
  const breakdown = useMemo(() => studyTrendlineBreakdown(groupRecords), [groupRecords]);
  const distanceSummary = useMemo(() => studyDistanceBreakdown(groupRecords), [groupRecords]);
  const distanceByTimeframe = useMemo(() => studyDistanceBreakdown(groupRecords, true), [groupRecords]);
  const selectedBreakdown = breakdown.find(row => row.key === breakdownKey);
  const visible = useMemo(() => {
    if (!selectedBreakdown) return groupRecords;
    const ids = new Set(selectedBreakdown.recordIds);
    return groupRecords.filter(r => ids.has(r.id));
  }, [groupRecords, selectedBreakdown]);

  const cancel = () => {
    historyRequest.current?.abort(); historyRequest.current = null;
    worker.current?.terminate(); worker.current = null; setRunning(false);
  };
  useEffect(() => () => { historyRequest.current?.abort(); worker.current?.terminate(); }, []);
  // Never carry one symbol's study or a future replay result onto another chart.
  useEffect(() => {
    cancel(); setResult(null); setSelected(null); setError(''); setStorageNotice(''); completedInput.current = null;
    setBreakdownKey(null);
    setDistanceFilter('All');
    setHistory({});
    restoredKey.current = '';
  }, [props.symbol]);
  useEffect(() => {
    if (source === 'arrows' || !cutoff || restoredKey.current === storageKey) return;
    restoredKey.current = storageKey;
    try {
      const saved = readStudySnapshot(userStorage.getItem(storageKey), props.symbol);
      if (saved && saved.result.to <= cutoff) {
        setZoneTf(saved.zoneTimeframe); setLookback(saved.lookback); setResult(saved.result);
        setRangeMode(saved.fromTime === undefined ? 'bars' : 'date');
        setStartDate(saved.fromTime === undefined ? '' : studyLocalDateValue(saved.fromTime));
        completedInput.current = { cutoff: saved.result.to, tradingTimeEnabled: saved.tradingTimeEnabled };
        setStorageNotice('Restored your last saved study journal on this browser.');
      }
    } catch { setStorageNotice('Browser storage is unavailable. Export the journal to keep a copy.'); }
  }, [cutoff, storageKey, props.symbol, source]);
  useEffect(() => {
    if (completedInput.current && completedInput.current.cutoff > cutoff) {
      cancel(); setResult(null); setSelected(null); completedInput.current = null;
    }
  }, [cutoff]);

  const run = async () => {
    cancel(); setError(''); setResult(null); setSelected(null); setStorageNotice(''); setProgress('Preparing candles…');
    setBreakdownKey(null);
    if (source === 'arrows') {
      const task = new Worker(new URL('../services/trendlineStudy.worker.ts', import.meta.url), { type: 'module' });
      worker.current = task; setRunning(true);
      completedInput.current = { cutoff, tradingTimeEnabled: props.tradingTimeEnabled };
      task.onmessage = event => {
        if (worker.current !== task) return;
        if (event.data.progress) setProgress(`Reading entry arrows ${event.data.progress.done} / ${event.data.progress.total}`);
        if (event.data.result) {
          setResult(event.data.result); cancel();
          setStorageNotice('Entry-arrow snapshot captured. Export the journal to keep this copy; capture again to update it.');
        }
        if (event.data.error) { setError(event.data.error); cancel(); }
      };
      task.onerror = () => { setError('Could not read the entry arrows. Try again.'); cancel(); };
      task.postMessage({ kind: 'entry-arrows', symbol: props.symbol, pipSize: props.pipSize, cutoff,
        entries: props.entryArrows, candles: { ...props.candles, [props.timeframe]: props.chartCandles } });
      return;
    }
    if (!validDate) { setError('Choose a valid start date before the study end time.'); return; }
    if (!studyEntryTimeframes(props.symbol, zoneTf).length) {
      setError(`No existing engulfing entry SL/TP rule uses ${timeframeLabels[zoneTf]} zones with confirmations at that timeframe or higher.${props.symbol === 'XAUUSD' ? ' Select M15 for this Gold study.' : ''}`);
      return;
    }
    const request = new AbortController();
    historyRequest.current = request;
    setRunning(true);
    const input: TrendlineStudyInput = { symbol: props.symbol, pipSize: props.pipSize,
      zoneTimeframe: zoneTf, candles: studyCandles,
      cutoff, lookback, tradingTimeEnabled: props.tradingTimeEnabled,
      ...(rangeMode === 'date' ? { fromTime } : {}) };
    completedInput.current = { cutoff, tradingTimeEnabled: input.tradingTimeEnabled };
    try {
      if (input.fromTime !== undefined) {
        const loaded = await loadStudyDateHistory({ symbol: input.symbol, zoneTimeframe: input.zoneTimeframe,
          fromTime: input.fromTime, cutoff: input.cutoff, candles: input.candles,
          signal: request.signal, progress: setProgress });
        if (request.signal.aborted || historyRequest.current !== request) return;
        input.candles = loaded.candles;
        input.historyWarnings = loaded.warnings;
        setHistory(loaded.candles);
      }
      if (request.signal.aborted || historyRequest.current !== request) return;
      setProgress('Preparing entry calculations…');
      const task = new Worker(new URL('../services/trendlineStudy.worker.ts', import.meta.url), { type: 'module' });
      worker.current = task;
      setRunning(true);
      task.onmessage = event => {
        if (worker.current !== task) return;
        if (event.data.progress) setProgress(`Checking engulfing ${event.data.progress.done} / ${event.data.progress.total}`);
        if (event.data.result) {
          setResult(event.data.result); cancel();
          const saved: StudySnapshot = { version: 3, symbol: input.symbol, zoneTimeframe: input.zoneTimeframe,
            lookback: input.lookback, tradingTimeEnabled: input.tradingTimeEnabled, result: event.data.result,
            ...(input.fromTime === undefined ? {} : { fromTime: input.fromTime }) };
          try {
            userStorage.setItem(storageKey, JSON.stringify(saved));
            setStorageNotice('Study journal saved for your account on this browser.');
          } catch { setStorageNotice('Browser storage is full or unavailable. Export the journal to keep a copy.'); }
        }
        if (event.data.error) { setError(event.data.error); cancel(); }
      };
      task.onerror = () => { setError('The study could not finish. Try fewer bars.'); cancel(); };
      task.postMessage(input);
    } catch (failure) {
      if (request.signal.aborted || historyRequest.current !== request) return;
      setError(failure instanceof Error ? failure.message : 'The study could not start.'); cancel();
    }
  };

  useEffect(() => {
    let frame = 0;
    let previous: string | null = null;
    let lastDraw = 0;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - lastDraw < 100) return;
      lastDraw = time;
      const chart = props.chartRef.current;
      const series = props.seriesRef.current;
      const host = props.hostRef.current;
      const next: typeof positions = [];
      if (chart && series && host) {
        for (const record of visible) {
          const entryTime = record.filledAt ?? record.levels.calculatedAt;
          // Lower-timeframe entries belong to the containing displayed chart bar.
          const candle = [...props.chartCandles].reverse().find(c => c.time <= entryTime);
          if (!candle || entryTime >= studyCloseTime(candle.time, props.timeframe)) continue;
          const x = chart.timeScale().timeToCoordinate(candle.time);
          const y = series.priceToCoordinate(record.levels.entry);
          if (x !== null && y !== null && x >= 0 && x < host.clientWidth - 70 && y >= 0 && y < host.clientHeight) {
            next.push({ record, x, y });
          }
        }
      }
      const signature = next.map(p => `${p.record.id}:${p.x.toFixed(1)}:${p.y.toFixed(1)}`).join('|');
      if (signature !== previous) { previous = signature; setPositions(next); }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [visible, props.chartCandles, props.timeframe, props.chartRef, props.seriesRef, props.hostRef]);

  const exportJournal = () => {
    const blob = new Blob(['\uFEFF', studyJournalCsv(visible)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = source === 'arrows' ? `Entry-Arrow-Trendline-Study-${props.symbol}.csv`
      : `Trendline-Study-${props.symbol}-${zoneTf}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-label="Trendline study arrows">
      {positions.map(({ record, x, y }, index) => <button key={record.id} type="button"
        aria-label={`Trendline study ${record.signal.direction === 'bullish' ? 'buy' : 'sell'} ${record.fibGroup} ${record.zoneName}`}
        title={`${groupLabels[record.fibGroup]} · ${record.zoneName} · ${record.outcome}\n${supportLabels(record.support).join('\n') || 'No matching trendline'}\nClick for details`}
        onClick={() => { setSelected(record); setMinimized(false); }}
        className="pointer-events-auto absolute rounded border-2 border-white px-1 text-xs font-black shadow"
        style={{ left: x, top: y, transform: `translate(-50%, ${record.signal.direction === 'bullish' ? '8px' : '-110%'})`,
          background: record.fibGroup === 'No recorded support' ? '#64748b' : record.fibGroup === 'FIB only' ? '#b45309' : record.fibGroup === 'With FIB' ? '#7c3aed' : '#0284c7', color: 'white', zIndex: index }}>
        {record.signal.direction === 'bullish' ? '⬆' : '⬇'} {record.fibGroup === 'No recorded support' ? 'NO TL' : record.fibGroup === 'FIB only' ? 'FIB ONLY' : `TL ${record.fibGroup === 'With FIB' ? 'F' : 'N'}`}
      </button>)}
    </div>
    <section aria-label="Trendline study" className="absolute bottom-8 right-3 z-50 w-[min(760px,calc(100%_-_24px))] rounded-xl border-2 border-violet-200 bg-white text-slate-800 shadow-xl">
      <div className="flex items-center justify-between gap-2 border-b border-violet-100 bg-violet-50 px-3 py-2">
        <strong className="text-sm text-violet-900">TRENDLINE STUDY · {props.symbol}</strong>
        <div className="flex gap-2"><button type="button" className={button} onClick={() => setMinimized(v => !v)}>{minimized ? 'Expand' : 'Minimize'}</button>
          <button type="button" className={button} onClick={props.onClose}>Close</button></div>
      </div>
      {!minimized && <div className="max-h-[min(65vh,560px)] space-y-3 overflow-auto p-3 text-xs">
        <label>Study data<select aria-label="Study data source" className="ml-2 rounded border p-1" value={source}
          onChange={e => {
            cancel(); setSource(e.target.value as 'arrows' | 'historical'); setResult(null); setSelected(null);
            setError(''); setStorageNotice(''); setGroup('All'); setTrendlineType('all'); setDistanceFilter('All'); setBreakdownKey(null);
            completedInput.current = null; restoredKey.current = '';
          }}>
          <option value="arrows">Entry arrow details</option><option value="historical">Historical candle study</option>
        </select></label>
        <p>{source === 'arrows'
          ? `Study the ${props.entryArrows.length} entry-arrow trades currently included by the chart and its trade filters. Entry, SL, TP and results are copied directly from the arrows. Includes scalping and MTF entries, and entries without matching support. Capture again after changing chart filters or loading more history.`
          : 'Compare zone + engulfing entries with FIB and trendline, trendline without FIB, or FIB without a matching trendline.'}
          {' '}Trendline support means green for BUY or red for SELL on the zone timeframe or higher at confirmation. Both continuation and breakout lines count; no line touch is required.</p>
        <div className="flex flex-wrap items-end gap-2">
          {source === 'historical' && <>
          <label>Zone timeframe<select aria-label="Study zone timeframe" className="ml-2 rounded border p-1" value={zoneTf}
            disabled={running} onChange={e => { setZoneTf(e.target.value as TradeTimeframe); setResult(null); setSelected(null); }}>
            {(['M1', 'M5', 'M15', 'H1'] as const).map(tf => <option key={tf}>{tf}</option>)}
          </select></label>
          <label>Study range<select aria-label="Study range mode" className="ml-2 rounded border p-1" value={rangeMode}
            disabled={running} onChange={e => {
              const mode = e.target.value as 'bars' | 'date';
              setRangeMode(mode); setResult(null); setSelected(null); setError('');
              if (mode === 'date' && !startDate && cutoff) setStartDate(studyLocalDateValue(preview.from ?? cutoff));
            }}><option value="bars">Recent bars</option><option value="date">From date</option></select></label>
          {rangeMode === 'bars' ? <label>Recent zone bars<select aria-label="Study lookback" className="ml-2 rounded border p-1" value={lookback}
            disabled={running} onChange={e => { setLookback(Number(e.target.value)); setResult(null); setSelected(null); }}>
            {[50, 100, 200, 500, 1000, STUDY_MAX_LOOKBACK].map(n => <option key={n}>{n}</option>)}
          </select></label> : <label>Study from date<input type="date" aria-label="Study from date"
            className="ml-2 rounded border p-1" value={startDate} max={cutoff ? studyLocalDateValue(cutoff) : undefined}
            disabled={running} onChange={e => { setStartDate(e.target.value); setResult(null); setSelected(null); setError(''); }} /></label>}
          </>}
          <button type="button" className={button} disabled={running || !cutoff || (source === 'arrows'
            ? !props.entryArrows.length : !validDate || rangeMode === 'bars' && !preview.bars)}
            onClick={() => void run()}>{source === 'arrows' ? 'Capture entry arrows' : 'Run study'}</button>
          {running && <button type="button" className={button} onClick={cancel}>Cancel</button>}
          <label>Trendline type<select aria-label="Study trendline type" className="ml-2 rounded border p-1" value={trendlineType}
            onChange={e => {
              const kind = e.target.value as StudyTrendlineType;
              setTrendlineType(kind); setSelected(null); setBreakdownKey(null);
              if (kind !== 'all' && (group === 'FIB only' || group === 'No recorded support')) setGroup('All');
            }}>
            <option value="all">All</option><option value="continuation">Continuation</option><option value="breakout">Breakout</option>
          </select></label>
          <label>FIB group<select aria-label="Study FIB filter" className="ml-2 rounded border p-1" value={group} onChange={e => { setGroup(e.target.value); setSelected(null); setBreakdownKey(null); }}>
            <option value="All">All</option>{(['With FIB', 'No FIB', 'FIB only',
              ...(source === 'arrows' ? ['No recorded support' as const] : [])] as const).map(g => <option key={g} value={g}
              disabled={(g === 'FIB only' || g === 'No recorded support') && trendlineType !== 'all'}>{groupLabels[g]}</option>)}
          </select></label>
          <label>Entry distance<select aria-label="Study entry distance filter" className="ml-2 rounded border p-1" value={distanceFilter}
            onChange={e => { setDistanceFilter(e.target.value as StudyDistanceBand | 'All'); setSelected(null); setBreakdownKey(null); }}>
            <option value="All">All distances</option>{STUDY_DISTANCE_BANDS.map(band => <option key={band}>{band}</option>)}
          </select></label>
          <button type="button" className={button} disabled={!visible.length} onClick={exportJournal}>Export study journal</button>
        </div>
        <p aria-label="Study trendline type filter description" className="text-slate-500">
          {trendlineType === 'all' ? 'Showing all trendline types, including the FIB-only comparison.'
            : `Showing recorded entries with ${trendlineType} support. Choose All to see FIB-only entries, which have no matching trendline.`}
          {' '}The filter updates accuracy, journal, arrows and export. Trades supported by both types count once in each selection.
          {result ? ` ${typeRecords.length} of ${result.records.length} captured entries match this type selection.` : ''}
        </p>
        {source === 'historical' && <><div aria-label="Selected study date range" className="space-y-1 rounded border border-violet-200 bg-violet-50 p-2">
          {rangeMode === 'date' ? datePreview && validDate ? <>
            <p className="font-semibold">Study starts: <time dateTime={new Date(datePreview.from * 1000).toISOString()}>{when(datePreview.from)}</time></p>
            <p>Study ends: <time dateTime={new Date(datePreview.to * 1000).toISOString()}>{when(datePreview.to)}</time> · Your local time</p>
            <p>{datePreview.bars.toLocaleString()} completed {timeframeLabels[zoneTf]} bars currently loaded in this period. Older history will be loaded when needed.</p>
            <p>From-date studies include the whole available period through the latest completed chart candles. The 2,000-bar limit applies to Recent bars only.</p>
          </> : <p>Choose a valid start date before the study end time.</p> : preview.from !== undefined ? <>
            <p className="font-semibold">Study starts: <time dateTime={new Date(preview.from * 1000).toISOString()}>{when(preview.from)}</time></p>
            <p>Study ends: <time dateTime={new Date(preview.to * 1000).toISOString()}>{when(preview.to)}</time> · Your local time</p>
            <p>Using {preview.bars.toLocaleString()} of {preview.requested.toLocaleString()} requested completed {timeframeLabels[zoneTf]} bars.
              {preview.bars < preview.requested ? ' More candle history is needed for the full selection.' : ''}</p>
          </> : <p>Waiting for completed {timeframeLabels[zoneTf]} candle history to show the study start date.</p>}
        </div>
        <p className="text-slate-500">Study timeframes: {studyTimeframes(zoneTf).map(tf => timeframeLabels[tf]).join(', ')}. Entry confirmations and trendline evidence use the selected timeframe or higher. Each journal row lists the supporting timeframe and type.</p>
        <p className="text-slate-500">Candle entry routes use the existing buffers, capped pending entries and RR. Gold keeps its fixed SL/TP. This study excludes lower-timeframe scalping and CHoCH-only entries. Trading-time filter for this {result ? 'snapshot' : 'run'}: {(result ? completedInput.current?.tradingTimeEnabled : props.tradingTimeEnabled) ? 'ON' : 'OFF'}.</p></>}
        {running && <p role="status">{progress}</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {storageNotice && <p className="text-slate-500">{storageNotice}</p>}
        {result && <>
          <p>{when(result.from)} → {when(result.to)} · {result.scanned} {source === 'arrows' ? 'entry arrows read' : 'engulfing patterns checked'} · {result.records.length} study entries. Snapshot as of this run; run again for updated results.</p>
          {!!result.missingTimeframes.length && <p className="text-amber-700">Insufficient history: {result.missingTimeframes.join(', ')}.
            {source === 'arrows' ? ' Some entries lack enough history to assess these trend lines. Their recorded prices and results are still included; no match does not prove there was no support.'
              : ' Signals requiring unavailable data cannot be assessed. Accuracy covers loaded candles only.'}</p>}
          {!!result.historyWarnings?.length && <div className="text-amber-700" role="status"><p>Historical coverage notes:</p>
            <ul className="list-inside list-disc">{result.historyWarnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
          <div className="overflow-x-auto"><table aria-label="Trendline group accuracy" className="w-full text-left"><thead className="bg-violet-50"><tr>
            {['Group', 'Entries', 'Done', 'TP', 'SL', 'RF', 'Open', 'Unclear', 'Cancelled', 'TP %', 'Total R', 'Avg R'].map(h => <th key={h} className="px-2 py-1">{h}</th>)}
          </tr></thead><tbody>{(['With FIB', 'No FIB', ...(trendlineType === 'all' ? ['FIB only' as const,
            ...(source === 'arrows' ? ['No recorded support' as const] : [])] : []), 'All'] as const).map(g => {
            const stats = studyAccuracy(distanceRecords.filter(r => g === 'All' || r.fibGroup === g));
            return <tr key={g} className="border-b"><th className="px-2 py-1">{g === 'All' ? 'All' : groupLabels[g]}</th>
              {[stats.total, stats.completed, stats.tp, stats.sl, stats.rf, stats.pending, stats.ambiguous,
                stats.cancelled, stats.accuracy === undefined ? '—' : `${stats.accuracy.toFixed(1)}%`,
                number(stats.totalR), number(stats.averageR)].map((v, i) => <td key={i} className="px-2 py-1">{v}</td>)}
            </tr>;
          })}</tbody></table></div>
          <p className="text-slate-500">TP % = TP ÷ (TP + SL + RF). Open, pending, cancelled and ambiguous candles are excluded. R is theoretical, before fees and slippage.
            {source === 'arrows' ? ' Each arrow ID counts once. Open positions that have reached RF remain open until a final result is recorded. R uses the full target ratio; partial exits and actual broker profit are not inferred.'
              : ' One entry per zone within the chosen sample; historical broker positions are not reconstructed.'}</p>
          <section aria-label="Trendline timeframe and type accuracy" className="space-y-2 rounded border border-violet-200 p-2">
            <h3 className="font-bold text-violet-900">Accuracy by trendline timeframe and type</h3>
            <p>Compare continuation and breakout support at each timeframe, with and without FIB. This table follows the FIB and trendline-type filters above.</p>
            <div className="max-h-64 overflow-auto"><table aria-label="Trendline timeframe breakdown" className="w-full min-w-[1050px] text-left">
              <thead className="sticky top-0 bg-violet-50"><tr>{['Trendline TF', 'Type', 'Group', 'Entries', 'Done', 'TP', 'SL', 'RF', 'Open', 'Unclear', 'Cancelled', 'TP %', 'Avg R', 'Details'].map(h => <th key={h} className="p-1">{h}</th>)}</tr></thead>
              <tbody>{breakdown.map(row => <tr key={row.key} className={`border-b ${row.key === breakdownKey ? 'bg-violet-100' : ''}`}>
                <th scope="row" className="whitespace-nowrap p-1">{row.timeframe ? timeframeLabels[row.timeframe] : 'None'}</th>
                <td className="p-1">{row.kind ? row.kind === 'continuation' ? 'Continuation' : 'Breakout' : 'No matching trendline'}</td>
                <td className="p-1">{groupLabels[row.fibGroup]}</td>
                {[row.stats.total, row.stats.completed, row.stats.tp, row.stats.sl, row.stats.rf, row.stats.pending,
                  row.stats.ambiguous, row.stats.cancelled, row.stats.accuracy === undefined ? '—' : `${row.stats.accuracy.toFixed(1)}%`,
                  number(row.stats.averageR)].map((value, i) => <td key={i} className="p-1">{value}</td>)}
                <td className="p-1"><button type="button" className={button} aria-pressed={row.key === breakdownKey}
                  aria-label={`View ${row.timeframe ? timeframeLabels[row.timeframe] : 'no trendline'} ${row.kind ?? ''} ${groupLabels[row.fibGroup]} trades`}
                  onClick={() => {
                    setBreakdownKey(row.key); setSelected(null);
                    requestAnimationFrame(() => journalRef.current?.scrollIntoView({ block: 'nearest' }));
                  }}>View trades</button></td>
              </tr>)}</tbody>
            </table>{!breakdown.length && <p className="p-2">No entries for this filter.</p>}</div>
            <p className="text-slate-500">A trade with several supporting timeframes or types appears in several rows, once per row. Rows overlap; use the All summary above for the unique trade total. These rows show supporting conditions together, not the isolated effect of one line.</p>
          </section>
          <section aria-label="Entry distance results" className="space-y-2 rounded border border-violet-200 p-2">
            <h3 className="font-bold text-violet-900">Results by distance from entry</h3>
            <p>Near: up to 25% of entry-timeframe ATR(14). Medium: above 25% to 50%. Far: above 50%.
              Each trade shows its own limits in pips. Lines are frozen at confirmation and projected to entry time;
              ATR uses only candles closed by entry. These are comparison labels, not entry restrictions.</p>
            <p>Unknown means distance or ATR history is unavailable, or the order has not filled.
              No trendline means no matching line was found in available history. Recapture or rerun older studies to calculate distances.</p>
            {[{ title: 'Nearest measured supporting line per trade', rows: distanceSummary, detailed: false },
              { title: 'Distance by supporting timeframe and type', rows: distanceByTimeframe, detailed: true }].map(table => (
              <div key={table.title}>
                <h4 className="font-bold">{table.title}</h4>
                <div className="max-h-56 overflow-auto"><table aria-label={table.title} className="w-full min-w-[760px] text-left">
                  <thead className="sticky top-0 bg-violet-50"><tr>
                    {[...(table.detailed ? ['Trendline TF', 'Type'] : []), 'Distance', 'Entries', 'Done', 'TP', 'SL', 'RF', 'Open', 'Unclear', 'Cancelled', 'TP %', 'Total R', 'Avg R'].map(h => <th key={h} className="p-1">{h}</th>)}
                  </tr></thead><tbody>{table.rows.map(row => <tr key={row.key} className="border-b">
                    {table.detailed && <><td className="p-1">{row.timeframe ? timeframeLabels[row.timeframe] : 'None'}</td>
                      <td className="p-1">{row.kind === 'continuation' ? 'Continuation' : row.kind === 'breakout' ? 'Breakout' : 'No matching line'}</td></>}
                    <th scope="row" className="p-1">{row.band}</th>
                    {[row.stats.total, row.stats.completed, row.stats.tp, row.stats.sl, row.stats.rf, row.stats.pending, row.stats.ambiguous, row.stats.cancelled,
                      row.stats.accuracy === undefined ? '—' : `${row.stats.accuracy.toFixed(1)}%`,
                      number(row.stats.totalR), number(row.stats.averageR)].map((value, i) => <td key={i} className="p-1">{value}</td>)}
                  </tr>)}</tbody>
                </table>{!table.rows.length && <p>No entries for this filter.</p>}</div>
              </div>
            ))}
            <p className="text-slate-500">The first table counts each arrow once, using its nearest measured supporting line.
              The second uses the nearest line within each timeframe/type pair. Its rows overlap when an entry has several supporting pairs.
              Tables follow the FIB, trendline-type and distance filters. Compare sample sizes alongside TP % and average R.</p>
          </section>
          <p><span className="font-bold text-violet-700">⬆/⬇ TL F = FIB + trendline</span> · <span className="font-bold text-sky-600">⬆/⬇ TL N = Trendline without FIB</span> · <span className="font-bold text-amber-700">⬆/⬇ FIB ONLY = No matching trendline</span>. Click an arrow or journal row for details.</p>
          {selectedBreakdown && <div aria-label="Active trendline trade filter" className="flex flex-wrap items-center justify-between gap-2 rounded bg-violet-50 p-2">
            <span>Showing {selectedBreakdown.recordIds.length} trades: {selectedBreakdown.timeframe ? timeframeLabels[selectedBreakdown.timeframe] : 'No matching trendline'} {selectedBreakdown.kind ?? ''} · {groupLabels[selectedBreakdown.fibGroup]}. Journal, arrows and export use this selection.</span>
            <button type="button" className={button} onClick={() => { setBreakdownKey(null); setSelected(null); }}>Show all filtered trades</button>
          </div>}
          <div ref={journalRef} className="max-h-64 overflow-auto"><table className="w-full min-w-[900px] text-left" aria-label="Trendline study journal"><thead className="sticky top-0 bg-slate-100"><tr>
            {['Entry time', 'Zone / engulfing', 'Direction', 'Entry', 'SL', 'TP', 'Nearest distance', 'Supporting trendline: timeframe / type', 'Group', 'Result', 'R'].map(h => <th key={h} className="p-1">{h}</th>)}
          </tr></thead><tbody>{visible.map(r => <tr key={r.id} className="cursor-pointer border-b hover:bg-violet-50" onClick={() => setSelected(r)}>
            <td className="p-1"><button type="button" className="text-left underline" onClick={() => setSelected(r)}>{when(r.filledAt ?? r.levels.calculatedAt)}</button></td>
            <td className="p-1">{r.zoneTimeframe} {r.zoneName} / {r.signal.timeframe} {r.signal.type}</td>
            <td className="p-1">{r.signal.direction === 'bullish' ? 'BUY' : 'SELL'}</td>
            <td className="p-1 tabular-nums">{r.levels.entry.toFixed(5)}</td>
            <td className="p-1 tabular-nums">{r.levels.stopLoss.toFixed(5)}</td>
            <td className="p-1 tabular-nums">{r.levels.takeProfit.toFixed(5)}</td>
            <td className="p-1">{nearestDistance(r)}</td>
            <td className="min-w-52 p-1"><div className="flex flex-col items-start gap-1">{!r.support.length && <span className="font-semibold text-amber-800">No matching trendline</span>}{supportLabels(r.support).map(label => (
              <span key={label} className={`whitespace-nowrap rounded border px-1.5 py-0.5 ${r.signal.direction === 'bullish' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{label}</span>
            ))}</div></td>
            <td className="p-1">{groupLabels[r.fibGroup]}</td><td className="p-1">{r.outcome}</td><td className="p-1">{number(r.returnR)}</td>
          </tr>)}</tbody></table>{!visible.length && <p className="p-2">No qualifying entries in this sample.</p>}</div>
        </>}
        {selected && <div className="space-y-1 rounded border border-violet-200 bg-violet-50 p-2" aria-label="Trendline arrow details">
          <strong>{selected.signal.direction === 'bullish' ? 'BUY' : 'SELL'} · {selected.zoneTimeframe} {selected.zoneName} · {selected.signal.timeframe} {selected.signal.type} · {selected.arrowDetails?.style ?? selected.style}</strong>
          {selected.arrowDetails && <>
            <p>Source: {selected.arrowDetails.source} · Arrow status: {selected.levels.status}</p>
            <p>Main zone: {selected.zoneTimeframe} {selected.arrowDetails.mainZone} · Entry zone: {selected.signal.timeframe} {selected.arrowDetails.entryZone}</p>
            <p>Recorded FIB: {selected.arrowDetails.fib || 'Not recorded'} · Outside trading hours: {selected.arrowDetails.tradingTimeBlocked ? 'Yes' : 'No'}</p>
            <p>Confirmation: {when(studyCloseTime(selected.signal.time, selected.signal.timeframe))}</p>
            <p>Risk-free price: {selected.levels.riskFree.toFixed(5)} · RF enabled: {selected.levels.riskFreeEnabled === false ? 'No' : 'Yes'}</p>
            {!!selected.arrowDetails.unavailable.length && <p className="text-amber-700">Insufficient trendline history: {selected.arrowDetails.unavailable.join(', ')}</p>}
          </>}
          <p className="font-semibold">{groupLabels[selected.fibGroup]} · Trendline support: {supportLabels(selected.support).join(' / ') || 'No matching trendline at confirmation'}</p>
          <p>Nearest measured support: {nearestDistance(selected)} · Measured at: {when(selected.distanceContext?.measuredAt)}</p>
          {selected.distanceContext?.atrPips !== undefined ? <p>
            {timeframeLabels[selected.distanceContext.timeframe]} entry ATR(14): {number(selected.distanceContext.atrPips)} pips.
            Near: up to {number(selected.distanceContext.nearPips)} pips; Medium: above that to {number(selected.distanceContext.mediumPips)} pips; Far: above that.
          </p> : <p>Distance group unknown without sufficient entry-timeframe ATR history and a filled entry.</p>}
          <p>{selected.fibGroup}: {selected.fibSources.join(', ') || 'No numerical FIB alignment at confirmation'}</p>
          <p>Entry {selected.levels.entry.toFixed(5)} · SL {selected.levels.stopLoss.toFixed(5)} · TP {selected.levels.takeProfit.toFixed(5)} · {selected.levels.rewardRisk}R · Risk {selected.levels.riskPips} pips{selected.levels.pendingAtCreation ? ' · Capped pending entry' : ''}</p>
          <p>Signal: {when(selected.signal.time)} · Filled: {when(selected.filledAt)} · Resolved: {when(selected.resolvedAt)} · {selected.outcome} · R {number(selected.returnR)}</p>
          {!!selected.support.length && <p>Supporting trendlines, confirmed before entry:</p>}
          <ul className="list-inside list-disc">{selected.support.map((s, i) => <li key={i}>{supportLabel(s)} · anchors {when(s.firstTime)} / {when(s.secondTime)} · confirmed {when(s.confirmedAt)}</li>)}</ul>
        </div>}
      </div>}
    </section>
  </>;
}
