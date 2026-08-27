import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { automationsModule, createAutomationsController } from '../src/modules/automations.js';

class FakeElement {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.children = [];
    this.attributes = new Map(); this.dataset = {}; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false;
    this.checked = false; this.value = ''; this.type = ''; }
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
  const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.automations-panel', panel);
  const selectors = ['[data-automation-form]', '[data-automation-id]', '[data-automation-name]', '[data-automation-template]',
    '[data-automation-trigger]', '[data-automation-weekday]', '[data-automation-time]', '[data-automation-timezone]',
    '[data-automation-enabled]', '[data-automation-save]', '[data-automation-cancel]', '[data-automation-feedback]',
    '[data-automation-list]', '[data-automation-runs]', '[data-automation-runtime]', '[data-runtime-start]',
    '[data-runtime-stop]', '[data-runtime-tick]'];
  for (const selector of selectors) panel.map.set(selector, new FakeElement());
  const weekday = panel.querySelector('[data-automation-weekday]'); const weekdaySelect = new FakeElement('select'); weekdaySelect.value = '1'; weekday.map.set('select', weekdaySelect);
  const time = panel.querySelector('[data-automation-time]'); const timeInput = new FakeElement('input'); timeInput.value = '09:00'; time.map.set('input', timeInput);
  panel.querySelector('[data-automation-trigger]').value = 'MANUAL_ONLY'; panel.querySelector('[data-automation-template]').value = 'summary';
  panel.querySelector('[data-automation-timezone]').value = 'America/Sao_Paulo';
  return { root, get: (selector) => panel.querySelector(selector) };
};
const item = { id: 'auto-1', name: '<img src=x onerror=alert(1)>', triggerType: 'MANUAL_ONLY', schedule: null,
  timezone: 'UTC', enabled: true, status: 'ACTIVE', riskLevel: 'LOW', sideEffectLevel: 'READ_ONLY', nextRunAt: null };
const runtimeHealth = { status: 'STOPPED', enabled: false, lastTickAt: null, nextTickAt: null, dueCount: 0, runsStarted: 0, runsFailed: 0 };
const withRuntime = (api) => ({ getAutomationRuntimeStatus: async () => runtimeHealth, ...api });

const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; globalThis.fetch = originalFetch; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });

test('automation module exposes a fullscreen lifecycle workspace with local feedback', () => {
  const markup = automationsModule.render(); assert.equal(automationsModule.fullscreen, true);
  assert.match(markup, /data-automation-form/); assert.match(markup, /aria-live="polite"/); assert.doesNotMatch(markup, /statePanel/);
});

test('controller loads real automations once and renders untrusted names as text', async () => {
  let calls = 0; const api = withRuntime({ listAutomations: async () => { calls += 1; return [item]; } });
  const dom = createDom(); const controller = createAutomationsController({ api }); controller.mount(dom.root); controller.mount(dom.root); await flush();
  assert.equal(calls, 1); const article = dom.get('[data-automation-list]').children[0];
  assert.equal(article.children[0].textContent, item.name); assert.equal(article.children[0].children.length, 0);
});

test('form creates a manual automation through the central client payload', async () => {
  let received; const api = withRuntime({ listAutomations: async () => [], createAutomation: async (input) => { received = input; return item; } });
  const dom = createDom(); createAutomationsController({ api }).mount(dom.root); await flush();
  dom.get('[data-automation-name]').value = 'Resumo'; await dom.get('[data-automation-form]').dispatch('submit');
  assert.equal(received.name, 'Resumo'); assert.equal(received.triggerType, 'MANUAL_ONLY'); assert.equal(received.schedule, null);
  assert.equal(received.intent, 'Como está o estado operacional do canal?');
});

test('Run Now ignores a repeated click while the request is active', async () => {
  const pending = deferred(); let calls = 0; const api = withRuntime({ listAutomations: async () => [item],
    runAutomationNow: async () => { calls += 1; return pending.promise; } });
  const dom = createDom(); createAutomationsController({ api }).mount(dom.root); await flush();
  const actions = dom.get('[data-automation-list]').children[0].children.at(-1); const run = actions.children[0];
  const first = run.dispatch('click'); const second = run.dispatch('click'); await flush(); assert.equal(calls, 1);
  pending.resolve({ run: { status: 'SUCCEEDED' } }); await Promise.all([first, second]);
});

test('late list response after unmount cannot replace the detached workspace', async () => {
  const pending = deferred(); const dom = createDom(); const controller = createAutomationsController({ api: withRuntime({ listAutomations: async () => pending.promise }) });
  controller.mount(dom.root); controller.unmount(); pending.resolve([item]); await flush();
  assert.equal(dom.get('[data-automation-list]').children.length, 0);
});

test('central API client uses exact automation contracts and validates ids', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: 200, async json() { return {}; } }; };
  const api = createApiClient('http://localhost:3000');
  await api.createAutomation({ name: 'x' }); await api.listAutomations(); await api.updateAutomation('auto 1', { name: 'y' });
  await api.setAutomationState('auto 1', 'pause'); await api.runAutomationNow('auto 1'); await api.listAutomationRuns('auto 1');
  assert.deepEqual(calls.map(([url, options]) => [url, options.method ?? 'GET']), [
    ['http://localhost:3000/api/automations', 'POST'], ['http://localhost:3000/api/automations', 'GET'],
    ['http://localhost:3000/api/automations/auto%201', 'PATCH'], ['http://localhost:3000/api/automations/auto%201/pause', 'POST'],
    ['http://localhost:3000/api/automations/auto%201/run', 'POST'], ['http://localhost:3000/api/automations/auto%201/runs?limit=20', 'GET'],
  ]);
  await assert.rejects(() => api.runAutomationNow(''), TypeError);
  await assert.rejects(() => api.setAutomationState('a', 'destroy'), TypeError);
});

test('runtime controls use central contracts once and render operational health', async () => {
  const actions = []; const api = withRuntime({ listAutomations: async () => [],
    getAutomationRuntimeStatus: async () => ({ ...runtimeHealth, enabled: true, status: 'RUNNING', dueCount: 2 }),
    controlAutomationRuntime: async (action) => { actions.push(action); return runtimeHealth; } });
  const dom = createDom(); createAutomationsController({ api }).mount(dom.root); await flush();
  assert.equal(dom.get('[data-automation-runtime]').children[0].children[0].textContent, 'RUNNING');
  await dom.get('[data-runtime-tick]').dispatch('click'); assert.deepEqual(actions, ['tick']);
});

test('central API client uses exact runtime contracts without request payloads', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]);
    return { ok: true, status: 200, async json() { return runtimeHealth; } }; };
  const api = createApiClient('http://localhost:3000'); await api.getAutomationRuntimeStatus();
  await api.listAutomationRuntimeEvents(10); await api.controlAutomationRuntime('start'); await api.controlAutomationRuntime('stop');
  await api.controlAutomationRuntime('tick');
  assert.deepEqual(calls.map(([url, options]) => [url, options.method ?? 'GET', options.body]), [
    ['http://localhost:3000/api/automations/runtime/status', 'GET', undefined],
    ['http://localhost:3000/api/automations/runtime/events?limit=10', 'GET', undefined],
    ['http://localhost:3000/api/automations/runtime/start', 'POST', '{}'],
    ['http://localhost:3000/api/automations/runtime/stop', 'POST', '{}'],
    ['http://localhost:3000/api/automations/runtime/tick', 'POST', '{}'],
  ]);
  await assert.rejects(() => api.controlAutomationRuntime('restart'), TypeError);
});
