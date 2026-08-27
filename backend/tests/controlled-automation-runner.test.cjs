const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, describe, test } = require('node:test');
const express = require('express');
process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { AutomationAuditRepository } = require('../dist/database/repositories/AutomationAuditRepository');
const { AutomationRepository } = require('../dist/database/repositories/AutomationRepository');
const { AutomationRunRepository } = require('../dist/database/repositories/AutomationRunRepository');
const { calculateNextRunAt, normalizeAutomationSchedule } = require('../dist/domains/automation');
const { createAutomationsRouter } = require('../dist/routes/automations');
const { AutomationRunnerService } = require('../dist/services/automation/AutomationRunnerService');
const { AutomationSchedulerService } = require('../dist/services/automation/AutomationSchedulerService');
const { AutomationService } = require('../dist/services/automation/AutomationService');

let client; let repository; let runRepository; let auditRepository; let now;
const migration = readFileSync(path.resolve(__dirname, '../prisma/migrations/20260828120000_controlled_automation_runner/migration.sql'), 'utf8');
const executeSql = async (sql) => {
  for (const statement of sql.split(';').map((item) => item.trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
};
const plan = (sideEffect = 'READ_ONLY') => ({ intent: 'channel_status', objective: 'Resumo operacional', capabilities: ['supervisor.read'],
  requiresWrite: sideEffect !== 'READ_ONLY', hasExternalSideEffect: sideEffect.startsWith('EXTERNAL'), missingData: [],
  steps: [{ id: 'supervisor', capabilityId: 'supervisor.read', objective: 'Resumo', dependencies: [],
    access: sideEffect === 'READ_ONLY' ? 'read' : sideEffect === 'INTERNAL_WRITE' ? 'write' : 'external_side_effect',
    sideEffect, persistentMutation: sideEffect !== 'READ_ONLY', ...(sideEffect !== 'READ_ONLY' ? { maxAffectedItems: 20 } : {}),
    inputs: [], outputs: [], optional: false }] });
const result = { status: 'completed', interpretation: 'Resumo', response: 'Operação concluída.', capabilities: ['supervisor.read'],
  steps: [], evidence: { facts: ['real'], inferences: [], recommendations: [], risks: [], missingData: [], confidence: 1 } };
class FakeOrchestrator {
  constructor({ reviewState = 'approved', sideEffect = 'READ_ONLY', fail = false } = {}) {
    this.reviewState = reviewState; this.sideEffect = sideEffect; this.fail = fail;
    this.plans = 0; this.previews = 0; this.executions = 0; this.requests = [];
  }
  plan() { this.plans += 1; return plan(this.sideEffect); }
  async preview(request) { this.previews += 1; this.requests.push(structuredClone(request));
    return { executionId: `execution-${this.previews}`, created: true, plan: plan(this.sideEffect), review: {
      state: this.reviewState, riskLevel: this.sideEffect === 'READ_ONLY' ? 'LOW' : 'HIGH', sideEffectLevel: this.sideEffect,
      requiredApprovals: this.reviewState === 'approved' ? 0 : 1, version: 1, reasons: [], validUntil: new Date('2026-08-29T00:00:00Z') } }; }
  async executeApprovedPlan() { this.executions += 1; if (this.fail) throw new Error('raw provider secret');
    return { execution: { id: 'execution' }, result, created: true }; }
}
const services = (orchestrator = new FakeOrchestrator()) => {
  const service = new AutomationService(repository, runRepository, auditRepository, orchestrator, () => new Date(now));
  const runner = new AutomationRunnerService(repository, runRepository, auditRepository, orchestrator, () => new Date(now));
  return { service, runner, scheduler: new AutomationSchedulerService(repository, runner), orchestrator };
};
const createInput = (overrides = {}) => ({ name: 'Resumo diário', triggerType: 'DAILY', schedule: { time: '09:00' },
  timezone: 'America/Sao_Paulo', intent: 'Como está o estado operacional do canal?', enabled: true, ...overrides });

before(async () => {
  client = await DatabaseService.connect(); await client.$executeRawUnsafe('PRAGMA foreign_keys=ON');
  await client.$executeRawUnsafe('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)');
  await client.$executeRawUnsafe(`CREATE TABLE "Automation" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "name" TEXT NOT NULL,
    "description" TEXT, "trigger" TEXT, "action" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Automation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`);
  await client.$executeRawUnsafe("INSERT INTO Automation(id,name,enabled,updatedAt) VALUES('legacy','Legado',0,CURRENT_TIMESTAMP)");
  await executeSql(migration);
  const legacy = await client.automation.findUnique({ where: { id: 'legacy' } });
  assert.equal(legacy.name, 'Legado'); assert.equal(legacy.triggerType, 'MANUAL_ONLY');
  repository = new AutomationRepository(client); runRepository = new AutomationRunRepository(client);
  auditRepository = new AutomationAuditRepository(client);
});
beforeEach(async () => { now = '2026-08-28T10:00:00.000Z'; await client.automationAuditEvent.deleteMany();
  await client.automationRun.deleteMany(); await client.automation.deleteMany(); });
after(async () => DatabaseService.disconnect());

describe('automation schedule and definitions', () => {
  test('calculates daily and weekly occurrences in the configured timezone', () => {
    assert.equal(calculateNextRunAt('DAILY', { time: '09:00' }, 'America/Sao_Paulo', new Date(now)).toISOString(), '2026-08-28T12:00:00.000Z');
    assert.equal(calculateNextRunAt('WEEKLY', { time: '09:00', weekday: 1 }, 'UTC', new Date(now)).toISOString(), '2026-08-31T09:00:00.000Z');
  });
  test('rejects invalid schedules and keeps manual automations unscheduled', () => {
    assert.throws(() => normalizeAutomationSchedule('DAILY', { time: '25:00' }));
    assert.equal(calculateNextRunAt('MANUAL_ONLY', null, 'UTC', new Date(now)), null);
  });
  test('creates, lists, updates and opens a persisted definition with assessed risk', async () => {
    const { service } = services(); const created = await service.create(createInput());
    assert.equal(created.status, 'ACTIVE'); assert.equal(created.riskLevel, 'LOW'); assert.ok(created.nextRunAt);
    assert.equal((await service.list()).length, 1); assert.equal((await service.getById(created.id)).name, 'Resumo diário');
    const updated = await service.update(created.id, { name: 'Resumo semanal', triggerType: 'WEEKLY', schedule: { time: '10:00', weekday: 1 } });
    assert.equal(updated.name, 'Resumo semanal'); assert.equal(updated.triggerType, 'WEEKLY');
  });
  test('enables, pauses, resumes and disables without losing the definition', async () => {
    const { service } = services(); const created = await service.create(createInput({ enabled: false, triggerType: 'MANUAL_ONLY', schedule: null }));
    assert.equal((await service.enable(created.id)).status, 'ACTIVE'); assert.equal((await service.pause(created.id)).status, 'PAUSED');
    assert.equal((await service.resume(created.id)).status, 'ACTIVE'); const disabled = await service.disable(created.id);
    assert.equal(disabled.enabled, false); assert.equal(disabled.status, 'DISABLED');
  });
  test('finds only active due definitions without executing them', async () => {
    const set = services(); const created = await set.service.create(createInput());
    await repository.update(created.id, { nextRunAt: new Date('2026-08-28T09:00:00Z') });
    assert.deepEqual((await set.scheduler.findDueAutomations(new Date(now))).map(({ id }) => id), [created.id]);
    assert.equal(set.orchestrator.previews, 0);
  });
});

describe('controlled runner', () => {
  test('runs an approved manual plan once through the orchestrator and audits it', async () => {
    const set = services(); const automation = await set.service.create(createInput({ triggerType: 'MANUAL_ONLY', schedule: null }));
    const output = await set.runner.runNow(automation.id);
    assert.equal(output.run.status, 'SUCCEEDED'); assert.equal(set.orchestrator.previews, 1); assert.equal(set.orchestrator.executions, 1);
    assert.match(output.run.resultSummary, /Operação concluída/);
    assert.deepEqual((await set.service.listAudit(automation.id)).map(({ eventType }) => eventType).sort(),
      ['AUTOMATION_CREATED', 'RUN_STARTED', 'RUN_SUCCEEDED'].sort());
  });
  test('blocks a high-risk plan until its existing review is approved', async () => {
    const orchestrator = new FakeOrchestrator({ reviewState: 'review_required', sideEffect: 'EXTERNAL_READ' });
    const set = services(orchestrator); const automation = await set.service.create(createInput({ triggerType: 'MANUAL_ONLY', schedule: null }));
    const blocked = await set.runner.runNow(automation.id); assert.equal(blocked.run.status, 'BLOCKED'); assert.equal(orchestrator.executions, 0);
    const repeated = await set.runner.runNow(automation.id); assert.equal(repeated.run.id, blocked.run.id); assert.equal(orchestrator.previews, 1);
    orchestrator.reviewState = 'approved'; const resumed = await set.runner.executeApprovedRun(blocked.run.id);
    assert.equal(resumed.run.status, 'SUCCEEDED'); assert.equal(orchestrator.executions, 1);
  });
  test('sanitizes execution failures and records no raw provider message', async () => {
    const set = services(new FakeOrchestrator({ fail: true })); const automation = await set.service.create(createInput({ triggerType: 'MANUAL_ONLY', schedule: null }));
    const failed = await set.runner.runNow(automation.id); assert.equal(failed.run.status, 'FAILED');
    assert.equal(failed.run.failureReason, 'AutomationExecutionFailed'); assert.doesNotMatch(JSON.stringify(failed), /secret/);
  });
  test('scheduled occurrence is idempotent and advances after execution', async () => {
    const set = services(); const automation = await set.service.create(createInput()); const scheduledFor = new Date('2026-08-28T09:00:00Z');
    await repository.update(automation.id, { nextRunAt: scheduledFor });
    const first = await set.runner.runScheduled(automation.id, scheduledFor); const second = await set.runner.runScheduled(automation.id, scheduledFor);
    assert.equal(first.run.id, second.run.id); assert.equal(set.orchestrator.previews, 1); assert.equal((await set.service.listRuns(automation.id)).length, 1);
    assert.ok((await set.service.getById(automation.id)).nextRunAt > scheduledFor);
  });
  test('runDueAutomations executes a finite snapshot once', async () => {
    const set = services(); const automation = await set.service.create(createInput()); await repository.update(automation.id, { nextRunAt: new Date('2026-08-28T09:00:00Z') });
    const output = await set.scheduler.runDueAutomations(new Date(now)); assert.equal(output.due, 1); assert.equal(output.results.length, 1);
    assert.equal((await set.scheduler.findDueAutomations(new Date(now))).length, 0);
  });
  test('parallel scheduled claims produce one persisted run', async () => {
    const set = services(); const automation = await set.service.create(createInput()); const scheduledFor = new Date('2026-08-28T09:00:00Z');
    await repository.update(automation.id, { nextRunAt: scheduledFor });
    const [left, right] = await Promise.all([set.runner.runScheduled(automation.id, scheduledFor), set.runner.runScheduled(automation.id, scheduledFor)]);
    assert.equal(left.run.id, right.run.id); assert.equal((await set.service.listRuns(automation.id)).length, 1);
  });
});

describe('automation HTTP API', () => {
  let server; let baseUrl;
  before(async () => { const set = services(); const app = express(); app.use(express.json()); app.use(createAutomationsRouter(set.service, set.runner, set.scheduler));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); }); });
  after(async () => new Promise((resolve) => server.close(resolve)));
  const request = async (route, options = {}) => { const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json' } });
    return { status: response.status, body: await response.json() }; };
  test('creates, lists, opens, updates and runs through strict contracts', async () => {
    const created = await request('/', { method: 'POST', body: JSON.stringify(createInput({ triggerType: 'MANUAL_ONLY', schedule: null })) });
    assert.equal(created.status, 201); assert.equal((await request('/')).status, 200); assert.equal((await request(`/${created.body.id}`)).status, 200);
    assert.equal((await request(`/${created.body.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Atualizada' }) })).status, 200);
    const run = await request(`/${created.body.id}/run`, { method: 'POST', body: '{}' }); assert.equal(run.status, 201); assert.equal(run.body.run.status, 'SUCCEEDED');
    assert.equal((await request(`/${created.body.id}/runs`)).body.length, 1); assert.equal((await request(`/${created.body.id}/audit`)).status, 200);
  });
  test('rejects malformed payloads and reports missing records safely', async () => {
    assert.equal((await request('/', { method: 'POST', body: JSON.stringify({ name: 'x', secret: 'no' }) })).status, 400);
    const missing = await request('/missing'); assert.equal(missing.status, 404); assert.doesNotMatch(JSON.stringify(missing.body), /Prisma|stack|secret/i);
    assert.equal((await request('/due?now=invalid')).status, 400);
  });
});
