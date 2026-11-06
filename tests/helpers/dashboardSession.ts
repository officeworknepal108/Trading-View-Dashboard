import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Seed a real session in an isolated test workspace; production auth stays enabled.
export async function seedDashboardSession(workspace: string, now = Date.now()) {
  const raw = 'isolated-dashboard-test-session';
  await mkdir(path.join(workspace, '.dashboard-auth'), { recursive: true });
  await writeFile(path.join(workspace, '.dashboard-auth', 'accounts.json'), JSON.stringify({
    users: [
      { id: 'test-admin', email: 'testadmin@gmail.com', role: 'admin', status: 'approved', verified: true, createdAt: now },
      { id: 'test-client', email: 'testclient@gmail.com', role: 'client', status: 'approved', verified: true, createdAt: now },
    ],
    sessions: [
      { userId: 'test-admin', digest: createHash('sha256').update(raw).digest('hex'), expiresAt: now + 365 * 86_400_000 },
      { userId: 'test-client', digest: createHash('sha256').update('isolated-client-test-session').digest('hex'), expiresAt: now + 365 * 86_400_000 },
    ],
    challenges: [], resets: [], oauth: [], audit: [],
  }));
  return `dashboard_session=${raw}`;
}
