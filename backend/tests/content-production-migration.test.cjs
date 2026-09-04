const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260913120000_content_production_pipeline/migration.sql'), 'utf8');

const prerequisites = `
  CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
  CREATE TABLE "VideoIdea" ("id" TEXT NOT NULL PRIMARY KEY);
  CREATE TABLE "PlannedContentItem" ("id" TEXT NOT NULL PRIMARY KEY);
  CREATE TABLE "SeriesDefinition" ("id" TEXT NOT NULL PRIMARY KEY);
  CREATE TABLE "ContentPackaging" ("id" TEXT NOT NULL PRIMARY KEY);
  CREATE TABLE "LibraryItem" ("id" TEXT NOT NULL PRIMARY KEY);
`;

test('content production migration is additive and keeps existing records', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); db.exec(prerequisites);
    db.exec("INSERT INTO Project(id) VALUES ('legacy-project')"); db.exec(migration);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM Project').get().count, 1);
    for (const table of ['ContentProduction', 'ProductionStep', 'ProductionEvent', 'ProductionAssetRelation']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    }
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});

test('content production migration enforces workflow and asset identities', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); db.exec(prerequisites); db.exec(migration);
    db.exec(`INSERT INTO ContentProduction(id,productionKey,title,format,origin,workflowTemplate,updatedAt)
      VALUES ('p','production-key','Video','LONG_FORM','DIRECT','LONG_FORM',CURRENT_TIMESTAMP)`);
    db.exec(`INSERT INTO ProductionStep(id,productionId,key,label,position,mode,updatedAt)
      VALUES ('s','p','EDITING','Edicao',1,'MANUAL',CURRENT_TIMESTAMP)`);
    assert.throws(() => db.exec(`INSERT INTO ProductionStep(id,productionId,key,label,position,mode,updatedAt)
      VALUES ('s2','p','EDITING','Edicao',2,'MANUAL',CURRENT_TIMESTAMP)`));
    db.exec("INSERT INTO LibraryItem(id) VALUES ('asset')");
    db.exec("INSERT INTO ProductionAssetRelation(id,productionId,libraryItemId,role) VALUES ('a','p','asset','RAW_VIDEO')");
    assert.throws(() => db.exec("INSERT INTO ProductionAssetRelation(id,productionId,libraryItemId,role) VALUES ('a2','p','asset','RAW_VIDEO')"));
  } finally { db.close(); }
});
