const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ChannelInsightRepository } = require('../dist/database/repositories/ChannelInsightRepository');
const { PerformanceSignalRepository } = require('../dist/database/repositories/PerformanceSignalRepository');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { createCreatorIntelligenceRouter } = require('../dist/routes/creatorIntelligence');
const { ChannelMemoryService } = require('../dist/services/creator-intelligence/ChannelMemoryService');
const { CreatorIntelligenceService } = require('../dist/services/creator-intelligence/CreatorIntelligenceService');
const { PerformanceBaselineService } = require('../dist/services/performance-intelligence/PerformanceBaselineService');
const { PerformanceIngestionService } = require('../dist/services/performance-intelligence/PerformanceIngestionService');
const {
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeAnalyticsQuotaError,
  YouTubeAnalyticsTemporaryError,
  YouTubePerformanceSyncValidationError,
  YouTubeVideoNotFoundError,
} = require('../dist/services/performance-intelligence/YouTubePerformanceSyncService');

let client;
let server;
let baseUrl;
let youtubeSyncService;

const record = (overrides = {}) => ({
  videoId: 'api-video', title: 'API video', game: 'BeamNG.drive', series: 'Testes',
  format: 'narrado', views: 1000, impressions: 10000, ctr: 10,
  averageViewPercentage: 50, watchTimeMinutes: 5000, subscribersGained: 10,
  collectedAt: '2026-08-24T12:00:00.000Z', ...overrides,
});

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  client = await DatabaseService.connect();
  const sql = `
    CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "VideoIdea" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "ContentDecision" (
      "id" TEXT NOT NULL PRIMARY KEY, "videoIdeaId" TEXT NOT NULL, "category" TEXT NOT NULL,
      "score" REAL NOT NULL, "rationale" TEXT NOT NULL, "evidence" JSONB NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "ChannelInsight" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "key" TEXT NOT NULL UNIQUE,
      "category" TEXT NOT NULL, "subject" TEXT NOT NULL, "statement" TEXT NOT NULL,
      "confidence" REAL NOT NULL, "classification" TEXT NOT NULL, "evidence" JSONB,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "VideoPerformanceSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE,
      "videoId" TEXT NOT NULL, "title" TEXT NOT NULL, "game" TEXT, "series" TEXT, "format" TEXT,
      "publishedAt" DATETIME, "periodStart" DATETIME, "periodEnd" DATETIME, "views" REAL, "engagedViews" REAL,
      "impressions" REAL, "ctr" REAL, "durationSeconds" REAL, "averageViewDurationSeconds" REAL,
      "averageViewPercentage" REAL, "watchTimeMinutes" REAL, "subscribersGained" INTEGER,
      "subscribersLost" INTEGER,
      "likes" INTEGER, "comments" INTEGER, "source" TEXT NOT NULL, "confidence" REAL NOT NULL DEFAULT 1,
      "collectedAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "PerformanceSignal" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "videoIdeaId" TEXT,
      "performanceSnapshotId" TEXT, "key" TEXT UNIQUE, "game" TEXT, "series" TEXT, "format" TEXT,
      "metric" TEXT NOT NULL, "value" REAL NOT NULL, "sampleSize" INTEGER NOT NULL DEFAULT 1,
      "source" TEXT NOT NULL, "classification" TEXT NOT NULL DEFAULT 'real',
      "confidence" REAL NOT NULL DEFAULT 1, "measuredAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("performanceSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE CASCADE
    );
  `;
  for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
  const snapshots = new VideoPerformanceSnapshotRepository(client);
  const signals = new PerformanceSignalRepository(client);
  const insights = new ChannelInsightRepository(client);
  const memory = new ChannelMemoryService(insights, signals, snapshots);
  const service = new CreatorIntelligenceService({
    snapshotRepository: snapshots,
    performanceSignalRepository: signals,
    insightRepository: insights,
    channelMemoryService: memory,
    performanceIngestionService: new PerformanceIngestionService(snapshots, signals),
    performanceBaselineService: new PerformanceBaselineService(snapshots),
  });
  youtubeSyncService = {
    status: { state: 'connected', lastSyncAt: null, lastErrorType: null },
    lastSync: { source: 'youtube-analytics', lastSyncAt: null },
    result: { source: 'youtube-analytics', created: 1, updated: 0, records: [], signals: [] },
    error: null,
    calls: [],
    async getStatus() { return this.status; },
    async getLastSync() { return this.lastSync; },
    async sync(input) {
      this.calls.push(structuredClone(input));
      if (this.error) throw this.error;
      return this.result;
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createCreatorIntelligenceRouter(service, youtubeSyncService));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

beforeEach(async () => {
  await client.performanceSignal.deleteMany();
  await client.channelInsight.deleteMany();
  await client.videoPerformanceSnapshot.deleteMany();
  youtubeSyncService.status = { state: 'connected', lastSyncAt: null, lastErrorType: null };
  youtubeSyncService.lastSync = { source: 'youtube-analytics', lastSyncAt: null };
  youtubeSyncService.result = { source: 'youtube-analytics', created: 1, updated: 0, records: [], signals: [] };
  youtubeSyncService.error = null;
  youtubeSyncService.calls = [];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await DatabaseService.disconnect();
});

describe('Performance Intelligence HTTP API', { concurrency: false }, () => {
  test('ingests manual records, fixes provenance and returns normalized persisted data', async () => {
    const response = await request('/performance/ingest/manual', {
      method: 'POST', body: JSON.stringify({ records: [record()] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.created, 1);
    assert.equal(response.body.records[0].source, 'manual');
  });

  test('repeating the same video-period updates instead of duplicating', async () => {
    await request('/performance/ingest/manual', { method: 'POST', body: JSON.stringify({ records: [record()] }) });
    const repeated = await request('/performance/ingest/manual', {
      method: 'POST', body: JSON.stringify({ records: [record({ views: 2000 })] }),
    });
    assert.equal(repeated.body.updated, 1);
    const listed = await request('/performance/records');
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].views, 2000);
  });

  test('rejects empty arrays, unknown fields and invalid metrics with 400', async () => {
    for (const body of [
      { records: [] },
      { records: [record({ source: 'forged' })] },
      { records: [record({ ctr: 101 })] },
    ]) {
      assert.equal((await request('/performance/ingest/manual', { method: 'POST', body: JSON.stringify(body) })).status, 400);
    }
  });

  test('lists records and signals in deterministic backend order', async () => {
    await request('/performance/ingest/manual', {
      method: 'POST', body: JSON.stringify({ records: [record({ videoId: 'a' }), record({ videoId: 'b', collectedAt: '2026-08-25T12:00:00.000Z' })] }),
    });
    const records = await request('/performance/records');
    const signals = await request('/performance/signals');
    assert.deepEqual(records.body.map(({ videoId }) => videoId), ['b', 'a']);
    assert.ok(signals.body.length >= 2);
  });

  test('returns a dynamic baseline and evidence-backed channel learnings', async () => {
    await request('/performance/ingest/manual', { method: 'POST', body: JSON.stringify({ records: [record()] }) });
    const baseline = await request('/performance/baseline');
    const learnings = await request('/learnings');
    assert.equal(baseline.status, 200);
    assert.equal(baseline.body.views.median, 1000);
    assert.equal(learnings.status, 200);
    assert.ok(learnings.body.every(({ evidence }) => evidence.derivedFrom === 'VideoPerformanceSnapshot'));
  });

  test('empty state is honest and contains null baseline values', async () => {
    assert.deepEqual((await request('/performance/records')).body, []);
    assert.deepEqual((await request('/performance/signals')).body, []);
    assert.equal((await request('/performance/baseline')).body.views.median, null);
  });

  test('decision evidence validates ids and returns 404 without leaking internals', async () => {
    assert.equal((await request('/decisions/%20/evidence')).status, 400);
    const missing = await request('/decisions/missing/evidence');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'Content decision not found' });
  });

  test('reports provider status and last synchronization without triggering a sync', async () => {
    youtubeSyncService.status = {
      state: 'synchronized', lastSyncAt: new Date('2026-08-24T15:00:00.000Z'), lastErrorType: null,
    };
    youtubeSyncService.lastSync = {
      source: 'youtube-analytics', lastSyncAt: new Date('2026-08-24T15:00:00.000Z'),
    };
    const status = await request('/performance/youtube/status');
    const lastSync = await request('/performance/youtube/last-sync');
    assert.equal(status.status, 200);
    assert.equal(status.body.state, 'synchronized');
    assert.equal(lastSync.status, 200);
    assert.equal(lastSync.body.source, 'youtube-analytics');
    assert.equal(youtubeSyncService.calls.length, 0);
  });

  test('synchronizes a validated video request exactly once', async () => {
    youtubeSyncService.result.records = [{ id: 'snapshot', videoId: 'abc', source: 'youtube-analytics' }];
    const response = await request('/performance/youtube/sync', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'video', videoId: 'abc', startDate: '2026-08-01', endDate: '2026-08-24', limit: 1,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.source, 'youtube-analytics');
    assert.equal(youtubeSyncService.calls.length, 1);
    assert.deepEqual(youtubeSyncService.calls[0], {
      mode: 'video', videoId: 'abc', projectId: undefined,
      startDate: '2026-08-01', endDate: '2026-08-24', limit: 1,
    });
  });

  test('rejects malformed sync bodies and unknown fields before the service', async () => {
    for (const body of [
      {},
      { mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24', extra: true },
      { mode: 'period', startDate: 1, endDate: '2026-08-24' },
    ]) {
      assert.equal((await request('/performance/youtube/sync', {
        method: 'POST', body: JSON.stringify(body),
      })).status, 400);
    }
    assert.equal(youtubeSyncService.calls.length, 0);
  });

  test('maps sync validation, missing video and expected configuration errors', async () => {
    const cases = [
      [new YouTubePerformanceSyncValidationError('invalid period'), 400, 'invalid period'],
      [new YouTubeVideoNotFoundError(), 404, 'YouTube video not found'],
      [new YouTubeAnalyticsNotConfiguredError(), 503, 'YouTube Analytics is not configured'],
      [new YouTubeAnalyticsNotAuthorizedError(), 401, 'Google authorization is required'],
    ];
    for (const [error, expectedStatus, expectedMessage] of cases) {
      youtubeSyncService.error = error;
      const response = await request('/performance/youtube/sync', {
        method: 'POST',
        body: JSON.stringify({ mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24' }),
      });
      assert.equal(response.status, expectedStatus);
      assert.equal(response.body.error, expectedMessage);
    }
  });

  test('maps quota and temporary failures without exposing provider payloads', async () => {
    for (const [error, expectedStatus] of [
      [new YouTubeAnalyticsQuotaError(), 429],
      [new YouTubeAnalyticsTemporaryError(), 503],
    ]) {
      error.providerPayload = { access_token: 'secret', rows: ['private'] };
      youtubeSyncService.error = error;
      const response = await request('/performance/youtube/sync', {
        method: 'POST',
        body: JSON.stringify({ mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24' }),
      });
      assert.equal(response.status, expectedStatus);
      assert.ok(!JSON.stringify(response.body).includes('secret'));
      assert.ok(!JSON.stringify(response.body).includes('private'));
    }
  });

  test('returns a sanitized 500 for an unexpected synchronization failure', async () => {
    youtubeSyncService.error = Object.assign(new Error('raw prompt and credential'), {
      access_token: 'secret-token',
    });
    const original = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    try {
      const response = await request('/performance/youtube/sync', {
        method: 'POST',
        body: JSON.stringify({ mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24' }),
      });
      assert.equal(response.status, 500);
      assert.deepEqual(response.body, {
        error: 'Failed to synchronize YouTube Analytics',
        code: 'INTERNAL_ERROR',
      });
      assert.ok(!logs.join(' ').includes('secret-token'));
      assert.ok(!logs.join(' ').includes('raw prompt'));
    } finally {
      console.error = original;
    }
  });
});
