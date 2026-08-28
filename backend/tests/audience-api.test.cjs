const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const express = require('express');
const { createAudienceRouter } = require('../dist/routes/audience');
const {
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsQuotaError,
  YouTubeAnalyticsTemporaryError,
} = require('../dist/integrations/youtube/YouTubeAnalyticsErrors');

let server; let baseUrl;
const sync = {
  getStatus: async () => ({ state: 'synchronized', quality: { state: 'GOOD' } }),
  sync: async (input) => ({ state: 'synchronized', created: input.projectId ? 2 : 1, updated: 0 }),
};
const intelligence = {
  summary: async (projectId) => ({ projectId: projectId ?? null, trafficSources: [{ segment: 'BROWSE' }] }),
  traffic: async () => ({ sources: [{ segment: 'YT_SEARCH' }] }),
  compare: async (input) => ({ current: { start: input.currentStart }, previous: { start: input.previousStart } }),
};
before(async () => {
  const app = express(); app.use(express.json()); app.use(createAudienceRouter(sync, intelligence));
  server = await new Promise((resolve) => { const active = app.listen(0, '127.0.0.1', () => resolve(active)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));
const request = async (path, options) => { const response = await fetch(`${baseUrl}${path}`, options); return { status: response.status, body: await response.json() }; };
const post = (projectId) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: '2026-08-01', endDate: '2026-08-07', ...(projectId ? { projectId } : {}) }) });

describe('audience HTTP contracts', () => {
  test('exposes status, synchronization, summary, traffic and comparison', async () => {
    assert.equal((await request('/status')).status, 200);
    assert.equal((await request('/sync', post('project'))).body.created, 2);
    assert.equal((await request('/summary?projectId=project')).body.trafficSources[0].segment, 'BROWSE');
    assert.equal((await request('/traffic')).body.sources[0].segment, 'YT_SEARCH');
    const comparison = await request('/comparison?currentStart=2026-08-01&currentEnd=2026-08-08&previousStart=2026-07-24&previousEnd=2026-08-01');
    assert.equal(comparison.status, 200);
  });

  test('rejects invalid, extra or incomplete input', async () => {
    assert.equal((await request('/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: 'bad', endDate: '2026-08-07' }) })).status, 400);
    assert.equal((await request('/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: '2026-08-01', endDate: '2026-08-07', token: 'no' }) })).status, 400);
    assert.equal((await request('/summary?unexpected=true')).status, 400);
    assert.equal((await request('/comparison?currentStart=2026-08-01')).status, 400);
  });

  test('maps authorization, quota and provider failures without internal details', async () => {
    const localApp = express(); localApp.use(express.json()); localApp.use(createAudienceRouter({
      ...sync,
      sync: async ({ projectId }) => {
        if (projectId === 'auth') throw new YouTubeAnalyticsNotAuthorizedError();
        if (projectId === 'quota') throw new YouTubeAnalyticsQuotaError();
        throw new YouTubeAnalyticsTemporaryError();
      },
    }, intelligence));
    const local = await new Promise((resolve) => { const active = localApp.listen(0, '127.0.0.1', () => resolve(active)); });
    try {
      const send = async (projectId) => { const response = await fetch(`http://127.0.0.1:${local.address().port}/sync`, post(projectId)); return { status: response.status, body: await response.json() }; };
      const auth = await send('auth'); const quota = await send('quota'); const unavailable = await send('temporary');
      assert.equal(auth.status, 401); assert.equal(quota.status, 429); assert.equal(unavailable.status, 503);
      assert.doesNotMatch(JSON.stringify([auth.body, quota.body, unavailable.body]), /stack|token|secret|Prisma/i);
    } finally { await new Promise((resolve) => local.close(resolve)); }
  });

  test('returns safe errors when read models fail', async () => {
    const localApp = express(); localApp.use(express.json()); localApp.use(createAudienceRouter(sync, {
      summary: async () => { throw new Error('Prisma secret stack'); },
      traffic: async () => { throw new Error('private payload'); },
      compare: async () => { throw new Error('internal'); },
    }));
    const local = await new Promise((resolve) => { const active = localApp.listen(0, '127.0.0.1', () => resolve(active)); });
    try {
      const origin = `http://127.0.0.1:${local.address().port}`;
      const responses = await Promise.all([
        fetch(`${origin}/summary`), fetch(`${origin}/traffic`),
        fetch(`${origin}/comparison?currentStart=2026-08-01&currentEnd=2026-08-08&previousStart=2026-07-24&previousEnd=2026-08-01`),
      ]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      assert.deepEqual(responses.map(({ status }) => status), [500, 500, 500]);
      assert.doesNotMatch(JSON.stringify(bodies), /Prisma|stack|private payload/i);
    } finally { await new Promise((resolve) => local.close(resolve)); }
  });
});
