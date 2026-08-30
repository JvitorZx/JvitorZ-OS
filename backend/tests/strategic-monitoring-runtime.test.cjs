const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const {
  StrategicMonitoringJob,
  readStrategicMonitoringJobConfig,
} = require('../dist/services/automation/StrategicMonitoringJob');
const { AutomationSchedulerService } = require('../dist/services/automation/AutomationSchedulerService');

const at = new Date('2026-09-09T18:00:00.000Z');

describe('proactive strategic monitoring job', () => {
  test('is disabled by default and does not inspect data or evaluate', async () => {
    const previous = process.env.STRATEGIC_MONITORING_ENABLED;
    delete process.env.STRATEGIC_MONITORING_ENABLED;
    assert.equal(readStrategicMonitoringJobConfig().enabled, false);
    let touched = false;
    const job = new StrategicMonitoringJob({ evaluate: async () => { touched = true; } }, { latest: async () => { touched = true; } });
    assert.equal((await job.run(at)).status, 'DISABLED'); assert.equal(touched, false);
    if (previous === undefined) delete process.env.STRATEGIC_MONITORING_ENABLED; else process.env.STRATEGIC_MONITORING_ENABLED = previous;
  });

  test('bounds interval configuration and keeps project optional', () => {
    const before = { enabled: process.env.STRATEGIC_MONITORING_ENABLED, interval: process.env.STRATEGIC_MONITORING_INTERVAL_MS, project: process.env.STRATEGIC_MONITORING_PROJECT_ID };
    process.env.STRATEGIC_MONITORING_ENABLED = 'true'; process.env.STRATEGIC_MONITORING_INTERVAL_MS = '1'; process.env.STRATEGIC_MONITORING_PROJECT_ID = ' project-1 ';
    const config = readStrategicMonitoringJobConfig(); assert.equal(config.enabled, true); assert.equal(config.intervalMs, 900000); assert.equal(config.projectId, 'project-1');
    for (const [key, value] of Object.entries({ STRATEGIC_MONITORING_ENABLED: before.enabled, STRATEGIC_MONITORING_INTERVAL_MS: before.interval, STRATEGIC_MONITORING_PROJECT_ID: before.project })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  test('skips safely while the latest evaluation is inside the interval', async () => {
    let calls = 0;
    const job = new StrategicMonitoringJob({ evaluate: async () => { calls += 1; } },
      { latest: async () => [{ evaluatedAt: new Date(at.getTime() - 60_000) }] },
      () => ({ enabled: true, intervalMs: 900000, projectId: null }));
    const result = await job.run(at); assert.equal(result.status, 'NOT_DUE'); assert.equal(result.attempted, false); assert.equal(calls, 0);
  });

  test('evaluates once when due and passes the configured project', async () => {
    const projects = [];
    const job = new StrategicMonitoringJob({ evaluate: async (projectId) => { projects.push(projectId); } },
      { latest: async () => [] }, () => ({ enabled: true, intervalMs: 900000, projectId: 'project-1' }));
    const result = await job.run(at); assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.attempts, 1); assert.deepEqual(projects, ['project-1']);
    const repeated = await job.run(new Date(at.getTime() + 60_000)); assert.equal(repeated.status, 'NOT_DUE'); assert.deepEqual(projects, ['project-1']);
  });

  test('retries a bounded failure and recovers without another scheduler', async () => {
    let calls = 0; const delays = [];
    const job = new StrategicMonitoringJob({ evaluate: async () => { calls += 1; if (calls === 1) throw new Error('temporary'); } },
      { latest: async () => [] }, () => ({ enabled: true, intervalMs: 900000, projectId: null }), async (delay) => { delays.push(delay); });
    const result = await job.run(at, 1); assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.attempts, 2); assert.deepEqual(delays, [1000]);
  });

  test('contains a persistent failure with a safe error type', async () => {
    const job = new StrategicMonitoringJob({ evaluate: async () => { throw new Error('private source payload'); } },
      { latest: async () => [] }, () => ({ enabled: true, intervalMs: 900000, projectId: null }), async () => {});
    const result = await job.run(at, 1); assert.equal(result.status, 'FAILED'); assert.equal(result.errorType, 'Error');
    assert.doesNotMatch(JSON.stringify(result), /private source payload/);
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
