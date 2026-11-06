import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, LayoutDashboard, LogOut, UserRound, Users } from 'lucide-react';
import { OandaProChart } from './components/OandaProChart';
import { LoginPanel, UserManagement, authRequest } from './components/Authentication';
import type { DashboardUser } from './services/authTypes';
import { selectUserStorage } from './services/userStorage';

export default function App() {
  const [terminalId, setTerminalId] = useState<'primary' | 'secondary'>('primary');
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<'chart' | 'users'>('chart');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const acceptUser = (next: DashboardUser | null) => {
    selectUserStorage(next?.id ?? 'signed-out');
    setUser(next);
  };
  useEffect(() => {
    const refresh = async () => {
      try { const result = await authRequest('/me'); acceptUser(result.user); setError(''); }
      catch { acceptUser(null); setError('Unable to verify your session. Please try signing in again.'); }
      finally { setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false);
        accountMenuRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountMenuOpen]);
  const navigate = (next: 'chart' | 'users') => {
    setPage(next);
    setAccountMenuOpen(false);
  };
  const logout = async () => {
    setAccountMenuOpen(false);
    try { await authRequest('/logout', {}); acceptUser(null); setPage('chart'); setTerminalId('primary'); }
    catch { setError('Sign out failed. Please try again.'); }
  };
  if (loading) return <div className="auth-page">Checking your session…</div>;
  if (!user) return <LoginPanel onLogin={next => { acceptUser(next); setPage('chart'); }} />;
  if (!user.canAccess) return <div className="auth-page"><section className="auth-card">
    <div className="auth-brand">TRADING DASHBOARD</div><h1>Account access</h1>
    <p>{user.email}</p><p className="auth-notice">{user.accessMessage}</p>
    <p className="auth-muted">An admin can review your access. This page updates automatically.</p>
    <button className="auth-primary" onClick={() => void logout()}>Sign out</button>
  </section></div>;
  return <div className="flex h-dvh w-full flex-col overflow-hidden bg-slate-100 text-slate-900">
    <header className="relative z-[90] flex h-8 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-4">
      <span className="truncate text-[10px] font-semibold text-slate-500">
        {error ? <span role="alert" className="text-rose-700">{error}</span>
          : page === 'chart' ? 'Trading dashboard' : user.role === 'super_admin' ? 'User Management' : 'Client Management'}
      </span>
      <div ref={accountMenuRef} className="relative ml-3 shrink-0">
        <button type="button" aria-label="Account menu" aria-expanded={accountMenuOpen} aria-controls="account-menu"
          onClick={() => setAccountMenuOpen(open => !open)}
          className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500">
          <UserRound size={13} aria-hidden="true" /> Account
          <ChevronDown size={12} aria-hidden="true" className={accountMenuOpen ? 'rotate-180' : ''} />
        </button>
        {accountMenuOpen && <nav id="account-menu" aria-label="Account options"
          className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw_-_24px)] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <div className="mb-1 border-b border-slate-100 px-2.5 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-indigo-700">{user.role.replace('_', ' ')}</div>
            <div className="mt-1 break-all text-xs text-slate-500">{user.email}</div>
          </div>
          <button type="button" aria-current={page === 'chart' ? 'page' : undefined} onClick={() => navigate('chart')}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${page === 'chart' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}>
            <LayoutDashboard size={14} aria-hidden="true" /> Trading dashboard
          </button>
          {user.role !== 'client' && <button type="button" aria-current={page === 'users' ? 'page' : undefined} onClick={() => navigate('users')}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${page === 'users' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}>
            <Users size={14} aria-hidden="true" /> {user.role === 'super_admin' ? 'User Management' : 'Client Management'}
          </button>}
          <div className="mt-1 border-t border-slate-100 pt-1">
            <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-rose-700 hover:bg-rose-50">
              <LogOut size={14} aria-hidden="true" /> Sign out
            </button>
          </div>
        </nav>}
      </div>
    </header>
    <main className="auth-workspace min-h-0 w-full">
      {page === 'users' && user.role !== 'client' ? <UserManagement user={user} />
        : <OandaProChart key={`${user.id}:${terminalId}`} terminalId={terminalId} onTerminalChange={setTerminalId} userRole={user.role} />}
    </main>
  </div>;
}
