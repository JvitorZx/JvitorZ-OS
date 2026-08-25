const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ChannelInsightRepository } = require('../dist/database/repositories/ChannelInsightRepository');
const { PerformanceSignalRepository } = require('../dist/database/repositories/PerformanceSignalRepository');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { ManualPerformanceProvider } = require('../dist/domains/performance-intelligence/PerformanceProvider');
const { ChannelMemoryService } = require('../dist/services/creator-intelligence/ChannelMemoryService');
const { CreatorIntelligenceService } = require('../dist/services/creator-intelligence/CreatorIntelligenceService');
const { PerformanceBaselineService } = require('../dist/services/performance-intelligence/PerformanceBaselineService');
const { PerformanceIngestionService } = require('../dist/services/performance-intelligence/PerformanceIngestionService');
const {
  normalizePerformanceRecord,
  PerformanceValidationError,
} = require('../dist/services/performance-intelligence/PerformanceNormalizer');

let client;
let snapshots;
let signals;
let insights;
let ingestion;

const firstRecord = (overrides = {}) => ({
  videoId: 'video-a',
  title: 'Teste controlado',
  game: 'BeamNG.drive',
  series: 'Desafios',
  format: 'narrado',
  publishedAt: '2026-08-01T12:00:00.000Z',
  views: 1000,
  impressions: 10000,
  ctr: 10,
  durationSeconds: 600,
  averageViewDurationSeconds: 300,
  averageViewPercentage: 50,
  watchTimeMinutes: 5000,
  subscribersGained: 20,
  likes: 100,
  comments: 10,
  collectedAt: '2026-08-24T12:00:00.000Z',
  ...overrides,
});

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
      "subscribersGained" INTEGER, "subscribersLost" INTEGER, "likes" INTEGER, "comments" INTEGER, "source" TEXT NOT NULL,
      "confidence" REAL NOT NULL DEFAULT 1, "collectedAt" DATETIME NOT NULL,
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
});

beforeEach(async () => {
  await client.performanceSignal.deleteMany();
  await client.channelInsight.deleteMany();
  await client.videoPerformanceSnapshot.deleteMany();
  await client.project.deleteMany();
});

after(async () => DatabaseService.disconnect());

describe('Performance intelligence normalization and ingestion', { concurrency: false }, () => {
  test('normalizes complete data without changing the provider input', () => {
    const input = firstRecord();
    const copy = structuredClone(input);
    const normalized = normalizePerformanceRecord(input, 'fake');
    assert.deepEqual(input, copy);
    assert.equal(normalized.source, 'fake');
    assert.equal(normalized.views, 1000);
    assert.equal(normalized.publishedAt.toISOString(), input.publishedAt);
  });

  test('keeps every unavailable optional metric null instead of fabricating values', () => {
    const normalized = normalizePerformanceRecord({ videoId: 'v', title: 'T' }, 'manual');
    assert.equal(normalized.views, null);
    assert.equal(normalized.ctr, null);
    assert.equal(normalized.averageViewPercentage, null);
    assert.equal(normalized.subscribersGained, null);
    assert.equal(normalized.subscribersLost, null);
  });

  test('rejects invalid required, negative, percentage and period values', () => {
    assert.throws(() => normalizePerformanceRecord({ videoId: '', title: 'T' }, 'manual'), PerformanceValidationError);
    assert.throws(() => normalizePerformanceRecord(firstRecord({ views: -1 }), 'manual'), PerformanceValidationError);
    assert.throws(() => normalizePerformanceRecord(firstRecord({ ctr: 101 }), 'manual'), PerformanceValidationError);
    assert.throws(() => normalizePerformanceRecord(firstRecord({ periodStart: '2026-02-01', periodEnd: '2026-01-01' }), 'manual'), PerformanceValidationError);
  });

  test('uses provider identity as provenance rather than request data', async () => {
    const result = await ingestion.ingest(new ManualPerformanceProvider([firstRecord({ source: 'forged' })]));
    assert.equal(result.records[0].source, 'manual');
  });

  test('accepts a fake provider through the neutral contract without network', async () => {
    let calls = 0;
    const provider = {
      name: 'fake-analytics',
      async fetch() {
        calls += 1;
        return [firstRecord({ videoId: 'fake-video' })];
      },
    };
    const result = await ingestion.ingest(provider);
    assert.equal(calls, 1);
    assert.equal(result.records[0].source, 'fake-analytics');
  });

  test('creates and then updates the same video-period idempotently', async () => {
    const provider = new ManualPerformanceProvider([firstRecord()]);
    const first = await ingestion.ingest(provider);
    const second = await ingestion.ingest(new ManualPerformanceProvider([firstRecord({ views: 1200 })]));
    assert.equal(first.created, 1);
    assert.equal(second.updated, 1);
    assert.equal((await snapshots.findAll()).length, 1);
    assert.equal((await snapshots.findAll())[0].views, 1200);
  });

  test('concurrent ingestion keeps one persistent snapshot for the same identity', async () => {
    await Promise.all([
      ingestion.ingest(new ManualPerformanceProvider([firstRecord()])),
      ingestion.ingest(new ManualPerformanceProvider([firstRecord()])),
    ]);
    assert.equal((await snapshots.findAll()).length, 1);
  });

  test('distinguishes explicit periods for the same video', async () => {
    await ingestion.ingest(new ManualPerformanceProvider([
      firstRecord({ periodStart: '2026-08-01', periodEnd: '2026-08-07' }),
      firstRecord({ periodStart: '2026-08-08', periodEnd: '2026-08-14' }),
    ]));
    assert.equal((await snapshots.findAll()).length, 2);
  });

  test('keeps the same source video and period isolated between projects', async () => {
    await client.$executeRawUnsafe(`INSERT INTO "Project" ("id") VALUES ('project-a'), ('project-b')`);
    await ingestion.ingest(new ManualPerformanceProvider([firstRecord()]), 'project-a');
    await ingestion.ingest(new ManualPerformanceProvider([firstRecord()]), 'project-b');
    assert.equal((await snapshots.findAll({ projectId: 'project-a' })).length, 1);
    assert.equal((await snapshots.findAll({ projectId: 'project-b' })).length, 1);
  });

  test('derives only signals whose source metrics are available', async () => {
    const result = await ingestion.ingest(new ManualPerformanceProvider([
      firstRecord(),
      firstRecord({ videoId: 'video-b', views: 500, watchTimeMinutes: undefined, averageViewPercentage: undefined, subscribersGained: undefined }),
    ]));
    const secondSignals = result.signals.filter(({ performanceSnapshotId }) => performanceSnapshotId === result.records[1].id);
    assert.ok(secondSignals.some(({ metric }) => metric === 'game_performance'));
    assert.ok(!secondSignals.some(({ metric }) => metric === 'watch_time_performance'));
    assert.ok(!secondSignals.some(({ metric }) => metric === 'retention_performance'));
  });

  test('replaces derived signals on update without duplicating keys', async () => {
    await ingestion.ingest(new ManualPerformanceProvider([firstRecord()]));
    await ingestion.ingest(new ManualPerformanceProvider([firstRecord({ averageViewPercentage: undefined })]));
    const all = await signals.findAll();
    assert.equal(all.filter(({ metric }) => metric === 'retention_performance').length, 0);
    assert.equal(new Set(all.map(({ key }) => key)).size, all.length);
  });
});

describe('Dynamic baseline and channel learning', { concurrency: false }, () => {
  test('returns null baselines with zero samples for an empty channel', async () => {
    const baseline = await new PerformanceBaselineService(snapshots).getBaseline();
    assert.deepEqual(baseline.views, { average: null, median: null, sampleSize: 0 });
  });

  test('calculates medians, format baselines and subscriber conversion from real fields', async () => {
    await ingestion.ingest(new ManualPerformanceProvider([
      firstRecord({ videoId: 'a', views: 100, subscribersGained: 1 }),
      firstRecord({ videoId: 'b', views: 300, subscribersGained: 6 }),
    ]));
    const baseline = await new PerformanceBaselineService(snapshots).getBaseline();
    assert.equal(baseline.views.median, 200);
    assert.equal(baseline.byFormat.narrado.views.sampleSize, 2);
    assert.equal(baseline.subscribersPerThousandViews.median, 15);
  });

  test('creates evidence-traceable learnings for game, series and format', async () => {
    await ingestion.ingest(new ManualPerformanceProvider([firstRecord()]));
    const memory = new ChannelMemoryService(insights, signals, snapshots);
    const learned = await memory.refreshFromSnapshots();
    assert.deepEqual(new Set(learned.map(({ category }) => category)), new Set([
      'performance_game', 'performance_series', 'performance_format',
      'performance_watch_time', 'performance_retention', 'performance_subscriber_conversion',
    ]));
    const evidence = learned[0].evidence;
    assert.equal(evidence.derivedFrom, 'VideoPerformanceSnapshot');
    assert.equal(evidence.sampleSize, 1);
    assert.equal(evidence.snapshotIds.length, 1);
  });

  test('updates stable learnings rather than creating duplicates', async () => {
    await ingestion.ingest(new ManualPerformanceProvider([firstRecord()]));
    const memory = new ChannelMemoryService(insights, signals, snapshots);
    await memory.refreshFromSnapshots();
    await memory.refreshFromSnapshots();
    assert.equal((await memory.listMemory()).length, 6);
  });

  test('invalidates a learning when updated source data no longer supports its dimension', async () => {
    await ingestion.ingest(new ManualPerformanceProvider([firstRecord()]));
    const memory = new ChannelMemoryService(insights, signals, snapshots);
    await memory.refreshFromSnapshots();
    await ingestion.ingest(new ManualPerformanceProvider([firstRecord({ game: null })]));
    await memory.refreshFromSnapshots();
    const game = (await memory.listMemory()).find(({ category }) => category === 'performance_game');
    assert.equal(game.classification, 'unknown');
    assert.equal(game.confidence, 0);
    assert.equal(game.evidence.invalidated, true);
  });

  test('service exposes records, signals, baseline and learnings without external network', async () => {
    const memory = new ChannelMemoryService(insights, signals, snapshots);
    const service = new CreatorIntelligenceService({
      snapshotRepository: snapshots,
      performanceSignalRepository: signals,
      performanceIngestionService: ingestion,
      performanceBaselineService: new PerformanceBaselineService(snapshots),
      channelMemoryService: memory,
      insightRepository: insights,
    });
    const result = await service.ingestManualPerformance([firstRecord()]);
    assert.equal(result.created, 1);
    assert.equal((await service.listPerformanceRecords()).length, 1);
    assert.ok((await service.listPerformanceSignals()).length > 0);
    assert.equal((await service.getPerformanceBaseline()).views.median, 1000);
    assert.equal((await service.getChannelLearnings()).length, 6);
  });
});
