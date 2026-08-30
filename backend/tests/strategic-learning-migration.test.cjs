const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260907120000_strategic_learning_memory/migration.sql'), 'utf8');

test('strategic learning migration preserves outcomes and enforces auditable evidence', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY); CREATE TABLE "PlanningOutcome" ("id" TEXT NOT NULL PRIMARY KEY);');
    db.prepare('INSERT INTO PlanningOutcome(id) VALUES (?)').run('outcome');
    db.exec(migration);
    db.prepare(`INSERT INTO StrategicLearning
      (id, key, dimension, subject, comparisonContext, description, direction, status, observationCount,
       favorableCount, neutralCount, contraryCount, confidence, freshness, benchmark, limitations,
       analysisFingerprint, firstObservedAt, lastObservedAt, updatedAt)
      VALUES ('learning', 'key', 'FORMAT', 'LONG_FORM', '{}', 'Observed', 'FAVORABLE', 'WEAK', 1,
       1, 0, 0, .2, 'RECENT', '{}', '[]', 'fingerprint', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
    db.prepare(`INSERT INTO StrategicLearningEvidence(id, learningId, outcomeId, stance, summary)
      VALUES ('evidence', 'learning', 'outcome', 'FAVORABLE', 'Trace')`).run();
    assert.throws(() => db.prepare(`INSERT INTO StrategicLearningEvidence(id, learningId, outcomeId, stance, summary)
      VALUES ('duplicate', 'learning', 'outcome', 'FAVORABLE', 'Trace')`).run(), /UNIQUE/);
    assert.equal(db.prepare('SELECT id FROM PlanningOutcome').get().id, 'outcome');
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});
