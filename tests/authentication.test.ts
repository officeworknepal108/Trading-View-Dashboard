import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardAuth, normalizeLoginEmail } from '../src/server/authentication';
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

test('Google/password login, approval, roles, OTP, expiry, resets and session revocation', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dashboard-auth-test-'));
  const emails: { to: string; subject: string; text: string }[] = [];
  let now = Date.now();
  const app = express();
  app.use(denyPrivateFiles);
  app.use(express.json());
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const previousId = process.env.GOOGLE_CLIENT_ID;
  const previousSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  const identities: Record<string, string> = { owner: 'tradingviewfx108@gmail.com', 'former-owner': 'cabhishek64@gmail.com', admin: 'manager@gmail.com', client: 'approvedclient@gmail.com' };
  const oldOwnerToken = 'former-owner-test-session';
  const pendingOwnerToken = 'pending-owner-test-session';
  await writeFile(path.join(directory, 'accounts.json'), JSON.stringify({
    users: [
      { id: 'former-owner', email: 'cabhishek64@gmail.com', googleSubject: 'google:former-owner', role: 'super_admin', status: 'approved', verified: true, createdAt: now },
      { id: 'pending-owner', email: identities.owner, role: 'client', status: 'pending', verified: true, createdAt: now },
    ],
    sessions: [
      { userId: 'former-owner', digest: createHash('sha256').update(oldOwnerToken).digest('hex'), expiresAt: now + 8 * 60 * 60_000 },
      { userId: 'pending-owner', digest: createHash('sha256').update(pendingOwnerToken).digest('hex'), expiresAt: now + 8 * 60 * 60_000 },
    ], challenges: [], resets: [], oauth: [], audit: [],
  }));
  const auth = new DashboardAuth({ directory, publicUrl: base, now: () => now,
    sendEmail: async (to, subject, text) => { emails.push({ to, subject, text }); },
    googleIdentity: async code => ({ email: identities[code] ?? 'newclient@gmail.com', subject: `google:${code}`, verified: code !== 'unverified' }),
  });
  app.use('/api/auth', auth.router);
  app.use('/api', auth.guard);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/tradingview/market-data', (_req, res) => res.json({ ok: true }));
  app.put('/api/mt5/config', (_req, res) => res.json({ ok: true }));
  app.post('/api/telegram/alerts', (_req, res) => res.json({ ok: true }));
  app.post('/api/mt5/heartbeat', (_req, res) => res.json({ ok: true }));
  const anon = new Browser(base);
  const owner = new Browser(base);
  owner.cookies.set('dashboard_session', pendingOwnerToken);
  const formerOwner = new Browser(base);
  formerOwner.cookies.set('dashboard_session', oldOwnerToken);
  const admin = new Browser(base);
  const client = new Browser(base);
  const codeFor = (email: string) => emails.filter(message => message.to === email && message.subject.includes('verification')).at(-1)!.text.match(/\b\d{6}\b/)![0];
  const googleStart = async (browser: Browser, code: string) => {
    const start = await browser.request('/api/auth/google');
    assert.equal(start.status, 302);
    const location = new URL(start.headers.get('location')!);
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    const callback = await browser.request(`/api/auth/google/callback?code=${code}&state=${location.searchParams.get('state')}`);
    assert.equal(callback.headers.get('location'), '/?auth=verify');
  };
  const verify = async (browser: Browser, email: string) => {
    const response = await browser.request('/api/auth/verify', { code: codeFor(email) });
    assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('dashboard_session='))!;
    assert.match(cookie, /Max-Age=2592000/);
    assert.match(cookie, /HttpOnly/);
    const stored = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
    const digest = createHash('sha256').update(browser.cookies.get('dashboard_session')!).digest('hex');
    const session = stored.sessions.find((entry: any) => entry.digest === digest);
    assert.equal(session.expiresAt - session.verifiedAt, 30 * 86_400_000);
    return (await response.json()).user;
  };
  try {
    await t.test('default is locked, cross-origin writes fail and owner cannot register a password', async () => {
      for (const route of ['/.dashboard-auth/accounts.json', '/@fs/C:/project/.dashboard-auth/accounts.json', '/%252edashboard-auth/accounts.json', '/data/trade-journal.json', '/.env.mt5']) {
        assert.equal((await anon.request(route)).status, 404);
      }
      assert.equal((await anon.request('/api/tradingview/market-data')).status, 401);
      assert.equal((await anon.request('/api/mt5/heartbeat', {})).status, 401);
      assert.equal((await anon.request('/api/auth/register', { email: identities.owner, password: 'test-password-123' })).status, 403);
      assert.equal((await anon.request('/api/auth/register', {}, 'POST', 'https://other.example')).status, 403);
      const callback = await anon.request('/api/auth/google/callback?code=owner&state=forged');
      assert.ok(callback.headers.get('location')!.includes('auth_error='));
    });
    await t.test('an active legacy session upgrades to 30 days without another code', async () => {
      const sentBefore = emails.length;
      const response = await formerOwner.request('/api/auth/me');
      assert.equal((await response.json()).user.role, 'super_admin');
      assert.match(response.headers.getSetCookie()[0], /Max-Age=2592000/);
      assert.equal(emails.length, sentBefore);
    });
    await t.test('ownership transfers only after Google and OTP, including resend, and the old owner cannot reclaim it', async () => {
      await googleStart(owner, 'owner');
      assert.equal((await owner.request('/api/mt5/config', {}, 'PUT')).status, 403);
      assert.equal((await (await owner.request('/api/auth/me')).json()).user.role, 'client', 'Google sign-in alone cannot promote an existing session');
      assert.equal((await formerOwner.request('/api/mt5/config', {}, 'PUT')).status, 200, 'the previous owner stays active until the new code succeeds');
      assert.equal((await owner.request('/api/auth/verify', { code: '000000' })).status, 400);
      assert.equal((await formerOwner.request('/api/mt5/config', {}, 'PUT')).status, 200, 'an incorrect code cannot revoke the previous owner');
      now += 61_000;
      assert.equal((await owner.request('/api/auth/resend', {})).status, 200);
      const user = await verify(owner, identities.owner);
      assert.equal(user.role, 'super_admin');
      assert.equal(user.canAccess, true);
      assert.equal((await formerOwner.request('/api/mt5/config', {}, 'PUT')).status, 401, 'handover revokes the previous owner session');
      const members = (await (await owner.request('/api/auth/users')).json()).users;
      assert.equal(members.filter((member: any) => member.role === 'super_admin').length, 1);
      const old = members.find((member: any) => member.email === 'cabhishek64@gmail.com');
      assert.equal(old.role, 'client');
      assert.equal(old.status, 'removed');
      assert.equal((await owner.request('/api/auth/verify', { code: codeFor(identities.owner) })).status, 400, 'one-time code cannot be reused');
      assert.equal((await owner.request('/api/mt5/config', {}, 'PUT')).status, 200);
      assert.equal((await owner.request('/api/auth/users', { email: 'manager@gmail.com', role: 'admin' })).status, 201);
      await googleStart(formerOwner, 'former-owner');
      const former = await verify(formerOwner, identities['former-owner']);
      assert.equal(former.role, 'client');
      assert.equal(former.canAccess, false);
      assert.equal((await formerOwner.request('/api/mt5/config', {}, 'PUT')).status, 403);
    });
    await t.test('clients prove email ownership, then wait for approval', async () => {
      assert.equal((await client.request('/api/auth/register', { email: identities.client, password: 'client-password-123' })).status, 200);
      const pending = await verify(client, identities.client);
      assert.equal(pending.status, 'pending');
      assert.equal(pending.canAccess, false);
      assert.equal((await client.request('/api/tradingview/market-data')).status, 403);
    });
    await t.test('admin approves clients but cannot manage admins or super admin', async () => {
      await googleStart(admin, 'admin');
      assert.equal((await verify(admin, identities.admin)).role, 'admin');
      assert.equal((await admin.request('/api/auth/login', { email: identities.admin, password: 'anything' })).status, 401);
      const members = (await (await owner.request('/api/auth/users')).json()).users;
      const clientUser = members.find((member: any) => member.email === identities.client);
      const ownerUser = members.find((member: any) => member.role === 'super_admin');
      assert.equal((await admin.request(`/api/auth/users/${ownerUser.id}`, { status: 'suspended' }, 'PATCH')).status, 403);
      assert.equal((await admin.request('/api/auth/users', { email: 'rogueadmin@gmail.com', role: 'admin' })).status, 403);
      assert.equal((await admin.request(`/api/auth/users/${clientUser.id}`, { role: 'admin' }, 'PATCH')).status, 403);
      const result = await admin.request(`/api/auth/users/${clientUser.id}`, { status: 'approved', expiresAt: now + 60 * 60_000 }, 'PATCH');
      assert.equal(result.status, 200);
      assert.equal((await result.json()).user.approvedBy, identities.admin);
      assert.equal((await client.request('/api/auth/me').then(r => r.json())).user, null, 'approval changes revoke existing sessions');
    });
    await t.test('approved clients have charts but cannot access bridge, Telegram or user management', async () => {
      now += 61_000;
      assert.equal((await client.request('/api/auth/login', { email: identities.client, password: 'client-password-123' })).status, 200);
      assert.equal((await verify(client, identities.client)).canAccess, true);
      assert.equal((await client.request('/api/tradingview/market-data')).status, 200);
      for (const route of ['/api/mt5/bridge/start', '/api/telegram/alerts']) assert.equal((await client.request(route, {})).status, 403);
      assert.equal((await client.request('/api/mt5/config', {}, 'PUT')).status, 403);
      assert.equal((await client.request('/api/mt5/accounts')).status, 403);
      assert.equal((await client.request('/api/auth/users')).status, 403);
      assert.equal((await client.request('/api/auth/activity')).status, 403);
    });
    await t.test('Google and password login resolve to one account and do not expose hashes', async () => {
      now += 61_000;
      const before = (await (await owner.request('/api/auth/users')).json()).users;
      await googleStart(client, 'client');
      const account = await verify(client, identities.client);
      assert.equal(account.id, before.find((u: any) => u.email === identities.client).id);
      assert.equal(account.passwordHash, undefined);
      assert.equal(account.googleSubject, undefined);
      assert.equal((await (await owner.request('/api/auth/users')).json()).users.length, before.length);
    });
    await t.test('single-use reset link expires in 15 minutes and resetting revokes sessions', async () => {
      assert.equal((await anon.request('/api/auth/forgot-password', { email: identities.client })).status, 200);
      const reset = emails.filter(message => message.subject.includes('Reset')).at(-1)!;
      const token = reset.text.match(/#reset=([^\s]+)/)![1];
      assert.equal((await anon.request('/api/auth/reset-password', { token, password: 'new-client-password-123' })).status, 200);
      assert.equal((await client.request('/api/tradingview/market-data')).status, 401);
      assert.equal((await anon.request('/api/auth/reset-password', { token, password: 'other-password-123' })).status, 400);
      assert.equal((await anon.request('/api/auth/login', { email: identities.client, password: 'client-password-123' })).status, 401);
      await anon.request('/api/auth/forgot-password', { email: identities.client });
      const later = emails.filter(message => message.subject.includes('Reset')).at(-1)!.text.match(/#reset=([^\s]+)/)![1];
      now += 15 * 60_000 + 1;
      assert.equal((await anon.request('/api/auth/reset-password', { token: later, password: 'other-password-123' })).status, 400);
    });
    await t.test('OTP expires, retries are bounded and suspension/expiry deny active users', async () => {
      const other = new Browser(base);
      await other.request('/api/auth/register', { email: 'expiredcode@gmail.com', password: 'client-password-123' });
      const old = codeFor('expiredcode@gmail.com');
      now += 5 * 60_000 + 1;
      assert.equal((await other.request('/api/auth/verify', { code: old })).status, 400);
      await other.request('/api/auth/register', { email: 'wrongcode@gmail.com', password: 'client-password-123' });
      for (let count = 0; count < 5; count++) assert.equal((await other.request('/api/auth/verify', { code: '000000' })).status, 400);
      assert.equal((await other.request('/api/auth/verify', { code: codeFor('wrongcode@gmail.com') })).status, 400);
      await client.request('/api/auth/login', { email: identities.client, password: 'new-client-password-123' });
      const account = await verify(client, identities.client);
      assert.equal(account.canAccess, true);
      assert.equal((await admin.request(`/api/auth/users/${account.id}`, { status: 'suspended' }, 'PATCH')).status, 200);
      assert.equal((await client.request('/api/tradingview/market-data')).status, 401);
      await admin.request(`/api/auth/users/${account.id}`, { status: 'approved', expiresAt: now + 2_000 }, 'PATCH');
      now += 61_000;
      await client.request('/api/auth/login', { email: identities.client, password: 'new-client-password-123' });
      assert.equal((await verify(client, identities.client)).canAccess, false);
      assert.equal((await client.request('/api/tradingview/market-data')).status, 403);
    });
    await t.test('resending invalidates the earlier code and repeated password failures are limited', async () => {
      const browser = new Browser(base);
      await browser.request('/api/auth/register', { email: 'resendclient@gmail.com', password: 'client-password-123' });
      const oldCode = codeFor('resendclient@gmail.com');
      assert.equal((await browser.request('/api/auth/resend', {})).status, 429);
      now += 61_000;
      assert.equal((await browser.request('/api/auth/resend', {})).status, 200);
      const newCode = codeFor('resendclient@gmail.com');
      if (newCode !== oldCode) assert.equal((await browser.request('/api/auth/verify', { code: oldCode })).status, 400);
      assert.equal((await verify(browser, 'resendclient@gmail.com')).status, 'pending');
      for (let attempt = 0; attempt < 8; attempt++) {
        assert.equal((await anon.request('/api/auth/login', { email: 'nonexistent@gmail.com', password: 'incorrect-password' })).status, 401);
      }
      assert.equal((await anon.request('/api/auth/login', { email: 'nonexistent@gmail.com', password: 'incorrect-password' })).status, 429);
    });
    await t.test('super admin sees approval history; admin activity is restricted; secrets stay hashed', async () => {
      const all = (await (await owner.request('/api/auth/activity')).json()).activity;
      assert.ok(all.some((entry: any) => entry.actor === identities.admin && entry.action === 'user.updated'));
      const own = (await (await admin.request('/api/auth/activity')).json()).activity;
      assert.ok(own.every((entry: any) => entry.actor === identities.admin));
      const saved = await readFile(path.join(directory, 'accounts.json'), 'utf8');
      assert.ok(!saved.includes('new-client-password-123'));
      assert.ok(!saved.includes(owner.cookies.get('dashboard_session')!));
      assert.ok(!saved.includes('test-client-secret'));
      assert.equal(normalizeLoginEmail('Approved.Client+alias@googlemail.com'), identities.client);
    });
    await t.test('a new super-admin device requires a code without logging out the already verified device', async () => {
      const device = new Browser(base);
      assert.equal((await device.request('/api/mt5/config', {}, 'PUT')).status, 401);
      await googleStart(device, 'owner');
      assert.equal((await device.request('/api/mt5/config', {}, 'PUT')).status, 401);
      assert.equal((await owner.request('/api/mt5/config', {}, 'PUT')).status, 200);
      await verify(device, identities.owner);
      assert.equal((await device.request('/api/mt5/config', {}, 'PUT')).status, 200);
      assert.equal((await owner.request('/api/mt5/config', {}, 'PUT')).status, 200);
    });
    await t.test('all roles retain verified sessions after reopening; polling does not renew the 30-day deadline', async () => {
      const start = now;
      const sentBefore = emails.length;
      const persisted = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
      const reopen = [owner, admin, client].map(browser => {
        const reopened = new Browser(base);
        reopened.cookies = new Map(browser.cookies);
        return reopened;
      });
      try {
        now += 86_400_000;
        for (const browser of reopen) {
          const response = await browser.request('/api/auth/me');
          assert.ok((await response.json()).user, 'the verified browser still has its session after 24 hours');
          assert.doesNotMatch(response.headers.getSetCookie()[0], /Max-Age=2592000;/, 'session polling does not restart the period');
        }
        assert.equal(emails.length, sentBefore, 'reopening does not send any verification emails');
        const afterPolling = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
        assert.deepEqual(afterPolling.sessions.map((entry: any) => entry.expiresAt), persisted.sessions.map((entry: any) => entry.expiresAt));
        now = start + 31 * 86_400_000;
        for (const browser of reopen) assert.equal((await (await browser.request('/api/auth/me')).json()).user, null);
      } finally { now = start; }
    });
    await t.test('only the super admin can create or restore admin access with no expiry', async () => {
      const members = (await (await owner.request('/api/auth/users')).json()).users;
      const manager = members.find((member: any) => member.email === identities.admin);
      assert.equal((await admin.request(`/api/auth/users/${manager.id}`, { expiresAt: null }, 'PATCH')).status, 403);
      const creation = await owner.request('/api/auth/users', { email: 'permanentadmin@gmail.com', role: 'admin', expiresAt: null });
      assert.equal(creation.status, 201);
      assert.equal((await creation.json()).user.expiresAt, undefined);
      const start = now;
      try {
        const dated = await owner.request(`/api/auth/users/${manager.id}`, { expiresAt: now + 86_400_000 }, 'PATCH');
        assert.equal(dated.status, 200);
        assert.equal((await dated.json()).user.expiresAt, now + 86_400_000);
        const cleared = await owner.request(`/api/auth/users/${manager.id}`, { expiresAt: null }, 'PATCH');
        assert.equal(cleared.status, 200);
        assert.equal((await cleared.json()).user.expiresAt, undefined);
        now += 2 * 86_400_000;
        const after = (await (await owner.request('/api/auth/users')).json()).users.find((member: any) => member.id === manager.id);
        assert.equal(after.canAccess, true, 'admin access remains active after its former expiry date');
        const saved = JSON.parse(await readFile(path.join(directory, 'accounts.json'), 'utf8'));
        assert.equal(saved.users.find((member: any) => member.id === manager.id).expiresAt, undefined);
      } finally { now = start; }
    });
  } finally {
    if (previousId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = previousSecret;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('client journal excludes broker identifiers, executions and money results', () => {
  const trades = [{ id: 'chart' }, { id: 'MT5:42' }, { id: 'a', mt5Managed: true },
    { id: 'b', mt5SignalId: 'signal' }, { id: 'c', brokerTicket: 42 }, { id: 'd', realizedProfit: 5 }];
  assert.deepEqual(clientVisibleTrades(trades), [{ id: 'chart' }]);
});
