import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { analyticsModule, createTemporalIntelligenceController } from '../src/modules/analytics.js';
import { operatorRegistry } from '../src/operators/registry.js';

class FakeElement {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.selectorMap = new Map(); this.listeners = new Map(); this.children = []; this.dataset = {}; this.attributes = new Map(); this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.type = ''; }
  querySelector(selector) { return this.selectorMap.get(selector) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  listenerCount(type) { return (this.listeners.get(type) ?? []).length; }
  async dispatch(type, target = this) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ preventDefault() {}, target }))); }
  closest(selector) {
    if (selector === '[data-trend-id]' && this.dataset.trendId) return this;
    if (selector === '[data-series-id]' && this.dataset.seriesId) return this;
    if (selector === '[data-unlink-video]' && this.dataset.unlinkVideo) return this;
    return null;
  }
}

const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; globalThis.fetch = originalFetch; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const trend = (id, subject = 'Canal') => ({ id, subject, metric: 'views', classification: 'RISING', confidence: 0.8, sampleSize: 8, delta: 0.3,
  currentWindow: { label: '28d', value: 200, sampleSize: 4 }, previousWindow: { label: 'previous 28d', value: 100, sampleSize: 4 }, quality: { state: 'GOOD', freshness: 'RECENT' } });
const series = (id, name = 'Série A') => ({ series: { id, name, videoLinks: [] }, health: { health: 'HEALTHY', trend: 'STABLE', confidence: 0.7, sampleSize: 6, reasons: [] } });

const createTrendDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.selectorMap.set('.temporal-intelligence-workspace', panel);
  for (const selector of ['[data-temporal-view]','[data-temporal-feedback]','[data-trend-days]','[data-temporal-refresh]','[data-trend-list]','[data-trend-detail]','[data-pattern-list]']) panel.selectorMap.set(selector, new FakeElement());
  panel.querySelector('[data-temporal-view]').dataset.temporalView = 'trends'; panel.querySelector('[data-trend-days]').value = '28'; return { root, panel };
};
const createSeriesDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.selectorMap.set('.temporal-intelligence-workspace', panel);
  for (const selector of ['[data-temporal-view]','[data-temporal-feedback]','[data-series-create-form]','[data-series-name]','[data-series-game]','[data-series-topic]','[data-series-create]','[data-series-list]','[data-series-detail]','[data-series-link-form]','[data-series-snapshot]','[data-series-link]']) panel.selectorMap.set(selector, new FakeElement());
  panel.querySelector('[data-temporal-view]').dataset.temporalView = 'series'; panel.querySelector('[data-series-name]').value = 'Nova série'; return { root, panel };
};

test('API client uses centralized strict temporal intelligence contracts', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([url, options]); return { ok: true, status: options.method === 'DELETE' ? 204 : 200, json: async () => [] }; };
  const api = createApiClient('http://local'); await api.listTrends({ days: 28 }); await api.getTrend('trend 1'); await api.listSeries(); await api.getSeries('series 1'); await api.linkSeriesVideo('series 1', 'snapshot 1'); await api.unlinkSeriesVideo('series 1', 'video 1'); await api.listContentPatterns(); await api.getSubjectPerformance('game');
  assert.match(calls[0][0], /\/trends\?days=28$/); assert.match(calls[1][0], /\/trends\/trend%201$/); assert.equal(calls[4][1].method, 'POST'); assert.deepEqual(JSON.parse(calls[4][1].body), { snapshotId: 'snapshot 1', mode: 'manual' }); assert.equal(calls[5][1].method, 'DELETE'); assert.match(calls[7][0], /type=game/);
  await assert.rejects(api.listTrends({ days: 8 }), TypeError); await assert.rejects(api.getSeries(''), TypeError);
});

test('Analytics exposes Trends, Series and the two real operators without redesigning navigation', () => {
  assert.match(analyticsModule.render({}, { route: { subpath: 'trends' } }), /data-trend-list/); assert.match(analyticsModule.render({}, { route: { subpath: 'series' } }), /data-series-create-form/);
  assert.ok(operatorRegistry.some(({ id, route }) => id === 'trends' && route === '/analytics/trends')); assert.ok(operatorRegistry.some(({ id, route }) => id === 'series' && route === '/analytics/series'));
});

test('Trends mount loads backend rows in order and renders unsafe content as text', async () => {
  const dom = createTrendDom(); const calls = []; const api = { listTrends: async () => { calls.push('trends'); return [trend('one', '<img src=x onerror=alert(1)>'), trend('two', '<script>alert(1)</script>')]; }, listContentPatterns: async () => { calls.push('patterns'); return []; }, getTrend: async () => trend('one') };
  createTemporalIntelligenceController({ api }).mount(dom.root); await flush(); assert.deepEqual(calls, ['trends', 'patterns']);
  const list = dom.panel.querySelector('[data-trend-list]').children[0]; assert.match(list.children[0].children[0].textContent, /<img src=x onerror=alert\(1\)>/); assert.equal(list.children[0].children[0].children.length, 0);
});

test('late trend detail cannot overwrite a newer selection', async () => {
  const dom = createTrendDom(); const one = deferred(); const two = deferred(); const api = { listTrends: async () => [trend('one'), trend('two')], listContentPatterns: async () => [], getTrend: (id) => id === 'one' ? one.promise : two.promise };
  const controller = createTemporalIntelligenceController({ api }); controller.mount(dom.root); await flush(); const first = new FakeElement('button'); first.dataset.trendId = 'one'; const second = new FakeElement('button'); second.dataset.trendId = 'two';
  const firstClick = dom.panel.dispatch('click', first); const secondClick = dom.panel.dispatch('click', second); two.resolve(trend('two', 'Mais recente')); await secondClick; one.resolve(trend('one', 'Obsoleta')); await firstClick;
  assert.equal(dom.panel.querySelector('[data-trend-detail]').children[0].textContent, 'Mais recente · views');
});

test('Series creation, opening and linking use backend results and unique listeners', async () => {
  const dom = createSeriesDom(); const calls = []; let entries = [series('a')]; const api = { listSeries: async () => entries, getSeries: async (id) => entries.find((entry) => entry.series.id === id), createSeries: async (input) => { calls.push(['create', input]); entries = [...entries, series('b', input.name)]; return entries[1].series; }, linkSeriesVideo: async (id, snapshotId) => { calls.push(['link', id, snapshotId]); }, unlinkSeriesVideo: async () => {} };
  const controller = createTemporalIntelligenceController({ api }); controller.mount(dom.root); controller.mount(dom.root); await flush(); assert.equal(dom.panel.listenerCount('click'), 1); assert.equal(dom.panel.querySelector('[data-series-create-form]').listenerCount('submit'), 1);
  await dom.panel.querySelector('[data-series-create-form]').dispatch('submit'); await flush(); assert.equal(calls.filter(([kind]) => kind === 'create').length, 1);
  dom.panel.querySelector('[data-series-snapshot]').value = 'snapshot-1'; await dom.panel.querySelector('[data-series-link-form]').dispatch('submit'); assert.deepEqual(calls.at(-1), ['link', 'b', 'snapshot-1']);
});

test('unmount ignores late list responses and removes listeners', async () => {
  const dom = createTrendDom(); const pending = deferred(); const controller = createTemporalIntelligenceController({ api: { listTrends: () => pending.promise, listContentPatterns: async () => [] } });
  controller.mount(dom.root); controller.unmount(); pending.resolve([trend('late')]); await flush(); assert.equal(dom.panel.listenerCount('click'), 0); assert.equal(dom.panel.querySelector('[data-trend-list]').children.length, 0);
});

test('API failure remains local and does not fabricate temporal rows', async () => {
  const dom = createTrendDom(); createTemporalIntelligenceController({ api: { listTrends: async () => { throw new Error('private payload'); }, listContentPatterns: async () => [] } }).mount(dom.root);
  await flush(); assert.match(dom.panel.querySelector('[data-temporal-feedback]').textContent, /Não foi possível carregar/); assert.doesNotMatch(dom.panel.querySelector('[data-temporal-feedback]').textContent, /private payload/); assert.equal(dom.panel.querySelector('[data-trend-list]').children.length, 0);
});
