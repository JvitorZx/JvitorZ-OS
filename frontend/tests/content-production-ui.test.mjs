import assert from 'node:assert/strict'; import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js'; import { createProductionController, productionModule } from '../src/modules/production.js';

class FakeElement {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.attributes = new Map(); this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.dataset = {}; this.type = ''; this.placeholder = ''; }
  querySelector(selector) { if (this.map.has(selector)) return this.map.get(selector); const data = selector.match(/^\[data-([\w-]+)\]$/); if (!data) return null; const key = data[1].replace(/-([a-z])/g, (_, value) => value.toUpperCase()); const visit = (item) => item.children.find((child) => child.dataset?.[key] !== undefined) ?? item.children.map(visit).find(Boolean); return visit(this); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; this.textContent = ''; }
  closest(selector) { const data = selector.match(/^\[data-([\w-]+)\]$/); if (!data) return null; const key = data[1].replace(/-([a-z])/g, (_, value) => value.toUpperCase()); return this.dataset[key] !== undefined ? this : null; }
  async dispatch(type, target = this) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target, preventDefault() {} }))); }
}
const originalDocument = globalThis.document; const originalFetch = globalThis.fetch; globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.fetch = originalFetch; globalThis.document = { createElement: (tag) => new FakeElement(tag) }; }); process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0)); const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }; const collect = (node) => `${node.textContent}${node.children.map(collect).join('')}`;
const production = (overrides = {}) => ({ id: 'p1', title: '<img src=x onerror=alert(1)>', format: 'SHORT', game: 'Forza', status: 'PLANNED', currentStage: 'PREPARING', summary: '<script>alert(1)</script>', nextAction: { label: 'Iniciar: Preparacao', reason: 'Etapa manual disponivel.' }, packaging: null, assets: [], events: [{ event: 'PRODUCTION_CREATED', stepKey: null, reason: null }], steps: [{ key: 'PREPARING', label: 'Preparacao', position: 1, state: 'AVAILABLE', mode: 'MANUAL', capability: null, skippable: false }], ...overrides });
const dom = () => { const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.production-panel', panel); for (const selector of ['[data-production-form]', '[data-production-list]', '[data-production-detail]', '[data-production-feedback]']) panel.map.set(selector, new FakeElement()); return { root, get: (selector) => panel.querySelector(selector) }; };

test('central API client exposes the complete production HTTP surface', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: options.method === 'POST' ? 201 : 200, json: async () => ({}) }; }; const api = createApiClient('http://localhost:3000');
  await api.listProductions({ format: 'SHORT', limit: 5 }); await api.createProduction({ title: 'x' }); await api.getProduction('p/1'); await api.updateProduction('p/1', { title: 'x' }); await api.getProductionWorkflow('p/1'); await api.getProductionNextAction('p/1'); await api.getProductionHistory('p/1'); await api.resumeProduction('p/1'); await api.cancelProduction('p/1', 'reason'); await api.transitionProductionStep('p/1', 'EDITING', 'start'); await api.runProductionPackaging('p/1'); await api.linkProductionPackaging('p/1', 'pack/1'); await api.reviewProduction('p/1'); await api.linkProductionAsset('p/1', 'asset/1', 'RAW_VIDEO'); await api.unlinkProductionAsset('p/1', 'relation/1'); await api.publishProduction('p/1', { videoId: 'youtube' });
  assert.equal(calls.length, 16); assert.match(calls[2][0], /p%2F1/); assert.equal(calls[9][1].method, 'POST'); await assert.rejects(() => api.getProduction(' '), TypeError);
});

test('production workspace is fullscreen, loads once and keeps listeners unique', async () => {
  assert.equal(productionModule.fullscreen, true); assert.equal(productionModule.route, '/production'); const page = dom(); let calls = 0; const controller = createProductionController({ api: { listProductions: async () => { calls += 1; return [production()]; } } }); controller.mount(page.root); controller.mount(page.root); await flush(); assert.equal(calls, 1); assert.equal(page.get('[data-production-list]').listeners.get('click').length, 1); assert.equal(page.get('[data-production-list]').children.length, 1);
});

test('untrusted production metadata and timeline are rendered only as text', async () => {
  const page = dom(); const controller = createProductionController({ api: { listProductions: async () => [production()], getProduction: async () => production() } }); controller.mount(page.root); await flush(); await page.get('[data-production-list]').dispatch('click', page.get('[data-production-list]').children[0]); await flush(); const rendered = collect(page.get('[data-production-detail]')); assert.match(rendered, /<img src=x onerror=alert\(1\)>/); assert.match(rendered, /<script>alert\(1\)<\/script>/);
});

test('duplicate action while pending produces one request', async () => {
  const wait = deferred(); const page = dom(); let actions = 0; const api = { listProductions: async () => [production()], getProduction: async () => production(), transitionProductionStep: async () => { actions += 1; return wait.promise; } }; const controller = createProductionController({ api }); controller.mount(page.root); await flush(); await page.get('[data-production-list]').dispatch('click', page.get('[data-production-list]').children[0]); await flush(); const button = page.get('[data-production-detail]').querySelector('[data-production-action]'); const first = page.get('[data-production-detail]').dispatch('click', button); await page.get('[data-production-detail]').dispatch('click', button); assert.equal(actions, 1); wait.resolve(production({ status: 'IN_PRODUCTION' })); await first;
});

test('late detail after unmount cannot alter detached workspace', async () => {
  const wait = deferred(); const page = dom(); const controller = createProductionController({ api: { listProductions: async () => [production()], getProduction: async () => wait.promise } }); controller.mount(page.root); await flush(); const opening = page.get('[data-production-list]').dispatch('click', page.get('[data-production-list]').children[0]); controller.unmount(); wait.resolve(production()); await opening; assert.equal(page.get('[data-production-detail]').children.length, 0);
});

test('API errors remain local, safe and do not create false production state', async () => {
  const page = dom(); createProductionController({ api: { listProductions: async () => { throw new Error('private token payload'); } } }).mount(page.root); await flush(); assert.equal(page.get('[data-production-list]').children.length, 0); assert.match(page.get('[data-production-feedback]').textContent, /Nao foi possivel/); assert.doesNotMatch(page.get('[data-production-feedback]').textContent, /private|token/);
});
