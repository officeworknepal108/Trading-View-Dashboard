import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const configPath = path.join(root, 'code-lock.config.json');
const stateDir = path.join(root, '.code-lock');
const secretsPath = path.join(stateDir, 'secrets.json');
const sessionPath = path.join(stateDir, 'unlocked.json');
const iterations = 310_000;

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const config = readJson(configPath);
if (!config) {
  console.error('Code lock configuration is missing or invalid.');
  process.exit(2);
}

const scopeNames = Object.keys(config.scopes);
const normalize = (value) => value.replaceAll('\\', '/').replace(/^\.\//, '');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const ensureStateDir = () => fs.mkdirSync(stateDir, { recursive: true });

const derive = (password, salt) => crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const promptSecret = (label) => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY) {
    reject(new Error('A real terminal is required so the password is not passed in command history.'));
    return;
  }

  let value = '';
  const stdin = process.stdin;
  process.stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  const finish = (error) => {
    stdin.setRawMode(false);
    stdin.pause();
    stdin.removeListener('data', onData);
    process.stdout.write('\n');
    if (error) reject(error);
    else resolve(value);
  };

  const onData = (key) => {
    if (key === '\u0003') return finish(new Error('Cancelled.'));
    if (key === '\r' || key === '\n') return finish();
    if (key === '\u007f' || key === '\b') {
      if (value.length > 0) {
        value = value.slice(0, -1);
        process.stdout.write('\b \b');
      }
      return;
    }
    if (/^[\x20-\x7E]+$/.test(key)) {
      value += key;
      process.stdout.write('*'.repeat(key.length));
    }
  };

  stdin.on('data', onData);
});

const requireScope = (scope) => {
  if (!scopeNames.includes(scope)) {
    throw new Error(`Unknown lock "${scope}". Use: ${scopeNames.join(', ')}.`);
  }
};

const ownersFor = (file) => {
  const normalized = normalize(file);
  const owners = new Set();
  for (const rule of config.rules) {
    if (rule.paths.some((item) => normalize(item) === normalized)) {
      rule.owners.forEach((owner) => owners.add(owner));
    }
  }
  return [...owners];
};

const protectedPaths = () => [...new Set(config.rules.flatMap((rule) => rule.paths.map(normalize)))];

const setReadOnly = (relativePath, readOnly) => {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  if (process.platform === 'win32') {
    execFileSync('attrib.exe', [readOnly ? '+R' : '-R', absolutePath], { windowsHide: true });
    return;
  }
  const currentMode = fs.statSync(absolutePath).mode;
  fs.chmodSync(absolutePath, readOnly ? currentMode & ~0o222 : currentMode | 0o200);
};

const applyFileProtection = (sessions) => {
  for (const protectedPath of protectedPaths()) {
    const owners = ownersFor(protectedPath);
    const fullyAuthorized = owners.every((owner) => sessions[owner]);
    setReadOnly(protectedPath, !fullyAuthorized);
  }
};

const activeSessions = () => {
  const sessions = readJson(sessionPath, {});
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(sessions).filter(([scope, expiresAt]) => scopeNames.includes(scope) && Number(expiresAt) > now),
  );
};

const saveSessions = (sessions) => {
  ensureStateDir();
  fs.writeFileSync(sessionPath, `${JSON.stringify(sessions, null, 2)}\n`, { mode: 0o600 });
};

const changedFiles = (stagedOnly) => {
  const commands = stagedOnly
    ? [['diff', '--cached', '--name-only', '--diff-filter=ACMR']]
    : [
        ['diff', '--name-only', '--diff-filter=ACMR'],
        ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
        ['ls-files', '--others', '--exclude-standard'],
      ];
  const files = new Set();
  for (const args of commands) {
    const output = git(...args);
    if (output) output.split(/\r?\n/).filter(Boolean).map(normalize).forEach((file) => files.add(file));
  }
  return [...files];
};

const command = process.argv[2] ?? 'status';
const argument = process.argv[3];

try {
  if (command === 'setup') {
    if (fs.existsSync(secretsPath)) {
      throw new Error('Passwords are already configured. The existing lock setup was not replaced.');
    }

    ensureStateDir();
    const records = {};
    console.log('Create three separate local passwords. They are masked and never saved in GitHub.');
    for (const scope of scopeNames) {
      const password = await promptSecret(`${scope.toUpperCase()} password: `);
      if (password.length < 8) throw new Error(`${scope.toUpperCase()} password must contain at least 8 characters.`);
      const confirmation = await promptSecret(`Confirm ${scope.toUpperCase()} password: `);
      if (password !== confirmation) throw new Error(`${scope.toUpperCase()} passwords did not match.`);
      const salt = crypto.randomBytes(16).toString('hex');
      records[scope] = { salt, hash: derive(password, salt), iterations };
    }
    fs.writeFileSync(secretsPath, `${JSON.stringify({ version: 1, scopes: records }, null, 2)}\n`, { mode: 0o600 });
    saveSessions({});
    git('config', 'core.hooksPath', '.githooks');
    applyFileProtection({});
    console.log('All three locks are configured and currently LOCKED.');
    process.exit(0);
  }

  if (command === 'unlock') {
    requireScope(argument);
    const secrets = readJson(secretsPath);
    if (!secrets?.scopes?.[argument]) throw new Error('Locks are not configured. Run: npm run lock:setup');
    const password = await promptSecret(`${argument.toUpperCase()} password: `);
    const record = secrets.scopes[argument];
    const candidate = derive(password, record.salt);
    if (!safeEqual(candidate, record.hash)) throw new Error('Incorrect password. Nothing was unlocked.');
    const sessions = activeSessions();
    sessions[argument] = Date.now() + Number(config.unlockMinutes) * 60_000;
    saveSessions(sessions);
    applyFileProtection(sessions);
    console.log(`${argument.toUpperCase()} unlocked for ${config.unlockMinutes} minutes or until the next commit.`);
    process.exit(0);
  }

  if (command === 'lock') {
    const sessions = activeSessions();
    if (!argument || argument === 'all') {
      saveSessions({});
      applyFileProtection({});
      if (!process.argv.includes('--quiet')) console.log('Gold, Forex, and Shared are LOCKED.');
    } else {
      requireScope(argument);
      delete sessions[argument];
      saveSessions(sessions);
      applyFileProtection(sessions);
      if (!process.argv.includes('--quiet')) console.log(`${argument.toUpperCase()} is LOCKED.`);
    }
    process.exit(0);
  }

  if (command === 'status') {
    const configured = readJson(secretsPath);
    const sessions = activeSessions();
    if (configured) applyFileProtection(sessions);
    console.log(`Password setup: ${configured ? 'configured' : 'NOT CONFIGURED'}`);
    for (const scope of scopeNames) {
      const expiresAt = sessions[scope];
      console.log(`${scope.padEnd(6)}: ${expiresAt ? `UNLOCKED until ${new Date(expiresAt).toLocaleString()}` : 'LOCKED'}`);
    }
    process.exit(0);
  }

  if (command === 'check') {
    const stagedOnly = process.argv.includes('--staged');
    const files = changedFiles(stagedOnly);
    const protectedFiles = files.map((file) => ({ file, owners: ownersFor(file) })).filter((item) => item.owners.length > 0);
    if (protectedFiles.length === 0) {
      console.log('Code lock check passed: no protected files changed.');
      process.exit(0);
    }

    const secrets = readJson(secretsPath);
    const configTracked = (() => {
      try {
        git('cat-file', '-e', 'HEAD:code-lock.config.json');
        return true;
      } catch {
        return false;
      }
    })();
    const bootstrapFiles = new Set([
      'scripts/code-lock.mjs', 'code-lock.config.json', '.githooks/pre-commit', '.githooks/post-commit',
      'AGENTS.md', 'CODE_LOCKS.md', 'package.json', 'package-lock.json', '.gitignore',
    ]);
    if (!secrets && !configTracked && protectedFiles.every(({ file }) => bootstrapFiles.has(file))) {
      console.log('Code lock bootstrap check passed. Run npm run lock:setup immediately after installing it.');
      process.exit(0);
    }
    if (!secrets) throw new Error('Protected code changed while passwords are not configured. Run: npm run lock:setup');

    const sessions = activeSessions();
    applyFileProtection(sessions);
    const violations = protectedFiles
      .map(({ file, owners }) => ({ file, missing: owners.filter((owner) => !sessions[owner]) }))
      .filter(({ missing }) => missing.length > 0);
    if (violations.length > 0) {
      console.error('CODE LOCK BLOCKED these protected changes:');
      for (const violation of violations) console.error(`  ${violation.file} (unlock: ${violation.missing.join(', ')})`);
      console.error('Unlock only the named section(s), then try again.');
      process.exit(1);
    }
    console.log(`Code lock check passed for ${protectedFiles.length} protected file(s).`);
    process.exit(0);
  }

  throw new Error('Usage: code-lock.mjs setup | status | unlock <scope> | lock [scope|all] | check [--staged]');
} catch (error) {
  console.error(`Code lock error: ${error.message}`);
  process.exit(1);
}
