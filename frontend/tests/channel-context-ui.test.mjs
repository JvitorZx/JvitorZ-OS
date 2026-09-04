import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { channelContextModule, createChannelContextController } from '../src/modules/channel-context.js';

class FakeElement {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.attributes = new Map(); this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.dataset = {}; this.type = ''; }
  querySelector(selector) { if (this.map.has(selector)) return this.map.get(selector); const match = selector.match(/^\[data-([\w-]+)\]$/); if (!match) return null; const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase()); const visit = (item) => item.children.find((child) => child.dataset?.[key] !== undefined) ?? item.children.map(visit).find(Boolean); return visit(this); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; this.textContent = ''; }
  closest(selector) { const match = selector.match(/^\[data-([\w-]+)\]$/); if (!match) return null; const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase()); return this.dataset[key] !== undefined ? this : null; }
  async dispatch(type, target = this) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target, preventDefault() {} }))); }
}
const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.fetch = originalFetch; globalThis.document = { createElement: (tag) => new FakeElement(tag) }; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const collectText = (item) => `${item.textContent}${item.children.map(collectText).join('')}`;
const deferred = () => { let resolve; const promise = new Promise((ok) => { resolve = ok; }); return { promise, resolve }; };
const entry = (id = 'ctx-1', overrides = {}) => ({ id, type: 'FACT', status: 'CONFIRMED', category: 'STRATEGY', subject: `Contexto ${id}`, statement: '<script>alert(1)</script>', confidence: .8,
  source: 'bootstrap:sprint45', sourceReference: id, occurredAt: '2026-08-01T00:00:00Z', periodStart: null, periodEnd: null, relations: [], supersedes: null, supersededBy: null, ...overrides });
const dom = () => { const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.channel-context-panel', panel); for (const selector of ['[data-context-feedback]', '[data-context-type]', '[data-context-status]', '[data-context-from]', '[data-context-to]', '[data-context-entity]', '[data-context-list]', '[data-context-detail]']) panel.map.set(selector, new FakeElement()); return { root, get: (selector) => panel.querySelector(selector) }; };

test('central API client exposes channel context CRUD, resolve, supersede and relation contracts', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: options.method === 'POST' ? 201 : 200, async json() { return {}; } }; };
  const api = createApiClient('http://localhost:3000'); await api.listChannelContext({ type: 'FACT', currentOnly: true, limit: 5 }); await api.resolveChannelContext({ text: 'Forza', limit: 3 });
  await api.getChannelContext('ctx/1'); await api.createChannelContext({ type: 'FACT' }); await api.updateChannelContext('ctx/1', { confidence: .8 });
  await api.supersedeChannelContext('ctx/1', { type: 'DECISION' }); await api.relateChannelContext('ctx/1', { relation: 'INFORMS', entityType: 'VIDEO', entityId: 'v1' });
  assert.deepEqual(calls.map(([url]) => url), ['http://localhost:3000/api/context?type=FACT&currentOnly=true&limit=5', 'http://localhost:3000/api/context/resolve?text=Forza&limit=3',
    'http://localhost:3000/api/context/ctx%2F1', 'http://localhost:3000/api/context', 'http://localhost:3000/api/context/ctx%2F1',
    'http://localhost:3000/api/context/ctx%2F1/supersede', 'http://localhost:3000/api/context/ctx%2F1/relations']);
  await assert.rejects(() => api.getChannelContext(' '), TypeError); await assert.rejects(() => api.listChannelContext({ limit: 0 }), TypeError);
});

test('context workspace is fullscreen, loads timeline and renders HTML as literal text', async () => {
  assert.equal(channelContextModule.fullscreen, true); assert.match(channelContextModule.render(), /data-context-list/); assert.match(channelContextModule.render(), /Timeline/);
  const page = dom(); createChannelContextController({ api: { listChannelContext: async () => [entry()] } }).mount(page.root); await flush();
  assert.equal(page.get('[data-context-list]').children.length, 1); const button = page.get('[data-context-list]').children[0];
  const controller = createChannelContextController({ api: { listChannelContext: async () => [entry()], getChannelContext: async () => entry() } }); const second = dom(); controller.mount(second.root); await flush();
  await second.get('[data-context-list]').dispatch('click', second.get('[data-context-list]').children[0]); await flush(); assert.match(collectText(second.get('[data-context-detail]')), /<script>alert\(1\)<\/script>/);
});

test('type, status and entity filters are applied without duplicate listeners', async () => {
  const inputs = []; const page = dom(); const controller = createChannelContextController({ api: { listChannelContext: async (filters) => { inputs.push(filters); return [entry('forza', { type: 'DECISION', status: 'ACTIVE', subject: 'Forza Horizon 6' }), entry('city', { subject: 'City Car' })]; } } });
  controller.mount(page.root); controller.mount(page.root); await flush(); page.get('[data-context-type]').value = 'DECISION'; await page.get('[data-context-type]').dispatch('change'); await flush();
  assert.equal(inputs.length, 2); assert.equal(inputs[1].type, 'DECISION'); page.get('[data-context-entity]').value = 'forza'; await page.get('[data-context-entity]').dispatch('change'); await flush(); assert.equal(page.get('[data-context-list]').children.length, 1);
});

test('late detail and list responses cannot overwrite newer state or an unmounted workspace', async () => {
  const old = deferred(); const page = dom(); const controller = createChannelContextController({ api: { listChannelContext: async () => [entry('a'), entry('b')], getChannelContext: async (id) => id === 'a' ? old.promise : entry('b') } });
  controller.mount(page.root); await flush(); const rows = page.get('[data-context-list]').children; const first = page.get('[data-context-list]').dispatch('click', rows[0]); await page.get('[data-context-list]').dispatch('click', rows[1]); old.resolve(entry('a')); await first;
  assert.match(collectText(page.get('[data-context-detail]')), /Contexto b/); controller.unmount();
  const pending = deferred(); const detached = dom(); const detachedController = createChannelContextController({ api: { listChannelContext: async () => pending.promise } }); detachedController.mount(detached.root); detachedController.unmount(); pending.resolve([entry('late')]); await flush(); assert.doesNotMatch(collectText(detached.get('[data-context-list]')), /late/);
});

test('API failure remains local and does not fabricate timeline data', async () => {
  const page = dom(); createChannelContextController({ api: { listChannelContext: async () => { throw new Error('secret payload'); } } }).mount(page.root); await flush();
  assert.equal(page.get('[data-context-list]').children.length, 0); assert.match(page.get('[data-context-feedback]').textContent, /Nao foi possivel/); assert.doesNotMatch(page.get('[data-context-feedback]').textContent, /secret/);
});
