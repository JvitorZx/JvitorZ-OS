const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const fs = require('node:fs'); const path = require('node:path'); const express = require('express');
process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ProductionRepository } = require('../dist/database/repositories/ProductionRepository');
const { PackagingRepository } = require('../dist/database/repositories/PackagingRepository');
const { ProductionService, ProductionConflictError, ProductionNotFoundError } = require('../dist/services/production');
const { PackagingService } = require('../dist/services/packaging');
const { productionWorkflowFor, resolveProductionNextAction } = require('../dist/domains/production');
const { createProductionRouter } = require('../dist/routes/production');
const { classifyManagerIntent } = require('../dist/services/orchestration/ManagerIntentInterpreter');
const { createDefaultCapabilityRegistry } = require('../dist/services/orchestration/OrchestrationComposition');

const migrateAll = async (client) => {
  const root = path.resolve(__dirname, '../prisma/migrations');
  for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort()) {
    const sql = fs.readFileSync(path.join(root, directory, 'migration.sql'), 'utf8');
    for (const statement of sql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
  }
};
const details = (id = 'direct-video', format = 'LONG_FORM') => ({ title: `Video ${id}`, format, productionKey: id, summary: 'Uma corrida terminou com o carro quebrado.', keyEvents: ['o carro quebrou no fim da corrida'] });

describe('persistent content production pipeline', { concurrency: false }, () => {
  let client; let repository; let packaging; let service; let server; let baseUrl; let contextCalls;
  const approved = { reviewProduction: () => ({ outcome: 'APPROVED', findings: [] }) };
  before(async () => {
    client = await DatabaseService.connect(); await client.$executeRawUnsafe('PRAGMA foreign_keys = ON'); await migrateAll(client);
    repository = new ProductionRepository(client); contextCalls = [];
    const resolver = { resolve: async (input) => { contextCalls.push(input); return { entries: [], truncated: false }; } };
    packaging = new PackagingService(new PackagingRepository(client), resolver, { create: async (entry) => ({ id: 'memory', ...entry }), relate: async () => {} }, { findAll: async () => [] }, { findAll: async () => [] }, () => new Date('2026-09-13T12:00:00Z'));
    service = new ProductionService(repository, packaging, approved, resolver, () => new Date('2026-09-13T12:00:00Z'));
    const app = express(); app.use(express.json()); app.use('/api/production', createProductionRouter(service));
    server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); }); baseUrl = `http://127.0.0.1:${server.address().port}/api/production`;
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });
  beforeEach(async () => {
    await client.productionAssetRelation.deleteMany(); await client.productionEvent.deleteMany(); await client.productionStep.deleteMany(); await client.contentProduction.deleteMany();
    await client.packagingMetricSnapshot.deleteMany(); await client.packagingExperiment.deleteMany(); await client.packagingHistory.deleteMany(); await client.packagingVariant.deleteMany(); await client.contentPackaging.deleteMany();
    await client.planningExecutionEvent.deleteMany(); await client.planningHistory.deleteMany(); await client.plannedContentItem.deleteMany(); await client.contentPlan.deleteMany(); await client.seriesDefinition.deleteMany(); await client.libraryItem.deleteMany(); contextCalls.length = 0;
  });
  const request = async (url = '', options = {}) => { const response = await fetch(`${baseUrl}${url}`, { headers: { 'content-type': 'application/json' }, ...options }); return { status: response.status, body: await response.json() }; };
  const startComplete = async (productionId, stepKey) => { await service.startStep(productionId, stepKey); return service.completeStep(productionId, stepKey); };
  const reachPackaging = async (productionId) => { await startComplete(productionId, 'PREPARING'); await startComplete(productionId, 'EDITING'); const row = await service.get(productionId); if (row.steps.some(({ key }) => key === 'CHAPTERS')) { await service.skipStep(productionId, 'CHAPTERS', { reason: 'Sem capitulos neste fluxo.' }); await service.skipStep(productionId, 'SHORTS', { reason: 'Sem clipping automatico.' }); } };
  const reachReady = async (productionId) => { await reachPackaging(productionId); const generated = await service.runPackaging(productionId); await packaging.selectVariant(generated.packaging.variants[0].id, 'Escolha manual'); await service.completeStep(productionId, 'PACKAGING'); return service.review(productionId); };

  test('workflow templates keep long-form modular and Short minimal', () => {
    assert.deepEqual(productionWorkflowFor('LONG_FORM').map(({ key }) => key), ['PREPARING', 'EDITING', 'CHAPTERS', 'SHORTS', 'PACKAGING', 'REVIEW']);
    assert.deepEqual(productionWorkflowFor('SHORT').map(({ key }) => key), ['PREPARING', 'EDITING', 'PACKAGING', 'REVIEW']);
    assert.equal(productionWorkflowFor('LONG_FORM').find(({ key }) => key === 'CHAPTERS').mode, 'ASSISTED');
  });
  test('next action resolver is deterministic across dependencies, failure and publication', () => {
    const steps = productionWorkflowFor('SHORT').map((step, index) => ({ ...step, position: index + 1, state: index ? 'NOT_STARTED' : 'AVAILABLE' }));
    assert.equal(resolveProductionNextAction('PLANNED', steps).stepKey, 'PREPARING');
    steps[0].state = 'FAILED'; assert.equal(resolveProductionNextAction('IN_PRODUCTION', steps).type, 'RETRY');
    assert.equal(resolveProductionNextAction('READY_TO_PUBLISH', steps).type, 'PUBLISH_EXTERNALLY');
  });
  test('creates one persistent workflow and preserves idempotent identity', async () => {
    const input = details(); const first = await service.create(input); const second = await service.create(structuredClone(input));
    assert.equal(first.created, true); assert.equal(second.created, false); assert.equal(first.production.id, second.production.id); assert.equal(await client.contentProduction.count(), 1); assert.equal(first.production.steps.length, 6);
  });
  test('planned item and Series link to one production without duplicating Planner', async () => {
    const series = await client.seriesDefinition.create({ data: { key: 'city-series', name: 'Vida de Motorista', normalizedKey: 'vida-de-motorista' } });
    const plan = await client.contentPlan.create({ data: { horizon: 'TODAY', status: 'ACTIVE', summary: 'Plano', balance: {}, constraints: [], risks: [], source: {}, generatedAt: new Date(), items: { create: { candidateKey: 'city-9', candidateType: 'SHORT', title: 'City Car Ep. 9', rationale: 'Continuidade', status: 'READY', priority: 'HIGH', effort: 'MEDIUM', readiness: 'READY', queue: 'NEXT', position: 1, executionScore: 80, evidence: [], risks: [], constraints: [], missingData: [], dependencies: [], seriesId: series.id } } } });
    const item = await client.plannedContentItem.findFirstOrThrow({ where: { planId: plan.id } });
    const first = await service.create({ plannedContentItemId: item.id, seriesId: series.id }); const repeated = await service.create({ plannedContentItemId: item.id });
    assert.equal(first.production.title, 'City Car Ep. 9'); assert.equal(first.production.format, 'SHORT'); assert.equal(first.production.seriesDefinition.id, series.id); assert.equal(repeated.created, false);
  });
  test('steps start and complete once under concurrent duplicate requests', async () => {
    const { production } = await service.create(details('concurrent'));
    const [a, b] = await Promise.all([service.startStep(production.id, 'PREPARING'), service.startStep(production.id, 'PREPARING')]);
    assert.equal(a.steps[0].state, 'IN_PROGRESS'); assert.equal(b.steps[0].state, 'IN_PROGRESS'); assert.equal(await client.productionEvent.count({ where: { productionId: production.id, event: 'STEP_STARTED' } }), 1);
    await Promise.all([service.completeStep(production.id, 'PREPARING'), service.completeStep(production.id, 'PREPARING')]);
    assert.equal(await client.productionEvent.count({ where: { productionId: production.id, event: 'STEP_COMPLETED' } }), 1);
  });
  test('dependency progression and resume preserve the existing workflow', async () => {
    const { production } = await service.create(details('resume', 'SHORT')); await startComplete(production.id, 'PREPARING');
    const resumed = await service.resume(production.id); assert.equal(resumed.nextAction.stepKey, 'EDITING'); assert.equal(resumed.steps.find(({ key }) => key === 'EDITING').state, 'AVAILABLE'); assert.equal(await client.contentProduction.count(), 1);
  });
  test('optional manual Chapters and Shorts can be skipped but required steps cannot', async () => {
    const { production } = await service.create(details('skip')); await startComplete(production.id, 'PREPARING'); await startComplete(production.id, 'EDITING');
    const chapters = await service.skipStep(production.id, 'CHAPTERS', { reason: 'Sem capitulos' }); assert.equal(chapters.steps.find(({ key }) => key === 'CHAPTERS').state, 'SKIPPED');
    await assert.rejects(() => service.skipStep(production.id, 'PACKAGING'), ProductionConflictError);
  });
  test('failed assisted work is auditable and can be retried safely', async () => {
    const failing = new ProductionService(repository, { generate: async () => { throw new Error('private payload'); } }, approved, { resolve: async () => ({ entries: [] }) });
    const { production } = await failing.create(details('retry', 'SHORT')); await startComplete(production.id, 'PREPARING'); await startComplete(production.id, 'EDITING');
    await assert.rejects(() => failing.runPackaging(production.id), ProductionConflictError); let row = await failing.get(production.id); assert.equal(row.steps.find(({ key }) => key === 'PACKAGING').state, 'FAILED');
    row = await failing.retryStep(production.id, 'PACKAGING'); assert.equal(row.steps.find(({ key }) => key === 'PACKAGING').state, 'AVAILABLE'); assert.ok(row.events.some(({ event }) => event === 'STEP_FAILED'));
  });
  test('real Packaging is linked once and resume never regenerates valid variants', async () => {
    const { production } = await service.create(details('packaging', 'SHORT')); await reachPackaging(production.id);
    const first = await service.runPackaging(production.id); const second = await service.runPackaging(production.id);
    assert.equal(first.created, true); assert.equal(second.created, false); assert.equal(first.packaging.id, second.packaging.id); assert.equal(await client.contentPackaging.count(), 1); assert.equal(contextCalls.length, 2);
  });
  test('Supervisor is a persisted quality gate and approved content becomes READY_TO_PUBLISH', async () => {
    const { production } = await service.create(details('ready', 'SHORT')); const ready = await reachReady(production.id);
    assert.equal(ready.status, 'READY_TO_PUBLISH'); assert.equal(ready.steps.find(({ key }) => key === 'REVIEW').state, 'COMPLETED'); assert.ok(ready.events.some(({ event }) => event === 'SUPERVISOR_REVIEWED'));
  });
  test('Supervisor NEEDS_CHANGES preserves all outputs for correction', async () => {
    const local = new ProductionService(repository, packaging, { reviewProduction: () => ({ outcome: 'NEEDS_CHANGES', findings: ['Ajustar embalagem.'] }) }, { resolve: async () => ({ entries: [] }) });
    const { production } = await local.create(details('needs-changes', 'SHORT')); await startComplete(production.id, 'PREPARING'); await startComplete(production.id, 'EDITING'); const generated = await local.runPackaging(production.id); await packaging.selectVariant(generated.packaging.variants[0].id); await local.completeStep(production.id, 'PACKAGING'); const reviewed = await local.review(production.id);
    assert.equal(reviewed.status, 'IN_REVIEW'); assert.equal(reviewed.steps.find(({ key }) => key === 'REVIEW').state, 'WAITING_USER'); assert.equal(reviewed.packaging.id, generated.packaging.id);
  });
  test('significant edits version the production and invalidate only downstream outputs', async () => {
    const { production } = await service.create(details('invalidate', 'SHORT')); const ready = await reachReady(production.id); const changed = await service.update(ready.id, { summary: 'O final real foi alterado depois da revisao.' });
    assert.equal(changed.version, 2); assert.equal(changed.steps.find(({ key }) => key === 'PACKAGING').state, 'OUTDATED'); assert.equal(changed.steps.find(({ key }) => key === 'REVIEW').state, 'OUTDATED'); assert.equal(changed.steps.find(({ key }) => key === 'EDITING').state, 'COMPLETED'); assert.ok(changed.packaging);
  });
  test('Library assets are referenced without copy and duplicate links remain idempotent', async () => {
    const asset = await client.libraryItem.create({ data: { title: 'Video bruto', type: 'ASSET', content: 'local://raw.mp4' } }); const { production } = await service.create(details('asset'));
    await service.linkAsset(production.id, asset.id, 'RAW_VIDEO'); const linked = await service.linkAsset(production.id, asset.id, 'RAW_VIDEO');
    assert.equal(linked.assets.length, 1); assert.equal(linked.assets[0].libraryItem.content, 'local://raw.mp4');
  });
  test('publication is an explicit external link and does not write to YouTube', async () => {
    const { production } = await service.create(details('published', 'SHORT')); const ready = await reachReady(production.id); const published = await service.publish(ready.id, { videoId: 'youtube-47', url: 'https://youtube.com/watch?v=youtube-47' }); const repeated = await service.publish(ready.id, { videoId: 'youtube-47' });
    assert.equal(published.status, 'PUBLISHED'); assert.equal(published.publishedVideoId, 'youtube-47'); assert.equal(repeated.id, published.id); assert.equal(await client.productionEvent.count({ where: { productionId: ready.id, event: 'PUBLICATION_LINKED' } }), 1);
  });
  test('cancel keeps history and invalid production steps return domain-safe errors', async () => {
    const { production } = await service.create(details('cancel')); const cancelled = await service.cancel(production.id, 'Mudanca editorial');
    assert.equal(cancelled.status, 'CANCELLED'); assert.ok(cancelled.events.some(({ event }) => event === 'PRODUCTION_CANCELLED')); await assert.rejects(() => service.startStep(production.id, 'MISSING'), ProductionNotFoundError);
  });
  test('Manager recognizes production and reuses the same next-action contract', async () => {
    assert.equal(classifyManagerIntent('Continua a producao de onde paramos'), 'PRODUCTION'); let starts = 0;
    const row = { id: 'p', title: 'Forza', status: 'PLANNED', currentStage: 'PREPARING', workflowTemplate: 'SHORT', steps: [], nextAction: { type: 'START', stepKey: 'PREPARING', label: 'Iniciar preparacao' } };
    const registry = createDefaultCapabilityRegistry({ production: { list: async () => [row], create: async () => ({ production: row }), resume: async () => row, startStep: async () => { starts += 1; return { ...row, status: 'IN_PRODUCTION', nextAction: { ...row.nextAction, label: 'Continuar preparacao' } }; }, skipStep: async () => row, retryStep: async () => row, repeatStep: async () => row } });
    const output = await registry.get('production.manage').execute({ request: { intent: 'Continua de onde paramos' }, results: new Map() }); assert.equal(starts, 1); assert.match(output.summary, /Forza/); assert.equal(output.data.productionId, 'p');
  });
  test('HTTP contracts create, list, open, transition, resume and expose history', async () => {
    const created = await request('', { method: 'POST', body: JSON.stringify(details('http', 'SHORT')) }); assert.equal(created.status, 201);
    assert.equal((await request('')).body.length, 1); assert.equal((await request(`/${created.body.id}`)).status, 200); assert.equal((await request(`/${created.body.id}/next-action`)).body.stepKey, 'PREPARING');
    assert.equal((await request(`/${created.body.id}/steps/PREPARING/start`, { method: 'POST', body: '{}' })).status, 200); assert.equal((await request(`/${created.body.id}/resume`, { method: 'POST', body: '{}' })).status, 200); assert.ok((await request(`/${created.body.id}/history`)).body.length >= 2);
  });
  test('HTTP validates payloads, filters and state conflicts without leaking internals', async () => {
    const invalid = await request('', { method: 'POST', body: '{"title":"x","secret":"value"}' }); assert.equal(invalid.status, 400); assert.doesNotMatch(JSON.stringify(invalid.body), /Prisma|stack|secret/);
    assert.equal((await request('?format=UNKNOWN')).status, 400); assert.equal((await request('/missing')).status, 404);
  });
});
