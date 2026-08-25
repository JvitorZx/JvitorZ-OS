const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');
const Database = require('better-sqlite3');

const migration = readFileSync(path.join(
  __dirname,
  '../prisma/migrations/20260825100000_youtube_analytics_subscribers_lost/migration.sql',
), 'utf8');

const createPreviousDatabase = () => {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE "VideoPerformanceSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "ingestionKey" TEXT NOT NULL UNIQUE,
      "videoId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "subscribersGained" INTEGER,
      "source" TEXT NOT NULL,
      "confidence" REAL NOT NULL DEFAULT 1,
      "collectedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    INSERT INTO "VideoPerformanceSnapshot" (
      "id", "ingestionKey", "videoId", "title", "subscribersGained", "source", "collectedAt", "updatedAt"
    ) VALUES (
      'legacy', 'legacy-key', 'legacy-video', 'Legacy video', 5, 'manual',
      '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'
    );
  `);
  return database;
};

describe('YouTube Analytics subscribers lost migration', () => {
  test('adds the nullable field while preserving existing snapshots', () => {
    const database = createPreviousDatabase();
    database.exec(migration);
    const columns = database.prepare('PRAGMA table_info("VideoPerformanceSnapshot")').all();
    const field = columns.find(({ name }) => name === 'subscribersLost');
    const legacy = database.prepare('SELECT * FROM "VideoPerformanceSnapshot" WHERE "id" = ?').get('legacy');
    assert.ok(field);
    assert.equal(field.notnull, 0);
    assert.equal(legacy.title, 'Legacy video');
    assert.equal(legacy.subscribersGained, 5);
    assert.equal(legacy.subscribersLost, null);
    database.close();
  });

  test('accepts an actual subscribers-lost value after migration', () => {
    const database = createPreviousDatabase();
    database.exec(migration);
    database.prepare('UPDATE "VideoPerformanceSnapshot" SET "subscribersLost" = ? WHERE "id" = ?').run(2, 'legacy');
    assert.equal(database.prepare('SELECT "subscribersLost" FROM "VideoPerformanceSnapshot"').get().subscribersLost, 2);
    database.close();
  });
});
