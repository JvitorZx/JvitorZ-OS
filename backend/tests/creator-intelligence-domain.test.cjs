const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ChannelInsightRepository } = require('../dist/database/repositories/ChannelInsightRepository');
const { ContentDecisionRepository } = require('../dist/database/repositories/ContentDecisionRepository');
const { ContentOpportunityRepository } = require('../dist/database/repositories/ContentOpportunityRepository');
const { PerformanceSignalRepository } = require('../dist/database/repositories/PerformanceSignalRepository');
const { VideoIdeaRepository } = require('../dist/database/repositories/VideoIdeaRepository');
const { ChannelMemoryService } = require('../dist/services/creator-intelligence/ChannelMemoryService');
const {
  CreatorIntelligenceService,
  CreatorIntelligenceValidationError,
  VideoIdeaNotFoundError,
} = require('../dist/services/creator-intelligence/CreatorIntelligenceService');
const { IdeaEvaluationService } = require('../dist/services/creator-intelligence/IdeaEvaluationService');
const {
  InternalHistoryResearchProvider,
} = require('../dist/services/creator-intelligence/InternalHistoryResearchProvider');

let client;
let ideas;
let opportunities;
let decisions;
let insights;
let signals;

const createIdea = (overrides = {}) => ideas.create({
  projectId: null,
  game: 'BeamNG.drive',
  theme: 'Desafios de simulacao',
  format: 'desafio narrado',
  premise: 'Testar se um carro popular sobrevive a uma estrada impossivel.',
  estimatedEffort: 2,
  novelty: 75,
  identityFit: 90,
  ...overrides,
});

const createSignal = (overrides = {}) => signals.create({
  projectId: null,
  videoIdeaId: null,
  game: 'BeamNG.drive',
  format: null,
  metric: 'game_performance',
  value: 80,
  sampleSize: 3,
  source: 'channel-history',
  classification: 'real',
  measuredAt: new Date('2026-08-01T12:00:00.000Z'),
  ...overrides,
});

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  const schemaSql = `
    CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
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
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
    CREATE TABLE "PerformanceSignal" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT,
      "videoIdeaId" TEXT,
      "game" TEXT,
      "format" TEXT,
      "metric" TEXT NOT NULL,
      "value" REAL NOT NULL,
      "sampleSize" INTEGER NOT NULL DEFAULT 1,
      "source" TEXT NOT NULL,
      "classification" TEXT NOT NULL DEFAULT 'real',
      "measuredAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
  `;
  for (const statement of schemaSql.split(';').map((value) => value.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }

  ideas = new VideoIdeaRepository(client);
  opportunities = new ContentOpportunityRepository(client);
  decisions = new ContentDecisionRepository(client);
  insights = new ChannelInsightRepository(client);
  signals = new PerformanceSignalRepository(client);
});

beforeEach(async () => {
  await client.contentDecision.deleteMany();
  await client.contentOpportunity.deleteMany();
  await client.performanceSignal.deleteMany();
  await client.channelInsight.deleteMany();
  await client.videoIdea.deleteMany();
});

after(async () => DatabaseService.disconnect());

describe('Creator Intelligence repositories', { concurrency: false }, () => {
  test('persists, lists and opens ideas without mutating input', async () => {
    const input = {
      projectId: null,
      game: 'BeamNG.drive',
      theme: 'Tema',
      format: 'Formato',
      premise: 'Premissa clara para um video.',
      estimatedEffort: 2,
      novelty: 60,
      identityFit: 80,
    };
    const snapshot = structuredClone(input);
    const created = await ideas.create(input);

    assert.deepEqual(input, snapshot);
    assert.equal((await ideas.findById(created.id)).premise, input.premise);
    assert.deepEqual((await ideas.findAll()).map(({ id }) => id), [created.id]);
  });

  test('uses deterministic newest-first idea ordering', async () => {
    const first = await createIdea({ theme: 'A' });
    const second = await createIdea({ theme: 'B' });
    await client.videoIdea.update({
      where: { id: first.id },
      data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    await client.videoIdea.update({
      where: { id: second.id },
      data: { createdAt: new Date('2026-01-02T00:00:00.000Z') },
    });
    assert.deepEqual((await ideas.findAll()).map(({ id }) => id), [second.id, first.id]);
  });

  test('persists opportunities and decisions linked to the correct idea', async () => {
    const idea = await createIdea();
    const opportunity = await opportunities.create({
      videoIdeaId: idea.id,
      source: 'internal',
      classification: 'inference',
      summary: 'Formato em crescimento no historico interno.',
      score: 70,
    });
    const decision = await decisions.create({
      videoIdeaId: idea.id,
      category: 'TESTAR',
      score: 68,
      rationale: 'Evidencia parcial.',
      evidence: { classification: 'recommendation' },
    });

    assert.equal((await opportunities.findByIdeaId(idea.id))[0].id, opportunity.id);
    assert.equal((await decisions.findByIdeaId(idea.id))[0].id, decision.id);
  });

  test('findRelevant returns only matching project, game, format or linked idea signals', async () => {
    const idea = await createIdea();
    const gameSignal = await createSignal();
    const formatSignal = await createSignal({
      game: null,
      format: idea.format,
      metric: 'format_performance',
    });
    const linkedSignal = await createSignal({
      game: null,
      videoIdeaId: idea.id,
      metric: 'similar_content_performance',
    });
    await createSignal({ game: 'Outro jogo' });

    const relevant = await signals.findRelevant({
      projectId: null,
      videoIdeaId: idea.id,
      game: idea.game,
      format: idea.format,
    });
    assert.deepEqual(
      new Set(relevant.map(({ id }) => id)),
      new Set([gameSignal.id, formatSignal.id, linkedSignal.id]),
    );
  });
});

describe('IdeaEvaluationService', { concurrency: false }, () => {
  const evaluator = new IdeaEvaluationService();

  test('scores real evidence and labels every component explicitly', async () => {
    const idea = await createIdea();
    const result = evaluator.evaluate(idea, [{
      factor: 'gamePerformance',
      value: 90,
      classification: 'real',
      source: 'internal:test',
      summary: 'Historico real do jogo.',
      sampleSize: 4,
    }]);

    assert.ok(result.score >= 0 && result.score <= 100);
    assert.equal(result.classification, 'recommendation');
    assert.equal(result.components.find(({ factor }) => factor === 'gamePerformance').classification, 'real');
    assert.ok(result.components.every(({ classification }) => [
      'real', 'inference', 'recommendation', 'unknown',
    ].includes(classification)));
    assert.match(result.rationale, /não prevê visualizações/i);
  });

  test('keeps absent historical data visibly unknown instead of inventing it', async () => {
    const idea = await createIdea({ game: null, novelty: null, identityFit: null, estimatedEffort: null });
    const result = evaluator.evaluate(idea, []);

    assert.ok(result.unknownFactors.includes('gamePerformance'));
    assert.ok(result.unknownFactors.includes('formatPerformance'));
    assert.ok(result.unknownFactors.includes('novelty'));
    assert.equal(result.components.find(({ factor }) => factor === 'gamePerformance').value, null);
  });

  test('weights evidence by sample size and clamps values safely', async () => {
    const idea = await createIdea();
    const result = evaluator.evaluate(idea, [
      { factor: 'gamePerformance', value: 0, classification: 'real', source: 'a', summary: 'A', sampleSize: 1 },
      { factor: 'gamePerformance', value: 200, classification: 'real', source: 'b', summary: 'B', sampleSize: 3 },
    ]);
    assert.equal(result.components.find(({ factor }) => factor === 'gamePerformance').value, 75);
  });

  test('ranks ideas deterministically and explains every position', async () => {
    const first = evaluator.evaluate(await createIdea({ novelty: 95, identityFit: 95, estimatedEffort: 1 }), []);
    const second = evaluator.evaluate(await createIdea({ novelty: 10, identityFit: 20, estimatedEffort: 5 }), []);
    const ranking = evaluator.rank([second, first]);

    assert.equal(ranking[0].ideaId, first.ideaId);
    assert.deepEqual(ranking.map(({ rank }) => rank), [1, 2]);
    assert.ok(ranking.every(({ rankingRationale }) => rankingRationale.length > 20));
  });

  test('uses only the documented GRAVAR, TESTAR, GUARDAR and DESCARTAR decisions', async () => {
    const variants = [
      await createIdea({ novelty: 100, identityFit: 100, estimatedEffort: 1 }),
      await createIdea({ novelty: 65, identityFit: 65, estimatedEffort: 3 }),
      await createIdea({ novelty: 30, identityFit: 30, estimatedEffort: 4 }),
      await createIdea({ premise: 'x', novelty: 0, identityFit: 0, estimatedEffort: 5 }),
    ];
    const categories = variants.map((idea) => evaluator.evaluate(idea, []).category);
    assert.ok(categories.every((category) => ['GRAVAR', 'TESTAR', 'GUARDAR', 'DESCARTAR'].includes(category)));
  });
});

describe('InternalHistoryResearchProvider and ChannelMemoryService', { concurrency: false }, () => {
  test('provider maps persisted history without network or provider-specific coupling', async () => {
    const idea = await createIdea();
    await createSignal();
    await createSignal({ game: null, format: idea.format, metric: 'format_performance', value: 72 });
    const provider = new InternalHistoryResearchProvider(signals);

    const evidence = await provider.research(idea);

    assert.deepEqual(new Set(evidence.map(({ factor }) => factor)), new Set([
      'gamePerformance', 'formatPerformance',
    ]));
    assert.ok(evidence.every(({ source }) => source.startsWith('internal-history:')));
  });

  test('memory refresh derives cautious learnings and updates them as new data arrives', async () => {
    await createSignal({ value: 80, sampleSize: 2 });
    const memory = new ChannelMemoryService(insights, signals);
    const first = await memory.refreshFromPerformance(null);
    const gameLearning = first.find(({ category }) => category === 'game');
    assert.match(gameLearning.statement, /sinal histórico/i);
    assert.equal(gameLearning.classification, 'inference');

    await createSignal({ value: 20, sampleSize: 2, measuredAt: new Date('2026-08-02T12:00:00Z') });
    await memory.refreshFromPerformance(null);
    const updated = (await memory.listMemory(null)).find(({ category }) => category === 'game');

    assert.equal(updated.id, gameLearning.id);
    assert.notEqual(updated.statement, gameLearning.statement);
    assert.equal(await client.channelInsight.count(), 1);
  });

  test('creator preferences are persisted as revisable memory, not fixed rules', async () => {
    const memory = new ChannelMemoryService(insights, signals);
    const first = await memory.recordLearning({
      category: 'creator_preference',
      subject: 'gravacao longa',
      statement: 'Prefere evitar gravações muito longas nesta fase.',
      confidence: 0.6,
      classification: 'inference',
    });
    const updated = await memory.recordLearning({
      category: 'creator_preference',
      subject: 'gravacao longa',
      statement: 'Aceita gravações longas quando o formato justifica.',
      confidence: 0.8,
      classification: 'inference',
    });
    assert.equal(updated.id, first.id);
    assert.match(updated.statement, /Aceita/);
  });
});

describe('CreatorIntelligenceService', { concurrency: false }, () => {
  const createService = (researchProviders = []) => new CreatorIntelligenceService({
    ideaRepository: ideas,
    opportunityRepository: opportunities,
    decisionRepository: decisions,
    insightRepository: insights,
    performanceSignalRepository: signals,
    evaluationService: new IdeaEvaluationService(),
    researchProviders,
    channelMemoryService: new ChannelMemoryService(insights, signals),
  });

  test('registers normalized game, theme, format and premise', async () => {
    const service = createService();
    const idea = await service.registerIdea({
      game: '  BeamNG.drive  ',
      theme: '  Simulacao  ',
      format: '  desafio  ',
      premise: '  Testar uma rota extrema com um carro popular.  ',
    });
    assert.equal(idea.game, 'BeamNG.drive');
    assert.equal(idea.theme, 'Simulacao');
    assert.equal(idea.format, 'desafio');
    assert.equal(idea.premise, 'Testar uma rota extrema com um carro popular.');
  });

  test('rejects invalid scores, effort and empty required fields', async () => {
    const service = createService();
    await assert.rejects(
      service.registerIdea({ theme: '', format: 'video', premise: 'p' }),
      CreatorIntelligenceValidationError,
    );
    await assert.rejects(
      service.registerIdea({ theme: 't', format: 'f', premise: 'p', estimatedEffort: 7 }),
      CreatorIntelligenceValidationError,
    );
    await assert.rejects(
      service.registerIdea({ theme: 't', format: 'f', premise: 'p', novelty: 101 }),
      CreatorIntelligenceValidationError,
    );
  });

  test('evaluates through every injected provider and persists a recommendation decision', async () => {
    const calls = [];
    const fakeProvider = {
      name: 'fake',
      async research(idea) {
        calls.push(idea.id);
        return [{
          factor: 'gamePerformance', value: 88, classification: 'real',
          source: 'fake:history', summary: 'Historico fake.', sampleSize: 5,
        }];
      },
    };
    const service = createService([fakeProvider]);
    const idea = await createIdea();

    const result = await service.evaluateIdea(idea.id);

    assert.deepEqual(calls, [idea.id]);
    assert.equal(result.decision.videoIdeaId, idea.id);
    assert.equal(result.decision.category, result.evaluation.category);
    assert.equal((await decisions.findByIdeaId(idea.id)).length, 1);
  });

  test('rejects a missing idea before calling research providers', async () => {
    let called = false;
    const service = createService([{ name: 'fake', async research() { called = true; return []; } }]);
    await assert.rejects(service.evaluateIdea('missing'), VideoIdeaNotFoundError);
    assert.equal(called, false);
  });

  test('compares several ideas and returns a stable ranking with readable reasons', async () => {
    const service = createService();
    const strong = await createIdea({ novelty: 95, identityFit: 95, estimatedEffort: 1 });
    const weak = await createIdea({ novelty: 10, identityFit: 10, estimatedEffort: 5, premise: 'x' });
    const ranking = await service.compareIdeas([weak.id, strong.id]);

    assert.equal(ranking[0].ideaId, strong.id);
    assert.ok(ranking.every(({ rankingRationale }) => rankingRationale.length > 0));
    assert.equal(await client.contentDecision.count(), 2);
  });

  test('returns a recommendation without persisting fake predictions', async () => {
    const service = createService();
    const idea = await createIdea();
    const result = await service.recommendEditorial(null);

    assert.equal(result.recommendation.ideaId, idea.id);
    assert.match(result.disclaimer, /não é previsão de views/i);
    assert.equal('predictedViews' in result.recommendation, false);
    assert.equal(await client.contentDecision.count(), 0);
  });

  test('builds bounded future-AI context from relevant data only', async () => {
    const service = createService();
    const idea = await createIdea();
    await service.registerOpportunity({
      videoIdeaId: idea.id,
      source: 'internal',
      classification: 'inference',
      summary: 'Oportunidade persistida.',
    });
    await service.evaluateIdea(idea.id);
    const memory = new ChannelMemoryService(insights, signals);
    await memory.recordLearning({
      category: 'creator_preference',
      subject: 'duracao',
      statement: 'Prefere vídeos objetivos.',
      confidence: 0.7,
      classification: 'inference',
    });

    const context = await service.buildContext(null);

    assert.deepEqual(context.ideas.map(({ id }) => id), [idea.id]);
    assert.equal(context.opportunities.length, 1);
    assert.equal(context.previousDecisions.length, 1);
    assert.deepEqual(context.creatorConstraints, ['Prefere vídeos objetivos.']);
    assert.ok(context.ideas.length <= 5);
    assert.ok(context.relevantHistory.length <= 12);
  });
});
