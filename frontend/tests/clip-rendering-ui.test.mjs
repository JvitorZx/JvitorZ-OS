import assert from 'node:assert/strict'; import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { rendersModule, createRendersController } from '../src/modules/renders.js';
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
const clip = (id = 'c1') => ({ id, status: 'SELECTED', title: '<img src=x onerror=run()>', analysis: { productionId: 'p1' } });
const job = (status = 'QUEUED', id = 'j1') => ({ id, candidateId: 'c1', productionId: 'p1', status, layout: 'FIT', attempt: 1, progress: 10, previewUrl: status === 'SUCCEEDED' ? '/api/renders/jobs/j1/preview' : null, outputMetadata: status === 'SUCCEEDED' ? { width: 720, height: 1280, durationMs: 5000, videoCodec: 'h264', hasAudio: true } : null });
const defaults = () => ({ renderHealth: async () => ({ available: true }), listProductions: async () => [{ id: 'p1', title: 'Production' }, { id: 'p2', title: 'Other' }], listShortAnalyses: async () => [{ status: 'CURRENT', candidates: [clip()] }], getClipCandidate: async (id) => clip(id), renderPreflight: async (id) => ({ eligible: true, reasons: [], productionId: 'p1', candidateId: id, clip: { title: clip().title, startMs: 0, endMs: 5000 } }), listRenderJobs: async () => [job()], renderPreviewUrl: (id) => `http://localhost:3000/api/renders/jobs/${id}/preview` });
const dom = () => { const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.renders-panel', panel); for (const key of ['production','candidate','layout','preflight','jobs','detail','feedback','health','enqueue']) panel.map.set(`[data-render-${key}]`, new FakeElement()); return { root, panel, get: (key) => panel.querySelector(`[data-render-${key}]`) }; };
const action = (name, id) => { const node = new FakeElement('button'); node.dataset.renderAction = name; if (id) node.dataset.jobId = id; return node; };
const nodes = (root) => [root, ...root.children.flatMap(nodes)];
const start = async (api = defaults(), context = {}) => { const page = dom(); const scheduled = new Map(); let counter = 0; const controller = createRendersController({ api, schedule: (callback) => { scheduled.set(++counter, callback); return counter; }, unschedule: (id) => scheduled.delete(id) }); controller.mount(page.root, context); await flush(); await flush(); return { ...page, controller, scheduled }; };

test('render API exposes explicit enqueue/cancel/retry and ID preview without local paths', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([url, options]); return { ok: true, status: 200, json: async () => ({}) }; }; const api = createApiClient('http://localhost:3000');
  await api.renderHealth(); await api.renderPreflight('c/1'); await api.listRenderJobs('p/1'); await api.getRenderJob('j/1'); await api.enqueueRender({ candidateId: 'c1', layout: 'FIT' }); await api.cancelRenderJob('j1'); await api.retryRenderJob('j1');
  assert.equal(calls.length, 7); assert.match(calls[1][0], /c%2F1\/preflight$/); assert.match(calls[2][0], /productionId=p%2F1$/); assert.equal(calls[4][1].method, 'POST'); assert.deepEqual(JSON.parse(calls[4][1].body), { candidateId: 'c1', layout: 'FIT' }); assert.equal(calls[5][1].body, '{}'); assert.match(api.renderPreviewUrl('j/1'), /j%2F1\/preview$/); assert.throws(() => api.renderPreviewUrl(''), TypeError);
});
test('render workspace accepts candidate deeplink and mounts one handler', async () => {
  const page = await start(defaults(), { route: { subpath: 'c1' } }); page.controller.mount(page.root); assert.equal(page.get('candidate').value, 'c1'); assert.equal(page.get('enqueue').disabled, false); assert.equal(page.panel.listeners.get('click').length, 1); assert.equal(rendersModule.route, '/renders'); assert.equal(rendersModule.allowSubroutes, true); assert.equal(page.scheduled.size, 1);
});
test('preflight renders literal title and blocks unavailable candidate', async () => {
  const page = await start({ ...defaults(), renderPreflight: async () => ({ eligible: false, reasons: ['Conclua a seleção'], clip: { title: clip().title, startMs: 0, endMs: 5000 } }) }); assert.equal(page.get('enqueue').disabled, true); assert.match(collect(page.get('preflight')), /<img/); assert.match(collect(page.get('preflight')), /Conclua a seleção/); assert.ok(!nodes(page.get('preflight')).some((node) => node.tagName === 'IMG'));
});
test('render enqueue is single-flight and honors explicit central crop', async () => {
  const wait = deferred(), calls = []; const page = await start({ ...defaults(), enqueueRender: async (input) => { calls.push(input); return wait.promise; } }); page.get('layout').value = 'CENTER_CROP';
  const first = page.panel.dispatch('click', action('enqueue')); await page.panel.dispatch('click', action('enqueue')); assert.deepEqual(calls, [{ candidateId: 'c1', layout: 'CENTER_CROP' }]); assert.equal(page.get('production').disabled, true); wait.resolve({ job: job(), created: true }); await first; assert.match(page.get('feedback').textContent, /Trabalho registrado/); assert.equal(page.get('production').disabled, false);
});
test('only succeeded output can produce a video preview and URL comes from job ID', async () => {
  const page = await start({ ...defaults(), listRenderJobs: async () => [job('SUCCEEDED')] }); await page.panel.dispatch('click', action('open', 'j1')); const video = nodes(page.get('detail')).find((node) => node.tagName === 'VIDEO'); assert.equal(video.src, 'http://localhost:3000/api/renders/jobs/j1/preview'); assert.match(collect(page.get('detail')), /720 × 1280/); page.controller.unmount(); assert.equal(video.attributes.has('src'), false);
  const failed = await start({ ...defaults(), listRenderJobs: async () => [{ ...job('FAILED'), errorCode: 'SOURCE_CHANGED', previewUrl: 'file:///private' }] }); await failed.panel.dispatch('click', action('open', 'j1')); assert.ok(!nodes(failed.get('detail')).some((node) => node.tagName === 'VIDEO')); assert.match(collect(failed.get('detail')), /Tentar novamente/);
});
test('cancel and retry require explicit actions', async () => {
  const calls = []; const page = await start({ ...defaults(), cancelRenderJob: async (id) => { calls.push(['cancel', id]); return job('CANCELLED'); }, retryRenderJob: async (id) => { calls.push(['retry', id]); return { job: job('QUEUED', 'j2'), created: true }; } }); assert.equal(calls.length, 0); await page.panel.dispatch('click', action('cancel', 'j1')); await page.panel.dispatch('click', action('retry', 'j1')); assert.deepEqual(calls, [['cancel', 'j1'], ['retry', 'j1']]);
});
test('stale preflight cannot enable a newly selected unavailable candidate', async () => {
  const wait = deferred(); const page = await start(); const api = defaults(); api.renderPreflight = async (id) => id === 'c2' ? wait.promise : { eligible: false, reasons: ['Bloqueado'], clip: { title: 'Latest', startMs: 0, endMs: 5000 } }; const next = await start(api); next.get('candidate').value = 'c2'; const old = next.get('candidate').dispatch('change'); next.get('candidate').value = 'c3'; await next.get('candidate').dispatch('change'); wait.resolve({ eligible: true, clip: { title: 'Old', startMs: 0, endMs: 5000 } }); await old; assert.equal(next.get('enqueue').disabled, true); assert.match(collect(next.get('preflight')), /Latest/); assert.doesNotMatch(collect(next.get('preflight')), /Old/); page.controller.unmount();
});
test('polling updates active work and does not recreate unchanged finished video', async () => {
  let state = job(); const page = await start({ ...defaults(), listRenderJobs: async () => [state] }); await page.panel.dispatch('click', action('open', 'j1')); state = job('SUCCEEDED'); const tick = [...page.scheduled.values()][0]; await tick(); assert.match(collect(page.get('detail')), /Concluído/); const video = nodes(page.get('detail')).find((node) => node.tagName === 'VIDEO'); await [...page.scheduled.values()][0](); assert.equal(nodes(page.get('detail')).find((node) => node.tagName === 'VIDEO'), video);
});
test('unmount cancels polling and ignores delayed setup', async () => {
  const wait = deferred(); const page = await start({ ...defaults(), renderHealth: async () => wait.promise }); page.controller.unmount(); wait.resolve({ available: true }); await flush(); assert.equal(page.scheduled.size, 0); assert.equal(page.get('production').children.length, 0); assert.equal(page.panel.listeners.get('click').length, 0);
});
test('renderer absence and failures remain explicit without exposing internals', async () => {
  const absent = await start({ ...defaults(), renderHealth: async () => ({ available: false }) }); assert.match(absent.get('health').textContent, /não está disponível/); assert.equal(absent.get('enqueue').disabled, true);
  const page = await start({ ...defaults(), enqueueRender: async () => { throw new Error('private token D:/secret'); } }); await page.panel.dispatch('click', action('enqueue')); assert.match(page.get('feedback').textContent, /operação não pôde/); assert.doesNotMatch(page.get('feedback').textContent, /secret|token/);
});
