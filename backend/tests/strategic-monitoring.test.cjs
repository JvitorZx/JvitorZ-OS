const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DATABASE_URL = ':memory:';
const { DatabaseService } = require('../dist/database/DatabaseService');
const { StrategicSignalRepository } = require('../dist/database/repositories/StrategicSignalRepository');
const { MonitoringSnapshotRepository } = require('../dist/database/repositories/MonitoringSnapshotRepository');
const { StrategicMonitoringService } = require('../dist/services/strategic-monitoring');
const { PersistedStrategicMonitoringSource } = require('../dist/services/strategic-monitoring');
const { buildStrategicSignalCandidates, STRATEGIC_SIGNAL_TYPES } = require('../dist/domains/strategic-monitoring');
const { createMonitoringRouter } = require('../dist/routes/monitoring');
const { classifyManagerIntent } = require('../dist/services/orchestration/ManagerIntentInterpreter');
const { isEditorialQuestion } = require('../dist/services/creator-intelligence/EditorialDecisionService');
const { PlannerService } = require('../dist/services/PlannerService');
const { createDefaultCapabilityRegistry } = require('../dist/services/orchestration/OrchestrationComposition');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');

const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260909120000_strategic_monitoring/migration.sql'), 'utf8');
const controlMigration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260910120000_monitoring_control_plane/migration.sql'), 'utf8');
const fact = (overrides = {}) => ({ type: 'TREND_DECLINING', source: 'TRENDS', sourceId: 'ctr-channel', subject: 'CTR do canal',
  stateValue: 'DECLINING', summary: 'CTR foi classificado como DECLINING em janelas comparaveis.', impact: 'Revisar antes de repetir.',
  confidence: .8, limitations: [], evidence: ['Amostra comparavel.'], observedAt: new Date('2026-09-09T10:00:00Z'), ...overrides });

describe('strategic monitoring', { concurrency: false }, () => {
  let client; let service; let source; let now; let server; let baseUrl;
  before(async () => {
    client = await DatabaseService.connect();
    await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await client.$executeRawUnsafe('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)');
    for (const statement of migration.split(';').map((entry) => entry.trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
    for (const statement of controlMigration.split(';').map((entry) => entry.trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
    source = { result: { facts: [fact()], evaluatedSources: ['TRENDS'], sourceState: { TRENDS: 'AVAILABLE' } },
      collect: async () => source.result };
    now = new Date('2026-09-09T12:00:00Z');
    service = new StrategicMonitoringService(new StrategicSignalRepository(client), new MonitoringSnapshotRepository(client), source, () => now);
    const app = express(); app.use(express.json()); app.use(createMonitoringRouter(service));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });
  const request = async (route, options = {}) => { const response = await fetch(`${baseUrl}${route}`, { ...options,
    headers: { 'content-type': 'application/json' } }); return { status: response.status, body: await response.json() }; };

  test('public rules support every requested signal type deterministically', () => {
    const facts = STRATEGIC_SIGNAL_TYPES.map((type, index) => fact({ type, source: `SOURCE-${index}`, sourceId: `${index}` }));
    const first = buildStrategicSignalCandidates(facts); const second = buildStrategicSignalCandidates([...facts].reverse());
    assert.equal(first.length, STRATEGIC_SIGNAL_TYPES.length);
    assert.deepEqual(first.map(({ fingerprint }) => fingerprint), second.map(({ fingerprint }) => fingerprint));
  });

  test('persisted source maps every supported upstream state without reclassifying metrics', async () => {
    const sourceReader = new PersistedStrategicMonitoringSource(
      { findAll: async () => [
        { id: 'trend-down', subject: 'CTR', subjectType: 'CHANNEL', metric: 'ctr', classification: 'DECLINING', delta: -.2, sampleSize: 6, confidence: .8, quality: {}, detectedAt: now },
        { id: 'trend-up', subject: 'Retention', subjectType: 'CHANNEL', metric: 'retention', classification: 'RISING', delta: .2, sampleSize: 6, confidence: .8, quality: {}, detectedAt: now },
      ] },
      { findAll: async () => [{ id: 'series-down' }, { id: 'series-dormant' }] },
      { getById: async (id) => ({ health: { health: id === 'series-down' ? 'DECLINING' : 'DORMANT', confidence: .7,
        missingData: [], reasons: ['Classificacao temporal persistida.'], lastPublishedAt: now, sampleSize: 6, trend: 'DECLINING' },
        series: { name: id } }) },
      { findAll: async () => [
        { id: 'stale', subject: 'Game A', freshness: 'STALE', confidence: .6, gaps: [], summary: 'Stale', state: 'WATCH', researchHistory: { validUntil: new Date('2026-09-08T00:00:00Z'), researchedAt: now } },
        { id: 'expiring', subject: 'Game B', freshness: 'AGING', confidence: .6, gaps: [], summary: 'Expiring', state: 'WATCH', researchHistory: { validUntil: new Date('2026-09-10T00:00:00Z'), researchedAt: now } },
      ] },
      { findCurrent: async () => ({ items: [{ id: 'blocked', planId: 'plan', title: 'Blocked', queue: 'BLOCKED', readiness: 'BLOCKED',
        executionConfidence: .7, missingData: ['research'], constraints: [], rationale: 'Dependency', dependencies: [], updatedAt: now }] }) },
      { findAll: async () => [
        { id: 'contradicted', dimension: 'GAME', subject: 'A', status: 'CONTRADICTED', confidence: .5, limitations: [], description: 'Contradicted', lastObservedAt: now, observationCount: 4, direction: 'MIXED' },
        { id: 'learning-stale', dimension: 'SERIES', subject: 'B', status: 'STALE', confidence: .4, limitations: [], description: 'Stale', lastObservedAt: now, observationCount: 3, direction: 'FAVORABLE' },
      ] },
      { findAll: async () => [{ id: 'experiment', title: 'Test', status: 'INCONCLUSIVE', primaryMetric: 'ctr', confidence: .2,
        result: { classification: 'INSUFFICIENT_EVIDENCE', confidence: .2, limitations: ['small sample'], summary: 'Inconclusive', analyzedAt: now }, updatedAt: now }] },
      { run: async (id) => id === 'ctr'
        ? { id, name: 'CTR', status: 'NOT_CONFIGURED', confidence: 0, missingData: ['CTR'], signals: [], sampleSize: 0, lastDataAt: null }
        : { id, name: 'Retention', status: 'LIMITED', confidence: .4, missingData: [], signals: [], sampleSize: 2, lastDataAt: now,
          quality: { state: 'PARTIAL', freshness: 'STALE', reasons: [], completeness: .5, consistency: 1, sourceReliability: 1 } } },
    );
    const result = await sourceReader.collect(null, now);
    const types = new Set(result.facts.map(({ type }) => type));
    for (const expected of ['TREND_DECLINING', 'TREND_RISING', 'SERIES_DECLINING', 'SERIES_DORMANT', 'OPPORTUNITY_STALE',
      'OPPORTUNITY_EXPIRING', 'PLANNING_BLOCKED', 'EXPERIMENT_INCONCLUSIVE', 'LEARNING_CONTRADICTED', 'LEARNING_STALE',
      'DATA_MISSING', 'DATA_STALE']) assert.equal(types.has(expected), true, expected);
  });

  test('creates one auditable signal and does not duplicate identical evaluations', async () => {
    const first = await service.evaluate(); const second = await service.evaluate();
    assert.equal(first.created, 1); assert.equal(second.unchanged, true);
    assert.equal((await service.list()).length, 1); assert.equal((await service.get(first.signals[0].id)).evidence.length, 1);
  });

  test('concurrent evaluations of identical data persist one snapshot and one signal', async () => {
    const before = await client.monitoringSnapshot.count();
    const results = await Promise.all([service.evaluate(), service.evaluate()]);
    assert.equal(results.every(({ unchanged }) => unchanged), true);
    assert.equal(await client.monitoringSnapshot.count(), before);
    assert.equal((await service.list()).length, 1);
  });

  test('a real source change creates a new snapshot and evidence without duplicating the logical signal', async () => {
    source.result = { ...source.result, facts: [fact({ stateValue: 'DECLINING:STRONGER', summary: 'CTR continua DECLINING com evidencia atualizada.', evidence: ['Nova janela comparavel.'] })] };
    now = new Date('2026-09-09T13:00:00Z'); const result = await service.evaluate();
    assert.equal(result.updated, 1); assert.equal((await service.list()).length, 1);
    assert.equal((await service.get(result.signals[0].id)).evidence.length, 2);
  });

  test('absence in a successfully evaluated source resolves the signal automatically', async () => {
    source.result = { facts: [], evaluatedSources: ['TRENDS'], sourceState: { TRENDS: 'AVAILABLE' } };
    now = new Date('2026-09-09T14:00:00Z'); const result = await service.evaluate();
    assert.equal(result.resolved, 1); assert.equal((await service.list())[0].state, 'RESOLVED');
  });

  test('cooldown suppresses immediate recurrence and permits a later reopening', async () => {
    source.result = { facts: [fact({ stateValue: 'DECLINING:STRONGER', summary: 'CTR continua DECLINING com evidencia atualizada.', evidence: ['Nova janela comparavel.'] })],
      evaluatedSources: ['TRENDS'], sourceState: { TRENDS: 'AVAILABLE' } };
    now = new Date('2026-09-09T15:00:00Z'); await service.evaluate();
    assert.equal((await service.list())[0].state, 'RESOLVED');
    now = new Date('2026-09-11T15:00:00Z'); const reopened = await service.evaluate();
    assert.equal(reopened.updated, 1); assert.equal((await service.list())[0].state, 'NEW');
  });

  test('manual acknowledgement, dismissal and conflict states are persisted safely', async () => {
    const signal = (await service.list())[0];
    assert.equal((await service.acknowledge(signal.id, 'Revisado pelo criador.')).state, 'ACKNOWLEDGED');
    assert.equal((await service.dismiss(signal.id, 'Nao e relevante agora.')).state, 'DISMISSED');
    await assert.rejects(() => service.resolve(signal.id), /closed signal/);
  });

  test('HTTP contracts filter, open, evaluate and sanitize validation errors', async () => {
    assert.equal((await request('/signals?severity=HIGH')).status, 200);
    assert.equal((await request('/signals?severity=INVALID')).status, 400);
    assert.equal((await request('/signals/missing')).status, 404);
    assert.equal((await request('/evaluate', { method: 'POST', body: '{}' })).status, 200);
    assert.equal((await request('/evaluate', { method: 'POST', body: '{"extra":true}' })).status, 400);
  });

  test('manager recognizes monitoring questions as an explicit read-only intent', () => {
    assert.equal(classifyManagerIntent('quais sinais estrategicos precisam de atencao?'), 'STRATEGIC_MONITORING');
    assert.equal(isEditorialQuestion('o que mudou no canal?'), true);
  });

  test('Gerente monitoring capability reads active signals without write side effects', async () => {
    const registry = createDefaultCapabilityRegistry({ monitoring: { list: async () => [{ id: 'signal', state: 'NEW', severity: 'HIGH',
      type: 'PLANNING_BLOCKED', subject: 'Item', summary: 'Blocked', confidence: .8 }] } });
    const capability = registry.get('strategic-monitoring.read');
    assert.equal(capability.definition.sideEffect, 'READ_ONLY');
    const output = await capability.execute({ request: { intent: 'signals' }, plan: {}, results: new Map() });
    assert.match(output.summary, /1 sinal/i); assert.equal(output.data.active.length, 1);
  });

  test('Planner receives bounded monitoring context without changing persisted history', async () => {
    let providerInput;
    const planner = new PlannerService(
      { findById: async () => ({ id: 'conversation', projectId: null, context: null,
        messages: [{ id: 'user', sender: 'user', text: 'Resuma o contexto', createdAt: new Date('2026-09-09T10:00:00Z') }] }) },
      { create: async (data) => ({ id: 'reply', createdAt: new Date(), ...data }) },
      { generate: async (input) => { providerInput = input; return 'Resposta segura'; } },
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { listForPlanner: async () => [{ id: 'signal', type: 'PLANNING_BLOCKED', severity: 'HIGH', subject: 'Video',
        summary: 'Item bloqueado.', confidence: .8, limitations: [], detectedAt: new Date() }] },
    );
    await planner.generateReply('conversation');
    assert.match(providerInput.messages.map(({ content }) => content).join('\n'), /Sinais estrategicos ativos/);
    assert.match(providerInput.messages.map(({ content }) => content).join('\n'), /nao altere ranking/i);
  });

  test('operational summary exposes only active HIGH and CRITICAL signals to Supervisor consumers', async () => {
    source.result = { facts: [fact({ type: 'PLANNING_BLOCKED', source: 'PLANNING', sourceId: 'item', subject: 'Item bloqueado' })],
      evaluatedSources: ['PLANNING', 'TRENDS'], sourceState: { PLANNING: 'AVAILABLE', TRENDS: 'AVAILABLE' } };
    now = new Date('2026-09-12T12:00:00Z'); await service.evaluate();
    const summary = await service.getOperationalSummary();
    assert.ok(summary.high >= 1); assert.ok(summary.signals.every(({ severity }) => ['HIGH', 'CRITICAL'].includes(severity)));
  });

  test('Supervisor exposes monitoring summary without activating or resolving signals', async () => {
    const monitoring = { getOperationalSummary: async () => ({ total: 2, active: 1, high: 1, critical: 0, stale: 0,
      signals: [{ id: 'signal', type: 'PLANNING_BLOCKED', severity: 'HIGH', subject: 'Item', summary: 'Blocked', confidence: .8, detectedAt: now }] }) };
    const supervisor = new SupervisorModule(...Array(15).fill(undefined), monitoring);
    const overview = await supervisor.getSupervisorOverview();
    assert.equal(overview.strategicMonitoring.high, 1);
    assert.equal(overview.strategicMonitoring.signals[0].id, 'signal');
  });

  test('a degraded source marks previous active signals stale instead of resolving them', async () => {
    source.result = { facts: [fact({ sourceId: 'stale-source' })], evaluatedSources: ['TRENDS'], sourceState: { TRENDS: 'AVAILABLE' } };
    now = new Date('2026-09-13T12:00:00Z'); await service.evaluate();
    source.result = { facts: [fact({ type: 'DATA_QUALITY_DEGRADED', sourceId: 'collector', stateValue: 'DEGRADED',
      summary: 'TRENDS nao pode ser avaliado.', impact: 'Preservar sinais.', limitations: ['source unavailable'] })],
      evaluatedSources: [], sourceState: { TRENDS: 'DEGRADED' } };
    now = new Date('2026-09-13T13:00:00Z'); await service.evaluate();
    const stale = (await service.list()).find(({ sourceId }) => sourceId === 'stale-source');
    assert.equal(stale.state, 'STALE');
  });
});
