import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { ApiRequestError, createApiClient } from '../src/api/client.js';
import { analyticsModule, createAudienceController } from '../src/modules/analytics.js';

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.selectorMap = new Map(); this.listeners = new Map();
    this.attributes = new Map(); this.children = []; this.dataset = {}; this.textContent = '';
    this.className = ''; this.hidden = false; this.disabled = false; this.value = '';
  }
  querySelector(selector) { return this.selectorMap.get(selector) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  listenerCount(type) { return (this.listeners.get(type) ?? []).length; }
  async dispatch(type) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ preventDefault() {} }))); }
}

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const summary = () => ({
  trafficSources: [{ segment: 'YT_SEARCH', views: 120, watchTimeMinutes: 300, viewShare: 0.6 }],
  countries: [{ segment: 'BR', views: 160, viewShare: 0.8, averageViewDurationSeconds: 125 }],
  devices: [{ segment: 'MOBILE', views: 140, viewShare: 0.7 }],
  subscribedStatus: [{ segment: 'UNSUBSCRIBED', views: 130, viewShare: 0.65, averageViewPercentage: 48.5 }],
  searchTerms: [{ segment: '<img src=x onerror=alert(1)>', views: 25 }],
  facts: ['Fato observado.'], signals: ['Sinal sem causalidade.'], hypotheses: [], recommendations: ['Compare períodos.'], missingData: [],
  quality: { state: 'GOOD', freshness: 'RECENT', sampleSize: 5 },
});
const status = () => ({ state: 'synchronized', quality: { state: 'GOOD', freshness: 'RECENT', sampleSize: 5 } });
const createApi = (overrides = {}) => ({
  getAudienceSummary: async () => summary(), getTrafficSourceAnalysis: async () => ({ ...summary(), sources: summary().trafficSources }),
  getAudienceStatus: async () => status(), syncYouTubeAudience: async () => ({ created: 5, updated: 0 }), ...overrides,
});
const createDom = (view = 'audience') => {
  const root = new FakeElement('section'); const panel = new FakeElement('article'); root.selectorMap.set('.audience-workspace', panel);
  const selectors = ['[data-audience-feedback]','[data-audience-sync-form]','[data-audience-sync]','[data-audience-status]','[data-audience-quality]','[data-audience-traffic]','[data-audience-countries]','[data-audience-devices]','[data-audience-subscribed]','[data-audience-search]','[data-audience-insights]','[data-audience-start]','[data-audience-end]','[data-audience-view]'];
  for (const selector of selectors) panel.selectorMap.set(selector, new FakeElement());
  panel.querySelector('[data-audience-view]').dataset.audienceView = view;
  panel.querySelector('[data-audience-start]').value = '2026-08-01'; panel.querySelector('[data-audience-end]').value = '2026-08-07';
  return { root, panel, get: (selector) => panel.querySelector(selector) };
};
const originalDocument = globalThis.document;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; });
process.on('exit', () => { globalThis.document = originalDocument; });

test('Analytics exposes Audience and Traffic Sources as operational subroutes', () => {
  assert.match(analyticsModule.render({}, { route: { subpath: 'audience' } }), /data-audience-view="audience"/);
  assert.match(analyticsModule.render({}, { route: { subpath: 'traffic' } }), /data-audience-view="traffic"/);
  assert.match(analyticsModule.render({}, { route: { subpath: 'audience' } }), /aria-live="polite"/);
});

test('audience controller loads real lists in backend order and renders text safely', async () => {
  const dom = createDom(); const controller = createAudienceController({ api: createApi() });
  controller.mount(dom.root); await flush();
  assert.equal(dom.get('[data-audience-status]').textContent, 'Sincronizado');
  assert.match(dom.get('[data-audience-quality]').textContent, /GOOD.*RECENT.*5/);
  assert.equal(dom.get('[data-audience-traffic]').children[0].children[0].textContent.startsWith('YT_SEARCH'), true);
  assert.match(dom.get('[data-audience-countries]').children[0].children[0].textContent, /2:05 de duração média/);
  assert.match(dom.get('[data-audience-subscribed]').children[0].children[0].textContent, /48,5% médio/);
  assert.equal(dom.get('[data-audience-search]').children[0].children[0].textContent, '<img src=x onerror=alert(1)>: 25 views');
  assert.equal(dom.get('[data-audience-search]').children[0].children[0].children.length, 0);
});

test('Traffic Sources view uses its dedicated read contract', async () => {
  let trafficCalls = 0; let summaryCalls = 0; const dom = createDom('traffic');
  createAudienceController({ api: createApi({ getTrafficSourceAnalysis: async () => { trafficCalls += 1; return { ...summary(), sources: summary().trafficSources }; }, getAudienceSummary: async () => { summaryCalls += 1; return summary(); } }) }).mount(dom.root);
  await flush(); assert.equal(trafficCalls, 1); assert.equal(summaryCalls, 0);
});

test('manual sync is bounded to one in-flight request and refreshes persisted data', async () => {
  const pending = deferred(); let syncCalls = 0; let loads = 0; const dom = createDom();
  const controller = createAudienceController({ api: createApi({
    getAudienceSummary: async () => { loads += 1; return summary(); },
    syncYouTubeAudience: async () => { syncCalls += 1; return pending.promise; },
  }) });
  controller.mount(dom.root); await flush();
  const first = dom.get('[data-audience-sync-form]').dispatch('submit');
  const second = dom.get('[data-audience-sync-form]').dispatch('submit');
  assert.equal(syncCalls, 1); assert.equal(dom.get('[data-audience-sync]').disabled, true);
  pending.resolve({ created: 4, updated: 1 }); await Promise.all([first, second]); await flush();
  assert.equal(loads, 2); assert.match(dom.get('[data-audience-feedback]').textContent, /5 linha/);
  assert.equal(dom.get('[data-audience-sync-form]').listenerCount('submit'), 1);
});

test('unmount removes listeners and ignores late load responses', async () => {
  const pending = deferred(); const dom = createDom(); const controller = createAudienceController({ api: createApi({ getAudienceSummary: async () => pending.promise }) });
  controller.mount(dom.root); assert.equal(dom.get('[data-audience-sync-form]').listenerCount('submit'), 1);
  controller.unmount(); pending.resolve(summary()); await flush();
  assert.equal(dom.get('[data-audience-sync-form]').listenerCount('submit'), 0);
  assert.equal(dom.get('[data-audience-status]').textContent, '');
});

test('read failures use local feedback and never create false audience rows', async () => {
  const dom = createDom(); const controller = createAudienceController({ api: createApi({ getAudienceSummary: async () => { throw new ApiRequestError('safe', 503); } }) });
  controller.mount(dom.root); await flush();
  assert.match(dom.get('[data-audience-feedback]').textContent, /Não foi possível carregar/);
  assert.equal(dom.get('[data-audience-traffic]').children.length, 0);
});

test('central API client uses audience contracts and preserves safe statuses', async () => {
  const originalFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return { ok: true, status: 200, async json() { return { ok: true }; } }; };
  try {
    const api = createApiClient('http://localhost:4000');
    await api.getAudienceStatus(); await api.syncYouTubeAudience({ startDate: '2026-08-01', endDate: '2026-08-07' });
    await api.getAudienceSummary('project/one'); await api.getTrafficSourceAnalysis();
    await api.compareAudiencePeriods({ currentStart: '2026-08-01', currentEnd: '2026-08-08', previousStart: '2026-07-24', previousEnd: '2026-08-01' });
    assert.equal(calls[0][0], 'http://localhost:4000/api/operators/creator-intelligence/audience/status');
    assert.deepEqual(calls[1][1], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: '2026-08-01', endDate: '2026-08-07' }) });
    assert.match(calls[2][0], /projectId=project%2Fone/); assert.match(calls[4][0], /currentStart=2026-08-01/);
  } finally { globalThis.fetch = originalFetch; }
  globalThis.fetch = async () => ({ ok: false, status: 503, async json() { return { stack: 'private', token: 'never' }; } });
  try {
    await assert.rejects(createApiClient('http://localhost:4000').getAudienceStatus(), (error) => error instanceof ApiRequestError && error.status === 503 && !error.message.includes('private'));
  } finally { globalThis.fetch = originalFetch; }
});
