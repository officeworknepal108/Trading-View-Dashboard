export type ScalpingTrend = 'bullish' | 'bearish' | 'neutral';
export type ScalpingDirection = 'bullish' | 'bearish';
export type ScalpingRouteTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D';

export type ScalpingReason =
  | 'not-scalping-route'
  | 'm15-neutral'
  | 'm15-bias-mismatch'
  | 'continuation-confirmed'
  | 'pullback-confirmed'
  | 'm5-confirmed';

export interface ScalpingDecision {
  applicable: boolean;
  allowed: boolean;
  action: 'BUY' | 'SELL' | 'WAIT' | 'NOT_APPLICABLE';
  setup: 'continuation' | 'pullback' | 'confirmation' | 'none';
  entryTimeframe?: 'M1' | 'M5';
  reason: ScalpingReason;
}

/**
 * Scalping Logic
 *
 * M1 and M5 scalping use M15 as the directional bias, M5 as continuation or
 * pullback context, and the completed entry-timeframe engulfing as
 * confirmation. Zone validity, FIB/Major Liquidity qualification, pattern
 * contact, volume, SL, TP and maximum risk remain the responsibility of the
 * existing entry engine.
 *
 * Supported routes:
 * - Native M1 structure with an M1 engulfing.
 * - M1 structure with its M5 engulfing fallback.
 * - Native M5 structure with an M5 engulfing.
 */
export function evaluateScalpingLogic(options: {
  zoneTimeframe: ScalpingRouteTimeframe;
  signalTimeframe: ScalpingRouteTimeframe;
  signalDirection: ScalpingDirection;
  m5Trend: ScalpingTrend;
  m15Trend: ScalpingTrend;
}): ScalpingDecision {
  const { zoneTimeframe, signalTimeframe, signalDirection, m5Trend, m15Trend } = options;
  const nativeM1 = zoneTimeframe === 'M1' && signalTimeframe === 'M1';
  const fiveMinuteEntry = signalTimeframe === 'M5'
    && (zoneTimeframe === 'M1' || zoneTimeframe === 'M5');
  const applicable = nativeM1 || fiveMinuteEntry;

  if (!applicable) {
    return {
      applicable: false,
      allowed: true,
      action: 'NOT_APPLICABLE',
      setup: 'none',
      reason: 'not-scalping-route',
    };
  }

  if (m15Trend === 'neutral') {
    return {
      applicable: true,
      allowed: false,
      action: 'WAIT',
      setup: 'none',
      entryTimeframe: signalTimeframe,
      reason: 'm15-neutral',
    };
  }

  if (signalDirection !== m15Trend) {
    return {
      applicable: true,
      allowed: false,
      action: 'WAIT',
      setup: 'none',
      entryTimeframe: signalTimeframe,
      reason: 'm15-bias-mismatch',
    };
  }

  const action = signalDirection === 'bullish' ? 'BUY' : 'SELL';
  if (m5Trend === signalDirection) {
    return {
      applicable: true,
      allowed: true,
      action,
      setup: 'continuation',
      entryTimeframe: signalTimeframe,
      reason: 'continuation-confirmed',
    };
  }

  if (m5Trend !== 'neutral') {
    return {
      applicable: true,
      allowed: true,
      action,
      setup: 'pullback',
      entryTimeframe: signalTimeframe,
      reason: 'pullback-confirmed',
    };
  }

  return {
    applicable: true,
    allowed: true,
    action,
    setup: 'confirmation',
    entryTimeframe: signalTimeframe,
    reason: 'm5-confirmed',
  };
}
