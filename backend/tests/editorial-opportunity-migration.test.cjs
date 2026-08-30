const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const migration = readFileSync(path.resolve(__dirname,
  '../prisma/migrations/20260902100000_editorial_opportunity_ranking/migration.sql'), 'utf8');

test('editorial opportunity migration is additive and preserves decision history', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE "EditorialDecision" (
        "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT, "conversationId" TEXT,
        "dedupeKey" TEXT NOT NULL UNIQUE, "question" TEXT NOT NULL, "intent" TEXT NOT NULL,
        "recommendation" TEXT NOT NULL, "alternatives" JSONB NOT NULL, "score" REAL,
        "confidence" REAL NOT NULL, "classification" TEXT NOT NULL DEFAULT 'recommendation',
        "evidence" JSONB NOT NULL, "risks" JSONB NOT NULL, "missingData" JSONB NOT NULL,
        "nextAction" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );
      INSERT INTO "EditorialDecision" (
        "id", "dedupeKey", "question", "intent", "recommendation", "alternatives",
        "confidence", "evidence", "risks", "missingData", "nextAction", "updatedAt"
      ) VALUES ('legacy', 'legacy-key', 'Question', 'next_content', 'Recommendation', '[]',
        0.4, '[]', '[]', '[]', 'Action', CURRENT_TIMESTAMP);
      ${migration}
    `);
    const row = db.prepare('SELECT * FROM "EditorialDecision" WHERE "id" = ?').get('legacy');
    assert.equal(row.category, 'INSUFFICIENT_DATA');
    assert.equal(row.favorableEvidence, '[]');
    assert.equal(row.contraryEvidence, '[]');
    assert.equal(row.constraints, '[]');
    assert.equal(db.prepare('PRAGMA integrity_check').pluck().get(), 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});
