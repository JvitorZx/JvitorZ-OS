import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

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

describe('Planner library API client', { concurrency: false }, () => {
  const baseUrl = 'http://localhost:4000';

  const withFetch = async (implementation, assertion) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = implementation;

    try {
      await assertion();
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  const jsonResponse = (status, payload) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  });

  test('saveMessageToLibrary posts to encoded ids without sending arbitrary content', async () => {
    const calls = [];
    const savedItem = { id: 'library-1', content: 'Conteudo persistido' };

    await withFetch(
      async (...args) => {
        calls.push(args);
        return jsonResponse(201, savedItem);
      },
      async () => {
        const api = createApiClient(baseUrl);
        const result = await api.saveMessageToLibrary('conversation/one', 'message with space');

        assert.deepEqual(result, savedItem);
        assert.equal(calls.length, 1);
        assert.equal(
          calls[0][0],
          `${baseUrl}/api/operators/planner/conversations/conversation%2Fone/messages/message%20with%20space/library`,
        );
        assert.deepEqual(calls[0][1], { method: 'POST' });
        assert.equal(Object.hasOwn(calls[0][1], 'body'), false);
      },
    );
  });

  test('saveMessageToLibrary treats an idempotent 200 response as success', async () => {
    const existingItem = { id: 'library-existing', content: 'Resposta já salva' };

    await withFetch(
      async () => jsonResponse(200, existingItem),
      async () => {
        const api = createApiClient(baseUrl);
        const result = await api.saveMessageToLibrary('conversation-1', 'message-1');

        assert.deepEqual(result, existingItem);
      },
    );
  });

  test('listLibraryItems gets and returns the persisted library list', async () => {
    const calls = [];
    const items = [{ id: 'library-2' }, { id: 'library-1' }];

    await withFetch(
      async (...args) => {
        calls.push(args);
        return jsonResponse(200, items);
      },
      async () => {
        const api = createApiClient(baseUrl);
        const result = await api.listLibraryItems();

        assert.deepEqual(result, items);
        assert.deepEqual(calls, [[`${baseUrl}/api/operators/planner/library`, undefined]]);
      },
    );
  });

  test('getLibraryItem gets an encoded id and returns the persisted item', async () => {
    const calls = [];
    const item = { id: 'library/item', content: 'Resposta' };

    await withFetch(
      async (...args) => {
        calls.push(args);
        return jsonResponse(200, item);
      },
      async () => {
        const api = createApiClient(baseUrl);
        const result = await api.getLibraryItem('library/item');

        assert.deepEqual(result, item);
        assert.deepEqual(calls, [[`${baseUrl}/api/operators/planner/library/library%2Fitem`, undefined]]);
      },
    );
  });

  test('library errors preserve safe HTTP statuses without raw responses', async (t) => {
    for (const status of [404, 409, 422]) {
      await t.test(`status ${status}`, async () => {
        await withFetch(
          async () => ({ ok: false, status }),
          async () => {
            const api = createApiClient(baseUrl);

            await assert.rejects(
              api.saveMessageToLibrary('conversation-1', 'message-1'),
              (error) =>
                error instanceof ApiRequestError
                && error.status === status
                && !Object.hasOwn(error, 'response'),
            );
          },
        );
      });
    }
  });

  test('library server errors remain safe', async () => {
    await withFetch(
      async () => ({
        ok: false,
        status: 500,
        async json() {
          return { stack: 'internal stack', prisma: 'internal query' };
        },
      }),
      async () => {
        const api = createApiClient(baseUrl);

        await assert.rejects(
          api.listLibraryItems(),
          (error) =>
            error instanceof ApiRequestError
            && error.status === 500
            && !Object.hasOwn(error, 'response')
            && !error.message.includes('internal stack')
            && !error.message.includes('internal query'),
        );
      },
    );
  });

  test('invalid library ids are rejected before network access', async (t) => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return jsonResponse(200, {});
    };

    try {
      const api = createApiClient(baseUrl);
      const cases = [
        ['conversationId', () => api.saveMessageToLibrary('  ', 'message-1')],
        ['messageId', () => api.saveMessageToLibrary('conversation-1', null)],
        ['libraryItemId', () => api.getLibraryItem(123)],
      ];

      for (const [name, request] of cases) {
        await t.test(name, async () => {
          await assert.rejects(request(), TypeError);
        });
      }

      assert.equal(callCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
