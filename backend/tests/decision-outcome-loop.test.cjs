const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, describe, test } = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ChannelInsightRepository } = require('../dist/database/repositories/ChannelInsightRepository');
const { ConversationRepository } = require('../dist/database/repositories/ConversationRepository');
const { EditorialDecisionRepository } = require('../dist/database/repositories/EditorialDecisionRepository');
const { EditorialDecisionOutcomeRepository } = require('../dist/database/repositories/EditorialDecisionOutcomeRepository');
const { EditorialDecisionVideoLinkRepository } = require('../dist/database/repositories/EditorialDecisionVideoLinkRepository');
const { MessageRepository } = require('../dist/database/repositories/MessageRepository');
const { PerformanceSignalRepository } = require('../dist/database/repositories/PerformanceSignalRepository');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { createCreatorIntelligenceRouter } = require('../dist/routes/creatorIntelligence');
const { PlannerService } = require('../dist/services/PlannerService');
const { ChannelMemoryService } = require('../dist/services/creator-intelligence/ChannelMemoryService');
const { CreatorIntelligenceService } = require('../dist/services/creator-intelligence/CreatorIntelligenceService');
const {
  DecisionOutcomeDecisionNotFoundError,
  DecisionOutcomeLinkConflictError,
  DecisionOutcomeService,
  DecisionOutcomeSnapshotNotFoundError,
} = require('../dist/services/creator-intelligence/DecisionOutcomeService');
const { EditorialDecisionService } = require('../dist/services/creator-intelligence/EditorialDecisionService');

const migrationSql = readFileSync(path.resolve(
  __dirname,
  '../prisma/migrations/20260825233000_decision_outcome_loop/migration.sql',
), 'utf8');

let client;
let conversations;
let messages;
let decisions;
let links;
let outcomes;
let snapshots;
let signals;
let insights;
let memory;
let outcomeService;
let intelligence;
let editorialService;
let server;
let baseUrl;
let sequence = 0;

const baseSchema = `
  CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
  CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "title" TEXT, "context" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  );
  CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "sender" TEXT NOT NULL,
    "text" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "VideoIdea" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "game" TEXT, "theme" TEXT NOT NULL,
    "format" TEXT NOT NULL, "premise" TEXT NOT NULL, "estimatedEffort" INTEGER,
    "novelty" REAL, "identityFit" REAL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE TABLE "ContentOpportunity" (
    "id" TEXT NOT NULL PRIMARY KEY, "videoIdeaId" TEXT NOT NULL, "source" TEXT NOT NULL,
    "classification" TEXT NOT NULL, "summary" TEXT NOT NULL, "score" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
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
    "publishedAt" DATETIME, "periodStart" DATETIME, "periodEnd" DATETIME, "views" REAL,
    "impressions" REAL, "ctr" REAL, "durationSeconds" REAL, "averageViewDurationSeconds" REAL,
    "averageViewPercentage" REAL, "watchTimeMinutes" REAL, "subscribersGained" INTEGER,
    "subscribersLost" INTEGER, "likes" INTEGER, "comments" INTEGER, "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1, "collectedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  );
  CREATE TABLE "PerformanceSignal" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "videoIdeaId" TEXT,
    "performanceSnapshotId" TEXT, "key" TEXT UNIQUE, "game" TEXT, "series" TEXT, "format" TEXT,
    "metric" TEXT NOT NULL, "value" REAL NOT NULL, "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL, "classification" TEXT NOT NULL DEFAULT 'real',
    "confidence" REAL NOT NULL DEFAULT 1, "measuredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "EditorialDecision" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "conversationId" TEXT,
    "operatorMessageId" TEXT, "outcomeSnapshotId" TEXT, "dedupeKey" TEXT NOT NULL UNIQUE,
    "question" TEXT NOT NULL, "intent" TEXT NOT NULL, "recommendation" TEXT NOT NULL,
    "alternatives" JSONB NOT NULL, "score" REAL, "confidence" REAL NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'recommendation', "evidence" JSONB NOT NULL,
    "risks" JSONB NOT NULL, "missingData" JSONB NOT NULL, "nextAction" TEXT NOT NULL,
    "outcome" JSONB, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
`;

const executeSql = async (sql) => {
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
};

const createConversation = () => conversations.create({ projectId: null, title: 'Outcome', context: null });

const createDecision = async (overrides = {}) => decisions.create({
  projectId: null,
  conversationId: null,
  dedupeKey: `decision-${++sequence}`,
  question: 'O que vale gravar?',
  intent: 'next_content',
  recommendation: 'Testar formato narrado.',
  alternatives: [],
  score: 75,
  confidence: 0.7,
  classification: 'recommendation',
  evidence: [],
  risks: ['Amostra limitada.'],
  missingData: [],
  nextAction: 'Publicar um teste controlado.',
  ...overrides,
});

const snapshotData = (overrides = {}) => ({
  projectId: null,
  ingestionKey: `snapshot-${++sequence}`,
  videoId: `video-${sequence}`,
  title: `Vídeo ${sequence}`,
  game: 'BeamNG.drive',
  series: 'Desafios',
  format: 'narrado',
  publishedAt: new Date('2026-08-01T00:00:00.000Z'),
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-08-07T00:00:00.000Z'),
  views: 100,
  engagedViews: null,
  impressions: 1000,
  ctr: 5,
  durationSeconds: 600,
  averageViewDurationSeconds: 240,
  averageViewPercentage: 40,
  watchTimeMinutes: 400,
  subscribersGained: 5,
  subscribersLost: 1,
  likes: 20,
  comments: 4,
  source: 'youtube-analytics',
  confidence: 1,
  collectedAt: new Date('2026-08-24T12:00:00.000Z'),
  ...overrides,
});

const createSnapshot = (overrides = {}) => snapshots.upsert(snapshotData(overrides)).then(({ snapshot }) => snapshot);

const createHistory = async () => {
  for (let index = 0; index < 3; index += 1) {
    await createSnapshot({
      videoId: `history-${index}`,
      title: `Histórico ${index}`,
      views: 100,
      impressions: 1000,
      ctr: 5,
      watchTimeMinutes: 400,
      averageViewDurationSeconds: 240,
      averageViewPercentage: 40,
      subscribersGained: 5,
      subscribersLost: 2,
      likes: 20,
      comments: 4,
    });
  }
};

const request = async (route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await executeSql(baseSchema);
  await executeSql(migrationSql);
  conversations = new ConversationRepository(client);
  messages = new MessageRepository(client);
  decisions = new EditorialDecisionRepository(client);
  links = new EditorialDecisionVideoLinkRepository(client);
  outcomes = new EditorialDecisionOutcomeRepository(client);
  snapshots = new VideoPerformanceSnapshotRepository(client);
  signals = new PerformanceSignalRepository(client);
  insights = new ChannelInsightRepository(client);
  memory = new ChannelMemoryService(insights, signals, snapshots);
  outcomeService = new DecisionOutcomeService(decisions, links, outcomes, snapshots, memory);
  intelligence = new CreatorIntelligenceService({
    insightRepository: insights,
    performanceSignalRepository: signals,
    channelMemoryService: memory,
    snapshotRepository: snapshots,
  });
  editorialService = new EditorialDecisionService(intelligence, decisions, conversations, snapshots, signals);
  const youtube = { async getStatus() { return { state: 'connected', lastSyncAt: null, lastErrorType: null }; } };
  const app = express();
  app.use(express.json());
  app.use(createCreatorIntelligenceRouter(intelligence, youtube, editorialService, outcomeService));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

beforeEach(async () => {
  await client.editorialDecisionOutcome.deleteMany();
  await client.editorialDecisionVideoLink.deleteMany();
  await client.editorialDecision.deleteMany();
  await client.channelInsight.deleteMany();
  await client.performanceSignal.deleteMany();
  await client.videoPerformanceSnapshot.deleteMany();
  await client.message.deleteMany();
  await client.conversation.deleteMany();
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await DatabaseService.disconnect();
});

describe('Decision video link repository and service', { concurrency: false }, () => {
  test('persists a real decision-to-video link and returns it deterministically', async () => {
    const decision = await createDecision();
    const snapshot = await createSnapshot({ videoId: 'published-video' });
    const first = await outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id, notes: 'Teste publicado.' });
    const repeated = await outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id });
    assert.equal(first.created, true);
    assert.equal(repeated.created, false);
    assert.equal(repeated.link.id, first.link.id);
    assert.equal((await outcomeService.listLinks(decision.id)).length, 1);
  });

  test('deduplicates concurrent link attempts in the database', async () => {
    const decision = await createDecision();
    const snapshot = await createSnapshot({ videoId: 'concurrent-video' });
    const linked = await Promise.all([
      outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id }),
      outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id }),
    ]);
    assert.equal(linked[0].link.id, linked[1].link.id);
    assert.equal(await client.editorialDecisionVideoLink.count(), 1);
  });

  test('rejects nonexistent entities and cross-project links', async () => {
    const decision = await createDecision();
    await assert.rejects(outcomeService.linkVideo('missing', { snapshotId: 'missing' }), DecisionOutcomeDecisionNotFoundError);
    await assert.rejects(outcomeService.linkVideo(decision.id, { snapshotId: 'missing' }), DecisionOutcomeSnapshotNotFoundError);
    await client.$executeRawUnsafe('INSERT INTO "Project" ("id") VALUES (\'project-b\')');
    const snapshot = await createSnapshot({ projectId: 'project-b' });
    await assert.rejects(outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id }), DecisionOutcomeLinkConflictError);
  });

  test('removes an unevaluated link but protects evaluated history', async () => {
    await createHistory();
    const decision = await createDecision();
    const snapshot = await createSnapshot({ views: 200, watchTimeMinutes: 800 });
    const first = await outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id });
    await outcomeService.removeLink(decision.id, first.link.id);
    assert.equal((await outcomeService.listLinks(decision.id)).length, 0);
    const second = await outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id });
    await outcomeService.evaluate(second.link.id);
    await assert.rejects(outcomeService.removeLink(decision.id, second.link.id), DecisionOutcomeLinkConflictError);
  });
});

describe('Decision outcome evaluation', { concurrency: false }, () => {
  const evaluateTarget = async (metrics) => {
    await createHistory();
    const decision = await createDecision();
    const snapshot = await createSnapshot(metrics);
    const { link } = await outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id });
    return outcomeService.evaluate(link.id);
  };

  test('classifies positive evidence without claiming causality', async () => {
    const { outcome } = await evaluateTarget({ views: 180, watchTimeMinutes: 720, averageViewPercentage: 55 });
    assert.equal(outcome.classification, 'POSITIVE');
    assert.match(outcome.interpretation.causality, /não demonstra.*causou/);
    assert.ok(outcome.supportingMetrics.length >= 2);
  });

  test('classifies mixed evidence when metrics disagree', async () => {
    const { outcome } = await evaluateTarget({ views: 180, watchTimeMinutes: 180, averageViewPercentage: 25 });
    assert.equal(outcome.classification, 'MIXED');
    assert.ok(outcome.supportingMetrics.length > 0);
    assert.ok(outcome.contradictingMetrics.length > 0);
  });

  test('classifies negative evidence with sufficient comparisons', async () => {
    const { outcome } = await evaluateTarget({
      views: 50,
      watchTimeMinutes: 150,
      averageViewPercentage: 25,
      subscribersLost: 4,
    });
    assert.equal(outcome.classification, 'NEGATIVE');
    assert.ok(outcome.contradictingMetrics.length >= 2);
  });

  test('remains inconclusive with insufficient data and never invents engaged views', async () => {
    const decision = await createDecision();
    const snapshot = await createSnapshot({
      views: 100, engagedViews: null, impressions: null, ctr: null, watchTimeMinutes: null,
      averageViewDurationSeconds: null, averageViewPercentage: null, subscribersGained: null,
      subscribersLost: null, likes: null, comments: null,
    });
    const { link } = await outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id });
    const { outcome } = await outcomeService.evaluate(link.id);
    assert.equal(outcome.classification, 'INCONCLUSIVE');
    assert.equal(outcome.facts.engagedViews, null);
    assert.ok(outcome.missingData.includes('engaged views'));
  });

  test('re-evaluates idempotently and revises the same learning', async () => {
    await createHistory();
    const decision = await createDecision();
    const data = snapshotData({
      videoId: 'revised-video',
      views: 180,
      watchTimeMinutes: 720,
      subscribersLost: 2,
    });
    const snapshot = (await snapshots.upsert(data)).snapshot;
    const { link } = await outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id });
    const first = await outcomeService.evaluate(link.id);
    const firstLearning = first.outcome.learningInsight;
    await snapshots.upsert({
      ...data,
      views: 40,
      watchTimeMinutes: 100,
      averageViewPercentage: 20,
      subscribersLost: 4,
    });
    const second = await outcomeService.evaluate(link.id, snapshot.id);
    assert.equal(second.created, false);
    assert.equal(second.outcome.id, first.outcome.id);
    assert.equal(second.outcome.classification, 'NEGATIVE');
    assert.equal(second.outcome.learningInsightId, firstLearning.id);
    assert.equal(await client.channelInsight.count(), 1);
    assert.notEqual(second.outcome.learningInsight.statement, firstLearning.statement);
  });
});

describe('Decision outcome HTTP API', { concurrency: false }, () => {
  test('links, lists, evaluates and opens an outcome with idempotent statuses', async () => {
    await createHistory();
    const decision = await createDecision();
    const snapshot = await createSnapshot({ videoId: 'api-video', views: 180, watchTimeMinutes: 720 });
    const first = await request(`/editorial-decisions/${decision.id}/videos`, {
      method: 'POST', body: JSON.stringify({ snapshotId: snapshot.id, origin: 'manual' }),
    });
    assert.equal(first.status, 201);
    const repeated = await request(`/editorial-decisions/${decision.id}/videos`, {
      method: 'POST', body: JSON.stringify({ snapshotId: snapshot.id }),
    });
    assert.equal(repeated.status, 200);
    assert.equal((await request(`/editorial-decisions/${decision.id}/videos`)).body.length, 1);
    const evaluated = await request(`/editorial-decisions/${decision.id}/videos/${first.body.id}/outcomes`, {
      method: 'POST', body: JSON.stringify({}),
    });
    assert.equal(evaluated.status, 201);
    const reevaluated = await request(`/editorial-decisions/${decision.id}/videos/${first.body.id}/outcomes`, {
      method: 'POST', body: JSON.stringify({ snapshotId: snapshot.id }),
    });
    assert.equal(reevaluated.status, 200);
    assert.equal(reevaluated.body.id, evaluated.body.id);
    assert.equal((await request('/decision-outcomes?limit=5')).status, 200);
    assert.equal((await request(`/decision-outcomes/${evaluated.body.id}`)).status, 200);
    assert.equal((await request(`/editorial-decisions/${decision.id}/outcomes`)).body.length, 1);
  });

  test('validates payloads and returns safe missing errors', async () => {
    const decision = await createDecision();
    const invalid = await request(`/editorial-decisions/${decision.id}/videos`, {
      method: 'POST', body: JSON.stringify({ snapshotId: '', content: 'arbitrary' }),
    });
    assert.equal(invalid.status, 400);
    const missing = await request(`/editorial-decisions/${decision.id}/videos`, {
      method: 'POST', body: JSON.stringify({ snapshotId: 'missing' }),
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(Object.keys(missing.body), ['error']);
    assert.equal((await request('/decision-outcomes?unknown=value')).status, 400);
  });
});

describe('Decision outcome memory integration', { concurrency: false }, () => {
  test('flows from decision to video, performance, outcome, memory and Planner context', async () => {
    await createHistory();
    const conversation = await createConversation();
    const decision = await createDecision({ conversationId: conversation.id });
    const snapshot = await createSnapshot({ videoId: 'full-flow', views: 180, watchTimeMinutes: 720 });
    const { link } = await outcomeService.linkVideo(decision.id, { snapshotId: snapshot.id });
    const { outcome } = await outcomeService.evaluate(link.id);
    assert.ok(outcome.learningInsight);
    await messages.create({ conversationId: conversation.id, sender: 'user', text: 'O último teste deu certo?' });
    const planner = new PlannerService(conversations, messages, undefined, intelligence, undefined, editorialService);
    const reply = await planner.generateReply(conversation.id);
    assert.equal(reply.sender, 'operator');
    assert.equal(reply.editorialDecision.intent, 'diagnose_performance');
    assert.ok(reply.editorialDecision.evidence.some(({ source }) => source.startsWith('channel-memory:')));
  });
});

describe('Decision outcome migration', () => {
  test('is additive, preserves snapshots and enforces link identity', () => {
    const database = new Database(':memory:');
    try {
      database.exec(`
        PRAGMA foreign_keys=ON;
        CREATE TABLE "EditorialDecision" ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE "ChannelInsight" ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE "VideoPerformanceSnapshot" ("id" TEXT NOT NULL PRIMARY KEY, "videoId" TEXT NOT NULL, "views" REAL);
        INSERT INTO "EditorialDecision" ("id") VALUES ('decision');
        INSERT INTO "VideoPerformanceSnapshot" ("id", "videoId", "views") VALUES ('snapshot', 'video', 10);
        ${migrationSql}
      `);
      assert.ok(database.prepare('PRAGMA table_info("VideoPerformanceSnapshot")').all().some(({ name }) => name === 'engagedViews'));
      assert.equal(database.prepare('SELECT "views" FROM "VideoPerformanceSnapshot"').get().views, 10);
      database.prepare(`INSERT INTO "EditorialDecisionVideoLink"
        ("id", "decisionId", "sourceSnapshotId", "videoId") VALUES ('link', 'decision', 'snapshot', 'video')`).run();
      assert.throws(() => database.prepare(`INSERT INTO "EditorialDecisionVideoLink"
        ("id", "decisionId", "sourceSnapshotId", "videoId") VALUES ('link-2', 'decision', 'snapshot', 'video')`).run(), /UNIQUE/);
    } finally {
      database.close();
    }
  });
});
