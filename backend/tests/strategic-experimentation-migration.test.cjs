const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260908120000_strategic_experimentation/migration.sql'), 'utf8');

test('strategic experimentation migration preserves data and enforces auditable unique outcomes', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE Project(id TEXT PRIMARY KEY); CREATE TABLE StrategicLearning(id TEXT PRIMARY KEY);
      CREATE TABLE PlannedContentItem(id TEXT PRIMARY KEY); CREATE TABLE PlanningExecutionEvent(id TEXT PRIMARY KEY);
      CREATE TABLE PlanningOutcome(id TEXT PRIMARY KEY); INSERT INTO PlanningOutcome(id) VALUES ('outcome');`);
    db.exec(migration);
    db.prepare(`INSERT INTO StrategicExperiment(id,title,status,primaryMetric,updatedAt) VALUES ('experiment','Hook test','RUNNING','ctr',CURRENT_TIMESTAMP)`).run();
    db.prepare(`INSERT INTO ExperimentHypothesis(id,experimentId,description,expectedVariantKey,updatedAt) VALUES ('hypothesis','experiment','Direct hook is associated with stronger CTR','A',CURRENT_TIMESTAMP)`).run();
    db.prepare(`INSERT INTO ExperimentVariant(id,experimentId,key,label,updatedAt) VALUES ('variant-a','experiment','A','Direct',CURRENT_TIMESTAMP)`).run();
    db.prepare(`INSERT INTO ExperimentObservation(id,experimentId,variantId,outcomeId,observedAt,freshness,dataQuality,comparisonContext,metrics)
      VALUES ('observation','experiment','variant-a','outcome',CURRENT_TIMESTAMP,'RECENT','HIGH','{}','{"ctr":0.06}')`).run();
    assert.throws(() => db.prepare(`INSERT INTO ExperimentObservation(id,experimentId,variantId,outcomeId,observedAt,freshness,dataQuality,comparisonContext,metrics)
      VALUES ('duplicate','experiment','variant-a','outcome',CURRENT_TIMESTAMP,'RECENT','HIGH','{}','{}')`).run(), /UNIQUE/);
    assert.equal(db.prepare('SELECT id FROM PlanningOutcome').get().id, 'outcome');
    assert.equal(db.pragma('foreign_key_check').length, 0); assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});
