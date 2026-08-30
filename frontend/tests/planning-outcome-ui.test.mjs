import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { createStrategicPlanningController, strategicPlanningModule } from '../src/modules/strategic-planning.js';

const datasetKey = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.attributes = new Map();
    this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false;
    this.value = ''; this.selected = false; this.dataset = {}; this.type = '';
  }
  querySelector(selector) {
    if (this.map.has(selector)) return this.map.get(selector);
    const match = selector.match(/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/);
    if (!match) return null;
    const key = datasetKey(match[1]); const expected = match[2];
    return this.walk().find((element) => key in element.dataset && (expected === undefined || element.dataset[key] === expected)) ?? null;
  }
  *walk() { for (const child of this.children) { yield child; yield* child.walk(); } }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
  closest(selector) {
    const match = selector.match(/^\[data-([a-z-]+)\]$/); const key = match ? datasetKey(match[1]) : '';
    return key && key in this.dataset ? this : null;
  }
  async dispatch(type, target = this) {
    await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target, preventDefault() {} })));
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise((ok) => { resolve = ok; }); return { promise, resolve }; };
const collectText = (element) => `${element.textContent}${element.children.map(collectText).join('')}`;
const completedItem = (id = 'item-1') => ({
  id, planId: 'plan-1', candidateKey: id, candidateType: 'TOPIC', title: `Item ${id}`, rationale: 'Motivo',
  status: 'COMPLETED', priority: 'HIGH', effort: 'MEDIUM', readiness: 'READY', queue: 'DONE', position: 1,
  executionScore: 80, manualPriority: false, executionState: 'completed', executionAction: 'Executar', executionConfidence: 0.8,
  executionContext: {}, evidence: [], risks: [], constraints: [], missingData: [], dependencies: [],
});
const plan = (items = [completedItem()]) => ({
  id: 'plan-1', horizon: 'TODAY', status: 'READY', summary: 'Plan', balance: {}, constraints: [], risks: [],
  generatedAt: '2026-09-06T08:00:00.000Z', items, history: [],
});
const outcome = (overrides = {}) => ({
  id: 'outcome-1', classification: 'ABOVE_REFERENCE', confidence: 0.76, dataQuality: 'HIGH', freshness: 'RECENT',
  windowStart: '2026-08-23T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z', metrics: { views: 300 },
  benchmark: { comparableVideos: 2 }, evidence: [{ classification: 'fact', summary: '<script>alert(1)</script>' }],
  limitations: ['Comparacao observacional nao demonstra causalidade.'], ...overrides,
});
const bundle = (itemId = 'item-1', activeLink = null) => ({ itemId, planId: 'plan-1', executionState: 'completed', activeLink, links: activeLink ? [activeLink] : [], audit: [] });
const link = (overrides = {}) => ({
  id: 'link-1', itemId: 'item-1', videoId: 'video-1', videoTitle: '<img src=x onerror=alert(1)>',
  linkedAt: '2026-09-06T10:00:00.000Z', outcomes: [outcome()], auditEvents: [], ...overrides,
});
const createDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.strategic-planning-panel', panel);
  for (const selector of ['[data-planning-generate-form]', '[data-planning-horizon]', '[data-planning-generate]', '[data-planning-feedback]', '[data-planning-meta]', '[data-planning-now]', '[data-planning-queue]', '[data-planning-detail]', '[data-planning-execution-history]', '[data-planning-outcomes]']) panel.map.set(selector, new FakeElement());
  panel.querySelector('[data-planning-horizon]').value = 'TODAY';
  return { root, panel, get: (selector) => panel.querySelector(selector) };
};

const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; globalThis.fetch = originalFetch; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });

test('central client exposes all planning outcome contracts with strict identifiers', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => ({
    ok: true, status: options.method === 'POST' ? 201 : 200,
    async json() { calls.push([String(url), options]); return {}; },
  });
  const api = createApiClient('http://localhost:3000');
  await api.listPlanningVideoCandidates('item/1'); await api.getPlanningItemOutcome('item/1');
  await api.associatePlanningVideo('item/1', { snapshotId: 'snapshot-1' }); await api.unlinkPlanningVideo('item/1', 'Correction');
  await api.capturePlanningOutcome('item/1'); await api.getPlanningOutcome('outcome/1');
  assert.deepEqual(calls.map(([url]) => url), [
    'http://localhost:3000/api/planning/items/item%2F1/video-candidates',
    'http://localhost:3000/api/planning/items/item%2F1/outcome',
    'http://localhost:3000/api/planning/items/item%2F1/outcome/video',
    'http://localhost:3000/api/planning/items/item%2F1/outcome/video',
    'http://localhost:3000/api/planning/items/item%2F1/outcomes',
    'http://localhost:3000/api/planning/outcomes/outcome%2F1',
  ]);
  assert.equal(calls[2][1].method, 'POST'); assert.equal(calls[3][1].method, 'DELETE'); assert.equal(calls[4][1].body, '{}');
  await assert.rejects(() => api.getPlanningItemOutcome(' '), TypeError);
  await assert.rejects(() => api.unlinkPlanningVideo('item', ''), TypeError);
});

test('Planning exposes a clear Results area and renders persisted content as literal text', async () => {
  assert.match(strategicPlanningModule.render(), /data-planning-outcomes/);
  const dom = createDom();
  createStrategicPlanningController({ api: {
    getCurrentContentPlan: async () => plan(), listPlanningExecutionHistory: async () => [],
    getPlanningItemOutcome: async () => bundle('item-1', link()), listPlanningVideoCandidates: async () => [],
  } }).mount(dom.root);
  await flush(); const row = dom.get('[data-planning-queue]').children[4].children[1];
  await dom.get('[data-planning-queue]').dispatch('click', row.children[3].children.find((child) => child.dataset.planningOpen)); await flush();
  const rendered = dom.get('[data-planning-outcomes]'); const content = collectText(rendered);
  assert.match(content, /PlanejadoExecutadoPublicadoResultado/); assert.match(content, /<img src=x onerror=alert\(1\)>/);
  assert.match(content, /<script>alert\(1\)<\/script>/); assert.equal(rendered.querySelector('[data-planning-video-candidate="item-1"]').children.length, 1);
});

test('association is explicit, sends no title/content and repeated clicks stay single-flight', async () => {
  const pending = deferred(); let calls = 0; let currentBundle = bundle(); const dom = createDom();
  const api = {
    getCurrentContentPlan: async () => plan(), listPlanningExecutionHistory: async () => [],
    getPlanningItemOutcome: async () => currentBundle,
    listPlanningVideoCandidates: async () => [{ snapshotId: 'snapshot-1', videoId: 'video-1', title: 'Video', format: 'LONG_FORM', linkedItemId: null }],
    associatePlanningVideo: async (_itemId, input) => { calls += 1; assert.deepEqual(input, { snapshotId: 'snapshot-1' }); await pending.promise; currentBundle = bundle('item-1', link({ outcomes: [] })); return {}; },
  };
  createStrategicPlanningController({ api }).mount(dom.root); await flush();
  const row = dom.get('[data-planning-queue]').children[4].children[1]; await dom.get('[data-planning-queue]').dispatch('click', row.children[3].children.find((child) => child.dataset.planningOpen)); await flush();
  const results = dom.get('[data-planning-outcomes]'); const select = results.querySelector('[data-planning-video-candidate="item-1"]'); select.value = 'snapshot-1';
  const save = results.querySelector('[data-planning-outcome-link]');
  const first = results.dispatch('click', save); const second = results.dispatch('click', save); await flush(); assert.equal(calls, 1);
  pending.resolve(); await Promise.all([first, second]); await flush(); assert.match(collectText(results), /Video ID: video-1/);
});

test('late outcome response after selecting another item or unmount is ignored', async () => {
  const late = deferred(); const dom = createDom(); const controller = createStrategicPlanningController({ api: {
    getCurrentContentPlan: async () => plan([completedItem('a'), { ...completedItem('b'), position: 2 }]),
    listPlanningExecutionHistory: async () => [], listPlanningVideoCandidates: async () => [],
    getPlanningItemOutcome: async (id) => id === 'a' ? late.promise : bundle('b', link({ itemId: 'b', videoTitle: 'Video B' })),
  } });
  controller.mount(dom.root); await flush(); const done = dom.get('[data-planning-queue]').children[4];
  await dom.get('[data-planning-queue]').dispatch('click', done.children[1].children[3].children.find((child) => child.dataset.planningOpen));
  await dom.get('[data-planning-queue]').dispatch('click', done.children[2].children[3].children.find((child) => child.dataset.planningOpen)); await flush();
  late.resolve(bundle('a', link({ itemId: 'a', videoTitle: 'Late A' }))); await flush(); assert.match(collectText(dom.get('[data-planning-outcomes]')), /Video B/);
  controller.unmount(); assert.equal(dom.get('[data-planning-outcomes]').listeners.get('click')?.length ?? 0, 0);
});
