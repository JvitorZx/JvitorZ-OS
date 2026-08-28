const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const express = require('express');
const { createReachRouter } = require('../dist/routes/reach');
const { YouTubeReachNotAuthorizedError, YouTubeReachTemporaryError } = require('../dist/integrations/youtube/YouTubeReachErrors');

let server; let baseUrl;
const service = {
  getStatus: async () => ({ state: 'waiting_for_report', quality: { state: 'MISSING' } }),
  list: async () => [{ id: 'reach' }], getQuality: async () => ({ state: 'GOOD' }),
  sync: async (input) => ({ state: input.projectId === 'wait' ? 'waiting_for_report' : 'synchronized', created: 1 }),
};
before(async () => {
  const app = express(); app.use(express.json()); app.use(createReachRouter(service));
  server = await new Promise((resolve) => { const active = app.listen(0, '127.0.0.1', () => resolve(active)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));
const request = async (path, options) => { const response = await fetch(`${baseUrl}${path}`, options); return { status: response.status, body: await response.json() }; };

describe('reach HTTP contracts', () => {
  test('exposes status, data and quality', async () => {
    assert.equal((await request('/youtube/status')).status, 200); assert.equal((await request('/data?videoId=video-a')).body[0].id, 'reach'); assert.equal((await request('/quality')).body.state, 'GOOD');
  });
  test('returns 200 for available reports and 202 while waiting', async () => {
    const options = (projectId) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: '2026-08-01', endDate: '2026-08-25', ...(projectId ? { projectId } : {}) }) });
    assert.equal((await request('/youtube/sync', options())).status, 200); assert.equal((await request('/youtube/sync', options('wait'))).status, 202);
  });
  test('rejects unsupported fields and invalid queries', async () => {
    assert.equal((await request('/youtube/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: '2026-08-01', endDate: '2026-08-25', secret: true }) })).status, 400);
    assert.equal((await request('/data?unexpected=true')).status, 400);
  });
  test('maps authorization and provider errors without details', async () => {
    const app = express(); app.use(express.json()); app.use(createReachRouter({ ...service, sync: async ({ projectId }) => { if (projectId === 'auth') throw new YouTubeReachNotAuthorizedError(); throw new YouTubeReachTemporaryError(); } }));
    const local = await new Promise((resolve) => { const active = app.listen(0, '127.0.0.1', () => resolve(active)); });
    try {
      const send = async (projectId) => { const response = await fetch(`http://127.0.0.1:${local.address().port}/youtube/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: '2026-08-01', endDate: '2026-08-25', projectId }) }); return { status: response.status, body: await response.json() }; };
      const auth = await send('auth'); const failure = await send('failure');
      assert.equal(auth.status, 401); assert.equal(failure.status, 503); assert.doesNotMatch(JSON.stringify([auth.body, failure.body]), /stack|token|secret|Prisma/i);
    } finally { await new Promise((resolve) => local.close(resolve)); }
  });
});
