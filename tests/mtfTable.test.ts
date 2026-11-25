import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MultiTimeframeEntryTable, mtfTableHitExpired, isSlTpTradeDisplayFinished,
  tradeDisplayExpired, tradeDrawingExpired, tradeDrawingFromRecord, resolveArrowTradeZones,
  completedTradeLabel, CompletedTradeRow, resolveRetainedTrade, zoneTableTradeExpired, internalSbrTableSourceVisible,
  resolveZoneTableTrade, zoneTableCompletedStatus, TradeDetailsRow, ZoneTableEntryPrice,
  zoneTableMtfStatus, reconcileSavedMtfTrade, validateRecordedMtfTrade, ZoneTableEngulfingConfirmations,
  ZoneSourceTimeframeLabel, resolveZoneTableSourceTimeframe,
  selectChochStatusTableZones, ChochStatusTableRow, explainZoneEntry, ZoneEntryReadinessText, ZoneEntryReasonDetails,
  ManualTradeTimeframeControl, compactZoneTableStatus, firstZoneTapBarsAgo,
  latestZoneTapBarsAgo, ZoneTableTapAge } from '../src/components/OandaProChart';
import type { Mt5AutomationStatus, Mt5StoredSignal } from '../src/services/mt5Automation';
import type { JournalTradeRecord } from '../src/components/TradeJournal';
import type { MtfRow } from '../src/services/mtf';
import type { StructureZone } from '../src/services/marketStructure';
import type { TradeLevels } from '../src/services/tradeLevels';

const bar = (time: number, complete = true) => ({ time, open: 100, high: 102, low: 99, close: 101, volume: 1, complete });

test('Gold tap windows reset with 20 bars for Tap 1 and 10 bars for later taps', () => {
  const candles = Array.from({ length: 200 }, (_, i) => bar(i * 900));
  const zone: StructureZone = { id: 'repeat-taps', name: 'QML', category: 'mg', isBuy: true,
    active: true, status: 'valid', startTime: -900, endTime: 999999, bottom: 100, top: 102,
    tapTime: 0, tapCount: 1 };
  const original = structuredClone(zone);
  for (let tap = 1; tap <= 5; tap++) {
    const tapIndex = (tap - 1) * 20;
    const current = { ...zone, tapCount: tap, lastTapTime: candles[tapIndex].time };
    for (const age of [0, 1, 9, 10, 11, 19, 20, 21, 49, 50, 51]) {
      const visibleCandles = candles.slice(0, tapIndex + age + 1);
      const actualAge = latestZoneTapBarsAgo(current, visibleCandles);
      assert.equal(actualAge, age, `TAP ${tap} must count from its own touch`);
      for (const trade of [undefined, { status: 'pending' as const }, { status: 'active' as const }, { status: 'tp-hit' as const }]) {
        const expired = zoneTableTradeExpired(trade, actualAge!, visibleCandles,
          visibleCandles.at(-1)!.time, tap, 'XAUUSD');
        assert.equal(expired, age > (tap === 1 ? 20 : 10));
      }
      assert.equal(zoneTableTradeExpired({ status: 'tp-hit' }, actualAge!, visibleCandles,
        visibleCandles.at(-1)!.time, tap, 'EURUSD'), age > 50, 'Forex retains its 50-bar window');
    }
  }
  assert.deepEqual(zone, original, 'table age must not alter tap or trading data');
});

test('latest-tap age follows replay and actual candles across gaps and merged zones', () => {
  const zone: StructureZone = { id: 'latest-touch', name: 'QML', category: 'mg', isBuy: true,
    active: true, status: 'valid', startTime: 0, endTime: 999999, bottom: 100, top: 102,
    tapTime: 60, tapBarsAgo: 99, lastTapTime: 200000, lastTapBarsAgo: 0 };
  const candles = [bar(60), bar(120), bar(200000), bar(200060)];
  assert.equal(latestZoneTapBarsAgo(zone, candles.slice(0, 2)), 1, 'future taps must not leak into replay');
  assert.equal(latestZoneTapBarsAgo(zone, candles), 1, 'gaps must not create imaginary candles');
  const newer = { ...zone, id: 'newer', lastTapTime: 200060 };
  assert.equal(latestZoneTapBarsAgo({ ...zone, confluenceMembers: [zone, newer] }, candles), 0);
  assert.equal(latestZoneTapBarsAgo({ ...zone, lastTapBarsAgo: 0 }), 0);
  assert.equal(latestZoneTapBarsAgo({ ...zone, lastTapTime: undefined, lastTapBarsAgo: undefined }), 99);
  assert.equal(latestZoneTapBarsAgo({ ...zone, tapTime: undefined, lastTapTime: undefined }, candles), undefined);
});

test('tap age stays beside completed and pending status labels in the same table cell', () => {
  for (const status of ['TP HIT', 'SL HIT', 'ENTRY MISSED', 'WAIT 1H ABOVE', 'TRADE', 'NO TRADE']) {
    const html = renderToStaticMarkup(React.createElement(ZoneTableTapAge, { barsAgo: 12, children: status }));
    assert.equal(html, `<span class="text-[8px] font-bold">12 bars · </span>${status}`);
  }
  assert.equal(renderToStaticMarkup(React.createElement(ZoneTableTapAge, { barsAgo: 1, children: 'TP HIT' })), '<span class="text-[8px] font-bold">1 bar · </span>TP HIT');
  assert.equal(renderToStaticMarkup(React.createElement(ZoneTableTapAge, { barsAgo: 0, children: 'SL HIT' })), '<span class="text-[8px] font-bold">0 bars · </span>SL HIT');
  assert.equal(renderToStaticMarkup(React.createElement(ZoneTableTapAge, { children: 'WAIT' })), 'WAIT');
});

test('tap tooltip describes the same latest-tap count and renewed table window', () => {
  const options = entryDiagnosticOptions();
  const readiness = explainZoneEntry({ ...options, barsAgo: 2,
    zone: { ...options.zone, tapTime: 900, lastTapTime: 1800, tapCount: 3 } });
  const text = readiness.narrative!.join('\n');
  assert.ok(text.includes('last touched this zone 2 bars ago'));
  assert.ok(text.includes('Each new tap restarts'));
  assert.ok(!text.includes('Later touches do not restart'));
});

test('displayed bar age keeps increasing from the first touch when the same zone is touched again', () => {
  const zone: StructureZone = { id: 'qml-first-touch', name: 'QML', category: 'mg', isBuy: true,
    active: true, status: 'valid', startTime: 0, endTime: 10000, bottom: 100, top: 102,
    tapTime: 60, tapBarsAgo: 5, lastTapTime: 300, lastTapBarsAgo: 1, tapCount: 2 };
  const candles = [60, 120, 180, 240, 300, 360].map(time => bar(time));
  const original = structuredClone({ zone, candles });
  assert.equal(firstZoneTapBarsAgo(zone, candles), 5, 'the most recent visit must not reset the age to 1');
  const nextVisit = { ...zone, tapBarsAgo: 6, lastTapTime: 420, lastTapBarsAgo: 0, tapCount: 3 };
  assert.equal(firstZoneTapBarsAgo(nextVisit, [...candles, bar(420, false)]), 6);
  assert.equal(firstZoneTapBarsAgo(nextVisit, [...candles, bar(420), bar(480)]), 7);
  assert.equal(firstZoneTapBarsAgo(nextVisit), 6, 'metadata fallback also uses first-touch age');
  assert.deepEqual({ zone, candles }, original, 'display must not rewrite tap or entry lifecycle data');
});

test('first-touch age follows the replay candle, counts actual bars across gaps and handles merged zones', () => {
  const zone: StructureZone = { id: 'old-touch', name: 'QML', category: 'mg', isBuy: true,
    active: true, status: 'valid', startTime: 0, endTime: 999999, bottom: 100, top: 102,
    tapTime: 60, tapBarsAgo: 99, lastTapTime: 200000, lastTapBarsAgo: 0 };
  const candles = [bar(60), bar(120), bar(200000), bar(200060)];
  assert.equal(firstZoneTapBarsAgo(zone, candles.slice(0, 1)), 0);
  assert.equal(firstZoneTapBarsAgo(zone, candles.slice(0, 2)), 1, 'replay must ignore future age metadata');
  assert.equal(firstZoneTapBarsAgo(zone, candles), 3, 'a weekend gap does not add imaginary candles');
  const newer = { ...zone, id: 'later-member', tapTime: 200000, tapBarsAgo: 1 };
  const merged = { ...newer, confluenceMembers: [newer, zone] };
  assert.equal(firstZoneTapBarsAgo(merged, candles), 3, 'merged rows start at their earliest first touch');
  assert.equal(firstZoneTapBarsAgo({ ...zone, tapTime: 300000 }, candles), undefined);
  assert.equal(firstZoneTapBarsAgo({ ...zone, tapTime: undefined, tapBarsAgo: undefined }), undefined,
    'latest-touch metadata must not masquerade as a first touch');
});

test('manual trade control starts unassigned and explains same-or-higher timeframe exits', () => {
  const position = { ticket: 77, identifier: 77, openedAtMsc: 123456, symbol: 'XAUUSD', magic: 0,
    direction: 'BUY' as const, volume: 0.02, priceOpen: 100, priceCurrent: 101, stopLoss: 90,
    takeProfit: 120, profit: 2, swap: 0, openedAt: 123 };
  const render = (fibExitTimeframe?: 'M15') => renderToStaticMarkup(React.createElement(ManualTradeTimeframeControl,
    { position: { ...position, fibExitTimeframe }, onChange: () => {} }));
  const unknown = render();
  assert.ok(unknown.includes('Not set — Fib exits paused'));
  assert.ok(!unknown.includes('value="M15" selected'));
  const assigned = render('M15');
  assert.ok(assigned.includes('value="M15" selected'));
  assert.ok(assigned.includes('15m and higher only'));
  assert.ok(assigned.includes('Broker SL and TP remain active'));
});

function entryDiagnosticOptions(overrides: Partial<Parameters<typeof explainZoneEntry>[0]> = {}): Parameters<typeof explainZoneEntry>[0] {
  return { zone: { id: 'qml', name: 'QML', category: 'mg', isBuy: true, active: true,
    status: 'valid', startTime: 0, endTime: 9000, bottom: 100, top: 102, chochClass: 'valid' },
    timeframe: 'M15', confirmationLabel: '1H', now: 2700,
    evidence: { signal: { type: 'T1', direction: 'bullish', time: 1800, timeframe: 'M15', candleCount: 2 },
      waiting: [], details: [] }, ...overrides };
}

function entryDiagnosticAutomation(): Mt5AutomationStatus {
  return { ok: true, config: { enabled: true, dryRun: false, tradingTimeEnabled: false,
    telegramMessagesEnabled: false, scalpingEnabled: true, intradayEnabled: true, mtfLtfFibRequired: false,
    symbol: 'XAUUSD', brokerSymbol: 'XAUUSD', enabledTimeframes: ['M5', 'M15', 'M30', 'H1'],
    riskPercent: 0.25, maximumOpenTrades: 3, maximumDailyLossPercent: 2, maximumSpreadPoints: 100,
    signalMaxAgeSeconds: 60, pendingExpiryMinutes: 30, moveStopToBreakEvenAtR: 1 },
    bridge: { connected: true, terminalConnected: true, symbolResolved: true,
      account: 'account-a', server: 'server-a', brokerSymbol: 'XAUUSD', dailyRisk: {
        available: true, date: '2026-11-13', startingBalance: 10000, limitPercent: 2, limitMoney: 200,
        realizedLossMoney: 0, floatingLossMoney: 0, usedMoney: 0, usedPercent: 0,
        remainingMoney: 200, remainingPercent: 2, reservedRiskMoney: 0,
        availableRiskMoney: 200, availableRiskPercent: 2, limitReached: false, riskUnbounded: false } },
    marketData: { source: 'MT5_BROKER', fresh: true, lastUpdateAt: 2700000, timeframes: {} },
    positions: [], counts: {}, recentSignals: [] };
}

test('compact table restores bar counts and confirmation text while preserving full hover reasons', () => {
  const options = entryDiagnosticOptions({ evidence: { waiting: ['A+ FIB ALIGNMENT', 'ENGULFING'],
    details: ['Fib alignment is missing.', 'No completed engulfing qualifies.'] } });
  const readiness = explainZoneEntry(options);
  const before = structuredClone(readiness);
  const label = compactZoneTableStatus(readiness, 2);
  assert.equal(label, '2 bars · NO TRADE');
  const cell = renderToStaticMarkup(React.createElement(ZoneEntryReadinessText, { readiness, compactLabel: label }));
  assert.ok(cell.includes('2 bars · NO TRADE') && cell.includes('tabindex="0"'));
  assert.ok(!cell.includes('WAIT —') && !cell.includes('+1') && !cell.includes('A+ FIB ALIGNMENT'));
  const details = renderToStaticMarkup(React.createElement(ZoneEntryReasonDetails, { readiness }));
  assert.ok(details.includes('Fib alignment is still missing') && details.includes('engulfing has qualified') && details.includes('text-[11px]'));
  assert.deepEqual(readiness, before, 'compact wording must not change entry checks');
  options.zone.chochClass = 'pending';
  assert.equal(compactZoneTableStatus(explainZoneEntry(options), 2), 'WAIT 1H ABOVE');
  options.zone.isBuy = false;
  assert.equal(compactZoneTableStatus(explainZoneEntry(options), 2), 'WAIT 1H BELOW');
  assert.equal(compactZoneTableStatus(explainZoneEntry({ ...options, opportunityExpired: true }), 6), '6 bars · NO TRADE');
  assert.equal(compactZoneTableStatus(readiness, 6, false), '6 bars · NO TRADE');
  assert.equal(compactZoneTableStatus(explainZoneEntry(entryDiagnosticOptions()), 2), '2 bars · TRADE');
});

test('compact result labels keep their detailed hover without long waiting labels', () => {
  const readiness = explainZoneEntry(entryDiagnosticOptions());
  for (const compactLabel of ['TP HIT', 'SL HIT', 'ENTRY MISSED']) {
    const cell = renderToStaticMarkup(React.createElement(ZoneEntryReadinessText, { readiness, compactLabel }));
    assert.ok(cell.includes(compactLabel));
    assert.ok(!cell.includes('ENTRY READY'));
  }
});

test('natural explanation includes passed Fib alignment, tap age and the remaining missing condition', () => {
  const options = entryDiagnosticOptions({ barsAgo: 5, now: 3000,
    evidence: { waiting: ['ENGULFING'], details: [] } });
  options.zone = { ...options.zone, tapTime: 1800, fibStatus: 'a-plus', fibBand: '0.5-0.618',
    dayFibStatus: 'a-plus', dayFibBand: '0.5-0.618' };
  const before = structuredClone(options);
  const readiness = explainZoneEntry(options);
  const text = readiness.narrative!.join('\n');
  assert.ok(text.includes('15-minute buy zone'));
  assert.ok(text.includes('A+ Fib 0.5-0.618 and Day Fib 0.5-0.618'));
  assert.ok(text.includes('conditions have passed'));
  assert.ok(text.includes('5 bars ago'));
  assert.ok(text.includes('No completed buy engulfing has qualified'));
  assert.deepEqual(options, before);
  const html = renderToStaticMarkup(React.createElement(ZoneEntryReasonDetails, { readiness }));
  assert.ok(html.includes('<p') && !html.includes('1. ENGULFING'));
});

function storyTrade(): TradeLevels {
  return { entry: 105, stopLoss: 100, takeProfit: 115, riskFree: 110, riskPips: 50, rewardRisk: 2,
    status: 'active', pendingAtCreation: false, calculatedAt: 2700, filledAt: 2700,
    signal: { type: 'T1', direction: 'bullish', timeframe: 'M15', time: 1800, candleCount: 2 } };
}

function storyBroker(): Mt5StoredSignal {
  return { id: 'filled-entry', symbol: 'XAUUSD', zoneId: 'qml', zoneTimeframe: 'M15', zoneName: 'QML',
    account: 'account-a', server: 'server-a', brokerSymbol: 'XAUUSD', brokerTicket: 77,
    source: 'ENGULFING', direction: 'BUY', orderType: 'MARKET', signalTimeframe: 'M15',
    signalAt: 1800, calculatedAt: 2700, engulfingType: 'T1', entry: 105, executionPrice: 105.1,
    stopLoss: 100, takeProfit: 115, riskFree: 110, rewardRisk: 2, riskPips: 50,
    openedAt: 2700, entryQualifiedAt: 2700, status: 'ACTIVE', createdAt: 2700, updatedAt: 2700, expiresAt: 2820,
    journalContext: { biasAtEntry: {} as NonNullable<Mt5StoredSignal['journalContext']>['biasAtEntry'],
      autoReason: 'Qualified entry', volumeLogicStatus: 'not-applicable', fibSource: 'ZONE FIB', fibBand: '0.5-0.618',
      fibLevels: [{ label: '0.5', price: 101 }], entrySnapshotCandles: [
        { time: 900, open: 103, high: 104, low: 100, close: 101, complete: true },
        { time: 1800, open: 101, high: 106, low: 100, close: 105, complete: true },
      ] } };
}

test('executed MT5 explanation uses broker fill, recorded Fib evidence and actual outcome prices', () => {
  const options = entryDiagnosticOptions({ now: 3000, automationSupported: true,
    automation: entryDiagnosticAutomation(), brokerSignal: storyBroker(),
    evidence: { waiting: ['ENGULFING'], details: [] } });
  const before = structuredClone(options);
  const text = explainZoneEntry(options).narrative!.join('\n');
  for (const expected of ['buy MT5 trade', 'ticket 77', 'ZONE FIB', 'T1 buy engulfing',
    'automatic entry checks passed', 'touched Fib 0.5 at 101.000', '105.100', '100.000', '115.000', 'still open']) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(!text.includes('No completed buy engulfing'), 'current missing checks cannot rewrite an executed entry');
  for (const [status, price, description] of [['TP', 115.2, 'take profit'], ['SL', 99.8, 'stop loss']] as const) {
    const closed = explainZoneEntry({ ...options, brokerSignal: { ...storyBroker(), status, closedAt: 2900, closePrice: price } }).narrative!.join('\n');
    assert.ok(closed.includes(description) && closed.includes(price.toFixed(3)));
    assert.ok(!closed.includes('still open'));
  }
  assert.deepEqual(options, before);
});

test('replay and chart entries are never presented as broker fills and future outcomes stay hidden', () => {
  const automation = entryDiagnosticAutomation();
  automation.bridge.connected = false;
  const options = entryDiagnosticOptions({ now: 3000, replay: true, recordedTrade: {
    ...storyTrade(), status: 'tp-hit', result: 'tp', resolvedAt: 3600 },
    automationSupported: true, automation, brokerSignal: storyBroker() });
  const open = explainZoneEntry(options).narrative!.join('\n');
  assert.ok(open.includes('buy replay entry') && open.includes('still open'));
  assert.ok(!open.includes('MT5 trade') && !open.includes('reached its take profit') && !open.includes('working connection'));
  const closed = explainZoneEntry({ ...options, now: 4000 }).narrative!.join('\n');
  assert.ok(closed.includes('replay entry reached its take profit'));
  const chart = explainZoneEntry({ ...options, replay: false, brokerSignal: undefined }).narrative!.join('\n');
  assert.ok(chart.includes('buy chart entry') && chart.includes('does not confirm that an order opened in MT5'));
  assert.ok(!chart.includes('automatic entry checks passed'));
  const future = explainZoneEntry({ ...options, recordedTrade: { ...storyTrade(), filledAt: 5000 } }).narrative!.join('\n');
  assert.ok(!future.includes('buy replay entry was recorded'));
});

test('foreign-account, queued and unproven MT5 records cannot produce a confirmed trade story', () => {
  const options = entryDiagnosticOptions({ now: 3000, automation: entryDiagnosticAutomation() });
  for (const brokerSignal of [{ ...storyBroker(), account: 'other' },
    { ...storyBroker(), brokerTicket: undefined }, { ...storyBroker(), openedAt: 5000 }]) {
    assert.ok(!explainZoneEntry({ ...options, brokerSignal }).narrative!.join('\n').includes('MT5 trade was recorded'));
  }
  const queued = explainZoneEntry({ ...options, brokerSignal: { ...storyBroker(), status: 'QUEUED',
    openedAt: undefined, brokerTicket: undefined } }).narrative!.join('\n');
  assert.ok(queued.includes('fill has not been confirmed'));
  const noSnapshot = explainZoneEntry({ ...options, brokerSignal: { ...storyBroker(), journalContext: undefined,
    entryQualifiedAt: undefined } }).narrative!.join('\n');
  assert.ok(!noSnapshot.includes('touched Fib 0.5') && !noSnapshot.includes('automatic entry checks passed'));
});

test('Zone Table reports real waiting reasons, full hover details and no premature ENTRY READY', () => {
  const options = entryDiagnosticOptions({ evidence: { waiting: ['FIB 0.5 TOUCH'],
    details: ['T1 is visible, but the pattern missed 3887.835.'] }, outsideHours: true });
  options.zone.chochClass = 'pending';
  const before = structuredClone(options);
  const status = explainZoneEntry(options);
  assert.equal(status.mode, 'WAIT');
  assert.ok(status.reasons.includes('FIB 0.5 TOUCH'));
  assert.ok(status.reasons.includes('1H CLOSE ABOVE'));
  assert.ok(status.reasons.includes('TRADING HOURS'));
  assert.ok(status.title.includes('3887.835'));
  const html = renderToStaticMarkup(React.createElement(ZoneEntryReadinessText, { readiness: status }));
  assert.ok(html.includes('tabindex="0"') && html.includes('Hover or focus') && html.includes('WAIT'));
  assert.ok(!html.includes('ENTRY READY'));
  assert.deepEqual(options, before, 'rendering reasons must not change entry eligibility');
  assert.equal(explainZoneEntry(entryDiagnosticOptions()).label, 'ENTRY READY');
  assert.equal(explainZoneEntry(entryDiagnosticOptions({ zoneUsed: true })).mode, 'BLOCKED');
  assert.equal(explainZoneEntry(entryDiagnosticOptions({ opportunityExpired: true })).mode, 'BLOCKED');
  assert.ok(explainZoneEntry(entryDiagnosticOptions({ evidence: { waiting: ['ENGULFING'], details: [] } }))
    .label.includes('WAIT'));
});

test('small-text entry tooltip explains every hidden reason without inventing a trigger price', () => {
  const options = entryDiagnosticOptions({ opportunityExpired: true,
    evidence: { waiting: ['ENGULFING'], details: ['No completed sell engulfing qualifies.'] } });
  options.zone = { ...options.zone, name: 'ISS L4', isBuy: false, bottom: 3900.634, top: 3905.975 };
  const readiness = explainZoneEntry(options);
  assert.ok(readiness.label.includes('+1'));
  const tooltip = renderToStaticMarkup(React.createElement(ZoneEntryReasonDetails, { readiness }));
  assert.ok(tooltip.includes('text-[11px]') && tooltip.includes('font-normal'));
  assert.ok(tooltip.includes('ISS L4') && tooltip.includes('3,900.634') && tooltip.includes('3,905.975'));
  assert.ok(tooltip.includes('allowed entry limit') && tooltip.includes('Entry from this opportunity is now blocked'));
  assert.ok(tooltip.includes('No completed sell engulfing has qualified'));
  assert.ok(!tooltip.includes('1R reached'), 'a generic expiry flag cannot prove a specific 1R trigger');
  assert.ok(!tooltip.includes('entry limit at'), 'do not invent a numerical trigger when it is unavailable');
});

test('tooltip uses real Fib prices, preserves server errors, and distinguishes waiting from a missed entry', () => {
  const options = entryDiagnosticOptions({ evidence: { waiting: ['FIB 0.5 TOUCH'], details: [] } });
  options.zone.fibLevel50 = 3887.835;
  const fib = explainZoneEntry(options);
  assert.ok(fib.title.includes('3,887.835') && fib.title.includes('new engulfing can qualify'));
  assert.ok(!fib.title.includes('ENTRY MISSED'));
  const automation = entryDiagnosticAutomation();
  automation.newsCalendar = { available: false, error: 'Calendar request returned 429.' };
  const news = explainZoneEntry(entryDiagnosticOptions({ automationSupported: true, automation }));
  assert.ok(news.title.includes('Calendar request returned 429.'));
  assert.ok(news.title.includes('important news event'));
  const pending = entryDiagnosticOptions();
  pending.zone.chochClass = 'pending';
  assert.ok(explainZoneEntry(pending).title.includes('while that candle is still open is not enough'));
});

test('Zone Table applies live execution gates and ignores them in replay', () => {
  const automation = entryDiagnosticAutomation();
  const options = entryDiagnosticOptions({ automationSupported: true, automation });
  assert.equal(explainZoneEntry(options).label, 'ENTRY READY');
  automation.bridge.connected = false;
  assert.ok(explainZoneEntry(options).reasons.includes('MT5 CONNECTION'));
  assert.equal(explainZoneEntry({ ...options, replay: true }).label, 'ENTRY READY');
  automation.bridge.connected = true;
  automation.marketData.fresh = false;
  assert.ok(explainZoneEntry(options).reasons.includes('FRESH MT5 DATA'));
  automation.marketData.fresh = true;
  automation.config.enabled = false;
  assert.equal(explainZoneEntry(options).mode, 'DISABLED');
  automation.config.enabled = true;
  automation.config.dryRun = true;
  assert.equal(explainZoneEntry(options).mode, 'SIMULATION');
  automation.config.dryRun = false;
  automation.newsCalendar = { available: false, error: 'Calendar feed unavailable.' };
  assert.ok(explainZoneEntry(options).title.includes('Calendar feed unavailable.'));
  automation.newsCalendar = { available: true, pausedUntil: 3000 };
  assert.ok(explainZoneEntry(options).reasons.includes('NEWS WINDOW'));
  automation.newsCalendar = undefined;
  automation.bridge.dailyRisk = { available: false, error: 'Risk data unavailable.' };
  assert.ok(explainZoneEntry(options).reasons.includes('DAILY RISK DATA'));
  automation.bridge.dailyRisk = { ...entryDiagnosticAutomation().bridge.dailyRisk as Extract<NonNullable<Mt5AutomationStatus['bridge']['dailyRisk']>, { available: true }>, limitReached: true };
  assert.equal(explainZoneEntry(options).mode, 'BLOCKED');
});

test('Zone Table keeps ENTRY MISSED visible for a new pattern, but not for incomplete or other-account entries', () => {
  const automation = entryDiagnosticAutomation();
  const missed = { id: 'missed', symbol: 'XAUUSD', zoneTimeframe: 'M15', zoneId: 'qml',
    signalAt: 900, status: 'EXPIRED', entryQualifiedAt: 1800,
    account: 'account-a', server: 'server-a', brokerSymbol: 'XAUUSD' } as Mt5StoredSignal;
  automation.missedEntries = [missed];
  const options = entryDiagnosticOptions({ automationSupported: true, automation, now: 100000 });
  const readiness = explainZoneEntry(options);
  assert.equal(readiness.mode, 'BLOCKED');
  assert.ok(readiness.label.includes('ENTRY MISSED'));
  assert.ok(readiness.title.includes('cannot produce another entry'));
  assert.equal(explainZoneEntry({ ...options, replay: true }).label, 'ENTRY READY');
  automation.missedEntries = [{ ...missed, entryQualifiedAt: undefined }];
  assert.equal(explainZoneEntry(options).label, 'ENTRY READY');
  automation.missedEntries = [{ ...missed, account: 'account-b' }];
  assert.equal(explainZoneEntry(options).label, 'ENTRY READY');
  automation.missedEntries = [];
  const incomplete = explainZoneEntry({ ...options, evidence: { waiting: ['FIB 0.5 TOUCH'], details: [] } });
  assert.equal(incomplete.mode, 'WAIT');
  assert.ok(incomplete.reasons.includes('FIB 0.5 TOUCH'));
  assert.ok(!incomplete.reasons.includes('ENTRY MISSED'));
});

test('scanner entry reasons match the exact account, zone and signal and expire promptly', () => {
  const automation = entryDiagnosticAutomation();
  const check: NonNullable<Mt5AutomationStatus['entryChecks']>[number] = {
    zoneId: 'qml', zoneTimeframe: 'M15', signalTimeframe: 'M15', signalAt: 1800,
    symbol: 'XAUUSD', direction: 'BUY', checkedAt: 2695, account: 'account-a', server: 'server-a',
    brokerSymbol: 'XAUUSD', mode: 'WAIT', reasons: ['VOLATILITY TO SETTLE', 'OPPOSING ZONE CLEARANCE'] };
  const options = entryDiagnosticOptions({ automationSupported: true, automation });
  automation.entryChecks = [check];
  assert.ok(explainZoneEntry(options).reasons.includes('VOLATILITY TO SETTLE'));
  for (const change of [{ account: 'other' }, { server: 'other' }, { brokerSymbol: 'other' },
    { zoneId: 'other' }, { signalAt: 900 }, { checkedAt: 2600 }, { direction: 'SELL' as const }]) {
    automation.entryChecks = [{ ...check, ...change }];
    assert.equal(explainZoneEntry(options).label, 'ENTRY READY', JSON.stringify(change));
  }
});

test('a fresh CHoCH shows a compact pending row before a revisit and leaves the table after confirmation', () => {
  for (const isBuy of [true, false]) {
    const pending: StructureZone = { id: 'choch-level', name: isBuy ? 'RBS' : 'SBR', category: 'mg',
      isBuy, active: true, status: 'valid', startTime: 100, endTime: 2000,
      bottom: 100, top: 102, chochTime: 900, chochClass: 'pending', tradeable: false };
    const original = structuredClone(pending);
    const selected = selectChochStatusTableZones([pending], [bar(900), bar(1800, false)]);
    assert.equal(selected.length, 1, 'no tap is needed to display confirmation');
    const render = (zone: StructureZone) => renderToStaticMarkup(React.createElement('table', {},
      React.createElement('tbody', {}, React.createElement(ChochStatusTableRow, { zone, timeframe: 'M15' }))));
    const html = render(selected[0]);
    assert.ok(html.includes(`WAIT 1H ${isBuy ? 'ABOVE' : 'BELOW'}`));
    assert.ok(html.includes('Hover or focus for all entry reasons.') && html.includes('tabindex="0"'));
    assert.ok(!html.includes('VALID'));
    for (const chochClass of ['valid', 'vip', 'air'] as const) {
      const resolved = { ...pending, chochClass, chochConfirmationTime: 3600 };
      const after = selectChochStatusTableZones([resolved], [bar(3600), bar(4500)]);
      assert.equal(after.length, 0, 'resolved CHoCH must not keep a confirmation-only table row');
      assert.ok(!render(resolved).includes('<tr'), 'the row renderer also hides resolved confirmation');
    }
    assert.deepEqual(pending, original, 'display never changes tap history or trade eligibility');
  }
});

test('pending CHoCH shows only its RBS or SBR confirmation level, never its QML or DB/DT', () => {
  for (const isBuy of [true, false]) {
    for (const category of ['mg', 'internal'] as const) {
      const prefix = category === 'internal' ? 'Internal ' : '';
      const names = ['QML', isBuy ? 'DB' : 'DT', isBuy ? 'RBS' : 'SBR'];
      const family = names.map(name => ({ id: `${prefix}${name}`, name: `${prefix}${name}` as StructureZone['name'],
        category, isBuy, active: true, status: 'valid' as const, startTime: 100, endTime: 2000,
        bottom: 100, top: 102, chochTime: 900, chochClass: 'pending' as const }));
      const before = structuredClone(family);
      const select = (zones: StructureZone[]) => selectChochStatusTableZones(zones, [bar(900), bar(1800)]);
      assert.deepEqual(select(family).map(zone => zone.name), [`${prefix}${isBuy ? 'RBS' : 'SBR'}`]);
      assert.equal(select([...family].reverse()).length, 1);
      assert.equal(select([...family, { ...family[2], id: 'duplicate' }]).length, 1);
      assert.equal(select(family.map(zone => ({ ...zone, chochClass: 'valid' as const }))).length, 0);
      assert.equal(select(family.slice(0, 2)).length, 0, 'do not substitute QML or the extreme for a missing level');
      assert.deepEqual(family, before, 'all chart zones remain unchanged');
    }
  }
});

test('CHoCH status rows exclude invalid, duplicate, future and resolved structures', () => {
  const current: StructureZone = { id: 'current', name: 'RBS', category: 'mg', isBuy: true,
    active: true, status: 'valid', startTime: 100, endTime: 2000,
    bottom: 100, top: 102, chochTime: 900, chochClass: 'pending' };
  const candles = [bar(900), ...Array.from({ length: 51 }, (_, i) => bar(1800 + i * 900))];
  const select = (zone: StructureZone, ids = new Set<string>()) => selectChochStatusTableZones([zone], candles, ids);
  assert.equal(select(current).length, 1, 'pending confirmation stays visible until resolved');
  assert.equal(select({ ...current, chochClass: 'valid', chochConfirmationTime: 1800 }).length, 0);
  assert.equal(select({ ...current, active: false, status: 'invalidated' }).length, 0);
  assert.equal(select({ ...current, status: 'rejected' }).length, 0);
  assert.equal(select({ ...current, chochClass: undefined }).length, 0);
  assert.equal(select({ ...current, chochTime: 999999 }).length, 0);
  assert.equal(select(current, new Set(['current'])).length, 0, 'ordinary table rows must not be duplicated');
  assert.equal(selectChochStatusTableZones([{ ...current, chochClass: 'pending', chochConfirmationTime: undefined }],
    [...candles, bar(47700)]).length, 1, 'unresolved confirmation remains visible');
});

test('Zone Table source labels retain 1Hr for a saved hourly zone with a 15-minute confirmation', () => {
  const source = resolveZoneTableSourceTimeframe({ recorded: 'H1', inferred: ['M15'] });
  assert.equal(source, 'H1');
  const html = renderToStaticMarkup(React.createElement(ZoneSourceTimeframeLabel, { timeframe: source }));
  assert.ok(html.includes('1Hr') && html.includes('text-[7px]') && html.includes('Zone source timeframe'));
  assert.ok(!html.includes('15m'));
  assert.ok(renderToStaticMarkup(React.createElement(ZoneSourceTimeframeLabel, { timeframe: 'M15' })).includes('15m'));
  assert.equal(resolveZoneTableSourceTimeframe({ stored: 'H1', recorded: 'M15' }), 'H1');
  assert.equal(resolveZoneTableSourceTimeframe({ setup: 'H4' }), 'H4');
  assert.equal(resolveZoneTableSourceTimeframe({ inferred: ['H1', 'H1'] }), 'H1');
  assert.equal(resolveZoneTableSourceTimeframe({ inferred: ['M15', 'H1'] }), undefined);
  assert.equal(renderToStaticMarkup(React.createElement(ZoneSourceTimeframeLabel, { timeframe: undefined })), '');
});

test('Zone Table later engulfings render as small confirmation text without entry controls', () => {
  const html = renderToStaticMarkup(React.createElement(ZoneTableEngulfingConfirmations, { confirmations: [{
    sourceZoneId: 'DT-1793850300-4146.92', symbol: 'XAUUSD', confirmedAt: 12000,
    signal: { timeframe: 'M30', type: 'T2', direction: 'bearish', time: 10200 },
  }] }));
  assert.ok(html.includes('30m') && html.includes('T2'));
  assert.ok(html.includes('text-[8px]') && html.includes('Additional confirmation only'));
  assert.ok(!html.includes('<button') && !html.includes('ENTRY') && !html.includes('TP HIT'));
  assert.equal(renderToStaticMarkup(React.createElement(ZoneTableEngulfingConfirmations, { confirmations: [] })), '');
});

test('a retained Internal SBR row requires its current active chart zone', () => {
  const zone = { id: 'internal-sbr', name: 'Internal SBR' as const, active: true, status: 'valid' as const };
  assert.equal(internalSbrTableSourceVisible('Internal SBR', zone.id, [zone], true), true);
  assert.equal(internalSbrTableSourceVisible('Internal SBR', zone.id, [], true), false);
  assert.equal(internalSbrTableSourceVisible('Internal SBR', 'old-zone', [zone], true), false);
  assert.equal(internalSbrTableSourceVisible('Internal SBR', undefined, [zone], true), false);
  assert.equal(internalSbrTableSourceVisible('Internal SBR', zone.id, [zone], false), false);
  assert.equal(internalSbrTableSourceVisible('Internal SBR', zone.id, [{ ...zone, active: false }], true), false);
  assert.equal(internalSbrTableSourceVisible('Internal SBR', zone.id, [{ ...zone, status: 'pending' }], true), false);
  assert.equal(internalSbrTableSourceVisible('Internal SBR', zone.id, [{ ...zone, name: 'Internal TJL2' }], true), false);
  for (const name of ['TJL2', 'SBR', 'Internal RBS']) {
    assert.equal(internalSbrTableSourceVisible(name, undefined, [], false), true,
      'other retained trade rows keep their existing behavior');
  }
});

test('a saved internal-zone snapshot cannot supply a missing source structure to the MTF table', () => {
  const context: MtfRow = {
    id: 'H4-M15-internal-choch-300', higherTimeframe: 'H4', lowerTimeframe: 'M15',
    confirmationKind: 'choch', structureScope: 'internal', direction: 'bullish',
    confirmationTime: 300, confirmationBarsAgo: 1, higherTimeframeZoneId: 'higher',
    higherTimeframeZone: 'TJL1', higherTimeframeTapTime: 200, higherTimeframeTapBarsAgo: 1,
    tappedZone: 'Internal RBS', engulfingType: 'T1', engulfingTime: 800,
  };
  const record: JournalTradeRecord = { ...reloadMtfRecord('open'),
    id: 'MTF:H4-M15-internal-choch-300:800:100', brokerTicket: undefined,
    zoneTimeframe: 'H4', signalTimeframe: 'M15', zoneName: 'Internal RBS',
    mtfContext: context };
  const candles = [
    { ...bar(700), open: 101, high: 102, low: 99, close: 100 },
    { ...bar(800), open: 100, high: 105, low: 99, close: 104 },
  ];
  let checked = false;
  assert.equal(validateRecordedMtfTrade(record, candles, () => {
    checked = true;
    return undefined; // The current structure has no matching internal CHoCH pair.
  }), undefined);
  assert.equal(checked, true, 'stored mtfContext must not bypass structural validation');
  const freshContext = { ...context, confirmationBarsAgo: 2 };
  assert.deepEqual(validateRecordedMtfTrade(record, candles, () => ({ context: freshContext })),
    { ...record, mtfContext: freshContext }, 'a qualified entry uses current source context');
  assert.equal(record.mtfContext, context, 'validation does not rewrite journal history');
  assert.equal(validateRecordedMtfTrade(record, undefined, () => ({ context })), undefined,
    'an unverified chart record stays hidden until its candles load');
  const brokerRecord = { ...record, brokerTicket: 12345 };
  assert.equal(validateRecordedMtfTrade(brokerRecord, undefined, () => undefined), brokerRecord,
    'an actual broker execution survives missing chart structure');
});

test('the reported Internal SBR T4 is rejected when the recorded signal candle is bullish', () => {
  const record: JournalTradeRecord = { ...reloadMtfRecord('open'),
    id: 'MTF:H4-M15-internal-choch-1793260800:1793271600:4021.415', brokerTicket: undefined,
    zoneName: 'Internal SBR', zoneTimeframe: 'H4', signalTimeframe: 'M15',
    direction: 'bearish', engulfingType: 'T4', engulfingCandleCount: 3,
    signalAt: 1793271600, entry: 4021.415, stopLoss: 4041.415, takeProfit: 3921.415 };
  const candles = [{ ...bar(1793271600), open: 4031.14, high: 4039.415,
    low: 4030.325, close: 4036.12 }];
  assert.equal(validateRecordedMtfTrade(record, candles, () => {
    assert.fail('a disproved bearish T4 cannot be restored from cached context');
  }), undefined);
});

test('saved chart MTF entries resolve from completed candles and stay final after reload', () => {
  const record: JournalTradeRecord = { ...reloadMtfRecord('open'), id: 'MTF:old-chart',
    brokerTicket: undefined, signalTimeframe: 'M5', openedAt: 1000, completedAt: 1000,
    entry: 3996.445, stopLoss: 3992.825, takeProfit: 4007.305, tradeStyle: 'INTRADAY' };
  const first = { ...bar(1000), open: 3996.445, low: 3994, high: 4000, close: 3999 };
  const hit = { ...first, time: 1300, high: 4008 };
  const before = JSON.stringify(record);
  const resolved = reconcileSavedMtfTrade(record, [first, hit], 1600);
  assert.equal(resolved.record.result, 'tp');
  assert.equal(resolved.record.closedAt, 1600);
  assert.equal(resolved.verified, true);
  assert.equal(reconcileSavedMtfTrade(record, [first, { ...hit, complete: false }], 1600).record.result, 'open');
  assert.equal(reconcileSavedMtfTrade(record, [first, hit], 1599).record.result, 'open', 'no future candle exits');
  assert.equal(reconcileSavedMtfTrade(record, [first, { ...hit, high: 4000, low: 3990 }], 1600).record.result, 'sl');
  const reloaded = JSON.parse(JSON.stringify(resolved.record));
  assert.deepEqual(reconcileSavedMtfTrade(reloaded, [], 10000).record, reloaded);
  assert.equal(JSON.stringify(record), before);
  const props = { ...reloadMtfProps(), records: [record], asOf: 1600,
    entryCandles: { M5: [first, hit] } };
  const html = renderReloadTable(props);
  assert.ok(html.includes('TP HIT'));
  assert.ok(!html.includes('ENTRY 3,996.445') && !html.includes('>OPEN<'));
  const later = Array.from({ length: 6 }, (_, i) => ({ ...first, time: 1600 + i * 300 }));
  assert.ok(!renderReloadTable({ ...props, asOf: 3400,
    entryCandles: { M5: [first, hit, ...later] } }).includes('MTF TRADE'));
});

test('incomplete MTF evidence is unknown while broker trades never use chart exits', () => {
  const record = { ...reloadMtfRecord('open'), id: 'MTF:chart', brokerTicket: undefined,
    openedAt: 1000, signalTimeframe: 'M1' as const };
  const quiet = (time: number) => ({ ...bar(time), low: 99.5, high: 100.5 });
  for (const candles of [[], [quiet(1060)], [quiet(1000), quiet(1120)], [quiet(1000)]]) {
    assert.equal(reconcileSavedMtfTrade(record, candles, 1300).verified, false);
    assert.equal(reconcileSavedMtfTrade(record, candles, 1300).record.result, 'open');
  }
  assert.equal(reconcileSavedMtfTrade(record, [quiet(1000), quiet(1060)], 1120).verified, true);
  assert.equal(reconcileSavedMtfTrade({ ...record, openedAt: 1010 },
    [{ ...bar(1000), high: 110 }], 1120).verified, false, 'pre-entry candle extremes cannot close a trade');
  for (const broker of [{ brokerTicket: 123 }, { mt5Managed: true }, { mt5SignalId: 'signal' }]) {
    const managed = { ...record, ...broker };
    const result = reconcileSavedMtfTrade(managed, [{ ...bar(1000), high: 110 }], 1120);
    assert.equal(result.record, managed);
    assert.equal(result.verified, false);
  }
  const html = renderReloadTable({ ...reloadMtfProps(), records: [record], entryCandles: {} });
  assert.ok(html.includes('STATUS UNKNOWN'));
  assert.ok(!html.includes('>OPEN<'));
});

test('zone table identifies its own MTF route without granting direct-entry permission', () => {
  const zone: StructureZone = { id: 'sbr-1', name: 'SBR', category: 'mg', isBuy: false,
    startTime: 100, endTime: 9000, top: 103, bottom: 102, active: true,
    status: 'pending', chochClass: 'pending', chochTime: 700, tapTime: 1000, tradeable: false };
  const row: MtfRow = { id: 'H4-M15-external-choch-700', higherTimeframe: 'H4', lowerTimeframe: 'M15',
    confirmationKind: 'choch', structureScope: 'external', direction: 'bearish',
    confirmationTime: 700, confirmationBarsAgo: 1, higherTimeframeZoneId: 'htf',
    higherTimeframeZone: 'TJL1', higherTimeframeTapTime: 600, higherTimeframeTapBarsAgo: 1,
    tappedZone: 'SBR', tapTime: 1000, sourcePairOverlapsHigherZone: true, chochSequence: 1 };
  const before = JSON.stringify({ zone, row });
  assert.deepEqual(zoneTableMtfStatus([zone], 'M15', [row]), {
    label: 'MTF SETUP · WAITING FOR ENTRY', confirmed: false,
  });
  const completed = tradeDrawingFromRecord({ ...reloadMtfRecord(), direction: 'bearish', signalTimeframe: 'M15' });
  const trade = { ...completed, result: undefined, resolvedAt: undefined, status: 'active' as const };
  const confirmed = { ...row, entryZone: zone, engulfingType: 'T1' as const, engulfingTime: 1100, trade };
  assert.deepEqual(zoneTableMtfStatus([zone], 'M15', [row, confirmed]), {
    label: 'MTF ENTRY CONFIRMED · H4 → M15', confirmed: true,
  });
  for (const changed of [
    { lowerTimeframe: 'M5' as const }, { direction: 'bullish' as const },
    { structureScope: 'internal' as const }, { confirmationTime: 701 },
    { sourcePairOverlapsHigherZone: false }, { chochSequence: 2 },
    { tappedZone: 'QML' as const }, { tapTime: 1001 },
  ]) assert.equal(zoneTableMtfStatus([zone], 'M15', [{ ...row, ...changed }]), undefined);
  assert.equal(zoneTableMtfStatus([zone], 'H4', [row]), undefined);
  for (const changed of [
    { tradingTimeBlocked: true }, { trade: undefined }, { trade: completed },
    { entryZone: { ...zone, id: 'other-sbr' } },
  ]) assert.equal(zoneTableMtfStatus([zone], 'M15', [{ ...confirmed, ...changed }]), undefined);
  for (const changed of [
    { active: false }, { status: 'invalidated' as const }, { invalidatedAt: 1200 }, { supersededAt: 1200 },
  ]) assert.equal(zoneTableMtfStatus([{ ...zone, ...changed }], 'M15', [row]), undefined);
  assert.equal(JSON.stringify({ zone, row }), before);
  assert.equal(zone.tradeable, false, 'the direct route still requires its own confirmation');
});

test('zone table uses the arrow outcome and hides completed entry prices and trade details', () => {
  for (const result of ['sl', 'tp'] as const) {
    const record: JournalTradeRecord = { id: 'MT5:filled', zoneId: 'sbr-original', zoneName: 'SBR',
      zoneTimeframe: 'M15', signalTimeframe: 'M15', source: 'ENGULFING', symbol: 'XAUUSD',
      signalAt: 1000, openedAt: 1900, completedAt: 2800, direction: 'bearish', engulfingType: 'T3',
      result, entry: 4051.160, stopLoss: 4060.290, takeProfit: 4032.990, riskPips: 91.3, rewardRisk: 2 };
    const active = { ...tradeDrawingFromRecord(record), status: 'active' as const,
      result: undefined, resolvedAt: undefined, entry: 4051.365, stopLoss: 4060.300,
      takeProfit: 4033.495, riskPips: 89.35 };
    const before = JSON.stringify({ active, record });
    const resolved = resolveZoneTableTrade(active, [record], 3700, ['sbr-original'], ['SBR'])!;
    assert.equal(zoneTableCompletedStatus(resolved), `${result.toUpperCase()} HIT`);
    assert.equal(resolved.entry, active.entry, 'table prices stay unchanged despite broker fill slippage');
    const html = renderToStaticMarkup(React.createElement(TradeDetailsRow, {
      trade: resolved, colSpan: 5,
    }));
    assert.equal(html, '', 'the lower details row disappears after SL/TP');
    assert.equal(renderToStaticMarkup(React.createElement(ZoneTableEntryPrice, { trade: resolved })), '—');
    const activeHtml = renderToStaticMarkup(React.createElement(TradeDetailsRow, { trade: active, colSpan: 5 }));
    for (const detail of ['ENTRY', '4,051.365', 'SL', '4,060.300', 'TP', '4,033.495', 'R:R 1:2', '89.35', 'CHART ACTIVE']) {
      assert.ok(activeHtml.includes(detail), detail);
    }
    assert.ok(renderToStaticMarkup(React.createElement(ZoneTableEntryPrice, { trade: active })).includes('4,051.365'));
    assert.equal(resolveZoneTableTrade(active, [record], 2799, ['sbr-original']), active, 'replay cannot reveal a future exit');
    assert.equal(resolveZoneTableTrade(active, [record], 3700, ['another-zone']), active);
    assert.equal(resolveZoneTableTrade(active, [{ ...record, signalAt: 1001 }], 3700, ['sbr-original']), active);
    assert.equal(resolveZoneTableTrade(active, [{ ...record, signalTimeframe: 'M5' }], 3700, ['sbr-original']), active);
    assert.equal(JSON.stringify({ active, record }), before, 'display reconciliation does not rewrite trading state');
  }
});

test('the reported SBR entry uses the saved exit despite a recalculated zone-price suffix', () => {
  const chartZoneId = 'TJL2-1793125800-4055.3822';
  for (const [brokerZoneId, entry, stopLoss, takeProfit] of [
    ['TJL2-1793125800-4055.3018', 4051.16, 4060.29, 4032.99],
    ['TJL2-1793125800-4055.2410999999997', 4051.08, 4060.11, 4033.17],
  ] as const) {
    for (const result of ['sl', 'tp'] as const) {
      const record: JournalTradeRecord = { id: 'MT5:reported', symbol: 'XAUUSD', zoneId: brokerZoneId,
        zoneName: 'SBR', zoneTimeframe: 'M15', signalTimeframe: 'M15', source: 'ENGULFING',
        signalAt: 1793178000, openedAt: 1793178900, completedAt: 1793190216,
        direction: 'bearish', engulfingType: 'T3', result, entry, stopLoss, takeProfit, riskPips: 91.3, rewardRisk: 2 };
      const active = { ...tradeDrawingFromRecord(record), status: 'active' as const, result: undefined,
        resolvedAt: undefined, entry: 4051.365, stopLoss: 4060.3, takeProfit: 4033.495, riskPips: 89.35 };
      const resolved = resolveZoneTableTrade(active, [record], 1793190300, [chartZoneId], ['SBR'])!;
      assert.equal(zoneTableCompletedStatus(resolved), `${result.toUpperCase()} HIT`);
      const html = renderToStaticMarkup(React.createElement(TradeDetailsRow, {
        trade: resolved, colSpan: 5,
      }));
      assert.equal(html, '');
      assert.equal(renderToStaticMarkup(React.createElement(ZoneTableEntryPrice, { trade: resolved })), '—');
      assert.equal(resolveZoneTableTrade(active, [record], 1793190215, [chartZoneId], ['SBR']), active);
      for (const otherZone of ['TJL2-1793124900-4055.3822', 'TJL1-1793125800-4055.3822', 'SBR-1793125800-4055.3822']) {
        assert.equal(resolveZoneTableTrade(active, [record], 1793190300, [otherZone], ['SBR']), active,
          'matching names and entry signals must not combine separate zones');
      }
    }
  }
});

test('completed zone price cells show the zone boundaries and pip width without trade prices', () => {
  const zone = { bottom: 4034.310, top: 4038.071 };
  for (const result of ['sl', 'tp'] as const) {
    const trade = tradeDrawingFromRecord({ id: 'DIRECT:range', zoneName: 'SBR', zoneTimeframe: 'M15',
      source: 'ENGULFING', signalTimeframe: 'M15', signalAt: 1000, openedAt: 1900, completedAt: 2800,
      direction: 'bearish', engulfingType: 'T3', result, entry: 4051.365,
      stopLoss: 4060.300, takeProfit: 4033.495, riskPips: 89.35, rewardRisk: 2 });
    const before = JSON.stringify({ trade, zone });
    const html = renderToStaticMarkup(React.createElement(ZoneTableEntryPrice, { trade, zone, pipSize: 0.1 }));
    assert.ok(html.includes('4,034.310 – 4,038.071'));
    assert.ok(html.includes('37.61 PIPS'));
    for (const hidden of ['ENTRY', '4,051.365', '4,060.300', '4,033.495']) assert.ok(!html.includes(hidden), hidden);
    assert.equal(zoneTableCompletedStatus(trade), `${result.toUpperCase()} HIT`);
    assert.equal(renderToStaticMarkup(React.createElement(TradeDetailsRow, { trade, colSpan: 5 })), '');
    const active = { ...trade, status: 'active' as const, result: undefined, resolvedAt: undefined };
    const activeHtml = renderToStaticMarkup(React.createElement(ZoneTableEntryPrice, { trade: active, zone, pipSize: 0.1 }));
    assert.ok(activeHtml.includes('ENTRY') && activeHtml.includes('4,051.365'));
    assert.equal(JSON.stringify({ trade, zone }), before);
  }
});

test('zone status uses broker SL/TP without bars-ago text or changing active status behavior', () => {
  assert.equal(zoneTableCompletedStatus({ status: 'active' }, { status: 'SL' }), 'SL HIT');
  assert.equal(zoneTableCompletedStatus({ status: 'active' }, { status: 'TP' }), 'TP HIT');
  assert.equal(zoneTableCompletedStatus({ result: 'sl' }, { status: 'ACTIVE' }), 'SL HIT');
  assert.equal(zoneTableCompletedStatus({ status: 'active' }), undefined);
});

test('Gold completed zone rows outlive drawings and expire beyond 20 candles from the first tap', () => {
  const candles = Array.from({ length: 52 }, (_, i) => bar(1000 + i * 900));
  for (const result of ['sl', 'tp'] as const) {
    const trade = { result, resolvedAt: 1000,
      signal: { timeframe: 'M15' as const, direction: 'bullish' as const } };
    const before = JSON.stringify(trade);
    for (const tapAge of [5, 6, 19, 20]) {
      const asOf = 1000 + (tapAge + 1) * 900;
      assert.equal(tradeDrawingExpired(trade, candles, asOf), true);
      assert.equal(zoneTableTradeExpired(trade, tapAge, candles, asOf), false);
      const html = renderToStaticMarkup(React.createElement(CompletedTradeRow, {
        name: 'Internal TJL1', trade, candles, asOf, colSpan: 5,
      }));
      assert.ok(html.includes(`${result.toUpperCase()} HIT`));
      assert.ok(!html.includes('CHART ACTIVE') && !html.includes('ENTRY'));
    }
    assert.equal(zoneTableTradeExpired(trade, 21, candles, 47800), true);
    assert.equal(zoneTableTradeExpired(trade, 2, candles, 47800), false,
      'a fresh first tap retains its own 20-candle window without restarting drawing expiry');
    assert.equal(JSON.stringify(trade), before);
  }
  assert.equal(zoneTableTradeExpired({ status: 'active' }, 21, candles, 47800), true,
    'Gold table rows hide after 20 bars even when the position remains open');
  assert.equal(tradeDrawingExpired({ status: 'active' }, candles, 47800), false,
    'the table window never hides an open trade drawing');
  assert.equal(zoneTableTradeExpired({ status: 'active' }, 51, candles, 47800, 1, 'EURUSD'), false,
    'Forex active trades keep their existing retention rules');
});

test('completed rows show only zone, exit outcome and bars since exit without entry levels', () => {
  for (const result of ['tp', 'sl'] as const) {
    const trade = { result, resolvedAt: 1000, entry: 4044.69, stopLoss: 4026.19, takeProfit: 4081.69 };
    const html = renderToStaticMarkup(React.createElement(CompletedTradeRow, {
      name: 'Internal TJL1', trade, candles: [1000, 1060, 1120, 1180].map(time => bar(time)), asOf: 1120, colSpan: 5,
    }));
    assert.ok(html.includes('Internal TJL1'));
    assert.ok(html.includes(`${result.toUpperCase()} HIT · 2 bars ago`));
    for (const obsolete of ['ENTRY', '4,044.690', '4,026.190', '4,081.690', 'CHART ACTIVE', 'T2', 'FIB']) {
      assert.ok(!html.includes(obsolete), obsolete);
    }
  }
});

test('exit age uses real bars, excludes future candles and does not count market gaps', () => {
  const trade = { status: 'TP', closedAt: 1000, openedAt: 100 };
  const candles = [1000, 1060, 10000, 10060].map(time => bar(time));
  assert.equal(completedTradeLabel(trade, candles, 1000), 'TP HIT · 0 bars ago');
  assert.equal(completedTradeLabel(trade, candles, 1060), 'TP HIT · 1 bar ago');
  assert.equal(completedTradeLabel(trade, candles, 10000), 'TP HIT · 2 bars ago');
  assert.equal(completedTradeLabel({ status: 'SL' }, candles, 10000), 'SL HIT');
  assert.equal(completedTradeLabel({ status: 'active' }, candles, 10000), undefined);
});

test('a retained active entry resolves on later candles and keeps the terminal outcome', () => {
  const trade = tradeDrawingFromRecord({ id: 'DIRECT:test', zoneName: 'Internal TJL1', zoneTimeframe: 'M15',
    source: 'ENGULFING', signalTimeframe: 'M15', signalAt: 100, openedAt: 1000, completedAt: 1000,
    direction: 'bullish', engulfingType: 'T2', result: 'tp', entry: 100, stopLoss: 98, takeProfit: 103,
    riskPips: 20, rewardRisk: 1.5 });
  const active = { ...trade, status: 'active' as const, result: undefined, resolvedAt: undefined };
  const before = JSON.stringify(active);
  const tp = resolveRetainedTrade(active, [bar(1000), { ...bar(1900), high: 104 }]);
  assert.equal(tp.result, 'tp');
  assert.equal(tp.resolvedAt, 1900);
  assert.equal(JSON.stringify(active), before, 'display resolution does not mutate the saved input');
  assert.equal(resolveRetainedTrade(tp, [{ ...bar(2800), low: 97 }]).result, 'tp');
  const sl = resolveRetainedTrade(active, [bar(1000), { ...bar(1900), low: 97 }]);
  assert.equal(sl.result, 'sl');
  assert.equal(sl.resolvedAt, 1900);
});

test('arrow details recover a missing journal main zone from its original broker signal', () => {
  const record: JournalTradeRecord = {
    id: 'MT5:original', symbol: 'XAUUSD', source: 'MTF', zoneName: 'SBR',
    zoneTimeframe: 'H1', signalTimeframe: 'M1', signalAt: 1000, direction: 'bearish',
    engulfingType: 'T3', entry: 100, stopLoss: 101, takeProfit: 97,
    riskPips: 10, rewardRisk: 3, completedAt: 1200, result: 'sl',
  };
  const original = { id: 'original', symbol: 'XAUUSD', signalAt: 1000,
    direction: 'SELL' as const, zoneTimeframe: 'H1' as const, signalTimeframe: 'M1' as const,
    zoneId: 'SUPPLY-1792659600-4090.14' };
  const before = JSON.stringify(record);
  assert.deepEqual(resolveArrowTradeZones(record, [original], () => undefined),
    { mainZone: 'SUPPLY', entryZone: 'SBR' });
  assert.equal(resolveArrowTradeZones(record, [{ ...original, symbol: 'EURUSD' }], () => undefined).mainZone,
    undefined, 'another market must not supply the main zone');
  assert.equal(resolveArrowTradeZones(record, [original, { ...original, id: 'other', zoneId: 'DB-1792659600-4090' }],
    () => undefined).mainZone, 'SUPPLY', 'the original execution wins over a same-candle candidate');
  assert.equal(JSON.stringify(record), before, 'display lookup must not rewrite history');
});

test('arrow details reconstruct modern and legacy MTF setup IDs and reject ambiguous zones', () => {
  const record: JournalTradeRecord = {
    id: 'MTF:M15-M1-external-choch-900:1000:100', symbol: 'XAUUSD', source: 'MTF',
    zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1', signalAt: 1000,
    direction: 'bullish', engulfingType: 'T1', entry: 100, stopLoss: 99, takeProfit: 103,
    riskPips: 10, rewardRisk: 3, completedAt: 1200, result: 'tp',
  };
  const context = { higherTimeframe: 'M15', lowerTimeframe: 'M1', direction: 'bullish',
    engulfingTime: 1000, engulfingType: 'T1', higherTimeframeZone: 'DB',
    higherTimeframeZoneId: 'DB-original', tappedZone: 'QML' } as MtfRow;
  assert.deepEqual(resolveArrowTradeZones(record, [], id => id === record.id ? context : undefined),
    { mainZone: 'DB', entryZone: 'QML' });
  const legacy = { ...record, id: 'MTF:M15-M1-choch-900:1000:100' };
  assert.equal(resolveArrowTradeZones(legacy, [], id => id === record.id ? context : undefined).mainZone, 'DB');
  assert.equal(resolveArrowTradeZones(legacy, [], id => id.includes('-internal-')
    ? { ...context, higherTimeframeZone: 'DT', higherTimeframeZoneId: 'DT-other' } : context).mainZone,
    undefined, 'conflicting historical matches must not produce a guessed zone');
  assert.equal(resolveArrowTradeZones(record, [], () => undefined).mainZone, undefined);
  assert.equal(resolveArrowTradeZones({ ...record, zoneId: 'TJL1-1791983700-4088.8021' }, [],
    () => { throw new Error('saved names do not require reconstruction'); }).mainZone, 'TJL1');
});

test('MTF display expires after five complete entry-timeframe bars, excluding the hit candle', () => {
  const candles = [1000, 1060, 1120, 1180, 1240, 1300].map(time => bar(time));
  assert.equal(mtfTableHitExpired(1000, candles, 1300, 'M1'), false);
  assert.equal(mtfTableHitExpired(1000, candles, 1360, 'M1'), true);
  assert.equal(mtfTableHitExpired(1000, [...candles.slice(0, -1), bar(1300, false)], 1360, 'M1'), false);
  assert.equal(mtfTableHitExpired(undefined, candles, 99999, 'M1'), false, 'open trades stay visible');
  const gaps = [1300, 1600, 1900, 10000, 10300].map(time => bar(time));
  assert.equal(mtfTableHitExpired(1000, gaps, 10300, 'M5'), false, 'market gaps are not candles');
  assert.equal(mtfTableHitExpired(1000, gaps, 10600, 'M5'), true);
});

test('SL, TP and risk-free stay five candles without resurrecting an expired setup', () => {
  for (const result of ['sl', 'tp', 'rf', 'risk-free'] as const) {
    const record: JournalTradeRecord = {
      id: 'MT5:expiry', setupId: 'MTF:original', source: 'MTF',
      zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1',
      direction: 'bullish', engulfingType: 'T1', signalAt: 800, openedAt: 900,
      completedAt: result === 'risk-free' ? 900 : 1000, partialClosedAt: result === 'rf' || result === 'risk-free' ? 1000 : undefined,
      result, entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10,
    };
    const props: React.ComponentProps<typeof MultiTimeframeEntryTable> = {
      rows: [{ id: 'original', setupId: 'MTF-1', higherTimeframe: 'M15', lowerTimeframe: 'M1',
        confirmationKind: 'choch', structureScope: 'external', direction: 'bullish', confirmationTime: 700,
        confirmationBarsAgo: 1, higherTimeframeZoneId: 'parent', higherTimeframeZone: 'DB',
        higherTimeframeTapTime: 700, higherTimeframeTapBarsAgo: 1, engulfingTime: 800 }],
      liveTrades: [], records: [record], timeZone: 'UTC',
      entryCandles: { M1: [1060, 1120, 1180, 1240, 1300].map(time => bar(time)) }, asOf: 1300,
    };
    const before = JSON.stringify(record);
    const immediate = renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, { ...props, asOf: 1000, entryCandles: {} }));
    assert.equal(immediate.includes('MTF table minimized'), false, result);
    assert.equal(renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, props)).includes('MTF table minimized'),
      false, result);
    const expired = renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, { ...props, asOf: 1360 }));
    assert.ok(expired.includes('MTF table minimized'), result);
    assert.ok(!expired.includes('MTF-1'), 'expired execution must not reappear as a setup');
    assert.equal(JSON.stringify(record), before, 'display filtering must leave journal history intact');
    const drawing = tradeDrawingFromRecord(record);
    assert.equal(tradeDisplayExpired(record, props.entryCandles.M1!, 1300), false);
    assert.equal(tradeDisplayExpired(drawing, props.entryCandles.M1!, 1300), false, 'chart matches table during retention');
    assert.equal(tradeDisplayExpired(drawing, props.entryCandles.M1!, 1360), true, 'chart expires with table');
    assert.equal(tradeDisplayExpired(drawing, props.entryCandles.M1!, 1300), false, 'replay rewind restores the same window');
  }
});

test('a live risk-free position hides after five bars while an ordinary open position remains visible', () => {
  const props: React.ComponentProps<typeof MultiTimeframeEntryTable> = {
    rows: [], records: [], timeZone: 'UTC', asOf: 1360,
    entryCandles: { M1: [1000, 1060, 1120, 1180, 1240, 1300].map(time => bar(time)) },
    liveTrades: [{
      position: { ticket: 1, symbol: 'XAUUSD', direction: 'BUY', volume: 1, priceOpen: 100,
        priceCurrent: 102, stopLoss: 100, takeProfit: 103, profit: 2, swap: 0, openedAt: 900,
        source: 'MTF', zoneTimeframe: 'M15', signalTimeframe: 'M1', signalStatus: 'RISK_FREE' },
      trade: { entry: 100, stopLoss: 99, takeProfit: 103, riskFree: 101, riskFreeEnabled: true,
        riskPips: 10, rewardRisk: 3, status: 'active', pendingAtCreation: false, calculatedAt: 900, filledAt: 900,
        signal: { type: 'T1', direction: 'bullish', timeframe: 'M1', time: 800, candleCount: 2 } },
    }],
  };
  const render = () => renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, props));
  assert.ok(render().includes('MTF table minimized'));
  props.asOf = 1300;
  assert.ok(!render().includes('MTF table minimized'), 'risk-free stays visible through four completed candles');
  props.asOf = 1360;
  props.liveTrades[0].position.signalStatus = 'ACTIVE';
  assert.ok(!render().includes('MTF table minimized'), 'an active trade without an RF event has no expiry');
});

test('entry/SL/TP drawings stay visible through RF while the position remains open', () => {
  const candles = Array.from({ length: 31 }, (_, index) => bar(1000 + index * 60));
  for (const direction of ['bullish', 'bearish'] as const) {
    for (const status of ['active', 'risk-free', 'RISK_FREE'] as const) {
      const trade = { status, partialClosedAt: 1000, updatedAt: 1000,
        signal: { timeframe: 'M1' as const, direction } };
      assert.equal(tradeDrawingExpired(trade, candles, 2860), false, `${direction} ${status}`);
    }
  }
  const record: JournalTradeRecord = {
    id: 'MT5:rf-open', source: 'MTF', zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1',
    direction: 'bullish', engulfingType: 'T1', signalAt: 800, openedAt: 900,
    completedAt: 1000, partialClosedAt: 1000, result: 'risk-free',
    entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10,
  };
  assert.equal(tradeDrawingExpired(record, candles, 2860), false, 'reload retains an open RF record');
  assert.equal(tradeDrawingExpired(tradeDrawingFromRecord(record), candles, 2860), false);
});

test('RF followed by SL or TP starts drawing expiry at the final hit, not the partial close', () => {
  const candles = Array.from({ length: 16 }, (_, index) => bar(1000 + index * 60));
  for (const result of ['sl', 'tp', 'rf'] as const) {
    const record: JournalTradeRecord = {
      id: `MT5:rf-${result}`, source: 'MTF', zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1',
      direction: 'bullish', engulfingType: 'T1', signalAt: 800, openedAt: 900,
      partialClosedAt: 1000, completedAt: 1600, closedAt: 1600, result,
      entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10,
    };
    const drawing = tradeDrawingFromRecord(record);
    assert.equal(tradeDrawingExpired(record, candles, 1900), false, `${result}: four completed bars`);
    assert.equal(tradeDrawingExpired(drawing, candles, 1900), false);
    assert.equal(tradeDrawingExpired(record, candles, 1960), true, `${result}: fifth completed bar`);
    assert.equal(tradeDrawingExpired(drawing, candles, 1960), true);
    assert.equal(tradeDrawingExpired(drawing, [...candles.slice(0, -1), bar(1900, false)], 1960), false);
    assert.equal(tradeDrawingExpired(drawing, candles, 1900), false, 'rewinding restores the retention window');
  }
  const brokerRf = { status: 'RF', signalTimeframe: 'M1' as const, partialClosedAt: 1000, updatedAt: 1600 };
  assert.equal(tradeDrawingExpired(brokerRf, candles, 1900), false);
  assert.equal(tradeDrawingExpired(brokerRf, candles, 1960), true);
  assert.equal(tradeDrawingExpired({ status: 'sl-hit', signalTimeframe: 'M1' }, candles, 9999), false,
    'an unknown final hit time cannot start a countdown');
});

test('an unresolved MTF execution retains its source and prices without an active setup', () => {
  const record: JournalTradeRecord = {
    id: 'MT5:original', brokerTicket: 101033888, source: 'MTF',
    zoneId: 'Internal DT-1793004300-4022.31', setupId: 'MTF:M15-M1-external-choch-1793029860',
    symbol: 'XAUUSD', zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1',
    direction: 'bearish', engulfingType: 'T3', tradeStyle: 'SCALPING',
    signalAt: 1793034120, openedAt: 1793034182, completedAt: 1793034301,
    result: 'open', entry: 4021.48, stopLoss: 4024.05, takeProfit: 4014.01,
    rewardRisk: 3, riskPips: 25.7,
  };
  const render = (rows: React.ComponentProps<typeof MultiTimeframeEntryTable>['rows']) => renderToStaticMarkup(
    React.createElement(MultiTimeframeEntryTable, { rows, liveTrades: [], records: [record], timeZone: 'Asia/Kathmandu',
      entryCandles: {}, asOf: record.completedAt }),
  );
  const html = render([]);
  for (const text of ['Internal DT', 'M1 QML', 'STATUS UNKNOWN', '4,021.480', '4,024.050', '4,014.010']) {
    assert.ok(html.includes(text), `missing ${text}`);
  }
  assert.ok(!html.includes('MTF table minimized'));
  assert.ok(html.includes('Original entry-zone drawing not saved'), 'legacy records must not invent a zone');
  const duplicate = render([{
    id: 'M15-M1-external-choch-1793029860', setupId: 'MTF-1',
    higherTimeframe: 'M15', lowerTimeframe: 'M1', confirmationKind: 'choch', structureScope: 'external',
    direction: 'bearish', confirmationTime: 1793029860, confirmationBarsAgo: 1,
    higherTimeframeZoneId: record.zoneId!, higherTimeframeZone: 'Internal DT',
    higherTimeframeTapTime: 1793029860, higherTimeframeTapBarsAgo: 1,
    engulfingTime: record.signalAt, engulfingType: 'T3',
  }]);
  assert.ok(!duplicate.includes('MTF-1'), 'the recalculated setup must not duplicate the saved execution');
});

test('the display filter recognizes chart and broker SL/TP without hiding open or risk-free trades', () => {
  for (const status of ['SL', 'TP', 'sl-hit', 'tp-hit']) assert.equal(isSlTpTradeDisplayFinished({ status }), true);
  for (const result of ['sl', 'tp']) assert.equal(isSlTpTradeDisplayFinished({ result }), true);
  for (const status of ['active', 'pending', 'risk-free', 'RISK_FREE']) assert.equal(isSlTpTradeDisplayFinished({ status }), false);
  assert.equal(isSlTpTradeDisplayFinished({ result: 'rf' }), false);
  assert.equal(isSlTpTradeDisplayFinished(undefined), false);
});


function reloadMtfRecord(result: JournalTradeRecord['result'] = 'tp'): JournalTradeRecord {
  return { id: 'reload-record', brokerTicket: 12345, setupId: 'MTF:reload', source: 'MTF',
    zoneName: 'QML', zoneTimeframe: 'M15', signalTimeframe: 'M1', direction: 'bullish',
    engulfingType: 'T1', signalAt: 800, openedAt: 900, completedAt: 1000,
    partialClosedAt: result === 'rf' ? 1000 : undefined,
    result, entry: 100, stopLoss: 99, takeProfit: 103, rewardRisk: 3, riskPips: 10 };
}

function reloadMtfProps(): React.ComponentProps<typeof MultiTimeframeEntryTable> {
  return { rows: [], liveTrades: [], records: [], timeZone: 'UTC', entryCandles: {}, asOf: 1360 };
}

const renderReloadTable = (props: React.ComponentProps<typeof MultiTimeframeEntryTable>) =>
  renderToStaticMarkup(React.createElement(MultiTimeframeEntryTable, props));

test('reload with delayed entry candles never flashes old SL, TP or RF records', () => {
  for (const result of ['sl', 'tp', 'rf'] as const) {
    const record = reloadMtfRecord(result);
    const original = structuredClone(record);
    const props = { ...reloadMtfProps(), records: [record] };
    const loading = renderReloadTable(props);
    assert.ok(loading.includes('Loading MTF data'));
    assert.ok(!loading.includes('ENTRY 100.000'), 'closed trade prices stay hidden during loading');
    assert.ok(!loading.includes('MTF table minimized'), 'missing data is not an empty table');
    const loaded = renderReloadTable({ ...props,
      entryCandles: { M1: [1060,1120,1180,1240,1300].map(time => bar(time)) } });
    assert.ok(loaded.includes('MTF table minimized'));
    assert.ok(!loaded.includes('ENTRY 100.000'), 'expired trades never flash back after loading');
    assert.deepEqual(record, original, 'table loading must not rewrite saved trades');
  }
});

test('loaded recent results retain exactly five completed candles and ignore other timeframes', () => {
  const props = { ...reloadMtfProps(), records: [reloadMtfRecord()] };
  assert.ok(renderReloadTable({ ...props, entryCandles: { M15: [bar(1000)] } }).includes('Loading MTF data'));
  const candles = [1060,1120,1180,1240,1300].map(time => bar(time));
  const retained = renderReloadTable({ ...props, asOf: 1300, entryCandles: { M1: candles } });
  assert.ok(retained.includes('TP HIT'));
  assert.ok(retained.includes('TP HIT · 5 bars ago'));
  assert.ok(!retained.includes('ENTRY 100.000'));
  assert.ok(!retained.includes('Loading MTF data'));
  assert.ok(renderReloadTable({ ...props, asOf: 1360, entryCandles: { M1: candles } }).includes('MTF table minimized'));
});

test('initial MTF loading and failed feeds show status with retry instead of a false empty table', () => {
  let retries = 0;
  const props = { ...reloadMtfProps(), requiredTimeframes: ['M1'] as const, onRetry: () => { retries++; } };
  assert.ok(renderReloadTable(props).includes('Loading MTF data'));
  const failed = renderReloadTable({ ...props, records: [reloadMtfRecord()], candleErrors: { M1: 'Feed unavailable' } });
  assert.ok(failed.includes('Unable to load MTF candle data (M1)'));
  assert.ok(failed.includes('Retry'));
  assert.ok(!failed.includes('ENTRY 100.000'));
  assert.equal(retries, 0, 'rendering an error must not trigger reload loops');
  const recovered = renderReloadTable({ ...props, records: [reloadMtfRecord()],
    entryCandles: { M1: [1060,1120,1180,1240,1300].map(time => bar(time)) } });
  assert.ok(!recovered.includes('Unable to load'));
  assert.ok(!recovered.includes('Loading MTF data'));
});

test('open and risk-free positions remain visible alongside loading or failure status', () => {
  for (const result of ['open','risk-free'] as const) {
    const record = reloadMtfRecord(result);
    const props = { ...reloadMtfProps(), records: [record], requiredTimeframes: ['M1'] as const };
    assert.ok(renderReloadTable(props).includes('ENTRY 100.000'), result);
    assert.ok(renderReloadTable({ ...props, candleErrors: { M1: 'Missing feed' } }).includes('ENTRY 100.000'), result);
    const trade = { ...tradeDrawingFromRecord(record), status: result === 'open' ? 'active' as const : 'risk-free' as const };
    const live: React.ComponentProps<typeof MultiTimeframeEntryTable>['liveTrades'] = [{ trade,
      position: { ticket: 12345, symbol: 'XAUUSD', direction: 'BUY', volume: 1,
        priceOpen: 100, priceCurrent: 102, stopLoss: 99, takeProfit: 103, profit: 2, swap: 0,
        openedAt: 900, source: 'MTF', zoneTimeframe: 'M15', signalTimeframe: 'M1',
        signalStatus: result === 'open' ? 'ACTIVE' : 'RISK_FREE' } }];
    const liveMarkup = renderReloadTable({ ...props, liveTrades: live });
    assert.ok(liveMarkup.includes('MT5 #12345'));
    assert.ok(liveMarkup.includes('Loading MTF data'));
  }
});
