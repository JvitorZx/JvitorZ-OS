import assert from 'node:assert/strict'; import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { shortsModule, createShortsController } from '../src/modules/shorts.js';
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
const row = (id = 'a1', status = 'CURRENT') => ({ id, productionId: 'p1', version: 1, status, limitations: [], candidates: [{ id: 'c1', title: '<img src=x onerror=alert(1)>', hook: '<script>attack</script>', summary: 'Um momento real', rationale: 'Evidência temporal', startMs: 1000, endMs: 11000, durationMs: 10000, status: 'CANDIDATE', score: 60, scoreFactors: { event: 30 }, risks: [] }] });
const dom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.shorts-panel', panel);
  for (const key of ['production', 'min', 'max', 'versions', 'detail', 'feedback']) panel.map.set(`[data-shorts-${key}]`, new FakeElement());
  return { root, panel, get: (key) => panel.querySelector(`[data-shorts-${key}]`) };
};
const defaultApi = () => ({ listProductions: async () => [{ id: 'p1', title: 'Vídeo' }, { id: 'p2', title: 'Outro vídeo' }], listShortAnalyses: async () => [row()], getShortAnalysis: async () => row() });
const action = (name, id) => { const button = new FakeElement('button'); button.dataset.shortsAction = name; if (id) button.dataset.clipId = id; return button; };
const start = async (api = defaultApi(), context) => { const page = dom(); const controller = createShortsController({ api }); controller.mount(page.root, context); await flush(); await flush(); return { ...page, controller }; };

test('Shorts API encodes IDs and sends explicit verbs and payloads', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([url, options]); return { ok: true, status: 200, json: async () => ({}) }; };
  const api = createApiClient('http://localhost:3000');
  await api.listShortAnalyses('p/1'); await api.getShortAnalysis('a/1'); await api.analyzeShorts('p/1', { maxDurationMs: 90000 }); await api.analyzeShorts('p/1', {}, true);
  await api.getClipCandidate('c/1'); await api.updateClipCandidate('c/1', { hook: 'Real' }); await api.createClipCandidate('a/1', { startMs: 0, endMs: 1000 });
  await api.transitionClipCandidate('c/1', 'select'); await api.getClipEvidence('c/1'); await api.reviewShortAnalysis('a/1'); await api.completeShortAnalysis('a/1'); await api.getSelectedClips('p/1'); await api.getShortRenderContract('p/1');
  assert.equal(calls.length, 13); assert.match(calls[0][0], /p%2F1$/); assert.match(calls[3][0], /regenerate$/); assert.equal(calls[5][1].method, 'PATCH'); assert.deepEqual(JSON.parse(calls[2][1].body), { maxDurationMs: 90000 });
  await assert.rejects(() => api.transitionClipCandidate('c', 'delete'), TypeError); await assert.rejects(() => api.getShortAnalysis(' '), TypeError);
});

test('workspace mounts once and respects the Production deep link', async () => {
  let loads = 0; const ids = []; const api = { ...defaultApi(), listProductions: async () => { loads++; return [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }]; }, listShortAnalyses: async (id) => { ids.push(id); return []; } };
  const page = await start(api, { route: { subpath: 'p2' } }); page.controller.mount(page.root);
  assert.equal(shortsModule.route, '/shorts'); assert.equal(shortsModule.allowSubroutes, true); assert.equal(loads, 1); assert.deepEqual(ids, ['p2']); assert.equal(page.panel.listeners.get('click').length, 1);
});

test('candidate text and evidence never become HTML', async () => {
  const page = await start({ ...defaultApi(), getClipEvidence: async () => ({ segments: [{ startMs: 1000, endMs: 2000, text: '<img src=x onerror=run()>' }] }) });
  assert.match(collect(page.get('detail')), /<script>attack<\/script>/);
  await page.panel.dispatch('click', action('evidence', 'c1'));
  assert.match(collect(page.get('detail')), /<img src=x onerror=run\(\)>/);
  const tags = []; const visit = (item) => { tags.push(item.tagName); item.children.forEach(visit); }; visit(page.get('detail'));
  assert.ok(!tags.includes('IMG') && !tags.includes('SCRIPT'));
});

test('analysis is single-flight and resume does not trigger automatic generation', async () => {
  const wait = deferred(); let calls = 0;
  const page = await start({ ...defaultApi(), analyzeShorts: async () => { calls++; return wait.promise; } });
  assert.equal(calls, 0); const first = page.panel.dispatch('click', action('analyze')); await page.panel.dispatch('click', action('analyze')); assert.equal(calls, 1);
  wait.resolve({ analysis: row(), created: false }); await first; assert.match(page.get('feedback').textContent, /retomada/);
});

test('unmounted requests cannot overwrite a newly mounted workspace', async () => {
  const wait = deferred(); const api = { ...defaultApi(), analyzeShorts: async () => wait.promise }; const page = await start(api);
  const mutation = page.panel.dispatch('click', action('analyze')); page.controller.unmount(); const next = dom(); page.controller.mount(next.root); await flush(); await flush();
  const before = collect(next.get('detail')); wait.resolve({ analysis: row('late'), created: true }); await mutation;
  assert.equal(collect(next.get('detail')), before); assert.equal(page.panel.listeners.get('click').length, 0);
});

test('switching production drops outdated read responses', async () => {
  const wait = deferred(); let reads = 0;
  const page = await start({ ...defaultApi(), listShortAnalyses: async (id) => { reads++; return id === 'p1' ? wait.promise : [{ ...row('p2-analysis'), productionId: 'p2', version: 2 }]; } });
  page.get('production').value = 'p2'; await page.get('production').dispatch('change'); wait.resolve([row()]); await flush();
  assert.equal(reads, 2); assert.match(collect(page.get('detail')), /Versão 2/); assert.doesNotMatch(collect(page.get('detail')), /Versão 1/);
});

test('stale history disables mutation controls and still allows evidence inspection', async () => {
  const page = await start({ ...defaultApi(), listShortAnalyses: async () => [row('old', 'STALE')] });
  const actions = page.get('detail').querySelectorAll('[data-shorts-action]');
  assert.ok(actions.find((item) => item.dataset.shortsAction === 'review').disabled);
  assert.ok(actions.find((item) => item.dataset.shortsAction === 'evidence'));
  assert.ok(!actions.find((item) => item.dataset.shortsAction === 'select'));
  assert.match(collect(page.get('detail')), /preservada como histórico/);
});

test('invalid duration config does not reach the server', async () => {
  let calls = 0; const page = await start({ ...defaultApi(), analyzeShorts: async () => { calls++; } });
  page.get('min').value = '50'; page.get('max').value = '10'; await page.panel.dispatch('click', action('analyze'));
  assert.equal(calls, 0); assert.match(page.get('feedback').textContent, /mínimo menor/);
});

test('manual timestamp editing converts seconds to milliseconds and persists fields', async () => {
  let sent; const page = await start({ ...defaultApi(), updateClipCandidate: async (id, input) => { sent = { id, input }; } });
  const editor = page.get('detail').querySelectorAll('[data-clip-editor]').find((item) => item.dataset.clipEditor === 'c1');
  for (const input of editor.querySelectorAll('[data-clip-field]')) if (input.dataset.clipField === 'startMs') input.value = '2.125';
  await page.panel.dispatch('click', action('save', 'c1'));
  assert.equal(sent.id, 'c1'); assert.equal(sent.input.startMs, 2125); assert.equal(sent.input.endMs, 11000); assert.equal(sent.input.hook, '<script>attack</script>');
});

test('server errors are local and do not disclose error bodies', async () => {
  const page = await start({ ...defaultApi(), analyzeShorts: async () => { throw Object.assign(new Error('secret-token'), { status: 409 }); } });
  await page.panel.dispatch('click', action('analyze'));
  assert.match(page.get('feedback').textContent, /fonte temporal atual/); assert.doesNotMatch(page.get('feedback').textContent, /secret/);
});
