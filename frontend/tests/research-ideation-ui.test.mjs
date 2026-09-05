import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { createResearchController, researchModule } from '../src/modules/research.js';

class FakeElement {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.map = new Map(); this.listeners = new Map(); this.attributes = new Map(); this.children = []; this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.dataset = {}; }
  querySelector(selector) { return this.map.get(selector) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  closest(selector) { return selector === '[data-research-action]' && this.dataset.researchAction ? this : selector === '[data-research-opportunity]' && this.dataset.researchOpportunity ? this : null; }
  async dispatch(type, target = this) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target, preventDefault() {} }))); }
}
const originalDocument = globalThis.document; const originalFetch = globalThis.fetch;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; globalThis.fetch = originalFetch; });
process.on('exit', () => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const selectors = ['[data-research-form]', '[data-research-query]', '[data-research-mode]', '[data-research-submit]', '[data-research-feedback]', '[data-research-result]', '[data-research-opportunities]', '[data-research-detail]', '[data-research-history]', '[data-research-tabs]', '[data-research-session-form]', '[data-research-session-query]', '[data-research-session-objective]', '[data-research-session-type]', '[data-research-session-format]', '[data-research-session-game]', '[data-research-session-submit]', '[data-research-sessions]', '[data-research-games]', '[data-research-content]', '[data-research-ideas]', '[data-research-shortlist]'];
const createDom = () => { const root = new FakeElement(); const panel = new FakeElement(); root.map.set('.research-panel', panel); for (const selector of selectors) panel.map.set(selector, new FakeElement()); panel.querySelector('[data-research-mode]').value = 'general'; panel.querySelector('[data-research-session-type]').value = 'GAME'; return { root, get: (selector) => panel.querySelector(selector) }; };
const session = { id: 's1', query: 'Jogos', objective: 'Escolher um teste', status: 'COMPLETED', freshness: 'RECENT', researchedAt: '2026-09-15T12:00:00Z', format: 'LONG_FORM', game: null };
const idea = { id: 'i1', premise: '<img src=x onerror=alert(1)>', workingTitle: '<script>alert(1)</script>', status: 'CANDIDATE', format: 'LONG_FORM', effortLevel: 'LOW', opportunityScore: 71, risks: [], assumptions: [] };
const apiBase = () => ({
  listResearchOpportunities: async () => [], listResearchHistory: async () => [], listResearchSessions: async () => [session], listResearchIdeas: async () => [idea],
  getResearchSession: async () => session, getResearchGameCandidates: async () => [], getContentResearch: async () => ({ patterns: [], gaps: [], repetition: [], disclaimer: 'Sem demanda externa.' }),
});

test('Research workspace exposes sessions, games, content, ideas and shortlist', () => {
  const markup = researchModule.render(); for (const value of ['research-sessions', 'research-games', 'research-content', 'research-ideas', 'research-shortlist']) assert.match(markup, new RegExp(value));
  assert.match(markup, /score relativo/i); assert.doesNotMatch(markup, /href="#research-|statePanel/);
});
test('central API client uses all Sprint 49 contracts without direct arbitrary content', async () => {
  const calls = []; globalThis.fetch = async (url, options = {}) => { calls.push([String(url), options]); return { ok: true, status: 200, async json() { return []; } }; };
  const api = createApiClient('http://localhost:3000'); await api.createResearchSession({ query: 'x' }); await api.runResearchSession('s/1'); await api.getResearchSessionEvidence('s/1'); await api.getResearchGameCandidates('s/1'); await api.getContentResearch('s/1'); await api.generateResearchIdeas('s/1', { objective: 'x', format: 'LONG_FORM' }); await api.transitionResearchIdea('i/1', 'SHORTLISTED'); await api.sendResearchIdeaToPlanner('i/1');
  assert.deepEqual(calls.map(([url]) => url), ['http://localhost:3000/api/research/sessions', 'http://localhost:3000/api/research/sessions/s%2F1/run', 'http://localhost:3000/api/research/sessions/s%2F1/evidence', 'http://localhost:3000/api/research/sessions/s%2F1/games', 'http://localhost:3000/api/research/sessions/s%2F1/content', 'http://localhost:3000/api/research/sessions/s%2F1/ideas/generate', 'http://localhost:3000/api/research/ideas/i%2F1/status', 'http://localhost:3000/api/research/ideas/i%2F1/planner']);
  assert.equal(calls.at(-1)[1].body, '{}');
});
test('mount loads persisted sessions and ideas in backend order using text nodes', async () => {
  const dom = createDom(); createResearchController({ api: apiBase() }).mount(dom.root); await flush();
  assert.equal(dom.get('[data-research-sessions]').children[0].children[1].textContent, 'Escolher um teste'); assert.equal(dom.get('[data-research-ideas]').children[0].children[1].textContent, '<script>alert(1)</script>'); assert.equal(dom.get('[data-research-ideas]').children[0].children[1].children.length, 0);
});
test('create and run session is single-flight and refreshes persisted data', async () => {
  const pending = deferred(); let creates = 0; let runs = 0; const api = { ...apiBase(), createResearchSession: async () => { creates += 1; return pending.promise; }, runResearchSession: async () => { runs += 1; return session; } };
  const dom = createDom(); createResearchController({ api }).mount(dom.root); await flush(); dom.get('[data-research-session-query]').value = 'Jogo'; dom.get('[data-research-session-objective]').value = 'Teste';
  const one = dom.get('[data-research-session-form]').dispatch('submit'); const two = dom.get('[data-research-session-form]').dispatch('submit'); await flush(); assert.equal(creates, 1); assert.equal(dom.get('[data-research-session-submit]').disabled, true);
  pending.resolve(session); await Promise.all([one, two]); assert.equal(runs, 1); assert.equal(dom.get('[data-research-session-submit]').disabled, false);
});
test('unmount removes studio listeners and ignores late workspace responses', async () => {
  const pending = deferred(); const api = { ...apiBase(), listResearchSessions: async () => pending.promise }; const dom = createDom(); const controller = createResearchController({ api }); controller.mount(dom.root); controller.unmount(); pending.resolve([session]); await flush();
  assert.equal(dom.get('[data-research-session-form]').listeners.get('submit')?.length ?? 0, 0); assert.equal(dom.get('[data-research-sessions]').children.length, 0);
});
