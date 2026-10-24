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
