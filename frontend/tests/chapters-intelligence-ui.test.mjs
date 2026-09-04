import assert from 'node:assert/strict'; import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js'; import { chaptersModule, createChaptersController } from '../src/modules/chapters.js';

class FakeElement {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.attributes = new Map(); this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.dataset = {}; }
  querySelector(selector) { if (this.map.has(selector)) return this.map.get(selector); const data = selector.match(/^\[data-([\w-]+)\]$/); if (!data) return null; const key = data[1].replace(/-([a-z])/g, (_, value) => value.toUpperCase()); const visit = (item) => item.children.find((child) => child.dataset?.[key] !== undefined) ?? item.children.map(visit).find(Boolean); return visit(this); }
  querySelectorAll(selector) { const data = selector.match(/^\[data-([\w-]+)\]$/); if (!data) return []; const key = data[1].replace(/-([a-z])/g, (_, value) => value.toUpperCase()); const found = []; const visit = (item) => { for (const child of item.children) { if (child.dataset?.[key] !== undefined) found.push(child); visit(child); } }; visit(this); return found; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; this.textContent = ''; }
  closest(selector) { for (const part of selector.split(',')) { const data = part.trim().match(/^\[data-([\w-]+)\]$/); if (data) { const key = data[1].replace(/-([a-z])/g, (_, value) => value.toUpperCase()); if (this.dataset[key] !== undefined) return this; } } return null; }
  async dispatch(type, target = this) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target, preventDefault() {} }))); }
}
const originalDocument = globalThis.document; const originalFetch = globalThis.fetch; const originalNavigator = globalThis.navigator;
globalThis.document = { createElement: (tag) => new FakeElement(tag) }; Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
afterEach(() => { globalThis.fetch = originalFetch; }); process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true }); });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0)); const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }; const collect = (item) => `${item.textContent}${item.children.map(collect).join('')}`;
const chapterSet = (id = 'set-1') => ({ id, version: 1, status: 'DRAFT', production: { title: '<img src=x onerror=alert(1)>' }, entries: [{ id: 'entry-1', startMs: 0, title: '<script>alert(1)</script>', rationale: 'Mudanca real', segmentStartPosition: 0, segmentEndPosition: 1 }] });
const dom = () => { const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.chapters-panel', panel); for (const selector of ['[data-chapters-production]', '[data-chapters-format]', '[data-chapters-content]', '[data-chapters-versions]', '[data-chapters-detail]', '[data-chapters-feedback]']) panel.map.set(selector, new FakeElement(selector.includes('production') ? 'select' : 'div')); return { root, panel, get: (selector) => panel.querySelector(selector) }; };

test('central API client exposes the complete Chapters HTTP surface', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: options.method === 'POST' ? 201 : 200, json: async () => ({}) }; }; const api = createApiClient('http://localhost:3000');
  await api.importTimedTranscript({ productionId: 'p/1', format: 'SBV', content: 'x' }); await api.getTimedTranscript('t/1'); await api.getProductionTranscript('p/1'); await api.listChapterVersions('p/1'); await api.generateChapters('p/1'); await api.generateChapters('p/1', true); await api.getChapterVersion('s/1'); await api.updateChapterVersion('s/1', []); await api.addChapter('s/1', { startMs: 0, title: 'Inicio' }); await api.removeChapter('s/1', 'e/1'); await api.selectChapterVersion('s/1'); await api.formatChapterVersion('s/1');
  assert.equal(calls.length, 12); assert.match(calls[0][0], /api\/chapters\/transcripts$/); assert.match(calls[5][0], /regenerate$/); assert.match(calls[6][0], /s%2F1/); await assert.rejects(() => api.getChapterVersion(' '), TypeError);
});

test('Chapters is a fullscreen lifecycle module and loads productions once', async () => {
  const page = dom(); let loads = 0; const controller = createChaptersController({ api: { listProductions: async () => { loads += 1; return []; } } }); controller.mount(page.root); controller.mount(page.root); await flush(); assert.equal(chaptersModule.route, '/chapters'); assert.equal(chaptersModule.fullscreen, true); assert.equal(loads, 1); assert.equal(page.panel.listeners.get('click').length, 1);
});

test('persisted chapter titles and evidence are rendered only as literal text', async () => {
  const page = dom(); const controller = createChaptersController({ api: { listProductions: async () => [{ id: 'p1', title: 'Video' }], listChapterVersions: async () => [chapterSet()] } }); controller.mount(page.root); await flush(); await flush(); const rendered = collect(page.get('[data-chapters-detail]')); assert.match(rendered, /<img src=x onerror=alert\(1\)>/); assert.match(rendered, /<script>alert\(1\)<\/script>/);
});

test('generation is single-flight and does not duplicate requests', async () => {
  const page = dom(); const wait = deferred(); let generated = 0; const api = { listProductions: async () => [{ id: 'p1', title: 'Video' }], listChapterVersions: async () => [], generateChapters: async () => { generated += 1; return wait.promise; } }; const controller = createChaptersController({ api }); controller.mount(page.root); await flush(); await flush(); const target = new FakeElement('button'); target.dataset.chaptersAction = 'generate'; const first = page.panel.dispatch('click', target); await page.panel.dispatch('click', target); assert.equal(generated, 1); wait.resolve({ created: true, chapterSet: chapterSet() }); await first;
});

test('late responses after unmount cannot alter the detached workspace', async () => {
  const wait = deferred(); const page = dom(); const controller = createChaptersController({ api: { listProductions: async () => wait.promise } }); controller.mount(page.root); controller.unmount(); wait.resolve([{ id: 'p1', title: 'Late' }]); await flush(); assert.equal(page.get('[data-chapters-production]').children.length, 0);
});

test('API failure remains local and creates no false chapter state', async () => {
  const page = dom(); createChaptersController({ api: { listProductions: async () => { throw new Error('private token'); } } }).mount(page.root); await flush(); assert.match(page.get('[data-chapters-feedback]').textContent, /Nao foi possivel/); assert.doesNotMatch(page.get('[data-chapters-feedback]').textContent, /private|token/);
});
