const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ChannelInsightRepository } = require('../dist/database/repositories/ChannelInsightRepository');
const { ContentDecisionRepository } = require('../dist/database/repositories/ContentDecisionRepository');
const { ContentOpportunityRepository } = require('../dist/database/repositories/ContentOpportunityRepository');
const { ConversationRepository } = require('../dist/database/repositories/ConversationRepository');
const { MessageRepository } = require('../dist/database/repositories/MessageRepository');
const { PerformanceSignalRepository } = require('../dist/database/repositories/PerformanceSignalRepository');
const { VideoIdeaRepository } = require('../dist/database/repositories/VideoIdeaRepository');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { createOperatorsRouter } = require('../dist/routes/operators');
const { ChannelMemoryService } = require('../dist/services/creator-intelligence/ChannelMemoryService');
const { CreatorIntelligenceService } = require('../dist/services/creator-intelligence/CreatorIntelligenceService');
const { IdeaEvaluationService } = require('../dist/services/creator-intelligence/IdeaEvaluationService');
const { PlannerService } = require('../dist/services/PlannerService');

let client;
let server;
let baseUrl;
let creatorIntelligence;
let ideas;
let conversations;
let providerCalls;

const request = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const validIdea = (overrides = {}) => ({
  game: 'BeamNG.drive',
  theme: 'Simulacao',
  format: 'desafio narrado',
  premise: 'Descobrir se um carro comum conclui uma rota extrema.',
  estimatedEffort: 2,
  novelty: 75,
  identityFit: 90,
  ...overrides,
});

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  const schemaSql = `
    CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "Conversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT,
      "title" TEXT,
      "context" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "Message" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "sender" TEXT NOT NULL,
      "text" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE TABLE "VideoIdea" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT,
      "game" TEXT,
      "theme" TEXT NOT NULL,
      "format" TEXT NOT NULL,
      "premise" TEXT NOT NULL,
      "estimatedEffort" INTEGER,
      "novelty" REAL,
      "identityFit" REAL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ContentOpportunity" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "videoIdeaId" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "classification" TEXT NOT NULL,
      "summary" TEXT NOT NULL,
      "score" REAL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE TABLE "ContentDecision" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "videoIdeaId" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "score" REAL NOT NULL,
      "rationale" TEXT NOT NULL,
      "evidence" JSONB NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE TABLE "ChannelInsight" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT,
      "key" TEXT NOT NULL UNIQUE,
      "category" TEXT NOT NULL,
      "subject" TEXT NOT NULL,
      "statement" TEXT NOT NULL,
      "confidence" REAL NOT NULL,
      "classification" TEXT NOT NULL,
      "evidence" JSONB,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "PerformanceSignal" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT,
      "videoIdeaId" TEXT,
      "performanceSnapshotId" TEXT,
      "key" TEXT UNIQUE,
      "game" TEXT,
      "series" TEXT,
      "format" TEXT,
      "metric" TEXT NOT NULL,
      "value" REAL NOT NULL,
      "sampleSize" INTEGER NOT NULL DEFAULT 1,
      "source" TEXT NOT NULL,
      "classification" TEXT NOT NULL DEFAULT 'real',
      "confidence" REAL NOT NULL DEFAULT 1,
      "measuredAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  `;
  for (const statement of schemaSql.split(';').map((value) => value.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }

  conversations = new ConversationRepository(client);
  const messages = new MessageRepository(client);
  ideas = new VideoIdeaRepository(client);
  const opportunities = new ContentOpportunityRepository(client);
  const decisions = new ContentDecisionRepository(client);
  const insights = new ChannelInsightRepository(client);
  const signals = new PerformanceSignalRepository(client);
  const snapshots = new VideoPerformanceSnapshotRepository(client);
  providerCalls = [];
  const fakeProvider = {
    name: 'http-fake',
    async research(idea) {
      providerCalls.push(idea.id);
      return [{
        factor: 'gamePerformance',
        value: 82,
        classification: 'real',
        source: 'http-fake:history',
        summary: 'Historico controlado.',
        sampleSize: 4,
      }];
    },
  };
  creatorIntelligence = new CreatorIntelligenceService({
    ideaRepository: ideas,
    opportunityRepository: opportunities,
    decisionRepository: decisions,
    insightRepository: insights,
    performanceSignalRepository: signals,
    evaluationService: new IdeaEvaluationService(),
    researchProviders: [fakeProvider],
    snapshotRepository: snapshots,
    channelMemoryService: new ChannelMemoryService(insights, signals, snapshots),
  });
  const plannerService = new PlannerService(
    conversations,
    messages,
    undefined,
    creatorIntelligence,
  );

  const app = express();
  app.use(express.json());
  app.use('/api/operators', createOperatorsRouter(
    plannerService,
    undefined,
    undefined,
    creatorIntelligence,
  ));
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/operators`;
});

beforeEach(async () => {
  providerCalls.length = 0;
  await client.contentDecision.deleteMany();
  await client.contentOpportunity.deleteMany();
  await client.performanceSignal.deleteMany();
  await client.channelInsight.deleteMany();
  await client.videoIdea.deleteMany();
  await client.message.deleteMany();
  await client.conversation.deleteMany();
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await DatabaseService.disconnect();
});

describe('Creator Intelligence HTTP API', { concurrency: false }, () => {
  test('registers and lists persisted ideas', async () => {
    const created = await request('/creator-intelligence/ideas', { method: 'POST', body: validIdea() });
    const listed = await request('/creator-intelligence/ideas');

    assert.equal(created.status, 201);
    assert.equal(created.body.game, 'BeamNG.drive');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.map(({ id }) => id), [created.body.id]);
  });

  test('rejects arbitrary and invalid idea payloads with 400', async () => {
    assert.equal((await request('/creator-intelligence/ideas', {
      method: 'POST',
      body: { ...validIdea(), predictedViews: 1_000_000 },
    })).status, 400);
    assert.equal((await request('/creator-intelligence/ideas', {
      method: 'POST',
      body: validIdea({ estimatedEffort: 9 }),
    })).status, 400);
    assert.equal(await client.videoIdea.count(), 0);
  });

  test('evaluates an idea, calls research once and persists the decision', async () => {
    const idea = await ideas.create({ projectId: null, ...validIdea() });
    const response = await request(`/creator-intelligence/ideas/${idea.id}/evaluate`, { method: 'POST' });

    assert.equal(response.status, 200);
    assert.equal(response.body.idea.id, idea.id);
    assert.equal(response.body.decision.videoIdeaId, idea.id);
    assert.equal(response.body.evaluation.classification, 'recommendation');
    assert.deepEqual(providerCalls, [idea.id]);
    assert.equal(await client.contentDecision.count(), 1);
  });

  test('returns 404 for an unknown idea without calling research', async () => {
    const response = await request('/creator-intelligence/ideas/missing/evaluate', { method: 'POST' });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Video idea not found' });
    assert.deepEqual(providerCalls, []);
  });

  test('compares ideas with readable ranking and no views prediction', async () => {
    const first = await ideas.create({ projectId: null, ...validIdea({ novelty: 90 }) });
    const second = await ideas.create({ projectId: null, ...validIdea({ novelty: 20, identityFit: 30 }) });
    const response = await request('/creator-intelligence/ideas/compare', {
      method: 'POST', body: { ideaIds: [second.id, first.id] },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(({ rank }) => rank), [1, 2]);
    assert.ok(response.body.every(({ rankingRationale }) => rankingRationale.length > 0));
    assert.equal(JSON.stringify(response.body).includes('predictedViews'), false);
  });

  test('requires at least two unique ids for comparison', async () => {
    const response = await request('/creator-intelligence/ideas/compare', {
      method: 'POST', body: { ideaIds: ['same', 'same'] },
    });
    assert.equal(response.status, 400);
  });

  test('returns an empty, honest recommendation when no ideas exist', async () => {
    const response = await request('/creator-intelligence/recommendation');
    assert.equal(response.status, 200);
    assert.equal(response.body.recommendation, null);
    assert.deepEqual(response.body.ranking, []);
    assert.match(response.body.disclaimer, /Nenhuma previsão de views/i);
  });

  test('returns a bounded context object for future AI', async () => {
    await ideas.create({ projectId: null, ...validIdea() });
    const response = await request('/creator-intelligence/context');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.ideas));
    assert.ok(Array.isArray(response.body.relevantHistory));
    assert.ok(Array.isArray(response.body.previousDecisions));
    assert.ok(response.body.ideas.length <= 5);
  });

  test('Planner delegates editorial recommendation through the service boundary', async () => {
    const conversation = await conversations.create({ projectId: null, title: 'Planejamento', context: null });
    const idea = await ideas.create({ projectId: null, ...validIdea() });
    const response = await request(`/planner/conversations/${conversation.id}/editorial-recommendation`);

    assert.equal(response.status, 200);
    assert.equal(response.body.recommendation.ideaId, idea.id);
    assert.equal(response.body.classification, 'recommendation');
  });

  test('Planner recommendation returns 404 for a missing conversation', async () => {
    const response = await request('/planner/conversations/missing/editorial-recommendation');
    assert.equal(response.status, 404);
    assert.deepEqual(providerCalls, []);
  });

  test('Planner exposes channel learnings through its service boundary', async () => {
    const conversation = await conversations.create({ projectId: null, title: 'Memoria', context: null });
    await creatorIntelligence.ingestManualPerformance([{
      videoId: 'planner-performance',
      title: 'Vídeo real para o Planner',
      game: 'BeamNG.drive',
      format: 'desafio narrado',
      views: 1000,
      averageViewPercentage: 50,
      collectedAt: '2026-08-24T12:00:00.000Z',
    }]);
    const response = await request(`/planner/conversations/${conversation.id}/channel-learnings`);
    assert.equal(response.status, 200);
    assert.ok(response.body.some(({ category }) => category === 'performance_game'));
    assert.ok(response.body.every(({ evidence }) => evidence.derivedFrom === 'VideoPerformanceSnapshot'));
  });

  test('returns persisted decision evidence and 404 for an unknown decision', async () => {
    const idea = await ideas.create({ projectId: null, ...validIdea() });
    const evaluation = await request(`/creator-intelligence/ideas/${idea.id}/evaluate`, {
      method: 'POST', body: {},
    });
    const response = await request(`/creator-intelligence/decisions/${evaluation.body.decision.id}/evidence`);
    assert.equal(response.status, 200);
    assert.equal(response.body.videoIdeaId, idea.id);
    assert.ok(response.body.evidence.confidence > 0);
    assert.ok(Array.isArray(response.body.evidence.evidenceUsed));
    assert.equal((await request('/creator-intelligence/decisions/missing/evidence')).status, 404);
  });

  test('unexpected errors are sanitized in response and logs', async () => {
    const privateDetail = 'private SQL token and database path';
    const original = creatorIntelligence.listIdeas;
    const originalConsoleError = console.error;
    const logs = [];
    creatorIntelligence.listIdeas = async () => { throw new Error(privateDetail); };
    console.error = (...values) => logs.push(values);
    let response;
    try {
      response = await request('/creator-intelligence/ideas');
    } finally {
      creatorIntelligence.listIdeas = original;
      console.error = originalConsoleError;
    }

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: 'Creator intelligence operation failed' });
    assert.equal(JSON.stringify({ response, logs }).includes(privateDetail), false);
  });
});
