import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { seedDashboardSession } from './helpers/dashboardSession';
import { buildIntradayPullbackSignals } from '../src/services/intradayPullback';
import type { Mt5SignalInput } from '../src/services/mt5Automation';

test('MT5 account handshake resets old candles and queues while preserving automation settings', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'mt5-connection-test-'));
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer();
    listener.on('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      assert.ok(address && typeof address !== 'string');
      listener.close(() => resolve(address.port));
    });
  });
  const dataPath = path.join(workspace, 'data');
  await mkdir(dataPath);
  await writeFile(path.join(dataPath, 'mt5-automation.json'), JSON.stringify({
    enabled: false, dryRun: true, riskPercent: 0.5, brokerSymbol: 'old-symbol',
  }));
  await writeFile(path.join(dataPath, 'mt5-signals.json'), JSON.stringify({ signals: [
    { id: 'old-queued', status: 'QUEUED', updatedAt: 1 },
    { id: 'old-active', status: 'ACTIVE', account: 'old', server: 'old', updatedAt: 1 },
  ] }));
  const serverPath = fileURLToPath(new URL('../server.ts', import.meta.url));
  const tsxPath = new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href;
  const cookie = await seedDashboardSession(workspace);
  // This isolated connection test must not depend on the live calendar or its rate limits.
  const calendarFixture = `data:text/javascript,${encodeURIComponent(`
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://nfs.faireconomy.media/ff_calendar_thisweek.json') {
        return Promise.resolve(new Response(JSON.stringify([
          { country: 'USD', impact: 'Low', date: '2026-01-01T00:00:00Z' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return originalFetch(input, init);
    };
  `)}`;
  const child = spawn(process.execPath, ['--import', tsxPath, '--import', calendarFixture, serverPath], {
    cwd: workspace, windowsHide: true,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', MT5_BRIDGE_TOKEN: 'isolated-test-token', AUTH_PUBLIC_URL: `http://127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  const request = async (route: string, body?: unknown, method = 'POST') => fetch(`${base}${route}`, {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer isolated-test-token', Cookie: cookie, Origin: base },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { ready = (await request('/api/mt5/status')).ok; } catch { /* Server is starting. */ }
      if (ready) break;
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    const first = { bridgeId: 'test-bridge', account: '123', server: 'Broker-A', brokerSymbol: 'XAUUSD.x', balance: 12345, equity: 12400,
      terminalConnected: true, symbolResolved: true, symbolCandidates: ['XAUUSD.x'],
      positions: [{ ticket: 77, identifier: 77, openedAtMsc: 1700000000000, magic: 0, symbol: 'XAUUSD.x',
        direction: 'BUY', volume: 0.02, priceOpen: 4000, priceCurrent: 4001, stopLoss: 3990,
        takeProfit: 4020, profit: 2, swap: 0, openedAt: 1700000000 }],
      fibProfitEvents: [{ ticket: 77, direction: 'BUY', originalVolume: 0.05, remainingVolume: 0.01,
        status: 'partial', phase: 'touch', updatedAt: 1000, zoneTimeframe: 'M15', zoneName: 'QML' }] };
    assert.equal((await request('/api/mt5/heartbeat', first)).status, 200);
    let status = await (await request('/api/mt5/status')).json();
    assert.deepEqual(status.bridge.fibProfitEvents, first.fibProfitEvents);
    assert.equal(status.config.brokerSymbol, 'XAUUSD.x');
    assert.equal(status.config.brokerSymbolAccount, '123');
    assert.equal(status.config.enabled, false);
    assert.equal(status.config.dryRun, true);
    assert.equal(status.config.riskPercent, 0.5);
    assert.equal(status.config.intradayRiskPercent, 0.5, 'legacy shared risk initializes Intraday');
    assert.equal(status.config.scalpingRiskPercent, 0.5, 'legacy shared risk initializes Scalping');
    assert.equal(status.config.tradingTimeEnabled, false, 'missing session setting defaults OFF');
    assert.equal(status.counts.REJECTED, 1);
    assert.equal(status.counts.ACTIVE, 1, 'existing positions are not rewritten on connection changes');
    assert.equal(status.positions[0].fibExitTimeframe, undefined, 'never infer a manual timeframe');
    const timeframeRequest = { ...first, timeframe: 'M15', identifier: 77, openedAtMsc: 1700000000000 };
    assert.equal((await request('/api/mt5/positions/77/timeframe', timeframeRequest, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.positions[0].fibExitTimeframe, 'M15');
    assert.equal((await request('/api/mt5/positions/77/timeframe', { ...timeframeRequest, openedAtMsc: 1700000000001 }, 'PUT')).status, 409);
    assert.equal((await request('/api/mt5/positions/77/timeframe', { ...timeframeRequest, account: 'foreign' }, 'PUT')).status, 409);
    assert.equal((await request('/api/mt5/positions/77/timeframe', { ...timeframeRequest, timeframe: 'M2' }, 'PUT')).status, 400);
    assert.equal((await request('/api/mt5/positions/77/timeframe', { ...timeframeRequest, timeframe: '' }, 'PUT')).status, 200);
    assert.equal((await (await request('/api/mt5/status')).json()).positions[0].fibExitTimeframe, undefined);
    assert.equal((await request('/api/mt5/positions/77/timeframe', timeframeRequest, 'PUT')).status, 200);
    const now = Math.floor(Date.now() / 1000);
    const candles = Array.from({ length: 10 }, (_, index) => ({
      time: now - (9 - index) * 60, open: 4000, high: 4002, low: 3998, close: 4001, volume: 10, complete: index < 9,
    }));
    const snapshot = { ...first, symbol: first.brokerSymbol, timeframe: 'M1', candles };
    assert.equal((await request('/api/mt5/market-data', snapshot)).status, 202);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.marketData.timeframes.M1.count, 10);
    assert.equal((await request('/api/mt5/market-data', { ...snapshot, account: 'foreign' })).status, 409);
    const second = { ...first, account: '456', server: 'Broker-B', brokerSymbol: 'XAUUSDm', symbolCandidates: ['XAUUSDm'],
      positions: first.positions.map(position => ({ ...position, symbol: 'XAUUSDm' })) };
    assert.equal((await request('/api/mt5/heartbeat', second)).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.brokerSymbol, 'XAUUSDm');
    assert.equal(status.config.brokerSymbolAccount, '456');
    assert.equal(status.positions[0].fibExitTimeframe, undefined, 'a timeframe assignment cannot follow a reused ticket into another account');
    assert.equal(status.marketData.timeframes.M1.count, 0, 'old account candles are discarded');
    assert.equal((await request('/api/mt5/market-data', snapshot)).status, 409);
    assert.equal((await request('/api/mt5/signals/old-active/status', { status: 'SL', account: '456', server: 'Broker-B' })).status, 500);
    const ambiguous = { ...second, brokerSymbol: '', symbolResolved: false, symbolCandidates: ['XAUUSD', 'XAUUSDm'] };
    assert.equal((await request('/api/mt5/heartbeat', ambiguous)).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.marketData.fresh, false);
    assert.equal(status.bridge.symbolResolved, false);
    const selection = { ...status.config, brokerSymbol: 'XAUUSD', brokerSymbolAccount: '456', brokerSymbolServer: 'Broker-B' };
    assert.equal((await request('/api/mt5/config', selection, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.brokerSymbol, 'XAUUSD');
    assert.equal(status.config.brokerSymbolServer, 'Broker-B');
    assert.equal(status.config.enabled, false);
    assert.equal((await request('/api/mt5/config', { ...status.config, tradingTimeEnabled: true }, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.tradingTimeEnabled, true, 'session filtering can still be enabled explicitly');
    const { tradingTimeEnabled: omittedSession, ...partialSettings } = status.config;
    assert.equal((await request('/api/mt5/config', partialSettings, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.tradingTimeEnabled, true, 'omitting the setting preserves the saved selection');
    assert.equal((await request('/api/mt5/config', { ...status.config, tradingTimeEnabled: false }, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.tradingTimeEnabled, false);
    assert.equal((await request('/api/mt5/config', { ...status.config, maximumDailyLossPercent: 8 }, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.maximumDailyLossPercent, 5, 'server caps the daily loss control at 5%');
    assert.equal(status.config.scalpOneToOneEnabled, false);
    assert.equal(status.config.scalpOneToOneRiskPercent, 0.25);
    assert.equal((await request('/api/mt5/config', { ...status.config, scalpOneToOneRiskPercent: 0.75 }, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.scalpOneToOneRiskPercent, 0.75);
    assert.equal(status.config.riskPercent, 0.5, 'Scalp 1:1 selection leaves general risk unchanged');
    assert.equal((await request('/api/mt5/config', { ...status.config, scalpOneToOneRiskPercent: 5 }, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.scalpOneToOneRiskPercent, 0.75, 'invalid scalp risk preserves the saved selection');
    const dailyRisk = { available: true, date: '2026-10-24', startingBalance: 10000, limitPercent: 2,
      limitMoney: 200, realizedLossMoney: 120, floatingLossMoney: 80, usedMoney: 200, usedPercent: 2,
      remainingMoney: 0, remainingPercent: 0, reservedRiskMoney: 120, availableRiskMoney: 0,
      availableRiskPercent: 0, limitReached: true, riskUnbounded: false };
    assert.equal((await request('/api/mt5/heartbeat', { ...second, dailyRisk })).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.deepEqual(status.bridge.dailyRisk, dailyRisk, 'dashboard gets the bridge percentage and account-currency figures');
    assert.equal((await request('/api/mt5/heartbeat', { ...second, dailyRisk: { ...dailyRisk, usedMoney: -1 } })).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.bridge.dailyRisk.available, false, 'invalid risk data does not become a zero-loss reading');

    // Two terminals must not overwrite each other's connection, candles, risk or journal.
    const secondary = { ...first, bridgeId: 'secondary-bridge', account: '789', server: 'Broker-C' };
    const secondaryRoute = (route: string) => `${route}?terminal=secondary`;
    let secondaryStatus = await (await request(secondaryRoute('/api/mt5/status'))).json();
    assert.equal(secondaryStatus.config.enabled, false);
    assert.equal(secondaryStatus.config.dryRun, true);
    assert.equal((await request(secondaryRoute('/api/mt5/heartbeat'), second)).status, 409,
      'the same live account cannot be connected twice');
    assert.equal((await request(secondaryRoute('/api/mt5/heartbeat'), secondary)).status, 200);
    assert.equal((await request(secondaryRoute('/api/mt5/market-data'), { ...snapshot, ...secondary, symbol: secondary.brokerSymbol })).status, 202);
    status = await (await request('/api/mt5/status')).json();
    secondaryStatus = await (await request(secondaryRoute('/api/mt5/status'))).json();
    assert.equal(status.bridge.account, '456');
    assert.equal(status.marketData.timeframes.M1.count, 0);
    assert.equal(secondaryStatus.bridge.account, '789');
    assert.equal(secondaryStatus.marketData.timeframes.M1.count, 10);
    assert.equal((await request('/api/mt5/market-data', { ...snapshot, ...secondary, symbol: secondary.brokerSymbol })).status, 409);
    assert.equal((await request(secondaryRoute('/api/mt5/config'), {
      ...secondaryStatus.config, riskPercent: 1.5, scalpOneToOneRiskPercent: 1, maximumDailyLossPercent: 3,
      tradingTimeEnabled: true, mtfLtfFibRequired: true,
    }, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    secondaryStatus = await (await request(secondaryRoute('/api/mt5/status'))).json();
    assert.equal(status.config.riskPercent, 0.5, 'account 1 keeps its own risk');
    assert.equal(status.config.maximumDailyLossPercent, 5);
    assert.equal(status.config.mtfLtfFibRequired, true, 'strategy settings are shared');
    assert.equal(status.config.tradingTimeEnabled, true);
    assert.equal(secondaryStatus.config.riskPercent, 1.5);
    assert.equal(status.config.scalpOneToOneRiskPercent, 0.75, 'primary scalp risk stays independent');
    assert.equal(secondaryStatus.config.scalpOneToOneRiskPercent, 1, 'secondary has its own scalp risk');
    assert.equal(secondaryStatus.config.maximumDailyLossPercent, 3);
    assert.equal(secondaryStatus.config.enabled, false);
    assert.equal(secondaryStatus.counts.ACTIVE, undefined, 'account 1 signals cannot leak into account 2');
    const record = { id: 'same-local-id', completedAt: now, source: 'ENGULFING', entry: 4000 };
    assert.equal((await request('/api/journal/trades', { trades: [{ ...record, reason: 'primary' }] })).status, 200);
    assert.equal((await request(secondaryRoute('/api/journal/trades'), { trades: [{ ...record, reason: 'secondary' }] })).status, 200);
    const primaryJournal = await (await request('/api/journal/trades')).json();
    const secondaryJournal = await (await request(secondaryRoute('/api/journal/trades'))).json();
    assert.equal(primaryJournal.trades[0].reason, 'primary');
    assert.equal(secondaryJournal.trades[0].reason, 'secondary');
    const accounts = await (await request('/api/mt5/accounts')).json();
    assert.deepEqual(accounts.accounts.map((account: any) => account.account), ['456', '789']);
    assert.equal((await request('/api/mt5/status?terminal=unknown')).status, 400);
    assert.equal((await request(secondaryRoute('/api/mt5/signals/old-active/status'),
      { status: 'SL', account: 'old', server: 'old' })).status, 404,
      'a secondary bridge cannot update a primary signal even when it knows its ID');
    const availableRisk = { ...dailyRisk, usedMoney: 0, usedPercent: 0, limitReached: false,
      remainingMoney: 200, remainingPercent: 2, reservedRiskMoney: 0,
      availableRiskMoney: 200, availableRiskPercent: 2, realizedLossMoney: 0, floatingLossMoney: 0 };
    await request('/api/mt5/heartbeat', { ...second, dailyRisk: availableRisk });
    await request(secondaryRoute('/api/mt5/heartbeat'), { ...secondary, dailyRisk: availableRisk });
    await request('/api/mt5/market-data', { ...snapshot, ...second, symbol: second.brokerSymbol });
    await request(secondaryRoute('/api/mt5/market-data'), { ...snapshot, ...secondary, symbol: secondary.brokerSymbol });
    // Only the isolated test server reads these synthetic files. No terminal is connected.
    await writeFile(path.join(dataPath, 'mt5-automation.json'), JSON.stringify({
      ...status.config, enabled: true, dryRun: true, tradingTimeEnabled: false,
    }));
    await writeFile(path.join(dataPath, 'mt5-automation.secondary.json'), JSON.stringify({
      ...secondaryStatus.config, enabled: true, dryRun: true,
    }));
    const queuedSignal = { id: 'same-signal', status: 'QUEUED', symbol: 'XAUUSD', source: 'ENGULFING',
      zoneTimeframe: 'H1', signalTimeframe: 'M15', tradeStyle: 'INTRADAY', direction: 'BUY',
      orderType: 'LIMIT', entry: 4000, stopLoss: 3990, takeProfit: 4020, riskFree: 4010,
      rewardRisk: 2, riskPips: 100, signalAt: now, calculatedAt: now,
      createdAt: now, updatedAt: now, expiresAt: now + 600 };
    await writeFile(path.join(dataPath, 'mt5-signals.json'), JSON.stringify({ signals: [
      { ...queuedSignal, account: second.account, server: second.server, brokerSymbol: second.brokerSymbol },
    ] }));
    await writeFile(path.join(dataPath, 'mt5-signals.secondary.json'), JSON.stringify({ signals: [
      { ...queuedSignal, account: secondary.account, server: secondary.server, brokerSymbol: secondary.brokerSymbol },
    ] }));
    const wrongClaim = await (await request(secondaryRoute('/api/mt5/signals/claim'), second)).json();
    assert.equal(wrongClaim.signal, null, 'wrong-account claim cannot consume an order');
    const claimed = await Promise.all([
      request('/api/mt5/signals/claim', second).then(response => response.json()),
      request(secondaryRoute('/api/mt5/signals/claim'), secondary).then(response => response.json()),
    ]);
    const claimStatus = await (await request('/api/mt5/status')).json();
    assert.equal(claimed[0].signal?.account, '456', JSON.stringify({
      fresh: claimStatus.marketData?.fresh, risk: claimStatus.bridge?.dailyRisk,
      news: claimStatus.newsCalendar, error: claimed[0].error,
    }));
    assert.equal(claimed[1].signal?.account, '789');
    assert.equal(claimed[0].config.riskPercent, 0.5);
    assert.equal(claimed[1].config.riskPercent, 1.5);
    assert.equal((await (await request('/api/mt5/signals/claim', second)).json()).signal, null,
      'a repeated poll cannot claim the same order twice');

    // Layered orders have distinct identities and a common frozen budget. This
    // fixture stays in the isolated server's temp directory; no broker is used.
    const configFile = path.join(dataPath, 'mt5-automation.json');
    const beforeLayers = JSON.parse(await readFile(configFile, 'utf8'));
    await writeFile(configFile, JSON.stringify({ ...beforeLayers, scalpOneToOneEnabled: true,
      scalpOneToOneRiskPercent: 1, telegramMessagesEnabled: false }));
    const layers = ([10, 25] as const).map(leg => {
      const entry = leg === 10 ? 3999 : 3997.5;
      return { ...queuedSignal, ...second, id: `SCALP_1_1:test:P${leg}`,
        setupId: `SCALP_1_1:test:P${leg}`, zoneId: `SCALP_1_1-test-P${leg}`,
        zoneName: 'Scalp 1:1', zoneTimeframe: 'M15', tradeStyle: 'SCALP_1_1', engulfingType: 'T1',
        signalAt: now - 900, calculatedAt: now, expiresAt: now + 900,
        entry, stopLoss: 3990, takeProfit: 4010, riskFree: 4010,
        riskPips: (entry - 3990) * 10, rewardRisk: (4010 - entry) / (entry - 3990),
        scalpSetupRiskBudget: 50,
        scalpEntry: { version: 1, leg, riskShare: leg === 10 ? 0.6 : 0.4,
          referenceEntry: 4000, nextOpen: 4000, confirmationBody: 10 },
        journalContext: { volume1: 1000, volume2: 750, volumeLogicStatus: 'valid',
          biasAtEntry: { H4: 'bullish' }, entrySnapshotCandles: [], autoReason: 'Isolated pullback test.' },
      };
    });
    await writeFile(path.join(dataPath, 'mt5-signals.json'), JSON.stringify({ signals: layers }));
    const firstLayer = await (await request('/api/mt5/signals/claim', second)).json();
    const secondLayer = await (await request('/api/mt5/signals/claim', second)).json();
    assert.equal(firstLayer.signal?.scalpEntry.leg, 10);
    assert.equal(secondLayer.signal?.scalpEntry.leg, 25, JSON.stringify(secondLayer));
    assert.equal(firstLayer.signal.scalpSetupRiskBudget, secondLayer.signal.scalpSetupRiskBudget);
    for (const [index, layer] of layers.entries()) {
      assert.equal((await request(`/api/mt5/signals/${encodeURIComponent(layer.id)}/status`, {
        ...second, status: 'PLACED', brokerTicket: 10010 + index, executionPrice: layer.entry,
        openedAt: now, volume: 0.02,
      })).status, 200);
    }
    // A fast limit fill can reach TP between polls, without an ACTIVE callback.
    assert.equal((await request(`/api/mt5/signals/${encodeURIComponent(layers[0].id)}/status`, {
      ...second, status: 'TP', closedAt: now, closePrice: 4010, realizedProfit: 36,
    })).status, 200);
    assert.equal((await (await request('/api/mt5/signals/claim', second)).json()).signal, null);
    const afterLayers = JSON.parse(await readFile(path.join(dataPath, 'mt5-signals.json'), 'utf8')).signals;
    assert.equal(afterLayers.find((s: any) => s.scalpEntry.leg === 25).status, 'CANCELLED',
      'a sibling target cancels the still-unfilled second order');
    const layerJournal = JSON.parse(await readFile(path.join(dataPath, 'trade-journal.json'), 'utf8')).trades;
    assert.equal(layerJournal.find((r: any) => r.mt5SignalId === layers[0].id).scalpEntry.riskShare, 0.6);
    await writeFile(path.join(dataPath, 'mt5-signals.json'), JSON.stringify({ signals: [
      { ...layers[0], scalpEntry: { ...layers[0].scalpEntry, riskShare: 1 } },
    ] }));
    assert.equal((await (await request('/api/mt5/signals/claim', second)).json()).signal, null);
    assert.equal(JSON.parse(await readFile(path.join(dataPath, 'mt5-signals.json'), 'utf8')).signals[0].status, 'REJECTED',
      'a queued leg cannot claim 100% of setup risk');

    const intradayBase: Mt5SignalInput = { ...queuedSignal, id: 'intraday-test', symbol: 'XAUUSD',
      setupId: 'DIRECT:M15:intraday-zone', zoneId: 'intraday-zone', zoneName: 'TJL1', zoneTimeframe: 'M15',
      signalTimeframe: 'M15', tradeStyle: 'INTRADAY', source: 'ENGULFING', direction: 'BUY', orderType: 'MARKET',
      engulfingType: 'T1', signalAt: now - 900, calculatedAt: now,
      entry: 4000, stopLoss: 3980, takeProfit: 4040, riskFree: 4020, rewardRisk: 2, riskPips: 200 };
    const intradayOrders = buildIntradayPullbackSignals(intradayBase, [
      { time: now - 900, open: 3990, close: 4000, high: 4001, low: 3982, complete: true },
      { time: now, open: 4000, close: 4000, high: 4001, low: 3997, complete: false },
    ]).map(signal => ({ ...signal, ...second, status: 'QUEUED', intradaySetupRiskBudget: 50,
      createdAt: now, updatedAt: now }));
    assert.equal(intradayOrders.length, 2);
    await writeFile(path.join(dataPath, 'mt5-signals.json'), JSON.stringify({ signals: intradayOrders }));
    const intraFirst = await (await request('/api/mt5/signals/claim', second)).json();
    const intraSecond = await (await request('/api/mt5/signals/claim', second)).json();
    assert.equal(intraFirst.signal?.intradayEntry.leg, 10);
    assert.equal(intraSecond.signal?.intradayEntry.leg, 25, JSON.stringify(intraSecond));
    assert.equal(intraFirst.signal.intradaySetupRiskBudget, intraSecond.signal.intradaySetupRiskBudget);
    const forgedIntraday = await request('/api/mt5/signals', intradayOrders[0]);
    assert.equal(forgedIntraday.ok, false, 'browser submissions cannot bypass scanner qualification for split risk');
    assert.match((await forgedIntraday.json()).error, /server strategy scanner/);
    for (const [index, order] of intradayOrders.entries()) {
      assert.equal((await request(`/api/mt5/signals/${encodeURIComponent(order.id)}/status`, {
        ...second, status: 'PLACED', brokerTicket: 20010 + index, executionPrice: order.entry,
        openedAt: now, volume: 0.01,
      })).status, 200);
    }
    await request(`/api/mt5/signals/${encodeURIComponent(intradayOrders[0].id)}/status`, {
      ...second, status: 'TP', closedAt: now, closePrice: 4040, realizedProfit: 41,
    });
    assert.equal((await (await request('/api/mt5/signals/claim', second)).json()).signal, null);
    const intradayStored = JSON.parse(await readFile(path.join(dataPath, 'mt5-signals.json'), 'utf8')).signals;
    assert.equal(intradayStored.find((s: any) => s.intradayEntry.leg === 25).status, 'CANCELLED');
    const intraJournal = JSON.parse(await readFile(path.join(dataPath, 'trade-journal.json'), 'utf8')).trades;
    assert.equal(intraJournal.find((r: any) => r.mt5SignalId === intradayOrders[0].id).intradayEntry.riskShare, 0.6);
    await writeFile(path.join(dataPath, 'mt5-signals.json'), JSON.stringify({ signals: [
      { ...intradayOrders[0], intradayEntry: { ...intradayOrders[0].intradayEntry!, riskShare: 1 } },
    ] }));
    assert.equal((await (await request('/api/mt5/signals/claim', second)).json()).signal, null);
    assert.equal(JSON.parse(await readFile(path.join(dataPath, 'mt5-signals.json'), 'utf8')).signals[0].status, 'REJECTED');
    await writeFile(configFile, JSON.stringify(beforeLayers));

    // A qualified, unfilled order becomes a durable missed opportunity, not a reusable zone.
    const missedZone = 'TJL1-1794492000-3890.29265';
    const qualified = { ...queuedSignal, ...second, id: 'qualified-expiry', zoneId: missedZone,
      setupId: `DIRECT:H1:${missedZone}`, zoneName: 'TJL1', engulfingType: 'T1',
      entryQualifiedAt: now - 60, expiresAt: now - 1 };
    await writeFile(path.join(dataPath, 'mt5-signals.json'), JSON.stringify({ signals: [
      qualified,
      { ...qualified, id: 'unqualified-expiry', zoneId: 'another-zone', entryQualifiedAt: undefined },
      ...Array.from({ length: 26 }, (_, i) => ({ ...queuedSignal, id: `history-${i}`, status: 'REJECTED' })),
    ] }));
    assert.equal((await (await request('/api/mt5/signals/claim', second)).json()).signal, null);
    const missedStatus = await (await request('/api/mt5/status')).json();
    assert.deepEqual(missedStatus.missedEntries.map((entry: any) => entry.id), ['qualified-expiry']);
    assert.ok(!missedStatus.recentSignals.some((entry: any) => entry.id === qualified.id),
      'the retirement survives beyond the recent 25 signals');
    const retry = await (await request('/api/mt5/signals', { ...queuedSignal, id: 'later-engulfing',
      zoneId: 'TJL1-1794492000-3890.30', setupId: `GOLD_SCALP:H1:${missedZone}`,
      zoneName: 'TJL1', engulfingType: 'T1' })).json();
    assert.equal(retry.duplicate, true, JSON.stringify(retry));
    assert.equal(retry.signal.id, qualified.id);
    assert.equal(retry.signal.status, 'EXPIRED', 'a new pattern must never queue a replacement entry');
    assert.deepEqual((await (await request(secondaryRoute('/api/mt5/status'))).json()).missedEntries, [],
      'missed entries are isolated by terminal and broker account');


    const clientRequest = (route: string, body?: unknown, method?: string) => fetch(`${base}${route}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { Cookie: 'dashboard_session=isolated-client-test-session', Origin: base, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const clientStatus = await (await clientRequest('/api/mt5/status')).json();
    assert.equal(clientStatus.bridge.balance, undefined);
    assert.equal(clientStatus.bridge.equity, undefined);
    assert.equal(clientStatus.bridge.account, undefined);
    assert.equal(clientStatus.config.riskPercent, undefined);
    assert.deepEqual(clientStatus.recentSignals, []);
    assert.deepEqual(clientStatus.positions, []);
    assert.equal((await clientRequest('/api/mt5/accounts')).status, 403);
    assert.equal((await clientRequest('/api/mt5/config', {}, 'PUT')).status, 403);
    assert.equal((await clientRequest('/api/mt5/positions/77/timeframe', timeframeRequest, 'PUT')).status, 403);
    assert.equal((await clientRequest('/api/mt5/bridge/start', {})).status, 403);
    assert.equal((await clientRequest('/api/telegram/alerts', {})).status, 403);
    const bridgeStatus = await fetch(`${base}/api/mt5/status`, { headers: { Authorization: 'Bearer isolated-test-token' } });
    assert.equal(bridgeStatus.status, 200, 'the existing Python bridge can still synchronize configuration');
    const bridgeOnly = await fetch(`${base}/api/mt5/accounts`, { headers: { Authorization: 'Bearer isolated-test-token' } });
    assert.equal(bridgeOnly.status, 401, 'a bridge token cannot access unrelated browser APIs');
    await writeFile(path.join(dataPath, 'trade-journal.json'), JSON.stringify({ trades: [
      { id: 'chart-only', completedAt: now, zoneName: 'TJL', signalAt: now - 60, result: 'tp' },
      { id: 'MT5:private', completedAt: now, zoneName: 'QML', mt5Managed: true, brokerTicket: 42, realizedProfit: 300 },
    ] }));
    const clientJournal = await (await clientRequest('/api/journal/trades')).json();
    assert.deepEqual(clientJournal.trades.map((trade: any) => trade.id), ['chart-only']);
    assert.equal((await clientRequest('/api/journal/trades', { trades: [{ id: 'chart-only', completedAt: now, reason: 'My personal note' }] })).status, 200);
    assert.equal((await (await clientRequest('/api/journal/trades')).json()).trades[0].reason, 'My personal note');
    const shared = await (await request('/api/journal/trades')).json();
    assert.equal(shared.trades.find((trade: any) => trade.id === 'chart-only').reason, undefined, 'client notes never change the shared journal');
    assert.ok(shared.trades.some((trade: any) => trade.id === 'MT5:private'), 'admins retain broker history');

    // Import the user's $5,000 + $220 - $150 + $400 example through the real heartbeat API.
    const capitalHistory = { balance: 5470, initialPrincipal: 5000, initialAt: now - 604800, inferredOpening: false,
      totalDeposits: 5400, totalWithdrawals: 150, withdrawalCount: 1, tradingNet: 220, adjustments: 0,
      asOf: now, events: [{ id: 'deposit-400', at: now, kind: 'deposit', amount: 400 },
        { id: 'withdraw-150', at: now, kind: 'withdrawal', amount: -150 }] };
    const fundingHeartbeat = { ...second, account: 'capital-account', server: 'Capital-Broker',
      currency: 'USD', balance: 5470, capitalHistory };
    assert.equal((await request('/api/mt5/heartbeat', fundingHeartbeat)).status, 200);
    let capital = (await (await request('/api/journal/capital')).json()).capital;
    assert.equal(capital.summary.retainedPnl, 70);
    assert.equal(capital.summary.pendingDeposits, 400);
    assert.equal(capital.connected, true);
    const allocation = { account: fundingHeartbeat.account, server: fundingHeartbeat.server, currency: 'USD',
      kind: 'profit', amount: 70, requestId: 'profit-example-request-1' };
    assert.equal((await request('/api/journal/capital/allocate', { ...allocation, account: 'foreign' })).status, 409);
    const duplicateRequests = await Promise.all([
      request('/api/journal/capital/allocate', allocation), request('/api/journal/capital/allocate', allocation),
    ]);
    assert.ok(duplicateRequests.every(response => response.status === 200));
    capital = (await (await request('/api/journal/capital')).json()).capital;
    assert.equal(capital.summary.principal, 5070);
    assert.equal(capital.summary.retainedPnl, 0);
    assert.equal(capital.allocations.length, 1, 'concurrent retries cannot capitalize the same profit twice');
    assert.equal((await request('/api/journal/capital/allocate', { ...allocation, kind: 'deposit', amount: 400,
      requestId: 'deposit-example-request-1' })).status, 200);
    assert.equal((await request('/api/journal/capital/allocate', { ...allocation, kind: 'deposit', amount: 1,
      requestId: 'overspend-example-request' })).status, 409);
    // Repeated bridge snapshots must preserve manual allocations.
    await request('/api/mt5/heartbeat', fundingHeartbeat);
    capital = (await (await request('/api/journal/capital')).json()).capital;
    assert.equal(capital.summary.principal, 5470);
    assert.equal(capital.summary.pendingDeposits, 0);
    assert.equal(capital.snapshot.balance, 5470);
    const savedCapital = Object.values(JSON.parse(await readFile(path.join(dataPath, 'mt5-capital.json'), 'utf8'))) as any[];
    assert.equal(savedCapital[0].profitAllocated, 70, 'allocations are durably stored');
    assert.equal(savedCapital[0].depositAllocated, 400);
    assert.equal((await (await request(secondaryRoute('/api/journal/capital'))).json()).capital, null,
      'each MT5 terminal has its own capital ledger');
    await request('/api/mt5/heartbeat', { ...fundingHeartbeat, account: 'other-account' });
    assert.equal((await (await request('/api/journal/capital')).json()).capital.summary.principal, 5000,
      'switching accounts never imports another account’s allocations');
    await request('/api/mt5/heartbeat', { ...fundingHeartbeat, capitalHistory: { ...capitalHistory, balance: NaN } });
    assert.equal((await (await request('/api/journal/capital')).json()).capital.connected, false,
      'invalid history cannot authorize an allocation using old saved data');
    assert.equal((await request('/api/journal/capital/allocate', { ...allocation, requestId: 'stale-example-request' })).status, 409);
    assert.equal((await clientRequest('/api/journal/capital')).status, 403);
    assert.equal((await clientRequest('/api/journal/capital/allocate', allocation)).status, 403);
    assert.equal((await fetch(`${base}/api/journal/capital`, { headers: { Authorization: 'Bearer isolated-test-token' } })).status, 401);
    // Risk edits affect only their own strategy and selected account; partial
    // requests must not reset execution switches or unrelated saved settings.
    const beforeRisk = (await (await request('/api/mt5/status')).json()).config;
    const secondaryBeforeRisk = (await (await request(secondaryRoute('/api/mt5/status'))).json()).config;
    for (const [field, value] of [['intradayRiskPercent', 1.5], ['scalpingRiskPercent', 2], ['scalpOneToOneRiskPercent', .75]] as const) {
      const prior = (await (await request('/api/mt5/status')).json()).config;
      assert.equal((await request('/api/mt5/config', { [field]: value }, 'PUT')).status, 200);
      const next = (await (await request('/api/mt5/status')).json()).config;
      assert.equal(next[field], value);
      for (const untouched of ['intradayRiskPercent', 'scalpingRiskPercent', 'scalpOneToOneRiskPercent',
        'enabled', 'dryRun', 'scalpingEnabled', 'intradayEnabled', 'maximumDailyLossPercent'] as const)
        if (untouched !== field) assert.equal(next[untouched], prior[untouched], `${field} must not change ${untouched}`);
    }
    const own = (await (await request('/api/mt5/status')).json()).config;
    assert.equal(own.riskPercent, beforeRisk.riskPercent);
    const secondAfterRisk = (await (await request(secondaryRoute('/api/mt5/status'))).json()).config;
    for (const field of ['intradayRiskPercent', 'scalpingRiskPercent', 'scalpOneToOneRiskPercent'] as const)
      assert.equal(secondAfterRisk[field], secondaryBeforeRisk[field]);
    assert.equal((await request(secondaryRoute('/api/mt5/config'), { intradayRiskPercent: 3 }, 'PUT')).status, 200);
    assert.equal((await (await request('/api/mt5/status')).json()).config.intradayRiskPercent, 1.5);
    const persisted = JSON.parse(await readFile(path.join(dataPath, 'mt5-automation.json'), 'utf8'));
    assert.equal(persisted.intradayRiskPercent, 1.5); assert.equal(persisted.scalpingRiskPercent, 2);
    assert.equal(persisted.scalpOneToOneRiskPercent, .75);
  } finally {
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve());
    });
    child.kill('SIGKILL');
    await exited;
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(workspace));
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(workspace).startsWith('mt5-connection-test-'));
    await rm(workspace, { recursive: true, force: true });
  }
});
