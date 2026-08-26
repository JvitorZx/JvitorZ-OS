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
  for (const selector of ['[data-manager-form]', '[data-manager-intent]', '[data-manager-run]', '[data-manager-sync-confirm]', '[data-manager-sync-start]', '[data-manager-sync-end]', '[data-manager-feedback]', '[data-manager-result]', '[data-manager-history]']) {
    panel.map.set(selector, new FakeElement());
  }
  panel.querySelector('[data-manager-sync-start]').value = '2026-08-18';
  panel.querySelector('[data-manager-sync-end]').value = '2026-08-25';
  return { root, get: (selector) => panel.querySelector(selector) };
};
const result = {
  status: 'completed', interpretation: 'Objetivo', response: '<img src=x onerror=alert(1)>',
  capabilities: ['performance.read', 'planner.respond'],
  evidence: { facts: ['Fato'], inferences: ['Inferência'], recommendations: ['Recomendação'], risks: [], missingData: [], confidence: 0.8 },
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

test('manager loads history, runs once, and renders untrusted content as text', async () => {
  const calls = [];
  const api = { listOrchestrationExecutions: async () => [], runOrchestration: async (input) => { calls.push(input); return { result }; } };
  const dom = createDom(); const controller = createManagerController({ api }); controller.mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Como está meu canal?';
  await dom.get('[data-manager-form]').dispatch('submit');
  assert.equal(calls.length, 1);
  const content = dom.get('[data-manager-result]').children[0];
  assert.equal(content.children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(content.children[1].children.length, 0);
});

test('manager blocks duplicate submit while an execution is pending', async () => {
  const pending = deferred(); let calls = 0;
  const api = { listOrchestrationExecutions: async () => [], runOrchestration: async () => { calls += 1; return pending.promise; } };
  const dom = createDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Status';
  const first = dom.get('[data-manager-form]').dispatch('submit'); const second = dom.get('[data-manager-form]').dispatch('submit');
  await flush(); assert.equal(calls, 1); assert.equal(dom.get('[data-manager-run]').disabled, true);
  pending.resolve({ result }); await Promise.all([first, second]);
});

test('manager sends bounded sync parameters only after explicit UI confirmation', async () => {
  let received;
  const api = { listOrchestrationExecutions: async () => [], runOrchestration: async (input) => { received = input; return { result }; } };
  const dom = createDom(); createManagerController({ api }).mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Sincronize o YouTube e revise outcomes';
  dom.get('[data-manager-sync-confirm]').checked = true;
  await dom.get('[data-manager-form]').dispatch('submit');
  assert.deepEqual(received.sync, { mode: 'recent', startDate: '2026-08-18', endDate: '2026-08-25', limit: 20 });
  assert.equal(received.confirmExternalSideEffect, true);
});

test('late orchestration response after unmount does not alter detached UI', async () => {
  const pending = deferred();
  const api = { listOrchestrationExecutions: async () => [], runOrchestration: async () => pending.promise };
  const dom = createDom(); const controller = createManagerController({ api }); controller.mount(dom.root); await flush();
  dom.get('[data-manager-intent]').value = 'Status'; const request = dom.get('[data-manager-form]').dispatch('submit');
  controller.unmount(); pending.resolve({ result }); await request;
  assert.equal(dom.get('[data-manager-result]').children.length, 0);
});

test('central API client uses exact orchestrator contracts and validates execution ids', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: 200, async json() { return {}; } }; };
  const api = createApiClient('http://localhost:3000');
  await api.planOrchestration({ intent: 'status' }); await api.runOrchestration({ intent: 'status' });
  await api.listOrchestrationExecutions({ limit: 5 }); await api.getOrchestrationExecution('execution-1'); await api.getOrchestrationPlan('execution-1');
  assert.deepEqual(calls.map(([url]) => url), [
    'http://localhost:3000/api/orchestrator/plan', 'http://localhost:3000/api/orchestrator/run',
    'http://localhost:3000/api/orchestrator/executions/recent?limit=5',
    'http://localhost:3000/api/orchestrator/executions/execution-1',
    'http://localhost:3000/api/orchestrator/executions/execution-1/plan',
  ]);
  await assert.rejects(() => api.getOrchestrationExecution(''), TypeError);
});
