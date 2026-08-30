const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260909120000_strategic_monitoring/migration.sql'), 'utf8');

test('strategic monitoring migration is additive and enforces audit identities', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE Project(id TEXT PRIMARY KEY); INSERT INTO Project(id) VALUES ('project');`);
    db.exec(migration);
    db.prepare(`INSERT INTO StrategicSignal(id,projectId,logicalKey,fingerprint,type,severity,state,source,sourceId,subject,summary,impact,confidence,detectedAt,lastObservedAt,cooldownUntil,updatedAt)
      VALUES ('signal','project','logical','fingerprint','TREND_DECLINING','MEDIUM','NEW','TRENDS','trend','CTR','Declining','Review',0.8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
    assert.throws(() => db.prepare(`INSERT INTO StrategicSignal(id,logicalKey,fingerprint,type,severity,source,sourceId,subject,summary,impact,confidence,detectedAt,lastObservedAt,cooldownUntil,updatedAt)
      VALUES ('duplicate','logical','other','TREND_DECLINING','MEDIUM','TRENDS','other','CTR','Declining','Review',0.8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(), /UNIQUE/);
    db.prepare(`INSERT INTO MonitoringSnapshot(id,projectId,evaluationFingerprint,evaluatedSources,sourceState,candidateCount,createdCount,updatedCount,resolvedCount,evaluatedAt)
      VALUES ('snapshot','project','evaluation','["TRENDS"]','{"TRENDS":"AVAILABLE"}',1,1,0,0,CURRENT_TIMESTAMP)`).run();
    db.prepare(`INSERT INTO SignalEvidence(id,signalId,snapshotId,source,sourceId,kind,summary,payload,observedAt)
      VALUES ('evidence','signal','snapshot','TRENDS','trend','DETECTED','Observed','{}',CURRENT_TIMESTAMP)`).run();
    assert.equal(db.prepare('SELECT COUNT(*) count FROM StrategicSignal').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM SignalEvidence').get().count, 1);
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});
