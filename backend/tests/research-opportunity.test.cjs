const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const {
  classifyResearchIntent, freshnessFor, normalizeResearchRequest,
} = require('../dist/services/research/ResearchNormalization');
const { OpportunityDiscoveryService } = require('../dist/services/research/OpportunityDiscoveryService');
const { InternalResearchProvider } = require('../dist/services/research/InternalResearchProvider');
const {
  ResearchProviderUnavailableError, ResearchService,
} = require('../dist/services/research/ResearchService');
const { ResearchHistoryRepository } = require('../dist/database/repositories/ResearchHistoryRepository');
const { ResearchOpportunityRepository } = require('../dist/database/repositories/ResearchOpportunityRepository');
const { DatabaseService } = require('../dist/database/DatabaseService');
const { createResearchRouter } = require('../dist/routes/research');
const { CapabilityRegistry } = require('../dist/services/orchestration/CapabilityRegistry');
const { createManagerOrchestrationPlan } = require('../dist/services/orchestration/ManagerPlanner');
const { classifyManagerIntent } = require('../dist/services/orchestration/ManagerIntentInterpreter');
const { createDefaultCapabilityRegistry } = require('../dist/services/orchestration/OrchestrationComposition');
const { PlannerService } = require('../dist/services/PlannerService');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');

const now = new Date('2026-09-03T12:00:00.000Z');
const source = (id = 'internal', freshness = 'RECENT', quality = 'GOOD') => ({
  id, provider: id, label: id, kind: id === 'external' ? 'EXTERNAL' : 'INTERNAL',
  collectedAt: now.toISOString(), freshness, quality, limitations: [],
});
const evidence = (id, sourceId = 'internal', signal = 'RISING') => ({
  id, sourceId, classification: 'inference', summary: `Evidence ${id}`, relevance: 0.9,
  confidence: 0.8, observedAt: now.toISOString(), freshness: 'RECENT', context: { signal },
});
const candidate = (key = 'game:beamng', evidenceIds = ['e1'], sourceIds = ['internal']) => ({
  key, label: 'BeamNG.drive', type: 'GAME', summary: 'Candidato interno', relevance: 0.9,
  confidence: 0.8, sourceIds, evidenceIds, context: { explored: false },
});
const providerResult = (id = 'internal') => ({ source: source(id), evidence: [evidence(`e-${id}`, id)], candidates: [candidate('game:beamng', [`e-${id}`], [id])] });

describe('research normalization and freshness', () => {
  test('classifies all discovery families deterministically', () => {
    assert.equal(classifyResearchIntent('procure jogos de simulador'), 'GAME_DISCOVERY');
    assert.equal(classifyResearchIntent('qual lacuna de conteúdo existe?'), 'CONTENT_GAP');
    assert.equal(classifyResearchIntent('tem algum tema surgindo?'), 'TREND_RESEARCH');
    assert.equal(classifyResearchIntent('qual interesse da audiência?'), 'AUDIENCE_OPPORTUNITY');
    assert.equal(classifyResearchIntent('demanda de busca no YouTube'), 'SEARCH_DEMAND');
    assert.equal(classifyResearchIntent('investigue esta ideia'), 'IDEA_RESEARCH');
  });
  test('normalizes request without mutating input', () => {
    const input = { query: '  Jogos de Corrida? ', projectId: ' p1 ', subjectType: 'GAME' };
    const copy = structuredClone(input); const query = normalizeResearchRequest(input);
    assert.equal(query.normalized, 'jogos de corrida'); assert.equal(query.projectId, 'p1'); assert.deepEqual(input, copy);
  });
  test('rejects invalid and unbounded requests', () => {
    assert.throws(() => normalizeResearchRequest({ query: ' ' }), /query/);
    assert.throws(() => normalizeResearchRequest({ query: 'ok', intent: 'FAKE' }), /intent/);
    assert.throws(() => normalizeResearchRequest({ query: 'x'.repeat(501) }), /500/);
  });
  test('classifies recent, aging, stale and missing timestamps', () => {
    assert.equal(freshnessFor(new Date(now.getTime() - 1_000), now), 'RECENT');
    assert.equal(freshnessFor(new Date(now.getTime() - 2 * 86_400_000), now), 'AGING');
    assert.equal(freshnessFor(new Date(now.getTime() - 8 * 86_400_000), now), 'STALE');
    assert.equal(freshnessFor(null, now), 'MISSING');
  });
});

describe('internal provider and opportunity discovery', () => {
  const empty = { findAll: async () => [] };
  test('normalizes internal trends, series, ideas, games and audience with explicit origin', async () => {
    const provider = new InternalResearchProvider({
      snapshots: { findAll: async () => [{ id: 's1', game: 'BeamNG.drive', format: 'LONG_FORM', views: 100, confidence: 1, collectedAt: now }] },
      trends: { findAll: async () => [{ id: 't1', subject: 'BeamNG.drive', subjectType: 'GAME', metric: 'views', classification: 'RISING', confidence: 0.8, sampleSize: 6, detectedAt: now }] },
      series: { findAll: async () => [{ id: 'sr1', name: 'Desafios', videoLinks: [{ id: 'l1' }], updatedAt: now }] },
      patterns: empty,
      ideas: { findAll: async () => [{ id: 'i1', game: 'Assetto Corsa', theme: 'Teste', format: 'LONG_FORM', identityFit: 80, updatedAt: now }] },
      audience: { findAll: async () => [{ id: 'a1', dimension: 'traffic_source', segment: 'YOUTUBE_SEARCH', views: 40, qualityAtCollection: 'GOOD', collectedAt: now }] },
    }, () => now);
    const result = await provider.search(normalizeResearchRequest({ query: 'jogos de simulador' }));
    assert.equal(result.source.kind, 'INTERNAL'); assert.ok(result.candidates.some(({ label }) => label === 'BeamNG.drive'));
    assert.ok(result.candidates.some(({ label }) => label === 'Assetto Corsa'));
    assert.ok(result.evidence.every(({ sourceId }) => sourceId === provider.id));
    assert.match(result.source.limitations.join(' '), /demanda externa/i);
  });
  test('ranks relevant candidates deterministically and preserves inputs', () => {
    const input = [providerResult()]; const copy = structuredClone(input);
    const result = new OpportunityDiscoveryService().discover(normalizeResearchRequest({ query: 'BeamNG' }), input);
    assert.equal(result[0].subject, 'BeamNG.drive'); assert.equal(result[0].state, 'WATCH');
    assert.ok(result[0].gaps.some((item) => /não possui conteúdo/i.test(item))); assert.deepEqual(input, copy);
  });
  test('preserves conflicting sources instead of hiding disagreement', () => {
    const first = providerResult('internal');
    const second = { source: source('external'), evidence: [evidence('e-external', 'external', 'DECLINING')],
      candidates: [candidate('game:beamng', ['e-external'], ['external'])] };
    const result = new OpportunityDiscoveryService().discover(normalizeResearchRequest({ query: 'BeamNG' }), [first, second])[0];
    assert.equal(result.state, 'WATCH'); assert.ok(result.risks.some((item) => /conflit/i.test(item)));
    assert.deepEqual(result.sources, ['internal', 'external']);
  });
  test('does not claim performance or exact views', () => {
    const result = new OpportunityDiscoveryService().discover(normalizeResearchRequest({ query: 'BeamNG' }), [providerResult()])[0];
    assert.doesNotMatch(JSON.stringify(result), /vai dar|garante|previs[aã]o de views/i);
    assert.match(result.risks.join(' '), /não garantia/i);
  });
  test('keeps little evidence and content gaps explicit', () => {
    const weak = candidate('game:new', [], ['internal']);
    weak.label = 'Jogo novo'; weak.confidence = 0.1; weak.context = { explored: false };
    const result = new OpportunityDiscoveryService().discover(
      normalizeResearchRequest({ query: 'lacuna de conteúdo', intent: 'CONTENT_GAP' }),
      [{ source: source(), evidence: [], candidates: [weak] }],
    )[0];
    assert.equal(result.state, 'INSUFFICIENT_DATA');
    assert.ok(result.gaps.some((item) => /não possui conteúdo/i.test(item)));
    assert.match(result.nextInvestigation, /mais evidências/i);
  });
  test('returns an honest missing result when internal history is absent', async () => {
    const provider = new InternalResearchProvider({ snapshots: empty, trends: empty, series: empty, patterns: empty, ideas: empty, audience: empty }, () => now);
    const result = await provider.search(normalizeResearchRequest({ query: 'oportunidades' }));
    assert.equal(result.source.quality, 'MISSING'); assert.deepEqual(result.evidence, []); assert.deepEqual(result.candidates, []);
  });
});

class MemoryHistory {
  constructor() { this.rows = []; this.sequence = 0; }
  async create(data) {
    const row = { id: `h${++this.sequence}`, createdAt: data.researchedAt, updatedAt: data.researchedAt, ...structuredClone(data),
      opportunities: data.opportunities.map((item, index) => ({ id: `o${this.sequence}-${index}`, researchHistoryId: `h${this.sequence}`,
        createdAt: data.researchedAt, updatedAt: data.researchedAt, ...structuredClone(item) })) };
    delete row.opportunities.create; this.rows.push(row); return structuredClone(row);
  }
  async findFresh(key, at) { return structuredClone(this.rows.filter((row) => row.cacheKey === key && row.validUntil > at && !['ERROR', 'MISSING'].includes(row.quality)).at(-1) ?? null); }
  async findLatest(key) { return structuredClone(this.rows.filter((row) => row.cacheKey === key && !['ERROR', 'MISSING'].includes(row.quality)).at(-1) ?? null); }
  async findByExecutionKey(key) { return structuredClone(this.rows.find((row) => row.executionKey === key) ?? null); }
  async findById(id) { return structuredClone(this.rows.find((row) => row.id === id) ?? null); }
  async findAll({ projectId, limit = 20 } = {}) { return structuredClone(this.rows.filter((row) => projectId === undefined || row.projectId === projectId).reverse().slice(0, limit)); }
}

describe('research service cache and degraded mode', () => {
  test('caches an identical valid query and avoids duplicate provider work', async () => {
    let calls = 0; const history = new MemoryHistory();
    const provider = { id: 'internal', sourceKind: 'INTERNAL', supports: () => true, search: async () => { calls += 1; return providerResult(); } };
    const service = new ResearchService({ historyRepository: history, opportunityRepository: { findAll: async () => [], findById: async () => null }, providers: [provider], clock: () => now });
    const first = await service.research({ query: 'BeamNG' }); const second = await service.research({ query: '  beamng ' });
    assert.equal(first.cache, 'MISS'); assert.equal(second.cache, 'HIT'); assert.equal(calls, 1); assert.equal(history.rows.length, 1);
  });
  test('force refresh creates comparable history', async () => {
    const history = new MemoryHistory(); const provider = { id: 'internal', sourceKind: 'INTERNAL', supports: () => true, search: async () => providerResult() };
    let tick = now.getTime(); const service = new ResearchService({ historyRepository: history, opportunityRepository: { findAll: async () => [], findById: async () => null }, providers: [provider], clock: () => new Date(tick) });
    const first = await service.research({ query: 'BeamNG' }); tick += 1; const refreshed = await service.refresh(first.historyId);
    assert.equal(refreshed.cache, 'MISS'); assert.equal(history.rows.length, 2);
  });
  test('uses stale last-known-good explicitly when providers fail', async () => {
    const history = new MemoryHistory(); let fail = false;
    const provider = { id: 'internal', sourceKind: 'INTERNAL', supports: () => true, search: async () => { if (fail) throw new Error('private'); return providerResult(); } };
    let tick = now.getTime(); const service = new ResearchService({ historyRepository: history, opportunityRepository: { findAll: async () => [], findById: async () => null }, providers: [provider], cacheTtlMs: 1, clock: () => new Date(tick) });
    await service.research({ query: 'BeamNG' }); fail = true; tick += 10;
    const fallback = await service.research({ query: 'BeamNG' }); assert.equal(fallback.cache, 'STALE_FALLBACK'); assert.equal(fallback.freshness, 'STALE');
    assert.doesNotMatch(JSON.stringify(fallback), /private/);
  });
  test('fails safely when no provider and no valid history exist', async () => {
    const service = new ResearchService({ historyRepository: new MemoryHistory(), opportunityRepository: { findAll: async () => [], findById: async () => null }, providers: [] });
    await assert.rejects(() => service.research({ query: 'tema' }), ResearchProviderUnavailableError);
  });
  test('Game Research sets the neutral game intent and subject for any provider', async () => {
    let received; const history = new MemoryHistory();
    const provider = { id: 'fake', sourceKind: 'INTERNAL', supports: () => true, search: async (query) => { received = query; return providerResult(); } };
    const service = new ResearchService({ historyRepository: history, opportunityRepository: { findAll: async () => [], findById: async () => null }, providers: [provider], clock: () => now });
    await service.researchGames({ query: 'jogos para testar' });
    assert.equal(received.intent, 'GAME_DISCOVERY'); assert.equal(received.subjectType, 'GAME');
  });
});

describe('research persistence and HTTP contracts', { concurrency: false }, () => {
  let client; let history; let opportunities; let server; let baseUrl;
  before(async () => {
    client = await DatabaseService.connect();
    await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await client.$executeRawUnsafe('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)');
    const fs = require('node:fs'); const path = require('node:path');
    const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260903120000_research_opportunity_discovery/migration.sql'), 'utf8');
    for (const statement of migration.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
    history = new ResearchHistoryRepository(client); opportunities = new ResearchOpportunityRepository(client);
    const service = new ResearchService({ historyRepository: history, opportunityRepository: opportunities,
      providers: [{ id: 'internal', sourceKind: 'INTERNAL', supports: () => true, search: async () => providerResult() }], clock: () => now });
    const app = express(); app.use(express.json()); app.use(createResearchRouter(service));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });
  const request = async (path, options) => { const response = await fetch(`${baseUrl}${path}`, options); return { status: response.status, body: await response.json() }; };
  test('persists research, sources and normalized opportunities in SQLite', async () => {
    const response = await request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'BeamNG' }) });
    assert.equal(response.status, 200); assert.equal(response.body.opportunities.length, 1);
    assert.equal((await history.findAll()).length, 1); assert.equal((await opportunities.findAll()).length, 1);
  });
  test('lists and opens opportunities with origin and date', async () => {
    const list = await request('/opportunities'); assert.equal(list.status, 200); assert.equal(list.body.length, 1);
    const detail = await request(`/opportunities/${list.body[0].id}`); assert.equal(detail.status, 200);
    assert.equal(detail.body.query, 'BeamNG'); assert.ok(detail.body.researchedAt); assert.equal(detail.body.sources[0], 'internal');
  });
  test('exposes game, topic, history and refresh contracts', async () => {
    assert.equal((await request('/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"jogos"}' })).status, 200);
    assert.equal((await request('/topics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"temas"}' })).status, 200);
    const list = await request('/history?limit=10'); assert.equal(list.status, 200); assert.ok(list.body.length >= 3);
    assert.equal((await request(`/history/${list.body[0].historyId}`)).status, 200);
    assert.equal((await request(`/history/${list.body[0].historyId}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 200);
  });
  test('rejects unexpected fields and missing records safely', async () => {
    assert.equal((await request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"x","secret":"no"}' })).status, 400);
    assert.equal((await request('/opportunities/missing')).status, 404);
    assert.equal((await request('/history/missing')).status, 404);
    assert.equal((await request('/history/missing/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"extra":true}' })).status, 400);
    assert.equal((await request('/opportunities?state=UNKNOWN')).status, 400);
  });
});

describe('Gerente and Decision integration', () => {
  test('routes explicit investigation to Research without researching ordinary questions', () => {
    assert.equal(classifyManagerIntent('procure jogos que combinem com meu canal'), 'RESEARCH_DISCOVERY');
    assert.equal(classifyManagerIntent('meu CTR está bom?'), 'CTR_ANALYSIS');
    const registry = new CapabilityRegistry();
    for (const [id, tags] of [['research.discover', ['research']], ['creator-intelligence.decide', ['editorial-decision']], ['planner.respond', ['response']]]) {
      registry.register({ id, responsibility: id, inputs: [], outputs: [], availability: 'available', capabilityTags: tags,
        dependencies: id === 'creator-intelligence.decide' ? ['research.discover'] : [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false }, async () => ({ summary: id }));
    }
    const plan = createManagerOrchestrationPlan({ intent: 'procure jogos', managerIntent: 'RESEARCH_DISCOVERY' }, registry);
    assert.deepEqual(plan.capabilities, ['research.discover', 'creator-intelligence.decide', 'planner.respond']);
    assert.deepEqual(plan.steps[1].dependencies, ['research-discover']);
  });
  test('passes normalized Research opportunities into EditorialDecisionService', async () => {
    let received;
    const dependencies = {
      intelligence: { listPerformanceRecords: async () => [], listPerformanceSignals: async () => [], getPerformanceBaseline: async () => ({}) },
      editorial: { generate: async (input) => { received = input; return { decision: { id: 'd1', recommendation: 'Teste', nextAction: 'Investigue', confidence: 0.5, category: 'TEST', score: 50, intent: 'next_content', candidateType: 'GAME', candidateKey: 'g', evidence: [], risks: [], missingData: [], favorableEvidence: [], contraryEvidence: [], constraints: [] } }; }, compareCandidates: async () => { throw new Error('unused'); }, list: async () => [] },
      outcomes: { listOutcomes: async () => [] }, refresh: { listStates: async () => [], refreshAvailable: async () => ({ reviewed: 0, unchanged: 0, failed: 0 }) },
      supervisor: { getSupervisorOverview: async () => ({ youtubeAnalytics: { state: 'connected' }, editorial: { risks: [], actions: [] }, outcomeReviews: { reviewAvailable: 0 }, dataQuality: [], channelOperators: [] }) },
      library: { listItems: async () => [] }, youtube: { sync: async () => ({ created: 0, updated: 0 }) },
      channelOperators: { run: async () => ({ id: 'x', name: 'x', status: 'NOT_CONFIGURED', facts: [], insights: [], signals: [], recommendations: [], missingData: [], confidence: 0, sampleSize: 0 }) },
      audience: { summary: async () => ({ facts: [], signals: [], recommendations: [], missingData: [], confidence: 0, trafficSources: [], countries: [], devices: [], quality: {} }), traffic: async () => ({ sources: [], signals: [], missingData: [], quality: {} }) },
      research: { research: async () => ({ historyId: 'h1', quality: 'GOOD', freshness: 'RECENT', limitations: [], results: [], opportunities: [{ key: 'game:g', subject: 'Game G', subjectType: 'GAME', state: 'PROMISING', summary: 'Sinal', sources: ['internal'], freshness: 'RECENT', compatibility: 0.7, confidence: 0.7, evidence: [], risks: [], gaps: [], nextInvestigation: 'Compare' }] }) },
    };
    const registry = createDefaultCapabilityRegistry(dependencies);
    const researchOutput = await registry.get('research.discover').execute({ request: { intent: 'pesquise jogo', managerIntent: 'RESEARCH_DISCOVERY' }, plan: {}, results: new Map() });
    const results = new Map([['research-discover', { capabilityId: 'research.discover', status: 'completed', durationMs: 1, output: researchOutput }]]);
    await registry.get('creator-intelligence.decide').execute({ request: { intent: 'pesquise jogo', managerIntent: 'RESEARCH_DISCOVERY' }, plan: {}, results });
    assert.equal(received.researchOpportunities[0].subject, 'Game G');
  });
  test('Planner delegates a research question to the Gerente and persists only its answer', async () => {
    const created = []; let received;
    const conversation = { id: 'conversation', projectId: null, context: null, messages: [
      { id: 'user', sender: 'user', text: 'procure jogos que combinem com meu canal', createdAt: now },
    ] };
    const planner = new PlannerService(
      { findById: async () => conversation },
      { create: async (data) => { const row = { id: 'operator', ...data }; created.push(row); return row; } },
      undefined, undefined, undefined, undefined, undefined,
      { query: async (input) => { received = input; return { correlationId: 'research-run', answer: 'Compare os candidatos encontrados.', decision: null }; } },
    );
    const reply = await planner.generateReply('conversation');
    assert.equal(received.message, conversation.messages[0].text);
    assert.equal(reply.text, 'Compare os candidatos encontrados.');
    assert.equal(reply.orchestrationExecutionId, 'research-run'); assert.equal(created.length, 1);
  });
  test('Supervisor exposes Research quality and conflicts without triggering discovery', async () => {
    let calls = 0;
    const supervisor = new SupervisorModule(
      { getStatus: async () => ({ state: 'connected', lastSyncAt: now, lastErrorType: null }) },
      { list: async () => [] }, { getOperationalStatus: async () => ({ current: 0, reviewAvailable: 0, stale: 0, insufficientData: 0, recentFailures: 0 }) },
      { getOperationalSummary: async () => ({ awaitingReview: 0, approved: 0, rejected: 0, expired: 0, executedRecently: 0, blockedRecently: 0 }) },
      { getOperationalSummary: async () => ({ total: 0, active: 0, paused: 0, blocked: 0, error: 0, due: 0 }) },
      { countByStatuses: async () => 0 }, { getHealth: () => ({ status: 'stopped' }) },
      { getSummary: async () => ({ healthy: 0, degraded: 0, blocked: 0, failing: 0, disabled: 0, quotasReached: 0, pausedByFailure: 0, approvalsPending: 0, retriesPending: 0 }) },
      { list: async () => [] },
      { getStatus: async () => ({ state: 'connected', quality: { state: 'GOOD', freshness: 'RECENT', reasons: [] } }) },
      { summary: async () => null }, { findRecent: async () => [] },
      { getOperationalSummary: async () => { calls += 1; return { totalResearches: 2, opportunities: 4, lowConfidence: 1, stale: 0, conflicts: 1, quality: 'PARTIAL', freshness: 'AGING', latestAt: now, sources: [{ id: 'internal', kind: 'INTERNAL', freshness: 'AGING', quality: 'GOOD' }] }; } },
    );
    const overview = await supervisor.getSupervisorOverview();
    assert.equal(calls, 1); assert.equal(overview.research.conflicts, 1); assert.equal(overview.research.quality, 'PARTIAL');
    assert.equal(overview.dataQuality.find(({ area }) => area === 'Pesquisa').state, 'PARTIAL');
  });
});
