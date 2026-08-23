const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');
const Database = require('better-sqlite3');

const migrationPath = path.resolve(
  __dirname,
  '../prisma/migrations/20260823180000_conversation_library_items/migration.sql',
);
const migrationSql = readFileSync(migrationPath, 'utf8');

const createSprint16Database = () => {
  const database = new Database(':memory:');
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE "Project" (
      "id" TEXT NOT NULL PRIMARY KEY
    );
    CREATE TABLE "Conversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT,
      "title" TEXT,
      "context" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
    CREATE TABLE "Message" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "sender" TEXT NOT NULL,
      "text" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE TABLE "LibraryItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT,
      "sourceMessageId" TEXT,
      "title" TEXT NOT NULL,
      "type" TEXT,
      "content" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      FOREIGN KEY ("sourceMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX "LibraryItem_sourceMessageId_key" ON "LibraryItem"("sourceMessageId");

    INSERT INTO "Conversation" (
      "id", "title", "context", "createdAt", "updatedAt"
    ) VALUES
      ('conversation-1', 'Conversation 1', 'Context 1', '2026-08-20 10:00:00', '2026-08-20 10:00:00'),
      ('conversation-2', 'Conversation 2', 'Context 2', '2026-08-20 11:00:00', '2026-08-20 11:00:00'),
      ('conversation-empty', 'Conversation Empty', NULL, '2026-08-20 12:00:00', '2026-08-20 12:00:00');
    INSERT INTO "Message" (
      "id", "conversationId", "sender", "text", "createdAt"
    ) VALUES (
      'message-1', 'conversation-1', 'operator', 'Persisted response', '2026-08-20 10:05:00'
    );
    INSERT INTO "LibraryItem" (
      "id", "sourceMessageId", "title", "type", "content", "createdAt", "updatedAt"
    ) VALUES
      ('library-1', 'message-1', 'Artifact 1', 'resource', 'Content 1', '2026-08-20 10:06:00', '2026-08-20 10:06:00'),
      ('library-2', NULL, 'Artifact 2', 'reference', 'Content 2', '2026-08-20 10:07:00', '2026-08-20 10:07:00');
  `);

  return database;
};

const withMigratedDatabase = (callback) => {
  const database = createSprint16Database();

  try {
    database.exec(migrationSql);
    callback(database);
  } finally {
    database.close();
  }
};

const insertLink = (database, conversationId, libraryItemId) =>
  database.prepare(`
    INSERT INTO "ConversationLibraryItem" ("conversationId", "libraryItemId")
    VALUES (?, ?)
  `).run(conversationId, libraryItemId);

describe('ConversationLibraryItem migration', () => {
  test('applies to a Sprint 16 SQLite database and creates the join table empty', () => {
    withMigratedDatabase((database) => {
      const table = database.prepare(`
        SELECT "name" FROM "sqlite_master"
        WHERE "type" = 'table' AND "name" = 'ConversationLibraryItem'
      `).get();

      assert.deepEqual(table, { name: 'ConversationLibraryItem' });
      assert.equal(
        database.prepare('SELECT COUNT(*) AS "count" FROM "ConversationLibraryItem"').get().count,
        0,
      );
    });
  });

  test('preserves existing conversations, library items and messages unchanged', () => {
    withMigratedDatabase((database) => {
      assert.deepEqual(
        database.prepare(`
          SELECT "id", "title", "context" FROM "Conversation" ORDER BY "id"
        `).all(),
        [
          { id: 'conversation-1', title: 'Conversation 1', context: 'Context 1' },
          { id: 'conversation-2', title: 'Conversation 2', context: 'Context 2' },
          { id: 'conversation-empty', title: 'Conversation Empty', context: null },
        ],
      );
      assert.deepEqual(
        database.prepare(`
          SELECT "id", "sourceMessageId", "title", "content" FROM "LibraryItem" ORDER BY "id"
        `).all(),
        [
          {
            id: 'library-1',
            sourceMessageId: 'message-1',
            title: 'Artifact 1',
            content: 'Content 1',
          },
          {
            id: 'library-2',
            sourceMessageId: null,
            title: 'Artifact 2',
            content: 'Content 2',
          },
        ],
      );
      assert.deepEqual(
        database.prepare(`
          SELECT "id", "conversationId", "sender", "text" FROM "Message"
        `).get(),
        {
          id: 'message-1',
          conversationId: 'conversation-1',
          sender: 'operator',
          text: 'Persisted response',
        },
      );
    });
  });

  test('creates a valid link with a persisted createdAt value', () => {
    withMigratedDatabase((database) => {
      insertLink(database, 'conversation-1', 'library-1');
      const link = database.prepare(`
        SELECT "conversationId", "libraryItemId", "createdAt"
        FROM "ConversationLibraryItem"
      `).get();

      assert.equal(link.conversationId, 'conversation-1');
      assert.equal(link.libraryItemId, 'library-1');
      assert.equal(typeof link.createdAt, 'string');
      assert.notEqual(link.createdAt.length, 0);
    });
  });

  test('rejects a duplicate conversation and library item pair', () => {
    withMigratedDatabase((database) => {
      insertLink(database, 'conversation-1', 'library-1');

      assert.throws(
        () => insertLink(database, 'conversation-1', 'library-1'),
        (error) => error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY',
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS "count" FROM "ConversationLibraryItem"').get().count,
        1,
      );
    });
  });

  test('allows one library item to be linked to different conversations', () => {
    withMigratedDatabase((database) => {
      insertLink(database, 'conversation-1', 'library-1');
      insertLink(database, 'conversation-2', 'library-1');

      assert.deepEqual(
        database.prepare(`
          SELECT "conversationId" FROM "ConversationLibraryItem"
          WHERE "libraryItemId" = 'library-1' ORDER BY "conversationId"
        `).all(),
        [{ conversationId: 'conversation-1' }, { conversationId: 'conversation-2' }],
      );
    });
  });

  test('allows one conversation to link different library items', () => {
    withMigratedDatabase((database) => {
      insertLink(database, 'conversation-1', 'library-1');
      insertLink(database, 'conversation-1', 'library-2');

      assert.deepEqual(
        database.prepare(`
          SELECT "libraryItemId" FROM "ConversationLibraryItem"
          WHERE "conversationId" = 'conversation-1' ORDER BY "libraryItemId"
        `).all(),
        [{ libraryItemId: 'library-1' }, { libraryItemId: 'library-2' }],
      );
    });
  });

  test('enforces both foreign-key relations', () => {
    withMigratedDatabase((database) => {
      assert.throws(
        () => insertLink(database, 'missing-conversation', 'library-1'),
        (error) => error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY',
      );
      assert.throws(
        () => insertLink(database, 'conversation-1', 'missing-library-item'),
        (error) => error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY',
      );
    });
  });

  test('cascades links when a conversation is deleted', () => {
    withMigratedDatabase((database) => {
      insertLink(database, 'conversation-empty', 'library-1');
      database.prepare('DELETE FROM "Conversation" WHERE "id" = ?').run('conversation-empty');

      assert.equal(
        database.prepare('SELECT COUNT(*) AS "count" FROM "ConversationLibraryItem"').get().count,
        0,
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS "count" FROM "LibraryItem"').get().count,
        2,
      );
    });
  });

  test('cascades links when a library item is deleted', () => {
    withMigratedDatabase((database) => {
      insertLink(database, 'conversation-1', 'library-2');
      database.prepare('DELETE FROM "LibraryItem" WHERE "id" = ?').run('library-2');

      assert.equal(
        database.prepare('SELECT COUNT(*) AS "count" FROM "ConversationLibraryItem"').get().count,
        0,
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS "count" FROM "Conversation"').get().count,
        3,
      );
    });
  });

  test('defines deterministic ordering and inverse lookup indexes', () => {
    withMigratedDatabase((database) => {
      const indexNames = database.prepare('PRAGMA index_list("ConversationLibraryItem")').all()
        .map(({ name }) => name);

      assert.equal(
        indexNames.includes(
          'ConversationLibraryItem_conversationId_createdAt_libraryItemId_idx',
        ),
        true,
      );
      assert.equal(indexNames.includes('ConversationLibraryItem_libraryItemId_idx'), true);
    });
  });
});
