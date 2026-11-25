import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardAuth, normalizeUsername } from '../src/server/authentication';
import { clientVisibleTrades } from '../src/server/clientJournal';
import { denyPrivateFiles } from '../src/server/privateFiles';

class Browser {
  cookies = new Map<string, string>();
  constructor(readonly base: string) {}
  async request(route: string, body?: unknown, method?: string, origin = this.base) {
    const response = await fetch(`${this.base}${route}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'), redirect: 'manual',
      headers: { Origin: origin, Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
}

test('managed username/password accounts and client device isolation', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dashboard-auth-test-'));
  let now = Date.now();
  const ownerPassword = 'Owner-test-password-123';
  const password = 'Managed-test-password-123';
  const app = express(); app.use(denyPrivateFiles); app.use(express.json());
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  // Preserve old user IDs, permissions, history and approval data during migration.
  await writeFile(path.join(directory, 'accounts.json'), JSON.stringify({
    users: [
      { id: 'owner-id', email: 'tradingviewfx108@gmail.com', role: 'super_admin', status: 'approved', verified: true, createdAt: now },
      { id: 'legacy-client', email: 'oldclient@gmail.com', role: 'client', status: 'approved', verified: true, createdAt: now },
    ], sessions: [{ userId: 'legacy-client', digest: createHash('sha256').update('legacy-cookie').digest('hex'), expiresAt: now + 86_400_000 }],
    challenges: [{ digest: 'old-otp' }], resets: [{ digest: 'old-reset' }], oauth: [], audit: [],
  }));
  let auth = new DashboardAuth({ directory, publicUrl: base, now: () => now });
  // Indirection lets us reload the service against persisted accounts in a test.
  app.use('/api/auth', (req, res, next) => auth.router(req, res, next));
  app.use('/api', (req, res, next) => auth.guard(req, res, next));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/tradingview/market-data', (_req, res) => res.json({ ok: true }));
  app.put('/api/mt5/config', (_req, res) => res.json({ ok: true }));
  app.post('/api/telegram/alerts', (_req, res) => res.json({ ok: true }));
  app.post('/api/mt5/heartbeat', (_req, res) => res.json({ ok: true }));
  const owner = new Browser(base), admin = new Browser(base), client = new Browser(base), anon = new Browser(base);
  const login = async (browser: Browser, username: string, suppliedPassword = password) => browser.request('/api/auth/login', { username, password: suppliedPassword });
  const getUser = async (browser: Browser) => (await (await browser.request('/api/auth/me')).json()).user;
  const create = async (browser: Browser, username: string, role = 'client') => {
    const response = await browser.request('/api/auth/users', { username, password, role });
    assert.equal(response.status, 201, await response.clone().text()); return (await response.json()).user;
  };
  let managerId = '', clientId = '';
  try {
    await t.test('private files, anonymous APIs and cross-origin requests stay protected', async () => {
      for (const route of ['/.dashboard-auth/accounts.json', '/.dashboard-auth/owner-setup.json', '/@fs/C:/project/.dashboard-auth/accounts.json', '/%252edashboard-auth/accounts.json', '/data/trade-journal.json', '/.env.mt5']) {
        assert.equal((await anon.request(route)).status, 404);
      }
      assert.equal((await anon.request('/api/tradingview/market-data')).status, 401);
      assert.equal((await anon.request('/api/auth/login', {}, 'POST', 'https://other.example')).status, 403);
      assert.equal((await anon.request('/api/health')).status, 200);
      assert.equal((await anon.request('/api/auth/owner-setup', { username: 'attacker', password })).status, 403);
      for (const route of ['/google', '/google/callback', '/register', '/verify', '/resend', '/forgot', '/reset']) {
        assert.equal((await anon.request('/api/auth' + route, {})).status, 410);
      }
    });
    await t.test('owner credentials require the local token once; no Google or mail dependency', async () => {
      assert.equal((await (await anon.request('/api/auth/config')).json()).ownerSetupRequired, true);
      const setup = JSON.parse(await readFile(path.join(directory, 'owner-setup.json'), 'utf8'));
      const response = await fetch(base + '/api/auth/owner-setup', { method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json', Authorization: `Bearer ${setup.token}` },
        body: JSON.stringify({ username: 'Owner', password: ownerPassword }) });
      assert.equal(response.status, 200);
      assert.equal((await (await anon.request('/api/auth/config')).json()).ownerSetupRequired, false);
      await assert.rejects(readFile(path.join(directory, 'owner-setup.json')));
      const replay = await fetch(base + '/api/auth/owner-setup', { method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json', Authorization: `Bearer ${setup.token}` },
        body: JSON.stringify({ username: 'hijack', password }) });
      assert.equal(replay.status, 403);
      assert.equal((await login(owner, 'OWNER', ownerPassword)).status, 200);
      assert.equal((await getUser(owner)).id, 'owner-id');
      const stored = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
      assert.ok(stored.users.some((u: any) => u.id === 'legacy-client'));
      assert.deepEqual(stored.challenges, []); assert.deepEqual(stored.resets, []);
      const legacy = new Browser(base); legacy.cookies.set('dashboard_session', 'legacy-cookie');
      assert.equal(await getUser(legacy), null);
    });
    await t.test('super admin creates admins; admins create clients and cannot escalate roles', async () => {
      managerId = (await create(owner, 'Manager', 'admin')).id;
      assert.equal((await login(admin, 'manager')).status, 200);
      clientId = (await create(admin, 'client_one')).id;
      assert.equal((await login(client, 'client_one')).status, 200);
      assert.equal((await client.request('/api/auth/users')).status, 403);
      assert.equal((await admin.request('/api/auth/users', { username: 'admin_two', password, role: 'admin' })).status, 403);
      assert.equal((await admin.request(`/api/auth/users/${clientId}`, { role: 'admin' }, 'PATCH')).status, 403);
      assert.equal((await admin.request(`/api/auth/users/${managerId}`, { password }, 'PATCH')).status, 403);
      assert.equal((await owner.request('/api/auth/users/owner-id', { password }, 'PATCH')).status, 403);
      const list = (await (await admin.request('/api/auth/users')).json()).users;
      assert.ok(list.every((u: any) => u.role === 'client'));
      assert.equal((await owner.request('/api/auth/users', { username: ' CLIENT_ONE ', password, role: 'client' })).status, 409);
      assert.equal((await owner.request('/api/auth/users', { username: 'bad user', password, role: 'client' })).status, 400);
      assert.equal((await owner.request('/api/auth/users', { username: 'short_password', password: 'short', role: 'client' })).status, 400);
    });
    await t.test('client reads charts but cannot control bridge or Telegram', async () => {
      assert.equal((await client.request('/api/tradingview/market-data')).status, 200);
      assert.equal((await client.request('/api/mt5/config', {}, 'PUT')).status, 403);
      assert.equal((await client.request('/api/telegram/alerts', {})).status, 403);
      assert.equal((await admin.request('/api/mt5/config', {}, 'PUT')).status, 200);
      assert.equal((await owner.request('/api/mt5/heartbeat', {})).status, 403);
      const previousToken = process.env.MT5_BRIDGE_TOKEN;
      process.env.MT5_BRIDGE_TOKEN = 'isolated-machine-token';
      try {
        const response = await fetch(base + '/api/mt5/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer isolated-machine-token' } });
        assert.equal(response.status, 200);
      } finally { if (previousToken === undefined) delete process.env.MT5_BRIDGE_TOKEN; else process.env.MT5_BRIDGE_TOKEN = previousToken; }
    });
    await t.test('wrong password never kicks out the active client; new login revokes old device without cooldown', async () => {
      const second = new Browser(base);
      assert.equal((await login(second, 'client_one', 'wrong-password')).status, 401);
      assert.ok(await getUser(client));
      assert.equal((await login(second, 'client_one')).status, 200);
      assert.equal(await getUser(client), null);
      assert.equal((await client.request('/api/tradingview/market-data')).status, 401);
      // The old device may immediately sign back in; no timed account block.
      assert.equal((await login(client, 'client_one')).status, 200);
      assert.equal(await getUser(second), null);
      for (let i = 0; i < 15; i++) assert.equal((await login(client, 'client_one')).status, 200);
      const stored = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
      assert.equal(stored.sessions.filter((s: any) => s.userId === clientId).length, 1);
    });
    await t.test('same-browser tabs share a login; another client replaces the previous account on that device', async () => {
      const tab = new Browser(base); tab.cookies = client.cookies;
      assert.equal((await getUser(tab)).id, clientId);
      const oldTab = new Browser(base); oldTab.cookies = new Map(client.cookies);
      await create(admin, 'client_two');
      assert.equal((await login(client, 'client_two')).status, 200);
      assert.equal((await getUser(tab)).username, 'client_two');
      assert.equal(await getUser(oldTab), null);
      const stolenSession = new Browser(base);
      stolenSession.cookies.set('dashboard_session', client.cookies.get('dashboard_session')!);
      assert.equal(await getUser(stolenSession), null, 'client session requires its device cookie');
      assert.equal((await login(client, 'client_one')).status, 200);
    });
    await t.test('simultaneous device logins leave exactly one active session', async () => {
      const devices = [new Browser(base), new Browser(base)];
      const responses = await Promise.all(devices.map(browser => login(browser, 'client_one')));
      assert.ok(responses.every(response => response.status === 200));
      const users = await Promise.all(devices.map(getUser));
      assert.equal(users.filter(Boolean).length, 1);
      assert.equal((await login(client, 'client_one')).status, 200);
    });
    await t.test('password resets revoke all old sessions; credentials never appear in user lists or audit', async () => {
      const nextPassword = 'Replacement-password-456';
      const response = await admin.request(`/api/auth/users/${clientId}`, { password: nextPassword }, 'PATCH');
      assert.equal(response.status, 200); assert.equal(await getUser(client), null);
      assert.equal((await login(client, 'client_one')).status, 401);
      assert.equal((await login(client, 'client_one', nextPassword)).status, 200);
      const users = await (await owner.request('/api/auth/users')).text();
      const activity = await (await owner.request('/api/auth/activity')).text();
      for (const text of [users, activity]) {
        assert.ok(!text.includes(nextPassword)); assert.ok(!text.includes(ownerPassword)); assert.ok(!text.includes('passwordHash'));
      }
      // Invalid edits must not partially change a username in memory.
      assert.equal((await admin.request(`/api/auth/users/${clientId}`, { username: 'bad_partial', password: 'short' }, 'PATCH')).status, 400);
      assert.equal((await login(client, 'client_one', nextPassword)).status, 200);
      assert.equal((await admin.request(`/api/auth/users/${clientId}`, { password }, 'PATCH')).status, 200);
      assert.equal((await login(client, 'client_one')).status, 200);
    });
    await t.test('legacy users receive credentials without losing their ID; role changes keep passwords', async () => {
      const response = await admin.request('/api/auth/users/legacy-client', { username: 'migrated_client', password }, 'PATCH');
      assert.equal(response.status, 200);
      const migrated = new Browser(base); assert.equal((await login(migrated, 'migrated_client')).status, 200);
      assert.equal((await getUser(migrated)).id, 'legacy-client');
      assert.equal((await owner.request('/api/auth/users/legacy-client', { role: 'admin' }, 'PATCH')).status, 200);
      assert.equal(await getUser(migrated), null);
      assert.equal((await login(migrated, 'migrated_client')).status, 200);
      assert.equal((await getUser(migrated)).role, 'admin');
    });
    await t.test('suspension, removal and expiry still deny access; admins cannot change admin expiry', async () => {
      for (const status of ['suspended', 'removed', 'pending']) {
        assert.equal((await admin.request(`/api/auth/users/${clientId}`, { status }, 'PATCH')).status, 200);
        assert.equal(await getUser(client), null);
        assert.equal((await login(client, 'client_one')).status, 403);
        await admin.request(`/api/auth/users/${clientId}`, { status: 'approved' }, 'PATCH');
        assert.equal((await login(client, 'client_one')).status, 200);
      }
      assert.equal((await admin.request(`/api/auth/users/${managerId}`, { expiresAt: null }, 'PATCH')).status, 403);
      assert.equal((await admin.request(`/api/auth/users/${clientId}`, { expiresAt: now + 1000 }, 'PATCH')).status, 200);
      now += 2000;
      assert.equal((await login(client, 'client_one')).status, 403);
      await admin.request(`/api/auth/users/${clientId}`, { status: 'approved' }, 'PATCH');
      assert.equal((await login(client, 'client_one')).status, 403, 'approval alone cannot extend expiry');
      await admin.request(`/api/auth/users/${clientId}`, { expiresAt: null }, 'PATCH');
      assert.equal((await login(client, 'client_one')).status, 200);
    });
    await t.test('delete user enforces roles, revokes sessions and removes both new and legacy accounts', async () => {
      const disposableAdmin = await create(owner, 'delete_manager', 'admin');
      const disposableClient = await create(admin, 'delete_client');
      const adminBrowser = new Browser(base), clientBrowser = new Browser(base);
      assert.equal((await login(adminBrowser, 'delete_manager')).status, 200);
      assert.equal((await login(clientBrowser, 'delete_client')).status, 200);
      assert.equal((await anon.request(`/api/auth/users/${disposableClient.id}`, {}, 'DELETE')).status, 401);
      assert.equal((await clientBrowser.request(`/api/auth/users/${clientId}`, {}, 'DELETE')).status, 403);
      assert.equal((await admin.request(`/api/auth/users/${disposableAdmin.id}`, {}, 'DELETE')).status, 403);
      assert.equal((await owner.request('/api/auth/users/owner-id', {}, 'DELETE')).status, 403);
      assert.equal((await owner.request(`/api/auth/users/${disposableAdmin.id}`, {}, 'DELETE', 'https://other.example')).status, 403);
      assert.equal((await admin.request(`/api/auth/users/${disposableClient.id}`, {}, 'DELETE')).status, 200);
      assert.equal(await getUser(clientBrowser), null);
      assert.equal((await login(clientBrowser, 'delete_client')).status, 401);
      assert.equal((await owner.request(`/api/auth/users/${disposableAdmin.id}`, {}, 'DELETE')).status, 200);
      assert.equal(await getUser(adminBrowser), null);
      // Older email-only users can be deleted without first assigning credentials.
      const stored = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
      const legacyId = stored.users.find((u: any) => u.id === 'legacy-client').id;
      assert.equal((await owner.request(`/api/auth/users/${legacyId}`, {}, 'DELETE')).status, 200);
      const users = (await (await owner.request('/api/auth/users')).json()).users;
      assert.ok(!users.some((u: any) => [legacyId, disposableAdmin.id, disposableClient.id].includes(u.id)));
      const saved = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
      assert.ok(!saved.sessions.some((session: any) => [legacyId, disposableAdmin.id, disposableClient.id].includes(session.userId)));
      const audit = (await (await owner.request('/api/auth/activity')).json()).activity;
      assert.ok(audit.some((entry: any) => entry.action === 'user.deleted' && entry.target === 'delete_client'));
      assert.equal((await owner.request(`/api/auth/users/${disposableAdmin.id}`, {}, 'DELETE')).status, 404);
    });
    await t.test('sessions persist across restart for 30 days, polling cannot extend them, and logout revokes them', async () => {
      const before = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
      const digest = createHash('sha256').update(client.cookies.get('dashboard_session')!).digest('hex');
      const session = before.sessions.find((s: any) => s.digest === digest);
      assert.equal(session.expiresAt - session.verifiedAt, 30 * 86_400_000);
      now += 86_400_000;
      auth = new DashboardAuth({ directory, publicUrl: base, now: () => now });
      assert.ok(await getUser(client));
      const after = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
      assert.equal(after.sessions.find((s: any) => s.digest === digest).expiresAt, session.expiresAt);
      assert.equal((await client.request('/api/auth/logout', {})).status, 200); assert.equal(await getUser(client), null);
      assert.equal((await login(client, 'client_one')).status, 200);
      now += 31 * 86_400_000;
      assert.equal(await getUser(client), null); assert.equal(await getUser(admin), null);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('usernames are normalized and invalid identifiers are rejected', () => {
  assert.equal(normalizeUsername(' Client_One '), 'client_one');
  for (const name of ['', 'ab', 'a b', '../owner', 'test@gmail.com', 'x'.repeat(33)]) assert.throws(() => normalizeUsername(name));
});

test('client journal excludes broker identifiers, executions and money results', () => {
  const trades = [{ id: 'chart' }, { id: 'MT5:42' }, { id: 'a', mt5Managed: true },
    { id: 'b', mt5SignalId: 'signal' }, { id: 'c', brokerTicket: 42 }, { id: 'd', realizedProfit: 5 }];
  assert.deepEqual(clientVisibleTrades(trades), [{ id: 'chart' }]);
});
