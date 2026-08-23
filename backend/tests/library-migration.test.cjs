const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const migrationPath = path.resolve(
  __dirname,
  '../prisma/migrations/20260823160000_library_item_source_message/migration.sql',
);

test('library source migration preserves legacy items and enforces one item per message', () => {
  const database = new Database(':memory:');

  try {
    database.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "Message" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "LibraryItem" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "projectId" TEXT,
        "title" TEXT NOT NULL,
        "type" TEXT,
        "content" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
      INSERT INTO "LibraryItem" (
        "id", "title", "type", "content", "updatedAt"
      ) VALUES (
        'legacy-item', 'Legado', 'resource', 'Conteúdo preservado', CURRENT_TIMESTAMP
      );
    `);

    database.exec(readFileSync(migrationPath, 'utf8'));

    const legacy = database.prepare(
      'SELECT "title", "content", "sourceMessageId" FROM "LibraryItem" WHERE "id" = ?',
    ).get('legacy-item');
    assert.deepEqual(legacy, {
      title: 'Legado',
      content: 'Conteúdo preservado',
      sourceMessageId: null,
    });

    const columns = database.prepare('PRAGMA table_info("LibraryItem")').all();
    assert.equal(columns.some(({ name }) => name === 'sourceMessageId'), true);
    const sourceForeignKey = database.prepare('PRAGMA foreign_key_list("LibraryItem")').all()
      .find(({ from }) => from === 'sourceMessageId');
    assert.equal(sourceForeignKey.table, 'Message');
    assert.equal(sourceForeignKey.on_delete, 'SET NULL');

    database.prepare('INSERT INTO "Message" ("id") VALUES (?)').run('message-1');
    const insertItem = database.prepare(`
      INSERT INTO "LibraryItem" (
        "id", "sourceMessageId", "title", "type", "content", "updatedAt"
      ) VALUES (?, ?, ?, 'resource', ?, CURRENT_TIMESTAMP)
    `);
    insertItem.run('item-1', 'message-1', 'Primeiro', 'Resposta');

    assert.throws(
      () => insertItem.run('item-2', 'message-1', 'Duplicado', 'Resposta duplicada'),
      (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE',
    );
    assert.equal(
      database.prepare(
        'SELECT COUNT(*) AS "count" FROM "LibraryItem" WHERE "sourceMessageId" = ?',
      ).get('message-1').count,
      1,
    );

    database.prepare('DELETE FROM "Message" WHERE "id" = ?').run('message-1');
    assert.equal(
      database.prepare(
        'SELECT "sourceMessageId" FROM "LibraryItem" WHERE "id" = ?',
      ).get('item-1').sourceMessageId,
      null,
    );
  } finally {
    database.close();
  }
});
