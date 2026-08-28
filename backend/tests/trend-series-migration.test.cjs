const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const migration = readFileSync(path.resolve(__dirname, '../prisma/migrations/20260901120000_trends_series_patterns/migration.sql'), 'utf8');

test('trend and series migration is additive, valid in SQLite and preserves legacy rows', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "VideoPerformanceSnapshot" ("id" TEXT NOT NULL PRIMARY KEY);
      INSERT INTO "Project" ("id") VALUES ('legacy-project');
      INSERT INTO "VideoPerformanceSnapshot" ("id") VALUES ('legacy-snapshot');
    `);
    db.exec(migration);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM "Project"').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM "VideoPerformanceSnapshot"').get().count, 1);
    for (const table of ['TrendSignal', 'SeriesDefinition', 'VideoSeriesLink', 'ContentPattern']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    }
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='VideoSeriesLink_seriesId_videoId_key'").get());
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});
