const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const readMigration = (name) => fs.readFileSync(path.resolve(__dirname, `../prisma/migrations/${name}/migration.sql`), 'utf8');

test('planning execution migration preserves legacy plans and maps operational states', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "EditorialDecision" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "ResearchOpportunity" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "ResearchHistory" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "SeriesDefinition" ("id" TEXT NOT NULL PRIMARY KEY);
    `);
    db.exec(readMigration('20260904120000_strategic_content_planning'));
    db.prepare(`INSERT INTO ContentPlan
      (id, horizon, status, summary, balance, constraints, risks, source, generatedAt, updatedAt)
      VALUES (?, 'TODAY', 'READY', 'Legacy', '{}', '[]', '[]', '{}', ?, ?)`)
      .run('legacy-plan', '2026-09-05T10:00:00.000Z', '2026-09-05T10:00:00.000Z');
    const insertItem = db.prepare(`INSERT INTO PlannedContentItem
      (id, planId, candidateKey, candidateType, title, rationale, status, priority, effort, readiness, queue,
       position, executionScore, evidence, risks, constraints, missingData, dependencies, updatedAt)
      VALUES (?, 'legacy-plan', ?, 'TOPIC', ?, 'Legacy', ?, 'HIGH', 'MEDIUM', 'READY', ?, ?, 70,
       '[]', '[]', '[]', '[]', '[]', '2026-09-05T10:00:00.000Z')`);
    insertItem.run('completed', 'completed', 'Completed', 'COMPLETED', 'DONE', 1);
    insertItem.run('paused', 'paused', 'Paused', 'PAUSED', 'WAITING', 2);
    insertItem.run('active', 'active', 'Active', 'IN_PROGRESS', 'NEXT', 3);

    db.exec(readMigration('20260905100000_planning_execution_guidance'));

    const rows = db.prepare('SELECT id, executionState, executionAction, executionContext FROM PlannedContentItem ORDER BY position').all();
    assert.deepEqual(rows.map(({ executionState }) => executionState), ['completed', 'paused', 'in_progress']);
    assert.ok(rows.every(({ executionAction }) => executionAction.length > 0));
    assert.ok(rows.every(({ executionContext }) => executionContext === '{}'));
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='PlanningExecutionEvent'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='PlannedContentItem_one_in_progress_per_plan'").get());
    assert.throws(() => insertAfterMigration(db, 'second-active', 4), /UNIQUE constraint failed/);
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});

const insertAfterMigration = (db, id, position) => db.prepare(`INSERT INTO PlannedContentItem
  (id, planId, candidateKey, candidateType, title, rationale, status, priority, effort, readiness, queue,
   position, executionScore, evidence, risks, constraints, missingData, dependencies, executionState,
   executionAction, executionContext, updatedAt)
  VALUES (?, 'legacy-plan', ?, 'TOPIC', 'Concurrent', 'Legacy', 'IN_PROGRESS', 'HIGH', 'MEDIUM', 'READY',
   'NEXT', ?, 70, '[]', '[]', '[]', '[]', '[]', 'in_progress', 'Executar.', '{}', '2026-09-05T10:00:00.000Z')`)
  .run(id, id, position);
