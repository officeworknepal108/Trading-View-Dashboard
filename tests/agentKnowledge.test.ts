import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { retrieveProjectKnowledge, summarizeTradeMemory } from '../src/services/agentKnowledge';

test('retrieves MTF implementation and regression knowledge for MTF questions', async () => {
  const chunks = await retrieveProjectKnowledge('Why must LTF CHOCH overlap the HTF tapped zone?', 8);

  assert.ok(chunks.length > 0);
  assert.ok(chunks.some((chunk) => chunk.source === 'src/services/mtf.ts'));
  assert.ok(chunks.some((chunk) => chunk.source === 'tests/mtf.test.ts'));
  assert.ok(chunks.every((chunk) => chunk.startLine >= 1 && chunk.endLine >= chunk.startLine));
});

test('returns general project documentation when a question has no keyword match', async () => {
  const chunks = await retrieveProjectKnowledge(randomUUID(), 6);

  assert.ok(chunks.some((chunk) => chunk.source === 'README.md'));
});

test('summarizes approved profit, loss and breakeven memories without treating lessons as trades', () => {
  const base = { details: 'details', setupId: 'MTF-1', createdAt: '2026-10-05', approved: true as const };
  const summary = summarizeTradeMemory([
    { ...base, id: '1', type: 'trade_outcome', summary: 'winner', outcome: 'profit' },
    { ...base, id: '2', type: 'trade_outcome', summary: 'loser', outcome: 'loss' },
    { ...base, id: '3', type: 'trade_outcome', summary: 'flat', outcome: 'breakeven' },
    { ...base, id: '4', type: 'lesson', summary: 'rule', outcome: 'not_applicable' },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    profit: 1,
    loss: 1,
    breakeven: 1,
    observedProfitRate: 0.5,
  });
});
