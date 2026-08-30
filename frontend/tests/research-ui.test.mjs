import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { createResearchController, researchModule } from '../src/modules/research.js';

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.attributes = new Map();
    this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.dataset = {};
  }
  querySelector(selector) { return this.map.get(selector) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  closest(selector) { return selector === '[data-research-opportunity]' && this.dataset.researchOpportunity ? this : null; }
  async dispatch(type, target = this) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target, preventDefault() {} }))); }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const opportunity = (id, subject = '<img src=x onerror=alert(1)>') => ({
  id, subject, state: 'PROMISING', confidence: 0.7, compatibility: 0.8, freshness: 'RECENT', summary: '<script>alert(1)</script>',
  evidence: [{ classification: 'fact', summary: '<b>evidência</b>' }], risks: ['Sem garantia'], gaps: ['Fonte externa ausente'], nextInvestigation: 'Compare no Decision Engine',
});
const execution = { query: { text: 'jogos' }, quality: 'GOOD', freshness: 'RECENT', cache: 'MISS', opportunities: [opportunity('o1', 'BeamNG')] };
const createDom = () => {
  const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.research-panel', panel);
  for (const selector of ['[data-research-form]', '[data-research-query]', '[data-research-mode]', '[data-research-submit]', '[data-research-feedback]', '[data-research-result]', '[data-research-opportunities]', '[data-research-detail]', '[data-research-history]']) panel.map.set(selector, new FakeElement());
  panel.querySelector('[data-research-mode]').value = 'general';
  return { root, get: (selector) => panel.querySelector(selector) };
};

const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; globalThis.fetch = originalFetch; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });

test('Research is a lifecycle-enabled fullscreen module with local feedback', () => {
  const markup = researchModule.render();
  assert.equal(researchModule.fullscreen, true); assert.match(markup, /data-research-form/); assert.match(markup, /aria-live="polite"/); assert.doesNotMatch(markup, /statePanel/);
});

test('central client uses exact Research contracts and validates ids', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: 200, async json() { return {}; } }; };
  const api = createApiClient('http://localhost:3000');
  await api.runResearch({ query: 'x' }); await api.researchGames({ query: 'x' }); await api.researchTopics({ query: 'x' });
  await api.listResearchOpportunities({ state: 'PROMISING', limit: 5 }); await api.getResearchOpportunity('o/1');
  await api.listResearchHistory({ limit: 3 }); await api.getResearchHistory('h/1'); await api.refreshResearch('h/1');
  assert.deepEqual(calls.map(([url]) => url), [
    'http://localhost:3000/api/research', 'http://localhost:3000/api/research/games', 'http://localhost:3000/api/research/topics',
    'http://localhost:3000/api/research/opportunities?state=PROMISING&limit=5', 'http://localhost:3000/api/research/opportunities/o%2F1',
    'http://localhost:3000/api/research/history?limit=3', 'http://localhost:3000/api/research/history/h%2F1', 'http://localhost:3000/api/research/history/h%2F1/refresh',
  ]);
  assert.deepEqual(calls[0][1], { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"x"}' });
  await assert.rejects(() => api.getResearchOpportunity(' '), TypeError);
});

test('mount loads real opportunities and history in backend order', async () => {
  const api = { listResearchOpportunities: async () => [opportunity('o2', 'Second'), opportunity('o1', 'First')], listResearchHistory: async () => [execution] };
  const dom = createDom(); createResearchController({ api }).mount(dom.root); await flush();
  assert.equal(dom.get('[data-research-opportunities]').children[0].children[0].textContent, 'Second');
  assert.equal(dom.get('[data-research-history]').children[0].children[0].textContent, 'jogos');
});

test('submits exactly one Research request while busy and refreshes persisted lists', async () => {
  const pending = deferred(); let calls = 0; let listCalls = 0;
  const api = { runResearch: async () => { calls += 1; return pending.promise; }, listResearchOpportunities: async () => { listCalls += 1; return []; }, listResearchHistory: async () => [] };
  const dom = createDom(); createResearchController({ api }).mount(dom.root); await flush(); dom.get('[data-research-query]').value = 'jogos';
  const first = dom.get('[data-research-form]').dispatch('submit'); const second = dom.get('[data-research-form]').dispatch('submit');
  await flush(); assert.equal(calls, 1); assert.equal(dom.get('[data-research-submit]').disabled, true);
  pending.resolve(execution); await Promise.all([first, second]); assert.equal(listCalls, 2);
  assert.equal(dom.get('[data-research-result]').children[0].children[0].textContent, 'jogos');
});

test('opens persisted content as literal text and never executes HTML', async () => {
  const api = { listResearchOpportunities: async () => [opportunity('o1')], listResearchHistory: async () => [], getResearchOpportunity: async () => opportunity('o1') };
  const dom = createDom(); createResearchController({ api }).mount(dom.root); await flush();
  const button = dom.get('[data-research-opportunities]').children[0]; await dom.get('[data-research-opportunities]').dispatch('click', button);
  const article = dom.get('[data-research-detail]').children[0];
  assert.equal(article.children[0].textContent, '<img src=x onerror=alert(1)>'); assert.equal(article.children[1].textContent, '<script>alert(1)</script>');
  assert.equal(article.children[0].children.length, 0);
});

test('late opportunity detail cannot overwrite a newer selection', async () => {
  const first = deferred();
  const api = { listResearchOpportunities: async () => [opportunity('a', 'A'), opportunity('b', 'B')], listResearchHistory: async () => [], getResearchOpportunity: async (id) => id === 'a' ? first.promise : opportunity('b', 'B') };
  const dom = createDom(); createResearchController({ api }).mount(dom.root); await flush();
  const [a, b] = dom.get('[data-research-opportunities]').children; const pending = dom.get('[data-research-opportunities]').dispatch('click', a);
  await dom.get('[data-research-opportunities]').dispatch('click', b); first.resolve(opportunity('a', 'A')); await pending;
  assert.equal(dom.get('[data-research-detail]').children[0].children[0].textContent, 'B');
});

test('unmount ignores late load and removes listeners', async () => {
  const pending = deferred(); const api = { listResearchOpportunities: async () => pending.promise, listResearchHistory: async () => [] };
  const dom = createDom(); const controller = createResearchController({ api }); controller.mount(dom.root); controller.unmount();
  pending.resolve([opportunity('o1')]); await flush();
  assert.equal(dom.get('[data-research-form]').listeners.get('submit')?.length ?? 0, 0);
  assert.equal(dom.get('[data-research-opportunities]').children.length, 0);
});
