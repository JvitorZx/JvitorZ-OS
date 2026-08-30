import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { createManagerController, managerModule } from '../src/modules/manager.js';

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map();
    this.attributes = new Map(); this.children = []; this.textContent = ''; this.className = '';
    this.hidden = false; this.disabled = false; this.checked = false; this.value = '';
  }
  querySelector(selector) { return this.map.get(selector) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  async dispatch(type) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ preventDefault() {} }))); }
}

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const createDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.manager-panel', panel);
  for (const selector of ['[data-manager-form]', '[data-manager-intent]', '[data-manager-preview]', '[data-manager-sync-confirm]', '[data-manager-sync-start]', '[data-manager-sync-end]', '[data-manager-feedback]', '[data-manager-plan]', '[data-manager-review-actions]', '[data-manager-review-reason]', '[data-manager-approve]', '[data-manager-reject]', '[data-manager-execute]', '[data-manager-result]', '[data-manager-history]']) {
    panel.map.set(selector, new FakeElement());
  }
  panel.querySelector('[data-manager-sync-start]').value = '2026-08-18';
  panel.querySelector('[data-manager-sync-end]').value = '2026-08-25';
  return { root, get: (selector) => panel.querySelector(selector) };
};
const createQueryDom = () => {
  const dom = createDom();
  const panel = dom.root.querySelector('.manager-panel');
  for (const selector of ['[data-manager-query-form]', '[data-manager-question]', '[data-manager-query]']) {
    panel.map.set(selector, new FakeElement());
  }
  return dom;
};
const managerAnswer = {
  correlationId: 'manager-1', status: 'completed', outcome: 'ANSWERED', intent: 'CHANNEL_DIAGNOSIS',
  answer: '<script>alert(1)</script>', confidence: 0.72,
  operatorsUsed: [{ operatorId: 'analytics' }, { operatorId: 'trends' }],
  evidence: [{ classification: 'fact', summary: '<b>Fato real</b>' }],
  conflicts: [{ summary: 'CTR forte e retenção fraca.' }], missingData: ['amostra longa'], decision: null,
};
const result = {
  status: 'completed', interpretation: 'Objetivo', response: '<img src=x onerror=alert(1)>',
  capabilities: ['performance.read', 'planner.respond'],
  evidence: { facts: ['Fato'], inferences: ['Inferência'], recommendations: ['Recomendação'], risks: [], missingData: [], confidence: 0.8 },
};
const preview = {
  executionId: 'execution-1', created: true,
  plan: { objective: 'Objetivo', steps: [{ capabilityId: 'performance.read', objective: 'Ler dados', sideEffect: 'READ_ONLY' }] },
  review: { state: 'approved', riskLevel: 'LOW', sideEffectLevel: 'READ_ONLY', requiredApprovals: 0, version: 1, reasons: ['Read only'] },
};

const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; globalThis.fetch = originalFetch; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });

test('manager module exposes a lifecycle-enabled controlled workspace', () => {
  const markup = managerModule.render();
  assert.equal(managerModule.fullscreen, true); assert.match(markup, /data-manager-form/);
  assert.match(markup, /aria-live="polite"/); assert.equal(typeof managerModule.createController, 'function');
});

test('manager previews then executes once and renders untrusted content as text', async () => {
  const calls = [];
  const api = { listOrchestrationExecutions: async () => [], previewOrchestration: async (input) => { calls.push(input); return structuredClone(preview); },
    executeOrchestrationPlan: async () => ({ result }) };
  const dom = createDom(); const controller = createManagerController({ api }); controller.mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Como está meu canal?';
  await dom.get('[data-manager-form]').dispatch('submit');
  assert.equal(calls.length, 1);
  await dom.get('[data-manager-execute]').dispatch('click');
  const content = dom.get('[data-manager-result]').children[0];
  assert.equal(content.children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(content.children[1].children.length, 0);
});

test('manager blocks duplicate preview while a request is pending', async () => {
  const pending = deferred(); let calls = 0;
  const api = { listOrchestrationExecutions: async () => [], previewOrchestration: async () => { calls += 1; return pending.promise; } };
  const dom = createDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Status';
  const first = dom.get('[data-manager-form]').dispatch('submit'); const second = dom.get('[data-manager-form]').dispatch('submit');
  await flush(); assert.equal(calls, 1); assert.equal(dom.get('[data-manager-preview]').disabled, true);
  pending.resolve(structuredClone(preview)); await Promise.all([first, second]);
});

test('manager sends bounded sync parameters only after explicit UI confirmation', async () => {
  let received;
  const api = { listOrchestrationExecutions: async () => [], previewOrchestration: async (input) => { received = input; return structuredClone(preview); } };
  const dom = createDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Sincronize o YouTube e revise outcomes';
  dom.get('[data-manager-sync-confirm]').checked = true;
  await dom.get('[data-manager-form]').dispatch('submit');
  assert.deepEqual(received.sync, { mode: 'recent', startDate: '2026-08-18', endDate: '2026-08-25', limit: 20 });
  assert.equal('confirmExternalSideEffect' in received, false);
});

test('manager shows review controls only for a review-required plan', async () => {
  const reviewPreview = structuredClone(preview);
  reviewPreview.review = { ...reviewPreview.review, state: 'review_required', riskLevel: 'HIGH',
    sideEffectLevel: 'EXTERNAL_READ', requiredApprovals: 1 };
  const api = { listOrchestrationExecutions: async () => [], previewOrchestration: async () => reviewPreview };
  const dom = createDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Sincronize o YouTube e revise outcomes';
  await dom.get('[data-manager-form]').dispatch('submit');
  assert.equal(dom.get('[data-manager-review-actions]').hidden, false);
  assert.equal(dom.get('[data-manager-approve]').hidden, false);
  assert.equal(dom.get('[data-manager-reject]').hidden, false);
  assert.equal(dom.get('[data-manager-execute]').hidden, true);
});

test('manager approves a reviewed plan before executing it', async () => {
  const calls = [];
  const reviewPreview = structuredClone(preview);
  reviewPreview.review.state = 'review_required'; reviewPreview.review.requiredApprovals = 1;
  const api = {
    listOrchestrationExecutions: async () => [],
    previewOrchestration: async () => structuredClone(reviewPreview),
    approveOrchestrationPlan: async (id, payload) => {
      calls.push(['approve', id, payload]); return { review: { ...reviewPreview.review, state: 'approved', version: 2 } };
    },
    executeOrchestrationPlan: async (id) => { calls.push(['execute', id]); return { result }; },
  };
  const dom = createDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Sync'; await dom.get('[data-manager-form]').dispatch('submit');
  dom.get('[data-manager-review-reason]').value = 'Conferido';
  await dom.get('[data-manager-approve]').dispatch('click');
  assert.deepEqual(calls[0], ['approve', 'execution-1', { reviewer: 'local-operator', reason: 'Conferido', expectedVersion: 1 }]);
  assert.equal(dom.get('[data-manager-execute]').hidden, false);
  await dom.get('[data-manager-execute]').dispatch('click');
  assert.deepEqual(calls[1], ['execute', 'execution-1']);
});

test('manager rejection records the reason and never executes the plan', async () => {
  const calls = [];
  const reviewPreview = structuredClone(preview); reviewPreview.review.state = 'review_required';
  const api = { listOrchestrationExecutions: async () => [], previewOrchestration: async () => reviewPreview,
    rejectOrchestrationPlan: async (id, payload) => { calls.push([id, payload]);
      return { review: { ...reviewPreview.review, state: 'rejected', version: 2 } }; } };
  const dom = createDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Sync'; await dom.get('[data-manager-form]').dispatch('submit');
  dom.get('[data-manager-review-reason]').value = 'Não autorizado';
  await dom.get('[data-manager-reject]').dispatch('click');
  assert.equal(calls.length, 1); assert.equal(calls[0][1].reason, 'Não autorizado');
  assert.equal(dom.get('[data-manager-review-actions]').hidden, true);
});

test('manager does not send a rejection without a reason', async () => {
  let calls = 0;
  const reviewPreview = structuredClone(preview); reviewPreview.review.state = 'review_required';
  const api = { listOrchestrationExecutions: async () => [], previewOrchestration: async () => reviewPreview,
    rejectOrchestrationPlan: async () => { calls += 1; } };
  const dom = createDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Sync'; await dom.get('[data-manager-form]').dispatch('submit');
  await dom.get('[data-manager-reject]').dispatch('click');
  assert.equal(calls, 0); assert.match(dom.get('[data-manager-feedback]').textContent, /motivo/);
});

test('late approval after unmount does not update the detached plan', async () => {
  const pending = deferred();
  const reviewPreview = structuredClone(preview); reviewPreview.review.state = 'review_required';
  const api = { listOrchestrationExecutions: async () => [], previewOrchestration: async () => reviewPreview,
    approveOrchestrationPlan: async () => pending.promise };
  const dom = createDom(); const controller = createManagerController({ api }); controller.mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Sync'; await dom.get('[data-manager-form]').dispatch('submit');
  const approval = dom.get('[data-manager-approve]').dispatch('click'); controller.unmount();
  pending.resolve({ review: { ...reviewPreview.review, state: 'approved' } }); await approval;
  assert.match(dom.get('[data-manager-plan]').children[0].children[3].textContent, /review_required/);
});

test('manager review feedback remains local and never references statePanel', () => {
  const markup = managerModule.render();
  assert.match(markup, /data-manager-feedback/); assert.doesNotMatch(markup, /statePanel/);
});

test('late orchestration response after unmount does not alter detached UI', async () => {
  const pending = deferred();
  const api = { listOrchestrationExecutions: async () => [], previewOrchestration: async () => pending.promise };
  const dom = createDom(); const controller = createManagerController({ api }); controller.mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Status'; const request = dom.get('[data-manager-form]').dispatch('submit');
  controller.unmount(); pending.resolve(structuredClone(preview)); await request;
  assert.equal(dom.get('[data-manager-result]').children.length, 0);
});

test('central API client uses exact orchestrator contracts and validates execution ids', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: 200, async json() { return {}; } }; };
  const api = createApiClient('http://localhost:3000');
  await api.planOrchestration({ intent: 'status' }); await api.previewOrchestration({ intent: 'status' });
  await api.runOrchestration({ intent: 'status' });
  await api.listOrchestrationExecutions({ limit: 5 }); await api.getOrchestrationExecution('execution-1'); await api.getOrchestrationPlan('execution-1');
  await api.getPlanReview('execution-1');
  await api.approveOrchestrationPlan('execution-1', { reviewer: 'local', expectedVersion: 1 });
  await api.rejectOrchestrationPlan('execution-1', { reviewer: 'local', reason: 'no', expectedVersion: 1 });
  await api.executeOrchestrationPlan('execution-1'); await api.getOrchestrationAuditTrail('execution-1');
  assert.deepEqual(calls.map(([url]) => url), [
    'http://localhost:3000/api/orchestrator/plan', 'http://localhost:3000/api/orchestrator/preview',
    'http://localhost:3000/api/orchestrator/run',
    'http://localhost:3000/api/orchestrator/executions/recent?limit=5',
    'http://localhost:3000/api/orchestrator/executions/execution-1',
    'http://localhost:3000/api/orchestrator/executions/execution-1/plan',
    'http://localhost:3000/api/orchestrator/executions/execution-1/review',
    'http://localhost:3000/api/orchestrator/executions/execution-1/approve',
    'http://localhost:3000/api/orchestrator/executions/execution-1/reject',
    'http://localhost:3000/api/orchestrator/executions/execution-1/execute',
    'http://localhost:3000/api/orchestrator/executions/execution-1/audit',
  ]);
  await assert.rejects(() => api.getOrchestrationExecution(''), TypeError);
});

test('manager autonomous form is present without removing controlled PlanReview', () => {
  const markup = managerModule.render();
  assert.match(markup, /data-manager-query-form/); assert.match(markup, /data-manager-form/);
  assert.match(markup, /Planejar operação controlada/);
});

test('manager query runs once, renders evidence safely and refreshes real history', async () => {
  let calls = 0; let historyCalls = 0;
  const api = {
    queryManager: async (input) => { calls += 1; assert.deepEqual(input, { message: 'Por que meu canal caiu?' }); return managerAnswer; },
    listManagerHistory: async () => { historyCalls += 1; return []; },
  };
  const dom = createQueryDom(); const controller = createManagerController({ api }); controller.mount(dom.root); await flush();
  dom.get('[data-manager-question]').value = 'Por que meu canal caiu?';
  await dom.get('[data-manager-query-form]').dispatch('submit');
  const content = dom.get('[data-manager-result]').children[0];
  assert.equal(calls, 1); assert.equal(historyCalls, 2);
  assert.equal(content.children[1].textContent, '<script>alert(1)</script>');
  assert.equal(content.children[1].children.length, 0);
  assert.equal(content.children.some?.((item) => item.textContent === '<b>Fato real</b>') ?? false, false);
});

test('manager blocks duplicate autonomous queries while pending', async () => {
  const pending = deferred(); let calls = 0;
  const api = { queryManager: async () => { calls += 1; return pending.promise; }, listManagerHistory: async () => [] };
  const dom = createQueryDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-question]').value = 'Status do canal';
  const first = dom.get('[data-manager-query-form]').dispatch('submit');
  const second = dom.get('[data-manager-query-form]').dispatch('submit');
  await flush(); assert.equal(calls, 1); assert.equal(dom.get('[data-manager-query]').disabled, true);
  pending.resolve(managerAnswer); await Promise.all([first, second]);
});

test('manager renders degraded state in local feedback without statePanel', async () => {
  const api = { queryManager: async () => ({ ...managerAnswer, status: 'partial', outcome: 'DEGRADED' }), listManagerHistory: async () => [] };
  const dom = createQueryDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-question]').value = 'Diagnóstico'; await dom.get('[data-manager-query-form]').dispatch('submit');
  assert.match(dom.get('[data-manager-feedback]').textContent, /degradado/);
  assert.doesNotMatch(dom.get('[data-manager-feedback]').textContent, /stack|payload|statePanel/i);
});

test('late autonomous response after unmount cannot alter detached UI', async () => {
  const pending = deferred();
  const api = { queryManager: async () => pending.promise, listManagerHistory: async () => [] };
  const dom = createQueryDom(); const controller = createManagerController({ api }); controller.mount(dom.root); await flush();
  dom.get('[data-manager-question]').value = 'Status';
  const request = dom.get('[data-manager-query-form]').dispatch('submit'); controller.unmount();
  pending.resolve(managerAnswer); await request;
  assert.equal(dom.get('[data-manager-result]').children.length, 0);
});

test('manager autonomous lifecycle keeps one submit listener across repeated mount', async () => {
  let calls = 0;
  const api = { queryManager: async () => { calls += 1; return managerAnswer; }, listManagerHistory: async () => [] };
  const dom = createQueryDom(); const controller = createManagerController({ api });
  controller.mount(dom.root); controller.mount(dom.root); await flush();
  dom.get('[data-manager-question]').value = 'Status'; await dom.get('[data-manager-query-form]').dispatch('submit');
  assert.equal(calls, 1); assert.equal(dom.get('[data-manager-query-form]').listeners.get('submit').length, 1);
});

test('central API client exposes manager query, history and diagnostics contracts', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: 200, async json() { return {}; } }; };
  const api = createApiClient('http://localhost:3000');
  await api.queryManager({ message: 'status' }); await api.listManagerHistory({ limit: 5 });
  await api.getManagerHistory('manager-1'); await api.getManagerDiagnostics('manager-1');
  assert.deepEqual(calls.map(([url]) => url), [
    'http://localhost:3000/api/manager/query',
    'http://localhost:3000/api/manager/history?limit=5',
    'http://localhost:3000/api/manager/history/manager-1',
    'http://localhost:3000/api/manager/history/manager-1/diagnostics',
  ]);
  await assert.rejects(() => api.getManagerHistory(''), TypeError);
});
