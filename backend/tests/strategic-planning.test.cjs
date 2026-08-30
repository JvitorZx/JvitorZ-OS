const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { StrategicPlanningRanker } = require('../dist/domains/strategic-planning/StrategicPlanningRanker');
const { DatabaseService } = require('../dist/database/DatabaseService');
const { ContentPlanRepository } = require('../dist/database/repositories/ContentPlanRepository');
const { PlannedContentItemRepository } = require('../dist/database/repositories/PlannedContentItemRepository');
const { PlanningHistoryRepository } = require('../dist/database/repositories/PlanningHistoryRepository');
const { StrategicPlanningService, ContentPlanNotFoundError, PlannedContentItemNotFoundError } = require('../dist/services/strategic-planning');
const { createPlanningRouter } = require('../dist/routes/planning');
const { classifyManagerIntent } = require('../dist/services/orchestration/ManagerIntentInterpreter');
const { createManagerOrchestrationPlan } = require('../dist/services/orchestration/ManagerPlanner');
const { createDefaultCapabilityRegistry } = require('../dist/services/orchestration/OrchestrationComposition');
const { PlannerService } = require('../dist/services/PlannerService');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');

const candidate = (overrides = {}) => ({
  key: 'idea-a', title: 'Ideia A', candidateType: 'TOPIC', sourceDecisionId: 'd1',
  decisionCategory: 'PRIORITIZE', opportunityScore: 75, confidence: 0.8,
  freshness: 'RECENT', trend: 'STABLE', seriesHealth: 'HEALTHY', effort: 'MEDIUM',
  repetitionKey: 'topic:a', evidence: [{ classification: 'fact', source: 'test', summary: 'Fato A', confidence: 0.8 }],
  risks: [], constraints: [], missingData: [],
  dependencies: [{ type: 'EDITORIAL_DECISION', referenceId: 'd1', status: 'READY', summary: 'Decisao pronta.' }],
  ...overrides,
});

describe('strategic planning deterministic ranking', () => {
  test('generates an ordered queue without mutating candidates', () => {
    const input = [candidate(), candidate({ key: 'idea-b', title: 'Ideia B', opportunityScore: 55, repetitionKey: 'topic:b' })];
    const copy = structuredClone(input); const result = new StrategicPlanningRanker().rank(input, 'NEXT_7_DAYS');
    assert.equal(result.candidates[0].key, 'idea-a'); assert.equal(result.candidates[0].queue, 'NEXT'); assert.deepEqual(input, copy);
  });
  test('same data and constraints produce the same structural ranking', () => {
    const input = [candidate({ key: 'b', repetitionKey: 'b' }), candidate({ key: 'a', repetitionKey: 'a' })];
    const ranker = new StrategicPlanningRanker();
    assert.deepEqual(ranker.rank(input, 'TODAY'), ranker.rank(structuredClone(input), 'TODAY'));
  });
  test('fresh rising opportunity becomes urgent', () => {
    const result = new StrategicPlanningRanker().rank([candidate({ trend: 'RISING', freshness: 'RECENT' })], 'TODAY');
    assert.equal(result.candidates[0].urgent, true); assert.equal(result.candidates[0].priority, 'CRITICAL');
  });
  test('strong series without a recent episode becomes urgent', () => {
    const result = new StrategicPlanningRanker().rank([candidate({ seriesHealth: 'STRONG', daysSinceLastEpisode: 20 })], 'TODAY');
    assert.equal(result.candidates[0].urgent, true);
  });
  test('declining series and high effort rank below a healthy low effort item', () => {
    const result = new StrategicPlanningRanker().rank([
      candidate({ key: 'declining', repetitionKey: 'd', seriesHealth: 'DECLINING', effort: 'HIGH' }),
      candidate({ key: 'healthy', repetitionKey: 'h', seriesHealth: 'HEALTHY', effort: 'LOW' }),
    ], 'NEXT_3_DAYS');
    assert.equal(result.candidates[0].key, 'healthy');
  });
  test('repetition is recorded as risk and does not automatically block', () => {
    const input = ['a', 'b', 'c'].map((key) => candidate({ key, repetitionKey: 'series:same' }));
    const result = new StrategicPlanningRanker().rank(input, 'NEXT_7_DAYS');
    assert.ok(result.candidates.every(({ risks }) => risks.some(({ code }) => code === 'REPETITION_RISK')));
    assert.ok(result.candidates.every(({ readiness }) => readiness !== 'BLOCKED'));
  });
  test('missing or stale evidence stays explicit and waits for research', () => {
    const result = new StrategicPlanningRanker().rank([candidate({ missingData: ['retention'], freshness: 'STALE' })], 'TODAY');
    assert.equal(result.candidates[0].readiness, 'NEEDS_RESEARCH'); assert.equal(result.candidates[0].queue, 'WAITING');
  });
  test('blocking constraints and dependencies produce BLOCKED', () => {
    const result = new StrategicPlanningRanker().rank([candidate({
      constraints: [{ code: 'NO_ASSET', summary: 'Asset indisponivel', blocking: true }],
      dependencies: [{ type: 'MANUAL', status: 'BLOCKED', summary: 'Aprovacao pendente' }],
    })], 'TODAY');
    assert.equal(result.candidates[0].readiness, 'BLOCKED'); assert.equal(result.candidates[0].queue, 'BLOCKED');
  });
  test('balances proven items and experiments without exceeding the horizon', () => {
    const input = Array.from({ length: 10 }, (_, index) => candidate({
      key: `item-${index}`, repetitionKey: `item-${index}`,
      sourceDecisionId: index % 3 === 2 ? undefined : `d${index}`, decisionCategory: index % 3 === 2 ? 'TEST' : 'PRIORITIZE',
    }));
    const result = new StrategicPlanningRanker().rank(input, 'NEXT_3_DAYS');
    assert.equal(result.candidates.length, 5); assert.ok(result.balance.experimental >= 1); assert.ok(result.balance.proven >= 2);
  });
  test('explains ordering without predicting exact views', () => {
    const result = new StrategicPlanningRanker().rank([candidate()], 'TODAY');
    assert.match(result.candidates[0].rationale, /score editorial|confianca/i);
    assert.doesNotMatch(JSON.stringify(result), /vai (ter|dar)|previsao de views|views exatas/i);
  });
});

const decision = (overrides = {}) => ({
  id: 'd1', candidateKey: 'beamng-next', candidateType: 'GAME', recommendation: 'Gravar BeamNG com desafio claro',
  category: 'PRIORITIZE', score: 78, confidence: 0.84, opportunityScore: { value: 78, components: [] },
  evidence: [{ classification: 'fact', source: 'performance', summary: 'Serie acima da baseline.', confidence: 0.84 }],
  risks: [], constraints: [], missingData: [], ...overrides,
});

describe('strategic planning persistence, API and integrations', { concurrency: false }, () => {
  let client; let service; let server; let baseUrl; let currentPlan;
  const decisions = [decision()]; const researchOpportunities = [];
  const research = {
    listOpportunities: async () => structuredClone(researchOpportunities),
    research: async () => {
      await client.$executeRawUnsafe("INSERT OR IGNORE INTO ResearchHistory(id) VALUES ('research-requested')");
      return { historyId: 'research-requested' };
    },
  };

  before(async () => {
    client = await DatabaseService.connect(); await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    for (const table of ['Project', 'EditorialDecision', 'ResearchHistory', 'ResearchOpportunity', 'SeriesDefinition']) {
      await client.$executeRawUnsafe(`CREATE TABLE "${table}" ("id" TEXT NOT NULL PRIMARY KEY)`);
    }
    await client.$executeRawUnsafe("INSERT INTO EditorialDecision(id) VALUES ('d1')");
    const fs = require('node:fs'); const path = require('node:path');
    const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260904120000_strategic_content_planning/migration.sql'), 'utf8');
    for (const statement of migration.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
    const executionMigration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260905100000_planning_execution_guidance/migration.sql'), 'utf8');
    for (const statement of executionMigration.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
    service = new StrategicPlanningService(
      new ContentPlanRepository(client), new PlannedContentItemRepository(client), new PlanningHistoryRepository(client),
      { list: async () => structuredClone(decisions) }, research, new StrategicPlanningRanker(), () => new Date('2026-09-04T12:00:00.000Z'),
    );
    const app = express(); app.use(express.json()); app.use(createPlanningRouter(service));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });
  const request = async (route, options = {}) => {
    const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json' } });
    return { status: response.status, body: await response.json() };
  };

  test('generates and persists a versioned plan from existing decisions', async () => {
    const response = await request('/generate', { method: 'POST', body: JSON.stringify({ horizon: 'NEXT_7_DAYS' }) });
    assert.equal(response.status, 201); currentPlan = response.body;
    assert.equal(currentPlan.items.length, 1); assert.equal(currentPlan.items[0].sourceDecisionId, 'd1');
    assert.equal((await client.contentPlan.count()), 1); assert.equal((await client.planningHistory.count()), 1);
  });
  test('gets current and plan detail with ordered queue', async () => {
    const current = await request('/current'); const detail = await request(`/${currentPlan.id}`);
    assert.equal(current.status, 200); assert.equal(detail.status, 200); assert.equal(detail.body.items[0].queue, 'NEXT');
  });
  test('combines persisted Research and EditorialDecision origins without duplicating ranking logic', async () => {
    await client.$executeRawUnsafe("INSERT INTO ResearchHistory(id) VALUES ('research-source')");
    await client.$executeRawUnsafe("INSERT INTO ResearchOpportunity(id) VALUES ('opportunity-source')");
    researchOpportunities.push({
      id: 'opportunity-source', researchHistoryId: 'research-source', key: 'beamng-next', subject: 'BeamNG', subjectType: 'GAME',
      state: 'HIGH_INTEREST', freshness: 'RECENT', confidence: 0.8, evidence: [], risks: [], gaps: [],
      researchHistory: { projectId: null, researchedAt: new Date('2026-09-04T10:00:00.000Z') },
    });
    const plan = await service.generate({ horizon: 'TODAY' });
    assert.equal(plan.items[0].sourceDecisionId, 'd1'); assert.equal(plan.items[0].sourceResearchOpportunityId, 'opportunity-source');
  });
  test('manual item, reprioritization and history are persisted', async () => {
    const added = await request('/items', { method: 'POST', body: JSON.stringify({ planId: currentPlan.id, title: 'Teste manual controlado', priority: 'LOW', effort: 'HIGH', reason: 'Teste editorial manual.' }) });
    assert.equal(added.status, 201);
    const updated = await request(`/items/${added.body.id}`, { method: 'PATCH', body: JSON.stringify({ priority: 'HIGH', reason: 'Prioridade editorial revisada.' }) });
    assert.equal(updated.status, 200); assert.equal(updated.body.priority, 'HIGH'); assert.equal(updated.body.manualPriority, true);
    const history = await request(`/history?itemId=${added.body.id}`); assert.equal(history.status, 200); assert.equal(history.body.length, 2);
  });
  test('reorders every plan item and preserves one NEXT item', async () => {
    const plan = await request(`/${currentPlan.id}`); const reversed = [...plan.body.items].reverse().map(({ id }) => id);
    const response = await request('/reorder', { method: 'POST', body: JSON.stringify({ planId: currentPlan.id, itemIds: reversed, reason: 'Ordem manual.' }) });
    assert.equal(response.status, 200); assert.deepEqual(response.body.map(({ id }) => id), reversed); assert.equal(response.body.filter(({ queue }) => queue === 'NEXT').length, 1);
  });
  test('completes an item and moves it to DONE', async () => {
    const plan = await request(`/${currentPlan.id}`); const response = await request(`/items/${plan.body.items[0].id}/complete`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 200); assert.equal(response.body.status, 'COMPLETED'); assert.equal(response.body.queue, 'DONE');
  });
  test('research dependency can be requested through the controlled update contract', async () => {
    decisions.splice(0, 1, decision({ id: 'd2', candidateKey: 'needs-research', missingData: ['external demand'] }));
    await client.$executeRawUnsafe("INSERT INTO EditorialDecision(id) VALUES ('d2')");
    const generated = await request('/generate', { method: 'POST', body: JSON.stringify({ horizon: 'TODAY' }) });
    const waiting = generated.body.items[0]; assert.equal(waiting.readiness, 'NEEDS_RESEARCH');
    const researched = await request(`/items/${waiting.id}`, { method: 'PATCH', body: JSON.stringify({ requestResearch: true }) });
    assert.equal(researched.status, 200); assert.equal(researched.body.researchHistoryId, 'research-requested');
  });
  test('preserves previous plans instead of silently overwriting them', async () => {
    const before = await client.contentPlan.count(); await service.generate({ horizon: 'NEXT_14_DAYS' }); assert.equal(await client.contentPlan.count(), before + 1);
  });
  test('validates malformed payloads and missing resources safely', async () => {
    assert.equal((await request('/generate', { method: 'POST', body: '{"horizon":"FAKE"}' })).status, 400);
    assert.equal((await request('/items', { method: 'POST', body: '{"planId":"x","secret":true}' })).status, 400);
    assert.equal((await request('/current?secret=true')).status, 400);
    assert.equal((await request('/history?secret=true')).status, 400);
    assert.equal((await request('/missing')).status, 404);
    await assert.rejects(() => service.getById('missing'), ContentPlanNotFoundError);
    await assert.rejects(() => service.updateItem('missing', { priority: 'HIGH', reason: 'x' }), PlannedContentItemNotFoundError);
  });
  test('manager classifies and selects the dedicated planning capability', async () => {
    assert.equal(classifyManagerIntent('o que eu gravo hoje?'), 'CONTENT_PLANNING');
    const dependencies = {
      intelligence: { listPerformanceRecords: async () => [], listPerformanceSignals: async () => [], getPerformanceBaseline: async () => ({}) },
      editorial: { generate: async () => { throw new Error('unused'); }, compareCandidates: async () => { throw new Error('unused'); }, list: async () => [] },
      outcomes: { listOutcomes: async () => [] }, refresh: { listStates: async () => [], refreshAvailable: async () => ({ reviewed: 0, unchanged: 0, failed: 0 }) },
      supervisor: { getSupervisorOverview: async () => ({}) }, library: { listItems: async () => [] }, youtube: { sync: async () => ({ created: 0, updated: 0 }) },
      channelOperators: { run: async () => ({}) }, audience: { summary: async () => ({}), traffic: async () => ({}) }, research: { research: async () => ({}) },
      planning: { getOrGenerateCurrent: async () => ({ plan: await service.getById(currentPlan.id), generated: false }) },
    };
    const registry = createDefaultCapabilityRegistry(dependencies);
    const plan = createManagerOrchestrationPlan({ intent: 'o que eu gravo hoje?', managerIntent: 'CONTENT_PLANNING' }, registry);
    assert.deepEqual(plan.capabilities, ['strategic-planning.current', 'planner.respond']);
    const generic = createManagerOrchestrationPlan({ intent: 'planeje meus conteudos', managerIntent: 'PLANNING' }, registry);
    assert.deepEqual(generic.capabilities, ['strategic-planning.current', 'planner.respond']);
    const output = await registry.get('strategic-planning.current').execute({ request: { intent: 'x' }, plan, results: new Map() });
    assert.equal(output.data.planId, currentPlan.id); assert.match(output.summary, /prioridade|sem item/i);
  });
  test('Planner delegates a planning question to the Manager and remains message owner', async () => {
    const created = []; const conversation = { id: 'c1', projectId: null, context: null, messages: [{ id: 'u1', sender: 'user', text: 'o que eu gravo hoje?', createdAt: new Date() }] };
    const planner = new PlannerService({ findById: async () => conversation }, { create: async (data) => { const row = { id: 'm1', ...data }; created.push(row); return row; } },
      undefined, undefined, undefined, undefined, undefined, { query: async () => ({ correlationId: 'manager-plan', answer: 'Grave BeamNG.', decision: null }) });
    const reply = await planner.generateReply('c1'); assert.equal(reply.text, 'Grave BeamNG.'); assert.equal(created.length, 1);
  });
  test('Supervisor exposes planning risks without letting planning failures break the dashboard', async () => {
    const supervisor = new SupervisorModule(
      { getStatus: async () => ({ state: 'connected', lastSyncAt: new Date(), lastErrorType: null }) },
      { list: async () => [] }, { getOperationalStatus: async () => ({ current: 0, reviewAvailable: 0, stale: 0, insufficientData: 0, recentFailures: 0 }) },
      { getOperationalSummary: async () => ({ awaitingReview: 0, approved: 0, rejected: 0, expired: 0, executedRecently: 0, blockedRecently: 0 }) },
      { getOperationalSummary: async () => ({ total: 0, active: 0, paused: 0, blocked: 0, error: 0, due: 0 }) },
      { countByStatuses: async () => 0 }, { getHealth: () => ({ status: 'stopped' }) },
      { getSummary: async () => ({ healthy: 0, degraded: 0, blocked: 0, failing: 0, disabled: 0, quotasReached: 0, pausedByFailure: 0, approvalsPending: 0, retriesPending: 0 }) },
      { list: async () => [] }, { getStatus: async () => ({ state: 'connected', quality: { state: 'GOOD', freshness: 'RECENT', reasons: [] } }) },
      { summary: async () => null }, { findRecent: async () => [] },
      { getOperationalSummary: async () => ({ totalResearches: 0, opportunities: 0, lowConfidence: 0, stale: 0, conflicts: 0, quality: 'MISSING', freshness: 'MISSING', latestAt: null, sources: [] }) },
      { getOperationalSummary: async () => ({ planId: 'p1', status: 'READY', horizon: 'TODAY', total: 3, ready: 1, needsResearch: 1, blocked: 1, lowConfidence: 1, experiments: 2, stale: 1, conflicts: 1 }) },
    );
    const overview = await supervisor.getSupervisorOverview(); assert.equal(overview.planning.blocked, 1);
    assert.equal(overview.dataQuality.find(({ area }) => area === 'Planejamento').state, 'PARTIAL');
  });
});
