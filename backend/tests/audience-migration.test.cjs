const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('audience migration is SQLite-compatible and preserves legacy project data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvitorz-audience-migration-'));
  const file = path.join(dir, 'test.db');
  const db = new Database(file);
  try {
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY); INSERT INTO "Project" ("id") VALUES (\'existing\');');
    db.exec(fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260827223500_audience_traffic_intelligence/migration.sql'), 'utf8'));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "Project"').get().count, 1);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='AudienceSnapshot'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='AudienceSyncState'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='AudienceSnapshot_ingestionKey_key'").get());
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
