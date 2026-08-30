const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ContentPlanRepository } = require('../dist/database/repositories/ContentPlanRepository');
const { PlannedContentItemRepository } = require('../dist/database/repositories/PlannedContentItemRepository');
const { PlanningHistoryRepository } = require('../dist/database/repositories/PlanningHistoryRepository');
const { PlanningExecutionRepository } = require('../dist/database/repositories/PlanningExecutionRepository');
const { StrategicPlanningRanker } = require('../dist/domains/strategic-planning/StrategicPlanningRanker');
const { createExecutionGuidance } = require('../dist/domains/strategic-planning/ExecutionGuidance');
const {
  StrategicPlanningService,
  PlanningExecutionConflictError,
} = require('../dist/services/strategic-planning');
const { createPlanningRouter } = require('../dist/routes/planning');

const runMigration = async (client, migration) => {
  const sql = fs.readFileSync(path.resolve(__dirname, `../prisma/migrations/${migration}/migration.sql`), 'utf8');
  for (const statement of sql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
};

const candidate = (overrides = {}) => ({
  key: 'candidate', title: 'Conteudo principal', candidateType: 'TOPIC', confidence: 0.82,
  opportunityScore: 76, freshness: 'RECENT', effort: 'MEDIUM', repetitionKey: 'topic:principal',
  evidence: [{ classification: 'fact', source: 'internal', summary: 'Evidencia persistida.', confidence: 0.82, freshness: 'RECENT' }],
  risks: [], constraints: [], missingData: [], dependencies: [], rationale: 'Melhor relacao entre evidencia e esforco.',
  readiness: 'READY', priority: 'HIGH', queue: 'NEXT', rank: 1, executionScore: 80, urgent: false, experimental: false,
  ...overrides,
});

describe('strategic plan execution guidance and lifecycle', { concurrency: false }, () => {
  let client; let service; let server; let baseUrl; let sequence = 0;

  before(async () => {
    client = await DatabaseService.connect();
    await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    for (const table of ['Project', 'EditorialDecision', 'ResearchHistory', 'ResearchOpportunity', 'SeriesDefinition']) {
      await client.$executeRawUnsafe(`CREATE TABLE "${table}" ("id" TEXT NOT NULL PRIMARY KEY)`);
    }
    await runMigration(client, '20260904120000_strategic_content_planning');
    await runMigration(client, '20260905100000_planning_execution_guidance');
    service = new StrategicPlanningService(
      new ContentPlanRepository(client), new PlannedContentItemRepository(client), new PlanningHistoryRepository(client),
      { list: async () => [] }, { listOpportunities: async () => [], research: async () => ({ historyId: 'unused' }) },
      new StrategicPlanningRanker(), () => new Date('2026-09-05T12:00:00.000Z'), new PlanningExecutionRepository(client),
    );
    const app = express(); app.use(express.json()); app.use(createPlanningRouter(service));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });

  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });

  const createPlan = async (options = {}) => {
    const suffix = ++sequence;
    const makeItem = (position) => ({
      candidateKey: `item-${suffix}-${position}`, candidateType: 'TOPIC', title: `Item ${suffix}.${position}`,
      rationale: `Razao ${position}`, status: 'READY', priority: position === 1 ? 'CRITICAL' : 'HIGH', effort: 'MEDIUM',
      readiness: 'READY', queue: position === 1 ? 'NEXT' : 'LATER', position, executionScore: 90 - position,
      manualPriority: position === 1, evidence: [{ classification: 'fact', summary: `Fato ${position}`, confidence: 0.8 }],
      risks: [], constraints: [], missingData: [], dependencies: [], executionState: 'pending',
      executionAction: `Executar item ${position}.`, executionConfidence: position === 1 ? 0.8 : 0.7,
      executionContext: { source: 'test' }, sourceDecisionId: null, sourceResearchOpportunityId: null,
      researchHistoryId: null, seriesId: null,
    });
    return new ContentPlanRepository(client).create({
      projectId: null, horizon: 'TODAY', status: 'READY', summary: 'Plano de teste', balance: {}, constraints: [], risks: [], source: {},
      generatedAt: new Date('2026-09-05T10:00:00.000Z'), items: [makeItem(1), makeItem(2), ...(options.third ? [makeItem(3)] : [])],
    });
  };

  const request = async (route, options = {}) => {
    const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json' } });
    return { status: response.status, body: await response.json() };
  };

  test('guidance reduces confidence for stale and missing evidence without predicting views', () => {
    const healthy = createExecutionGuidance(candidate());
    const degraded = createExecutionGuidance(candidate({ freshness: 'STALE', missingData: ['retention', 'ctr'], readiness: 'NEEDS_RESEARCH' }));
    assert.equal(healthy.state, 'pending'); assert.ok(degraded.confidence < healthy.confidence);
    assert.match(degraded.action, /Investigar/); assert.doesNotMatch(JSON.stringify(degraded), /previs[aã]o|views exatas/i);
  });

  test('starting execution records a strategic snapshot and preserves manual order and priority', async () => {
    const plan = await createPlan(); const first = plan.items[0];
    const result = await service.transitionExecution(first.id, { state: 'in_progress', reason: 'Comecar gravacao.' });
    assert.equal(result.changed, true); assert.equal(result.item.executionState, 'in_progress'); assert.equal(result.item.queue, 'NEXT');
    assert.equal(result.item.priority, 'CRITICAL'); assert.equal(result.item.position, 1); assert.equal(result.event.event, 'EXECUTION_STARTED');
    assert.equal(result.event.strategicContext.title, first.title); assert.deepEqual(result.event.strategicContext.evidence, first.evidence);
  });

  test('repeating the same transition is idempotent', async () => {
    const plan = await createPlan(); const first = plan.items[0];
    await service.transitionExecution(first.id, { state: 'in_progress' });
    const repeated = await service.transitionExecution(first.id, { state: 'in_progress' });
    assert.equal(repeated.changed, false); assert.equal(repeated.event, null);
    assert.equal(await client.planningExecutionEvent.count({ where: { itemId: first.id } }), 1);
  });

  test('complete, skip and pause promote the next eligible item coherently', async () => {
    for (const state of ['completed', 'skipped', 'paused']) {
      const plan = await createPlan(); const [first, second] = plan.items;
      const result = await service.transitionExecution(first.id, { state, reason: `Mover para ${state}` });
      const updatedFirst = result.plan.items.find(({ id }) => id === first.id);
      const updatedSecond = result.plan.items.find(({ id }) => id === second.id);
      assert.equal(updatedFirst.queue, state === 'paused' ? 'WAITING' : 'DONE');
      assert.equal(updatedSecond.queue, 'NEXT'); assert.equal(result.currentGuidance.itemId, second.id);
    }
  });

  test('completed and skipped items reject later state changes', async () => {
    const plan = await createPlan(); const first = plan.items[0];
    await service.transitionExecution(first.id, { state: 'completed' });
    await assert.rejects(() => service.transitionExecution(first.id, { state: 'in_progress' }), PlanningExecutionConflictError);
  });

  test('concurrent starts cannot create two active executions in one plan', async () => {
    const plan = await createPlan();
    const outcomes = await Promise.allSettled(plan.items.map(({ id }) => service.transitionExecution(id, { state: 'in_progress' })));
    assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(({ status }) => status === 'rejected').length, 1);
    assert.equal(await client.plannedContentItem.count({ where: { planId: plan.id, executionState: 'in_progress' } }), 1);
  });

  test('execution history is append-only, filtered and newest first', async () => {
    const plan = await createPlan(); const first = plan.items[0];
    await service.transitionExecution(first.id, { state: 'in_progress' });
    await service.transitionExecution(first.id, { state: 'paused', reason: 'Aguardar material.' });
    const history = await service.listExecutionHistory({ planId: plan.id });
    assert.equal(history.length, 2); assert.equal(history[0].state, 'paused'); assert.equal(history[1].state, 'in_progress');
  });

  test('HTTP contracts expose guidance, lifecycle, history and safe validation statuses', async () => {
    const plan = await createPlan(); const first = plan.items[0];
    const guidance = await request('/current/guidance'); assert.equal(guidance.status, 200); assert.ok(guidance.body.action);
    const invalid = await request(`/items/${first.id}/execution`, { method: 'POST', body: JSON.stringify({ state: 'unknown' }) });
    assert.equal(invalid.status, 400);
    const missing = await request('/items/missing/execution', { method: 'POST', body: JSON.stringify({ state: 'completed' }) });
    assert.equal(missing.status, 404);
    const started = await request(`/items/${first.id}/execution`, { method: 'POST', body: JSON.stringify({ state: 'in_progress', reason: 'Iniciar.' }) });
    assert.equal(started.status, 200); assert.equal(started.body.item.executionState, 'in_progress');
    const history = await request(`/execution-history?planId=${plan.id}&limit=10`); assert.equal(history.status, 200); assert.equal(history.body.length, 1);
    const completed = await request(`/items/${first.id}/execution`, { method: 'POST', body: JSON.stringify({ state: 'completed' }) });
    assert.equal(completed.status, 200); assert.equal(completed.body.currentGuidance.itemId, plan.items[1].id);
    const conflict = await request(`/items/${first.id}/execution`, { method: 'POST', body: JSON.stringify({ state: 'paused' }) });
    assert.equal(conflict.status, 409); assert.doesNotMatch(JSON.stringify(conflict.body), /Prisma|stack|SQL/i);
  });

  test('legacy completion endpoint records execution history and promotes NEXT', async () => {
    const plan = await createPlan(); const response = await request(`/items/${plan.items[0].id}/complete`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 200); assert.equal(response.body.executionState, 'completed');
    const detail = await request(`/${plan.id}`); assert.equal(detail.body.items[1].queue, 'NEXT');
    assert.equal(await client.planningExecutionEvent.count({ where: { itemId: plan.items[0].id } }), 1);
  });
});
