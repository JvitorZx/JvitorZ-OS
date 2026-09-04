import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { createMonitoringController, monitoringModule } from '../src/modules/monitoring.js';
import { supervisorModule } from '../src/modules/supervisor.js';

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.attributes = new Map();
    this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false;
    this.value = ''; this.dataset = {}; this.type = ''; this.placeholder = ''; this.maxLength = 0;
  }
  querySelector(selector) {
    if (this.map.has(selector)) return this.map.get(selector);
    const match = selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);
    if (!match) return null;
    const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const expected = match[2];
    const visit = (node) => node.children.find((child) => child.dataset?.[key] !== undefined && (expected === undefined || child.dataset[key] === expected))
      ?? node.children.map(visit).find(Boolean);
    return visit(this);
  }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
  closest(selector) {
    const match = selector.match(/^\[data-([\w-]+)\]$/); if (!match) return null;
    const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase()); return this.dataset[key] !== undefined ? this : null;
  }
  async dispatch(type, target = this) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target, preventDefault() {} }))); }
}

const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.fetch = originalFetch; globalThis.document = { createElement: (tag) => new FakeElement(tag) }; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const collectText = (node) => `${node.textContent}${node.children.map(collectText).join('')}`;
const signal = (id = 'signal-1', overrides = {}) => ({
  id, subject: `Sinal ${id}`, summary: 'Mudança observada', impact: 'Requer atenção', severity: 'HIGH', state: 'NEW',
  type: 'PLANNING_BLOCKED', source: 'PLANNING', confidence: 0.8, limitations: ['Amostra limitada'],
  detectedAt: '2026-09-09T12:00:00.000Z', evidence: [{ kind: 'DETECTED', summary: '<script>alert(1)</script>' }], ...overrides,
});
const createDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.strategic-monitoring-panel', panel);
  for (const selector of ['[data-monitoring-severity]', '[data-monitoring-state]', '[data-monitoring-type]', '[data-monitoring-evaluate]', '[data-monitoring-feedback]', '[data-monitoring-list]', '[data-monitoring-detail]', '[data-monitoring-control-status]', '[data-monitoring-operation]', '[data-monitoring-runtime]', '[data-monitoring-last-run]', '[data-monitoring-last-success]', '[data-monitoring-last-failure]', '[data-monitoring-next-run]', '[data-monitoring-cadence]', '[data-monitoring-enable]', '[data-monitoring-disable]']) panel.map.set(selector, new FakeElement());
  return { root, get: (selector) => panel.querySelector(selector) };
};

test('central API client exposes safe monitoring contracts and filters', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: 200, async json() { return []; } }; };
  const api = createApiClient('http://localhost:3000');
  await api.listStrategicSignals({ severity: 'HIGH', state: 'NEW', type: 'DATA_STALE', limit: 20 });
  await api.getStrategicSignal('signal/1'); await api.getMonitoringControl(); await api.updateMonitoringCadence(3600000);
  await api.enableStrategicMonitoring(); await api.disableStrategicMonitoring(); await api.runStrategicMonitoringNow(); await api.evaluateStrategicMonitoring();
  await api.acknowledgeStrategicSignal('signal/1', 'Revisado'); await api.dismissStrategicSignal('signal/1'); await api.resolveStrategicSignal('signal/1');
  assert.deepEqual(calls.map(([url]) => url), [
    'http://localhost:3000/api/monitoring/signals?state=NEW&severity=HIGH&type=DATA_STALE&limit=20',
    'http://localhost:3000/api/monitoring/signals/signal%2F1', 'http://localhost:3000/api/monitoring/control',
    'http://localhost:3000/api/monitoring/control', 'http://localhost:3000/api/monitoring/control/enable',
    'http://localhost:3000/api/monitoring/control/disable', 'http://localhost:3000/api/monitoring/control/run',
    'http://localhost:3000/api/monitoring/evaluate',
    'http://localhost:3000/api/monitoring/signals/signal%2F1/acknowledge',
    'http://localhost:3000/api/monitoring/signals/signal%2F1/dismiss',
    'http://localhost:3000/api/monitoring/signals/signal%2F1/resolve',
  ]);
  assert.equal(calls[3][1].body, '{"intervalMs":3600000}'); assert.equal(calls[4][1].body, '{}'); assert.equal(calls[8][1].body, '{"reason":"Revisado"}');
  await assert.rejects(() => api.getStrategicSignal(' '), TypeError); await assert.rejects(() => api.listStrategicSignals({ limit: 0 }), TypeError);
});

test('monitoring is a lifecycle-enabled fullscreen workspace with accessible local feedback', () => {
  const markup = monitoringModule.render(); assert.equal(monitoringModule.fullscreen, true);
  assert.match(markup, /data-monitoring-list/); assert.match(markup, /Controle do Monitoramento/); assert.match(markup, /aria-live="polite"/); assert.doesNotMatch(markup, /statePanel/);
});

test('control plane renders disabled state and never activates on mount', async () => {
  let enables = 0; const dom = createDom();
  createMonitoringController({ api: { listStrategicSignals: async () => [], getMonitoringControl: async () => ({
    enabled: false, intervalMs: 21600000, operationalState: 'DISABLED', scheduler: { active: false }, lastRunAt: null, nextRunAt: null,
  }), enableStrategicMonitoring: async () => { enables += 1; } } }).mount(dom.root); await flush();
  assert.equal(dom.get('[data-monitoring-control-status]').textContent, 'Desativado'); assert.equal(enables, 0);
  assert.equal(dom.get('[data-monitoring-enable]').hidden, false); assert.equal(dom.get('[data-monitoring-disable]').hidden, true);
});

test('explicit activation and deactivation update the persisted state shown by the UI', async () => {
  const dom = createDom(); let enables = 0; let disables = 0;
  const state = (enabled) => ({ enabled, intervalMs: 21600000, operationalState: enabled ? 'ACTIVE' : 'DISABLED', scheduler: { active: enabled }, lastRunAt: null, nextRunAt: enabled ? '2026-09-11T00:00:00Z' : null });
  createMonitoringController({ api: { listStrategicSignals: async () => [], getMonitoringControl: async () => state(false),
    enableStrategicMonitoring: async () => { enables += 1; return state(true); }, disableStrategicMonitoring: async () => { disables += 1; return state(false); } } }).mount(dom.root); await flush();
  await dom.get('[data-monitoring-enable]').dispatch('click'); await flush();
  assert.equal(enables, 1); assert.equal(dom.get('[data-monitoring-control-status]').textContent, 'Ativo');
  await dom.get('[data-monitoring-disable]').dispatch('click'); await flush();
  assert.equal(disables, 1); assert.equal(dom.get('[data-monitoring-control-status]').textContent, 'Desativado');
});

test('cadence update is single-flight and reconciles the displayed state', async () => {
  const pending = deferred(); let calls = 0; const dom = createDom();
  const base = { enabled: true, intervalMs: 21600000, operationalState: 'ACTIVE', scheduler: { active: true }, lastRunAt: null, nextRunAt: '2026-09-11T00:00:00Z' };
  createMonitoringController({ api: { listStrategicSignals: async () => [], getMonitoringControl: async () => base,
    updateMonitoringCadence: async () => { calls += 1; return pending.promise; } } }).mount(dom.root); await flush();
  dom.get('[data-monitoring-cadence]').value = '3600000';
  const first = dom.get('[data-monitoring-cadence]').dispatch('change'); const second = dom.get('[data-monitoring-cadence]').dispatch('change'); await flush();
  assert.equal(calls, 1); assert.equal(dom.get('[data-monitoring-cadence]').disabled, true);
  pending.resolve({ ...base, intervalMs: 3600000 }); await Promise.all([first, second]);
  assert.equal(dom.get('[data-monitoring-cadence]').value, '3600000');
});

test('loads real signals and preserves backend ordering with severity styling', async () => {
  const dom = createDom(); createMonitoringController({ api: { listStrategicSignals: async () => [signal('high'), signal('critical', { severity: 'CRITICAL' })] } }).mount(dom.root); await flush();
  const rows = dom.get('[data-monitoring-list]').children; assert.deepEqual(rows.map((row) => row.dataset.monitoringSignal), ['high', 'critical']);
  assert.match(rows[1].className, /severity-critical/);
});

test('renders an honest empty state and safe load failure', async () => {
  const empty = createDom(); createMonitoringController({ api: { listStrategicSignals: async () => [] } }).mount(empty.root); await flush();
  assert.match(collectText(empty.get('[data-monitoring-list]')), /Nenhum sinal/);
  const failed = createDom(); createMonitoringController({ api: { listStrategicSignals: async () => { throw new Error('secret'); } } }).mount(failed.root); await flush();
  assert.match(failed.get('[data-monitoring-feedback]').textContent, /Não foi possível carregar/); assert.doesNotMatch(failed.get('[data-monitoring-feedback]').textContent, /secret/);
});

test('filter changes reload once with selected server-side filters', async () => {
  const inputs = []; const dom = createDom(); createMonitoringController({ api: { listStrategicSignals: async (filters) => { inputs.push(filters); return []; } } }).mount(dom.root); await flush();
  dom.get('[data-monitoring-severity]').value = 'HIGH'; await dom.get('[data-monitoring-severity]').dispatch('change'); await flush();
  assert.equal(inputs.length, 2); assert.equal(inputs[1].severity, 'HIGH');
});

test('opens a signal as literal text and exposes stale state without executing HTML', async () => {
  const row = signal('stale', { state: 'STALE', type: 'DATA_STALE' }); const dom = createDom();
  createMonitoringController({ api: { listStrategicSignals: async () => [row], getStrategicSignal: async () => row } }).mount(dom.root); await flush();
  await dom.get('[data-monitoring-list]').dispatch('click', dom.get('[data-monitoring-list]').children[0]); await flush();
  assert.match(collectText(dom.get('[data-monitoring-detail]')), /<script>alert\(1\)<\/script>/);
  assert.match(collectText(dom.get('[data-monitoring-detail]')), /dados stale/);
});

test('late detail response cannot replace a newer selected signal', async () => {
  const first = deferred(); const second = signal('second'); const dom = createDom();
  createMonitoringController({ api: { listStrategicSignals: async () => [signal('first'), second], getStrategicSignal: async (id) => id === 'first' ? first.promise : second } }).mount(dom.root); await flush();
  const rows = dom.get('[data-monitoring-list]').children;
  const openFirst = dom.get('[data-monitoring-list]').dispatch('click', rows[0]); const openSecond = dom.get('[data-monitoring-list]').dispatch('click', rows[1]);
  await openSecond; first.resolve(signal('first')); await openFirst; await flush();
  assert.match(collectText(dom.get('[data-monitoring-detail]')), /Sinal second/); assert.doesNotMatch(collectText(dom.get('[data-monitoring-detail]')), /Sinal first/);
});

test('manual evaluation is single-flight and refreshes persisted signals', async () => {
  const pending = deferred(); let evaluations = 0; let loads = 0; const dom = createDom();
  const control = { enabled: false, intervalMs: 21600000, operationalState: 'DISABLED', scheduler: { active: false }, lastRunAt: null, nextRunAt: null };
  createMonitoringController({ api: { listStrategicSignals: async () => { loads += 1; return []; }, getMonitoringControl: async () => control,
    runStrategicMonitoringNow: async () => { evaluations += 1; return pending.promise; } } }).mount(dom.root); await flush();
  const first = dom.get('[data-monitoring-evaluate]').dispatch('click'); const second = dom.get('[data-monitoring-evaluate]').dispatch('click'); await flush();
  assert.equal(evaluations, 1); assert.equal(dom.get('[data-monitoring-evaluate]').disabled, true);
  pending.resolve({ evaluation: { unchanged: false }, control }); await Promise.all([first, second]); assert.equal(loads, 2);
});

test('signal transition is single-flight and refreshes only after persisted success', async () => {
  const pending = deferred(); let calls = 0; const item = signal(); const dom = createDom();
  createMonitoringController({ api: { listStrategicSignals: async () => [item], getStrategicSignal: async () => item,
    acknowledgeStrategicSignal: async () => { calls += 1; return pending.promise; } } }).mount(dom.root); await flush();
  await dom.get('[data-monitoring-list]').dispatch('click', dom.get('[data-monitoring-list]').children[0]); await flush();
  const action = dom.get('[data-monitoring-detail]').querySelector('[data-monitoring-action]');
  const first = dom.get('[data-monitoring-detail]').dispatch('click', action); const second = dom.get('[data-monitoring-detail]').dispatch('click', action); await flush(); assert.equal(calls, 1);
  pending.resolve({ ...item, state: 'ACKNOWLEDGED' }); await Promise.all([first, second]); assert.match(collectText(dom.get('[data-monitoring-detail]')), /ACKNOWLEDGED/);
});

test('unmount removes listeners and ignores late list/evaluation responses', async () => {
  const pending = deferred(); const dom = createDom(); const controller = createMonitoringController({ api: { listStrategicSignals: async () => pending.promise } });
  controller.mount(dom.root); controller.unmount(); pending.resolve([signal('late')]); await flush();
  assert.equal(dom.get('[data-monitoring-list]').listeners.get('click')?.length ?? 0, 0);
  assert.doesNotMatch(collectText(dom.get('[data-monitoring-list]')), /Sinal late/);
});

test('unmount ignores a late control-plane response', async () => {
  const pending = deferred(); const dom = createDom();
  const controller = createMonitoringController({ api: { listStrategicSignals: async () => [], getMonitoringControl: async () => pending.promise } });
  controller.mount(dom.root); await flush(); controller.unmount();
  pending.resolve({ enabled: true, intervalMs: 900000, operationalState: 'ACTIVE', scheduler: { active: true }, lastRunAt: null, nextRunAt: '2026-09-11T00:00:00Z' });
  await flush(); assert.equal(dom.get('[data-monitoring-control-status]').textContent, '');
  assert.equal(dom.get('[data-monitoring-enable]').listeners.get('click')?.length ?? 0, 0);
});

test('Supervisor presents priority monitoring signals without recomputing them', () => {
  const markup = supervisorModule.render({ supervisor: { strategicMonitoring: { active: 2, high: 1, critical: 1, stale: 1,
    signals: [{ severity: 'CRITICAL', subject: '<b>Bloqueio</b>', summary: 'Revisar plano' }] } } });
  assert.match(markup, /Monitoramento estratégico/); assert.match(markup, /Críticos: 1/); assert.match(markup, /&lt;b&gt;Bloqueio&lt;\/b&gt;/);
  assert.match(markup, /#\/monitoring/);
});
