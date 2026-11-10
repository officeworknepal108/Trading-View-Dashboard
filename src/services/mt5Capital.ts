export interface CapitalEvent {
  id: string;
  at: number;
  kind: 'initial-deposit' | 'opening-balance' | 'deposit' | 'withdrawal' | 'adjustment' | 'deposit-allocation' | 'profit-allocation';
  amount: number;
}

export interface CapitalSnapshot {
  balance: number;
  initialPrincipal: number;
  initialAt: number;
  inferredOpening: boolean;
  totalDeposits: number;
  totalWithdrawals: number;
  withdrawalCount: number;
  tradingNet: number;
  adjustments: number;
  asOf: number;
  events: CapitalEvent[];
}

export interface CapitalAccount {
  account: string;
  server: string;
  currency: string;
  snapshot: CapitalSnapshot;
  depositAllocated: number;
  profitAllocated: number;
  allocations: CapitalEvent[];
}

export interface CapitalSummary {
  principal: number;
  additionalDeposits: number;
  pendingDeposits: number;
  retainedPnl: number;
  availableProfit: number;
}

export interface CapitalView extends CapitalAccount {
  summary: CapitalSummary;
  connected: boolean;
  historyFrom: number;
}

// Calendar months, clamped to the final day rather than rolling into the next month.
export function capitalHistoryFrom(now: number): number {
  const date = new Date(now * 1000);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 2);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime() / 1000;
}

export const capitalMoney = (value: number) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;
export const capitalAccountKey = (account: string, server: string, currency: string) => JSON.stringify([account, server, currency]);

export function summarizeCapital(value: CapitalAccount): CapitalSummary {
  const s = value.snapshot;
  const additionalDeposits = capitalMoney(s.totalDeposits - s.initialPrincipal);
  const pendingDeposits = capitalMoney(additionalDeposits - value.depositAllocated);
  const retainedPnl = capitalMoney(s.tradingNet - s.totalWithdrawals - value.profitAllocated);
  return {
    principal: capitalMoney(s.initialPrincipal + value.depositAllocated + value.profitAllocated),
    additionalDeposits, pendingDeposits, retainedPnl,
    // Neither floating gains nor unsettled deposits can be capitalized as trading profit.
    availableProfit: Math.max(0, Math.min(retainedPnl, s.balance - pendingDeposits)),
  };
}

export function sanitizeCapitalSnapshot(value: unknown): CapitalSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as CapitalSnapshot;
  const fields = ['balance', 'initialPrincipal', 'initialAt', 'totalDeposits', 'totalWithdrawals',
    'withdrawalCount', 'tradingNet', 'adjustments', 'asOf'] as const;
  if (fields.some(k => typeof v[k] !== 'number' || !Number.isFinite(v[k]))
    || v.initialPrincipal < 0 || v.totalDeposits < v.initialPrincipal || v.totalWithdrawals < 0
    || !Number.isSafeInteger(v.withdrawalCount) || v.withdrawalCount < 0 || v.initialAt < 0 || v.asOf <= 0
    || Math.abs(v.balance - (v.totalDeposits - v.totalWithdrawals + v.tradingNet + v.adjustments)) > 0.02
    || !Array.isArray(v.events) || v.events.length > 100_000) return undefined;
  const seen = new Set<string>();
  const events: CapitalEvent[] = [];
  for (const e of v.events) {
    if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 100 || seen.has(e.id)
      || !['initial-deposit', 'opening-balance', 'deposit', 'withdrawal', 'adjustment'].includes(e.kind)
      || typeof e.at !== 'number' || !Number.isFinite(e.at) || e.at < 0
      || typeof e.amount !== 'number' || !Number.isFinite(e.amount)
      || (['initial-deposit', 'deposit', 'opening-balance'].includes(e.kind) && e.amount <= 0)
      || (e.kind === 'withdrawal' && e.amount >= 0)) return undefined;
    seen.add(e.id);
    events.push({ id: e.id, at: e.at, kind: e.kind, amount: e.amount });
  }
  return { ...Object.fromEntries(fields.map(k => [k, v[k]])),
    inferredOpening: v.inferredOpening === true, events } as CapitalSnapshot;
}

export function allocateCapital(value: CapitalAccount, kind: 'deposit' | 'profit', amount: number, id: string, now: number): CapitalAccount {
  // A retry with the same request ID cannot transfer money twice.
  const previous = value.allocations.find(e => e.id === id);
  if (previous) {
    if (previous.kind !== `${kind}-allocation` || previous.amount !== amount) throw new Error('This request was already used for a different allocation.');
    return value;
  }
  const summary = summarizeCapital(value);
  const available = kind === 'deposit' ? summary.pendingDeposits : summary.availableProfit;
  if (!Number.isFinite(amount) || amount <= 0 || amount > available + 1e-8) {
    throw new Error('Amount exceeds the money currently available to add to principal.');
  }
  return { ...value,
    depositAllocated: capitalMoney(value.depositAllocated + (kind === 'deposit' ? amount : 0)),
    profitAllocated: capitalMoney(value.profitAllocated + (kind === 'profit' ? amount : 0)),
    allocations: [...value.allocations.filter(e => e.at >= capitalHistoryFrom(now)),
      { id, at: now, kind: kind === 'deposit' ? 'deposit-allocation' : 'profit-allocation', amount }],
  };
}
