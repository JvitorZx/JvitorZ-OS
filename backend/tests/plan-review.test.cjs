const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, describe, test } = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');
process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { OrchestrationExecutionRepository } = require('../dist/database/repositories/OrchestrationExecutionRepository');
const { PlanReviewRepository } = require('../dist/database/repositories/PlanReviewRepository');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');
const { createOrchestratorRouter } = require('../dist/routes/orchestrator');
const { CapabilityRegistry } = require('../dist/services/orchestration/CapabilityRegistry');
const { OrchestratorService } = require('../dist/services/orchestration/OrchestratorService');
const { classifyPlanRisk, CapabilityMetadataError } = require('../dist/services/orchestration/PlanRiskClassifier');
const { PlanReviewConflictError, PlanReviewExpiredError, PlanReviewRequiredError,
  PlanReviewService } = require('../dist/services/orchestration/PlanReviewService');

let client;
let now = new Date('2026-08-27T12:00:00.000Z');
let executionRepository;
let reviewRepository;

const migration = (name) => readFileSync(path.resolve(__dirname, `../prisma/migrations/${name}/migration.sql`), 'utf8');
const executeSql = async (sql) => {
  for (const statement of sql.split(';').map((item) => item.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
};

const metadata = (id, access = 'read', sideEffect = 'READ_ONLY', persistentMutation = false, maxAffectedItems) => ({
  id, responsibility: `Responsibility ${id}`, inputs: [], outputs: [], availability: 'available', dependencies: [],
  access, sideEffect, persistentMutation, ...(maxAffectedItems ? { maxAffectedItems } : {}),
});

const createRegistry = (calls = [], overrides = {}) => {
  const registry = new CapabilityRegistry();
  const definitions = {
    'performance.read': metadata('performance.read'),
    'analytics.read': metadata('analytics.read'),
    'creator-intelligence.decide': metadata('creator-intelligence.decide', 'write', 'INTERNAL_WRITE', true, 1),
    'decision-outcomes.read': metadata('decision-outcomes.read'),
    'outcome-refresh.inspect': metadata('outcome-refresh.inspect'),
    'outcome-refresh.run': metadata('outcome-refresh.run', 'write', 'INTERNAL_WRITE', true, 20),
    'supervisor.read': metadata('supervisor.read'),
    'planner.respond': metadata('planner.respond'),
    'youtube.sync': metadata('youtube.sync', 'external_side_effect', 'EXTERNAL_READ', true, 20),
  };
  for (const [id, definition] of Object.entries(definitions)) {
    registry.register(definition, async (context) => {
      calls.push(id);
      if (overrides[id]) return overrides[id](context);
      if (id === 'outcome-refresh.inspect') return { summary: id, data: { reviewAvailable: 1 }, confidence: 1 };
      return { summary: id === 'planner.respond' ? 'Resposta revisada.' : id, facts: [`${id} fact`], confidence: 1 };
    });
  }
  return registry;
};

const createService = (registry = createRegistry()) => {
  const reviews = new PlanReviewService(executionRepository, reviewRepository, () => new Date(now));
  return { reviews, orchestrator: new OrchestratorService(registry, executionRepository, reviews) };
};

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys=ON');
  await client.$executeRawUnsafe('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)');
  await executeSql(migration('20260826150000_controlled_orchestration_foundation'));
  await executeSql(migration('20260827120000_orchestration_plan_review'));
  executionRepository = new OrchestrationExecutionRepository(client);
  reviewRepository = new PlanReviewRepository(client);
});

beforeEach(async () => {
  now = new Date('2026-08-27T12:00:00.000Z');
  await client.orchestrationAuditEvent.deleteMany();
  await client.planReview.deleteMany();
  await client.orchestrationExecution.deleteMany();
});

after(async () => DatabaseService.disconnect());

describe('risk and side-effect policy', () => {
  test('classifies read-only, bounded internal writes and external writes distinctly', () => {
    const base = { intent: 'general_operations', objective: 'test', capabilities: [], requiresWrite: false,
      hasExternalSideEffect: false, missingData: [] };
    const step = (sideEffect, persistentMutation, maxAffectedItems) => ({ id: sideEffect, capabilityId: sideEffect,
      objective: sideEffect, dependencies: [], optional: false, access: sideEffect === 'READ_ONLY' ? 'read'
        : sideEffect === 'INTERNAL_WRITE' ? 'write' : 'external_side_effect', sideEffect, persistentMutation, maxAffectedItems });
    assert.equal(classifyPlanRisk({ ...base, steps: [step('READ_ONLY', false)] }).riskLevel, 'LOW');
    const internal = classifyPlanRisk({ ...base, steps: [step('INTERNAL_WRITE', true, 1)] });
    assert.equal(internal.riskLevel, 'MEDIUM'); assert.equal(internal.requiredApprovals, 0);
    const external = classifyPlanRisk({ ...base, steps: [step('EXTERNAL_WRITE', true, 1)] });
    assert.equal(external.riskLevel, 'HIGH'); assert.equal(external.requiredApprovals, 1);
  });

  test('rejects inconsistent capability metadata before execution', () => {
    const registry = new CapabilityRegistry();
    assert.throws(() => registry.register(metadata('bad', 'read', 'EXTERNAL_WRITE', false), async () => ({ summary: 'bad' })), CapabilityMetadataError);
  });
});

describe('PlanReviewService and execution guard', () => {
  test('auto-approves a LOW read-only preview without executing capabilities', async () => {
    const calls = []; const { orchestrator } = createService(createRegistry(calls));
    const preview = await orchestrator.preview({ intent: 'Como está meu canal?' });
    assert.equal(preview.review.riskLevel, 'LOW'); assert.equal(preview.review.state, 'approved');
    assert.equal(preview.review.requiredApprovals, 0); assert.deepEqual(calls, []);
  });

  test('classifies bounded internal persistence as MEDIUM and policy-approved', async () => {
    const { orchestrator } = createService();
    const preview = await orchestrator.preview({ intent: 'O que devo gravar?' });
    assert.equal(preview.review.riskLevel, 'MEDIUM'); assert.equal(preview.review.state, 'approved');
    assert.equal(preview.review.sideEffectLevel, 'INTERNAL_WRITE');
  });

  test('requires explicit review for a persistent external read', async () => {
    const { orchestrator } = createService();
    const preview = await orchestrator.preview({ intent: 'Sincronize o YouTube e revise outcomes',
      sync: { mode: 'recent', startDate: '2026-08-20', endDate: '2026-08-27', limit: 20 } });
    assert.equal(preview.review.riskLevel, 'HIGH'); assert.equal(preview.review.state, 'review_required');
    assert.equal(preview.review.sideEffectLevel, 'EXTERNAL_READ'); assert.equal(preview.review.requiredApprovals, 1);
    await assert.rejects(() => orchestrator.executeApprovedPlan(preview.executionId), PlanReviewRequiredError);
  });

  test('approves, executes and records an immutable audit sequence', async () => {
    const calls = []; const { orchestrator } = createService(createRegistry(calls));
    const preview = await orchestrator.preview({ intent: 'Sincronize o YouTube e revise outcomes',
      sync: { mode: 'recent', startDate: '2026-08-20', endDate: '2026-08-27', limit: 20 } });
    const approved = await orchestrator.approvePlan(preview.executionId, 'Joao', 'Revisado', preview.review.version);
    assert.equal(approved.review.state, 'approved'); assert.ok(approved.review.approvedPlan);
    const run = await orchestrator.executeApprovedPlan(preview.executionId);
    assert.equal(run.result.status, 'completed'); assert.equal((await orchestrator.getPlanReview(preview.executionId)).state, 'executed');
    assert.deepEqual(calls, ['youtube.sync', 'outcome-refresh.inspect', 'outcome-refresh.run', 'supervisor.read', 'planner.respond']);
    const events = await orchestrator.getAuditTrail(preview.executionId);
    assert.deepEqual(events.map(({ eventType }) => eventType), ['PLAN_CREATED', 'PLAN_APPROVED', 'EXECUTION_ATTEMPTED', 'PLAN_EXECUTED']);
    assert.doesNotMatch(JSON.stringify(events), /token|secret|authorization/i);
  });

  test('rejects a plan and blocks every later execution attempt', async () => {
    const { orchestrator } = createService();
    const preview = await orchestrator.preview({ intent: 'Sincronize o YouTube e revise outcomes',
      sync: { mode: 'recent', startDate: '2026-08-20', endDate: '2026-08-27' } });
    await orchestrator.rejectPlan(preview.executionId, 'Reviewer', 'Janela incorreta', preview.review.version);
    await assert.rejects(() => orchestrator.executeApprovedPlan(preview.executionId), PlanReviewRequiredError);
    assert.equal((await orchestrator.getPlanReview(preview.executionId)).state, 'rejected');
    assert.equal((await orchestrator.getAuditTrail(preview.executionId)).at(-1).eventType, 'EXECUTION_BLOCKED');
  });

  test('expires plans only after their risk-based validity window', async () => {
    const { orchestrator } = createService();
    const preview = await orchestrator.preview({ intent: 'Sincronize o YouTube e revise outcomes',
      sync: { mode: 'recent', startDate: '2026-08-20', endDate: '2026-08-27' } });
    now = new Date('2026-08-27T12:16:00.000Z');
    assert.equal((await orchestrator.getPlanReview(preview.executionId)).state, 'expired');
    await assert.rejects(() => orchestrator.approvePlan(preview.executionId, 'Reviewer', null, 1), PlanReviewExpiredError);
  });

  test('invalidates an approval if the persisted plan changes', async () => {
    const { orchestrator } = createService();
    const preview = await orchestrator.preview({ intent: 'Sincronize o YouTube e revise outcomes',
      sync: { mode: 'recent', startDate: '2026-08-20', endDate: '2026-08-27' } });
    await orchestrator.approvePlan(preview.executionId, 'Reviewer', null, preview.review.version);
    const execution = await client.orchestrationExecution.findUnique({ where: { id: preview.executionId } });
    await client.orchestrationExecution.update({ where: { id: preview.executionId },
      data: { plan: { ...execution.plan, objective: 'changed' } } });
    await assert.rejects(() => orchestrator.approvePlan(preview.executionId, 'Reviewer', null, 2), PlanReviewExpiredError);
    await assert.rejects(() => orchestrator.executeApprovedPlan(preview.executionId), PlanReviewExpiredError);
    assert.equal((await orchestrator.getPlanReview(preview.executionId)).state, 'expired');
  });

  test('makes approval and preview idempotent under retries', async () => {
    const { orchestrator } = createService();
    const input = { intent: 'Sincronize o YouTube e revise outcomes', idempotencyKey: 'review-one',
      sync: { mode: 'recent', startDate: '2026-08-20', endDate: '2026-08-27' } };
    const first = await orchestrator.preview(input); const second = await orchestrator.preview(input);
    assert.equal(first.executionId, second.executionId); assert.equal(second.created, false);
    const approved = await orchestrator.approvePlan(first.executionId, 'Reviewer', null, first.review.version);
    const repeated = await orchestrator.approvePlan(first.executionId, 'Reviewer', null, first.review.version);
    assert.equal(approved.review.id, repeated.review.id); assert.equal(repeated.changed, false);
  });

  test('allows only one concurrent execution to invoke capabilities', async () => {
    let release; const gate = new Promise((resolve) => { release = resolve; }); const calls = [];
    const registry = createRegistry(calls, { 'youtube.sync': async () => { await gate; return { summary: 'sync' }; } });
    const { orchestrator } = createService(registry);
    const preview = await orchestrator.preview({ intent: 'Sincronize o YouTube e revise outcomes',
      sync: { mode: 'recent', startDate: '2026-08-20', endDate: '2026-08-27' } });
    await orchestrator.approvePlan(preview.executionId, 'Reviewer', null, preview.review.version);
    const first = orchestrator.executeApprovedPlan(preview.executionId);
    const second = orchestrator.executeApprovedPlan(preview.executionId);
    const completion = Promise.allSettled([first, second]);
    setTimeout(release, 10);
    const settled = await completion;
    assert.equal(settled.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(settled.filter(({ status, reason }) => status === 'rejected' && reason instanceof PlanReviewConflictError).length, 1);
    assert.equal(calls.filter((id) => id === 'youtube.sync').length, 1);
  });
});

test('Supervisor reports review counts without approving or executing', async () => {
  let calls = 0;
  const supervisor = new SupervisorModule(
    { getStatus: async () => ({ state: 'connected' }) },
    { list: async () => [] },
    { getOperationalStatus: async () => ({ current: 0, reviewAvailable: 0, stale: 0, insufficientData: 0, recentFailures: 0 }) },
    { getOperationalSummary: async () => { calls += 1; return { awaitingReview: 2, approved: 1, rejected: 1,
      expired: 0, executedRecently: 3, blockedRecently: 1 }; } },
  );
  const overview = await supervisor.getSupervisorOverview();
  assert.equal(overview.orchestrationReviews.awaitingReview, 2); assert.equal(calls, 1);
});

describe('plan review HTTP integration', () => {
  let server; let baseUrl;
  before(async () => {
    const { orchestrator } = createService();
    const app = express(); app.use(express.json()); app.use(createOrchestratorRouter(orchestrator));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`; resolve();
    }); });
  });
  after(async () => new Promise((resolve) => server.close(resolve)));
  const request = async (route, options = {}) => {
    const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json' } });
    return { status: response.status, body: await response.json() };
  };

  test('flows from intent through approval, execution and audit', async () => {
    const preview = await request('/preview', { method: 'POST', body: JSON.stringify({
      intent: 'Sincronize o YouTube e revise outcomes',
      sync: { mode: 'recent', startDate: '2026-08-20', endDate: '2026-08-27' },
    }) });
    assert.equal(preview.status, 201); assert.equal(preview.body.review.state, 'review_required');
    assert.equal((await request(`/executions/${preview.body.executionId}/execute`, { method: 'POST', body: '{}' })).status, 409);
    const approved = await request(`/executions/${preview.body.executionId}/approve`, { method: 'POST', body: JSON.stringify({
      reviewer: 'Joao', reason: 'Aprovado', expectedVersion: preview.body.review.version,
    }) });
    assert.equal(approved.status, 200);
    assert.equal((await request(`/executions/${preview.body.executionId}/execute`, { method: 'POST', body: '{}' })).status, 200);
    const audit = await request(`/executions/${preview.body.executionId}/audit`);
    assert.equal(audit.status, 200); assert.ok(audit.body.some(({ eventType }) => eventType === 'PLAN_EXECUTED'));
  });

  test('validates decisions and returns safe missing responses', async () => {
    assert.equal((await request('/preview', { method: 'POST', body: JSON.stringify({ intent: 'status', extra: true }) })).status, 400);
    const missing = await request('/executions/missing/review'); assert.equal(missing.status, 404);
    assert.doesNotMatch(JSON.stringify(missing.body), /Prisma|stack|token|secret/i);
  });
});

test('plan review migration is additive and enforces one review per execution', () => {
  const database = new Database(':memory:');
  try {
    database.exec('PRAGMA foreign_keys=ON; CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);');
    database.exec(migration('20260826150000_controlled_orchestration_foundation'));
    database.exec(migration('20260827120000_orchestration_plan_review'));
    database.prepare(`INSERT INTO OrchestrationExecution (id, intent, objective, capabilities, request, plan, failures, updatedAt)
      VALUES ('execution', 'status', 'status', '[]', '{}', '{}', '[]', CURRENT_TIMESTAMP)`).run();
    database.prepare(`INSERT INTO PlanReview (id, executionId, state, riskLevel, sideEffectLevel, planHash, validUntil, updatedAt)
      VALUES ('review', 'execution', 'approved', 'LOW', 'READ_ONLY', 'hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
    assert.throws(() => database.prepare(`INSERT INTO PlanReview (id, executionId, state, riskLevel, sideEffectLevel, planHash, validUntil, updatedAt)
      VALUES ('duplicate', 'execution', 'approved', 'LOW', 'READ_ONLY', 'hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(), /UNIQUE/);
  } finally { database.close(); }
});
