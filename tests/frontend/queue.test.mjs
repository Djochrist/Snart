import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSyncRunner, syncPending } from '../../frontend/js/queue.js';

function memoryQueue(items) {
  const data = new Map(items.map((item) => [item.client_id, item]));
  return {
    data,
    list: async () => [...data.values()],
    put: async (item) => { data.set(item.client_id, item); },
    remove: async (clientId) => { data.delete(clientId); },
  };
}

const item = (client_id, extra = {}) => ({ client_id, sync_state: 'pending', ...extra });
const isRetryable = (error) => error.retryable === true;
const failure = (retryable) => Object.assign(new Error(retryable ? 'réseau' : 'refusé'), { retryable });

test('un élément n’est retiré qu’après le succès du serveur', async () => {
  const queue = memoryQueue([item('a'), item('b')]);
  const sent = [];
  const result = await syncPending({ queue, isRetryable, send: async (entry) => { sent.push(entry.client_id); return { id: 1 }; } });
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(queue.data.size, 0);
  assert.equal(result.sent.length, 2);
});

test('une panne réseau garde l’élément et interrompt la synchronisation', async () => {
  const queue = memoryQueue([item('a'), item('b')]);
  const sent = [];
  const result = await syncPending({
    queue,
    isRetryable,
    send: async (entry) => { sent.push(entry.client_id); throw failure(true); },
  });
  assert.deepEqual(sent, ['a']);
  assert.equal(queue.data.size, 2);
  assert.equal(queue.data.get('a').sync_state, 'pending');
  assert.equal(result.interrupted, true);
});

test('un refus 4xx garde l’élément, l’explique et laisse passer les suivants', async () => {
  const queue = memoryQueue([item('a'), item('b')]);
  const result = await syncPending({
    queue,
    isRetryable,
    send: async (entry) => {
      if (entry.client_id === 'a') throw failure(false);
      return { id: 2 };
    },
  });
  assert.equal(queue.data.get('a').sync_state, 'rejected');
  assert.equal(queue.data.get('a').last_error, 'refusé');
  assert.equal(queue.data.has('b'), false);
  assert.equal(result.rejected.length, 1);
});

test('un élément refusé n’est pas renvoyé en boucle', async () => {
  const queue = memoryQueue([item('a', { sync_state: 'rejected' })]);
  let calls = 0;
  await syncPending({ queue, isRetryable, send: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(queue.data.size, 1);
});

test('deux synchronisations simultanées n’en font qu’une', async () => {
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sync = createSyncRunner(async () => { runs += 1; await gate; });
  const first = sync();
  const second = sync();
  release();
  await Promise.all([first, second]);
  assert.equal(runs, 1);
  await sync();
  assert.equal(runs, 2);
});
