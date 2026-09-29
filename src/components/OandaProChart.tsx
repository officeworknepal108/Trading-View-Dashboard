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

type OandaGranularity = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D';
type MarketGranularity = OandaGranularity | 'W';

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

const TIMEFRAME_SECONDS: Record<MarketGranularity, number> = {
  M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D: 86400, W: 604800,
};

const TJL1_CONFIRMATION_SECONDS: Partial<Record<MarketGranularity, number>> = {
  M1: 300,
  M5: 900,
  M15: 3600,
  M30: 3600,
  H1: 14400,
  H4: 86400,
  D: 604800,
};

const VIP_SUPPORT_GRANULARITY: Partial<Record<OandaGranularity, MarketGranularity>> = {
  M1: 'M15', M5: 'H1', M15: 'H4', H1: 'D', H4: 'W',
};

const GRANULARITY_LABELS: Record<MarketGranularity, string> = {
  M1: '1m', M5: '5m', M15: '15m', M30: '30m', H1: '1h', H4: '4h', D: '1D', W: '1W',
};

const TJL1_CONFIRMATION_LABELS: Record<OandaGranularity, string> = {
  M1: '5m', M5: '15m', M15: '1h', M30: '1h', H1: '4h', H4: '1D', D: '1W',
};

function formatPrice(value: number | undefined): string {
  return Number.isFinite(value) ? Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }) : '—';
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
  const structureLinesRef = useRef<StructureLine[]>([]);
  const structureMarkersRef = useRef<any[]>([]);
  const issMarkersRef = useRef<any[]>([]);
  const showMgZonesRef = useRef(true);
  const showSupplyDemandRef = useRef(true);
  const showStructureRef = useRef(true);
  const showIssRef = useRef(true);
  const showInvalidZonesRef = useRef(false);
  const redrawZonesRef = useRef<() => void>(() => undefined);
  const hasFittedRef = useRef(false);
  const replayTimeRef = useRef<number | null>(null);
  const pendingReplayViewportRef = useRef<{ fromOffset: number; toOffset: number } | null>(null);
  const loadRequestIdRef = useRef(0);
  const loadedGranularityRef = useRef<OandaGranularity>('H1');
  const candlesRef = useRef<OandaCandle[]>([]);
  const replaySelectingRef = useRef(false);
  const replaySelectionIndexRef = useRef<number | null>(null);
  const syncReplaySelectionLineRef = useRef<() => void>(() => undefined);
  const [granularity, setGranularity] = useState<OandaGranularity>('H1');
  const [candles, setCandles] = useState<OandaCandle[]>([]);
  const [vipCandles, setVipCandles] = useState<OandaCandle[]>([]);
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
  const [showInvalidZones, setShowInvalidZones] = useState(false);
  const [showZoneTable, setShowZoneTable] = useState(true);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySelecting, setReplaySelecting] = useState(false);
  const [replaySelectionIndex, setReplaySelectionIndex] = useState<number | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);

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

  const vipSupportGranularity = VIP_SUPPORT_GRANULARITY[granularity];
  const vipDisplayCandles = useMemo(() => {
    if (!vipSupportGranularity || displayCandles.length === 0) return [];
    const lastSourceCandle = displayCandles[displayCandles.length - 1];
    const cutoff = lastSourceCandle.time
      + (lastSourceCandle.complete ? TIMEFRAME_SECONDS[granularity] : 0);
    return vipCandles.filter((candle) => (
      candle.complete
      && candle.time + TIMEFRAME_SECONDS[vipSupportGranularity] <= cutoff
    ));
  }, [displayCandles, granularity, vipCandles, vipSupportGranularity]);

  const vipStructure = useMemo(() => (
    vipSupportGranularity
      ? analyzeMarketStructure(vipDisplayCandles, {
        allowSupplyDemand: ['H1', 'H4', 'D'].includes(vipSupportGranularity),
        sourceBarSeconds: TIMEFRAME_SECONDS[vipSupportGranularity],
        confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[vipSupportGranularity],
        zoneVisualBars: 30,
      })
      : null
  ), [vipDisplayCandles, vipSupportGranularity]);

  const structure = useMemo(
    () => analyzeMarketStructure(displayCandles, {
      allowSupplyDemand: ['H1', 'H4', 'D'].includes(granularity),
      sourceBarSeconds: TIMEFRAME_SECONDS[granularity],
      confirmationBarSeconds: TJL1_CONFIRMATION_SECONDS[granularity],
      zoneVisualBars: 30,
      vipSupport: vipSupportGranularity && vipStructure
        ? { timeframe: GRANULARITY_LABELS[vipSupportGranularity], zones: vipStructure.zones }
        : undefined,
    }),
    [displayCandles, granularity, vipStructure, vipSupportGranularity],
  );

  const latestCandle = hoveredCandle || displayCandles[displayCandles.length - 1] || null;
  const previousCandle = displayCandles.length > 1 ? displayCandles[displayCandles.length - 2] : null;
  const zoneTableRows = useMemo(() => structure.zones
    .filter((zone) => zone.active && zone.status === 'valid'
      && zone.tapTime !== undefined && (zone.tapBarsAgo ?? Infinity) <= 50)
    .sort((a, b) => (b.tapTime ?? b.startTime) - (a.tapTime ?? a.startTime))
    .slice(0, 8), [structure.zones]);
  const pendingTjlRows = useMemo(() => structure.zones
    .filter((zone) => zone.name === 'TJL1' && zone.active && zone.status === 'pending')
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 4), [structure.zones]);
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
    layer.replaceChildren();
    if (displayCandles.length === 0) return;

    const rightEdge = Math.max(0, host.clientWidth - 72);
    for (const zone of zonesRef.current) {
      const visible = zone.category === 'mg'
        ? showMgZonesRef.current
        : zone.category === 'iss'
          ? showIssRef.current
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
      const isMg = zone.category === 'mg';
      const pending = zone.status === 'pending';
      const confirmationLabel = TJL1_CONFIRMATION_LABELS[granularity];
      const inactive = !zone.active;
      const rejected = zone.status === 'rejected';
      const fill = inactive
        ? 'rgba(100, 116, 139, 0.10)'
        : pending
        ? demand ? 'rgba(16, 185, 129, 0.13)' : 'rgba(244, 63, 94, 0.12)'
        : isIss
        ? 'rgba(217, 119, 6, 0.14)'
        : demand ? 'rgba(16, 185, 129, 0.13)' : 'rgba(244, 63, 94, 0.12)';
      const border = inactive
        ? 'rgba(71, 85, 105, 0.72)'
        : pending ? demand ? 'rgba(5, 150, 105, 0.72)' : 'rgba(225, 29, 72, 0.72)' : isIss ? 'rgba(180, 83, 9, 0.72)' : demand ? 'rgba(5, 150, 105, 0.65)' : 'rgba(225, 29, 72, 0.65)';
      box.style.position = 'absolute';
      box.style.left = `${left}px`;
      box.style.width = `${right - left}px`;
      box.style.top = `${Math.min(top, bottom)}px`;
      box.style.height = `${Math.max(2, Math.abs(bottom - top))}px`;
      box.style.background = fill;
      box.style.borderTop = `1px solid ${border}`;
      box.style.borderBottom = `1px solid ${border}`;

      const label = document.createElement('span');
      const name = isMg || isIss ? zone.name : demand ? 'DEMAND' : 'SUPPLY';
      label.textContent = inactive
        ? rejected ? `${name} · REJECTED` : name
        : `${name}${pending ? ' · PENDING' : zone.name === 'TJL1' ? ' · VALID' : ''}`;
      if (inactive) {
        label.textContent = rejected ? `${name} \u00b7 REJECTED` : name;
      } else if (zone.name === 'TJL1') {
        label.textContent = pending
          ? `TJL1 · PENDING ${confirmationLabel} ${zone.isBuy ? 'ABOVE' : 'BELOW'}`
          : 'VALID TJL1';
      } else if (zone.name === 'TJL2') {
        label.textContent = 'TJL2';
      }
      label.style.position = 'absolute';
      label.style.right = '4px';
      label.style.top = '2px';
      label.style.fontSize = '9px';
      label.style.lineHeight = '12px';
      label.style.fontWeight = '800';
      label.style.color = inactive ? '#475569' : pending ? demand ? '#047857' : '#be123c' : isIss ? '#b45309' : demand ? '#047857' : '#be123c';
      box.appendChild(label);
      layer.appendChild(box);
    }

    if (showStructureRef.current || showIssRef.current) {
      const namespace = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(namespace, 'svg');
      svg.setAttribute('width', String(host.clientWidth));
      svg.setAttribute('height', String(host.clientHeight));
      svg.style.position = 'absolute';
      svg.style.inset = '0';
      svg.style.overflow = 'hidden';

      for (const structureLine of structureLinesRef.current) {
        if (structureLine.type === 'iss' && !showIssRef.current) continue;
        if (structureLine.type !== 'iss' && !showStructureRef.current) continue;
        const x1 = chart.timeScale().timeToCoordinate(structureLine.fromTime as UTCTimestamp);
        const x2 = chart.timeScale().timeToCoordinate(structureLine.toTime as UTCTimestamp);
        const y1 = series.priceToCoordinate(structureLine.fromPrice);
        const y2 = series.priceToCoordinate(structureLine.toPrice);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

        const bullish = structureLine.direction === 'bullish';
        const color = bullish ? '#0f766e' : '#be123c';
        const line = document.createElementNS(namespace, 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', structureLine.type === 'swing' ? '1' : '0.8');
        line.setAttribute('stroke-opacity', structureLine.type === 'swing' ? '0.52' : '0.42');
        if (structureLine.type !== 'swing') line.setAttribute('stroke-dasharray', '4 3');
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
          const candle = displayCandles.find((item) => Number(item.time) === Number(marker.time));
          if (!candle) continue;
          const x = chart.timeScale().timeToCoordinate(marker.time as UTCTimestamp);
          const isHigh = marker.position === 'aboveBar';
          const markerPrice = isHigh ? candle.high : candle.low;
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
                : showSupplyDemandRef.current;
            return visible
              && (zone.active || showInvalidZonesRef.current)
              && Number(marker.time) >= zone.startTime
              && Number(marker.time) <= zone.endTime
              && markerPrice >= zone.bottom
              && markerPrice <= zone.top;
          });
          const offsetForCollision = overlapsStructureMarker || overlapsVisibleZone;
          const text = document.createElementNS(namespace, 'text');
          text.setAttribute('x', String(x + (offsetForCollision ? -10 : 0)));
          text.setAttribute('y', String(y + (isHigh ? -5 : 11)));
          text.setAttribute('text-anchor', offsetForCollision ? 'end' : 'middle');
          text.setAttribute('fill', '#2563eb');
          text.setAttribute('fill-opacity', '0.88');
          text.setAttribute('font-size', '10');
          text.setAttribute('font-weight', '700');
          text.textContent = marker.text;
          svg.appendChild(text);
        }
      }
      layer.appendChild(svg);
    }
  }, [displayCandles.length, granularity]);

  redrawZonesRef.current = redrawZones;

  useEffect(() => {
    zonesRef.current = structure.zones;
    structureLinesRef.current = structure.lines;
    structureMarkersRef.current = structure.markers;
    issMarkersRef.current = structure.issMarkers;
    showMgZonesRef.current = showMgZones;
    showSupplyDemandRef.current = showSupplyDemand;
    showStructureRef.current = showStructure;
    showIssRef.current = showIss;
    showInvalidZonesRef.current = showInvalidZones;
    const frame = window.requestAnimationFrame(redrawZones);
    return () => window.cancelAnimationFrame(frame);
  }, [redrawZones, showInvalidZones, showIss, showMgZones, showStructure, showSupplyDemand, structure.issMarkers, structure.lines, structure.markers, structure.zones]);

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
      const [payload, vipPayload] = await Promise.all([
        requestCandles(granularity),
        vipSupportGranularity ? requestCandles(vipSupportGranularity) : Promise.resolve(null),
      ]);
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
      setVipCandles(vipPayload?.candles || []);
      if (nextReplayIndex !== null) setReplayIndex(nextReplayIndex);
      setHoveredCandle(null);
      setSource(payload.source || 'TradingView WebSocket · OANDA:XAUUSD · unofficial');
      setLastUpdated(payload.fetchedAt || new Date().toISOString());
      setError(null);
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
  }, [granularity, vipSupportGranularity]);

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
        barSpacing: 7,
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
      window.requestAnimationFrame(() => {
        redrawZonesRef.current();
        syncReplaySelectionLineRef.current();
      });
    });
    const handleVisibleRangeChange = () => {
      redrawZonesRef.current();
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
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

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
      chart.timeScale().fitContent();
      chart.timeScale().scrollToRealTime();
      hasFittedRef.current = true;
    }
    window.requestAnimationFrame(() => redrawZonesRef.current());
  }, [displayCandles, replayIndex, showIss, showStructure, structure.issMarkers, structure.markers]);

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

  return (
    <section className="h-full w-full bg-slate-100 p-3 sm:p-4 overflow-hidden">
      <div className="h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-2 bg-white">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
            <div className="h-8 w-8 rounded-full bg-amber-100 text-amber-700 grid place-items-center font-black">Au</div>
            <div>
              <div className="text-sm font-black text-slate-900 leading-tight">Gold Spot / U.S. Dollar</div>
              <div className="text-[10px] font-bold tracking-wider text-slate-500">XAUUSD · OANDA</div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {TIMEFRAMES.map((timeframe) => (
              <button
                key={timeframe.value}
                onClick={() => changeTimeframe(timeframe.value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-black transition ${
                  granularity === timeframe.value
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                {timeframe.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
            {replayIndex === null ? (
              <button
                onClick={openReplaySelector}
                disabled={candles.length < 2}
                className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[10px] font-black text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Choose a chart bar, then start candle-by-candle replay from that point"
              >
                ▶ REPLAY
              </button>
            ) : (
              <>
                <button
                  onClick={() => setReplayIndex((index) => Math.max(1, (index ?? 1) - 1))}
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-[10px] font-black text-violet-700 hover:bg-violet-50"
                  title="Previous candle"
                >
                  ‹
                </button>
                <button
                  onClick={openReplaySelector}
                  className={`rounded-md border px-2 py-1.5 text-[10px] font-black transition ${
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
                  className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[10px] font-black text-violet-700 hover:bg-violet-100"
                  title={replayPlaying ? 'Pause replay' : 'Play replay'}
                >
                  {replayPlaying ? '❚❚ PAUSE' : '▶ PLAY'}
                </button>
                <button
                  onClick={() => setReplayIndex((index) => Math.min(candles.length - 1, (index ?? 1) + 1))}
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-[10px] font-black text-violet-700 hover:bg-violet-50"
                  title="Next candle"
                >
                  ›
                </button>
                <select
                  value={replaySpeed}
                  onChange={(event) => setReplaySpeed(Number(event.target.value))}
                  className="rounded-md border border-violet-200 bg-white px-1.5 py-1.5 text-[10px] font-black text-violet-700"
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
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-black text-slate-500 hover:bg-slate-100"
                  title="Exit replay and return to the live chart"
                >
                  LIVE
                </button>
                <span className="px-1 text-[10px] font-bold text-violet-700">
                  {displayCandles.length}/{candles.length}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
            <button
              onClick={() => setShowStructure((value) => !value)}
              className={`rounded-md border px-2.5 py-1.5 text-[10px] font-black transition ${
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
              className={`rounded-md border px-2.5 py-1.5 text-[10px] font-black transition ${
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
              className={`rounded-md border px-2.5 py-1.5 text-[10px] font-black transition ${
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
              className={`rounded-md border px-2.5 py-1.5 text-[10px] font-black transition ${
                showIss ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide ISS 0–5 wave markings"
            >
              ISS 5-WAVE {showIss ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setShowInvalidZones((value) => !value)}
              className={`rounded-md border px-2.5 py-1.5 text-[10px] font-black transition ${
                showInvalidZones
                  ? 'border-slate-400 bg-slate-200 text-slate-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              title="Show or hide rejected, invalidated, and superseded zones"
            >
              INVALID ZONES {showInvalidZones ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${
              error
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}>
              {error ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
              {error ? 'FEED DISCONNECTED' : 'TRADINGVIEW CONNECTED'}
            </div>
            <button
              onClick={() => setRefreshKey((value) => value + 1)}
              className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
              title="Refresh TradingView OANDA:XAUUSD candles"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => void toggleFullscreen()}
              className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
              title="Fullscreen chart"
            >
              <Maximize2 className="h-4 w-4" />
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
          <div className={`pointer-events-auto absolute left-3 top-3 z-20 overflow-hidden rounded-md border border-slate-300 bg-white/95 shadow-sm ${showZoneTable ? 'w-[330px]' : 'w-auto'}`}>
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
                  <th className="px-2 py-1 text-right font-bold">Tap / Trade</th>
                </tr>
              </thead>
              <tbody>
                {pendingTjlRows.map((zone) => (
                  <tr key={zone.id} className={`border-t text-slate-700 ${zone.isBuy ? 'border-emerald-100 bg-emerald-50/70' : 'border-rose-100 bg-rose-50/70'}`}>
                    <td className={`px-2 py-1 font-black ${zone.isBuy ? 'text-emerald-800' : 'text-rose-800'}`}>TJL1</td>
                    <td className={`px-2 py-1 font-bold ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {zone.isBuy ? 'BUY' : 'SELL'}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatPrice(zone.bottom)} – {formatPrice(zone.top)}</td>
                    <td className={`px-2 py-1 text-right font-black whitespace-nowrap ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                      WAIT {TJL1_CONFIRMATION_LABELS[granularity].toUpperCase()} {zone.isBuy ? 'ABOVE' : 'BELOW'}
                    </td>
                  </tr>
                ))}
                {zoneTableRows.map((zone) => (
                  <tr key={zone.id} className="border-t border-slate-100 text-slate-700">
                    <td className="px-2 py-1 font-black text-slate-800">
                      <span>{zone.name}</span>
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
                          {zone.chochClass === 'pending' ? 'WAIT' : zone.chochClass.toUpperCase()}
                        </span>
                      )}
                      {zone.chochClass === 'vip' && zone.vipSupportTimeframe && zone.vipSupportZone && (
                        <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[8px] font-black text-amber-700">
                          {zone.vipSupportTimeframe} {zone.vipSupportZone}
                        </span>
                      )}
                    </td>
                    <td className={`px-2 py-1 font-bold ${zone.isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {zone.isBuy ? 'BUY' : 'SELL'}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatPrice(zone.bottom)} – {formatPrice(zone.top)}</td>
                    <td className="px-2 py-1 text-right font-bold whitespace-nowrap">
                      <span className="text-slate-500">{zone.tapBarsAgo} bars</span>
                      <span className={zone.tradeable === false ? 'ml-1 text-rose-700' : 'ml-1 text-emerald-700'}>
                        - {zone.tradeable === false ? 'NO TRADE' : 'TRADE'}
                      </span>
                    </td>
                  </tr>
                ))}
                {pendingTjlRows.length === 0 && zoneTableRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-center text-slate-400">No active zone rows</td>
                  </tr>
                )}
              </tbody>
            </table>
            </>}
          </div>
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
