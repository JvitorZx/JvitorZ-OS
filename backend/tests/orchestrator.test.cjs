const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');
process.env.DATABASE_URL = ':memory:';

const { CapabilityRegistry } = require('../dist/services/orchestration/CapabilityRegistry');
const { consolidateEvidence } = require('../dist/services/orchestration/EvidenceConsolidator');
const { classifyOrchestrationIntent, createOrchestrationPlan } = require('../dist/services/orchestration/IntentRouter');
const { OrchestrationConfirmationRequiredError, OrchestratorService } = require('../dist/services/orchestration/OrchestratorService');
const { createDefaultCapabilityRegistry } = require('../dist/services/orchestration/OrchestrationComposition');
const { createOrchestratorRouter } = require('../dist/routes/orchestrator');
const { PlannerService } = require('../dist/services/PlannerService');
const { DatabaseService } = require('../dist/database/DatabaseService');
const { OrchestrationExecutionRepository } = require('../dist/database/repositories/OrchestrationExecutionRepository');

class MemoryExecutionRepository {
  constructor() { this.records = []; this.sequence = 0; }
  async create(data) {
    if (data.idempotencyKey && this.records.some((item) => item.idempotencyKey === data.idempotencyKey)) {
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    }
    const now = new Date();
    const record = { id: `execution-${++this.sequence}`, status: 'pending', result: null, evidence: null,
      errorType: null, startedAt: now, completedAt: null, createdAt: now, updatedAt: now, ...structuredClone(data) };
    this.records.push(record); return structuredClone(record);
  }
  async findById(id) { return structuredClone(this.records.find((item) => item.id === id) ?? null); }
  async findByIdempotencyKey(key) { return structuredClone(this.records.find((item) => item.idempotencyKey === key) ?? null); }
  async markRunning(id) { return this.update(id, { status: 'running' }); }
  async complete(id, data) { return this.update(id, { ...data, completedAt: new Date() }); }
  async findRecent({ projectId, conversationId, limit = 20 } = {}) {
    return structuredClone(this.records.filter((item) =>
      (projectId === undefined || item.projectId === projectId)
      && (conversationId === undefined || item.conversationId === conversationId)).slice(-limit).reverse());
  }
  async update(id, data) {
    const index = this.records.findIndex((item) => item.id === id);
    this.records[index] = { ...this.records[index], ...structuredClone(data), updatedAt: new Date() };
    return structuredClone(this.records[index]);
  }
}

const definition = (id, access = 'read', dependencies = []) => ({
  id, responsibility: id, inputs: [], outputs: [], availability: 'available', dependencies, access,
});

const createRegistry = (calls = [], overrides = {}) => {
  const registry = new CapabilityRegistry();
  const outputs = {
    'performance.read': { summary: 'performance', facts: ['10 snapshots reais.'], confidence: 1 },
    'analytics.read': { summary: 'analytics', inferences: ['Retenção estável.'], confidence: 0.8 },
    'creator-intelligence.decide': { summary: 'decision', recommendations: ['Grave um teste narrado.'], risks: ['Amostra limitada.'], confidence: 0.7, data: { decisionId: 'decision-1' } },
    'decision-outcomes.read': { summary: 'outcomes', facts: ['Outcome POSITIVE.'], confidence: 0.8 },
    'outcome-refresh.inspect': { summary: 'inspect', facts: ['1 outcome revisável.'], confidence: 1, data: { reviewAvailable: 1 } },
    'outcome-refresh.run': { summary: 'refresh', facts: ['1 outcome revisado.'], confidence: 1 },
    'supervisor.read': { summary: 'supervisor', facts: ['Sistema operacional.'], confidence: 1 },
    'planner.respond': { summary: 'Resposta consolidada.', recommendations: ['Grave um teste narrado.'], confidence: 0.8 },
    'youtube.sync': { summary: 'sync', facts: ['1 snapshot sincronizado.'], confidence: 1 },
    'library.read': { summary: 'library', facts: ['2 artefatos.'], confidence: 1 },
  };
  const accesses = { 'creator-intelligence.decide': 'write', 'outcome-refresh.run': 'write', 'youtube.sync': 'external_side_effect' };
  for (const id of Object.keys(outputs)) {
    registry.register(definition(id, accesses[id] ?? 'read'), async (context) => {
      calls.push(id); return overrides[id] ? overrides[id](context) : structuredClone(outputs[id]);
    });
  }
  return registry;
};

describe('orchestration intent and planning', () => {
  test('routes known intents deterministically without an external model', () => {
    assert.equal(classifyOrchestrationIntent('O que eu devo gravar?'), 'next_content');
    assert.equal(classifyOrchestrationIntent('Meu último teste funcionou?'), 'outcome_status');
    assert.equal(classifyOrchestrationIntent('Como está meu canal?'), 'channel_status');
    assert.equal(classifyOrchestrationIntent('Essa série ainda vale a pena?'), 'series_viability');
    assert.equal(classifyOrchestrationIntent('Sincronize o YouTube e revise outcomes'), 'controlled_sync_review');
  });
  test('creates a plan before execution with dependencies and access classes', () => {
    const plan = createOrchestrationPlan({ intent: 'O que vale gravar agora?' });
    assert.deepEqual(plan.steps.map(({ capabilityId }) => capabilityId), ['performance.read', 'analytics.read', 'creator-intelligence.decide', 'planner.respond']);
    assert.deepEqual(plan.steps[2].dependencies, ['analytics']);
    assert.equal(plan.requiresWrite, true); assert.equal(plan.hasExternalSideEffect, false);
  });
});

describe('controlled OrchestratorService', () => {
  test('executes a multi-capability plan once, in dependency order, and persists memory', async () => {
    const calls = []; const repository = new MemoryExecutionRepository();
    const service = new OrchestratorService(createRegistry(calls), repository);
    const run = await service.run({ intent: 'O que vale gravar agora?', conversationId: 'conversation-1' });
    assert.deepEqual(calls, ['performance.read', 'analytics.read', 'creator-intelligence.decide', 'planner.respond']);
    assert.equal(run.result.status, 'completed'); assert.equal(run.result.response, 'Resposta consolidada.');
    assert.equal(repository.records[0].status, 'completed'); assert.equal(repository.records[0].conversationId, 'conversation-1');
  });
  test('short-circuits refresh when inspection reports no eligible outcomes', async () => {
    const calls = [];
    const registry = createRegistry(calls, {
      'outcome-refresh.inspect': async () => ({ summary: 'none', data: { reviewAvailable: 0 } }),
      'outcome-refresh.run': async ({ results }) => ({ summary: 'none', skipped: Number(results.get('review-state').output.data.reviewAvailable) === 0 }),
    });
    const service = new OrchestratorService(registry, new MemoryExecutionRepository());
    const run = await service.run({ intent: 'Sincronize o YouTube e revise outcomes', confirmExternalSideEffect: true,
      sync: { mode: 'recent', startDate: '2026-08-01', endDate: '2026-08-25' } });
    assert.equal(run.result.steps.find(({ stepId }) => stepId === 'refresh').status, 'skipped');
    assert.equal(calls.includes('outcome-refresh.run'), false);
  });
  test('returns a partial result and sanitized failure while useful steps continue', async () => {
    const service = new OrchestratorService(createRegistry([], { 'analytics.read': async () => { throw new Error('private payload'); } }), new MemoryExecutionRepository());
    const run = await service.run({ intent: 'Como está meu canal?' });
    assert.equal(run.result.status, 'partial');
    assert.equal(run.result.steps.find(({ stepId }) => stepId === 'analytics').errorType, 'Error');
    assert.doesNotMatch(JSON.stringify(run), /private payload/);
  });
  test('deduplicates a repeated explicit idempotency key', async () => {
    const calls = []; const service = new OrchestratorService(createRegistry(calls), new MemoryExecutionRepository());
    const first = await service.run({ intent: 'Como está meu canal?', idempotencyKey: 'request-1' });
    const second = await service.run({ intent: 'Como está meu canal?', idempotencyKey: 'request-1' });
    assert.equal(first.execution.id, second.execution.id); assert.equal(second.created, false);
    assert.equal(calls.filter((id) => id === 'performance.read').length, 1);
  });
  test('shares one execution for concurrent requests with the same idempotency key', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const calls = [];
    const service = new OrchestratorService(createRegistry(calls, {
      'performance.read': async () => { await gate; return { summary: 'done', facts: ['done'] }; },
    }), new MemoryExecutionRepository());
    const first = service.run({ intent: 'O que devo gravar?', idempotencyKey: 'concurrent-1' });
    const second = service.run({ intent: 'O que devo gravar?', idempotencyKey: 'concurrent-1' });
    release();
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.execution.id, right.execution.id);
    assert.equal(calls.filter((id) => id === 'performance.read').length, 1);
  });
  test('requires explicit confirmation before the controlled YouTube side effect', async () => {
    const service = new OrchestratorService(createRegistry(), new MemoryExecutionRepository());
    await assert.rejects(() => service.run({ intent: 'Sincronize o YouTube e revise outcomes',
      sync: { mode: 'recent', startDate: '2026-08-01', endDate: '2026-08-25' } }), OrchestrationConfirmationRequiredError);
  });
  test('runs sync, detection, refresh and Supervisor only after explicit confirmation', async () => {
    const calls = []; const service = new OrchestratorService(createRegistry(calls), new MemoryExecutionRepository());
    const run = await service.run({ intent: 'Sincronize o YouTube e revise outcomes', confirmExternalSideEffect: true,
      sync: { mode: 'recent', startDate: '2026-08-01', endDate: '2026-08-25' } });
    assert.deepEqual(calls, ['youtube.sync', 'outcome-refresh.inspect', 'outcome-refresh.run', 'supervisor.read', 'planner.respond']);
    assert.equal(run.result.status, 'completed');
  });
  test('keeps facts, inferences and recommendations in separate evidence channels', () => {
    const evidence = consolidateEvidence([{ stepId: 'a', capabilityId: 'a', status: 'completed', durationMs: 1,
      output: { summary: 'a', facts: ['Fato'], inferences: ['Inferência'], recommendations: ['Recomendação'], confidence: 0.8 } }]);
    assert.deepEqual(evidence.facts, ['Fato']); assert.deepEqual(evidence.inferences, ['Inferência']);
    assert.deepEqual(evidence.recommendations, ['Recomendação']);
  });
  test('lists recent execution memory and opens plan by id', async () => {
    const service = new OrchestratorService(createRegistry(), new MemoryExecutionRepository());
    const run = await service.run({ intent: 'Como está meu canal?', projectId: 'project-1' });
    assert.equal((await service.listRecent({ projectId: 'project-1' })).length, 1);
    assert.equal((await service.getExecutionPlan(run.execution.id)).intent, 'channel_status');
  });
});

test('real registry exposes only available capabilities and delegates Supervisor', async () => {
  let supervisorCalls = 0;
  const dependencies = {
    intelligence: { listPerformanceRecords: async () => [], listPerformanceSignals: async () => [], getPerformanceBaseline: async () => ({}) },
    editorial: { generate: async () => { throw new Error('not used'); } }, outcomes: { listOutcomes: async () => [] },
    refresh: { listStates: async () => [], refreshAvailable: async () => ({ reviewed: 0, unchanged: 0, skipped: 0, failed: 0, results: [] }) },
    supervisor: { getSupervisorOverview: async () => { supervisorCalls += 1; return { youtubeAnalytics: { state: 'connected' }, outcomeReviews: { reviewAvailable: 0 }, editorial: { risks: [], actions: [] } }; } },
    library: { listItems: async () => [] }, youtube: { sync: async () => ({ created: 0, updated: 0 }) },
  };
  const registry = createDefaultCapabilityRegistry(dependencies);
  assert.equal(registry.list().every(({ availability }) => availability === 'available'), true);
  const output = await registry.get('supervisor.read').execute({ request: { intent: 'status' }, plan: {}, results: new Map() });
  assert.equal(output.data.youtubeAnalytics, 'connected'); assert.equal(supervisorCalls, 1);
});

test('Planner remains the message owner while orchestration supplies editorial context', async () => {
  const created = [];
  const conversation = { id: 'conversation', projectId: null, context: null, messages: [
    { id: 'user', conversationId: 'conversation', sender: 'user', text: 'O que devo gravar?', createdAt: new Date() },
  ] };
  const orchestrator = { run: async () => ({ execution: { id: 'execution-1' }, result: { response: 'Resposta coordenada.',
    steps: [{ capabilityId: 'creator-intelligence.decide', output: { data: { decisionId: 'decision-1' } } }] } }) };
  const editorial = { getById: async () => ({ id: 'decision-1', operatorMessageId: null }), attachOperatorMessage: async () => {} };
  const planner = new PlannerService({ findById: async () => conversation },
    { create: async (data) => { const message = { id: 'operator', createdAt: new Date(), ...data }; created.push(message); return message; } },
    undefined, undefined, undefined, editorial, orchestrator);
  const reply = await planner.generateReply('conversation');
  assert.equal(reply.text, 'Resposta coordenada.'); assert.equal(reply.sender, 'operator');
  assert.equal(reply.orchestrationExecutionId, 'execution-1'); assert.equal(created.length, 1);
});

describe('orchestrator HTTP API', () => {
  let server; let baseUrl;
  before(async () => {
    const app = express(); app.use(express.json());
    app.use(createOrchestratorRouter(new OrchestratorService(createRegistry(), new MemoryExecutionRepository())));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });
  after(async () => new Promise((resolve) => server.close(resolve)));
  const request = async (route, options = {}) => { const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json' } }); return { status: response.status, body: await response.json() }; };
  test('plans, runs, opens and lists executions through safe contracts', async () => {
    assert.equal((await request('/capabilities')).status, 200);
    assert.equal((await request('/plan', { method: 'POST', body: JSON.stringify({ intent: 'Como está meu canal?' }) })).status, 200);
    const run = await request('/run', { method: 'POST', body: JSON.stringify({ intent: 'Como está meu canal?' }) });
    assert.equal(run.status, 201); assert.equal((await request(`/executions/${run.body.execution.id}`)).status, 200);
    assert.equal((await request(`/executions/${run.body.execution.id}/plan`)).status, 200);
    assert.equal((await request('/executions/recent?limit=10')).status, 200);
  });
  test('rejects extra fields and missing executions safely', async () => {
    assert.equal((await request('/run', { method: 'POST', body: JSON.stringify({ intent: 'status', secret: 'no' }) })).status, 400);
    const missing = await request('/executions/missing'); assert.equal(missing.status, 404);
    assert.doesNotMatch(JSON.stringify(missing.body), /stack|Prisma|secret/i);
  });
});

test('orchestration migration is additive and enforces idempotency in SQLite', () => {
  const sql = readFileSync(path.resolve(__dirname, '../prisma/migrations/20260826150000_controlled_orchestration_foundation/migration.sql'), 'utf8');
  const database = new Database(':memory:');
  try {
    database.exec('PRAGMA foreign_keys=ON; CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);'); database.exec(sql);
    database.prepare(`INSERT INTO OrchestrationExecution (id, idempotencyKey, intent, objective, capabilities, request, plan, failures, updatedAt)
      VALUES ('one', 'same', 'channel_status', 'status', '[]', '{}', '{}', '[]', CURRENT_TIMESTAMP)`).run();
    assert.throws(() => database.prepare(`INSERT INTO OrchestrationExecution (id, idempotencyKey, intent, objective, capabilities, request, plan, failures, updatedAt)
      VALUES ('two', 'same', 'channel_status', 'status', '[]', '{}', '{}', '[]', CURRENT_TIMESTAMP)`).run(), /UNIQUE/);
  } finally { database.close(); }
});

test('OrchestrationExecutionRepository persists and orders execution memory in SQLite', async () => {
  const sql = readFileSync(path.resolve(__dirname, '../prisma/migrations/20260826150000_controlled_orchestration_foundation/migration.sql'), 'utf8');
  const client = await DatabaseService.connect();
  try {
    await client.$executeRawUnsafe('PRAGMA foreign_keys=ON');
    await client.$executeRawUnsafe('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)');
    for (const statement of sql.split(';').map((item) => item.trim()).filter(Boolean)) {
      await client.$executeRawUnsafe(statement);
    }
    const repository = new OrchestrationExecutionRepository(client);
    const created = await repository.create({
      projectId: null, conversationId: 'conversation', idempotencyKey: 'persisted',
      intent: 'channel_status', objective: 'Status', capabilities: ['supervisor.read'],
      request: { intent: 'status' }, plan: { steps: [] }, failures: [],
    });
    await repository.markRunning(created.id);
    await repository.complete(created.id, {
      status: 'completed', result: { response: 'ok' }, evidence: { facts: ['real'] }, failures: [],
    });
    assert.equal((await repository.findById(created.id)).status, 'completed');
    assert.equal((await repository.findByIdempotencyKey('persisted')).id, created.id);
    assert.deepEqual((await repository.findRecent({ conversationId: 'conversation' })).map(({ id }) => id), [created.id]);
  } finally {
    await DatabaseService.disconnect();
  }
});
