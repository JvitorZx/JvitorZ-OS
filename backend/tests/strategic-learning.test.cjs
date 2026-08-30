const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DATABASE_URL = ':memory:';
const { DatabaseService } = require('../dist/database/DatabaseService');
const { StrategicLearningRepository } = require('../dist/database/repositories/StrategicLearningRepository');
const { StrategicLearningService } = require('../dist/services/strategic-learning');
const { analyzeStrategicLearning } = require('../dist/domains/strategic-learning');
const { createPlanningRouter } = require('../dist/routes/planning');
const { PlannerService } = require('../dist/services/PlannerService');

const runMigration = async (client, name) => {
  const sql = fs.readFileSync(path.resolve(__dirname, `../prisma/migrations/${name}/migration.sql`), 'utf8');
  for (const statement of sql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
};
const observation = (id, classification = 'ABOVE_REFERENCE', overrides = {}) => ({
  outcomeId: id, videoId: id, observedAt: new Date('2026-09-07T10:00:00.000Z'), confidence: 0.8,
  freshness: 'RECENT', classification, dimension: 'FORMAT', subject: 'LONG_FORM',
  comparisonContext: { format: 'LONG_FORM', windowHours: 168, publicationAgeDays: 8, strategy: 'median' }, benchmark: { comparableVideos: 3 }, ...overrides,
});

describe('strategic learning memory', { concurrency: false }, () => {
  let client; let repository; let service; let server; let baseUrl; let sequence = 0;
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
    await runMigration(client, '20260904120000_strategic_content_planning');
    await runMigration(client, '20260905100000_planning_execution_guidance');
    await runMigration(client, '20260906120000_strategic_planning_outcomes');
    await runMigration(client, '20260907120000_strategic_learning_memory');
    repository = new StrategicLearningRepository(client);
    service = new StrategicLearningService(repository, () => new Date('2026-09-07T12:00:00.000Z'));
    const app = express(); app.use(express.json()); app.use(createPlanningRouter({}, {}, service));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });

  const seedOutcome = async (classification, overrides = {}) => {
    const n = ++sequence; const planId = `plan-${n}`; const itemId = `item-${n}`; const executionId = `execution-${n}`;
    const snapshotId = `snapshot-${n}`; const linkId = `link-${n}`; const outcomeId = `outcome-${n}`; const videoId = `video-${n}`;
    await client.contentPlan.create({ data: { id: planId, horizon: 'TODAY', status: 'READY', summary: 'Plan', balance: {}, constraints: [], risks: [], source: {}, generatedAt: new Date() } });
    await client.plannedContentItem.create({ data: { id: itemId, planId, candidateKey: itemId, candidateType: overrides.candidateType || 'TOPIC', title: `Item ${n}`, rationale: 'Reason', status: 'COMPLETED', priority: overrides.priority || 'HIGH', effort: 'MEDIUM', readiness: 'READY', queue: 'DONE', position: 1, executionScore: 80, manualPriority: false, evidence: [], risks: [], constraints: [], missingData: [], dependencies: [], executionState: 'completed', executionAction: 'Done', executionContext: {} } });
    await client.planningExecutionEvent.create({ data: { id: executionId, planId, itemId, event: 'EXECUTION_COMPLETED', state: 'completed', itemTitle: `Item ${n}`, action: 'Done', strategicContext: {} } });
    await client.videoPerformanceSnapshot.create({ data: { id: snapshotId, ingestionKey: snapshotId, videoId, title: `Video ${n}`, game: overrides.game || 'BeamNG', series: overrides.series || 'Career', format: overrides.format || 'LONG_FORM', publishedAt: new Date('2026-08-30T00:00:00.000Z'), periodStart: new Date('2026-08-30T00:00:00.000Z'), periodEnd: new Date('2026-09-06T00:00:00.000Z'), views: 100, impressions: 500, ctr: .05, source: 'test', confidence: .9, collectedAt: overrides.observedAt || new Date('2026-09-07T10:00:00.000Z') } });
    await client.planningOutcomeLink.create({ data: { id: linkId, planId, itemId, executionEventId: executionId, sourceSnapshotId: snapshotId, videoId, videoTitle: `Video ${n}`, activeItemKey: itemId, activeVideoKey: videoId } });
    await client.planningOutcome.create({ data: { id: outcomeId, planId, itemId, executionEventId: executionId, linkId, snapshotId, videoId,
      observedAt: overrides.observedAt || new Date('2026-09-07T10:00:00.000Z'), windowStart: new Date('2026-08-30T00:00:00.000Z'), windowEnd: new Date('2026-09-06T00:00:00.000Z'), freshness: overrides.freshness || 'RECENT', dataQuality: 'HIGH', metrics: { views: 100 },
      benchmark: { strategy: 'median_of_same_format_window_and_publication_age', format: overrides.format || 'LONG_FORM', windowHours: 168, publicationAgeDays: 7, comparableVideos: 3 }, comparison: [], evidence: [], classification, confidence: .8, limitations: ['No causality'], missingData: [] } });
    return { outcomeId, itemId, planId, videoId };
  };
  const request = async (route, options = {}) => { const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json' } }); return { status: response.status, body: await response.json() }; };

  test('single observation is weak and never claims causality', () => {
    const result = analyzeStrategicLearning(null, [observation('one')], new Date('2026-09-07T12:00:00.000Z'));
    assert.equal(result.status, 'WEAK'); assert.equal(result.observationCount, 1); assert.match(result.description, /1 videos comparaveis/);
    assert.match(JSON.stringify(result.limitations), /nao demonstra causalidade/i);
  });
  test('repeated comparable evidence progresses from emerging to supported', () => {
    const emerging = analyzeStrategicLearning(null, [observation('a'), observation('b')]);
    const supported = analyzeStrategicLearning(null, [observation('a'), observation('b'), observation('c'), observation('d')]);
    assert.equal(emerging.status, 'EMERGING'); assert.equal(supported.status, 'SUPPORTED'); assert.ok(supported.confidence > emerging.confidence);
  });
  test('contradictory and stale evidence remain explicit', () => {
    const contradicted = analyzeStrategicLearning(null, [observation('a'), observation('b'), observation('c', 'BELOW_REFERENCE'), observation('d', 'BELOW_REFERENCE')]);
    const stale = analyzeStrategicLearning(null, [observation('old', 'ABOVE_REFERENCE', { observedAt: new Date('2026-08-01T00:00:00.000Z') })], new Date('2026-09-07T12:00:00.000Z'));
    assert.equal(contradicted.status, 'CONTRADICTED'); assert.equal(contradicted.direction, 'MIXED'); assert.equal(stale.status, 'STALE');
  });
  test('refresh reports insufficient data honestly', async () => {
    const result = await service.refresh('empty-project'); assert.equal(result.insufficientData, true); assert.equal(result.learnings.length, 0);
  });
  test('refresh persists traceable learnings and is idempotent without artificial history', async () => {
    const source = await seedOutcome('ABOVE_REFERENCE'); const first = await service.refresh();
    assert.ok(first.created > 0); const learning = (await service.related('outcomeId', source.outcomeId))[0];
    assert.ok(learning); const detail = await service.get(learning.id); assert.equal(detail.evidence[0].outcome.id, source.outcomeId);
    const revisions = await service.history(learning.id); const repeated = await service.refresh();
    assert.ok(repeated.unchanged > 0); assert.equal((await service.history(learning.id)).length, revisions.length);
  });
  test('new evidence updates counts and preserves a material revision', async () => {
    const before = (await service.list({ dimension: 'FORMAT' })).find(({ subject }) => subject === 'LONG_FORM');
    await seedOutcome('ABOVE_REFERENCE'); await service.refresh(); const after = await service.get(before.id);
    assert.ok(after.observationCount > before.observationCount); assert.ok(after.revisions.length >= 2);
  });
  test('concurrent reevaluation is serialized and does not duplicate learnings or evidence', async () => {
    await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
    const list = await service.list(); assert.equal(new Set(list.map(({ key }) => key)).size, list.length);
    const learning = await service.get(list[0].id); assert.equal(new Set(learning.evidence.map(({ outcomeId }) => outcomeId)).size, learning.evidence.length);
  });
  test('HTTP contracts list, open, trace, refresh and validate safely', async () => {
    const list = await request('/learnings'); assert.equal(list.status, 200); const learning = list.body[0];
    assert.equal((await request(`/learnings/${learning.id}`)).status, 200);
    assert.equal((await request(`/learnings/${learning.id}/evidence`)).status, 200);
    assert.equal((await request(`/learnings/${learning.id}/history`)).status, 200);
    assert.equal((await request('/learnings/refresh', { method: 'POST', body: '{}' })).status, 200);
    assert.equal((await request('/learnings?status=FAKE')).status, 400);
    assert.equal((await request('/learnings/missing')).status, 404);
  });
  test('Planner-facing memory is bounded and read-only', async () => {
    const context = await service.listForPlanner(null, 2); assert.ok(context.length <= 2);
    assert.ok(context.every((entry) => !('executionScore' in entry) && !('priority' in entry)));
  });
  test('Planner injects bounded strategic memory as read-only observational context', async () => {
    let received; const created = [];
    const planner = new PlannerService(
      { findById: async () => ({ id: 'conversation', projectId: null, context: null, messages: [{ id: 'user', sender: 'user', text: 'Resuma meu contexto', createdAt: new Date('2026-09-07T10:00:00.000Z') }] }) },
      { create: async (data) => { created.push(data); return { id: 'reply', ...data }; } },
      { generate: async (input) => { received = input; return 'Resposta segura'; } },
      undefined, undefined, undefined, undefined, undefined,
      { listForPlanner: async () => [{ id: 'learning', dimension: 'FORMAT', subject: 'LONG_FORM', description: 'Tres resultados ficaram acima da referencia.', status: 'EMERGING', confidence: .6, freshness: 'RECENT', limitations: [] }] },
    );
    await planner.generateReply('conversation');
    assert.equal(created.length, 1); const memory = received.messages.find(({ role }) => role === 'system');
    assert.ok(memory); assert.match(memory.content, /nao trate correlacao como causalidade/i);
  });
});
