import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { createStrategicPlanningController, strategicPlanningModule } from '../src/modules/strategic-planning.js';

const datasetKey = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
class FakeElement {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.attributes = new Map(); this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.dataset = {}; }
  querySelector(selector) {
    if (this.map.has(selector)) return this.map.get(selector);
    const match = selector.match(/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/); if (!match) return null;
    const key = datasetKey(match[1]); return this.walk().find((entry) => key in entry.dataset && (match[2] === undefined || entry.dataset[key] === match[2])) ?? null;
  }
  *walk() { for (const child of this.children) { yield child; yield* child.walk(); } }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
  closest(selector) { const match = selector.match(/^\[data-([a-z-]+)\]$/); const key = match ? datasetKey(match[1]) : ''; return key && key in this.dataset ? this : null; }
  async dispatch(type, target = this) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target, preventDefault() {} }))); }
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const collectText = (element) => `${element.textContent}${element.children.map(collectText).join('')}`;
const missingPlan = Object.assign(new Error('missing'), { status: 404 });
const learning = (overrides = {}) => ({ id: 'learning-1', dimension: 'FORMAT', subject: 'LONG_FORM',
  description: '<script>alert(1)</script>', status: 'EMERGING', observationCount: 3, favorableCount: 2,
  neutralCount: 1, contraryCount: 0, confidence: .64, freshness: 'RECENT', limitations: ['Amostra pequena'],
  evidence: [], revisions: [], ...overrides });
const createDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.strategic-planning-panel', panel);
  for (const selector of ['[data-planning-generate-form]', '[data-planning-horizon]', '[data-planning-generate]', '[data-planning-feedback]', '[data-planning-meta]', '[data-planning-now]', '[data-planning-queue]', '[data-planning-detail]', '[data-planning-execution-history]', '[data-planning-outcomes]', '[data-planning-learnings]', '[data-planning-learning-detail]', '[data-planning-learning-refresh]', '[data-planning-experiments]', '[data-planning-experiment-detail]', '[data-planning-experiment-form]']) panel.map.set(selector, new FakeElement());
  panel.querySelector('[data-planning-horizon]').value = 'TODAY'; return { root, get: (selector) => panel.querySelector(selector) };
};
const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; globalThis.fetch = originalFetch; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });

test('central client exposes learning list, refresh, detail, evidence, history and related contracts', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => ({ ok: true, status: 200, async json() { calls.push([String(url), options]); return {}; } });
  const api = createApiClient('http://localhost:3000');
  await api.listStrategicLearnings({ status: 'EMERGING', limit: 5 }); await api.refreshStrategicLearnings({});
  await api.getStrategicLearning('learning/1'); await api.getStrategicLearningEvidence('learning/1'); await api.getStrategicLearningHistory('learning/1');
  await api.listStrategicLearningsFor('outcome', 'outcome/1');
  assert.deepEqual(calls.map(([url]) => url), [
    'http://localhost:3000/api/planning/learnings?status=EMERGING&limit=5', 'http://localhost:3000/api/planning/learnings/refresh',
    'http://localhost:3000/api/planning/learnings/learning%2F1', 'http://localhost:3000/api/planning/learnings/learning%2F1/evidence',
    'http://localhost:3000/api/planning/learnings/learning%2F1/history', 'http://localhost:3000/api/planning/outcomes/outcome%2F1/learnings',
  ]);
  assert.equal(calls[1][1].method, 'POST'); await assert.rejects(() => api.getStrategicLearning(' '), TypeError);
  await assert.rejects(() => api.listStrategicLearningsFor('fake', 'id'), TypeError);
});

test('Planning renders honest empty state and literal learning content', async () => {
  assert.match(strategicPlanningModule.render(), /data-planning-learnings/); const dom = createDom();
  const controller = createStrategicPlanningController({ api: { getCurrentContentPlan: async () => { throw missingPlan; }, listStrategicLearnings: async () => [learning()] } });
  controller.mount(dom.root); await flush(); const list = dom.get('[data-planning-learnings]');
  assert.match(collectText(list), /<script>alert\(1\)<\/script>/); assert.equal(list.children[0].children[0].tagName, 'ARTICLE');
  controller.unmount();
});

test('opening a learning shows auditable evidence, confidence and limitations', async () => {
  const dom = createDom(); const detailed = learning({ evidence: [{ stance: 'FAVORABLE', summary: '<img src=x onerror=alert(1)>', outcome: { itemId: 'missing' } }], revisions: [{ event: 'LEARNING_REEVALUATED', previousStatus: 'WEAK', currentStatus: 'EMERGING' }] });
  createStrategicPlanningController({ api: { getCurrentContentPlan: async () => { throw missingPlan; }, listStrategicLearnings: async () => [learning()], getStrategicLearning: async () => detailed } }).mount(dom.root);
  await flush(); const open = dom.get('[data-planning-learnings]').querySelector('[data-planning-learning-open]'); await dom.get('[data-planning-learnings]').dispatch('click', open); await flush();
  const content = collectText(dom.get('[data-planning-learning-detail]')); assert.match(content, /3 observacoes comparaveis/); assert.match(content, /<img src=x onerror=alert\(1\)>/); assert.match(content, /WEAK -> EMERGING/);
});

test('refresh is single-flight and late list/detail responses are ignored after unmount', async () => {
  const refresh = deferred(); const lateList = deferred(); let calls = 0; const dom = createDom();
  const controller = createStrategicPlanningController({ api: { getCurrentContentPlan: async () => { throw missingPlan; }, listStrategicLearnings: async () => lateList.promise,
    refreshStrategicLearnings: async () => { calls += 1; return refresh.promise; } } });
  controller.mount(dom.root); const button = dom.get('[data-planning-learning-refresh]');
  const first = button.dispatch('click'); const second = button.dispatch('click'); await flush(); assert.equal(calls, 1);
  controller.unmount(); refresh.resolve({ insufficientData: false }); lateList.resolve([learning({ description: 'Late' })]); await Promise.all([first, second]); await flush();
  assert.doesNotMatch(collectText(dom.get('[data-planning-learnings]')), /Late/); assert.equal(button.listeners.get('click')?.length ?? 0, 0);
});

test('central client exposes complete strategic experimentation contracts', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => ({ ok: true, status: 200, async json() { calls.push([String(url), options]); return {}; } });
  const api = createApiClient('http://localhost:3000');
  await api.listStrategicExperiments({ status: 'RUNNING', limit: 5 });
  await api.createStrategicExperiment({ title: 'Test' }); await api.getStrategicExperiment('exp/1');
  await api.startStrategicExperiment('exp/1'); await api.addStrategicExperimentObservation('exp/1', 'var/1', 'out/1');
  await api.analyzeStrategicExperiment('exp/1'); await api.cancelStrategicExperiment('exp/1', 'Stop');
  await api.getStrategicExperimentEvidence('exp/1'); await api.getStrategicExperimentHistory('exp/1');
  assert.deepEqual(calls.map(([url]) => url), [
    'http://localhost:3000/api/planning/experiments?status=RUNNING&limit=5', 'http://localhost:3000/api/planning/experiments',
    'http://localhost:3000/api/planning/experiments/exp%2F1', 'http://localhost:3000/api/planning/experiments/exp%2F1/start',
    'http://localhost:3000/api/planning/experiments/exp%2F1/observations', 'http://localhost:3000/api/planning/experiments/exp%2F1/analyze',
    'http://localhost:3000/api/planning/experiments/exp%2F1/cancel', 'http://localhost:3000/api/planning/experiments/exp%2F1/evidence',
    'http://localhost:3000/api/planning/experiments/exp%2F1/history',
  ]);
  assert.equal(JSON.parse(calls[4][1].body).outcomeId, 'out/1'); await assert.rejects(() => api.getStrategicExperiment(' '), TypeError);
});

test('Planning renders experiment list safely and ignores stale detail after unmount', async () => {
  const detail = deferred(); const dom = createDom();
  const experiment = { id: 'experiment-1', title: '<img src=x onerror=alert(1)>', status: 'RUNNING', primaryMetric: 'ctr', _count: { observations: 2 },
    hypothesis: { description: 'Direct hook' }, variants: [], result: null, limitations: [] };
  const controller = createStrategicPlanningController({ api: { getCurrentContentPlan: async () => { throw missingPlan; }, listStrategicLearnings: async () => [],
    listStrategicExperiments: async () => [experiment], getStrategicExperiment: async () => detail.promise } });
  controller.mount(dom.root); await flush(); const list = dom.get('[data-planning-experiments]');
  assert.match(collectText(list), /<img src=x onerror=alert\(1\)>/); const open = list.querySelector('[data-experiment-open]');
  const pending = list.dispatch('click', open); controller.unmount(); detail.resolve({ ...experiment, title: 'Late experiment' }); await pending; await flush();
  assert.doesNotMatch(collectText(dom.get('[data-planning-experiment-detail]')), /Late experiment/);
  assert.equal(list.listeners.get('click')?.length ?? 0, 0);
});
