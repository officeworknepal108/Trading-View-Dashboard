export type IntradayTrend = 'bullish' | 'bearish' | 'neutral';
export type IntradayDirection = 'bullish' | 'bearish';
export type IntradayTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D';

export type IntradayReason =
  | 'not-intraday-route'
  | 'h4-neutral'
  | 'h4-bias-mismatch'
  | 'h1-neutral'
  | 'm15-neutral'
  | 'm15-setup-mismatch'
  | 'continuation-confirmed'
  | 'pullback-confirmed';

export interface IntradayDecision {
  applicable: boolean;
  allowed: boolean;
  action: 'BUY' | 'SELL' | 'WAIT' | 'NOT_APPLICABLE';
  setup: 'continuation' | 'pullback' | 'none';
  entryTimeframe?: 'M5' | 'M15';
  reason: IntradayReason;
}

/**
 * Intraday Logic
 *
 * H4 supplies the main direction, H1 identifies continuation versus pullback,
 * M15 must confirm the setup direction, and the completed M5 or M15 engulfing
 * supplies the entry. Zone/FIB qualification and trade-level calculations stay
 * in the existing structure and trade engines.
 */
export function evaluateIntradayLogic(options: {
  setupTimeframe: IntradayTimeframe;
  entryTimeframe: IntradayTimeframe;
  signalDirection: IntradayDirection;
  h4Trend: IntradayTrend;
  h1Trend: IntradayTrend;
  m15Trend: IntradayTrend;
}): IntradayDecision {
  const {
    setupTimeframe, entryTimeframe, signalDirection, h4Trend, h1Trend, m15Trend,
  } = options;
  const m5Entry = entryTimeframe === 'M5'
    && ['M15', 'H1'].includes(setupTimeframe);
  const m15Entry = entryTimeframe === 'M15'
    && ['M15', 'H1', 'H4'].includes(setupTimeframe);
  const applicable = m5Entry || m15Entry;

  if (!applicable) {
    return {
      applicable: false,
      allowed: true,
      action: 'NOT_APPLICABLE',
      setup: 'none',
      reason: 'not-intraday-route',
    };
  }
  const confirmedEntryTimeframe: 'M5' | 'M15' = m5Entry ? 'M5' : 'M15';

  if (h4Trend === 'neutral') {
    return {
      applicable: true, allowed: false, action: 'WAIT', setup: 'none',
      entryTimeframe: confirmedEntryTimeframe, reason: 'h4-neutral',
    };
  }
  if (h4Trend !== signalDirection) {
    return {
      applicable: true, allowed: false, action: 'WAIT', setup: 'none',
      entryTimeframe: confirmedEntryTimeframe, reason: 'h4-bias-mismatch',
    };
  }
  if (h1Trend === 'neutral') {
    return {
      applicable: true, allowed: false, action: 'WAIT', setup: 'none',
      entryTimeframe: confirmedEntryTimeframe, reason: 'h1-neutral',
    };
  }
  if (m15Trend === 'neutral') {
    return {
      applicable: true, allowed: false, action: 'WAIT', setup: 'none',
      entryTimeframe: confirmedEntryTimeframe, reason: 'm15-neutral',
    };
  }
  if (m15Trend !== signalDirection) {
    return {
      applicable: true, allowed: false, action: 'WAIT', setup: 'none',
      entryTimeframe: confirmedEntryTimeframe, reason: 'm15-setup-mismatch',
    };
  }

  const action = signalDirection === 'bullish' ? 'BUY' : 'SELL';
  const continuation = h1Trend === signalDirection;
  return {
    applicable: true,
    allowed: true,
    action,
    setup: continuation ? 'continuation' : 'pullback',
    entryTimeframe: confirmedEntryTimeframe,
    reason: continuation ? 'continuation-confirmed' : 'pullback-confirmed',
  };
}
