const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ChannelProfileRepository } = require('../dist/database/repositories/ChannelProfileRepository');
const {
  ChannelProfileService,
  ChannelProfileNotFoundError,
  ChannelProfileConflictError,
} = require('../dist/services/ChannelProfileService');
const { createChannelProfilesRouter } = require('../dist/routes/channelProfiles');
const { createOperatorsRouter } = require('../dist/routes/operators');
const { PlannerService } = require('../dist/services/PlannerService');
const { ConversationRepository } = require('../dist/database/repositories/ConversationRepository');
const { MessageRepository } = require('../dist/database/repositories/MessageRepository');

let client;
let repository;
let service;

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe(`CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL UNIQUE, "name" TEXT, "role" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  )`);
  await client.$executeRawUnsafe(`CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "description" TEXT, "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`);
  await client.$executeRawUnsafe(`CREATE TABLE "ChannelProfile" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT UNIQUE, "youtubeChannelId" TEXT UNIQUE,
    "displayName" TEXT NOT NULL, "thumbnailUrl" TEXT, "usesLegacyWorkspaceData" BOOLEAN NOT NULL DEFAULT false, "legacyDataAdoptedAt" DATETIME, "connectionState" TEXT NOT NULL DEFAULT 'DISCONNECTED', "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`);
  await client.$executeRawUnsafe(`CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "title" TEXT, "context" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  )`);
  await client.$executeRawUnsafe(`CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "sender" TEXT NOT NULL, "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE
  )`);
  repository = new ChannelProfileRepository(client);
  service = new ChannelProfileService(client, repository);
});

beforeEach(async () => {
  await client.message.deleteMany();
  await client.conversation.deleteMany();
  await client.channelProfile.deleteMany();
  await client.project.deleteMany();
  await client.user.deleteMany();
});

after(async () => DatabaseService.disconnect());

describe('channel profile persistence', { concurrency: false }, () => {
  test('creates profiles with deterministic ordering and no active profile by default', async () => {
    await repository.create({ displayName: 'Zeta' });
    await repository.create({ displayName: 'Alpha' });
    const profiles = await repository.findAll();
    assert.deepEqual(profiles.map((profile) => profile.displayName), ['Alpha', 'Zeta']);
    assert.equal(await repository.findActive(), null);
  });

  test('creates a separate workspace boundary for every new channel profile', async () => {
    const games = await service.create({ displayName: 'JvitorZx' });
    const music = await service.create({ displayName: 'JVTR' });
    assert.ok(games.projectId);
    assert.ok(music.projectId);
    assert.notEqual(games.projectId, music.projectId);
    assert.equal(await client.project.count(), 2);
  });

  test('activation leaves exactly one profile active', async () => {
    const games = await repository.create({ displayName: 'JvitorZx' });
    const music = await repository.create({ displayName: 'JVTR' });
    await repository.activate(games.id);
    const active = await repository.activate(music.id);
    assert.equal(active.id, music.id);
    assert.deepEqual((await repository.findAll()).filter((profile) => profile.isActive).map((profile) => profile.id), [music.id]);
  });

  test('service validates project ownership and profile existence', async () => {
    await assert.rejects(() => service.create({ displayName: 'Games', projectId: 'missing' }), /does not reference/);
    await assert.rejects(() => service.activate('missing'), ChannelProfileNotFoundError);
  });

  test('observed YouTube channel cannot be silently reassigned to a different profile', async () => {
    const games = await repository.create({ displayName: 'JvitorZx' });
    const music = await service.create({ displayName: 'JVTR' });
    const connected = await service.connectObservedChannel(games.id, {
      id: 'games-channel', title: 'JvitorZx', thumbnailUrl: 'https://yt.example/games.jpg',
    });
    assert.equal(connected.youtubeChannelId, 'games-channel');
    assert.equal(connected.thumbnailUrl, 'https://yt.example/games.jpg');
    await assert.rejects(
      () => service.connectObservedChannel(games.id, { id: 'music-channel', title: 'JVTR' }),
      ChannelProfileConflictError,
    );
    await assert.rejects(
      () => service.connectObservedChannel(music.id, { id: 'games-channel', title: 'JvitorZx' }),
      ChannelProfileConflictError,
    );
  });

  test('adopting legacy workspace data is explicit and persisted on the chosen profile', async () => {
    const games = await service.create({ displayName: 'JvitorZx' });
    const adopted = await service.adoptLegacyWorkspaceData(games.id);
    assert.equal(adopted.usesLegacyWorkspaceData, true);
    assert.ok(adopted.legacyDataAdoptedAt instanceof Date);
    assert.equal((await repository.findById(games.id)).usesLegacyWorkspaceData, true);
  });

  test('active channel scope hides Planner conversations from other channel workspaces', async () => {
    const planner = new PlannerService(new ConversationRepository(client), new MessageRepository(client));
    const games = await client.project.create({ data: { name: 'Games', owner: { create: { email: 'games-owner@local.test' } } } });
    const music = await client.project.create({ data: { name: 'Music', owner: { create: { email: 'music-owner@local.test' } } } });
    const gamesConversation = await planner.createConversation({ title: 'Games plan', projectId: games.id });
    const musicConversation = await planner.createConversation({ title: 'Music plan', projectId: music.id });
    const app = express(); app.use(express.json());
    app.use('/operators', createOperatorsRouter(planner, undefined, undefined, undefined, undefined, undefined, undefined, {
      getActive: async () => ({ id: 'games-profile', projectId: games.id }),
    }));
    const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}/operators/planner/conversations`;
      const listed = await fetch(base); const listedBody = await listed.json();
      assert.equal(listed.status, 200);
      assert.deepEqual(listedBody.map((conversation) => conversation.id), [gamesConversation.id]);
      const hidden = await fetch(`${base}/${musicConversation.id}`);
      assert.equal(hidden.status, 404);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});

test('channel profiles HTTP contract is strict and exposes no internal database error', async () => {
  const profiles = [{ id: 'games', displayName: 'JvitorZx', isActive: true }];
  const app = express();
  app.use(express.json());
  app.use('/profiles', createChannelProfilesRouter({
    list: async () => profiles,
    getActive: async () => profiles[0],
    create: async ({ displayName }) => ({ id: 'music', displayName, isActive: false }),
    activate: async (id) => ({ id, displayName: 'JVTR', isActive: true }),
    adoptLegacyWorkspaceData: async (id) => ({ id, displayName: 'JvitorZx', usesLegacyWorkspaceData: true }),
  }));
  const server = await new Promise((resolve) => { const active = app.listen(0, '127.0.0.1', () => resolve(active)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/profiles`;
    const listed = await fetch(base);
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), { profiles, activeProfileId: 'games' });
    const created = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'JVTR' }) });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).id, 'music');
    assert.equal((await fetch(`${base}/games/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 200);
    assert.equal((await fetch(`${base}/games/adopt-legacy-data`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 200);
    assert.equal((await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'x', injected: true }) })).status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('channel profile migration preserves existing channel snapshots without assigning ownership', () => {
  const Database = require('better-sqlite3');
  const fs = require('node:fs');
  const path = require('node:path');
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "ChannelSnapshot" ("id" TEXT NOT NULL PRIMARY KEY, "channelId" TEXT NOT NULL UNIQUE, "title" TEXT NOT NULL,
      "collectedAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL);
      INSERT INTO "ChannelSnapshot" ("id", "channelId", "title", "collectedAt", "updatedAt") VALUES ('legacy', 'games', 'JvitorZx', 1, 1);`);
    db.exec(fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260925100000_channel_profiles/migration.sql'), 'utf8'));
    const legacy = db.prepare('SELECT "channelProfileId" FROM "ChannelSnapshot" WHERE "id" = ?').get('legacy');
    assert.equal(legacy.channelProfileId, null);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'ChannelProfile'").get().count, 1);
  } finally { db.close(); }
});

test('channel profile thumbnail migration preserves existing profiles', () => {
  const Database = require('better-sqlite3');
  const fs = require('node:fs');
  const path = require('node:path');
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE "ChannelProfile" ("id" TEXT NOT NULL PRIMARY KEY, "displayName" TEXT NOT NULL);
      INSERT INTO "ChannelProfile" ("id", "displayName") VALUES ('games', 'JvitorZx');`);
    db.exec(fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260925110000_channel_profile_thumbnail/migration.sql'), 'utf8'));
    const profile = db.prepare('SELECT "displayName", "thumbnailUrl" FROM "ChannelProfile" WHERE "id" = ?').get('games');
    assert.deepEqual(profile, { displayName: 'JvitorZx', thumbnailUrl: null });
  } finally { db.close(); }
});

test('legacy data scope migration leaves adoption disabled until it is explicitly chosen', () => {
  const Database = require('better-sqlite3');
  const fs = require('node:fs');
  const path = require('node:path');
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE "ChannelProfile" ("id" TEXT NOT NULL PRIMARY KEY, "displayName" TEXT NOT NULL);
      INSERT INTO "ChannelProfile" ("id", "displayName") VALUES ('games', 'JvitorZx');`);
    db.exec(fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260925120000_channel_profile_legacy_data_scope/migration.sql'), 'utf8'));
    const profile = db.prepare('SELECT "usesLegacyWorkspaceData", "legacyDataAdoptedAt" FROM "ChannelProfile" WHERE "id" = ?').get('games');
    assert.deepEqual(profile, { usesLegacyWorkspaceData: 0, legacyDataAdoptedAt: null });
  } finally { db.close(); }
});
