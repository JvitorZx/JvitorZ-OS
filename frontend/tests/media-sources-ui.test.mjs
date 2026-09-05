import assert from 'node:assert/strict'; import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { mediaModule, createMediaController } from '../src/modules/media.js';
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
const source = (id = 's1', status = 'READY') => ({ id, libraryItemId: 'l1', title: '<img src=x onerror=run()>', relativePath: 'video.mp4', status, sizeBytes: '1024', durationMs: 6000, width: 320, height: 180, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, productions: [{ productionId: 'p1', role: 'EDITED_VIDEO' }] });
const dom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.media-panel', panel);
  for (const key of ['form', 'root', 'path', 'title', 'production', 'role', 'list', 'detail', 'feedback', 'health', 'submit']) panel.map.set(`[data-media-${key}]`, new FakeElement());
  return { root, panel, get: (key) => panel.querySelector(`[data-media-${key}]`) };
};
const defaults = () => ({ mediaHealth: async () => ({ available: true }), listMediaRoots: async () => [{ id: 'r1', label: 'Mídia local' }], listProductions: async () => [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }], listMediaSources: async () => [source()], getMediaSource: async (id) => source(id), mediaPreviewUrl: (id) => `http://localhost:3000/api/media/sources/${id}/preview` });
const action = (name, id) => { const node = new FakeElement('button'); node.dataset.mediaAction = name; if (id) node.dataset.sourceId = id; return node; };
const start = async (api = defaults(), context = {}) => { const page = dom(); const controller = createMediaController({ api }); controller.mount(page.root, context); await flush(); await flush(); return { ...page, controller }; };

test('media client exposes safe ID-based preview and explicit register/reprobe payloads', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([url, options]); return { ok: true, status: 200, json: async () => ({}) }; };
  const api = createApiClient('http://localhost:3000'); await api.mediaHealth(); await api.listMediaRoots(); await api.listMediaSources(); await api.getMediaSource('s/1'); await api.registerMediaSource({ rootId: 'r1', relativePath: 'a.mp4' }); await api.reprobeMediaSource('s/1');
  assert.equal(calls.length, 6); assert.match(calls[3][0], /s%2F1$/); assert.equal(calls[4][1].method, 'POST'); assert.deepEqual(JSON.parse(calls[4][1].body), { rootId: 'r1', relativePath: 'a.mp4' }); assert.match(api.mediaPreviewUrl('s/1'), /s%2F1\/preview$/);
  assert.throws(() => api.mediaPreviewUrl(' '), TypeError);
});
test('media lifecycle mounts once and carries the selected Production context', async () => {
  let loads = 0; const page = await start({ ...defaults(), listMediaRoots: async () => { loads++; return [{ id: 'r1', label: 'Local' }]; } }, { route: { subpath: 'p2' } }); page.controller.mount(page.root);
  assert.equal(loads, 1); assert.equal(page.panel.listeners.get('click').length, 1); assert.equal(page.get('production').value, 'p2'); assert.equal(mediaModule.route, '/media'); assert.equal(mediaModule.allowSubroutes, true);
});
test('source titles render as literal text and ready preview uses ID only', async () => {
  const page = await start(); await page.panel.dispatch('click', action('open', 's1')); assert.match(collect(page.get('detail')), /<img src=x onerror=run\(\)>/);
  const elements = []; const visit = (node) => { elements.push(node); node.children.forEach(visit); }; visit(page.get('detail'));
  assert.ok(!elements.some((node) => node.tagName === 'IMG')); const video = elements.find((node) => node.tagName === 'VIDEO'); assert.equal(video.src, 'http://localhost:3000/api/media/sources/s1/preview'); assert.equal(video.preload, 'metadata');
});
test('changed sources have no preview element and request another inspection', async () => {
  const page = await start({ ...defaults(), getMediaSource: async () => source('s1', 'CHANGED') }); await page.panel.dispatch('click', action('open', 's1'));
  assert.match(collect(page.get('detail')), /Arquivo alterado/); assert.match(collect(page.get('detail')), /visualização fica indisponível/);
  const tags = []; const visit = (node) => { tags.push(node.tagName); node.children.forEach(visit); }; visit(page.get('detail')); assert.ok(!tags.includes('VIDEO'));
});
test('registration remains single-flight and sends relative path with Production role', async () => {
  const wait = deferred(); const calls = []; const page = await start({ ...defaults(), registerMediaSource: async (input) => { calls.push(input); return wait.promise; } });
  page.get('path').value = 'episodio/a.mp4'; page.get('production').value = 'p2'; page.get('role').value = 'RAW_VIDEO';
  const first = page.get('form').dispatch('submit'); await page.get('form').dispatch('submit'); assert.equal(calls.length, 1); assert.deepEqual(calls[0], { rootId: 'r1', relativePath: 'episodio/a.mp4', productionId: 'p2', role: 'RAW_VIDEO' });
  wait.resolve({ source: source(), created: true }); await first; assert.match(page.get('feedback').textContent, /conectado à Biblioteca/);
});
test('late source response cannot overwrite another selection', async () => {
  const wait = deferred(); const page = await start({ ...defaults(), getMediaSource: async (id) => id === 's1' ? wait.promise : { ...source(id), title: 'Newest' } });
  const old = page.panel.dispatch('click', action('open', 's1')); await page.panel.dispatch('click', action('open', 's2')); wait.resolve({ ...source(), title: 'Old' }); await old;
  assert.match(collect(page.get('detail')), /Newest/); assert.doesNotMatch(collect(page.get('detail')), /Old/);
});
test('unmount removes handlers and ignores late setup responses', async () => {
  const wait = deferred(); const page = dom(); const controller = createMediaController({ api: { ...defaults(), listMediaRoots: async () => wait.promise } }); controller.mount(page.root); controller.unmount(); wait.resolve([{ id: 'r1', label: 'Late' }]); await flush();
  assert.equal(page.get('root').children.length, 0); assert.equal(page.get('form').listeners.get('submit').length, 0); assert.equal(page.panel.listeners.get('click').length, 0);
});
test('reprobe communicates source invalidation without claiming rendering', async () => {
  const page = await start({ ...defaults(), reprobeMediaSource: async () => ({ source: source(), changed: true }) }); await page.panel.dispatch('click', action('open', 's1')); await page.panel.dispatch('click', action('reprobe', 's1'));
  assert.match(page.get('feedback').textContent, /precisam de nova revisão/); assert.doesNotMatch(page.get('feedback').textContent, /renderizado/);
});
test('capability absence and API errors stay explicit and do not expose internals', async () => {
  const page = await start({ ...defaults(), mediaHealth: async () => ({ available: false }), registerMediaSource: async () => { throw Object.assign(new Error('private path/token'), { status: 400 }); } });
  assert.match(page.get('health').textContent, /não está disponível/); page.get('path').value = '../secret'; await page.get('form').dispatch('submit'); assert.match(page.get('feedback').textContent, /caminho relativo/); assert.doesNotMatch(page.get('feedback').textContent, /private|token/);
});
