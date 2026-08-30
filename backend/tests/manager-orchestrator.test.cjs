const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const express = require('express');

const { CapabilityRegistry } = require('../dist/services/orchestration/CapabilityRegistry');
const { detectOrchestrationConflicts } = require('../dist/services/orchestration/EvidenceConsolidator');
const { classifyManagerIntent, extractComparisonCandidates } = require('../dist/services/orchestration/ManagerIntentInterpreter');
const { createManagerOrchestrationPlan } = require('../dist/services/orchestration/ManagerPlanner');
const { ManagerOrchestratorService } = require('../dist/services/orchestration/ManagerOrchestratorService');
const { OrchestratorService } = require('../dist/services/orchestration/OrchestratorService');
const { createManagerRouter } = require('../dist/routes/manager');
const { PlannerService } = require('../dist/services/PlannerService');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');

class MemoryExecutionRepository {
  constructor() { this.records = []; this.sequence = 0; }
  async create(data) {
    if (data.idempotencyKey && this.records.some((item) => item.idempotencyKey === data.idempotencyKey)) {
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    }
    const now = new Date();
    const row = { id: `manager-${++this.sequence}`, status: 'pending', result: null, evidence: null,
      errorType: null, startedAt: now, completedAt: null, createdAt: now, updatedAt: now, ...structuredClone(data) };
    this.records.push(row); return structuredClone(row);
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

const definition = (id, tags, dependencies = []) => ({
  id, responsibility: `Use ${id}`, inputs: [], outputs: [], availability: 'available',
  capabilityTags: tags, dependencies, access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
});

const managerRegistry = (overrides = {}) => {
  const registry = new CapabilityRegistry();
  const entries = [
    ['supervisor.read', ['data-quality', 'supervision'], []], ['performance.read', ['performance'], []],
    ['analytics.read', ['analytics'], ['performance.read']], ['channel-operator.ctr', ['ctr'], []],
    ['channel-operator.retention', ['retention'], []], ['channel-operator.long-form', ['long-form'], []],
    ['channel-operator.shorts', ['shorts'], []], ['channel-operator.trends', ['trends'], []],
    ['channel-operator.series', ['series'], []], ['audience.read', ['audience'], []],
    ['traffic-sources.read', ['traffic-sources'], []], ['editorial-decisions.read', ['decision-memory'], []],
    ['library.read', ['shared-memory'], []], ['creator-intelligence.decide', ['editorial-decision'], []],
    ['planner.respond', ['response'], []],
  ];
  for (const [id, tags, dependencies] of entries) registry.register(definition(id, tags, dependencies), async () => {
    if (overrides[id] instanceof Error) throw overrides[id];
    if (overrides[id]) return structuredClone(overrides[id]);
    if (id === 'planner.respond') return { summary: 'Resposta consolidada.', recommendations: ['Teste controlado.'], confidence: 0.8 };
    return { summary: id, facts: [`Fato de ${id}.`], confidence: 0.8,
      data: { sampleSize: 8, quality: { state: 'GOOD', freshness: 'RECENT' }, signalDirections: ['neutral'] } };
  });
  return registry;
};

describe('manager intent interpretation', () => {
  const cases = [
    ['por que meu canal caiu?', 'CHANNEL_DIAGNOSIS'], ['o que eu devo gravar amanha?', 'CONTENT_DECISION'],
    ['City Car Driving ou Forza?', 'IDEA_COMPARISON'], ['vale continuar essa serie?', 'SERIES_ANALYSIS'],
    ['qual dessas ideias e melhor?', 'IDEA_COMPARISON'], ['o problema esta no CTR ou na retencao?', 'CHANNEL_DIAGNOSIS'],
    ['meus Shorts pioraram?', 'SHORTS_ANALYSIS'], ['compare meus videos longos', 'LONGFORM_ANALYSIS'],
    ['meu CTR esta bom?', 'CTR_ANALYSIS'], ['como esta a retencao?', 'RETENTION_ANALYSIS'],
    ['qual tendencia esta crescendo?', 'TREND_ANALYSIS'], ['qual pais mais assiste?', 'AUDIENCE_ANALYSIS'],
    ['de onde vem meu trafego?', 'TRAFFIC_ANALYSIS'], ['planeje meus proximos conteudos', 'PLANNING'],
    ['qual a melhor oportunidade agora?', 'OPPORTUNITY_DISCOVERY'], ['quais riscos existem?', 'RISK_ANALYSIS'],
    ['como melhorar meu conteudo?', 'GENERAL_CREATOR_QUESTION'], ['qual e a temperatura?', 'UNKNOWN'],
  ];
  for (const [message, intent] of cases) test(`${intent} is deterministic`, () => assert.equal(classifyManagerIntent(message), intent));
  test('extracts comparison candidates', () => assert.deepEqual(
    extractComparisonCandidates('City Car Driving ou Forza?'), ['City Car Driving', 'Forza'],
  ));
});

describe('manager planning and evidence', () => {
  test('selects focused capabilities and response', () => {
    const plan = createManagerOrchestrationPlan({ intent: 'CTR?', managerIntent: 'CTR_ANALYSIS' }, managerRegistry());
    assert.deepEqual(plan.capabilities, ['supervisor.read', 'channel-operator.ctr', 'channel-operator.trends', 'planner.respond']);
  });
  test('deduplicates operators and preserves dependencies', () => {
    const plan = createManagerOrchestrationPlan({ intent: 'canal', managerIntent: 'CHANNEL_DIAGNOSIS' }, managerRegistry());
    assert.equal(new Set(plan.capabilities).size, plan.capabilities.length);
    assert.deepEqual(plan.steps.find(({ capabilityId }) => capabilityId === 'analytics.read').dependencies, ['performance-read']);
  });
  test('does not run unrelated operators for Shorts', () => {
    const plan = createManagerOrchestrationPlan({ intent: 'shorts', managerIntent: 'SHORTS_ANALYSIS' }, managerRegistry());
    assert.equal(plan.capabilities.includes('channel-operator.shorts'), true);
    assert.equal(plan.capabilities.includes('channel-operator.ctr'), false);
    assert.equal(plan.capabilities.includes('channel-operator.series'), false);
  });
  test('reports an unavailable operator as missing data', () => {
    const registry = new CapabilityRegistry();
    registry.register({ ...definition('ctr.offline', ['ctr']), availability: 'unavailable', unavailableReason: 'CTR not synchronized' }, async () => ({}));
    registry.register(definition('planner.respond', ['response']), async () => ({ summary: 'safe' }));
    const plan = createManagerOrchestrationPlan({ intent: 'ctr', managerIntent: 'CTR_ANALYSIS' }, registry);
    assert.deepEqual(plan.capabilities, ['planner.respond']);
    assert.equal(plan.missingData.some((item) => item.includes('CTR not synchronized')), true);
  });
  test('preserves CTR versus retention conflict', () => {
    const conflicts = detectOrchestrationConflicts([
      { stepId: 'ctr', capabilityId: 'channel-operator.ctr', status: 'completed', durationMs: 1, output: { summary: 'ctr', data: { signalDirections: ['positive'] } } },
      { stepId: 'retention', capabilityId: 'channel-operator.retention', status: 'completed', durationMs: 1, output: { summary: 'retention', data: { signalDirections: ['negative'] } } },
    ]);
    assert.equal(conflicts[0].code, 'STRONG_PACKAGING_WEAK_CONSUMPTION');
  });
  test('preserves declining trend versus healthy series conflict', () => {
    const conflicts = detectOrchestrationConflicts([
      { stepId: 'trends', capabilityId: 'channel-operator.trends', status: 'completed', durationMs: 1, output: { summary: 'trend', data: { signalDirections: ['negative'] } } },
      { stepId: 'series', capabilityId: 'channel-operator.series', status: 'completed', durationMs: 1, output: { summary: 'series', data: { signalDirections: ['positive'] } } },
    ]);
    assert.equal(conflicts[0].code, 'DECLINING_TREND_HEALTHY_SERIES');
  });
});

describe('autonomous manager service', () => {
  test('runs multiple operators and persists an append-only correlation id', async () => {
    const repository = new MemoryExecutionRepository();
    const service = new ManagerOrchestratorService(new OrchestratorService(managerRegistry(), repository));
    const result = await service.query({ message: 'por que meu canal caiu?', projectId: 'project-1' });
    assert.equal(result.intent, 'CHANNEL_DIAGNOSIS'); assert.equal(result.correlationId, 'manager-1');
    assert.equal(result.operatorsUsed.length, 7); assert.equal(repository.records.length, 1);
    assert.equal(repository.records[0].result.correlationId, result.correlationId);
  });
  test('deduplicates repeated request ids', async () => {
    const repository = new MemoryExecutionRepository();
    const service = new ManagerOrchestratorService(new OrchestratorService(managerRegistry(), repository));
    const first = await service.query({ message: 'meu CTR esta bom?', requestId: 'same-request' });
    const second = await service.query({ message: 'meu CTR esta bom?', requestId: 'same-request' });
    assert.equal(first.correlationId, second.correlationId); assert.equal(repository.records.length, 1);
  });
  test('returns a safe degraded result after partial failure', async () => {
    const registry = managerRegistry({ 'channel-operator.trends': new Error('private payload') });
    const result = await new ManagerOrchestratorService(new OrchestratorService(registry, new MemoryExecutionRepository()))
      .query({ message: 'meu CTR esta bom?' });
    assert.equal(result.status, 'partial'); assert.equal(result.outcome, 'DEGRADED');
    assert.equal(result.operatorsUsed.find(({ operatorId }) => operatorId === 'trends').errorType, 'Error');
    assert.doesNotMatch(JSON.stringify(result), /private payload/);
  });
  test('stale data lowers confidence', async () => {
    const stale = { summary: 'stale', facts: ['Fato antigo.'], confidence: 1,
      data: { sampleSize: 10, quality: { state: 'PARTIAL', freshness: 'STALE' } } };
    const result = await new ManagerOrchestratorService(new OrchestratorService(managerRegistry({ 'channel-operator.ctr': stale }), new MemoryExecutionRepository()))
      .query({ message: 'meu CTR esta bom?' });
    assert.equal(result.confidence < 0.8, true);
  });
  test('answers INSUFFICIENT_DATA honestly', async () => {
    const missing = { summary: 'missing', missingData: ['YouTube data'], confidence: 0, data: { sampleSize: 0 } };
    const overrides = Object.fromEntries(['supervisor.read', 'channel-operator.ctr', 'channel-operator.trends', 'planner.respond'].map((id) => [id, missing]));
    const result = await new ManagerOrchestratorService(new OrchestratorService(managerRegistry(overrides), new MemoryExecutionRepository()))
      .query({ message: 'meu CTR esta bom?' });
    assert.equal(result.outcome, 'INSUFFICIENT_DATA'); assert.match(result.answer, /^INSUFFICIENT_DATA/);
  });
  test('lists, opens and diagnoses persisted history', async () => {
    const repository = new MemoryExecutionRepository(); const service = new ManagerOrchestratorService(new OrchestratorService(managerRegistry(), repository));
    const result = await service.query({ message: 'como esta a retencao?', conversationId: 'conversation-1' });
    assert.equal((await service.listHistory({ conversationId: 'conversation-1' }))[0].correlationId, result.correlationId);
    assert.equal((await service.getHistory(result.correlationId)).intent, 'RETENTION_ANALYSIS');
    assert.equal((await service.getDiagnostics(result.correlationId)).operators.length, 3);
  });
  test('routes idea comparison through the editorial decision capability', async () => {
    const decision = { summary: 'decision', recommendations: ['Priorize Forza.'], confidence: 0.82,
      data: { decisionId: 'decision-1', category: 'PRIORITIZE', candidateKey: 'forza' } };
    const result = await new ManagerOrchestratorService(new OrchestratorService(
      managerRegistry({ 'creator-intelligence.decide': decision }), new MemoryExecutionRepository(),
    )).query({ message: 'City Car Driving ou Forza?' });
    assert.equal(result.intent, 'IDEA_COMPARISON'); assert.equal(result.decision.decisionId, 'decision-1');
    assert.equal(result.operatorsUsed.some(({ operatorId }) => operatorId === 'creator-intelligence'), true);
  });
});

test('Planner delegates an editorial question to Manager and remains message owner', async () => {
  const created = []; const conversation = { id: 'conversation', projectId: null, context: null, messages: [
    { id: 'user', sender: 'user', text: 'por que meu canal caiu?', createdAt: new Date() },
  ] };
  const manager = { query: async () => ({ correlationId: 'manager-1', answer: 'Diagnostico.', decision: null }) };
  const planner = new PlannerService({ findById: async () => conversation },
    { create: async (data) => { const row = { id: 'operator', ...data }; created.push(row); return row; } },
    undefined, undefined, undefined, undefined, undefined, manager);
  const reply = await planner.generateReply('conversation');
  assert.equal(reply.text, 'Diagnostico.'); assert.equal(reply.orchestrationExecutionId, 'manager-1'); assert.equal(created.length, 1);
});

test('Supervisor reviews recent manager conflicts and degraded executions without rebuilding analysis', async () => {
  const orchestrationRepository = { findRecent: async () => [{
    request: { managerIntent: 'CHANNEL_DIAGNOSIS' },
    result: { status: 'partial', outcome: 'DEGRADED', evidence: { confidence: 0.3 },
      conflicts: [{ code: 'CONFLICT' }], operatorInvocations: [{ operatorId: 'ctr' }, { operatorId: 'retention' }] },
  }] };
  const supervisor = new SupervisorModule(
    { getStatus: async () => ({ state: 'connected', lastSyncAt: new Date(), lastErrorType: null }) },
    { list: async () => [] }, { getOperationalStatus: async () => ({ current: 0, reviewAvailable: 0, stale: 0, insufficientData: 0, recentFailures: 0 }) },
    { getOperationalSummary: async () => ({ awaitingReview: 0, approved: 0, rejected: 0, expired: 0, executedRecently: 0, blockedRecently: 0 }) },
    { getOperationalSummary: async () => ({ total: 0, active: 0, paused: 0, blocked: 0, error: 0, due: 0 }) },
    { countByStatuses: async () => 0 }, { getHealth: () => ({ status: 'stopped' }) },
    { getSummary: async () => ({ healthy: 0, degraded: 0, blocked: 0, failing: 0, disabled: 0, quotasReached: 0, pausedByFailure: 0, approvalsPending: 0, retriesPending: 0 }) },
    { list: async () => [] },
    { getStatus: async () => ({ state: 'connected', quality: { state: 'GOOD', freshness: 'RECENT', reasons: [] } }) },
    { summary: async () => null }, orchestrationRepository,
  );
  const overview = await supervisor.getSupervisorOverview();
  assert.deepEqual(overview.managerOrchestration, {
    recent: 1, degraded: 1, lowConfidence: 1, insufficientData: 0, conflicts: 1, operators: ['ctr', 'retention'],
  });
});

describe('manager HTTP API', () => {
  let server; let baseUrl;
  before(async () => {
    const app = express(); app.use(express.json());
    app.use(createManagerRouter(new ManagerOrchestratorService(new OrchestratorService(managerRegistry(), new MemoryExecutionRepository()))));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });
  after(async () => new Promise((resolve) => server.close(resolve)));
  const request = async (route, options = {}) => { const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json' } }); return { status: response.status, body: await response.json() }; };
  test('queries, lists, opens and diagnoses', async () => {
    const query = await request('/query', { method: 'POST', body: JSON.stringify({ message: 'meus Shorts pioraram?' }) });
    assert.equal(query.status, 200); assert.equal(query.body.intent, 'SHORTS_ANALYSIS');
    assert.equal((await request('/history')).status, 200);
    assert.equal((await request(`/history/${query.body.correlationId}`)).status, 200);
    assert.equal((await request(`/history/${query.body.correlationId}/diagnostics`)).status, 200);
  });
  test('rejects extra fields and sanitizes missing history', async () => {
    assert.equal((await request('/query', { method: 'POST', body: JSON.stringify({ message: 'x', secret: 'no' }) })).status, 400);
    const missing = await request('/history/missing'); assert.equal(missing.status, 404);
    assert.doesNotMatch(JSON.stringify(missing.body), /stack|Prisma|secret/i);
  });
});
