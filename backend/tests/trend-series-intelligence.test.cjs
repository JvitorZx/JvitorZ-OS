const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { AudienceSnapshotRepository } = require('../dist/database/repositories/AudienceSnapshotRepository');
const { ContentPatternRepository } = require('../dist/database/repositories/ContentPatternRepository');
const { SeriesDefinitionRepository } = require('../dist/database/repositories/SeriesDefinitionRepository');
const { TrendSignalRepository } = require('../dist/database/repositories/TrendSignalRepository');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { detectTrend, TrendWindowPolicy } = require('../dist/domains/trend-intelligence');
const { ChannelOperatorService } = require('../dist/services/channel-operators/ChannelOperatorService');
const { ContentPatternIntelligenceService } = require('../dist/services/trend-intelligence/ContentPatternIntelligenceService');
const { SeriesIntelligenceService } = require('../dist/services/trend-intelligence/SeriesIntelligenceService');
const { TrendIntelligenceService } = require('../dist/services/trend-intelligence/TrendIntelligenceService');
const { createTemporalIntelligenceRouter } = require('../dist/routes/temporalIntelligence');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');
const { classifyOrchestrationIntent, createOrchestrationPlan } = require('../dist/services/orchestration/IntentRouter');

let client; let snapshots; let audience; let trends; let seriesRepo; let patterns; let trendService; let seriesService; let patternService; let server; let baseUrl;
const now = new Date('2026-09-01T00:00:00.000Z');
const quality = (state = 'GOOD') => ({ state, completeness: state === 'GOOD' ? 1 : 0.6, consistency: state === 'GOOD' ? 1 : 0.7, freshness: state === 'GOOD' ? 'RECENT' : 'STALE', reasons: [] });
const windows = new TrendWindowPolicy().calendar(7, new Date('2026-08-15T00:00:00.000Z'));
const observation = (id, value, occurredAt) => ({ id, videoId: `video-${id}`, value, occurredAt: new Date(occurredAt) });
const classify = (current, previous, state = 'GOOD') => detectTrend({ subject: 'Canal', subjectType: 'CHANNEL', metric: 'views', windows,
  current: current.map((value, index) => observation(`c${index}`, value, `2026-08-${12 + index}T00:00:00Z`)),
  previous: previous.map((value, index) => observation(`p${index}`, value, `2026-08-0${5 + index}T00:00:00Z`)),
  quality: quality(state), detectedAt: now, aggregate: 'mean' });

const snapshot = (id, overrides = {}) => ({
  id, ingestionKey: `ing-${id}`, videoId: `video-${id}`, title: `Vídeo ${id}`, game: 'BeamNG.drive', series: null, format: 'long-form',
  publishedAt: new Date(`2026-08-${String(Number(id.replace(/\D/g, '')) || 1).padStart(2, '0')}T00:00:00Z`), periodStart: null, periodEnd: null,
  views: 100, engagedViews: 90, impressions: 1000, ctr: 8, durationSeconds: 600, averageViewDurationSeconds: 300,
  averageViewPercentage: 50, watchTimeMinutes: 500, subscribersGained: 5, subscribersLost: 0, likes: 10, comments: 2,
  source: 'test', confidence: 1, collectedAt: now, ...overrides,
});

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  const base = `
    CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "VideoPerformanceSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE, "videoId" TEXT NOT NULL, "title" TEXT NOT NULL,
      "game" TEXT, "series" TEXT, "format" TEXT, "publishedAt" DATETIME, "periodStart" DATETIME, "periodEnd" DATETIME, "views" REAL,
      "engagedViews" REAL, "impressions" REAL, "ctr" REAL, "durationSeconds" REAL, "averageViewDurationSeconds" REAL,
      "averageViewPercentage" REAL, "watchTimeMinutes" REAL, "subscribersGained" INTEGER, "subscribersLost" INTEGER, "likes" INTEGER,
      "comments" INTEGER, "source" TEXT NOT NULL, "confidence" REAL NOT NULL DEFAULT 1, "collectedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL
    );
    CREATE TABLE "AudienceSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE, "dimension" TEXT NOT NULL, "segment" TEXT NOT NULL,
      "format" TEXT, "periodStart" DATETIME NOT NULL, "periodEnd" DATETIME NOT NULL, "views" REAL, "engagedViews" REAL,
      "watchTimeMinutes" REAL, "averageViewDurationSeconds" REAL, "averageViewPercentage" REAL, "source" TEXT NOT NULL,
      "collectedAt" DATETIME NOT NULL, "freshnessAtCollection" TEXT NOT NULL, "qualityAtCollection" TEXT NOT NULL,
      "qualityReasons" JSONB NOT NULL, "providerMetadata" JSONB, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
    );`;
  for (const statement of base.split(';').map((value) => value.trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
  const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260901120000_trends_series_patterns/migration.sql'), 'utf8');
  for (const statement of migration.split(';').map((value) => value.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
  snapshots = new VideoPerformanceSnapshotRepository(client); audience = new AudienceSnapshotRepository(client); trends = new TrendSignalRepository(client);
  seriesRepo = new SeriesDefinitionRepository(client); patterns = new ContentPatternRepository(client);
  trendService = new TrendIntelligenceService(snapshots, audience, trends);
  seriesService = new SeriesIntelligenceService(seriesRepo, snapshots, { findAll: async () => [] });
  patternService = new ContentPatternIntelligenceService(snapshots, patterns, seriesRepo, audience);
  const app = express(); app.use(express.json()); app.use(createTemporalIntelligenceRouter(trendService, seriesService, patternService));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
beforeEach(async () => { await client.videoSeriesLink.deleteMany(); await client.contentPattern.deleteMany(); await client.trendSignal.deleteMany(); await client.seriesDefinition.deleteMany(); await client.audienceSnapshot.deleteMany(); await client.videoPerformanceSnapshot.deleteMany(); await client.project.deleteMany(); });
after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });

describe('trend domain', { concurrency: false }, () => {
  test('classifies rising, declining and stable only with documented magnitude and consistency', () => {
    assert.equal(classify([150, 160, 170], [100, 105, 95]).classification, 'RISING');
    assert.equal(classify([60, 70, 65], [100, 105, 95]).classification, 'DECLINING');
    assert.equal(classify([102, 99, 101], [100, 101, 99]).classification, 'STABLE');
  });
  test('classifies volatile dispersion and insufficient samples honestly', () => {
    assert.equal(classify([5, 105], [10, 100]).classification, 'VOLATILE');
    assert.equal(classify([200], [100, 100]).classification, 'INSUFFICIENT_DATA');
  });
  test('reduces confidence when upstream quality is stale and preserves inputs', () => {
    const current = [150, 160, 170]; const previous = [100, 105, 95]; const copy = structuredClone({ current, previous });
    assert.ok(classify(current, previous, 'GOOD').confidence > classify(current, previous, 'STALE').confidence);
    assert.deepEqual({ current, previous }, copy);
  });
  test('central period policy creates equal non-overlapping windows and N versus N slices', () => {
    const policy = new TrendWindowPolicy(); const pair = policy.calendar(28, now);
    assert.equal(pair.current.end - pair.current.start, pair.previous.end - pair.previous.start);
    assert.equal(pair.previous.end.getTime(), pair.current.start.getTime());
    assert.deepEqual(policy.recentItems([6, 5, 4, 3, 2, 1], 3), { current: [6, 5, 4], previous: [3, 2, 1] });
  });
});

describe('persisted trend, series and pattern intelligence', { concurrency: false }, () => {
  test('persists channel trends and keeps project histories isolated', async () => {
    await client.project.createMany({ data: [{ id: 'one', name: 'One', description: null, ownerId: 'unused' }, { id: 'two', name: 'Two', description: null, ownerId: 'unused' }] }).catch(async () => {
      await client.$executeRawUnsafe(`INSERT INTO "Project" ("id") VALUES ('one'), ('two')`);
    });
    const dates = ['2026-07-10','2026-07-12','2026-08-10','2026-08-12'];
    await client.videoPerformanceSnapshot.createMany({ data: dates.map((date, index) => snapshot(`p${index + 1}`, { projectId: 'one', publishedAt: new Date(`${date}T00:00:00Z`), views: index < 2 ? 100 : 200 })) });
    const result = await trendService.list({ projectId: 'one', days: 28, now, subjectType: 'CHANNEL' });
    assert.ok(result.some(({ metric, classification }) => metric === 'views' && classification === 'RISING'));
    assert.equal((await trends.findAll({ projectId: 'two' })).length, 0);
  });
  test('detects audience traffic only from persisted equivalent periods', async () => {
    const common = { projectId: null, format: 'LONG_FORM', engagedViews: 10, watchTimeMinutes: 10, averageViewDurationSeconds: null, averageViewPercentage: null,
      source: 'test', collectedAt: now, freshnessAtCollection: 'RECENT', qualityAtCollection: 'GOOD', qualityReasons: [], providerMetadata: null };
    await client.audienceSnapshot.createMany({ data: [
      { id: 'a1', ingestionKey: 'a1', dimension: 'traffic_source', segment: 'SEARCH', periodStart: new Date('2026-07-10'), periodEnd: new Date('2026-07-12'), views: 100, ...common },
      { id: 'a2', ingestionKey: 'a2', dimension: 'traffic_source', segment: 'SEARCH', periodStart: new Date('2026-07-12'), periodEnd: new Date('2026-07-14'), views: 100, ...common },
      { id: 'a3', ingestionKey: 'a3', dimension: 'traffic_source', segment: 'SEARCH', periodStart: new Date('2026-08-10'), periodEnd: new Date('2026-08-12'), views: 180, ...common },
      { id: 'a4', ingestionKey: 'a4', dimension: 'traffic_source', segment: 'SEARCH', periodStart: new Date('2026-08-12'), periodEnd: new Date('2026-08-14'), views: 190, ...common },
    ] });
    const result = await trendService.list({ days: 28, now, subjectType: 'TRAFFIC_SOURCE' });
    assert.equal(result.find(({ subject }) => subject === 'SEARCH').classification, 'RISING');
  });
  test('imports only explicit series metadata with exact high-confidence evidence', async () => {
    await client.videoPerformanceSnapshot.create({ data: snapshot('1', { series: 'Carros Abandonados' }) });
    await client.videoPerformanceSnapshot.create({ data: snapshot('2', { series: null }) });
    const imported = await seriesService.importExactMetadata(); const listed = await seriesService.list(undefined, now);
    assert.equal(imported.seriesCreated, 1); assert.equal(listed.length, 1); assert.equal(listed[0].series.videoLinks[0].origin, 'IMPORTED');
    const noAuto = await seriesService.autoAssociate(listed[0].series.id, '2');
    assert.equal(noAuto.linked, false); assert.equal((await seriesRepo.findLinksByVideo('video-2')).length, 0);
  });
  test('automatic series association rejects an exact match from another project', async () => {
    await client.$executeRawUnsafe(`INSERT INTO "Project" ("id") VALUES ('one'), ('two')`);
    await client.videoPerformanceSnapshot.create({ data: snapshot('1', { projectId: 'two', series: 'Série isolada' }) });
    const created = await seriesService.create({ projectId: 'one', name: 'Série isolada' });
    await assert.rejects(() => seriesService.autoAssociate(created.series.id, '1'), /does not belong/);
    assert.equal((await seriesRepo.findLinksByVideo('video-1')).length, 0);
  });
  test('manual linking is idempotent and unlinking corrects the association', async () => {
    await client.videoPerformanceSnapshot.create({ data: snapshot('1') });
    const created = await seriesService.create({ name: 'Testes controlados' });
    assert.equal((await seriesService.linkVideo(created.series.id, '1')).created, true);
    assert.equal((await seriesService.linkVideo(created.series.id, '1')).created, false);
    assert.equal(await seriesService.unlinkVideo(created.series.id, 'video-1'), true);
  });
  test('series health distinguishes strong, declining, healthy, dormant and insufficient samples', async () => {
    const createHealth = async (name, values, dateOffset = 0, at = now) => {
      const created = await seriesService.create({ name });
      for (let index = 0; index < values.length; index += 1) {
        const id = `${normalizeName(name)}-${index}`; const day = 1 + index + dateOffset;
        await client.videoPerformanceSnapshot.create({ data: snapshot(id, { series: name, views: values[index], publishedAt: new Date(`2026-08-${String(day).padStart(2, '0')}T00:00:00Z`) }) });
        await seriesService.linkVideo(created.series.id, id);
      }
      return (await seriesService.getById(created.series.id, at)).health.health;
    };
    const normalizeName = (value) => value.toLowerCase().replace(/\W/g, '');
    assert.equal(await createHealth('Strong', [100, 110, 120, 260, 280, 300]), 'STRONG');
    assert.equal(await createHealth('Declining', [300, 280, 260, 120, 110, 100]), 'DECLINING');
    assert.equal(await createHealth('Healthy', [100, 102, 99, 101, 100, 103]), 'HEALTHY');
    assert.equal(await createHealth('Dormant', [100, 110, 120, 260, 280, 300], 0, new Date('2027-01-01')), 'DORMANT');
    assert.equal(await createHealth('Small', [100, 200]), 'INSUFFICIENT_DATA');
  });
  test('content patterns report association, recency and no causal claim', async () => {
    const rows = [100,110,120,300,320,340].map((views, index) => snapshot(`g${index}`, { game: index < 3 ? 'Weak Game' : 'Strong Game', views, publishedAt: new Date(`2026-08-${10 + index}T00:00:00Z`) }));
    await client.videoPerformanceSnapshot.createMany({ data: rows });
    const result = await patternService.detect({ now });
    const strong = result.find(({ subject }) => subject === 'Strong Game'); const weak = result.find(({ subject }) => subject === 'Weak Game');
    assert.equal(strong.classification, 'STRONG'); assert.equal(weak.classification, 'WEAK');
    assert.match(strong.hypothesis, /não demonstra causalidade/i);
    assert.equal((await patternService.performanceBySubject('GAME', undefined, now)).length, 2);
  });
});

describe('temporal operators, API and routing', { concurrency: false }, () => {
  const request = async (pathname, options) => { const response = await fetch(`${baseUrl}${pathname}`, options); return { status: response.status, body: response.status === 204 ? null : await response.json() }; };
  test('exposes strict trend, series, detail, link and pattern contracts', async () => {
    await client.videoPerformanceSnapshot.create({ data: snapshot('1', { series: 'API Series' }) });
    const list = await request('/series'); assert.equal(list.status, 200); assert.equal(list.body.length, 1);
    const detail = await request(`/series/${list.body[0].series.id}`); assert.equal(detail.status, 200);
    assert.equal((await request('/trends?days=9')).status, 400);
    assert.equal((await request('/trends?days=7')).status, 200);
    assert.equal((await request('/content-patterns')).status, 200);
    assert.equal((await request('/subject-performance?type=game')).status, 200);
    assert.equal((await request('/series', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Nova', unexpected: true }) })).status, 400);
  });
  test('maps trend and series questions to real Gerente capabilities', () => {
    assert.equal(classifyOrchestrationIntent('o que está crescendo?'), 'trend_analysis');
    assert.equal(classifyOrchestrationIntent('vale continuar essa série?'), 'series_viability');
    assert.ok(createOrchestrationPlan({ intent: 'o que está crescendo?' }).capabilities.includes('channel-operator.trends'));
    const seriesPlan = createOrchestrationPlan({ intent: 'City Car ainda vale?' });
    assert.ok(seriesPlan.capabilities.includes('channel-operator.series'));
  });
  test('channel operator contract exposes temporal status without inventing evidence', async () => {
    const service = new ChannelOperatorService(snapshots, { findAll: async () => [] }, undefined, audience,
      { list: async () => [{ id: 't', subject: 'Canal', metric: 'views', classification: 'INSUFFICIENT_DATA', sampleSize: 0, confidence: 0, detectedAt: now, delta: null }] },
      { list: async () => [] });
    const temporal = await service.run('trends');
    assert.equal(temporal.status, 'NOT_CONFIGURED'); assert.equal(temporal.id, 'trends'); assert.equal(temporal.confidence, 0);
  });
  test('Supervisor consolidates strong temporal highlights without creating alarmist alerts', async () => {
    const emptyReview = { current: 0, reviewAvailable: 0, stale: 0, insufficientData: 0, recentFailures: 0 };
    const supervisor = new SupervisorModule(
      { getStatus: async () => ({ state: 'connected', lastSyncAt: now, lastErrorType: null }) },
      { list: async () => [] }, { getOperationalStatus: async () => emptyReview },
      { getOperationalSummary: async () => ({ awaitingReview: 0, approved: 0, rejected: 0, expired: 0, executedRecently: 0, blockedRecently: 0 }) },
      { getOperationalSummary: async () => ({ total: 0, active: 0, paused: 0, blocked: 0, error: 0, due: 0 }) },
      { countByStatuses: async () => 0 }, { getHealth: () => ({ status: 'STOPPED' }) },
      { getSummary: async () => ({ healthy: 0, degraded: 0, blocked: 0, failing: 0, disabled: 0, quotasReached: 0, pausedByFailure: 0, approvalsPending: 0, retriesPending: 0 }) },
      { list: async () => [
        { id: 'trends', status: 'AVAILABLE', confidence: 0.8, sampleSize: 8, missingData: [], signals: [{ summary: 'Canal views: RISING.' }] },
        { id: 'series', status: 'LIMITED', confidence: 0.2, sampleSize: 2, missingData: ['episodes'], signals: [{ summary: 'Série: INSUFFICIENT_DATA.' }] },
      ] },
      { getStatus: async () => ({ state: 'not_configured', quality: { state: 'MISSING', reasons: [] } }) },
      { summary: async () => ({ quality: { state: 'MISSING' }, facts: [], signals: [], missingData: [] }) },
    );
    const overview = await supervisor.getSupervisorOverview();
    assert.deepEqual(overview.temporalIntelligence.highlights, ['Canal views: RISING.', 'Série: INSUFFICIENT_DATA.']);
    assert.ok(!overview.alerts.some((value) => /INSUFFICIENT_DATA/.test(value)));
  });
});
