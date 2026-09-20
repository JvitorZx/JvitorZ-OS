import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createApiClient, ApiRequestError } from '../src/api/client.js';
import { channelModule, createChannelController } from '../src/modules/channel.js';
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

class FakeElement {
  constructor() { this.map = new Map(); this.listeners = new Map(); this.attributes = new Map(); this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; }
  querySelector(selector) { return this.map.get(selector) ?? null; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  async dispatch(type) { for (const handler of this.listeners.get(type) ?? []) await handler({ currentTarget: this, preventDefault() {} }); }
}

const channelDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); const button = new FakeElement(); const feedback = new FakeElement();
  root.map.set('.channel-panel', panel); panel.map.set('[data-channel-sync]', button); panel.map.set('[data-channel-feedback]', feedback);
  return { root, button, feedback };
};

const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };

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

test('channel client exposes explicit read and synchronization contracts', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ id: 'channel-1' }) };
  };
  try {
    const api = createApiClient('http://localhost:3000');
    assert.equal((await api.getYouTubeChannel()).id, 'channel-1');
    assert.equal((await api.syncYouTubeChannel()).id, 'channel-1');
    assert.deepEqual(calls, [
      { url: 'http://localhost:3000/api/youtube/channel', options: undefined },
      { url: 'http://localhost:3000/api/youtube/channel/sync', options: { method: 'POST' } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Channel exposes safe local controls according to the operational state', () => {
  const output = channelModule.render({ ...dashboard, authUrl: 'http://localhost:3000/api/auth/google' }, { apiBaseUrl: 'http://localhost:3000' });
  assert.match(output, /Sincronizar canal/);
  assert.match(output, /Reconectar Google/);
  assert.match(output, /aria-live="polite"/);
  assert.doesNotMatch(output, /access_token|client_secret/);
});

test('Channel consolidates every real YouTube source without inventing availability', () => {
  const output = channelModule.render(dashboard, { apiBaseUrl: 'http://localhost:3000' });
  assert.match(output, /Fontes do YouTube/);
  assert.match(output, /Google OAuth/);
  assert.match(output, /Dados do canal/);
  assert.match(output, /YouTube Analytics/);
  assert.match(output, /YouTube Reach/);
  assert.match(output, /Último dado válido/);
  assert.doesNotMatch(output, /Tudo funcionando|100% disponível/);
});

test('Channel synchronization is single-flight and refreshes only after persisted success', async () => {
  const pending = deferred(); let calls = 0; let refreshes = 0;
  const page = channelDom();
  const controller = createChannelController({
    api: { syncYouTubeChannel: async () => { calls += 1; return pending.promise; } },
    refreshDashboard: async () => { refreshes += 1; },
  });
  controller.mount(page.root); controller.mount(page.root);
  const first = page.button.dispatch('click'); await page.button.dispatch('click');
  assert.equal(calls, 1); assert.equal(page.button.disabled, true);
  pending.resolve({ id: 'channel-1' }); await first;
  assert.equal(refreshes, 1); assert.equal(page.button.disabled, false);
});

test('Channel ignores a late synchronization response after unmount', async () => {
  const pending = deferred(); let refreshes = 0; const page = channelDom();
  const controller = createChannelController({ api: { syncYouTubeChannel: async () => pending.promise }, refreshDashboard: async () => { refreshes += 1; } });
  controller.mount(page.root); const request = page.button.dispatch('click'); controller.unmount();
  pending.resolve({ id: 'channel-1' }); await request;
  assert.equal(refreshes, 0); assert.doesNotMatch(page.feedback.textContent, /sucesso/i);
});

test('Channel maps synchronization failures to local safe feedback', async () => {
  const page = channelDom();
  const controller = createChannelController({ api: { syncYouTubeChannel: async () => { throw new ApiRequestError('private', 401, 'AUTH_REQUIRED'); } } });
  controller.mount(page.root); await page.button.dispatch('click');
  assert.match(page.feedback.textContent, /Reconecte sua conta Google/);
  assert.doesNotMatch(page.feedback.textContent, /private|token|stack/);
});
