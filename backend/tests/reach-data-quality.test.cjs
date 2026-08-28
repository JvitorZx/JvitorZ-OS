const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';
const { DatabaseService } = require('../dist/database/DatabaseService');
const { VideoReachSnapshotRepository } = require('../dist/database/repositories/VideoReachSnapshotRepository');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { ReachSyncStateRepository } = require('../dist/database/repositories/ReachSyncStateRepository');
const { DataQualityService } = require('../dist/domains/data-quality/DataQualityService');
const { classifyFreshness } = require('../dist/domains/data-quality/FreshnessPolicy');
const { YouTubeReachSyncService, YouTubeReachSyncValidationError } = require('../dist/services/performance-intelligence/YouTubeReachSyncService');

let client; let reach; let performance; let states;
const row = (overrides = {}) => ({
  id: 'reach-a', projectId: null, ingestionKey: 'reach-key', videoId: 'video-a',
  periodStart: new Date('2026-08-24T00:00:00Z'), periodEnd: new Date('2026-08-25T00:00:00Z'),
  impressions: 1000, ctr: 7.5, source: 'youtube-reporting-reach', reportId: 'report', jobId: 'job',
  reportCreatedAt: new Date('2026-08-25T03:00:00Z'), collectedAt: new Date('2026-08-25T04:00:00Z'),
  freshnessAtCollection: 'RECENT', qualityAtCollection: 'PARTIAL', qualityReasons: [], providerMetadata: {},
  createdAt: new Date('2026-08-25T04:00:00Z'), updatedAt: new Date('2026-08-25T04:00:00Z'), ...overrides,
});

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)');
  await client.$executeRawUnsafe(`CREATE TABLE "VideoPerformanceSnapshot" ("id" TEXT NOT NULL PRIMARY KEY,"projectId" TEXT,"ingestionKey" TEXT NOT NULL UNIQUE,"videoId" TEXT NOT NULL,"title" TEXT NOT NULL,"game" TEXT,"series" TEXT,"format" TEXT,"publishedAt" DATETIME,"periodStart" DATETIME,"periodEnd" DATETIME,"views" REAL,"engagedViews" REAL,"impressions" REAL,"ctr" REAL,"durationSeconds" REAL,"averageViewDurationSeconds" REAL,"averageViewPercentage" REAL,"watchTimeMinutes" REAL,"subscribersGained" INTEGER,"subscribersLost" INTEGER,"likes" INTEGER,"comments" INTEGER,"source" TEXT NOT NULL,"confidence" REAL NOT NULL DEFAULT 1,"collectedAt" DATETIME NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL)`);
  await client.$executeRawUnsafe(`CREATE TABLE "VideoReachSnapshot" ("id" TEXT NOT NULL PRIMARY KEY,"projectId" TEXT,"ingestionKey" TEXT NOT NULL UNIQUE,"videoId" TEXT NOT NULL,"periodStart" DATETIME NOT NULL,"periodEnd" DATETIME NOT NULL,"impressions" REAL NOT NULL,"ctr" REAL NOT NULL,"source" TEXT NOT NULL,"reportId" TEXT,"jobId" TEXT,"reportCreatedAt" DATETIME,"collectedAt" DATETIME NOT NULL,"freshnessAtCollection" TEXT NOT NULL,"qualityAtCollection" TEXT NOT NULL,"qualityReasons" JSONB NOT NULL,"providerMetadata" JSONB,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL)`);
  await client.$executeRawUnsafe('CREATE TABLE "ReachSyncState" ("source" TEXT NOT NULL PRIMARY KEY,"reportTypeId" TEXT NOT NULL,"jobId" TEXT,"state" TEXT NOT NULL,"lastReportAt" DATETIME,"lastSyncAt" DATETIME,"lastErrorType" TEXT,"updatedAt" DATETIME NOT NULL)');
  reach = new VideoReachSnapshotRepository(client); performance = new VideoPerformanceSnapshotRepository(client); states = new ReachSyncStateRepository(client);
});
beforeEach(async () => { await client.videoReachSnapshot.deleteMany(); await client.videoPerformanceSnapshot.deleteMany(); await client.reachSyncState.deleteMany(); await client.project.deleteMany(); });
after(async () => DatabaseService.disconnect());

describe('reach data quality', () => {
  const quality = new DataQualityService();
  test('distinguishes missing data from provider error', () => { assert.equal(quality.evaluateReach([]).state, 'MISSING'); assert.equal(quality.providerError().state, 'ERROR'); });
  test('classifies recent, stale and historical data centrally', () => {
    const now = new Date('2026-08-27T00:00:00Z');
    assert.equal(classifyFreshness(new Date('2026-08-26T00:00:00Z'), now).state, 'RECENT');
    assert.equal(classifyFreshness(new Date('2026-08-20T00:00:00Z'), now).state, 'STALE');
    assert.equal(classifyFreshness(new Date('2026-07-01T00:00:00Z'), now).state, 'HISTORICAL');
  });
  test('returns GOOD for a complete consistent recent sample', () => {
    const records = ['a','b','c'].map((id, index) => row({ id, ingestionKey: id, videoId: id, periodStart: new Date(`2026-08-2${3 + index}T00:00:00Z`), periodEnd: new Date(`2026-08-2${4 + index}T00:00:00Z`) }));
    const result = quality.evaluateReach(records, { knownVideoIds: new Set(['a','b','c']), now: new Date('2026-08-27T12:00:00Z') });
    assert.equal(result.state, 'GOOD'); assert.equal(result.completeness, 1); assert.equal(result.consistency, 1);
  });
  test('marks small samples partial without calling them errors', () => {
    const result = quality.evaluateReach([row()], { knownVideoIds: new Set(['video-a']), now: new Date('2026-08-25T12:00:00Z') });
    assert.equal(result.state, 'PARTIAL'); assert.ok(result.reasons.some(({ code }) => code === 'SMALL_SAMPLE'));
  });
  test('flags invalid CTR, impressions, unknown videos and periods', () => {
    const result = quality.evaluateReach([row({ impressions: -1, ctr: 101, periodEnd: new Date('2026-08-23T00:00:00Z') })], { knownVideoIds: new Set(['other']), now: new Date('2026-08-25T12:00:00Z') });
    assert.equal(result.state, 'INCONSISTENT');
    assert.deepEqual(new Set(result.reasons.map(({ code }) => code)), new Set(['UNKNOWN_VIDEO','INVALID_IMPRESSIONS','INVALID_CTR','INVALID_PERIOD','SMALL_SAMPLE']));
  });
  test('flags duplicate source periods explicitly', () => {
    const result = quality.evaluateReach([row(), row({ id: 'other', ingestionKey: 'other' })], { knownVideoIds: new Set(['video-a']), now: new Date('2026-08-25T12:00:00Z') });
    assert.equal(result.state, 'INCONSISTENT'); assert.ok(result.reasons.some(({ code }) => code === 'DUPLICATE_PERIOD'));
  });
});

describe('reach synchronization and persistence', { concurrency: false }, () => {
  const createService = (fetchResult) => new YouTubeReachSyncService({ googleService: { isConfigured: () => true, isAuthenticated: () => true }, provider: { fetch: async () => structuredClone(fetchResult) }, reachRepository: reach, performanceRepository: performance, stateRepository: states });
  const fetched = { state: 'available', jobId: 'job', jobCreated: false, reportsProcessed: 1, records: [{ videoId: 'video-a', periodStart: '2026-08-24', periodEnd: '2026-08-25', impressions: 1000, ctr: 7.5, reportId: 'report', jobId: 'job', reportCreatedAt: '2026-08-25T03:00:00Z', collectedAt: '2026-08-25T04:00:00Z' }] };
  test('persists official reach idempotently with source metadata', async () => {
    const service = createService(fetched); const first = await service.sync({ startDate: '2026-08-01', endDate: '2026-08-25' }); const second = await service.sync({ startDate: '2026-08-01', endDate: '2026-08-25' });
    assert.equal(first.created, 1); assert.equal(second.updated, 1); assert.equal((await reach.findAll()).length, 1); assert.equal(first.records[0].source, 'youtube-reporting-reach');
  });
  test('keeps projects isolated through the ingestion key', async () => {
    await client.$executeRawUnsafe(`INSERT INTO "Project" ("id") VALUES ('a'), ('b')`);
    await createService(fetched).sync({ projectId: 'a', startDate: '2026-08-01', endDate: '2026-08-25' }); await createService(fetched).sync({ projectId: 'b', startDate: '2026-08-01', endDate: '2026-08-25' });
    assert.equal((await reach.findAll({ projectId: 'a' })).length, 1); assert.equal((await reach.findAll({ projectId: 'b' })).length, 1);
  });
  test('persists waiting state without fabricating records', async () => {
    const result = await createService({ state: 'waiting', jobId: 'new-job', jobCreated: true, reportsProcessed: 0, records: [] }).sync({ startDate: '2026-08-01', endDate: '2026-08-25' });
    assert.equal(result.state, 'waiting_for_report'); assert.equal(result.quality.state, 'MISSING'); assert.equal((await reach.findAll()).length, 0);
  });
  test('validates date bounds before provider use', async () => {
    const service = createService(fetched);
    await assert.rejects(service.sync({ startDate: 'bad', endDate: '2026-08-25' }), YouTubeReachSyncValidationError);
    await assert.rejects(service.sync({ startDate: '2026-01-01', endDate: '2026-08-25' }), YouTubeReachSyncValidationError);
  });
});
