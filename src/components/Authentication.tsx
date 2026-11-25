import React, { useEffect, useId, useState } from 'react';
import type { DashboardUser } from '../services/authTypes';
import './Authentication.css';

export async function authRequest(route: string, body?: unknown, method = 'POST') {
  const response = await fetch(`/api/auth${route}`, {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: 'same-origin', cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Request failed.');
  return payload;
}

function PasswordField({ label, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return <div style={{ margin: '16px 0' }}>
    <label htmlFor={id} style={{ margin: '0 0 7px' }}>{label}</label>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input {...props} id={id} type={visible ? 'text' : 'password'} style={{ minWidth: 0, flex: 1 }} />
      <button type="button" aria-controls={id} aria-pressed={visible}
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        onClick={() => setVisible(value => !value)} style={{ padding: '8px', whiteSpace: 'nowrap' }}>
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  </div>;
}

export function LoginPanel({ onLogin }: { onLogin: (user: DashboardUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [clientOnly, setClientOnly] = useState(false);
  useEffect(() => {
    void authRequest('/config').then(config => {
      setSetupRequired(config.ownerSetupRequired === true);
      setClientOnly(config.clientOnly === true);
    })
      .catch(() => setError('Unable to reach the login service. Please retry.'));
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await authRequest('/login', { username, password });
      setPassword(''); onLogin(result.user);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="auth-page"><section className="auth-card">
    <div className="auth-brand">TRADING DASHBOARD</div>
    <h1>{clientOnly ? 'Client sign in' : 'Sign in'}</h1>
    <p className="auth-muted">Use the username and password assigned to you.</p>
    {setupRequired && <p className="auth-notice">The owner must finish the private local account setup before managing users.</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <form onSubmit={submit}>
      <label>Username<input required autoComplete="username" autoCapitalize="none" spellCheck={false}
        minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} /></label>
      <PasswordField label="Password" required autoComplete="current-password" maxLength={128}
        value={password} onChange={e => setPassword(e.target.value)} />
      <button className="auth-primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
    </form>
    <p className="auth-footer">For a new account or password reset, contact your admin. Client accounts can be used on one browser/device at a time. Signing in elsewhere signs out the previous device.</p>
  </section></div>;
}

function AccountCredentials({ member, busy, onSave }: {
  member: DashboardUser; busy: boolean;
  onSave: (changes: Record<string, unknown>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(member.username ?? '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  return <div>
    <button disabled={busy} onClick={() => { setOpen(value => !value); setPassword(''); setConfirmation(''); setError(''); }}>
      {open ? 'Cancel login change' : member.credentialsReady ? 'Edit login / reset password' : 'Set username and password'}
    </button>
    {open && <form onSubmit={async event => {
      event.preventDefault(); setError('');
      if (password !== confirmation) { setError('Passwords do not match.'); return; }
      if (await onSave({ username, ...(password ? { password } : {}) })) {
        setPassword(''); setConfirmation(''); setOpen(false);
      }
    }}>
      <label>Username<input required autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32}
        value={username} onChange={e => setUsername(e.target.value)} /></label>
      <PasswordField label={member.credentialsReady ? 'New password (leave blank to keep)' : 'Password'}
        required={!member.credentialsReady} autoComplete="new-password" minLength={12} maxLength={128}
        value={password} onChange={e => setPassword(e.target.value)} />
      <PasswordField label="Confirm password" required={!!password} autoComplete="new-password" maxLength={128}
        value={confirmation} onChange={e => setConfirmation(e.target.value)} />
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>Save login</button>
    </form>}
  </div>;
}

function adminExpiryValue(expiresAt?: number) {
  return expiresAt === undefined ? ''
    : new Date(expiresAt - new Date(expiresAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function AdminExpiryControl({ member, busy, onSave }: {
  member: DashboardUser;
  busy: boolean;
  onSave: (expiresAt: number | null) => Promise<boolean>;
}) {
  const [noExpiry, setNoExpiry] = useState(member.expiresAt === undefined);
  const [date, setDate] = useState(adminExpiryValue(member.expiresAt));
  useEffect(() => {
    setNoExpiry(member.expiresAt === undefined);
    setDate(adminExpiryValue(member.expiresAt));
  }, [member.expiresAt]);
  const save = async (expiresAt: number | null) => {
    if (!await onSave(expiresAt)) {
      setNoExpiry(member.expiresAt === undefined);
      setDate(adminExpiryValue(member.expiresAt));
    }
  };
  return <div className="space-y-2">
    <select aria-label={`Expiry option for ${member.email}`} disabled={busy} value={noExpiry ? 'none' : 'date'}
      onChange={e => {
        const selected = e.target.value === 'none';
        setNoExpiry(selected);
        if (selected) {
          setDate('');
          if (member.expiresAt !== undefined) void save(null);
        }
      }}>
      <option value="none">No expiry</option>
      <option value="date">Set expiry date</option>
    </select>
    {!noExpiry && <input aria-label={`Access expiry for ${member.email}`} type="datetime-local" value={date}
      disabled={busy} onChange={e => setDate(e.target.value)}
      onBlur={() => {
        if (!noExpiry && date && date !== adminExpiryValue(member.expiresAt)) void save(new Date(date).getTime());
      }} />}
    {!noExpiry && !date && <small role="status">Choose a date to save.</small>}
  </div>;
}

export function UserManagement({ user }: { user: DashboardUser }) {
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [activity, setActivity] = useState<{ id: string; actor: string; action: string; target?: string; at: number; details?: string }[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [role, setRole] = useState<'client' | 'admin'>('client');
  const [expires, setExpires] = useState('');
  const [adminNoExpiry, setAdminNoExpiry] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const [members, log] = await Promise.all([authRequest('/users'), authRequest('/activity')]);
    setUsers(members.users); setActivity(log.activity);
  };
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  const update = async (id: string, changes: Record<string, unknown>) => {
    setBusy(true); setError('');
    try { await authRequest(`/users/${encodeURIComponent(id)}`, changes, 'PATCH'); await refresh(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const deleteUser = async (id: string) => {
    setBusy(true); setError('');
    try { await authRequest(`/users/${encodeURIComponent(id)}`, {}, 'DELETE'); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    if (password !== confirmation) { setError('Passwords do not match.'); setBusy(false); return; }
    try {
      await authRequest('/users', { username, password, role, expiresAt: role === 'admin' && adminNoExpiry
        ? null : expires ? new Date(expires).getTime() : null });
      setUsername(''); setPassword(''); setConfirmation(''); setExpires(''); setAdminNoExpiry(true); await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="auth-management">
    <h1>{user.role === 'super_admin' ? 'User Management' : 'Client Management'}</h1>
    <p className="auth-muted">Manage approved access, suspensions, and expiry dates. Every change is recorded.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <form className="auth-create" onSubmit={create}>
      <label>Username<input required autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} /></label>
      <PasswordField label="Password" required autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} />
      <PasswordField label="Confirm password" required autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} />
      {user.role === 'super_admin' && <label>Role<select value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="client">Client</option><option value="admin">Admin</option></select></label>}
      {role === 'admin' && <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={adminNoExpiry} style={{ width: 16, height: 16, padding: 0 }}
          onChange={e => { setAdminNoExpiry(e.target.checked); if (e.target.checked) setExpires(''); }} />
        No expiry
      </label>}
      {(role !== 'admin' || !adminNoExpiry) && <label>{role === 'admin' ? 'Access expires' : 'Access expires (optional)'}<input type="datetime-local"
        required={role === 'admin'} value={expires} onChange={e => setExpires(e.target.value)} /></label>}
      <button className="auth-primary" disabled={busy}>Add {role}</button>
    </form>
    <div className="auth-table-wrap"><table><thead><tr><th>Account</th><th>Role / status</th><th>Approved by</th><th>Expiry</th><th>Actions</th></tr></thead>
      <tbody>{users.map(member => <tr key={member.id}>
        <td>{member.username ?? member.email}<small>{member.credentialsReady ? 'Username/password ready' : 'Login credentials need setup'}</small></td>
        <td>{member.role.replace('_', ' ')}<small>{member.accessMessage}</small></td>
        <td>{member.approvedBy ?? '—'}<small>{member.approvedAt ? new Date(member.approvedAt).toLocaleString() : ''}</small></td>
        <td>{member.role === 'super_admin' ? 'No expiry' : member.role === 'admin'
          ? <AdminExpiryControl member={member} busy={busy} onSave={expiresAt => update(member.id, { expiresAt })} />
          : <input key={`${member.id}:${member.expiresAt ?? 'none'}`} aria-label={`Access expiry for ${member.email}`} type="datetime-local"
          defaultValue={member.expiresAt ? new Date(member.expiresAt - new Date(member.expiresAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ''}
          onBlur={e => {
            const next = e.target.value ? new Date(e.target.value).getTime() : null;
            if (next !== (member.expiresAt ?? null)) void update(member.id, { expiresAt: next });
          }} />}</td>
        <td>{member.role !== 'super_admin' && <div className="auth-actions">
          <AccountCredentials member={member} busy={busy} onSave={changes => update(member.id, changes)} />
          <button disabled={busy} onClick={() => void update(member.id, { status: 'approved' })}>{member.status === 'approved' ? 'Renew approval' : 'Approve / restore'}</button>
          <button disabled={busy} onClick={() => void update(member.id, { status: 'suspended' })}>Suspend</button>
          <button disabled={busy} onClick={() => void update(member.id, { status: 'removed' })}>Remove access</button>
          <button disabled={busy} onClick={() => void deleteUser(member.id)} title="Delete this login account and revoke its sessions">Delete user</button>
          {user.role === 'super_admin' && <button disabled={busy} onClick={() => void update(member.id, { role: member.role === 'admin' ? 'client' : 'admin' })}>{member.role === 'admin' ? 'Remove admin role' : 'Make admin'}</button>}
        </div>}</td>
      </tr>)}</tbody></table></div>
    <h2>{user.role === 'super_admin' ? 'All activity' : 'Your activity'}</h2>
    <button className="auth-refresh" onClick={() => void refresh().catch(e => setError(e.message))}>Refresh users and activity</button>
    <div className="auth-table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target / details</th></tr></thead><tbody>
      {activity.map(item => <tr key={item.id}><td>{new Date(item.at).toLocaleString()}</td><td>{item.actor}</td><td>{item.action}</td><td>{item.target}<small>{item.details}</small></td></tr>)}
    </tbody></table></div>
  </section>;
}
