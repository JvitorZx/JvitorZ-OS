const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');
const Database = require('better-sqlite3');

const migrationSql = readFileSync(path.resolve(
  __dirname,
  '../prisma/migrations/20260824190000_creator_intelligence_foundation/migration.sql',
), 'utf8');

const migrate = (callback) => {
  const database = new Database(':memory:');
  try {
    database.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT);
      CREATE TABLE "Conversation" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT);
      CREATE TABLE "LibraryItem" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL);
      INSERT INTO "Project" ("id", "name") VALUES ('project-1', 'Canal');
      INSERT INTO "Conversation" ("id", "title") VALUES ('conversation-1', 'Persistida');
      INSERT INTO "LibraryItem" ("id", "title") VALUES ('library-1', 'Persistido');
    `);
    database.exec(migrationSql);
    callback(database);
  } finally {
    database.close();
  }
};

describe('Creator Intelligence migration', () => {
  test('creates all five domain tables without changing existing data', () => {
    migrate((database) => {
      const tables = database.prepare(`
        SELECT "name" FROM "sqlite_master"
        WHERE "type" = 'table' AND "name" IN (
          'VideoIdea', 'ContentOpportunity', 'ContentDecision', 'ChannelInsight', 'PerformanceSignal'
        ) ORDER BY "name"
      `).all().map(({ name }) => name);

      assert.deepEqual(tables, [
        'ChannelInsight',
        'ContentDecision',
        'ContentOpportunity',
        'PerformanceSignal',
        'VideoIdea',
      ]);
      assert.deepEqual(
        database.prepare('SELECT "id", "title" FROM "Conversation"').get(),
        { id: 'conversation-1', title: 'Persistida' },
      );
      assert.deepEqual(
        database.prepare('SELECT "id", "title" FROM "LibraryItem"').get(),
        { id: 'library-1', title: 'Persistido' },
      );
    });
  });

  test('persists an idea and its opportunity, decision and performance signal', () => {
    migrate((database) => {
      database.exec(`
        INSERT INTO "VideoIdea" (
          "id", "projectId", "theme", "format", "premise", "createdAt", "updatedAt"
        ) VALUES ('idea-1', 'project-1', 'Simulacao', 'desafio', 'Premissa', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO "ContentOpportunity" (
          "id", "videoIdeaId", "source", "classification", "summary"
        ) VALUES ('opportunity-1', 'idea-1', 'internal', 'inference', 'Oportunidade');
        INSERT INTO "ContentDecision" (
          "id", "videoIdeaId", "category", "score", "rationale", "evidence"
        ) VALUES ('decision-1', 'idea-1', 'TESTAR', 65, 'Racional', '{}');
        INSERT INTO "PerformanceSignal" (
          "id", "projectId", "videoIdeaId", "metric", "value", "source", "measuredAt"
        ) VALUES ('signal-1', 'project-1', 'idea-1', 'similar_content_performance', 70, 'internal', CURRENT_TIMESTAMP);
      `);

      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "VideoIdea"').get().count, 1);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "ContentOpportunity"').get().count, 1);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "ContentDecision"').get().count, 1);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "PerformanceSignal"').get().count, 1);
    });
  });

  test('updates channel memory by its stable unique key', () => {
    migrate((database) => {
      const insert = database.prepare(`
        INSERT INTO "ChannelInsight" (
          "id", "projectId", "key", "category", "subject", "statement",
          "confidence", "classification", "createdAt", "updatedAt"
        ) VALUES (?, 'project-1', ?, 'game', 'Jogo', 'Sinal', 0.5, 'inference', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      insert.run('insight-1', 'project-1:game:jogo');
      assert.throws(
        () => insert.run('insight-2', 'project-1:game:jogo'),
        (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE',
      );
    });
  });

  test('cascades idea-owned decisions and opportunities while preserving project data', () => {
    migrate((database) => {
      database.exec(`
        INSERT INTO "VideoIdea" (
          "id", "projectId", "theme", "format", "premise", "createdAt", "updatedAt"
        ) VALUES ('idea-1', 'project-1', 'Tema', 'Formato', 'Premissa', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO "ContentOpportunity" (
          "id", "videoIdeaId", "source", "classification", "summary"
        ) VALUES ('opportunity-1', 'idea-1', 'internal', 'real', 'Oportunidade');
        INSERT INTO "ContentDecision" (
          "id", "videoIdeaId", "category", "score", "rationale", "evidence"
        ) VALUES ('decision-1', 'idea-1', 'GRAVAR', 80, 'Racional', '{}');
        DELETE FROM "VideoIdea" WHERE "id" = 'idea-1';
      `);

      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "ContentOpportunity"').get().count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "ContentDecision"').get().count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "Project"').get().count, 1);
    });
  });
});
