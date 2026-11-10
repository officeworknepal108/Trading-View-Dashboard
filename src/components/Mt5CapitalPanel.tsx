import React, { useEffect, useState } from 'react';
import type { CapitalEvent, CapitalView } from '../services/mt5Capital';

const labels: Record<CapitalEvent['kind'], string> = {
  'initial-deposit': 'Initial deposit to principal', 'opening-balance': 'Opening balance',
  deposit: 'Deposit received', withdrawal: 'Withdrawal', adjustment: 'Broker balance adjustment',
  'deposit-allocation': 'Deposit added to principal', 'profit-allocation': 'Profit added to principal',
};

export function Mt5CapitalPanel({ terminalId, compact = false, floating = 0, timeZone = 'Asia/Kathmandu' }: {
  terminalId: 'primary' | 'secondary'; compact?: boolean; floating?: number; timeZone?: string;
}) {
  const [capital, setCapital] = useState<CapitalView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [amounts, setAmounts] = useState({ deposit: '', profit: '' });
  const generation = React.useRef(0);
  const pendingRequest = React.useRef<{ signature: string; id: string } | null>(null);
  const mutationRunning = React.useRef(false);
  const readSequence = React.useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    setCapital(null); setLoading(true); setError(''); setAmounts({ deposit: '', profit: '' });
    const load = async () => {
      if (mutationRunning.current) return;
      const sequence = ++readSequence.current;
      try {
        const response = await fetch(`/api/journal/capital?terminal=${terminalId}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to load capital history.');
        if (!cancelled && sequence === readSequence.current) { setCapital(payload.capital); setError(''); }
      } catch (e) {
        if (!cancelled && sequence === readSequence.current) setError(e instanceof Error ? e.message : 'Unable to load capital history.');
      } finally { if (!cancelled) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => { if (generation.current === current) void load(); }, 5000);
    return () => { cancelled = true; generation.current++; window.clearInterval(timer); };
  }, [terminalId]);

  const money = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: /^[A-Z]{3}$/.test(capital?.currency ?? '') ? capital!.currency : 'USD',
  }).format(value);
  const date = (at: number) => at > 0 ? new Date(at * 1000).toLocaleString('en-GB', { timeZone }) : 'Date unavailable';
  const allocate = async (kind: 'deposit' | 'profit', available: number) => {
    if (!capital || mutationRunning.current) return;
    const amount = amounts[kind].trim() ? Number(amounts[kind]) : available;
    if (!Number.isFinite(amount) || amount <= 0 || amount > available + 1e-8) {
      setError('Enter an amount greater than zero and within the available amount.'); return;
    }
    const current = generation.current;
    const signature = JSON.stringify([capital.account, capital.server, capital.currency, kind, amount]);
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, id: crypto.randomUUID() };
    mutationRunning.current = true;
    ++readSequence.current;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/journal/capital/allocate?terminal=${terminalId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, amount, requestId: pendingRequest.current.id, account: capital.account,
          server: capital.server, currency: capital.currency }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to add to principal.');
      pendingRequest.current = null;
      if (generation.current === current) { setCapital(payload.capital); setAmounts(a => ({ ...a, [kind]: '' })); }
    } catch (e) {
      if (generation.current === current) setError(e instanceof Error ? e.message : 'Unable to add to principal.');
    } finally { mutationRunning.current = false; setBusy(false); }
  };

  if (loading) return <div className="p-2 text-slate-500">Loading MT5 capital…</div>;
  if (!capital) return <div className="p-2 text-amber-700">{error || 'Waiting for MT5 deposit and withdrawal history. Connect the updated bridge to import it.'}</div>;
  const { summary, snapshot } = capital;
  const rows = [...snapshot.events, ...capital.allocations].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const exportHistory = () => {
    const csv = (cells: unknown[]) => cells.map(cell => {
      const value = typeof cell === 'string' && /^[=+@\-\t\r]/.test(cell) ? `'${cell}` : String(cell);
      return `"${value.replace(/"/g, '""')}"`;
    }).join(',');
    const content = [csv(['Account', capital.account, 'Server', capital.server, 'Currency', capital.currency]),
      csv(['History from', date(capital.historyFrom), 'History to', date(Date.now() / 1000)]),
      csv(['Current principal', summary.principal, 'Retained P/L', summary.retainedPnl]),
      csv(['Original principal', snapshot.initialPrincipal, 'Original deposit date', date(snapshot.initialAt)]),
      csv(['Additional deposits', summary.additionalDeposits, 'Deposits added to principal', capital.depositAllocated]),
      csv(['Profit added to principal', capital.profitAllocated, 'Unallocated deposits', summary.pendingDeposits]),
      csv(['Total withdrawn', snapshot.totalWithdrawals, 'Withdrawal count', snapshot.withdrawalCount]),
      '', csv(['Date', 'Activity', `Amount (${capital.currency})`, 'Reference']),
      ...rows.map(row => csv([date(row.at), labels[row.kind], row.amount, row.id]))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `MT5-Withdrawals-${capital.account}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const metric = (label: string, value: string) => <div key={label} className="flex flex-wrap justify-between gap-x-2"><span>{label}</span><b>{value}</b></div>;
  return <section className={compact ? 'mb-2 rounded border border-slate-200 bg-slate-50 p-2 text-[10px] leading-relaxed text-slate-600' : 'min-h-0 flex-1 overflow-auto p-3 text-xs text-slate-700'}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-black text-slate-800">{compact ? 'Account principal & P/L' : 'Withdrawals & principal'}</h3>
      {!compact && <button type="button" onClick={exportHistory} className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 font-bold text-indigo-700">Download history (CSV)</button>}
    </div>
    {!compact && <p className="mb-3 text-slate-500">MT5 {capital.account} · {capital.server} · {capital.currency}</p>}
    <div className={compact ? 'space-y-1' : 'mb-4 grid gap-3 rounded border bg-white p-3 sm:grid-cols-2'}>
      {!compact && <>
        {metric(snapshot.inferredOpening ? 'Opening principal (before available MT5 history)' : `Original principal · ${date(snapshot.initialAt)}`, money(snapshot.initialPrincipal))}
        {metric('Additional deposits received', money(summary.additionalDeposits))}
        {metric('Deposits added to principal', money(capital.depositAllocated))}
        {metric('Profit added to principal', money(capital.profitAllocated))}
        {metric('Total withdrawn', `${money(snapshot.totalWithdrawals)} · ${snapshot.withdrawalCount} withdrawal(s)`)}
      </>}
      {metric('Current principal', money(summary.principal))}
      {metric('MT5 balance', money(snapshot.balance))}
      {metric('Unallocated deposits', money(summary.pendingDeposits))}
      <div className={summary.retainedPnl < 0 ? 'font-bold text-rose-700' : 'font-bold text-emerald-700'}>Retained P/L: {money(summary.retainedPnl)}</div>
      {compact && <>
        {metric('Floating P/L', money(floating))}
        <div className={summary.retainedPnl + floating < 0 ? 'font-black text-rose-700' : 'font-black text-emerald-700'}>Overall P/L: {money(summary.retainedPnl + floating)}</div>
      </>}
      {Math.abs(snapshot.adjustments) >= 0.005 && metric('Other broker adjustments', money(snapshot.adjustments))}
    </div>
    {!capital.connected && <p className="my-2 text-amber-700">Saved history. Waiting for fresh MT5 data; adding to principal is paused.</p>}
    {error && <p role="alert" className="my-2 text-rose-700">{error}</p>}
    <div className="my-3 space-y-2">
      {([['deposit', summary.pendingDeposits, 'Deposit'], ['profit', summary.availableProfit, 'Retained profit']] as const).map(([kind, available, label]) => available > 0.00000001 && <div key={kind} className="rounded border border-indigo-100 bg-indigo-50 p-2">
        <div className="mb-1 font-bold">{label} available: {money(available)}</div>
        <div className="flex flex-wrap gap-1">
          <input type="number" min="0" max={available} step="any" aria-label={`${label} amount to add to principal`}
            placeholder={String(available)} value={amounts[kind]} onChange={e => setAmounts(a => ({ ...a, [kind]: e.target.value }))}
            className="min-w-0 flex-1 rounded border bg-white px-2 py-1" disabled={busy || !capital.connected} />
          <button type="button" disabled={busy || !capital.connected} onClick={() => void allocate(kind, available)}
            className="rounded bg-indigo-700 px-2 py-1 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Add to principal'}</button>
        </div>
      </div>)}
    </div>
    <p className="mb-2 text-[10px] text-slate-500">Profit minus losses, fees, withdrawals and profit moved to principal. Deposits are separate.</p>
    {!compact && <>
      <p className="mb-2 text-[10px] text-slate-500">History: {date(capital.historyFrom)} – {date(Date.now() / 1000)}. Lifetime totals stay in the summary. Allocations move existing money; they do not add a second deposit.</p>
      <div className="overflow-x-auto rounded border bg-white"><table className="w-full text-left text-xs">
        <thead className="bg-slate-100"><tr><th className="p-2">Date</th><th className="p-2">Activity</th><th className="p-2 text-right">Amount</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="whitespace-nowrap p-2">{date(row.at)}</td><td className="p-2">{labels[row.kind]}</td><td className={`p-2 text-right font-bold ${row.kind === 'withdrawal' ? 'text-rose-700' : 'text-slate-700'}`}>{money(row.amount)}</td></tr>)}</tbody>
      </table>{!rows.length && <p className="p-4 text-slate-500">No funding or principal transfers in the last two months.</p>}</div>
    </>}
  </section>;
}
