import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { telegramFetch } from '../src/services/telegramTransport';

const url = 'https://api.telegram.org/botfake-test-token/sendMessage';
const options = { method: 'POST', body: JSON.stringify({ text: 'test' }) };
const refused = () => Object.assign(new Error('fetch failed'), {
  cause: { code: 'ECONNREFUSED', address: '127.0.0.1' },
});

test('Telegram uses encrypted DNS after a refused loopback connection', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    calls.push(input);
    if (input === url) throw refused();
    return Response.json({ Status: 0, Answer: [{ name: 'api.telegram.org.', type: 1, data: '149.154.166.110' }] });
  });
  t.mock.method(https, 'request', (target: URL, config: any, receive: (response: any) => void) => {
    assert.equal(target.hostname, 'api.telegram.org');
    assert.equal(config.rejectUnauthorized, undefined, 'TLS verification must retain its secure default');
    config.lookup(target.hostname, { all: true }, (error: unknown, addresses: unknown) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: '149.154.166.110', family: 4 }]);
    });
    const request = new EventEmitter() as EventEmitter & { end: (body: string) => void };
    request.end = body => {
      assert.equal(body, options.body);
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      receive(response);
      response.emit('data', Buffer.from('{"ok":true}'));
      response.emit('end');
    };
    return request;
  });
  assert.deepEqual(await (await telegramFetch(url, options)).json(), { ok: true });
  assert.equal(calls.length, 2);
});

test('Telegram never retries ambiguous failures or API rejections', async t => {
  let calls = 0;
  const error = Object.assign(new Error('response lost'), { cause: { code: 'ECONNRESET' } });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { calls++; throw error; });
  await assert.rejects(telegramFetch(url, options), candidate => candidate === error);
  assert.equal(calls, 1);
  fetchMock.mock.mockImplementation(async () => { calls++; return new Response('{}', { status: 429 }); });
  assert.equal((await telegramFetch(url, options)).status, 429);
  assert.equal(calls, 2);
});

test('Telegram rejects private DNS answers and tries the second provider', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    calls.push(input);
    if (input === url) throw refused();
    return Response.json({ Status: 0, Answer: [{ name: 'api.telegram.org.', type: 1, data: '127.0.0.1' }] });
  });
  await assert.rejects(telegramFetch(url, options), /both encrypted DNS providers/);
  assert.equal(calls.length, 3);
  assert.ok(calls[2].startsWith('https://cloudflare-dns.com/'));
});

test('DNS and connect failures automatically switch to encrypted DNS', async t => {
  for (const failure of [
    { code: 'ENOTFOUND' }, { code: 'EAI_AGAIN' },
    { code: 'ECONNREFUSED', address: '149.154.166.110' },
    { code: 'ENETUNREACH' }, { code: 'EHOSTUNREACH' },
    { code: 'UND_ERR_CONNECT_TIMEOUT' }, { code: 'ETIMEDOUT', syscall: 'connect' },
    { errors: [{ code: 'ENETUNREACH' }, { code: 'ECONNREFUSED' }] },
  ]) {
    await t.test(JSON.stringify(failure), async sub => {
      const calls: string[] = [];
      sub.mock.method(globalThis, 'fetch', async (input: string) => {
        calls.push(input);
        if (input === url) throw Object.assign(new Error('fetch failed'), { cause: failure });
        throw new Error('offline');
      });
      await assert.rejects(telegramFetch(url, options), /both encrypted DNS providers/);
      assert.equal(calls.length, 3);
    });
  }
});

test('fallback rotates addresses and DNS providers, then resolves fresh after network changes', async t => {
  let network = 1;
  const attempted: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    if (input === url) throw refused();
    if (network === 0) throw new Error('internet disconnected');
    const addresses = network === 2 ? ['149.154.167.221']
      : input.includes('dns.google') ? ['149.154.166.110', '149.154.167.220'] : ['149.154.167.221'];
    return Response.json({ Status: 0, Answer: addresses.map(data => ({ name: 'api.telegram.org.', type: 1, data })) });
  });
  t.mock.method(https, 'request', (_target: URL, config: any, receive: (response: any) => void) => {
    let address = '';
    config.lookup('api.telegram.org', { all: true }, (_error: unknown, values: { address: string }[]) => {
      address = values[0].address;
      attempted.push(address);
    });
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      if (address !== '149.154.167.221') { request.emit('error', new Error('connect failed')); return; }
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      receive(response);
      response.emit('data', Buffer.from('{"ok":true}'));
      response.emit('end');
    };
    return request;
  });
  assert.equal((await telegramFetch(url, options)).status, 200);
  assert.deepEqual(attempted, ['149.154.166.110', '149.154.167.220', '149.154.167.221']);
  network = 0;
  await assert.rejects(telegramFetch(url, options), /both encrypted DNS providers/);
  network = 2;
  assert.equal((await telegramFetch(url, options)).status, 200, 'recovers after internet returns without restarting');
  assert.equal(attempted.at(-1), '149.154.167.221');
  assert.equal(attempted.length, 4);
});

test('fallback never resends when the TLS connection was already established', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    if (input === url) throw refused();
    return Response.json({ Status: 0, Answer: ['149.154.166.110', '149.154.167.220']
      .map(data => ({ name: 'api.telegram.org.', type: 1, data })) });
  });
  t.mock.method(https, 'request', () => {
    attempts++;
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      const socket = new EventEmitter();
      request.emit('socket', socket);
      socket.emit('secureConnect');
      request.emit('error', new Error('response lost'));
    };
    return request;
  });
  await assert.rejects(telegramFetch(url, options), /delivery could not be confirmed/);
  assert.equal(attempts, 1);
});
