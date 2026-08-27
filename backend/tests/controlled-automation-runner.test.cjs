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
const { AutomationRuntimeEventRepository } = require('../dist/database/repositories/AutomationRuntimeEventRepository');
const { calculateNextRunAt, normalizeAutomationSchedule } = require('../dist/domains/automation');
const { createAutomationsRouter } = require('../dist/routes/automations');
const { AutomationRunnerService } = require('../dist/services/automation/AutomationRunnerService');
const { AutomationSchedulerService } = require('../dist/services/automation/AutomationSchedulerService');
const { AutomationService } = require('../dist/services/automation/AutomationService');
const { AutomationRuntimeService, readAutomationRuntimeConfig } = require('../dist/services/automation/AutomationRuntimeService');

let client; let repository; let runRepository; let auditRepository; let now;
const migration = readFileSync(path.resolve(__dirname, '../prisma/migrations/20260828120000_controlled_automation_runner/migration.sql'), 'utf8');
const runtimeMigration = readFileSync(path.resolve(__dirname, '../prisma/migrations/20260829100000_safe_automation_runtime/migration.sql'), 'utf8');
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
  constructor({ reviewState = 'approved', sideEffect = 'READ_ONLY', fail = false, transientFailures = 0 } = {}) {
    this.reviewState = reviewState; this.sideEffect = sideEffect; this.fail = fail;
    this.transientFailures = transientFailures;
    this.plans = 0; this.previews = 0; this.executions = 0; this.requests = [];
  }
  plan() { this.plans += 1; return plan(this.sideEffect); }
  async preview(request) { this.previews += 1; this.requests.push(structuredClone(request));
    return { executionId: `execution-${this.previews}`, created: true, plan: plan(this.sideEffect), review: {
      state: this.reviewState, riskLevel: this.sideEffect === 'READ_ONLY' ? 'LOW' : 'HIGH', sideEffectLevel: this.sideEffect,
      requiredApprovals: this.reviewState === 'approved' ? 0 : 1, version: 1, reasons: [], validUntil: new Date('2026-08-29T00:00:00Z') } }; }
  async executeApprovedPlan() { this.executions += 1;
    if (this.transientFailures > 0) { this.transientFailures -= 1; const error = new Error('temporary'); error.name = 'AutomationRuntimeTransientError'; throw error; }
    if (this.fail) throw new Error('raw provider secret');
    return { execution: { id: 'execution' }, result, created: true }; }
}
const services = (orchestrator = new FakeOrchestrator(), delay = async () => undefined) => {
  const service = new AutomationService(repository, runRepository, auditRepository, orchestrator, () => new Date(now));
  const runner = new AutomationRunnerService(repository, runRepository, auditRepository, orchestrator, () => new Date(now));
  return { service, runner, scheduler: new AutomationSchedulerService(repository, runner, auditRepository, delay), orchestrator };
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
  await executeSql(runtimeMigration);
  const legacy = await client.automation.findUnique({ where: { id: 'legacy' } });
  assert.equal(legacy.name, 'Legado'); assert.equal(legacy.triggerType, 'MANUAL_ONLY');
  repository = new AutomationRepository(client); runRepository = new AutomationRunRepository(client);
  auditRepository = new AutomationAuditRepository(client);
});
beforeEach(async () => { now = '2026-08-28T10:00:00.000Z'; await client.automationRuntimeEvent.deleteMany(); await client.automationAuditEvent.deleteMany();
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

class FakeTimers {
  constructor() { this.pending = []; }
  set(handler, delay) { const item = { handler, delay }; this.pending.push(item); return item; }
  clear(handle) { this.pending = this.pending.filter((item) => item !== handle); }
  async runNext() { const item = this.pending.shift(); if (item) { item.handler(); await new Promise((resolve) => setTimeout(resolve, 0)); } }
}
const runtimeFor = (scheduler, config = { enabled: true, pollIntervalMs: 60000, maxRetries: 0 }, timers = new FakeTimers()) => ({
  runtime: new AutomationRuntimeService(scheduler, runRepository, repository, auditRepository,
    new AutomationRuntimeEventRepository(client), () => config, () => new Date(now), timers), timers,
});

describe('safe automation runtime', () => {
  test('uses disabled conservative configuration by default', () => {
    const previous = process.env.AUTOMATION_RUNTIME_ENABLED; delete process.env.AUTOMATION_RUNTIME_ENABLED;
    const config = readAutomationRuntimeConfig(); assert.equal(config.enabled, false); assert.ok(config.pollIntervalMs >= 5000); assert.equal(config.maxRetries, 0);
    if (previous === undefined) delete process.env.AUTOMATION_RUNTIME_ENABLED; else process.env.AUTOMATION_RUNTIME_ENABLED = previous;
  });
  test('rejects start and tick while disabled but keeps stop safe', async () => {
    const scheduler = { runDueAutomations: async () => { throw new Error('must not run'); } };
    const { runtime } = runtimeFor(scheduler, { enabled: false, pollIntervalMs: 60000, maxRetries: 0 });
    await assert.rejects(() => runtime.start(), /disabled/); await assert.rejects(() => runtime.triggerTick(), /disabled/);
    assert.equal((await runtime.stop()).status, 'STOPPED');
  });
  test('starts and stops idempotently and can restart without duplicate timers', async () => {
    const scheduler = { runDueAutomations: async (at) => ({ checkedAt: at, due: 0, missed: 0, results: [] }) };
    const { runtime, timers } = runtimeFor(scheduler); await runtime.start(); await runtime.start();
    assert.equal(runtime.getHealth().status, 'RUNNING'); assert.equal(timers.pending.length, 1);
    await runtime.stop(); await runtime.stop(); assert.equal(runtime.getHealth().status, 'STOPPED'); assert.equal(timers.pending.length, 0);
    await runtime.start(); assert.equal(timers.pending.length, 1); await runtime.stop();
  });
  test('prevents two runtime owners inside one process', async () => {
    const scheduler = { runDueAutomations: async (at) => ({ checkedAt: at, due: 0, missed: 0, results: [] }) };
    const first = runtimeFor(scheduler).runtime; const second = runtimeFor(scheduler).runtime;
    await first.start(); await assert.rejects(() => second.start(), /already active/); await first.stop();
  });
  test('shares a slow tick and never overlaps scheduler work', async () => {
    let release; const gate = new Promise((resolve) => { release = resolve; }); let calls = 0;
    const scheduler = { runDueAutomations: async (at) => { calls += 1; await gate; return { checkedAt: at, due: 0, missed: 0, results: [] }; } };
    const { runtime } = runtimeFor(scheduler); const first = runtime.triggerTick(); const second = runtime.triggerTick();
    assert.equal(first, second); await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(calls, 1);
    release(); await first; assert.equal(runtime.getHealth().lastError, null);
  });
  test('graceful stop prevents new ticks and waits for the active tick', async () => {
    let release; const gate = new Promise((resolve) => { release = resolve; }); let calls = 0;
    const scheduler = { runDueAutomations: async (at) => { calls += 1; await gate; return { checkedAt: at, due: 0, missed: 0, results: [] }; } };
    const { runtime, timers } = runtimeFor(scheduler); await runtime.start(); const tick = runtime.triggerTick();
    await new Promise((resolve) => setTimeout(resolve, 0)); const stopping = runtime.stop();
    assert.equal(runtime.getHealth().status, 'STOPPING'); assert.equal(timers.pending.length, 0); assert.equal(calls, 1);
    release(); await Promise.all([tick, stopping]); assert.equal(runtime.getHealth().status, 'STOPPED');
  });
  test('recovers interrupted runs as failed without executing them again', async () => {
    const set = services(); const automation = await set.service.create(createInput({ triggerType: 'MANUAL_ONLY', schedule: null }));
    const run = await runRepository.create({ automationId: automation.id, occurrenceKey: 'manual-crash', triggerSource: 'MANUAL', status: 'RUNNING' });
    const scheduler = { runDueAutomations: async (at) => ({ checkedAt: at, due: 0, missed: 0, results: [] }) };
    const { runtime } = runtimeFor(scheduler); await runtime.start();
    const recovered = await runRepository.findById(run.id); assert.equal(recovered.status, 'FAILED'); assert.equal(recovered.failureReason, 'Interrupted');
    assert.equal(set.orchestrator.previews, 0); assert.equal((await runtime.listEvents()).some(({ eventType }) => eventType === 'RUN_RECOVERED'), true);
    await runtime.stop();
  });
  test('coalesces missed daily occurrences into the latest eligible run', async () => {
    now = '2026-08-28T15:00:00.000Z'; const set = services(); const automation = await set.service.create(createInput());
    await repository.update(automation.id, { nextRunAt: new Date('2026-08-24T12:00:00Z') });
    const output = await set.scheduler.runDueAutomations(new Date(now)); assert.equal(output.missed, 1); assert.equal(output.results.length, 1);
    assert.equal(output.results[0].run.scheduledFor.toISOString(), '2026-08-28T12:00:00.000Z');
    assert.equal((await set.service.listAudit(automation.id)).some(({ eventType }) => eventType === 'MISSED_OCCURRENCE'), true);
  });
  test('coalesces missed weekly occurrences and advances to the future', async () => {
    now = '2026-08-31T12:00:00.000Z'; const set = services(); const automation = await set.service.create(createInput({
      triggerType: 'WEEKLY', schedule: { time: '09:00', weekday: 1 }, timezone: 'UTC' }));
    await repository.update(automation.id, { nextRunAt: new Date('2026-08-17T09:00:00Z') });
    const output = await set.scheduler.runDueAutomations(new Date(now)); assert.equal(output.missed, 1);
    assert.equal(output.results[0].run.scheduledFor.toISOString(), '2026-08-31T09:00:00.000Z');
    assert.ok((await set.service.getById(automation.id)).nextRunAt > new Date(now));
  });
  test('retries only an explicitly transient technical failure within the configured bound', async () => {
    const delays = []; const set = services(new FakeOrchestrator({ transientFailures: 1 }), async (milliseconds) => { delays.push(milliseconds); });
    const automation = await set.service.create(createInput());
    await repository.update(automation.id, { nextRunAt: new Date('2026-08-28T09:00:00Z') });
    const output = await set.scheduler.runDueAutomations(new Date(now), 1);
    assert.equal(output.results[0].run.status, 'SUCCEEDED'); assert.equal(output.results[0].run.attempt, 2); assert.equal(set.orchestrator.executions, 2);
    assert.deepEqual(delays, [1000]);
  });
  test('does not retry generic, OAuth, validation or approval failures', async () => {
    const set = services(new FakeOrchestrator({ fail: true })); const automation = await set.service.create(createInput());
    await repository.update(automation.id, { nextRunAt: new Date('2026-08-28T09:00:00Z') });
    const output = await set.scheduler.runDueAutomations(new Date(now), 2);
    assert.equal(output.results[0].run.status, 'FAILED'); assert.equal(output.results[0].run.attempt, 1); assert.equal(set.orchestrator.executions, 1);
  });
  test('never bypasses review for an external write scheduled by the runtime', async () => {
    const orchestrator = new FakeOrchestrator({ reviewState: 'review_required', sideEffect: 'EXTERNAL_WRITE' });
    const set = services(orchestrator); const automation = await set.service.create(createInput());
    await repository.update(automation.id, { nextRunAt: new Date('2026-08-28T09:00:00Z') });
    const output = await set.scheduler.runDueAutomations(new Date(now));
    assert.equal(output.results[0].run.status, 'BLOCKED'); assert.equal(orchestrator.previews, 1); assert.equal(orchestrator.executions, 0);
    assert.equal((await set.scheduler.runDueAutomations(new Date(now))).results.length, 0);
  });
  test('runs the complete persisted runtime pipeline for one eligible occurrence', async () => {
    const set = services(); const automation = await set.service.create(createInput());
    await repository.update(automation.id, { nextRunAt: new Date('2026-08-28T09:00:00Z') });
    const { runtime } = runtimeFor(set.scheduler); const result = await runtime.triggerTick();
    assert.equal(result.due, 1); assert.equal(result.results[0].run.status, 'SUCCEEDED'); assert.equal(set.orchestrator.executions, 1);
    assert.equal((await set.service.listRuns(automation.id)).length, 1);
    assert.equal((await set.service.listAudit(automation.id)).some(({ eventType }) => eventType === 'RUN_SUCCEEDED'), true);
    assert.ok((await set.service.getById(automation.id)).nextRunAt > new Date(now));
  });
  test('health and persistent events expose only bounded operational metadata', async () => {
    const scheduler = { runDueAutomations: async (at) => ({ checkedAt: at, due: 2, missed: 1,
      results: [{ created: true, run: { status: 'SUCCEEDED' } }, { created: true, run: { status: 'FAILED' } }] }) };
    const { runtime } = runtimeFor(scheduler); await runtime.triggerTick(); const health = runtime.getHealth();
    assert.equal(health.dueCount, 2); assert.equal(health.runsStarted, 2); assert.equal(health.runsFailed, 1);
    const events = await runtime.listEvents(); assert.equal(events.some(({ eventType }) => eventType === 'MISSED_OCCURRENCE'), true);
    assert.doesNotMatch(JSON.stringify(events), /token|secret|credential/i);
  });
  test('records a failed tick and exposes ERROR without leaking the underlying message', async () => {
    const scheduler = { runDueAutomations: async () => { throw new Error('secret provider payload'); } };
    const { runtime } = runtimeFor(scheduler); await assert.rejects(() => runtime.triggerTick());
    assert.equal(runtime.getHealth().status, 'ERROR'); assert.equal(runtime.getHealth().lastError, 'Error');
    assert.doesNotMatch(JSON.stringify(await runtime.listEvents()), /provider payload|secret/i);
  });
});

describe('automation HTTP API', () => {
  let server; let baseUrl; let runtimeCalls;
  before(async () => { const set = services(); runtimeCalls = [];
    const health = { status: 'STOPPED', enabled: true, pollIntervalMs: 60000, maxRetries: 0, startedAt: null,
      lastTickAt: null, lastSuccessfulTickAt: null, lastError: null, dueCount: 0, runsStarted: 0, runsFailed: 0, nextTickAt: null };
    const runtime = { getHealth: () => health, listEvents: async () => [{ eventType: 'RUNTIME_STOPPED' }],
      start: async () => { runtimeCalls.push('start'); return { ...health, status: 'RUNNING' }; },
      stop: async () => { runtimeCalls.push('stop'); return health; },
      triggerTick: async () => { runtimeCalls.push('tick'); return { checkedAt: new Date(now), due: 0, missed: 0, results: [] }; } };
    const app = express(); app.use(express.json()); app.use(createAutomationsRouter(set.service, set.runner, set.scheduler, runtime));
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
  test('exposes validated runtime health, controls and recent events', async () => {
    assert.equal((await request('/runtime/status')).body.status, 'STOPPED');
    assert.equal((await request('/runtime/health')).status, 200); assert.equal((await request('/runtime/events?limit=10')).status, 200);
    assert.equal((await request('/runtime/events?limit=0')).status, 400);
    assert.equal((await request('/runtime/start', { method: 'POST', body: '{}' })).body.status, 'RUNNING');
    assert.equal((await request('/runtime/stop', { method: 'POST', body: '{}' })).status, 200);
    assert.equal((await request('/runtime/tick', { method: 'POST', body: '{}' })).body.due, 0);
    assert.deepEqual(runtimeCalls, ['start', 'stop', 'tick']);
    assert.equal((await request('/runtime/start', { method: 'POST', body: '{"unexpected":true}' })).status, 400);
  });
});
