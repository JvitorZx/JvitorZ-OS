import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  analyticsModule,
  createAnalyticsController,
  formatPerformanceValue,
} from '../src/modules/analytics.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.selectorMap = new Map();
    this.listeners = new Map();
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.value = '';
    this.type = '';
  }

  querySelector(selector) { return this.selectorMap.get(selector) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  listenerCount(type) { return (this.listeners.get(type) ?? []).length; }
  async dispatch(type, event = {}) {
    const target = event.target ?? this;
    await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({
      preventDefault() {},
      target,
      ...event,
    })));
  }
  closest(selector) {
    return selector === '[data-decision-id]' && this.dataset.decisionId ? this : null;
  }
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const baselineMetric = (average, median, sampleSize) => ({ average, median, sampleSize });

const defaultData = () => ({
  status: { state: 'synchronized', lastSyncAt: '2026-08-24T12:00:00.000Z', lastErrorType: null },
  lastSync: { source: 'youtube-analytics', lastSyncAt: '2026-08-24T12:00:00.000Z' },
  records: [{
    id: 'snapshot-1', title: 'Video persistido', collectedAt: '2026-08-24T12:00:00.000Z',
    views: 1200, watchTimeMinutes: 4500, averageViewDurationSeconds: 125,
    averageViewPercentage: 48.5, subscribersGained: 12, subscribersLost: 2,
    likes: 100, comments: 14,
  }],
  baseline: {
    views: baselineMetric(1000, 900, 4),
    watchTimeMinutes: baselineMetric(4000, 3500, 4),
    averageViewDurationSeconds: baselineMetric(120, 115, 4),
    averageViewPercentage: baselineMetric(45, 44, 4),
    subscribersGained: baselineMetric(10, 9, 4),
    subscribersPerThousandViews: baselineMetric(10, 9.5, 4),
    byFormat: { narrado: { views: baselineMetric(1000, 900, 3) } },
  },
  signals: [{
    metric: 'retention_performance', value: 54, classification: 'real',
    source: 'youtube-analytics:snapshot-1', confidence: 1,
    measuredAt: '2026-08-24T12:00:00.000Z',
  }],
  learnings: [{
    subject: 'retencao media', statement: 'Baseline observada em quatro videos.',
    classification: 'inference', confidence: 0.8, evidence: { sampleSize: 4 },
  }],
  context: { previousDecisions: [{ id: 'decision-1', category: 'TESTAR', score: 72, rationale: 'Evidencia inicial.' }] },
  decision: {
    id: 'decision-1', category: 'TESTAR', score: 72, rationale: '<b>Justificativa literal</b>',
    evidence: {
      classification: 'recommendation', confidence: 0.7,
      components: [{ rationale: '<img src=x onerror=alert(1)>' }],
      risks: ['Amostra pequena'], missingData: ['formatPerformance'],
    },
  },
  outcomes: [],
});

const createApi = (overrides = {}) => {
  const data = defaultData();
  const calls = [];
  const api = {
    calls,
    getYouTubePerformanceStatus: async () => { calls.push('status'); return data.status; },
    getYouTubeLastSync: async () => { calls.push('lastSync'); return data.lastSync; },
    listPerformanceRecords: async () => { calls.push('records'); return data.records; },
    getPerformanceBaseline: async () => { calls.push('baseline'); return data.baseline; },
    listPerformanceSignals: async () => { calls.push('signals'); return data.signals; },
    listChannelLearnings: async () => { calls.push('learnings'); return data.learnings; },
    getCreatorIntelligenceContext: async () => { calls.push('context'); return data.context; },
    listDecisionOutcomes: async () => { calls.push('outcomes'); return data.outcomes; },
    syncYouTubePerformance: async (input) => { calls.push(['sync', structuredClone(input)]); return { created: 1, updated: 0 }; },
    getDecisionEvidence: async (id) => { calls.push(['decision', id]); return data.decision; },
    ...overrides,
  };
  return api;
};

const createDom = () => {
  const panel = new FakeElement('article');
  const root = new FakeElement('section');
  root.selectorMap.set('.performance-operations', panel);
  const selectors = [
    '[data-performance-feedback]', '[data-youtube-performance-status]', '[data-youtube-last-sync]',
    '[data-performance-sync-form]', '[data-performance-mode]', '[data-performance-start]',
    '[data-performance-end]', '[data-performance-limit]', '[data-performance-video-field]',
    '[data-performance-video-id]', '[data-performance-sync]', '[data-performance-video-title]',
    '[data-performance-collected-at]', '[data-performance-formats]', '[data-performance-signals]',
    '[data-channel-learnings]', '[data-performance-decisions]', '[data-decision-evidence]',
    '[data-decision-outcomes]',
    '[data-baseline-sample]',
  ];
  for (const selector of selectors) panel.selectorMap.set(selector, new FakeElement());
  for (const field of [
    'views', 'engagedViews', 'watchTimeMinutes', 'averageViewDurationSeconds', 'averageViewPercentage',
    'subscribersGained', 'subscribersLost', 'likes', 'comments',
  ]) panel.selectorMap.set(`[data-performance-metric="${field}"]`, new FakeElement('strong'));
  for (const field of [
    'views', 'watchTimeMinutes', 'averageViewDurationSeconds', 'averageViewPercentage',
    'subscribersGained', 'subscribersPerThousandViews',
  ]) {
    panel.selectorMap.set(`[data-baseline-median="${field}"]`, new FakeElement('strong'));
    panel.selectorMap.set(`[data-baseline-average="${field}"]`, new FakeElement('small'));
  }
  panel.querySelector('[data-performance-mode]').value = 'recent';
  panel.querySelector('[data-performance-start]').value = '2026-08-01';
  panel.querySelector('[data-performance-end]').value = '2026-08-24';
  panel.querySelector('[data-performance-limit]').value = '20';
  return { root, panel, get: (selector) => panel.querySelector(selector) };
};

const originalDocument = globalThis.document;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
afterEach(() => { globalThis.document = { createElement: (tag) => new FakeElement(tag) }; });
process.on('exit', () => { globalThis.document = originalDocument; });

test('Analytics markup exposes accessible operational regions without redesigning navigation', () => {
  const markup = analyticsModule.render({});
  assert.match(markup, /data-performance-sync-form/);
  assert.match(markup, /data-youtube-performance-status/);
  assert.match(markup, /data-performance-signals/);
  assert.match(markup, /data-channel-learnings/);
  assert.match(markup, /data-decision-evidence/);
  assert.match(markup, /aria-live="polite"/);
});

test('performance formatting preserves unavailable values instead of turning them into zero', () => {
  assert.equal(formatPerformanceValue(null), '--');
  assert.equal(formatPerformanceValue(undefined), '--');
  assert.notEqual(formatPerformanceValue(0), '--');
  assert.equal(formatPerformanceValue(125, 'duration'), '2:05');
  assert.match(formatPerformanceValue(48.5, 'percent'), /48,5%/);
});

test('mount loads every real data source once and renders provider state', async () => {
  const api = createApi();
  const dom = createDom();
  createAnalyticsController({ api }).mount(dom.root);
  await flush();
  assert.deepEqual(api.calls, ['status', 'lastSync', 'records', 'baseline', 'signals', 'learnings', 'context', 'outcomes']);
  assert.equal(dom.get('[data-youtube-performance-status]').textContent, 'Sincronizado');
  assert.equal(dom.get('[data-performance-feedback]').hidden, true);
});

test('renders evaluated editorial outcomes from real API data as literal text', async () => {
  const unsafeRecommendation = '<img src=x onerror=alert(1)>';
  const api = createApi({
    listDecisionOutcomes: async () => [{
      id: 'outcome-1',
      classification: 'POSITIVE',
      confidence: 0.8,
      interpretation: { summary: 'Resultado acima do baseline.' },
      supportingMetrics: [{ metric: 'views', label: 'Views' }],
      contradictingMetrics: [],
      snapshot: { title: 'Video avaliado' },
      decisionVideoLink: { decision: { recommendation: unsafeRecommendation } },
    }],
  });
  const dom = createDom();
  createAnalyticsController({ api }).mount(dom.root);
  await flush();
  const row = dom.get('[data-decision-outcomes]').children[0];
  assert.equal(row.children[0].textContent, 'Video avaliado');
  assert.equal(row.children[1].textContent, unsafeRecommendation);
  assert.equal(row.children[1].children.length, 0);
  assert.match(row.children[2].textContent, /POSITIVE/);
});

test('renders the latest persisted snapshot and every supported metric', async () => {
  const dom = createDom();
  createAnalyticsController({ api: createApi() }).mount(dom.root);
  await flush();
  assert.equal(dom.get('[data-performance-video-title]').textContent, 'Video persistido');
  assert.equal(dom.get('[data-performance-metric="views"]').textContent, '1.200');
  assert.equal(dom.get('[data-performance-metric="averageViewDurationSeconds"]').textContent, '2:05');
  assert.match(dom.get('[data-performance-metric="averageViewPercentage"]').textContent, /48,5%/);
  assert.equal(dom.get('[data-performance-metric="subscribersLost"]').textContent, '2');
});

test('renders null snapshot metrics as unavailable', async () => {
  const api = createApi({ listPerformanceRecords: async () => [{ title: 'Parcial', views: null, likes: null }] });
  const dom = createDom();
  createAnalyticsController({ api }).mount(dom.root);
  await flush();
  assert.equal(dom.get('[data-performance-metric="views"]').textContent, '--');
  assert.equal(dom.get('[data-performance-metric="likes"]').textContent, '--');
});

test('renders baseline sample, medians and format comparisons', async () => {
  const dom = createDom();
  createAnalyticsController({ api: createApi() }).mount(dom.root);
  await flush();
  assert.equal(dom.get('[data-baseline-sample]').textContent, '4 videos na amostra');
  assert.equal(dom.get('[data-baseline-median="views"]').textContent, '900');
  assert.equal(dom.get('[data-performance-formats]').children[0].children[0].textContent, 'narrado');
});

test('marks a baseline with few samples as initial', async () => {
  const api = createApi({
    getPerformanceBaseline: async () => ({
      views: baselineMetric(10, 10, 1), byFormat: {},
    }),
  });
  const dom = createDom();
  createAnalyticsController({ api }).mount(dom.root);
  await flush();
  assert.equal(dom.get('[data-baseline-sample]').textContent, 'Amostra inicial: 1');
});

test('renders signals as facts and memory as revisable inference without raw JSON', async () => {
  const dom = createDom();
  createAnalyticsController({ api: createApi() }).mount(dom.root);
  await flush();
  const signal = dom.get('[data-performance-signals]').children[0];
  const learning = dom.get('[data-channel-learnings]').children[0];
  assert.match(signal.children[1].textContent, /Fato observado/);
  assert.match(learning.children[2].textContent, /Inferencia revisavel/);
  assert.doesNotMatch(learning.children.map(({ textContent }) => textContent).join(' '), /\{"sampleSize"/);
});

test('empty datasets render honest empty states', async () => {
  const api = createApi({
    listPerformanceRecords: async () => [],
    listPerformanceSignals: async () => [],
    listChannelLearnings: async () => [],
    getCreatorIntelligenceContext: async () => ({ previousDecisions: [] }),
  });
  const dom = createDom();
  createAnalyticsController({ api }).mount(dom.root);
  await flush();
  assert.equal(dom.get('[data-performance-video-title]').textContent, 'Nenhuma coleta');
  assert.match(dom.get('[data-performance-signals]').children[0].textContent, /Nenhum sinal/);
  assert.match(dom.get('[data-channel-learnings]').children[0].textContent, /Nenhum aprendizado/);
});

test('manual recent sync sends one bounded request and refreshes all data', async () => {
  const api = createApi();
  const dom = createDom();
  const controller = createAnalyticsController({ api });
  controller.mount(dom.root);
  await flush();
  await dom.get('[data-performance-sync-form]').dispatch('submit');
  const syncCalls = api.calls.filter((call) => Array.isArray(call) && call[0] === 'sync');
  assert.deepEqual(syncCalls, [['sync', {
    mode: 'recent', startDate: '2026-08-01', endDate: '2026-08-24', limit: 20,
  }]]);
  assert.equal(api.calls.filter((call) => call === 'records').length, 2);
  assert.match(dom.get('[data-performance-feedback]').textContent, /1 registro/);
  assert.equal(dom.get('[data-performance-sync]').disabled, false);
});

test('repeated submit while synchronization is pending makes one request', async () => {
  const pending = deferred();
  let calls = 0;
  const api = createApi({ syncYouTubePerformance: async () => { calls += 1; return pending.promise; } });
  const dom = createDom();
  createAnalyticsController({ api }).mount(dom.root);
  await flush();
  const form = dom.get('[data-performance-sync-form]');
  const first = form.dispatch('submit');
  const second = form.dispatch('submit');
  await flush();
  assert.equal(calls, 1);
  assert.equal(dom.get('[data-performance-sync]').disabled, true);
  pending.resolve({ created: 0, updated: 1 });
  await Promise.all([first, second]);
});

test('video mode exposes the video field and sends its persisted identifier', async () => {
  const api = createApi();
  const dom = createDom();
  createAnalyticsController({ api }).mount(dom.root);
  await flush();
  dom.get('[data-performance-mode]').value = 'video';
  await dom.get('[data-performance-mode]').dispatch('change');
  dom.get('[data-performance-video-id]').value = 'video-123';
  await dom.get('[data-performance-sync-form]').dispatch('submit');
  const call = api.calls.find((item) => Array.isArray(item) && item[0] === 'sync');
  assert.equal(dom.get('[data-performance-video-field]').hidden, false);
  assert.equal(call[1].videoId, 'video-123');
});

test('expected synchronization errors remain local and understandable', async (t) => {
  for (const [status, pattern] of [
    [401, /Autorize o Google/], [429, /cota/], [503, /indisponivel/], [400, /Revise o periodo/],
  ]) {
    await t.test(`status ${status}`, async () => {
      const api = createApi({ syncYouTubePerformance: async () => { throw Object.assign(new Error('private'), { status }); } });
      const dom = createDom();
      createAnalyticsController({ api }).mount(dom.root);
      await flush();
      await dom.get('[data-performance-sync-form]').dispatch('submit');
      assert.match(dom.get('[data-performance-feedback]').textContent, pattern);
      assert.doesNotMatch(dom.get('[data-performance-feedback]').textContent, /private/);
    });
  }
});

test('a partial load failure keeps valid sections and shows local feedback', async () => {
  const api = createApi({ listPerformanceSignals: async () => { throw Object.assign(new Error('private'), { status: 503 }); } });
  const dom = createDom();
  createAnalyticsController({ api }).mount(dom.root);
  await flush();
  assert.equal(dom.get('[data-performance-video-title]').textContent, 'Video persistido');
  assert.match(dom.get('[data-performance-signals]').children[0].textContent, /Nao foi possivel/);
  assert.match(dom.get('[data-performance-feedback]').textContent, /indisponivel/);
});

test('decision evidence is loaded by id and rendered as literal text', async () => {
  const api = createApi();
  const dom = createDom();
  createAnalyticsController({ api }).mount(dom.root);
  await flush();
  const button = dom.get('[data-performance-decisions]').children[0];
  await dom.get('[data-performance-decisions]').dispatch('click', { target: button });
  assert.deepEqual(api.calls.find((item) => Array.isArray(item) && item[0] === 'decision'), ['decision', 'decision-1']);
  const content = dom.get('[data-decision-evidence]').children[0];
  assert.equal(content.children[1].textContent, '<b>Justificativa literal</b>');
  assert.equal(content.children[3].children[1].children[0].textContent, '<img src=x onerror=alert(1)>');
});

test('a late initial response after unmount does not alter detached UI', async () => {
  const pending = deferred();
  const api = createApi({ listPerformanceRecords: () => pending.promise });
  const dom = createDom();
  const controller = createAnalyticsController({ api });
  controller.mount(dom.root);
  controller.unmount();
  pending.resolve([{ title: 'Resposta obsoleta', views: 999 }]);
  await flush();
  assert.equal(dom.get('[data-performance-video-title]').textContent, '');
});

test('a late synchronization after unmount does not report success in old UI', async () => {
  const pending = deferred();
  const api = createApi({ syncYouTubePerformance: () => pending.promise });
  const dom = createDom();
  const controller = createAnalyticsController({ api });
  controller.mount(dom.root);
  await flush();
  const request = dom.get('[data-performance-sync-form]').dispatch('submit');
  controller.unmount();
  pending.resolve({ created: 1, updated: 0 });
  await request;
  assert.doesNotMatch(dom.get('[data-performance-feedback]').textContent, /concluida/);
});

test('mounting the same DOM twice keeps listeners unique', async () => {
  const api = createApi();
  const dom = createDom();
  const controller = createAnalyticsController({ api });
  controller.mount(dom.root);
  controller.mount(dom.root);
  await flush();
  assert.equal(dom.get('[data-performance-sync-form]').listenerCount('submit'), 1);
  assert.equal(dom.get('[data-performance-mode]').listenerCount('change'), 1);
  assert.equal(dom.get('[data-performance-decisions]').listenerCount('click'), 1);
});

test('unmount removes all controller listeners', async () => {
  const dom = createDom();
  const controller = createAnalyticsController({ api: createApi() });
  controller.mount(dom.root);
  await flush();
  controller.unmount();
  assert.equal(dom.get('[data-performance-sync-form]').listenerCount('submit'), 0);
  assert.equal(dom.get('[data-performance-mode]').listenerCount('change'), 0);
  assert.equal(dom.get('[data-performance-decisions]').listenerCount('click'), 0);
});
