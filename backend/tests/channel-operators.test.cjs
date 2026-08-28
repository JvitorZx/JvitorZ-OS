const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { VideoReachSnapshotRepository } = require('../dist/database/repositories/VideoReachSnapshotRepository');
const { AudienceSnapshotRepository } = require('../dist/database/repositories/AudienceSnapshotRepository');
const { ChannelOperatorService } = require('../dist/services/channel-operators/ChannelOperatorService');
const { createChannelOperatorsRouter } = require('../dist/routes/channelOperators');
const { classifyOrchestrationIntent, createOrchestrationPlan } = require('../dist/services/orchestration/IntentRouter');
const { createDefaultCapabilityRegistry } = require('../dist/services/orchestration/OrchestrationComposition');
const { OrchestratorService } = require('../dist/services/orchestration/OrchestratorService');

let client;
let service;
let server;
let baseUrl;

const snapshot = (id, overrides = {}) => ({
  id, ingestionKey: `ingestion-${id}`, videoId: `video-${id}`, title: `Vídeo ${id}`,
  game: 'BeamNG.drive', series: 'Testes', format: 'long-form', views: 1000,
  impressions: 10000, ctr: 8, durationSeconds: 600, averageViewDurationSeconds: 300,
  averageViewPercentage: 50, watchTimeMinutes: 5000, subscribersGained: 12,
  subscribersLost: 1, likes: 80, comments: 10, source: 'youtube-analytics', confidence: 1,
  collectedAt: new Date(`2026-08-${id === 'a' ? '20' : '21'}T12:00:00.000Z`), ...overrides,
});
const reach = (id, overrides = {}) => ({
  id: `reach-${id}`, ingestionKey: `reach-ingestion-${id}`, videoId: `video-${id}`,
  periodStart: new Date(`2026-08-${id === 'a' ? '20' : '21'}T00:00:00.000Z`),
  periodEnd: new Date(`2026-08-${id === 'a' ? '21' : '22'}T00:00:00.000Z`),
  impressions: 10000, ctr: 8, source: 'youtube-reporting-reach', reportId: 'report', jobId: 'job',
  reportCreatedAt: new Date('2026-08-22T03:00:00.000Z'), collectedAt: new Date('2026-08-22T04:00:00.000Z'),
  freshnessAtCollection: 'RECENT', qualityAtCollection: 'PARTIAL', qualityReasons: [], providerMetadata: {},
  ...overrides,
});

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await client.$executeRawUnsafe('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)');
  await client.$executeRawUnsafe(`CREATE TABLE "VideoPerformanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE,
    "videoId" TEXT NOT NULL, "title" TEXT NOT NULL, "game" TEXT, "series" TEXT, "format" TEXT,
    "publishedAt" DATETIME, "periodStart" DATETIME, "periodEnd" DATETIME,
    "views" REAL, "engagedViews" REAL, "impressions" REAL, "ctr" REAL, "durationSeconds" REAL,
    "averageViewDurationSeconds" REAL, "averageViewPercentage" REAL, "watchTimeMinutes" REAL,
    "subscribersGained" INTEGER, "subscribersLost" INTEGER, "likes" INTEGER, "comments" INTEGER,
    "source" TEXT NOT NULL, "confidence" REAL NOT NULL DEFAULT 1, "collectedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL
  )`);
  await client.$executeRawUnsafe(`CREATE TABLE "VideoReachSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE,
    "videoId" TEXT NOT NULL, "periodStart" DATETIME NOT NULL, "periodEnd" DATETIME NOT NULL,
    "impressions" REAL NOT NULL, "ctr" REAL NOT NULL, "source" TEXT NOT NULL, "reportId" TEXT,
    "jobId" TEXT, "reportCreatedAt" DATETIME, "collectedAt" DATETIME NOT NULL,
    "freshnessAtCollection" TEXT NOT NULL, "qualityAtCollection" TEXT NOT NULL,
    "qualityReasons" JSONB NOT NULL, "providerMetadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL
  )`);
  await client.$executeRawUnsafe(`CREATE TABLE "AudienceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE,
    "dimension" TEXT NOT NULL, "segment" TEXT NOT NULL, "format" TEXT,
    "periodStart" DATETIME NOT NULL, "periodEnd" DATETIME NOT NULL, "views" REAL,
    "engagedViews" REAL, "watchTimeMinutes" REAL, "averageViewDurationSeconds" REAL,
    "averageViewPercentage" REAL, "source" TEXT NOT NULL, "collectedAt" DATETIME NOT NULL,
    "freshnessAtCollection" TEXT NOT NULL, "qualityAtCollection" TEXT NOT NULL,
    "qualityReasons" JSONB NOT NULL, "providerMetadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL
  )`);
  service = new ChannelOperatorService(
    new VideoPerformanceSnapshotRepository(client),
    new VideoReachSnapshotRepository(client),
    undefined,
    new AudienceSnapshotRepository(client),
  );
  const app = express();
  app.use(express.json());
  app.use(createChannelOperatorsRouter(service));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

beforeEach(async () => {
  await client.audienceSnapshot.deleteMany();
  await client.videoReachSnapshot.deleteMany();
  await client.videoPerformanceSnapshot.deleteMany();
  await client.project.deleteMany();
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await DatabaseService.disconnect();
});

const request = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
};

describe('specialized channel operators', { concurrency: false }, () => {
  test('returns the complete neutral contract without data fabrication', async () => {
    const analyses = await service.list();
    assert.deepEqual(analyses.map(({ id }) => id), ['ctr', 'retention', 'long-form', 'shorts']);
    for (const analysis of analyses) {
      assert.equal(analysis.status, 'NOT_CONFIGURED');
      assert.equal(analysis.sampleSize, 0);
      assert.equal(analysis.confidence, 0);
      for (const field of ['facts', 'signals', 'insights', 'recommendations', 'missingData', 'evidence']) {
        assert.ok(Array.isArray(analysis[field]));
      }
    }
  });

  test('computes CTR only from persisted impressions and CTR', async () => {
    await client.videoPerformanceSnapshot.createMany({ data: [snapshot('a', { ctr: null, impressions: null }), snapshot('b', { ctr: null, impressions: null })] });
    await client.videoReachSnapshot.createMany({ data: [reach('a', { ctr: 6 }), reach('b', { ctr: 10 })] });
    const analysis = await service.run('ctr');
    assert.equal(analysis.status, 'AVAILABLE');
    assert.equal(analysis.source, 'youtube-reporting-reach');
    assert.equal(analysis.facts.find(({ label }) => label === 'CTR mediano').value, 8);
    assert.equal(analysis.evidence.length, 2);
    assert.doesNotMatch(JSON.stringify(analysis), /thumbnail causou|views exatas/i);
  });

  test('reports missing CTR instead of deriving it from views', async () => {
    await client.videoPerformanceSnapshot.create({ data: snapshot('a', { ctr: null, impressions: null }) });
    const analysis = await service.run('ctr');
    assert.equal(analysis.status, 'LIMITED');
    assert.deepEqual(analysis.missingData, ['YouTube reach report (impressions, CTR)']);
    assert.equal(analysis.sampleSize, 0);
  });

  test('limits retention claims when no granular curve exists', async () => {
    await client.videoPerformanceSnapshot.create({ data: snapshot('a') });
    const analysis = await service.run('retention');
    assert.equal(analysis.status, 'LIMITED');
    assert.deepEqual(analysis.missingData, ['retention curve / initial retention']);
    assert.match(analysis.insights[0], /não existe granularidade suficiente/i);
  });

  test('keeps long-form and Shorts samples explicitly classified and isolated', async () => {
    await client.videoPerformanceSnapshot.createMany({ data: [snapshot('a', { format: 'long-form' }), snapshot('b', { format: 'Shorts' })] });
    const longForm = await service.run('long-form');
    const shorts = await service.run('shorts');
    assert.equal(longForm.sampleSize, 1);
    assert.equal(shorts.sampleSize, 1);
    assert.equal(longForm.evidence[0].videoId, 'video-a');
    assert.equal(shorts.evidence[0].videoId, 'video-b');
  });

  test('enriches Long-form and Shorts with only their matching audience format', async () => {
    await client.videoPerformanceSnapshot.createMany({ data: [snapshot('a', { format: 'long-form' }), snapshot('b', { format: 'Shorts' })] });
    const common = {
      periodStart: new Date('2026-08-20T00:00:00Z'), periodEnd: new Date('2026-08-27T00:00:00Z'),
      engagedViews: 80, watchTimeMinutes: 300, averageViewDurationSeconds: null,
      averageViewPercentage: null, source: 'youtube-analytics-audience',
      collectedAt: new Date('2026-08-27T01:00:00Z'), freshnessAtCollection: 'RECENT',
      qualityAtCollection: 'GOOD', qualityReasons: [], providerMetadata: {},
    };
    await client.audienceSnapshot.createMany({ data: [
      { id: 'audience-long-source', ingestionKey: 'audience-long-source', dimension: 'traffic_source', segment: 'BROWSE', format: 'LONG_FORM', views: 100, ...common },
      { id: 'audience-long-country', ingestionKey: 'audience-long-country', dimension: 'country', segment: 'BR', format: 'LONG_FORM', views: 90, ...common },
      { id: 'audience-long-device', ingestionKey: 'audience-long-device', dimension: 'device_type', segment: 'COMPUTER', format: 'LONG_FORM', views: 70, ...common },
      { id: 'audience-long-subscribed', ingestionKey: 'audience-long-subscribed', dimension: 'subscribed_status', segment: 'SUBSCRIBED', format: 'LONG_FORM', views: 60, ...common },
      { id: 'audience-short-source', ingestionKey: 'audience-short-source', dimension: 'traffic_source', segment: 'SHORTS', format: 'SHORTS', views: 200, ...common },
      { id: 'audience-short-country', ingestionKey: 'audience-short-country', dimension: 'country', segment: 'US', format: 'SHORTS', views: 180, ...common },
      { id: 'audience-short-device', ingestionKey: 'audience-short-device', dimension: 'device_type', segment: 'MOBILE', format: 'SHORTS', views: 160, ...common },
      { id: 'audience-short-subscribed', ingestionKey: 'audience-short-subscribed', dimension: 'subscribed_status', segment: 'UNSUBSCRIBED', format: 'SHORTS', views: 150, ...common },
    ] });
    const longForm = await service.run('long-form'); const shorts = await service.run('shorts');
    assert.equal(longForm.facts.find(({ label }) => label === 'Principal fonte').value, 'BROWSE');
    assert.equal(longForm.facts.find(({ label }) => label === 'Principal país').value, 'BR');
    assert.equal(shorts.facts.find(({ label }) => label === 'Principal fonte').value, 'SHORTS');
    assert.equal(shorts.facts.find(({ label }) => label === 'Principal dispositivo').value, 'MOBILE');
    assert.equal(longForm.facts.some(({ value }) => ['US', 'MOBILE', 'UNSUBSCRIBED'].includes(value)), false);
    assert.equal(shorts.facts.some(({ value }) => ['BROWSE', 'COMPUTER', 'SUBSCRIBED'].includes(value)), false);
  });

  test('keeps a classified format limited when its usable metrics are absent', async () => {
    await client.videoPerformanceSnapshot.create({ data: snapshot('a', {
      views: null, watchTimeMinutes: null, averageViewPercentage: null, subscribersGained: null,
    }) });
    const analysis = await service.run('long-form');
    assert.equal(analysis.status, 'LIMITED');
    assert.deepEqual(analysis.missingData, ['views', 'watchTime', 'averageViewPercentage', 'subscribersGained', 'audience / traffic source by format']);
    assert.equal(analysis.facts.find(({ label }) => label === 'Watch time observado').value, null);
  });

  test('filters every analysis by project when requested', async () => {
    await client.$executeRawUnsafe(`INSERT INTO "Project" ("id") VALUES ('project-a'), ('project-b')`);
    await client.videoPerformanceSnapshot.createMany({ data: [
      snapshot('a', { projectId: 'project-a' }),
      snapshot('b', { projectId: 'project-b', ingestionKey: 'other-project' }),
    ] });
    await client.videoReachSnapshot.createMany({ data: [
      reach('a', { projectId: 'project-a' }),
      reach('b', { projectId: 'project-b', ingestionKey: 'reach-other-project' }),
    ] });
    const analysis = await service.run('ctr', 'project-a');
    assert.equal(analysis.sampleSize, 1);
    assert.equal(analysis.evidence[0].snapshotId, 'reach-a');
  });
});

describe('channel operator HTTP contracts', { concurrency: false }, () => {
  test('lists and opens operators through safe HTTP responses', async () => {
    await client.videoPerformanceSnapshot.create({ data: snapshot('a') });
    await client.videoReachSnapshot.create({ data: reach('a') });
    const list = await request('/');
    const item = await request('/ctr');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 4);
    assert.equal(item.status, 200);
    assert.equal(item.body.id, 'ctr');
  });

  test('validates query and missing operator without leaking internals', async () => {
    const invalid = await request('/ctr?extra=true');
    const missing = await request('/unknown');
    assert.equal(invalid.status, 400);
    assert.equal(missing.status, 404);
    assert.doesNotMatch(JSON.stringify([invalid.body, missing.body]), /Prisma|stack|DATABASE_URL/i);
  });
});

test('natural language routes to one or combined channel operators', () => {
  assert.equal(classifyOrchestrationIntent('Analise meu CTR'), 'ctr_analysis');
  assert.equal(classifyOrchestrationIntent('Como está a retenção?'), 'retention_analysis');
  assert.equal(classifyOrchestrationIntent('Compare meus vídeos longos'), 'long_form_analysis');
  assert.equal(classifyOrchestrationIntent('Como foram meus Shorts?'), 'shorts_analysis');
  assert.equal(classifyOrchestrationIntent('De onde vêm minhas views?'), 'audience_analysis');
  assert.equal(classifyOrchestrationIntent('As pessoas assistem mais pelo celular ou computador?'), 'audience_analysis');
  assert.deepEqual(createOrchestrationPlan({ intent: 'Qual país mais assiste?' }).capabilities, ['channel-operator.long-form', 'channel-operator.shorts', 'planner.respond']);
  const combined = createOrchestrationPlan({ intent: 'Analise CTR e retenção do canal' });
  assert.deepEqual(combined.capabilities, ['channel-operator.ctr', 'channel-operator.retention', 'planner.respond']);
});

test('Gerente executes combined specialists and consolidates their persisted evidence', async () => {
  await client.videoPerformanceSnapshot.create({ data: snapshot('a') });
  await client.videoReachSnapshot.create({ data: reach('a') });
  const records = [];
  const repository = {
    async create(data) { const now = new Date(); const record = { id: 'execution-channel', status: 'pending', result: null, evidence: null, errorType: null, startedAt: now, completedAt: null, createdAt: now, updatedAt: now, ...structuredClone(data) }; records.push(record); return structuredClone(record); },
    async findById(id) { return structuredClone(records.find((item) => item.id === id) ?? null); },
    async findByIdempotencyKey() { return null; },
    async markRunning(id) { records[0].status = 'running'; return structuredClone(records[0]); },
    async complete(id, data) { Object.assign(records[0], structuredClone(data), { completedAt: new Date() }); return structuredClone(records[0]); },
    async findRecent() { return structuredClone(records); },
  };
  const unused = async () => [];
  const registry = createDefaultCapabilityRegistry({
    intelligence: { listPerformanceRecords: unused, listPerformanceSignals: unused, getPerformanceBaseline: async () => ({}) },
    editorial: { generate: async () => { throw new Error('not used'); } },
    outcomes: { listOutcomes: unused },
    refresh: { listStates: unused, refreshAvailable: async () => ({ reviewed: 0, unchanged: 0, failed: 0 }) },
    supervisor: { getSupervisorOverview: async () => ({ youtubeAnalytics: { state: 'connected' }, outcomeReviews: { reviewAvailable: 0 }, editorial: { risks: [], actions: [] } }) },
    library: { listItems: unused }, youtube: { sync: async () => ({ created: 0, updated: 0 }) },
    channelOperators: service,
  });
  const result = await new OrchestratorService(registry, repository).run({ intent: 'Analise meu CTR e retenção' });
  assert.deepEqual(result.result.steps.map(({ capabilityId }) => capabilityId), [
    'channel-operator.ctr', 'channel-operator.retention', 'planner.respond',
  ]);
  assert.match(result.result.response, /CTR|retenção/i);
  assert.ok(result.result.evidence.facts.length > 0);
});
