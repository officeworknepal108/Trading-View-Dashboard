import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  UTCTimestamp,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Maximize2,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { analyzeMarketStructure, StructureLine, StructureZone } from '../services/marketStructure';
import { findReplayIndexAtOrBefore } from '../services/replay';
import { buildAlternatingSwingFibs, SwingFibMove } from '../services/swingFib';

type OandaGranularity = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D';
type MarketGranularity = OandaGranularity | 'W' | 'MO';
type FibVisibilityKey = 'tjl1' | 'tjl2' | 'choch' | 'intChoch' | 'intTjl1' | 'intTjl2'
  | 'doubleChoch' | 'iss' | 'swing';

const DEFAULT_FIB_VISIBILITY: Record<FibVisibilityKey, boolean> = {
  tjl1: false,
  tjl2: false,
  choch: false,
  intChoch: false,
  intTjl1: false,
  intTjl2: false,
  doubleChoch: false,
  iss: false,
  swing: false,
};

const FIB_VISIBILITY_OPTIONS: Array<{ key: FibVisibilityKey; label: string }> = [
  { key: 'tjl1', label: 'TJL1 MARKING' },
  { key: 'tjl2', label: 'TJL2 MARKING' },
  { key: 'choch', label: 'CHoCH MARKING' },
  { key: 'doubleChoch', label: 'D CHoCH MARKING' },
  { key: 'iss', label: 'ISS MARKING' },
  { key: 'swing', label: 'SWING MARKING' },
];

const INTERNAL_FIB_VISIBILITY_OPTIONS: Array<{ key: FibVisibilityKey; label: string }> = [
  { key: 'intChoch', label: 'Int CHoCH MARKING' },
  { key: 'intTjl1', label: 'Int TJL1 MARKING' },
  { key: 'intTjl2', label: 'Int TJL2 MARKING' },
];

const ALL_FIB_VISIBILITY_OPTIONS = [
  ...FIB_VISIBILITY_OPTIONS,
  ...INTERNAL_FIB_VISIBILITY_OPTIONS,
];

function isSingleFibMarkingKey(key: FibVisibilityKey): boolean {
  return key === 'tjl1' || key === 'tjl2' || key === 'intTjl1' || key === 'intTjl2'
    || key === 'doubleChoch' || key === 'iss';
}

interface OandaCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  complete: boolean;
}

interface MarketDataResponse {
  ok: boolean;
  source?: string;
  granularity?: MarketGranularity;
  fetchedAt?: string;
  candles?: OandaCandle[];
  error?: string;
}

const TIMEFRAMES: Array<{ value: OandaGranularity; label: string }> = [
  { value: 'M1', label: '1m' },
  { value: 'M5', label: '5m' },
  { value: 'M15', label: '15m' },
  { value: 'M30', label: '30m' },
  { value: 'H1', label: '1h' },
  { value: 'H4', label: '4h' },
  { value: 'D', label: 'D' },
];

const TREND_TABLE_GRANULARITIES: OandaGranularity[] = ['M1', 'M5', 'M15', 'H1', 'H4', 'D'];

const TREND_TABLE_LABELS: Record<OandaGranularity, string> = {
  M1: '1 MIN', M5: '5 MIN', M15: '15 MIN', M30: '30 MIN', H1: '1 HOUR', H4: '4 HOUR', D: '1 DAY',
};

const TIMEFRAME_SECONDS: Record<MarketGranularity, number> = {
  M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D: 86400, W: 604800,
  MO: 31 * 86400,
};

const PRESENT_VIEW_BAR_SPACING = 8.5;
const PRESENT_VIEW_RIGHT_GAP_RATIO = 0.34;
const PRESENT_VIEW_PRICE_SCALE_WIDTH = 80;

const TJL1_CONFIRMATION_SECONDS: Partial<Record<MarketGranularity, number>> = {
  M1: 300,
  M5: 900,
  M15: 3600,
  M30: 3600,
  H1: 14400,
  H4: 86400,
  D: 604800,
};

const VIP_SUPPORT_GRANULARITIES: Record<OandaGranularity, MarketGranularity[]> = {
  // A fresh valid zone from either mapped timeframe can qualify VIP CHoCH.
  M1: ['M5', 'M15'],
  M5: ['M15', 'H1'],
  M15: ['H1', 'H4'],
  M30: ['H1', 'H4'],
  H1: ['H4', 'D'],
  H4: ['D', 'W'],
  D: ['W', 'MO'],
};

const GRANULARITY_LABELS: Record<MarketGranularity, string> = {
  M1: '1m', M5: '5m', M15: '15m', M30: '30m', H1: '1h', H4: '4h', D: '1D', W: '1W', MO: '1M',
};

function marketCandleCloseTime(time: number, granularity: MarketGranularity): number {
  if (granularity !== 'MO') return time + TIMEFRAME_SECONDS[granularity];
  const start = new Date(time * 1000);
  return Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate(),
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(),
  ) / 1000;
}

const TJL1_CONFIRMATION_LABELS: Record<OandaGranularity, string> = {
  M1: '5m', M5: '15m', M15: '1h', M30: '1h', H1: '4h', H4: '1D', D: '1W',
};

function formatPrice(value: number | undefined): string {
  return Number.isFinite(value) ? Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }) : '—';
}

function displayZoneName(name: string): string {
  return name.startsWith('Internal ') ? `Int ${name.slice('Internal '.length)}` : name;
}

function displayFibLabel(zone: StructureZone): string {
  if (zone.fibBand === 'deep') {
    return 'FIB DEEP DISCOUNT';
  }
  return `A+ FIB ${zone.fibBand}`;
}

function fibVisibilityKey(zone: StructureZone): FibVisibilityKey {
  if (zone.category === 'iss') return 'iss';
  if (zone.category === 'internal') {
    if (zone.name === 'Internal TJL1') return 'intTjl1';
    if (zone.name === 'Internal TJL2') return 'intTjl2';
    return 'intChoch';
  }
  if (zone.doubleChochTime !== undefined || zone.doubleChochStatus !== undefined) return 'doubleChoch';
  if (zone.chochTime !== undefined || zone.chochClass !== undefined) return 'choch';
  if (zone.name === 'TJL1') return 'tjl1';
  if (zone.name === 'TJL2') return 'tjl2';
  return 'swing';
}

function isFibMarkingVisible(
  zone: StructureZone,
  showFib: boolean,
  visibility: Record<FibVisibilityKey, boolean>,
  previousVisibility: Record<FibVisibilityKey, boolean>,
): boolean {
  const key = fibVisibilityKey(zone);
  if (key === 'tjl1' || key === 'tjl2' || key === 'intTjl1' || key === 'intTjl2'
    || key === 'doubleChoch' || key === 'iss') {
    return showFib && visibility[key];
  }
  return showFib && (visibility[key] || previousVisibility[key]);
}

function formatCandleCountdown(secondsRemaining: number): string {
  const total = Math.max(0, Math.floor(secondsRemaining));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface TrendTableRow {
  granularity: OandaGranularity;
  label: string;
  trend: ReturnType<typeof analyzeMarketStructure>['trend'];
  closesAt?: number;
}

const MultiTimeframeTrendTable: React.FC<{ rows: TrendTableRow[]; replayActive: boolean }> = ({
  rows,
  replayActive,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [nowSeconds, setNowSeconds] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!expanded || replayActive) return undefined;
    const updateClock = () => setNowSeconds(Date.now() / 1000);
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, [expanded, replayActive]);

  return (
    <div className={`pointer-events-auto absolute bottom-3 right-20 z-20 overflow-hidden rounded-md border border-slate-300 bg-white/95 shadow-sm ${expanded ? 'w-[238px]' : 'w-auto'}`}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-slate-600">
        <span>{expanded ? 'Trend table' : 'Trend table minimized'}</span>
        <button
          type="button"
          onClick={() => setExpanded((visible) => !visible)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[7px] font-black text-slate-600 hover:bg-slate-200"
          title={expanded ? 'Minimize trend table' : 'Show trend table'}
        >
          {expanded ? '− MINIMIZE' : '+ SHOW TABLE'}
        </button>
      </div>
      {expanded && (
        <table className="w-full border-collapse text-center text-[9px]">
          <thead className="bg-slate-500 text-[8px] uppercase text-white">
            <tr>
              <th className="border-r border-slate-400 px-1 py-0.5 font-bold">Timeframe</th>
              <th className="border-r border-slate-400 px-1 py-0.5 font-bold">Trend</th>
              <th className="px-1 py-0.5 font-bold">Time left</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isBullish = row.trend === 'bullish';
              const isBearish = row.trend === 'bearish';
              return (
                <tr key={row.granularity} className="border-t border-slate-300 text-slate-700">
                  <td className="border-r border-slate-300 px-1 py-0.5 font-medium">{row.label}</td>
                  <td className={`border-r border-slate-300 px-1 py-0.5 font-bold ${
                    isBullish ? 'text-emerald-600' : isBearish ? 'text-rose-600' : 'text-slate-500'
                  }`}>
                    {isBullish ? '▲ BULLISH' : isBearish ? '▼ BEARISH' : '— NEUTRAL'}
                  </td>
                  <td className="px-1 py-0.5 font-medium tabular-nums text-slate-600">
                    {replayActive || row.closesAt === undefined
                      ? '—'
                      : formatCandleCountdown(row.closesAt - nowSeconds)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export const OandaProChart: React.FC = () => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const markersRef = useRef<any>(null);
  const zoneLayerRef = useRef<HTMLDivElement | null>(null);
  const livePriceLabelRef = useRef<HTMLDivElement | null>(null);
  const livePriceValueRef = useRef<HTMLSpanElement | null>(null);
  const liveCountdownRef = useRef<HTMLSpanElement | null>(null);
  const replaySelectionLineRef = useRef<HTMLDivElement | null>(null);
  const zonesRef = useRef<StructureZone[]>([]);
  const swingFibMovesRef = useRef<SwingFibMove[]>([]);
  const structureLinesRef = useRef<StructureLine[]>([]);
  const structureMarkersRef = useRef<any[]>([]);
  const issMarkersRef = useRef<any[]>([]);
  const internalMarkersRef = useRef<any[]>([]);
  const showMgZonesRef = useRef(true);
  const showSupplyDemandRef = useRef(true);
  const showStructureRef = useRef(true);
  const showIssRef = useRef(true);
  const showInternalRef = useRef(true);
  const showFibRef = useRef(true);
  const fibVisibilityRef = useRef<Record<FibVisibilityKey, boolean>>(DEFAULT_FIB_VISIBILITY);
  const fibPreviousVisibilityRef = useRef<Record<FibVisibilityKey, boolean>>(DEFAULT_FIB_VISIBILITY);
  const showInvalidZonesRef = useRef(false);
  const redrawZonesRef = useRef<() => void>(() => undefined);
  const overlayRedrawFrameRef = useRef<number | null>(null);
  const hasFittedRef = useRef(false);
  const replayTimeRef = useRef<number | null>(null);
  const pendingReplayViewportRef = useRef<{ fromOffset: number; toOffset: number } | null>(null);
  const loadRequestIdRef = useRef(0);
  const loadedGranularityRef = useRef<OandaGranularity>('M15');
  const candlesRef = useRef<OandaCandle[]>([]);
  const replaySelectingRef = useRef(false);
  const replaySelectionIndexRef = useRef<number | null>(null);
  const syncReplaySelectionLineRef = useRef<() => void>(() => undefined);
  const [granularity, setGranularity] = useState<OandaGranularity>('M15');
  const [candles, setCandles] = useState<OandaCandle[]>([]);
  const [vipCandles, setVipCandles] = useState<Partial<Record<MarketGranularity, OandaCandle[]>>>({});
  const [hoveredCandle, setHoveredCandle] = useState<OandaCandle | null>(null);
  const [source, setSource] = useState('TradingView WebSocket · OANDA:XAUUSD');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showStructure, setShowStructure] = useState(true);
  const [showMgZones, setShowMgZones] = useState(true);
  const [showSupplyDemand, setShowSupplyDemand] = useState(true);
  const [showIss, setShowIss] = useState(true);
  const [showInternal, setShowInternal] = useState(true);
  const [showFib, setShowFib] = useState(true);
  const [showFibOptions, setShowFibOptions] = useState(false);
  const [showInternalFibOptions, setShowInternalFibOptions] = useState(false);
  const [expandedFibOption, setExpandedFibOption] = useState<FibVisibilityKey | null>(null);
  const [fibVisibility, setFibVisibility] = useState<Record<FibVisibilityKey, boolean>>(
    DEFAULT_FIB_VISIBILITY,
  );
  const [fibPreviousVisibility, setFibPreviousVisibility] = useState<Record<FibVisibilityKey, boolean>>(
    DEFAULT_FIB_VISIBILITY,
  );
  const [showEngulfing, setShowEngulfing] = useState(true);
  const [showInvalidZones, setShowInvalidZones] = useState(false);
  const [showIndicatorControls, setShowIndicatorControls] = useState(false);
  const [showZoneTable, setShowZoneTable] = useState(true);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySelecting, setReplaySelecting] = useState(false);
  const [replaySelectionIndex, setReplaySelectionIndex] = useState<number | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const hasAnyFibMarking = Object.values(fibVisibility).some(Boolean)
    || Object.values(fibPreviousVisibility).some(Boolean);

  candlesRef.current = candles;
  replaySelectingRef.current = replaySelecting;
  replaySelectionIndexRef.current = replaySelectionIndex;

  const syncReplaySelectionLine = useCallback(() => {
    const line = replaySelectionLineRef.current;
    const chart = chartRef.current;
    const host = hostRef.current;
    const selectionIndex = replaySelectionIndexRef.current;
    const currentCandles = candlesRef.current;
    if (!line || !chart || !host || !replaySelectingRef.current
      || selectionIndex === null || !currentCandles[selectionIndex]) {
      if (line) line.style.display = 'none';
      return;
    }
    const coordinate = chart.timeScale().timeToCoordinate(
      currentCandles[selectionIndex].time as UTCTimestamp,
    );
    const rightEdge = Math.max(0, host.clientWidth - 72);
    if (coordinate === null || coordinate < 0 || coordinate > rightEdge) {
      line.style.display = 'none';
      return;
    }
    line.style.display = 'block';
    line.style.left = `${coordinate}px`;
  }, []);

  syncReplaySelectionLineRef.current = syncReplaySelectionLine;

  const displayCandles = useMemo(() => replayIndex === null
    ? candles
    : candles.slice(0, Math.min(candles.length, replayIndex + 1)), [candles, replayIndex]);

  const vipSupportGranularities = VIP_SUPPORT_GRANULARITIES[granularity];
  const auxiliaryGranularities = useMemo(() => Array.from(new Set<MarketGranularity>([
    ...vipSupportGranularities,
    ...TREND_TABLE_GRANULARITIES,
  ])).filter((value) => value !== granularity), [granularity, vipSupportGranularities]);
  const vipSupportContexts = useMemo(() => {
    if (displayCandles.length === 0) return [];
    const lastSourceCandle = displayCandles[displayCandles.length - 1];
    const cutoff = lastSourceCandle.time
      + (lastSourceCandle.complete ? TIMEFRAME_SECONDS[granularity] : 0);
    return vipSupportGranularities.map((supportGranularity) => {
      const completedCandles = (vipCandles[supportGranularity] || []).filter((candle) => (
        candle.complete
        && marketCandleCloseTime(candle.time, supportGranularity) <= cutoff
      ));
      const supportStructure = analyzeMarketStructure(completedCandles, {
        allowSupplyDemand: ['H1', 'H4', 'D', 'W', 'MO'].includes(supportGranularity),
        sourceBarSeconds: TIMEFRAME_SECONDS[supportGranularity],
        confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[supportGranularity],
        zoneVisualBars: 30,
      });
      return {
        timeframe: GRANULARITY_LABELS[supportGranularity],
        zones: supportStructure.zones,
      };
    });
  }, [displayCandles, granularity, vipCandles, vipSupportGranularities]);

  const structure = useMemo(
    () => analyzeMarketStructure(displayCandles, {
      allowSupplyDemand: ['H1', 'H4', 'D'].includes(granularity),
      sourceBarSeconds: TIMEFRAME_SECONDS[granularity],
      confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[granularity],
      zoneVisualBars: 30,
      vipSupport: vipSupportContexts,
    }),
    [displayCandles, granularity, vipSupportContexts],
  );

  const swingFibMoves = useMemo(() => {
    if (granularity !== 'H4') return [];
    const seedLine = structure.lines
      .filter((line) => line.type === 'swing'
        && line.fromTime !== line.toTime
        && line.fromPrice !== line.toPrice)
      .sort((first, second) => first.toTime - second.toTime)[0];
    if (!seedLine) return [];

    return buildAlternatingSwingFibs(displayCandles, {
      sourceTime: seedLine.fromTime,
      sourcePrice: seedLine.fromPrice,
      zeroTime: seedLine.toTime,
      zeroPrice: seedLine.toPrice,
    });
  }, [displayCandles, granularity, structure.lines]);

  const restorePresentChartView = useCallback(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host || displayCandles.length === 0) return;
    const lastIndex = displayCandles.length - 1;
    const plotWidth = Math.max(
      PRESENT_VIEW_BAR_SPACING * 72,
      host.clientWidth - PRESENT_VIEW_PRICE_SCALE_WIDTH,
    );
    const totalVisibleSlots = Math.max(
      72,
      Math.floor(plotWidth / PRESENT_VIEW_BAR_SPACING),
    );
    const rightOffset = Math.max(
      12,
      Math.round(totalVisibleSlots * PRESENT_VIEW_RIGHT_GAP_RATIO),
    );
    const visibleCandleCount = Math.max(
      48,
      totalVisibleSlots - rightOffset,
    );
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, lastIndex - visibleCandleCount + 1),
      to: lastIndex + rightOffset,
    });
    window.requestAnimationFrame(() => {
      redrawZonesRef.current();
      syncReplaySelectionLineRef.current();
    });
  }, [displayCandles.length]);

  const trendTableRows = useMemo<TrendTableRow[]>(() => {
    const replayCutoff = replayIndex === null || displayCandles.length === 0
      ? undefined
      : displayCandles[displayCandles.length - 1].time
        + (displayCandles[displayCandles.length - 1].complete ? TIMEFRAME_SECONDS[granularity] : 0);

    return TREND_TABLE_GRANULARITIES.map((tableGranularity) => {
      const availableCandles = tableGranularity === granularity
        ? displayCandles
        : vipCandles[tableGranularity] || [];
      const timeframeCandles = replayCutoff === undefined
        ? availableCandles
        : availableCandles.filter((candle) => candle.time <= replayCutoff);
      const tableStructure = tableGranularity === granularity
        ? structure
        : analyzeMarketStructure(timeframeCandles, {
          allowSupplyDemand: ['H1', 'H4', 'D'].includes(tableGranularity),
          sourceBarSeconds: TIMEFRAME_SECONDS[tableGranularity],
          confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[tableGranularity],
          zoneVisualBars: 30,
        });
      const latestTimeframeCandle = timeframeCandles[timeframeCandles.length - 1];
      return {
        granularity: tableGranularity,
        label: TREND_TABLE_LABELS[tableGranularity],
        trend: tableStructure.trend,
        closesAt: latestTimeframeCandle
          ? marketCandleCloseTime(latestTimeframeCandle.time, tableGranularity)
          : undefined,
      };
    });
  }, [displayCandles, granularity, replayIndex, structure, vipCandles]);

  const latestCandle = hoveredCandle || displayCandles[displayCandles.length - 1] || null;
  const previousCandle = displayCandles.length > 1 ? displayCandles[displayCandles.length - 2] : null;
  const zoneTableRows = useMemo(() => structure.zones
    .filter((zone) => zone.active && zone.status === 'valid'
      && (showInternal || zone.category !== 'internal')
      && zone.doubleChochStatus === undefined
      && zone.tapTime !== undefined && (zone.tapBarsAgo ?? Infinity) <= 50)
    .sort((a, b) => (b.tapTime ?? b.startTime) - (a.tapTime ?? a.startTime))
    .slice(0, 8), [showInternal, structure.zones]);
  const latestDisplayCandleTime = displayCandles[displayCandles.length - 1]?.time;
  const doubleChochRows = useMemo(() => structure.zones
    .filter((zone) => zone.active && zone.status === 'valid'
      && zone.doubleChochStatus !== undefined
      && (zone.tapTime !== undefined
        ? (zone.tapBarsAgo ?? Infinity) <= 50
        : zone.doubleChochStatus === 'pending'
          ? zone.name === 'SBR' || zone.name === 'RBS'
          : (zone.name === 'SBR' || zone.name === 'RBS')
            && zone.doubleChochConfirmationTime !== undefined
            && latestDisplayCandleTime !== undefined
            && latestDisplayCandleTime + TIMEFRAME_SECONDS[granularity]
              === zone.doubleChochConfirmationTime))
    .sort((a, b) => (b.tapTime ?? b.doubleChochTime ?? b.startTime)
      - (a.tapTime ?? a.doubleChochTime ?? a.startTime)
      || b.startTime - a.startTime)
    .slice(0, 8), [granularity, latestDisplayCandleTime, structure.zones]);
  const pendingConfirmationRows = useMemo(() => structure.zones
    .filter((zone) => (zone.name === 'TJL1' || zone.name === 'ISS L3' || zone.name === 'Internal TJL1')
      && zone.active && zone.status === 'pending'
      && (showInternal || zone.category !== 'internal'))
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 4), [showInternal, structure.zones]);
  const change = latestCandle && previousCandle ? latestCandle.close - previousCandle.close : 0;
  const changePercent = latestCandle && previousCandle && previousCandle.close
    ? change / previousCandle.close * 100
    : 0;

  const redrawZones = useCallback(() => {
    const layer = zoneLayerRef.current;
    const host = hostRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!layer || !host || !chart || !series) return;
    if (displayCandles.length === 0) {
      layer.replaceChildren();
      return;
    }

    const fragment = document.createDocumentFragment();
    const candleByTime = new Map<number, OandaCandle>(displayCandles.map((candle) => (
      [Number(candle.time), candle] as [number, OandaCandle]
    )));
    const rightEdge = Math.max(0, host.clientWidth - 72);
    for (const zone of zonesRef.current) {
      const visible = zone.category === 'mg'
        ? showMgZonesRef.current
        : zone.category === 'iss'
          ? showIssRef.current
          : zone.category === 'internal'
            ? showInternalRef.current
            : showSupplyDemandRef.current;
      if (!visible) continue;
      if (!zone.active && !showInvalidZonesRef.current) continue;
      const rawLeft = chart.timeScale().timeToCoordinate(zone.startTime as UTCTimestamp);
      const rawRight = chart.timeScale().timeToCoordinate(zone.endTime as UTCTimestamp);
      const top = series.priceToCoordinate(zone.top);
      const bottom = series.priceToCoordinate(zone.bottom);
      if (top === null || bottom === null) continue;
      const left = Math.max(0, rawLeft === null ? 0 : rawLeft);
      const right = Math.min(rightEdge, rawRight === null ? rightEdge : rawRight);
      if (left >= right || right <= 0) continue;

      const box = document.createElement('div');
      const demand = zone.isBuy;
      const isIss = zone.category === 'iss';
      const isInternal = zone.category === 'internal';
      const isMg = zone.category === 'mg';
      // Like TJL1, show HTF confirmation state only on the zone whose break
      // actually confirmed Double CHoCH (SBR for bearish, RBS for bullish).
      const showsDoubleChochStatus = zone.doubleChochStatus !== undefined
        && (zone.name === 'SBR' || zone.name === 'RBS');
      const pending = zone.status === 'pending'
        || (showsDoubleChochStatus && zone.doubleChochStatus === 'pending');
      const confirmationLabel = TJL1_CONFIRMATION_LABELS[granularity];
      const inactive = !zone.active;
      const rejected = zone.status === 'rejected';
      const fill = inactive
        ? 'rgba(100, 116, 139, 0.10)'
        : pending
        ? demand ? 'rgba(16, 185, 129, 0.13)' : 'rgba(244, 63, 94, 0.12)'
        : isIss
        ? 'rgba(217, 119, 6, 0.14)'
        : isInternal
        ? 'rgba(124, 58, 237, 0.12)'
        : demand ? 'rgba(16, 185, 129, 0.13)' : 'rgba(244, 63, 94, 0.12)';
      const border = inactive
        ? 'rgba(71, 85, 105, 0.72)'
        : pending ? demand ? 'rgba(5, 150, 105, 0.72)' : 'rgba(225, 29, 72, 0.72)' : isIss ? 'rgba(180, 83, 9, 0.72)' : isInternal ? 'rgba(109, 40, 217, 0.72)' : demand ? 'rgba(5, 150, 105, 0.65)' : 'rgba(225, 29, 72, 0.65)';
      box.style.position = 'absolute';
      box.style.left = `${left}px`;
      box.style.width = `${right - left}px`;
      box.style.top = `${Math.min(top, bottom)}px`;
      box.style.height = `${Math.max(2, Math.abs(bottom - top))}px`;
      box.style.background = fill;
      box.style.borderTop = `1px solid ${border}`;
      box.style.borderBottom = `1px solid ${border}`;

      const label = document.createElement('span');
      const name = isMg || isIss || isInternal ? displayZoneName(zone.name) : demand ? 'DEMAND' : 'SUPPLY';
      label.textContent = inactive
        ? rejected ? `${name} · REJECTED` : name
        : `${name}${pending ? ' · PENDING' : zone.name === 'TJL1' ? ' · VALID' : ''}`;
      if (inactive) {
        label.textContent = rejected ? `${name} \u00b7 REJECTED` : name;
      } else if (showsDoubleChochStatus) {
        label.textContent = zone.doubleChochStatus === 'pending'
          ? `${name} · DOUBLE CHoCH · PENDING ${confirmationLabel} ${zone.doubleChochConfirmationDirection === 'up' ? 'ABOVE' : 'BELOW'}`
          : `${name} · VALID DOUBLE CHoCH`;
      } else if (zone.name === 'TJL1' || zone.name === 'ISS L3' || zone.name === 'Internal TJL1') {
        label.textContent = pending
          ? `${name} · PENDING ${confirmationLabel} ${zone.isBuy ? 'ABOVE' : 'BELOW'}`
          : `VALID ${name}`;
      } else if (zone.name === 'TJL2') {
        label.textContent = 'TJL2';
      } else if (isInternal && zone.chochClass) {
        const internalClass = zone.chochClass === 'pending' ? 'WAIT' : zone.chochClass.toUpperCase();
        label.textContent = `${name} · INT CHoCH · ${internalClass}`;
      }
      if (!inactive && showFibRef.current && zone.fibStatus === 'a-plus'
        && zone.fibBand && zone.fibBand !== 'DB/DT') {
        label.textContent = `${label.textContent} · ${displayFibLabel(zone)}`;
      }
      label.style.position = 'absolute';
      label.style.right = '4px';
      label.style.top = '2px';
      label.style.fontSize = '9px';
      label.style.lineHeight = '12px';
      label.style.fontWeight = '800';
      label.style.color = inactive ? '#475569' : pending ? demand ? '#047857' : '#be123c' : isIss ? '#b45309' : isInternal ? '#6d28d9' : demand ? '#047857' : '#be123c';
      box.appendChild(label);
      fragment.appendChild(box);
    }

    const hasVisibleFibMarking = Object.values(fibVisibilityRef.current).some(Boolean)
      || Object.values(fibPreviousVisibilityRef.current).some(Boolean);
    if (showStructureRef.current || showIssRef.current || showInternalRef.current
      || (showFibRef.current && hasVisibleFibMarking)) {
      const namespace = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(namespace, 'svg');
      svg.setAttribute('width', String(host.clientWidth));
      svg.setAttribute('height', String(host.clientHeight));
      svg.style.position = 'absolute';
      svg.style.inset = '0';
      svg.style.overflow = 'hidden';

      if (showFibRef.current && hasVisibleFibMarking) {
        const fibLevels = [
          { ratio: 0, label: '0' },
          { ratio: 0.5, label: '0.5' },
          { ratio: 0.618, label: '0.618' },
          { ratio: 0.71, label: '0.71' },
          { ratio: 0.79, label: '0.79' },
          { ratio: 1, label: '1' },
        ];

        const fibMovesByType = new Map<FibVisibilityKey, StructureZone[]>();
        for (const zone of zonesRef.current) {
          const type = fibVisibilityKey(zone);
          const isIssWaveFib = type === 'iss' && zone.name === 'ISS L3'
            && zone.issPoint0Time !== undefined;
          const isInternalChochFib = type === 'intChoch'
            && zone.category === 'internal'
            && zone.chochTime !== undefined;
          if (type === 'iss' && !isIssWaveFib) continue;
          if (type === 'intChoch' && !isInternalChochFib) continue;
          if (!zone.active && !showInvalidZonesRef.current && !isIssWaveFib) continue;
          if (!zone.fibRelevant || !isFibMarkingVisible(
            zone,
            showFibRef.current,
            fibVisibilityRef.current,
            fibPreviousVisibilityRef.current,
          )) continue;
          if (zone.fibSourceTime === undefined || zone.fibSourcePrice === undefined
            || zone.fibZeroTime === undefined || zone.fibZeroPrice === undefined) continue;

          const typeMoves = fibMovesByType.get(type) ?? [];
          typeMoves.push(zone);
          fibMovesByType.set(type, typeMoves);
        }

        if (fibVisibilityRef.current.swing || fibPreviousVisibilityRef.current.swing) {
          const swingZones = swingFibMovesRef.current.map<StructureZone>((move) => ({
            id: `swing-fib-${move.startedAt}-${move.direction}`,
            name: move.direction === 'up' ? 'DEMAND' : 'SUPPLY',
            category: 'supplyDemand',
            isBuy: move.direction === 'up',
            startTime: move.startedAt,
            endTime: move.zeroTime,
            top: Math.max(move.sourcePrice, move.zeroPrice),
            bottom: Math.min(move.sourcePrice, move.zeroPrice),
            active: true,
            status: 'valid',
            fibRelevant: true,
            fibSourceTime: move.sourceTime,
            fibSourcePrice: move.sourcePrice,
            fibZeroTime: move.zeroTime,
            fibZeroPrice: move.zeroPrice,
          }));
          fibMovesByType.set('swing', swingZones);
        }

        const latestFibMoves = [...fibMovesByType.entries()].flatMap(([type, typeMoves]) => {
          const distinctMoves = new Set<string>();
          const orderedMoves = typeMoves
            .sort((first, second) => {
              const firstEventTime = first.issCompletionTime
                ?? first.doubleChochTime ?? first.chochTime ?? first.startTime;
              const secondEventTime = second.issCompletionTime
                ?? second.doubleChochTime ?? second.chochTime ?? second.startTime;
              return secondEventTime - firstEventTime || second.startTime - first.startTime;
            })
            .filter((zone) => {
              const moveKey = [
                zone.fibSourceTime,
                zone.fibSourcePrice,
                zone.fibZeroTime,
                zone.fibZeroPrice,
              ].join(':');
              if (distinctMoves.has(moveKey)) return false;
              distinctMoves.add(moveKey);
              return true;
            });
          return [
            fibVisibilityRef.current[type] ? orderedMoves[0] : undefined,
            type !== 'tjl1' && type !== 'tjl2' && type !== 'intTjl1' && type !== 'intTjl2'
              && type !== 'doubleChoch' && type !== 'iss'
              && fibPreviousVisibilityRef.current[type]
              ? orderedMoves[1]
              : undefined,
          ].filter((zone): zone is StructureZone => zone !== undefined);
        });

        for (const zone of latestFibMoves) {
          const sourceX = chart.timeScale().timeToCoordinate(zone.fibSourceTime as UTCTimestamp);
          const zeroX = chart.timeScale().timeToCoordinate(zone.fibZeroTime as UTCTimestamp);
          const sourceY = series.priceToCoordinate(zone.fibSourcePrice);
          const zeroY = series.priceToCoordinate(zone.fibZeroPrice);
          if (sourceX === null || zeroX === null || sourceY === null || zeroY === null) continue;

          const lineLeft = Math.min(sourceX, zeroX);
          const lineRight = Math.max(sourceX, zeroX);
          if (lineRight < 0 || lineLeft > rightEdge) continue;

          for (const level of fibLevels) {
            const price = zone.fibZeroPrice
              + (zone.fibSourcePrice - zone.fibZeroPrice) * level.ratio;
            const y = series.priceToCoordinate(price);
            if (y === null || y < -20 || y > host.clientHeight + 20) continue;

            const levelLine = document.createElementNS(namespace, 'line');
            levelLine.setAttribute('x1', String(lineLeft));
            levelLine.setAttribute('y1', String(y));
            levelLine.setAttribute('x2', String(lineRight));
            levelLine.setAttribute('y2', String(y));
            levelLine.setAttribute('stroke', '#e11d48');
            levelLine.setAttribute('stroke-width', level.ratio === 0 || level.ratio === 1 ? '1.2' : '1');
            levelLine.setAttribute('stroke-opacity', '0.82');
            svg.appendChild(levelLine);

            const levelText = document.createElementNS(namespace, 'text');
            levelText.setAttribute('x', String(Math.max(18, lineLeft - 7)));
            levelText.setAttribute('y', String(y + 3));
            levelText.setAttribute('text-anchor', 'end');
            levelText.setAttribute('fill', '#e11d48');
            levelText.setAttribute('fill-opacity', '0.9');
            levelText.setAttribute('font-size', '9');
            levelText.setAttribute('font-weight', '700');
            levelText.textContent = level.label;
            svg.appendChild(levelText);
          }

          const anchorLine = document.createElementNS(namespace, 'line');
          anchorLine.setAttribute('x1', String(sourceX));
          anchorLine.setAttribute('y1', String(sourceY));
          anchorLine.setAttribute('x2', String(zeroX));
          anchorLine.setAttribute('y2', String(zeroY));
          anchorLine.setAttribute('stroke', '#f43f5e');
          anchorLine.setAttribute('stroke-width', '1.2');
          anchorLine.setAttribute('stroke-opacity', '0.82');
          anchorLine.setAttribute('stroke-dasharray', '7 6');
          svg.appendChild(anchorLine);

          for (const anchor of [{ x: sourceX, y: sourceY }, { x: zeroX, y: zeroY }]) {
            const circle = document.createElementNS(namespace, 'circle');
            circle.setAttribute('cx', String(anchor.x));
            circle.setAttribute('cy', String(anchor.y));
            circle.setAttribute('r', '4');
            circle.setAttribute('fill', '#ffffff');
            circle.setAttribute('stroke', '#2563eb');
            circle.setAttribute('stroke-width', '1.4');
            svg.appendChild(circle);
          }
        }
      }

      for (const structureLine of structureLinesRef.current) {
        const isInternalLine = structureLine.type.startsWith('internal-');
        if (structureLine.type === 'iss' && !showIssRef.current) continue;
        if (isInternalLine && !showInternalRef.current) continue;
        if (structureLine.type !== 'iss' && !isInternalLine && !showStructureRef.current) continue;
        const x1 = chart.timeScale().timeToCoordinate(structureLine.fromTime as UTCTimestamp);
        const x2 = chart.timeScale().timeToCoordinate(structureLine.toTime as UTCTimestamp);
        const y1 = series.priceToCoordinate(structureLine.fromPrice);
        const y2 = series.priceToCoordinate(structureLine.toPrice);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

        const bullish = structureLine.direction === 'bullish';
        const isIssLine = structureLine.type === 'iss';
        const color = isIssLine ? '#d97706' : isInternalLine ? '#7c3aed' : bullish ? '#0f766e' : '#be123c';
        const line = document.createElementNS(namespace, 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', color);
        const isSwing = structureLine.type === 'swing' || structureLine.type === 'internal-swing';
        line.setAttribute('stroke-width', isIssLine ? '0.8' : isSwing ? '1' : '0.8');
        line.setAttribute('stroke-opacity', isIssLine ? '0.74' : isInternalLine ? '0.68' : isSwing ? '0.52' : '0.42');
        if (!isSwing && !isIssLine) line.setAttribute('stroke-dasharray', '4 3');
        svg.appendChild(line);

        if (structureLine.label) {
          const text = document.createElementNS(namespace, 'text');
          text.setAttribute('x', String((x1 + x2) / 2));
          text.setAttribute('y', String(y1 - 5));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('fill', color);
          text.setAttribute('fill-opacity', '0.55');
          text.setAttribute('font-size', '8');
          text.setAttribute('font-weight', '600');
          text.textContent = structureLine.label;
          svg.appendChild(text);
        }
      }

      // ISS point labels are drawn at the real wick coordinate. Series markers
      // are deliberately not used here because they place a large circle away
      // from the candle and make it look like the point belongs elsewhere.
      if (showIssRef.current) {
        for (const marker of issMarkersRef.current) {
          const candle = candleByTime.get(Number(marker.time));
          if (!candle) continue;
          const x = chart.timeScale().timeToCoordinate(marker.time as UTCTimestamp);
          const isHigh = marker.position === 'aboveBar';
          const markerPrice = typeof marker.pivotPrice === 'number'
            ? marker.pivotPrice
            : isHigh ? candle.high : candle.low;
          const y = series.priceToCoordinate(markerPrice);
          if (x === null || y === null) continue;
          const overlapsStructureMarker = showStructureRef.current
            && structureMarkersRef.current.some((structureMarker) => (
              Number(structureMarker.time) === Number(marker.time)
              && structureMarker.position === marker.position
            ));
          const overlapsVisibleZone = zonesRef.current.some((zone) => {
            const visible = zone.category === 'mg'
              ? showMgZonesRef.current
              : zone.category === 'iss'
                ? showIssRef.current
                : zone.category === 'internal'
                  ? showInternalRef.current
                  : showSupplyDemandRef.current;
            return visible
              && (zone.active || showInvalidZonesRef.current)
              && Number(marker.time) >= zone.startTime
              && Number(marker.time) <= zone.endTime
              && markerPrice >= zone.bottom
              && markerPrice <= zone.top;
          });
          const offsetForCollision = overlapsStructureMarker || overlapsVisibleZone;
          // Keep every ISS number outside its pivot wick. If a structure marker
          // or zone label occupies that side, move it farther vertically rather
          // than sideways so it remains centered on the correct candle.
          const markerOffset = offsetForCollision ? 38 : 24;
          const text = document.createElementNS(namespace, 'text');
          text.setAttribute('x', String(x));
          text.setAttribute('y', String(y + (isHigh ? -markerOffset : markerOffset)));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          text.setAttribute('fill', marker.color || '#d97706');
          text.setAttribute('fill-opacity', '0.95');
          text.setAttribute('font-size', '11');
          text.setAttribute('font-weight', '700');
          text.textContent = marker.text;
          svg.appendChild(text);
        }
      }
      fragment.appendChild(svg);
    }
    // Swap the complete overlay in one operation so the browser does not
    // perform layout work for every individual zone, line, and label.
    layer.replaceChildren(fragment);
  }, [displayCandles.length, granularity]);

  redrawZonesRef.current = redrawZones;

  const scheduleOverlayRedraw = useCallback(() => {
    if (overlayRedrawFrameRef.current !== null) return;
    overlayRedrawFrameRef.current = window.requestAnimationFrame(() => {
      overlayRedrawFrameRef.current = null;
      redrawZonesRef.current();
    });
  }, []);

  useEffect(() => {
    zonesRef.current = structure.zones;
    swingFibMovesRef.current = swingFibMoves;
    structureLinesRef.current = structure.lines;
    structureMarkersRef.current = structure.markers;
    issMarkersRef.current = structure.issMarkers;
    internalMarkersRef.current = structure.internalMarkers;
    showMgZonesRef.current = showMgZones;
    showSupplyDemandRef.current = showSupplyDemand;
    showStructureRef.current = showStructure;
    showIssRef.current = showIss;
    showInternalRef.current = showInternal;
    showFibRef.current = showFib;
    fibVisibilityRef.current = fibVisibility;
    fibPreviousVisibilityRef.current = fibPreviousVisibility;
    showInvalidZonesRef.current = showInvalidZones;
    scheduleOverlayRedraw();
  }, [fibPreviousVisibility, fibVisibility, redrawZones, scheduleOverlayRedraw, showFib, showInternal, showInvalidZones, showIss, showMgZones, showStructure, showSupplyDemand, structure.internalMarkers, structure.issMarkers, structure.lines, structure.markers, structure.zones, swingFibMoves]);

  useEffect(() => {
    if (granularity !== 'H4' && expandedFibOption === 'swing') {
      setExpandedFibOption(null);
    }
  }, [expandedFibOption, granularity]);

  useEffect(() => {
    if (!replayPlaying || replayIndex === null) return;
    const timer = window.setInterval(() => {
      setReplayIndex((index) => {
        if (index === null || index >= candles.length - 1) {
          setReplayPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, Math.round(550 / replaySpeed));
    return () => window.clearInterval(timer);
  }, [candles.length, replayIndex, replayPlaying, replaySpeed]);

  useEffect(() => {
    if (replayIndex === null) return;
    const replayCandle = candles[Math.min(replayIndex, candles.length - 1)];
    if (replayCandle) replayTimeRef.current = replayCandle.time;
  }, [candles, replayIndex]);

  const loadCandles = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRequestIdRef.current;
    const replayTime = replayTimeRef.current;
    setIsLoading(true);
    try {
      const requestCandles = async (requestedGranularity: MarketGranularity) => {
        const query = new URLSearchParams({
          granularity: requestedGranularity,
          count: '1500',
        });
        if (replayTime !== null) query.set('endTime', String(replayTime));
        const response = await fetch(`/api/tradingview/market-data?${query}`, {
          signal,
          cache: 'no-store',
        });
        const payload = await response.json() as MarketDataResponse;
        if (!response.ok || !payload.ok || !Array.isArray(payload.candles)) {
          throw new Error(payload.error || `TradingView request failed with HTTP ${response.status}`);
        }
        return payload;
      };
      // Prioritize the selected chart. Opening seven unofficial TradingView
      // sockets at once made the main timeframe wait behind slower auxiliary
      // requests even though those are only needed for VIP/trend context.
      const payload = await requestCandles(granularity);
      if (requestId !== loadRequestIdRef.current) return;
      if (payload.candles.length === 0) throw new Error('TradingView returned no candles for OANDA:XAUUSD.');
      const nextReplayIndex = replayTime === null
        ? null
        : findReplayIndexAtOrBefore(payload.candles, replayTime);
      if (replayTime !== null && nextReplayIndex === null) {
        throw new Error(`The selected replay date is not available on ${GRANULARITY_LABELS[granularity]}.`);
      }
      loadedGranularityRef.current = granularity;
      setCandles(payload.candles);
      if (nextReplayIndex !== null) setReplayIndex(nextReplayIndex);
      setHoveredCandle(null);
      setSource(payload.source || 'TradingView WebSocket · OANDA:XAUUSD · unofficial');
      setLastUpdated(payload.fetchedAt || new Date().toISOString());
      setError(null);
      setIsLoading(false);

      // Supporting timeframes load after the visible chart. Their final data
      // and all resulting structure calculations are identical to before.
      const auxiliaryPayloads = await Promise.all(auxiliaryGranularities.map(requestCandles));
      if (requestId !== loadRequestIdRef.current) return;
      setVipCandles(Object.fromEntries(auxiliaryGranularities.map((supportGranularity, index) => (
        [supportGranularity, auxiliaryPayloads[index]?.candles || []]
      ))));
    } catch (loadError) {
      if ((loadError as Error).name !== 'AbortError') {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load TradingView candles.');
        if (requestId === loadRequestIdRef.current && replayTime !== null) {
          pendingReplayViewportRef.current = null;
          setGranularity(loadedGranularityRef.current);
        }
      }
    } finally {
      if (!signal?.aborted && requestId === loadRequestIdRef.current) setIsLoading(false);
    }
  }, [auxiliaryGranularities, granularity]);

  useEffect(() => {
    const controller = new AbortController();
    hasFittedRef.current = false;
    void loadCandles(controller.signal);
    const interval = window.setInterval(() => {
      if (replayTimeRef.current === null) void loadCandles();
    }, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadCandles, refreshKey]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#475569',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#eef2f7' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#64748b', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#334155' },
        horzLine: { color: '#64748b', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#334155' },
      },
      rightPriceScale: {
        borderColor: '#e2e8f0',
        scaleMargins: { top: 0.08, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#e2e8f0',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: PRESENT_VIEW_BAR_SPACING,
        minBarSpacing: 1.5,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#089981',
      downColor: '#f23645',
      borderUpColor: '#089981',
      borderDownColor: '#f23645',
      wickUpColor: '#089981',
      wickDownColor: '#f23645',
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: '#64748b',
      priceLineStyle: LineStyle.Dotted,
    });
    const seriesMarkers = createSeriesMarkers(candleSeries, []);
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    chart.subscribeCrosshairMove((parameter: any) => {
      const point = parameter.seriesData?.get(candleSeries);
      if (!point || typeof point.open !== 'number') {
        setHoveredCandle(null);
        return;
      }
      const timestamp = typeof parameter.time === 'number' ? parameter.time : 0;
      setHoveredCandle({
        time: timestamp,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        volume: 0,
        complete: true,
      });
    });

    const observer = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
      scheduleOverlayRedraw();
      window.requestAnimationFrame(() => syncReplaySelectionLineRef.current());
    });
    const handleVisibleRangeChange = () => {
      scheduleOverlayRedraw();
      syncReplaySelectionLineRef.current();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    observer.observe(host);
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    markersRef.current = seriesMarkers;
    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      if (overlayRedrawFrameRef.current !== null) {
        window.cancelAnimationFrame(overlayRedrawFrameRef.current);
        overlayRedrawFrameRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
    };
  }, [scheduleOverlayRedraw]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncReplaySelectionLine);
    return () => window.cancelAnimationFrame(frame);
  }, [candles, replaySelecting, replaySelectionIndex, syncReplaySelectionLine]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || displayCandles.length === 0) return;
    candleSeries.setData(displayCandles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })));
    volumeSeries.setData(displayCandles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: candle.volume,
      color: candle.close >= candle.open ? 'rgba(8, 153, 129, 0.3)' : 'rgba(242, 54, 69, 0.3)',
    })));
    markersRef.current?.setMarkers([
      ...(showStructure ? structure.markers : []),
      ...(showInternal ? structure.internalMarkers : []),
      ...(showEngulfing ? structure.engulfingMarkers : []),
    ].sort((a: any, b: any) => Number(a.time) - Number(b.time)));
    const pendingViewport = pendingReplayViewportRef.current;
    if (replayIndex !== null && pendingViewport && loadedGranularityRef.current === granularity) {
      const replayLogicalIndex = displayCandles.length - 1;
      chart.timeScale().setVisibleLogicalRange({
        from: replayLogicalIndex + pendingViewport.fromOffset,
        to: replayLogicalIndex + pendingViewport.toOffset,
      });
      pendingReplayViewportRef.current = null;
      hasFittedRef.current = true;
    } else if (!hasFittedRef.current) {
      restorePresentChartView();
      hasFittedRef.current = true;
    }
    scheduleOverlayRedraw();
  }, [displayCandles, replayIndex, restorePresentChartView, scheduleOverlayRedraw, showEngulfing, showInternal, showIss, showStructure, structure.engulfingMarkers, structure.internalMarkers, structure.issMarkers, structure.markers]);

  useEffect(() => {
    const label = livePriceLabelRef.current;
    const priceValue = livePriceValueRef.current;
    const countdown = liveCountdownRef.current;
    if (!label || !priceValue || !countdown) return;

    const updateLiveCountdown = () => {
      const series = candleSeriesRef.current;
      const host = hostRef.current;
      const liveCandle = candles[candles.length - 1];
      if (replayIndex !== null || !series || !host || !liveCandle) {
        label.style.display = 'none';
        return;
      }

      const coordinate = series.priceToCoordinate(liveCandle.close);
      if (coordinate === null) {
        label.style.display = 'none';
        return;
      }

      const closesAt = liveCandle.time + TIMEFRAME_SECONDS[granularity];
      const remaining = closesAt - Date.now() / 1000;
      const rising = liveCandle.close >= liveCandle.open;
      label.style.display = 'flex';
      label.style.top = `${Math.max(22, Math.min(host.clientHeight - 22, coordinate))}px`;
      label.style.backgroundColor = rising ? '#089981' : '#f23645';
      priceValue.textContent = formatPrice(liveCandle.close);
      countdown.textContent = formatCandleCountdown(remaining);
    };

    updateLiveCountdown();
    const timer = window.setInterval(updateLiveCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [candles, granularity, replayIndex]);

  const toggleFullscreen = async () => {
    const element = hostRef.current?.parentElement?.parentElement;
    if (!element) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await element.requestFullscreen();
  };

  const openReplaySelector = () => {
    if (candles.length < 2) return;
    setReplayPlaying(false);
    setReplaySelectionIndex(replayIndex ?? Math.max(1, candles.length - 10));
    setReplaySelecting(true);
  };

  const beginReplay = () => {
    if (candles.length < 2) return;
    const nextReplayIndex = replaySelectionIndex ?? Math.max(1, candles.length - 10);
    setReplayPlaying(false);
    replayTimeRef.current = candles[nextReplayIndex]?.time ?? null;
    setReplayIndex(nextReplayIndex);
    setReplaySelecting(false);
    hasFittedRef.current = false;
  };

  const exitReplay = () => {
    setReplayPlaying(false);
    replayTimeRef.current = null;
    pendingReplayViewportRef.current = null;
    setReplayIndex(null);
    setReplaySelecting(false);
    setReplaySelectionIndex(null);
    hasFittedRef.current = false;
    setRefreshKey((value) => value + 1);
  };

  const changeTimeframe = (nextGranularity: OandaGranularity) => {
    if (nextGranularity === granularity) return;
    if (replayIndex !== null) {
      const replayCandle = candles[Math.min(replayIndex, candles.length - 1)];
      if (replayCandle) replayTimeRef.current = replayCandle.time;
      const visibleRange = chartRef.current?.timeScale().getVisibleLogicalRange();
      const replayLogicalIndex = displayCandles.length - 1;
      if (visibleRange && replayLogicalIndex >= 0) {
        pendingReplayViewportRef.current = {
          fromOffset: visibleRange.from - replayLogicalIndex,
          toOffset: visibleRange.to - replayLogicalIndex,
        };
      }
      setReplayPlaying(false);
    } else {
      setReplaySelecting(false);
      setReplaySelectionIndex(null);
    }
    setGranularity(nextGranularity);
  };

  const selectReplayBar = (event: React.PointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host || candles.length < 2) return;
    const coordinate = event.clientX - host.getBoundingClientRect().left;
    const logicalIndex = chart.timeScale().coordinateToLogical(coordinate);
    if (logicalIndex === null || !Number.isFinite(logicalIndex)) return;
    setReplaySelectionIndex(Math.max(
      1,
      Math.min(candles.length - 1, Math.round(logicalIndex)),
    ));
  };

  const renderFibOptionButton = (option: { key: FibVisibilityKey; label: string }) => {
    const isSingleMarking = isSingleFibMarkingKey(option.key);
    const isUnavailable = option.key === 'swing' && granularity !== 'H4';
    const latestOn = fibVisibility[option.key];
    const previousOn = fibPreviousVisibility[option.key];
    const status = isUnavailable
      ? '4H'
      : isSingleMarking
      ? latestOn ? 'ON' : 'OFF'
      : latestOn && previousOn
        ? 'BOTH'
        : latestOn ? 'LATEST' : previousOn ? 'PREV' : 'OFF';
    const active = !isUnavailable && (latestOn || (!isSingleMarking && previousOn));
    return (
      <button
        key={option.key}
        type="button"
        disabled={isUnavailable}
        onClick={() => {
          if (isSingleMarking) {
            setFibVisibility((current) => ({
              ...current,
              [option.key]: !current[option.key],
            }));
            setFibPreviousVisibility((current) => ({
              ...current,
              [option.key]: false,
            }));
            setExpandedFibOption((current) => current === option.key ? null : current);
            return;
          }
          setExpandedFibOption((current) => current === option.key ? null : option.key);
        }}
        className={`flex h-7 items-center justify-between rounded-md border px-1.5 text-[8px] font-black leading-none transition ${
          isUnavailable
            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
            : expandedFibOption === option.key
            ? 'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800'
            : active
              ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'
              : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
        }`}
        title={isUnavailable
          ? 'Swing FIB marking is available only on the 4H chart'
          : isSingleMarking
          ? `Show or hide the single current ${option.label.replace(' MARKING', '')} FIB marking`
          : `Choose latest or previous ${option.label}`}
        aria-expanded={isSingleMarking ? undefined : expandedFibOption === option.key}
      >
        <span className="whitespace-nowrap">{option.label.replace(' MARKING', '')}</span>
        <span className={`ml-1 rounded-full px-1 py-0.5 text-[8px] ${
          active ? 'bg-fuchsia-200 text-fuchsia-800' : 'bg-slate-200 text-slate-500'
        }`}>
          {status}
        </span>
      </button>
    );
  };

  return (
    <section className="h-full w-full bg-slate-100 p-3 sm:p-4 overflow-hidden">
      <div className="h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2.5 py-1.5 bg-white">
          <div className="flex items-center gap-1.5 pr-2 border-r border-slate-200">
            <div className="h-7 w-7 rounded-full bg-amber-100 text-amber-700 grid place-items-center text-xs font-black">Au</div>
            <div>
              <div className="text-[13px] font-black text-slate-900 leading-tight">Gold Spot / U.S. Dollar</div>
              <div className="text-[9px] font-bold tracking-wider text-slate-500">XAUUSD · OANDA</div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {TIMEFRAMES.map((timeframe) => (
              <button
                key={timeframe.value}
                onClick={() => changeTimeframe(timeframe.value)}
                className={`rounded-md px-2 py-1 text-[11px] font-black transition ${
                  granularity === timeframe.value
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                {timeframe.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
            {replayIndex === null ? (
              <button
                onClick={openReplaySelector}
                disabled={candles.length < 2}
                className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[9px] font-black text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Choose a chart bar, then start candle-by-candle replay from that point"
              >
                ▶ REPLAY
              </button>
            ) : (
              <>
                <button
                  onClick={() => setReplayIndex((index) => Math.max(1, (index ?? 1) - 1))}
                  className="rounded-md border border-violet-200 bg-white px-1.5 py-1 text-[9px] font-black text-violet-700 hover:bg-violet-50"
                  title="Previous candle"
                >
                  ‹
                </button>
                <button
                  onClick={openReplaySelector}
                  className={`rounded-md border px-1.5 py-1 text-[9px] font-black transition ${
                    replaySelecting
                      ? 'border-blue-300 bg-blue-100 text-blue-800'
                      : 'border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
                  }`}
                  title="Show the blue Replay line and choose another candle"
                >
                  │ LINE
                </button>
                <button
                  onClick={() => setReplayPlaying((playing) => !playing)}
                  className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[9px] font-black text-violet-700 hover:bg-violet-100"
                  title={replayPlaying ? 'Pause replay' : 'Play replay'}
                >
                  {replayPlaying ? '❚❚ PAUSE' : '▶ PLAY'}
                </button>
                <button
                  onClick={() => setReplayIndex((index) => Math.min(candles.length - 1, (index ?? 1) + 1))}
                  className="rounded-md border border-violet-200 bg-white px-1.5 py-1 text-[9px] font-black text-violet-700 hover:bg-violet-50"
                  title="Next candle"
                >
                  ›
                </button>
                <select
                  value={replaySpeed}
                  onChange={(event) => setReplaySpeed(Number(event.target.value))}
                  className="rounded-md border border-violet-200 bg-white px-1 py-1 text-[9px] font-black text-violet-700"
                  title="Replay speed"
                >
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={5}>5x</option>
                  <option value={10}>10x</option>
                </select>
                <button
                  onClick={exitReplay}
                  className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[9px] font-black text-slate-500 hover:bg-slate-100"
                  title="Exit replay and return to the live chart"
                >
                  LIVE
                </button>
                <span className="px-1 text-[9px] font-bold text-violet-700">
                  {displayCandles.length}/{candles.length}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
            <button
              type="button"
              onClick={() => setShowIndicatorControls((visible) => !visible)}
              className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-600 transition hover:bg-slate-100"
              title={showIndicatorControls ? 'Minimize indicator controls' : 'Show indicator controls'}
            >
              {showIndicatorControls ? 'INDICATORS − MINIMIZE' : 'INDICATORS + SHOW CONTROLS'}
            </button>
            {showIndicatorControls && <>
            <button
              onClick={() => setShowStructure((value) => !value)}
              className={`rounded-md border px-2 py-1 text-[10px] font-black transition ${
                showStructure
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide HH, HL, LH and LL structure markings"
            >
              MG STRUCTURE {showStructure ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setShowMgZones((value) => !value)}
              className={`rounded-md border px-2 py-1 text-[10px] font-black transition ${
                showMgZones
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide TJL1, TJL2, QML, SBR, RBS, DT and DB zones"
            >
              MG ZONES {showMgZones ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setShowSupplyDemand((value) => !value)}
              className={`rounded-md border px-2 py-1 text-[10px] font-black transition ${
                showSupplyDemand
                  ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide supply and demand zones; available only on H1, H4 and D"
            >
              S/D 1H+ {showSupplyDemand ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setShowIss((value) => !value)}
              className={`rounded-md border px-2 py-1 text-[10px] font-black transition ${
                showIss ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide ISS 0–5 wave markings"
            >
              ISS 5-WAVE {showIss ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setShowInternal((value) => !value)}
              className={`rounded-md border px-2 py-1 text-[10px] font-black transition ${
                showInternal ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide post-ISS internal structure, zones, BOS and CHoCH"
            >
              INT STRUCTURE {showInternal ? 'ON' : 'OFF'}
            </button>
            <div className="relative flex">
              <button
                onClick={() => setShowFib((value) => !value)}
                className={`rounded-l-md border border-r-0 px-2 py-1 text-[10px] font-black transition ${
                  showFib ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 bg-white text-slate-500'
                }`}
                title="Master switch for all Fibonacci confluence markings"
              >
                FIB {showFib ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                onClick={() => setShowFibOptions((visible) => !visible)}
                className={`rounded-r-md border px-1.5 py-1 text-[10px] font-black transition ${
                  showFibOptions
                    ? 'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800'
                    : showFib
                      ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'
                      : 'border-slate-200 bg-white text-slate-500'
                }`}
                title="Open individual FIB marking options"
                aria-label="Open individual FIB marking options"
                aria-expanded={showFibOptions}
              >
                {showFibOptions ? '▴' : '▾'}
              </button>
              {showFibOptions && (
                <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg border border-fuchsia-100 bg-white p-2 shadow-xl ring-1 ring-slate-900/5">
                  <div className="mb-1.5 flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <div>
                      <div className="text-[10px] font-black tracking-wide text-slate-700">FIB MARKINGS</div>
                      <div className="text-[8px] font-bold text-slate-400">CHOOSE ONE OR BOTH</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFibVisibility({ ...DEFAULT_FIB_VISIBILITY });
                        setFibPreviousVisibility({ ...DEFAULT_FIB_VISIBILITY });
                      }}
                      disabled={!hasAnyFibMarking}
                      className={`rounded-full border px-2 py-1 text-[8px] font-black leading-none transition ${
                        hasAnyFibMarking
                          ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100'
                          : 'border-slate-200 bg-slate-50 text-slate-400'
                      }`}
                      title="Turn off every FIB marking"
                    >
                      CLEAR
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {FIB_VISIBILITY_OPTIONS.map(renderFibOptionButton)}
                    <button
                      type="button"
                      onClick={() => {
                        setShowInternalFibOptions((visible) => !visible);
                        if (showInternalFibOptions
                          && expandedFibOption
                          && INTERNAL_FIB_VISIBILITY_OPTIONS.some(({ key }) => key === expandedFibOption)) {
                          setExpandedFibOption(null);
                        }
                      }}
                      className={`flex h-7 items-center justify-between rounded-md border px-1.5 text-[8px] font-black leading-none transition ${
                        showInternalFibOptions
                          ? 'border-violet-300 bg-violet-100 text-violet-800'
                          : INTERNAL_FIB_VISIBILITY_OPTIONS.some(({ key }) => (
                            fibVisibility[key] || fibPreviousVisibility[key]
                          ))
                            ? 'border-violet-200 bg-violet-50 text-violet-700'
                            : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                      }`}
                      aria-expanded={showInternalFibOptions}
                    >
                      <span>INTERNAL</span>
                      <span className="ml-1 rounded-full bg-violet-200 px-1 py-0.5 text-[8px] text-violet-800">
                        {showInternalFibOptions ? '−' : '+'}
                      </span>
                    </button>
                  </div>
                  {showInternalFibOptions && (
                    <div className="mt-1.5 rounded-md border border-violet-100 bg-violet-50/60 p-1.5">
                      <div className="mb-1 text-[8px] font-black text-violet-800">INTERNAL FIB</div>
                      <div className="grid grid-cols-2 gap-1">
                        {INTERNAL_FIB_VISIBILITY_OPTIONS.map(renderFibOptionButton)}
                      </div>
                    </div>
                  )}
                  {expandedFibOption && !isSingleFibMarkingKey(expandedFibOption) && (
                    <div className="mt-1.5 rounded-md border border-fuchsia-100 bg-fuchsia-50/60 p-1.5">
                      <div className="mb-1 text-[8px] font-black text-fuchsia-800">
                        {ALL_FIB_VISIBILITY_OPTIONS.find(({ key }) => key === expandedFibOption)
                          ?.label.replace(' MARKING', '')} SETUP
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => setFibVisibility((current) => ({
                            ...current,
                            [expandedFibOption]: !current[expandedFibOption],
                          }))}
                          className={`flex items-center justify-between whitespace-nowrap rounded border px-1.5 py-1 text-[8px] font-black leading-none ${
                            fibVisibility[expandedFibOption]
                              ? 'border-fuchsia-300 bg-fuchsia-200 text-fuchsia-800'
                              : 'border-slate-200 bg-white text-slate-500'
                          }`}
                        >
                          <span>LATEST</span>
                          <span className={`ml-1 rounded-full px-1 py-0.5 text-[8px] ${
                            fibVisibility[expandedFibOption]
                              ? 'bg-fuchsia-300 text-fuchsia-900'
                              : 'bg-slate-200 text-slate-500'
                          }`}>
                            {fibVisibility[expandedFibOption] ? 'ON' : 'OFF'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setFibPreviousVisibility((current) => ({
                            ...current,
                            [expandedFibOption]: !current[expandedFibOption],
                          }))}
                          className={`flex items-center justify-between whitespace-nowrap rounded border px-1.5 py-1 text-[8px] font-black leading-none ${
                            fibPreviousVisibility[expandedFibOption]
                              ? 'border-fuchsia-300 bg-fuchsia-200 text-fuchsia-800'
                              : 'border-slate-200 bg-white text-slate-500'
                          }`}
                        >
                          <span>PREVIOUS</span>
                          <span className={`ml-1 rounded-full px-1 py-0.5 text-[8px] ${
                            fibPreviousVisibility[expandedFibOption]
                              ? 'bg-fuchsia-300 text-fuchsia-900'
                              : 'bg-slate-200 text-slate-500'
                          }`}>
                            {fibPreviousVisibility[expandedFibOption] ? 'ON' : 'OFF'}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowEngulfing((value) => !value)}
              className={`rounded-md border px-2 py-1 text-[10px] font-black transition ${
                showEngulfing ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide confirmed Type 1–4 engulfing signals in A+ FIB zones"
            >
              ENGULFING {showEngulfing ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setShowInvalidZones((value) => !value)}
              className={`rounded-md border px-2 py-1 text-[10px] font-black transition ${
                showInvalidZones
                  ? 'border-slate-400 bg-slate-200 text-slate-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide rejected, invalidated, and superseded zones"
            >
              INVALID ZONES {showInvalidZones ? 'ON' : 'OFF'}
            </button>
            </>}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <div className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black ${
              error
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}>
              {error ? <WifiOff className="h-2.5 w-2.5" /> : <Wifi className="h-2.5 w-2.5" />}
              {error ? 'FEED DISCONNECTED' : 'TRADINGVIEW CONNECTED'}
            </div>
            <button
              type="button"
              onClick={restorePresentChartView}
              className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[9px] font-black text-slate-600 hover:bg-slate-100"
              title="Restore the default candle zoom and return to the latest candle"
            >
              <RefreshCw className="h-3 w-3" />
              REFRESH CHART VIEW
            </button>
            <button
              onClick={() => setRefreshKey((value) => value + 1)}
              className="rounded-md border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
              title="Refresh TradingView OANDA:XAUUSD candles"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => void toggleFullscreen()}
              className="rounded-md border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
              title="Fullscreen chart"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-xs">
          <span className="flex items-center gap-1.5 font-black text-slate-800">
            <Crosshair className="h-3.5 w-3.5 text-slate-400" />
            O <b>{formatPrice(latestCandle?.open)}</b>
          </span>
          <span className="text-slate-500">H <b className="text-slate-800">{formatPrice(latestCandle?.high)}</b></span>
          <span className="text-slate-500">L <b className="text-slate-800">{formatPrice(latestCandle?.low)}</b></span>
          <span className="text-slate-500">C <b className="text-slate-800">{formatPrice(latestCandle?.close)}</b></span>
          <span className={`font-black ${change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {change >= 0 ? '+' : ''}{formatPrice(change)} ({changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%)
          </span>
          <span className={`rounded px-2 py-0.5 text-[10px] font-black ${
            structure.trend === 'bullish'
              ? 'bg-emerald-50 text-emerald-700'
              : structure.trend === 'bearish'
                ? 'bg-rose-50 text-rose-700'
                : 'bg-slate-100 text-slate-600'
          }`}>
            STRUCTURE: {structure.trend.toUpperCase()}
          </span>
          <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-slate-500">
            <Wifi className="h-3.5 w-3.5 text-emerald-600" />
            {source} · no fallback · {candles.length.toLocaleString()} bars
          </span>
        </div>

        <div className="relative flex-1 min-h-0 bg-white">
          <div ref={hostRef} className="absolute inset-0" />
          <div ref={zoneLayerRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />
          <div
            ref={livePriceLabelRef}
            className="pointer-events-none absolute right-0 z-20 hidden w-[72px] -translate-y-1/2 flex-col items-center justify-center py-0.5 text-white shadow-sm"
            aria-label="Live candle price and time remaining"
          >
            <span ref={livePriceValueRef} className="text-[10px] font-black leading-[12px]" />
            <span ref={liveCountdownRef} className="text-[9px] font-bold leading-[11px]" />
          </div>
          {replaySelecting && replaySelectionIndex !== null && (
            <div
              className="absolute inset-0 z-30 cursor-ew-resize"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                selectReplayBar(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) selectReplayBar(event);
              }}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              title="Drag the blue replay line to the candle where replay should start"
            >
              <div
                ref={replaySelectionLineRef}
                className="absolute inset-y-0 w-0.5 bg-blue-600 shadow-[0_0_0_1px_rgba(255,255,255,.9)]"
              >
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-blue-600 px-2 py-1 text-[10px] font-black text-white">
                  REPLAY START
                </span>
              </div>
            </div>
          )}
          {replaySelecting && (
            <div className="absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-lg">
              <span className="text-[10px] font-black text-slate-600">DRAG BLUE LINE TO SELECT BAR</span>
              <span className="text-[10px] font-bold text-slate-400">{(replaySelectionIndex ?? 0) + 1}/{candles.length}</span>
              <label className="flex items-center gap-1 text-[10px] font-bold text-slate-600">
                Speed
                <select
                  value={replaySpeed}
                  onChange={(event) => setReplaySpeed(Number(event.target.value))}
                  className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-black text-violet-700"
                >
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={5}>5x</option>
                  <option value={10}>10x</option>
                </select>
              </label>
              <button onClick={beginReplay} className="rounded bg-violet-600 px-2 py-1 text-[10px] font-black text-white hover:bg-violet-700">START</button>
              <button onClick={() => setReplaySelecting(false)} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-100">CANCEL</button>
            </div>
          )}
          <div className={`pointer-events-auto absolute left-3 top-3 z-20 overflow-hidden rounded-md border border-slate-300 bg-white/95 shadow-sm ${showZoneTable ? 'w-[500px]' : 'w-auto'}`}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-violet-50 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-violet-700">
              <span>{showZoneTable ? 'Zone table' : 'Zone table minimized'}</span>
              <button
                type="button"
                onClick={() => setShowZoneTable((visible) => !visible)}
                className="rounded border border-violet-200 bg-white px-1.5 py-0.5 text-[8px] font-black text-violet-700 hover:bg-violet-100"
                title={showZoneTable ? 'Minimize zone table' : 'Show zone table'}
              >
                {showZoneTable ? '− MINIMIZE' : '+ SHOW TABLE'}
              </button>
            </div>
            {showZoneTable && <>
            <table className="w-full border-collapse text-left text-[10px]">
              <thead className="bg-slate-100 text-[9px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1 font-bold">Zone</th>
                  <th className="px-2 py-1 font-bold">Type</th>
                  <th className="px-2 py-1 font-bold">Price range</th>
                  <th className="px-2 py-1 text-center font-bold">Engulf</th>
                  <th className="px-2 py-1 text-right font-bold">Tap / Trade</th>
                </tr>
              </thead>
              <tbody>
                {pendingConfirmationRows.map((zone) => (
                  <tr key={zone.id} className={`border-t text-slate-700 ${zone.isBuy ? 'border-emerald-100 bg-emerald-50/70' : 'border-rose-100 bg-rose-50/70'}`}>
                    <td className={`px-2 py-1 font-black ${zone.isBuy ? 'text-emerald-800' : 'text-rose-800'}`}>{displayZoneName(zone.name)}</td>
                    <td className={`px-2 py-1 font-bold ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {zone.isBuy ? 'BUY' : 'SELL'}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatPrice(zone.bottom)} – {formatPrice(zone.top)}</td>
                    <td className="px-2 py-1 text-center text-slate-400">—</td>
                    <td className={`px-2 py-1 text-right font-black whitespace-nowrap ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                      WAIT {TJL1_CONFIRMATION_LABELS[granularity].toUpperCase()} {zone.isBuy ? 'ABOVE' : 'BELOW'}
                    </td>
                  </tr>
                ))}
                {doubleChochRows.map((zone) => {
                  const pending = zone.doubleChochStatus === 'pending';
                  const confirmationLabel = TJL1_CONFIRMATION_LABELS[granularity].toUpperCase();
                  const confirmationSide = zone.doubleChochConfirmationDirection === 'up' ? 'ABOVE' : 'BELOW';
                  return (
                    <tr key={`double-${zone.id}`} className={`border-t text-slate-700 ${
                      pending ? 'border-amber-100 bg-amber-50/70' : 'border-emerald-100 bg-emerald-50/50'
                    }`}>
                      <td className="px-2 py-1 font-black text-slate-800">
                        <span>{displayZoneName(zone.name)}</span>
                        <span className="ml-1 rounded bg-violet-100 px-1 py-0.5 text-[8px] font-black text-violet-800">
                          DOUBLE CHoCH
                        </span>
                        <span className={`ml-1 rounded px-1 py-0.5 text-[8px] font-black ${
                          pending ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          HTF {pending ? 'WAIT' : 'VALID'}
                        </span>
                        {zone.doubleChochOriginClass && (
                          <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[8px] font-black text-slate-600">
                            FROM {zone.doubleChochOriginClass.toUpperCase()}
                          </span>
                        )}
                      </td>
                      <td className={`px-2 py-1 font-bold ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {zone.isBuy ? 'BUY' : 'SELL'}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{formatPrice(zone.bottom)} – {formatPrice(zone.top)}</td>
                      <td className={`px-2 py-1 text-center font-black whitespace-nowrap ${
                        zone.isBuy ? 'text-emerald-700' : 'text-rose-700'
                      }`}>
                        {showEngulfing && zone.engulfingType
                          ? `${zone.engulfingType} ${zone.isBuy ? 'BULL' : 'BEAR'}`
                          : '—'}
                      </td>
                      <td className={`px-2 py-1 text-right font-black whitespace-nowrap ${
                        pending ? 'text-amber-700' : 'text-emerald-700'
                      }`}>
                        {pending
                          ? `WAIT ${confirmationLabel} ${confirmationSide} · NO TRADE`
                          : zone.tapTime === undefined
                            ? 'VALID DOUBLE CHoCH · NO TRADE'
                            : `${zone.tapBarsAgo} bars · ${confirmationLabel} CONFIRMED · TRADE`}
                      </td>
                    </tr>
                  );
                })}
                {zoneTableRows.map((zone) => (
                  <tr key={zone.id} className="border-t border-slate-100 text-slate-700">
                    <td className="px-2 py-1 font-black text-slate-800">
                      <span>
                        {showFib && zone.fibBand === 'DB/DT'
                          ? `FIB A+ ${displayZoneName(zone.name)}`
                          : displayZoneName(zone.name)}
                      </span>
                      {zone.chochClass && (
                        <span className={`ml-1 rounded px-1 py-0.5 text-[8px] font-black ${
                          zone.chochClass === 'vip'
                            ? 'bg-amber-100 text-amber-800'
                            : zone.chochClass === 'valid'
                              ? 'bg-emerald-100 text-emerald-800'
                              : zone.chochClass === 'air'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-violet-100 text-violet-700'
                        }`}>
                          {zone.category === 'internal' ? 'INT ' : ''}
                          {zone.chochClass === 'pending' ? 'WAIT' : zone.chochClass.toUpperCase()}
                        </span>
                      )}
                      {zone.chochClass === 'vip' && zone.vipSupportTimeframe && zone.vipSupportZone && (
                        <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[8px] font-black text-amber-700">
                          {zone.vipSupportTimeframe} {displayZoneName(zone.vipSupportZone)}
                        </span>
                      )}
                      {showFib && zone.fibStatus === 'a-plus'
                        && zone.fibBand && zone.fibBand !== 'DB/DT' && (
                        <span className="ml-1 rounded bg-fuchsia-100 px-1 py-0.5 text-[8px] font-black text-fuchsia-800">
                          {displayFibLabel(zone)}
                        </span>
                      )}
                    </td>
                    <td className={`px-2 py-1 font-bold ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {zone.isBuy ? 'BUY' : 'SELL'}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatPrice(zone.bottom)} – {formatPrice(zone.top)}</td>
                    <td className={`px-2 py-1 text-center font-black whitespace-nowrap ${
                      zone.isBuy ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {showEngulfing && zone.engulfingType
                        ? `${zone.engulfingType} ${zone.isBuy ? 'BULL' : 'BEAR'}`
                        : '—'}
                    </td>
                    <td className="px-2 py-1 text-right font-bold whitespace-nowrap">
                      <span className="text-slate-500">{zone.tapBarsAgo} bars</span>
                      <span className={zone.tradeable === false ? 'ml-1 text-rose-700' : 'ml-1 text-emerald-700'}>
                        - {zone.tradeable === false ? 'NO TRADE' : 'TRADE'}
                      </span>
                    </td>
                  </tr>
                ))}
                {pendingConfirmationRows.length === 0 && doubleChochRows.length === 0 && zoneTableRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-center text-slate-400">No active zone rows</td>
                  </tr>
                )}
              </tbody>
            </table>
            </>}
          </div>
          <MultiTimeframeTrendTable rows={trendTableRows} replayActive={replayIndex !== null} />
          {isLoading && candles.length === 0 && !error && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-white/85">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                Loading TradingView OANDA:XAUUSD candles…
              </div>
            </div>
          )}

          {error && candles.length === 0 && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-white/95 p-6">
              <div className="max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-5 text-center shadow-sm">
                <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-rose-600" />
                <h2 className="font-black text-rose-900">TradingView candle feed is unavailable</h2>
                <p className="mt-2 text-sm text-rose-800">{error}</p>
                <p className="mt-3 text-xs leading-relaxed text-slate-600">
                  The dashboard requests OANDA:XAUUSD through TradingView's unofficial WebSocket protocol. No synthetic or Binance fallback will be displayed.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-bold text-slate-500">
          <span className="flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" /> Unofficial TradingView protocol</span>
          <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Symbol: OANDA:XAUUSD</span>
          <span>OHLC supplied by TradingView</span>
          <span>Structure: HH · HL · LH · LL · BOS · CHoCH</span>
          <span>Genesis Low: {formatPrice(structure.genesis?.price)}</span>
          <span>Active MG zones: {structure.zones.filter((zone) => zone.category === 'mg' && zone.active).length}</span>
          <span>Invalid zones: {structure.zones.filter((zone) => !zone.active).length}</span>
          <span>S/D: {['H1', 'H4', 'D'].includes(granularity) ? structure.zones.filter((zone) => zone.category === 'supplyDemand').length : 'H1+ ONLY'}</span>
          <span>Last candle: {latestCandle?.complete === false ? 'FORMING' : 'COMPLETE'}</span>
          <span className="ml-auto">Updated: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}</span>
        </div>
      </div>
    </section>
  );
};
