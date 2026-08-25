const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');
const Database = require('better-sqlite3');

const migration = readFileSync(path.join(
  __dirname,
  '../prisma/migrations/20260824213000_performance_intelligence/migration.sql',
), 'utf8');

const createPreviousDatabase = () => {
  const database = new Database(':memory:');
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "VideoIdea" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "PerformanceSignal" (
      "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "videoIdeaId" TEXT,
      "game" TEXT, "format" TEXT, "metric" TEXT NOT NULL, "value" REAL NOT NULL,
      "sampleSize" INTEGER NOT NULL DEFAULT 1, "source" TEXT NOT NULL,
      "classification" TEXT NOT NULL DEFAULT 'real', "measuredAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL,
      FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea"("id") ON DELETE SET NULL
    );
    INSERT INTO "PerformanceSignal" (
      "id", "metric", "value", "source", "measuredAt"
    ) VALUES ('legacy', 'game_performance', 75, 'legacy-source', '2026-08-01T00:00:00.000Z');
  `);
  return database;
};

describe('Performance Intelligence migration', () => {
  test('applies to the previous schema and preserves legacy signals', () => {
    const database = createPreviousDatabase();
    database.exec(migration);
    const legacy = database.prepare('SELECT * FROM "PerformanceSignal" WHERE "id" = ?').get('legacy');
    assert.equal(legacy.value, 75);
    assert.equal(legacy.confidence, 1);
    assert.equal(legacy.performanceSnapshotId, null);
    assert.equal(legacy.series, null);
    database.close();
  });

  test('creates snapshot fields, foreign key and idempotency indexes', () => {
    const database = createPreviousDatabase();
    database.exec(migration);
    const columns = database.prepare('PRAGMA table_info("VideoPerformanceSnapshot")').all().map(({ name }) => name);
    assert.ok(columns.includes('averageViewPercentage'));
    assert.ok(columns.includes('subscribersGained'));
    assert.ok(columns.includes('confidence'));
    const snapshotIndexes = database.prepare('PRAGMA index_list("VideoPerformanceSnapshot")').all();
    const signalIndexes = database.prepare('PRAGMA index_list("PerformanceSignal")').all();
    assert.ok(snapshotIndexes.some(({ name, unique }) => name === 'VideoPerformanceSnapshot_ingestionKey_key' && unique === 1));
    assert.ok(signalIndexes.some(({ name, unique }) => name === 'PerformanceSignal_key_key' && unique === 1));
    const foreignKeys = database.prepare('PRAGMA foreign_key_list("PerformanceSignal")').all();
    assert.ok(foreignKeys.some(({ table, on_delete }) => table === 'VideoPerformanceSnapshot' && on_delete === 'CASCADE'));
    database.close();
  });

  test('allows legacy null origins while enforcing unique derived signal keys', () => {
    const database = createPreviousDatabase();
    database.exec(migration);
    const insert = database.prepare(`
      INSERT INTO "PerformanceSignal" (
        "id", "key", "metric", "value", "source", "measuredAt"
      ) VALUES (?, ?, 'retention_performance', 50, 'manual', '2026-08-24T00:00:00.000Z')
    `);
    insert.run('one', 'snapshot:retention');
    assert.throws(() => insert.run('two', 'snapshot:retention'), /UNIQUE/);
    database.close();
  });
});
