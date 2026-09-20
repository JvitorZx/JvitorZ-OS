import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createApiClient, ApiRequestError } from '../src/api/client.js';
import { channelModule, channelSourceAction, collectionAgeDays, createChannelController, observedSnapshotDelta } from '../src/modules/channel.js';
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
  constructor() { this.map = new Map(); this.listeners = new Map(); this.attributes = new Map(); this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; }
  querySelector(selector) { return this.map.get(selector) ?? null; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  async dispatch(type) { for (const handler of this.listeners.get(type) ?? []) await handler({ currentTarget: this, preventDefault() {} }); }
}

const channelDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); const button = new FakeElement(); const feedback = new FakeElement(); const videos = new FakeElement(); const detail = new FakeElement(); const summary = new FakeElement(); const resultCount = new FakeElement(); const reset = new FakeElement(); const search = new FakeElement(); const format = new FakeElement(); const sort = new FakeElement(); const evidence = new FakeElement(); format.value = 'ALL'; sort.value = 'COLLECTED'; evidence.value = 'ALL';
  root.map.set('.channel-panel', panel); root.map.set('[data-channel-videos]', videos); root.map.set('[data-channel-video-detail]', detail); root.map.set('[data-channel-video-summary]', summary); root.map.set('[data-channel-video-result-count]', resultCount); root.map.set('[data-channel-video-reset]', reset); root.map.set('[data-channel-video-search]', search); root.map.set('[data-channel-video-format]', format); root.map.set('[data-channel-video-sort]', sort); root.map.set('[data-channel-video-evidence]', evidence); panel.map.set('[data-channel-sync]', button); panel.map.set('[data-channel-feedback]', feedback);
  return { root, button, feedback, videos, detail, summary, resultCount, reset, search, format, sort, evidence };
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
    return { ok: true, status: 200, json: async () => url.includes('/videos-summary')
      ? { videos: 2, observations: 3, coverage: { views: 1 } }
      : url.includes('/videos?')
      ? [{ id: 'snapshot-1' }]
      : url.includes('/videos/') ? { current: { videoId: 'video/1' }, history: [] } : ({ id: 'channel-1' }) };
  };
  try {
    const api = createApiClient('http://localhost:3000');
    assert.equal((await api.getYouTubeChannel()).id, 'channel-1');
    assert.equal((await api.syncYouTubeChannel()).id, 'channel-1');
    assert.equal((await api.listYouTubeChannelVideos(8)).length, 1);
    assert.equal((await api.getYouTubeChannelVideoSummary()).videos, 2);
    assert.equal((await api.getYouTubeChannelVideo('video/1')).current.videoId, 'video/1');
    assert.deepEqual(calls, [
      { url: 'http://localhost:3000/api/youtube/channel', options: undefined },
      { url: 'http://localhost:3000/api/youtube/channel/sync', options: { method: 'POST' } },
      { url: 'http://localhost:3000/api/youtube/videos?limit=8', options: undefined },
      { url: 'http://localhost:3000/api/youtube/videos-summary', options: undefined },
      { url: 'http://localhost:3000/api/youtube/videos/video%2F1', options: undefined },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Channel renders recent persisted videos as text and ignores duplicates from remount', async () => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: () => new FakeElement() };
  try {
    let calls = 0; const page = channelDom();
    const controller = createChannelController({ api: { listYouTubeChannelVideos: async () => { calls += 1; return [{ videoId: 'v1', title: '<img src=x onerror=alert(1)>', format: 'SHORTS', views: 12, collectedAt: '2026-09-10T00:00:00Z' }]; } } });
    controller.mount(page.root); controller.mount(page.root); await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1); assert.equal(page.videos.children.length, 1);
    assert.equal(page.videos.children[0].children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  } finally { globalThis.document = originalDocument; }
});

test('Channel opens persisted video detail and keeps missing metrics explicit', async () => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: () => new FakeElement() };
  try {
    const page = channelDom();
    const controller = createChannelController({ api: {
      listYouTubeChannelVideos: async () => [{ videoId: 'v1', title: 'Vídeo', format: 'LONG_FORM', views: 10 }],
      getYouTubeChannelVideo: async () => ({ current: { videoId: 'v1', title: '<b>Vídeo</b>', format: 'LONG_FORM', views: 10, averageViewPercentage: 50, ctr: null }, history: [{ id: 'one', collectedAt: '2026-09-10T00:00:00Z', views: 10, averageViewPercentage: 50, ctr: null }] }),
    } });
    controller.mount(page.root); await new Promise((resolve) => setTimeout(resolve, 0));
    const open = page.videos.children[0].children[2]; await open.dispatch('click');
    assert.equal(page.videos.children[0].children[2].attributes.get('aria-pressed'), 'true');
    assert.equal(page.detail.children[0].textContent, '<b>Vídeo</b>');
    assert.equal(page.detail.children[2].href, 'https://www.youtube.com/watch?v=v1');
    assert.equal(page.detail.children[2].rel, 'noopener noreferrer');
    assert.match(page.detail.children[4].textContent, /1 coleta/);
    assert.match(page.detail.children[5].textContent, /não há uma coleta anterior/);
    assert.match(page.detail.children[6].children[0].textContent, /10 views/);
    assert.match(page.detail.children[6].children[0].textContent, /CTR --%/);
  } finally { globalThis.document = originalDocument; }
});

test('Channel snapshot deltas require two observed numeric values', () => {
  assert.equal(observedSnapshotDelta({ views: 15 }, { views: 10 }, 'views'), 5);
  assert.equal(observedSnapshotDelta({ views: null }, { views: 10 }, 'views'), null);
  assert.equal(observedSnapshotDelta({ views: 15 }, undefined, 'views'), null);
});

test('Channel collection age reports elapsed days without a hidden freshness threshold', () => {
  assert.equal(collectionAgeDays('2026-09-10T00:00:00Z', new Date('2026-09-12T23:59:00Z')), 2);
  assert.equal(collectionAgeDays('invalid', new Date('2026-09-12T00:00:00Z')), null);
  assert.equal(collectionAgeDays('2026-09-13T00:00:00Z', new Date('2026-09-12T00:00:00Z')), null);
});

test('Channel filters the loaded local list without another API request', async () => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: () => new FakeElement() };
  try {
    let calls = 0; const page = channelDom();
    createChannelController({ api: { listYouTubeChannelVideos: async (limit) => { calls += 1; assert.equal(limit, 50); return [
      { videoId: 'a', title: 'City Car', format: 'LONG_FORM' }, { videoId: 'b', title: 'Forza Short', format: 'SHORTS' },
    ]; } } }).mount(page.root);
    await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(page.videos.children.length, 2);
    page.search.value = 'forza'; await page.search.dispatch('input'); assert.equal(page.videos.children.length, 1);
    page.search.value = 'inexistente'; await page.search.dispatch('input'); assert.equal(page.videos.children[0].textContent, 'Nenhum vídeo corresponde aos filtros.');
    assert.equal(page.resultCount.textContent, '0 vídeo(s) exibido(s)');
    page.search.value = ''; page.format.value = 'LONG_FORM'; await page.format.dispatch('change'); assert.equal(page.videos.children.length, 1);
    assert.equal(calls, 1);
  } finally { globalThis.document = originalDocument; }
});

test('Channel video detail controls have specific accessible names', async () => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: () => new FakeElement() };
  try {
    const page = channelDom();
    createChannelController({ api: { listYouTubeChannelVideos: async () => [{ videoId: 'v1', title: 'Meu vídeo' }] } }).mount(page.root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(page.videos.children[0].children[2].attributes.get('aria-label'), 'Abrir detalhes de Meu vídeo');
  } finally { globalThis.document = originalDocument; }
});

test('Channel sorts loaded videos locally without another API request', async () => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: () => new FakeElement() };
  try {
    let calls = 0; const page = channelDom();
    createChannelController({ api: { listYouTubeChannelVideos: async () => { calls += 1; return [
      { videoId: 'a', title: 'Zulu', views: 2, averageViewPercentage: 70, ctr: null, collectedAt: '2026-09-01' }, { videoId: 'b', title: 'Alpha', views: 20, averageViewPercentage: 40, ctr: 5, collectedAt: '2026-09-02' },
    ]; } } }).mount(page.root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    page.sort.value = 'TITLE'; await page.sort.dispatch('change'); assert.equal(page.videos.children[0].children[0].children[0].textContent, 'Alpha');
    page.sort.value = 'VIEWS'; await page.sort.dispatch('change'); assert.equal(page.videos.children[0].children[0].children[0].textContent, 'Alpha');
    page.sort.value = 'RETENTION'; await page.sort.dispatch('change'); assert.equal(page.videos.children[0].children[0].children[0].textContent, 'Zulu');
    page.sort.value = 'CTR'; await page.sort.dispatch('change'); assert.equal(page.videos.children[0].children[0].children[0].textContent, 'Alpha');
    assert.equal(calls, 1);
  } finally { globalThis.document = originalDocument; }
});

test('Channel filters explicit metric availability locally', async () => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: () => new FakeElement() };
  try {
    let calls = 0; const page = channelDom();
    createChannelController({ api: { listYouTubeChannelVideos: async () => { calls += 1; return [
      { videoId: 'a', title: 'Com dados', averageViewPercentage: 50, ctr: 4 }, { videoId: 'b', title: 'Sem CTR', averageViewPercentage: null, ctr: null },
    ]; } } }).mount(page.root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    page.evidence.value = 'HAS_RETENTION'; await page.evidence.dispatch('change'); assert.equal(page.videos.children.length, 1);
    page.evidence.value = 'MISSING_CTR'; await page.evidence.dispatch('change'); assert.equal(page.videos.children[0].children[0].children[0].textContent, 'Sem CTR');
    assert.equal(calls, 1);
  } finally { globalThis.document = originalDocument; }
});

test('Channel resets every local content filter with one listener', async () => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: () => new FakeElement() };
  try {
    const page = channelDom();
    const controller = createChannelController({ api: { listYouTubeChannelVideos: async () => [{ videoId: 'a', title: 'A' }] } }); controller.mount(page.root); controller.mount(page.root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    page.search.value = 'x'; page.format.value = 'SHORTS'; page.evidence.value = 'MISSING_CTR'; page.sort.value = 'TITLE'; await page.reset.dispatch('click');
    assert.deepEqual([page.search.value, page.format.value, page.evidence.value, page.sort.value], ['', 'ALL', 'ALL', 'COLLECTED']);
    assert.equal(page.reset.listeners.get('click').size, 1);
  } finally { globalThis.document = originalDocument; }
});

test('Channel renders persisted coverage summary without inventing missing metrics', async () => {
  const originalDocument = globalThis.document; globalThis.document = { createElement: () => new FakeElement() };
  try {
    const page = channelDom();
    createChannelController({ api: {
      listYouTubeChannelVideos: async () => [],
      getYouTubeChannelVideoSummary: async () => ({ videos: 2, observations: 3, formats: { SHORTS: 1, LONG_FORM: 1 }, earliestCollectedAt: '2026-09-01T12:00:00Z', latestCollectedAt: '2026-09-10T12:00:00Z', coverage: { views: 1, watchTime: 1, retention: 0, impressions: 0, ctr: 0, subscribers: 0, interactions: 1 } }),
    } }).mount(page.root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(page.summary.children.length, 6);
    assert.equal(page.summary.children[0].children[0].textContent, '2');
    assert.equal(page.summary.children[3].children[0].textContent, '0');
    assert.match(page.summary.children[5].textContent, /SHORTS: 1/);
    assert.match(page.summary.children[5].textContent, /desde 01\/09\/2026/);
    assert.match(page.summary.children[5].textContent, /Cobertura parcial: watch time 1\/2/);
  } finally { globalThis.document = originalDocument; }
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

test('Channel source guidance follows the real integration state', () => {
  assert.deepEqual(channelSourceAction({ state: 'NOT_CONFIGURED' }), { label: 'Configuração necessária', available: false });
  assert.deepEqual(channelSourceAction({ state: 'AUTH_REQUIRED' }), { label: 'Reconectar', available: true });
  assert.deepEqual(channelSourceAction({ state: 'CONNECTED', action: 'SYNC' }), { label: 'Abrir sincronização', available: true });
  assert.deepEqual(channelSourceAction({ state: 'DEGRADED' }), { label: 'Revisar dados', available: true });
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
