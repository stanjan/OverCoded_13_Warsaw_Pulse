import test from 'node:test';
import assert from 'node:assert/strict';
import { JobPool } from './job-pool.mjs';

test('concurrent slots, FIFO queue, and idempotent release', async () => {
  const pool = new JobPool({ concurrency: 2, maxQueue: 2 });
  const a = await pool.acquire();
  const b = await pool.acquire();
  assert.equal(pool.active, 2);
  const order = [];
  const c = pool.acquire().then(release => { order.push('c'); return release; });
  const d = pool.acquire().then(release => { order.push('d'); return release; });
  await assert.rejects(pool.acquire(), { statusCode: 429 });
  a(); a();
  const releaseC = await c;
  assert.deepEqual(order, ['c']);
  assert.equal(pool.active, 2);
  b();
  const releaseD = await d;
  assert.deepEqual(order, ['c', 'd']);
  releaseC(); releaseD();
  assert.equal(pool.active, 0);
});

test('cancelled and timed-out waiting requests never acquire a slot', async () => {
  const pool = new JobPool({ concurrency: 1, waitMs: 20 });
  const release = await pool.acquire();
  const controller = new AbortController();
  const waiting = pool.acquire(controller.signal);
  controller.abort();
  await assert.rejects(waiting, { statusCode: 499 });
  await assert.rejects(pool.acquire(), { statusCode: 429 });
  assert.equal(pool.queue.length, 0);
  assert.equal(pool.active, 1);
  release();
  assert.equal(pool.active, 0);
});
