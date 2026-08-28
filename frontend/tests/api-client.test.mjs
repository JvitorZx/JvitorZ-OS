import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ApiRequestError, createApiClient } from '../src/api/client.js';

test('reach API client uses centralized status, sync, data and quality contracts', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return { ok: true, status: 200, async json() { return { state: 'GOOD' }; } }; };
  try {
    const api = createApiClient('http://localhost:4000');
    await api.getYouTubeReachStatus();
    await api.syncYouTubeReach({ startDate: '2026-08-01', endDate: '2026-08-25' });
    await api.listYouTubeReachData({ videoId: 'video/one' });
    await api.getDataQuality('project/one');
    assert.equal(calls[0][0], 'http://localhost:4000/api/operators/creator-intelligence/reach/youtube/status');
    assert.deepEqual(calls[1][1], { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"startDate":"2026-08-01","endDate":"2026-08-25"}' });
    assert.equal(calls[2][0], 'http://localhost:4000/api/operators/creator-intelligence/reach/data?videoId=video%2Fone');
    assert.equal(calls[3][0], 'http://localhost:4000/api/operators/creator-intelligence/reach/quality?projectId=project%2Fone');
  } finally { globalThis.fetch = originalFetch; }
});

test('channel operator client uses centralized encoded contracts and preserves safe status', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    if (String(args[0]).includes('/missing')) return { ok: false, status: 404 };
    return { ok: true, status: 200, async json() { return { id: 'ctr', status: 'AVAILABLE' }; } };
  };
  try {
    const api = createApiClient('http://localhost:4000');
    await api.listChannelOperators('project/one');
    await api.getChannelOperator('long-form', 'project/one');
    assert.deepEqual(calls[0], [
      'http://localhost:4000/api/operators/channel?projectId=project%2Fone',
      undefined,
    ]);
    assert.deepEqual(calls[1], [
      'http://localhost:4000/api/operators/channel/long-form?projectId=project%2Fone',
      undefined,
    ]);
    const beforeInvalid = calls.length;
    await assert.rejects(api.getChannelOperator(' '), TypeError);
    await assert.rejects(api.listChannelOperators(''), TypeError);
    assert.equal(calls.length, beforeInvalid);
    await assert.rejects(api.getChannelOperator('missing'), (error) => error instanceof ApiRequestError && error.status === 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test('outcome review API client uses explicit safe contracts and validates ids', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, status: 200, async json() { return { status: 'reviewed' }; } };
  };
  try {
    const api = createApiClient('http://localhost:4000');
    await api.listOutcomeReviewStates();
    await api.getOutcomeReviewState('outcome/1');
    await api.reviewDecisionOutcome('outcome/1');
    await api.reviewAvailableOutcomes();
    await api.listOutcomeReviews('outcome/1');
    await api.getOutcomeReviewStatus();
    assert.equal(calls[0][0], 'http://localhost:4000/api/operators/creator-intelligence/decision-outcomes/review-states');
    assert.equal(calls[1][0], 'http://localhost:4000/api/operators/creator-intelligence/decision-outcomes/outcome%2F1/review-state');
    assert.deepEqual(calls[2][1], { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(calls[3][0], 'http://localhost:4000/api/operators/creator-intelligence/decision-outcomes/review');
    assert.equal(calls[4][0], 'http://localhost:4000/api/operators/creator-intelligence/decision-outcomes/outcome%2F1/reviews');
    assert.equal(calls[5][0], 'http://localhost:4000/api/operators/creator-intelligence/decision-outcomes/review-status');
    const beforeInvalid = calls.length;
    await assert.rejects(api.getOutcomeReviewState(' '), TypeError);
    await assert.rejects(api.reviewDecisionOutcome(null), TypeError);
    await assert.rejects(api.listOutcomeReviews(42), TypeError);
    assert.equal(calls.length, beforeInvalid);
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

describe('Planner active memory API client', { concurrency: false }, () => {
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

  test('linkLibraryItemToConversation posts encoded ids without a body and accepts 201', async () => {
    const calls = [];
    const item = { id: 'library/item', content: 'Conteudo persistido' };

    await withFetch(
      async (...args) => {
        calls.push(args);
        return jsonResponse(201, item);
      },
      async () => {
        const api = createApiClient(baseUrl);
        const result = await api.linkLibraryItemToConversation(
          'conversation/with space',
          'library/item',
        );

        assert.deepEqual(result, item);
        assert.deepEqual(calls, [[
          `${baseUrl}/api/operators/planner/conversations/conversation%2Fwith%20space/library/library%2Fitem`,
          { method: 'POST' },
        ]]);
        assert.equal(Object.hasOwn(calls[0][1], 'body'), false);
      },
    );
  });

  test('linkLibraryItemToConversation accepts an idempotent 200 response', async () => {
    const existing = { id: 'library-existing' };

    await withFetch(
      async () => jsonResponse(200, existing),
      async () => {
        const api = createApiClient(baseUrl);
        assert.deepEqual(
          await api.linkLibraryItemToConversation('conversation-1', 'library-1'),
          existing,
        );
      },
    );
  });

  test('listConversationLibraryItems uses GET and preserves backend order and content', async () => {
    const calls = [];
    const items = [
      { id: 'library-2', content: 'Segundo' },
      { id: 'library-1', content: 'Primeiro' },
    ];

    await withFetch(
      async (...args) => {
        calls.push(args);
        return jsonResponse(200, items);
      },
      async () => {
        const api = createApiClient(baseUrl);
        const result = await api.listConversationLibraryItems('conversation/one');

        assert.deepEqual(result, items);
        assert.deepEqual(calls, [[
          `${baseUrl}/api/operators/planner/conversations/conversation%2Fone/library`,
          undefined,
        ]]);
      },
    );
  });

  test('unlinkLibraryItemFromConversation uses DELETE without a body and accepts 204', async () => {
    const calls = [];

    await withFetch(
      async (...args) => {
        calls.push(args);
        return { ok: true, status: 204 };
      },
      async () => {
        const api = createApiClient(baseUrl);
        const result = await api.unlinkLibraryItemFromConversation(
          'conversation/one',
          'library item',
        );

        assert.equal(result, undefined);
        assert.deepEqual(calls, [[
          `${baseUrl}/api/operators/planner/conversations/conversation%2Fone/library/library%20item`,
          { method: 'DELETE' },
        ]]);
        assert.equal(Object.hasOwn(calls[0][1], 'body'), false);
      },
    );
  });

  test('invalid active-memory identifiers fail before network access', async (t) => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return jsonResponse(200, {});
    };

    try {
      const api = createApiClient(baseUrl);
      const cases = [
        ['link empty conversationId', () => api.linkLibraryItemToConversation('', 'library-1')],
        ['link spaces libraryItemId', () => api.linkLibraryItemToConversation('conversation-1', '  ')],
        ['list null conversationId', () => api.listConversationLibraryItems(null)],
        ['list undefined conversationId', () => api.listConversationLibraryItems(undefined)],
        ['unlink numeric conversationId', () => api.unlinkLibraryItemFromConversation(123, 'library-1')],
        ['unlink null libraryItemId', () => api.unlinkLibraryItemFromConversation('conversation-1', null)],
      ];

      for (const [name, operation] of cases) {
        await t.test(name, async () => {
          await assert.rejects(operation(), TypeError);
        });
      }

      assert.equal(callCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('active-memory errors preserve safe HTTP statuses', async (t) => {
    const cases = [
      [404, (api) => api.listConversationLibraryItems('conversation-1')],
      [422, (api) => api.linkLibraryItemToConversation('conversation-1', 'library-1')],
      [500, (api) => api.unlinkLibraryItemFromConversation('conversation-1', 'library-1')],
    ];

    for (const [status, operation] of cases) {
      await t.test(`status ${status}`, async () => {
        await withFetch(
          async () => ({
            ok: false,
            status,
            async json() {
              return { stack: 'private stack', payload: 'private payload' };
            },
          }),
          async () => {
            const api = createApiClient(baseUrl);
            await assert.rejects(
              operation(api),
              (error) => error instanceof ApiRequestError
                && error.status === status
                && !Object.hasOwn(error, 'response')
                && !error.message.includes('private'),
            );
          },
        );
      });
    }
  });
});

describe('Performance Operations API client', { concurrency: false }, () => {
  const baseUrl = 'http://localhost:4000';
  const jsonResponse = (status, payload) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  });

  test('uses the centralized GET contracts for performance operations', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return jsonResponse(200, {});
    };
    try {
      const api = createApiClient(baseUrl);
      await api.getYouTubePerformanceStatus();
      await api.getYouTubeLastSync();
      await api.listPerformanceRecords();
      await api.getPerformanceBaseline();
      await api.listPerformanceSignals();
      await api.listChannelLearnings();
      await api.getCreatorIntelligenceContext();
      assert.deepEqual(calls.map(([url, options]) => [url, options]), [
        [`${baseUrl}/api/operators/creator-intelligence/performance/youtube/status`, undefined],
        [`${baseUrl}/api/operators/creator-intelligence/performance/youtube/last-sync`, undefined],
        [`${baseUrl}/api/operators/creator-intelligence/performance/records`, undefined],
        [`${baseUrl}/api/operators/creator-intelligence/performance/baseline`, undefined],
        [`${baseUrl}/api/operators/creator-intelligence/performance/signals`, undefined],
        [`${baseUrl}/api/operators/creator-intelligence/learnings`, undefined],
        [`${baseUrl}/api/operators/creator-intelligence/context`, undefined],
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('posts only the explicit synchronization input', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return jsonResponse(200, { created: 1, updated: 0 });
    };
    try {
      const api = createApiClient(baseUrl);
      const input = {
        mode: 'recent', startDate: '2026-08-01', endDate: '2026-08-24', limit: 10,
      };
      assert.deepEqual(await api.syncYouTubePerformance(input), { created: 1, updated: 0 });
      assert.equal(calls[0][0], `${baseUrl}/api/operators/creator-intelligence/performance/youtube/sync`);
      assert.deepEqual(calls[0][1], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      assert.ok(!calls[0][1].body.includes('token'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('opens decision evidence by encoded persisted id', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return jsonResponse(200, { id: 'decision/one' });
    };
    try {
      const api = createApiClient(baseUrl);
      await api.getDecisionEvidence('decision/one');
      assert.deepEqual(calls, [[
        `${baseUrl}/api/operators/creator-intelligence/decisions/decision%2Fone/evidence`,
        undefined,
      ]]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('preserves expected performance HTTP statuses without raw responses', async (t) => {
    const originalFetch = globalThis.fetch;
    try {
      for (const status of [400, 401, 404, 429, 500, 503]) {
        await t.test(`status ${status}`, async () => {
          globalThis.fetch = async () => ({
            ok: false,
            status,
            async json() { return { access_token: 'must-not-be-read', stack: 'private' }; },
          });
          const api = createApiClient(baseUrl);
          await assert.rejects(
            api.syncYouTubePerformance({ mode: 'period' }),
            (error) => error instanceof ApiRequestError
              && error.status === status
              && !Object.hasOwn(error, 'response')
              && !error.message.includes('private'),
          );
        });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects invalid synchronization input and decision ids before network', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return jsonResponse(200, {}); };
    try {
      const api = createApiClient(baseUrl);
      await assert.rejects(api.syncYouTubePerformance(null), TypeError);
      await assert.rejects(api.syncYouTubePerformance([]), TypeError);
      await assert.rejects(api.getDecisionEvidence('  '), TypeError);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('dashboard errors use the safe request error contract', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    try {
      const api = createApiClient(baseUrl);
      await assert.rejects(
        api.getDashboard(),
        (error) => error instanceof ApiRequestError
          && error.status === 500
          && !error.message.includes('stack'),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Editorial Decision API client', { concurrency: false }, () => {
  const baseUrl = 'http://localhost:4000';
  const response = (status, payload) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  });

  test('uses centralized contracts for generation, history, opening and outcome', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return response(200, { id: 'decision/1' });
    };
    try {
      const api = createApiClient(baseUrl);
      await api.generateEditorialDecision({ question: 'O que vale gravar?' });
      await api.listEditorialDecisions({ conversationId: 'conversation/1', limit: 5 });
      await api.getEditorialDecision('decision/1');
      await api.registerEditorialDecisionOutcome('decision/1', 'snapshot/1');
      assert.equal(calls[0][0], `${baseUrl}/api/operators/creator-intelligence/editorial-decisions`);
      assert.deepEqual(calls[0][1], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'O que vale gravar?' }),
      });
      assert.equal(calls[1][0], `${baseUrl}/api/operators/creator-intelligence/editorial-decisions?conversationId=conversation%2F1&limit=5`);
      assert.equal(calls[2][0], `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/decision%2F1`);
      assert.deepEqual(calls[3], [
        `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/decision%2F1/outcome`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ snapshotId: 'snapshot/1' }),
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects invalid editorial parameters before network and preserves safe status', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return response(409, { stack: 'private', token: 'must-not-be-read' });
    };
    try {
      const api = createApiClient(baseUrl);
      await assert.rejects(api.generateEditorialDecision(null), TypeError);
      await assert.rejects(api.listEditorialDecisions({ limit: 0 }), TypeError);
      await assert.rejects(api.getEditorialDecision(' '), TypeError);
      await assert.rejects(api.registerEditorialDecisionOutcome('decision', ''), TypeError);
      assert.equal(calls, 0);
      await assert.rejects(
        api.registerEditorialDecisionOutcome('decision', 'snapshot'),
        (error) => error instanceof ApiRequestError
          && error.status === 409
          && !error.message.includes('private'),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses centralized decision outcome loop contracts with encoded identifiers', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      const status = args[1]?.method === 'POST' ? 201 : args[1]?.method === 'DELETE' ? 204 : 200;
      return response(status, { id: 'outcome/1' });
    };
    try {
      const api = createApiClient(baseUrl);
      await api.linkEditorialDecisionVideo('decision/1', { snapshotId: 'snapshot/1', origin: 'manual' });
      await api.listEditorialDecisionVideos('decision/1');
      await api.unlinkEditorialDecisionVideo('decision/1', 'link/1');
      await api.evaluateEditorialDecisionOutcome('decision/1', 'link/1');
      await api.listEditorialDecisionOutcomes('decision/1');
      await api.listDecisionOutcomes({ conversationId: 'conversation/1', videoId: 'video/1', limit: 8 });
      await api.getDecisionOutcome('outcome/1');

      assert.deepEqual(calls[0], [
        `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/decision%2F1/videos`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ snapshotId: 'snapshot/1', origin: 'manual' }),
        },
      ]);
      assert.deepEqual(calls[1], [
        `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/decision%2F1/videos`,
        undefined,
      ]);
      assert.deepEqual(calls[2], [
        `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/decision%2F1/videos/link%2F1`,
        { method: 'DELETE' },
      ]);
      assert.deepEqual(calls[3], [
        `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/decision%2F1/videos/link%2F1/outcomes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      ]);
      assert.equal(calls[4][0], `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/decision%2F1/outcomes`);
      assert.equal(calls[5][0], `${baseUrl}/api/operators/creator-intelligence/decision-outcomes?conversationId=conversation%2F1&videoId=video%2F1&limit=8`);
      assert.equal(calls[6][0], `${baseUrl}/api/operators/creator-intelligence/decision-outcomes/outcome%2F1`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects invalid decision outcome loop input before network access', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return response(200, {}); };
    try {
      const api = createApiClient(baseUrl);
      await assert.rejects(api.linkEditorialDecisionVideo('', { snapshotId: 'snapshot' }), TypeError);
      await assert.rejects(api.linkEditorialDecisionVideo('decision', { snapshotId: '' }), TypeError);
      await assert.rejects(api.unlinkEditorialDecisionVideo('decision', null), TypeError);
      await assert.rejects(api.evaluateEditorialDecisionOutcome('decision', ' '), TypeError);
      await assert.rejects(api.listDecisionOutcomes({ limit: 0 }), TypeError);
      await assert.rejects(api.listDecisionOutcomes({ unknown: 'ignored', projectId: '' }), TypeError);
      await assert.rejects(api.getDecisionOutcome(23), TypeError);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
