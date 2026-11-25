import express from 'express';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DashboardUser, UserRole, AccessState } from '../services/authTypes';

const SUPER_EMAIL = 'tradingviewfx108@gmail.com';
const SESSION_COOKIE = 'dashboard_session';
const DEVICE_COOKIE = 'dashboard_device';
const MINUTE = 60_000;
const SESSION_LIFETIME = 30 * 24 * 60 * MINUTE;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
};
export class AuthError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export function normalizeUsername(input: unknown): string {
  const name = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(name)) {
    throw new AuthError(400, 'Use a username of 3 to 32 letters, numbers, dots, underscores or hyphens.');
  }
  return name;
}
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new AuthError(400, 'Use a password between 12 and 128 characters.');
  }
  const salt = randomBytes(16).toString('hex');
  const digest = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, result) => error ? reject(error) : resolve(result));
  });
  return `${salt}:${digest.toString('hex')}`;
}
async function passwordMatches(password: unknown, saved?: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, expected] = (saved ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const digest = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, result) => error ? reject(error) : resolve(result));
  });
  return equal(digest.toString('hex'), expected) && !!saved;
}
interface User extends Omit<DashboardUser, 'canAccess' | 'accessMessage' | 'credentialsReady'> {
  passwordHash?: string;
  googleSubject?: string;
}
interface Session { digest: string; userId: string; expiresAt: number; verifiedAt?: number; deviceDigest?: string; origin?: string }
interface Audit { id: string; at: number; actor: string; action: string; target?: string; details?: string }
interface Store { users: User[]; sessions: Session[]; challenges: unknown[]; resets: unknown[]; oauth: unknown[]; audit: Audit[] }
export interface AuthOptions { directory?: string; publicUrl?: string; localUrl?: string; now?: () => number }

export class DashboardAuth {
  readonly router = express.Router();
  readonly origin: string;
  readonly localOrigin: string;
  private localOrigins: Set<string>;
  private store!: Store;
  private ready: Promise<void>;
  private file: string;
  private setupFile: string;
  private setupToken?: string;
  private now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private rates = new Map<string, { count: number; until: number }>();
  constructor(options: AuthOptions = {}) {
    this.origin = new URL(options.publicUrl ?? process.env.AUTH_PUBLIC_URL ?? 'http://127.0.0.1:3002').origin;
    if (!this.origin.startsWith('https:') && !['127.0.0.1', 'localhost'].includes(new URL(this.origin).hostname)) {
      throw new Error('AUTH_PUBLIC_URL must use HTTPS outside localhost.');
    }
    const publicIsLocal = ['127.0.0.1', 'localhost'].includes(new URL(this.origin).hostname);
    const local = new URL(options.localUrl ?? process.env.AUTH_LOCAL_URL
      ?? (publicIsLocal ? this.origin : `http://127.0.0.1:${process.env.PORT || 3002}`));
    if (!['http:', 'https:'].includes(local.protocol) || !['127.0.0.1', 'localhost'].includes(local.hostname)) {
      throw new Error('AUTH_LOCAL_URL must be a loopback HTTP or HTTPS address.');
    }
    this.localOrigin = local.origin;
    this.localOrigins = new Set(['127.0.0.1', 'localhost'].map(hostname => {
      const alias = new URL(local); alias.hostname = hostname; return alias.origin;
    }));
    this.file = path.join(options.directory ?? path.resolve('.dashboard-auth'), 'accounts.json');
    this.setupFile = path.join(path.dirname(this.file), 'owner-setup.json');
    this.now = options.now ?? Date.now;
    this.ready = this.load();
    this.routes();
  }
  private async load() {
    try { this.store = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.store = { users: [], sessions: [], challenges: [], resets: [], oauth: [], audit: [] };
    }
    // Old email challenges and reset links no longer authorize any account.
    this.store.challenges = []; this.store.resets = []; this.store.oauth = [];
    // Legacy client cookies have no device binding and must sign in again.
    this.store.sessions = this.store.sessions.filter(s => s.deviceDigest
      || this.store.users.some(u => u.id === s.userId && u.role !== 'client'));
    if (!this.ownerReady()) {
      this.setupToken = secret();
      const url = this.localOrigin;
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(this.setupFile, JSON.stringify({ token: this.setupToken, origin: url, url }), { mode: 0o600 });
    } else await unlink(this.setupFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await this.save();
  }
  private ownerReady() {
    return this.store.users.some(u => u.role === 'super_admin' && u.username && u.passwordHash);
  }
  private async save() {
    this.store.sessions = this.store.sessions.filter(s => s.expiresAt > this.now());
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(this.store), { mode: 0o600 });
    await rename(temporary, this.file);
  }
  private audit(actor: string, action: string, target?: string, details?: string) {
    this.store.audit.push({ id: secret(), at: this.now(), actor, action, target, details });
  }
  private run(handler: (req: express.Request, res: express.Response) => Promise<unknown> | unknown): express.RequestHandler {
    return (req, res) => {
      const task = this.queue.then(async () => { await this.ready; return handler(req, res); });
      this.queue = task.catch(() => undefined);
      void task.catch(error => {
        if (!res.headersSent) res.status(error instanceof AuthError ? error.statusCode : 503)
          .json({ ok: false, error: error instanceof AuthError ? error.message : 'Authentication service unavailable. Try again shortly.' });
      });
    };
  }
  private isLocalRequest(req: express.Request): boolean {
    // A tunnel also connects from loopback; forwarded requests must never gain
    // local management rights by supplying a localhost Host header.
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
      && !['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'cf-connecting-ip', 'cf-ray'].some(header => req.get(header));
  }
  private requestOrigin(req: express.Request): string | undefined {
    const host = req.get('host')?.toLowerCase();
    const local = [...this.localOrigins].find(origin => new URL(origin).host === host);
    if (local) return this.isLocalRequest(req) ? local : undefined;
    return new URL(this.origin).host === host ? this.origin : undefined;
  }
  private clientOnlyRequest(req: express.Request): boolean {
    const origin = this.requestOrigin(req);
    return !!origin && !this.localOrigins.has(origin);
  }
  private allowedWriteOrigin(req: express.Request): boolean {
    const origin = this.requestOrigin(req);
    return !!origin && req.get('origin') === origin;
  }
  private cookieOptions(req: express.Request) {
    return { httpOnly: true, secure: (this.requestOrigin(req) ?? this.origin).startsWith('https:'), sameSite: 'lax' as const, path: '/' };
  }
  private cookie(req: express.Request, name: string) {
    return (req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
  }
  private limit(key: string, maximum = 8, duration = 15 * MINUTE) {
    const now = this.now();
    if (this.rates.size > 10_000) for (const [name, value] of this.rates) if (value.until <= now) this.rates.delete(name);
    const entry = this.rates.get(key);
    if (entry && entry.until > now) {
      if (entry.count >= maximum) throw new AuthError(429, 'Too many failed attempts. Please try again later.');
      entry.count++;
    } else this.rates.set(key, { count: 1, until: now + duration });
  }
  private view(user: User): DashboardUser {
    const expired = user.expiresAt !== undefined && user.expiresAt <= this.now();
    const canAccess = user.verified && user.status === 'approved' && !expired;
    const accessMessage = user.status === 'pending' ? 'Waiting for admin approval.'
      : user.status === 'suspended' ? 'Your access is suspended. Contact an admin.'
      : user.status === 'removed' ? 'Your access has been removed. Contact an admin.'
      : expired ? 'Your access has expired. Contact an admin to renew it.'
      : !user.verified ? 'Ask an admin to set up your login.' : 'Access approved.';
    const { passwordHash: _password, googleSubject: _subject, ...safe } = user;
    return { ...safe, credentialsReady: !!(user.username && user.passwordHash), canAccess, accessMessage };
  }
  private findSession(req: express.Request): User | undefined {
    const origin = this.requestOrigin(req);
    if (!origin) return;
    const session = this.store.sessions.find(s => s.digest === hash(this.cookie(req, SESSION_COOKIE)) && s.expiresAt > this.now());
    if (!session || session.origin && session.origin !== origin) return;
    const user = this.store.users.find(u => u.id === session.userId);
    if (user && user.role !== 'client' && this.clientOnlyRequest(req)) return;
    if (user?.role === 'client' && session.deviceDigest !== hash(this.cookie(req, DEVICE_COOKIE))) return;
    return user;
  }
  private requireUser(req: express.Request, admin = false): User {
    const user = this.findSession(req);
    if (!user) throw new AuthError(401, 'Please sign in.');
    if (!this.view(user).canAccess) throw new AuthError(403, this.view(user).accessMessage);
    if (admin && user.role === 'client') throw new AuthError(403, 'You do not have permission for this action.');
    return user;
  }
  private invalidate(userId: string) { this.store.sessions = this.store.sessions.filter(s => s.userId !== userId); }
  private issueSession(req: express.Request, res: express.Response, user: User) {
    const raw = secret();
    let device = this.cookie(req, DEVICE_COOKIE);
    if (!/^[A-Za-z0-9_-]{43}$/.test(device)) device = secret();
    const deviceDigest = hash(device);
    // One account per browser, and one browser per client account. Successful
    // logins replace sessions atomically inside the auth queue, without cooldown.
    this.store.sessions = this.store.sessions.filter(s => s.deviceDigest !== deviceDigest
      && s.digest !== hash(this.cookie(req, SESSION_COOKIE))
      && !(user.role === 'client' && s.userId === user.id));
    const verifiedAt = this.now();
    this.store.sessions.push({ digest: hash(raw), userId: user.id, deviceDigest, verifiedAt, expiresAt: verifiedAt + SESSION_LIFETIME, origin: this.requestOrigin(req) });
    res.cookie(DEVICE_COOKIE, device, { ...this.cookieOptions(req), maxAge: SESSION_LIFETIME });
    res.cookie(SESSION_COOKIE, raw, { ...this.cookieOptions(req), maxAge: SESSION_LIFETIME });
  }
  private uniqueUsername(input: unknown, exceptId?: string) {
    const username = normalizeUsername(input);
    if (this.store.users.some(u => u.id !== exceptId && u.username === username)) throw new AuthError(409, 'That username is already in use.');
    return username;
  }
  private routes() {
    this.router.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      if (!this.requestOrigin(req) || !['GET', 'HEAD'].includes(req.method) && !this.allowedWriteOrigin(req)) {
        res.status(403).json({ ok: false, error: 'Same-origin requests only.' }); return;
      }
      next();
    });
    this.router.get('/config', this.run((req, res) => res.json({ ok: true, passwordLogin: true,
      clientOnly: this.clientOnlyRequest(req), ownerSetupRequired: !this.ownerReady() })));
    this.router.post('/owner-setup', this.run(async (req, res) => {
      const local = this.isLocalRequest(req) && this.localOrigins.has(this.requestOrigin(req) ?? '');
      if (!local || this.ownerReady() || !this.setupToken || !equal(req.get('authorization') ?? '', `Bearer ${this.setupToken}`)) {
        throw new AuthError(403, 'Owner setup requires the private local setup prompt.');
      }
      const username = this.uniqueUsername(req.body?.username);
      const passwordHash = await hashPassword(req.body?.password);
      let owner = this.store.users.find(u => u.email === SUPER_EMAIL) ?? this.store.users.find(u => u.role === 'super_admin');
      if (!owner) { owner = { id: secret(), email: SUPER_EMAIL, role: 'super_admin', status: 'approved', verified: true, createdAt: this.now() }; this.store.users.push(owner); }
      for (const old of this.store.users.filter(u => u.role === 'super_admin' && u.id !== owner.id)) {
        old.role = 'client'; old.status = 'removed'; this.invalidate(old.id);
      }
      Object.assign(owner, { username, passwordHash, role: 'super_admin', status: 'approved', verified: true, expiresAt: undefined });
      this.invalidate(owner.id);
      this.audit(username, 'owner.credentials.created', username);
      await this.save(); this.setupToken = undefined;
      await unlink(this.setupFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
      res.json({ ok: true });
    }));
    this.router.get('/me', this.run((req, res) => {
      const user = this.findSession(req);
      res.json({ ok: true, user: user ? this.view(user) : null });
    }));
    this.router.post('/login', this.run(async (req, res) => {
      const username = normalizeUsername(req.body?.username);
      this.limit(`login:ip:${req.ip}`, 60); this.limit(`login:user:${username}`, 12);
      const user = this.store.users.find(u => u.username === username);
      if (!await passwordMatches(req.body?.password, user?.passwordHash) || !user) throw new AuthError(401, 'Username or password is incorrect.');
      if (user.role !== 'client' && this.clientOnlyRequest(req)) throw new AuthError(403, 'Admins and super admin must sign in through the local dashboard.');
      if (!this.view(user).canAccess) throw new AuthError(403, this.view(user).accessMessage);
      this.rates.delete(`login:user:${username}`); this.rates.delete(`login:ip:${req.ip}`);
      this.issueSession(req, res, user); this.audit(username, 'login.password', username);
      await this.save(); res.json({ ok: true, user: this.view(user) });
    }));
    this.router.post('/logout', this.run(async (req, res) => {
      const digest = hash(this.cookie(req, SESSION_COOKIE));
      this.store.sessions = this.store.sessions.filter(s => s.digest !== digest);
      await this.save(); res.clearCookie(SESSION_COOKIE, this.cookieOptions(req)); res.json({ ok: true });
    }));
    // Explicitly disable the old authorization paths, including old reset links.
    for (const route of ['/register', '/verify', '/resend', '/forgot', '/reset', '/google', '/google/callback']) {
      this.router.all(route, (_req, res) => res.status(410).json({ ok: false, error: 'Use your assigned username and password. Contact an admin for account access or password resets.' }));
    }
    this.router.get('/users', this.run((req, res) => {
      const actor = this.requireUser(req, true);
      res.json({ ok: true, users: this.store.users.filter(u => actor.role === 'super_admin' || u.role === 'client').map(u => this.view(u)) });
    }));
    this.router.post('/users', this.run(async (req, res) => {
      const actor = this.requireUser(req, true);
      if (!['admin', 'client'].includes(req.body?.role)) throw new AuthError(400, 'Choose admin or client.');
      const role: UserRole = req.body.role;
      if (role === 'admin' && actor.role !== 'super_admin') throw new AuthError(403, 'Only the super admin can create admins.');
      const username = this.uniqueUsername(req.body?.username);
      const passwordHash = await hashPassword(req.body?.password);
      const expiresAt = this.expiry(req.body?.expiresAt);
      const user: User = { id: secret(), email: username, username, passwordHash, role, status: 'approved', verified: true,
        createdAt: this.now(), approvedBy: actor.username ?? actor.email, approvedAt: this.now(), expiresAt };
      this.store.users.push(user); this.audit(actor.username ?? actor.email, 'user.created', username, role);
      await this.save(); res.status(201).json({ ok: true, user: this.view(user) });
    }));
    this.router.patch('/users/:id', this.run(async (req, res) => {
      const actor = this.requireUser(req, true);
      const user = this.store.users.find(u => u.id === req.params.id);
      if (!user) throw new AuthError(404, 'User not found.');
      if (user.email === SUPER_EMAIL || user.role === 'super_admin') throw new AuthError(403, 'The super admin account is protected.');
      if (actor.role !== 'super_admin' && (user.role !== 'client' || req.body?.role !== undefined)) throw new AuthError(403, 'Only the super admin can manage admins.');
      const status: AccessState | undefined = req.body?.status;
      if (status !== undefined && !['approved', 'pending', 'suspended', 'removed'].includes(status)) throw new AuthError(400, 'Invalid access status.');
      if (req.body?.role !== undefined && !['admin', 'client'].includes(req.body.role)) throw new AuthError(400, 'Invalid role.');
      // Validate everything before mutating the account.
      const username = req.body?.username === undefined ? user.username : this.uniqueUsername(req.body.username, user.id);
      const passwordHash = req.body?.password === undefined ? user.passwordHash : await hashPassword(req.body.password);
      const expiresAt = req.body?.expiresAt === undefined ? user.expiresAt : this.expiry(req.body.expiresAt);
      Object.assign(user, { username, passwordHash, expiresAt });
      if (username && passwordHash) user.verified = true;
      if (req.body?.role !== undefined) user.role = req.body.role;
      if (status !== undefined) user.status = status;
      if (status === 'approved') { user.approvedBy = actor.username ?? actor.email; user.approvedAt = this.now(); }
      this.invalidate(user.id);
      this.audit(actor.username ?? actor.email, 'user.updated', user.username ?? user.email,
        JSON.stringify({ role: user.role, status: user.status, expiresAt: user.expiresAt ?? null, credentialsChanged: req.body?.username !== undefined || req.body?.password !== undefined }));
      await this.save(); res.json({ ok: true, user: this.view(user) });
    }));
    this.router.delete('/users/:id', this.run(async (req, res) => {
      const actor = this.requireUser(req, true);
      const user = this.store.users.find(u => u.id === req.params.id);
      if (!user) throw new AuthError(404, 'User not found.');
      if (user.email === SUPER_EMAIL || user.role === 'super_admin') throw new AuthError(403, 'The super admin account is protected.');
      if (actor.role !== 'super_admin' && user.role !== 'client') throw new AuthError(403, 'Only the super admin can delete admins.');
      this.invalidate(user.id);
      this.store.users = this.store.users.filter(u => u.id !== user.id);
      this.audit(actor.username ?? actor.email, 'user.deleted', user.username ?? user.email, JSON.stringify({ id: user.id, role: user.role }));
      await this.save();
      res.json({ ok: true });
    }));
    this.router.get('/activity', this.run((req, res) => {
      const actor = this.requireUser(req, true);
      res.json({ ok: true, activity: this.store.audit.filter(a => actor.role === 'super_admin' || a.actor === (actor.username ?? actor.email) || a.actor === actor.email).slice(-500).reverse() });
    }));
  }
  private expiry(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= this.now()) throw new AuthError(400, 'Choose a future access expiry date.');
    return value;
  }

  // Browser authorization is distinct from the existing bridge machine token.
  guard: express.RequestHandler = (req, res, next) => {
    void this.ready.then(() => {
      if (req.path === '/health' && req.method === 'GET') { next(); return; }
      const machineWrite = (req.method === 'POST' && (/^\/mt5\/(heartbeat|market-data|signals\/claim|pullback-allocation)$/.test(req.path)
        || /^\/mt5\/signals\/[^/]+\/status$/.test(req.path)));
      // The existing Python bridge reads status to synchronize its execution config.
      const machineRoute = machineWrite || req.method === 'GET' && req.path === '/mt5/status';
      const bridgeToken = process.env.MT5_BRIDGE_TOKEN?.trim();
      if (machineRoute && bridgeToken && equal(req.get('authorization') ?? '', `Bearer ${bridgeToken}`)) { next(); return; }
      const user = this.requireUser(req);
      res.locals.dashboardUser = this.view(user);
      if (!['GET', 'HEAD'].includes(req.method) && !this.allowedWriteOrigin(req)) throw new AuthError(403, 'Same-origin requests only.');
      if (machineWrite) throw new AuthError(403, 'Bridge machine authentication required.');
      if (user.role === 'client') {
        const allowed = req.method === 'GET' && ['/mt5/status', '/mt5/market-data', '/tradingview/market-data', '/journal/trades'].includes(req.path)
          || req.method === 'POST' && ['/ai/chat', '/journal/trades'].includes(req.path);
        if (!allowed) throw new AuthError(403, 'This function is available only to admins.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        const target = req.path;
        const changes = target === '/mt5/config' ? Object.fromEntries([
          'enabled', 'dryRun', 'tradingTimeEnabled', 'telegramMessagesEnabled', 'scalpingEnabled',
          'intradayEnabled', 'scalpOneToOneEnabled', 'scalpOneToOneRiskPercent', 'bollingerM5Enabled', 'bollingerM5RiskPercent', 'intradayRiskPercent', 'scalpingRiskPercent', 'mtfLtfFibRequired', 'riskPercent', 'maximumOpenTrades',
          'maximumDailyLossPercent', 'maximumSpreadPoints', 'signalMaxAgeSeconds',
          'pendingExpiryMinutes', 'moveStopToBreakEvenAtR',
        ].filter(key => ['boolean', 'number'].includes(typeof req.body?.[key]))
          .map(key => [key, req.body[key]])) : undefined;
        res.once('finish', () => {
          const task = this.queue.then(async () => {
            this.audit(user.email, 'dashboard.action', target, JSON.stringify({ method: req.method, status: res.statusCode, changes }));
            await this.save();
          });
          this.queue = task.catch(() => undefined);
        });
      }
      next();
    }).catch(error => res.status(error instanceof AuthError ? error.statusCode : 503)
      .json({ ok: false, error: error instanceof AuthError ? error.message : 'Authentication service unavailable.' }));
  };
}
