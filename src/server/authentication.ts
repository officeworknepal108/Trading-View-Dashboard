import express from 'express';
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DashboardUser, UserRole, AccessState } from '../services/authTypes';

const SUPER_EMAIL = 'tradingviewfx108@gmail.com';
const SESSION_COOKIE = 'dashboard_session';
const CHALLENGE_COOKIE = 'dashboard_verification';
const GOOGLE_COOKIE = 'dashboard_google';
const MINUTE = 60_000;
const SESSION_LIFETIME = 30 * 24 * 60 * MINUTE;
const LEGACY_SESSION_LIFETIME = 8 * 60 * MINUTE;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
};

export function normalizeLoginEmail(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (raw.length > 254) throw new AuthError(400, 'Use a valid Gmail address.');
  const match = raw.match(/^([a-z0-9.+]+)@(gmail\.com|googlemail\.com)$/);
  if (!match) throw new AuthError(400, 'Use a valid Gmail address.');
  const local = match[1].split('+')[0].replace(/\./g, '');
  if (!local) throw new AuthError(400, 'Use a valid Gmail address.');
  return `${local}@gmail.com`;
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new AuthError(400, 'Use a dashboard password between 12 and 128 characters.');
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

interface User extends Omit<DashboardUser, 'canAccess' | 'accessMessage'> {
  passwordHash?: string;
  googleSubject?: string;
}
interface Session { digest: string; userId: string; expiresAt: number; verifiedAt?: number }
interface Challenge {
  digest: string; userId: string; codeHash: string; expiresAt: number; attempts: number;
  sentAt: number; passwordHash?: string;
  googleAuthenticated?: boolean;
}
interface Audit { id: string; at: number; actor: string; action: string; target?: string; details?: string }
interface Store {
  users: User[]; sessions: Session[]; challenges: Challenge[];
  resets: { digest: string; userId: string; expiresAt: number }[];
  oauth: { digest: string; verifier: string; expiresAt: number }[];
  audit: Audit[];
}
export class AuthError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
interface Identity { email: string; subject: string; verified: boolean }
export interface AuthOptions {
  directory?: string;
  publicUrl?: string;
  now?: () => number;
  sendEmail?: (to: string, subject: string, text: string) => Promise<void>;
  googleIdentity?: (code: string, verifier: string, redirectUri: string) => Promise<Identity>;
}

export class DashboardAuth {
  readonly router = express.Router();
  readonly origin: string;
  private store!: Store;
  private ready: Promise<void>;
  private file: string;
  private now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private rates = new Map<string, { count: number; until: number }>();
  private mail: NonNullable<AuthOptions['sendEmail']>;
  private identity: NonNullable<AuthOptions['googleIdentity']>;

  constructor(options: AuthOptions = {}) {
    this.origin = new URL(options.publicUrl ?? process.env.AUTH_PUBLIC_URL ?? 'http://127.0.0.1:3002').origin;
    if (!this.origin.startsWith('https:') && !['127.0.0.1', 'localhost'].includes(new URL(this.origin).hostname)) {
      throw new Error('AUTH_PUBLIC_URL must use HTTPS outside localhost.');
    }
    this.file = path.join(options.directory ?? path.resolve('.dashboard-auth'), 'accounts.json');
    this.now = options.now ?? Date.now;
    this.mail = options.sendEmail ?? sendAuthEmail;
    this.identity = options.googleIdentity ?? googleIdentity;
    this.ready = this.load();
    this.routes();
  }

  private async load() {
    try { this.store = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.store = { users: [], sessions: [], challenges: [], resets: [], oauth: [], audit: [] };
    }
  }
  private async save() {
    const now = this.now();
    this.store.sessions = this.store.sessions.filter(s => s.expiresAt > now);
    this.store.challenges = this.store.challenges.filter(s => s.expiresAt > now);
    this.store.resets = this.store.resets.filter(s => s.expiresAt > now);
    this.store.oauth = this.store.oauth.filter(s => s.expiresAt > now);
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
      const task = this.queue.then(async () => {
        await this.ready;
        return handler(req, res);
      });
      this.queue = task.catch(() => undefined);
      void task.catch(error => {
        if (!res.headersSent) res.status(error instanceof AuthError ? error.statusCode : 503)
          .json({ ok: false, error: error instanceof AuthError ? error.message : 'Authentication service unavailable. Try again shortly.' });
      });
    };
  }
  private cookieOptions() {
    return { httpOnly: true, secure: this.origin.startsWith('https:'), sameSite: 'lax' as const, path: '/' };
  }
  private cookie(req: express.Request, name: string) {
    return (req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
  }
  private limit(key: string, maximum = 8, duration = 15 * MINUTE) {
    const now = this.now();
    if (this.rates.size > 10_000) for (const [name, value] of this.rates) if (value.until <= now) this.rates.delete(name);
    const entry = this.rates.get(key);
    if (entry && entry.until > now) {
      if (entry.count >= maximum) throw new AuthError(429, 'Too many attempts. Please wait 15 minutes before trying again.');
      entry.count++;
    } else this.rates.set(key, { count: 1, until: now + duration });
  }
  private limitRequest(req: express.Request, action: string, email?: string) {
    this.limit(`${action}:ip:${req.ip}`, 30);
    if (email) this.limit(`${action}:email:${email}`, 8);
  }
  private view(user: User): DashboardUser {
    const expired = user.expiresAt !== undefined && user.expiresAt <= this.now();
    const canAccess = user.verified && user.status === 'approved' && !expired;
    const accessMessage = user.status === 'pending' ? 'Waiting for admin approval.'
      : user.status === 'suspended' ? 'Your access is suspended. Contact an admin.'
      : user.status === 'removed' ? 'Your access has been removed. Contact an admin.'
      : expired ? 'Your access has expired. Contact an admin to renew it.'
      : !user.verified ? 'Verify your email to continue.' : 'Access approved.';
    const { passwordHash: _password, googleSubject: _subject, ...safe } = user;
    return { ...safe, canAccess, accessMessage };
  }
  private findSession(req: express.Request): User | undefined {
    const session = this.store.sessions.find(s => s.digest === hash(this.cookie(req, SESSION_COOKIE)) && s.expiresAt > this.now());
    return session && this.store.users.find(u => u.id === session.userId);
  }
  private requireUser(req: express.Request, admin = false, superOnly = false): User {
    const user = this.findSession(req);
    if (!user) throw new AuthError(401, 'Please sign in.');
    if (!this.view(user).canAccess) throw new AuthError(403, this.view(user).accessMessage);
    if (admin && user.role === 'client' || superOnly && user.role !== 'super_admin') throw new AuthError(403, 'You do not have permission for this action.');
    return user;
  }
  private invalidate(userId: string) {
    this.store.sessions = this.store.sessions.filter(s => s.userId !== userId);
    this.store.challenges = this.store.challenges.filter(s => s.userId !== userId);
    this.store.resets = this.store.resets.filter(s => s.userId !== userId);
  }
  private issueSession(res: express.Response, user: User) {
    const raw = secret();
    const verifiedAt = this.now();
    this.store.sessions.push({ digest: hash(raw), userId: user.id, verifiedAt, expiresAt: verifiedAt + SESSION_LIFETIME });
    res.cookie(SESSION_COOKIE, raw, { ...this.cookieOptions(), maxAge: SESSION_LIFETIME });
  }
  private async challenge(res: express.Response, user: User, passwordHash?: string, googleAuthenticated = false) {
    const previous = this.store.challenges.find(c => c.userId === user.id);
    if (previous && previous.sentAt + MINUTE > this.now()) throw new AuthError(429, 'Wait one minute before requesting another code.');
    const raw = secret();
    const code = String(randomInt(100_000, 1_000_000));
    await this.mail(user.email, 'Your dashboard verification code', `Your verification code is ${code}. It expires in 5 minutes and can be used once. If you did not request it, ignore this email.`);
    this.store.challenges = this.store.challenges.filter(c => c.userId !== user.id);
    this.store.challenges.push({ digest: hash(raw), userId: user.id, codeHash: hash(`${raw}:${code}`),
      expiresAt: this.now() + 5 * MINUTE, sentAt: this.now(), attempts: 0, passwordHash, googleAuthenticated });
    res.cookie(CHALLENGE_COOKIE, raw, { ...this.cookieOptions(), maxAge: 5 * MINUTE });
    await this.save();
  }
  private newUser(email: string): User {
    const user: User = { id: secret(), email, role: 'client', status: 'pending', verified: false, createdAt: this.now() };
    this.store.users.push(user);
    return user;
  }

  private routes() {
    this.router.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== this.origin) {
        res.status(403).json({ ok: false, error: 'Same-origin requests only.' }); return;
      }
      next();
    });
    this.router.get('/config', (_req, res) => res.json({ ok: true,
      googleReady: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      emailReady: !!process.env.AUTH_EMAIL_FROM && !!process.env.RESEND_API_KEY,
      codeMinutes: 5, resetMinutes: 15 }));
    this.router.get('/me', this.run(async (req, res) => {
      const user = this.findSession(req);
      if (user?.verified) {
        const raw = this.cookie(req, SESSION_COOKIE);
        const session = this.store.sessions.find(s => s.digest === hash(raw) && s.expiresAt > this.now())!;
        // Upgrade an already verified legacy session without asking for another code.
        // Polling retains the original deadline; it never starts a new 30-day period.
        if (session.verifiedAt === undefined) {
          session.verifiedAt = Math.min(this.now(), session.expiresAt - LEGACY_SESSION_LIFETIME);
          session.expiresAt = session.verifiedAt + SESSION_LIFETIME;
          await this.save();
        }
        res.cookie(SESSION_COOKIE, raw, { ...this.cookieOptions(), maxAge: session.expiresAt - this.now() });
      }
      res.json({ ok: true, user: user ? this.view(user) : null });
    }));
    this.router.post('/register', this.run(async (req, res) => {
      this.limitRequest(req, 'register');
      const email = normalizeLoginEmail(req.body?.email);
      this.limit(`email-send:${email}`, 5);
      if (email === SUPER_EMAIL) throw new AuthError(403, 'Admins must sign in with Google.');
      let user = this.store.users.find(u => u.email === email);
      if (user && user.role !== 'client') throw new AuthError(403, 'Admins must sign in with Google.');
      if (user?.verified) throw new AuthError(400, 'Use sign in or Forgot Password for this account.');
      const passwordHash = await hashPassword(req.body?.password);
      user ??= this.newUser(email);
      await this.challenge(res, user, passwordHash);
      res.json({ ok: true, verificationRequired: true });
    }));
    this.router.post('/login', this.run(async (req, res) => {
      this.limitRequest(req, 'login');
      const email = normalizeLoginEmail(req.body?.email);
      this.limit(`login:email:${email}`);
      const user = this.store.users.find(u => u.email === email);
      const valid = await passwordMatches(req.body?.password, user?.passwordHash);
      if (!user || !valid || !user.verified) throw new AuthError(401, 'Email or dashboard password is incorrect.');
      if (user.role !== 'client' || email === SUPER_EMAIL) throw new AuthError(403, 'Admins must sign in with Google.');
      this.limit(`email-send:${email}`, 5);
      await this.challenge(res, user);
      res.json({ ok: true, verificationRequired: true });
    }));
    this.router.post('/verify', this.run(async (req, res) => {
      this.limitRequest(req, 'verify');
      const raw = this.cookie(req, CHALLENGE_COOKIE);
      const challenge = this.store.challenges.find(c => c.digest === hash(raw));
      if (!challenge || challenge.expiresAt <= this.now()) throw new AuthError(400, 'The code expired. Please sign in again for a new code.');
      challenge.attempts++;
      const valid = challenge.attempts <= 5 && typeof req.body?.code === 'string'
        && equal(challenge.codeHash, hash(`${raw}:${req.body.code}`));
      if (!valid) {
        if (challenge.attempts >= 5) this.store.challenges = this.store.challenges.filter(c => c !== challenge);
        await this.save();
        throw new AuthError(400, challenge.attempts >= 5 ? 'Too many incorrect codes. Sign in again.' : 'Incorrect verification code.');
      }
      const user = this.store.users.find(u => u.id === challenge.userId)!;
      if (user.email === SUPER_EMAIL) {
        if (!challenge.googleAuthenticated) {
          this.store.challenges = this.store.challenges.filter(c => c !== challenge);
          await this.save();
          throw new AuthError(403, 'The super admin must sign in with Google and verify the new email code.');
        }
        // Complete the handover only after both Google and the email code succeed.
        // The previous owner stays active until this point, then loses all sessions.
        const previousOwners = this.store.users.filter(candidate => candidate.role === 'super_admin' && candidate.id !== user.id);
        const ownershipChanged = user.role !== 'super_admin' || user.status !== 'approved' || previousOwners.length > 0;
        for (const previous of previousOwners) {
          previous.role = 'client';
          previous.status = 'removed';
          previous.passwordHash = undefined;
          this.invalidate(previous.id);
          this.audit(user.email, 'ownership.transferred', previous.email, `New super admin: ${user.email}`);
        }
        user.role = 'super_admin';
        user.status = 'approved';
        user.expiresAt = undefined;
        user.passwordHash = undefined;
        if (ownershipChanged) this.invalidate(user.id);
      }
      user.verified = true;
      if (challenge.passwordHash) user.passwordHash = challenge.passwordHash;
      this.store.challenges = this.store.challenges.filter(c => c !== challenge);
      this.issueSession(res, user);
      res.clearCookie(CHALLENGE_COOKIE, this.cookieOptions());
      this.audit(user.email, 'login.verified', user.email);
      await this.save();
      res.json({ ok: true, user: this.view(user) });
    }));
    this.router.post('/resend', this.run(async (req, res) => {
      this.limitRequest(req, 'resend');
      const old = this.store.challenges.find(c => c.digest === hash(this.cookie(req, CHALLENGE_COOKIE)));
      if (!old || old.expiresAt <= this.now()) throw new AuthError(400, 'Please sign in again for a new code.');
      const user = this.store.users.find(u => u.id === old.userId)!;
      this.limit(`email-send:${user.email}`, 5);
      await this.challenge(res, user, old.passwordHash, old.googleAuthenticated);
      res.json({ ok: true });
    }));
    this.router.post('/forgot-password', this.run(async (req, res) => {
      this.limitRequest(req, 'reset');
      const email = normalizeLoginEmail(req.body?.email);
      this.limit(`email-send:${email}`, 5);
      const user = this.store.users.find(u => u.email === email && u.role === 'client' && u.verified);
      if (user && user.email !== SUPER_EMAIL) {
        const raw = secret();
        await this.mail(email, 'Reset your dashboard password', `Reset your dashboard password using this link:\n${this.origin}/#reset=${raw}\n\nThis link expires in 15 minutes and can be used once. Your Google password is not changed.`);
        this.store.resets = this.store.resets.filter(r => r.userId !== user.id);
        this.store.resets.push({ digest: hash(raw), userId: user.id, expiresAt: this.now() + 15 * MINUTE });
        await this.save();
      }
      res.json({ ok: true, message: 'If this Gmail has an eligible account, a reset link has been sent.' });
    }));
    this.router.post('/reset-password', this.run(async (req, res) => {
      this.limitRequest(req, 'reset-confirm');
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      const reset = this.store.resets.find(r => r.digest === hash(token) && r.expiresAt > this.now());
      const user = reset && this.store.users.find(u => u.id === reset.userId && u.role === 'client' && u.email !== SUPER_EMAIL);
      if (!user) throw new AuthError(400, 'The reset link is invalid or expired. Request a new one.');
      user.passwordHash = await hashPassword(req.body?.password);
      this.invalidate(user.id);
      this.audit(user.email, 'password.reset', user.email);
      await this.save();
      res.clearCookie(SESSION_COOKIE, this.cookieOptions());
      res.json({ ok: true, message: 'Password reset. Sign in with your new dashboard password.' });
    }));
    this.router.post('/logout', this.run(async (req, res) => {
      const digest = hash(this.cookie(req, SESSION_COOKIE));
      this.store.sessions = this.store.sessions.filter(s => s.digest !== digest);
      res.clearCookie(SESSION_COOKIE, this.cookieOptions());
      res.clearCookie(CHALLENGE_COOKIE, this.cookieOptions());
      await this.save();
      res.json({ ok: true });
    }));
    this.router.get('/google', this.run(async (req, res) => {
      this.limitRequest(req, 'google');
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new AuthError(503, 'Google sign-in needs server configuration.');
      const state = secret();
      const verifier = secret();
      this.store.oauth.push({ digest: hash(state), verifier, expiresAt: this.now() + 10 * MINUTE });
      res.cookie(GOOGLE_COOKIE, state, { ...this.cookieOptions(), maxAge: 10 * MINUTE });
      await this.save();
      const query = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: `${this.origin}/api/auth/google/callback`, response_type: 'code', scope: 'openid email',
        state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
      res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`);
    }));
    this.router.get('/google/callback', this.run(async (req, res) => {
      try {
        this.limitRequest(req, 'google-callback');
        const state = typeof req.query.state === 'string' ? req.query.state : '';
        const flow = this.store.oauth.find(o => o.digest === hash(state) && o.expiresAt > this.now());
        if (!state || !equal(state, this.cookie(req, GOOGLE_COOKIE)) || !flow || typeof req.query.code !== 'string') {
          throw new AuthError(400, 'Google sign-in expired or could not be verified. Try again.');
        }
        this.store.oauth = this.store.oauth.filter(o => o !== flow);
        await this.save();
        const identity = await this.identity(req.query.code, flow.verifier, `${this.origin}/api/auth/google/callback`);
        if (!identity.verified || !identity.subject) throw new AuthError(403, 'Google did not verify this email.');
        const email = normalizeLoginEmail(identity.email);
        let user = this.store.users.find(u => u.googleSubject === identity.subject || u.email === email);
        if (user?.googleSubject && user.googleSubject !== identity.subject || user && user.email !== email) {
          throw new AuthError(403, 'This Google identity does not match the registered account.');
        }
        user ??= this.newUser(email);
        user.googleSubject = identity.subject;
        this.limit(`email-send:${email}`, 5);
        await this.challenge(res, user, undefined, true);
        res.clearCookie(GOOGLE_COOKIE, this.cookieOptions());
        res.redirect('/?auth=verify');
      } catch (error) {
        res.clearCookie(GOOGLE_COOKIE, this.cookieOptions());
        const message = error instanceof AuthError ? error.message : 'Google sign-in or verification email failed. Please try again.';
        res.redirect(`/?auth_error=${encodeURIComponent(message)}`);
      }
    }));
    this.router.get('/users', this.run((req, res) => {
      const actor = this.requireUser(req, true);
      res.json({ ok: true, users: this.store.users.filter(u => actor.role === 'super_admin' || u.role === 'client').map(u => this.view(u)) });
    }));
    this.router.post('/users', this.run(async (req, res) => {
      const actor = this.requireUser(req, true);
      const email = normalizeLoginEmail(req.body?.email);
      const role: UserRole = req.body?.role === 'admin' ? 'admin' : 'client';
      if (role === 'admin' && actor.role !== 'super_admin') throw new AuthError(403, 'Only the super admin can create admins.');
      if (email === SUPER_EMAIL) throw new AuthError(403, 'The super admin account is protected.');
      const existing = this.store.users.find(u => u.email === email);
      if (existing) throw new AuthError(409, 'This user already exists. Update their existing account.');
      const user = this.newUser(email);
      user.role = role;
      user.status = 'approved';
      user.approvedBy = actor.email;
      user.approvedAt = this.now();
      user.expiresAt = this.expiry(req.body?.expiresAt);
      this.audit(actor.email, 'user.created', email, role);
      await this.save();
      res.status(201).json({ ok: true, user: this.view(user) });
    }));
    this.router.patch('/users/:id', this.run(async (req, res) => {
      const actor = this.requireUser(req, true);
      const user = this.store.users.find(u => u.id === req.params.id);
      if (!user) throw new AuthError(404, 'User not found.');
      if (user.email === SUPER_EMAIL || user.role === 'super_admin') throw new AuthError(403, 'The super admin account is protected.');
      if (actor.role !== 'super_admin' && (user.role !== 'client' || req.body?.role !== undefined)) {
        throw new AuthError(403, 'Only the super admin can manage admins.');
      }
      const status: AccessState | undefined = req.body?.status;
      if (status !== undefined && !['approved', 'pending', 'suspended', 'removed'].includes(status)) throw new AuthError(400, 'Invalid access status.');
      if (req.body?.role !== undefined && !['admin', 'client'].includes(req.body.role)) throw new AuthError(400, 'Invalid role.');
      if (req.body?.expiresAt !== undefined) user.expiresAt = this.expiry(req.body.expiresAt);
      if (req.body?.role !== undefined) { user.role = req.body.role; user.passwordHash = undefined; }
      if (status !== undefined) user.status = status;
      if (status === 'approved') { user.approvedBy = actor.email; user.approvedAt = this.now(); }
      this.invalidate(user.id);
      this.audit(actor.email, 'user.updated', user.email, JSON.stringify({ role: user.role, status: user.status, expiresAt: user.expiresAt ?? null }));
      await this.save();
      res.json({ ok: true, user: this.view(user) });
    }));
    this.router.get('/activity', this.run((req, res) => {
      const actor = this.requireUser(req, true);
      res.json({ ok: true, activity: this.store.audit.filter(a => actor.role === 'super_admin' || a.actor === actor.email).slice(-500).reverse() });
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
      const machineWrite = (req.method === 'POST' && (/^\/mt5\/(heartbeat|market-data|signals\/claim)$/.test(req.path)
        || /^\/mt5\/signals\/[^/]+\/status$/.test(req.path)));
      // The existing Python bridge reads status to synchronize its execution config.
      const machineRoute = machineWrite || req.method === 'GET' && req.path === '/mt5/status';
      const bridgeToken = process.env.MT5_BRIDGE_TOKEN?.trim();
      if (machineRoute && bridgeToken && equal(req.get('authorization') ?? '', `Bearer ${bridgeToken}`)) { next(); return; }
      const user = this.requireUser(req);
      res.locals.dashboardUser = this.view(user);
      if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== this.origin) throw new AuthError(403, 'Same-origin requests only.');
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
          'intradayEnabled', 'mtfLtfFibRequired', 'riskPercent', 'maximumOpenTrades',
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

async function sendAuthEmail(to: string, subject: string, text: string) {
  if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) throw new Error('Email delivery is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: [to], subject, text }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Unable to send verification email.');
}
async function googleIdentity(code: string, verifier: string, redirectUri: string): Promise<Identity> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, code_verifier: verifier, client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Google token exchange failed.');
  const token = await response.json() as { access_token?: string; token_type?: string };
  if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer') throw new Error('Google token missing.');
  const infoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!infoResponse.ok) throw new Error('Google identity check failed.');
  const info = await infoResponse.json() as { email?: string; sub?: string; email_verified?: boolean };
  return { email: info.email ?? '', subject: info.sub ?? '', verified: info.email_verified === true };
}
