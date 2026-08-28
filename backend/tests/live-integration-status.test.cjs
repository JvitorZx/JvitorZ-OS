const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, describe, test } = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ChannelSnapshotRepository } = require('../dist/database/repositories/ChannelSnapshotRepository');
const { ChannelDataService } = require('../dist/services/ChannelDataService');
const { IntegrationStatusService } = require('../dist/services/IntegrationStatusService');
const { createIntegrationsRouter } = require('../dist/routes/integrations');

let client;
let repository;

const snapshot = (overrides = {}) => ({
  channelId: 'channel-1', title: 'Canal real', subscriberCount: '148', videoCount: '248',
  viewCount: '85228', country: 'BR', publishedAt: new Date('2016-02-07T12:19:28.000Z'),
  collectedAt: new Date('2026-08-27T20:00:00.000Z'), ...overrides,
});

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe(`CREATE TABLE "ChannelSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY, "channelId" TEXT NOT NULL UNIQUE, "title" TEXT NOT NULL,
    "subscriberCount" TEXT, "videoCount" TEXT, "viewCount" TEXT, "country" TEXT,
    "publishedAt" DATETIME, "collectedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  )`);
  repository = new ChannelSnapshotRepository(client);
});

beforeEach(async () => client.channelSnapshot.deleteMany());
after(async () => DatabaseService.disconnect());

describe('live channel persistence', { concurrency: false }, () => {
  test('repository upserts and returns the latest real channel snapshot', async () => {
    await repository.upsert(snapshot());
    const updated = await repository.upsert(snapshot({ subscriberCount: '149', collectedAt: new Date('2026-08-27T21:00:00.000Z') }));
    assert.equal(await client.channelSnapshot.count(), 1);
    assert.equal(updated.subscriberCount, '149');
    assert.equal((await repository.findLatest()).channelId, 'channel-1');
  });

  test('successful collection persists provider data and reports CONNECTED', async () => {
    let saved;
    const service = new ChannelDataService(
      { isConfigured: () => true, isAuthenticated: () => true },
      { findLatest: async () => null, upsert: async (data) => { saved = data; return { id: 'snapshot', createdAt: new Date(), updatedAt: new Date(), ...data }; } },
      { getChannelInfo: async () => ({ id: 'channel-1', title: 'Canal', subscribers: '10', videoCount: '2', viewCount: '50', country: 'BR', publishedAt: '2020-01-01T00:00:00.000Z' }) },
    );
    const result = await service.getChannel();
    assert.equal(result.integration.state, 'CONNECTED');
    assert.equal(result.subscribers, '10');
    assert.equal(saved.channelId, 'channel-1');
  });

  test('temporary provider failure preserves last-known-good data as DEGRADED', async () => {
    const cached = { id: 'cached', createdAt: new Date(), updatedAt: new Date(), ...snapshot() };
    const service = new ChannelDataService(
      { isConfigured: () => true, isAuthenticated: () => true },
      { findLatest: async () => cached, upsert: async () => { throw new Error('must not save'); } },
      { getChannelInfo: async () => { throw Object.assign(new Error('private'), { code: 'ETIMEDOUT' }); } },
    );
    const result = await service.getChannel();
    assert.equal(result.integration.state, 'DEGRADED');
    assert.equal(result.integration.stale, true);
    assert.equal(result.title, 'Canal real');
    assert.doesNotMatch(result.integration.summary, /private/);
  });

  test('missing authorization without cache is explicit and does not call provider', async () => {
    let calls = 0;
    const service = new ChannelDataService(
      { isConfigured: () => true, isAuthenticated: () => false },
      { findLatest: async () => null },
      { getChannelInfo: async () => { calls += 1; } },
    );
    const result = await service.getChannel();
    assert.equal(result.integration.state, 'AUTH_REQUIRED');
    assert.equal(result.id, null);
    assert.equal(calls, 0);
  });
});

describe('standard integration state', () => {
  const channel = { id: 'channel-1', integration: { state: 'CONNECTED', stale: false, lastSuccessAt: new Date('2026-08-27T20:00:00Z'), summary: 'Canal conectado.' } };
  const runtime = { getHealth: () => ({ enabled: false, status: 'STOPPED', lastSuccessfulTickAt: null }) };

  test('maps configuration, authentication, analytics and local services consistently', async () => {
    const service = new IntegrationStatusService(
      { getAuthenticationState: () => 'CONNECTED' },
      { getChannel: async () => channel },
      { getStatus: async () => ({ state: 'synchronized', lastSyncAt: new Date('2026-08-27T20:00:00Z'), lastErrorType: null }) },
      runtime,
      { $queryRawUnsafe: async () => [1] },
    );
    const result = await service.getAll({ channel });
    assert.equal(result.googleOAuth.state, 'CONNECTED');
    assert.equal(result.youtubeData.state, 'CONNECTED');
    assert.equal(result.youtubeAnalytics.state, 'CONNECTED');
    assert.equal(result.database.state, 'CONNECTED');
    assert.equal(result.openai.state, 'NOT_CONFIGURED');
    assert.equal(result.automationRuntime.state, 'NOT_CONFIGURED');
  });

  test('keeps a previous Analytics sync available in DEGRADED mode', async () => {
    const lastSyncAt = new Date('2026-08-26T20:00:00Z');
    const service = new IntegrationStatusService(
      { getAuthenticationState: () => 'CONNECTED' },
      { getChannel: async () => channel },
      { getStatus: async () => ({ state: 'temporary_error', lastSyncAt, lastErrorType: 'temporary' }) },
      runtime,
      { $queryRawUnsafe: async () => [1] },
    );
    const result = await service.getAll({ channel });
    assert.equal(result.youtubeAnalytics.state, 'DEGRADED');
    assert.equal(result.youtubeAnalytics.available, true);
    assert.equal(result.youtubeAnalytics.stale, true);
  });

  test('reports database failure without exposing its exception', async () => {
    const service = new IntegrationStatusService(
      { getAuthenticationState: () => 'AUTH_REQUIRED' },
      { getChannel: async () => ({ ...channel, id: null, integration: { ...channel.integration, state: 'AUTH_REQUIRED' } }) },
      { getStatus: async () => ({ state: 'not_authorized', lastSyncAt: null, lastErrorType: 'authorization' }) },
      runtime,
      { $queryRawUnsafe: async () => { throw new Error('private database path'); } },
    );
    const result = await service.getAll();
    assert.equal(result.googleOAuth.state, 'AUTH_REQUIRED');
    assert.equal(result.youtubeAnalytics.state, 'AUTH_REQUIRED');
    assert.equal(result.database.state, 'ERROR');
    assert.doesNotMatch(JSON.stringify(result), /private database path/);
  });
});

test('integration status endpoint returns only the consolidated safe contract', async () => {
  const app = express();
  app.use('/api/integrations', createIntegrationsRouter({ getAll: async () => ({ backend: { state: 'CONNECTED' } }) }));
  const server = await new Promise((resolve) => { const active = app.listen(0, '127.0.0.1', () => resolve(active)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/integrations/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { backend: { state: 'CONNECTED' } });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('live channel migration is additive and compatible with SQLite', () => {
  const db = new Database(':memory:');
  try {
    const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260831200000_live_channel_snapshot/migration.sql'), 'utf8');
    db.exec("CREATE TABLE Existing (id TEXT PRIMARY KEY, value TEXT); INSERT INTO Existing VALUES ('one', 'preserved');");
    db.exec(sql);
    assert.equal(db.prepare('SELECT value FROM Existing WHERE id = ?').get('one').value, 'preserved');
    assert.equal(db.prepare("SELECT count(*) count FROM sqlite_master WHERE type = 'table' AND name = 'ChannelSnapshot'").get().count, 1);
    db.prepare('INSERT INTO ChannelSnapshot (id, channelId, title, collectedAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run('snapshot-1', 'channel-1', 'Canal', Date.now(), Date.now());
    assert.throws(() => db.prepare('INSERT INTO ChannelSnapshot (id, channelId, title, collectedAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run('snapshot-2', 'channel-1', 'Duplicado', Date.now(), Date.now()));
  } finally {
    db.close();
  }
});
