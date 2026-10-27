import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  type Time,
  type TickMarkType,
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
import {
  analyzeMarketStructure,
  applyTradeableZoneEngulfingFallback,
  DISABLED_HIGHER_TIMEFRAME_CONFIRMATION,
  getGoldZoneTapState,
  isZoneEligibleForEngulfingEntry,
  isGoldZoneEntryBlocked,
  isGoldZoneOpportunityExpired,
  StructureLine,
  StructureZone,
} from '../services/marketStructure';
import { findReplayIndexAtOrBefore } from '../services/replay';
import { buildAlternatingSwingFibs, SwingFibMove } from '../services/swingFib';
import { ChartTimeZone, formatChartTick, formatChartTime } from '../services/chartTime';
import { structureSnapshotsMatch, type PreparedStructureAnalysis, type StructureAnalysisTask } from '../services/structureAnalysis';
import { buildDayFibs, DayFibMove } from '../services/dayFib';
import { applySwingFibConfluence } from '../services/swingFibConfluence';
import { applyDayFibConfluence } from '../services/dayFibConfluence';
import { INDICATOR_FIB_LEVELS, indicatorFibPrice } from '../services/indicatorFib';
import {
  MTF_MAPPINGS,
  buildGoldIntradayMtfHistoryRows,
  buildGoldIntradayMtfRows,
  buildGoldScalpingMtfHistoryRows,
  buildGoldScalpingMtfRows,
  buildMtfHistoryRows,
  buildMtfRows,
  getSavedMtfEntryQualification,
  mtfChochSequenceLabel,
  type MtfGranularity,
  type MtfRow,
} from '../services/mtf';
import {
  findGoldScalpingCandleSignal,
  goldScalpingCandleTimeframe,
  goldScalpingChochTradeRule,
  goldScalpingTradeRule,
  goldScalpingZoneWidthPips,
  goldIntradayMtfTradeRule,
  isGoldIntradayCandleRoute,
  isGoldScalpingZone,
} from '../services/goldScalping';
import {
  assessEngulfingVolumeLogic,
  applyOppositePositionRewardRisk,
  calculateTradeLevels,
  formatTradeTimeframe,
  getDirectTradeRule,
  getMtfTradeRule,
  getEngulfingVolumeStatus,
  isDaySwingFibEntryTimeframe,
  isZoneEngulfingFibQualified,
  isDeepDiscountTradeSignal,
  isUnfilledDirectSetupQualified,
  measureTradeableFibZone,
  resolveDirectEntryPolicy,
  resolveZoneEngulfingSignal,
  timeframeWindowCutoff,
  type EngulfingTradeSignal,
  type DirectEntryPolicyDecision,
  type TradeLevels,
  type TradeResult,
  type TradeRule,
  type TradeTimeframe,
} from '../services/tradeLevels';
import { applyOneMinuteGenesisQml, executionZoneName } from '../services/oneMinuteGenesis';
import {
  DEFAULT_TRADE_RECORD_FILTERS,
  buildCanonicalTradeRecords,
  filterAccuracyTradeRecords,
  tradeRecordOutsideTradingTime,
  selectTradeChartRecords,
  selectTwoMonthAccuracyRecords,
  twoMonthAccuracyWindow,
  tradeRecordDatePeriodKey,
  tradeRecordPeriodLabel,
  type TradeRecordFilters,
} from '../services/tradeRecordFilters';
import { deduplicateTradeRecords } from '../services/tradeRecordDeduplication';
import { isNepalTradingTime } from '../services/tradingTime';
import {
  OANDA_MARKET_SYMBOLS,
  normalizeOandaMarketSymbol,
  oandaMarketSymbolConfig,
  type OandaMarketSymbol,
} from '../services/marketSymbols';
import {
  hasIdentifiedDirectZoneLabel,
  isDirectTradeOverlay,
  isTradeOverlayTerminated,
  isTradeOverlayVisibleOnTimeframe,
  liveMtfPositionMatchesChartRow,
  retainedDirectTradeHasSource,
  resolveTradeOverlaySetupKey,
  tradeOverlayEntryEventKey,
  tradeOverlayExecutionKey,
  tradeOverlayZoneLabel,
} from '../services/tradeOverlayIdentity';
import {
  consolidateZonesForDisplay,
  displayZoneMembers,
  redundantStandaloneLiquidityZoneIds,
  selectLtfChochContext,
  selectRecentComparisonZones,
  selectExtremeAPlusTjl2Zones,
  tappedZoneDrawingEndIndex,
  type DisplayStructureZone,
} from '../services/zoneConfluence';
import {
  TradeJournal,
  renderHistoricalTradeSnapshot,
  type JournalTradeRecord,
} from './TradeJournal';
import { TradeMultiSelect } from './TradeMultiSelect';
import {
  findEarlierZoneEntry,
  tradeZoneExecutionKey,
  type ZoneTradeRecord,
  MT5_DEFAULT_ENABLED_TIMEFRAMES,
  MT5_ENTRY_TIMEFRAME_OPTIONS,
  MT5_RISK_PERCENT_OPTIONS,
  isTradeStyleEnabled,
  type Mt5AutomationStatus,
  type Mt5StoredSignal,
} from '../services/mt5Automation';

type OandaGranularity = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D';
type MarketGranularity = OandaGranularity | 'W' | 'MO';
type LiveChartDataSource = 'MT5' | 'OANDA';
type FibVisibilityKey = 'tjl1' | 'tjl2' | 'choch' | 'intChoch' | 'intTjl1' | 'intTjl2'
  | 'doubleChoch' | 'iss' | 'swing' | 'day';
type ChochFibVisibility = [boolean, boolean, boolean, boolean];
type ChartDrawingTool = 'rectangle' | 'fib' | 'measure' | 'note' | 'path' | 'trend';
type ChartDrawingVisibility = 'all' | 'current-only' | 'current-and-above' | 'current-and-below';

// Coalesce zone movement into one animation frame. User drawing redraws also
// render React controls, so keep those separately throttled.
const DRAWING_REDRAW_INTERVAL_MS = 80;

interface ChartDrawingPoint {
  time: number;
  price: number;
}

interface ChartDrawing {
  id: string;
  scope: string;
  tool: ChartDrawingTool;
  points: ChartDrawingPoint[];
  text?: string;
  color?: string;
  visibilityTimeframe?: OandaGranularity;
  visibility?: ChartDrawingVisibility;
  hidden?: boolean;
}

interface ChartDrawingDraft {
  tool: ChartDrawingTool;
  points: ChartDrawingPoint[];
  hover?: ChartDrawingPoint;
}

interface ChartDrawingDrag {
  drawingId: string;
  pointIndex?: number;
  rectangleCorner?: {
    timePointIndex: number;
    pricePointIndex: number;
  };
  start: ChartDrawingPoint;
  originalPoints: ChartDrawingPoint[];
}

interface ChartDrawingTextEditor {
  drawingId: string;
  value: string;
}

const CHART_DRAWINGS_STORAGE_KEY = 'oanda-dashboard-chart-drawings-v1';
const MARKET_SYMBOL_STORAGE_KEY = 'oanda-dashboard-market-symbol-v1';
const CHART_DRAWING_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0f172a'] as const;

const CHART_DRAWING_TOOLS: Array<{
  tool: ChartDrawingTool;
  label: string;
  hint: string;
}> = [
  { tool: 'rectangle', label: 'RECTANGLE', hint: 'Mark a price and time area' },
  { tool: 'fib', label: 'FIB MARKING', hint: 'Draw Fibonacci retracement levels' },
  { tool: 'measure', label: 'SCALE / MEASURE', hint: 'Measure bars and price movement' },
  { tool: 'note', label: 'NOTE TEXT', hint: 'Attach a written note to a price' },
  { tool: 'path', label: 'PATH', hint: 'Draw connected custom segments' },
  { tool: 'trend', label: 'TREND LINE', hint: 'Connect two chart points' },
];

function loadStoredChartDrawings(): ChartDrawing[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHART_DRAWINGS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((drawing): drawing is ChartDrawing => (
      drawing && typeof drawing.id === 'string' && typeof drawing.scope === 'string'
      && CHART_DRAWING_TOOLS.some(({ tool }) => tool === drawing.tool)
      && Array.isArray(drawing.points)
      && drawing.points.every((point: ChartDrawingPoint) => (
        Number.isFinite(point?.time) && Number.isFinite(point?.price)
      ))
    )).map((drawing) => {
      const [sourceScope, storedSymbolOrTimeframe, legacyTimeframe] = drawing.scope.split(':');
      const storedSymbol = normalizeOandaMarketSymbol(storedSymbolOrTimeframe);
      return {
        ...drawing,
        scope: `${sourceScope}:${storedSymbol ?? 'XAUUSD'}`,
        visibilityTimeframe: drawing.visibilityTimeframe
          ?? (DRAWING_TIMEFRAME_ORDER.includes((legacyTimeframe ?? storedSymbolOrTimeframe) as OandaGranularity)
            ? (legacyTimeframe ?? storedSymbolOrTimeframe) as OandaGranularity
            : 'M15'),
        visibility: drawing.visibility ?? 'all',
        hidden: drawing.hidden ?? false,
      };
    });
  } catch {
    return [];
  }
}

function loadStoredMarketSymbol(): OandaMarketSymbol {
  try {
    return normalizeOandaMarketSymbol(window.localStorage.getItem(MARKET_SYMBOL_STORAGE_KEY)) ?? 'XAUUSD';
  } catch {
    return 'XAUUSD';
  }
}

const DEFAULT_CHOCH_FIB_VISIBILITY: ChochFibVisibility = [false, false, false, false];

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
  day: false,
};

const FIB_VISIBILITY_OPTIONS: Array<{ key: FibVisibilityKey; label: string }> = [
  { key: 'tjl1', label: 'TJL1 MARKING' },
  { key: 'tjl2', label: 'TJL2 MARKING' },
  { key: 'choch', label: 'CHoCH MARKING' },
  { key: 'doubleChoch', label: 'D CHoCH MARKING' },
  { key: 'iss', label: 'ISS MARKING' },
  { key: 'swing', label: 'SWING MARKING' },
  { key: 'day', label: 'DAY FIB' },
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
    || key === 'doubleChoch' || key === 'iss' || key === 'day';
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
  symbol?: OandaMarketSymbol;
  granularity?: MarketGranularity;
  fetchedAt?: string;
  candles?: OandaCandle[];
  error?: string;
}

interface TrackedDirectTradeSetup {
  scope: string;
  zone: StructureZone;
  signal: EngulfingTradeSignal;
  rule: TradeRule;
}

interface DirectZoneEntryDecision {
  policy: DirectEntryPolicyDecision;
  trade?: TradeLevels;
  previewTrade?: TradeLevels;
  trades?: TradeLevels[];
  oppositePositionOpen: boolean;
}

interface TradeOverlay {
  id: string;
  symbol?: OandaMarketSymbol;
  setupId?: string;
  trade: TradeLevels;
  label?: string;
  fibLabels?: string[];
  chartTimeframe?: OandaGranularity;
  referenceOnly?: boolean;
}

/** Resolve display labels without changing saved trades or their execution rules. */
export function resolveArrowTradeZones(
  record: JournalTradeRecord,
  signals: readonly Partial<Mt5StoredSignal>[],
  recover: (id: string) => MtfRow | undefined,
): { mainZone?: string; entryZone: string } {
  if (record.source !== 'MTF') return { mainZone: record.zoneName, entryZone: record.zoneName };
  const matches = signals.filter((signal) => (
    signal.symbol === (record.symbol ?? 'XAUUSD')
    && signal.signalAt === record.signalAt && signal.signalTimeframe === record.signalTimeframe
    && signal.zoneTimeframe === record.zoneTimeframe
    && signal.direction === (record.direction === 'bullish' ? 'BUY' : 'SELL')
  ));
  const exact = matches.filter((signal) => record.id === `MT5:${signal.id}`
    || (record.brokerTicket !== undefined
      && (record.brokerTicket === signal.brokerTicket || record.brokerTicket === signal.brokerPosition)));
  const signal = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
  let context = record.mtfContext ?? signal?.journalContext?.mtfContext;
  const savedZone = record.zoneId?.match(/^(.+)-\d{9,}-.+$/)?.[1]
    ?? signal?.zoneId?.match(/^(.+)-\d{9,}-.+$/)?.[1];
  if (!context && !savedZone && record.signalAt !== undefined) {
    const ids = new Set<string>();
    for (const id of [record.id, record.setupId, signal?.setupId]) {
      if (!id?.startsWith('MTF:')) continue;
      const rowId = id.split(':')[1];
      const candidates = /^\w+-\w+-choch-\d+$/.test(rowId)
        ? [rowId.replace('-choch-', '-external-choch-'), rowId.replace('-choch-', '-internal-choch-')]
        : [rowId];
      for (const candidate of candidates) ids.add(`MTF:${candidate}:${record.signalAt}:${record.entry}`);
    }
    const recovered = [...ids].map(recover).filter((row): row is MtfRow => (
      row !== undefined && row.higherTimeframe === record.zoneTimeframe
      && row.lowerTimeframe === record.signalTimeframe && row.direction === record.direction
      && row.engulfingTime === record.signalAt && row.engulfingType === record.engulfingType
    ));
    if (new Set(recovered.map((row) => row.higherTimeframeZoneId)).size === 1) context = recovered[0];
  }
  return {
    mainZone: context?.higherTimeframeZone ?? savedZone,
    entryZone: context?.entryZone?.name ?? context?.tappedZone ?? record.zoneName,
  };
}

interface EntryHover {
  id: string;
  candleTime: number;
  high: number;
  low: number;
  trade: TradeLevels;
  source: string;
  zone: string;
  fib: string;
  style: string;
  tradingTimeBlocked: boolean;
}

const RETAINED_CHART_TRADES_STORAGE_KEY = 'oanda-dashboard-retained-chart-trades-v1';

function loadStoredRetainedChartTrades(): Map<string, TradeOverlay> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(RETAINED_CHART_TRADES_STORAGE_KEY) || '[]',
    );
    if (!Array.isArray(parsed)) return new Map();
    const entries = parsed.filter((overlay): overlay is TradeOverlay => (
      overlay && typeof overlay.id === 'string'
      && DRAWING_TIMEFRAME_ORDER.includes(overlay.chartTimeframe as OandaGranularity)
      && overlay.trade && Number.isFinite(overlay.trade.entry)
      && Number.isFinite(overlay.trade.stopLoss) && Number.isFinite(overlay.trade.takeProfit)
      && Number.isFinite(overlay.trade.calculatedAt) && overlay.trade.result === undefined
      && overlay.trade.signal
      && (overlay.trade.signal.direction === 'bullish' || overlay.trade.signal.direction === 'bearish')
      && hasIdentifiedDirectZoneLabel(overlay.id, overlay.setupId, overlay.label)
    )).map((overlay) => [overlay.id, {
      ...overlay,
      // Migrate older saved drawings that used the source-zone chart instead
      // of the timeframe where the engulfing entry actually formed.
      chartTimeframe: overlay.trade.signal.timeframe,
    }] as const);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function tradeOverlaySetupKey(overlay: TradeOverlay): string {
  return resolveTradeOverlaySetupKey(overlay.id, overlay.setupId);
}

function directTradeOverlayZoneId(overlay: TradeOverlay): string | undefined {
  const setupKey = tradeOverlaySetupKey(overlay);
  return setupKey.startsWith('DIRECT:') ? setupKey.slice('DIRECT:'.length) : undefined;
}

function retainedLiquidityTradeDuplicatesConfluence(
  overlay: TradeOverlay,
  zones: readonly DisplayStructureZone[],
  candles: readonly OandaCandle[],
): boolean {
  const zoneLabel = tradeOverlayZoneLabel(overlay.label);
  if (zoneLabel !== 'DB' && zoneLabel !== 'DT') return false;
  const expectedInternal = zoneLabel === 'DB' ? 'Internal DB' : 'Internal DT';
  const bullish = overlay.trade.signal.direction === 'bullish';
  const finalIndex = candles.findIndex((candle) => candle.time === overlay.trade.signal.time);
  if (finalIndex < 0) return false;
  const firstIndex = Math.max(0, finalIndex - overlay.trade.signal.candleCount + 1);
  const signalCandles = candles.slice(firstIndex, finalIndex + 1);

  return zones.some((zone) => {
    const members = displayZoneMembers(zone);
    const tjl2 = members.find((member) => member.name === 'TJL2');
    const internal = members.find((member) => member.name === expectedInternal);
    if (!tjl2 || !internal || zone.isBuy !== bullish
      || overlay.trade.signal.time < Math.max(tjl2.startTime, internal.startTime)) return false;
    return signalCandles.some((candle) => candle.high >= zone.bottom && candle.low <= zone.top);
  });
}

type AccuracyTradeRecord = JournalTradeRecord;
type LiveMt5Position = Mt5AutomationStatus['positions'][number];

interface LiveMt5TableTrade {
  position: LiveMt5Position;
  trade: TradeLevels;
  signal?: Mt5StoredSignal;
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
const DRAWING_TIMEFRAME_ORDER: OandaGranularity[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D'];

const TREND_TABLE_GRANULARITIES: OandaGranularity[] = ['M1', 'M5', 'M15', 'H1', 'H4', 'D'];
const AUTOMATION_GRANULARITIES: OandaGranularity[] = ['M1', 'M5', 'M15', 'M30', 'H1'];
const MT5_CHART_GRANULARITIES: OandaGranularity[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D'];

const ACCURACY_ZONE_ROWS = [
  'TJL1', 'TJL2', 'QML', 'QML(A+)', 'QML(A++)', 'SBR', 'RBS', 'DB', 'DT', 'DBD', 'DTD',
  'Internal QML', 'Internal SBR', 'Internal RBS', 'ISS L3', 'ISS L4',
];

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
  M5: ['H1'],
  M15: ['H1', 'H4'],
  M30: ['H1', 'H4'],
  H1: ['H4', 'D'],
  H4: ['D', 'W'],
  D: ['W', 'MO'],
};

const DIRECT_ENGULFING_FALLBACKS: Partial<Record<OandaGranularity, OandaGranularity[]>> = {
  M1: ['M5'],
  M15: ['M30'],
  H1: ['M15', 'M30'],
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

function resolveRuleForDirectEntry(options: {
  zoneTimeframe: TradeTimeframe;
  signal: EngulfingTradeSignal;
  sourceCandles: OandaCandle[];
  baseRule: TradeRule;
}): TradeRule | undefined {
  const { zoneTimeframe, signal, sourceCandles, baseRule } = options;
  return resolveDirectEntryPolicy({
    zoneTimeframe,
    signal,
    sourceCandles,
    baseRule,
  }).rule;
}

const TJL1_CONFIRMATION_LABELS: Record<OandaGranularity, string> = {
  M1: '5m', M5: '15m', M15: '1h', M30: '1h', H1: '4h', H4: '1D', D: '1W',
};

// Number#toLocaleString constructs an ICU formatter on every call. These
// labels are redrawn during every drag frame, so keep the formatters alive.
const priceFormatters = {
  3: new Intl.NumberFormat(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
  5: new Intl.NumberFormat(undefined, { minimumFractionDigits: 5, maximumFractionDigits: 5 }),
};
const zonePipsFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function formatPrice(value: number | undefined): string {
  const precision = Number.isFinite(value) && Math.abs(Number(value)) < 10 ? 5 : 3;
  return Number.isFinite(value) ? priceFormatters[precision].format(Number(value)) : '—';
}

function candleSnapshotsMatch(first: OandaCandle[], second: OandaCandle[]): boolean {
  if (first === second) return true;
  if (first.length !== second.length) return false;
  if (first.length === 0) return true;
  const start = Math.max(0, first.length - 2);
  for (let index = start; index < first.length; index += 1) {
    const left = first[index];
    const right = second[index];
    if (!right || left.time !== right.time || left.open !== right.open
      || left.high !== right.high || left.low !== right.low || left.close !== right.close
      || left.volume !== right.volume || left.complete !== right.complete) return false;
  }
  return true;
}

function mt5StatusRenderSignature(status: Mt5AutomationStatus): string {
  const { lastHeartbeatAt: _heartbeat, ...bridge } = status.bridge;
  return JSON.stringify({
    config: status.config,
    bridge,
    positions: status.positions,
    marketData: status.marketData,
    counts: status.counts,
    recentSignals: status.recentSignals,
  });
}

function tradeStatusLabel(trade: TradeLevels): string {
  if (trade.status === 'pending') return 'CHART PENDING';
  if (trade.status === 'active') return trade.riskFreeEnabled === false
    ? 'CHART ACTIVE' : `CHART ACTIVE · 1R AT ${formatPrice(trade.riskFree)}`;
  if (trade.status === 'risk-free') return trade.result === 'rf' ? 'RF' : '1R HIT · RF ACTIVE';
  if (trade.status === 'tp-hit') return 'TP HIT';
  return 'SL HIT';
}

const TradeStatusText: React.FC<{ trade: TradeLevels }> = ({ trade }) => {
  const riskFreePrice = (
    <span className="tabular-nums text-[9px] font-semibold text-slate-700">
      {formatPrice(trade.riskFree)}
    </span>
  );

  if (trade.status === 'active') return trade.riskFreeEnabled === false
    ? <>CHART ACTIVE</> : <>CHART ACTIVE · 1R AT {riskFreePrice}</>;
  if (trade.status === 'risk-free') {
    return trade.result === 'rf' ? <>RF</> : <>1R HIT · RF ACTIVE</>;
  }
  if (trade.status === 'tp-hit') return <>TP HIT</>;
  if (trade.status === 'sl-hit') return <>SL HIT</>;
  return <>{tradeStatusLabel(trade)}</>;
};

function mt5SignalStatusLabel(signal: Mt5StoredSignal): string {
  if (signal.status === 'QUEUED') return 'MT5 QUEUED';
  if (signal.status === 'CLAIMED' || signal.status === 'PLACED') return 'MT5 PROCESSING';
  if (signal.status === 'ACTIVE') return signal.tradeStyle === 'SCALPING'
    ? `MT5 ACTIVE · 1R AT ${formatPrice(signal.riskFree)}` : 'MT5 ACTIVE';
  if (signal.status === 'RISK_FREE') return 'MT5 1R HIT · RF ACTIVE';
  if (signal.status === 'RF') return 'MT5 RF';
  if (signal.status === 'TP') {
    return signal.tradeStyle === 'SCALPING' && signal.rewardRisk === 1
      ? `TP HIT · RF ${formatPrice(signal.riskFree)}`
      : 'TP HIT';
  }
  if (signal.status === 'SL') return 'SL HIT';
  if (signal.status === 'CANCELLED') return 'MT5 CANCELLED';
  if (signal.status === 'EXPIRED') return 'MT5 EXPIRED';
  if (signal.status === 'SIMULATED') return 'MT5 SIMULATED';
  if (signal.message?.includes('daily loss')) return 'MT5 REJECTED · DAILY LOSS LIMIT';
  if (signal.message?.includes('open trades')) return 'MT5 REJECTED · OPEN TRADE LIMIT';
  if (signal.message?.toLowerCase().includes('spread')) return 'MT5 REJECTED · SPREAD LIMIT';
  return 'MT5 REJECTED · NO TRADE';
}

function mt5SignalStatusClassName(signal: Mt5StoredSignal): string {
  if (signal.status === 'SL' || signal.status === 'REJECTED'
    || signal.status === 'CANCELLED' || signal.status === 'EXPIRED') return 'text-rose-700';
  if (signal.status === 'QUEUED' || signal.status === 'CLAIMED'
    || signal.status === 'PLACED') return 'text-amber-700';
  return 'text-emerald-700';
}

function isCompletedTrade(trade: TradeLevels | undefined): boolean {
  return trade?.result !== undefined;
}

function resolveRetainedTrade(trade: TradeLevels, candles: OandaCandle[]): TradeLevels {
  if (trade.result || trade.filledAt === undefined) return trade;
  const isBuy = trade.signal.direction === 'bullish';
  let reachedRiskFree = false;
  for (const candle of candles) {
    if (candle.time < trade.filledAt) continue;
    const tpHit = isBuy ? candle.high >= trade.takeProfit : candle.low <= trade.takeProfit;
    const riskFreeHit = isBuy ? candle.high >= trade.riskFree : candle.low <= trade.riskFree;
    const slHit = isBuy ? candle.low <= trade.stopLoss : candle.high >= trade.stopLoss;
    if (tpHit) {
      return { ...trade, status: 'tp-hit', result: 'tp', resolvedAt: candle.time };
    }
    reachedRiskFree = trade.riskFreeEnabled !== false && (reachedRiskFree || riskFreeHit);
    if (slHit) {
      return {
        ...trade,
        status: reachedRiskFree ? 'risk-free' : 'sl-hit',
        result: reachedRiskFree ? 'rf' : 'sl',
        resolvedAt: candle.time,
      };
    }
  }
  return { ...trade, status: reachedRiskFree ? 'risk-free' : 'active' };
}

const TradeDetailsRow: React.FC<{
  trade: TradeLevels;
  colSpan: number;
  mtf?: boolean;
  oppositePositionOpen?: boolean;
  mt5Signal?: Mt5StoredSignal;
  referenceOnly?: boolean;
  hideReferenceStatus?: boolean;
}> = ({ trade, colSpan, mtf = false, oppositePositionOpen = false, mt5Signal, referenceOnly = false, hideReferenceStatus = false }) => (
  <tr className="border-t border-indigo-100 bg-indigo-50/70">
    <td colSpan={colSpan} className="px-2 py-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap text-[9px] font-black text-slate-700">
        {mtf && <span className="rounded bg-indigo-100 px-1 py-0.5 text-indigo-700">MTF</span>}
        {oppositePositionOpen && (
          <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-800">OPPOSITE MT5 POSITION · 1:1</span>
        )}
        <span className="text-blue-700">ENTRY <span className="tabular-nums font-semibold text-slate-700">{formatPrice(trade.entry)}</span></span>
        <span className="text-rose-700">SL <span className="tabular-nums font-semibold text-slate-700">{formatPrice(trade.stopLoss)}</span></span>
        <span className="text-emerald-700">TP <span className="tabular-nums font-semibold text-slate-700">{formatPrice(trade.takeProfit)}</span></span>
        <span>R:R 1:{trade.rewardRisk}</span>
        <span>SL {trade.riskPips} PIPS</span>
        {!(referenceOnly && hideReferenceStatus) && <span className={referenceOnly ? 'text-rose-700' : mt5Signal
          ? mt5SignalStatusClassName(mt5Signal)
          : trade.status === 'sl-hit'
            ? 'text-rose-700'
            : trade.status === 'pending'
              ? 'text-amber-700'
              : 'text-emerald-700'}>
          {referenceOnly ? 'OUTSIDE TRADING TIME · NO TRADE'
            : mt5Signal ? mt5SignalStatusLabel(mt5Signal) : <TradeStatusText trade={trade} />}
        </span>}
      </div>
    </td>
  </tr>
);

function displayZoneName(
  name: string,
  oneMinuteGenesisQml?: StructureZone['oneMinuteGenesisQml'],
): string {
  if (oneMinuteGenesisQml) return '1MG QML';
  return name.startsWith('Internal ') ? `Int ${name.slice('Internal '.length)}` : name;
}

function isDefaultDeepDiscountZoneName(name: string | undefined): boolean {
  return name === 'DB' || name === 'DT';
}

function displayConfluenceZoneName(
  zone: DisplayStructureZone,
  uppercaseSecondary = false,
): string {
  const primary = displayZoneName(zone.name, zone.oneMinuteGenesisQml);
  const secondary = displayZoneMembers(zone)
    .filter((member) => member.id !== zone.id)
    .map((member) => displayZoneName(member.name, member.oneMinuteGenesisQml))
    .map((name) => uppercaseSecondary ? name.toUpperCase() : name);
  return Array.from(new Set([primary, ...secondary])).join(' + ');
}

function confluenceBadgeLabels(zone: DisplayStructureZone): string[] {
  const labels: string[] = [];
  for (const member of displayZoneMembers(zone).filter((candidate) => candidate.id !== zone.id)) {
    if (member.chochClass === 'vip') {
      labels.push(member.category === 'internal' ? 'INT VIP' : 'VIP');
    }
    if (member.vipSupportTimeframe && member.vipSupportZone) {
      labels.push(
        `${formatTradeTimeframe(member.vipSupportTimeframe)} ${displayZoneName(member.vipSupportZone)}`,
      );
    }
    if (member.majorLiquidity) labels.push('MAJOR LIQUIDITY');
  }
  return Array.from(new Set(labels));
}

function confluenceMapValue<T>(
  zone: DisplayStructureZone,
  values: ReadonlyMap<string, T>,
): T | undefined {
  for (const member of displayZoneMembers(zone)) {
    const value = values.get(member.id);
    if (value !== undefined) return value;
  }
  return undefined;
}

function confluenceFirstValue<T>(
  zone: DisplayStructureZone,
  resolve: (member: StructureZone) => T | undefined,
): T | undefined {
  for (const member of displayZoneMembers(zone)) {
    const value = resolve(member);
    if (value !== undefined) return value;
  }
  return undefined;
}

function confluenceTapBarsAgo(zone: DisplayStructureZone): number | undefined {
  const values = displayZoneMembers(zone)
    .map((member) => member.lastTapBarsAgo ?? member.tapBarsAgo)
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? Math.min(...values) : undefined;
}

function confluenceLatestTap(zone: DisplayStructureZone): { time: number; count: number } | undefined {
  const taps = displayZoneMembers(zone)
    .map((member) => ({ time: member.lastTapTime ?? member.tapTime, count: member.tapCount ?? 1 }))
    .filter((tap): tap is { time: number; count: number } => tap.time !== undefined);
  return taps.sort((a, b) => b.time - a.time)[0];
}

function confluenceEngulfingLabel(zone: DisplayStructureZone): string | undefined {
  const labels = displayZoneMembers(zone)
    .map(displayEngulfingLabel)
    .filter((label): label is string => Boolean(label));
  return Array.from(new Set(labels)).join(' / ') || undefined;
}

function confluenceIsTradeable(zone: DisplayStructureZone): boolean {
  return displayZoneMembers(zone).some((member) => member.tradeable !== false);
}

function directEntryPolicyLabel(policy: DirectEntryPolicyDecision): string {
  if (policy.reason === 'zone-used') return 'ZONE ALREADY USED';
  if (policy.reason === 'outside-trading-time') return 'OUTSIDE TRADING TIME';
  if (policy.reason === 'volume-confirmed') return 'VOLUME PASSED';
  if (policy.reason === 'volume-unavailable') return 'VOLUME UNAVAILABLE';
  if (policy.reason === 'volume-not-applicable') return 'NO M1 VOLUME RULE';
  if (policy.reason === 'volume-failed') return 'VOLUME FAILED';
  return 'ENTRY VALID';
}

function displayFibLabel(zone: StructureZone): string {
  if (zone.fibBand === 'deep') {
    return 'FIB DEEP DISCOUNT';
  }
  return `A+ FIB ${zone.fibBand}`;
}

function tradeZoneFibLabels(zone: StructureZone): string[] {
  const labels: string[] = [];
  if (zone.fibStatus === 'a-plus' && zone.fibBand && zone.fibBand !== 'DB/DT') {
    labels.push(displayFibLabel(zone));
  }
  if (zone.swingFibStatus === 'a-plus' && zone.swingFibBand) {
    labels.push(`SWING A+ FIB ${zone.swingFibBand}`);
  }
  if (zone.dayFibStatus === 'a-plus' && zone.dayFibBand) {
    labels.push(`DAY FIB A+ ${zone.dayFibBand}`);
  }
  return labels;
}

function formatZonePips(pips: number): string {
  return zonePipsFormatter.format(pips);
}

function measureListedZone(zone: StructureZone, pipSize: number) {
  const qualifiedMeasurement = measureTradeableFibZone(zone, pipSize);
  if (qualifiedMeasurement) return qualifiedMeasurement;
  const width = Math.abs(zone.top - zone.bottom);
  if (!Number.isFinite(width) || width === 0 || !Number.isFinite(pipSize) || pipSize <= 0) {
    return undefined;
  }
  return {
    pips: Math.round((width / pipSize) * 100) / 100,
    midline: (zone.top + zone.bottom) / 2,
  };
}

function displayEngulfingLabel(zone: StructureZone): string | undefined {
  const labels = [
    isZoneEngulfingFibQualified(zone, 'structure') ? zone.engulfingType : undefined,
    isZoneEngulfingFibQualified(zone, 'swing') && zone.swingEngulfingType
      ? `SW ${zone.swingEngulfingType}` : undefined,
    isZoneEngulfingFibQualified(zone, 'day') && zone.dayEngulfingType
      ? `DAY ${zone.dayEngulfingType}` : undefined,
  ].filter((label): label is string => label !== undefined);
  if (labels.length > 0) return `${labels.join(' / ')} ${zone.isBuy ? 'BULL' : 'BEAR'}`;
  return isZoneEngulfingFibQualified(zone, 'structure')
    && zone.fallbackEngulfingType && zone.fallbackEngulfingTimeframe
    ? `${formatTradeTimeframe(zone.fallbackEngulfingTimeframe)} ${zone.fallbackEngulfingType} ${zone.isBuy ? 'BULL' : 'BEAR'}`
    : undefined;
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
  chochVisibility: ChochFibVisibility,
): boolean {
  const key = fibVisibilityKey(zone);
  if (key === 'choch') return showFib && chochVisibility.some(Boolean);
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

function candleCountdownSeconds(
  closesAt: number | undefined,
  granularity: OandaGranularity,
  nowSeconds: number,
): number {
  const duration = TIMEFRAME_SECONDS[granularity];
  if (closesAt === undefined) {
    const elapsedInCandle = ((nowSeconds % duration) + duration) % duration;
    return duration - elapsedInCandle;
  }
  if (closesAt > nowSeconds) return closesAt - nowSeconds;
  const elapsedAfterClose = nowSeconds - closesAt;
  return duration - (elapsedAfterClose % duration);
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
    <div data-journal-exclude="true" className={`pointer-events-auto absolute bottom-3 right-20 z-20 overflow-hidden rounded-md border border-slate-300 bg-white/95 shadow-sm ${expanded ? 'w-[238px]' : 'w-auto'}`}>
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
                    {replayActive
                      ? '—'
                      : formatCandleCountdown(candleCountdownSeconds(
                        row.closesAt,
                        row.granularity,
                        nowSeconds,
                      ))}
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

const MTF_TABLE_LABELS: Record<MtfGranularity, string> = {
  M1: '1m', M5: '5m', M15: '15m', H1: '1H', H4: '4H', D: '1D',
};

function mtfZoneLabel(name: StructureZone['name'], majorLiquidity = false): string {
  const label = name.startsWith('Internal ') ? name.slice('Internal '.length) : name;
  return majorLiquidity ? `${label} · Major Liquidity` : label;
}

function mtfSignalLabel(row: DisplayMtfRow, trade: TradeLevels | undefined): string {
  if ((row.chochSequence ?? 1) > 1) return mtfChochSequenceLabel(row.chochSequence!);
  if (row.sourcePairOverlapsHigherZone === false) {
    return 'CHOCH OBSERVED · SOURCE OUTSIDE ZONE · NO ENTRY';
  }
  if (row.tradingTimeBlocked) return trade
    ? `ENTRY ${formatPrice(trade.entry)} · OUTSIDE TRADING TIME · NO TRADE`
    : 'OUTSIDE TRADING TIME · NO TRADE';
  if (isCompletedTrade(trade)) return tradeStatusLabel(trade);
  if (!row.tappedZone) return 'Waiting for zone tap';
  if (!row.engulfingType) return 'Waiting';
  const type = row.engulfingType.replace('T', 'Type ');
  return `${row.goldScalping && trade ? 'SCALP ' : ''}${type} ${row.direction === 'bullish' ? 'BUY' : 'SELL'} ${
    trade ? 'MTF ENTRY' : 'CONFIRMED'
  }`;
}

type DisplayMtfRow = MtfRow & {
  setupId: string;
  trade?: TradeLevels;
  previewTrade?: TradeLevels;
  tradeBarsAgo?: number;
  tradingTimeBlocked?: boolean;
};

export function isSlTpTradeDisplayFinished(trade: { result?: string; status?: string } | undefined): boolean {
  return trade?.result === 'sl' || trade?.result === 'tp'
    || trade?.status === 'sl-hit' || trade?.status === 'tp-hit'
    || trade?.status === 'SL' || trade?.status === 'TP';
}

export function mtfTableHitExpired(
  hitAt: number | undefined, candles: readonly OandaCandle[], asOf: number, timeframe: TradeTimeframe,
): boolean {
  if (hitAt === undefined || hitAt > asOf) return false;
  let bars = 0;
  for (const candle of candles) {
    if (candle.time > hitAt && candle.complete !== false
      && candle.time + TIMEFRAME_SECONDS[timeframe] <= asOf && ++bars >= 5) return true;
  }
  return false;
}

type TradeDisplayState = {
  status?: string; result?: string; resolvedAt?: number; closedAt?: number; completedAt?: number;
  partialClosedAt?: number; updatedAt?: number; signalTimeframe?: TradeTimeframe;
  signal?: { timeframe: TradeTimeframe; direction: 'bullish' | 'bearish' };
  direction?: string; filledAt?: number; openedAt?: number; calculatedAt?: number; signalAt?: number;
  riskFree?: number; entry?: number; stopLoss?: number;
};

/** Display only: retain a hit for five completed candles of its entry timeframe. */
export function tradeDisplayExpired(
  trade: TradeDisplayState | undefined, candles: readonly OandaCandle[], asOf: number,
): boolean {
  if (!trade) return false;
  const timeframe = trade.signal?.timeframe ?? trade.signalTimeframe;
  if (!timeframe) return false;
  let hitAt: number | undefined;
  if (isSlTpTradeDisplayFinished(trade)) {
    hitAt = trade.resolvedAt ?? trade.closedAt ?? trade.completedAt ?? trade.updatedAt;
  } else if (trade.partialClosedAt !== undefined || trade.result === 'rf'
    || ['risk-free', 'RISK_FREE', 'RF'].includes(trade.status ?? '') || trade.result === 'risk-free') {
    hitAt = trade.partialClosedAt;
    if (hitAt === undefined) {
      const bullish = (trade.signal?.direction ?? trade.direction) === 'bullish' || trade.direction === 'BUY';
      const level = trade.riskFree ?? (trade.entry !== undefined && trade.stopLoss !== undefined
        ? trade.entry + (bullish ? 1 : -1) * Math.abs(trade.entry - trade.stopLoss) : undefined);
      hitAt = level === undefined ? undefined : candles.find(candle => (
        candle.time >= (trade.filledAt ?? trade.openedAt ?? trade.calculatedAt ?? trade.signalAt ?? Infinity)
        && candle.time <= asOf && (trade.resolvedAt === undefined || candle.time <= trade.resolvedAt)
        && (bullish ? candle.high >= level : candle.low <= level)
      ))?.time;
      hitAt ??= trade.resolvedAt ?? trade.closedAt ?? (trade.result === 'rf' ? trade.completedAt : undefined) ?? trade.updatedAt;
    }
  }
  return mtfTableHitExpired(hitAt, candles, asOf, timeframe);
}

/** Drawings stay through partial RF; count five candles only after the final exit. */
export function tradeDrawingExpired(
  trade: TradeDisplayState | undefined, candles: readonly OandaCandle[], asOf: number,
): boolean {
  const timeframe = trade?.signal?.timeframe ?? trade?.signalTimeframe;
  if (!trade || !timeframe) return false;
  // A final RF result means the remaining position closed at its stop after RF.
  // RISK_FREE/risk-free without a final result is still an open position.
  const closed = isSlTpTradeDisplayFinished(trade) || trade.result === 'rf' || trade.status === 'RF';
  if (!closed) return false;
  return mtfTableHitExpired(trade.resolvedAt ?? trade.closedAt ?? trade.completedAt ?? trade.updatedAt,
    candles, asOf, timeframe);
}

export function tradeDrawingFromRecord(record: JournalTradeRecord): TradeLevels & { partialClosedAt?: number } {
  const bullish = record.direction === 'bullish';
  return {
    entry: record.entry, stopLoss: record.stopLoss, takeProfit: record.takeProfit,
    riskFree: record.entry + (bullish ? 1 : -1) * Math.abs(record.entry - record.stopLoss),
    riskFreeEnabled: record.tradeStyle === 'SCALPING', riskPips: record.riskPips, rewardRisk: record.rewardRisk,
    status: record.result === 'tp' ? 'tp-hit' : record.result === 'sl' ? 'sl-hit' : 'risk-free',
    result: ['tp', 'sl', 'rf'].includes(record.result) ? record.result as 'tp' | 'sl' | 'rf' : undefined,
    resolvedAt: ['tp', 'sl', 'rf'].includes(record.result) ? record.closedAt ?? record.completedAt : undefined,
    partialClosedAt: record.partialClosedAt, filledAt: record.openedAt, pendingAtCreation: false,
    calculatedAt: (record.signalAt ?? record.openedAt ?? record.completedAt) + TIMEFRAME_SECONDS[record.signalTimeframe],
    signal: { type: record.engulfingType as EngulfingTradeSignal['type'], direction: record.direction,
      timeframe: record.signalTimeframe, time: record.signalAt ?? record.openedAt ?? record.completedAt,
      candleCount: record.engulfingCandleCount ?? (record.engulfingType === 'T1' ? 2 : 3) },
  };
}

export const MultiTimeframeEntryTable: React.FC<{
  rows: DisplayMtfRow[];
  liveTrades: LiveMt5TableTrade[];
  records: JournalTradeRecord[];
  timeZone: ChartTimeZone;
  entryCandles: Partial<Record<TradeTimeframe, readonly OandaCandle[]>>;
  asOf: number;
}> = ({ rows, liveTrades, records, timeZone, entryCandles, asOf }) => {
  const [expanded, setExpanded] = useState(true);
  const expired = (trade: TradeDisplayState | undefined) => tradeDisplayExpired(trade,
    entryCandles[trade?.signal?.timeframe ?? trade?.signalTimeframe ?? 'M1'] ?? [], asOf);
  const visibleLiveTrades = liveTrades.filter(({ signal, trade, position }) => {
    const recorded = records.find(record => record.brokerTicket === position.ticket
      || record.setupId !== undefined && record.setupId === position.setupId);
    return !expired(recorded && ['sl', 'tp', 'rf', 'risk-free'].includes(recorded.result) ? recorded : { ...trade, ...signal,
      status: signal?.status ?? position.signalStatus ?? trade.status });
  });
  const savedRows = records.filter(record => !expired(record) && !liveTrades.some(({ position }) => (
    position.ticket === record.brokerTicket || position.setupId === record.setupId && record.setupId !== undefined
  )));
  const displayRows = rows.filter((row) => !expired(row.trade ?? row.previewTrade) && !liveTrades.some(({ position }) => (
    liveMtfPositionMatchesChartRow(position, row)
  )) && !records.some(record => (
    record.setupId === `MTF:${row.id}` || record.signalAt === row.engulfingTime
      && record.zoneTimeframe === row.higherTimeframe
      && record.signalTimeframe === row.lowerTimeframe && record.direction === row.direction
  )));
  return (
    <div data-journal-exclude="true" className={`pointer-events-auto absolute right-3 top-3 z-20 overflow-hidden rounded-md border border-slate-300 bg-white/95 shadow-sm ${expanded ? 'w-fit max-w-[calc(100%_-_24px)]' : 'w-auto'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-indigo-50 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-indigo-700">
        <span>{expanded ? 'MTF table' : 'MTF table minimized'}</span>
        <button
          type="button"
          onClick={() => setExpanded((visible) => !visible)}
          className="rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[8px] font-black text-indigo-700 hover:bg-indigo-100"
          title={expanded ? 'Minimize MTF table' : 'Show MTF table'}
        >
          {expanded ? '− MINIMIZE' : '+ SHOW TABLE'}
        </button>
      </div>
      {expanded && (
        <div className="max-h-[50vh] overflow-auto">
        <table className="table-auto border-collapse text-left text-[9px]">
          <thead className="bg-slate-100 text-[9px] uppercase text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-2 py-1 font-bold">ID</th>
              <th className="whitespace-nowrap px-2 py-1 font-bold">MTF</th>
              <th className="whitespace-nowrap px-2 py-1 font-bold">Setup</th>
              <th className="whitespace-nowrap px-2 py-1 font-bold">HTF Zone Tapped</th>
              <th className="whitespace-nowrap px-2 py-1 font-bold">LTF Zone Tapped</th>
              <th className="whitespace-nowrap px-2 py-1 font-bold">Signal</th>
              <th className="whitespace-nowrap px-2 py-1 text-right font-bold">Entry Time / Bars</th>
            </tr>
          </thead>
          <tbody>
            {visibleLiveTrades.map(({ position, trade, signal }) => {
              const bullish = position.direction === 'BUY';
              return (
                <React.Fragment key={`live-mt5-${position.ticket}`}>
                  <tr className={`border-t ${bullish ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                    <td className="whitespace-nowrap px-2 py-1 font-black text-indigo-700">
                      MT5 #{position.ticket}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-black text-slate-700">
                      {position.zoneTimeframe ? formatTradeTimeframe(position.zoneTimeframe) : '?'} →{' '}
                      {position.signalTimeframe ? formatTradeTimeframe(position.signalTimeframe) : '?'}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-1 font-black ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {signal?.tradeStyle === 'SCALPING' ? 'SCALP · ' : ''}{bullish ? 'Bullish' : 'Bearish'} · MT5 OPEN
                    </td>
                    <td className={`whitespace-nowrap px-2 py-1 font-black ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {position.zoneTimeframe ? formatTradeTimeframe(position.zoneTimeframe) : '?'}{' '}
                      {signal?.journalContext?.mtfContext?.higherTimeframeZone
                        ?? signal?.zoneId?.replace(/-\d{9,}-.+$/, '') ?? 'Recorded HTF zone'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-bold text-slate-500">
                      {position.signalTimeframe} {signal?.journalContext?.mtfContext?.entryZone?.name ?? position.zoneName}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-1 font-black ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {signal ? mt5SignalStatusLabel(signal) : `MT5 ACTIVE ${position.direction}`}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right font-bold text-slate-500">
                      {formatChartTime(position.openedAt, timeZone)}
                    </td>
                  </tr>
                  <TradeDetailsRow trade={trade} colSpan={7} mtf mt5Signal={signal} />
                </React.Fragment>
              );
            })}
            {displayRows.map((row) => {
              const bullish = row.direction === 'bullish';
              const entry = row.engulfingType !== undefined;
              return (
                <React.Fragment key={row.id}>
                <tr className={`border-t ${bullish ? 'border-emerald-100 bg-emerald-50/50' : 'border-rose-100 bg-rose-50/50'}`}>
                  <td className="px-2 py-1 font-black whitespace-nowrap text-indigo-700">
                    {row.setupId}
                  </td>
                  <td className="px-2 py-1 font-black whitespace-nowrap text-slate-700">
                    {MTF_TABLE_LABELS[row.higherTimeframe]} → {MTF_TABLE_LABELS[row.lowerTimeframe]}
                  </td>
                  <td className={`px-2 py-1 font-black whitespace-nowrap ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {row.goldScalping ? 'SCALP · ' : ''}{bullish ? 'Bullish' : 'Bearish'} {row.confirmationKind === 'choch' ? 'CHOCH' : 'ISS'}
                  </td>
                  <td className={`px-2 py-1 font-black whitespace-nowrap ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                    <div>{MTF_TABLE_LABELS[row.higherTimeframe]} {mtfZoneLabel(
                      row.higherTimeframeZone,
                      row.higherTimeframeMajorLiquidity,
                    )}</div>
                    <div className="text-[7px] font-bold leading-tight text-slate-400">
                      {row.higherTimeframeTapBarsAgo} {row.higherTimeframeTapBarsAgo === 1 ? 'bar' : 'bars'} ago
                    </div>
                  </td>
                  <td className={`px-2 py-1 font-bold whitespace-nowrap ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {row.tappedZone
                      ? `${MTF_TABLE_LABELS[row.lowerTimeframe]} ${mtfZoneLabel(row.tappedZone)}`
                      : '—'}
                  </td>
                  <td className={`whitespace-nowrap px-2 py-1 font-black ${
                    row.trade?.status === 'sl-hit'
                      ? 'text-rose-700'
                      : entry ? bullish ? 'text-emerald-700' : 'text-rose-700' : 'text-slate-600'
                  }`}>
                    {mtfSignalLabel(row, row.trade ?? row.previewTrade)}
                  </td>
                  <td className="px-2 py-1 text-right font-bold whitespace-nowrap text-slate-500">
                    {row.tradeBarsAgo === undefined ? '—' : `${row.tradeBarsAgo} bars`}
                  </td>
                </tr>
                {(row.trade ?? row.previewTrade)
                  && <TradeDetailsRow trade={(row.trade ?? row.previewTrade)!} colSpan={7} mtf
                    referenceOnly={row.tradingTimeBlocked} />}
                </React.Fragment>
              );
            })}
            {savedRows.map(record => (
              <React.Fragment key={record.id}>
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td className="px-2 py-1 font-bold">{record.brokerTicket ? `MT5 #${record.brokerTicket}` : 'MTF TRADE'}</td>
                  <td className="px-2 py-1 font-bold">{formatTradeTimeframe(record.zoneTimeframe)} → {formatTradeTimeframe(record.signalTimeframe)}</td>
                  <td className="px-2 py-1">{record.direction === 'bullish' ? 'BUY' : 'SELL'} · {record.engulfingType}</td>
                  <td className="px-2 py-1">{record.mtfContext?.higherTimeframeZone ?? record.zoneId?.replace(/-\d{9,}-.+$/, '') ?? 'Recorded HTF zone'}</td>
                  <td className="px-2 py-1">{record.signalTimeframe} {record.mtfContext?.entryZone?.name ?? record.zoneName}</td>
                  <td className="px-2 py-1 font-bold">{record.result === 'sl' ? 'SL HIT' : record.result === 'tp' ? 'TP HIT' : record.result === 'rf' ? 'RISK FREE CLOSED' : record.result === 'risk-free' ? 'RISK FREE' : 'OPEN'}</td>
                  <td className="px-2 py-1">{formatChartTime(record.openedAt ?? record.signalAt ?? record.completedAt, timeZone)}</td>
                </tr>
                <tr className="border-b border-slate-200 bg-white">
                  <td colSpan={7} className="px-2 py-1">
                    ENTRY {formatPrice(record.entry)} · SL {formatPrice(record.stopLoss)} · TP {formatPrice(record.takeProfit)}
                    {!record.mtfContext?.entryZone && ' · Original entry-zone drawing not saved'}
                  </td>
                </tr>
              </React.Fragment>
            ))}
            {displayRows.length === 0 && visibleLiveTrades.length === 0 && savedRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-2 text-center text-slate-400">No active MTF setup</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
};

function accuracyCounts(records: AccuracyTradeRecord[]) {
  return records.reduce((counts, record) => ({
    sl: counts.sl + (record.result === 'sl' ? 1 : 0),
    rf: counts.rf + (record.result === 'rf' ? 1 : 0),
    tp: counts.tp + (record.result === 'tp' ? 1 : 0),
  }), { sl: 0, rf: 0, tp: 0 });
}

type AccuracyTradingTimeFilter = 'ALL' | 'TRADING' | 'NON_TRADING';

function matchesAccuracyTradingTime(
  record: AccuracyTradeRecord,
  filter: AccuracyTradingTimeFilter,
): boolean {
  if (filter === 'ALL') return true;
  return tradeRecordOutsideTradingTime(record) === (filter === 'NON_TRADING');
}

function accuracyRecordOutsideTradingTime(record: AccuracyTradeRecord): boolean {
  return tradeRecordOutsideTradingTime(record);
}

function formatAccuracyTradeTime(time: number, timeZone: ChartTimeZone): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(time * 1000)).replace(',', '');
}

const JOURNAL_SCREENSHOT_PREFIX = 'trade-journal-screenshot:';

async function resizeJournalScreenshot(dataUrl: string, maximumWidth = 1200): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Unable to prepare the journal screenshot.'));
  });
  if (image.width <= maximumWidth) return dataUrl;
  const scale = maximumWidth / image.width;
  const canvas = document.createElement('canvas');
  canvas.width = maximumWidth;
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.76);
}

function readPendingJournalScreenshot(tradeId: string): string | undefined {
  try {
    return window.localStorage.getItem(`${JOURNAL_SCREENSHOT_PREFIX}${tradeId}`) || undefined;
  } catch {
    return undefined;
  }
}

function journalFibMetadata(
  zone: StructureZone,
  signal: EngulfingTradeSignal,
): Pick<JournalTradeRecord, 'fibSource' | 'fibBand' | 'fibLevels'> {
  let fibSource = zone.majorLiquidity ? 'MAJOR LIQUIDITY' : 'ZONE FIB';
  let fibBand = zone.fibBand;
  if (signal.time === zone.swingEngulfingTime && signal.type === zone.swingEngulfingType) {
    fibSource = '4H SWING FIB';
    fibBand = zone.swingFibBand;
  } else if (signal.time === zone.dayEngulfingTime && signal.type === zone.dayEngulfingType) {
    fibSource = 'DAY FIB';
    fibBand = zone.dayFibBand;
  }
  const fibLevels = zone.fibSourcePrice !== undefined && zone.fibZeroPrice !== undefined
    ? [0.5, 0.618, 0.71, 0.79].map((level) => ({
      label: String(level),
      price: zone.fibZeroPrice! + (zone.fibSourcePrice! - zone.fibZeroPrice!) * level,
    }))
    : undefined;
  return { fibSource, fibBand, fibLevels };
}

function journalVolumeMetadata(
  candles: OandaCandle[],
  signal: EngulfingTradeSignal,
): Pick<JournalTradeRecord, 'volumeLogicStatus' | 'volume1' | 'volume2' | 'volume3'> {
  const assessment = assessEngulfingVolumeLogic(candles, signal);
  return {
    volumeLogicStatus: getEngulfingVolumeStatus(assessment, signal.type),
    volume1: assessment.firstVolume,
    volume2: assessment.secondVolume,
    volume3: assessment.thirdVolume,
  };
}

const EngulfingAccuracyTable: React.FC<{
  records: AccuracyTradeRecord[];
  allRecords: AccuracyTradeRecord[];
  timeframe: OandaGranularity;
  showAllTrades: boolean;
  historyAsOf: number;
  timeZone: ChartTimeZone;
  marketSymbol: OandaMarketSymbol;
  entryArrowsVisible: boolean;
  onClose: () => void;
  onVisibleRecordIdsChange: (ids: string[]) => void;
}> = ({ records, allRecords, timeframe, showAllTrades, historyAsOf, timeZone, marketSymbol, entryArrowsVisible, onClose, onVisibleRecordIdsChange }) => {
  const [filters, setFilters] = useState<TradeRecordFilters>(() => ({
    ...DEFAULT_TRADE_RECORD_FILTERS,
    timeframes: [timeframe],
  }));
  useEffect(() => {
    setFilters((current) => ({ ...current, timeframes: [timeframe] }));
  }, [timeframe]);
  const [tradingTimeFilter, setTradingTimeFilter] = useState<AccuracyTradingTimeFilter>('ALL');
  const [tradeStyleFilter, setTradeStyleFilter] = useState<'ALL' | 'SCALPING' | 'INTRADAY'>('ALL');
  const selectedStyle = marketSymbol === 'XAUUSD' ? tradeStyleFilter : 'ALL';
  const matchesStyle = (record: AccuracyTradeRecord) => selectedStyle === 'ALL'
    || record.tradeStyle === selectedStyle;
  const historyWindow = twoMonthAccuracyWindow(historyAsOf);
  const formatHistoryDate = (time: number) => new Date(time * 1000).toLocaleDateString('en-GB', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric',
  });
  const filteredAllRecords = useMemo(
    () => filterAccuracyTradeRecords<AccuracyTradeRecord>(selectTwoMonthAccuracyRecords(allRecords, historyAsOf), filters, timeZone, marketSymbol)
      .filter((record) => matchesAccuracyTradingTime(record, tradingTimeFilter)
        && matchesStyle(record)),
    [allRecords, filters, timeZone, tradingTimeFilter, selectedStyle, historyAsOf, marketSymbol],
  );
  const summaryRecords = filteredAllRecords;
  const visibleChartIds = useMemo(() => {
    const selectedIds = new Set(summaryRecords.map((record) => record.id));
    return new Set(records.filter((record) => selectedIds.has(record.id)).map((record) => record.id));
  }, [records, summaryRecords]);
  useEffect(() => {
    onVisibleRecordIdsChange(summaryRecords.map((record) => record.id));
  }, [onVisibleRecordIdsChange, summaryRecords]);
  const timeframeCounts = accuracyCounts(summaryRecords);
  const availableTimeframes = useMemo(() => Array.from(new Set<TradeTimeframe>(
    [...TIMEFRAMES.map(({ value }) => value), ...allRecords.map((record) => record.signalTimeframe)],
  )).sort((first, second) => TIMEFRAME_SECONDS[first] - TIMEFRAME_SECONDS[second]), [allRecords]);
  const availableZones = useMemo(() => Array.from(new Set(
    allRecords.map((record) => record.zoneName),
  )).sort(), [allRecords]);
  const extraZoneRows: string[] = Array.from(new Set<string>(
    summaryRecords.map((record) => record.zoneName),
  ))
    .filter((zoneName) => !ACCURACY_ZONE_ROWS.includes(zoneName));
  const zoneRows = [...ACCURACY_ZONE_ROWS, ...extraZoneRows];
  const resultRow = (title: string, counts: ReturnType<typeof accuracyCounts>) => {
    const total = counts.sl + counts.rf + counts.tp;
    const accuracy = total > 0 ? `${Math.round((counts.tp * 10_000) / total) / 100}%` : '—';
    return (
      <tr key={title} className="border-t border-slate-200 bg-white/95">
        <td className="whitespace-nowrap px-1.5 py-0.5 text-left font-bold text-slate-700">{title}</td>
        <td className="px-1.5 py-0.5 font-black text-rose-700">{counts.sl}</td>
        <td className="px-1.5 py-0.5 font-black text-amber-600">{counts.rf}</td>
        <td className="px-1.5 py-0.5 font-black text-emerald-700">{counts.tp}</td>
        <td className="px-1.5 py-0.5 font-bold text-slate-700">{total}</td>
        <td className="px-1.5 py-0.5 font-black text-indigo-700">{accuracy}</td>
      </tr>
    );
  };
  const header = (firstColumn: string) => (
    <tr className="bg-slate-500 text-[8px] uppercase text-white">
      <th className="whitespace-nowrap px-1.5 py-0.5 text-left">{firstColumn}</th>
      <th className="px-1.5 py-0.5">SL</th>
      <th className="px-1.5 py-0.5">RF</th>
      <th className="px-1.5 py-0.5">TP</th>
      <th className="px-1.5 py-0.5">Total</th>
      <th className="whitespace-nowrap px-1.5 py-0.5">Accuracy%</th>
    </tr>
  );

  return (
    <div data-journal-exclude="true" className={`pointer-events-auto absolute z-30 overflow-hidden rounded-md border border-slate-300 bg-white/95 shadow-md ${
      showAllTrades
        ? 'bottom-3 left-3 top-3 flex w-fit max-w-[calc(100%_-_24px)] flex-col'
        : 'left-3 top-1/2 flex max-h-[calc(100%_-_24px)] max-w-[calc(100%_-_24px)] -translate-y-1/2 flex-col'
    }`}>
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-300 bg-indigo-50 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-indigo-700">
        <span>
          {marketSymbol} trade accuracy · {entryArrowsVisible ? visibleChartIds.size : 0} arrow{visibleChartIds.size === 1 && entryArrowsVisible ? '' : 's'}
        </span>
        <TradeMultiSelect
          allLabel="ALL TIMEFRAMES"
          emptyLabel="NO TIMEFRAMES"
          selected={filters.timeframes}
          options={availableTimeframes.map((value) => ({ value, label: formatTradeTimeframe(value) }))}
          onChange={(timeframes) => setFilters((current) => ({
            ...current,
            timeframes: timeframes as TradeRecordFilters['timeframes'],
          }))}
        />
        <select
          value={tradingTimeFilter}
          onChange={(event) => setTradingTimeFilter(event.target.value as AccuracyTradingTimeFilter)}
          className="rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-indigo-700"
          aria-label="Filter accuracy by trading time"
          title="Classify by Nepal trading sessions at entry time"
        >
          <option value="ALL">ALL TIMES</option>
          <option value="TRADING">TRADING TIME</option>
          <option value="NON_TRADING">NON-TRADING TIME</option>
        </select>
        {marketSymbol === 'XAUUSD' && <select
          value={tradeStyleFilter}
          onChange={(event) => setTradeStyleFilter(event.target.value as 'ALL' | 'SCALPING' | 'INTRADAY')}
          className="rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-indigo-700"
          aria-label="Filter accuracy by trade style"
        >
          <option value="ALL">ALL STYLES</option>
          <option value="SCALPING">SCALPING</option>
          <option value="INTRADAY">INTRADAY</option>
        </select>}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid h-5 w-5 place-items-center rounded-full border border-indigo-200 bg-white text-[10px] font-black leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          title="Close accuracy table"
          aria-label="Close accuracy table"
        >
          ×
        </button>
      </div>
      <div className="shrink-0 border-b border-indigo-100 bg-white px-2 py-1 text-[9px] font-bold text-indigo-700">
        {formatHistoryDate(historyWindow.from)} – {formatHistoryDate(historyWindow.to)}
      </div>
      <div className={showAllTrades ? 'flex min-h-0 flex-1' : 'min-h-0 overflow-auto'}>
        <div className={showAllTrades ? 'w-[290px] shrink-0 overflow-auto border-r border-slate-300' : ''}>
          <table className="w-full border-collapse text-center text-[9px]">
            <thead>{header('Timeframe')}</thead>
            <tbody>
              {resultRow(filters.timeframes === 'ALL'
                ? 'ALL'
                : filters.timeframes.map((value) => GRANULARITY_LABELS[value].toUpperCase()).join(', ') || 'NONE', timeframeCounts)}
              {marketSymbol === 'XAUUSD' && <>
                {header('Trade style')}
                {resultRow('INTRADAY', accuracyCounts(summaryRecords.filter((record) => record.tradeStyle === 'INTRADAY')))}
                {resultRow('SCALPING', accuracyCounts(summaryRecords.filter((record) => record.tradeStyle === 'SCALPING')))}
              </>}
              {header('Trade source')}
              {resultRow('ENGULFING', accuracyCounts(
                summaryRecords.filter((record) => record.source === 'ENGULFING'),
              ))}
              {resultRow('MTF', accuracyCounts(
                summaryRecords.filter((record) => record.source === 'MTF'),
              ))}
              {header('Zone type')}
              {zoneRows.map((zoneName) => resultRow(
                zoneName,
                accuracyCounts(summaryRecords.filter((record) => record.zoneName === zoneName)),
              ))}
            </tbody>
          </table>
        </div>
        {showAllTrades && (
          <div className="min-w-0 max-w-[calc(100vw-338px)] flex-1 overflow-auto">
            <div className="sticky left-0 top-0 z-20 border-b border-indigo-200 bg-indigo-50">
              <div className="bg-indigo-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-indigo-800">
                All completed setups · {filteredAllRecords.length}/{allRecords.length} shown · {entryArrowsVisible ? visibleChartIds.size : 0} chart arrows · newest first
              </div>
              <div className="flex flex-wrap items-center gap-1 border-t border-indigo-100 px-1.5 py-1">
                <select value={filters.datePeriod} onChange={(event) => setFilters((current) => ({
                  ...current,
                  datePeriod: event.target.value as TradeRecordFilters['datePeriod'],
                }))} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[8px] font-bold">
                  <option value="DAY">DAILY</option><option value="WEEK">WEEKLY</option><option value="MONTH">MONTHLY</option>
                </select>
                <input type="date" value={filters.date === 'ALL' ? '' : filters.date} onChange={(event) => setFilters((current) => ({
                  ...current, date: event.target.value || 'ALL',
                }))} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[8px] font-bold" title="Choose any date" />
                {filters.date !== 'ALL' && filters.datePeriod !== 'DAY' && (
                  <span className="whitespace-nowrap text-[8px] font-bold text-indigo-700">
                    {tradeRecordPeriodLabel(tradeRecordDatePeriodKey(filters.date, filters.datePeriod), filters.datePeriod)}
                  </span>
                )}
                {filters.date !== 'ALL' && <button type="button" onClick={() => setFilters((current) => ({ ...current, date: 'ALL' }))} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[8px] font-black text-slate-500">ALL DATES</button>}
                <select value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value as TradeRecordFilters['source'] }))} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[8px] font-bold">
                  <option value="ALL">ALL SOURCES</option><option value="ENGULFING">ENGULFING</option><option value="MTF">MTF</option>
                </select>
                <select value={filters.side} onChange={(event) => setFilters((current) => ({ ...current, side: event.target.value as TradeRecordFilters['side'] }))} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[8px] font-bold">
                  <option value="ALL">ALL SIDES</option><option value="BUY">BUY</option><option value="SELL">SELL</option>
                </select>
                <select value={filters.result} onChange={(event) => setFilters((current) => ({ ...current, result: event.target.value as TradeRecordFilters['result'] }))} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[8px] font-bold">
                  <option value="ALL">ALL RESULTS</option><option value="tp">TP</option><option value="sl">SL</option><option value="rf">RF</option>
                </select>
                <TradeMultiSelect
                  allLabel="ALL ZONES"
                  emptyLabel="NO ZONES"
                  selected={filters.zones}
                  options={availableZones.map((value) => ({ value, label: value }))}
                  onChange={(zones) => setFilters((current) => ({ ...current, zones }))}
                />
                <button type="button" onClick={() => {
                  setFilters({ ...DEFAULT_TRADE_RECORD_FILTERS, timeframes: [timeframe] });
                  setTradingTimeFilter('ALL');
                  setTradeStyleFilter('ALL');
                }} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[8px] font-black text-slate-600 hover:bg-slate-100">RESET</button>
              </div>
            </div>
            <table className="min-w-[1010px] border-collapse text-center text-[9px]">
              <thead className="sticky top-[55px] z-10 bg-slate-600 uppercase text-white">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="whitespace-nowrap px-1.5 py-1 text-left">Completed</th>
                <th className="whitespace-nowrap px-1.5 py-1 text-left">Entered</th>
                <th className="px-1.5 py-1">On chart</th>
                <th className="whitespace-nowrap px-1.5 py-1">Trading time</th>
                <th className="px-1.5 py-1">TF</th>
                <th className="px-1.5 py-1">Source</th>
                <th className="px-1.5 py-1">Style</th>
                <th className="whitespace-nowrap px-1.5 py-1 text-left">Zone</th>
                <th className="px-1.5 py-1">Side</th>
                <th className="px-1.5 py-1">Result</th>
                <th className="px-1.5 py-1">Entry</th>
                <th className="px-1.5 py-1">SL</th>
                <th className="px-1.5 py-1">TP</th>
                <th className="px-1.5 py-1">R:R</th>
              </tr>
              </thead>
              <tbody>
              {filteredAllRecords.map((record, index) => (
                  <tr key={record.id} title={`Trade ID: ${record.id}`} className="border-t border-slate-200 odd:bg-white even:bg-slate-50">
                  <td className="px-1.5 py-1 text-slate-500">{index + 1}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-left text-slate-600">
                    {formatAccuracyTradeTime(record.completedAt, timeZone)}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-left text-slate-600">
                    {record.openedAt !== undefined
                      ? formatAccuracyTradeTime(record.openedAt, timeZone)
                      : record.signalAt !== undefined
                        ? formatAccuracyTradeTime(record.signalAt + TIMEFRAME_SECONDS[record.signalTimeframe], timeZone)
                        : '—'}
                  </td>
                  <td className={`px-1.5 py-1 font-black ${entryArrowsVisible && visibleChartIds.has(record.id) ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {entryArrowsVisible && visibleChartIds.has(record.id) ? 'ARROW' : '—'}
                  </td>
                  <td className={`whitespace-nowrap px-1.5 py-1 font-bold ${accuracyRecordOutsideTradingTime(record) ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {accuracyRecordOutsideTradingTime(record) ? 'OUTSIDE TIME' : 'IN SESSION'}
                  </td>
                  <td className="px-1.5 py-1 font-bold text-slate-700">
                    {formatTradeTimeframe(record.signalTimeframe)}
                  </td>
                  <td className="px-1.5 py-1 font-bold text-slate-600">{record.source}</td>
                  <td className="px-1.5 py-1 font-bold text-indigo-700">{record.tradeStyle ?? '—'}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-left font-bold text-slate-700">
                    {record.zoneName}
                  </td>
                  <td className={`px-1.5 py-1 font-black ${
                    record.direction === 'bullish' ? 'text-emerald-700' : 'text-rose-700'
                  }`}>
                    {record.direction === 'bullish' ? 'BUY' : 'SELL'}
                  </td>
                  <td className={`px-1.5 py-1 font-black ${
                    record.result === 'tp'
                      ? 'text-emerald-700'
                      : record.result === 'rf' ? 'text-amber-600' : 'text-rose-700'
                  }`}>
                    {record.result.toUpperCase()}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-slate-700">{formatPrice(record.entry)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-slate-700">{formatPrice(record.stopLoss)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-slate-700">{formatPrice(record.takeProfit)}</td>
                  <td className="px-1.5 py-1 font-bold text-slate-700">1:{record.rewardRisk}</td>
                  </tr>
                ))}
              {filteredAllRecords.length === 0 && (
                  <tr>
                    <td colSpan={15} className="px-2 py-3 text-center text-slate-400">
                      {selectedStyle === 'INTRADAY'
                        ? 'No classified Intraday trades yet; rules are still being defined.'
                        : 'No completed setups match these filters'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const OandaProChart: React.FC = () => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartPaneRef = useRef<HTMLDivElement | null>(null);
  const drawingToolbarDragRef = useRef<{
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const markersRef = useRef<any>(null);
  const zoneLayerRef = useRef<HTMLDivElement | null>(null);
  const livePriceLabelRef = useRef<HTMLDivElement | null>(null);
  const livePriceValueRef = useRef<HTMLSpanElement | null>(null);
  const liveCountdownRef = useRef<HTMLSpanElement | null>(null);
  const headerOpenRef = useRef<HTMLElement | null>(null);
  const headerHighRef = useRef<HTMLElement | null>(null);
  const headerLowRef = useRef<HTMLElement | null>(null);
  const headerCloseRef = useRef<HTMLElement | null>(null);
  const headerChangeRef = useRef<HTMLSpanElement | null>(null);
  const updateHeaderCandleRef = useRef<(timestamp?: number) => void>(() => undefined);
  const replaySelectionLineRef = useRef<HTMLDivElement | null>(null);
  const journalSyncSignatureRef = useRef('');
  const telegramAlertSentRef = useRef(new Set<string>());
  const telegramAlertSendingRef = useRef(false);
  const mt5JournalImageSignatureRef = useRef('');
  const capturedTradeSetupsRef = useRef(new Set<string>());
  const zonesRef = useRef<StructureZone[]>([]);
  const visualZonesRef = useRef<DisplayStructureZone[]>([]);
  const swingFibMovesRef = useRef<SwingFibMove[]>([]);
  const dayFibMovesRef = useRef<DayFibMove[]>([]);
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
  const chochFibVisibilityRef = useRef<ChochFibVisibility>(DEFAULT_CHOCH_FIB_VISIBILITY);
  const showInvalidZonesRef = useRef(false);
  const showTradeLevelsRef = useRef(true);
  const tradeOverlaysRef = useRef<TradeOverlay[]>([]);
  const entryHoversRef = useRef<EntryHover[]>([]);
  const [hoveredEntry, setHoveredEntry] = useState<{ entry: EntryHover; x: number; y: number } | null>(null);
  const redrawZonesRef = useRef<() => void>(() => undefined);
  const overlayRedrawFrameRef = useRef<number | null>(null);
  const drawingRedrawFrameRef = useRef<number | null>(null);
  const drawingRedrawTimerRef = useRef<number | null>(null);
  const lastDrawingRedrawAtRef = useRef(0);
  const hasChartDrawingLayerRef = useRef(false);
  const hasFittedRef = useRef(false);
  const pendingMarketSymbolFitRef = useRef(false);
  const replayTimeRef = useRef<number | null>(null);
  const pendingReplayViewportRef = useRef<{ fromOffset: number; toOffset: number } | null>(null);
  const loadRequestIdRef = useRef(0);
  const loadedGranularityRef = useRef<OandaGranularity>('M15');
  const loadedDataSourceRef = useRef<LiveChartDataSource>('OANDA');
  const loadedMarketSymbolRef = useRef<OandaMarketSymbol>('XAUUSD');
  const candlesRef = useRef<OandaCandle[]>([]);
  const analysisWorkerRef = useRef<Worker | null>(null);
  const analysisRequestIdRef = useRef(0);
  const analysisRequestsRef = useRef(new Map<number, {
    resolve: (updates: PreparedStructureAnalysis[]) => void;
    reject: (error: Error) => void;
  }>());
  const preparedAnalysesRef = useRef(new Map<string, PreparedStructureAnalysis>());
  const supportAnalysisCacheRef = useRef<Partial<Record<MarketGranularity, {
    candles: OandaCandle[];
    structure: ReturnType<typeof analyzeMarketStructure>;
  }>>>({});
  const supportContextsRef = useRef<Array<{ timeframe: string; zones: StructureZone[] }>>([]);
  const tableAnalysisCacheRef = useRef<Partial<Record<OandaGranularity, {
    candles: OandaCandle[];
    structure: ReturnType<typeof analyzeMarketStructure>;
  }>>>({});
  const replaySelectingRef = useRef(false);
  const replaySelectionIndexRef = useRef<number | null>(null);
  const syncReplaySelectionLineRef = useRef<() => void>(() => undefined);
  const [granularity, setGranularity] = useState<OandaGranularity>('M15');
  const [marketSymbol, setMarketSymbol] = useState<OandaMarketSymbol>(loadStoredMarketSymbol);
  const [liveChartDataSource, setLiveChartDataSource] = useState<LiveChartDataSource>('OANDA');
  const [candles, setCandles] = useState<OandaCandle[]>([]);
  const [vipCandles, setVipCandles] = useState<Partial<Record<MarketGranularity, OandaCandle[]>>>({});
  const vipCandlesRef = useRef(vipCandles);
  vipCandlesRef.current = vipCandles;
  const [source, setSource] = useState('Loading TradingView OANDA candles');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [chartTimeZone, setChartTimeZone] = useState<ChartTimeZone>('Asia/Kathmandu');
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
  const [chochFibVisibility, setChochFibVisibility] = useState<ChochFibVisibility>(
    DEFAULT_CHOCH_FIB_VISIBILITY,
  );
  const [showEngulfing, setShowEngulfing] = useState(true);
  const [tradingTimeEnabled, setTradingTimeEnabled] = useState(false);
  const [telegramMessagesEnabled, setTelegramMessagesEnabled] = useState(true);
  const [showInvalidZones, setShowInvalidZones] = useState(false);
  const [showTradeLevels, setShowTradeLevels] = useState(true);
  const [showEntryArrows, setShowEntryArrows] = useState(false);
  const [showAccuracyTable, setShowAccuracyTable] = useState(false);
  const [visibleAccuracyRecordIds, setVisibleAccuracyRecordIds] = useState<string[] | null>(null);
  const [showAccuracyOptions, setShowAccuracyOptions] = useState(false);
  const [showAllAccuracyTrades, setShowAllAccuracyTrades] = useState(false);
  const [showJournal, setShowJournal] = useState(() => (
    new URLSearchParams(window.location.search).get('journal') === '1'
  ));
  const [savedJournalTrades, setSavedJournalTrades] = useState<AccuracyTradeRecord[]>([]);
  const [mt5Status, setMt5Status] = useState<Mt5AutomationStatus | null>(null);
  const dailyRisk = mt5Status?.bridge.dailyRisk;
  const overallProfit = mt5Status?.bridge.overallProfit;
  const dailyRiskMoney = (value: number) => `${mt5Status?.bridge.currency === 'USD' ? '$' : `${mt5Status?.bridge.currency || 'USD'} `}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const overallProfitMoney = (value: number) => `${value < 0 ? '-' : ''}${dailyRiskMoney(Math.abs(value))}`;
  const scalpingEnabled = mt5Status?.config.scalpingEnabled ?? true;
  const intradayEnabled = mt5Status?.config.intradayEnabled ?? true;
  const tradeStyleEnabled = useCallback((trade: {
    tradeStyle?: 'SCALPING' | 'INTRADAY'; zoneTimeframe?: TradeTimeframe;
  }) => isTradeStyleEnabled({ scalpingEnabled, intradayEnabled }, trade),
  [scalpingEnabled, intradayEnabled]);
  const directTradeStyleEnabled = tradeStyleEnabled({
    tradeStyle: marketSymbol === 'XAUUSD' ? 'INTRADAY' : undefined,
    zoneTimeframe: granularity,
  });
  const overlayStyleEnabled = useCallback((overlay: TradeOverlay) => {
    const stored = (mt5Status?.recentSignals ?? []).find((signal) => (
      overlay.id === `MT5:${signal.brokerTicket}`
      || (overlay.setupId !== undefined && overlay.setupId === signal.setupId)
    ));
    return tradeStyleEnabled(stored ?? {
      tradeStyle: overlay.id.startsWith('GOLD_SCALP:') || overlay.label?.includes('SCALP')
        ? 'SCALPING' : marketSymbol === 'XAUUSD' ? 'INTRADAY' : undefined,
      zoneTimeframe: overlay.chartTimeframe ?? granularity,
    });
  }, [granularity, marketSymbol, mt5Status?.recentSignals, tradeStyleEnabled]);
  const visibleMt5Positions = useMemo(() => (mt5Status?.positions ?? []).filter((position) => {
    const signal = (mt5Status?.recentSignals ?? []).find((candidate) => (
      candidate.brokerTicket === position.ticket
      || (position.setupId !== undefined && candidate.setupId === position.setupId)
    ));
    return tradeStyleEnabled(signal ?? { zoneTimeframe: position.zoneTimeframe });
  }), [mt5Status?.positions, mt5Status?.recentSignals, tradeStyleEnabled]);
  useEffect(() => { setHoveredEntry(null); }, [tradeStyleEnabled]);
  const [mt5SettingsOpen, setMt5SettingsOpen] = useState(false);
  const [mt5BridgeControlError, setMt5BridgeControlError] = useState<string | null>(null);
  const [showIndicatorControls, setShowIndicatorControls] = useState(false);
  const [showZoneComparison, setShowZoneComparison] = useState(false);
  const [showLtfChoch, setShowLtfChoch] = useState(false);
  const [comparisonTimeframe, setComparisonTimeframe] = useState<OandaGranularity | null>(null);
  const [hiddenComparisonZoneKeys, setHiddenComparisonZoneKeys] = useState<string[]>([]);
  const [showDrawingTools, setShowDrawingTools] = useState(false);
  const [activeDrawingTool, setActiveDrawingTool] = useState<ChartDrawingTool | null>(null);
  const [chartDrawings, setChartDrawings] = useState<ChartDrawing[]>(loadStoredChartDrawings);
  const [drawingDraft, setDrawingDraft] = useState<ChartDrawingDraft | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [showDrawingVisibility, setShowDrawingVisibility] = useState(false);
  const [drawingToolbarPosition, setDrawingToolbarPosition] = useState<{ left: number; top: number } | null>(null);
  const [drawingTextEditor, setDrawingTextEditor] = useState<ChartDrawingTextEditor | null>(null);
  const [drawingDrag, setDrawingDrag] = useState<ChartDrawingDrag | null>(null);
  const [drawingRenderVersion, setDrawingRenderVersion] = useState(0);
  const [showZoneTable, setShowZoneTable] = useState(true);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySelecting, setReplaySelecting] = useState(false);
  const [replaySelectionIndex, setReplaySelectionIndex] = useState<number | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [trackedDirectTradeSetups, setTrackedDirectTradeSetups] = useState<
  Map<string, TrackedDirectTradeSetup>
  >(new Map());
  const [retainedChartTradeOverlays, setRetainedChartTradeOverlays] = useState<
  Map<string, TradeOverlay>
  >(loadStoredRetainedChartTrades);
  const hasAnyFibMarking = Object.values(fibVisibility).some(Boolean)
    || Object.values(fibPreviousVisibility).some(Boolean)
    || chochFibVisibility.some(Boolean);

  candlesRef.current = candles;
  replaySelectingRef.current = replaySelecting;
  replaySelectionIndexRef.current = replaySelectionIndex;

  const marketConfig = oandaMarketSymbolConfig(marketSymbol);
  const mtfLtfFibRequired = mt5Status?.config.mtfLtfFibRequired === true;
  const drawingScope = `${liveChartDataSource}:${marketSymbol}`;
  hasChartDrawingLayerRef.current = chartDrawings.length > 0 || drawingDraft !== null;

  useEffect(() => {
    window.localStorage.setItem(CHART_DRAWINGS_STORAGE_KEY, JSON.stringify(chartDrawings));
  }, [chartDrawings]);

  useEffect(() => {
    window.localStorage.setItem(MARKET_SYMBOL_STORAGE_KEY, marketSymbol);
  }, [marketSymbol]);

  useEffect(() => {
    window.localStorage.setItem(
      RETAINED_CHART_TRADES_STORAGE_KEY,
      JSON.stringify([...retainedChartTradeOverlays.values()]),
    );
  }, [retainedChartTradeOverlays]);

  useEffect(() => {
    setDrawingDraft(null);
    setDrawingDrag(null);
    setSelectedDrawingId(null);
    setShowDrawingVisibility(false);
  }, [drawingScope, granularity]);

  useEffect(() => {
    setDrawingToolbarPosition(null);
    drawingToolbarDragRef.current = null;
    setDrawingTextEditor((current) => (
      current?.drawingId === selectedDrawingId ? current : null
    ));
  }, [selectedDrawingId]);

  useEffect(() => {
    const moveToolbar = (event: MouseEvent) => {
      const drag = drawingToolbarDragRef.current;
      const pane = chartPaneRef.current;
      if (!drag || !pane) return;
      const bounds = pane.getBoundingClientRect();
      setDrawingToolbarPosition({
        left: Math.max(0, Math.min(bounds.width - drag.width, event.clientX - bounds.left - drag.offsetX)),
        top: Math.max(0, Math.min(bounds.height - drag.height, event.clientY - bounds.top - drag.offsetY)),
      });
    };
    const finishToolbarMove = () => {
      drawingToolbarDragRef.current = null;
    };
    window.addEventListener('mousemove', moveToolbar);
    window.addEventListener('mouseup', finishToolbarMove);
    return () => {
      window.removeEventListener('mousemove', moveToolbar);
      window.removeEventListener('mouseup', finishToolbarMove);
    };
  }, []);

  useEffect(() => {
    const cancelDrawing = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawingDraft(null);
      setDrawingDrag(null);
      setSelectedDrawingId(null);
      setShowDrawingVisibility(false);
      setActiveDrawingTool(null);
    };
    window.addEventListener('keydown', cancelDrawing);
    return () => window.removeEventListener('keydown', cancelDrawing);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/journal/trades?view=dashboard', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; trades?: AccuracyTradeRecord[] };
        if (!cancelled && response.ok && payload.ok && Array.isArray(payload.trades)) {
          setSavedJournalTrades(payload.trades);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const refreshMt5Status = useCallback(async () => {
    try {
      const response = await fetch('/api/mt5/status', { cache: 'no-store' });
      const payload = await response.json() as Mt5AutomationStatus;
      if (response.ok && payload.ok) {
        setMt5Status((current) => current
          && mt5StatusRenderSignature(current) === mt5StatusRenderSignature(payload)
          ? current
          : payload);
      }
    } catch {
      // The chart remains usable when the optional local bridge is offline.
    }
  }, []);

  useEffect(() => {
    void refreshMt5Status();
    const timer = window.setInterval(() => void refreshMt5Status(), 5_000);
    return () => window.clearInterval(timer);
  }, [refreshMt5Status]);

  const mt5JournalLifecycleSignature = useMemo(() => (
    (mt5Status?.recentSignals ?? [])
      .filter((signal) => ['ACTIVE', 'RISK_FREE', 'TP', 'SL', 'RF'].includes(signal.status))
      .map((signal) => `${signal.id}:${signal.status}:${signal.updatedAt}`)
      .sort()
      .join('|')
  ), [mt5Status?.recentSignals]);

  useEffect(() => {
    const lifecycleSignals = (mt5Status?.recentSignals ?? []).filter((signal) => (
      ['ACTIVE', 'RISK_FREE', 'TP', 'SL', 'RF'].includes(signal.status)
    ));
    const signature = mt5JournalLifecycleSignature;
    if (!signature || signature === mt5JournalImageSignatureRef.current) return;
    mt5JournalImageSignatureRef.current = signature;
    let cancelled = false;
    const prepareMt5JournalImages = async () => {
      try {
        const response = await fetch('/api/journal/trades?view=pending-images', { cache: 'no-store' });
        const payload = await response.json() as { ok?: boolean; trades?: JournalTradeRecord[] };
        if (!response.ok || !payload.ok || !Array.isArray(payload.trades)) return;
        const signalIds = new Set(lifecycleSignals.map((signal) => signal.id));
        const candidates = payload.trades.filter((trade) => (
          trade.mt5Managed && trade.mt5SignalId && signalIds.has(trade.mt5SignalId)
          && (!trade.entryScreenshotDataUrl
            || (trade.lifecycleStatus === 'closed' && !trade.exitScreenshotDataUrl))
        ));
        let savedTrades: JournalTradeRecord[] | undefined;
        for (const trade of candidates) {
          if (cancelled) return;
          const entryScreenshotDataUrl = trade.entryScreenshotDataUrl
            || (trade.entrySnapshotCandles && trade.entrySnapshotCandles.length >= 2
              ? renderHistoricalTradeSnapshot(trade, trade.entrySnapshotCandles)
              : undefined);
          const exitScreenshotDataUrl = trade.lifecycleStatus === 'closed'
            ? trade.exitScreenshotDataUrl
              || (trade.exitSnapshotCandles && trade.exitSnapshotCandles.length >= 2
                ? renderHistoricalTradeSnapshot(trade, trade.exitSnapshotCandles)
                : undefined)
            : undefined;
          if (!entryScreenshotDataUrl
            || (trade.lifecycleStatus === 'closed' && !exitScreenshotDataUrl)) continue;
          const updated = {
            ...trade,
            entryScreenshotDataUrl,
            exitScreenshotDataUrl,
            screenshotDataUrl: trade.screenshotDataUrl
              || exitScreenshotDataUrl || entryScreenshotDataUrl,
          };
          const saveResponse = await fetch('/api/journal/trades?view=dashboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trades: [updated] }),
          });
          const savePayload = await saveResponse.json() as {
            ok?: boolean;
            trades?: JournalTradeRecord[];
          };
          if (saveResponse.ok && savePayload.ok && Array.isArray(savePayload.trades)) {
            savedTrades = savePayload.trades;
          }
        }
        if (!cancelled && savedTrades) setSavedJournalTrades(savedTrades);
      } catch {
        mt5JournalImageSignatureRef.current = '';
      }
    };
    void prepareMt5JournalImages();
    return () => { cancelled = true; };
  }, [mt5JournalLifecycleSignature]);

  const updateMt5Config = useCallback(async (changes: Record<string, unknown>) => {
    if (!mt5Status) return;
    const response = await fetch('/api/mt5/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...mt5Status.config, ...changes }),
    });
    const payload = await response.json() as { ok?: boolean; config?: Mt5AutomationStatus['config'] };
    if (response.ok && payload.ok && payload.config) {
      setMt5Status((current) => current ? { ...current, config: payload.config! } : current);
    }
  }, [mt5Status]);

  useEffect(() => {
    if (mt5Status?.config) {
      setTradingTimeEnabled(mt5Status.config.tradingTimeEnabled === true);
      setTelegramMessagesEnabled(mt5Status.config.telegramMessagesEnabled !== false);
    }
  }, [mt5Status?.config?.tradingTimeEnabled, mt5Status?.config?.telegramMessagesEnabled]);

  const controlMt5Bridge = useCallback(async (action: 'start' | 'stop') => {
    setMt5BridgeControlError(null);
    try {
      const response = await fetch(`/api/mt5/bridge/${action}`, { method: 'POST' });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || `Unable to ${action} bridge.`);
      window.setTimeout(() => void refreshMt5Status(), 500);
    } catch (error) {
      setMt5BridgeControlError(error instanceof Error ? error.message : 'Bridge control failed.');
    }
  }, [refreshMt5Status]);

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
  const mtfLowerGranularities = useMemo(() => MTF_MAPPINGS
    .filter((mapping) => mapping.higher === granularity)
    .map((mapping) => mapping.lower), [granularity]);
  const auxiliaryGranularities = useMemo(() => Array.from(new Set<MarketGranularity>([
    // MTF cannot be evaluated until its mapped lower-timeframe candles exist.
    // Put those feeds first so the table is not left empty behind slower trend
    // and VIP-support requests.
    ...mtfLowerGranularities,
    ...vipSupportGranularities,
    ...TREND_TABLE_GRANULARITIES,
    ...AUTOMATION_GRANULARITIES,
    ...(DIRECT_ENGULFING_FALLBACKS[granularity] ?? []),
  ])).filter((value) => value !== granularity), [
    granularity,
    mtfLowerGranularities,
    vipSupportGranularities,
  ]);
  const analyzeChartStructure = useCallback((
    key: string,
    sourceCandles: OandaCandle[],
    options: Parameters<typeof analyzeMarketStructure>[1],
  ) => {
    const prepared = preparedAnalysesRef.current.get(key);
    const { vipSupport: _vipSupport, ...baseOptions } = options;
    if (prepared && prepared.optionsKey === JSON.stringify(baseOptions)
      && prepared.dependencies.every(({ key: dependencyKey, revision }) => (
        preparedAnalysesRef.current.get(dependencyKey)?.revision === revision
      )) && structureSnapshotsMatch(prepared.candles, sourceCandles)) return prepared.result;
    // Replay edits and browsers without Workers retain the original calculation.
    return analyzeMarketStructure(sourceCandles, options);
  }, []);

  useEffect(() => () => {
    analysisWorkerRef.current?.terminate();
    analysisWorkerRef.current = null;
    for (const request of analysisRequestsRef.current.values()) request.reject(new Error('Chart closed'));
    analysisRequestsRef.current.clear();
    preparedAnalysesRef.current.clear();
  }, []);

  const vipSupportContexts = useMemo(() => {
    if (displayCandles.length === 0) return [];
    const lastSourceCandle = displayCandles[displayCandles.length - 1];
    const cutoff = lastSourceCandle.time
      + (lastSourceCandle.complete ? TIMEFRAME_SECONDS[granularity] : 0);
    const contexts = vipSupportGranularities.map((supportGranularity) => {
      const completedCandles = (vipCandles[supportGranularity] || []).filter((candle) => (
        candle.complete
        && marketCandleCloseTime(candle.time, supportGranularity) <= cutoff
      ));
      const cached = supportAnalysisCacheRef.current[supportGranularity];
      const supportStructure = cached && structureSnapshotsMatch(cached.candles, completedCandles)
        ? cached.structure : analyzeChartStructure(`support:${supportGranularity}`, completedCandles, {
        allowSupplyDemand: ['H1', 'H4', 'D', 'W', 'MO'].includes(supportGranularity),
        sourceBarSeconds: TIMEFRAME_SECONDS[supportGranularity],
        confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[supportGranularity],
        zoneVisualBars: 30,
      });
      supportAnalysisCacheRef.current[supportGranularity] = { candles: completedCandles, structure: supportStructure };
      return {
        timeframe: GRANULARITY_LABELS[supportGranularity],
        zones: supportStructure.zones,
      };
    });
    const previous = supportContextsRef.current;
    if (previous.length === contexts.length && contexts.every((context, index) => (
      context.timeframe === previous[index].timeframe && context.zones === previous[index].zones
    ))) return previous;
    supportContextsRef.current = contexts;
    return contexts;
  }, [displayCandles, granularity, vipCandles, vipSupportGranularities]);

  const structure = useMemo(
    () => analyzeChartStructure('chart', displayCandles, {
      allowSupplyDemand: ['H1', 'H4', 'D'].includes(granularity),
      sourceBarSeconds: TIMEFRAME_SECONDS[granularity],
      confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[granularity],
      zoneVisualBars: 30,
      vipSupport: vipSupportContexts,
    }),
    [displayCandles, granularity, vipSupportContexts],
  );

  const h4SwingSource = useMemo(() => {
    if (granularity === 'D') return { candles: [] as OandaCandle[], lines: [] as StructureLine[] };
    if (granularity === 'H4') return { candles: displayCandles, lines: structure.lines };
    const h4Candles = vipCandles.H4 || [];
    if (h4Candles.length === 0) return { candles: h4Candles, lines: [] as StructureLine[] };
    const h4Structure = analyzeChartStructure('h4', h4Candles, {
      allowSupplyDemand: true,
      sourceBarSeconds: TIMEFRAME_SECONDS.H4,
      confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS.H4,
      zoneVisualBars: 30,
    });
    return { candles: h4Candles, lines: h4Structure.lines };
  }, [displayCandles, granularity, structure.lines, vipCandles]);

  const swingFibMoves = useMemo(() => {
    const seedLine = h4SwingSource.lines
      .filter((line) => line.type === 'swing'
        && line.fromTime !== line.toTime
        && line.fromPrice !== line.toPrice)
      .sort((first, second) => first.toTime - second.toTime)[0];
    if (!seedLine) return [];

    return buildAlternatingSwingFibs(h4SwingSource.candles, {
      sourceTime: seedLine.fromTime,
      sourcePrice: seedLine.fromPrice,
      zeroTime: seedLine.toTime,
      zeroPrice: seedLine.toPrice,
    });
  }, [h4SwingSource]);

  const dayFibMoves = useMemo(() => (
    ['M1', 'M5', 'M15', 'M30'].includes(granularity)
      ? buildDayFibs(displayCandles)
      : []
  ), [displayCandles, granularity]);

  const swingFibConfluence = useMemo(() => applySwingFibConfluence(
    displayCandles,
    structure.zones,
    isDaySwingFibEntryTimeframe(granularity)
      && ['M15', 'M30', 'H1'].includes(granularity)
      ? swingFibMoves
      : undefined,
  ), [displayCandles, granularity, structure.zones, swingFibMoves]);
  const dayFibConfluence = useMemo(() => applyDayFibConfluence(
    displayCandles,
    swingFibConfluence.zones,
    isDaySwingFibEntryTimeframe(granularity)
      && ['M15', 'M30'].includes(granularity)
      ? dayFibMoves[dayFibMoves.length - 1]
      : undefined,
  ), [dayFibMoves, displayCandles, granularity, swingFibConfluence.zones]);
  const displayZones = useMemo(() => {
    const fallbackGranularities = DIRECT_ENGULFING_FALLBACKS[granularity] ?? [];
    const latestChartCandle = displayCandles[displayCandles.length - 1];
    if (!latestChartCandle) return dayFibConfluence.zones;
    const cutoff = timeframeWindowCutoff(
      latestChartCandle.time,
      TIMEFRAME_SECONDS[granularity],
    );
    let zones = fallbackGranularities.reduce((currentZones, fallbackGranularity) => {
      const fallbackCandles = (vipCandles[fallbackGranularity] || []).filter((candle) => (
        candle.complete && marketCandleCloseTime(candle.time, fallbackGranularity) <= cutoff
      ));
      return applyTradeableZoneEngulfingFallback(
        fallbackCandles,
        currentZones,
        fallbackGranularity,
        granularity === 'H1',
      );
    }, dayFibConfluence.zones);
    if (granularity === 'M1') {
      const dailyCandles = (vipCandles.D || []).filter((candle) => candle.time <= cutoff);
      zones = applyOneMinuteGenesisQml(zones, displayCandles, dailyCandles);
    }
    return zones;
  }, [dayFibConfluence.zones, displayCandles, granularity, vipCandles]);
  const consolidatedDisplayZones = useMemo(
    () => consolidateZonesForDisplay(displayZones, marketConfig.pipSize),
    [displayZones, marketConfig.pipSize],
  );
  const redundantStandaloneZoneIds = useMemo(
    () => redundantStandaloneLiquidityZoneIds(displayZones, marketConfig.pipSize),
    [displayZones, marketConfig.pipSize],
  );
  const extremeAPlusTjl2Selection = useMemo(
    () => selectExtremeAPlusTjl2Zones(displayZones, marketConfig.pipSize),
    [displayZones, marketConfig.pipSize],
  );
  const redundantRetainedOverlayIds = useMemo(() => new Set(
    [...retainedChartTradeOverlays.values()]
      .filter((overlay) => (overlay.symbol ?? 'XAUUSD') === marketSymbol
        && overlay.chartTimeframe === granularity
        && retainedLiquidityTradeDuplicatesConfluence(
          overlay,
          consolidatedDisplayZones,
          displayCandles,
        ))
      .map((overlay) => overlay.id),
  ), [consolidatedDisplayZones, displayCandles, granularity, marketSymbol, retainedChartTradeOverlays]);

  const zoneEntryRecords = useMemo<ZoneTradeRecord[]>(() => [
    ...savedJournalTrades,
    ...[...retainedChartTradeOverlays.values()].filter((overlay) => !overlay.referenceOnly)
      .map((overlay) => ({
        id: overlay.id, symbol: overlay.symbol ?? 'XAUUSD',
        setupId: overlay.setupId, zoneTimeframe: overlay.chartTimeframe,
        signalAt: overlay.trade.signal.time, openedAt: overlay.trade.filledAt,
      })),
    ...(mt5Status?.recentSignals ?? []).filter((signal) => signal.openedAt !== undefined)
      .map((signal) => ({ ...signal, signalAt: signal.signalAt })),
  ], [savedJournalTrades, retainedChartTradeOverlays, mt5Status?.recentSignals]);

  // Preserve Gold's original tracking identity exactly. Currency pairs receive
  // their own symbol-prefixed scopes without changing Gold's entry lifecycle.
  const tradeTrackingScope = marketSymbol === 'XAUUSD'
    ? `${liveChartDataSource}:${granularity}:${replayIndex === null ? 'live' : 'replay'}`
    : `${marketSymbol}:${liveChartDataSource}:${granularity}:${replayIndex === null ? 'live' : 'replay'}`;
  const pendingM15DbBlocksSignal = useCallback((zone: StructureZone, signal: EngulfingTradeSignal) => {
    if (granularity !== 'M15' || signal.timeframe !== 'M15') return false;
    const signalCandle = displayCandles.find((candle) => candle.time === signal.time);
    if (!signalCandle) return false;
    return displayZones.some((db) => db.name === 'DB' && db.active
      && db.m15H1ChochClosePending
      && db.isBuy === zone.isBuy
      && signal.time >= (db.chochTime ?? db.startTime)
      && zone.bottom <= db.top && db.bottom <= zone.top
      && signalCandle.low <= db.top && signalCandle.high >= db.bottom);
  }, [displayCandles, displayZones, granularity]);
  const expiredGoldZoneBeforeSignal = useCallback((
    zone: StructureZone,
    signal: EngulfingTradeSignal,
    entry?: { price: number; filledAt: number; stopLoss: number },
  ) => (
    marketSymbol === 'XAUUSD' && isGoldZoneEntryBlocked(
      zone, displayCandles, granularity, marketConfig.pipSize, signal.time, entry,
    )
  ), [displayCandles, granularity, marketConfig.pipSize, marketSymbol]);
  const currentDirectTradeSetups = useMemo(() => {
    const setups = new Map<string, TrackedDirectTradeSetup>();
    const zoneTimeframe = granularity as TradeTimeframe;
    for (const zone of displayZones) {
      if (redundantStandaloneZoneIds.has(zone.id)) continue;
      if (extremeAPlusTjl2Selection.blockedZoneIds.has(zone.id)) continue;
      if (!isZoneEligibleForEngulfingEntry(zone)) continue;
      const signal = resolveZoneEngulfingSignal(zone, zoneTimeframe);
      if (!signal) continue;
      if (pendingM15DbBlocksSignal(zone, signal) || expiredGoldZoneBeforeSignal(zone, signal)) continue;
      if (marketSymbol === 'XAUUSD'
        && !isGoldIntradayCandleRoute(zoneTimeframe, signal.timeframe)) continue;
      const rule = getDirectTradeRule(zoneTimeframe, signal.timeframe);
      if (!rule) continue;
      setups.set(`${tradeTrackingScope}:${tradeZoneExecutionKey({
        symbol: marketSymbol, zoneTimeframe, zoneId: zone.id,
      })}`, {
        scope: tradeTrackingScope,
        zone: { ...zone },
        signal,
        rule,
      });
    }
    return setups;
  }, [displayZones, expiredGoldZoneBeforeSignal, extremeAPlusTjl2Selection.blockedZoneIds, granularity, marketSymbol, pendingM15DbBlocksSignal, redundantStandaloneZoneIds, tradeTrackingScope]);

  useEffect(() => {
    setTrackedDirectTradeSetups((existing) => {
      let changed = false;
      const next = new Map<string, TrackedDirectTradeSetup>(existing);
      for (const [key, setup] of next) {
        if (setup.scope === tradeTrackingScope
          && extremeAPlusTjl2Selection.blockedZoneIds.has(setup.zone.id)) {
          next.delete(key);
          changed = true;
        }
      }
      for (const [key, setup] of currentDirectTradeSetups) {
        // A zone gets one entry only. Once its first valid engulfing has been
        // captured, a later T1/T2/T3/T4 on that same zone cannot replace it.
        if (!next.has(key)) {
          next.set(key, setup);
          changed = true;
        }
      }
      return changed ? next : existing;
    });
  }, [currentDirectTradeSetups, extremeAPlusTjl2Selection.blockedZoneIds, tradeTrackingScope]);

  const directZoneEntryDecisions = useMemo(() => {
    const decisions = new Map<string, DirectZoneEntryDecision>();
    if (!marketConfig.mt5AutomationEnabled) return decisions;
    const latestChartCandle = displayCandles[displayCandles.length - 1];
    if (!latestChartCandle) return decisions;
    const cutoff = timeframeWindowCutoff(
      latestChartCandle.time,
      TIMEFRAME_SECONDS[granularity],
    );
    const setups = new Map<string, TrackedDirectTradeSetup>();
    for (const setup of trackedDirectTradeSetups.values()) {
      if (setup.scope === tradeTrackingScope
        && (marketSymbol !== 'XAUUSD'
          || isGoldIntradayCandleRoute(granularity, setup.signal.timeframe))
        && !redundantStandaloneZoneIds.has(setup.zone.id)
        && !extremeAPlusTjl2Selection.blockedZoneIds.has(setup.zone.id)) {
        setups.set(setup.zone.id, setup);
      }
    }
    for (const setup of currentDirectTradeSetups.values()) {
      if (!setups.has(setup.zone.id)) setups.set(setup.zone.id, setup);
    }

    for (const setup of setups.values()) {
      const liveZone = displayZones.find((zone) => zone.id === setup.zone.id);
      const currentZone = liveZone ?? setup.zone;
      if (pendingM15DbBlocksSignal(currentZone, setup.signal)
        || expiredGoldZoneBeforeSignal(currentZone, setup.signal)) continue;
      const sourceCandles = setup.signal.timeframe === granularity
        ? displayCandles
        : (vipCandles[setup.signal.timeframe] || []).filter((candle) => (
          marketCandleCloseTime(candle.time, setup.signal.timeframe) <= cutoff
        ));
      const executionCandles = TIMEFRAME_SECONDS[setup.signal.timeframe]
        < TIMEFRAME_SECONDS[granularity]
        ? sourceCandles
        : displayCandles;
      const policy = resolveDirectEntryPolicy({
        zoneTimeframe: granularity,
        signal: setup.signal,
        sourceCandles,
        baseRule: setup.rule,
      });
      const signalClose = setup.signal.time + TIMEFRAME_SECONDS[setup.signal.timeframe];
      if (findEarlierZoneEntry({
        symbol: marketSymbol, zoneTimeframe: granularity,
        zoneId: setup.zone.id, signalAt: setup.signal.time,
      }, zoneEntryRecords)) {
        decisions.set(setup.zone.id, {
          policy: { ...policy, allowed: false, rule: undefined, reason: 'zone-used' },
          oppositePositionOpen: false,
        });
        continue;
      }
      if (!policy.allowed || !policy.rule) {
        decisions.set(setup.zone.id, { policy, oppositePositionOpen: false });
        continue;
      }
      const adjusted = applyOppositePositionRewardRisk(
        policy.rule,
        replayIndex === null && marketSymbol !== 'XAUUSD' ? mt5Status?.positions : undefined,
        setup.signal.direction,
      );
      const trade = calculateTradeLevels({
        sourceCandles,
        executionCandles,
        signal: setup.signal,
        rule: adjusted.rule,
        riskFreeEnabled: marketSymbol !== 'XAUUSD',
        omitStopBuffer: marketSymbol !== 'XAUUSD'
          && isDeepDiscountTradeSignal(currentZone, setup.signal),
      });
      if (trade && trade.filledAt === undefined && !isUnfilledDirectSetupQualified({
        zone: liveZone,
        signal: setup.signal,
        zoneTimeframe: granularity,
        sourceCandles,
        goldZone: marketSymbol === 'XAUUSD'
          ? { candles: displayCandles, pipSize: marketConfig.pipSize } : undefined,
      })) continue;
      const firstOutsideTradingTime = tradingTimeEnabled && (!isNepalTradingTime(signalClose)
        || (trade?.filledAt !== undefined && !isNepalTradingTime(trade.filledAt)));
      const attempts = trade ? [trade] : [];
      if (firstOutsideTradingTime) {
        decisions.set(setup.zone.id, {
          policy: { ...policy, allowed: false, rule: undefined, reason: 'outside-trading-time' },
          previewTrade: trade,
          trades: attempts,
          oppositePositionOpen: false,
        });
        continue;
      }
      decisions.set(setup.zone.id, {
        policy,
        trade,
        trades: attempts,
        oppositePositionOpen: adjusted.oppositePositionOpen,
      });
    }
    return decisions;
  }, [
    currentDirectTradeSetups,
    displayCandles,
    displayZones,
    extremeAPlusTjl2Selection.blockedZoneIds,
    granularity,
    expiredGoldZoneBeforeSignal,
    marketConfig.mt5AutomationEnabled,
    marketConfig.pipSize,
    mt5Status?.positions,
    pendingM15DbBlocksSignal,
    replayIndex,
    redundantStandaloneZoneIds,
    trackedDirectTradeSetups,
    tradeTrackingScope,
    tradingTimeEnabled,
    vipCandles,
    zoneEntryRecords,
  ]);
  const directZoneTrades = useMemo(() => {
    const trades = new Map<string, TradeLevels>();
    for (const [zoneId, decision] of directZoneEntryDecisions) {
      if (decision.trade) trades.set(zoneId, decision.trade);
    }
    return trades;
  }, [directZoneEntryDecisions]);
  const displayedTapCount = useCallback((zone: DisplayStructureZone): number | undefined => {
    if (marketSymbol !== 'XAUUSD') return confluenceLatestTap(zone)?.count;
    const trade = confluenceMapValue<TradeLevels>(zone, directZoneTrades);
    const entry = trade?.filledAt === undefined ? undefined
      : { price: trade.entry, filledAt: trade.filledAt, stopLoss: trade.stopLoss };
    const latestMember = displayZoneMembers(zone)
      .filter((member) => member.tapTime !== undefined)
      .sort((first, second) => (second.lastTapTime ?? second.tapTime ?? 0)
        - (first.lastTapTime ?? first.tapTime ?? 0))[0];
    return latestMember
      ? getGoldZoneTapState(latestMember, displayCandles, granularity,
        marketConfig.pipSize, Infinity, entry).tapIndices.length
      : undefined;
  }, [directZoneTrades, displayCandles, granularity, marketConfig.pipSize, marketSymbol]);
  const directZoneMt5Signals = useMemo(() => {
    const signals = new Map<string, Mt5StoredSignal>();
    if (replayIndex !== null || liveChartDataSource !== 'MT5') return signals;
    const setupPrefix = `DIRECT:${granularity}:`;
    for (const signal of mt5Status?.recentSignals ?? []) {
      if (signal.source !== 'ENGULFING' || !signal.setupId?.startsWith(setupPrefix)) continue;
      const zoneId = signal.setupId.slice(setupPrefix.length);
      if (!zoneId || signals.has(zoneId)) continue;
      const trade = directZoneTrades.get(zoneId);
      if (!trade || signal.signalAt !== trade.signal.time
        || signal.signalTimeframe !== trade.signal.timeframe) continue;
      signals.set(zoneId, signal);
    }
    return signals;
  }, [directZoneTrades, granularity, liveChartDataSource, mt5Status?.recentSignals, replayIndex]);

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

  const tableTimeframeData = useMemo(() => {
    const replayCutoff = replayIndex === null || displayCandles.length === 0
      ? undefined
      : displayCandles[displayCandles.length - 1].time
        + (displayCandles[displayCandles.length - 1].complete ? TIMEFRAME_SECONDS[granularity] : 0);
    const data: Partial<Record<OandaGranularity, {
      candles: OandaCandle[];
      structure: ReturnType<typeof analyzeMarketStructure>;
    }>> = {};
    for (const tableGranularity of Array.from(new Set([
      ...TREND_TABLE_GRANULARITIES,
      ...AUTOMATION_GRANULARITIES,
    ]))) {
      const availableCandles = tableGranularity === granularity
        ? displayCandles
        : vipCandles[tableGranularity] || [];
      const timeframeCandles = replayCutoff === undefined
        ? availableCandles
        : availableCandles.filter((candle) => candle.time <= replayCutoff);
      if (timeframeCandles.length === 0) continue;
      const cached = tableAnalysisCacheRef.current[tableGranularity];
      const timeframeStructure = tableGranularity === granularity
          ? structure
          : cached && structureSnapshotsMatch(cached.candles, timeframeCandles)
            ? cached.structure : analyzeChartStructure(`table:${tableGranularity}`, timeframeCandles, {
          allowSupplyDemand: ['H1', 'H4', 'D'].includes(tableGranularity),
          sourceBarSeconds: TIMEFRAME_SECONDS[tableGranularity],
          confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[tableGranularity],
          zoneVisualBars: 30,
          });
      tableAnalysisCacheRef.current[tableGranularity] = {
        candles: timeframeCandles,
        structure: timeframeStructure,
      };
      data[tableGranularity] = {
        candles: timeframeCandles,
        structure: timeframeStructure,
      };
      const context = data[tableGranularity]!;
      const supplyDemandFibZones = new Map(applySwingFibConfluence(
        timeframeCandles,
        context.structure.zones.filter((zone) => zone.category === 'supplyDemand'),
        swingFibMoves,
      ).zones.map((zone) => [zone.id, zone]));
      context.structure = { ...context.structure, zones: context.structure.zones.map((zone) => (
        supplyDemandFibZones.get(zone.id) ?? zone
      )) };
    }
    return data;
  }, [displayCandles, granularity, replayIndex, structure, swingFibMoves, vipCandles]);
  const tradeDisplayAsOf = replayIndex === null ? Date.now() / 1000
    : (displayCandles.at(-1)?.time ?? 0) + (displayCandles.at(-1)?.complete ? TIMEFRAME_SECONDS[granularity] : 0);
  const hasTradeDisplayExpired = useCallback((trade: TradeDisplayState | undefined) => {
    const timeframe = trade?.signal?.timeframe ?? trade?.signalTimeframe;
    return tradeDisplayExpired(trade, timeframe ? tableTimeframeData[timeframe]?.candles ?? [] : [], tradeDisplayAsOf);
  }, [tableTimeframeData, tradeDisplayAsOf]);
  const hasTradeDrawingExpired = useCallback((trade: TradeDisplayState | undefined) => {
    const timeframe = trade?.signal?.timeframe ?? trade?.signalTimeframe;
    return tradeDrawingExpired(trade, timeframe ? tableTimeframeData[timeframe]?.candles ?? [] : [], tradeDisplayAsOf);
  }, [tableTimeframeData, tradeDisplayAsOf]);
  const hasRetainedDirectTradeSource = useCallback((overlay: TradeOverlay) => {
    const sourceZoneId = directTradeOverlayZoneId(overlay);
    const sourceZone = overlay.id.startsWith('DIRECT:')
      ? displayZones.find((zone) => zone.id === sourceZoneId)
      : undefined;
    if (sourceZone && (pendingM15DbBlocksSignal(sourceZone, overlay.trade.signal)
      || expiredGoldZoneBeforeSignal(sourceZone, overlay.trade.signal))) return false;
    const signalTimeframe = overlay.trade.signal.timeframe;
    const sourceTimeframes = AUTOMATION_GRANULARITIES.filter((timeframe) => (
      getDirectTradeRule(timeframe, signalTimeframe) !== undefined
    ));
    return retainedDirectTradeHasSource({
      id: overlay.id,
      setupId: overlay.setupId,
      label: overlay.label,
      signalTime: overlay.trade.signal.time,
      direction: overlay.trade.signal.direction,
    }, tableTimeframeData[signalTimeframe]?.candles, sourceTimeframes.map((timeframe) => (
      timeframe === granularity
        ? displayZones
        : tableTimeframeData[timeframe]?.structure.zones
    )));
  }, [displayZones, expiredGoldZoneBeforeSignal, granularity, pendingM15DbBlocksSignal, tableTimeframeData]);
  const ltfChochContext = useMemo(() => {
    if (!showLtfChoch || !comparisonTimeframe
      || DRAWING_TIMEFRAME_ORDER.indexOf(comparisonTimeframe)
        >= DRAWING_TIMEFRAME_ORDER.indexOf(granularity)) return null;
    const lowerData = tableTimeframeData[comparisonTimeframe];
    const chartTime = displayCandles[displayCandles.length - 1]?.time;
    if (!lowerData || chartTime === undefined) return null;
    const lowerTime = lowerData.candles[lowerData.candles.length - 1]?.time ?? chartTime;
    const currentTime = Math.min(Math.max(chartTime, lowerTime),
      chartTime + TIMEFRAME_SECONDS[granularity] - 1);
    return selectLtfChochContext(displayZones, lowerData.structure.zones,
      lowerData.structure.lines, currentTime, lowerData.candles,
      marketSymbol === 'XAUUSD' && granularity === 'M15' && comparisonTimeframe === 'M1');
  }, [comparisonTimeframe, displayCandles, displayZones, granularity, marketSymbol, showLtfChoch, tableTimeframeData]);
  const comparisonZones = useMemo(() => {
    if (!comparisonTimeframe || comparisonTimeframe === granularity) return [];
    if (ltfChochContext) return ltfChochContext.zones;
    const sourceZones = tableTimeframeData[comparisonTimeframe]?.structure.zones ?? [];
    const currentTime = displayCandles[displayCandles.length - 1]?.time;
    return currentTime === undefined ? [] : selectRecentComparisonZones(
      sourceZones, displayZones, currentTime,
    );
  }, [comparisonTimeframe, displayCandles, displayZones, granularity, ltfChochContext, tableTimeframeData]);
  const visibleComparisonZones = useMemo(() => comparisonZones.filter(({ zone }) => (
    !hiddenComparisonZoneKeys.includes(`${marketSymbol}:${comparisonTimeframe}:${zone.id}`)
  )), [comparisonTimeframe, comparisonZones, hiddenComparisonZoneKeys, marketSymbol]);
  const oneMinuteScalpingZones = useMemo(() => (
    marketSymbol === 'XAUUSD' && granularity === 'M1'
      ? (tableTimeframeData.M15?.structure.zones ?? []).filter((zone) => (
        zone.active && zone.status === 'valid'
        && isGoldScalpingZone('M15', goldScalpingZoneWidthPips(zone))
      ))
      : []
  ), [granularity, marketSymbol, tableTimeframeData]);

  const trendTableRows = useMemo<TrendTableRow[]>(() => (
    TREND_TABLE_GRANULARITIES.map((tableGranularity) => {
      const timeframeData = tableTimeframeData[tableGranularity];
      const latestTimeframeCandle = timeframeData?.candles[timeframeData.candles.length - 1];
      return {
        granularity: tableGranularity,
        label: TREND_TABLE_LABELS[tableGranularity],
        trend: timeframeData?.structure.trend ?? 'neutral',
        closesAt: latestTimeframeCandle
          ? marketCandleCloseTime(latestTimeframeCandle.time, tableGranularity)
          : undefined,
      };
    })
  ), [tableTimeframeData]);

  const extremeAPlusMtfBlockedZoneIds = useMemo(() => {
    const blockedByTimeframe = new Map<string, Set<string>>();
    for (const tableGranularity of Object.keys(tableTimeframeData) as OandaGranularity[]) {
      const timeframeData = tableTimeframeData[tableGranularity];
      if (!timeframeData) continue;
      blockedByTimeframe.set(
        tableGranularity,
        selectExtremeAPlusTjl2Zones(
          timeframeData.structure.zones,
          marketConfig.pipSize,
        ).blockedZoneIds,
      );
    }
    return blockedByTimeframe;
  }, [marketConfig.pipSize, tableTimeframeData]);
  const goldScalpingAccuracyTrades = useMemo(() => {
    if (marketSymbol !== 'XAUUSD') return [];
    const rows: Array<{
      zone: StructureZone;
      zoneTimeframe: 'M15' | 'H1';
      trade: TradeLevels;
    }> = [];
    for (const zoneTimeframe of ['M15', 'H1'] as const) {
      const zoneData = tableTimeframeData[zoneTimeframe];
      if (!zoneData) continue;
      let zones = applySwingFibConfluence(
        zoneData.candles, zoneData.structure.zones, swingFibMoves,
      ).zones;
      if (zoneTimeframe === 'M15') {
        const dayMoves = buildDayFibs(zoneData.candles);
        zones = applyDayFibConfluence(
          zoneData.candles, zones, dayMoves[dayMoves.length - 1],
        ).zones;
      }
      for (const zone of zones) {
        if (extremeAPlusMtfBlockedZoneIds.get(zoneTimeframe)?.has(zone.id)) continue;
        const signalTimeframe = goldScalpingCandleTimeframe(
          zoneTimeframe, goldScalpingZoneWidthPips(zone),
        );
        const signalData = signalTimeframe && tableTimeframeData[signalTimeframe];
        if (!signalTimeframe || !signalData) continue;
        const signal = findGoldScalpingCandleSignal(
          zone, zoneTimeframe, signalData.candles,
        );
        const rule = goldScalpingTradeRule(zoneTimeframe, signalTimeframe);
        if (!signal || !rule) continue;
        if (findEarlierZoneEntry({ symbol: marketSymbol, zoneTimeframe,
          zoneId: zone.id, signalAt: signal.time }, zoneEntryRecords)) continue;
        if (isGoldZoneEntryBlocked(
          zone, zoneData.candles, zoneTimeframe, marketConfig.pipSize, signal.time,
        )) continue;
        const trade = calculateTradeLevels({
          sourceCandles: signalData.candles,
          executionCandles: signalData.candles,
          signal,
          rule,
        });
        if (!trade) continue;
        rows.push({ zone, zoneTimeframe, trade });
      }
    }
    return rows;
  }, [extremeAPlusMtfBlockedZoneIds, marketConfig.pipSize, marketSymbol, swingFibMoves, tableTimeframeData, zoneEntryRecords]);
  const goldScalpingDirectTrades = useMemo(() => goldScalpingAccuracyTrades.filter(({ trade }) => (
    !tradingTimeEnabled || (isNepalTradingTime(trade.signal.time + TIMEFRAME_SECONDS[trade.signal.timeframe])
      && (trade.filledAt === undefined || isNepalTradingTime(trade.filledAt)))
  )), [goldScalpingAccuracyTrades, tradingTimeEnabled]);
  const activeMtfRows = useMemo(() => {
    const rows = new Map((marketSymbol === 'XAUUSD'
      ? buildGoldIntradayMtfRows(tableTimeframeData, mtfLtfFibRequired)
      : buildMtfRows(tableTimeframeData, mtfLtfFibRequired)).map((row) => [row.id, row]));
    if (marketSymbol === 'XAUUSD') {
      for (const row of buildGoldScalpingMtfRows(tableTimeframeData, mtfLtfFibRequired)) rows.set(row.id, row);
    }
    return Array.from(rows.values())
    .filter((row) => !extremeAPlusMtfBlockedZoneIds
      .get(row.higherTimeframe)?.has(row.higherTimeframeZoneId))
    .filter((row) => {
      if (marketSymbol !== 'XAUUSD' || row.engulfingTime === undefined) return true;
      const zoneData = tableTimeframeData[row.higherTimeframe];
      const zone = zoneData?.structure.zones.find((candidate) => (
        candidate.id === row.higherTimeframeZoneId
      ));
      return !zone || !zoneData || !isGoldZoneEntryBlocked(
        zone, zoneData.candles, row.higherTimeframe, marketConfig.pipSize,
        row.engulfingTime ?? Infinity,
      );
    })
    .filter((row) => row.engulfingBarsAgo !== undefined
      ? row.engulfingBarsAgo <= 100
      : (row.tapBarsAgo ?? row.confirmationBarsAgo) <= 50);
  }, [extremeAPlusMtfBlockedZoneIds, marketConfig.pipSize, marketSymbol, mtfLtfFibRequired, tableTimeframeData]);

  const allMtfTradeRows = useMemo<DisplayMtfRow[]>(() => {
    const setupIds = new Map<string, string>();
    return activeMtfRows.map((row) => {
      const setupKey = `${row.higherTimeframeZoneId}:${row.higherTimeframeTapTime}`;
      let setupId = setupIds.get(setupKey);
      if (!setupId) {
        setupId = `MTF-${setupIds.size + 1}`;
        setupIds.set(setupKey, setupId);
      }
      let trade: TradeLevels | undefined;
      let previewTrade: TradeLevels | undefined;
      let tradingTimeBlocked = false;
      const lowerTimeframeData = tableTimeframeData[row.lowerTimeframe];
      if (marketConfig.mt5AutomationEnabled
        && !findEarlierZoneEntry({ symbol: marketSymbol, zoneTimeframe: row.higherTimeframe,
          zoneId: row.higherTimeframeZoneId, signalAt: row.engulfingTime ?? Infinity }, zoneEntryRecords)
        && row.engulfingType && row.engulfingTime !== undefined && lowerTimeframeData) {
        const signal: EngulfingTradeSignal = {
          type: row.engulfingType,
          direction: row.direction,
          time: row.engulfingTime,
          candleCount: row.engulfingCandleCount ?? 2,
          timeframe: row.lowerTimeframe,
        };
        const rule = row.goldScalping
          ? goldScalpingChochTradeRule(row.higherTimeframe, row.lowerTimeframe)
          : marketSymbol === 'XAUUSD'
            ? goldIntradayMtfTradeRule(row.higherTimeframe, row.lowerTimeframe)
            : getMtfTradeRule(row.higherTimeframe, row.lowerTimeframe);
        const signalClose = signal.time + TIMEFRAME_SECONDS[signal.timeframe];
        if (rule) {
          trade = calculateTradeLevels({
            sourceCandles: lowerTimeframeData.candles,
            executionCandles: lowerTimeframeData.candles,
            signal,
            rule,
            riskFreeEnabled: marketSymbol !== 'XAUUSD' || row.goldScalping === true,
            omitStopBuffer: marketSymbol !== 'XAUUSD'
              && row.engulfingDeepDiscount === true,
          });
          if (tradingTimeEnabled && (!isNepalTradingTime(signalClose)
            || (trade?.filledAt !== undefined && !isNepalTradingTime(trade.filledAt)))) {
            previewTrade = trade;
            trade = undefined;
            tradingTimeBlocked = true;
          }
        }
      }
      const displayedTrade = trade ?? previewTrade;
      const tradeIndex = displayedTrade && lowerTimeframeData
        ? lowerTimeframeData.candles.findIndex((candle) => candle.time === displayedTrade.calculatedAt)
        : -1;
      const tradeBarsAgo = tradeIndex >= 0 && lowerTimeframeData
        ? lowerTimeframeData.candles.length - 1 - tradeIndex
        : undefined;
      return { ...row, setupId, trade, previewTrade, tradeBarsAgo, tradingTimeBlocked };
    });
  },
    [activeMtfRows, marketConfig.mt5AutomationEnabled, marketSymbol, tableTimeframeData, tradingTimeEnabled, zoneEntryRecords],
  );

  const mtfRows = useMemo<DisplayMtfRow[]>(() => (
    // An MTF setup belongs to both charts in its pair. Keeping the table on
    // only the HTF made a valid setup appear to be missing during LTF replay
    // until the user switched back to the higher timeframe.
    allMtfTradeRows.filter((row) => (
      (row.higherTimeframe === granularity || row.lowerTimeframe === granularity)
      && tradeStyleEnabled({ tradeStyle: marketSymbol === 'XAUUSD'
        ? row.goldScalping ? 'SCALPING' : 'INTRADAY' : undefined,
        zoneTimeframe: row.higherTimeframe })
    ))
  ), [allMtfTradeRows, granularity, marketSymbol, tradeStyleEnabled]);

  const repeatedLtfChochLabels = useMemo(() => {
    const rows = marketSymbol === 'XAUUSD'
      ? [...buildGoldScalpingMtfHistoryRows(tableTimeframeData, mtfLtfFibRequired),
        ...buildGoldIntradayMtfHistoryRows(tableTimeframeData, mtfLtfFibRequired)]
      : buildMtfHistoryRows(tableTimeframeData, mtfLtfFibRequired);
    return new Map(rows.filter((row) => row.lowerTimeframe === granularity
      && tradeStyleEnabled({ tradeStyle: marketSymbol === 'XAUUSD'
        ? row.goldScalping ? 'SCALPING' : 'INTRADAY' : undefined,
        zoneTimeframe: row.higherTimeframe })
      && (row.chochSequence ?? 1) > 1)
      .sort((first, second) => first.higherTimeframeTapTime - second.higherTimeframeTapTime)
      .map((row) => [`${row.structureScope}:${row.confirmationTime}`,
        mtfChochSequenceLabel(row.chochSequence!)]));
  }, [granularity, marketSymbol, mtfLtfFibRequired, tableTimeframeData, tradeStyleEnabled]);

  const savedChartMtfEntryQualification = useCallback((entry: {
    id: string;
    signalTime: number;
    direction: EngulfingTradeSignal['direction'];
    engulfingType: EngulfingTradeSignal['type'];
    zoneName: string;
    goldScalping?: boolean;
  }) => getSavedMtfEntryQualification(tableTimeframeData, {
    ...entry,
    zoneName: entry.zoneName as StructureZone['name'],
    goldIntraday: marketSymbol === 'XAUUSD' && !entry.goldScalping,
    requireLtfFib: mtfLtfFibRequired,
  }), [marketSymbol, mtfLtfFibRequired, tableTimeframeData]);

  const accuracyTradeRecords = useMemo<AccuracyTradeRecord[]>(() => {
    const records = new Map<string, AccuracyTradeRecord>();
    const addRecord = (
      id: string,
      zoneName: string,
      zoneTimeframe: TradeTimeframe,
      source: AccuracyTradeRecord['source'],
      trade: TradeLevels | undefined,
      volumeCandles: OandaCandle[] | undefined,
      journalDetails: Partial<JournalTradeRecord> = {},
    ) => {
      if (!trade?.result) return;
      const screenshotDataUrl = readPendingJournalScreenshot(id);
      records.set(id, {
        ...records.get(id),
        id,
        symbol: marketSymbol,
        zoneName,
        zoneTimeframe,
        result: trade.result,
        completedAt: trade.resolvedAt ?? trade.calculatedAt,
        source,
        direction: trade.signal.direction,
        signalTimeframe: trade.signal.timeframe,
        engulfingType: trade.signal.type,
        engulfingCandleCount: trade.signal.candleCount,
        entry: trade.entry,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        rewardRisk: trade.rewardRisk,
        riskPips: trade.riskPips,
        signalAt: trade.signal.time,
        openedAt: trade.filledAt,
        outsideTradingTime: !isNepalTradingTime(trade.signal.time + TIMEFRAME_SECONDS[trade.signal.timeframe])
          || (trade.filledAt !== undefined && !isNepalTradingTime(trade.filledAt)),
        ...(volumeCandles ? journalVolumeMetadata(volumeCandles, trade.signal) : {}),
        ...journalDetails,
        ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
      });
    };

    // Reconstruct direct engulfing outcomes from every historical zone that
    // retained a qualified signal, including zones invalidated after entry.
    const historyTimeframes: TradeTimeframe[] = marketSymbol === 'XAUUSD' ? ['M15', 'H1'] : [granularity];
    for (const zoneTimeframe of historyTimeframes) {
      const zoneData = tableTimeframeData[zoneTimeframe];
      if (!zoneData) continue;
      let sourceZones = zoneTimeframe === granularity ? displayZones
        : applySwingFibConfluence(zoneData.candles, zoneData.structure.zones, swingFibMoves).zones;
      if (zoneTimeframe !== granularity) {
        if (zoneTimeframe === 'M15') {
          const moves = buildDayFibs(zoneData.candles);
          sourceZones = applyDayFibConfluence(zoneData.candles, sourceZones, moves[moves.length - 1]).zones;
        }
        for (const fallback of DIRECT_ENGULFING_FALLBACKS[zoneTimeframe] ?? []) {
          sourceZones = applyTradeableZoneEngulfingFallback(
            tableTimeframeData[fallback]?.candles.filter((candle) => candle.complete !== false) ?? [],
            sourceZones, fallback, zoneTimeframe === 'H1',
          );
        }
      }
      const redundantIds = redundantStandaloneLiquidityZoneIds(sourceZones, marketConfig.pipSize);
      const blockedIds = selectExtremeAPlusTjl2Zones(sourceZones, marketConfig.pipSize).blockedZoneIds;
      for (const zone of sourceZones) {
        if (redundantIds.has(zone.id)) continue;
        if (blockedIds.has(zone.id)) continue;
        if (zone.status === 'rejected'
          || (!isZoneEligibleForEngulfingEntry(zone) && zone.tradeable === false)) continue;
        const signal = resolveZoneEngulfingSignal(zone, zoneTimeframe);
        if (!signal) continue;
        if (zoneTimeframe === granularity && pendingM15DbBlocksSignal(zone, signal)) continue;
        if (zoneTimeframe === 'M15' && signal.timeframe === 'M15' && sourceZones.some((db) => (
          db.name === 'DB' && db.active && db.m15H1ChochClosePending && db.isBuy === zone.isBuy
          && signal.time >= (db.chochTime ?? db.startTime) && zone.bottom <= db.top && db.bottom <= zone.top
          && zoneData.candles.some((candle) => candle.time === signal.time && candle.low <= db.top && candle.high >= db.bottom)
        ))) continue;
        if (marketSymbol === 'XAUUSD' && isGoldZoneEntryBlocked(
          zone, zoneData.candles, zoneTimeframe, marketConfig.pipSize, signal.time,
        )) continue;
        if (marketSymbol === 'XAUUSD'
          && !isGoldIntradayCandleRoute(zoneTimeframe, signal.timeframe)) continue;
        const baseRule = getDirectTradeRule(zoneTimeframe, signal.timeframe);
        if (!baseRule) continue;
        const sourceCandles = signal.timeframe === zoneTimeframe
          ? zoneData.candles
          : tableTimeframeData[signal.timeframe]?.candles || [];
        const rule = resolveRuleForDirectEntry({
          zoneTimeframe,
          signal,
          sourceCandles,
          baseRule,
        });
        if (!rule) continue;
        const executionCandles = TIMEFRAME_SECONDS[signal.timeframe]
          < TIMEFRAME_SECONDS[zoneTimeframe]
          ? sourceCandles
          : zoneData.candles;
        const trade = calculateTradeLevels({
          sourceCandles,
          executionCandles,
          signal,
          rule,
          riskFreeEnabled: marketSymbol !== 'XAUUSD',
          omitStopBuffer: marketSymbol !== 'XAUUSD'
            && isDeepDiscountTradeSignal(zone, signal),
        });
        addRecord(
          `DIRECT:${zone.id}:${signal.time}:${trade?.entry ?? 'NA'}`,
          executionZoneName(zone),
          zoneTimeframe,
          'ENGULFING',
          trade,
          sourceCandles,
          { zoneId: zone.id, ...journalFibMetadata(zone, signal),
            ...(marketSymbol === 'XAUUSD' ? { tradeStyle: 'INTRADAY' as const } : {}) },
        );
      }
    }

    for (const { zone, zoneTimeframe, trade } of goldScalpingAccuracyTrades) {
      addRecord(
        `GOLD_SCALP:${zoneTimeframe}:${zone.id}:${trade.signal.time}:${trade.entry}`,
        executionZoneName(zone), zoneTimeframe, 'ENGULFING', trade,
        tableTimeframeData[trade.signal.timeframe]?.candles,
        { zoneId: zone.id, ...journalFibMetadata(zone, trade.signal), tradeStyle: 'SCALPING' },
      );
    }

    // Unlike the compact live MTF table, history evaluates every eligible
    // mapped CHOCH event in the loaded candle window.
    const historicalMtfRows = new Map((marketSymbol === 'XAUUSD'
      ? buildGoldIntradayMtfHistoryRows(tableTimeframeData, mtfLtfFibRequired)
      : buildMtfHistoryRows(tableTimeframeData, mtfLtfFibRequired)).map((row) => [row.id, row]));
    if (marketSymbol === 'XAUUSD') {
      for (const row of buildGoldScalpingMtfHistoryRows(tableTimeframeData, mtfLtfFibRequired)) {
        historicalMtfRows.set(row.id, row);
      }
    }
    for (const row of historicalMtfRows.values()) {
      if (extremeAPlusMtfBlockedZoneIds
        .get(row.higherTimeframe)?.has(row.higherTimeframeZoneId)) continue;
      if (!row.engulfingType || row.engulfingTime === undefined) continue;
      const lowerTimeframeData = tableTimeframeData[row.lowerTimeframe];
      const rule = row.goldScalping
        ? goldScalpingChochTradeRule(row.higherTimeframe, row.lowerTimeframe)
        : marketSymbol === 'XAUUSD'
          ? goldIntradayMtfTradeRule(row.higherTimeframe, row.lowerTimeframe)
          : getMtfTradeRule(row.higherTimeframe, row.lowerTimeframe);
      if (!lowerTimeframeData || !rule) continue;
      const signal: EngulfingTradeSignal = {
        type: row.engulfingType,
        direction: row.direction,
        time: row.engulfingTime,
        candleCount: row.engulfingCandleCount ?? 2,
        timeframe: row.lowerTimeframe,
      };
      const trade = calculateTradeLevels({
        sourceCandles: lowerTimeframeData.candles,
        executionCandles: lowerTimeframeData.candles,
        signal,
        rule,
        riskFreeEnabled: marketSymbol !== 'XAUUSD' || row.goldScalping === true,
        omitStopBuffer: marketSymbol !== 'XAUUSD'
          && row.engulfingDeepDiscount === true,
      });
      addRecord(
        `MTF:${row.id}:${signal.time}:${trade?.entry ?? 'NA'}`,
        row.tappedZone ?? row.higherTimeframeZone,
        row.higherTimeframe,
        'MTF',
        trade,
        lowerTimeframeData.candles,
        {
          zoneId: row.higherTimeframeZoneId,
          setupId: `MTF:${row.id}`,
          mtfContext: row,
          fibSource: row.engulfingFibBand ? 'MTF FIB' : undefined,
          fibBand: row.engulfingFibBand,
          tradeStyle: marketSymbol === 'XAUUSD'
            ? row.goldScalping ? 'SCALPING' : 'INTRADAY' : undefined,
        },
      );
    }

    // Merge session-tracked records as a safety net for trades whose zones
    // have just rolled out of the current reconstructed structure collection.
    const directSetups = new Map<string, TrackedDirectTradeSetup>();
    for (const setup of trackedDirectTradeSetups.values()) {
      if (setup.scope === tradeTrackingScope
        && (marketSymbol !== 'XAUUSD'
          || isGoldIntradayCandleRoute(granularity, setup.signal.timeframe))) {
        directSetups.set(setup.zone.id, setup);
      }
    }
    for (const setup of currentDirectTradeSetups.values()) {
      directSetups.set(setup.zone.id, setup);
    }
    for (const [zoneId, decision] of directZoneEntryDecisions) {
      const setup = directSetups.get(zoneId);
      if (!setup) continue;
      const sourceCandles = setup.signal.timeframe === granularity
        ? displayCandles
        : vipCandles[setup.signal.timeframe] || [];
      for (const trade of decision.trades ?? (decision.trade ? [decision.trade] : decision.previewTrade ? [decision.previewTrade] : [])) {
        const id = `DIRECT:${zoneId}:${trade.signal.time}:${trade.entry}`;
        addRecord(id, executionZoneName(setup.zone), granularity, 'ENGULFING', trade,
          sourceCandles, marketSymbol === 'XAUUSD' ? { tradeStyle: 'INTRADAY' } : undefined);
      }
    }
    for (const row of mtfRows) {
      const trade = row.trade ?? row.previewTrade;
      if (!trade) continue;
      const id = `MTF:${row.id}:${row.engulfingTime}:${trade.entry}`;
      addRecord(
        id,
        row.tappedZone ?? row.higherTimeframeZone,
        row.higherTimeframe,
        'MTF',
        trade,
        tableTimeframeData[row.lowerTimeframe]?.candles,
        { zoneId: row.higherTimeframeZoneId, tradeStyle: marketSymbol === 'XAUUSD'
          ? row.goldScalping ? 'SCALPING' : 'INTRADAY' : undefined },
      );
    }
    return deduplicateTradeRecords(Array.from(records.values()));
  }, [
    currentDirectTradeSetups,
    displayCandles,
    displayZones,
    directZoneEntryDecisions,
    directZoneTrades,
    expiredGoldZoneBeforeSignal,
    extremeAPlusTjl2Selection.blockedZoneIds,
    extremeAPlusMtfBlockedZoneIds,
    granularity,
    goldScalpingAccuracyTrades,
    marketSymbol,
    mtfLtfFibRequired,
    mtfRows,
    pendingM15DbBlocksSignal,
    redundantStandaloneZoneIds,
    tableTimeframeData,
    swingFibMoves,
    trackedDirectTradeSetups,
    tradeTrackingScope,
    tradingTimeEnabled,
    vipCandles,
  ]);

  const openChartJournalTrades = useMemo<JournalTradeRecord[]>(() => {
    if (replayIndex !== null) return [];
    const records: JournalTradeRecord[] = [];
    const add = (id: string, zoneId: string | undefined, zoneName: string,
      zoneTimeframe: TradeTimeframe, source: 'ENGULFING' | 'MTF',
      trade: TradeLevels | undefined, tradeStyle?: 'SCALPING' | 'INTRADAY', mtfContext?: MtfRow) => {
      if (!trade || trade.filledAt === undefined || isCompletedTrade(trade)) return;
      if (tradingTimeEnabled && (!isNepalTradingTime(trade.calculatedAt)
        || !isNepalTradingTime(trade.filledAt))) return;
      records.push({
        id, zoneId, symbol: marketSymbol, zoneName, zoneTimeframe, source, tradeStyle,
        mtfContext, setupId: mtfContext ? `MTF:${mtfContext.id}` : undefined,
        result: trade.status === 'risk-free' ? 'risk-free' : 'open',
        completedAt: trade.filledAt, openedAt: trade.filledAt,
        signalAt: trade.signal.time, signalTimeframe: trade.signal.timeframe,
        engulfingType: trade.signal.type, engulfingCandleCount: trade.signal.candleCount,
        direction: trade.signal.direction, entry: trade.entry, stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit, rewardRisk: trade.rewardRisk, riskPips: trade.riskPips,
      });
    };
    for (const [zoneId, trade] of directZoneTrades) {
      const zone = displayZones.find((candidate) => candidate.id === zoneId);
      add(`DIRECT:${zoneId}:${trade.signal.time}:${trade.entry}`, zoneId,
        zone ? executionZoneName(zone) : 'Chart entry', granularity, 'ENGULFING', trade,
        marketSymbol === 'XAUUSD' ? 'INTRADAY' : undefined);
    }
    for (const { zone, zoneTimeframe, trade } of goldScalpingDirectTrades) {
      add(`GOLD_SCALP:${zoneTimeframe}:${zone.id}:${trade.signal.time}:${trade.entry}`,
        zone.id, executionZoneName(zone), zoneTimeframe, 'ENGULFING', trade, 'SCALPING');
    }
    for (const row of allMtfTradeRows) {
      if (!row.trade) continue;
      add(`MTF:${row.id}:${row.trade.signal.time}:${row.trade.entry}`, row.higherTimeframeZoneId,
        row.tappedZone ?? row.higherTimeframeZone, row.higherTimeframe, 'MTF', row.trade,
        marketSymbol === 'XAUUSD' ? row.goldScalping ? 'SCALPING' : 'INTRADAY' : undefined, row);
    }
    return records;
  }, [allMtfTradeRows, directZoneTrades, displayZones, goldScalpingDirectTrades, granularity,
    marketSymbol, replayIndex, tradingTimeEnabled]);

  const canonicalTradeRecords = useMemo(() => buildCanonicalTradeRecords(
    savedJournalTrades, accuracyTradeRecords, {
      marketSymbol, pipSize: marketConfig.pipSize, requireLtfFib: mtfLtfFibRequired,
      timeframeData: tableTimeframeData, qualifyMtf: savedChartMtfEntryQualification,
    },
  ), [accuracyTradeRecords, marketConfig.pipSize, marketSymbol, mtfLtfFibRequired,
    savedChartMtfEntryQualification, savedJournalTrades, tableTimeframeData]);
  const visibleCanonicalTradeRecords = useMemo(() => canonicalTradeRecords.filter(tradeStyleEnabled),
    [canonicalTradeRecords, tradeStyleEnabled]);
  const allSavedAccuracyRecords = useMemo(() => visibleCanonicalTradeRecords.filter((record) => (
    record.result === 'tp' || record.result === 'sl' || record.result === 'rf'
  )), [visibleCanonicalTradeRecords]);

  useEffect(() => {
    const facts = (record: AccuracyTradeRecord) => JSON.stringify([
      record.id, record.result, record.completedAt, record.entry, record.stopLoss,
      record.zoneId, record.setupId,
      record.mtfContext,
      record.takeProfit, record.openedAt, record.rewardRisk, record.tradeStyle,
      record.fibSource, record.fibBand, record.volumeLogicStatus,
      record.volume1, record.volume2, record.volume3, record.engulfingCandleCount,
    ]);
    const stored = new Map(savedJournalTrades.map((record) => [record.id, facts(record)]));
    const recordsToSave = new Map([...openChartJournalTrades, ...canonicalTradeRecords]
      .map((record) => [record.id, record]));
    const changed = [...recordsToSave.values()].filter((record) => (
      stored.get(record.id) !== facts(record)
      && !((record.result === 'open' || record.result === 'risk-free')
        && savedJournalTrades.some((saved) => saved.id === record.id
          && ['tp', 'sl', 'rf'].includes(saved.result)))
    ));
    if (changed.length === 0) return;
    const signature = changed.map(facts).sort().join('|');
    if (signature === journalSyncSignatureRef.current) return;
    journalSyncSignatureRef.current = signature;
    void (async () => {
      let saved: AccuracyTradeRecord[] | undefined;
      for (let offset = 0; offset < changed.length; offset += 2000) {
        const batch = changed.slice(offset, offset + 2000);
        const response = await fetch('/api/journal/trades?view=dashboard', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trades: batch }),
        });
        if (!response.ok) throw new Error('Unable to save validated trade records.');
        const payload = await response.json() as { ok?: boolean; trades?: AccuracyTradeRecord[] };
        if (!payload.ok || !Array.isArray(payload.trades)) throw new Error('Invalid journal response.');
        saved = payload.trades;
        for (const record of batch) {
          if (!record.screenshotDataUrl) continue;
          try { window.localStorage.removeItem(`${JOURNAL_SCREENSHOT_PREFIX}${record.id}`); }
          catch { /* The server copy remains durable. */ }
        }
      }
      if (saved) setSavedJournalTrades(saved);
    })().catch(() => { journalSyncSignatureRef.current = ''; });
  }, [canonicalTradeRecords, openChartJournalTrades, savedJournalTrades]);

  const replayResultCutoff = replayIndex === null ? undefined
    : displayCandles.length === 0 ? Number.NEGATIVE_INFINITY
      : marketCandleCloseTime(displayCandles[displayCandles.length - 1].time, granularity);
  const replayVisibleAccuracyRecords = useMemo(() => replayResultCutoff === undefined
    ? allSavedAccuracyRecords
    : allSavedAccuracyRecords.filter((record) => record.completedAt <= replayResultCutoff),
  [allSavedAccuracyRecords, replayResultCutoff]);
  const timeframeAccuracyRecords = useMemo(() => selectTradeChartRecords(
    replayVisibleAccuracyRecords, granularity, displayCandles, marketSymbol === 'XAUUSD',
  ), [
      displayCandles,
      granularity,
      marketSymbol,
      replayVisibleAccuracyRecords,
    ]);

  const tradeOverlays = useMemo<TradeOverlay[]>(() => {
    const overlays = new Map<string, TradeOverlay>();
    const addTrade = (
      id: string,
      trade: TradeLevels,
      label?: string,
      drawingTimeframe: OandaGranularity = trade.signal.timeframe,
      zone?: StructureZone,
    ) => {
      if (isCompletedTrade(trade)) return;
      const signature = [
        trade.calculatedAt,
        trade.entry,
        trade.stopLoss,
        trade.takeProfit,
      ].join(':');
      if (!overlays.has(signature)) overlays.set(signature, {
        id,
        symbol: marketSymbol,
        trade,
        label,
        fibLabels: zone ? tradeZoneFibLabels(zone) : undefined,
        chartTimeframe: drawingTimeframe,
      });
    };
    for (const [zoneId, trade] of directZoneTrades) {
      let setup: TrackedDirectTradeSetup | undefined;
      for (const candidate of trackedDirectTradeSetups.values()) {
        if (candidate.scope === tradeTrackingScope && candidate.zone.id === zoneId
          && candidate.signal.time === trade.signal.time) {
          setup = candidate;
          break;
        }
      }
      if (!setup) {
        for (const candidate of currentDirectTradeSetups.values()) {
          if (candidate.zone.id === zoneId && candidate.signal.time === trade.signal.time) {
            setup = candidate;
            break;
          }
        }
      }
      if (!setup) continue;
      addTrade(
        `DIRECT:${zoneId}:${trade.signal.time}:${trade.entry}`,
        trade,
        `${executionZoneName(setup.zone)} · CHART · 1:${trade.rewardRisk}`,
        trade.signal.timeframe,
        setup.zone,
      );
    }
    // Reconstruct filled, unresolved direct trades from historical zones too.
    // This restores their drawings and table rows after a refresh, even when
    // the originating zone is no longer part of the compact active-zone table.
    for (const zone of displayZones) {
      if (extremeAPlusTjl2Selection.blockedZoneIds.has(zone.id)
        || zone.status === 'rejected'
        || (!isZoneEligibleForEngulfingEntry(zone) && zone.tradeable === false)) continue;
      const signal = resolveZoneEngulfingSignal(zone, granularity);
      if (!signal) continue;
      if (pendingM15DbBlocksSignal(zone, signal) || expiredGoldZoneBeforeSignal(zone, signal)) continue;
      if (marketSymbol === 'XAUUSD'
        && !isGoldIntradayCandleRoute(granularity, signal.timeframe)) continue;
      const baseRule = getDirectTradeRule(granularity, signal.timeframe);
      if (!baseRule) continue;
      const sourceCandles = signal.timeframe === granularity
        ? displayCandles
        : vipCandles[signal.timeframe] || [];
      const rule = resolveRuleForDirectEntry({
        zoneTimeframe: granularity,
        signal,
        sourceCandles,
        baseRule,
      });
      if (!rule) continue;
      const executionCandles = TIMEFRAME_SECONDS[signal.timeframe]
        < TIMEFRAME_SECONDS[granularity]
        ? sourceCandles
        : displayCandles;
      const trade = calculateTradeLevels({
        sourceCandles,
        executionCandles,
        signal,
        rule,
        riskFreeEnabled: marketSymbol !== 'XAUUSD',
        omitStopBuffer: marketSymbol !== 'XAUUSD'
          && isDeepDiscountTradeSignal(zone, signal),
      });
      if (!trade || trade.filledAt === undefined || isCompletedTrade(trade)) continue;
      if (tradingTimeEnabled && (!isNepalTradingTime(signal.time + TIMEFRAME_SECONDS[signal.timeframe])
        || !isNepalTradingTime(trade.filledAt))) continue;
      addTrade(
        `DIRECT:${zone.id}:${signal.time}:${trade.entry}`,
        trade,
        `${executionZoneName(zone)} · CHART · 1:${trade.rewardRisk}`,
        trade.signal.timeframe,
        zone,
      );
    }
    for (const row of mtfRows) {
      if (row.trade) {
        addTrade(
          `MTF:${row.id}:${row.engulfingTime}:${row.trade.entry}`,
          row.trade,
          `${row.tappedZone ?? row.higherTimeframeZone} · ${row.goldScalping ? 'SCALP MTF' : 'MTF'} · 1:${row.trade.rewardRisk}`,
          row.lowerTimeframe,
        );
      }
    }
    for (const { zone, zoneTimeframe, trade } of goldScalpingDirectTrades) {
      addTrade(
        `GOLD_SCALP:${zoneTimeframe}:${zone.id}:${trade.signal.time}:${trade.entry}`,
        trade,
        `${executionZoneName(zone)} · SCALP · 1:${trade.rewardRisk}`,
        trade.signal.timeframe,
      );
    }
    return Array.from(overlays.values())
      .sort((first, second) => second.trade.calculatedAt - first.trade.calculatedAt);
  }, [
    currentDirectTradeSetups,
    displayCandles,
    displayZones,
    directZoneTrades,
    expiredGoldZoneBeforeSignal,
    extremeAPlusTjl2Selection.blockedZoneIds,
    granularity,
    goldScalpingDirectTrades,
    marketSymbol,
    mtfRows,
    pendingM15DbBlocksSignal,
    trackedDirectTradeSetups,
    tradeTrackingScope,
    tradingTimeEnabled,
    vipCandles,
  ]);

  useEffect(() => {
    setRetainedChartTradeOverlays((existing) => {
      const next = new Map<string, TradeOverlay>(existing);
      for (const [id, overlay] of next) {
        if ((overlay.symbol ?? 'XAUUSD') !== marketSymbol) continue;
        if (redundantRetainedOverlayIds.has(id)) {
          next.delete(id);
          continue;
        }
        const directZoneId = directTradeOverlayZoneId(overlay);
        if (directZoneId && (redundantStandaloneZoneIds.has(directZoneId)
          || extremeAPlusTjl2Selection.blockedZoneIds.has(directZoneId))) {
          next.delete(id);
          continue;
        }
        if (!hasIdentifiedDirectZoneLabel(overlay.id, overlay.setupId, overlay.label)) next.delete(id);
      }
      const liveBrokerSetupKeys = new Set(
        (mt5Status?.positions ?? []).flatMap((position) => (
          position.setupId
            ? [resolveTradeOverlaySetupKey(`MT5:${position.ticket}`, position.setupId)]
            : []
        )),
      );
      for (const overlay of tradeOverlays) {
        if (overlay.trade.filledAt !== undefined && !isCompletedTrade(overlay.trade)) {
          next.set(overlay.id, overlay);
        }
      }
      for (const [id, overlay] of next) {
        if ((overlay.symbol ?? 'XAUUSD') !== marketSymbol) continue;
        if (!hasRetainedDirectTradeSource(overlay)) {
          next.delete(id);
          continue;
        }
        if (liveBrokerSetupKeys.has(tradeOverlaySetupKey(overlay))) {
          next.delete(id);
          continue;
        }
        const directZoneId = directTradeOverlayZoneId(overlay);
        if (overlay.chartTimeframe === 'M5' && directZoneId
          && displayZones.some((zone) => (
            zone.id === directZoneId && zone.confirmationRouteDisabled
          ))) {
          next.delete(id);
          continue;
        }
        if (overlay.chartTimeframe !== granularity) continue;
        const resolved = resolveRetainedTrade(overlay.trade, displayCandles);
        if (isCompletedTrade(resolved)) next.delete(id);
        else next.set(id, { ...overlay, trade: resolved });
      }
      const firstTradeBySetup = new Map<string, { id: string; signalAt: number }>();
      for (const [id, overlay] of next) {
        const setupKey = `${overlay.symbol ?? 'XAUUSD'}:${tradeOverlaySetupKey(overlay)}`;
        const previous = firstTradeBySetup.get(setupKey);
        if (!previous || overlay.trade.signal.time < previous.signalAt) {
          if (previous) next.delete(previous.id);
          firstTradeBySetup.set(setupKey, { id, signalAt: overlay.trade.signal.time });
        } else {
          next.delete(id);
        }
      }
      const signature = (entries: Map<string, TradeOverlay>) => Array.from(entries)
        .map(([id, overlay]) => `${overlay.symbol ?? 'XAUUSD'}:${id}:${overlay.trade.status}:${overlay.trade.resolvedAt ?? ''}:${overlay.fibLabels?.join(',') ?? ''}`)
        .sort()
        .join('|');
      return signature(next) === signature(existing) ? existing : next;
    });
  }, [displayCandles, displayZones, extremeAPlusTjl2Selection.blockedZoneIds, granularity, hasRetainedDirectTradeSource, marketSymbol, mt5Status?.positions, redundantRetainedOverlayIds, redundantStandaloneZoneIds, tradeOverlays]);

  const retainedChartTradesForTimeframe = useMemo(() => {
    const firstTradeBySetup = new Map<string, TradeOverlay>();
    const candidates = [...retainedChartTradeOverlays.values()]
      .filter((overlay) => (overlay.symbol ?? 'XAUUSD') === marketSymbol
        && overlayStyleEnabled(overlay)
        && overlay.chartTimeframe === granularity
        && hasRetainedDirectTradeSource(overlay)
        && (!overlay.id.startsWith('MTF:') || savedChartMtfEntryQualification({
          id: overlay.id,
          signalTime: overlay.trade.signal.time,
          direction: overlay.trade.signal.direction,
          engulfingType: overlay.trade.signal.type,
          zoneName: tradeOverlayZoneLabel(overlay.label) ?? '',
          goldScalping: overlay.label?.includes('SCALP MTF') === true,
        }) !== undefined)
        && (!tradingTimeEnabled
          || (isNepalTradingTime(overlay.trade.signal.time + TIMEFRAME_SECONDS[overlay.trade.signal.timeframe])
            && (overlay.trade.filledAt === undefined || isNepalTradingTime(overlay.trade.filledAt)))))
      .sort((first, second) => first.trade.signal.time - second.trade.signal.time);
    for (const overlay of candidates) {
      const setupKey = tradeOverlaySetupKey(overlay);
      if (!firstTradeBySetup.has(setupKey)) firstTradeBySetup.set(setupKey, overlay);
    }
    return [...firstTradeBySetup.values()]
      .sort((first, second) => second.trade.calculatedAt - first.trade.calculatedAt);
  }, [granularity, hasRetainedDirectTradeSource, marketSymbol, overlayStyleEnabled, retainedChartTradeOverlays, savedChartMtfEntryQualification, tradingTimeEnabled]);

  // The Zone Table owns only direct chart-zone trades. MTF trades remain
  // drawable on the chart, but all their row/details UI belongs to MTF Table.
  const retainedDirectChartTradesForTimeframe = useMemo(() => (
    retainedChartTradesForTimeframe.filter((overlay) => (
      isDirectTradeOverlay(overlay.id, overlay.setupId)
      && hasIdentifiedDirectZoneLabel(overlay.id, overlay.setupId, overlay.label)
      && !redundantRetainedOverlayIds.has(overlay.id)
      && !redundantStandaloneZoneIds.has(directTradeOverlayZoneId(overlay) ?? '')
      && !extremeAPlusTjl2Selection.blockedZoneIds.has(directTradeOverlayZoneId(overlay) ?? '')
    ))
  ), [extremeAPlusTjl2Selection.blockedZoneIds, redundantRetainedOverlayIds, redundantStandaloneZoneIds, retainedChartTradesForTimeframe]);

  const liveMt5TradeOverlays = useMemo<TradeOverlay[]>(() => (
    (mt5Status?.positions ?? []).flatMap((position) => {
      // Once MT5 opens a position, its broker lifecycle controls the drawing.
      // Later zone/FIB invalidation must not hide an otherwise open trade.
      if (!(position.stopLoss > 0) || !(position.takeProfit > 0) || !(position.priceOpen > 0)) return [];
      const riskDistance = Math.abs(position.priceOpen - position.stopLoss);
      if (riskDistance <= 0) return [];
      const rewardRisk = Math.max(0.1, Math.round(
        Math.abs(position.takeProfit - position.priceOpen) / riskDistance * 10,
      ) / 10);
      const signalTimeframe = position.signalTimeframe ?? granularity;
      const signalType = (['T1', 'T2', 'T3', 'T4'].includes(position.engulfingType ?? '')
        ? position.engulfingType
        : 'T1') as EngulfingTradeSignal['type'];
      const isBuy = position.direction === 'BUY';
      const storedSignal = (mt5Status?.recentSignals ?? []).find((candidate) => (
        candidate.brokerTicket === position.ticket
        || (position.setupId !== undefined && candidate.setupId === position.setupId
          && ['ACTIVE', 'RISK_FREE', 'PLACED'].includes(candidate.status))
      ));
      if (!tradeStyleEnabled(storedSignal ?? { zoneTimeframe: position.zoneTimeframe })) return [];
      const signalAt = position.signalAt ?? storedSignal?.signalAt;
      // The drawing begins when the entry candle confirms. A broker fill can
      // occur later, so its timestamp belongs only to the execution record.
      const confirmedAt = signalAt !== undefined && Number.isFinite(signalAt)
        ? signalAt + TIMEFRAME_SECONDS[signalTimeframe]
        : storedSignal?.calculatedAt ?? position.openedAt;
      const trade: TradeLevels & { partialClosedAt?: number } = {
        entry: position.priceOpen,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        riskFree: isBuy ? position.priceOpen + riskDistance : position.priceOpen - riskDistance,
        riskFreeEnabled: storedSignal?.tradeStyle === 'SCALPING'
          || storedSignal?.status === 'RISK_FREE',
        riskPips: Math.round(riskDistance / 0.1 * 100) / 100,
        rewardRisk,
        status: storedSignal?.status === 'RISK_FREE' || position.signalStatus === 'RISK_FREE' ? 'risk-free' : 'active',
        partialClosedAt: storedSignal?.partialClosedAt,
        pendingAtCreation: false,
        calculatedAt: confirmedAt,
        filledAt: position.openedAt,
        signal: {
          type: signalType,
          direction: isBuy ? 'bullish' : 'bearish',
          time: signalAt ?? position.openedAt,
          candleCount: signalType === 'T1' ? 2 : 3,
          timeframe: signalTimeframe,
        },
      };
      return [{
        id: `MT5:${position.ticket}`,
        symbol: 'XAUUSD' as const,
        setupId: position.setupId,
        trade,
        label: `${storedSignal?.tradeStyle === 'SCALPING' ? 'SCALP · ' : ''}${position.zoneTimeframe ?? '?'}→${position.signalTimeframe ?? '?'} · 1:${position.rewardRisk ?? rewardRisk}`,
        chartTimeframe: signalTimeframe,
      }];
    })
  ), [granularity, mt5Status?.positions, mt5Status?.recentSignals, tradeStyleEnabled]);

  const liveMtfTableTrades = useMemo<LiveMt5TableTrade[]>(() => (
    (mt5Status?.positions ?? []).flatMap((position) => {
      if (position.source !== 'MTF' && !position.setupId?.startsWith('MTF:')) return [];
      if (marketSymbol !== 'XAUUSD' || replayIndex !== null
        || (position.zoneTimeframe !== granularity && position.signalTimeframe !== granularity)) return [];
      const overlay = liveMt5TradeOverlays.find((candidate) => candidate.id === `MT5:${position.ticket}`);
      if (!overlay) return [];
      const signal = (mt5Status?.recentSignals ?? []).find((candidate) => (
        candidate.brokerTicket === position.ticket
        || (position.setupId !== undefined && candidate.setupId === position.setupId
          && ['ACTIVE', 'RISK_FREE', 'PLACED'].includes(candidate.status))
      ));
      return [{ position, trade: overlay.trade, signal }];
    })
  ), [liveMt5TradeOverlays, mt5Status?.positions, mt5Status?.recentSignals, marketSymbol, granularity, replayIndex]);

  const recordedMtfTrades = useMemo(() => {
    const chartEnd = displayCandles[displayCandles.length - 1]?.time;
    if (chartEnd === undefined) return [];
    const cutoff = chartEnd + TIMEFRAME_SECONDS[granularity];
    return deduplicateTradeRecords([...savedJournalTrades, ...openChartJournalTrades])
      .filter(record => record.source === 'MTF'
        && (record.symbol ?? 'XAUUSD') === marketSymbol
        && (record.zoneTimeframe === granularity || record.signalTimeframe === granularity)
        && tradeStyleEnabled(record)
        && (record.openedAt ?? record.signalAt ?? Infinity) <= cutoff
        // A completed record cannot reveal a future result while replaying.
        && (replayIndex === null || record.completedAt <= cutoff))
      .slice(0, 20)
      .map(record => {
        if (record.mtfContext || !record.setupId?.startsWith('MTF:') || !record.signalAt) return record;
        const qualified = savedChartMtfEntryQualification({
          id: `${record.setupId}:${record.signalAt}:${record.entry}`,
          signalTime: record.signalAt, direction: record.direction,
          engulfingType: record.engulfingType as EngulfingTradeSignal['type'],
          zoneName: record.zoneName, goldScalping: record.tradeStyle === 'SCALPING',
        });
        return qualified?.context ? { ...record, mtfContext: qualified.context } : record;
      });
  }, [savedJournalTrades, openChartJournalTrades, displayCandles, granularity, marketSymbol,
    tradeStyleEnabled, replayIndex, savedChartMtfEntryQualification]);

  const mtfDrawingZones = useMemo(() => {
    const zones = new Map<string, { zone: StructureZone; label: string; endTime: number }>();
    const add = (context: MtfRow | undefined, endTime: number) => {
      if (!context || !(context.higherTimeframe === granularity || context.lowerTimeframe === granularity)) return;
      for (const [zone, timeframe, role] of [
        [context.higherZone, context.higherTimeframe, 'SETUP'],
        [context.entryZone, context.lowerTimeframe, 'ENTRY'],
      ] as const) {
        if (!zone) continue;
        zones.set(`${timeframe}:${zone.id}`, {
          zone, label: `${formatTradeTimeframe(timeframe)} MTF ${role} · ${zone.name}`,
          endTime: Math.max(zone.startTime + TIMEFRAME_SECONDS[granularity], endTime),
        });
      }
    };
    const now = displayCandles[displayCandles.length - 1]?.time ?? 0;
    for (const row of mtfRows) if (!hasTradeDisplayExpired(row.trade ?? row.previewTrade)) add(row, now);
    for (const record of recordedMtfTrades) if (!hasTradeDisplayExpired(record)) add(record.mtfContext,
      ['open', 'risk-free'].includes(record.result) ? now : record.completedAt);
    for (const { signal } of liveMtfTableTrades) if (!hasTradeDisplayExpired(signal)) add(signal?.journalContext?.mtfContext, now);
    return [...zones.values()];
  }, [hasTradeDisplayExpired, mtfRows, recordedMtfTrades, liveMtfTableTrades, displayCandles, granularity]);

  const completedChartTradeKeys = useMemo(() => {
    const setupKeys = new Set<string>();
    const entryEventKeys = new Set<string>();
    for (const [zoneId, trade] of directZoneTrades) {
      if (!isCompletedTrade(trade)) continue;
      setupKeys.add(resolveTradeOverlaySetupKey(
        `DIRECT:${zoneId}:${trade.signal.time}:${trade.entry}`,
      ));
      entryEventKeys.add(tradeOverlayEntryEventKey(trade.signal));
    }
    for (const row of mtfRows) {
      if (!row.trade || !isCompletedTrade(row.trade)) continue;
      setupKeys.add(resolveTradeOverlaySetupKey(
        `MTF:${row.id}:${row.engulfingTime}:${row.trade.entry}`,
      ));
      entryEventKeys.add(tradeOverlayEntryEventKey(row.trade.signal));
    }
    for (const record of savedJournalTrades) {
      if ((record.symbol ?? 'XAUUSD') !== marketSymbol || !record.signalAt || record.completedAt > tradeDisplayAsOf
        || (!['sl', 'tp', 'rf'].includes(record.result) && !hasTradeDrawingExpired(record))) continue;
      setupKeys.add(resolveTradeOverlaySetupKey(record.id, record.setupId));
      entryEventKeys.add(tradeOverlayEntryEventKey({
        timeframe: record.signalTimeframe, direction: record.direction, time: record.signalAt,
      }));
    }
    return { setupKeys, entryEventKeys };
  }, [directZoneTrades, mtfRows, savedJournalTrades, marketSymbol, tradeDisplayAsOf, hasTradeDrawingExpired]);

  const visibleTradeOverlays = useMemo(() => {
    const overlays = new Map<string, TradeOverlay>();
    const chartSetupKeys = new Set<string>();
    const entryEventKeys = new Set<string>();
    const addOverlay = (overlay: TradeOverlay) => {
      if (hasTradeDrawingExpired(overlay.trade)) return;
      if (!overlayStyleEnabled(overlay)) return;
      if ((overlay.symbol ?? 'XAUUSD') !== marketSymbol) return;
      if (!overlay.referenceOnly && !isCompletedTrade(overlay.trade) && !hasRetainedDirectTradeSource(overlay)) return;
      // The result owns the five-bar window; stale active copies must not reappear afterward.
      const setupKey = tradeOverlaySetupKey(overlay);
      const entryEventKey = tradeOverlayEntryEventKey(overlay.trade.signal);
      const liveBrokerPosition = replayIndex === null
        && liveMt5TradeOverlays.some((live) => live.id === overlay.id);
      if (!liveBrokerPosition && !isCompletedTrade(overlay.trade) && !overlay.referenceOnly && isTradeOverlayTerminated(
        setupKey,
        entryEventKey,
        false,
        completedChartTradeKeys.setupKeys,
        completedChartTradeKeys.entryEventKeys,
      )) return;
      if (!isTradeOverlayVisibleOnTimeframe(overlay.chartTimeframe, granularity)) return;
      if (!overlay.referenceOnly && (setupKey.startsWith('DIRECT:') || setupKey.startsWith('MTF:'))
        && chartSetupKeys.has(setupKey)) return;
      // OANDA/chart recalculation can revise a zone ID or its SL/TP after MT5
      // has filled it. The entry candle still identifies the same execution.
      if (!overlay.referenceOnly && entryEventKeys.has(entryEventKey)) return;
      const signature = overlay.referenceOnly ? `REFERENCE:${overlay.id}` : [
        overlay.trade.entry,
        overlay.trade.stopLoss,
        overlay.trade.takeProfit,
        overlay.trade.signal.direction,
      ].join(':');
      if (!overlays.has(signature)) {
        overlays.set(signature, overlay);
        if (!overlay.referenceOnly && (setupKey.startsWith('DIRECT:') || setupKey.startsWith('MTF:'))) {
          chartSetupKeys.add(setupKey);
        }
        if (!overlay.referenceOnly) entryEventKeys.add(entryEventKey);
      }
    };
    // An open broker position owns its drawing, including after partial RF.
    if (replayIndex === null) liveMt5TradeOverlays.forEach(addOverlay);
    // A final exit starts the drawing's five-completed-candle retention window.
    for (const record of deduplicateTradeRecords<JournalTradeRecord>(savedJournalTrades)) {
      if (!['sl', 'tp', 'rf', 'risk-free'].includes(record.result)
        || (record.symbol ?? 'XAUUSD') !== marketSymbol || record.signalTimeframe !== granularity
        || record.completedAt > tradeDisplayAsOf || hasTradeDrawingExpired(record)
        || !tradeStyleEnabled(record)) continue;
      addOverlay({ id: record.id, setupId: record.setupId, symbol: marketSymbol,
        trade: tradeDrawingFromRecord(record), chartTimeframe: record.signalTimeframe,
        label: `${record.zoneName} · ${record.tradeStyle === 'SCALPING' ? 'SCALP · ' : ''}${record.source}` });
    }
    for (const [zoneId, trade] of directZoneTrades) {
      if (!isCompletedTrade(trade)) continue;
      addOverlay({ id: `DIRECT:${zoneId}:${trade.signal.time}:${trade.entry}`, symbol: marketSymbol,
        trade, chartTimeframe: trade.signal.timeframe, label: 'TRADE RESULT' });
    }
    for (const row of mtfRows) {
      if (!row.trade || !isCompletedTrade(row.trade)) continue;
      addOverlay({ id: `MTF:${row.id}:${row.trade.signal.time}:${row.trade.entry}`, symbol: marketSymbol,
        trade: row.trade, chartTimeframe: row.lowerTimeframe, label: `${row.goldScalping ? 'SCALP ' : ''}MTF RESULT` });
    }
    for (const { zone, zoneTimeframe, trade } of goldScalpingAccuracyTrades) {
      if (!isCompletedTrade(trade)) continue;
      addOverlay({ id: `GOLD_SCALP:${zoneTimeframe}:${zone.id}:${trade.signal.time}:${trade.entry}`, symbol: marketSymbol,
        trade, chartTimeframe: trade.signal.timeframe, label: `${zone.name} · SCALP RESULT` });
    }
    retainedChartTradesForTimeframe.forEach(addOverlay);
    tradeOverlays.forEach(addOverlay);
    for (const [zoneId, decision] of directZoneEntryDecisions) {
      const trade = decision.previewTrade;
      if (!trade) continue;
      addOverlay({
        id: `DIRECT:${zoneId}:${trade.signal.time}:${trade.entry}`,
        symbol: marketSymbol,
        trade,
        label: `1:${trade.rewardRisk}`,
        chartTimeframe: trade.signal.timeframe,
        referenceOnly: true,
      });
    }
    for (const row of mtfRows) {
      if (!row.previewTrade) continue;
      addOverlay({
        id: `MTF:${row.id}:${row.engulfingTime}:${row.previewTrade.entry}`,
        symbol: marketSymbol,
        trade: row.previewTrade,
        label: `1:${row.previewTrade.rewardRisk}`,
        chartTimeframe: row.lowerTimeframe,
        referenceOnly: true,
      });
    }
    for (const { zone, zoneTimeframe, trade } of goldScalpingAccuracyTrades) {
      if (!tradingTimeEnabled || (isNepalTradingTime(trade.signal.time + TIMEFRAME_SECONDS[trade.signal.timeframe])
        && (trade.filledAt === undefined || isNepalTradingTime(trade.filledAt)))) continue;
      addOverlay({
        id: `GOLD_SCALP:${zoneTimeframe}:${zone.id}:${trade.signal.time}:${trade.entry}`,
        symbol: marketSymbol,
        trade,
        label: `1:${trade.rewardRisk}`,
        chartTimeframe: trade.signal.timeframe,
        referenceOnly: true,
      });
    }
    return Array.from(overlays.values())
      .sort((first, second) => second.trade.calculatedAt - first.trade.calculatedAt);
  }, [hasTradeDrawingExpired, savedJournalTrades, directZoneTrades, granularity, tradeDisplayAsOf, tradeStyleEnabled, completedChartTradeKeys, directZoneEntryDecisions, goldScalpingAccuracyTrades, hasRetainedDirectTradeSource, liveMt5TradeOverlays, marketSymbol, mtfRows, overlayStyleEnabled, replayIndex, retainedChartTradesForTimeframe, tradeOverlays, tradingTimeEnabled]);

  useEffect(() => {
    if (replayIndex !== null || !mt5Status?.config
      || mt5Status.config.telegramMessagesEnabled === false
      || !telegramMessagesEnabled || telegramAlertSendingRef.current) return;
    const now = Math.floor(Date.now() / 1000);
    const alerts = new Map<string, Record<string, unknown>>();
    const addEntry = (details: {
      zoneName: string; zoneTimeframe: TradeTimeframe;
      source?: 'MTF' | 'ENGULFING'; higherZoneName?: string; entryZoneName?: string;
      tradeStyle?: 'SCALPING' | 'INTRADAY';
      trade: TradeLevels;
    }) => {
      const { trade } = details;
      if (!tradeStyleEnabled(details)) return;
      if (trade.filledAt === undefined || trade.filledAt > now + 5
        || now - trade.filledAt > 180) return;
      const id = [marketSymbol, trade.signal.direction, trade.signal.timeframe,
        trade.signal.time, trade.entry.toFixed(5)].join(':');
      const alert = {
        id, kind: 'entry', symbol: marketSymbol,
        outsideTradingTime: !isNepalTradingTime(
          trade.signal.time + TIMEFRAME_SECONDS[trade.signal.timeframe],
        ) || !isNepalTradingTime(trade.filledAt),
        direction: trade.signal.direction === 'bullish' ? 'BUY' : 'SELL',
        zoneName: details.zoneName, zoneTimeframe: details.zoneTimeframe,
        source: details.source, higherZoneName: details.higherZoneName, entryZoneName: details.entryZoneName,
        signalTimeframe: trade.signal.timeframe, engulfingType: trade.signal.type,
        entry: trade.entry, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit,
        riskPips: trade.riskPips, rewardRisk: trade.rewardRisk, openedAt: trade.filledAt,
        tradeStyle: details.tradeStyle,
        ...(details.tradeStyle === 'SCALPING' ? { riskFree: trade.riskFree } : {}),
      };
      if (!telegramAlertSentRef.current.has(`${id}:entry`)) alerts.set(`${id}:entry`, alert);
    };
    for (const overlay of tradeOverlays) {
      const { trade } = overlay;
      if (trade.result || trade.filledAt === undefined) continue;
      const mtfRow = overlay.id.startsWith('MTF:')
        ? mtfRows.find((row) => row.trade?.signal.time === trade.signal.time
          && row.trade.entry === trade.entry) : undefined;
      const zoneTimeframe = mtfRow?.higherTimeframe
        ?? (overlay.id.startsWith('GOLD_SCALP:')
          ? overlay.id.split(':')[1] as TradeTimeframe : granularity);
      addEntry({
        zoneName: mtfRow?.tappedZone ?? mtfRow?.higherTimeframeZone
          ?? tradeOverlayZoneLabel(overlay.label) ?? 'Chart entry',
        zoneTimeframe, trade,
        source: mtfRow || overlay.id.startsWith('MTF:') ? 'MTF' : 'ENGULFING',
        higherZoneName: mtfRow?.higherTimeframeZone,
        entryZoneName: mtfRow?.entryZone?.name ?? mtfRow?.tappedZone,
        tradeStyle: marketSymbol === 'XAUUSD'
          ? mtfRow?.goldScalping || overlay.id.startsWith('GOLD_SCALP:')
            ? 'SCALPING' : 'INTRADAY' : undefined,
      });
    }
    for (const [zoneId, decision] of directZoneEntryDecisions) {
      if (!decision.previewTrade) continue;
      const zone = displayZones.find((candidate) => candidate.id === zoneId);
      addEntry({
        zoneName: zone ? executionZoneName(zone) : 'Chart entry',
        zoneTimeframe: granularity,
        tradeStyle: marketSymbol === 'XAUUSD' ? 'INTRADAY' : undefined,
        trade: decision.previewTrade,
      });
    }
    for (const row of mtfRows) {
      if (!row.previewTrade) continue;
      addEntry({
        zoneName: row.tappedZone ?? row.higherTimeframeZone,
        source: 'MTF', higherZoneName: row.higherTimeframeZone,
        entryZoneName: row.entryZone?.name ?? row.tappedZone,
        zoneTimeframe: row.higherTimeframe,
        tradeStyle: marketSymbol === 'XAUUSD'
          ? row.goldScalping ? 'SCALPING' : 'INTRADAY' : undefined,
        trade: row.previewTrade,
      });
    }
    for (const { zone, zoneTimeframe, trade } of goldScalpingAccuracyTrades) {
      if (isNepalTradingTime(trade.signal.time + TIMEFRAME_SECONDS[trade.signal.timeframe])
        && (trade.filledAt === undefined || isNepalTradingTime(trade.filledAt))) continue;
      addEntry({ zoneName: executionZoneName(zone), zoneTimeframe, tradeStyle: 'SCALPING', trade });
    }
    for (const record of [...allSavedAccuracyRecords].sort((first, second) => second.completedAt - first.completedAt)) {
      if (record.symbol && record.symbol !== marketSymbol) continue;
      if (!record.openedAt || !record.signalAt || !['tp', 'sl'].includes(record.result)
        || now - record.completedAt > 86_400) continue;
      const id = [marketSymbol, record.direction, record.signalTimeframe,
        record.signalAt, record.entry.toFixed(5)].join(':');
      const entryKey = `${id}:entry`;
      if (now - record.openedAt <= 180 && !telegramAlertSentRef.current.has(entryKey)
        && !alerts.has(entryKey)) {
        addEntry({
          zoneName: record.zoneName, zoneTimeframe: record.zoneTimeframe,
          source: record.source,
          higherZoneName: record.mtfContext?.higherTimeframeZone
            ?? (record.source === 'MTF' ? record.zoneId?.match(/^(.+)-\d{9,}-.+$/)?.[1] : record.zoneName),
          entryZoneName: record.source === 'MTF' ? record.mtfContext?.entryZone?.name ?? record.zoneName : undefined,
          tradeStyle: record.tradeStyle,
          trade: {
            entry: record.entry, stopLoss: record.stopLoss, takeProfit: record.takeProfit,
            riskFree: record.direction === 'bullish'
              ? record.entry + Math.abs(record.entry - record.stopLoss)
              : record.entry - Math.abs(record.entry - record.stopLoss),
            riskPips: record.riskPips, rewardRisk: record.rewardRisk,
            status: record.result === 'tp' ? 'tp-hit' : 'sl-hit', pendingAtCreation: false,
            calculatedAt: record.signalAt, filledAt: record.openedAt,
            signal: { type: record.engulfingType as EngulfingTradeSignal['type'],
              direction: record.direction, timeframe: record.signalTimeframe,
              time: record.signalAt, candleCount: 2 },
          },
        });
      }
      const resultKey = `${id}:${record.result}`;
      if (telegramAlertSentRef.current.has(resultKey) || !record.completedAt) continue;
      const returnR = record.result === 'sl' ? -1
        : record.tradeStyle === 'INTRADAY' && !record.partialClosedAt
          ? record.rewardRisk : (1 + record.rewardRisk) / 2;
      alerts.set(resultKey, {
        id, kind: record.result, symbol: marketSymbol,
        direction: record.direction === 'bullish' ? 'BUY' : 'SELL',
        zoneName: record.zoneName, zoneTimeframe: record.zoneTimeframe,
        signalTimeframe: record.signalTimeframe, engulfingType: record.engulfingType,
        entry: record.entry, stopLoss: record.stopLoss, takeProfit: record.takeProfit,
        riskPips: record.riskPips, rewardRisk: record.rewardRisk, openedAt: record.openedAt,
        tradeStyle: record.tradeStyle,
        closedAt: record.closedAt ?? record.completedAt,
        exitPrice: record.closePrice ?? (record.result === 'tp' ? record.takeProfit : record.stopLoss),
        returnR,
      });
    }
    if (alerts.size === 0) return;
    telegramAlertSendingRef.current = true;
    const batch = Array.from(alerts.entries()).slice(0, 40);
    void fetch('/api/telegram/alerts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alerts: batch.map(([, alert]) => alert) }),
    }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { acknowledged?: string[] };
      for (const key of payload.acknowledged ?? []) telegramAlertSentRef.current.add(key);
    }).catch(() => undefined).finally(() => {
      telegramAlertSendingRef.current = false;
    });
  }, [allSavedAccuracyRecords, directZoneEntryDecisions, displayZones, goldScalpingAccuracyTrades, granularity, marketSymbol, mt5Status?.config?.telegramMessagesEnabled, mtfRows, replayIndex, telegramMessagesEnabled, tradeOverlays, tradeStyleEnabled]);

  const chartEntryRecords = useMemo(() => selectTradeChartRecords(
    deduplicateTradeRecords([
      ...openChartJournalTrades.filter(tradeStyleEnabled),
      ...visibleCanonicalTradeRecords,
    ]), granularity, displayCandles, marketSymbol === 'XAUUSD',
    { includeActive: true, asOf: replayResultCutoff },
  ), [openChartJournalTrades, tradeStyleEnabled, visibleCanonicalTradeRecords,
    granularity, displayCandles, marketSymbol, replayResultCutoff]);
  const hoveredTradeZones = useMemo(() => {
    const record = chartEntryRecords.find((candidate) => candidate.id === hoveredEntry?.entry.id);
    if (!record) return undefined;
    return resolveArrowTradeZones(record, mt5Status?.recentSignals ?? [], (id) => (
      savedChartMtfEntryQualification({
        id, signalTime: record.signalAt!, direction: record.direction,
        engulfingType: record.engulfingType as EngulfingTradeSignal['type'],
        zoneName: record.zoneName, goldScalping: record.tradeStyle === 'SCALPING',
      })?.context
    ));
  }, [chartEntryRecords, hoveredEntry?.entry.id, mt5Status?.recentSignals, savedChartMtfEntryQualification]);
  const entryHovers = useMemo<EntryHover[]>(() => {
    const entries = new Map<string, EntryHover>();
    const add = (id: string, trade: TradeLevels, source: string, zone: string, fib: string, style: string, tradingTimeBlocked: boolean, chartEntryTime = trade.signal.time) => {
      const candle = displayCandles.find((candidate) => (
        chartEntryTime >= candidate.time
        && chartEntryTime < candidate.time + TIMEFRAME_SECONDS[granularity]
      ));
      if (!candle) return;
      if (!entries.has(id)) entries.set(id, {
        id, candleTime: candle.time, high: candle.high, low: candle.low,
        trade, source, zone, fib, style, tradingTimeBlocked,
      });
    };
    const visibleIds = visibleAccuracyRecordIds === null
      ? null : new Set<string>(visibleAccuracyRecordIds);
    for (const record of chartEntryRecords) {
      const active = record.result === 'open' || record.result === 'risk-free';
      if (!active && visibleIds !== null && !visibleIds.has(record.id)) continue;
      const signalAt = record.signalAt!;
      const projected = record.signalTimeframe !== granularity;
      const risk = Math.abs(record.entry - record.stopLoss);
      const bullish = record.direction === 'bullish';
      const trade: TradeLevels = {
        entry: record.entry,
        stopLoss: record.stopLoss,
        takeProfit: record.takeProfit,
        riskFree: bullish ? record.entry + risk : record.entry - risk,
        riskFreeEnabled: record.tradeStyle === 'SCALPING' || marketSymbol !== 'XAUUSD',
        riskPips: record.riskPips,
        rewardRisk: record.rewardRisk,
        status: record.result === 'tp' ? 'tp-hit' : record.result === 'sl' ? 'sl-hit'
          : record.result === 'open' ? 'active' : 'risk-free',
        pendingAtCreation: false,
        calculatedAt: signalAt,
        filledAt: record.openedAt,
        result: active ? undefined : record.result as 'tp' | 'sl' | 'rf',
        resolvedAt: active ? undefined : record.completedAt,
        signal: {
          type: record.engulfingType as EngulfingTradeSignal['type'],
          direction: record.direction,
          time: signalAt,
          candleCount: record.engulfingCandleCount ?? (record.engulfingType === 'T1' ? 2 : 3),
          timeframe: record.signalTimeframe,
        },
      };
      add(record.id, trade,
        projected ? `${record.signalTimeframe} ${record.tradeStyle === 'SCALPING' ? 'SCALPING' : 'INTRADAY'} ENTRY`
          : record.source === 'MTF'
          ? `${record.zoneTimeframe} → ${record.signalTimeframe} MTF` : 'CANDLE CONFIRMATION',
        record.zoneName,
        [record.fibSource, record.fibBand].filter(Boolean).join(' · ') || 'Not recorded',
        record.tradeStyle ?? 'INTRADAY',
        tradingTimeEnabled && accuracyRecordOutsideTradingTime(record),
        projected ? record.openedAt ?? signalAt + TIMEFRAME_SECONDS[record.signalTimeframe]
          : signalAt);
    }
    return Array.from(entries.values());
  }, [chartEntryRecords, displayCandles, granularity, marketSymbol, tradingTimeEnabled, visibleAccuracyRecordIds]);
  const latestCandle = displayCandles[displayCandles.length - 1] || null;
  const previousCandle = displayCandles.length > 1 ? displayCandles[displayCandles.length - 2] : null;
  const headerCandlesByTime = useMemo(() => new Map(displayCandles.map((candle, index) => (
    [candle.time, { candle, previous: index > 0 ? displayCandles[index - 1] : null }] as const
  ))), [displayCandles]);
  const retainedDirectTradeZoneIds = useMemo(() => new Set(
    retainedChartTradesForTimeframe
      .map(directTradeOverlayZoneId)
      .filter((zoneId): zoneId is string => Boolean(zoneId)),
  ), [retainedChartTradesForTimeframe]);
  const zoneTableRows = useMemo(() => {
    if (!directTradeStyleEnabled) return [];
    const candidates = consolidatedDisplayZones
    .filter((zone) => zone.active && zone.status === 'valid'
      && !hasTradeDisplayExpired(confluenceMapValue<TradeLevels>(zone, directZoneTrades))
      && !displayZoneMembers(zone).some(member => hasTradeDisplayExpired(directZoneMt5Signals.get(member.id)))
      && !redundantStandaloneZoneIds.has(zone.id)
      && ((displayedTapCount(zone) ?? 0) > 1
        || !displayZoneMembers(zone).some((member) => retainedDirectTradeZoneIds.has(member.id)))
      && ((displayedTapCount(zone) ?? 0) > 1
        || !retainedDirectChartTradesForTimeframe.some((overlay) => {
          const trade = confluenceMapValue<TradeLevels>(zone, directZoneTrades);
          return trade && tradeOverlayExecutionKey(overlay.trade) === tradeOverlayExecutionKey(trade);
        }))
      && (showInternal || zone.category !== 'internal')
      && zone.doubleChochStatus === undefined
      && (confluenceTapBarsAgo(zone) ?? Infinity) <= 50)
    .sort((a, b) => (
      (confluenceLatestTap(b)?.time ?? b.startTime)
      - (confluenceLatestTap(a)?.time ?? a.startTime)
    ));
    const bestByTrade = new Map<string, { zone: DisplayStructureZone; expired: boolean }>();
    for (const zone of candidates) {
      const trade = confluenceMapValue<TradeLevels>(zone, directZoneTrades);
      if (!trade) continue;
      const key = tradeOverlayExecutionKey(trade);
      const expired = marketSymbol === 'XAUUSD' && displayZoneMembers(zone).every((member) => (
        isGoldZoneOpportunityExpired(member, displayCandles, granularity, marketConfig.pipSize,
          Infinity, trade.filledAt === undefined ? undefined
            : { price: trade.entry, filledAt: trade.filledAt, stopLoss: trade.stopLoss })
      ));
      const previous = bestByTrade.get(key);
      if (!previous || (previous.expired && !expired)) bestByTrade.set(key, { zone, expired });
    }
    return candidates.filter((zone) => {
      const trade = confluenceMapValue<TradeLevels>(zone, directZoneTrades);
      return !trade || bestByTrade.get(tradeOverlayExecutionKey(trade))?.zone === zone;
    }).slice(0, 8);
  }, [hasTradeDisplayExpired, consolidatedDisplayZones, directTradeStyleEnabled, directZoneTrades, directZoneMt5Signals, displayedTapCount, displayCandles, granularity, marketConfig.pipSize, marketSymbol, redundantStandaloneZoneIds, retainedDirectChartTradesForTimeframe, retainedDirectTradeZoneIds, showInternal]);
  const scalpEntryTableRows = useMemo(() => {
    if (!scalpingEnabled) return [];
    const rows = new Map<string, {
      id: string;
      zone: string;
      trade: TradeLevels;
      tradingTimeBlocked: boolean;
    }>();
    for (const entry of entryHovers) {
      if (entry.style !== 'SCALPING' || entry.trade.signal.timeframe !== granularity) continue;
      rows.set(entry.id, {
        id: entry.id,
        zone: entry.zone,
        trade: entry.trade,
        tradingTimeBlocked: entry.tradingTimeBlocked,
      });
    }
    for (const { zone, zoneTimeframe, trade } of goldScalpingAccuracyTrades) {
      if (trade.signal.timeframe !== granularity
        || !displayCandles.some((candle) => candle.time === trade.signal.time)) continue;
      const id = `GOLD_SCALP:${zoneTimeframe}:${zone.id}:${trade.signal.time}:${trade.entry}`;
      if (!rows.has(id)) rows.set(id, {
        id,
        zone: executionZoneName(zone),
        trade,
        tradingTimeBlocked: tradingTimeEnabled
          && (!isNepalTradingTime(trade.signal.time + TIMEFRAME_SECONDS[trade.signal.timeframe])
            || (trade.filledAt !== undefined && !isNepalTradingTime(trade.filledAt))),
      });
    }
    return Array.from(rows.values())
      .filter(({ trade }) => !hasTradeDisplayExpired(trade))
      .sort((first, second) => second.trade.signal.time - first.trade.signal.time)
      .slice(0, 8);
  }, [hasTradeDisplayExpired, displayCandles, entryHovers, goldScalpingAccuracyTrades, granularity, scalpingEnabled, tradingTimeEnabled]);
  const replayDirectCandidates = useMemo<EntryHover[]>(() => {
    if (!directTradeStyleEnabled || replayIndex === null || replayResultCutoff === undefined) return [];
    const entries: EntryHover[] = [];
    for (const zone of displayZones) {
      if (redundantStandaloneZoneIds.has(zone.id)
        || extremeAPlusTjl2Selection.blockedZoneIds.has(zone.id)
        || zone.status === 'rejected'
        || (!isZoneEligibleForEngulfingEntry(zone) && zone.tradeable === false)) continue;
      const signal = resolveZoneEngulfingSignal(zone, granularity);
      if (!signal || signal.timeframe !== granularity) continue;
      if (pendingM15DbBlocksSignal(zone, signal) || expiredGoldZoneBeforeSignal(zone, signal)) continue;
      if (marketSymbol === 'XAUUSD'
        && !isGoldIntradayCandleRoute(granularity, signal.timeframe)) continue;
      const confirmationTime = signal.time + TIMEFRAME_SECONDS[signal.timeframe];
      if (confirmationTime > replayResultCutoff
        || !displayCandles.some((candle) => candle.time >= confirmationTime)) continue;
      const baseRule = getDirectTradeRule(granularity, signal.timeframe);
      if (!baseRule) continue;
      const rule = resolveRuleForDirectEntry({
        zoneTimeframe: granularity,
        signal,
        sourceCandles: displayCandles,
        baseRule,
      });
      if (!rule) continue;
      const trade = calculateTradeLevels({
        sourceCandles: displayCandles,
        executionCandles: displayCandles,
        signal,
        rule,
        riskFreeEnabled: marketSymbol !== 'XAUUSD',
        omitStopBuffer: marketSymbol !== 'XAUUSD'
          && isDeepDiscountTradeSignal(zone, signal),
      });
      const candle = displayCandles.find((item) => item.time === signal.time);
      if (!trade || !candle) continue;
      const fib = journalFibMetadata(zone, signal);
      entries.push({
        id: `DIRECT:${zone.id}:${signal.time}:${trade.entry}`,
        candleTime: candle.time,
        high: candle.high,
        low: candle.low,
        trade,
        source: 'CANDLE CONFIRMATION',
        zone: executionZoneName(zone),
        fib: [fib.fibSource, fib.fibBand].filter(Boolean).join(' · '),
        style: 'INTRADAY',
        tradingTimeBlocked: tradingTimeEnabled
          && (!isNepalTradingTime(confirmationTime)
            || (trade.filledAt !== undefined && !isNepalTradingTime(trade.filledAt))),
      });
    }
    return entries;
  }, [directTradeStyleEnabled, displayCandles, displayZones, expiredGoldZoneBeforeSignal, extremeAPlusTjl2Selection.blockedZoneIds, granularity, marketSymbol, pendingM15DbBlocksSignal, redundantStandaloneZoneIds, replayIndex, replayResultCutoff, tradingTimeEnabled]);
  // Visible arrows and their hover details share the same history, without drawing expiry.
  entryHoversRef.current = showEntryArrows ? entryHovers : [];
  const entryMarkers = useMemo(() => entryHovers.map(({ candleTime, trade, style }) => {
    const bullish = trade.signal.direction === 'bullish';
    const projectedScalp = (granularity === 'M15' || granularity === 'H1') && style === 'SCALPING'
      && (trade.signal.timeframe === 'M1' || trade.signal.timeframe === 'M5');
    return {
      time: candleTime as UTCTimestamp,
      position: bullish ? 'belowBar' as const : 'aboveBar' as const,
      color: bullish ? '#059669' : '#e11d48',
      shape: bullish ? 'arrowUp' as const : 'arrowDown' as const,
      text: trade.result?.toUpperCase(),
      size: projectedScalp ? 1 : 2,
    };
  }).sort((first, second) => Number(first.time) - Number(second.time) || second.size - first.size),
  [granularity, entryHovers]);
  const replayDirectHistoryByZone = useMemo(() => {
    const entries = new Map<string, EntryHover>();
    if (replayIndex === null) return entries;
    const directEntries = [...entryHovers, ...replayDirectCandidates].filter((entry) => (
      entry.id.startsWith('DIRECT:') && entry.trade.signal.timeframe === granularity
    )).sort((first, second) => second.trade.signal.time - first.trade.signal.time);
    for (const zone of zoneTableRows) {
      const match = directEntries.find((entry) => displayZoneMembers(zone).some((member) => (
        entry.id.startsWith(`DIRECT:${member.id}:`)
      )));
      if (match) entries.set(zone.id, match);
    }
    return entries;
  }, [entryHovers, granularity, replayDirectCandidates, replayIndex, zoneTableRows]);
  const replayHistoryOverlays = useMemo<TradeOverlay[]>(() => {
    if (replayIndex === null) return [];
    const entries = new Map<string, {
      id: string;
      trade: TradeLevels;
      tradingTimeBlocked: boolean;
    }>();
    for (const entry of replayDirectHistoryByZone.values()) entries.set(entry.id, entry);
    for (const entry of scalpEntryTableRows) entries.set(entry.id, entry);
    return Array.from(entries.values()).filter(({ trade }) => !hasTradeDisplayExpired(trade) && !visibleTradeOverlays.some((overlay) => (
      overlay.trade.signal.time === trade.signal.time && overlay.trade.entry === trade.entry
    )))
      .map(({ id, trade, tradingTimeBlocked }) => ({
        id,
        symbol: marketSymbol,
        trade,
        label: tradingTimeBlocked
          ? 'OUTSIDE TRADING TIME · REFERENCE'
          : `REPLAY · ${isCompletedTrade(trade) ? tradeStatusLabel(trade) : 'ENTRY'}`,
        chartTimeframe: trade.signal.timeframe,
        referenceOnly: true,
      }));
  }, [hasTradeDisplayExpired, marketSymbol, replayDirectHistoryByZone, replayIndex, scalpEntryTableRows, visibleTradeOverlays]);
  const retainedTradeZoneRows = useMemo(() => {
    if (!directTradeStyleEnabled) return [];
    const activeZoneIds = new Set([
      ...zoneTableRows.flatMap((zone) => displayZoneMembers(zone).map((member) => member.id)),
      ...displayZones
        .filter((zone) => zone.active && zone.status === 'valid'
          && zone.doubleChochStatus !== undefined)
        .map((zone) => zone.id),
    ]);
    const rows = new Map<string, StructureZone>();
    const listedTradeKeys = new Set([
      ...retainedDirectChartTradesForTimeframe.map((overlay) => tradeOverlayExecutionKey(overlay.trade)),
      ...zoneTableRows.flatMap((zone) => {
        const trade = confluenceMapValue<TradeLevels>(zone, directZoneTrades);
        return trade ? [tradeOverlayExecutionKey(trade)] : [];
      }),
    ]);
    for (const setup of trackedDirectTradeSetups.values()) {
      if (setup.scope !== tradeTrackingScope || activeZoneIds.has(setup.zone.id)
        || retainedDirectTradeZoneIds.has(setup.zone.id)
        || redundantStandaloneZoneIds.has(setup.zone.id)) continue;
      const trade = directZoneTrades.get(setup.zone.id);
      if (!trade || hasTradeDisplayExpired(trade)) continue;
      const tradeKey = tradeOverlayExecutionKey(trade);
      if (listedTradeKeys.has(tradeKey)) continue;
      const row = displayZones.find((zone) => zone.id === setup.zone.id) ?? setup.zone;
      if ((!showInternal && row.category === 'internal')
        || (isCompletedTrade(trade) && (row.tapBarsAgo ?? Infinity) > 50)) continue;
      rows.set(
        setup.zone.id,
        row,
      );
      listedTradeKeys.add(tradeKey);
    }
    const sorted = Array.from(rows.values())
      .sort((a, b) => (b.invalidatedAt ?? b.startTime) - (a.invalidatedAt ?? a.startTime));
    const open = sorted.filter((row) => !isCompletedTrade(directZoneTrades.get(row.id)));
    const completed = sorted.filter((row) => isCompletedTrade(directZoneTrades.get(row.id))).slice(0, 4);
    return [...open, ...completed];
  }, [
    hasTradeDisplayExpired,
    directTradeStyleEnabled,
    directZoneTrades,
    displayZones,
    showInternal,
    retainedDirectTradeZoneIds,
    retainedDirectChartTradesForTimeframe,
    redundantStandaloneZoneIds,
    trackedDirectTradeSetups,
    tradeTrackingScope,
    zoneTableRows,
  ]);
  const latestDisplayCandleTime = displayCandles[displayCandles.length - 1]?.time;
  const doubleChochRows = useMemo(() => consolidatedDisplayZones
    .filter((zone) => directTradeStyleEnabled && zone.active && zone.status === 'valid'
      && zone.doubleChochStatus !== undefined
      && (zone.tapTime !== undefined
        ? (zone.lastTapBarsAgo ?? zone.tapBarsAgo ?? Infinity) <= 50
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
    .slice(0, 8), [consolidatedDisplayZones, directTradeStyleEnabled, granularity, latestDisplayCandleTime]);
  const pendingConfirmationRows = useMemo(() => consolidatedDisplayZones
    .filter((zone) => directTradeStyleEnabled && (zone.name === 'TJL1' || zone.name === 'ISS L3' || zone.name === 'Internal TJL1')
      && zone.active && zone.status === 'pending'
      && (showInternal || zone.category !== 'internal'))
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 4), [consolidatedDisplayZones, directTradeStyleEnabled, showInternal]);
  updateHeaderCandleRef.current = (timestamp?: number) => {
    const selected = timestamp === undefined ? undefined : headerCandlesByTime.get(timestamp);
    const candle = selected?.candle ?? latestCandle;
    const prior = selected?.previous ?? previousCandle;
    if (!candle) return;
    if (headerOpenRef.current) headerOpenRef.current.textContent = formatPrice(candle.open);
    if (headerHighRef.current) headerHighRef.current.textContent = formatPrice(candle.high);
    if (headerLowRef.current) headerLowRef.current.textContent = formatPrice(candle.low);
    if (headerCloseRef.current) headerCloseRef.current.textContent = formatPrice(candle.close);
    if (headerChangeRef.current) {
      const selectedChange = prior ? candle.close - prior.close : 0;
      const selectedPercent = prior?.close ? selectedChange / prior.close * 100 : 0;
      headerChangeRef.current.textContent = `${selectedChange >= 0 ? '+' : ''}${formatPrice(selectedChange)} (${selectedPercent >= 0 ? '+' : ''}${selectedPercent.toFixed(2)}%)`;
      headerChangeRef.current.className = `font-black ${selectedChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }
  };
  useEffect(() => {
    updateHeaderCandleRef.current();
  }, [displayCandles]);

  // Zone endpoints scan candle history. They depend on market data, never on
  // the viewport, so dragging must only project the already computed result.
  const zoneDrawingEndIndices = useMemo(() => new Map(consolidatedDisplayZones.map((zone) => [
    zone.id,
    marketSymbol === 'XAUUSD'
      ? tappedZoneDrawingEndIndex(zone, displayCandles, granularity, marketConfig.pipSize)
      : undefined,
  ])), [consolidatedDisplayZones, displayCandles, granularity, marketConfig.pipSize, marketSymbol]);
  const overlayCandlesByTime = useMemo(() => new Map<number, OandaCandle>(
    displayCandles.map((candle) => [Number(candle.time), candle]),
  ), [displayCandles]);

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
    const candleByTime = overlayCandlesByTime;
    const mtfBadgesByZone = new Map<string, Set<string>>();
    for (const row of mtfRows) {
      if (!row.higherTimeframeZoneId) continue;
      const badges = mtfBadgesByZone.get(row.higherTimeframeZoneId) ?? new Set<string>();
      badges.add(row.setupId);
      mtfBadgesByZone.set(row.higherTimeframeZoneId, badges);
    }
    const unfinishedEntryZoneIds = new Set<string>();
    const listedZoneIds = new Set(zoneTableRows.flatMap((zone) => (
      displayZoneMembers(zone).map((member) => member.id)
    )));
    for (const [zoneId, trade] of directZoneTrades) {
      if (!isCompletedTrade(trade)) unfinishedEntryZoneIds.add(zoneId);
    }
    for (const row of mtfRows) {
      if (row.higherTimeframeZoneId && row.trade && !isCompletedTrade(row.trade)) {
        unfinishedEntryZoneIds.add(row.higherTimeframeZoneId);
      }
    }
    const isVisualZoneVisible = (zone: DisplayStructureZone) => (
      displayZoneMembers(zone).some((member) => (
        member.category === 'mg'
          ? showMgZonesRef.current
          : member.category === 'iss'
            ? showIssRef.current
            : member.category === 'internal'
              ? showInternalRef.current
              : showSupplyDemandRef.current
      )) && (zone.active || showInvalidZonesRef.current)
    );
    let latestMeasuredZoneId: string | undefined;
    let latestMeasuredTapTime = -Infinity;
    for (const zone of visualZonesRef.current) {
      if (!isVisualZoneVisible(zone) || !measureTradeableFibZone(zone, marketConfig.pipSize)) continue;
      const tapTime = Math.max(...displayZoneMembers(zone)
        .map((member) => member.tapTime ?? -Infinity));
      if (tapTime > latestMeasuredTapTime) {
        latestMeasuredTapTime = tapTime;
        latestMeasuredZoneId = zone.id;
      }
    }
    const rightEdge = Math.max(0, host.clientWidth - 72);
    const visibleTimeRange = chart.timeScale().getVisibleRange();
    // Start each comparison zone at its own origin and extend it 50 chart bars ahead.
    // Interpolating logical coordinates also places lower-timeframe origins between chart bars.
    const latestLogicalIndex = displayCandles.length - 1;
    const comparisonEndX = chart.timeScale().logicalToCoordinate(latestLogicalIndex + 50);
    for (const { zone, overlapsCurrentZone, visibleFromTime } of visibleComparisonZones) {
      if (comparisonEndX === null) continue;
      const sourceStartTime = visibleFromTime ?? zone.startTime;
      let nextIndex = 0;
      let high = displayCandles.length;
      while (nextIndex < high) {
        const middle = Math.floor((nextIndex + high) / 2);
        if (displayCandles[middle].time < sourceStartTime) nextIndex = middle + 1;
        else high = middle;
      }
      let originLogicalIndex = 0;
      if (nextIndex > 0 && nextIndex < displayCandles.length) {
        const previous = displayCandles[nextIndex - 1];
        const next = displayCandles[nextIndex];
        originLogicalIndex = nextIndex - 1 + (sourceStartTime - previous.time)
          / Math.max(1, next.time - previous.time);
      } else if (nextIndex === displayCandles.length) {
        const last = displayCandles[latestLogicalIndex];
        if (sourceStartTime >= last.time + TIMEFRAME_SECONDS[granularity]) continue;
        originLogicalIndex = latestLogicalIndex
          + (sourceStartTime - last.time) / TIMEFRAME_SECONDS[granularity];
      }
      const comparisonStartX = chart.timeScale().logicalToCoordinate(originLogicalIndex);
      if (comparisonStartX === null) continue;
      const left = Math.max(0, comparisonStartX);
      const right = Math.min(rightEdge, comparisonEndX);
      if (right <= left) continue;
      const top = series.priceToCoordinate(zone.top);
      const bottom = series.priceToCoordinate(zone.bottom);
      if (top === null || bottom === null) continue;
      if (Math.min(top, bottom) > host.clientHeight || Math.max(top, bottom) < 0) continue;
      const color = zone.isBuy ? '5, 150, 105' : '225, 29, 72';
      const box = document.createElement('div');
      box.style.position = 'absolute';
      box.style.left = `${left}px`;
      box.style.width = `${right - left}px`;
      box.style.top = `${Math.min(top, bottom)}px`;
      box.style.height = `${Math.max(2, Math.abs(bottom - top))}px`;
      box.style.background = `rgba(${color}, 0.045)`;
      box.style.borderTop = `1px dashed rgba(${color}, 0.32)`;
      box.style.borderBottom = `1px dashed rgba(${color}, 0.32)`;
      box.style.boxSizing = 'border-box';
      box.style.pointerEvents = 'none';
      const label = document.createElement('span');
      const chochZone = ltfChochContext?.confirmations.some(({ line }) => (
        zone.chochTime === line.toTime || zone.doubleChochTime === line.toTime
      ));
      label.textContent = `${GRANULARITY_LABELS[comparisonTimeframe!]} ${zone.isBuy ? 'BUY' : 'SELL'} ${chochZone ? 'CHoCH ZONE · ' : ''}${zone.name}${overlapsCurrentZone ? ' · OVERLAP' : ''}`;
      label.style.position = 'absolute';
      label.style.right = '19px';
      label.style.top = Math.abs(bottom - top) >= 14 ? '1px' : '-12px';
      label.style.fontSize = '9px';
      label.style.fontWeight = '800';
      label.style.color = `rgba(${color}, 0.8)`;
      label.style.whiteSpace = 'nowrap';
      box.appendChild(label);
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.textContent = '×';
      closeButton.title = `Hide ${GRANULARITY_LABELS[comparisonTimeframe!]} ${zone.isBuy ? 'buy' : 'sell'} ${zone.name} zone`;
      closeButton.setAttribute('aria-label', closeButton.title);
      closeButton.style.position = 'absolute';
      closeButton.style.right = '2px';
      closeButton.style.top = '-6px';
      closeButton.style.width = '14px';
      closeButton.style.height = '14px';
      closeButton.style.border = `1px solid rgba(${color}, 0.4)`;
      closeButton.style.borderRadius = '50%';
      closeButton.style.background = 'white';
      closeButton.style.color = `rgb(${color})`;
      closeButton.style.fontSize = '11px';
      closeButton.style.fontWeight = '800';
      closeButton.style.lineHeight = '12px';
      closeButton.style.padding = '0';
      closeButton.style.cursor = 'pointer';
      closeButton.style.pointerEvents = 'auto';
      closeButton.addEventListener('pointerdown', (event) => event.stopPropagation());
      closeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const key = `${marketSymbol}:${comparisonTimeframe}:${zone.id}`;
        setHiddenComparisonZoneKeys((current) => current.includes(key) ? current : [...current, key]);
      });
      box.appendChild(closeButton);
      fragment.appendChild(box);
    }
    const shownLtfConfirmations = new Set<string>();
    for (const { line, chochSequence } of ltfChochContext?.confirmations ?? []) {
      const key = `${line.toTime}:${line.direction}`;
      if (shownLtfConfirmations.has(key)) continue;
      shownLtfConfirmations.add(key);
      const confirmedAt = line.toTime + TIMEFRAME_SECONDS[comparisonTimeframe!];
      const chartCandle = [...displayCandles].reverse().find((candle) => candle.time < confirmedAt);
      if (!chartCandle || confirmedAt > chartCandle.time + TIMEFRAME_SECONDS[granularity]) continue;
      if (visibleTimeRange && (chartCandle.time < Number(visibleTimeRange.from)
        || chartCandle.time > Number(visibleTimeRange.to))) continue;
      const x = chart.timeScale().timeToCoordinate(chartCandle.time as UTCTimestamp);
      const y = series.priceToCoordinate(line.toPrice);
      if (x === null || y === null || x < 0 || x > rightEdge) continue;
      const badge = document.createElement('div');
      badge.style.position = 'absolute';
      badge.style.left = `${x}px`;
      badge.style.top = `${Math.max(0, y + (line.direction === 'bullish' ? 10 : -24))}px`;
      badge.style.transform = 'translateX(-50%)';
      badge.style.padding = '2px 5px';
      badge.style.borderRadius = '4px';
      badge.style.background = line.direction === 'bullish' ? '#dcfce7' : '#ffe4e6';
      badge.style.color = line.direction === 'bullish' ? '#166534' : '#9f1239';
      badge.style.fontSize = '9px';
      badge.style.fontWeight = '800';
      badge.style.whiteSpace = 'nowrap';
      badge.style.pointerEvents = 'none';
      badge.textContent = `${GRANULARITY_LABELS[comparisonTimeframe!]} ${mtfChochSequenceLabel(chochSequence)}${chochSequence === 1 ? ' CONFIRMED' : ''}`;
      fragment.appendChild(badge);
    }
    for (const zone of scalpingEnabled ? oneMinuteScalpingZones : []) {
      if (visibleTimeRange && (zone.endTime < Number(visibleTimeRange.from)
        || zone.startTime > Number(visibleTimeRange.to))) continue;
      if (!(zone.category === 'mg' ? showMgZonesRef.current
        : zone.category === 'iss' ? showIssRef.current
          : zone.category === 'internal' ? showInternalRef.current
            : showSupplyDemandRef.current)) continue;
      const rawLeft = chart.timeScale().timeToCoordinate(zone.startTime as UTCTimestamp);
      const rawRight = chart.timeScale().timeToCoordinate(zone.endTime as UTCTimestamp);
      const top = series.priceToCoordinate(zone.top);
      const bottom = series.priceToCoordinate(zone.bottom);
      if (top === null || bottom === null) continue;
      const left = Math.max(0, rawLeft ?? 0);
      const right = Math.min(rightEdge, rawRight ?? rightEdge);
      if (left >= right) continue;
      const box = document.createElement('div');
      box.style.position = 'absolute';
      box.style.left = `${left}px`;
      box.style.width = `${right - left}px`;
      box.style.top = `${Math.min(top, bottom)}px`;
      box.style.height = `${Math.max(2, Math.abs(bottom - top))}px`;
      box.style.background = zone.isBuy ? 'rgba(16, 185, 129, 0.08)' : 'rgba(244, 63, 94, 0.08)';
      box.style.border = `1px dashed ${zone.isBuy ? '#059669' : '#e11d48'}`;
      box.style.boxSizing = 'border-box';
      box.style.overflow = 'hidden';
      const label = document.createElement('span');
      label.textContent = `15M SCALP · ${zone.name}`;
      label.style.fontSize = '9px';
      label.style.fontWeight = '800';
      label.style.color = zone.isBuy ? '#047857' : '#be123c';
      box.appendChild(label);
      fragment.appendChild(box);
    }
    for (const { zone, label, endTime } of mtfDrawingZones) {
      const first = displayCandles.find(candle => candle.time >= zone.startTime);
      const last = [...displayCandles].reverse().find(candle => candle.time <= endTime);
      if (!first || !last || first.time > last.time) continue;
      if (visibleTimeRange && (last.time < Number(visibleTimeRange.from)
        || first.time > Number(visibleTimeRange.to))) continue;
      const left = Math.max(0, chart.timeScale().timeToCoordinate(first.time as UTCTimestamp) ?? 0);
      const right = Math.min(rightEdge, chart.timeScale().timeToCoordinate(last.time as UTCTimestamp) ?? rightEdge);
      const top = series.priceToCoordinate(zone.top);
      const bottom = series.priceToCoordinate(zone.bottom);
      if (top === null || bottom === null || left >= right) continue;
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'absolute', left: `${left}px`, width: `${right - left}px`,
        top: `${Math.min(top, bottom)}px`, height: `${Math.max(2, Math.abs(bottom - top))}px`,
        border: `2px solid ${zone.isBuy ? '#059669' : '#e11d48'}`,
        background: zone.isBuy ? 'rgba(16,185,129,0.06)' : 'rgba(244,63,94,0.06)',
        boxSizing: 'border-box', pointerEvents: 'none',
        fontSize: '9px', fontWeight: '800', color: zone.isBuy ? '#047857' : '#be123c',
      });
      box.textContent = label;
      fragment.appendChild(box);
    }
    const occupiedZoneLabelRects: Array<{
      left: number;
      right: number;
      top: number;
      bottom: number;
    }> = [];
    for (const zone of visualZonesRef.current) {
      if (!isVisualZoneVisible(zone)) continue;
      const listedInTable = displayZoneMembers(zone).some((member) => listedZoneIds.has(member.id));
      const extendedEndIndex = zoneDrawingEndIndices.get(zone.id);
      if (visibleTimeRange && ((extendedEndIndex === undefined && zone.endTime < Number(visibleTimeRange.from))
        || zone.startTime > Number(visibleTimeRange.to))) continue;
      const rawLeft = chart.timeScale().timeToCoordinate(zone.startTime as UTCTimestamp);
      const rawRight = extendedEndIndex === undefined
        ? chart.timeScale().timeToCoordinate(zone.endTime as UTCTimestamp)
        : chart.timeScale().logicalToCoordinate(extendedEndIndex);
      const top = series.priceToCoordinate(zone.top);
      const bottom = series.priceToCoordinate(zone.bottom);
      if (top === null || bottom === null) continue;
      if (Math.min(top, bottom) > host.clientHeight || Math.max(top, bottom) < 0) continue;
      const left = Math.max(0, rawLeft === null ? 0 : rawLeft);
      const right = Math.min(rightEdge, rawRight === null ? rightEdge : rawRight);
      if (left >= right || right <= 0) continue;
      const zoneWidth = right - left;

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
      const zoneTopCoordinate = Math.min(top, bottom);
      const zoneHeight = Math.max(2, Math.abs(bottom - top));
      box.style.position = 'absolute';
      box.style.left = `${left}px`;
      box.style.width = `${right - left}px`;
      box.style.top = `${zoneTopCoordinate}px`;
      box.style.height = `${zoneHeight}px`;
      box.style.background = fill;
      box.style.borderTop = `1px solid ${border}`;
      box.style.borderBottom = `1px solid ${border}`;
      box.style.overflow = listedInTable && zoneHeight < 16 ? 'visible' : 'hidden';

      const retainMeasurementForEntry = displayZoneMembers(zone)
        .some((member) => unfinishedEntryZoneIds.has(member.id));
      const measurement = listedInTable
        ? measureListedZone(zone, marketConfig.pipSize)
        : zone.id === latestMeasuredZoneId || retainMeasurementForEntry
          ? measureTradeableFibZone(zone, marketConfig.pipSize)
          : undefined;
      if (measurement) {
        const midlineCoordinate = series.priceToCoordinate(measurement.midline);
        if (midlineCoordinate !== null) {
          const midline = document.createElement('div');
          midline.style.position = 'absolute';
          midline.style.left = '0';
          midline.style.right = '0';
          midline.style.top = `${Math.max(0, Math.min(zoneHeight, midlineCoordinate - zoneTopCoordinate))}px`;
          midline.style.borderTop = `1px dashed ${border}`;
          midline.style.pointerEvents = 'none';
          box.appendChild(midline);
        }
      }

      const label = document.createElement('span');
      const name = isMg || isIss || isInternal
        ? displayConfluenceZoneName(zone, true)
        : demand ? 'DEMAND' : 'SUPPLY';
      const labelDetails: string[] = [];
      if (zone.majorLiquidity) labelDetails.push('MAJOR LIQUIDITY');
      const extremeAPlusMembers = displayZoneMembers(zone);
      const extremeAPlus = extremeAPlusMembers.some((member) => (
        extremeAPlusTjl2Selection.extremeZoneIds.has(member.id)
      ));
      const extremeAPlusBlocked = extremeAPlusMembers.some((member) => (
        extremeAPlusTjl2Selection.blockedZoneIds.has(member.id)
      ));
      if (extremeAPlusBlocked) labelDetails.push('EXTREME A+ HIGHER', 'NO TRADE');
      else if (extremeAPlus) labelDetails.push('EXTREME A+');
      if (measurement) {
        labelDetails.push(`${formatZonePips(measurement.pips)} PIPS`);
      }
      if (inactive) {
        if (rejected) labelDetails.push('REJECTED');
        else if (zone.status === 'superseded') labelDetails.push('SUPERSEDED');
      } else if (showsDoubleChochStatus) {
        if (zone.doubleChochStatus === 'pending') {
          labelDetails.push(
            'DOUBLE CHoCH',
            `PENDING ${confirmationLabel} ${zone.doubleChochConfirmationDirection === 'up' ? 'ABOVE' : 'BELOW'}`,
          );
        } else {
          labelDetails.push('VALID DOUBLE CHoCH');
          if (zone.tradeable === false) labelDetails.push('NO TRADE');
        }
      } else if (zone.name === 'TJL1' || zone.name === 'ISS L3' || zone.name === 'Internal TJL1') {
        labelDetails.push(pending
          ? `PENDING ${confirmationLabel} ${zone.isBuy ? 'ABOVE' : 'BELOW'}`
          : 'VALID');
      } else if (zone.chochClass) {
        if (zone.chochClass !== 'pending') {
          labelDetails.push(zone.chochClass.toUpperCase());
        }
      } else if (pending) {
        labelDetails.push('PENDING');
      }
      if (!inactive && showFibRef.current && zone.fibStatus === 'a-plus'
        && zone.fibBand && zone.fibBand !== 'DB/DT') {
        labelDetails.push(displayFibLabel(zone));
      }
      if (!inactive && showFibRef.current && zone.swingFibStatus === 'a-plus' && zone.swingFibBand) {
        labelDetails.push(`SWING A+ FIB ${zone.swingFibBand}`);
      }
      if (!inactive && showFibRef.current && zone.dayFibStatus === 'a-plus' && zone.dayFibBand) {
        labelDetails.push(`DAY FIB A+ ${zone.dayFibBand}`);
      }
      const confluenceLabels = confluenceBadgeLabels(zone);
      if (confluenceLabels.length > 0) {
        labelDetails.push(confluenceLabels.join(' / '));
      }
      const mtfBadges = Array.from(mtfBadgesByZone.get(zone.id) ?? []);
      if (mtfBadges.length > 0) {
        labelDetails.push(mtfBadges.join(' / '));
      }
      const visibleZoneTop = Math.max(0, zoneTopCoordinate);
      const visibleZoneBottom = Math.min(host.clientHeight, zoneTopCoordinate + zoneHeight);
      const visibleZoneHeight = visibleZoneBottom - visibleZoneTop;
      if (zoneWidth < 20 || visibleZoneHeight < 16) {
        if (listedInTable && zoneWidth >= 20 && visibleZoneHeight > 0) {
          const shortLabel = document.createElement('span');
          shortLabel.textContent = name;
          shortLabel.style.position = 'absolute';
          shortLabel.style.right = '2px';
          shortLabel.style.top = '-13px';
          shortLabel.style.padding = '0 2px';
          shortLabel.style.background = 'rgba(255, 255, 255, 0.92)';
          shortLabel.style.color = demand ? '#047857' : '#be123c';
          shortLabel.style.fontSize = '9px';
          shortLabel.style.fontWeight = '800';
          shortLabel.style.whiteSpace = 'nowrap';
          box.appendChild(shortLabel);
        }
        fragment.appendChild(box);
        continue;
      }
      const detailLines = zoneWidth >= 160
        ? Math.min(3, Math.max(0, Math.floor((visibleZoneHeight - 16) / 11)))
        : 0;
      const labelHeight = 12 + (labelDetails.length > 0 ? detailLines * 11 : 0);
      const labelLeft = left + 4;
      const labelRight = right - 4;
      const preferredLabelTop = Math.max(
        visibleZoneTop + 2,
        Math.min(
          visibleZoneTop + visibleZoneHeight / 2 - 6,
          visibleZoneBottom - labelHeight - 2,
        ),
      );
      let labelTop = preferredLabelTop;
      for (let step = 0; step <= 8; step += 1) {
        const offsets = step === 0 ? [0] : [step * 12, step * -12];
        const availableOffset = offsets.find((offset) => {
          const candidateTop = preferredLabelTop + offset;
          const candidateBottom = candidateTop + labelHeight;
          if (candidateTop < visibleZoneTop + 2
            || candidateBottom > visibleZoneBottom - 2) return false;
          return !occupiedZoneLabelRects.some((occupied) => (
            labelLeft < occupied.right + 4
            && labelRight > occupied.left - 4
            && candidateTop < occupied.bottom + 2
            && candidateBottom > occupied.top - 2
          ));
        });
        if (availableOffset !== undefined) {
          labelTop = preferredLabelTop + availableOffset;
          break;
        }
      }
      occupiedZoneLabelRects.push({
        left: labelLeft,
        right: labelRight,
        top: labelTop,
        bottom: labelTop + labelHeight,
      });
      label.style.position = 'absolute';
      label.style.left = '4px';
      label.style.right = '4px';
      label.style.top = `${labelTop - zoneTopCoordinate}px`;
      label.style.lineHeight = '12px';
      label.style.maxHeight = `${labelHeight}px`;
      label.style.overflow = 'hidden';
      label.style.color = inactive ? '#475569' : pending ? demand ? '#047857' : '#be123c' : isIss ? '#b45309' : isInternal ? '#6d28d9' : demand ? '#047857' : '#be123c';
      label.style.textAlign = 'center';

      const nameText = document.createElement('span');
      nameText.textContent = name;
      nameText.style.fontSize = '9px';
      nameText.style.fontWeight = '800';
      nameText.style.display = 'block';
      nameText.style.overflow = 'hidden';
      nameText.style.textOverflow = 'ellipsis';
      nameText.style.whiteSpace = 'nowrap';
      label.appendChild(nameText);

      if (labelDetails.length > 0 && detailLines > 0) {
        const detailText = document.createElement('span');
        detailText.textContent = labelDetails.join(' · ');
        detailText.style.fontSize = '8px';
        detailText.style.fontWeight = '400';
        detailText.style.opacity = '0.82';
        detailText.style.display = 'block';
        detailText.style.lineHeight = '11px';
        detailText.style.maxHeight = `${detailLines * 11}px`;
        detailText.style.overflow = 'hidden';
        detailText.style.overflowWrap = 'anywhere';
        label.appendChild(detailText);
      }
      box.appendChild(label);
      fragment.appendChild(box);
    }

    const hasVisibleFibMarking = Object.values(fibVisibilityRef.current).some(Boolean)
      || Object.values(fibPreviousVisibilityRef.current).some(Boolean)
      || chochFibVisibilityRef.current.some(Boolean);
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
        const fibMovesByType = new Map<FibVisibilityKey, StructureZone[]>();
        for (const zone of zonesRef.current) {
          const type = fibVisibilityKey(zone);
          const isIssWaveFib = type === 'iss' && zone.name === 'ISS L3'
            && zone.issPoint0Time !== undefined;
          const isInternalChochFib = type === 'intChoch'
            && zone.category === 'internal'
            && zone.chochTime !== undefined;
          const retainHistoricalChochFib = type === 'choch'
            && chochFibVisibilityRef.current.some(Boolean);
          if (type === 'iss' && !isIssWaveFib) continue;
          if (type === 'intChoch' && !isInternalChochFib) continue;
          if (!zone.active && !showInvalidZonesRef.current
            && !isIssWaveFib && !retainHistoricalChochFib) continue;
          if (!zone.fibRelevant || !isFibMarkingVisible(
            zone,
            showFibRef.current,
            fibVisibilityRef.current,
            fibPreviousVisibilityRef.current,
            chochFibVisibilityRef.current,
          )) continue;
          if (zone.fibSourceTime === undefined || zone.fibSourcePrice === undefined
            || zone.fibZeroTime === undefined || zone.fibZeroPrice === undefined) continue;

          const typeMoves = fibMovesByType.get(type) ?? [];
          typeMoves.push(zone);
          fibMovesByType.set(type, typeMoves);
        }

        if (granularity !== 'D'
          && (fibVisibilityRef.current.swing || fibPreviousVisibilityRef.current.swing)) {
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

        if (fibVisibilityRef.current.day) {
          const dayZones = dayFibMovesRef.current.map<StructureZone>((move) => ({
            id: `day-fib-${move.sessionDate}`,
            name: move.direction === 'up' ? 'DEMAND' : 'SUPPLY',
            category: 'supplyDemand',
            isBuy: move.direction === 'up',
            startTime: move.sourceTime,
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
          fibMovesByType.set('day', dayZones);
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
          if (type === 'choch') {
            return orderedMoves.slice(0, 4).filter((_, index) => (
              chochFibVisibilityRef.current[index]
            ));
          }
          const previousMoves = type !== 'tjl1' && type !== 'tjl2'
            && type !== 'intTjl1' && type !== 'intTjl2'
            && type !== 'doubleChoch' && type !== 'iss'
            && fibPreviousVisibilityRef.current[type]
            ? orderedMoves.slice(1, 2)
            : [];
          return [
            ...(fibVisibilityRef.current[type] && orderedMoves[0] ? [orderedMoves[0]] : []),
            ...previousMoves,
          ];
        });

        const fibAnchorCoordinate = (anchorTime: number) => {
          const exactCoordinate = chart.timeScale().timeToCoordinate(anchorTime as UTCTimestamp);
          if (exactCoordinate !== null) return exactCoordinate;

          // Higher-timeframe candles can begin inside a lower-timeframe market
          // gap (for example, an H4 candle at 21:00 while the next M15 candle
          // starts at 22:00). Map that anchor forward to the first available
          // chart candle, but do not pull anchors in from outside loaded data.
          let low = 0;
          let high = displayCandles.length;
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (displayCandles[middle].time < anchorTime) low = middle + 1;
            else high = middle;
          }
          const fallbackCandle = displayCandles[low];
          if (!fallbackCandle || low === 0 && fallbackCandle.time > anchorTime) return null;
          return chart.timeScale().timeToCoordinate(fallbackCandle.time as UTCTimestamp);
        };

        for (const zone of latestFibMoves) {
          const sourceX = fibAnchorCoordinate(zone.fibSourceTime!);
          const zeroX = fibAnchorCoordinate(zone.fibZeroTime!);
          const sourceY = series.priceToCoordinate(zone.fibSourcePrice);
          const zeroY = series.priceToCoordinate(zone.fibZeroPrice);
          if (sourceX === null || zeroX === null || sourceY === null || zeroY === null) continue;

          const lineLeft = Math.min(sourceX, zeroX);
          const lineRight = Math.max(sourceX, zeroX);
          if (lineRight < 0 || lineLeft > rightEdge) continue;

          for (const level of INDICATOR_FIB_LEVELS) {
            const price = indicatorFibPrice(zone.fibZeroPrice, zone.fibSourcePrice, level.ratio);
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

      const occupiedStructureLabels: Array<{
        left: number;
        right: number;
        top: number;
        bottom: number;
      }> = [];
      for (const structureLine of structureLinesRef.current) {
        const isInternalLine = structureLine.type.startsWith('internal-');
        if (structureLine.type === 'iss' && !showIssRef.current) continue;
        if (isInternalLine && !showInternalRef.current) continue;
        if (structureLine.type !== 'iss' && !isInternalLine && !showStructureRef.current) continue;
        if (visibleTimeRange && (Math.max(structureLine.fromTime, structureLine.toTime)
          < Number(visibleTimeRange.from) || Math.min(structureLine.fromTime, structureLine.toTime)
          > Number(visibleTimeRange.to))) continue;
        const x1 = chart.timeScale().timeToCoordinate(structureLine.fromTime as UTCTimestamp);
        const x2 = chart.timeScale().timeToCoordinate(structureLine.toTime as UTCTimestamp);
        const y1 = series.priceToCoordinate(structureLine.fromPrice);
        const y2 = series.priceToCoordinate(structureLine.toPrice);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        if ((x1 < 0 && x2 < 0) || (x1 > rightEdge && x2 > rightEdge)
          || (y1 < 0 && y2 < 0) || (y1 > host.clientHeight && y2 > host.clientHeight)) continue;

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

        const structureLabel = structureLine.type === 'choch' || structureLine.type === 'internal-choch'
          ? repeatedLtfChochLabels.get(`${isInternalLine ? 'internal' : 'external'}:${structureLine.toTime}`)
            ?? structureLine.label
          : structureLine.label;
        if (structureLabel) {
          const labelX = (x1 + x2) / 2;
          const preferredLabelY = y1 - 5;
          const labelWidth = Math.max(28, structureLabel.length * 5);
          const labelHeight = 10;
          let labelY = preferredLabelY;
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const row = Math.ceil(attempt / 2);
            const offset = attempt === 0 ? 0 : row * 11 * (attempt % 2 === 1 ? -1 : 1);
            const candidateY = Math.max(labelHeight, Math.min(host.clientHeight - 2, preferredLabelY + offset));
            const candidateBounds = {
              left: labelX - labelWidth / 2,
              right: labelX + labelWidth / 2,
              top: candidateY - labelHeight,
              bottom: candidateY + 2,
            };
            const overlapsLabel = occupiedStructureLabels.some((bounds) => (
              candidateBounds.left < bounds.right + 3
              && candidateBounds.right > bounds.left - 3
              && candidateBounds.top < bounds.bottom + 2
              && candidateBounds.bottom > bounds.top - 2
            ));
            if (overlapsLabel) continue;
            labelY = candidateY;
            occupiedStructureLabels.push(candidateBounds);
            break;
          }
          const text = document.createElementNS(namespace, 'text');
          text.setAttribute('x', String(labelX));
          text.setAttribute('y', String(labelY));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('fill', color);
          text.setAttribute('fill-opacity', '0.55');
          text.setAttribute('font-size', '8');
          text.setAttribute('font-weight', '600');
          text.textContent = structureLabel;
          svg.appendChild(text);
        }
      }

      // ISS point labels are drawn at the real wick coordinate. Series markers
      // are deliberately not used here because they place a large circle away
      // from the candle and make it look like the point belongs elsewhere.
      if (showIssRef.current) {
        for (const marker of issMarkersRef.current) {
          if (visibleTimeRange && (Number(marker.time) < Number(visibleTimeRange.from)
            || Number(marker.time) > Number(visibleTimeRange.to))) continue;
          const candle = candleByTime.get(Number(marker.time));
          if (!candle) continue;
          const x = chart.timeScale().timeToCoordinate(marker.time as UTCTimestamp);
          const isHigh = marker.position === 'aboveBar';
          const markerPrice = typeof marker.pivotPrice === 'number'
            ? marker.pivotPrice
            : isHigh ? candle.high : candle.low;
          const y = series.priceToCoordinate(markerPrice);
          if (x === null || y === null) continue;
          if (x < 0 || x > rightEdge || y < -50 || y > host.clientHeight + 50) continue;
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
    if (showTradeLevelsRef.current) {
      for (const overlay of tradeOverlaysRef.current) {
        const { trade } = overlay;
        if (hasTradeDrawingExpired(trade)) continue;
        // A final exit keeps its drawing for five completed entry-timeframe candles.
        const completedReplayReference = isCompletedTrade(trade);
        const anchor = displayCandles.find((candle) => (
          trade.calculatedAt >= candle.time
          && trade.calculatedAt < marketCandleCloseTime(candle.time, granularity)
        )) ?? displayCandles.find((candle) => candle.time >= trade.calculatedAt);
        if (!anchor) continue;
        const rawLeft = chart.timeScale().timeToCoordinate(anchor.time as UTCTimestamp);
        const entryY = series.priceToCoordinate(trade.entry);
        const stopY = series.priceToCoordinate(trade.stopLoss);
        const targetY = series.priceToCoordinate(trade.takeProfit);
        if (rawLeft === null || entryY === null || stopY === null || targetY === null) continue;
        const left = Math.max(0, rawLeft);
        const resolutionTime = completedReplayReference ? trade.resolvedAt : undefined;
        const latestTradeCandle = resolutionTime === undefined
          ? displayCandles[displayCandles.length - 1]
          : displayCandles.find((candle) => (
            resolutionTime >= candle.time
            && resolutionTime < marketCandleCloseTime(candle.time, granularity)
          )) ?? displayCandles[displayCandles.length - 1];
        const latestCandleX = latestTradeCandle
          ? chart.timeScale().timeToCoordinate(latestTradeCandle.time as UTCTimestamp)
          : null;
        // An unresolved Long/Short drawing grows with every new candle. It no
        // longer stops at an arbitrary pixel width before TP or SL is reached.
        const drawingRight = latestCandleX === null
          ? rightEdge
          : Math.min(rightEdge, Math.max(left + 8, latestCandleX + 6));
        const width = drawingRight - left;
        if (width < 8 || left >= rightEdge) continue;
        const makeRange = (firstY: number, secondY: number, reward: boolean) => {
          const range = document.createElement('div');
          range.style.position = 'absolute';
          range.style.left = `${left}px`;
          range.style.top = `${Math.min(firstY, secondY)}px`;
          range.style.width = `${width}px`;
          range.style.height = `${Math.max(1, Math.abs(secondY - firstY))}px`;
          range.style.background = overlay.referenceOnly ? 'rgba(148, 163, 184, 0.08)'
            : reward ? 'rgba(16, 185, 129, 0.18)' : 'rgba(244, 63, 94, 0.16)';
          range.style.border = `1px ${overlay.referenceOnly ? 'dashed' : 'solid'} ${reward ? 'rgba(5, 150, 105, 0.34)' : 'rgba(225, 29, 72, 0.32)'}`;
          range.style.opacity = '1';
          return range;
        };
        fragment.appendChild(makeRange(entryY, targetY, true));
        fragment.appendChild(makeRange(entryY, stopY, false));

        const makeLevelLine = (
          y: number,
          color: string,
          label: string,
          dashed = false,
        ) => {
          const line = document.createElement('div');
          line.style.position = 'absolute';
          line.style.left = `${left}px`;
          line.style.top = `${y}px`;
          line.style.width = `${width}px`;
          line.style.borderTop = `1px ${dashed || overlay.referenceOnly ? 'dashed' : 'solid'} ${color}`;

          const levelLabel = document.createElement('span');
          levelLabel.style.position = 'absolute';
          levelLabel.style.right = '2px';
          levelLabel.style.top = '-11px';
          levelLabel.style.padding = '0 2px';
          levelLabel.style.background = 'rgba(255, 255, 255, 0.9)';
          levelLabel.style.color = color;
          levelLabel.style.fontSize = '8px';
          levelLabel.style.fontWeight = '900';
          levelLabel.style.lineHeight = '10px';
          levelLabel.style.whiteSpace = 'nowrap';
          levelLabel.textContent = label;
          line.appendChild(levelLabel);
          fragment.appendChild(line);
        };

        makeLevelLine(entryY, '#1e40af', `${overlay.id.startsWith('GOLD_SCALP:') || overlay.label?.includes('SCALP') ? 'SCALP ENTRY' : 'ENTRY'} ${formatPrice(trade.entry)}`);
        makeLevelLine(stopY, '#be123c', `${overlay.referenceOnly ? 'SL' : 'SL EXIT'} ${formatPrice(trade.stopLoss)}`);
        makeLevelLine(targetY, '#047857', `${overlay.referenceOnly ? 'TP' : 'TP EXIT'} ${formatPrice(trade.takeProfit)}`);
        const riskFreeY = trade.riskFreeEnabled === false
          ? null : series.priceToCoordinate(trade.riskFree);
        if (riskFreeY !== null) {
          makeLevelLine(riskFreeY, '#a16207', `1R / BE ${formatPrice(trade.riskFree)}`, true);
        }

        if (!(overlay.referenceOnly && overlay.label === 'OUTSIDE TRADING TIME · REFERENCE')) {
          const badge = document.createElement('div');
          badge.style.position = 'absolute';
          badge.style.left = `${left + width / 2}px`;
          badge.style.top = `${Math.max(entryY, stopY) - 13}px`;
          badge.style.transform = 'translateX(-50%)';
          badge.style.color = overlay.referenceOnly ? '#be123c' : '#0f172a';
          badge.style.fontSize = '8px';
          badge.style.fontWeight = '800';
          badge.style.lineHeight = '10px';
          badge.style.whiteSpace = 'nowrap';
          badge.textContent = overlay.label ?? `CHART · 1:${trade.rewardRisk}`;
          fragment.appendChild(badge);
        }
      }
    }

    // Swap the complete overlay in one operation so the browser does not
    // perform layout work for every individual zone, line, and label.
    layer.replaceChildren(fragment);
  }, [hasTradeDrawingExpired, comparisonTimeframe, directZoneTrades, displayCandles, extremeAPlusTjl2Selection, granularity, latestCandle?.time, ltfChochContext, marketConfig.pipSize, marketSymbol, mtfRows, mtfDrawingZones, oneMinuteScalpingZones, overlayCandlesByTime, repeatedLtfChochLabels, replayIndex, scalpingEnabled, visibleComparisonZones, zoneDrawingEndIndices, zoneTableRows]);

  redrawZonesRef.current = redrawZones;

  const scheduleOverlayRedraw = useCallback(() => {
    if (overlayRedrawFrameRef.current !== null) return;
    overlayRedrawFrameRef.current = window.requestAnimationFrame(() => {
      overlayRedrawFrameRef.current = null;
      redrawZonesRef.current();
    });
  }, []);

  const scheduleDrawingRedraw = useCallback(() => {
    if (!hasChartDrawingLayerRef.current
      || drawingRedrawFrameRef.current !== null
      || drawingRedrawTimerRef.current !== null) return;
    const elapsed = performance.now() - lastDrawingRedrawAtRef.current;
    const scheduleFrame = () => {
      drawingRedrawTimerRef.current = null;
      drawingRedrawFrameRef.current = window.requestAnimationFrame(() => {
        drawingRedrawFrameRef.current = null;
        lastDrawingRedrawAtRef.current = performance.now();
        setDrawingRenderVersion((version) => version + 1);
      });
    };
    const delay = Math.max(0, DRAWING_REDRAW_INTERVAL_MS - elapsed);
    if (delay > 0) drawingRedrawTimerRef.current = window.setTimeout(scheduleFrame, delay);
    else scheduleFrame();
  }, []);

  useEffect(() => {
    zonesRef.current = displayZones;
    visualZonesRef.current = consolidatedDisplayZones;
    swingFibMovesRef.current = swingFibMoves;
    dayFibMovesRef.current = dayFibMoves;
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
    chochFibVisibilityRef.current = chochFibVisibility;
    showInvalidZonesRef.current = showInvalidZones;
    showTradeLevelsRef.current = showTradeLevels;
    tradeOverlaysRef.current = [...visibleTradeOverlays, ...replayHistoryOverlays];
    scheduleOverlayRedraw();
  }, [chochFibVisibility, consolidatedDisplayZones, dayFibMoves, displayZones, fibPreviousVisibility, fibVisibility, redrawZones, replayHistoryOverlays, scheduleOverlayRedraw, showFib, showInternal, showInvalidZones, showIss, showMgZones, showStructure, showSupplyDemand, showTradeLevels, structure.internalMarkers, structure.issMarkers, structure.lines, structure.markers, swingFibMoves, visibleTradeOverlays]);

  useEffect(() => {
    const overlay = tradeOverlays[0];
    const pane = chartPaneRef.current;
    if (!overlay || !pane || capturedTradeSetupsRef.current.has(overlay.id)) return undefined;
    const storageKey = `${JOURNAL_SCREENSHOT_PREFIX}${overlay.id}`;
    try {
      if (window.localStorage.getItem(storageKey)) {
        capturedTradeSetupsRef.current.add(overlay.id);
        return undefined;
      }
    } catch {
      // Capture can still be attempted even when local storage is restricted.
    }
    capturedTradeSetupsRef.current.add(overlay.id);
    const timer = window.setTimeout(() => {
      const capture = async () => {
        const previousShowFib = showFibRef.current;
        const previousShowTradeLevels = showTradeLevelsRef.current;
        const previousFibVisibility = fibVisibilityRef.current;
        const previousFibPreviousVisibility = fibPreviousVisibilityRef.current;
        const previousChochFibVisibility = chochFibVisibilityRef.current;
        try {
          showFibRef.current = true;
          showTradeLevelsRef.current = true;
          fibVisibilityRef.current = Object.fromEntries(
            ALL_FIB_VISIBILITY_OPTIONS.map((option) => [option.key, true]),
          ) as Record<FibVisibilityKey, boolean>;
          fibPreviousVisibilityRef.current = DEFAULT_FIB_VISIBILITY;
          chochFibVisibilityRef.current = [true, true, true, true];
          redrawZonesRef.current();
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          const { toJpeg } = await import('html-to-image');
          const screenshot = await toJpeg(pane, {
            backgroundColor: '#ffffff',
            cacheBust: false,
            pixelRatio: 1,
            quality: 0.8,
            filter: (node) => !(
              node instanceof HTMLElement && node.dataset.journalExclude === 'true'
            ),
          });
          const resized = await resizeJournalScreenshot(screenshot);
          window.localStorage.setItem(storageKey, resized);
        } catch {
          capturedTradeSetupsRef.current.delete(overlay.id);
        } finally {
          showFibRef.current = previousShowFib;
          showTradeLevelsRef.current = previousShowTradeLevels;
          fibVisibilityRef.current = previousFibVisibility;
          fibPreviousVisibilityRef.current = previousFibPreviousVisibility;
          chochFibVisibilityRef.current = previousChochFibVisibility;
          redrawZonesRef.current();
        }
      };
      void capture();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [tradeOverlays]);

  useEffect(() => {
    if (granularity === 'D' && expandedFibOption === 'swing') {
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

  const prepareChartAnalysis = useCallback(async (
    nextCandles: OandaCandle[],
    auxiliary: Partial<Record<MarketGranularity, OandaCandle[]>>,
    nextReplayIndex: number | null,
  ) => {
    if (typeof Worker === 'undefined') return;
    const visibleCandles = nextReplayIndex === null ? nextCandles : nextCandles.slice(0, nextReplayIndex + 1);
    const last = visibleCandles[visibleCandles.length - 1];
    if (!last) return;
    const cutoff = last.time + (last.complete ? TIMEFRAME_SECONDS[granularity] : 0);
    const tasks: StructureAnalysisTask[] = vipSupportGranularities.map((timeframe) => ({
      key: `support:${timeframe}`,
      candles: (auxiliary[timeframe] ?? []).filter((candle) => (
        candle.complete && marketCandleCloseTime(candle.time, timeframe) <= cutoff
      )),
      options: {
        allowSupplyDemand: ['H1', 'H4', 'D', 'W', 'MO'].includes(timeframe),
        sourceBarSeconds: TIMEFRAME_SECONDS[timeframe],
        confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[timeframe],
        zoneVisualBars: 30,
      },
    }));
    tasks.push({
      key: 'chart', candles: visibleCandles,
      options: {
        allowSupplyDemand: ['H1', 'H4', 'D'].includes(granularity),
        sourceBarSeconds: TIMEFRAME_SECONDS[granularity],
        confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[granularity], zoneVisualBars: 30,
      },
      support: vipSupportGranularities.map((timeframe) => ({ key: `support:${timeframe}`, timeframe: GRANULARITY_LABELS[timeframe] })),
    });
    if (granularity !== 'D' && granularity !== 'H4') tasks.push({
      key: 'h4', candles: auxiliary.H4 ?? [],
      options: { allowSupplyDemand: true, sourceBarSeconds: TIMEFRAME_SECONDS.H4,
        confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS.H4, zoneVisualBars: 30 },
    });
    for (const timeframe of new Set([...TREND_TABLE_GRANULARITIES, ...AUTOMATION_GRANULARITIES])) {
      if (timeframe === granularity) continue;
      const available = auxiliary[timeframe] ?? [];
      tasks.push({ key: `table:${timeframe}`,
        candles: nextReplayIndex === null ? available : available.filter((candle) => candle.time <= cutoff),
        options: { allowSupplyDemand: ['H1', 'H4', 'D'].includes(timeframe),
          sourceBarSeconds: TIMEFRAME_SECONDS[timeframe],
          confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[timeframe], zoneVisualBars: 30 },
      });
    }
    try {
      let worker = analysisWorkerRef.current;
      if (!worker) {
        worker = new Worker(new URL('../services/structureAnalysis.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ id: number; updates?: PreparedStructureAnalysis[]; error?: string }>) => {
          const request = analysisRequestsRef.current.get(event.data.id);
          analysisRequestsRef.current.delete(event.data.id);
          if (event.data.error) request?.reject(new Error(event.data.error));
          else {
            const updates = event.data.updates ?? [];
            for (const prepared of updates) preparedAnalysesRef.current.set(prepared.key, prepared);
            request?.resolve(updates);
          }
        };
        worker.onerror = () => {
          for (const request of analysisRequestsRef.current.values()) request.reject(new Error('Background analysis failed'));
          analysisRequestsRef.current.clear();
          worker?.terminate();
          analysisWorkerRef.current = null;
        };
        analysisWorkerRef.current = worker;
      }
      const id = ++analysisRequestIdRef.current;
      await new Promise<PreparedStructureAnalysis[]>((resolve, reject) => {
        analysisRequestsRef.current.set(id, { resolve, reject });
        worker!.postMessage({ id, tasks });
      });
    } catch {
      // Keep the existing synchronous result as a fallback if Worker startup fails.
    }
  }, [granularity, vipSupportGranularities]);

  const loadCandles = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRequestIdRef.current;
      const replayTime = replayTimeRef.current;
      const shouldShowLoading = candlesRef.current.length === 0
        || loadedGranularityRef.current !== granularity
        || loadedDataSourceRef.current !== liveChartDataSource
        || loadedMarketSymbolRef.current !== marketSymbol;
      if (shouldShowLoading) setIsLoading(true);
      try {
        const requestCandles = async (requestedGranularity: MarketGranularity) => {
        const query = new URLSearchParams({
          symbol: marketSymbol,
          granularity: requestedGranularity,
          count: ['M1', 'M5', 'M15', 'M30'].includes(requestedGranularity) ? '5000' : '1500',
        });
        if (replayTime !== null) query.set('endTime', String(replayTime));
        const useMt5BrokerFeed = replayTime === null && liveChartDataSource === 'MT5'
          && marketConfig.mt5AutomationEnabled
          && MT5_CHART_GRANULARITIES.includes(requestedGranularity as OandaGranularity);
        let lastError = `Market feed returned no ${GRANULARITY_LABELS[requestedGranularity]} candles.`;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const requestUrl = useMt5BrokerFeed
            ? `/api/mt5/market-data?timeframe=${requestedGranularity}`
            : `/api/tradingview/market-data?${query}`;
          const response = await fetch(requestUrl, {
            signal,
            cache: 'no-store',
          });
           const payload = await response.json() as MarketDataResponse;
           if (!response.ok || !payload.ok || !Array.isArray(payload.candles)) {
             throw new Error(payload.error || `Market data request failed with HTTP ${response.status}`);
           }
          if (!useMt5BrokerFeed && payload.symbol !== marketSymbol) {
            throw new Error(`Market feed returned ${payload.symbol ?? 'unknown'} data while loading ${marketSymbol}.`);
          }
           if (payload.candles.length > 0) return payload;
          lastError = `Market feed returned no ${GRANULARITY_LABELS[requestedGranularity]} candles.`;
        }
        throw new Error(lastError);
      };
      // Prioritize the selected chart. Opening seven unofficial TradingView
      // sockets at once made the main timeframe wait behind slower auxiliary
      // requests even though those are only needed for VIP/trend context.
      const payload = await requestCandles(granularity);
      if (requestId !== loadRequestIdRef.current || signal?.aborted) return;
      if (payload.candles.length === 0) throw new Error(`The market feed returned no ${marketSymbol} candles.`);
      const nextReplayIndex = replayTime === null
        ? null
        : findReplayIndexAtOrBefore(payload.candles, replayTime);
      if (replayTime !== null && nextReplayIndex === null) {
        throw new Error(`The selected replay date is not available on ${GRANULARITY_LABELS[granularity]}.`);
      }
      await prepareChartAnalysis(payload.candles, vipCandlesRef.current, nextReplayIndex);
      if (requestId !== loadRequestIdRef.current || signal?.aborted) return;
      loadedGranularityRef.current = granularity;
      loadedDataSourceRef.current = liveChartDataSource;
      loadedMarketSymbolRef.current = marketSymbol;
      setCandles((current) => candleSnapshotsMatch(current, payload.candles)
        ? current
        : payload.candles);
      if (nextReplayIndex !== null) setReplayIndex(nextReplayIndex);
      setSource(payload.source || `MetaTrader 5 · broker ${marketSymbol}`);
      setLastUpdated(payload.fetchedAt || new Date().toISOString());
      setError(null);
      setIsLoading(false);

      // Keep the last valid auxiliary candles visible while their replacements
      // load. Clearing them here made confirmed engulfing signals and their
      // trade rows disappear briefly on every 15-second refresh.
      // Load mapped LTF feeds and the direct chart's engulfing fallback first,
      // then publish them before unrelated trend/support timeframes.
      const priorityGranularities = auxiliaryGranularities.filter((value) => (
        mtfLowerGranularities.includes(value as MtfGranularity)
        || (DIRECT_ENGULFING_FALLBACKS[granularity] ?? []).includes(value as OandaGranularity)
      ));
      const remainingGranularities = auxiliaryGranularities.filter((value) => (
        !priorityGranularities.includes(value)
      ));
      const loadAuxiliaryBatch = async (batch: MarketGranularity[]) => {
        if (batch.length === 0) return true;
        const batchPayloads = await Promise.allSettled(batch.map(requestCandles));
        if (requestId !== loadRequestIdRef.current || signal?.aborted) return false;
        const loadedEntries = batch.flatMap((supportGranularity, index) => {
          const result = batchPayloads[index];
          return result.status === 'fulfilled'
            ? [[supportGranularity, result.value.candles] as const]
            : [];
        });
        if (loadedEntries.length === 0) return true;
          const current = vipCandlesRef.current;
          let changed = false;
          const next = { ...current };
          for (const [supportGranularity, nextCandles] of loadedEntries) {
            if (candleSnapshotsMatch(current[supportGranularity] ?? [], nextCandles)) continue;
            next[supportGranularity] = nextCandles;
            changed = true;
          }
          if (changed) {
            await prepareChartAnalysis(payload.candles, next, nextReplayIndex);
            if (requestId !== loadRequestIdRef.current || signal?.aborted) return false;
            vipCandlesRef.current = next;
            setVipCandles(next);
          }
        return true;
      };
      if (!await loadAuxiliaryBatch(priorityGranularities)) return;
      await loadAuxiliaryBatch(remainingGranularities);
    } catch (loadError) {
      if ((loadError as Error).name !== 'AbortError') {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load market candles.');
        if (requestId === loadRequestIdRef.current && replayTime !== null) {
          pendingReplayViewportRef.current = null;
          setGranularity(loadedGranularityRef.current);
        }
      }
    } finally {
      if (shouldShowLoading && !signal?.aborted && requestId === loadRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [auxiliaryGranularities, granularity, liveChartDataSource, marketConfig.mt5AutomationEnabled, marketSymbol, mtfLowerGranularities, prepareChartAnalysis]);

  useEffect(() => {
    const controller = new AbortController();
    hasFittedRef.current = false;
    let timer: number | undefined;
    // Schedule after completion so slow feeds/analysis cannot build a backlog
    // of fetches, cloned candle snapshots, and worker messages.
    const refresh = async () => {
      try {
        if (!controller.signal.aborted) await loadCandles(controller.signal);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => {
          if (replayTimeRef.current === null) void refresh();
        }, 15_000);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      loadRequestIdRef.current += 1;
      window.clearTimeout(timer);
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
        vertLine: {
          color: '#94a3b8',
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: true,
          labelBackgroundColor: '#111111',
        },
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
        tickMarkFormatter: (time, tickMarkType) => formatChartTick(time, tickMarkType, 'Asia/Kathmandu'),
        rightOffset: 8,
        barSpacing: PRESENT_VIEW_BAR_SPACING,
        minBarSpacing: 1.5,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      localization: {
        timeFormatter: (time) => formatChartTime(time, 'Asia/Kathmandu'),
      },
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
        updateHeaderCandleRef.current();
        setHoveredEntry(null);
        return;
      }
      const timestamp = typeof parameter.time === 'number' ? parameter.time : 0;
      updateHeaderCandleRef.current(timestamp);
      const cursor = parameter.point;
      const entry = cursor && entryHoversRef.current.find((candidate) => {
        if (candidate.candleTime !== timestamp) return false;
        const wickY = candleSeries.priceToCoordinate(candidate.trade.signal.direction === 'bullish'
          ? candidate.low : candidate.high);
        if (wickY === null) return false;
        return candidate.trade.signal.direction === 'bullish'
          ? cursor.y >= wickY - 5 && cursor.y <= wickY + 62
          : cursor.y <= wickY + 5 && cursor.y >= wickY - 62;
      });
      if (!entry) {
        setHoveredEntry(null);
        return;
      }
      setHoveredEntry((current) => current?.entry.id === entry.id
        && Math.abs(current.x - cursor.x) < 3 && Math.abs(current.y - cursor.y) < 3
        ? current : { entry, x: cursor.x, y: cursor.y });
    });

    const observer = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
      scheduleOverlayRedraw();
      scheduleDrawingRedraw();
      window.requestAnimationFrame(() => syncReplaySelectionLineRef.current());
    });
    const handleVisibleRangeChange = () => {
      scheduleOverlayRedraw();
      scheduleDrawingRedraw();
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
      if (drawingRedrawFrameRef.current !== null) {
        window.cancelAnimationFrame(drawingRedrawFrameRef.current);
        drawingRedrawFrameRef.current = null;
      }
      if (drawingRedrawTimerRef.current !== null) {
        window.clearTimeout(drawingRedrawTimerRef.current);
        drawingRedrawTimerRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
    };
  }, [scheduleDrawingRedraw, scheduleOverlayRedraw]);

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({
      priceFormat: {
        type: 'price',
        precision: marketConfig.pricePrecision,
        minMove: marketConfig.minMove,
      },
    });
  }, [marketConfig.minMove, marketConfig.pricePrecision]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      localization: {
        timeFormatter: (time: Time) => formatChartTime(time, chartTimeZone),
      },
      timeScale: {
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => (
          formatChartTick(time, tickMarkType, chartTimeZone)
        ),
      },
    });
  }, [chartTimeZone]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncReplaySelectionLine);
    return () => window.cancelAnimationFrame(frame);
  }, [candles, replaySelecting, replaySelectionIndex, syncReplaySelectionLine]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;
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
      ...(showEntryArrows ? entryMarkers : []),
    ].sort((a: any, b: any) => Number(a.time) - Number(b.time)));
    if (displayCandles.length === 0) {
      scheduleOverlayRedraw();
      scheduleDrawingRedraw();
      return;
    }
    if (pendingMarketSymbolFitRef.current) {
      // A price scale can remain fixed to the previous instrument (for example,
      // USDJPY near 158 while XAUUSD is near 4,165). Re-enable autoscaling only
      // for the first populated render after a symbol switch.
      chart.priceScale('right').applyOptions({ autoScale: true });
    }
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
    pendingMarketSymbolFitRef.current = false;
    scheduleOverlayRedraw();
    scheduleDrawingRedraw();
  }, [displayCandles, entryMarkers, granularity, replayIndex, restorePresentChartView, scheduleDrawingRedraw, scheduleOverlayRedraw, showEntryArrows, showInternal, showIss, showStructure, structure.internalMarkers, structure.issMarkers, structure.markers]);

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
    // The selected HTF candle can be much older than the rolling 1,500-bar
    // LTF window already in memory. Reload at the replay timestamp immediately
    // so mapped 1m/5m CHOCH data is available without a timeframe switch.
    setRefreshKey((value) => value + 1);
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
    if (comparisonTimeframe === nextGranularity) {
      setComparisonTimeframe(null);
      setShowLtfChoch(false);
    } else if (showLtfChoch && (!comparisonTimeframe
      || DRAWING_TIMEFRAME_ORDER.indexOf(comparisonTimeframe)
        >= DRAWING_TIMEFRAME_ORDER.indexOf(nextGranularity))) {
      setShowLtfChoch(false);
    }
  };

  const changeLiveChartDataSource = (nextSource: LiveChartDataSource) => {
    if (replayIndex !== null || nextSource === liveChartDataSource
      || (nextSource === 'MT5' && !marketConfig.mt5AutomationEnabled)) return;
    setLiveChartDataSource(nextSource);
    setCandles([]);
    setVipCandles({});
    setTrackedDirectTradeSetups(new Map<string, TrackedDirectTradeSetup>());
    setSource(nextSource === 'MT5'
      ? 'Waiting for MT5 broker candles'
      : 'Loading TradingView OANDA candles');
    setLastUpdated(null);
    setError(null);
    setIsLoading(true);
    hasFittedRef.current = false;
  };

  const changeMarketSymbol = (nextSymbol: OandaMarketSymbol) => {
    if (nextSymbol === marketSymbol) return;
    setVisibleAccuracyRecordIds(null);
    // Invalidate every request started for the previous symbol immediately.
    // Waiting for the next render left a short window where an older forex
    // response could repopulate the chart after Gold had been selected.
    loadRequestIdRef.current += 1;
    pendingMarketSymbolFitRef.current = true;
    replayTimeRef.current = null;
    pendingReplayViewportRef.current = null;
    setReplayIndex(null);
    setReplayPlaying(false);
    setReplaySelecting(false);
    setReplaySelectionIndex(null);
    setMarketSymbol(nextSymbol);
    setLiveChartDataSource('OANDA');
    setCandles([]);
    setVipCandles({});
    // Entries are already isolated by tradeTrackingScope. Keep Gold's tracked
    // first-entry history intact so visiting a currency pair cannot cause Gold
    // to recalculate a later Internal DB (or any other zone) entry on return.
    setSource(`Loading TradingView OANDA:${nextSymbol} candles`);
    setLastUpdated(null);
    setError(null);
    setIsLoading(true);
    hasFittedRef.current = false;
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

  const chartDrawingPointFromClient = (clientX: number, clientY: number): ChartDrawingPoint | null => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const host = hostRef.current;
    if (!chart || !series || !host || displayCandles.length === 0) return null;
    const bounds = host.getBoundingClientRect();
    const logical = chart.timeScale().coordinateToLogical(clientX - bounds.left);
    const price = series.coordinateToPrice(clientY - bounds.top);
    if (logical === null || price === null || !Number.isFinite(logical) || !Number.isFinite(price)) return null;
    const nearestIndex = Math.round(logical);
    let time: number;
    if (nearestIndex >= 0 && nearestIndex < displayCandles.length) {
      time = displayCandles[nearestIndex].time;
    } else if (nearestIndex < 0) {
      time = displayCandles[0].time + nearestIndex * TIMEFRAME_SECONDS[granularity];
    } else {
      const lastIndex = displayCandles.length - 1;
      time = displayCandles[lastIndex].time
        + (nearestIndex - lastIndex) * TIMEFRAME_SECONDS[granularity];
    }
    return { time, price };
  };

  const saveChartDrawing = (
    tool: ChartDrawingTool,
    points: ChartDrawingPoint[],
    text?: string,
  ) => {
    if (points.length === 0) return null;
    const drawingId = `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setChartDrawings((current) => [...current, {
      id: drawingId,
      scope: drawingScope,
      tool,
      points,
      text,
      color: '#2563eb',
      visibilityTimeframe: granularity,
      visibility: 'all',
      hidden: false,
    }]);
    setDrawingDraft(null);
    setActiveDrawingTool(null);
    return drawingId;
  };

  const handleDrawingChartClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!activeDrawingTool) return;
    const point = chartDrawingPointFromClient(event.clientX, event.clientY);
    if (!point) return;

    if (activeDrawingTool === 'path') {
      if (!drawingDraft || drawingDraft.tool !== 'path') {
        setDrawingDraft({ tool: 'path', points: [point], hover: point });
        return;
      }
      const nextPoints = [...drawingDraft.points, point].filter((candidate, index, points) => (
        index === 0 || candidate.time !== points[index - 1].time
        || Math.abs(candidate.price - points[index - 1].price) > 0.0001
      ));
      if (event.detail >= 2 && nextPoints.length >= 2) saveChartDrawing('path', nextPoints);
      else setDrawingDraft({ tool: 'path', points: nextPoints, hover: point });
      return;
    }

    if (!drawingDraft || drawingDraft.tool !== activeDrawingTool) {
      setDrawingDraft({ tool: activeDrawingTool, points: [point], hover: point });
      return;
    }
    const secondPoint = activeDrawingTool === 'trend' && event.shiftKey
      ? { ...point, price: drawingDraft.points[0].price }
      : point;
    const drawingId = saveChartDrawing(activeDrawingTool, [drawingDraft.points[0], secondPoint]);
    if (activeDrawingTool === 'note' && drawingId) {
      setSelectedDrawingId(drawingId);
      setDrawingTextEditor({ drawingId, value: '' });
    }
  };

  const finishDrawingPath = () => {
    if (drawingDraft?.tool === 'path' && drawingDraft.points.length >= 2) {
      saveChartDrawing('path', drawingDraft.points);
    } else {
      setDrawingDraft(null);
      setActiveDrawingTool(null);
    }
  };

  const undoLastChartDrawing = () => {
    setChartDrawings((current) => {
      const lastIndex = current.map((drawing) => drawing.scope).lastIndexOf(drawingScope);
      return lastIndex < 0 ? current : current.filter((_, index) => index !== lastIndex);
    });
  };

  const clearCurrentChartDrawings = () => {
    if (!chartDrawings.some((drawing) => drawing.scope === drawingScope)) return;
    if (!window.confirm(`Remove all drawings from the ${liveChartDataSource} charts?`)) return;
    setChartDrawings((current) => current.filter((drawing) => drawing.scope !== drawingScope));
    setDrawingDraft(null);
    setActiveDrawingTool(null);
    setSelectedDrawingId(null);
    setShowDrawingVisibility(false);
  };

  const updateChartDrawing = (drawingId: string, updates: Partial<ChartDrawing>) => {
    setChartDrawings((current) => current.map((drawing) => (
      drawing.id === drawingId ? { ...drawing, ...updates } : drawing
    )));
  };

  const removeChartDrawing = (drawingId: string) => {
    setChartDrawings((current) => current.filter((drawing) => drawing.id !== drawingId));
    setSelectedDrawingId(null);
    setShowDrawingVisibility(false);
    setDrawingDrag(null);
  };

  const chartDrawingIsVisible = (drawing: ChartDrawing) => {
    if (drawing.hidden) return false;
    const mode = drawing.visibility ?? 'all';
    if (mode === 'all') return true;
    const origin = drawing.visibilityTimeframe ?? granularity;
    const originIndex = DRAWING_TIMEFRAME_ORDER.indexOf(origin);
    const currentIndex = DRAWING_TIMEFRAME_ORDER.indexOf(granularity);
    if (mode === 'current-only') return currentIndex === originIndex;
    if (mode === 'current-and-above') return currentIndex >= originIndex;
    return currentIndex <= originIndex;
  };

  const chartDrawingPointToCoordinate = (point: ChartDrawingPoint): { x: number; y: number } | null => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || displayCandles.length === 0) return null;
    let logical: number;
    let low = 0;
    let high = displayCandles.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (displayCandles[middle].time < point.time) low = middle + 1;
      else high = middle;
    }
    if (low < displayCandles.length && displayCandles[low].time === point.time) {
      logical = low;
    } else if (low === 0) {
      logical = (point.time - displayCandles[0].time) / TIMEFRAME_SECONDS[granularity];
    } else if (low < displayCandles.length) {
      const previous = displayCandles[low - 1];
      const next = displayCandles[low];
      const interval = Math.max(1, next.time - previous.time);
      logical = low - 1 + (point.time - previous.time) / interval;
    } else {
      const lastIndex = displayCandles.length - 1;
      logical = lastIndex
        + (point.time - displayCandles[lastIndex].time) / TIMEFRAME_SECONDS[granularity];
    }
    const x = chart.timeScale().logicalToCoordinate(logical);
    const y = series.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x, y };
  };

  // Reading this state ensures SVG drawings are recalculated after chart pan,
  // zoom, resize, or candle replacement even though their data has not changed.
  void drawingRenderVersion;
  const currentSourceChartDrawings = chartDrawings.filter((drawing) => drawing.scope === drawingScope);
  const visibleChartDrawings = currentSourceChartDrawings.filter(chartDrawingIsVisible);
  const hiddenChartDrawings = currentSourceChartDrawings.filter((drawing) => drawing.hidden);
  const selectedChartDrawing = currentSourceChartDrawings.find((drawing) => (
    drawing.id === selectedDrawingId
  ));
  const previewChartDrawing = drawingDraft && drawingDraft.points.length > 0
    ? {
      id: 'drawing-preview',
      scope: drawingScope,
      tool: drawingDraft.tool,
      points: drawingDraft.hover
        ? [...drawingDraft.points, drawingDraft.hover]
        : drawingDraft.points,
    } satisfies ChartDrawing
    : null;
  const textEditorDrawing = drawingTextEditor
    ? currentSourceChartDrawings.find((drawing) => drawing.id === drawingTextEditor.drawingId)
    : undefined;
  const textEditorCoordinates = textEditorDrawing?.points.length
    ? textEditorDrawing.points.map(chartDrawingPointToCoordinate)
    : [];
  const drawingTextEditorPosition = textEditorCoordinates.length >= 1
    && textEditorCoordinates[0]
    ? (() => {
      const firstCoordinate = textEditorCoordinates[0];
      const lastCoordinate = textEditorCoordinates[textEditorCoordinates.length - 1] ?? firstCoordinate;
      let angle = textEditorDrawing?.tool === 'trend'
        ? Math.atan2(lastCoordinate.y - firstCoordinate.y, lastCoordinate.x - firstCoordinate.x) * 180 / Math.PI
        : 0;
      if (angle > 90 || angle < -90) angle += 180;
      return {
        left: (firstCoordinate.x + lastCoordinate.x) / 2,
        top: (firstCoordinate.y + lastCoordinate.y) / 2,
        angle,
      };
    })()
    : null;

  const startChartDrawingDrag = (
    event: React.MouseEvent<SVGElement>,
    drawing: ChartDrawing,
    pointIndex?: number,
    rectangleCorner?: ChartDrawingDrag['rectangleCorner'],
  ) => {
    if (previewChartDrawing) return;
    event.preventDefault();
    event.stopPropagation();
    const start = chartDrawingPointFromClient(event.clientX, event.clientY);
    if (!start) return;
    setSelectedDrawingId(drawing.id);
    setShowDrawingVisibility(false);
    setDrawingDrag({
      drawingId: drawing.id,
      pointIndex,
      rectangleCorner,
      start,
      originalPoints: drawing.points.map((point) => ({ ...point })),
    });
  };

  const moveSelectedChartDrawing = (clientX: number, clientY: number, shiftKey = false) => {
    if (!drawingDrag) return;
    const currentPoint = chartDrawingPointFromClient(clientX, clientY);
    if (!currentPoint) return;
    let points: ChartDrawingPoint[];
    if (drawingDrag.rectangleCorner !== undefined) {
      const { timePointIndex, pricePointIndex } = drawingDrag.rectangleCorner;
      points = drawingDrag.originalPoints.map((point, index) => ({
        time: index === timePointIndex ? currentPoint.time : point.time,
        price: index === pricePointIndex ? currentPoint.price : point.price,
      }));
    } else if (drawingDrag.pointIndex !== undefined) {
      const draggedDrawing = chartDrawings.find((drawing) => drawing.id === drawingDrag.drawingId);
      const oppositePoint = drawingDrag.originalPoints[drawingDrag.pointIndex === 0 ? 1 : 0];
      const draggedPoint = shiftKey && draggedDrawing?.tool === 'trend' && oppositePoint
        ? { ...currentPoint, price: oppositePoint.price }
        : currentPoint;
      points = drawingDrag.originalPoints.map((point, index) => (
        index === drawingDrag.pointIndex ? draggedPoint : point
      ));
    } else {
      const timeDelta = currentPoint.time - drawingDrag.start.time;
      const priceDelta = currentPoint.price - drawingDrag.start.price;
      points = drawingDrag.originalPoints.map((point) => ({
        time: point.time + timeDelta,
        price: point.price + priceDelta,
      }));
    }
    updateChartDrawing(drawingDrag.drawingId, { points });
  };

  useEffect(() => {
    if (!drawingDrag) return undefined;
    const moveDrawing = (event: MouseEvent) => (
      moveSelectedChartDrawing(event.clientX, event.clientY, event.shiftKey)
    );
    const finishMoving = () => setDrawingDrag(null);
    window.addEventListener('mousemove', moveDrawing);
    window.addEventListener('mouseup', finishMoving);
    return () => {
      window.removeEventListener('mousemove', moveDrawing);
      window.removeEventListener('mouseup', finishMoving);
    };
  }, [drawingDrag, chartDrawings]);

  const editChartDrawingText = (drawing: ChartDrawing) => {
    if (drawing.tool !== 'rectangle' && drawing.tool !== 'trend' && drawing.tool !== 'note') return;
    setSelectedDrawingId(drawing.id);
    setDrawingTextEditor({ drawingId: drawing.id, value: drawing.text ?? '' });
  };

  const saveChartDrawingText = () => {
    if (!drawingTextEditor) return;
    updateChartDrawing(drawingTextEditor.drawingId, {
      text: drawingTextEditor.value.trim().slice(0, 80),
    });
    setDrawingTextEditor(null);
  };

  useEffect(() => {
    const deleteSelectedDrawing = (event: KeyboardEvent) => {
      if (!selectedDrawingId || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      removeChartDrawing(selectedDrawingId);
    };
    window.addEventListener('keydown', deleteSelectedDrawing);
    return () => window.removeEventListener('keydown', deleteSelectedDrawing);
  }, [selectedDrawingId]);

  const renderChartDrawing = (drawing: ChartDrawing, preview = false) => {
    const points = drawing.points
      .map(chartDrawingPointToCoordinate)
      .filter((point): point is { x: number; y: number } => point !== null);
    if (points.length === 0) return null;
    const selected = !preview && drawing.id === selectedDrawingId;
    const drawingColor = drawing.color ?? '#2563eb';
    const stroke = preview ? '#7c3aed' : drawingColor;
    const opacity = preview ? 0.65 : 0.9;
    const wrapDrawing = (content: React.ReactNode) => (
      <g
        key={drawing.id}
        opacity={opacity}
        pointerEvents={preview ? 'none' : 'visiblePainted'}
        onMouseDown={preview ? undefined : (event) => startChartDrawingDrag(event, drawing)}
        onDoubleClick={preview ? undefined : (event) => {
          event.preventDefault();
          event.stopPropagation();
          editChartDrawingText(drawing);
        }}
        style={preview ? undefined : { cursor: 'move' }}
      >
        {content}
        {selected && (drawing.tool === 'rectangle' && drawing.points.length >= 2
          ? ([
            { timePointIndex: 0, pricePointIndex: 0 },
            { timePointIndex: 0, pricePointIndex: 1 },
            { timePointIndex: 1, pricePointIndex: 0 },
            { timePointIndex: 1, pricePointIndex: 1 },
          ] as const).map((corner) => {
            const point = {
              time: drawing.points[corner.timePointIndex].time,
              price: drawing.points[corner.pricePointIndex].price,
            };
            const coordinate = chartDrawingPointToCoordinate(point);
            if (!coordinate) return null;
            return (
              <circle
                key={`${drawing.id}-corner-${corner.timePointIndex}-${corner.pricePointIndex}`}
                cx={coordinate.x}
                cy={coordinate.y}
                r="4"
                fill="white"
                stroke="#7c3aed"
                strokeWidth="1.5"
                pointerEvents="all"
                onMouseDown={(event) => startChartDrawingDrag(event, drawing, undefined, corner)}
                style={{ cursor: 'nwse-resize' }}
              />
            );
          })
          : drawing.points.map((point, index) => {
          const coordinate = chartDrawingPointToCoordinate(point);
          if (!coordinate) return null;
          return (
            <circle
              key={`${drawing.id}-handle-${index}`}
              cx={coordinate.x}
              cy={coordinate.y}
              r="4"
              fill="white"
              stroke="#7c3aed"
              strokeWidth="1.5"
              pointerEvents="all"
              onMouseDown={(event) => startChartDrawingDrag(event, drawing, index)}
              style={{ cursor: 'grab' }}
            />
          );
        }))}
      </g>
    );

    if (drawing.tool === 'note') {
      const anchor = points[0];
      const labelPoint = points.length > 1 ? points[points.length - 1] : { x: anchor.x + 40, y: anchor.y - 30 };
      const label = drawing.text || 'Add text';
      const width = Math.min(220, Math.max(64, label.length * 5.4 + 18));
      return wrapDrawing(
        <>
          <line x1={anchor.x} y1={anchor.y} x2={labelPoint.x} y2={labelPoint.y} stroke={stroke} strokeWidth="1" />
          <circle cx={anchor.x} cy={anchor.y} r="3" fill="white" stroke={stroke} strokeWidth="1.2" />
          <rect x={labelPoint.x - width / 2} y={labelPoint.y - 10} width={width} height="20" rx="3" fill="white" stroke={stroke} />
          {drawingTextEditor?.drawingId !== drawing.id && (
            <text x={labelPoint.x} y={labelPoint.y + 3} textAnchor="middle" fill={stroke} fontSize="9" fontWeight="700">
              {label.length > 38 ? `${label.slice(0, 38)}…` : label}
            </text>
          )}
        </>
      );
    }

    if (drawing.tool === 'path') {
      return wrapDrawing(
        <>
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="transparent"
            strokeWidth="10"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      );
    }

    if (points.length < 2) {
      return wrapDrawing(<circle cx={points[0].x} cy={points[0].y} r="3" fill={stroke} />);
    }
    const [first, second] = points;

    if (drawing.tool === 'rectangle') {
      const left = Math.min(first.x, second.x);
      const top = Math.min(first.y, second.y);
      const width = Math.abs(second.x - first.x);
      return wrapDrawing(
        <>
          <rect
            x={left}
            y={top}
            width={width}
            height={Math.abs(second.y - first.y)}
            fill={`${drawingColor}1a`}
            stroke={stroke}
            strokeWidth="1"
          />
          {drawing.text && drawingTextEditor?.drawingId !== drawing.id && (
            <text
              x={left + width / 2}
              y={top + 14}
              textAnchor="middle"
              fill={drawingColor}
              fontSize="9"
              fontWeight="700"
              pointerEvents="none"
            >
              {drawing.text}
            </text>
          )}
        </>
      );
    }

    if (drawing.tool === 'fib') {
      const sourcePrice = drawing.points[0].price;
      const zeroPrice = drawing.points[drawing.points.length - 1].price;
      const left = Math.min(first.x, second.x);
      const right = Math.max(first.x, second.x);
      return wrapDrawing(
        <>
          <rect
            x={left}
            y={Math.min(first.y, second.y)}
            width={Math.max(8, right - left)}
            height={Math.max(8, Math.abs(second.y - first.y))}
            fill="transparent"
          />
          <line
            x1={first.x}
            y1={first.y}
            x2={second.x}
            y2={second.y}
            stroke={selected ? stroke : '#f43f5e'}
            strokeWidth="1.2"
            strokeOpacity="0.82"
            strokeDasharray="7 6"
          />
          {INDICATOR_FIB_LEVELS.map((level) => {
            const price = indicatorFibPrice(zeroPrice, sourcePrice, level.ratio);
            const coordinate = candleSeriesRef.current?.priceToCoordinate(price);
            if (coordinate === null || coordinate === undefined) return null;
            return (
              <g key={level.ratio}>
                <line
                  x1={left}
                  y1={coordinate}
                  x2={right}
                  y2={coordinate}
                  stroke={selected ? stroke : '#e11d48'}
                  strokeWidth={level.ratio === 0 || level.ratio === 1 ? '1.2' : '1'}
                  strokeOpacity="0.82"
                />
                <text
                  x={Math.max(18, left - 7)}
                  y={coordinate + 3}
                  textAnchor="end"
                  fill={selected ? stroke : '#e11d48'}
                  fillOpacity="0.9"
                  fontSize="9"
                  fontWeight="700"
                >
                  {level.label}
                </text>
              </g>
            );
          })}
        </>
      );
    }

    if (drawing.tool === 'measure') {
      const priceChange = drawing.points[1].price - drawing.points[0].price;
      const percentChange = drawing.points[0].price === 0 ? 0 : priceChange / drawing.points[0].price * 100;
      const elapsedSeconds = Math.abs(drawing.points[1].time - drawing.points[0].time);
      const elapsedDays = Math.floor(elapsedSeconds / 86_400);
      const elapsedHours = Math.floor(elapsedSeconds % 86_400 / 3_600);
      const elapsedMinutes = Math.floor(elapsedSeconds % 3_600 / 60);
      const elapsedParts = [
        elapsedDays ? `${elapsedDays}d` : '',
        elapsedHours ? `${elapsedHours}h` : '',
        elapsedMinutes || (!elapsedDays && !elapsedHours) ? `${elapsedMinutes}m` : '',
      ].filter(Boolean).join(' ');
      const firstTime = Math.min(drawing.points[0].time, drawing.points[1].time);
      const lastTime = Math.max(drawing.points[0].time, drawing.points[1].time);
      const measuredCandles = displayCandles.filter((candle) => (
        candle.time > firstTime && candle.time <= lastTime
      ));
      const bars = measuredCandles.length;
      const totalVolume = measuredCandles.reduce((sum, candle) => sum + candle.volume, 0);
      const volumeLabel = totalVolume >= 1_000_000
        ? `${(totalVolume / 1_000_000).toFixed(2)} M`
        : totalVolume >= 1_000
          ? `${(totalVolume / 1_000).toFixed(2)} K`
          : totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 });
      const left = Math.min(first.x, second.x);
      const top = Math.min(first.y, second.y);
      const width = Math.abs(second.x - first.x);
      const height = Math.abs(second.y - first.y);
      const centerX = left + width / 2;
      const measureColor = priceChange >= 0 ? '#22ab94' : '#f7525f';
      const chartHeight = chartPaneRef.current?.clientHeight ?? 0;
      const cardWidth = 180;
      const cardHeight = 58;
      const cardTop = top + height + cardHeight + 12 < chartHeight
        ? top + height + 12
        : Math.max(4, top - cardHeight - 12);
      const signedPrice = `${priceChange >= 0 ? '+' : ''}${formatPrice(priceChange)}`;
      const signedPercent = `${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(2)}%`;
      const pips = priceChange / marketConfig.pipSize;
      const signedPips = `${pips >= 0 ? '+' : ''}${pips.toFixed(1)}`;
      return wrapDrawing(
        <>
          <defs>
            <marker
              id={`measure-arrow-${drawing.id}`}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L7,3.5 L0,7 Z" fill={measureColor} />
            </marker>
          </defs>
          <rect
            x={left}
            y={top}
            width={width}
            height={height}
            fill={measureColor}
            fillOpacity="0.16"
            stroke={measureColor}
            strokeOpacity="0.65"
            strokeWidth="1"
          />
          {width > 2 && (
            <line
              x1={first.x}
              y1={top + height / 2}
              x2={second.x}
              y2={top + height / 2}
              stroke={measureColor}
              strokeWidth="1"
              strokeOpacity="0.8"
              markerEnd={`url(#measure-arrow-${drawing.id})`}
            />
          )}
          {height > 2 && (
            <line
              x1={centerX}
              y1={first.y}
              x2={centerX}
              y2={second.y}
              stroke={measureColor}
              strokeWidth="1"
              strokeOpacity="0.8"
              markerEnd={`url(#measure-arrow-${drawing.id})`}
            />
          )}
          <rect
            x={centerX - cardWidth / 2}
            y={cardTop}
            width={cardWidth}
            height={cardHeight}
            rx="4"
            fill={measureColor}
          />
          <text x={centerX} y={cardTop + 16} textAnchor="middle" fill="white" fontSize="9" fontWeight="700">
            {signedPrice} ({signedPercent}) {signedPips} pips
          </text>
          <text x={centerX} y={cardTop + 33} textAnchor="middle" fill="white" fontSize="9" fontWeight="700">
            {bars > 0 ? `${bars} bars, ` : ''}{elapsedParts}
          </text>
          <text x={centerX} y={cardTop + 50} textAnchor="middle" fill="white" fontSize="9" fontWeight="700">
            Vol {volumeLabel}
          </text>
        </>
      );
    }

    return wrapDrawing(
      <>
        <line
          x1={first.x}
          y1={first.y}
          x2={second.x}
          y2={second.y}
          stroke="transparent"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <line
          x1={first.x}
          y1={first.y}
          x2={second.x}
          y2={second.y}
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {drawing.text && drawingTextEditor?.drawingId !== drawing.id && (() => {
          const centerX = (first.x + second.x) / 2;
          const centerY = (first.y + second.y) / 2;
          let angle = Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI;
          if (angle > 90 || angle < -90) angle += 180;
          return (
            <text
              x={centerX}
              y={centerY - 3}
              textAnchor="middle"
              fill={drawingColor}
              stroke="white"
              strokeWidth="2.5"
              paintOrder="stroke"
              transform={`rotate(${angle} ${centerX} ${centerY})`}
              fontSize="9"
              fontWeight="700"
              pointerEvents="none"
            >
              {drawing.text}
            </text>
          );
        })()}
      </>
    );
  };

  const renderFibOptionButton = (option: { key: FibVisibilityKey; label: string }) => {
    const isSingleMarking = isSingleFibMarkingKey(option.key);
    const isChochMarking = option.key === 'choch';
    const isUnavailable = (option.key === 'swing' && granularity === 'D')
      || (option.key === 'day' && !['M1', 'M5', 'M15', 'M30'].includes(granularity));
    const latestOn = fibVisibility[option.key];
    const previousOn = fibPreviousVisibility[option.key];
    const chochVisibleCount = chochFibVisibility.filter(Boolean).length;
    const status = isUnavailable
      ? option.key === 'day' ? '≤30m' : '≤4H'
      : isChochMarking
        ? `${chochVisibleCount}/4`
      : isSingleMarking
      ? latestOn ? 'ON' : 'OFF'
      : latestOn && previousOn
        ? 'BOTH'
        : latestOn ? 'LATEST' : previousOn ? 'PREV' : 'OFF';
    const active = !isUnavailable && (isChochMarking
      ? chochVisibleCount > 0
      : latestOn || (!isSingleMarking && previousOn));
    return (
      <button
        key={option.key}
        type="button"
        disabled={isUnavailable}
        onClick={() => {
          if (isChochMarking) {
            setExpandedFibOption((current) => current === option.key ? null : option.key);
            return;
          }
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
          ? option.key === 'day'
            ? 'Day FIB is available on the 1m, 5m, 15m, and 30m charts'
            : 'Show the 4H Swing FIB drawing on charts from 1m through 4H'
          : isChochMarking
            ? 'Choose each of the latest four CHoCH FIB drawings separately'
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
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-2.5 py-1 xl:flex-nowrap">
          <div className="flex items-center gap-1 pr-1.5 border-r border-slate-200">
            <div className="grid h-5 w-5 place-items-center rounded-full bg-amber-100 text-[6px] font-black text-amber-700">
              {marketSymbol === 'XAUUSD' ? 'Au' : 'FX'}
            </div>
            <div>
              <select
                value={marketSymbol}
                onChange={(event) => changeMarketSymbol(event.target.value as OandaMarketSymbol)}
                className="max-w-40 cursor-pointer border-0 bg-transparent p-0 text-[9px] font-black leading-none text-slate-900 outline-none"
                aria-label="OANDA market symbol"
              >
                {OANDA_MARKET_SYMBOLS.map((symbol) => (
                  <option key={symbol} value={symbol}>{oandaMarketSymbolConfig(symbol).displayName}</option>
                ))}
              </select>
              <div className="mt-0.5 text-[6px] font-bold leading-none tracking-wider text-slate-500">
                {marketConfig.shortName} · {replayIndex !== null ? 'OANDA REPLAY' : liveChartDataSource}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {TIMEFRAMES.map((timeframe) => (
              <button
                key={timeframe.value}
                onClick={() => changeTimeframe(timeframe.value)}
                className={`rounded-full border px-2 py-0.5 text-[9px] font-black transition ${
                  granularity === timeframe.value
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                {timeframe.label}
              </button>
            ))}
          </div>

          <div
            className="flex items-center gap-0.5"
            title={replayIndex !== null
              ? 'Replay uses OANDA historical candles. Exit replay to choose the live chart source.'
              : 'This changes the chart feed only. Automatic execution always uses MT5 broker candles.'}
          >
            <span className="px-1 text-[9px] font-black tracking-wide text-slate-400">DATA</span>
            {(['MT5', 'OANDA'] as const).map((dataSource) => (
              <button
                key={dataSource}
                type="button"
                onClick={() => changeLiveChartDataSource(dataSource)}
                disabled={replayIndex !== null || (dataSource === 'MT5' && !marketConfig.mt5AutomationEnabled)}
                className={`rounded-full border px-2 py-0.5 text-[9px] font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  replayIndex === null && liveChartDataSource === dataSource
                    ? dataSource === 'MT5'
                      ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                      : 'border-amber-500 bg-amber-500 text-white shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:text-slate-900'
                }`}
              >
                {dataSource}
              </button>
            ))}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMt5SettingsOpen((visible) => !visible)}
              className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-black transition ${
                mt5Status?.config.enabled
                  ? mt5Status.config.dryRun || mt5Status.marketData?.fresh !== true
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-slate-300 bg-slate-50 text-slate-600'
              }`}
              title="Open MT5 automatic execution settings"
            >
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${
                mt5Status?.bridge.connected && mt5Status.marketData?.fresh
                  ? 'bg-emerald-500' : 'bg-slate-400'
              }`} />
              MT5 {mt5Status?.config.enabled
                ? mt5Status.config.dryRun
                  ? 'DRY RUN'
                  : mt5Status.marketData?.fresh ? 'AUTO ON' : 'AUTO WAIT'
                : 'OFF'}
            </button>
            {mt5SettingsOpen && mt5Status && (
              <div className="absolute right-0 top-full z-[70] mt-1 max-h-[calc(100dvh_-_96px)] w-64 overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white p-3 text-[10px] shadow-xl">
                <div className="sticky top-0 z-10 mb-2 flex items-center justify-between border-b border-slate-100 bg-white pb-2">
                  <div>
                    <div className="font-black text-slate-800">MT5 AUTO EXECUTION</div>
                    <div className={mt5Status.bridge.connected ? 'text-emerald-700' : 'text-rose-700'}>
                      Bridge {mt5Status.bridge.connected ? 'connected' : 'disconnected'}
                      {mt5Status.bridge.managedByServer ? ' · local server' : ''}
                    </div>
                  </div>
                  <button type="button" onClick={() => setMt5SettingsOpen(false)} className="text-slate-400">✕</button>
                </div>
                <div className="mb-2 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void controlMt5Bridge('start')}
                    disabled={mt5Status.bridge.connected || mt5Status.bridge.processRunning}
                    className="flex-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 font-black text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    START BRIDGE
                  </button>
                  <button
                    type="button"
                    onClick={() => void controlMt5Bridge('stop')}
                    disabled={!mt5Status.bridge.processRunning}
                    className="flex-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 font-black text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    STOP BRIDGE
                  </button>
                </div>
                {mt5BridgeControlError && (
                  <div className="mb-2 rounded border border-rose-200 bg-rose-50 p-1.5 text-rose-700">
                    {mt5BridgeControlError}
                  </div>
                )}
                <label className="mb-2 flex items-center justify-between font-bold text-slate-700">
                  <span>
                    Auto Trading:{' '}
                    <b className={mt5Status.config.enabled ? 'text-emerald-700' : 'text-rose-700'}>
                      {mt5Status.config.enabled ? 'ON' : 'OFF'}
                    </b>
                  </span>
                  <input
                    type="checkbox"
                    checked={mt5Status.config.enabled}
                    onChange={(event) => void updateMt5Config({ enabled: event.target.checked })}
                  />
                </label>
                <label className="mb-2 flex items-center justify-between font-bold text-slate-700">
                  <span>
                    Send Trades to MT5:{' '}
                    <b className={!mt5Status.config.dryRun ? 'text-emerald-700' : 'text-rose-700'}>
                      {!mt5Status.config.dryRun ? 'YES' : 'NO'}
                    </b>
                  </span>
                  <input
                    type="checkbox"
                    checked={!mt5Status.config.dryRun}
                    onChange={(event) => void updateMt5Config({ dryRun: !event.target.checked })}
                  />
                </label>
                <fieldset className="mb-2 rounded border border-slate-200 bg-slate-50 p-2">
                  <legend className="px-1 font-bold text-slate-700">Allowed Trade Styles</legend>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <label className="flex items-center gap-1 font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={mt5Status.config.scalpingEnabled}
                        onChange={(event) => void updateMt5Config({ scalpingEnabled: event.target.checked })}
                      />
                      Scalping
                    </label>
                    <label className="flex items-center gap-1 font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={mt5Status.config.intradayEnabled}
                        onChange={(event) => void updateMt5Config({ intradayEnabled: event.target.checked })}
                      />
                      Intraday
                    </label>
                  </div>
                  <span className="mt-1 block text-[8px] font-semibold text-slate-500">
                    Gold scalping uses M15/H1 zones with M1/M5 confirmation. Both switches can be on.
                    {' '}OFF hides that style across the dashboard and stops its alerts and new orders.
                  </span>
                </fieldset>
                <fieldset className="mb-2 rounded border border-slate-200 bg-slate-50 p-2">
                  <legend className="px-1 font-bold text-slate-700">Allowed Trade Timeframes</legend>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {MT5_ENTRY_TIMEFRAME_OPTIONS.map((timeframe) => {
                      const currentTimeframes = mt5Status.config.enabledTimeframes
                        ?? MT5_DEFAULT_ENABLED_TIMEFRAMES;
                      const checked = currentTimeframes.includes(timeframe);
                      return (
                        <label key={timeframe} className="flex items-center gap-1 font-bold text-slate-700">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const enabledTimeframes = event.target.checked
                                ? [...currentTimeframes, timeframe]
                                : currentTimeframes.filter((item) => item !== timeframe);
                              void updateMt5Config({ enabledTimeframes });
                            }}
                          />
                          {timeframe}
                        </label>
                      );
                    })}
                  </div>
                  <span className="mt-1 block text-[8px] font-semibold text-slate-500">
                    OFF blocks that timeframe everywhere. M1 OFF blocks M1 setup, M1 engulfing,
                    and every MTF trade related to M1.
                  </span>
                </fieldset>
                <label className="mb-2 block font-bold text-slate-700">
                  Risk per trade
                  <select
                    value={mt5Status.config.riskPercent}
                    onChange={(event) => void updateMt5Config({ riskPercent: Number(event.target.value) })}
                    className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1"
                  >
                    {MT5_RISK_PERCENT_OPTIONS.map((riskPercent) => (
                      <option key={riskPercent} value={riskPercent}>{riskPercent}%</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[8px] font-semibold text-slate-500">
                    Lot size = cash risk ÷ (SL pips × 10)
                  </span>
                </label>
                <label className="mb-2 block font-bold text-slate-700">
                  Daily loss limit (%)
                  <select
                    aria-label="Daily loss limit percent"
                    value={mt5Status.config.maximumDailyLossPercent}
                    onChange={(event) => void updateMt5Config({ maximumDailyLossPercent: Number(event.target.value) })}
                    className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1"
                  >
                    {[1, 2, 3, 4, 5].map((lossPercent) => (
                      <option key={lossPercent} value={lossPercent}>{lossPercent}%</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[8px] font-semibold text-slate-500">Maximum 5%. Closed and floating bot losses count together.</span>
                </label>
                <div className="mb-2 rounded border border-indigo-100 bg-indigo-50 p-2 text-slate-700">
                  <div className="mb-1 font-black text-indigo-800">Daily bot loss · Nepal day</div>
                  {mt5Status.bridge.connected && dailyRisk?.available ? <>
                    <div>Daily balance: <b>{dailyRiskMoney(dailyRisk.startingBalance)}</b></div>
                    <div>Limit: <b>{dailyRisk.limitPercent.toFixed(2)}% · {dailyRiskMoney(dailyRisk.limitMoney)}</b></div>
                    <div>Closed loss: <b>{(dailyRisk.realizedLossMoney / dailyRisk.startingBalance * 100).toFixed(2)}% · {dailyRiskMoney(dailyRisk.realizedLossMoney)}</b></div>
                    <div>Floating loss: <b>{(dailyRisk.floatingLossMoney / dailyRisk.startingBalance * 100).toFixed(2)}% · {dailyRiskMoney(dailyRisk.floatingLossMoney)}</b></div>
                    <div>Used today: <b>{dailyRisk.usedPercent.toFixed(2)}% · {dailyRiskMoney(dailyRisk.usedMoney)}</b></div>
                    <div>Remaining: <b>{dailyRisk.remainingPercent.toFixed(2)}% · {dailyRiskMoney(dailyRisk.remainingMoney)}</b></div>
                    <div>Reserved at SL: <b>{(dailyRisk.reservedRiskMoney / dailyRisk.startingBalance * 100).toFixed(2)}% · {dailyRiskMoney(dailyRisk.reservedRiskMoney)}</b></div>
                    <div>Available for new trades: <b>{dailyRisk.availableRiskPercent.toFixed(2)}% · {dailyRiskMoney(dailyRisk.availableRiskMoney)}</b></div>
                    <div className={`mt-1 font-black ${dailyRisk.limitReached || dailyRisk.riskUnbounded ? 'text-rose-700' : 'text-indigo-700'}`}>
                      {dailyRisk.limitReached ? 'DAILY LIMIT REACHED · NEW TRADES STOPPED'
                        : dailyRisk.riskUnbounded ? 'NEW TRADES PAUSED · AN AUTOMATED POSITION OR ORDER HAS NO SL'
                          : dailyRisk.availableRiskMoney <= 0 ? 'DAILY ALLOWANCE FULLY RESERVED · NEW TRADES PAUSED' : 'DAILY ALLOWANCE AVAILABLE'}
                    </div>
                  </> : <div className="text-amber-700">
                    {dailyRisk?.available === false ? dailyRisk.error : 'Waiting for fresh MT5 daily risk data.'}
                  </div>}
                </div>
                <div className="mb-2 rounded border border-slate-200 bg-slate-50 p-2 leading-relaxed text-slate-600">
                  <div className="mb-1 font-black text-slate-800">Overall bot profit / loss</div>
                  <div className="mb-1 text-[8px]">This MT5 account · all available history · no daily reset</div>
                  {mt5Status.bridge.connected && overallProfit?.available ? <>
                    <div>Realized profit: <b className="text-emerald-700">{overallProfitMoney(overallProfit.realizedProfitMoney)}</b></div>
                    <div>Realized loss: <b className="text-rose-700">{overallProfitMoney(overallProfit.realizedLossMoney)}</b></div>
                    <div>Net realized P/L: <b className={overallProfit.netRealizedMoney < 0 ? 'text-rose-700' : 'text-emerald-700'}>{overallProfitMoney(overallProfit.netRealizedMoney)}</b></div>
                    <div>Floating P/L: <b className={overallProfit.floatingMoney < 0 ? 'text-rose-700' : 'text-emerald-700'}>{overallProfitMoney(overallProfit.floatingMoney)}</b></div>
                    <div className={`mt-1 font-black ${overallProfit.netMoney < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      Overall P/L: {overallProfitMoney(overallProfit.netMoney)}
                    </div>
                    <div className="mt-1 text-[8px]">Bot trades only · commission, swap and fees included</div>
                  </> : <div className="text-amber-700">
                    {overallProfit?.available === false ? overallProfit.error : 'Waiting for overall MT5 profit/loss data.'}
                  </div>}
                </div>
                <label className="mb-2 block font-bold text-slate-700">
                  Maximum open trades (max 10)
                  <select
                    aria-label="Maximum open trades"
                    value={mt5Status.config.maximumOpenTrades}
                    onChange={(event) => void updateMt5Config({ maximumOpenTrades: Number(event.target.value) })}
                    className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1"
                  >
                    {Array.from({ length: 10 }, (_, index) => index + 1).map((tradeCount) => (
                      <option key={tradeCount} value={tradeCount}>{tradeCount}</option>
                    ))}
                  </select>
                </label>
                <div className="rounded bg-slate-50 p-2 leading-relaxed text-slate-600">
                  Account: <b>{mt5Status.bridge.account || 'Waiting for MT5 login'}</b><br />
                  Server: <b>{mt5Status.bridge.server || '—'}</b><br />
                  Symbol: <b>{mt5Status.config.brokerSymbol}</b><br />
                  {(mt5Status.bridge.symbolCandidates?.length ?? 0) > 1 && <label className="mb-1 block">
                    Broker Gold symbol
                    <select
                      aria-label="Broker Gold symbol"
                      value={mt5Status.bridge.symbolResolved ? mt5Status.bridge.brokerSymbol : ''}
                      onChange={(event) => {
                        if (event.target.value) void updateMt5Config({ brokerSymbol: event.target.value,
                          brokerSymbolAccount: mt5Status.bridge.account, brokerSymbolServer: mt5Status.bridge.server });
                      }}
                      className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1"
                    >
                      <option value="" disabled>Choose Gold symbol</option>
                      {mt5Status.bridge.symbolCandidates?.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
                    </select>
                  </label>}
                  {mt5Status.bridge.message && <div className="mb-1 text-amber-700">{mt5Status.bridge.message}</div>}
                  Execution candles: <b className={mt5Status.marketData?.fresh ? 'text-emerald-700' : 'text-amber-700'}>
                    MT5 BROKER · {mt5Status.marketData?.fresh ? 'FRESH' : 'WAITING'}
                  </b><br />
                  MT5 Capital: <b>{mt5Status.bridge.balance === undefined
                    ? '—'
                    : `${mt5Status.bridge.currency || '$'} ${mt5Status.bridge.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</b><br />
                  Equity: <b>{mt5Status.bridge.equity === undefined
                    ? '—'
                    : `${mt5Status.bridge.currency || '$'} ${mt5Status.bridge.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</b><br />
                  Selected cash risk: <b>{mt5Status.bridge.equity === undefined
                    ? '—'
                    : `${mt5Status.bridge.currency || '$'} ${(mt5Status.bridge.equity * mt5Status.config.riskPercent / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</b><br />
                  Waiting to send: <b>{mt5Status.counts.QUEUED ?? 0}</b> · Open MT5 trades: <b>{mt5Status.positions.length}</b><br />
                  Process: <b>{mt5Status.bridge.processRunning
                    ? `RUNNING · PID ${mt5Status.bridge.processId ?? '—'}`
                    : mt5Status.bridge.connected ? 'MANUALLY STARTED' : 'STOPPED'}</b><br />
                  Live orders also require <b>MT5_ALLOW_LIVE_EXECUTION=YES</b> in .env.mt5.
                </div>
                {(mt5Status.bridge.logs?.length ?? 0) > 0 && (
                  <div className="mt-2 max-h-24 overflow-auto rounded bg-slate-950 p-2 font-mono text-[8px] leading-relaxed text-slate-200">
                    {mt5Status.bridge.logs!.slice(-8).map((line, index) => (
                      <div key={`${index}:${line}`} className="whitespace-pre-wrap break-words">{line}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="relative flex items-center border-l border-slate-200 pl-1">
            <button
              type="button"
              onClick={() => {
                setShowIndicatorControls((visible) => !visible);
                setShowDrawingTools(false);
              }}
              className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-black transition ${
                showIndicatorControls
                  ? 'border-indigo-300 bg-indigo-100 text-indigo-800'
                  : 'border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
              title={showIndicatorControls ? 'Minimize indicator controls' : 'Show indicator controls'}
              aria-expanded={showIndicatorControls}
            >
              INDICATORS {showIndicatorControls ? '▴' : '▾'}
            </button>
            {showIndicatorControls && (
            <div className="absolute right-0 top-full z-[60] mt-1 w-[min(720px,calc(100vw-2rem))] rounded-lg border border-indigo-100 bg-white p-2 shadow-xl ring-1 ring-slate-900/5">
              <div className="relative mb-1.5 flex min-h-8 items-center justify-center border-b border-slate-100 pb-1.5 pr-8">
                <div className="text-center">
                  <div className="text-[10px] font-black tracking-wide text-slate-700">INDICATOR CONTROLS</div>
                  <div className="text-[8px] font-bold tracking-wide text-slate-400">SELECT EACH INDICATOR ON OR OFF</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIndicatorControls(false)}
                  className="absolute right-0 top-0 rounded-full border border-slate-200 px-1.5 py-0.5 text-[8px] font-black text-slate-500 hover:bg-slate-100"
                  aria-label="Close indicator controls"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1">
            <button
              onClick={() => setShowStructure((value) => !value)}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
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
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
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
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
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
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                showIss ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide ISS 0–5 wave markings"
            >
              ISS 5-WAVE {showIss ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setShowInternal((value) => !value)}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                showInternal ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide post-ISS internal structure, zones, BOS and CHoCH"
            >
              INT STRUCTURE {showInternal ? 'ON' : 'OFF'}
            </button>
            <div className="relative flex">
              <button
                onClick={() => setShowFib((value) => !value)}
                className={`whitespace-nowrap rounded-l-full border border-r-0 px-1.5 py-0.5 text-[8px] font-black transition ${
                  showFib ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 bg-white text-slate-500'
                }`}
                title="Master switch for all Fibonacci confluence markings"
              >
                FIB {showFib ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                onClick={() => setShowFibOptions((visible) => !visible)}
                className={`rounded-r-full border px-1 py-0.5 text-[8px] font-black transition ${
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
                      <div className="text-[8px] font-bold text-slate-400">SELECT FIBS SEPARATELY</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFibVisibility({ ...DEFAULT_FIB_VISIBILITY });
                        setFibPreviousVisibility({ ...DEFAULT_FIB_VISIBILITY });
                        setChochFibVisibility([false, false, false, false]);
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
                  <button
                    type="button"
                    onClick={() => void updateMt5Config({ mtfLtfFibRequired: !mtfLtfFibRequired })}
                    disabled={!mt5Status}
                    className={`mb-1.5 w-full whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                      mtfLtfFibRequired
                        ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                    title="Require the lower-timeframe Fib for MTF CHoCH entries; the zone midpoint and engulfing are always required"
                  >
                    MTF LTF FIB REQUIRED {mtfLtfFibRequired ? 'ON' : 'OFF'}
                  </button>
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
                        {expandedFibOption === 'choch' ? (
                          ['LATEST', 'PREVIOUS 1', 'PREVIOUS 2', 'PREVIOUS 3'].map((label, index) => {
                            const enabled = chochFibVisibility[index];
                            return (
                              <button
                                key={label}
                                type="button"
                                onClick={() => setChochFibVisibility((current) => current.map((value, slot) => (
                                  slot === index ? !value : value
                                )) as ChochFibVisibility)}
                                className={`flex items-center justify-between whitespace-nowrap rounded border px-1.5 py-1 text-[8px] font-black leading-none ${
                                  enabled
                                    ? 'border-fuchsia-300 bg-fuchsia-200 text-fuchsia-800'
                                    : 'border-slate-200 bg-white text-slate-500'
                                }`}
                              >
                                <span>{label}</span>
                                <span className={`ml-1 rounded-full px-1 py-0.5 text-[8px] ${
                                  enabled
                                    ? 'bg-fuchsia-300 text-fuchsia-900'
                                    : 'bg-slate-200 text-slate-500'
                                }`}>
                                  {enabled ? 'ON' : 'OFF'}
                                </span>
                              </button>
                            );
                          })
                        ) : <>
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
                        </>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowJournal(true);
                setShowAccuracyTable(false);
                setVisibleAccuracyRecordIds(null);
                setShowAccuracyOptions(false);
              }}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                showJournal
                  ? 'border-violet-300 bg-violet-100 text-violet-800'
                  : 'border-violet-200 bg-violet-50 text-violet-700'
              }`}
              title="Open the saved trading journal and export Excel or Word reports"
            >
              JOURNAL
            </button>
            <button
              onClick={() => setShowEngulfing((value) => !value)}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                showEngulfing ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide confirmed Type 1–4 engulfing signals and their mapped fallback timeframe"
            >
              ENGULFING {showEngulfing ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => {
                const enabled = !tradingTimeEnabled;
                setTradingTimeEnabled(enabled);
                void updateMt5Config({ tradingTimeEnabled: enabled });
              }}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                tradingTimeEnabled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Restrict dashboard and MT5 entries to the three Nepal trading sessions"
            >
              TRADING TIME {tradingTimeEnabled ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => {
                const enabled = !telegramMessagesEnabled;
                setTelegramMessagesEnabled(enabled);
                void updateMt5Config({ telegramMessagesEnabled: enabled });
              }}
              disabled={!mt5Status}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                telegramMessagesEnabled
                  ? 'border-sky-200 bg-sky-50 text-sky-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Send or pause Telegram trade messages"
            >
              TELEGRAM {telegramMessagesEnabled ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setShowTradeLevels((value) => !value)}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                showTradeLevels
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide the Entry-to-TP reward box and Entry-to-SL risk box"
            >
              LONG/SHORT POSITION {showTradeLevels ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => setShowEntryArrows((value) => !value)}
              aria-pressed={showEntryArrows}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                showEntryArrows
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide intraday and scalping entry arrows"
            >
              ENTRY ARROWS {showEntryArrows ? 'ON' : 'OFF'}
            </button>
            <div className="relative flex">
              <button
                type="button"
                onClick={() => {
                  if (showAccuracyTable) setVisibleAccuracyRecordIds(null);
                  else setShowEntryArrows(true);
                  setShowAccuracyTable((value) => !value);
                }}
                className={`whitespace-nowrap rounded-l-full border border-r-0 px-1.5 py-0.5 text-[8px] font-black transition ${
                  showAccuracyTable
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
                title="Show or hide completed engulfing SL, RF, TP, total, and accuracy results"
              >
                ACCURACY TABLE {showAccuracyTable ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                onClick={() => setShowAccuracyOptions((value) => !value)}
                className={`rounded-r-full border px-1 py-0.5 text-[8px] font-black transition ${
                  showAccuracyOptions
                    ? 'border-indigo-300 bg-indigo-100 text-indigo-800'
                    : showAccuracyTable
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-500'
                }`}
                title="Accuracy table options"
                aria-label="Accuracy table options"
                aria-expanded={showAccuracyOptions}
              >
                ▾
              </button>
              {showAccuracyOptions && (
                <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border border-indigo-200 bg-white p-1.5 shadow-lg">
                  <div className="mb-1 px-1 text-[8px] font-black uppercase tracking-wide text-indigo-700">
                    Accuracy options
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAllAccuracyTrades((value) => !value);
                      setShowEntryArrows(true);
                      setShowAccuracyTable(true);
                    }}
                    className={`flex w-full items-center justify-between whitespace-nowrap rounded border px-1.5 py-1 text-[8px] font-black leading-none ${
                      showAllAccuracyTrades
                        ? 'border-indigo-300 bg-indigo-100 text-indigo-800'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                    title="Show or hide every completed trade in the loaded chart history"
                  >
                    <span>SHOW ALL TRADES</span>
                    <span className={`ml-1 rounded-full px-1 py-0.5 text-[8px] ${
                      showAllAccuracyTrades
                        ? 'bg-indigo-200 text-indigo-900'
                        : 'bg-slate-200 text-slate-500'
                    }`}>
                      {showAllAccuracyTrades ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowInvalidZones((value) => !value)}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                showInvalidZones
                  ? 'border-slate-400 bg-slate-200 text-slate-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide rejected, invalidated, and superseded zones"
            >
              INVALID ZONES {showInvalidZones ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => setShowZoneComparison((value) => !value)}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black transition ${
                comparisonTimeframe
                  ? 'border-sky-300 bg-sky-100 text-sky-800'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              aria-expanded={showZoneComparison}
              title="Compare recent valid buy and sell zones from another timeframe"
            >
              HTF/LTF ZONES {comparisonTimeframe ? GRANULARITY_LABELS[comparisonTimeframe] : 'OFF'} ▾
            </button>
              </div>
              {showZoneComparison && (
                <div className="mt-2 max-h-[55vh] overflow-y-auto rounded-lg border border-sky-100 bg-sky-50/40 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black text-slate-700">COMPARE HTF / LTF ZONES</div>
                      <div className="text-[8px] text-slate-500">Up to five valid buy and five valid sell zones from one timeframe</div>
                      <div className="text-[8px] text-slate-500">Use × on the chart to hide a zone; SHOW here restores it.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setComparisonTimeframe(null);
                        setShowLtfChoch(false);
                      }}
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[8px] font-black text-slate-600 hover:bg-slate-100"
                    >
                      REMOVE ALL
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-pressed={showLtfChoch}
                    disabled={granularity === 'M1'}
                    onClick={() => {
                      if (!showLtfChoch && (!comparisonTimeframe
                        || DRAWING_TIMEFRAME_ORDER.indexOf(comparisonTimeframe)
                          >= DRAWING_TIMEFRAME_ORDER.indexOf(granularity))) {
                        const preferred = MTF_MAPPINGS.find((mapping) => mapping.higher === granularity)?.lower;
                        setComparisonTimeframe(preferred ?? DRAWING_TIMEFRAME_ORDER[
                          DRAWING_TIMEFRAME_ORDER.indexOf(granularity) - 1
                        ]);
                      }
                      setShowLtfChoch((value) => !value);
                    }}
                    className={`mb-1 rounded border px-2 py-1 text-[9px] font-black ${showLtfChoch
                      ? 'border-violet-300 bg-violet-100 text-violet-800'
                      : 'border-slate-200 bg-white text-slate-600'} disabled:opacity-50`}
                    title="After a chart zone tap, show lower-timeframe TJL1/TJL2 and its CHoCH on this chart"
                  >
                    LTF CHocH {showLtfChoch ? 'ON' : 'OFF'}
                  </button>
                  {showLtfChoch && (
                    <div className="mb-2 text-[8px] text-slate-600">
                      The latest lower TJL1/TJL2 pair appears after a chart zone tap. After CHoCH, its QML, SBR/RBS, and DB/DT zones remain while valid or pending.
                    </div>
                  )}
                  <div className="mb-2 flex flex-wrap gap-1">
                    {DRAWING_TIMEFRAME_ORDER.filter((value) => value !== granularity).map((value) => {
                      const higher = DRAWING_TIMEFRAME_ORDER.indexOf(value)
                        > DRAWING_TIMEFRAME_ORDER.indexOf(granularity);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setComparisonTimeframe(value);
                            if (higher) setShowLtfChoch(false);
                          }}
                          aria-pressed={comparisonTimeframe === value}
                          className={`rounded border px-2 py-1 text-[8px] font-black ${
                            comparisonTimeframe === value
                              ? 'border-sky-400 bg-sky-100 text-sky-900'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {GRANULARITY_LABELS[value]} {higher ? 'HTF' : 'LTF'}
                        </button>
                      );
                    })}
                  </div>
                  {!comparisonTimeframe ? (
                    <div className="text-[9px] text-slate-500">Choose a timeframe to show its recent zones.</div>
                  ) : !tableTimeframeData[comparisonTimeframe] ? (
                    <div className="text-[9px] text-slate-500">Loading {GRANULARITY_LABELS[comparisonTimeframe]} zones...</div>
                  ) : comparisonZones.length === 0 ? (
                    <div className="text-[9px] text-slate-500">{ltfChochContext
                      ? ltfChochContext.confirmations.length > 0
                        ? 'CHoCH confirmed; no valid or pending CHoCH zones to show.'
                        : 'Waiting for a chart zone tap or the latest lower TJL1/TJL2 pair.'
                      : 'No active, valid zones on this timeframe.'}</div>
                  ) : (
                    <div className="space-y-1">
                      {comparisonZones.map(({ zone, overlapsCurrentZone }) => {
                        const key = `${marketSymbol}:${comparisonTimeframe}:${zone.id}`;
                        const visible = !hiddenComparisonZoneKeys.includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={visible}
                            onClick={() => setHiddenComparisonZoneKeys((current) => (
                              current.includes(key) ? current.filter((item) => item !== key)
                                : [...current, key]
                            ))}
                            className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[9px] ${
                              visible ? 'border-sky-200 bg-white text-slate-700'
                                : 'border-slate-200 bg-slate-50 text-slate-400'
                            }`}
                            title={visible ? 'Hide this comparison zone' : 'Show this comparison zone'}
                          >
                            <span className="min-w-0 truncate font-bold">
                              {zone.isBuy ? 'BUY' : 'SELL'} {zone.name} · {formatPrice(zone.bottom)}–{formatPrice(zone.top)}
                              {overlapsCurrentZone ? ' · OVERLAPS CHART ZONE' : ''}
                            </span>
                            <span className="shrink-0 font-black text-sky-700">{visible ? 'HIDE ×' : 'SHOW'}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </div>

          <div className="flex items-center gap-0.5 border-l border-slate-200 pl-1.5">
            {replayIndex === null ? (
              <button
                onClick={openReplaySelector}
                disabled={candles.length < 2}
                className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-px text-[7px] font-black leading-3 text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Choose a chart bar, then start candle-by-candle replay from that point"
              >
                REPLAY
              </button>
            ) : (
              <>
                <button
                  onClick={() => setReplayIndex((index) => Math.max(1, (index ?? 1) - 1))}
                  className="rounded-full border border-violet-200 bg-white px-1.5 py-px text-[7px] font-black leading-3 text-violet-700 hover:bg-violet-50"
                  title="Previous candle"
                >
                  ‹
                </button>
                <button
                  onClick={openReplaySelector}
                  className={`rounded-full border px-1.5 py-px text-[7px] font-black leading-3 transition ${
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
                  className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-px text-[7px] font-black leading-3 text-violet-700 hover:bg-violet-100"
                  title={replayPlaying ? 'Pause replay' : 'Play replay'}
                >
                  {replayPlaying ? '❚❚ PAUSE' : '▶ PLAY'}
                </button>
                <button
                  onClick={() => setReplayIndex((index) => Math.min(candles.length - 1, (index ?? 1) + 1))}
                  className="rounded-full border border-violet-200 bg-white px-1.5 py-px text-[7px] font-black leading-3 text-violet-700 hover:bg-violet-50"
                  title="Next candle"
                >
                  ›
                </button>
                <select
                  value={replaySpeed}
                  onChange={(event) => setReplaySpeed(Number(event.target.value))}
                  className="rounded-full border border-violet-200 bg-white px-1.5 py-px text-[7px] font-black leading-3 text-violet-700"
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
                  className="rounded-full border border-slate-200 bg-white px-1.5 py-px text-[7px] font-black leading-3 text-slate-500 hover:bg-slate-100"
                  title="Exit replay and return to the live chart"
                >
                  LIVE
                </button>
                <span className="px-0.5 text-[7px] font-bold text-violet-700">
                  {displayCandles.length}/{candles.length}
                </span>
              </>
            )}
          </div>

          <div className="relative flex items-center">
            <button
              type="button"
              onClick={() => {
                setShowDrawingTools((visible) => !visible);
                setShowIndicatorControls(false);
              }}
              className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-black transition ${
                activeDrawingTool
                  ? 'border-violet-400 bg-violet-600 text-white'
                  : showDrawingTools
                    ? 'border-violet-300 bg-violet-100 text-violet-800'
                    : 'border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
              title="Open chart drawing tools"
              aria-expanded={showDrawingTools}
            >
              TOOLS {activeDrawingTool ? '●' : showDrawingTools ? '▴' : '▾'}
            </button>
            {showDrawingTools && (
              <div className="absolute right-0 top-full z-[65] mt-1 w-80 rounded-lg border border-violet-100 bg-white p-2 shadow-xl ring-1 ring-slate-900/5">
                <div className="relative mb-2 flex min-h-8 items-center justify-center border-b border-slate-100 pb-1.5 pr-8">
                  <div className="text-center">
                    <div className="text-[10px] font-black tracking-wide text-slate-700">CHART DRAWING TOOLS</div>
                    <div className="text-[8px] font-bold tracking-wide text-slate-400">SELECT A TOOL, THEN CLICK ON THE CHART</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDrawingTools(false)}
                    className="absolute right-0 top-0 rounded-full border border-slate-200 px-1.5 py-0.5 text-[8px] font-black text-slate-500 hover:bg-slate-100"
                    aria-label="Close drawing tools"
                  >
                    ✕
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {CHART_DRAWING_TOOLS.map((option) => (
                    <button
                      key={option.tool}
                      type="button"
                      onClick={() => {
                        setActiveDrawingTool(option.tool);
                        setDrawingDraft(null);
                        setDrawingDrag(null);
                        setSelectedDrawingId(null);
                        setShowDrawingVisibility(false);
                        setReplaySelecting(false);
                        setShowDrawingTools(false);
                      }}
                      className={`rounded-md border px-2 py-1.5 text-left transition ${
                        activeDrawingTool === option.tool
                          ? 'border-violet-400 bg-violet-100 text-violet-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-violet-200 hover:bg-violet-50'
                      }`}
                      title={option.hint}
                    >
                      <span className="block text-[9px] font-black">{option.label}</span>
                      <span className="mt-0.5 block text-[7px] font-semibold leading-tight text-slate-400">
                        {option.hint}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={undoLastChartDrawing}
                    disabled={!currentSourceChartDrawings.length}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-[8px] font-black text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    UNDO LAST
                  </button>
                  <button
                    type="button"
                    onClick={clearCurrentChartDrawings}
                    disabled={!currentSourceChartDrawings.length}
                    className="rounded-full border border-rose-200 px-2 py-0.5 text-[8px] font-black text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    CLEAR ALL
                  </button>
                  {hiddenChartDrawings.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setChartDrawings((current) => current.map((drawing) => (
                        drawing.scope === drawingScope ? { ...drawing, hidden: false } : drawing
                      )))}
                      className="rounded-full border border-violet-200 px-2 py-0.5 text-[8px] font-black text-violet-700 hover:bg-violet-50"
                    >
                      SHOW HIDDEN ({hiddenChartDrawings.length})
                    </button>
                  )}
                  {(activeDrawingTool || drawingDraft) && (
                    <button
                      type="button"
                      onClick={() => {
                        setDrawingDraft(null);
                        setActiveDrawingTool(null);
                        setShowDrawingTools(false);
                      }}
                      className="ml-auto rounded-full border border-amber-200 px-2 py-0.5 text-[8px] font-black text-amber-700 hover:bg-amber-50"
                    >
                      CANCEL
                    </button>
                  )}
                  <span className="ml-auto text-[8px] font-bold text-slate-400">
                    {currentSourceChartDrawings.length} SAVED
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex max-w-full flex-wrap items-center justify-end gap-1 xl:ml-0 xl:shrink-0 xl:flex-nowrap">
            <label className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[8px] font-black text-slate-600">
              TIME
              <select
                value={chartTimeZone}
                onChange={(event) => setChartTimeZone(event.target.value as ChartTimeZone)}
                className="bg-white text-[8px] font-black text-slate-700 outline-none"
                title="Choose the timezone shown on the chart axis and crosshair"
              >
                <option value="Asia/Kathmandu">NEPAL</option>
                <option value="Asia/Kolkata">INDIA</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
            <div className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] font-black ${
              error
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}>
              {error ? <WifiOff className="h-2.5 w-2.5" /> : <Wifi className="h-2.5 w-2.5" />}
              {error ? 'FEED DISCONNECTED' : source.startsWith('MetaTrader 5')
                ? 'MT5 BROKER CONNECTED' : 'TRADINGVIEW CONNECTED'}
            </div>
            <button
              onClick={() => {
                restorePresentChartView();
                setRefreshKey((value) => value + 1);
              }}
              className="rounded-md border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
              title="Refresh candles and restore the default chart view"
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

        {replayIndex === null && visibleMt5Positions.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-cyan-200 bg-cyan-50 px-3 py-1 text-[8px] font-semibold leading-none text-cyan-900">
            <span className="text-[8px] font-black">MT5 LIVE</span>
            {visibleMt5Positions.map((position) => (
              <span key={position.ticket} className="flex items-center gap-1 rounded border border-cyan-200 bg-white px-1.5 py-1">
                #{position.ticket}
                <b className="rounded bg-slate-100 px-1 py-0.5 text-[7px] font-black text-slate-600">
                  {position.signalTimeframe ?? '?'} ENTRY
                </b>
                · <b className={position.direction === 'BUY' ? 'text-emerald-700' : 'text-rose-700'}>{position.direction}</b>
                {' · '}{position.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })} LOT
                {' · '}RUNNING P/L: <b className={position.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                  {mt5Status!.bridge.currency || 'USD'} {position.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </b>
                {(position.signalStatus === 'RISK_FREE' || position.signalStatus === 'RF') && (
                  <b className="rounded bg-emerald-100 px-1 py-0.5 text-[7px] font-black text-emerald-700">RF DONE</b>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-xs">
          <span className="flex items-center gap-1.5 font-black text-slate-800">
            <Crosshair className="h-3.5 w-3.5 text-slate-400" />
            O <b ref={headerOpenRef} />
          </span>
          <span className="text-slate-500">H <b ref={headerHighRef} className="text-slate-800" /></span>
          <span className="text-slate-500">L <b ref={headerLowRef} className="text-slate-800" /></span>
          <span className="text-slate-500">C <b ref={headerCloseRef} className="text-slate-800" /></span>
          <span ref={headerChangeRef} className="font-black" />
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

        <div
          ref={chartPaneRef}
          className="relative flex-1 min-h-0 bg-white"
          onMouseLeave={() => setHoveredEntry(null)}
          onMouseDown={() => {
            if (!activeDrawingTool && !drawingDrag) {
              setSelectedDrawingId(null);
              setShowDrawingVisibility(false);
            }
          }}
        >
          <div ref={hostRef} className="absolute inset-0" />
          {hoveredEntry && showEntryArrows && (() => {
            const { entry, x, y } = hoveredEntry;
            const { trade } = entry;
            const record = chartEntryRecords.find((candidate) => candidate.id === entry.id);
            const bullish = trade.signal.direction === 'bullish';
            const mtf = record?.source === 'MTF';
            const timeframeName = (timeframe: TradeTimeframe) => timeframe === 'D'
              ? '1-day' : `${timeframe.slice(1)}-${timeframe.startsWith('H') ? 'hour' : 'minute'}`;
            const zoneName = (name: string) => name.replace(/^Int\.?\s+/i, 'Internal ');
            const mainZone = hoveredTradeZones?.mainZone
              ?? (mtf ? 'Name unavailable in saved history' : entry.zone);
            const entryZone = hoveredTradeZones?.entryZone ?? entry.zone;
            const status = trade.status === 'tp-hit' ? '✅ TAKE PROFIT HIT'
              : trade.status === 'sl-hit' ? '🔴 STOP LOSS HIT'
              : trade.status === 'risk-free' ? '🛡️ RISK-FREE HIT'
              : trade.status === 'pending' ? '⏳ WAITING FOR ENTRY' : '⏳ TRADE OPEN';
            const timeZoneLabel = chartTimeZone === 'Asia/Kathmandu' ? 'Nepal' : chartTimeZone;
            return (
            <div
              className="pointer-events-none absolute z-40 w-80 max-w-[calc(100%_-_16px)] rounded-xl border border-slate-200 bg-white/95 p-3 text-[11px] leading-relaxed text-slate-700 shadow-xl"
              style={{
                left: Math.max(8, Math.min(x + 16, (chartPaneRef.current?.clientWidth ?? 340) - 328)),
                top: Math.max(8, Math.min(y + 16, (chartPaneRef.current?.clientHeight ?? 440) - 420)),
              }}
            >
              <div className={`text-xs font-black ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                {bullish ? '🟢' : '🔴'} {marketSymbol} {bullish ? 'BUY' : 'SELL'} · {entry.style}
              </div>
              <div className="mt-1 font-bold text-slate-800">{status}</div>
              {entry.tradingTimeBlocked && <div className="mt-1 text-amber-700">⚠️ Outside trading hours</div>}
              <div className="mt-3 border-t border-slate-100 pt-2">
                <div className="mb-1 font-bold text-slate-900">📍 Trade setup</div>
                <div>Main zone: <b>{record ? `${timeframeName(record.zoneTimeframe)} ` : ''}{zoneName(mainZone)}</b></div>
                {mtf && <div>Entry zone: <b>{timeframeName(trade.signal.timeframe)} {zoneName(entryZone)}</b></div>}
                <div>Confirmation: <b>{timeframeName(trade.signal.timeframe)} {bullish ? 'bullish' : 'bearish'} engulfing {trade.signal.type}</b></div>
                {!mtf && <div>Entry method: <b>Candle confirmation at the main zone</b></div>}
                {entry.fib !== 'Not recorded' && <div>Fibonacci: <b>{entry.fib}</b></div>}
              </div>
              <div className="mt-3 border-t border-slate-100 pt-2">
                <div className="mb-1 font-bold text-slate-900">💰 Trade levels</div>
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
                  <span>Entry</span><b>{formatPrice(trade.entry)}</b>
                  <span>Stop loss</span><b>{formatPrice(trade.stopLoss)}</b>
                  {trade.riskFreeEnabled !== false && <><span>Risk-free at 1R</span><b>{formatPrice(trade.riskFree)}</b></>}
                  <span>Take profit</span><b>{formatPrice(trade.takeProfit)}</b>
                  <span>Risk/reward</span><b>1:{trade.rewardRisk}</b>
                </div>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-2">
                <div className="font-bold text-slate-900">🕒 {trade.filledAt !== undefined ? 'Entry time' : 'Confirmation time'}</div>
                <div>{formatChartTime((trade.filledAt ?? trade.signal.time
                  + TIMEFRAME_SECONDS[trade.signal.timeframe]) as UTCTimestamp, chartTimeZone)} {timeZoneLabel}</div>
              </div>
            </div>
            );
          })()}
          <div
            ref={zoneLayerRef}
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
            style={{ contain: 'layout paint style' }}
          />
          <svg
            className="pointer-events-none absolute inset-0 z-[18] h-full w-full overflow-hidden"
            style={{ contain: 'layout paint style' }}
            aria-label="Saved chart drawings"
          >
            {visibleChartDrawings.map((drawing) => renderChartDrawing(drawing))}
            {previewChartDrawing && renderChartDrawing(previewChartDrawing, true)}
          </svg>
          {drawingTextEditor && drawingTextEditorPosition && (
            <input
              autoFocus
              type="text"
              value={drawingTextEditor.value}
              maxLength={80}
              placeholder="Add text"
              onChange={(event) => setDrawingTextEditor((current) => (
                current ? { ...current, value: event.target.value } : current
              ))}
              onBlur={saveChartDrawingText}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveChartDrawingText();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setDrawingTextEditor(null);
                }
              }}
              onMouseDown={(event) => event.stopPropagation()}
              className={`absolute z-50 w-36 origin-center px-1 py-0.5 text-center text-[9px] font-semibold text-slate-700 outline-none placeholder:italic placeholder:text-slate-400 focus:border-blue-500 ${
                textEditorDrawing?.tool === 'note'
                  ? 'rounded border border-blue-400 bg-white shadow-md'
                  : 'border-0 border-b border-slate-400 bg-white/80 shadow-none'
              }`}
              style={{
                left: drawingTextEditorPosition.left,
                top: drawingTextEditorPosition.top,
                transform: `translate(-50%, -50%) rotate(${drawingTextEditorPosition.angle}deg)`,
              }}
              aria-label="Drawing text"
            />
          )}
          <div
            ref={livePriceLabelRef}
            className="pointer-events-none absolute right-0 z-20 hidden w-[72px] -translate-y-1/2 flex-col items-center justify-center py-0.5 text-white shadow-sm"
            aria-label="Live candle price and time remaining"
          >
            <span ref={livePriceValueRef} className="text-[10px] font-black leading-[12px]" />
            <span ref={liveCountdownRef} className="text-[9px] font-bold leading-[11px]" />
          </div>
          {selectedChartDrawing && chartDrawingIsVisible(selectedChartDrawing) && !activeDrawingTool && (
            <div
              className={`absolute z-40 flex items-center gap-0.5 rounded-md border border-violet-200 bg-white p-0.5 shadow-lg ${
                drawingToolbarPosition ? '' : 'left-1/2 top-2 -translate-x-1/2'
              }`}
              style={drawingToolbarPosition ?? undefined}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <span className="rounded bg-violet-100 px-1 py-0.5 text-[6px] font-black leading-none text-violet-800">
                {CHART_DRAWING_TOOLS.find(({ tool }) => tool === selectedChartDrawing.tool)?.label}
              </span>
              <button
                type="button"
                className="cursor-move select-none rounded px-1 py-0.5 text-[6px] font-black leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Drag this control bar"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const pane = chartPaneRef.current;
                  if (!pane) return;
                  const toolbarBounds = event.currentTarget.parentElement?.getBoundingClientRect();
                  const paneBounds = pane.getBoundingClientRect();
                  if (!toolbarBounds) return;
                  const left = toolbarBounds.left - paneBounds.left;
                  const top = toolbarBounds.top - paneBounds.top;
                  setDrawingToolbarPosition({ left, top });
                  drawingToolbarDragRef.current = {
                    offsetX: event.clientX - toolbarBounds.left,
                    offsetY: event.clientY - toolbarBounds.top,
                    width: toolbarBounds.width,
                    height: toolbarBounds.height,
                  };
                }}
              >
                ⠿ MOVE
              </button>
              {(selectedChartDrawing.tool === 'rectangle'
                || selectedChartDrawing.tool === 'trend'
                || selectedChartDrawing.tool === 'note') && (
                <>
                  <button
                    type="button"
                    onClick={() => editChartDrawingText(selectedChartDrawing)}
                    className="rounded border border-slate-200 px-1 py-0.5 text-[6px] font-black leading-none text-slate-600 hover:bg-slate-50"
                    title="You can also double-click the drawing"
                  >
                    TEXT
                  </button>
                  <div className="flex items-center gap-px rounded border border-slate-200 px-0.5 py-0.5" title="Drawing colour">
                    {CHART_DRAWING_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => updateChartDrawing(selectedChartDrawing.id, { color })}
                        className={`h-2.5 w-2.5 rounded-full border ${
                          (selectedChartDrawing.color ?? '#2563eb') === color
                            ? 'border-slate-900 ring-1 ring-slate-400'
                            : 'border-white'
                        }`}
                        style={{ backgroundColor: color }}
                        aria-label={`Use ${color} drawing colour`}
                      />
                    ))}
                  </div>
                </>
              )}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowDrawingVisibility((visible) => !visible)}
                  className={`rounded border px-1 py-0.5 text-[6px] font-black leading-none ${
                    showDrawingVisibility
                      ? 'border-violet-300 bg-violet-100 text-violet-800'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  VISIBILITY ▾
                </button>
                {showDrawingVisibility && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-md border border-slate-200 bg-white p-1.5 shadow-xl">
                    <div className="mb-1 border-b border-slate-100 px-1 pb-1 text-[8px] font-black text-slate-500">
                      CURRENT: {TIMEFRAMES.find(({ value }) => value === granularity)?.label.toUpperCase()}
                    </div>
                    {([
                      ['current-and-above', 'CURRENT INTERVAL AND ABOVE'],
                      ['current-and-below', 'CURRENT INTERVAL AND BELOW'],
                      ['current-only', 'CURRENT INTERVAL ONLY'],
                      ['all', 'ALL INTERVALS'],
                    ] as Array<[ChartDrawingVisibility, string]>).map(([visibility, label]) => (
                      <button
                        key={visibility}
                        type="button"
                        onClick={() => {
                          updateChartDrawing(selectedChartDrawing.id, {
                            visibility,
                            visibilityTimeframe: granularity,
                          });
                          setShowDrawingVisibility(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[8px] font-black ${
                          (selectedChartDrawing.visibility ?? 'all') === visibility
                            ? 'bg-violet-100 text-violet-800'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                        {(selectedChartDrawing.visibility ?? 'all') === visibility && <span>✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  updateChartDrawing(selectedChartDrawing.id, { hidden: true });
                  setSelectedDrawingId(null);
                  setShowDrawingVisibility(false);
                }}
                className="rounded border border-slate-200 px-1 py-0.5 text-[6px] font-black leading-none text-slate-600 hover:bg-slate-50"
              >
                HIDE
              </button>
              <button
                type="button"
                onClick={() => removeChartDrawing(selectedChartDrawing.id)}
                className="rounded border border-rose-200 px-1 py-0.5 text-[6px] font-black leading-none text-rose-700 hover:bg-rose-50"
              >
                DELETE
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedDrawingId(null);
                  setShowDrawingVisibility(false);
                }}
                className="rounded-full border border-slate-200 px-1 py-0 text-[6px] font-black leading-none text-slate-500 hover:bg-slate-100"
                aria-label="Close drawing editor"
              >
                ✕
              </button>
            </div>
          )}
          {activeDrawingTool && !replaySelecting && (
            <div
              className="absolute inset-0 z-30 cursor-crosshair"
              onClick={handleDrawingChartClick}
              onMouseMove={(event) => {
                if (!drawingDraft) return;
                const hover = chartDrawingPointFromClient(event.clientX, event.clientY);
                if (hover) {
                  const constrainedHover = activeDrawingTool === 'trend' && event.shiftKey
                    ? { ...hover, price: drawingDraft.points[0].price }
                    : hover;
                  setDrawingDraft((current) => current ? { ...current, hover: constrainedHover } : current);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (activeDrawingTool === 'path') finishDrawingPath();
                else {
                  setDrawingDraft(null);
                  setActiveDrawingTool(null);
                }
              }}
              title="Click on the chart to place drawing points"
            >
              <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-violet-200 bg-white/95 px-3 py-1.5 text-[9px] font-black text-violet-800 shadow-lg">
                {CHART_DRAWING_TOOLS.find(({ tool }) => tool === activeDrawingTool)?.label}
                <span className="font-semibold text-slate-500">
                  {activeDrawingTool === 'note'
                    ? 'Click a price for the note'
                    : activeDrawingTool === 'path'
                      ? 'Click points · double-click or right-click to finish'
                      : activeDrawingTool === 'note'
                        ? drawingDraft
                          ? 'Click where the text box should be placed'
                          : 'Click the anchor point'
                      : activeDrawingTool === 'fib'
                        ? drawingDraft
                          ? 'Click level 0 move extreme'
                          : 'Click level 1 structure source'
                        : activeDrawingTool === 'trend'
                          ? drawingDraft
                            ? 'Click second point · hold Shift for a straight horizontal line'
                            : 'Click the first point'
                          : drawingDraft ? 'Click the second point' : 'Click the first point'}
                </span>
                <span className="text-slate-400">ESC cancels</span>
              </div>
            </div>
          )}
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
          <div data-journal-exclude="true" className={`pointer-events-auto absolute left-3 top-3 z-20 overflow-hidden rounded-md border border-slate-300 bg-white/95 shadow-sm ${showZoneTable ? 'w-fit max-w-[calc(100%_-_24px)]' : 'w-auto'}`}>
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
            <table className="table-auto border-collapse text-left text-[10px]">
              <thead className="bg-slate-100 text-[9px] uppercase text-slate-500">
                <tr>
                  <th className="whitespace-nowrap px-2 py-1 font-bold">Zone</th>
                  <th className="whitespace-nowrap px-2 py-1 font-bold">Type</th>
                  <th className="whitespace-nowrap px-2 py-1 font-bold">Price range</th>
                  <th className="whitespace-nowrap px-2 py-1 text-center font-bold">Engulf</th>
                  <th className="whitespace-nowrap px-2 py-1 text-right font-bold">Tap / Trade</th>
                </tr>
              </thead>
              <tbody>
                {scalpEntryTableRows.map(({ id, zone, trade, tradingTimeBlocked }) => {
                  const bullish = trade.signal.direction === 'bullish';
                  return (
                    <tr key={`scalp-entry-${id}`} className="border-t border-indigo-200 bg-indigo-50/80">
                      <td className="px-2 py-1 font-black text-slate-800">
                        <div>SCALP · {zone}</div>
                        <div className="text-[8px] font-semibold text-slate-500">
                          {formatAccuracyTradeTime(
                            trade.signal.time + TIMEFRAME_SECONDS[trade.signal.timeframe],
                            chartTimeZone,
                          )}
                        </div>
                      </td>
                      <td className={`px-2 py-1 font-bold ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {bullish ? 'BUY' : 'SELL'}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 font-bold text-blue-700">
                        ENTRY {formatPrice(trade.entry)}
                      </td>
                      <td className="px-2 py-1 text-center font-black">{trade.signal.type}</td>
                      <td className={`whitespace-nowrap px-2 py-1 text-right font-black ${
                        tradingTimeBlocked ? 'text-rose-700' : 'text-indigo-700'
                      }`}>
                        {tradingTimeBlocked
                          ? 'OUTSIDE TRADING TIME · NO TRADE'
                          : <TradeStatusText trade={trade} />}
                      </td>
                    </tr>
                  );
                })}
                {retainedDirectChartTradesForTimeframe.filter(overlay => !hasTradeDisplayExpired(overlay.trade)).map((overlay) => {
                  const bullish = overlay.trade.signal.direction === 'bullish';
                  const zoneLabel = tradeOverlayZoneLabel(overlay.label);
                  const sourceZoneId = directTradeOverlayZoneId(overlay);
                  const sourceZone = displayZones.find((zone) => zone.id === sourceZoneId)
                    ?? [...trackedDirectTradeSetups.values()].find((setup) => (
                      setup.scope === tradeTrackingScope && setup.zone.id === sourceZoneId
                    ))?.zone;
                  const currentFibLabels = sourceZone ? tradeZoneFibLabels(sourceZone) : [];
                  const fibLabels = currentFibLabels.length > 0 ? currentFibLabels : overlay.fibLabels ?? [];
                  return (
                    <React.Fragment key={`open-chart-trade-${overlay.id}`}>
                      <tr className={`border-t ${bullish ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                        <td className="px-2 py-1 font-black text-slate-800">
                          <span>{zoneLabel ?? 'OPEN CHART TRADE'}</span>
                          {isDefaultDeepDiscountZoneName(zoneLabel) && (
                            <span className="ml-1 rounded bg-fuchsia-100 px-1 py-0.5 text-[8px] font-black text-fuchsia-800">
                              DEEP DISCOUNT
                            </span>
                          )}
                          {fibLabels.map((label) => (
                            <span key={label} className="ml-1 rounded bg-fuchsia-100 px-1 py-0.5 text-[8px] font-black text-fuchsia-800">
                              {label}
                            </span>
                          ))}
                        </td>
                        <td className={`px-2 py-1 font-bold ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {bullish ? 'BUY' : 'SELL'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1">
                          ENTRY {formatPrice(overlay.trade.entry)}
                        </td>
                        <td className={`whitespace-nowrap px-2 py-1 text-center font-black ${bullish ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {overlay.trade.signal.type}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-right font-black text-emerald-700">
                          <TradeStatusText trade={overlay.trade} />
                        </td>
                      </tr>
                      <TradeDetailsRow trade={overlay.trade} colSpan={5} />
                    </React.Fragment>
                  );
                })}
                {pendingConfirmationRows.map((zone) => (
                  <tr key={zone.id} className={`border-t text-slate-700 ${zone.isBuy ? 'border-emerald-100 bg-emerald-50/70' : 'border-rose-100 bg-rose-50/70'}`}>
                    <td className={`px-2 py-1 font-black ${zone.isBuy ? 'text-emerald-800' : 'text-rose-800'}`}>{displayZoneName(zone.name, zone.oneMinuteGenesisQml)}</td>
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
                  const trade = confluenceMapValue<TradeLevels>(zone, directZoneTrades);
                  const entryDecision = confluenceMapValue<DirectZoneEntryDecision>(zone, directZoneEntryDecisions);
                  const outsideTimePreview = !trade ? entryDecision?.previewTrade : undefined;
                  const displayedTrade = trade ?? outsideTimePreview;
                  const mt5Signal = confluenceMapValue<Mt5StoredSignal>(zone, directZoneMt5Signals);
                  if (hasTradeDisplayExpired(displayedTrade) || hasTradeDisplayExpired(mt5Signal)) return null;
                  const measurement = confluenceFirstValue(zone, (member) => (
                    measureTradeableFibZone(member, marketConfig.pipSize)
                  ));
                  return (
                    <React.Fragment key={`double-${zone.id}`}>
                    <tr className={`border-t text-slate-700 ${
                      pending ? 'border-amber-100 bg-amber-50/70' : 'border-emerald-100 bg-emerald-50/50'
                    }`}>
                      <td className="px-2 py-1 font-black text-slate-800">
                        <span>{displayZoneName(zone.name, zone.oneMinuteGenesisQml)}</span>
                        {displayedTapCount(zone) !== undefined && (
                          <span className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[8px] font-black text-sky-800">
                            TAP {displayedTapCount(zone)}
                          </span>
                        )}
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
                        {showFib && zone.swingFibStatus === 'a-plus' && zone.swingFibBand && (
                          <span className="ml-1 rounded bg-violet-100 px-1 py-0.5 text-[8px] font-black text-violet-800">
                            SWING A+ FIB {zone.swingFibBand}
                          </span>
                        )}
                        {showFib && zone.dayFibStatus === 'a-plus' && zone.dayFibBand && (
                          <span className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[8px] font-black text-sky-800">
                            DAY FIB A+ {zone.dayFibBand}
                          </span>
                        )}
                      </td>
                      <td className={`px-2 py-1 font-bold ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {zone.isBuy ? 'BUY' : 'SELL'}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <div>{formatPrice(zone.bottom)} – {formatPrice(zone.top)}</div>
                        {measurement && (
                          <div className="text-[8px] font-black text-slate-600">
                            {formatZonePips(measurement.pips)} PIPS
                          </div>
                        )}
                      </td>
                      <td className={`px-2 py-1 text-center font-black whitespace-nowrap ${
                        zone.isBuy ? 'text-emerald-700' : 'text-rose-700'
                      }`}>
                        {showEngulfing
                          ? displayedTrade
                            ? `${displayedTrade.signal.type} ${displayedTrade.signal.direction === 'bullish' ? 'BULL' : 'BEAR'}`
                            : displayEngulfingLabel(zone) ?? '—'
                          : '—'}
                      </td>
                      <td className={`px-2 py-1 text-right font-black whitespace-nowrap ${
                        trade?.status === 'sl-hit'
                          ? 'text-rose-700'
                          : outsideTimePreview ? 'text-rose-700'
                            : pending ? 'text-amber-700' : 'text-emerald-700'
                      }`}>
                        {isCompletedTrade(outsideTimePreview)
                          ? <TradeStatusText trade={outsideTimePreview!} />
                          : outsideTimePreview || entryDecision?.policy.reason === 'outside-trading-time'
                          ? 'OUTSIDE TRADING TIME'
                          : mt5Signal
                          ? <span className={mt5SignalStatusClassName(mt5Signal)}>{mt5SignalStatusLabel(mt5Signal)}</span>
                          : isCompletedTrade(trade)
                          ? <>{zone.lastTapBarsAgo ?? zone.tapBarsAgo} bars · <TradeStatusText trade={trade!} /></>
                           : pending
                           ? `WAIT ${confirmationLabel} ${confirmationSide} · NO TRADE`
                           : zone.tradeable === false
                             ? 'VALID DOUBLE CHoCH · NO TRADE'
                           : zone.tapTime === undefined
                             ? 'VALID DOUBLE CHoCH · NO TRADE'
                             : marketSymbol === 'XAUUSD' && isGoldZoneOpportunityExpired(
                               zone, displayCandles, granularity, marketConfig.pipSize, Infinity,
                               displayedTrade?.filledAt === undefined ? undefined
                                 : { price: displayedTrade.entry, filledAt: displayedTrade.filledAt, stopLoss: displayedTrade.stopLoss },
                             )
                               ? `${zone.lastTapBarsAgo ?? zone.tapBarsAgo} bars · DISTANCE REACHED · NO NEW ENTRY`
                               : marketSymbol === 'XAUUSD' && (displayedTapCount(zone) ?? 0) > 1
                                 ? `${zone.lastTapBarsAgo ?? zone.tapBarsAgo} bars · TAP ${displayedTapCount(zone)} · NO NEW ENTRY`
                               : `${zone.lastTapBarsAgo ?? zone.tapBarsAgo} bars · ${confirmationLabel} CONFIRMED · TRADE`}
                      </td>
                    </tr>
                    {displayedTrade && !isCompletedTrade(displayedTrade)
                      && <TradeDetailsRow trade={displayedTrade} colSpan={5}
                        mt5Signal={mt5Signal} referenceOnly={outsideTimePreview !== undefined}
                        hideReferenceStatus={outsideTimePreview !== undefined} />}
                    </React.Fragment>
                  );
                })}
                {zoneTableRows.map((zone) => {
                  const scalpTrade = marketSymbol === 'XAUUSD' && scalpingEnabled
                    ? goldScalpingDirectTrades.find((candidate) => (
                      candidate.zoneTimeframe === granularity
                      && displayZoneMembers(zone).some((member) => member.id === candidate.zone.id)
                    ))?.trade
                    : undefined;
                  const scalpPreview = marketSymbol === 'XAUUSD' && scalpingEnabled && tradingTimeEnabled && !scalpTrade
                    ? goldScalpingAccuracyTrades.find((candidate) => (
                      candidate.zoneTimeframe === granularity
                      && displayZoneMembers(zone).some((member) => member.id === candidate.zone.id)
                      && (!isNepalTradingTime(candidate.trade.signal.time + TIMEFRAME_SECONDS[candidate.trade.signal.timeframe])
                        || (candidate.trade.filledAt !== undefined && !isNepalTradingTime(candidate.trade.filledAt)))
                    ))?.trade
                    : undefined;
                  const trade = scalpTrade ?? confluenceMapValue<TradeLevels>(zone, directZoneTrades);
                  const entryDecision = confluenceMapValue<DirectZoneEntryDecision>(zone, directZoneEntryDecisions);
                  const outsideTimePreview = !trade
                    ? entryDecision?.previewTrade ?? scalpPreview : undefined;
                  const historicalEntry = replayDirectHistoryByZone.get(zone.id);
                  const historicalTrade = !trade && !outsideTimePreview ? historicalEntry?.trade : undefined;
                  const engulfingTrade = trade ?? outsideTimePreview ?? historicalTrade;
                  if (hasTradeDisplayExpired(engulfingTrade)) return null;
                  const scalpEngulfingTrade = scalpTrade ?? (!trade ? scalpPreview : undefined);
                  const deepDiscount = historicalEntry
                    ? isDeepDiscountTradeSignal(zone, historicalEntry.trade.signal)
                    : zone.fibBand === 'DB/DT';
                  const mt5Signal = confluenceMapValue<Mt5StoredSignal>(zone, directZoneMt5Signals);
                  const measurement = confluenceFirstValue(zone, (member) => (
                    measureTradeableFibZone(member, marketConfig.pipSize)
                  )) ?? measureListedZone(zone, marketConfig.pipSize);
                  const tapBarsAgo = confluenceTapBarsAgo(zone);
                  const latestTap = confluenceLatestTap(zone);
                  const tapCount = displayedTapCount(zone);
                  const opportunityExpired = marketSymbol === 'XAUUSD'
                    && displayZoneMembers(zone).every((member) => isGoldZoneOpportunityExpired(
                      member, displayCandles, granularity, marketConfig.pipSize,
                      Infinity, trade?.filledAt === undefined ? undefined
                        : { price: trade.entry, filledAt: trade.filledAt, stopLoss: trade.stopLoss },
                    ));
                  const confluenceLabels = confluenceBadgeLabels(zone);
                  const extremeAPlus = displayZoneMembers(zone).some((member) => (
                    extremeAPlusTjl2Selection.extremeZoneIds.has(member.id)
                  ));
                  const extremeAPlusBlocked = displayZoneMembers(zone).some((member) => (
                    extremeAPlusTjl2Selection.blockedZoneIds.has(member.id)
                  ));
                  const pendingChoch = zone.chochClass === 'pending';
                  const chochConfirmationLabel = TJL1_CONFIRMATION_LABELS[granularity].toUpperCase();
                  const chochConfirmationSide = zone.isBuy ? 'ABOVE' : 'BELOW';
                  return (
                  <React.Fragment key={zone.id}>
                  <tr className="border-t border-slate-100 text-slate-700">
                    <td className="px-2 py-1 font-black text-slate-800">
                      <span>{displayConfluenceZoneName(zone)}</span>
                      {latestTap && (
                        <span className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[8px] font-black text-sky-800">
                          TAP {tapCount ?? latestTap.count}
                        </span>
                      )}
                      {extremeAPlus && (
                        <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[8px] font-black text-emerald-800">
                          EXTREME A+
                        </span>
                      )}
                      {extremeAPlusBlocked && (
                        <span className="ml-1 rounded bg-rose-100 px-1 py-0.5 text-[8px] font-black text-rose-800">
                          EXTREME A+ HIGHER
                        </span>
                      )}
                      {deepDiscount && (
                        <span className="ml-1 rounded bg-fuchsia-100 px-1 py-0.5 text-[8px] font-black text-fuchsia-800">
                          DEEP DISCOUNT
                        </span>
                      )}
                      {confluenceLabels.map((label) => (
                        <span key={`${zone.id}-confluence-${label}`} className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[8px] font-black text-slate-700">
                          {label}
                        </span>
                      ))}
                      {zone.majorLiquidity && (
                        <span className="ml-1 rounded bg-cyan-100 px-1 py-0.5 text-[8px] font-black text-cyan-800">
                          MAJOR LIQUIDITY
                        </span>
                      )}
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
                          {pendingChoch
                            ? `WAIT ${chochConfirmationLabel} CLOSE ${chochConfirmationSide}`
                            : zone.chochClass.toUpperCase()}
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
                      {showFib && zone.swingFibStatus === 'a-plus' && zone.swingFibBand && (
                        <span className="ml-1 rounded bg-violet-100 px-1 py-0.5 text-[8px] font-black text-violet-800">
                          SWING A+ FIB {zone.swingFibBand}
                        </span>
                      )}
                      {showFib && zone.dayFibStatus === 'a-plus' && zone.dayFibBand && (
                        <span className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[8px] font-black text-sky-800">
                          DAY FIB A+ {zone.dayFibBand}
                        </span>
                      )}
                    </td>
                    <td className={`px-2 py-1 font-bold ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {zone.isBuy ? 'BUY' : 'SELL'}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <div>{formatPrice(zone.bottom)} – {formatPrice(zone.top)}</div>
                      {measurement && (
                        <div className="text-[8px] font-black text-slate-600">
                          {formatZonePips(measurement.pips)} PIPS
                        </div>
                      )}
                    </td>
                      <td className={`px-2 py-1 text-center font-black whitespace-nowrap ${
                        zone.isBuy ? 'text-emerald-700' : 'text-rose-700'
                      }`}>
                        {showEngulfing ? engulfingTrade ? <>
                          <div>{scalpEngulfingTrade ? 'SCALP ' : ''}{engulfingTrade.signal.type} {engulfingTrade.signal.direction === 'bullish' ? 'BULL' : 'BEAR'}</div>
                          {scalpEngulfingTrade && <div className="text-[8px] text-slate-500">
                            {scalpEngulfingTrade.signal.timeframe} CONFIRMED {formatAccuracyTradeTime(
                              scalpEngulfingTrade.signal.time + TIMEFRAME_SECONDS[scalpEngulfingTrade.signal.timeframe],
                              chartTimeZone,
                            )}
                          </div>}
                        </> : confluenceEngulfingLabel(zone) ?? '—' : '—'}
                    </td>
                    <td className={`px-2 py-1 text-right font-bold whitespace-nowrap ${
                      trade?.status === 'sl-hit' ? 'text-rose-700' : ''
                    }`}>
                      {extremeAPlusBlocked ? (
                        <span className="text-rose-700">EXTREME A+ HIGHER · NO TRADE</span>
                      ) : outsideTimePreview ? (
                        <span className={isCompletedTrade(outsideTimePreview)
                          ? outsideTimePreview.status === 'sl-hit' ? 'text-rose-700' : 'text-emerald-700'
                          : 'text-blue-700'}>
                          {tapBarsAgo} bars ·{' '}
                          {isCompletedTrade(outsideTimePreview)
                            ? tradeStatusLabel(outsideTimePreview)
                            : `ENTRY ${formatPrice(outsideTimePreview.entry)}`}
                        </span>
                      ) : historicalTrade ? (
                        <span className={historicalTrade.status === 'sl-hit' ? 'text-rose-700' : 'text-indigo-700'}>
                          {tapBarsAgo} bars ·{' '}
                          {historicalEntry?.tradingTimeBlocked
                            ? isCompletedTrade(historicalTrade)
                              ? tradeStatusLabel(historicalTrade)
                              : `ENTRY ${formatPrice(historicalTrade.entry)}`
                            : `ENTRY ${formatPrice(historicalTrade.entry)} · REPLAY ${tradeStatusLabel(historicalTrade)}`}
                        </span>
                      ) : mt5Signal ? (
                        <span className={mt5SignalStatusClassName(mt5Signal)}>
                          {mt5SignalStatusLabel(mt5Signal)}
                        </span>
                      ) : isCompletedTrade(trade) ? (
                        <span className={trade?.status === 'sl-hit' ? 'text-rose-700' : 'text-emerald-700'}>
                          {replayIndex !== null && historicalEntry && `ENTRY ${formatPrice(trade!.entry)} · `}
                          {tapBarsAgo} bars · <TradeStatusText trade={trade!} />
                        </span>
                      ) : opportunityExpired ? (
                        <span className="text-rose-700">DISTANCE REACHED · NO NEW ENTRY</span>
                      ) : marketSymbol === 'XAUUSD' && (tapCount ?? 0) > 1 ? (
                        <span className="text-rose-700">TAP {tapCount} · NO NEW ENTRY</span>
                      ) : entryDecision && !entryDecision.policy.allowed ? (
                        <span className="text-rose-700">
                          {directEntryPolicyLabel(entryDecision.policy)} · NO TRADE
                        </span>
                      ) : entryDecision?.policy.allowed && !trade ? (
                        <span className="text-rose-700">ENTRY INVALID · NO TRADE</span>
                      ) : scalpTrade ? (
                        <span className="text-indigo-700">SCALP ENTRY · {scalpTrade.signal.timeframe} · 1:{scalpTrade.rewardRisk}</span>
                      ) : <>
                        <span className="text-slate-500">{tapBarsAgo} bars</span>
                        <span className={!confluenceIsTradeable(zone) ? 'ml-1 text-rose-700' : 'ml-1 text-emerald-700'}>
                           - {pendingChoch
                             ? `WAIT ${chochConfirmationLabel} CLOSE ${chochConfirmationSide} Â· NO TRADE`
                             : !confluenceIsTradeable(zone)
                             ? 'NO TRADE'
                            : entryDecision?.oppositePositionOpen
                              ? 'OPPOSITE OPEN · TRADE 1:1'
                              : entryDecision?.policy.reason === 'volume-confirmed'
                                ? `VOLUME PASSED · TRADE 1:${trade?.rewardRisk ?? 3}`
                                : 'TRADE'}
                        </span>
                      </>}
                    </td>
                  </tr>
                  {(trade ?? outsideTimePreview)
                    && !isCompletedTrade(trade ?? outsideTimePreview)
                    && <TradeDetailsRow
                      trade={(trade ?? outsideTimePreview)!}
                      colSpan={5}
                      oppositePositionOpen={entryDecision?.oppositePositionOpen}
                      mt5Signal={mt5Signal}
                      referenceOnly={outsideTimePreview !== undefined}
                    />}
                  {historicalTrade && (
                    <TradeDetailsRow trade={historicalTrade} colSpan={5}
                      referenceOnly={historicalEntry?.tradingTimeBlocked}
                      hideReferenceStatus={historicalEntry?.tradingTimeBlocked} />
                  )}
                  </React.Fragment>
                  );
                })}
                {retainedTradeZoneRows.map((zone) => {
                  const trade = directZoneTrades.get(zone.id)!;
                  const mt5Signal = directZoneMt5Signals.get(zone.id);
                  if (hasTradeDisplayExpired(trade) || hasTradeDisplayExpired(mt5Signal)) return null;
                  return (
                    <React.Fragment key={`retained-trade-${zone.id}`}>
                      <tr className="border-t border-slate-200 bg-slate-50 text-slate-600">
                        <td className="px-2 py-1 font-black">{displayZoneName(zone.name, zone.oneMinuteGenesisQml)}</td>
                        <td className={`px-2 py-1 font-bold ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {zone.isBuy ? 'BUY' : 'SELL'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {formatPrice(zone.bottom)} – {formatPrice(zone.top)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-center font-black">
                          {displayEngulfingLabel(zone) ?? '—'}
                        </td>
                        <td className={`whitespace-nowrap px-2 py-1 text-right font-black ${mt5Signal
                          ? mt5SignalStatusClassName(mt5Signal)
                          : trade.status === 'sl-hit' ? 'text-rose-700' : 'text-emerald-700'
                        }`}>
                          {zone.tapBarsAgo} bars · {mt5Signal
                            ? mt5SignalStatusLabel(mt5Signal)
                            : <TradeStatusText trade={trade} />}
                        </td>
                      </tr>
                      {!isCompletedTrade(trade) && (
                        <TradeDetailsRow trade={trade} colSpan={5} mt5Signal={mt5Signal} />
                      )}
                    </React.Fragment>
                  );
                })}
                {pendingConfirmationRows.length === 0 && doubleChochRows.length === 0
                  && zoneTableRows.length === 0 && retainedTradeZoneRows.length === 0
                  && retainedDirectChartTradesForTimeframe.length === 0
                  && scalpEntryTableRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-center text-slate-400">No active zone rows</td>
                  </tr>
                )}
              </tbody>
            </table>
            </>}
          </div>
          {showAccuracyTable && (
            <EngulfingAccuracyTable
              records={timeframeAccuracyRecords}
              allRecords={replayVisibleAccuracyRecords}
              timeframe={granularity}
              showAllTrades={showAllAccuracyTrades}
              historyAsOf={replayResultCutoff ?? Math.floor(Date.now() / 1000)}
              timeZone={chartTimeZone}
              marketSymbol={marketSymbol}
              entryArrowsVisible={showEntryArrows}
              onVisibleRecordIdsChange={setVisibleAccuracyRecordIds}
              onClose={() => {
                setShowAccuracyTable(false);
                setVisibleAccuracyRecordIds(null);
                setShowAccuracyOptions(false);
              }}
            />
          )}
          {showJournal && (
            <TradeJournal
              records={visibleCanonicalTradeRecords}
              timeframe={granularity}
              marketSymbol={marketSymbol}
              historyAsOf={replayResultCutoff ?? Math.floor(Date.now() / 1000)}
              timeZone={chartTimeZone}
              onClose={() => setShowJournal(false)}
            />
          )}
          <MultiTimeframeEntryTable rows={mtfRows} liveTrades={liveMtfTableTrades}
            records={recordedMtfTrades} timeZone={chartTimeZone}
            entryCandles={Object.fromEntries(TIMEFRAMES.map(({ value }) => [value, tableTimeframeData[value]?.candles ?? []]))}
            asOf={tradeDisplayAsOf} />
          <MultiTimeframeTrendTable rows={trendTableRows} replayActive={replayIndex !== null} />
          {isLoading && candles.length === 0 && !error && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-white/85">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                Loading {marketSymbol} market candles…
              </div>
            </div>
          )}

          {error && candles.length === 0 && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-white/95 p-6">
              <div className="max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-5 text-center shadow-sm">
                <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-rose-600" />
                <h2 className="font-black text-rose-900">{marketSymbol} candle feed is unavailable</h2>
                <p className="mt-2 text-sm text-rose-800">{error}</p>
                <p className="mt-3 text-xs leading-relaxed text-slate-600">
                  The selected chart feed is unavailable. Automatic execution remains independent and always uses candles from the connected MT5 broker.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] font-bold text-slate-500">
          <span className={`flex items-center gap-1 ${source.startsWith('MetaTrader 5') ? 'text-emerald-700' : 'text-amber-700'}`}>
            {source.startsWith('MetaTrader 5')
              ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {source.startsWith('MetaTrader 5')
              ? 'MT5 broker chart data'
              : replayIndex !== null ? 'TradingView replay data' : 'OANDA live chart data'}
          </span>
          <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Symbol: {marketConfig.shortName}</span>
          <span>OHLC source: {source}</span>
          <span>Structure: HH · HL · LH · LL · BOS · CHoCH</span>
          <span>Genesis Low: {formatPrice(structure.genesis?.price)}</span>
          <span>Active MG zones: {displayZones.filter((zone) => zone.category === 'mg' && zone.active).length}</span>
          <span>Invalid zones: {displayZones.filter((zone) => !zone.active).length}</span>
          <span>S/D: {['H1', 'H4', 'D'].includes(granularity) ? displayZones.filter((zone) => zone.category === 'supplyDemand').length : 'H1+ ONLY'}</span>
          <span>Last candle: {latestCandle?.complete === false ? 'FORMING' : 'COMPLETE'}</span>
          <span className="ml-auto">Updated: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}</span>
        </div>
      </div>
    </section>
  );
};
