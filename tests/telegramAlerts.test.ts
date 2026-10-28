import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

test('Telegram numbering covers all alert kinds, shared styles, retries, restarts and Nepal midnight', { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'telegram-numbering-test-'));
  const clockFile = path.join(workspace, 'clock.txt');
  const captureFile = path.join(workspace, 'messages.jsonl');
  const failOnceFile = path.join(workspace, 'fail-once.txt');
  const beforeMidnight = Date.parse('2026-10-26T18:14:59Z') / 1000;
  await mkdir(path.join(workspace, 'data'));
  await writeFile(clockFile, String(beforeMidnight));
  await writeFile(path.join(workspace, 'data', 'mt5-automation.json'), JSON.stringify({
    enabled: false, telegramMessagesEnabled: true, scalpingEnabled: true, intradayEnabled: true,
  }));
  const preload = path.join(workspace, 'telegram-test-preload.mjs');
  // Intercept every Telegram request before networking: these tests never send messages.
  await writeFile(preload, `
    import { appendFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
    Date.now = () => Number(readFileSync(${JSON.stringify(clockFile)}, 'utf8')) * 1000;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
      if (url.hostname === 'api.telegram.org') {
        if (existsSync(${JSON.stringify(failOnceFile)})) {
          unlinkSync(${JSON.stringify(failOnceFile)});
          return new Response(JSON.stringify({ ok: false }), { status: 503 });
        }
        appendFileSync(${JSON.stringify(captureFile)}, JSON.stringify(JSON.parse(options.body).text) + '\\n');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return originalFetch(input, options);
    };
  `);
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer();
    listener.on('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      assert.ok(address && typeof address !== 'string');
      listener.close(() => resolve(address.port));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const closed = new Promise<void>(resolve => child!.once('close', () => resolve()));
    child.kill();
    await closed;
  };
  const start = async () => {
    child = spawn(process.execPath, ['--import', pathToFileURL(preload).href,
      '--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
      fileURLToPath(new URL('../server.ts', import.meta.url))], {
      cwd: workspace, windowsHide: true,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'production',
        TELEGRAM_BOT_TOKEN: 'fake-test-token', TELEGRAM_CHAT_ID: 'fake-test-chat', MT5_BRIDGE_TOKEN: 'fake-bridge-test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.on('data', chunk => { output += chunk.toString(); });
    child.stderr!.on('data', chunk => { output += chunk.toString(); });
    for (let attempt = 0; attempt < 400; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* Starting. */ }
      if (child.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Isolated server did not become ready: ${output}`);
  };
  const send = async (alerts: unknown[], expectedStatus = 200, terminal = 'primary') => {
    const response = await fetch(`${base}/api/telegram/alerts?terminal=${terminal}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alerts }),
    });
    assert.equal(response.status, expectedStatus, await response.text());
  };
  const messages = async (): Promise<string[]> => (await readFile(captureFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, kind: 'entry', symbol: 'XAUUSD', direction: 'BUY', zoneName: 'TJL2',
    zoneTimeframe: 'M15', signalTimeframe: 'M15', engulfingType: 'T1',
    entry: 100, stopLoss: 99, takeProfit: 102, riskPips: 10, rewardRisk: 2,
    tradeStyle: 'INTRADAY', openedAt: beforeMidnight, ...overrides,
  });
  try {
    await start();
    const initial = [entry('intraday'), entry('scalping', { tradeStyle: 'SCALPING', riskFree: 101 }),
      entry('mtf-intraday', { zoneTimeframe: 'H1', signalTimeframe: 'M5' }),
      entry('mtf-scalping', { tradeStyle: 'SCALPING', signalTimeframe: 'M1', riskFree: 101 })];
    await Promise.all(initial.map(alert => send([alert])));
    const first = await messages();
    assert.deepEqual(first.map(text => text.split('\n')[0]).sort(), [1, 2, 3, 4].map(number => `Trade #${number} \u2014 NEW ENTRY`));
    const sentState = JSON.parse(await readFile(path.join(workspace, 'data', 'telegram-alerts.json'), 'utf8'));
    const scalpNumber = sentState.scalping.tradeNumber;
    const intradayNumber = sentState.intraday.tradeNumber;
    await send([entry('broker-order', { kind: 'pending', tradeKey: 'filled-order' })]);
    await send([entry('filled-order')]);
    await send([entry('scalping', { kind: 'rf', tradeStyle: 'SCALPING', riskFree: 101,
      rfAt: beforeMidnight, partialClosedVolume: 0.5, remainingVolume: 0.5 })]);
    await send([entry('intraday', { kind: 'tp', closedAt: beforeMidnight, exitPrice: 102, returnR: 2 })]);
    await send([entry('cancel-order', { kind: 'pending' })]);
    await send([entry('cancel-order', { kind: 'cancelled', closedAt: beforeMidnight })]);
    const lifecycle = await messages();
    assert.match(lifecycle[4], /^Trade #5 \u2014/);
    assert.match(lifecycle[5], /^Trade #5 \u2014/);
    assert.ok(lifecycle[6].startsWith(`Trade #${scalpNumber} \u2014`));
    assert.ok(lifecycle[7].startsWith(`Trade #${intradayNumber} \u2014`));
    assert.match(lifecycle[8], /^Trade #6 \u2014/);
    assert.match(lifecycle[9], /^Trade #6 \u2014/);
    await send(initial);
    assert.equal((await messages()).length, 10, 'duplicates must not send again');
    await stop();
    await start();
    await send([entry('after-restart')]);
    assert.match((await messages()).at(-1)!, /^Trade #7 \u2014/);
    await writeFile(clockFile, String(beforeMidnight + 1));
    await send([entry('next-day', { openedAt: beforeMidnight + 1 })]);
    assert.match((await messages()).at(-1)!, /^Trade #1 \u2014/);
    await send([entry('scalping', { kind: 'sl', tradeStyle: 'SCALPING', closedAt: beforeMidnight + 1,
      exitPrice: 99, returnR: -1 })]);
    assert.ok((await messages()).at(-1)!.startsWith(`Trade #${scalpNumber} \u2014 STOP LOSS HIT`));
    await send([entry('next-day-2', { openedAt: beforeMidnight + 1 })]);
    assert.match((await messages()).at(-1)!, /^Trade #2 \u2014/);
    await writeFile(failOnceFile, 'fail');
    const retry = entry('retry', { openedAt: beforeMidnight + 1 });
    const countBeforeFailure = (await messages()).length;
    await send([retry], 502);
    assert.equal((await messages()).length, countBeforeFailure);
    await send([retry]);
    assert.match((await messages()).at(-1)!, /^Trade #3 \u2014/);
    await writeFile(path.join(workspace, 'data', 'mt5-automation.json'), JSON.stringify({
      enabled: false, telegramMessagesEnabled: true, scalpingEnabled: false, intradayEnabled: true,
    }));
    const beforeDisabled = (await messages()).length;
    await send([entry('disabled-scalp', { openedAt: beforeMidnight + 1, tradeStyle: 'SCALPING', riskFree: 101 })]);
    assert.equal((await messages()).length, beforeDisabled);
    await send([entry('after-disabled', { openedAt: beforeMidnight + 1 })]);
    assert.match((await messages()).at(-1)!, /^Trade #4 \u2014/);
    const signalKey = `XAUUSD:bearish:M1:${beforeMidnight + 1}`;
    const priceAlert = entry(`${signalKey}:4021.54000`, {
      direction: 'SELL', signalTimeframe: 'M1', openedAt: beforeMidnight + 1,
      entry: 4021.54, stopLoss: 4024.05, takeProfit: 4014.01,
    });
    const beforeSlippage = (await messages()).length;
    await send([priceAlert]);
    await send([{ ...priceAlert, id: `${signalKey}:4021.48000`, entry: 4021.48 }]);
    assert.equal((await messages()).length, beforeSlippage + 1, 'broker slippage must not send a second entry');
    await stop();
    await start();
    await send([{ ...priceAlert, id: `${signalKey}:4021.48000`, entry: 4021.48,
      kind: 'sl', closedAt: beforeMidnight + 1, exitPrice: 4024.05, returnR: -1 }]);
    await send([{ ...priceAlert, kind: 'sl', closedAt: beforeMidnight + 1, exitPrice: 4024.05, returnR: -1 }]);
    const afterSlippage = await messages();
    assert.equal(afterSlippage.length, beforeSlippage + 2, 'one result across both prices and restart');
    assert.equal(afterSlippage.at(-1)!.match(/^Trade #\d+/)![0], afterSlippage.at(-2)!.match(/^Trade #\d+/)![0]);
    // Both accounts may report the same event concurrently, with different IDs/prices.
    const sharedKey = `XAUUSD:bullish:M15:${beforeMidnight + 1}`;
    const shared = entry(`${sharedKey}:100.00000`, { tradeKey: sharedKey, openedAt: beforeMidnight + 1,
      tradeStyle: 'SCALPING', riskFree: 101 });
    await writeFile(path.join(workspace, 'data', 'mt5-automation.json'), JSON.stringify({
      enabled: false, telegramMessagesEnabled: true, scalpingEnabled: true, intradayEnabled: true,
    }));
    const beforeShared = (await messages()).length;
    for (const kind of ['pending', 'entry', 'rf', 'tp']) {
      const event = { ...shared, kind, rfAt: beforeMidnight + 1, partialClosedVolume: 0.5,
        remainingVolume: 0.5, closedAt: beforeMidnight + 1, exitPrice: 102, returnR: 2 };
      await Promise.all([
        send([event]), send([{ ...event, id: `${sharedKey}:100.01000`, entry: 100.01 }], 200, 'secondary'),
      ]);
    }
    const sharedMessages = (await messages()).slice(beforeShared);
    assert.equal(sharedMessages.length, 4, 'one pending, entry, RF and result across both accounts');
    assert.equal(new Set(sharedMessages.map(message => message.match(/^Trade #\d+/)![0])).size, 1);
    await stop();
    await start();
    await send([{ ...shared, kind: 'entry' }], 200, 'secondary');
    await send([{ ...shared, kind: 'tp', closedAt: beforeMidnight + 1, exitPrice: 102, returnR: 2 }]);
    assert.equal((await messages()).length, beforeShared + 4, 'shared delivery survives restart');
    const secondaryOnly = entry('secondary-only', { openedAt: beforeMidnight + 1 });
    await send([secondaryOnly], 200, 'secondary');
    await send([secondaryOnly]);
    assert.equal((await messages()).length, beforeShared + 5, 'a secondary-first signal is sent once');
    const legacyKey = `EURUSD:bullish:M15:${beforeMidnight + 1}`;
    await writeFile(path.join(workspace, 'data', 'telegram-alerts.secondary.json'), JSON.stringify({
      [legacyKey]: { tradeNumber: 40, tradeDate: '2026-10-27', entry: true },
    }));
    await send([entry(`${legacyKey}:100.00000`, { symbol: 'EURUSD', openedAt: beforeMidnight + 1 })]);
    assert.equal((await messages()).length, beforeShared + 5, 'old secondary delivery history prevents replay');
    await send([entry('after-history-merge', { openedAt: beforeMidnight + 1 })]);
    assert.match((await messages()).at(-1)!, /^Trade #41 \u2014/);
    const crossAccountRetry = entry('cross-account-retry', { openedAt: beforeMidnight + 1 });
    const beforeCrossAccountRetry = (await messages()).length;
    await writeFile(failOnceFile, 'fail');
    await send([crossAccountRetry], 502);
    await send([crossAccountRetry], 200, 'secondary');
    await send([crossAccountRetry]);
    assert.equal((await messages()).length, beforeCrossAccountRetry + 1,
      'Account 2 can retry a failed Account 1 delivery without a later duplicate');
    assert.match((await messages()).at(-1)!, /^Trade #42 \u2014/);
    for (const kind of ['pending', 'cancelled']) {
      const cancellation = entry('shared-cancellation', { kind, openedAt: beforeMidnight + 1,
        closedAt: beforeMidnight + 1 });
      await Promise.all([send([cancellation]), send([cancellation], 200, 'secondary')]);
    }
    assert.equal((await messages()).length, beforeCrossAccountRetry + 3,
      'the pending order and its cancellation each send once across both accounts');
    // The day-end report reads real terminal signals only and survives restart.
    await writeFile(clockFile, String(beforeMidnight + 62));
    const closedSignal = { id: 'closed', account: 'account-A', server: 'Broker', status: 'SL',
      closedAt: beforeMidnight, updatedAt: beforeMidnight, brokerTicket: 123 };
    await writeFile(path.join(workspace, 'data', 'mt5-signals.json'), JSON.stringify({ signals: [
      closedSignal, { ...closedSignal, id: 'price-copy' },
      { ...closedSignal, id: 'another-account', account: 'account-B', brokerTicket: 124 },
      { ...closedSignal, id: 'simulated', status: 'SIMULATED', brokerTicket: 125 },
    ] }));
    const heartbeat = async () => {
      const response = await fetch(`${base}/api/mt5/heartbeat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer fake-bridge-test' },
        body: JSON.stringify({ bridgeId: 'test-summary-bridge', account: 'account-A', server: 'Broker', terminalConnected: true }),
      });
      assert.equal(response.status, 200, await response.text());
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await messages()).some(text => text.startsWith('DAILY TRADE SUMMARY'))) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('Daily summary was not delivered');
    };
    const secondaryHeartbeat = async () => {
      const response = await fetch(`${base}/api/mt5/heartbeat?terminal=secondary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer fake-bridge-test' },
        body: JSON.stringify({ bridgeId: 'second-summary-bridge', account: 'account-B', server: 'Broker', terminalConnected: true }),
      });
      assert.equal(response.status, 200, await response.text());
      await new Promise(resolve => setTimeout(resolve, 200));
    };
    await secondaryHeartbeat();
    assert.equal((await messages()).filter(text => text.startsWith('DAILY TRADE SUMMARY')).length, 0,
      'Account 2 must not send a report even if it connects before Account 1');
    await heartbeat();
    assert.equal((await messages()).filter(text => text.startsWith('DAILY TRADE SUMMARY')).length, 1);
    assert.match((await messages()).at(-1)!, /Total trades: 1/);
    assert.match((await messages()).at(-1)!, /Losses: 1/);
    assert.ok(!(await messages()).at(-1)!.includes('$'));
    const reportFile = path.join(workspace, 'data', 'telegram-alerts.json');
    const reportState = JSON.parse(await readFile(reportFile, 'utf8'));
    const reportKey = Object.keys(reportState).find(key => key.startsWith('DAILY:') && reportState[key].summarySent)!;
    reportState[`DAILY:account-A:Broker:${reportKey.slice('DAILY:'.length)}`] = reportState[reportKey];
    delete reportState[reportKey];
    await writeFile(reportFile, JSON.stringify(reportState));
    await stop();
    await start();
    await heartbeat();
    await secondaryHeartbeat();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await messages()).filter(text => text.startsWith('DAILY TRADE SUMMARY')).length, 1,
      'both terminal heartbeats and a restart still produce only one daily summary');
    const switched = await fetch(`${base}/api/mt5/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer fake-bridge-test' },
      body: JSON.stringify({ bridgeId: 'test-summary-bridge', account: 'account-C', server: 'Broker', terminalConnected: true }),
    });
    assert.equal(switched.status, 200);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal((await messages()).filter(text => text.startsWith('DAILY TRADE SUMMARY')).length, 1,
      'switching the primary login cannot send a second report for the same day');
    const stateBeforeDemos = await readFile(path.join(workspace, 'data', 'telegram-alerts.json'), 'utf8');
    const denied = await fetch(`${base}/api/telegram/demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(denied.status, 400);
    await writeFile(failOnceFile, 'fail');
    const failedDemo = await fetch(`${base}/api/telegram/demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmDemo: true }),
    });
    assert.equal(failedDemo.status, 502);
    assert.equal((await failedDemo.json()).sent, 0);
    const demo = await fetch(`${base}/api/telegram/demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmDemo: true }),
    });
    assert.equal(demo.status, 200, await demo.text());
    const demos = (await messages()).filter(text => text.startsWith('DEMO '));
    assert.equal(demos.length, 10);
    assert.ok(demos.every(text => text.includes('NOT A LIVE TRADE')));
    assert.equal(await readFile(path.join(workspace, 'data', 'telegram-alerts.json'), 'utf8'), stateBeforeDemos,
      'demos must not consume live numbers or change live delivery/report state');
  } finally {
    await stop();
    assert.ok(path.resolve(workspace).startsWith(path.join(path.resolve(tmpdir()), 'telegram-numbering-test-')));
    await rm(workspace, { recursive: true, force: true });
  }
});
