const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DATABASE_URL = ':memory:';
const { DatabaseService } = require('../dist/database/DatabaseService');
const { ChannelContextRepository } = require('../dist/database/repositories/ChannelContextRepository');
const { ChannelContextService, ChannelContextResolver, ChannelContextBootstrap } = require('../dist/services/channel-context');
const { createChannelContextRouter } = require('../dist/routes/channelContext');
const { PlannerService } = require('../dist/services/PlannerService');
const { createDefaultCapabilityRegistry } = require('../dist/services/orchestration/OrchestrationComposition');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');
const { StrategicMonitoringService } = require('../dist/services/strategic-monitoring');
const { CreatorIntelligenceService } = require('../dist/services/creator-intelligence/CreatorIntelligenceService');

const base = (overrides = {}) => ({ type: 'FACT', status: 'CONFIRMED', category: 'STRATEGY', subject: 'Shorts',
  statement: 'Shorts sustentam descoberta.', confidence: .8, source: 'test:sprint45', ...overrides });

describe('channel context and creator memory', { concurrency: false }, () => {
  let client; let repository; let service; let resolver; let server; let baseUrl;
  before(async () => {
    client = await DatabaseService.connect(); await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await client.$executeRawUnsafe('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)');
    const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260911120000_channel_context_memory/migration.sql'), 'utf8');
    for (const statement of sql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
    repository = new ChannelContextRepository(client); service = new ChannelContextService(repository); resolver = new ChannelContextResolver(repository, () => new Date('2026-09-11T12:00:00Z'));
    const app = express(); app.use(express.json()); app.use('/api/context', createChannelContextRouter(service, resolver));
    server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/context`;
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });
  beforeEach(async () => { await client.channelContextRelation.deleteMany(); await client.channelContextEntry.deleteMany(); });
  const request = async (url = '', options = {}) => { const response = await fetch(`${baseUrl}${url}`, { headers: { 'content-type': 'application/json' }, ...options }); return { status: response.status, body: await response.json() }; };

  test('persists FACT with origin, confidence and structured metadata', async () => {
    const input = base({ metadata: { views: 7698 } }); const entry = await service.create(input);
    assert.equal(entry.type, 'FACT'); assert.equal(entry.source, 'test:sprint45'); assert.equal(entry.confidence, .8); assert.deepEqual(entry.metadata, { views: 7698 });
    assert.deepEqual(input.metadata, { views: 7698 });
  });
  test('keeps HYPOTHESIS semantically distinct from FACT', async () => {
    const hypothesis = await service.create(base({ type: 'HYPOTHESIS', status: 'ACTIVE', statement: 'O feed pode ter reduzido testes.' }));
    const fact = await service.create(base({ subject: 'Duracao', statement: 'Duracao media observada foi 24 segundos.' }));
    assert.equal(hypothesis.type, 'HYPOTHESIS'); assert.equal(fact.type, 'FACT');
  });
  test('persists temporal period and validates its order', async () => {
    const entry = await service.create(base({ periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-08-07T23:59:59Z' }));
    assert.equal(entry.periodStart.toISOString(), '2026-08-01T00:00:00.000Z');
    assert.throws(() => service.create(base({ periodStart: '2026-08-08', periodEnd: '2026-08-01' })), /period is invalid/);
  });
  test('supersession preserves history and removes old state from current queries', async () => {
    const old = await service.create(base({ type: 'DECISION', status: 'ACTIVE', statement: 'Estrategia de agosto.' }));
    const next = await service.supersede(old.id, base({ type: 'DECISION', status: 'ACTIVE', statement: 'Estrategia de setembro.' }));
    assert.equal(next.supersedesId, old.id); assert.equal((await service.get(old.id)).status, 'SUPERSEDED');
    assert.equal((await service.list({ currentOnly: true })).some(({ id }) => id === old.id), false); assert.equal((await service.list()).length, 2);
  });
  test('filters by type, status, period and related entity', async () => {
    const entry = await service.create(base({ type: 'EXPERIMENT', status: 'ACTIVE', periodStart: '2026-08-10', periodEnd: '2026-08-20' }));
    await service.relate(entry.id, { relation: 'TESTS', entityType: 'VIDEO', entityId: 'video-1' });
    assert.equal((await service.list({ type: 'EXPERIMENT' })).length, 1); assert.equal((await service.list({ status: 'REJECTED' })).length, 0);
    assert.equal((await service.list({ periodFrom: new Date('2026-08-15'), periodTo: new Date('2026-08-16') })).length, 1);
    assert.equal((await service.list({ entityType: 'VIDEO', entityId: 'video-1' })).length, 1);
  });
  test('relations are idempotent and auditable', async () => {
    const entry = await service.create(base()); await service.relate(entry.id, { relation: 'INFORMS', entityType: 'STRATEGIC_SIGNAL', entityId: 'signal-1' });
    await service.relate(entry.id, { relation: 'INFORMS', entityType: 'STRATEGIC_SIGNAL', entityId: 'signal-1' }); assert.equal((await service.get(entry.id)).relations.length, 1);
  });
  test('bootstrap is idempotent and persists known JvitorZx facts separately', async () => {
    const bootstrap = new ChannelContextBootstrap(service); const first = await bootstrap.run(); const second = await bootstrap.run();
    assert.ok(first.created >= 20); assert.equal(second.created, 0); assert.equal(second.existing, first.total);
    const shorts = await service.list({ category: 'SHORTS_METRICS' }); assert.equal(shorts.length, 3);
    assert.deepEqual(shorts.map(({ metadata }) => metadata.views).sort((a, b) => a - b), [1868, 5638, 7698]);
    assert.equal((await service.list({ type: 'HYPOTHESIS' })).some(({ statement }) => /pode ter reduzido/.test(statement)), true);
  });
  test('resolver selects relevant context deterministically without context dumping', async () => {
    await service.create(base({ subject: 'Forza Horizon 6', game: 'Forza Horizon 6', statement: 'Forza possui custo maior.' }));
    await service.create(base({ subject: 'City Car Driving', game: 'City Car Driving 2.0', statement: 'City Car possui progressao.' }));
    const result = await resolver.resolve({ text: 'O que fazer com Forza?', game: 'Forza Horizon 6', limit: 1, maxCharacters: 500 });
    assert.equal(result.entries.length, 1); assert.equal(result.entries[0].game, 'Forza Horizon 6'); assert.equal(result.truncated, true);
  });
  test('resolver excludes rejected and superseded context from current guidance', async () => {
    await service.create(base({ status: 'REJECTED', statement: 'Nao usar.' }));
    const old = await service.create(base({ type: 'DECISION', status: 'ACTIVE', statement: 'Antiga.' })); await service.supersede(old.id, base({ type: 'DECISION', statement: 'Atual.' }));
    const result = await resolver.resolve({ text: 'Shorts', limit: 10 }); assert.equal(result.entries.some(({ status }) => ['REJECTED', 'SUPERSEDED'].includes(status)), false); assert.equal(result.entries.some(({ statement }) => statement === 'Atual.'), true);
  });
  test('HTTP create, list and detail return persisted data', async () => {
    const created = await request('', { method: 'POST', body: JSON.stringify(base()) }); assert.equal(created.status, 201);
    assert.equal((await request('?type=FACT')).body.length, 1); assert.equal((await request(`/${created.body.id}`)).body.statement, base().statement);
  });
  test('HTTP update, supersede and relation contracts are strict', async () => {
    const created = await request('', { method: 'POST', body: JSON.stringify(base()) }); assert.equal((await request(`/${created.body.id}`, { method: 'PATCH', body: '{"confidence":0.9}' })).status, 200);
    assert.equal((await request(`/${created.body.id}/relations`, { method: 'POST', body: '{"relation":"INFORMS","entityType":"VIDEO","entityId":"v1"}' })).body.relations.length, 1);
    assert.equal((await request(`/${created.body.id}/supersede`, { method: 'POST', body: JSON.stringify(base({ statement: 'Nova decisao.' })) })).status, 201);
  });
  test('HTTP rejects malformed payloads and exposes no internal detail', async () => {
    assert.equal((await request('', { method: 'POST', body: '{"type":"FACT","secret":"x"}' })).status, 400); assert.equal((await request('?type=UNKNOWN')).status, 400); assert.equal((await request('/missing')).status, 404);
    const created = await request('', { method: 'POST', body: JSON.stringify(base({ periodEnd: '2026-08-10' })) });
    assert.equal((await request(`/${created.body.id}`, { method: 'PATCH', body: '{"periodStart":"2026-08-20"}' })).status, 400);
    assert.equal((await request(`/${created.body.id}`, { method: 'PATCH', body: '{"status":"SUPERSEDED"}' })).status, 400);
  });
  test('Manager capability consumes a bounded typed context selection', async () => {
    let query; const registry = createDefaultCapabilityRegistry({ channelContext: { resolve: async (input) => { query = input; return { entries: [{ id: 'ctx', type: 'HYPOTHESIS', status: 'ACTIVE', subject: 'Feed', statement: 'Pode haver menor teste.', confidence: .4 }], truncated: false }; } } });
    const output = await registry.get('channel-context.read').execute({ request: { intent: 'O que devo gravar agora?', projectId: null }, results: new Map() });
    assert.equal(query.limit, 8); assert.match(output.inferences[0], /HYPOTHESIS/); assert.deepEqual(output.data.contextIds, ['ctx']);
  });
  test('Planner injects selected context as optional typed guidance', async () => {
    let received; const planner = new PlannerService(
      { findById: async () => ({ id: 'c', projectId: null, context: null, messages: [{ id: 'm', sender: 'user', text: 'Fale de Forza', createdAt: new Date() }] }) },
      { create: async (data) => ({ id: 'reply', ...data }) }, { generate: async (input) => { received = input; return 'Resposta'; } },
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { resolve: async () => ({ entries: [{ id: 'ctx', type: 'DECISION', status: 'ACTIVE', subject: 'Forza', statement: 'Preservar identidade.', confidence: 1 }], truncated: false }) },
    );
    await planner.generateReply('c'); assert.match(received.messages.find(({ role, content }) => role === 'system' && /Contexto temporal/.test(content)).content, /DECISION\/ACTIVE/);
  });
  test('Supervisor exposes typed creator context without treating hypotheses as facts', async () => {
    const args = Array(16).fill(undefined); args.push({ resolve: async () => ({ totalCandidates: 1, truncated: false, entries: [{ id: 'ctx', type: 'HYPOTHESIS', status: 'ACTIVE', subject: 'Feed', statement: 'Possibilidade.', confidence: .3 }] }) });
    const overview = await new SupervisorModule(...args).getSupervisorOverview(); assert.equal(overview.channelContext.entries[0].type, 'HYPOTHESIS');
  });
  test('Monitoring relates persisted signals to selected context', async () => {
    const related = []; const signals = { findAll: async () => [], markSourcesStale: async () => 0, applyCandidate: async () => ({ signal: { id: 'signal-1' }, created: true, changed: true }), resolveMissing: async () => 0 };
    const snapshots = { ensureRules: async () => {}, createEvaluation: async () => ({ created: true, snapshot: { id: 'snapshot' } }), complete: async () => ({ id: 'snapshot' }) };
    const source = { collect: async () => ({ evaluatedSources: ['TRENDS'], sourceState: { TRENDS: 'AVAILABLE' }, facts: [{ type: 'TREND_RISING', source: 'TRENDS', sourceId: 'trend', subject: 'Forza', stateValue: 'RISING', summary: 'Subiu.', impact: 'Observar.', confidence: .8, limitations: [], evidence: ['Dado.'], observedAt: new Date(), metadata: { channelContextIds: ['ctx'] } }] }) };
    await new StrategicMonitoringService(signals, snapshots, source, () => new Date(), { relate: async (...input) => related.push(input) }).evaluate(); assert.deepEqual(related[0], ['ctx', 'INFORMS', 'STRATEGIC_SIGNAL', 'signal-1']);
  });
  test('Analytics context exposes the same bounded temporal memory contract', async () => {
    const empty = { findAll: async () => [] }; const intelligence = new CreatorIntelligenceService({ ideaRepository: empty, opportunityRepository: empty, decisionRepository: empty,
      insightRepository: { findByProject: async () => [] }, channelContextResolver: { resolve: async () => ({ entries: [{ id: 'ctx', type: 'FACT', status: 'CONFIRMED', category: 'STRATEGY', subject: 'Shorts', statement: 'Descoberta.', confidence: 1, occurredAt: null, periodStart: null, periodEnd: null }] }) } });
    const context = await intelligence.buildContext(); assert.equal(context.temporalContext[0].id, 'ctx'); assert.equal(context.temporalContext[0].type, 'FACT');
  });
});
