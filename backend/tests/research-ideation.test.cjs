const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const fs = require('node:fs'); const path = require('node:path'); const express = require('express');
process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ResearchHistoryRepository } = require('../dist/database/repositories/ResearchHistoryRepository');
const { ResearchOpportunityRepository } = require('../dist/database/repositories/ResearchOpportunityRepository');
const { VideoIdeaRepository } = require('../dist/database/repositories/VideoIdeaRepository');
const { ContentPatternRepository } = require('../dist/database/repositories/ContentPatternRepository');
const { ResearchService } = require('../dist/services/research/ResearchService');
const { ResearchIdeationService, ResearchIdeaConflictError } = require('../dist/services/research/ResearchIdeationService');
const { ideaIdentityKey, ideaSimilarity, scoreOpportunity } = require('../dist/domains/research/ResearchIdeation');
const { createResearchRouter } = require('../dist/routes/research');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');
const { classifyManagerIntent } = require('../dist/services/orchestration/ManagerIntentInterpreter');
const { createManagerOrchestrationPlan } = require('../dist/services/orchestration/ManagerPlanner');
const { CapabilityRegistry } = require('../dist/services/orchestration/CapabilityRegistry');

const migrateAll = async (client) => {
  const root = path.resolve(__dirname, '../prisma/migrations');
  for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort()) {
    const sql = fs.readFileSync(path.join(root, directory, 'migration.sql'), 'utf8');
    for (const statement of sql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
  }
};
const evidence = (id, signal = 'RISING') => ({ id, sourceId: 'internal', classification: id.endsWith('h') ? 'hypothesis' : 'fact', summary: `Evidencia ${id}`,
  relevance: .9, confidence: .8, observedAt: '2026-09-15T10:00:00.000Z', freshness: 'RECENT', context: { signal, explored: id.includes('known'), sampleSize: 4 } });
const provider = {
  id: 'internal', sourceKind: 'INTERNAL', supports: () => true,
  search: async () => ({ source: { id: 'internal', provider: 'internal', label: 'Canal', kind: 'INTERNAL', collectedAt: '2026-09-15T10:00:00.000Z', freshness: 'RECENT', quality: 'GOOD', limitations: ['Sem demanda externa.'] },
    evidence: [evidence('game-known-1'), evidence('game-known-2'), evidence('topic-new-1')],
    candidates: [
      { key: 'game:alpha', label: 'Jogo Alpha', type: 'GAME', summary: 'Presente no historico.', relevance: .9, confidence: .8, sourceIds: ['internal'], evidenceIds: ['game-known-1', 'game-known-2'], context: { explored: true, sampleSize: 4 } },
      { key: 'topic:challenge', label: 'Desafio concreto', type: 'TOPIC', summary: 'Lacuna editorial observada.', relevance: .75, confidence: .7, sourceIds: ['internal'], evidenceIds: ['topic-new-1'], context: { explored: false } },
    ] }),
};

describe('Sprint 49 research sessions and ideation', { concurrency: false }, () => {
  let client; let research; let studio; let server; let baseUrl; let memory; let handoffs;
  before(async () => {
    client = await DatabaseService.connect(); await client.$executeRawUnsafe('PRAGMA foreign_keys = ON'); await migrateAll(client);
    const sessions = new ResearchHistoryRepository(client); const opportunities = new ResearchOpportunityRepository(client); const ideas = new VideoIdeaRepository(client);
    research = new ResearchService({ historyRepository: sessions, opportunityRepository: opportunities, providers: [provider], clock: () => new Date('2026-09-15T12:00:00Z') });
    memory = []; handoffs = [];
    studio = new ResearchIdeationService(research, sessions, opportunities, ideas, new ContentPatternRepository(client),
      { addVideoIdea: async (input) => { handoffs.push(structuredClone(input)); return { created: handoffs.length === 1, item: { id: 'plan-item', ...input } }; } },
      { create: async (input) => { memory.push(structuredClone(input)); return input; } }, () => new Date('2026-09-15T12:00:00Z'));
    const app = express(); app.use(express.json()); app.use('/api/research', createResearchRouter(research, studio));
    server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); }); baseUrl = `http://127.0.0.1:${server.address().port}/api/research`;
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });
  beforeEach(async () => { await client.plannedContentItem.deleteMany(); await client.videoIdea.deleteMany(); await client.researchHistory.deleteMany(); memory.length = 0; handoffs.length = 0; });
  const createCompleted = async (input = {}) => { const session = await studio.createSession({ query: 'Qual jogo testar?', objective: 'Criar um video com acontecimento concreto', subjectType: 'GAME', ...input }); return studio.runSession(session.id); };
  const request = async (url, options = {}) => { const response = await fetch(`${baseUrl}${url}`, { headers: { 'content-type': 'application/json' }, ...options }); return { status: response.status, body: await response.json() }; };

  test('score is deterministic, relative, explainable and not a prediction', () => {
    const opportunity = { key: 'g', rank: 1, subject: 'Game', subjectType: 'GAME', state: 'PROMISING', summary: 'Sinal', sources: ['internal'], evidence: [evidence('one')], freshness: 'RECENT', compatibility: .8, confidence: .7, risks: [], gaps: [], nextInvestigation: 'Compare' };
    const first = scoreOpportunity(opportunity, { effort: 'LOW', objective: 'Teste' }); const second = scoreOpportunity(structuredClone(opportunity), { effort: 'LOW', objective: 'Teste' });
    assert.deepEqual(first, second); assert.equal(first.dimensions.length, 10); assert.match(first.disclaimer, /não é probabilidade|nao e probabilidade/i); assert.ok(first.relativeScore <= 100);
  });
  test('missing dimensions and stale evidence lower the quality gate explicitly', () => {
    const result = scoreOpportunity({ key: 'g', rank: 1, subject: 'Game', subjectType: 'GAME', state: 'WATCH', summary: 'Sinal', sources: [], evidence: [], freshness: 'STALE', compatibility: .2, confidence: .1, risks: [], gaps: ['analytics'], nextInvestigation: 'Colete' });
    assert.equal(result.qualityGate, 'INSUFFICIENT_EVIDENCE'); assert.ok(result.missingData.includes('analytics'));
  });
  test('identity and similarity consider structure and preserve input', () => {
    const left = { game: 'Alpha', series: null, format: 'LONG_FORM', premise: 'Missao com desafio real', coreEvent: 'Concluir missao' }; const copy = structuredClone(left);
    assert.equal(ideaIdentityKey(left), ideaIdentityKey(structuredClone(left))); assert.ok(ideaSimilarity(left, { ...left, premise: 'Desafio real durante a missao' }) > .5); assert.deepEqual(left, copy);
  });
  test('session persists evidence, gaps, ranking and audit', async () => {
    const draft = await studio.createSession({ query: 'Jogos', objective: 'Escolher teste', subjectType: 'GAME', constraints: ['esforco: low'] }); assert.equal(draft.status, 'DRAFT');
    const completed = await studio.runSession(draft.id); assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.opportunities[0].rank, 1); assert.equal(completed.evidenceItems.length, 3); assert.ok(completed.contentGaps.length); assert.deepEqual(completed.events.map(({ event }) => event), ['SESSION_CREATED', 'SESSION_RUN_STARTED', 'SESSION_RUN_COMPLETED']);
  });
  test('completed and concurrent runs do not duplicate snapshots', async () => {
    const draft = await studio.createSession({ query: 'Jogos', objective: 'Teste' }); const [a, b] = await Promise.all([studio.runSession(draft.id), studio.runSession(draft.id)]);
    assert.equal(a.id, b.id); assert.equal(await client.researchOpportunity.count({ where: { researchHistoryId: draft.id } }), 2); assert.equal(await client.researchSessionEvent.count({ where: { researchHistoryId: draft.id, event: 'SESSION_RUN_COMPLETED' } }), 1);
  });
  test('rerun creates a new snapshot and archive preserves history', async () => {
    const first = await createCompleted(); const second = await studio.rerunSession(first.id); assert.notEqual(first.id, second.id); assert.equal((await studio.archiveSession(first.id)).status, 'ARCHIVED'); assert.ok(await studio.getSession(second.id));
  });
  test('expired session is presented as stale without rewriting its snapshot', async () => {
    let now = new Date('2026-09-15T12:00:00Z');
    const expiring = new ResearchService({
      historyRepository: new ResearchHistoryRepository(client), opportunityRepository: new ResearchOpportunityRepository(client),
      providers: [provider], clock: () => now, cacheTtlMs: 1_000,
    });
    const draft = await expiring.createSession({ query: 'Teste temporal', objective: 'Observar freshness' });
    await expiring.runSession(draft.id); now = new Date('2026-09-15T12:00:02Z');
    const presented = await expiring.getSession(draft.id);
    assert.equal(presented.freshness, 'STALE'); assert.match(JSON.stringify(presented.limitations), /expirou/i);
    assert.equal((await client.researchHistory.findUniqueOrThrow({ where: { id: draft.id } })).freshness, 'RECENT');
  });
  test('game and content research expose persisted evidence and limitations', async () => {
    const session = await createCompleted(); const games = await studio.listGameCandidates(session.id); const content = await studio.getContentResearch(session.id);
    assert.deepEqual(games.map(({ subject }) => subject), ['Jogo Alpha']); assert.match(content.disclaimer, /não demonstram demanda externa/); assert.ok(content.gaps.length);
  });
  test('idea generation persists provenance, score, hypothesis and exact dedupe', async () => {
    const session = await createCompleted(); const input = { objective: 'Completar um desafio', format: 'LONG_FORM', effort: 'LOW', limit: 2 };
    const first = await studio.generateIdeas(session.id, input); const second = await studio.generateIdeas(session.id, structuredClone(input));
    assert.equal(first.ideas.length, 2); assert.equal(second.ideas.every(({ created }) => !created), true); assert.equal(await client.videoIdea.count(), 2);
    assert.equal(first.ideas[0].idea.sourceResearchHistoryId, session.id); assert.ok(first.ideas[0].idea.opportunityScore); assert.match(first.ideas[0].idea.hypothesis, /não estabelece causalidade/);
  });
  test('idea lifecycle writes Creator Memory only on explicit selection', async () => {
    const session = await createCompleted(); let idea = (await studio.generateIdeas(session.id, { objective: 'Desafio', format: 'LONG_FORM', limit: 1 })).ideas[0].idea;
    idea = await studio.transitionIdea(idea.id, 'SHORTLISTED'); assert.equal(memory.length, 0); idea = await studio.transitionIdea(idea.id, 'SELECTED'); assert.equal(memory.length, 1); assert.equal(memory[0].sourceReference, idea.id);
    await assert.rejects(() => studio.transitionIdea(idea.id, 'CANDIDATE'), ResearchIdeaConflictError);
  });
  test('rejection needs a reason and experiment is explicit', async () => {
    const session = await createCompleted(); const idea = (await studio.generateIdeas(session.id, { objective: 'Teste', format: 'SHORT', limit: 1 })).ideas[0].idea;
    await assert.rejects(() => studio.transitionIdea(idea.id, 'REJECTED')); const rejected = await studio.transitionIdea(idea.id, 'REJECTED', 'Não cabe no calendário atual.'); assert.equal(rejected.rejectionReason, 'Não cabe no calendário atual.');
    const candidate = await studio.transitionIdea(idea.id, 'CANDIDATE'); assert.equal((await studio.markExperiment(candidate.id, { enabled: true, hypothesis: 'Comparar observações reais.' })).isExperiment, true);
  });
  test('edited identity remains unique and concurrent selection keeps one winner', async () => {
    const session = await createCompleted();
    const generated = await studio.generateIdeas(session.id, { objective: 'Teste controlado', format: 'LONG_FORM', limit: 2 });
    const [first, second] = generated.ideas.map(({ idea }) => idea);
    await studio.transitionIdea(first.id, 'SHORTLISTED');
    await studio.transitionIdea(second.id, 'SHORTLISTED');
    const selected = await Promise.allSettled([
      studio.transitionIdea(first.id, 'SELECTED'),
      studio.transitionIdea(second.id, 'SELECTED'),
    ]);
    assert.equal(selected.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(selected.filter(({ status }) => status === 'rejected').length, 1);
    const cloneDraft = { game: first.game, series: first.series, format: first.format, premise: 'Outro acontecimento', coreEvent: 'Outro acontecimento' };
    const clone = await client.videoIdea.create({ data: {
      projectId: first.projectId, theme: first.theme, ...cloneDraft, ideaKey: ideaIdentityKey(cloneDraft),
    } });
    await assert.rejects(
      () => studio.editIdea(clone.id, { premise: first.premise, coreEvent: first.coreEvent }),
      ResearchIdeaConflictError,
    );
  });
  test('Planner handoff is explicit, traceable and idempotent at its boundary', async () => {
    const session = await createCompleted(); let idea = (await studio.generateIdeas(session.id, { objective: 'Teste', format: 'LONG_FORM', limit: 1 })).ideas[0].idea; idea = await studio.transitionIdea(idea.id, 'SHORTLISTED');
    assert.equal((await studio.sendToPlanner(idea.id)).created, true); assert.equal((await studio.sendToPlanner(idea.id)).created, false); assert.equal((await studio.getIdea(idea.id)).status, 'PLANNED'); assert.equal(handoffs[0].researchHistoryId, session.id);
  });
  test('HTTP session, run, ideas and strict payload contracts work', async () => {
    let response = await request('/sessions', { method: 'POST', body: JSON.stringify({ query: 'Jogos', objective: 'Teste', subjectType: 'GAME' }) }); assert.equal(response.status, 201); const id = response.body.id;
    response = await request(`/sessions/${id}/run`, { method: 'POST', body: '{}' }); assert.equal(response.status, 200); response = await request(`/sessions/${id}/ideas/generate`, { method: 'POST', body: JSON.stringify({ objective: 'Desafio', format: 'LONG_FORM', limit: 1 }) }); assert.equal(response.status, 201);
    assert.equal((await request('/sessions', { method: 'POST', body: JSON.stringify({ query: 'x', extra: true }) })).status, 400); assert.equal((await request('/sessions?status=MADE_UP')).status, 400); assert.equal((await request('/ideas?limit=999')).status, 400);
  });
  test('HTTP invalid transitions expose no internal details', async () => {
    const session = await createCompleted(); const idea = (await studio.generateIdeas(session.id, { objective: 'Teste', format: 'LONG_FORM', limit: 1 })).ideas[0].idea;
    const response = await request(`/ideas/${idea.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'PLANNED' }) }); assert.equal(response.status, 409); assert.doesNotMatch(JSON.stringify(response.body), /Prisma|stack|SELECT|database/i);
  });
  test('Manager routes ideation to only the modular research capability', () => {
    for (const prompt of ['me da tres ideias de jogo', 'qual proximo jogo vale testar?', 'quero algo barato de produzir', 'o que devo gravar agora?']) assert.equal(classifyManagerIntent(prompt), 'RESEARCH_DISCOVERY');
    const registry = new CapabilityRegistry(); for (const [id, tags] of [['research.discover', ['research']], ['planner.respond', ['response']]]) registry.register({ id, responsibility: id, inputs: [], outputs: [], availability: 'available', dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false, capabilityTags: tags }, async () => ({}));
    assert.deepEqual(createManagerOrchestrationPlan({ intent: 'me de ideias', managerIntent: 'RESEARCH_DISCOVERY' }, registry).capabilities, ['research.discover', 'planner.respond']);
  });
  test('Supervisor quality gate distinguishes research states', () => {
    const supervisor = new SupervisorModule(); assert.equal(supervisor.reviewResearch({ evidenceCount: 2, freshness: 'RECENT', scoreExplainable: true, hypothesisMarked: true }).outcome, 'READY');
    assert.equal(supervisor.reviewResearch({ evidenceCount: 0, freshness: 'MISSING' }).outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(supervisor.reviewResearch({ evidenceCount: 2, freshness: 'STALE' }).outcome, 'STALE'); assert.equal(supervisor.reviewResearch({ evidenceCount: 2, freshness: 'RECENT', conflictingEvidence: true }).outcome, 'NEEDS_REVIEW');
  });
});
