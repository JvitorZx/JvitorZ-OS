import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { createStrategicPlanningController, strategicPlanningModule } from '../src/modules/strategic-planning.js';
import { plannerModule } from '../src/modules/planner.js';
import { supervisorModule } from '../src/modules/supervisor.js';

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.attributes = new Map();
    this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false;
    this.value = ''; this.selected = false; this.dataset = {}; this.type = '';
  }
  querySelector(selector) { return this.map.get(selector) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
  closest(selector) {
    const key = ({
      '[data-planning-open]': 'planningOpen', '[data-planning-move]': 'planningMove',
      '[data-planning-complete]': 'planningComplete', '[data-planning-pause]': 'planningPause',
    })[selector];
    return key && this.dataset[key] ? this : null;
  }
  async dispatch(type, target = this) {
    await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target, preventDefault() {} })));
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const collectText = (element) => `${element.textContent}${element.children.map(collectText).join('')}`;
const evidence = (freshness = 'RECENT') => ({ classification: 'fact', source: 'internal', summary: '<b>evidência real</b>', confidence: 0.8, freshness });
const item = (id, queue = 'NEXT', overrides = {}) => ({
  id, planId: 'plan-1', candidateKey: id, candidateType: 'TOPIC', title: `Item ${id}`, rationale: `Motivo ${id}`,
  status: queue === 'DONE' ? 'COMPLETED' : queue === 'BLOCKED' ? 'BLOCKED' : 'READY', priority: 'HIGH', effort: 'MEDIUM',
  readiness: queue === 'BLOCKED' ? 'BLOCKED' : 'READY', queue, position: 1, executionScore: 75, manualPriority: false,
  evidence: [evidence()], risks: [], constraints: [], missingData: [], dependencies: [], ...overrides,
});
const plan = (items = [item('next')], overrides = {}) => ({
  id: 'plan-1', horizon: 'NEXT_7_DAYS', status: 'READY', summary: 'Plano atual', balance: {}, constraints: [], risks: [],
  generatedAt: '2026-09-04T12:00:00.000Z', items, history: [], ...overrides,
});
const createDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.strategic-planning-panel', panel);
  for (const selector of ['[data-planning-generate-form]', '[data-planning-horizon]', '[data-planning-generate]', '[data-planning-feedback]', '[data-planning-meta]', '[data-planning-now]', '[data-planning-queue]', '[data-planning-detail]']) panel.map.set(selector, new FakeElement());
  panel.querySelector('[data-planning-horizon]').value = 'NEXT_7_DAYS';
  return { root, panel, get: (selector) => panel.querySelector(selector) };
};

const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; globalThis.fetch = originalFetch; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });

test('central API client uses every Strategic Planning HTTP contract safely', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: options.method === 'POST' ? 201 : 200, async json() { return {}; } }; };
  const api = createApiClient('http://localhost:3000');
  await api.getCurrentContentPlan({ horizon: 'TODAY' }); await api.generateContentPlan({ horizon: 'TODAY' });
  await api.createPlannedContentItem({ planId: 'p1' }); await api.updatePlannedContentItem('i/1', { priority: 'HIGH' });
  await api.completePlannedContentItem('i/1'); await api.reorderContentPlan('p1', ['i1', 'i2'], 'Ordem manual');
  await api.listPlanningHistory({ planId: 'p1', limit: 10 }); await api.getContentPlan('p/1');
  assert.deepEqual(calls.map(([url]) => url), [
    'http://localhost:3000/api/planning/current?horizon=TODAY', 'http://localhost:3000/api/planning/generate',
    'http://localhost:3000/api/planning/items', 'http://localhost:3000/api/planning/items/i%2F1',
    'http://localhost:3000/api/planning/items/i%2F1/complete', 'http://localhost:3000/api/planning/reorder',
    'http://localhost:3000/api/planning/history?planId=p1&limit=10', 'http://localhost:3000/api/planning/p%2F1',
  ]);
  assert.equal(calls[5][1].body, '{"planId":"p1","itemIds":["i1","i2"],"reason":"Ordem manual"}');
  await assert.rejects(() => api.getContentPlan(' '), TypeError);
  await assert.rejects(() => api.reorderContentPlan('p1', [], 'x'), TypeError);
});

test('Planning is a lifecycle-enabled fullscreen module with accessible local feedback', () => {
  const markup = strategicPlanningModule.render();
  assert.equal(strategicPlanningModule.fullscreen, true); assert.match(markup, /data-planning-queue/);
  assert.match(markup, /aria-live="polite"/); assert.doesNotMatch(markup, /statePanel/);
});

test('loads the current plan and renders NEXT, BLOCKED and DONE groups', async () => {
  const data = plan([item('a', 'NEXT', { position: 1 }), item('b', 'BLOCKED', { position: 2 }), item('c', 'DONE', { position: 3 })]);
  const dom = createDom(); createStrategicPlanningController({ api: { getCurrentContentPlan: async () => data } }).mount(dom.root); await flush();
  assert.equal(dom.get('[data-planning-now]').children[0].children[0].textContent, 'Item a');
  const groups = dom.get('[data-planning-queue]').children; assert.equal(groups.length, 5);
  assert.equal(groups[0].children[0].textContent, 'NEXT · 1'); assert.equal(groups[3].children[0].textContent, 'BLOCKED · 1'); assert.equal(groups[4].children[0].textContent, 'DONE · 1');
});

test('renders an honest empty state for a missing current plan', async () => {
  const error = Object.assign(new Error('missing'), { status: 404 }); const dom = createDom();
  createStrategicPlanningController({ api: { getCurrentContentPlan: async () => { throw error; } } }).mount(dom.root); await flush();
  assert.match(dom.get('[data-planning-now]').children[0].textContent, /Nenhum plano ativo/);
  assert.equal(dom.get('[data-planning-feedback]').hidden, true);
});

test('generates one plan while busy and renders only the persisted response', async () => {
  const pending = deferred(); let calls = 0; const dom = createDom();
  const api = { getCurrentContentPlan: async () => { throw Object.assign(new Error(), { status: 404 }); }, generateContentPlan: async () => { calls += 1; return pending.promise; } };
  createStrategicPlanningController({ api }).mount(dom.root); await flush();
  const first = dom.get('[data-planning-generate-form]').dispatch('submit'); const second = dom.get('[data-planning-generate-form]').dispatch('submit');
  await flush(); assert.equal(calls, 1); assert.equal(dom.get('[data-planning-generate]').disabled, true);
  pending.resolve(plan()); await Promise.all([first, second]); assert.equal(dom.get('[data-planning-now]').children[0].children[0].textContent, 'Item next');
});

test('a late initial load cannot replace a newly generated plan', async () => {
  const initial = deferred(); const dom = createDom();
  const generated = plan([item('generated')]);
  createStrategicPlanningController({
    api: { getCurrentContentPlan: async () => initial.promise, generateContentPlan: async () => generated },
  }).mount(dom.root);
  await dom.get('[data-planning-generate-form]').dispatch('submit');
  initial.resolve(plan([item('old')])); await flush();
  assert.equal(dom.get('[data-planning-now]').children[0].children[0].textContent, 'Item generated');
});

test('complete, pause and reprioritize delegate once and apply backend responses', async () => {
  const rows = [item('complete', 'NEXT', { position: 1 }), item('pause', 'LATER', { position: 2 }), item('priority', 'LATER', { position: 3 })];
  const calls = []; const dom = createDom();
  const api = {
    getCurrentContentPlan: async () => plan(rows),
    completePlannedContentItem: async (id) => { calls.push(['complete', id]); return { ...rows[0], status: 'COMPLETED', queue: 'DONE' }; },
    updatePlannedContentItem: async (id, input) => { calls.push(['update', id, input]); const source = rows.find((row) => row.id === id); return { ...source, ...input, queue: input.status === 'PAUSED' ? 'WAITING' : source.queue }; },
  };
  createStrategicPlanningController({ api }).mount(dom.root); await flush();
  const allRows = dom.get('[data-planning-queue]').children.flatMap((group) => group.children.slice(1)).filter((row) => row.dataset.planningItem);
  const controls = Object.fromEntries(allRows.map((row) => [row.dataset.planningItem, row.children[3]]));
  await dom.get('[data-planning-queue]').dispatch('click', controls.complete.children.find((child) => child.dataset.planningComplete)); await flush();
  await dom.get('[data-planning-queue]').dispatch('click', controls.pause.children.find((child) => child.dataset.planningPause)); await flush();
  const select = controls.priority.children.find((child) => child.dataset.planningPriority); select.value = 'CRITICAL';
  await dom.get('[data-planning-queue]').dispatch('change', select); await flush();
  assert.deepEqual(calls.map((entry) => entry.slice(0, 2)), [['complete', 'complete'], ['update', 'pause'], ['update', 'priority']]);
});

test('reorder sends the complete deterministic id order once', async () => {
  const rows = [item('a', 'NEXT', { position: 1 }), item('b', 'LATER', { position: 2 })]; let received; const dom = createDom();
  const api = { getCurrentContentPlan: async () => plan(rows), reorderContentPlan: async (_planId, ids) => { received = ids; return [{ ...rows[1], position: 1, queue: 'NEXT' }, { ...rows[0], position: 2, queue: 'LATER' }]; } };
  createStrategicPlanningController({ api }).mount(dom.root); await flush();
  const later = dom.get('[data-planning-queue]').children[1].children[1]; const up = later.children[3].children.find((child) => child.dataset.planningMove && child.dataset.direction === 'up');
  await dom.get('[data-planning-queue]').dispatch('click', up); await flush(); assert.deepEqual(received, ['b', 'a']);
});

test('degraded data remains visible with a local warning and safe literal evidence', async () => {
  const degraded = plan([item('stale', 'WAITING', { evidence: [evidence('STALE')], missingData: ['retention'] })], { status: 'NEEDS_RESEARCH' });
  const dom = createDom(); createStrategicPlanningController({ api: { getCurrentContentPlan: async () => degraded } }).mount(dom.root); await flush();
  assert.match(dom.get('[data-planning-feedback]').textContent, /modo degradado/);
  const row = dom.get('[data-planning-queue]').children[2].children[1]; const open = row.children[3].children.find((child) => child.dataset.planningOpen);
  await dom.get('[data-planning-queue]').dispatch('click', open);
  const detail = dom.get('[data-planning-detail]').children[0];
  assert.match(collectText(detail), /<b>evidência real<\/b>/);
  const evidenceText = detail.children.flatMap((child) => child.children).flatMap((child) => child.children)
    .find((child) => child.textContent.includes('<b>evidência real</b>'));
  assert.equal(evidenceText.children.length, 0);
});

test('API failures do not create false plan state', async () => {
  const dom = createDom(); createStrategicPlanningController({ api: { getCurrentContentPlan: async () => { throw new Error('private'); } } }).mount(dom.root); await flush();
  assert.match(dom.get('[data-planning-feedback]').textContent, /Não foi possível carregar/);
  assert.match(dom.get('[data-planning-now]').children[0].textContent, /Nenhum plano ativo/);
  assert.doesNotMatch(dom.get('[data-planning-feedback]').textContent, /private/);
});

test('unmount removes listeners and ignores a late current-plan response', async () => {
  const pending = deferred(); const dom = createDom(); const controller = createStrategicPlanningController({ api: { getCurrentContentPlan: async () => pending.promise } });
  controller.mount(dom.root); controller.unmount(); pending.resolve(plan()); await flush();
  assert.equal(dom.get('[data-planning-generate-form]').listeners.get('submit')?.length ?? 0, 0);
  assert.equal(dom.get('[data-planning-queue]').listeners.get('click')?.length ?? 0, 0);
  assert.equal(dom.get('[data-planning-queue]').children.length, 0);
});

test('Planner and Supervisor expose Strategic Planning without recomputing it', () => {
  assert.match(plannerModule.render(), /data-planner-strategic-plan/);
  const markup = supervisorModule.render({ supervisor: { planning: { status: 'READY', horizon: 'TODAY', ready: 1, blocked: 1, lowConfidence: 1, experiments: 2, stale: 1, conflicts: 1, alerts: ['1 item bloqueado.'] } } });
  assert.match(markup, /Planejamento estratégico/); assert.match(markup, /1 item bloqueado/);
});
