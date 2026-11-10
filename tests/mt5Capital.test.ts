import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateCapital, capitalHistoryFrom, sanitizeCapitalSnapshot, summarizeCapital, type CapitalAccount } from '../src/services/mt5Capital';

const now = Date.UTC(2026, 10, 10, 12) / 1000;
function account(): CapitalAccount {
  return { account: '123', server: 'Broker', currency: 'USD', depositAllocated: 0, profitAllocated: 0, allocations: [],
    snapshot: { balance: 5220, initialPrincipal: 5000, initialAt: now - 604800, inferredOpening: false,
      totalDeposits: 5000, totalWithdrawals: 0, withdrawalCount: 0, tradingNet: 300 - 80,
      adjustments: 0, asOf: now, events: [] } };
}

test('withdrawals, retained profit and an additional deposit follow the agreed example without double counting', () => {
  let value = account();
  assert.equal(summarizeCapital(value).retainedPnl, 220);
  value.snapshot.totalWithdrawals = 150; value.snapshot.withdrawalCount = 1; value.snapshot.balance = 5070;
  assert.equal(summarizeCapital(value).retainedPnl, 70);
  value = allocateCapital(value, 'profit', 70, 'profit-example', now);
  assert.equal(summarizeCapital(value).principal, 5070);
  assert.equal(summarizeCapital(value).retainedPnl, 0);
  value.snapshot.totalDeposits += 400; value.snapshot.balance += 400;
  assert.equal(summarizeCapital(value).pendingDeposits, 400);
  assert.equal(summarizeCapital(value).retainedPnl, 0, 'funding never becomes trading profit');
  value = allocateCapital(value, 'deposit', 400, 'deposit-example', now);
  assert.deepEqual(summarizeCapital(value), {
    principal: 5470, additionalDeposits: 400, pendingDeposits: 0, retainedPnl: 0, availableProfit: 0,
  });
  assert.equal(value.snapshot.balance, 5470, 'allocating never changes the MT5 balance');
});

test('allocation supports partial amounts, retries, losses and insufficient cash', () => {
  let value = allocateCapital(account(), 'profit', 20, 'retry-example', now);
  value = allocateCapital(value, 'profit', 20, 'retry-example', now);
  assert.equal(value.profitAllocated, 20);
  assert.equal(value.allocations.length, 1);
  assert.throws(() => allocateCapital(value, 'profit', 21, 'retry-example', now), /different allocation/);
  for (const amount of [0, -1, NaN, Infinity, 201]) assert.throws(() => allocateCapital(value, 'profit', amount, 'bad-example', now));
  assert.throws(() => allocateCapital(value, 'deposit', 1, 'no-deposit', now));
  value.snapshot.tradingNet = -80;
  assert.equal(summarizeCapital(value).retainedPnl, -100, 'losses stay in net P/L');
  assert.equal(summarizeCapital(value).availableProfit, 0);
  value.snapshot.tradingNet = 220; value.snapshot.balance = 10;
  assert.equal(summarizeCapital(value).availableProfit, 10);
});

test('history expiry keeps principal totals and calendar month boundaries', () => {
  assert.equal(capitalHistoryFrom(Date.UTC(2026, 3, 30, 12) / 1000), Date.UTC(2026, 1, 28, 12) / 1000);
  let value = allocateCapital(account(), 'profit', 70, 'older-allocation', now);
  value.snapshot.tradingNet += 100;
  value = allocateCapital(value, 'profit', 100, 'new-allocation', Date.UTC(2027, 1, 10, 12) / 1000);
  assert.equal(value.allocations.length, 1);
  assert.equal(value.profitAllocated, 170);
  assert.equal(summarizeCapital(value).principal, 5170);
});

test('broker snapshots must reconcile, contain valid funding rows and reject duplicates', () => {
  const value = account().snapshot;
  assert.ok(sanitizeCapitalSnapshot(value));
  assert.equal(sanitizeCapitalSnapshot({ ...value, balance: 6000 }), undefined);
  assert.equal(sanitizeCapitalSnapshot({ ...value, totalDeposits: Infinity }), undefined);
  assert.equal(sanitizeCapitalSnapshot({ ...value, withdrawalCount: 0.5 }), undefined);
  const row = { id: 'deal-1', at: now, amount: -150, kind: 'withdrawal' };
  assert.ok(sanitizeCapitalSnapshot({ ...value, events: [row] }));
  assert.equal(sanitizeCapitalSnapshot({ ...value, events: [row, row] }), undefined);
  assert.equal(sanitizeCapitalSnapshot({ ...value, events: [{ ...row, amount: 150 }] }), undefined);
});
