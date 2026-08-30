const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DATABASE_URL = ':memory:';
const { DatabaseService } = require('../dist/database/DatabaseService');
const { ExperimentRepository } = require('../dist/database/repositories/ExperimentRepository');
const { ExperimentObservationRepository } = require('../dist/database/repositories/ExperimentObservationRepository');
const { ExperimentationService } = require('../dist/services/strategic-experimentation');
const { analyzeStrategicExperiment } = require('../dist/domains/strategic-experimentation');
const { createPlanningRouter } = require('../dist/routes/planning');
const { PlannerService } = require('../dist/services/PlannerService');
const { classifyManagerIntent } = require('../dist/services/orchestration/ManagerIntentInterpreter');
const { isEditorialQuestion } = require('../dist/services/creator-intelligence/EditorialDecisionService');

const runMigration = async (client, name) => {
  const sql = fs.readFileSync(path.resolve(__dirname, `../prisma/migrations/${name}/migration.sql`), 'utf8');
  for (const statement of sql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
};
const baseObservation = (id, variantKey, value, overrides = {}) => ({ id, variantKey, outcomeId: `outcome-${id}`, videoId: `video-${id}`,
  observedAt: new Date('2026-09-08T10:00:00Z'), freshness: 'RECENT', dataQuality: 'HIGH', outcomeConfidence: .8,
  comparisonContext: { format: 'LONG_FORM', windowHours: 168, publicationAgeDays: 7, strategy: 'median' }, metrics: { ctr: value }, ...overrides });
const analysisInput = (observations) => ({ experimentId: 'experiment', hypothesis: 'Direct hook has stronger observed CTR', expectedVariantKey: 'A',
  primaryMetric: 'ctr', direction: 'HIGHER_BETTER', variants: [{ key: 'A', label: 'Direct' }, { key: 'B', label: 'Contextual' }], observations });

describe('strategic experimentation', { concurrency: false }, () => {
  let client; let service; let server; let baseUrl; let sequence = 0; let refreshes = 0;
  before(async () => {
    client = await DatabaseService.connect(); await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    for (const table of ['Project', 'EditorialDecision', 'ResearchHistory', 'ResearchOpportunity', 'SeriesDefinition']) await client.$executeRawUnsafe(`CREATE TABLE "${table}" ("id" TEXT NOT NULL PRIMARY KEY)`);
    await client.$executeRawUnsafe(`CREATE TABLE "VideoPerformanceSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE, "videoId" TEXT NOT NULL,
      "title" TEXT NOT NULL, "game" TEXT, "series" TEXT, "format" TEXT, "publishedAt" DATETIME, "periodStart" DATETIME,
      "periodEnd" DATETIME, "views" REAL, "engagedViews" REAL, "impressions" REAL, "ctr" REAL, "durationSeconds" REAL,
      "averageViewDurationSeconds" REAL, "averageViewPercentage" REAL, "watchTimeMinutes" REAL, "subscribersGained" INTEGER,
      "subscribersLost" INTEGER, "likes" INTEGER, "comments" INTEGER, "source" TEXT NOT NULL, "confidence" REAL NOT NULL DEFAULT 1,
      "collectedAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "VideoPerformanceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE)`);
    for (const migration of ['20260904120000_strategic_content_planning', '20260905100000_planning_execution_guidance',
      '20260906120000_strategic_planning_outcomes', '20260907120000_strategic_learning_memory', '20260908120000_strategic_experimentation']) await runMigration(client, migration);
    service = new ExperimentationService(new ExperimentRepository(client), new ExperimentObservationRepository(client),
      { refresh: async () => { refreshes += 1; return {}; }, related: async () => [] }, () => new Date('2026-09-08T12:00:00Z'));
    const app = express(); app.use(express.json()); app.use(createPlanningRouter({}, {}, {}, service));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });

  const create = (overrides = {}) => service.create({ title: 'Hook experiment', hypothesis: 'Direct hook is associated with stronger CTR',
    expectedVariantKey: 'A', primaryMetric: 'ctr', metricDirection: 'HIGHER_BETTER', variants: [{ key: 'A', label: 'Direct' }, { key: 'B', label: 'Contextual' }], ...overrides });
  const seedOutcome = async (ctr, overrides = {}) => {
    const n = ++sequence; const planId = `plan-${n}`; const itemId = `item-${n}`; const executionId = `execution-${n}`;
    const snapshotId = `snapshot-${n}`; const linkId = `link-${n}`; const outcomeId = `outcome-${n}`; const videoId = `video-${n}`;
    await client.contentPlan.create({ data: { id: planId, horizon: 'TODAY', status: 'READY', summary: 'Plan', balance: {}, constraints: [], risks: [], source: {}, generatedAt: new Date() } });
    await client.plannedContentItem.create({ data: { id: itemId, planId, candidateKey: itemId, candidateType: 'TOPIC', title: `Item ${n}`, rationale: 'Reason', status: 'COMPLETED', priority: 'HIGH', effort: 'MEDIUM', readiness: 'READY', queue: 'DONE', position: 1, executionScore: 80, evidence: [], risks: [], constraints: [], missingData: [], dependencies: [], executionState: 'completed', executionAction: 'Done', executionContext: {} } });
    await client.planningExecutionEvent.create({ data: { id: executionId, planId, itemId, event: 'EXECUTION_COMPLETED', state: 'completed', itemTitle: `Item ${n}`, action: 'Done', strategicContext: {} } });
    await client.videoPerformanceSnapshot.create({ data: { id: snapshotId, ingestionKey: snapshotId, videoId, title: `Video ${n}`, format: overrides.format || 'LONG_FORM', publishedAt: new Date('2026-09-01T00:00:00Z'), periodStart: new Date('2026-09-01T00:00:00Z'), periodEnd: new Date('2026-09-08T00:00:00Z'), views: 100, impressions: 1000, ctr, source: 'test', confidence: .9, collectedAt: new Date('2026-09-08T10:00:00Z') } });
    await client.planningOutcomeLink.create({ data: { id: linkId, planId, itemId, executionEventId: executionId, sourceSnapshotId: snapshotId, videoId, videoTitle: `Video ${n}`, activeItemKey: itemId, activeVideoKey: videoId } });
    await client.planningOutcome.create({ data: { id: outcomeId, planId, itemId, executionEventId: executionId, linkId, snapshotId, videoId, observedAt: new Date('2026-09-08T10:00:00Z'), freshness: overrides.freshness || 'RECENT', dataQuality: overrides.dataQuality || 'HIGH', metrics: { ctr }, benchmark: { format: overrides.format || 'LONG_FORM', windowHours: 168, publicationAgeDays: 7, strategy: 'median' }, comparison: [], evidence: [], classification: 'WITHIN_REFERENCE', confidence: .8, limitations: [], missingData: [] } });
    return outcomeId;
  };
  const request = async (route, options = {}) => { const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json' } }); return { status: response.status, body: await response.json() }; };

  test('analysis requires comparable samples and never claims causality', () => {
    const result = analyzeStrategicExperiment(analysisInput([baseObservation('a', 'A', .08), baseObservation('b', 'B', .05)]));
    assert.equal(result.classification, 'INSUFFICIENT_EVIDENCE'); assert.match(JSON.stringify(result.limitations), /causalidade/i);
  });
  test('same complete data deterministically supports the hypothesis', () => {
    const rows = [baseObservation('a1', 'A', .08), baseObservation('a2', 'A', .07), baseObservation('b1', 'B', .05), baseObservation('b2', 'B', .05)];
    const first = analyzeStrategicExperiment(analysisInput(rows)); const second = analyzeStrategicExperiment(analysisInput([...rows].reverse()));
    assert.equal(first.classification, 'SUPPORTS_HYPOTHESIS'); assert.equal(first.analysisFingerprint, second.analysisFingerprint); assert.doesNotMatch(first.summary, /causou/i);
  });
  test('contrary, mixed, stale and incompatible data remain explicit', () => {
    const contrary = analyzeStrategicExperiment(analysisInput([baseObservation('a1', 'A', .04), baseObservation('a2', 'A', .04), baseObservation('b1', 'B', .08), baseObservation('b2', 'B', .08)]));
    const mixed = analyzeStrategicExperiment(analysisInput([baseObservation('a1', 'A', .051), baseObservation('a2', 'A', .05), baseObservation('b1', 'B', .05), baseObservation('b2', 'B', .05)]));
    const stale = analyzeStrategicExperiment(analysisInput([baseObservation('a1', 'A', .08, { freshness: 'STALE' }), baseObservation('a2', 'A', .08), baseObservation('b1', 'B', .05), baseObservation('b2', 'B', .05)]));
    const incompatible = analyzeStrategicExperiment(analysisInput([baseObservation('a1', 'A', .08), baseObservation('a2', 'A', .08), baseObservation('b1', 'B', .05, { comparisonContext: { format: 'SHORT' } }), baseObservation('b2', 'B', .05, { comparisonContext: { format: 'SHORT' } })]));
    assert.equal(contrary.classification, 'CONTRADICTS_HYPOTHESIS'); assert.equal(mixed.classification, 'MIXED_EVIDENCE');
    assert.equal(stale.classification, 'INSUFFICIENT_EVIDENCE'); assert.equal(incompatible.classification, 'INSUFFICIENT_EVIDENCE');
  });
  test('service creates variants, starts and rejects unsupported metrics', async () => {
    const experiment = await create(); assert.equal(experiment.variants.length, 2); assert.equal((await service.start(experiment.id)).status, 'RUNNING');
    await assert.rejects(() => create({ primaryMetric: 'invented' }), /unsupported/);
  });
  test('observations are idempotent and concurrent calls cannot duplicate an outcome', async () => {
    const experiment = await create(); const running = await service.start(experiment.id); const outcomeId = await seedOutcome(.08);
    const calls = await Promise.all([service.addObservation(experiment.id, running.variants[0].id, outcomeId), service.addObservation(experiment.id, running.variants[0].id, outcomeId)]);
    assert.equal(calls.filter(({ created }) => created).length, 1); assert.equal((await service.get(experiment.id)).observations.length, 1);
  });
  test('four comparable outcomes persist one deterministic result and audit history', async () => {
    const experiment = await create(); const running = await service.start(experiment.id);
    for (const [variant, ctr] of [[0, .08], [0, .07], [1, .05], [1, .05]]) await service.addObservation(experiment.id, running.variants[variant].id, await seedOutcome(ctr));
    const first = await service.analyze(experiment.id); const historySize = (await service.history(experiment.id)).length; const repeated = await service.analyze(experiment.id);
    assert.equal(first.analysis.classification, 'SUPPORTS_HYPOTHESIS'); assert.equal(first.experiment.status, 'COMPLETED'); assert.equal(refreshes, 1);
    assert.equal(repeated.changed, false); assert.equal((await service.history(experiment.id)).length, historySize); assert.equal((await service.evidence(experiment.id)).length, 4);
  });
  test('HTTP contracts validate, create, start, observe, analyze and expose audit safely', async () => {
    const created = await request('/experiments', { method: 'POST', body: JSON.stringify({ title: 'API experiment', hypothesis: 'A is observed above B', expectedVariantKey: 'A', primaryMetric: 'views', variants: [{ key: 'A', label: 'A' }, { key: 'B', label: 'B' }] }) });
    assert.equal(created.status, 201); assert.equal((await request('/experiments')).status, 200);
    assert.equal((await request(`/experiments/${created.body.id}/start`, { method: 'POST', body: '{}' })).status, 200);
    assert.equal((await request(`/experiments/${created.body.id}/history`)).status, 200); assert.equal((await request(`/experiments/${created.body.id}/evidence`)).status, 200);
    assert.equal((await request('/experiments', { method: 'POST', body: '{"extra":true}' })).status, 400);
    assert.equal((await request('/experiments/missing')).status, 404);
  });
  test('operational summary exposes waiting and low-confidence experiment state', async () => {
    const summary = await service.getOperationalSummary(); assert.ok(summary.total >= 1); assert.ok('waitingForData' in summary); assert.ok('contradicted' in summary);
  });
  test('Gerente recognizes experiment questions without changing planning intent', () => {
    assert.equal(classifyManagerIntent('o que estamos testando?'), 'EXPERIMENT_STATUS');
    assert.equal(isEditorialQuestion('o que estamos testando?'), true);
    assert.equal(classifyManagerIntent('o que eu gravo hoje?'), 'CONTENT_PLANNING');
  });
  test('Planner injects bounded experiment context as read-only language context', async () => {
    let input; const planner = new PlannerService(
      { findById: async () => ({ id: 'conversation', projectId: null, context: null, messages: [{ id: 'user', sender: 'user', text: 'Resuma o contexto', createdAt: new Date() }] }) },
      { create: async (data) => ({ id: 'reply', ...data }) }, { generate: async (value) => { input = value; return 'Resposta'; } },
      undefined, undefined, undefined, undefined, undefined, undefined,
      { listForPlanner: async () => [{ id: 'experiment', title: 'Hook test', status: 'RUNNING', hypothesis: 'Hook direto', primaryMetric: 'ctr', result: null, confidence: 0 }] },
    );
    await planner.generateReply('conversation'); const context = input.messages.find(({ role, content }) => role === 'system' && /Experimentos estrategicos/.test(content));
    assert.ok(context); assert.match(context.content, /nao altere ranking/i); assert.doesNotMatch(context.content, /causou/i);
  });
});
