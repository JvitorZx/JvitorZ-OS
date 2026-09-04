const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { StrategicMonitoringJob } = require('../dist/services/automation/StrategicMonitoringJob');
const { AutomationSchedulerService } = require('../dist/services/automation/AutomationSchedulerService');

const at = new Date('2026-09-10T18:00:00.000Z');

describe('proactive strategic monitoring runtime adapter', () => {
  test('delegates cadence and locking to the persistent control service', async () => {
    const calls = [];
    const job = new StrategicMonitoringJob({ runScheduled: async (now, retries) => {
      calls.push([now, retries]); return { status: 'SUCCEEDED', attempted: true, attempts: 1, evaluatedAt: now };
    } });
    assert.equal((await job.run(at, 1)).status, 'SUCCEEDED'); assert.deepEqual(calls, [[at, 1]]);
  });

  test('preserves disabled, not due and already-running decisions from the control plane', async () => {
    for (const status of ['DISABLED', 'NOT_DUE', 'ALREADY_RUNNING']) {
      const job = new StrategicMonitoringJob({ runScheduled: async () => ({ status, attempted: false, attempts: 0, evaluatedAt: null }) });
      const result = await job.run(at); assert.equal(result.status, status); assert.equal(result.attempted, false);
    }
  });

  test('contains persistent failure details to a safe error type', async () => {
    const job = new StrategicMonitoringJob({ runScheduled: async () => { throw new Error('private monitoring payload'); } });
    const result = await job.run(at, 1); assert.equal(result.status, 'FAILED'); assert.equal(result.errorType, 'Error');
    assert.doesNotMatch(JSON.stringify(result), /private monitoring payload/);
  });

  test('shares the existing automation scheduler and cannot execute external work by itself', async () => {
    let monitoringCalls = 0; let automationRuns = 0;
    const scheduler = new AutomationSchedulerService(
      { findDue: async () => [] },
      { runScheduled: async () => { automationRuns += 1; } },
      {}, async () => {}, {},
      { run: async () => { monitoringCalls += 1; return { status: 'SUCCEEDED', attempted: true, attempts: 1, evaluatedAt: at }; } },
    );
    const result = await scheduler.runDueAutomations(at);
    assert.equal(monitoringCalls, 1); assert.equal(automationRuns, 0); assert.equal(result.internalJobs.strategicMonitoring.status, 'SUCCEEDED');
  });

  test('a monitoring failure does not prevent due automation evaluation', async () => {
    let dueChecks = 0;
    const scheduler = new AutomationSchedulerService(
      { findDue: async () => { dueChecks += 1; return []; } }, {}, {}, async () => {}, {},
      { run: async () => { throw new Error('private monitoring failure'); } },
    );
    const result = await scheduler.runDueAutomations(at); assert.equal(dueChecks, 1); assert.equal(result.due, 0);
    assert.equal(result.internalJobs.strategicMonitoring.status, 'FAILED');
  });
});
