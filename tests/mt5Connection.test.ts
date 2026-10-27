import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

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
  const child = spawn(process.execPath, ['--import', tsxPath, serverPath], {
    cwd: workspace, windowsHide: true,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', MT5_BRIDGE_TOKEN: 'isolated-test-token' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  const request = async (route: string, body?: unknown, method = 'POST') => fetch(`${base}${route}`, {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer isolated-test-token' },
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
    const first = { bridgeId: 'test-bridge', account: '123', server: 'Broker-A', brokerSymbol: 'XAUUSD.x',
      terminalConnected: true, symbolResolved: true, symbolCandidates: ['XAUUSD.x'] };
    assert.equal((await request('/api/mt5/heartbeat', first)).status, 200);
    let status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.brokerSymbol, 'XAUUSD.x');
    assert.equal(status.config.brokerSymbolAccount, '123');
    assert.equal(status.config.enabled, false);
    assert.equal(status.config.dryRun, true);
    assert.equal(status.config.riskPercent, 0.5);
    assert.equal(status.config.tradingTimeEnabled, false, 'missing session setting defaults OFF');
    assert.equal(status.counts.REJECTED, 1);
    assert.equal(status.counts.ACTIVE, 1, 'existing positions are not rewritten on connection changes');
    const now = Math.floor(Date.now() / 1000);
    const candles = Array.from({ length: 10 }, (_, index) => ({
      time: now - (9 - index) * 60, open: 4000, high: 4002, low: 3998, close: 4001, volume: 10, complete: index < 9,
    }));
    const snapshot = { ...first, symbol: first.brokerSymbol, timeframe: 'M1', candles };
    assert.equal((await request('/api/mt5/market-data', snapshot)).status, 202);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.marketData.timeframes.M1.count, 10);
    assert.equal((await request('/api/mt5/market-data', { ...snapshot, account: 'foreign' })).status, 409);
    const second = { ...first, account: '456', server: 'Broker-B', brokerSymbol: 'XAUUSDm', symbolCandidates: ['XAUUSDm'] };
    assert.equal((await request('/api/mt5/heartbeat', second)).status, 200);
    status = await (await request('/api/mt5/status')).json();
    assert.equal(status.config.brokerSymbol, 'XAUUSDm');
    assert.equal(status.config.brokerSymbolAccount, '456');
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
      ...secondaryStatus.config, riskPercent: 1.5, maximumDailyLossPercent: 3,
      tradingTimeEnabled: true, mtfLtfFibRequired: true,
    }, 'PUT')).status, 200);
    status = await (await request('/api/mt5/status')).json();
    secondaryStatus = await (await request(secondaryRoute('/api/mt5/status'))).json();
    assert.equal(status.config.riskPercent, 0.5, 'account 1 keeps its own risk');
    assert.equal(status.config.maximumDailyLossPercent, 5);
    assert.equal(status.config.mtfLtfFibRequired, true, 'strategy settings are shared');
    assert.equal(status.config.tradingTimeEnabled, true);
    assert.equal(secondaryStatus.config.riskPercent, 1.5);
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
    assert.equal(claimed[0].signal?.account, '456');
    assert.equal(claimed[1].signal?.account, '789');
    assert.equal(claimed[0].config.riskPercent, 0.5);
    assert.equal(claimed[1].config.riskPercent, 1.5);
    assert.equal((await (await request('/api/mt5/signals/claim', second)).json()).signal, null,
      'a repeated poll cannot claim the same order twice');


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
