import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';

import { analyticsModule } from '../src/modules/analytics.js';
import { createLibraryController, libraryModule } from '../src/modules/library.js';
import { createOperatorsController } from '../src/modules/operators.js';
import { dashboardModules } from '../src/modules/index.js';
import { createApiClient } from '../src/api/client.js';

class FakeClassList {
  constructor(element) { this.element = element; }
  toggle(name, enabled) {
    const values = new Set(this.element.className.split(/\s+/).filter(Boolean));
    if (enabled) values.add(name); else values.delete(name);
    this.element.className = [...values].join(' ');
  }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.selectorMap = new Map(); this.listeners = new Map();
    this.attributes = new Map(); this.children = []; this.dataset = {}; this.className = '';
    this.classList = new FakeClassList(this); this.textContent = ''; this.hidden = false;
    this.disabled = false; this.href = ''; this.type = '';
  }
  querySelector(selector) { return this.selectorMap.get(selector) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  async dispatch(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) await listener({ target: this, ...event }); }
  closest(selector) { return selector === '[data-library-page-item]' && this.dataset.libraryPageItem ? this : null; }
}

const originalDocument = globalThis.document;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
after(() => { globalThis.document = originalDocument; });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

const channelAnalysis = (overrides = {}) => ({
  id: 'ctr', name: 'Operador de CTR', responsibility: 'Analisar CTR real.', status: 'AVAILABLE',
  source: 'persisted-youtube-performance', sampleSize: 2, confidence: 0.8,
  lastDataAt: '2026-08-25T12:00:00.000Z',
  facts: [{ label: 'CTR mediano', value: 8, unit: 'percent' }],
  signals: [{ classification: 'fact', summary: 'Vídeo acima da mediana.' }],
  insights: ['Associação observada.'], recommendations: ['Investigue a embalagem.'],
  missingData: [], evidence: [{ title: '<img src=x onerror=alert(1)>', videoId: 'video-1', collectedAt: '2026-08-25T12:00:00.000Z' }],
  quality: { state: 'GOOD', freshness: 'RECENT', completeness: 1, consistency: 1, reasons: [] },
  baselines: [{ scope: 'canal', median: 8, sampleSize: 2 }],
  ...overrides,
});

const createOperatorsDom = () => {
  const panel = new FakeElement('article'); const root = new FakeElement('section');
  const list = new FakeElement('ul'); const feedback = new FakeElement();
  root.selectorMap.set('.operators-panel', panel);
  panel.selectorMap.set('[data-operator-list]', list);
  panel.selectorMap.set('[data-operator-feedback]', feedback);
  return { root, panel, list, feedback };
};

test('Operators Hub renders real status and only registered actions', async () => {
  const dom = createOperatorsDom();
  createOperatorsController({ api: { listChannelOperators: async () => [channelAnalysis()] }, modules: dashboardModules }).mount(dom.root);
  await flush();
  const ctr = dom.list.children.find((item) => item.children[0].children[0].textContent === 'Operador de CTR');
  const planned = dom.list.children.find((item) => item.children[0].children[0].textContent === 'Novos operadores');
  assert.equal(ctr.children[0].children[1].textContent, 'Disponível');
  assert.equal(ctr.children.at(-1).href, '#/analytics/ctr');
  assert.equal(planned.children.at(-1).textContent, 'Em breve');
  assert.equal(planned.children.at(-1).href, '');
});

test('a late Operators response after unmount is ignored', async () => {
  const pending = deferred(); const dom = createOperatorsDom();
  const controller = createOperatorsController({ api: { listChannelOperators: () => pending.promise }, modules: dashboardModules });
  controller.mount(dom.root); const initial = dom.list.children.length; controller.unmount();
  pending.resolve([channelAnalysis()]); await flush();
  assert.equal(dom.list.children.length, initial);
});

test('Operators Hub reports API failure locally and keeps planned truth visible', async () => {
  const dom = createOperatorsDom();
  createOperatorsController({ api: { listChannelOperators: async () => { throw new Error('private'); } }, modules: dashboardModules }).mount(dom.root);
  await flush();
  assert.match(dom.feedback.textContent, /Não foi possível atualizar/);
  assert.doesNotMatch(dom.feedback.textContent, /private/);
  assert.ok(dom.list.children.some((item) => item.children[0].children[0].textContent === 'Novos operadores'));
});

const createAnalyticsDom = (id = 'ctr') => {
  const panel = new FakeElement('article'); const root = new FakeElement('section'); const summary = new FakeElement('section');
  summary.dataset.operatorId = id; root.selectorMap.set('.channel-operator-workspace', panel);
  panel.selectorMap.set('[data-channel-operator-summary]', summary);
  for (const selector of [
    '[data-channel-operator-feedback]', '[data-channel-operator-responsibility]', '[data-channel-operator-status]',
    '[data-channel-operator-meta]', '[data-channel-operator-facts]', '[data-channel-operator-signals]',
    '[data-channel-operator-insights]', '[data-channel-operator-recommendations]', '[data-channel-operator-missing]',
    '[data-channel-operator-evidence]', '[data-channel-operator-quality]', '[data-channel-operator-baselines]',
  ]) panel.selectorMap.set(selector, new FakeElement());
  return { root, panel, summary, get: (selector) => panel.querySelector(selector) };
};

test('Analytics contextual route renders one specialized operator with safe evidence', async () => {
  const calls = []; const dom = createAnalyticsDom();
  const controller = analyticsModule.createController({ api: { getChannelOperator: async (id) => { calls.push(id); return channelAnalysis(); } } });
  controller.mount(dom.root); await flush();
  assert.deepEqual(calls, ['ctr']);
  assert.equal(dom.get('[data-channel-operator-status]').textContent, 'Disponível');
  assert.equal(dom.get('[data-channel-operator-facts]').children[0].children[0].textContent, 'CTR mediano: 8%');
  assert.match(dom.get('[data-channel-operator-evidence]').children[0].children[0].textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(dom.get('[data-channel-operator-quality]').children[0].children[0].textContent, 'Estado: GOOD');
  assert.match(dom.get('[data-channel-operator-baselines]').children[0].children[0].textContent, /canal: mediana 8%/);
  assert.match(analyticsModule.render({}, { route: { subpath: 'retention' } }), /data-operator-id="retention"/);
});

test('specialized Analytics ignores a response received after unmount', async () => {
  const pending = deferred(); const dom = createAnalyticsDom();
  const controller = analyticsModule.createController({ api: { getChannelOperator: () => pending.promise } });
  controller.mount(dom.root); controller.unmount(); pending.resolve(channelAnalysis()); await flush();
  assert.equal(dom.get('[data-channel-operator-status]').textContent, '');
});

test('specialized Analytics renders honest missing-data and safe error states', async () => {
  const emptyDom = createAnalyticsDom();
  analyticsModule.createController({ api: { getChannelOperator: async () => channelAnalysis({
    status: 'NOT_CONFIGURED', sampleSize: 0, confidence: 0, facts: [], evidence: [],
    missingData: ['impressions', 'ctr'],
  }) } }).mount(emptyDom.root);
  await flush();
  assert.equal(emptyDom.get('[data-channel-operator-status]').textContent, 'Não configurado');
  assert.equal(emptyDom.get('[data-channel-operator-missing]').children[0].children.length, 2);

  const errorDom = createAnalyticsDom();
  analyticsModule.createController({ api: { getChannelOperator: async () => { throw Object.assign(new Error('raw'), { status: 500 }); } } }).mount(errorDom.root);
  await flush();
  assert.match(errorDom.get('[data-channel-operator-feedback]').textContent, /Não foi possível carregar/);
  assert.doesNotMatch(errorDom.get('[data-channel-operator-feedback]').textContent, /raw/);
});

const createLibraryDom = () => {
  const panel = new FakeElement('article'); const root = new FakeElement('section');
  const list = new FakeElement(); const reader = new FakeElement(); const feedback = new FakeElement();
  root.selectorMap.set('.library-page', panel);
  panel.selectorMap.set('[data-library-page-list]', list);
  panel.selectorMap.set('[data-library-page-reader]', reader);
  panel.selectorMap.set('[data-library-page-feedback]', feedback);
  return { root, list, reader, feedback };
};

test('standalone Library loads persisted items and opens literal content', async () => {
  const dom = createLibraryDom(); const calls = [];
  const controller = createLibraryController({ api: {
    listLibraryItems: async () => [{ id: 'item-1', title: 'Roteiro', type: 'planner-response' }],
    getLibraryItem: async (id) => { calls.push(id); return { id, title: 'Roteiro', type: 'planner-response', content: '<script>alert(1)</script>' }; },
  } });
  controller.mount(dom.root); await flush();
  const button = dom.list.children[0];
  await dom.list.dispatch('click', { target: button }); await flush();
  assert.deepEqual(calls, ['item-1']);
  assert.equal(dom.reader.children[2].textContent, '<script>alert(1)</script>');
  assert.match(libraryModule.render(), /data-library-page-list/);
});

test('standalone Library ignores late list responses after unmount', async () => {
  const pending = deferred(); const dom = createLibraryDom();
  const controller = createLibraryController({ api: { listLibraryItems: () => pending.promise } });
  controller.mount(dom.root); controller.unmount(); pending.resolve([{ id: 'late', title: 'Late' }]); await flush();
  assert.equal(dom.list.children.length, 0);
});

test('standalone Library exposes empty and local error states without false items', async () => {
  const empty = createLibraryDom();
  createLibraryController({ api: { listLibraryItems: async () => [] } }).mount(empty.root);
  await flush();
  assert.equal(empty.list.children[0].textContent, 'A Biblioteca ainda está vazia.');

  const failed = createLibraryDom();
  createLibraryController({ api: { listLibraryItems: async () => { throw new Error('private'); } } }).mount(failed.root);
  await flush();
  assert.equal(failed.list.children.length, 0);
  assert.match(failed.feedback.textContent, /Não foi possível carregar/);
  assert.doesNotMatch(failed.feedback.textContent, /private/);
});

test('Analytics CTR route integrates persisted SQLite data through HTTP into the UI', async () => {
  process.env.DATABASE_URL = ':memory:';
  const require = createRequire(import.meta.url);
  const express = require('../../backend/node_modules/express');
  const { DatabaseService } = require('../../backend/dist/database/DatabaseService');
  const { VideoPerformanceSnapshotRepository } = require('../../backend/dist/database/repositories/VideoPerformanceSnapshotRepository');
  const { VideoReachSnapshotRepository } = require('../../backend/dist/database/repositories/VideoReachSnapshotRepository');
  const { ChannelOperatorService } = require('../../backend/dist/services/channel-operators/ChannelOperatorService');
  const { createChannelOperatorsRouter } = require('../../backend/dist/routes/channelOperators');
  const client = await DatabaseService.connect();
  await client.$executeRawUnsafe(`CREATE TABLE "VideoPerformanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE,
    "videoId" TEXT NOT NULL, "title" TEXT NOT NULL, "game" TEXT, "series" TEXT, "format" TEXT,
    "publishedAt" DATETIME, "periodStart" DATETIME, "periodEnd" DATETIME,
    "views" REAL, "engagedViews" REAL, "impressions" REAL, "ctr" REAL, "durationSeconds" REAL,
    "averageViewDurationSeconds" REAL, "averageViewPercentage" REAL, "watchTimeMinutes" REAL,
    "subscribersGained" INTEGER, "subscribersLost" INTEGER, "likes" INTEGER, "comments" INTEGER,
    "source" TEXT NOT NULL, "confidence" REAL NOT NULL DEFAULT 1, "collectedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  )`);
  await client.videoPerformanceSnapshot.create({ data: {
    id: 'integrated-snapshot', ingestionKey: 'integrated-ingestion', videoId: 'integrated-video',
    title: 'Vídeo integrado', format: 'long-form', views: 1200, impressions: 10000, ctr: 9,
    averageViewDurationSeconds: 180, averageViewPercentage: 50, watchTimeMinutes: 3000,
    subscribersGained: 10, source: 'youtube-analytics', confidence: 1,
    collectedAt: new Date('2026-08-25T12:00:00.000Z'),
  } });
  await client.$executeRawUnsafe(`CREATE TABLE "VideoReachSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE,
    "videoId" TEXT NOT NULL, "periodStart" DATETIME NOT NULL, "periodEnd" DATETIME NOT NULL,
    "impressions" REAL NOT NULL, "ctr" REAL NOT NULL, "source" TEXT NOT NULL, "reportId" TEXT,
    "jobId" TEXT, "reportCreatedAt" DATETIME, "collectedAt" DATETIME NOT NULL,
    "freshnessAtCollection" TEXT NOT NULL, "qualityAtCollection" TEXT NOT NULL,
    "qualityReasons" JSONB NOT NULL, "providerMetadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  )`);
  await client.videoReachSnapshot.create({ data: {
    id: 'integrated-reach', ingestionKey: 'integrated-reach-key', videoId: 'integrated-video',
    periodStart: new Date('2026-08-25T00:00:00.000Z'), periodEnd: new Date('2026-08-26T00:00:00.000Z'),
    impressions: 10000, ctr: 9, source: 'youtube-reporting-reach', reportId: 'report', jobId: 'job',
    collectedAt: new Date('2026-08-26T03:00:00.000Z'), freshnessAtCollection: 'RECENT',
    qualityAtCollection: 'PARTIAL', qualityReasons: [], providerMetadata: {},
  } });
  const app = express();
  app.use('/api/operators/channel', createChannelOperatorsRouter(
    new ChannelOperatorService(new VideoPerformanceSnapshotRepository(client), new VideoReachSnapshotRepository(client)),
  ));
  const server = await new Promise((resolve) => {
    const active = app.listen(0, '127.0.0.1', () => resolve(active));
  });
  try {
    const dom = createAnalyticsDom();
    const controller = analyticsModule.createController({ api: createApiClient(`http://127.0.0.1:${server.address().port}`) });
    controller.mount(dom.root);
    for (let attempt = 0; attempt < 20 && dom.get('[data-channel-operator-status]').textContent === ''; attempt += 1) await flush();
    assert.equal(dom.get('[data-channel-operator-status]').textContent, 'Disponível');
    assert.equal(dom.get('[data-channel-operator-facts]').children[0].children[1].textContent, 'CTR mediano: 9%');
    controller.unmount();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await DatabaseService.disconnect();
  }
});
