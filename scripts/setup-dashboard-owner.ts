import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

// This prompt sends credentials only to the running local server. Never put a
// password in command arguments, environment variables, or terminal history.
async function masked(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Use an interactive local terminal.');
  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    process.stdout.write(label);
    input.setRawMode(true); input.setEncoding('utf8'); input.resume();
    const finish = (error?: Error) => {
      input.setRawMode(false); input.pause(); input.off('data', onData);
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (keys: string) => {
      for (const key of keys) {
        if (key === '\u0003') { finish(new Error('Cancelled.')); return; }
        if (key === '\r' || key === '\n') { finish(); return; }
        if (key === '\u007f' || key === '\b') {
          if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
        } else if (key >= ' ' && value.length < 128) { value += key; process.stdout.write('*'); }
      }
    };
    input.on('data', onData);
  });
}

try {
  if (!process.stdin.isTTY) throw new Error('Use an interactive local terminal.');
  const setup = JSON.parse(await readFile('.dashboard-auth/owner-setup.json', 'utf8'));
  const target = new URL(setup.url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('Setup must use the local dashboard server.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const username = await prompt.question('Super-admin username: ');
  prompt.close();
  const password = await masked('Password (12–128 characters): ');
  const confirmation = await masked('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match. Run setup again.');
  const response = await fetch(new URL('/api/auth/owner-setup', target), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: setup.origin, Authorization: `Bearer ${setup.token}` },
    body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Setup failed.');
  process.stdout.write('Super-admin login created. Sign in to the dashboard with your new username and password.\n');
} catch (error) {
  process.stderr.write((error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
    ? 'Start the updated dashboard server first. Owner setup is available only until owner credentials are created.'
    : error instanceof Error ? error.message : 'Setup failed.') + '\n');
  process.exitCode = 1;
}
