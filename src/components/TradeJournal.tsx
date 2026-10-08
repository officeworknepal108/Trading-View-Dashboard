import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, ImagePlus, Save, X } from 'lucide-react';
import type { ChartTimeZone } from '../services/chartTime';
import {
  filterTradeRecords,
  tradeRecordDateKey,
  type TradeRecordFilters,
} from '../services/tradeRecordFilters';
import {
  calculateHalfAtOneRResult,
  type EngulfingVolumeStatus,
  type TradeResult,
  type TradeTimeframe,
} from '../services/tradeLevels';
import { TradeMultiSelect } from './TradeMultiSelect';

export interface JournalTradeRecord {
  id: string;
  zoneName: string;
  zoneTimeframe: TradeTimeframe;
  result: TradeResult;
  completedAt: number;
  source: 'ENGULFING' | 'MTF';
  direction: 'bullish' | 'bearish';
  signalTimeframe: TradeTimeframe;
  engulfingType: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rewardRisk: number;
  riskPips: number;
  signalAt?: number;
  volumeLogicStatus?: EngulfingVolumeStatus;
  volume1?: number;
  volume2?: number;
  volume3?: number;
  fibSource?: string;
  fibBand?: string;
  fibLevels?: Array<{ label: string; price: number }>;
  snapshotCandles?: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  session?: string;
  reason?: string;
  mistake?: string;
  lesson?: string;
  screenshotDataUrl?: string;
}

interface SnapshotCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface JournalResponse {
  ok: boolean;
  trades?: JournalTradeRecord[];
  error?: string;
}

interface TradeJournalProps {
  records: JournalTradeRecord[];
  timeZone: ChartTimeZone;
  onClose: () => void;
}

const RESULT_LABELS: Record<TradeResult, string> = { tp: 'TP', sl: 'SL', rf: 'RISK FREE' };
const VOLUME_STATUS_LABELS: Record<EngulfingVolumeStatus, string> = {
  'not-applicable': 'N/A',
  unavailable: 'UNAVAILABLE',
  failed: 'FAILED',
  valid: 'VALID',
  best: 'BEST',
};

function volumeStatus(trade: JournalTradeRecord): EngulfingVolumeStatus {
  return trade.volumeLogicStatus ?? 'unavailable';
}

function volumeValues(trade: JournalTradeRecord): string {
  return [trade.volume1, trade.volume2, trade.volume3]
    .map((volume, index) => volume === undefined ? undefined : `V${index + 1} ${volume}`)
    .filter(Boolean)
    .join(' · ') || 'No saved volume values';
}

function displayTimeframe(timeframe: string): string {
  return timeframe.startsWith('M') ? `${timeframe.slice(1)}M` : timeframe;
}

function formatPrice(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatJournalDate(time: number, timeZone: ChartTimeZone): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(time * 1000));
}

function formatJournalTime(time: number, timeZone: ChartTimeZone): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(time * 1000));
}

export function inferTradingSession(time: number): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(time * 1000)));
  if (hour >= 5 && hour < 12) return 'ASIAN';
  if (hour >= 12 && hour < 18) return 'LONDON';
  if (hour >= 18 && hour < 21) return 'LON + NYC';
  return 'NEW YORK';
}

function calculateTotalR(trades: JournalTradeRecord[]): number {
  return trades.reduce((total, trade) => (
    total + calculateHalfAtOneRResult(trade.result, trade.rewardRisk)
  ), 0);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function signalTimeFromRecord(trade: JournalTradeRecord): number {
  if (trade.signalAt) return trade.signalAt;
  const segments = trade.id.split(':');
  const parsed = Number(segments[segments.length - 2]);
  return Number.isFinite(parsed) ? parsed : trade.completedAt;
}

function renderHistoricalTradeSnapshot(
  trade: JournalTradeRecord,
  sourceCandles: SnapshotCandle[],
): string | undefined {
  if (sourceCandles.length < 2) return undefined;
  const signalAt = signalTimeFromRecord(trade);
  const signalIndex = sourceCandles.findIndex((candle) => candle.time === signalAt);
  const containingIndex = signalIndex >= 0 ? signalIndex : sourceCandles.findIndex((candle, index) => (
    signalAt >= candle.time && (index === sourceCandles.length - 1 || signalAt < sourceCandles[index + 1].time)
  ));
  const centerIndex = containingIndex >= 0 ? containingIndex : Math.max(0, sourceCandles.length - 30);
  const outcomeIndex = sourceCandles.findIndex((candle) => candle.time >= trade.completedAt);
  const start = Math.max(0, centerIndex - 14);
  const end = Math.min(
    sourceCandles.length,
    Math.max(centerIndex + 28, outcomeIndex >= 0 ? outcomeIndex + 5 : 0),
  );
  const candles = sourceCandles.slice(start, Math.min(end, start + 90));
  if (candles.length < 2) return undefined;

  const canvas = document.createElement('canvas');
  canvas.width = 1100;
  canvas.height = 590;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = '#312e81';
  context.font = 'bold 20px Arial';
  context.fillText(`${displayTimeframe(trade.zoneTimeframe)} ${trade.zoneName} · ${trade.direction === 'bullish' ? 'BUY' : 'SELL'}`, 54, 32);
  context.fillStyle = '#475569';
  context.font = 'bold 13px Arial';
  context.fillText(
    `${displayTimeframe(trade.signalTimeframe)} ${trade.engulfingType} · ${formatJournalDate(trade.completedAt, 'Asia/Kathmandu')} · ${RESULT_LABELS[trade.result]}`,
    54,
    54,
  );
  const fibDescription = [trade.fibSource || 'FIB-qualified setup', trade.fibBand].filter(Boolean).join(' · ');
  context.fillStyle = '#b45309';
  context.fillText(`FIB: ${fibDescription}`, 690, 32);

  const chartLeft = 62;
  const chartTop = 82;
  const chartWidth = 910;
  const chartHeight = 430;
  const prices = candles.flatMap((candle) => [candle.high, candle.low]);
  prices.push(trade.entry, trade.stopLoss, trade.takeProfit);
  for (const level of trade.fibLevels || []) prices.push(level.price);
  let minimum = Math.min(...prices);
  let maximum = Math.max(...prices);
  const padding = Math.max((maximum - minimum) * 0.08, 0.5);
  minimum -= padding;
  maximum += padding;
  const priceToY = (price: number) => chartTop + ((maximum - price) / (maximum - minimum)) * chartHeight;

  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 1;
  context.font = '11px Arial';
  context.fillStyle = '#64748b';
  for (let row = 0; row <= 5; row += 1) {
    const y = chartTop + (chartHeight * row) / 5;
    context.beginPath();
    context.moveTo(chartLeft, y);
    context.lineTo(chartLeft + chartWidth, y);
    context.stroke();
    const price = maximum - ((maximum - minimum) * row) / 5;
    context.fillText(formatPrice(price), chartLeft + chartWidth + 8, y + 4);
  }

  const candleSlot = chartWidth / candles.length;
  const candleWidth = Math.max(2, Math.min(9, candleSlot * 0.58));
  candles.forEach((candle, index) => {
    const x = chartLeft + candleSlot * index + candleSlot / 2;
    const bullish = candle.close >= candle.open;
    context.strokeStyle = bullish ? '#059669' : '#e11d48';
    context.fillStyle = bullish ? '#10b981' : '#f43f5e';
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(x, priceToY(candle.high));
    context.lineTo(x, priceToY(candle.low));
    context.stroke();
    const bodyTop = priceToY(Math.max(candle.open, candle.close));
    const bodyBottom = priceToY(Math.min(candle.open, candle.close));
    context.fillRect(x - candleWidth / 2, bodyTop, candleWidth, Math.max(2, bodyBottom - bodyTop));
    if (candle.time === signalAt) {
      context.strokeStyle = '#7c3aed';
      context.lineWidth = 2;
      context.strokeRect(x - candleSlot / 2, chartTop, candleSlot, chartHeight);
      context.fillStyle = '#7c3aed';
      context.font = 'bold 11px Arial';
      context.fillText('ENGULFING', Math.max(chartLeft, x - 32), chartTop + 15);
    }
  });

  const drawLevel = (price: number, label: string, color: string, dashed = false) => {
    const y = priceToY(price);
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2;
    context.setLineDash(dashed ? [7, 5] : []);
    context.beginPath();
    context.moveTo(chartLeft, y);
    context.lineTo(chartLeft + chartWidth, y);
    context.stroke();
    context.setLineDash([]);
    context.font = 'bold 12px Arial';
    context.fillText(`${label} ${formatPrice(price)}`, chartLeft + 8, y - 5);
    context.restore();
  };
  for (const level of trade.fibLevels || []) drawLevel(level.price, `FIB ${level.label}`, '#d97706', true);
  drawLevel(trade.takeProfit, 'TP', '#059669');
  drawLevel(trade.entry, 'ENTRY', '#2563eb');
  drawLevel(trade.stopLoss, 'SL', '#e11d48');

  context.fillStyle = '#334155';
  context.font = 'bold 13px Arial';
  context.fillText(
    `Risk ${trade.riskPips} pips · R:R 1:${trade.rewardRisk} · Session ${trade.session || inferTradingSession(trade.completedAt)}`,
    62,
    552,
  );
  context.fillStyle = trade.result === 'tp' ? '#047857' : trade.result === 'sl' ? '#be123c' : '#b45309';
  context.font = 'bold 16px Arial';
  context.fillText(`RESULT: ${RESULT_LABELS[trade.result]}`, 850, 552);
  return canvas.toDataURL('image/jpeg', 0.78);
}

export const TradeJournal: React.FC<TradeJournalProps> = ({ records, timeZone, onClose }) => {
  const screenshotBackfillAttemptedRef = React.useRef(new Set<string>());
  const screenshotBackfillRunningRef = React.useRef(false);
  const [trades, setTrades] = useState<JournalTradeRecord[]>(records);
  const [selectedId, setSelectedId] = useState<string | null>(records[0]?.id ?? null);
  const [resultFilter, setResultFilter] = useState<'ALL' | TradeResult>('ALL');
  const [timeframeFilter, setTimeframeFilter] = useState<TradeRecordFilters['timeframes']>('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState<TradeRecordFilters['source']>('ALL');
  const [sideFilter, setSideFilter] = useState<TradeRecordFilters['side']>('ALL');
  const [zoneFilter, setZoneFilter] = useState<TradeRecordFilters['zones']>('ALL');
  const [volumeFilter, setVolumeFilter] = useState<'ALL' | EngulfingVolumeStatus>('ALL');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<'excel' | 'word' | null>(null);
  const [preparingScreenshots, setPreparingScreenshots] = useState(false);
  const [message, setMessage] = useState('Loading saved journal…');
  const [journalLoaded, setJournalLoaded] = useState(false);
  const [draft, setDraft] = useState({ session: '', reason: '', mistake: '', lesson: '', screenshotDataUrl: '' });

  useEffect(() => {
    let cancelled = false;
    const loadAndMerge = async () => {
      try {
        const storedResponse = await fetch('/api/journal/trades', { cache: 'no-store' });
        const storedPayload = await storedResponse.json() as JournalResponse;
        if (!storedResponse.ok || !storedPayload.ok) throw new Error(storedPayload.error || 'Unable to load journal.');
        const saved = storedPayload.trades ?? [];
        const storedById = new Map(saved.map((trade) => [trade.id, trade]));
        const mergedRecords = records.map((record) => {
          const stored = storedById.get(record.id);
          return {
            ...stored,
            ...record,
            session: stored?.session,
            reason: stored?.reason,
            mistake: stored?.mistake,
            lesson: stored?.lesson,
            screenshotDataUrl: stored?.screenshotDataUrl || record.screenshotDataUrl,
          };
        });
        const missingRecords = records.filter((record) => !storedById.has(record.id));
        let finalTrades = [...mergedRecords, ...saved.filter((trade) => !records.some((record) => record.id === trade.id))]
          .sort((first, second) => second.completedAt - first.completedAt);
        if (missingRecords.length > 0) {
          const saveResponse = await fetch('/api/journal/trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trades: missingRecords }),
          });
          const savePayload = await saveResponse.json() as JournalResponse;
          if (!saveResponse.ok || !savePayload.ok) throw new Error(savePayload.error || 'Unable to save new trades.');
          finalTrades = savePayload.trades ?? finalTrades;
        }
        if (cancelled) return;
        setTrades(finalTrades);
        setSelectedId((current) => current ?? finalTrades[0]?.id ?? null);
        setMessage(`${finalTrades.length} completed trade${finalTrades.length === 1 ? '' : 's'} saved`);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load journal.');
      } finally {
        if (!cancelled) setJournalLoaded(true);
      }
    };
    void loadAndMerge();
    return () => { cancelled = true; };
  }, [records]);

  useEffect(() => {
    if (!journalLoaded || screenshotBackfillRunningRef.current) return undefined;
    const candidates = trades.filter((trade) => (
      !trade.screenshotDataUrl && !screenshotBackfillAttemptedRef.current.has(trade.id)
    ));
    if (candidates.length === 0) return undefined;
    screenshotBackfillRunningRef.current = true;
    for (const trade of candidates) screenshotBackfillAttemptedRef.current.add(trade.id);
    const backfill = async () => {
      setPreparingScreenshots(true);
      const timeframeSeconds: Record<TradeTimeframe, number> = {
        M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D: 86400,
      };
      const byTimeframe = new Map<TradeTimeframe, JournalTradeRecord[]>();
      for (const trade of candidates) {
        const group = byTimeframe.get(trade.signalTimeframe) ?? [];
        group.push(trade);
        byTimeframe.set(trade.signalTimeframe, group);
      }
      const generated: JournalTradeRecord[] = [];
      setMessage(`Preparing ${candidates.length} missing trade screenshot${candidates.length === 1 ? '' : 's'}…`);
      for (const [timeframe, timeframeTrades] of byTimeframe) {
        try {
          const latestCompletion = Math.max(...timeframeTrades.map((trade) => trade.completedAt));
          const query = new URLSearchParams({
            granularity: timeframe,
            count: '5000',
            endTime: String(latestCompletion + timeframeSeconds[timeframe] * 20),
          });
          const response = await fetch(`/api/tradingview/market-data?${query}`, { cache: 'no-store' });
          const payload = await response.json() as { ok?: boolean; candles?: SnapshotCandle[] };
          if (!response.ok || !payload.ok || !Array.isArray(payload.candles)) continue;
          for (const trade of timeframeTrades) {
            const screenshotDataUrl = renderHistoricalTradeSnapshot(trade, payload.candles);
            if (screenshotDataUrl) generated.push({ ...trade, screenshotDataUrl });
          }
        } catch {
          // A missing timeframe feed must not block the rest of the journal.
        }
      }
      if (generated.length === 0) {
        setMessage('No historical candles were available for screenshot backfill.');
        return;
      }
      let savedTrades = trades;
      for (let index = 0; index < generated.length; index += 5) {
        const response = await fetch('/api/journal/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trades: generated.slice(index, index + 5) }),
        });
        const payload = await response.json() as JournalResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to save generated screenshots.');
        savedTrades = payload.trades ?? savedTrades;
      }
      setTrades(savedTrades);
      setMessage(`${generated.length} historical trade screenshot${generated.length === 1 ? '' : 's'} saved`);
    };
    void backfill()
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Unable to prepare trade screenshots.');
      })
      .finally(() => {
        screenshotBackfillRunningRef.current = false;
        setPreparingScreenshots(false);
      });
    return undefined;
  }, [journalLoaded, trades]);

  const selectedTrade = trades.find((trade) => trade.id === selectedId);
  useEffect(() => {
    if (!selectedTrade) return;
    setDraft({
      session: selectedTrade.session || inferTradingSession(selectedTrade.completedAt),
      reason: selectedTrade.reason || '',
      mistake: selectedTrade.mistake || '',
      lesson: selectedTrade.lesson || '',
      screenshotDataUrl: selectedTrade.screenshotDataUrl || '',
    });
  }, [selectedTrade]);

  const availableTimeframes = useMemo(() => {
    const order: TradeTimeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D'];
    return Array.from(new Set<TradeTimeframe>(trades.map((trade) => trade.signalTimeframe)))
      .sort((first, second) => order.indexOf(first) - order.indexOf(second));
  }, [trades]);
  const availableDates = useMemo(() => Array.from(new Set(
    trades.map((trade) => tradeRecordDateKey(trade.completedAt, timeZone)),
  )).sort().reverse(), [timeZone, trades]);
  const availableZones = useMemo(() => Array.from(new Set(
    trades.map((trade) => trade.zoneName),
  )).sort(), [trades]);
  const filteredTrades = useMemo(() => {
    const query = search.trim().toLowerCase();
    const coreFiltered = filterTradeRecords<JournalTradeRecord>(trades, {
      timeframes: timeframeFilter,
      date: dateFilter,
      source: sourceFilter,
      side: sideFilter,
      result: resultFilter,
      zones: zoneFilter,
    }, timeZone);
    return coreFiltered.filter((trade) => (
      (volumeFilter === 'ALL' || volumeStatus(trade) === volumeFilter)
      && (!query || [trade.zoneName, trade.engulfingType, volumeStatus(trade), trade.session, trade.reason, trade.mistake, trade.lesson]
        .some((value) => value?.toLowerCase().includes(query)))
    ));
  }, [dateFilter, resultFilter, search, sideFilter, sourceFilter, timeframeFilter, timeZone, trades, volumeFilter, zoneFilter]);

  useEffect(() => {
    if (filteredTrades.some((trade) => trade.id === selectedId)) return;
    setSelectedId(filteredTrades[0]?.id ?? null);
  }, [filteredTrades, selectedId]);

  const counts = useMemo(() => ({
    tp: filteredTrades.filter((trade) => trade.result === 'tp').length,
    sl: filteredTrades.filter((trade) => trade.result === 'sl').length,
    rf: filteredTrades.filter((trade) => trade.result === 'rf').length,
  }), [filteredTrades]);
  const accuracy = filteredTrades.length > 0 ? Math.round((counts.tp * 10_000) / filteredTrades.length) / 100 : 0;
  const totalR = calculateTotalR(filteredTrades);

  const saveTrade = async () => {
    if (!selectedTrade) return;
    setSaving(true);
    try {
      const updated = { ...selectedTrade, ...draft };
      const response = await fetch('/api/journal/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: [updated] }),
      });
      const payload = await response.json() as JournalResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to save journal notes.');
      setTrades(payload.trades ?? trades.map((trade) => trade.id === updated.id ? updated : trade));
      setMessage('Trade review saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save journal notes.');
    } finally {
      setSaving(false);
    }
  };

  const attachScreenshot = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('Please select an image file.');
      return;
    }
    if (file.size > 3_000_000) {
      setMessage('Screenshot must be smaller than 3 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft((current) => ({ ...current, screenshotDataUrl: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };

  const exportExcel = async () => {
    setExporting('excel');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const summary = [{
        'Total Trades': filteredTrades.length,
        TP: counts.tp,
        SL: counts.sl,
        'Risk Free': counts.rf,
        'Accuracy %': accuracy,
        'Total R': totalR,
      }];
      const rows = filteredTrades.map((trade, index) => ({
        No: index + 1,
        Date: formatJournalDate(trade.completedAt, timeZone),
        Time: formatJournalTime(trade.completedAt, timeZone),
        Session: trade.session || inferTradingSession(trade.completedAt),
        'Zone TF': displayTimeframe(trade.zoneTimeframe),
        Zone: trade.zoneName,
        Side: trade.direction === 'bullish' ? 'BUY' : 'SELL',
        Source: trade.source,
        'Engulfing TF': displayTimeframe(trade.signalTimeframe),
        'Engulfing Type': trade.engulfingType,
        'Volume Logic': VOLUME_STATUS_LABELS[volumeStatus(trade)],
        'Volume 1': trade.volume1 ?? '',
        'Volume 2': trade.volume2 ?? '',
        'Volume 3': trade.volume3 ?? '',
        Entry: trade.entry,
        SL: trade.stopLoss,
        TP: trade.takeProfit,
        'Risk Pips': trade.riskPips,
        'R:R': `1:${trade.rewardRisk}`,
        Result: RESULT_LABELS[trade.result],
        'Screenshot Available': trade.screenshotDataUrl ? 'YES' : 'NO',
        Reason: trade.reason || '',
        Mistake: trade.mistake || '',
        Lesson: trade.lesson || '',
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), 'Dashboard');
      const tradeSheet = XLSX.utils.json_to_sheet(rows);
      tradeSheet['!cols'] = [5, 13, 8, 13, 9, 18, 8, 12, 12, 14, 12, 12, 12, 12, 12, 12, 12, 10, 8, 12, 20, 38, 38, 38]
        .map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(workbook, tradeSheet, 'Trade Journal');
      XLSX.writeFile(workbook, `Trade-Journal-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setMessage('Excel journal exported');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to export Excel journal.');
    } finally {
      setExporting(null);
    }
  };

  const exportWord = async () => {
    setExporting('word');
    try {
      const {
        AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow,
        TextRun, WidthType,
      } = await import('docx');
      const summaryTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: ['Total Trades', 'TP', 'SL', 'Risk Free', 'Accuracy', 'Total R'].map((text) => (
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] })
          )) }),
          new TableRow({ children: [filteredTrades.length, counts.tp, counts.sl, counts.rf, `${accuracy}%`, totalR]
            .map((value) => new TableCell({ children: [new Paragraph(String(value))] })) }),
        ],
      });
      const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [
        new Paragraph({ text: 'Radhe Radhe', alignment: AlignmentType.CENTER, heading: HeadingLevel.TITLE }),
        new Paragraph({ text: 'Trading Journal Report', alignment: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: `Generated ${new Date().toLocaleString('en-GB')}`, alignment: AlignmentType.CENTER }),
        summaryTable,
      ];
      for (const [index, trade] of filteredTrades.entries()) {
        children.push(
          new Paragraph({ text: `Trade ${index + 1}`, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }),
          new Paragraph(`Date: ${formatJournalDate(trade.completedAt, timeZone)}    Time: ${formatJournalTime(trade.completedAt, timeZone)}    Session: ${trade.session || inferTradingSession(trade.completedAt)}`),
          new Paragraph(`Setup: ${displayTimeframe(trade.zoneTimeframe)} ${trade.zoneName} · ${trade.direction === 'bullish' ? 'BUY' : 'SELL'}`),
          new Paragraph(`Confirmation: ${displayTimeframe(trade.signalTimeframe)} ${trade.engulfingType} · Source: ${trade.source}`),
          new Paragraph(`Volume logic: ${VOLUME_STATUS_LABELS[volumeStatus(trade)]} · ${volumeValues(trade)}`),
          new Paragraph(`Entry: ${formatPrice(trade.entry)}    SL: ${formatPrice(trade.stopLoss)}    TP: ${formatPrice(trade.takeProfit)}    Risk: ${trade.riskPips} pips    R:R 1:${trade.rewardRisk}`),
          new Paragraph({ children: [new TextRun({ text: `Outcome: ${RESULT_LABELS[trade.result]}`, bold: true })] }),
          new Paragraph({ children: [new TextRun({ text: 'Reason: ', bold: true }), new TextRun(trade.reason || '—')] }),
          new Paragraph({ children: [new TextRun({ text: 'Mistake / Important observation: ', bold: true }), new TextRun(trade.mistake || '—')] }),
          new Paragraph({ children: [new TextRun({ text: 'Lesson learned: ', bold: true }), new TextRun(trade.lesson || '—')] }),
        );
        if (trade.screenshotDataUrl) {
          try {
            const imageResponse = await fetch(trade.screenshotDataUrl);
            const imageData = new Uint8Array(await imageResponse.arrayBuffer());
            const imageType = trade.screenshotDataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({ data: imageData, transformation: { width: 620, height: 350 }, type: imageType })],
            }));
          } catch {
            children.push(new Paragraph('Screenshot could not be embedded.'));
          }
        }
      }
      const document = new Document({ sections: [{ children }] });
      downloadBlob(await Packer.toBlob(document), `Trade-Journal-${new Date().toISOString().slice(0, 10)}.docx`);
      setMessage('Word journal exported');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to export Word journal.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div data-journal-exclude="true" className="pointer-events-auto absolute inset-3 z-40 flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-slate-50 shadow-2xl">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-300 bg-white px-3 py-2">
        <BookOpen className="h-4 w-4 text-indigo-700" />
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-indigo-800">Trading Journal</div>
          <div className="text-[9px] font-semibold text-slate-500">{message}</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => void exportExcel()} disabled={exporting !== null || preparingScreenshots}
            className="flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] font-black text-emerald-700 disabled:opacity-50">
            <Download className="h-3 w-3" /> {exporting === 'excel' ? 'EXPORTING…' : 'EXPORT EXCEL'}
          </button>
          <button type="button" onClick={() => void exportWord()} disabled={exporting !== null || preparingScreenshots}
            className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[9px] font-black text-blue-700 disabled:opacity-50">
            <Download className="h-3 w-3" /> {preparingScreenshots ? 'PREPARING IMAGES…' : exporting === 'word' ? 'EXPORTING…' : 'EXPORT WORD'}
          </button>
          <button type="button" onClick={onClose} className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100" title="Close journal">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-6 gap-2 border-b border-slate-200 bg-white p-2">
        {[
          ['TOTAL', filteredTrades.length, 'text-slate-800'],
          ['TP', counts.tp, 'text-emerald-700'],
          ['SL', counts.sl, 'text-rose-700'],
          ['RISK FREE', counts.rf, 'text-amber-600'],
          ['ACCURACY', `${accuracy}%`, 'text-indigo-700'],
          ['TOTAL R', `${totalR >= 0 ? '+' : ''}${totalR}R`, totalR >= 0 ? 'text-emerald-700' : 'text-rose-700'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-center">
            <div className="text-[8px] font-black uppercase text-slate-500">{label}</div>
            <div className={`text-sm font-black ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-2 py-1.5">
        <TradeMultiSelect
          allLabel="ALL TIMEFRAMES"
          emptyLabel="NO TIMEFRAMES"
          selected={timeframeFilter}
          options={availableTimeframes.map((timeframe) => ({ value: timeframe, label: displayTimeframe(timeframe) }))}
          onChange={(timeframes) => setTimeframeFilter(timeframes as TradeRecordFilters['timeframes'])}
        />
        <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="rounded border border-slate-200 px-2 py-1 text-[9px] font-bold">
          <option value="ALL">ALL DATES</option>{availableDates.map((date) => <option key={date} value={date}>{date}</option>)}
        </select>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as TradeRecordFilters['source'])} className="rounded border border-slate-200 px-2 py-1 text-[9px] font-bold">
          <option value="ALL">ALL SOURCES</option><option value="ENGULFING">ENGULFING</option><option value="MTF">MTF</option>
        </select>
        <select value={sideFilter} onChange={(event) => setSideFilter(event.target.value as TradeRecordFilters['side'])} className="rounded border border-slate-200 px-2 py-1 text-[9px] font-bold">
          <option value="ALL">ALL SIDES</option><option value="BUY">BUY</option><option value="SELL">SELL</option>
        </select>
        <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as 'ALL' | TradeResult)} className="rounded border border-slate-200 px-2 py-1 text-[9px] font-bold">
          <option value="ALL">ALL RESULTS</option><option value="tp">TP</option><option value="sl">SL</option><option value="rf">RISK FREE</option>
        </select>
        <TradeMultiSelect
          allLabel="ALL ZONES"
          emptyLabel="NO ZONES"
          selected={zoneFilter}
          options={availableZones.map((zone) => ({ value: zone, label: zone }))}
          onChange={setZoneFilter}
        />
        <select value={volumeFilter} onChange={(event) => setVolumeFilter(event.target.value as 'ALL' | EngulfingVolumeStatus)} className="rounded border border-slate-200 px-2 py-1 text-[9px] font-bold">
          <option value="ALL">ALL VOLUME LOGIC</option><option value="best">BEST</option><option value="valid">VALID</option><option value="failed">FAILED</option><option value="unavailable">UNAVAILABLE</option><option value="not-applicable">N/A</option>
        </select>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search zone, reason, mistake or lesson"
          className="min-w-48 flex-1 rounded border border-slate-200 px-2 py-1 text-[9px] font-semibold outline-none focus:border-indigo-300" />
        <button type="button" onClick={() => {
          setTimeframeFilter('ALL'); setDateFilter('ALL'); setSourceFilter('ALL');
          setSideFilter('ALL'); setResultFilter('ALL'); setZoneFilter('ALL');
          setVolumeFilter('ALL'); setSearch('');
        }} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-black text-slate-600 hover:bg-slate-100">RESET</button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto border-r border-slate-300 bg-white">
          <table className="min-w-[1220px] w-full border-collapse text-center text-[9px]">
            <thead className="sticky top-0 z-10 bg-slate-600 uppercase text-white">
              <tr>{['#', 'Date', 'Time', 'Session', 'Zone TF', 'Zone', 'Side', 'Engulfing', 'Volume', 'Entry', 'SL', 'TP', 'R:R', 'Result'].map((heading) => <th key={heading} className="whitespace-nowrap px-2 py-1.5">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {filteredTrades.map((trade, index) => (
                <tr key={trade.id} onClick={() => setSelectedId(trade.id)} className={`cursor-pointer border-t border-slate-200 ${selectedId === trade.id ? 'bg-indigo-100' : 'odd:bg-white even:bg-slate-50 hover:bg-indigo-50'}`}>
                  <td className="px-2 py-1.5 text-slate-500">{index + 1}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{formatJournalDate(trade.completedAt, timeZone)}</td>
                  <td className="px-2 py-1.5">{formatJournalTime(trade.completedAt, timeZone)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-bold">{trade.session || inferTradingSession(trade.completedAt)}</td>
                  <td className="px-2 py-1.5 font-bold">{displayTimeframe(trade.zoneTimeframe)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-left font-bold">{trade.zoneName}</td>
                  <td className={`px-2 py-1.5 font-black ${trade.direction === 'bullish' ? 'text-emerald-700' : 'text-rose-700'}`}>{trade.direction === 'bullish' ? 'BUY' : 'SELL'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{displayTimeframe(trade.signalTimeframe)} {trade.engulfingType}</td>
                  <td title={volumeValues(trade)} className={`whitespace-nowrap px-2 py-1.5 font-black ${volumeStatus(trade) === 'best' ? 'text-emerald-700' : volumeStatus(trade) === 'valid' ? 'text-blue-700' : volumeStatus(trade) === 'failed' ? 'text-rose-700' : 'text-slate-500'}`}>{VOLUME_STATUS_LABELS[volumeStatus(trade)]}</td>
                  <td className="px-2 py-1.5">{formatPrice(trade.entry)}</td><td className="px-2 py-1.5">{formatPrice(trade.stopLoss)}</td><td className="px-2 py-1.5">{formatPrice(trade.takeProfit)}</td>
                  <td className="px-2 py-1.5 font-bold">1:{trade.rewardRisk}</td>
                  <td className={`px-2 py-1.5 font-black ${trade.result === 'tp' ? 'text-emerald-700' : trade.result === 'sl' ? 'text-rose-700' : 'text-amber-600'}`}>{RESULT_LABELS[trade.result]}</td>
                </tr>
              ))}
              {filteredTrades.length === 0 && <tr><td colSpan={14} className="p-6 text-slate-400">No completed trades match these filters.</td></tr>}
            </tbody>
          </table>
        </div>

        <aside className="w-[330px] shrink-0 overflow-auto bg-slate-50 p-3">
          {selectedTrade ? <>
            <div className="mb-2 text-[10px] font-black uppercase text-indigo-800">Trade review</div>
            <div className="mb-2 rounded border border-slate-200 bg-white p-2 text-[9px] leading-relaxed text-slate-600">
              <strong className="text-slate-800">{displayTimeframe(selectedTrade.zoneTimeframe)} {selectedTrade.zoneName}</strong> · {selectedTrade.direction === 'bullish' ? 'BUY' : 'SELL'}<br />
              {displayTimeframe(selectedTrade.signalTimeframe)} {selectedTrade.engulfingType} · 1:{selectedTrade.rewardRisk} · {RESULT_LABELS[selectedTrade.result]}
              <br />Volume logic: <strong>{VOLUME_STATUS_LABELS[volumeStatus(selectedTrade)]}</strong> · {volumeValues(selectedTrade)}
            </div>
            <label className="mb-2 block text-[8px] font-black uppercase text-slate-500">Session
              <select value={draft.session} onChange={(event) => setDraft((current) => ({ ...current, session: event.target.value }))} className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-bold text-slate-700">
                {['ASIAN', 'LONDON', 'LON + NYC', 'NEW YORK', 'OTHER'].map((session) => <option key={session}>{session}</option>)}
              </select>
            </label>
            {[['reason', 'Reason for entry'], ['mistake', 'Mistake / important observation'], ['lesson', 'Lesson learned']].map(([key, label]) => (
              <label key={key} className="mb-2 block text-[8px] font-black uppercase text-slate-500">{label}
                <textarea value={draft[key as 'reason' | 'mistake' | 'lesson']} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} rows={3}
                  className="mt-1 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-medium normal-case text-slate-700 outline-none focus:border-indigo-300" />
              </label>
            ))}
            <label className="mb-2 flex cursor-pointer items-center justify-center gap-1 rounded border border-dashed border-slate-300 bg-white px-2 py-2 text-[9px] font-black text-slate-600 hover:border-indigo-300 hover:text-indigo-700">
              <ImagePlus className="h-3.5 w-3.5" /> ATTACH SCREENSHOT
              <input type="file" accept="image/*" className="hidden" onChange={(event) => attachScreenshot(event.target.files?.[0])} />
            </label>
            {draft.screenshotDataUrl && <img src={draft.screenshotDataUrl} alt="Trade screenshot" className="mb-2 max-h-40 w-full rounded border border-slate-200 object-contain" />}
            <button type="button" onClick={() => void saveTrade()} disabled={saving} className="flex w-full items-center justify-center gap-1 rounded bg-indigo-700 px-2 py-2 text-[9px] font-black text-white hover:bg-indigo-800 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? 'SAVING…' : 'SAVE TRADE REVIEW'}
            </button>
          </> : <div className="grid h-full place-items-center text-center text-xs text-slate-400">Select a trade to add your review.</div>}
        </aside>
      </div>
    </div>
  );
};
