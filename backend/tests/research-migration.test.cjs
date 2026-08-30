const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const migration = readFileSync(path.resolve(__dirname, '../prisma/migrations/20260903120000_research_opportunity_discovery/migration.sql'), 'utf8');

test('research migration is additive, SQLite-compatible and keeps legacy data intact', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY); INSERT INTO "Project" ("id") VALUES (\'legacy\');');
    db.exec(migration);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM "Project"').get().count, 1);
    for (const table of ['ResearchHistory', 'ResearchOpportunity']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    }
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='ResearchHistory_executionKey_key'").get());
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});
