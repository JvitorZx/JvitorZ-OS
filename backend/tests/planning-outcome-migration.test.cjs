const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const migration = (name) => fs.readFileSync(path.resolve(__dirname, `../prisma/migrations/${name}/migration.sql`), 'utf8');

test('strategic outcome migration preserves planning data and enforces auditable links', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "EditorialDecision" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "ResearchOpportunity" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "ResearchHistory" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "SeriesDefinition" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "VideoPerformanceSnapshot" (
        "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "videoId" TEXT NOT NULL,
        CONSTRAINT "VideoPerformanceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL
      );
    `);
    db.exec(migration('20260904120000_strategic_content_planning'));
    db.exec(migration('20260905100000_planning_execution_guidance'));
    db.prepare(`INSERT INTO ContentPlan
      (id, horizon, status, summary, balance, constraints, risks, source, generatedAt, updatedAt)
      VALUES ('plan', 'TODAY', 'READY', 'Preserved', '{}', '[]', '[]', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
    db.prepare(`INSERT INTO PlannedContentItem
      (id, planId, candidateKey, candidateType, title, rationale, status, priority, effort, readiness, queue,
       position, executionScore, evidence, risks, constraints, missingData, dependencies, executionState,
       executionAction, executionContext, updatedAt)
      VALUES ('item', 'plan', 'item', 'TOPIC', 'Item', 'Reason', 'COMPLETED', 'HIGH', 'MEDIUM', 'READY',
       'DONE', 1, 80, '[]', '[]', '[]', '[]', '[]', 'completed', 'Done', '{}', CURRENT_TIMESTAMP)`).run();
    db.prepare(`INSERT INTO PlanningExecutionEvent
      (id, planId, itemId, event, state, itemTitle, action, strategicContext)
      VALUES ('execution', 'plan', 'item', 'EXECUTION_COMPLETED', 'completed', 'Item', 'Done', '{}')`).run();
    db.prepare(`INSERT INTO VideoPerformanceSnapshot(id, videoId) VALUES ('snapshot', 'video-1')`).run();

    db.exec(migration('20260906120000_strategic_planning_outcomes'));

    assert.equal(db.prepare('SELECT title FROM PlannedContentItem WHERE id = ?').get('item').title, 'Item');
    db.prepare(`INSERT INTO PlanningOutcomeLink
      (id, planId, itemId, executionEventId, sourceSnapshotId, videoId, videoTitle, activeItemKey, activeVideoKey)
      VALUES ('link', 'plan', 'item', 'execution', 'snapshot', 'video-1', 'Video', 'item', 'video-1')`).run();
    assert.throws(() => db.prepare(`INSERT INTO PlanningOutcomeLink
      (id, planId, itemId, executionEventId, sourceSnapshotId, videoId, videoTitle, activeItemKey, activeVideoKey)
      VALUES ('duplicate', 'plan', 'item', 'execution', 'snapshot', 'video-1', 'Video', 'item', 'video-1')`).run(), /UNIQUE/);
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});
