import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createApiClient, ApiRequestError } from '../src/api/client.js';
import { channelModule } from '../src/modules/channel.js';
import { homeModule } from '../src/modules/home.js';
import { plannerModule } from '../src/modules/planner.js';
import { settingsModule } from '../src/modules/settings.js';
import { supervisorModule } from '../src/modules/supervisor.js';

const integrations = {
  backend: { state: 'CONNECTED', summary: 'Backend API disponível.' },
  database: { state: 'CONNECTED', summary: 'SQLite disponível.' },
  googleOAuth: { state: 'CONNECTED', summary: 'Google OAuth conectado.' },
  youtubeData: { state: 'DEGRADED', stale: true, lastSuccessAt: '2026-08-27T20:00:00Z', summary: 'Último dado válido.' },
  youtubeAnalytics: { state: 'CONNECTED', summary: 'Analytics sincronizado.' },
  openai: { state: 'NOT_CONFIGURED', summary: 'OpenAI não configurada.' },
  automationRuntime: { state: 'NOT_CONFIGURED', summary: 'Runtime desativado.' },
};

const dashboard = {
  integrations,
  channel: { title: 'Canal real', id: 'channel-1', country: 'BR', publishedAt: '2020-01-01T00:00:00Z' },
  metrics: { subscribers: '148', videos: '248', views: '85228' },
  supervisor: { channelOperators: [
    { id: 'ctr', status: 'LIMITED', confidence: 0.4, summary: 'CTR limitado: faltam impressions, ctr.' },
  ], editorial: {}, automations: {} },
};

test('Dashboard, Channel, Planner and Supervisor use the same operational truth', () => {
  const home = homeModule.render(dashboard);
  const channel = channelModule.render(dashboard);
  const planner = plannerModule.render(dashboard);
  const supervisor = supervisorModule.render(dashboard);
  assert.match(home, /Degradado/);
  assert.match(home, /Não configurado/);
  assert.match(channel, /Último dado conhecido/);
  assert.match(channel, /Canal real/);
  assert.match(planner, /Não configurado/);
  assert.match(supervisor, /CTR limitado: faltam impressions, ctr/);
});

test('Settings renders real integration states without secrets', () => {
  const output = settingsModule.render(dashboard, { apiBaseUrl: 'http://localhost:3000' });
  assert.match(output, /Google OAuth/);
  assert.match(output, /YouTube Analytics/);
  assert.match(output, /OpenAI não configurada/);
  assert.doesNotMatch(output, /API_KEY|client_secret|access_token/);
});

test('central API client exposes integration status and a safe error code', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    if (calls.length === 1) return { ok: true, status: 200, json: async () => integrations };
    return { ok: false, status: 401, json: async () => ({ code: 'AUTH_REQUIRED', token: 'private' }) };
  };
  try {
    const api = createApiClient('http://localhost:3000');
    assert.equal((await api.getIntegrationStatus()).youtubeData.state, 'DEGRADED');
    await assert.rejects(api.getIntegrationStatus(), (error) => (
      error instanceof ApiRequestError && error.status === 401 && error.code === 'AUTH_REQUIRED'
        && !error.message.includes('private')
    ));
    assert.equal(calls[0][0], 'http://localhost:3000/api/integrations/status');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
