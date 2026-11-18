import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestWorkerTask } from '../src/services/latestWorkerTask';

test('continuous replay advances never cancel a running scan or grow a backlog', () => {
  const sent: Array<{ taskId: number; input: number }> = [];
  const queue = new LatestWorkerTask<number>(task => sent.push(task));
  queue.submit(900);
  for (let time = 1800; time <= 9000; time += 900) queue.submit(time);
  assert.deepEqual(sent.map(task => task.input), [900]);
  assert.equal(queue.accepts(sent[0].taskId), true);
  queue.complete(sent[0].taskId);
  assert.deepEqual(sent.map(task => task.input), [900, 9000]);
  assert.equal(queue.accepts(sent[0].taskId), false);
  queue.complete(sent[0].taskId); // Late duplicate cannot release the current job.
  assert.equal(queue.accepts(sent[1].taskId), true);
  queue.complete(sent[1].taskId);
  queue.submit(9900); // A paused worker remains ready for a single step.
  assert.deepEqual(sent.map(task => task.input), [900, 9000, 9900]);
});

test('rewind replaces the pending forward scan, and disposal blocks old messages', () => {
  const sent: Array<{ taskId: number; input: number }> = [];
  const queue = new LatestWorkerTask<number>(task => sent.push(task));
  queue.submit(9000);
  queue.submit(9900);
  queue.submit(1800);
  queue.complete(sent[0].taskId);
  assert.deepEqual(sent.map(task => task.input), [9000, 1800]);
  queue.submit(2700);
  queue.dispose();
  assert.equal(queue.accepts(sent[1].taskId), false);
  queue.complete(sent[1].taskId);
  queue.submit(3600);
  assert.equal(sent.length, 2);
});
