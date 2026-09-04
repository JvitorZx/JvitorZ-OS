const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DATABASE_URL = ':memory:';
const { DatabaseService } = require('../dist/database/DatabaseService');
const { MonitoringControlRepository } = require('../dist/database/repositories/MonitoringControlRepository');
const {
  MonitoringControlConflictError,
  MonitoringControlService,
  MonitoringControlValidationError,
} = require('../dist/services/strategic-monitoring');
const { createMonitoringRouter } = require('../dist/routes/monitoring');

const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260910120000_monitoring_control_plane/migration.sql'), 'utf8');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const evaluation = { snapshot: { id: 'snapshot' }, created: 0, updated: 0, resolved: 0, unchanged: true, signals: [] };

describe('monitoring control plane', { concurrency: false }, () => {
  let client; let repository; let now; let runtime; let calls; let monitoring;
  const makeService = (source = monitoring, delay = async () => {}) => new MonitoringControlService(
    repository, source, () => now, delay, () => runtime,
  );

  before(async () => {
    client = await DatabaseService.connect();
    for (const statement of migration.split(';').map((entry) => entry.trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
    repository = new MonitoringControlRepository(client);
  });
  beforeEach(async () => {
    await client.monitoringControl.deleteMany();
    now = new Date('2026-09-10T12:00:00.000Z');
    runtime = { enabled: false, status: 'STOPPED', lastSuccessfulTickAt: null, lastError: null };
    calls = [];
    monitoring = { evaluate: async (projectId) => { calls.push(projectId); return evaluation; } };
  });
  after(async () => DatabaseService.disconnect());

  test('is persistently disabled by default', async () => {
    const state = await makeService().getState();
    assert.equal(state.enabled, false); assert.equal(state.operationalState, 'DISABLED');
    assert.equal(state.nextRunAt, null); assert.equal(await client.monitoringControl.count(), 1);
  });

  test('enable is idempotent and preserves one control row', async () => {
    const service = makeService(); const first = await service.enable(); const second = await service.enable();
    assert.equal(first.enabled, true); assert.equal(second.enabled, true);
    const persisted = await repository.getOrCreate();
    assert.equal(persisted.nextRunAt.toISOString(), '2026-09-10T18:00:00.000Z'); assert.equal(await client.monitoringControl.count(), 1);
  });

  test('disable is idempotent and removes the next periodic run', async () => {
    const service = makeService(); await service.enable();
    const first = await service.disable(); const second = await service.disable();
    assert.equal(first.enabled, false); assert.equal(second.enabled, false); assert.equal(second.nextRunAt, null);
  });

  test('cadence accepts only supported options and reconciles the existing schedule', async () => {
    const service = makeService(); await service.enable(); const updated = await service.updateCadence(3600000);
    assert.equal(updated.intervalMs, 3600000);
    assert.equal(updated.nextRunAt, null, 'runtime is stopped, so no effective next execution is advertised');
    const persisted = await repository.getOrCreate(); assert.equal(persisted.nextRunAt.toISOString(), '2026-09-10T13:00:00.000Z');
    await assert.rejects(() => service.updateCadence(1234), MonitoringControlValidationError);
  });

  test('manual execution works while disabled and does not enable periodic monitoring', async () => {
    const result = await makeService().runNow(); const state = await makeService().getState();
    assert.equal(result.status, 'SUCCEEDED'); assert.deepEqual(calls, [null]);
    assert.equal(state.enabled, false); assert.equal(state.operationalState, 'DISABLED'); assert.equal(state.lastSuccessfulRunAt.toISOString(), now.toISOString());
  });

  test('manual execution passes an optional project to the Sprint 43 pipeline', async () => {
    await makeService().runNow(' project-1 '); assert.deepEqual(calls, ['project-1']);
  });

  test('concurrent manual execution is rejected before a duplicate evaluation starts', async () => {
    const pending = deferred(); monitoring = { evaluate: async () => { calls.push(null); return pending.promise; } };
    const service = makeService(); const first = service.runNow(); await flush();
    await assert.rejects(() => service.runNow(), MonitoringControlConflictError); assert.equal(calls.length, 1);
    pending.resolve(evaluation); await first; assert.equal(await client.monitoringControl.count(), 1);
  });

  test('periodic execution stays disabled until explicit activation', async () => {
    const result = await makeService().runScheduled(now);
    assert.equal(result.status, 'DISABLED'); assert.equal(result.attempted, false); assert.equal(calls.length, 0);
  });

  test('periodic execution runs once when due and schedules the next cadence', async () => {
    const service = makeService(); await service.enable();
    now = new Date('2026-09-10T18:00:00.000Z'); const first = await service.runScheduled(now);
    const second = await service.runScheduled(new Date(now.getTime() + 1000));
    assert.equal(first.status, 'SUCCEEDED'); assert.equal(second.status, 'NOT_DUE'); assert.equal(calls.length, 1);
  });

  test('bounded retry recovers through the same pipeline', async () => {
    const delays = []; let attempt = 0;
    monitoring = { evaluate: async () => { attempt += 1; if (attempt === 1) throw new Error('temporary private payload'); return evaluation; } };
    const result = await makeService(monitoring, async (delay) => delays.push(delay)).runNow(null, 1);
    assert.equal(result.attempts, 2); assert.deepEqual(delays, [1000]);
  });

  test('failure records only a safe error type and never fabricates success', async () => {
    monitoring = { evaluate: async () => { throw new Error('private source payload'); } };
    await assert.rejects(() => makeService().runNow(), /private source payload/);
    const state = await makeService().getState();
    assert.equal(state.operationalState, 'ERROR'); assert.equal(state.lastErrorType, 'Error');
    assert.equal(state.lastSuccessfulRunAt, null); assert.doesNotMatch(JSON.stringify(state), /private source payload/);
  });

  test('restart reconciliation recovers a stale running lease without duplicating work', async () => {
    await repository.claimRun(now, false); now = new Date('2026-09-10T12:05:00.000Z');
    const state = await makeService().reconcile();
    assert.equal(state.operationalState, 'DISABLED'); assert.equal(state.lastErrorType, 'ProcessRestart');
    assert.equal(calls.length, 0); assert.equal(await client.monitoringControl.count(), 1);
  });

  test('restart reconciliation keeps one enabled schedule and is idempotent', async () => {
    const service = makeService(); await service.enable();
    const before = await repository.getOrCreate(); const first = await service.reconcile(); const second = await service.reconcile();
    assert.equal(first.enabled, true); assert.equal(second.enabled, true);
    assert.equal((await repository.getOrCreate()).nextRunAt.getTime(), before.nextRunAt.getTime());
    assert.equal(await client.monitoringControl.count(), 1); assert.equal(calls.length, 0);
  });

  test('status distinguishes desired activation from an actually running scheduler', async () => {
    const service = makeService(); let state = await service.enable();
    assert.equal(state.operationalState, 'WAITING_FOR_RUNTIME'); assert.equal(state.scheduler.active, false); assert.equal(state.nextRunAt, null);
    runtime = { enabled: true, status: 'RUNNING', lastSuccessfulTickAt: now, lastError: null };
    state = await service.getState(); assert.equal(state.operationalState, 'ACTIVE'); assert.equal(state.scheduler.active, true); assert.ok(state.nextRunAt);
  });

  test('disable during an active manual run is respected when it completes', async () => {
    const pending = deferred(); monitoring = { evaluate: async () => pending.promise };
    const service = makeService(); await service.enable(); const run = service.runNow(); await flush(); await service.disable();
    pending.resolve(evaluation); await run; const state = await service.getState();
    assert.equal(state.enabled, false); assert.equal(state.operationalState, 'DISABLED'); assert.equal(state.nextRunAt, null);
  });

  test('HTTP control contracts are strict, safe and delegate to the service', async () => {
    const service = makeService(); const app = express(); app.use(express.json());
    app.use(createMonitoringRouter(monitoring, service));
    const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, options = {}) => { const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json' } }); return { status: response.status, body: await response.json() }; };
    try {
      assert.equal((await request('/control')).body.enabled, false);
      assert.equal((await request('/control/enable', { method: 'POST', body: '{}' })).body.enabled, true);
      assert.equal((await request('/control', { method: 'PATCH', body: '{"intervalMs":3600000}' })).body.intervalMs, 3600000);
      assert.equal((await request('/control/run', { method: 'POST', body: '{}' })).status, 200);
      assert.equal((await request('/control/disable', { method: 'POST', body: '{}' })).body.enabled, false);
      assert.equal((await request('/control', { method: 'PATCH', body: '{"intervalMs":123}' })).status, 400);
      assert.equal((await request('/control/enable', { method: 'POST', body: '{"extra":true}' })).status, 400);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
