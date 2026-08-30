const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260904120000_strategic_content_planning/migration.sql'), 'utf8');

test('strategic planning migration is additive and valid in SQLite', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "EditorialDecision" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "ResearchOpportunity" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "ResearchHistory" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "SeriesDefinition" ("id" TEXT NOT NULL PRIMARY KEY);
      INSERT INTO "Project" ("id") VALUES ('legacy-project');
      INSERT INTO "EditorialDecision" ("id") VALUES ('legacy-decision');
    `);
    db.exec(migration);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM "Project"').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM "EditorialDecision"').get().count, 1);
    for (const table of ['ContentPlan', 'PlannedContentItem', 'PlanningHistory']) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='PlannedContentItem_planId_candidateKey_key'").get());
    assert.equal(db.pragma('foreign_key_check').length, 0); assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});
