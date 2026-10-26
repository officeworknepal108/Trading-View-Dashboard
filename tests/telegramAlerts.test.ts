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
        TELEGRAM_BOT_TOKEN: 'fake-test-token', TELEGRAM_CHAT_ID: 'fake-test-chat' },
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
  const send = async (alerts: unknown[], expectedStatus = 200) => {
    const response = await fetch(`${base}/api/telegram/alerts`, {
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
    assert.deepEqual(first.map(text => text.split('\n')[0]).sort(), [1, 2, 3, 4].map(number => `Trade #${number} | 2026-10-26 (Nepal)`));
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
    assert.match(lifecycle[4], /^Trade #5 \|/);
    assert.match(lifecycle[5], /^Trade #5 \|/);
    assert.ok(lifecycle[6].startsWith(`Trade #${scalpNumber} |`));
    assert.ok(lifecycle[7].startsWith(`Trade #${intradayNumber} |`));
    assert.match(lifecycle[8], /^Trade #6 \|/);
    assert.match(lifecycle[9], /^Trade #6 \|/);
    await send(initial);
    assert.equal((await messages()).length, 10, 'duplicates must not send again');
    await stop();
    await start();
    await send([entry('after-restart')]);
    assert.match((await messages()).at(-1)!, /^Trade #7 \|/);
    await writeFile(clockFile, String(beforeMidnight + 1));
    await send([entry('next-day', { openedAt: beforeMidnight + 1 })]);
    assert.match((await messages()).at(-1)!, /^Trade #1 \| 2026-10-27/);
    await send([entry('scalping', { kind: 'sl', tradeStyle: 'SCALPING', closedAt: beforeMidnight + 1,
      exitPrice: 99, returnR: -1 })]);
    assert.ok((await messages()).at(-1)!.startsWith(`Trade #${scalpNumber} | 2026-10-26`));
    await send([entry('next-day-2', { openedAt: beforeMidnight + 1 })]);
    assert.match((await messages()).at(-1)!, /^Trade #2 \| 2026-10-27/);
    await writeFile(failOnceFile, 'fail');
    const retry = entry('retry', { openedAt: beforeMidnight + 1 });
    const countBeforeFailure = (await messages()).length;
    await send([retry], 502);
    assert.equal((await messages()).length, countBeforeFailure);
    await send([retry]);
    assert.match((await messages()).at(-1)!, /^Trade #3 \| 2026-10-27/);
    await writeFile(path.join(workspace, 'data', 'mt5-automation.json'), JSON.stringify({
      enabled: false, telegramMessagesEnabled: true, scalpingEnabled: false, intradayEnabled: true,
    }));
    const beforeDisabled = (await messages()).length;
    await send([entry('disabled-scalp', { openedAt: beforeMidnight + 1, tradeStyle: 'SCALPING', riskFree: 101 })]);
    assert.equal((await messages()).length, beforeDisabled);
    await send([entry('after-disabled', { openedAt: beforeMidnight + 1 })]);
    assert.match((await messages()).at(-1)!, /^Trade #4 \| 2026-10-27/);
  } finally {
    await stop();
    assert.ok(path.resolve(workspace).startsWith(path.join(path.resolve(tmpdir()), 'telegram-numbering-test-')));
    await rm(workspace, { recursive: true, force: true });
  }
});
