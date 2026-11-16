import { runVolumeStudy, type VolumeStudyRecord } from './volumeEngulfingStudy';
import type { StudyCandles } from './trendlineStudyHistory';
import { tradeToMt5Signal, scalpOneToOneVolumePasses, type Mt5SignalInput } from './mt5Automation';
import type { MarketTrend, TradeLevels, TradeTimeframe } from './tradeLevels';
import type { JournalTradeRecord } from '../components/TradeJournal';
import type { StructureCandle } from './marketStructure';

/** Chart results are simulations, never broker fills. Pending/ambiguous rows are not results. */
export function scalpOneToOneChartRecord(r: VolumeStudyRecord): JournalTradeRecord | undefined {
  if (!scalpOneToOneVolumePasses(r.signal.type, r.v1, r.v2, r.v3)
    || r.filledAt === undefined || !['active', 'tp', 'sl'].includes(r.outcome)) return undefined;
  return {
    id: `SCALP_1_1:CHART:${r.signal.time}`, setupId: `SCALP_1_1:${r.signal.time}`,
    symbol: 'XAUUSD', zoneName: 'Scalp 1:1', zoneTimeframe: 'M15',
    source: 'ENGULFING', tradeStyle: 'SCALP_1_1',
    result: r.outcome === 'active' ? 'open' : r.outcome as 'tp' | 'sl',
    completedAt: r.resolvedAt ?? r.filledAt, openedAt: r.filledAt,
    signalAt: r.signal.time, signalTimeframe: 'M15', direction: r.signal.direction,
    engulfingType: r.signal.type, engulfingCandleCount: r.signal.candleCount,
    entry: r.levels.entry, stopLoss: r.levels.stopLoss, takeProfit: r.levels.takeProfit,
    rewardRisk: 1, riskPips: r.levels.riskPips,
    volumeLogicStatus: r.group === 'V3 < V2 and V1' ? 'best' : 'valid',
    volume1: r.v1, volume2: r.v2, volume3: r.v3, biasAtEntry: { H4: r.bias === 'none' ? 'neutral' : r.bias },
    autoReason: 'CHART ONLY result. Scalp 1:1: M15 volume confirmation with minimum 250-unit decrease, H4 bias and EMA20/50, H1 continuation/Far; fixed 1:1 SL/TP.',
  };
}

/** Live adapter for the approved study. No zone/Fib requirement or altered exit rule. */
export function buildScalpOneToOneSignals(candles: StudyCandles, now: number,
  pendingExpiryMinutes: number, maximumAgeSeconds = 120): Mt5SignalInput[] {
  if (!candles.M15?.length || !candles.H1?.length || !candles.H4?.length) return [];
  const result = runVolumeStudy({ symbol: 'XAUUSD', timeframe: 'M15', biasTimeframe: 'H4',
    h4EmaFilter: true, h1TrendlineFilter: true, cutoff: now, lookback: 2, candles });
  return result.records.filter(r => scalpOneToOneVolumePasses(r.signal.type, r.v1, r.v2, r.v3)
    && r.confirmedAt >= now - maximumAgeSeconds
    && r.confirmedAt <= now && now < r.confirmedAt + 900 && r.outcome !== 'tp' && r.outcome !== 'sl'
    && r.outcome !== 'cancelled' && r.outcome !== 'ambiguous')
    .flatMap(r => scalpOneToOnePullbackSignals(r, candles, now, pendingExpiryMinutes));
}

/** Freeze the original exits, then split the selected setup risk 60% / 40%. */
export function scalpOneToOnePullbackSignals(r: VolumeStudyRecord, candles: StudyCandles,
  now: number, pendingExpiryMinutes: number): Mt5SignalInput[] {
  // The general study includes smaller volume decreases. Skip that row instead
  // of aborting an entire historical batch in the strict signal converter.
  if (!scalpOneToOneVolumePasses(r.signal.type, r.v1, r.v2, r.v3)) return [];
  const confirmation = candles.M15?.find(c => c.time === r.signal.time);
  const next = candles.M15?.find(c => c.time === r.confirmedAt);
  if (!confirmation || confirmation.complete === false || !next
    || r.confirmedAt !== r.signal.time + 900) return [];
  const body = Math.abs(confirmation.close - confirmation.open);
  if (!(body > 0)) return [];
  const base = scalpOneToOneSignal(r, candles, now, pendingExpiryMinutes);
  const sign = r.signal.direction === 'bullish' ? 1 : -1;
  return ([10, 25] as const).flatMap(leg => {
    const entry = next.open - sign * body * leg / 100;
    const risk = sign * (entry - base.stopLoss), reward = sign * (base.takeProfit - entry);
    if (!(risk > 0 && risk <= 30.000001 && reward > 0)) return [];
    const riskShare = leg === 10 ? 0.6 : 0.4;
    return [{ ...base, id: `${base.id}:P${leg}`, setupId: `${base.setupId}:P${leg}`,
      zoneId: `${base.zoneId}-P${leg}`, orderType: 'LIMIT' as const, entry,
      rewardRisk: reward / risk, normalRewardRisk: reward / risk,
      riskPips: risk * 10, calculatedAt: r.confirmedAt, expiresAt: r.confirmedAt + 900,
      scalpEntry: { version: 2 as const, leg, riskShare, referenceEntry: base.entry,
        nextOpen: next.open, confirmationBody: body },
      journalContext: { ...base.journalContext!, autoReason: `${base.journalContext!.autoReason} `
        + `${leg}% body pullback; ${Math.round(riskShare * 100)}% of total setup risk. Original SL/TP fixed; next-M15 expiry.` },
    }];
  });
}

/** Every next-bar event order consistent with OHLC, including partial fills before TP. */
export function scalpPullbackBarStates(bar: StructureCandle, signals: Mt5SignalInput[], initialMask = 0,
  allowFills = true): Array<{ mask: number; exit: number }> {
  if (!signals.length) return [];
  const sign = signals[0].direction === 'BUY' ? 1 : -1, stop = signals[0].stopLoss;
  const x = (price: number) => sign * (price - stop);
  const open = x(bar.open), close = x(bar.close), target = x(signals[0].takeProfit);
  const low = Math.min(x(bar.low), x(bar.high)), high = Math.max(x(bar.low), x(bar.high));
  const entries = signals.map(s => x(s.entry));
  const prices = [...new Set([open, close, low, high,
    ...[0, target, ...entries].filter(p => p >= low && p <= high)])].sort((a, b) => a - b);
  type State = { position: number; mask: number; exit: number; seen: number };
  const arrive = (position: number, previous: State): State => {
    const price = prices[position];
    let { mask, exit, seen } = previous;
    if (price === high) seen |= 1;
    if (price === low) seen |= 2;
    if (!exit) {
      if (allowFills) entries.forEach((entry, i) => { if (price <= entry + 1e-8) mask |= 1 << i; });
      if (price <= 0) exit = -1;
      else if (price >= target) exit = 1;
    }
    return { position, mask, exit, seen };
  };
  const start = arrive(prices.indexOf(open), { position: 0, mask: initialMask, exit: 0, seen: 0 });
  const key = (s: State) => `${s.position}:${s.mask}:${s.exit}:${s.seen}`;
  const visited = new Set([key(start)]), queue = [start], result = new Map<string, State>();
  for (let head = 0; head < queue.length; head++) {
    const state = queue[head];
    if (prices[state.position] === close && state.seen === 3) result.set(`${state.mask}:${state.exit}`, state);
    for (const position of [state.position - 1, state.position + 1]) {
      if (position < 0 || position >= prices.length) continue;
      const next = arrive(position, state), id = key(next);
      if (!visited.has(id)) { visited.add(id); queue.push(next); }
    }
  }
  return [...result.values()].map(({ mask, exit }) => ({ mask, exit }));
}

export interface ScalpOneToOneChartFill {
  id: string;
  setupId?: string;
  leg: 10 | 25;
  trade: TradeLevels;
  outcome: 'active' | 'tp' | 'sl' | 'uncertain';
}

/** Fill facts survive uncertain exits; only established results enter performance. */
export function scalpOneToOneChartHistory(r: VolumeStudyRecord, candles: StudyCandles,
  asOf: number): { records: JournalTradeRecord[]; fills: ScalpOneToOneChartFill[] } {
  const records: JournalTradeRecord[] = [], fills: ScalpOneToOneChartFill[] = [];
  const signals = scalpOneToOnePullbackSignals(r, candles, r.confirmedAt, 15);
  const next = candles.M15?.find(c => c.time === r.confirmedAt);
  if (!next || next.complete === false || next.time + 900 > asOf) return { records, fills };
  const states = scalpPullbackBarStates(next, signals);
  if (!states.length) return { records, fills };
  const future = (candles.M15 ?? []).filter(c => c.time > next.time && c.complete !== false && c.time + 900 <= asOf);
  let futureExit = 0, futureTime: number | undefined;
  for (const c of future) {
    const buy = r.signal.direction === 'bullish';
    const target = buy ? c.high >= r.levels.takeProfit : c.low <= r.levels.takeProfit;
    const stop = buy ? c.low <= r.levels.stopLoss : c.high >= r.levels.stopLoss;
    if (!target && !stop) continue;
    const openingTarget = buy ? c.open >= r.levels.takeProfit : c.open <= r.levels.takeProfit;
    const openingStop = buy ? c.open <= r.levels.stopLoss : c.open >= r.levels.stopLoss;
    futureExit = openingTarget ? 1 : openingStop ? -1 : target && stop ? 2 : target ? 1 : -1;
    futureTime = c.time; break;
  }
  const base = scalpOneToOneChartRecord({ ...r, outcome: 'active', filledAt: next.time });
  if (!base) return { records, fills };
  signals.forEach((signal, index) => {
    if (!states.every(state => (state.mask & (1 << index)) !== 0)) return;
    const possibilities = states.map(state => !(state.mask & (1 << index)) ? 'unfilled'
      : String(state.exit || futureExit));
    const established = new Set(possibilities).size === 1 && possibilities[0] !== '2';
    const exit = established ? Number(possibilities[0]) : undefined;
    const resolvedAt = established ? exit ? states[0].exit ? next.time : futureTime : undefined
      : states.every(state => state.exit !== 0 || futureExit !== 0) ? futureTime ?? next.time : undefined;
    const outcome = exit === 1 ? 'tp' : exit === -1 ? 'sl' : established ? 'active' : 'uncertain';
    fills.push({ id: `SCALP_1_1:FILL:${r.signal.time}:P${signal.scalpEntry!.leg}`,
      setupId: signal.setupId, leg: signal.scalpEntry!.leg, outcome,
      trade: { entry: signal.entry, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit,
        riskFree: signal.takeProfit, riskFreeEnabled: false, riskPips: signal.riskPips, rewardRisk: signal.rewardRisk,
        status: outcome === 'tp' ? 'tp-hit' : outcome === 'sl' ? 'sl-hit' : 'active',
        result: outcome === 'tp' || outcome === 'sl' ? outcome : undefined,
        calculatedAt: next.time, filledAt: next.time, resolvedAt, pendingAtCreation: true,
        signal: { ...r.signal, timeframe: 'M15' } } });
    if (!established) return;
    records.push({ ...base, id: `SCALP_1_1:CHART:${r.signal.time}:P${signal.scalpEntry!.leg}`,
      setupId: signal.setupId, scalpEntry: signal.scalpEntry,
      result: exit === 1 ? 'tp' as const : exit === -1 ? 'sl' as const : 'open' as const,
      completedAt: resolvedAt ?? next.time, openedAt: next.time,
      entry: signal.entry, rewardRisk: signal.rewardRisk, riskPips: signal.riskPips,
      autoReason: `CHART ONLY. ${signal.journalContext!.autoReason}` });
  });
  return { records, fills };
}

export function scalpOneToOneChartRecords(r: VolumeStudyRecord, candles: StudyCandles,
  asOf: number): JournalTradeRecord[] {
  return scalpOneToOneChartHistory(r, candles, asOf).records;
}

/** Convert an already-qualified study record without changing entry, SL or TP. */
export function scalpOneToOneSignal(r: VolumeStudyRecord, candles: StudyCandles,
  now: number, pendingExpiryMinutes: number): Mt5SignalInput {
    if (!scalpOneToOneVolumePasses(r.signal.type, r.v1, r.v2, r.v3)) {
      throw new Error('Scalp 1:1 requires a minimum 250-unit candle-volume decrease.');
    }
    const trade: TradeLevels = { ...r.levels, signal: { ...r.signal, timeframe: 'M15' } };
    const signal = tradeToMt5Signal({ source: 'ENGULFING', setupId: `SCALP_1_1:${r.signal.time}`,
      zoneName: 'Scalp 1:1', zoneTimeframe: 'M15', trade, now, pendingExpiryMinutes });
    // Namespace the strategy so an existing intraday signal cannot consume this setup.
    signal.id = `SCALP_1_1:${signal.id}`;
    signal.tradeStyle = 'SCALP_1_1';
    signal.zoneId = `SCALP_1_1-${r.signal.time}`;
    const biasAtEntry = Object.fromEntries(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D']
      .map(tf => [tf, tf === 'H4' ? r.bias : 'neutral'])) as Record<TradeTimeframe, MarketTrend>;
    signal.journalContext = { biasAtEntry,
      autoReason: 'Scalp 1:1: M15 T1/T2/T3 + minimum 250-unit volume decrease, closed H4 structure and EMA20/50 agreement, confirmed H1 continuation/Far. 30-pip pattern buffer; fixed 1:1 target.',
      volumeLogicStatus: r.group === 'V3 < V2 and V1' ? 'best' : 'valid',
      volume1: r.v1, volume2: r.v2, volume3: r.v3,
      entrySnapshotCandles: (candles.M15 ?? []).filter(c => c.time <= r.signal.time).slice(-25) };
    return signal;
}
