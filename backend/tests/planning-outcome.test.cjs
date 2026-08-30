const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ContentPlanRepository } = require('../dist/database/repositories/ContentPlanRepository');
const { PlannedContentItemRepository } = require('../dist/database/repositories/PlannedContentItemRepository');
const { PlanningExecutionRepository } = require('../dist/database/repositories/PlanningExecutionRepository');
const { PlanningOutcomeRepository } = require('../dist/database/repositories/PlanningOutcomeRepository');
const { VideoPerformanceSnapshotRepository } = require('../dist/database/repositories/VideoPerformanceSnapshotRepository');
const { evaluateStrategicOutcome } = require('../dist/domains/strategic-planning');
const {
  StrategicOutcomeService, StrategicOutcomeConflictError, StrategicOutcomeNotReadyError,
} = require('../dist/services/strategic-planning');
const { createPlanningRouter } = require('../dist/routes/planning');

const runMigration = async (client, name) => {
  const sql = fs.readFileSync(path.resolve(__dirname, `../prisma/migrations/${name}/migration.sql`), 'utf8');
  for (const statement of sql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
};

const snapshotData = (id, videoId, views, overrides = {}) => ({
  ingestionKey: id, projectId: null, videoId, title: `Video ${videoId}`, game: 'Game', series: null, format: 'LONG_FORM',
  publishedAt: new Date('2026-08-22T00:00:00.000Z'), periodStart: new Date('2026-08-23T00:00:00.000Z'),
  periodEnd: new Date('2026-08-30T00:00:00.000Z'), views, engagedViews: null, impressions: views * 5,
  ctr: 0.06, durationSeconds: 600, averageViewDurationSeconds: 240, averageViewPercentage: 40,
  watchTimeMinutes: views * 4, subscribersGained: 4, subscribersLost: 0, likes: 50, comments: 8,
  source: 'test', confidence: 0.9, collectedAt: new Date('2026-09-06T10:00:00.000Z'), ...overrides,
});

describe('strategic planning outcome tracking', { concurrency: false }, () => {
  let client; let plans; let items; let execution; let snapshots; let outcomes; let service; let server; let baseUrl; let sequence = 0;

  before(async () => {
    client = await DatabaseService.connect(); await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    for (const table of ['Project', 'EditorialDecision', 'ResearchHistory', 'ResearchOpportunity', 'SeriesDefinition']) {
      await client.$executeRawUnsafe(`CREATE TABLE "${table}" ("id" TEXT NOT NULL PRIMARY KEY)`);
    }
    await client.$executeRawUnsafe(`CREATE TABLE "VideoPerformanceSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "ingestionKey" TEXT NOT NULL UNIQUE, "videoId" TEXT NOT NULL,
      "title" TEXT NOT NULL, "game" TEXT, "series" TEXT, "format" TEXT, "publishedAt" DATETIME, "periodStart" DATETIME,
      "periodEnd" DATETIME, "views" REAL, "engagedViews" REAL, "impressions" REAL, "ctr" REAL, "durationSeconds" REAL,
      "averageViewDurationSeconds" REAL, "averageViewPercentage" REAL, "watchTimeMinutes" REAL,
      "subscribersGained" INTEGER, "subscribersLost" INTEGER, "likes" INTEGER, "comments" INTEGER,
      "source" TEXT NOT NULL, "confidence" REAL NOT NULL DEFAULT 1, "collectedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "VideoPerformanceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`);
    await runMigration(client, '20260904120000_strategic_content_planning');
    await runMigration(client, '20260905100000_planning_execution_guidance');
    await runMigration(client, '20260906120000_strategic_planning_outcomes');
    plans = new ContentPlanRepository(client); items = new PlannedContentItemRepository(client);
    execution = new PlanningExecutionRepository(client); snapshots = new VideoPerformanceSnapshotRepository(client);
    outcomes = new PlanningOutcomeRepository(client);
    service = new StrategicOutcomeService(items, execution, outcomes, snapshots, () => new Date('2026-09-06T12:00:00.000Z'));
    const app = express(); app.use(express.json()); app.use(createPlanningRouter({}, service));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });

  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });

  const createPlan = async (completed = true) => {
    const n = ++sequence;
    const plan = await plans.create({
      projectId: null, horizon: 'TODAY', status: 'READY', summary: 'Plan', balance: {}, constraints: [], risks: [], source: {},
      generatedAt: new Date('2026-09-06T08:00:00.000Z'), items: [{
        sourceDecisionId: null, sourceResearchOpportunityId: null, researchHistoryId: null, seriesId: null,
        candidateKey: `item-${n}`, candidateType: 'TOPIC', title: `Item ${n}`, rationale: 'Reason', status: 'READY',
        priority: 'HIGH', effort: 'MEDIUM', readiness: 'READY', queue: 'NEXT', position: 1, executionScore: 80,
        manualPriority: false, evidence: [], risks: [], constraints: [], missingData: [], dependencies: [],
        executionState: 'pending', executionAction: 'Execute', executionConfidence: 0.8, executionContext: {},
      }],
    });
    if (!completed) return plan;
    await execution.transition({ itemId: plan.items[0].id, state: 'completed', event: 'EXECUTION_COMPLETED', action: 'Execute', reason: 'Done', confidence: 0.8, strategicContext: {}, occurredAt: new Date('2026-09-06T09:00:00.000Z') });
    return plans.findById(plan.id);
  };

  const saveSnapshot = async (data) => (await snapshots.upsert({ ...data })).snapshot;
  const request = async (route, options = {}) => {
    const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json' } });
    const body = response.status === 204 ? null : await response.json(); return { status: response.status, body };
  };

  test('evaluation waits for metrics and refuses incompatible format/window references', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const sparse = snapshotData('sparse', 'sparse', null, { impressions: null, ctr: null, watchTimeMinutes: null, averageViewDurationSeconds: null, averageViewPercentage: null, subscribersGained: null, subscribersLost: null, likes: null, comments: null });
    assert.equal(evaluateStrategicOutcome(sparse, [], now).classification, 'AWAITING_DATA');
    const target = snapshotData('target', 'target', 200);
    const incompatible = [snapshotData('short', 'short', 100, { format: 'SHORT' }), snapshotData('window', 'window', 100, { periodEnd: new Date('2026-08-29T00:00:00.000Z') })];
    assert.equal(evaluateStrategicOutcome(target, incompatible, now).classification, 'INSUFFICIENT_DATA');
  });

  test('evaluation uses same-format temporal peers and never claims causality', () => {
    const target = snapshotData('eval-target', 'eval-target', 300);
    const evaluation = evaluateStrategicOutcome(target, [snapshotData('r1', 'r1', 100), snapshotData('r2', 'r2', 120)], new Date('2026-09-06T12:00:00.000Z'));
    assert.equal(evaluation.classification, 'ABOVE_REFERENCE'); assert.equal(evaluation.benchmark.comparableVideos, 2);
    assert.match(JSON.stringify(evaluation), /nao demonstra causalidade/i); assert.doesNotMatch(JSON.stringify(evaluation), /aumentou as views/i);
  });

  test('stale observations remain usable only with reduced confidence and explicit limitation', () => {
    const target = snapshotData('stale-target', 'stale-target', 300, { collectedAt: new Date('2026-08-01T00:00:00.000Z') });
    const recent = evaluateStrategicOutcome({ ...target, collectedAt: new Date('2026-09-06T10:00:00.000Z') }, [snapshotData('sr1', 'sr1', 100), snapshotData('sr2', 'sr2', 120)], new Date('2026-09-06T12:00:00.000Z'));
    const stale = evaluateStrategicOutcome(target, [snapshotData('ss1', 'ss1', 100), snapshotData('ss2', 'ss2', 120)], new Date('2026-09-06T12:00:00.000Z'));
    assert.equal(stale.freshness, 'STALE'); assert.ok(stale.confidence < recent.confidence); assert.match(JSON.stringify(stale.limitations), /stale/i);
  });

  test('completed execution can link, relink and unlink with append-only audit', async () => {
    const plan = await createPlan(); const item = plan.items[0];
    const first = await saveSnapshot(snapshotData(`link-a-${sequence}`, `video-a-${sequence}`, 100));
    const second = await saveSnapshot(snapshotData(`link-b-${sequence}`, `video-b-${sequence}`, 120));
    const linked = await service.associateVideo(item.id, { snapshotId: first.id }); assert.equal(linked.created, true);
    const repeated = await service.associateVideo(item.id, { snapshotId: first.id }); assert.equal(repeated.created, false); assert.equal(repeated.link.id, linked.link.id);
    await assert.rejects(() => service.associateVideo(item.id, { snapshotId: second.id }), /reason is required/);
    const corrected = await service.associateVideo(item.id, { snapshotId: second.id, reason: 'Published video corrected.' });
    assert.equal(corrected.replaced, true); assert.equal(corrected.link.videoId, second.videoId);
    await service.unlinkVideo(item.id, 'Wrong publication.');
    const bundle = await service.getItemOutcome(item.id); assert.equal(bundle.activeLink, null);
    assert.deepEqual(bundle.audit.map(({ event }) => event).sort(), ['VIDEO_LINKED', 'VIDEO_RELINKED', 'VIDEO_UNLINKED', 'VIDEO_UNLINKED'].sort());
  });

  test('non-completed items and duplicate video attribution are rejected', async () => {
    const draft = await createPlan(false); const snapshot = await saveSnapshot(snapshotData(`draft-${sequence}`, `shared-${sequence}`, 100));
    await assert.rejects(() => service.associateVideo(draft.items[0].id, { snapshotId: snapshot.id }), StrategicOutcomeNotReadyError);
    const first = await createPlan(); const second = await createPlan();
    await service.associateVideo(first.items[0].id, { snapshotId: snapshot.id });
    await assert.rejects(() => service.associateVideo(second.items[0].id, { snapshotId: snapshot.id }), StrategicOutcomeConflictError);
  });

  test('concurrent identical associations persist one active link', async () => {
    const plan = await createPlan(); const item = plan.items[0];
    const snapshot = await saveSnapshot(snapshotData(`concurrent-${sequence}`, `concurrent-video-${sequence}`, 100));
    const linked = await Promise.all([
      service.associateVideo(item.id, { snapshotId: snapshot.id }),
      service.associateVideo(item.id, { snapshotId: snapshot.id }),
    ]);
    assert.equal(linked.filter(({ created }) => created).length, 1);
    assert.equal(linked[0].link.id, linked[1].link.id);
    assert.equal(await client.planningOutcomeLink.count({ where: { itemId: item.id, activeItemKey: item.id } }), 1);
  });

  test('outcome snapshots are idempotent, preserve windows and remain auditable', async () => {
    const plan = await createPlan(); const item = plan.items[0];
    const target = await saveSnapshot(snapshotData(`outcome-${sequence}`, `outcome-video-${sequence}`, 300));
    await saveSnapshot(snapshotData(`peer-a-${sequence}`, `peer-a-${sequence}`, 100));
    await saveSnapshot(snapshotData(`peer-b-${sequence}`, `peer-b-${sequence}`, 120));
    await service.associateVideo(item.id, { snapshotId: target.id });
    const first = await service.captureOutcome(item.id, target.id); const repeated = await service.captureOutcome(item.id, target.id);
    assert.equal(first.created, true); assert.equal(repeated.created, false); assert.equal(first.outcome.id, repeated.outcome.id);
    assert.equal(first.outcome.classification, 'ABOVE_REFERENCE'); assert.equal(first.outcome.windowEnd.toISOString(), target.periodEnd.toISOString());
    const bundle = await service.getItemOutcome(item.id); assert.equal(bundle.activeLink.outcomes.length, 1);
    assert.ok(bundle.audit.some(({ event }) => event === 'OUTCOME_CAPTURED'));
  });

  test('different persisted observation windows remain distinct outcomes', async () => {
    const plan = await createPlan(); const item = plan.items[0]; const videoId = `window-video-${sequence}`;
    const firstSnapshot = await saveSnapshot(snapshotData(`window-first-${sequence}`, videoId, 100));
    const secondSnapshot = await saveSnapshot(snapshotData(`window-second-${sequence}`, videoId, 180, {
      periodStart: new Date('2026-08-23T00:00:00.000Z'), periodEnd: new Date('2026-09-06T00:00:00.000Z'),
      collectedAt: new Date('2026-09-06T11:00:00.000Z'),
    }));
    await service.associateVideo(item.id, { snapshotId: firstSnapshot.id });
    await service.captureOutcome(item.id, firstSnapshot.id); await service.captureOutcome(item.id, secondSnapshot.id);
    const bundle = await service.getItemOutcome(item.id);
    assert.equal(bundle.activeLink.outcomes.length, 2);
    assert.notEqual(bundle.activeLink.outcomes[0].windowEnd.toISOString(), bundle.activeLink.outcomes[1].windowEnd.toISOString());
  });

  test('HTTP contracts validate payloads and expose persisted outcome state safely', async () => {
    const plan = await createPlan(); const item = plan.items[0]; const snapshot = await saveSnapshot(snapshotData(`http-${sequence}`, `http-video-${sequence}`, 100));
    assert.equal((await request(`/items/${item.id}/outcome/video`, { method: 'POST', body: JSON.stringify({ content: 'fake' }) })).status, 400);
    const linked = await request(`/items/${item.id}/outcome/video`, { method: 'POST', body: JSON.stringify({ snapshotId: snapshot.id }) });
    assert.equal(linked.status, 201); assert.equal(linked.body.link.videoId, snapshot.videoId);
    assert.equal((await request(`/items/${item.id}/outcome/video`, { method: 'POST', body: JSON.stringify({ snapshotId: snapshot.id }) })).status, 200);
    const captured = await request(`/items/${item.id}/outcomes`, { method: 'POST', body: '{}' });
    assert.equal(captured.status, 201); assert.equal(captured.body.outcome.videoId, snapshot.videoId);
    const detail = await request(`/outcomes/${captured.body.outcome.id}`); assert.equal(detail.status, 200);
    const bundle = await request(`/items/${item.id}/outcome`); assert.equal(bundle.status, 200); assert.equal(bundle.body.activeLink.outcomes.length, 1);
    const missing = await request('/items/missing/outcome'); assert.equal(missing.status, 404); assert.doesNotMatch(JSON.stringify(missing.body), /Prisma|stack|SQL/i);
  });

  test('candidate listing is deterministic and does not infer links by title', async () => {
    const plan = await createPlan();
    await saveSnapshot(snapshotData(`candidate-old-${sequence}`, `candidate-${sequence}`, 80, { collectedAt: new Date('2026-09-05T10:00:00.000Z') }));
    const latest = await saveSnapshot(snapshotData(`candidate-new-${sequence}`, `candidate-${sequence}`, 90));
    const candidates = await service.listVideoCandidates(plan.items[0].id);
    const matches = candidates.filter(({ videoId }) => videoId === latest.videoId);
    assert.equal(matches.length, 1); assert.equal(matches[0].snapshotId, latest.id);
  });
});
