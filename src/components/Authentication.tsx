import React, { useEffect, useState } from 'react';
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

export function LoginPanel({ onLogin }: { onLogin: (user: DashboardUser) => void }) {
  const query = new URLSearchParams(window.location.search);
  const resetToken = new URLSearchParams(window.location.hash.slice(1)).get('reset');
  const [role, setRole] = useState<'admin' | 'client'>('client');
  const [screen, setScreen] = useState<'login' | 'register' | 'forgot' | 'reset' | 'verify'>(
    resetToken ? 'reset' : query.get('auth') === 'verify' ? 'verify' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(query.get('auth_error') ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{ googleReady: boolean; emailReady: boolean } | null>(null);
  useEffect(() => {
    void authRequest('/config').then(setConfig).catch(() => setError('Unable to reach the login service.'));
    if (query.has('auth') || query.has('auth_error')) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const changeScreen = (next: typeof screen) => {
    setScreen(next); setError(''); setMessage(''); setPassword(''); setConfirmation('');
    if (next !== 'reset') window.history.replaceState(null, '', window.location.pathname);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if ((screen === 'register' || screen === 'reset') && password !== confirmation) throw new Error('The passwords do not match.');
      if (screen === 'verify') {
        const result = await authRequest('/verify', { code });
        onLogin(result.user); return;
      }
      if (screen === 'forgot') {
        const result = await authRequest('/forgot-password', { email }); setMessage(result.message); return;
      }
      if (screen === 'reset') {
        const result = await authRequest('/reset-password', { token: resetToken, password });
        changeScreen('login'); setMessage(result.message); return;
      }
      await authRequest(screen === 'register' ? '/register' : '/login', { email, password });
      setPassword(''); setConfirmation(''); setScreen('verify');
      setMessage('A verification code has been sent to your Gmail. It expires in 5 minutes.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    setBusy(true); setError('');
    try { await authRequest('/resend', {}); setCode(''); setMessage('A new code has been sent. It expires in 5 minutes.'); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const title = screen === 'verify' ? 'Check your Gmail' : screen === 'forgot' ? 'Reset your password'
    : screen === 'reset' ? 'Choose a new password' : screen === 'register' ? 'Request client access' : 'Welcome to your dashboard';
  return <div className="auth-page"><section className="auth-card">
    <div className="auth-brand">TRADING DASHBOARD</div>
    <h1>{title}</h1>
    <p className="auth-muted">Secure access for your trading workspace</p>
    {screen === 'login' && <div className="auth-tabs">
      <button className={role === 'admin' ? 'selected' : ''} onClick={() => { setRole('admin'); setError(''); }}>Admin Login</button>
      <button className={role === 'client' ? 'selected' : ''} onClick={() => { setRole('client'); setError(''); }}>Client Login</button>
    </div>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p className="auth-message" role="status">{message}</p>}
    {config && (!config.emailReady || !config.googleReady) && <p className="auth-notice">
      The owner must finish {(!config.googleReady && !config.emailReady) ? 'Google sign-in and verification email' : !config.emailReady ? 'verification email' : 'Google sign-in'} setup before those login options can be used.
    </p>}
    {(screen === 'login' || screen === 'register') && <>
      <a className={`auth-google ${!config?.googleReady || !config?.emailReady ? 'unavailable' : ''}`}
        href={config?.googleReady && config?.emailReady ? '/api/auth/google' : undefined}
        aria-disabled={!config?.googleReady || !config?.emailReady}>
        <span aria-hidden="true">G</span> Sign in with Google
      </a>
      {role === 'admin' && screen === 'login' && <p className="auth-muted">Admins and the super admin use Google sign-in, followed by an email verification code.</p>}
      {(role === 'client' || screen === 'register') && <div className="auth-divider">or use your dashboard password</div>}
    </>}
    {(screen !== 'login' || role === 'client') && <form onSubmit={submit}>
      {!['verify', 'reset'].includes(screen) && <label>Gmail address<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@gmail.com" /></label>}
      {!['verify', 'forgot'].includes(screen) && <label>{screen === 'reset' ? 'New dashboard password' : 'Dashboard password'}
        <input required type="password" autoComplete={screen === 'login' ? 'current-password' : 'new-password'}
          minLength={screen === 'login' ? undefined : 12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} />
      </label>}
      {['register', 'reset'].includes(screen) && <label>Confirm dashboard password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
      {screen === 'verify' && <label>6-digit verification code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
        <small>Expires 5 minutes after it was sent. Each code works once.</small></label>}
      <button className="auth-primary" disabled={busy || (screen !== 'reset' && !config?.emailReady)}>
        {busy ? 'Please wait…' : screen === 'verify' ? 'Verify and continue' : screen === 'register' ? 'Verify email and request access'
          : screen === 'forgot' ? 'Send reset link' : screen === 'reset' ? 'Save new password' : 'Sign in'}
      </button>
    </form>}
    <div className="auth-links">
      {screen === 'login' && role === 'client' && <><button onClick={() => changeScreen('forgot')}>Forgot Password?</button><button onClick={() => changeScreen('register')}>Request access</button></>}
      {screen === 'verify' && <button disabled={busy} onClick={() => void resend()}>Send a new code</button>}
      {screen !== 'login' && <button onClick={() => changeScreen('login')}>Back to login</button>}
    </div>
    <p className="auth-footer">After verification, this browser stays signed in for 30 days unless you sign out. Client access requires admin approval. Your dashboard password is separate from your Google password.</p>
  </section></div>;
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
  const [email, setEmail] = useState('');
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
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await authRequest('/users', { email, role, expiresAt: role === 'admin' && adminNoExpiry
        ? null : expires ? new Date(expires).getTime() : null });
      setEmail(''); setExpires(''); setAdminNoExpiry(true); await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="auth-management">
    <h1>{user.role === 'super_admin' ? 'User Management' : 'Client Management'}</h1>
    <p className="auth-muted">Manage approved access, suspensions, and expiry dates. Every change is recorded.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <form className="auth-create" onSubmit={create}>
      <label>Gmail address<input required type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
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
        <td>{member.email}<small>{member.verified ? 'Email verified' : 'Email verification required'}</small></td>
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
          <button disabled={busy} onClick={() => void update(member.id, { status: 'approved' })}>{member.status === 'approved' ? 'Renew approval' : 'Approve / restore'}</button>
          <button disabled={busy} onClick={() => void update(member.id, { status: 'suspended' })}>Suspend</button>
          <button disabled={busy} onClick={() => void update(member.id, { status: 'removed' })}>Remove access</button>
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
