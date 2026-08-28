const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { AudienceSnapshotRepository } = require('../dist/database/repositories/AudienceSnapshotRepository');
const { AudienceSyncStateRepository } = require('../dist/database/repositories/AudienceSyncStateRepository');
const { DataQualityService } = require('../dist/domains/data-quality/DataQualityService');
const { AudienceIntelligenceService } = require('../dist/services/audience/AudienceIntelligenceService');
const { YouTubeAudienceSyncService } = require('../dist/services/audience/YouTubeAudienceSyncService');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');
const { YouTubeAnalyticsTemporaryError } = require('../dist/integrations/youtube/YouTubeAnalyticsErrors');

let client; let snapshots; let states;
const now = new Date('2026-08-27T12:00:00.000Z');
const raw = (dimension, segment, views, overrides = {}) => ({
  dimension, segment, format: 'LONG_FORM', periodStart: '2026-08-21', periodEnd: '2026-08-28',
  views, engagedViews: views, watchTimeMinutes: views * 2,
  averageViewDurationSeconds: dimension === 'country' || dimension === 'subscribed_status' ? 180 : null,
  averageViewPercentage: dimension === 'country' || dimension === 'subscribed_status' ? 45 : null,
  collectedAt: now, ...overrides,
});
const complete = () => [
  raw('traffic_source', 'YT_SEARCH', 300), raw('traffic_source', 'BROWSE', 100),
  raw('search_term', 'termo real', 80), raw('country', 'BR', 350),
  raw('device_type', 'MOBILE', 320), raw('subscribed_status', 'UNSUBSCRIBED', 280),
];
const googleReady = { isConfigured: () => true, isAuthenticated: () => true };
const service = (records = complete(), error = null) => new YouTubeAudienceSyncService({
  googleService: googleReady,
  provider: { async fetch() { if (error) throw error; return { records, availableDimensions: [...new Set(records.map(({ dimension }) => dimension))], missingDimensions: ['traffic_source','search_term','country','device_type','subscribed_status'].filter((value) => !records.some(({ dimension }) => dimension === value)) }; } },
  snapshotRepository: snapshots,
  stateRepository: states,
});

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  const sql = `
    CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "AudienceSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE,
      "dimension" TEXT NOT NULL, "segment" TEXT NOT NULL, "format" TEXT,
      "periodStart" DATETIME NOT NULL, "periodEnd" DATETIME NOT NULL,
      "views" REAL, "engagedViews" REAL, "watchTimeMinutes" REAL,
      "averageViewDurationSeconds" REAL, "averageViewPercentage" REAL,
      "source" TEXT NOT NULL, "collectedAt" DATETIME NOT NULL,
      "freshnessAtCollection" TEXT NOT NULL, "qualityAtCollection" TEXT NOT NULL,
      "qualityReasons" JSONB NOT NULL, "providerMetadata" JSONB,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL
    );
    CREATE TABLE "AudienceSyncState" (
      "source" TEXT NOT NULL PRIMARY KEY, "state" TEXT NOT NULL, "lastSyncAt" DATETIME,
      "lastErrorType" TEXT, "missingData" JSONB NOT NULL, "updatedAt" DATETIME NOT NULL
    );`;
  for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
  snapshots = new AudienceSnapshotRepository(client);
  states = new AudienceSyncStateRepository(client);
});
beforeEach(async () => { await client.audienceSyncState.deleteMany(); await client.audienceSnapshot.deleteMany(); await client.$executeRawUnsafe('DELETE FROM "Project"'); });
after(async () => DatabaseService.disconnect());

describe('Audience persistence, quality and intelligence', { concurrency: false }, () => {
  test('sync persists official rows idempotently and reports complete quality', async () => {
    const first = await service().sync({ startDate: '2026-08-01', endDate: '2026-08-07' });
    const second = await service(complete().map((item) => item.dimension === 'traffic_source' && item.segment === 'YT_SEARCH' ? { ...item, views: 400 } : item)).sync({ startDate: '2026-08-01', endDate: '2026-08-07' });
    assert.equal(first.created, 6); assert.equal(first.state, 'synchronized');
    assert.equal(second.created, 0); assert.equal(second.updated, 6);
    assert.equal((await snapshots.findAll()).length, 6);
    assert.equal((await snapshots.findAll({ dimension: 'traffic_source' }))[0].views, 400);
    assert.equal(second.quality.state, 'GOOD');
  });

  test('summary separates facts, signals, missing data and confidence', async () => {
    await service().sync({ startDate: '2026-08-01', endDate: '2026-08-07' });
    const summary = await new AudienceIntelligenceService(snapshots).summary();
    assert.equal(summary.trafficSources[0].segment, 'YT_SEARCH');
    assert.equal(summary.countries[0].segment, 'BR');
    assert.equal(summary.countries[0].averageViewDurationSeconds, 180);
    assert.equal(summary.devices[0].segment, 'MOBILE');
    assert.equal(summary.subscribedStatus[0].segment, 'UNSUBSCRIBED');
    assert.equal(summary.subscribedStatus[0].averageViewPercentage, 45);
    assert.equal(summary.searchTerms[0].segment, 'termo real');
    assert.ok(summary.facts.every((value) => typeof value === 'string'));
    assert.ok(summary.confidence > 0);
    assert.deepEqual(summary.missingData, []);
  });

  test('partial and absent datasets remain explicit instead of being invented', async () => {
    await service([raw('traffic_source', 'BROWSE', 10)]).sync({ startDate: '2026-08-01', endDate: '2026-08-07' });
    const summary = await new AudienceIntelligenceService(snapshots).summary();
    assert.equal(summary.quality.state, 'PARTIAL');
    assert.ok(summary.missingData.includes('search_term'));
    assert.deepEqual(summary.searchTerms, []);
    await client.audienceSnapshot.deleteMany();
    assert.equal((await new AudienceIntelligenceService(snapshots).summary()).quality.state, 'MISSING');
  });

  test('data quality detects stale and inconsistent rows', () => {
    const quality = new DataQualityService();
    const shape = (overrides = {}) => ({
      id: 'a', projectId: null, ingestionKey: 'a', dimension: 'traffic_source', segment: 'BROWSE', format: 'LONG_FORM',
      periodStart: new Date('2026-01-01T00:00:00Z'), periodEnd: new Date('2026-01-02T00:00:00Z'), views: 10,
      engagedViews: 10, watchTimeMinutes: 20, averageViewDurationSeconds: null, averageViewPercentage: null,
      source: 'youtube-analytics-audience', collectedAt: now, freshnessAtCollection: 'RECENT', qualityAtCollection: 'GOOD',
      qualityReasons: [], providerMetadata: null, createdAt: now, updatedAt: now, ...overrides,
    });
    assert.equal(quality.evaluateAudience([shape()], ['traffic_source'], now).state, 'STALE');
    assert.equal(quality.evaluateAudience([shape({ views: -1, periodEnd: new Date('2026-08-08T00:00:00Z') })], ['traffic_source'], now).state, 'INCONSISTENT');
  });

  test('compares equivalent periods and reports a changed traffic mix', async () => {
    await service([raw('traffic_source', 'BROWSE', 100, { periodStart: '2026-08-01', periodEnd: '2026-08-08' })]).sync({ startDate: '2026-08-01', endDate: '2026-08-07' });
    await service([raw('traffic_source', 'YT_SEARCH', 200, { periodStart: '2026-07-24', periodEnd: '2026-08-01' })]).sync({ startDate: '2026-07-24', endDate: '2026-07-31' });
    const result = await new AudienceIntelligenceService(snapshots).compare({ currentStart: new Date('2026-08-01T00:00:00Z'), currentEnd: new Date('2026-08-08T00:00:00Z'), previousStart: new Date('2026-07-24T00:00:00Z'), previousEnd: new Date('2026-08-01T00:00:00Z') });
    assert.equal(result.current.traffic[0].segment, 'BROWSE');
    assert.equal(result.previous.traffic[0].segment, 'YT_SEARCH');
    assert.equal(result.changes.principalTrafficChanged, true);
    assert.equal(result.changes.principalCountryChanged, null);
    assert.equal(result.changes.principalDeviceChanged, null);
  });

  test('preserves last-known-good snapshots and sync time after a provider failure', async () => {
    const ok = service(); await ok.sync({ startDate: '2026-08-01', endDate: '2026-08-07' });
    const priorStatus = await states.find('youtube-analytics-audience');
    await assert.rejects(service([], new YouTubeAnalyticsTemporaryError()).sync({ startDate: '2026-08-01', endDate: '2026-08-07' }), YouTubeAnalyticsTemporaryError);
    assert.equal((await snapshots.findAll()).length, 6);
    const failed = await states.find('youtube-analytics-audience');
    assert.equal(failed.state, 'temporary_error');
    assert.equal(failed.lastSyncAt.getTime(), priorStatus.lastSyncAt.getTime());
  });

  test('keeps project audience histories isolated', async () => {
    await client.$executeRawUnsafe(`INSERT INTO "Project" ("id") VALUES ('one'), ('two')`);
    await service([raw('country', 'BR', 10)]).sync({ projectId: 'one', startDate: '2026-08-01', endDate: '2026-08-07' });
    await service([raw('country', 'US', 20)]).sync({ projectId: 'two', startDate: '2026-08-01', endDate: '2026-08-07' });
    assert.deepEqual((await snapshots.findAll({ projectId: 'one' })).map(({ segment }) => segment), ['BR']);
    assert.deepEqual((await snapshots.findAll({ projectId: 'two' })).map(({ segment }) => segment), ['US']);
  });

  test('Supervisor consolidates audience quality and facts without fabricating alerts', async () => {
    const audience = { quality: { state: 'PARTIAL' }, facts: ['Principal fonte: BROWSE.'], signals: [], missingData: ['search_term'] };
    const supervisor = new SupervisorModule(
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined,
      { summary: async () => audience },
    );
    const overview = await supervisor.getSupervisorOverview();
    assert.deepEqual(overview.audience, audience);
    assert.equal(overview.dataQuality.find(({ area }) => area === 'Audiência').state, 'PARTIAL');
    assert.equal(overview.dataQuality.find(({ area }) => area === 'Audiência').summary, 'Principal fonte: BROWSE.');
  });
});
