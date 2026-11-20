import type { StructureCandle } from './marketStructure';
import type { Mt5SignalInput } from './mt5Automation';
import type { JournalTradeRecord } from '../components/TradeJournal';

export const BOLLINGER_M5_MAX_SL_PIPS = 80;
export const BOLLINGER_M5_RULE = 'M5 BB20/2 re-entry, EMA200, SuperTrend ATR10/3, ADX14 >=15, confirmed H4 swing(3) break bias. One next-open entry, two-candle stop +0.2 ATR14 (minimum 1 ATR, maximum 80 pips; wider setups skipped), fixed 1.5R target. No engulfing, volume, partial close or breakeven.';
export interface BollingerInput {
  dataSource?: 'ARCHIVE' | 'OANDA'; datasetId?: string;
  studyCandleCount?: number; warmupCandleCount?: number;
  m5: StructureCandle[]; h4: StructureCandle[]; cutoff: number; from: number;
  cashRisk: number; capital: number; spread: number; commissionPerLot: number;
  contractSize: number; lotStep: number; minimumLot: number;
}
export interface BollingerRecord {
  id: string; signalAt: number; entryAt: number; direction: 'BUY' | 'SELL';
  entry: number; stopLoss: number; takeProfit: number; lot: number; initialRisk: number;
  outcome: 'TP' | 'SL' | 'OPEN' | 'UNCERTAIN'; resolvedAt?: number; exit?: number;
  pnl?: number; r?: number; reason?: string;
}
export interface BollingerResult {
  settings: Omit<BollingerInput, 'm5' | 'h4'>; records: BollingerRecord[];
  skipped: number; unknownBias: number; coverage: { first?: number; last?: number; h4First?: number; h4Last?: number };
}
export const BOLLINGER_STUDY_DEFAULTS = { cashRisk: 50, capital: 5000, spread: 0.3,
  commissionPerLot: 7, contractSize: 100, lotStep: 0.01, minimumLot: 0.01 };

/** Wilder smoothing starts with the arithmetic mean, never with future samples. */
function wilder(values: number[], length: number): number[] {
  const output = values.map(() => NaN); let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < length) sum += values[i];
    if (i === length - 1) output[i] = sum / length;
    else if (i >= length) output[i] = (output[i - 1] * (length - 1) + values[i]) / length;
  }
  return output;
}
export function bollingerIndicators(bars: StructureCandle[]) {
  const tr = bars.map((b, i) => Math.max(b.high - b.low, i ? Math.abs(b.high - bars[i - 1].close) : 0,
    i ? Math.abs(b.low - bars[i - 1].close) : 0));
  const atr = wilder(tr, 14), stAtr = wilder(tr, 10);
  const plus = wilder(bars.map((b, i) => { const up = i ? b.high - bars[i - 1].high : 0;
    const down = i ? bars[i - 1].low - b.low : 0; return up > down && up > 0 ? up : 0; }), 14);
  const minus = wilder(bars.map((b, i) => { const down = i ? bars[i - 1].low - b.low : 0;
    const up = i ? b.high - bars[i - 1].high : 0; return down > up && down > 0 ? down : 0; }), 14);
  const dx = bars.map((_, i) => plus[i] + minus[i] > 0 ? 100 * Math.abs(plus[i] - minus[i]) / (plus[i] + minus[i]) : 0);
  const adxTail = wilder(dx.slice(13), 14);
  let ema = NaN, upper = NaN, lower = NaN, trend = 0;
  return bars.map((b, i) => {
    if (i === 199) ema = bars.slice(0, 200).reduce((s, c) => s + c.close, 0) / 200;
    else if (i >= 200) ema += 2 / 201 * (b.close - ema);
    if (Number.isFinite(stAtr[i])) {
      const u = (b.high + b.low) / 2 + 3 * stAtr[i], l = (b.high + b.low) / 2 - 3 * stAtr[i];
      const oldUpper = upper, oldLower = lower;
      upper = !Number.isFinite(upper) || u < upper || bars[i - 1]?.close > upper ? u : upper;
      lower = !Number.isFinite(lower) || l > lower || bars[i - 1]?.close < lower ? l : lower;
      if (!trend) trend = b.close >= (b.high + b.low) / 2 ? 1 : -1;
      else if (trend === -1 && b.close > oldUpper) trend = 1;
      else if (trend === 1 && b.close < oldLower) trend = -1;
    }
    const window = i >= 19 ? bars.slice(i - 19, i + 1) : [];
    const mean = window.length ? window.reduce((s, c) => s + c.close, 0) / 20 : NaN;
    const sd = Math.sqrt(window.reduce((s, c) => s + (c.close - mean) ** 2, 0) / 20);
    return { ema, lower: mean - 2 * sd, upper: mean + 2 * sd, atr: atr[i], adx: adxTail[i - 13] ?? NaN, trend };
  });
}

/** Pivot j is usable only when j+3 has closed. Bias changes on a later close breaking that pivot. */
export function bollingerH4Bias(bars: StructureCandle[]): number[] {
  let high = Infinity, low = -Infinity, bias = 0;
  return bars.map((b, i) => {
    const j = i - 3;
    if (j >= 3) {
      const range = bars.slice(j - 3, j + 4);
      if (range.every((c, k) => k === 3 || c.high < bars[j].high)) high = bars[j].high;
      if (range.every((c, k) => k === 3 || c.low > bars[j].low)) low = bars[j].low;
    }
    if (b.close > high) bias = 1;
    else if (b.close < low) bias = -1;
    return bias;
  });
}

function clean(bars: StructureCandle[], cutoff: number, seconds: number, includeOpen = false) {
  const map = new Map<number, StructureCandle>();
  for (const b of bars) {
    if (![b.time, b.open, b.high, b.low, b.close].every(Number.isFinite)
      || b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) || b.low > b.high) throw new Error('Invalid candle data.');
    if (b.time <= cutoff && (includeOpen || b.complete !== false && b.time + seconds <= cutoff)) map.set(b.time, b);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** Mid OHLC becomes the executable closing quote: bid for buys, ask for sells. */
export function resolveBollingerBar(r: BollingerRecord, mid: StructureCandle,
  costs: Pick<BollingerInput, 'spread' | 'commissionPerLot' | 'contractSize' | 'cutoff'>): void {
  if (mid.complete === false || mid.time + 300 > costs.cutoff || r.outcome !== 'OPEN') return;
  const sign = r.direction === 'BUY' ? 1 : -1, shift = -sign * costs.spread / 2;
  const bar = { open: mid.open + shift, high: mid.high + shift, low: mid.low + shift };
  const gapSl = sign * (bar.open - r.stopLoss) <= 0, gapTp = sign * (bar.open - r.takeProfit) >= 0;
  const sl = sign === 1 ? bar.low <= r.stopLoss : bar.high >= r.stopLoss;
  const tp = sign === 1 ? bar.high >= r.takeProfit : bar.low <= r.takeProfit;
  if (!sl && !tp && !gapSl && !gapTp) return;
  r.resolvedAt = mid.time + 300;
  if (!gapSl && !gapTp && sl && tp) { r.outcome = 'UNCERTAIN'; r.reason = 'Both SL and TP touched in one M5 candle; tick order unavailable.'; return; }
  r.outcome = gapSl || sl && !gapTp ? 'SL' : 'TP';
  r.exit = gapSl ? bar.open : r.outcome === 'SL' ? r.stopLoss : r.takeProfit;
  r.pnl = (r.exit - r.entry) * sign * r.lot * costs.contractSize - costs.commissionPerLot * r.lot;
  r.r = r.pnl / r.initialRisk;
}

export function runBollingerStudy(input: BollingerInput, progress?: (done: number, total: number) => void): BollingerResult {
  if (![input.from, input.cutoff, input.cashRisk, input.capital, input.spread, input.commissionPerLot,
    input.contractSize, input.lotStep, input.minimumLot].every(Number.isFinite)
    || input.from >= input.cutoff || input.cashRisk <= 0 || input.capital <= 0 || input.spread < 0
    || input.commissionPerLot < 0 || input.contractSize <= 0 || input.lotStep <= 0 || input.minimumLot <= 0) throw new Error('Invalid study period, sizing or costs.');
  const bars = clean(input.m5, input.cutoff, 300, true), closed = bars.filter(b => b.complete !== false && b.time + 300 <= input.cutoff);
  // A partial candle may supply its opening price, never its future high/low/close.
  const indicators = bollingerIndicators(closed), h4 = clean(input.h4, input.cutoff, 14400), bias = bollingerH4Bias(h4);
  const records: BollingerRecord[] = []; let active: BollingerRecord | undefined, skipped = 0, unknownBias = 0, h = -1;
  const byTime = new Map(bars.map(b => [b.time, b]));
  for (let i = 0; i < closed.length; i++) {
    const bar = closed[i];
    if (active) {
      if (active.outcome === 'OPEN' && i && bar.time !== closed[i - 1].time + 300) { active.outcome = 'UNCERTAIN'; active.resolvedAt = bar.time;
        active.reason = 'History gap while position was open; exit path unavailable.'; }
      else resolveBollingerBar(active, bar, input);
      if (active.reason?.startsWith('History gap')) {
        // Conservatively retain the occupancy until an exit boundary is observed again.
        const shift = (active.direction === 'BUY' ? -1 : 1) * input.spread / 2;
        if (active.direction === 'BUY' ? bar.low + shift <= active.stopLoss || bar.high + shift >= active.takeProfit
          : bar.high + shift >= active.stopLoss || bar.low + shift <= active.takeProfit) active = undefined;
        else continue;
      } else if (active.outcome !== 'OPEN') active = undefined;
    }
    if (i % 2000 === 0) progress?.(i, closed.length);
    if (i < 200 || active || bar.time + 300 < input.from || closed[i - 1].time + 300 !== bar.time) continue;
    const a = indicators[i], p = indicators[i - 1], previous = closed[i - 1];
    const sign = previous.close < p.lower && bar.close > a.lower && bar.close < a.upper && bar.close > bar.open ? 1
      : previous.close > p.upper && bar.close < a.upper && bar.close > a.lower && bar.close < bar.open ? -1 : 0;
    if (!sign || a.adx < 15 || !Number.isFinite(a.adx) || a.trend !== sign || sign * (bar.close - a.ema) <= 0 || !Number.isFinite(a.ema)) continue;
    while (h + 1 < h4.length && h4[h + 1].time + 14400 <= bar.time + 300) h++;
    if (h < 0 || !bias[h] || bar.time + 300 - (h4[h].time + 14400) > 14400) { unknownBias++; continue; }
    if (bias[h] !== sign) continue;
    const next = byTime.get(bar.time + 300);
    if (!next) { skipped++; continue; }
    // Feed OHLC is assumed mid: buys open at ask, sells at bid; exits use the opposite quote.
    const entry = next.open + sign * input.spread / 2;
    const extreme = sign === 1 ? Math.min(previous.low, bar.low) - .2 * a.atr : Math.max(previous.high, bar.high) + .2 * a.atr;
    const distance = Math.max(sign * (entry - extreme), a.atr);
    if (distance * 10 > BOLLINGER_M5_MAX_SL_PIPS + 1e-8) { skipped++; continue; }
    const unitRisk = distance * input.contractSize + input.commissionPerLot;
    const lot = Math.floor((input.cashRisk / unitRisk + 1e-10) / input.lotStep) * input.lotStep;
    if (!Number.isFinite(distance) || !(distance > 0) || lot + 1e-10 < input.minimumLot) { skipped++; continue; }
    const r: BollingerRecord = { id: `BOLLINGER_M5:${bar.time}`, signalAt: bar.time, entryAt: next.time,
      direction: sign === 1 ? 'BUY' : 'SELL', entry, stopLoss: entry - sign * distance,
      takeProfit: entry + sign * distance * 1.5, lot, initialRisk: distance * lot * input.contractSize,
      outcome: 'OPEN' };
    records.push(r); active = r;
    // Entry-bar high/low are processed on the following loop iteration only after it has closed.
  }
  const { m5, h4: ignored, ...settings } = input;
  return { settings, records, skipped, unknownBias, coverage: { first: closed[0]?.time, last: closed.at(-1)?.time,
    h4First: h4[0]?.time, h4Last: h4.at(-1)?.time } };
}

export function bollingerStats(records: BollingerRecord[], capital: number) {
  const closed = records.filter(r => r.pnl !== undefined), tp = records.filter(r => r.outcome === 'TP').length,
    sl = records.filter(r => r.outcome === 'SL').length;
  let equity = 0, peak = 0, drawdown = 0;
  for (const r of [...closed].sort((a, b) => a.resolvedAt! - b.resolvedAt!)) { equity += r.pnl!; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak - equity); }
  return { trades: records.length, tp, sl, open: records.filter(r => r.outcome === 'OPEN').length,
    uncertain: records.filter(r => r.outcome === 'UNCERTAIN').length, winPercent: tp + sl ? tp / (tp + sl) * 100 : null,
    lossPercent: tp + sl ? sl / (tp + sl) * 100 : null,
    pnl: equity, percent: equity / capital * 100, r: closed.reduce((s, r) => s + r.r!, 0), drawdown,
    drawdownPercent: drawdown / capital * 100 };
}
export function bollingerMonthly(records: BollingerRecord[], capital: number) {
  const groups = new Map<string, BollingerRecord[]>();
  for (const r of records) { const month = new Date((r.resolvedAt ?? r.entryAt) * 1000).toISOString().slice(0, 7);
    groups.set(month, [...groups.get(month) ?? [], r]); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([month, rows]) => ({ month, ...bollingerStats(rows, capital) }));
}
export function bollingerCsv(result: BollingerResult) {
  const keys = ['id', 'signalAt', 'entryAt', 'direction', 'entry', 'stopLoss', 'takeProfit', 'lot', 'initialRisk', 'outcome', 'resolvedAt', 'exit', 'pnl', 'r', 'reason'] as const;
  const settings = ['from', 'cutoff', 'cashRisk', 'capital', 'spread', 'commissionPerLot', 'contractSize', 'lotStep', 'minimumLot',
    'dataSource', 'datasetId', 'studyCandleCount', 'warmupCandleCount'] as const;
  const cell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [[...keys, 'provenance', ...settings].join(','), ...result.records.map(r => [
    ...keys.map(k => r[k]), 'NATIVE_CHART_STUDY', ...settings.map(k => result.settings[k]),
  ].map(cell).join(','))].join('\r\n');
}
export function bollingerChartRecord(r: BollingerRecord): JournalTradeRecord | undefined {
  if (r.outcome === 'UNCERTAIN') return undefined;
  return { id: `CHART:${r.id}`, setupId: r.id, symbol: 'XAUUSD', zoneName: 'Bollinger M5 CHART STUDY',
    zoneTimeframe: 'H4', signalTimeframe: 'M5', source: 'BOLLINGER', tradeStyle: 'BOLLINGER_M5',
    direction: r.direction === 'BUY' ? 'bullish' : 'bearish', engulfingType: 'BOLLINGER',
    result: r.outcome === 'OPEN' ? 'open' : r.outcome === 'TP' ? 'tp' : 'sl', completedAt: r.resolvedAt ?? r.entryAt,
    openedAt: r.entryAt, signalAt: r.signalAt, entry: r.entry, stopLoss: r.stopLoss, takeProfit: r.takeProfit,
    rewardRisk: 1.5, riskPips: Math.abs(r.entry - r.stopLoss) * 10, volumeLogicStatus: 'not-applicable',
    autoReason: `CHART STUDY simulation; not a broker fill. Zero-spread/fee chart history; use Bollinger Study for cost-adjusted results. ${BOLLINGER_M5_RULE}` };
}
/** Same replay and causal rule engine; freshness is bounded to the entry candle. */
export function buildBollingerM5Signals(m5: StructureCandle[], h4: StructureCandle[], now: number, maxAge = 120): Mt5SignalInput[] {
  if (!m5.length || !h4.length) return [];
  const result = runBollingerStudy({ ...BOLLINGER_STUDY_DEFAULTS, cashRisk: 1_000_000, spread: 0, commissionPerLot: 0,
    m5, h4, cutoff: now, from: m5[0].time });
  return result.records.filter(r => r.outcome === 'OPEN' && r.entryAt <= now && now - r.entryAt <= Math.min(maxAge, 299)).map(r => ({
    id: r.id, setupId: r.id, symbol: 'XAUUSD', direction: r.direction, orderType: 'MARKET',
    source: 'BOLLINGER', tradeStyle: 'BOLLINGER_M5', zoneName: 'Bollinger M5', zoneTimeframe: 'H4', signalTimeframe: 'M5',
    engulfingType: 'BOLLINGER', signalAt: r.signalAt, calculatedAt: r.entryAt, entry: r.entry, stopLoss: r.stopLoss,
    takeProfit: r.takeProfit, riskFree: r.entry, rewardRisk: 1.5, riskPips: Math.abs(r.entry - r.stopLoss) * 10,
    expiresAt: r.entryAt + Math.min(maxAge, 299), journalContext: { biasAtEntry: { M1: 'neutral', M5: 'neutral', M15: 'neutral',
      M30: 'neutral', H1: 'neutral', H4: r.direction === 'BUY' ? 'bullish' : 'bearish', D: 'neutral' },
      autoReason: BOLLINGER_M5_RULE, volumeLogicStatus: 'not-applicable', entrySnapshotCandles: m5.filter(b => b.time <= r.signalAt).slice(-30) },
  }));
}
