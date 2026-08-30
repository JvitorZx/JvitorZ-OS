const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, describe, test } = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');

require('./editorial-opportunity-ranking.test.cjs');
require('./editorial-opportunity-migration.test.cjs');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ConversationRepository } = require('../dist/database/repositories/ConversationRepository');
const { EditorialDecisionRepository } = require('../dist/database/repositories/EditorialDecisionRepository');
const { MessageRepository } = require('../dist/database/repositories/MessageRepository');
const { PerformanceSignalRepository } = require('../dist/database/repositories/PerformanceSignalRepository');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');
const { createCreatorIntelligenceRouter } = require('../dist/routes/creatorIntelligence');
const { PlannerService } = require('../dist/services/PlannerService');
const {
  classifyEditorialIntent,
  EditorialDecisionConversationNotFoundError,
  EditorialDecisionService,
  EditorialDecisionSnapshotNotFoundError,
  EditorialDecisionValidationError,
  isEditorialQuestion,
} = require('../dist/services/creator-intelligence/EditorialDecisionService');

const migrationSql = readFileSync(path.resolve(
  __dirname,
  '../prisma/migrations/20260825220000_editorial_decision_loop/migration.sql',
), 'utf8');
const opportunityMigrationSql = readFileSync(path.resolve(
  __dirname,
  '../prisma/migrations/20260902100000_editorial_opportunity_ranking/migration.sql',
), 'utf8');

let client;
let conversations;
let messages;
let decisions;
let snapshots;
let signals;
let intelligence;
let service;
let temporalTrends;
let temporalSeries;
let server;
let baseUrl;

const emptyBaseline = () => ({
  projectId: null,
  views: { average: null, median: null, sampleSize: 0 },
  watchTimeMinutes: { average: null, median: null, sampleSize: 0 },
  averageViewDurationSeconds: { average: null, median: null, sampleSize: 0 },
  averageViewPercentage: { average: null, median: null, sampleSize: 0 },
  subscribersGained: { average: null, median: null, sampleSize: 0 },
  subscribersPerThousandViews: { average: null, median: null, sampleSize: 0 },
  byFormat: {},
});

const ranking = (overrides = {}) => ({
  ideaId: 'idea-a', rank: 1, score: 82, category: 'GRAVAR', classification: 'recommendation',
  rationale: 'A ideia combina identidade e histórico disponível.', components: [],
  unknownFactors: [], confidence: 0.8, evidenceUsed: [], risks: ['Amostra limitada.'],
  missingData: ['esforço real'], rankingRationale: 'Melhor score relativo.', ...overrides,
});

const resetIntelligence = () => {
  temporalTrends = [];
  temporalSeries = [];
  intelligence = {
    context: {
      channelState: { insights: [] }, relevantHistory: [], ideas: [], opportunities: [],
      previousDecisions: [], creatorConstraints: [],
    },
    recommendation: { recommendation: ranking(), ranking: [ranking()], classification: 'recommendation', disclaimer: 'Sem previsão.' },
    baseline: { ...emptyBaseline(), views: { average: 900, median: 800, sampleSize: 4 } },
    performanceSignals: [],
    learnings: [],
    records: [],
    async buildContext() { return structuredClone(this.context); },
    async recommendEditorial() { return structuredClone(this.recommendation); },
    async rankIdeas(ids) { return ids.map((id, index) => ranking({ ideaId: id, rank: index + 1, score: 82 - index * 10 })); },
    async getPerformanceBaseline() { return structuredClone(this.baseline); },
    async listPerformanceSignals() { return structuredClone(this.performanceSignals); },
    async getChannelLearnings() { return structuredClone(this.learnings); },
    async listPerformanceRecords() { return structuredClone(this.records); },
  };
  service = new EditorialDecisionService(
    intelligence, decisions, conversations, snapshots, signals,
    { async run() { throw new Error('reach not configured in this fixture'); } },
    { async list() { return structuredClone(temporalTrends); } },
    { async list() { return structuredClone(temporalSeries); } },
  );
};

const createConversation = (overrides = {}) => conversations.create({
  projectId: null, title: 'Decisão editorial', context: null, ...overrides,
});

let snapshotSequence = 0;
const createSnapshot = (overrides = {}) => snapshots.upsert({
  projectId: null,
  ingestionKey: `snapshot-${++snapshotSequence}`,
  videoId: 'video-a', title: 'Vídeo real', game: 'BeamNG.drive', series: 'Desafios',
  format: 'narrado', publishedAt: new Date('2026-08-01T00:00:00.000Z'),
  periodStart: new Date('2026-08-01T00:00:00.000Z'), periodEnd: new Date('2026-08-07T00:00:00.000Z'),
  views: 1000, impressions: null, ctr: null, durationSeconds: 600,
  averageViewDurationSeconds: 300, averageViewPercentage: 50, watchTimeMinutes: 5000,
  subscribersGained: 12, subscribersLost: 2, likes: 100, comments: 20,
  source: 'youtube-analytics', confidence: 1, collectedAt: new Date('2026-08-24T12:00:00.000Z'),
  ...overrides,
}).then(({ snapshot }) => snapshot);

const request = async (route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  const baseSchema = `
    CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "Conversation" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "title" TEXT, "context" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "Message" (
      "id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "sender" TEXT NOT NULL,
      "text" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
    );
    CREATE TABLE "VideoPerformanceSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE,
      "videoId" TEXT NOT NULL, "title" TEXT NOT NULL, "game" TEXT, "series" TEXT, "format" TEXT,
      "publishedAt" DATETIME, "periodStart" DATETIME, "periodEnd" DATETIME, "views" REAL, "engagedViews" REAL,
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
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("performanceSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE CASCADE
    );
  `;
  for (const statement of baseSchema.split(';').map((part) => part.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
  for (const statement of migrationSql.split(';').map((part) => part.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
  for (const statement of opportunityMigrationSql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
  conversations = new ConversationRepository(client);
  messages = new MessageRepository(client);
  decisions = new EditorialDecisionRepository(client);
  snapshots = new VideoPerformanceSnapshotRepository(client);
  signals = new PerformanceSignalRepository(client);
  resetIntelligence();
  const youtube = { async getStatus() { return { state: 'connected', lastSyncAt: null, lastErrorType: null }; } };
  const app = express();
  app.use(express.json());
  app.use(createCreatorIntelligenceRouter(intelligence, youtube, service));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

beforeEach(async () => {
  await client.editorialDecision.deleteMany();
  await client.performanceSignal.deleteMany();
  await client.videoPerformanceSnapshot.deleteMany();
  await client.message.deleteMany();
  await client.conversation.deleteMany();
  resetIntelligence();
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await DatabaseService.disconnect();
});

describe('Editorial decision intent', () => {
  test('recognizes operational questions without treating general chat as editorial', () => {
    assert.equal(classifyEditorialIntent('O que vale gravar agora?'), 'next_content');
    assert.equal(classifyEditorialIntent('Qual dessas ideias é melhor?', 2), 'compare_ideas');
    assert.equal(classifyEditorialIntent('Por que esse vídeo foi fraco?'), 'diagnose_performance');
    assert.equal(classifyEditorialIntent('Vale continuar essa série?'), 'continue_series');
    assert.equal(classifyEditorialIntent('O que devo mudar no próximo vídeo?'), 'improve_next');
    assert.equal(isEditorialQuestion('Oi, tudo bem?'), false);
  });
});

describe('EditorialDecisionService', { concurrency: false }, () => {
  test('selects relevant temporal and series evidence without predicting views', async () => {
    temporalTrends = [{ id: 'trend-game', subject: 'BeamNG.drive', metric: 'views', classification: 'RISING',
      confidence: 0.82, sampleSize: 8, detectedAt: new Date('2026-08-27T00:00:00Z') }];
    temporalSeries = [{ series: { id: 'series-one', name: 'Desafios' }, health: {
      health: 'HEALTHY', trend: 'STABLE', sampleSize: 6, confidence: 0.75,
    } }];
    intelligence.context.ideas = [{ id: 'idea-a', game: 'BeamNG.drive', theme: 'Teste', format: 'narrado', premise: 'Premissa' }];
    const { decision } = await service.generate({ question: 'O que vale gravar agora?' });
    const evidence = Array.isArray(decision.evidence) ? decision.evidence : [];
    assert.ok(evidence.some(({ source }) => source === 'trend:trend-game'));
    assert.ok(evidence.some(({ source }) => source === 'series:series-one'));
    assert.doesNotMatch(JSON.stringify(decision), /previsão exata|vai ter \d+ views/i);
  });
  test('combines facts, inference, recommendation, risks and missing data', async () => {
    const snapshot = await createSnapshot();
    intelligence.records = [snapshot];
    intelligence.performanceSignals = [{
      id: 'signal-real', metric: 'retention_performance', value: 65,
      source: 'youtube-analytics:snapshot', confidence: 1, measuredAt: new Date(),
    }];
    intelligence.learnings = [{
      key: 'memory-format', statement: 'Formato narrado apresenta retenção consistente.',
      confidence: 0.75, updatedAt: new Date(),
    }];
    const result = await service.generate({ question: 'O que vale gravar agora?' });
    assert.equal(result.created, true);
    assert.equal(result.decision.intent, 'next_content');
    assert.equal(result.decision.classification, 'recommendation');
    assert.ok(result.decision.confidence > 0);
    assert.ok(result.decision.nextAction.length > 0);
    assert.deepEqual([...new Set(result.decision.evidence.map(({ classification }) => classification))].sort(), ['fact', 'inference', 'recommendation']);
    assert.ok(result.decision.risks.includes('Desempenho histórico não garante resultado futuro.'));
    assert.ok(result.decision.missingData.includes('esforço real'));
    assert.equal((await decisions.findById(result.decision.id)).question, 'O que vale gravar agora?');
  });

  test('uses persisted watch-time and subscriber signals in the opportunity score', async () => {
    intelligence.performanceSignals = [
      { id: 'watch-signal', metric: 'watch_time_performance', value: 74, source: 'youtube-analytics', confidence: 0.9, measuredAt: new Date() },
      { id: 'subscriber-signal', metric: 'subscriber_conversion', value: 66, source: 'youtube-analytics', confidence: 0.8, measuredAt: new Date() },
    ];
    const { decision } = await service.generate({ question: 'O que vale gravar agora?' });
    const components = decision.opportunityScore.components;
    assert.equal(components.find(({ id }) => id === 'WATCH_TIME').value, 74);
    assert.equal(components.find(({ id }) => id === 'SUBSCRIBER_GAIN').value, 66);
    assert.ok(components.find(({ id }) => id === 'WATCH_TIME').source.startsWith('performance-signal:'));
  });

  test('keeps partial and absent data explicit without predicting views', async () => {
    intelligence.recommendation = { recommendation: null, ranking: [], classification: 'recommendation', disclaimer: 'Sem dados.' };
    intelligence.baseline = emptyBaseline();
    const { decision } = await service.generate({ question: 'O que vale gravar agora?' });
    assert.equal(decision.score, null);
    assert.equal(decision.confidence, 0);
    assert.ok(decision.missingData.includes('baseline de performance'));
    assert.ok(decision.missingData.includes('ideias cadastradas'));
    assert.doesNotMatch(decision.recommendation, /vai ter|terá|views previstas/i);
  });

  test('ranks requested ideas and preserves alternatives', async () => {
    const { decision } = await service.generate({
      question: 'Qual dessas ideias é melhor?', ideaIds: ['idea-a', 'idea-b'],
    });
    assert.equal(decision.intent, 'compare_ideas');
    assert.equal(decision.score, 82);
    assert.equal(decision.alternatives[0].ideaId, 'idea-b');
  });

  test('keeps performance diagnosis focused on observed metrics when ideas also exist', async () => {
    const snapshot = await createSnapshot();
    intelligence.records = [snapshot];
    const { decision } = await service.generate({ question: 'Por que esse vídeo foi fraco?' });
    assert.equal(decision.intent, 'diagnose_performance');
    assert.match(decision.recommendation, /desempenho observado como diagnóstico/);
    assert.doesNotMatch(decision.recommendation, /melhor opção disponível/);
  });

  test('deduplicates identical evidence state, including concurrent requests', async () => {
    const [first, second] = await Promise.all([
      service.generate({ question: 'Vale continuar essa série?' }),
      service.generate({ question: 'Vale continuar essa série?' }),
    ]);
    assert.equal(first.decision.id, second.decision.id);
    assert.equal(await client.editorialDecision.count(), 1);
  });

  test('reuses prior editorial decisions from the same conversation without mixing scopes', async () => {
    const a = await createConversation();
    const b = await createConversation({ title: 'B' });
    await service.generate({ question: 'O que vale gravar agora?', conversationId: a.id });
    const second = await service.generate({ question: 'Vale continuar essa série?', conversationId: a.id });
    const isolated = await service.generate({ question: 'Vale continuar essa série?', conversationId: b.id });
    assert.ok(second.decision.evidence.some(({ source }) => source.startsWith('editorial-decision:')));
    assert.equal(isolated.decision.evidence.some(({ source }) => source.startsWith('editorial-decision:')), false);

    const repeated = await service.generate({ question: 'Vale continuar essa série?', conversationId: a.id });
    assert.equal(repeated.decision.id, second.decision.id);
  });

  test('validates conversation existence and keeps conversations isolated', async () => {
    await assert.rejects(
      service.generate({ question: 'O que vale gravar agora?', conversationId: 'missing' }),
      EditorialDecisionConversationNotFoundError,
    );
    const a = await createConversation();
    const b = await createConversation({ title: 'B' });
    await service.generate({ question: 'O que vale gravar agora?', conversationId: a.id });
    await service.generate({ question: 'O que devo mudar no próximo vídeo?', conversationId: b.id });
    assert.equal((await service.list({ conversationId: a.id })).length, 1);
    assert.equal((await service.list({ conversationId: b.id })).length, 1);
  });

  test('registers a future result against a real snapshot and derives cautious learning', async () => {
    const snapshot = await createSnapshot();
    await signals.create({
      projectId: null, videoIdeaId: null, performanceSnapshotId: snapshot.id,
      game: null, format: null, metric: 'retention_performance', value: 70,
      sampleSize: 1, source: 'youtube-analytics', classification: 'real', confidence: 1,
      measuredAt: new Date('2026-08-24T12:00:00.000Z'),
    });
    const { decision } = await service.generate({ question: 'O que vale gravar agora?' });
    const updated = await service.registerOutcome(decision.id, snapshot.id);
    assert.equal(updated.outcomeSnapshotId, snapshot.id);
    assert.equal(updated.outcome.assessment, 'supported');
    assert.match(updated.outcome.learning, /acima da referência interna/);
  });

  test('rejects missing or cross-project outcome snapshots safely', async () => {
    const { decision } = await service.generate({ question: 'O que vale gravar agora?' });
    await assert.rejects(service.registerOutcome(decision.id, 'missing'), EditorialDecisionSnapshotNotFoundError);
    await client.$executeRawUnsafe('INSERT INTO "Project" ("id") VALUES (\'project-b\')');
    const snapshot = await createSnapshot({ projectId: 'project-b' });
    await assert.rejects(service.registerOutcome(decision.id, snapshot.id), EditorialDecisionValidationError);
  });

  test('Planner automatically persists an operator decision reply without OpenAI', async () => {
    const conversation = await createConversation();
    await messages.create({ conversationId: conversation.id, sender: 'user', text: 'O que vale gravar agora?' });
    const planner = new PlannerService(conversations, messages, undefined, undefined, undefined, service);
    const reply = await planner.generateReply(conversation.id);
    assert.equal(reply.sender, 'operator');
    assert.equal(reply.editorialDecision.classification, 'recommendation');
    assert.match(reply.text, /Confiança:/);
    assert.match(reply.text, /(Fato|Inferência|Recomendação) principal:/);
    assert.equal((await conversations.findById(conversation.id)).messages.length, 2);
    assert.equal((await service.list({ conversationId: conversation.id })).length, 1);
  });

  test('Supervisor exposes recent priorities, risks, opportunities and actions', async () => {
    intelligence.recommendation.ranking.push(ranking({
      ideaId: 'idea-b', rank: 2, score: 72, rationale: 'Alternativa com formato conhecido.',
    }));
    await service.generate({ question: 'O que vale gravar agora?' });
    const supervisor = new SupervisorModule(
      { async getStatus() { return { state: 'connected', lastSyncAt: null, lastErrorType: null }; } },
      service,
    );
    const overview = await supervisor.getSupervisorOverview();
    assert.equal(overview.editorial.decisions.length, 1);
    assert.equal(overview.editorial.priorities.length, 1);
    assert.ok(overview.editorial.risks.length > 0);
    assert.deepEqual(overview.editorial.opportunities, ['Ideia idea-b: Alternativa com formato conhecido.']);
    assert.ok(overview.editorial.actions.length > 0);
  });

  test('Supervisor exposes non-idea candidate alternatives without rebuilding the ranking', async () => {
    await service.compareCandidates({ candidates: [
      { key: 'game-a', label: 'Game A', type: 'GAME' },
      { key: 'game-b', label: 'Game B', type: 'GAME' },
    ] });
    const supervisor = new SupervisorModule(
      { async getStatus() { return { state: 'connected', lastSyncAt: null, lastErrorType: null }; } },
      service,
    );
    const overview = await supervisor.getSupervisorOverview();
    assert.match(overview.editorial.opportunities[0], /^Game B:/);
    assert.equal(overview.editorial.insufficientData, 1);
  });
});

describe('Editorial decision HTTP API', { concurrency: false }, () => {
  test('creates, lists and opens a persisted decision with strict payload validation', async () => {
    const created = await request('/editorial-decisions', {
      method: 'POST', body: JSON.stringify({ question: 'O que vale gravar agora?' }),
    });
    assert.equal(created.status, 201);
    const repeated = await request('/editorial-decisions', {
      method: 'POST', body: JSON.stringify({ question: 'O que vale gravar agora?' }),
    });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.id, created.body.id);
    const listed = await request('/editorial-decisions?limit=5');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 1);
    const opened = await request(`/editorial-decisions/${created.body.id}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.question, created.body.question);
    const invalid = await request('/editorial-decisions', {
      method: 'POST', body: JSON.stringify({ question: 'Pergunta', arbitrary: 'content' }),
    });
    assert.equal(invalid.status, 400);
  });

  test('compares candidates and exposes current decision, evidence, opportunities and risks', async () => {
    const compared = await request('/editorial-decisions/compare', {
      method: 'POST',
      body: JSON.stringify({
        candidates: [
          { key: 'game-b', label: 'Game B', type: 'GAME', game: 'Game B' },
          { key: 'game-a', label: 'Game A', type: 'GAME', game: 'Game A' },
        ],
      }),
    });
    assert.equal(compared.status, 201);
    assert.equal(compared.body.candidateKey, 'game-a');
    assert.equal(compared.body.category, 'INSUFFICIENT_DATA');
    assert.equal(compared.body.alternatives[0].candidateKey, 'game-b');

    const current = await request('/editorial-decisions/current');
    assert.equal(current.status, 200);
    assert.equal(current.body.id, compared.body.id);

    const evidence = await request(`/editorial-decisions/${compared.body.id}/evidence`);
    assert.equal(evidence.status, 200);
    assert.equal(evidence.body.decisionId, compared.body.id);
    assert.ok(Array.isArray(evidence.body.risks));
    assert.ok(evidence.body.risks.every(({ summary }) => typeof summary === 'string'));

    const opportunities = await request('/editorial-opportunities');
    assert.equal(opportunities.status, 200);
    assert.deepEqual(opportunities.body, []);
    const risks = await request('/editorial-risks');
    assert.equal(risks.status, 200);
    assert.equal(risks.body.length, 1);
  });

  test('rejects malformed candidate comparisons and unknown decision-view filters', async () => {
    const invalidCandidate = await request('/editorial-decisions/compare', {
      method: 'POST',
      body: JSON.stringify({ candidates: [{ key: 'a', label: 'A', type: 'GAME', unknown: true }] }),
    });
    assert.equal(invalidCandidate.status, 400);
    assert.equal((await request('/editorial-decisions/current?limit=1')).status, 400);
    assert.equal((await request('/editorial-opportunities?unknown=true')).status, 400);
    assert.equal((await request('/editorial-risks?limit=0')).status, 400);
  });

  test('returns safe 404 statuses for missing future outcome resources', async () => {
    const created = await request('/editorial-decisions', {
      method: 'POST', body: JSON.stringify({ question: 'O que vale gravar agora?' }),
    });
    const missingSnapshot = await request(`/editorial-decisions/${created.body.id}/outcome`, {
      method: 'POST', body: JSON.stringify({ snapshotId: 'missing' }),
    });
    assert.equal(missingSnapshot.status, 404);
    assert.deepEqual(Object.keys(missingSnapshot.body), ['error']);
    const missingDecision = await request('/editorial-decisions/missing/outcome', {
      method: 'POST', body: JSON.stringify({ snapshotId: 'missing' }),
    });
    assert.equal(missingDecision.status, 404);
  });

  test('rejects unknown list filters and empty outcome ids before the service', async () => {
    const invalidFilter = await request('/editorial-decisions?unknown=value');
    assert.equal(invalidFilter.status, 400);
    const invalidOutcome = await request('/editorial-decisions/decision/outcome', {
      method: 'POST', body: JSON.stringify({ snapshotId: '   ' }),
    });
    assert.equal(invalidOutcome.status, 400);
  });
});

describe('Editorial decision migration', () => {
  test('is additive, preserves rows and enforces decision identity', () => {
    const database = new Database(':memory:');
    try {
      database.exec(`
        PRAGMA foreign_keys=ON;
        CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE "Conversation" ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE "Message" ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE "VideoPerformanceSnapshot" ("id" TEXT NOT NULL PRIMARY KEY);
        INSERT INTO "Conversation" ("id") VALUES ('conversation-existing');
        ${migrationSql}
        ${opportunityMigrationSql}
      `);
      assert.equal(database.prepare('SELECT COUNT(*) count FROM "Conversation"').get().count, 1);
      const insert = database.prepare(`
        INSERT INTO "EditorialDecision" (
          "id", "dedupeKey", "question", "intent", "recommendation", "alternatives",
          "confidence", "evidence", "risks", "missingData", "nextAction", "updatedAt"
        ) VALUES (?, 'key-a', 'Pergunta', 'next_content', 'Resposta', '[]', 0.5, '[]', '[]', '[]', 'Ação', CURRENT_TIMESTAMP)
      `);
      insert.run('decision-a');
      assert.throws(() => insert.run('decision-b'), /UNIQUE/);
    } finally {
      database.close();
    }
  });
});
