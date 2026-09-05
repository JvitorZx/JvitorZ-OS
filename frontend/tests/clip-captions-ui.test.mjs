import assert from 'node:assert/strict'; import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { createClipCaptionsViewer } from '../src/modules/clip-captions.js';
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
const data = () => ({ jobId: 'j1', available: true, reasons: [], cueCount: 1, durationMs: 6000, cues: [{ index: 1, startMs: 1000, endMs: 3000, text: 'Olá! <img src=x>\nUma vitória 🎮', sourceSegmentId: 'seg1' }], formats: ['srt', 'vtt'], warnings: ['Fala parcialmente incluída; confira o texto.'] });
const nodes = (root) => [root, ...root.children.flatMap(nodes)];
const defaults = () => ({ getClipCaptions: async () => data(), clipCaptionsDownloadUrl: (id, format) => `http://localhost:3000/api/renders/jobs/${id}/captions/${format}` });

test('caption API accepts only safe formats and uses encoded job IDs', async () => {
  const calls = []; globalThis.fetch = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({}) }; }; const api = createApiClient('http://localhost:3000'); await api.getClipCaptions('j/1'); assert.match(calls[0], /j%2F1\/captions$/); assert.match(api.clipCaptionsDownloadUrl('j/1', 'srt'), /j%2F1\/captions\/srt$/); assert.throws(() => api.clipCaptionsDownloadUrl('j1', '../secret'), TypeError); assert.throws(() => api.clipCaptionsDownloadUrl('', 'vtt'), TypeError);
});
test('caption viewer preserves Unicode and literal markup with relative timestamps', async () => {
  const container = new FakeElement(); await createClipCaptionsViewer({ api: defaults() }).load('j1', container); assert.match(collect(container), /Olá! <img src=x>/); assert.match(collect(container), /🎮/); assert.match(collect(container), /1.00 → 3.00 s/); assert.ok(!nodes(container).some((node) => node.tagName === 'IMG')); assert.match(collect(container), /parcialmente incluída/);
});
test('download links are shown only for available supported formats', async () => {
  const container = new FakeElement(); await createClipCaptionsViewer({ api: { ...defaults(), getClipCaptions: async () => ({ ...data(), formats: ['srt', 'file:///secret'] }) } }).load('j1', container); const links = nodes(container).filter((node) => node.tagName === 'A'); assert.equal(links.length, 1); assert.equal(links[0].href, 'http://localhost:3000/api/renders/jobs/j1/captions/srt');
});
test('empty transcript shows reasons and never offers empty downloads', async () => {
  const container = new FakeElement(); await createClipCaptionsViewer({ api: { ...defaults(), getClipCaptions: async () => ({ ...data(), available: false, cueCount: 0, cues: [], reasons: ['Nenhuma fala neste intervalo.'] }) } }).load('j1', container); assert.match(collect(container), /Nenhuma fala/); assert.ok(!nodes(container).some((node) => node.tagName === 'A'));
});
test('loading captions is single-flight for the same job and panel', async () => {
  const wait = deferred(); let calls = 0; const viewer = createClipCaptionsViewer({ api: { ...defaults(), getClipCaptions: async () => { calls++; return wait.promise; } } }); const container = new FakeElement(); const first = viewer.load('j1', container); await viewer.load('j1', container); assert.equal(calls, 1); wait.resolve(data()); await first; assert.match(collect(container), /Baixar SRT/);
});
test('changing jobs ignores older caption responses', async () => {
  const wait = deferred(); const viewer = createClipCaptionsViewer({ api: { ...defaults(), getClipCaptions: async (id) => id === 'j1' ? wait.promise : { ...data(), cues: [{ index: 1, startMs: 0, endMs: 1000, text: 'New job' }] } } }); const container = new FakeElement(); const old = viewer.load('j1', container); await viewer.load('j2', container); wait.resolve(data()); await old; assert.match(collect(container), /New job/); assert.doesNotMatch(collect(container), /Olá/);
});
test('unmount clear prevents a pending read from changing the detached panel', async () => {
  const wait = deferred(); const viewer = createClipCaptionsViewer({ api: { ...defaults(), getClipCaptions: async () => wait.promise } }); const container = new FakeElement(); const load = viewer.load('j1', container); viewer.clear(); wait.resolve(data()); await load; assert.doesNotMatch(collect(container), /Baixar/);
});
test('stale output errors explain refresh without exposing internal errors', async () => {
  const container = new FakeElement(); await createClipCaptionsViewer({ api: { ...defaults(), getClipCaptions: async () => { throw new Error('secret private path'); } } }).load('j1', container); assert.match(collect(container), /Atualize o trabalho/); assert.doesNotMatch(collect(container), /secret|private/);
});
test('subtitle preview is explicit and detached controls cannot activate an old job', async () => {
  const calls = [], container = new FakeElement(); const viewer = createClipCaptionsViewer({ api: defaults(), onPreview: (id) => calls.push(id) }); await viewer.load('j1', container); assert.equal(calls.length, 0); const button = nodes(container).find((node) => node.tagName === 'BUTTON'); await button.dispatch('click'); assert.deepEqual(calls, ['j1']); viewer.clear(); await button.dispatch('click'); assert.equal(calls.length, 1);
});
