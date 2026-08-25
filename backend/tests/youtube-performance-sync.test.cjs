const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ChannelInsightRepository } = require('../dist/database/repositories/ChannelInsightRepository');
const { PerformanceSignalRepository } = require('../dist/database/repositories/PerformanceSignalRepository');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { ChannelMemoryService } = require('../dist/services/creator-intelligence/ChannelMemoryService');
const { PerformanceIngestionService } = require('../dist/services/performance-intelligence/PerformanceIngestionService');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');
const {
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeAnalyticsQuotaError,
  YouTubePerformanceSyncService,
  YouTubePerformanceSyncValidationError,
} = require('../dist/services/performance-intelligence/YouTubePerformanceSyncService');

let client;
let snapshots;
let signals;
let insights;
let ingestion;
let memory;

const googleReady = {
  isConfigured: () => true,
  isAuthenticated: () => true,
};

const rawRecord = (overrides = {}) => ({
  videoId: 'video-a',
  title: 'Video real normalizado',
  publishedAt: '2026-08-01T12:00:00.000Z',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-24',
  views: 1000,
  averageViewDurationSeconds: 240,
  averageViewPercentage: 40,
  watchTimeMinutes: 4000,
  subscribersGained: 12,
  subscribersLost: 2,
  likes: 80,
  comments: 9,
  collectedAt: '2026-08-24T15:00:00.000Z',
  ...overrides,
});

const metadata = (ids = ['recent-a', 'recent-b']) => ({
  calls: 0,
  async getByIds() { return new Map(); },
  async listRecentVideoIds(limit) {
    this.calls += 1;
    return ids.slice(0, limit);
  },
});

const createService = ({
  records = [rawRecord()],
  googleService = googleReady,
  metadataService = metadata(),
  fetchError,
} = {}) => {
  const providerOptions = [];
  let providerCalls = 0;
  const service = new YouTubePerformanceSyncService({
    googleService,
    snapshotRepository: snapshots,
    ingestionService: ingestion,
    channelMemoryService: memory,
    metadataService,
    providerFactory(options) {
      providerOptions.push(structuredClone(options));
      return {
        name: 'youtube-analytics',
        async fetch() {
          providerCalls += 1;
          if (fetchError) throw fetchError;
          return records;
        },
      };
    },
  });
  return { service, providerOptions, metadataService, getProviderCalls: () => providerCalls };
};

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  const sql = `
    CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "VideoIdea" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "ChannelInsight" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "key" TEXT NOT NULL UNIQUE,
      "category" TEXT NOT NULL, "subject" TEXT NOT NULL, "statement" TEXT NOT NULL,
      "confidence" REAL NOT NULL, "classification" TEXT NOT NULL, "evidence" JSONB,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL
    );
    CREATE TABLE "VideoPerformanceSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE,
      "videoId" TEXT NOT NULL, "title" TEXT NOT NULL, "game" TEXT, "series" TEXT, "format" TEXT,
      "publishedAt" DATETIME, "periodStart" DATETIME, "periodEnd" DATETIME,
      "views" REAL, "impressions" REAL, "ctr" REAL, "durationSeconds" REAL,
      "averageViewDurationSeconds" REAL, "averageViewPercentage" REAL, "watchTimeMinutes" REAL,
      "subscribersGained" INTEGER, "subscribersLost" INTEGER, "likes" INTEGER, "comments" INTEGER,
      "source" TEXT NOT NULL, "confidence" REAL NOT NULL DEFAULT 1, "collectedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL
    );
    CREATE TABLE "PerformanceSignal" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "videoIdeaId" TEXT,
      "performanceSnapshotId" TEXT, "key" TEXT UNIQUE, "game" TEXT, "series" TEXT, "format" TEXT,
      "metric" TEXT NOT NULL, "value" REAL NOT NULL, "sampleSize" INTEGER NOT NULL DEFAULT 1,
      "source" TEXT NOT NULL, "classification" TEXT NOT NULL DEFAULT 'real',
      "confidence" REAL NOT NULL DEFAULT 1, "measuredAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL,
      FOREIGN KEY ("performanceSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE CASCADE
    );
  `;
  for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
  snapshots = new VideoPerformanceSnapshotRepository(client);
  signals = new PerformanceSignalRepository(client);
  insights = new ChannelInsightRepository(client);
  ingestion = new PerformanceIngestionService(snapshots, signals);
  memory = new ChannelMemoryService(insights, signals, snapshots);
});

beforeEach(async () => {
  await client.performanceSignal.deleteMany();
  await client.channelInsight.deleteMany();
  await client.videoPerformanceSnapshot.deleteMany();
  await client.project.deleteMany();
});

after(async () => DatabaseService.disconnect());

describe('YouTube performance synchronization', { concurrency: false }, () => {
  test('syncs one video through ingestion, signals and channel memory', async () => {
    const { service, providerOptions, getProviderCalls } = createService();
    const result = await service.sync({
      mode: 'video', videoId: 'video-a', startDate: '2026-08-01', endDate: '2026-08-24', limit: 1,
    });
    assert.equal(getProviderCalls(), 1);
    assert.deepEqual(providerOptions[0].videoIds, ['video-a']);
    assert.equal(result.created, 1);
    assert.equal(result.records[0].source, 'youtube-analytics');
    assert.equal(result.records[0].subscribersLost, 2);
    assert.ok(result.signals.length > 0);
    assert.ok((await insights.findAll()).length > 0);
  });

  test('syncs recent video ids with the configured bound', async () => {
    const recent = metadata(['one', 'two', 'three']);
    const { service, providerOptions } = createService({ metadataService: recent });
    await service.sync({ mode: 'recent', startDate: '2026-08-01', endDate: '2026-08-24', limit: 2 });
    assert.equal(recent.calls, 1);
    assert.deepEqual(providerOptions[0].videoIds, ['one', 'two']);
    assert.equal(providerOptions[0].maxResults, 2);
  });

  test('syncs a period without adding a video filter', async () => {
    const { service, providerOptions } = createService();
    await service.sync({ mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24' });
    assert.equal(providerOptions[0].videoIds, undefined);
    assert.equal(providerOptions[0].maxResults, 20);
  });

  test('avoids an Analytics request when the recent uploads playlist is empty', async () => {
    const { service, getProviderCalls } = createService({ metadataService: metadata([]) });
    const result = await service.sync({ mode: 'recent', startDate: '2026-08-01', endDate: '2026-08-24' });
    assert.equal(getProviderCalls(), 0);
    assert.deepEqual(result, { source: 'youtube-analytics', created: 0, updated: 0, records: [], signals: [] });
  });

  test('recollection of the same source video and period updates instead of duplicating', async () => {
    const first = createService();
    await first.service.sync({ mode: 'video', videoId: 'video-a', startDate: '2026-08-01', endDate: '2026-08-24' });
    const second = createService({ records: [rawRecord({ views: 1500 })] });
    const result = await second.service.sync({ mode: 'video', videoId: 'video-a', startDate: '2026-08-01', endDate: '2026-08-24' });
    assert.equal(result.updated, 1);
    assert.equal((await snapshots.findAll()).length, 1);
    assert.equal((await snapshots.findAll())[0].views, 1500);
  });

  test('reports synchronized status and persisted last synchronization', async () => {
    const { service } = createService();
    assert.deepEqual(await service.getStatus(), { state: 'connected', lastSyncAt: null, lastErrorType: null });
    await service.sync({ mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24' });
    const status = await service.getStatus();
    assert.equal(status.state, 'synchronized');
    assert.equal(status.lastSyncAt.toISOString(), '2026-08-24T15:00:00.000Z');
    assert.equal((await service.getLastSync()).source, 'youtube-analytics');
  });

  test('distinguishes missing configuration and authorization before provider use', async () => {
    const missing = createService({ googleService: { isConfigured: () => false, isAuthenticated: () => false } });
    const unauthorized = createService({ googleService: { isConfigured: () => true, isAuthenticated: () => false } });
    assert.equal((await missing.service.getStatus()).state, 'not_configured');
    assert.equal((await unauthorized.service.getStatus()).state, 'not_authorized');
    await assert.rejects(
      missing.service.sync({ mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24' }),
      YouTubeAnalyticsNotConfiguredError,
    );
    await assert.rejects(
      unauthorized.service.sync({ mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24' }),
      YouTubeAnalyticsNotAuthorizedError,
    );
    assert.equal(missing.getProviderCalls(), 0);
    assert.equal(unauthorized.getProviderCalls(), 0);
  });

  test('classifies quota failures without persisting partial snapshots', async () => {
    const { service } = createService({ fetchError: new YouTubeAnalyticsQuotaError() });
    await assert.rejects(
      service.sync({ mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24' }),
      YouTubeAnalyticsQuotaError,
    );
    assert.equal((await service.getStatus()).state, 'temporary_error');
    assert.equal((await service.getStatus()).lastErrorType, 'quota');
    assert.equal((await snapshots.findAll()).length, 0);
  });

  test('changes status to not authorized after an invalid OAuth grant', async () => {
    const { service } = createService({ fetchError: new YouTubeAnalyticsNotAuthorizedError() });
    await assert.rejects(
      service.sync({ mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24' }),
      YouTubeAnalyticsNotAuthorizedError,
    );
    assert.deepEqual(await service.getStatus(), {
      state: 'not_authorized', lastSyncAt: null, lastErrorType: 'authorization',
    });
  });

  test('validates dates, limits, mode and video identifiers before network', async () => {
    const { service, getProviderCalls } = createService();
    const invalid = [
      { mode: 'invalid', startDate: '2026-08-01', endDate: '2026-08-24' },
      { mode: 'period', startDate: 'bad', endDate: '2026-08-24' },
      { mode: 'period', startDate: '2026-08-25', endDate: '2026-08-24' },
      { mode: 'period', startDate: '2026-08-01', endDate: '2026-08-24', limit: 51 },
      { mode: 'video', startDate: '2026-08-01', endDate: '2026-08-24' },
      { mode: 'recent', videoId: 'unexpected', startDate: '2026-08-01', endDate: '2026-08-24' },
    ];
    for (const input of invalid) await assert.rejects(service.sync(input), YouTubePerformanceSyncValidationError);
    assert.equal(getProviderCalls(), 0);
  });

  test('keeps projects isolated during synchronization', async () => {
    await client.$executeRawUnsafe(`INSERT INTO "Project" ("id") VALUES ('a'), ('b')`);
    await createService().service.sync({
      mode: 'period', projectId: 'a', startDate: '2026-08-01', endDate: '2026-08-24',
    });
    await createService().service.sync({
      mode: 'period', projectId: 'b', startDate: '2026-08-01', endDate: '2026-08-24',
    });
    assert.equal((await snapshots.findAll({ projectId: 'a' })).length, 1);
    assert.equal((await snapshots.findAll({ projectId: 'b' })).length, 1);
  });

  test('exposes provider status through the Supervisor overview', async () => {
    const supervisor = new SupervisorModule({
      async getStatus() {
        return { state: 'synchronized', lastSyncAt: new Date('2026-08-24T15:00:00.000Z'), lastErrorType: null };
      },
    });
    assert.equal((await supervisor.getSupervisorOverview()).youtubeAnalytics.state, 'synchronized');
  });

  test('keeps the Dashboard available when provider status has a temporary failure', async () => {
    const supervisor = new SupervisorModule({ async getStatus() { throw new Error('provider unavailable'); } });
    const overview = await supervisor.getSupervisorOverview();
    assert.deepEqual(overview.youtubeAnalytics, {
      state: 'temporary_error', lastSyncAt: null, lastErrorType: 'temporary',
    });
  });
});
