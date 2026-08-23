import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiRequestError, createApiClient } from '../src/api/client.js';

test('generatePlannerReply posts once to the encoded conversation endpoint without a body', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return {
      ok: true,
      status: 201,
      async json() {
        return { id: 'reply-1', sender: 'operator', text: 'Resposta' };
      },
    };
  };

  try {
    const api = createApiClient('http://localhost:4000');
    const reply = await api.generatePlannerReply('conversation/with space');

    assert.equal(reply.id, 'reply-1');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0][0],
      'http://localhost:4000/api/operators/planner/conversations/conversation%2Fwith%20space/reply',
    );
    assert.deepEqual(calls[0][1], { method: 'POST' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generatePlannerReply exposes only a safe HTTP status on non-success responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });

  try {
    const api = createApiClient('http://localhost:4000');

    await assert.rejects(
      api.generatePlannerReply('A'),
      (error) =>
        error instanceof ApiRequestError
        && error.status === 503
        && !Object.hasOwn(error, 'response'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
