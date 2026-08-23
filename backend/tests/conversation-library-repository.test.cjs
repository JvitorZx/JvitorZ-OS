const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const {
  ConversationLibraryItemRepository,
} = require('../dist/database/repositories/ConversationLibraryItemRepository');
const {
  ConversationRepository,
} = require('../dist/database/repositories/ConversationRepository');
const {
  LibraryItemRepository,
} = require('../dist/database/repositories/LibraryItemRepository');

let client;
let conversations;
let libraryItems;
let repository;

const createConversation = (title) =>
  conversations.create({ projectId: null, title, context: null });

const createLibraryItem = (title) =>
  libraryItems.create({ title, projectId: null, type: 'resource', content: title });

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await client.$executeRawUnsafe(`
    CREATE TABLE "Conversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT,
      "title" TEXT,
      "context" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "LibraryItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT,
      "sourceMessageId" TEXT,
      "title" TEXT NOT NULL,
      "type" TEXT,
      "content" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "ConversationLibraryItem" (
      "conversationId" TEXT NOT NULL,
      "libraryItemId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("conversationId", "libraryItemId"),
      FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY ("libraryItemId") REFERENCES "LibraryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  conversations = new ConversationRepository(client);
  libraryItems = new LibraryItemRepository(client);
  repository = new ConversationLibraryItemRepository(client);
});

beforeEach(async () => {
  await client.conversationLibraryItem.deleteMany();
  await client.libraryItem.deleteMany();
  await client.conversation.deleteMany();
});

after(async () => {
  await DatabaseService.disconnect();
});

describe('ConversationLibraryItemRepository', { concurrency: false }, () => {
  test('creates a persisted conversation and library item link', async () => {
    const conversation = await createConversation('Conversa');
    const item = await createLibraryItem('Artefato');

    const link = await repository.create(conversation.id, item.id);

    assert.equal(link.conversationId, conversation.id);
    assert.equal(link.libraryItemId, item.id);
    assert.ok(link.createdAt instanceof Date);
    assert.equal(await client.conversationLibraryItem.count(), 1);
  });

  test('findByConversationId resolves persisted items without N+1 queries', async () => {
    const conversation = await createConversation('Conversa');
    const first = await createLibraryItem('Primeiro');
    const second = await createLibraryItem('Segundo');
    await repository.create(conversation.id, first.id);
    await repository.create(conversation.id, second.id);

    const links = await repository.findByConversationId(conversation.id);

    assert.deepEqual(new Set(links.map(({ libraryItem }) => libraryItem.title)), new Set(['Primeiro', 'Segundo']));
  });

  test('orders links by createdAt ascending and libraryItemId ascending', async () => {
    const conversation = await createConversation('Conversa');
    const first = await createLibraryItem('Primeiro');
    const second = await createLibraryItem('Segundo');
    const newest = await createLibraryItem('Mais recente');
    await repository.create(conversation.id, first.id);
    await repository.create(conversation.id, second.id);
    await repository.create(conversation.id, newest.id);
    const tiedAt = new Date('2026-01-01T00:00:00.000Z');
    await client.conversationLibraryItem.updateMany({
      where: { libraryItemId: { in: [first.id, second.id] } },
      data: { createdAt: tiedAt },
    });
    await client.conversationLibraryItem.update({
      where: {
        conversationId_libraryItemId: {
          conversationId: conversation.id,
          libraryItemId: newest.id,
        },
      },
      data: { createdAt: new Date('2026-01-02T00:00:00.000Z') },
    });

    const tiedIds = [first.id, second.id].sort();
    const links = await repository.findByConversationId(conversation.id);

    assert.deepEqual(links.map(({ libraryItemId }) => libraryItemId), [...tiedIds, newest.id]);
  });

  test('findByConversationAndLibraryItem returns only the requested link', async () => {
    const conversation = await createConversation('Conversa');
    const item = await createLibraryItem('Artefato');
    await repository.create(conversation.id, item.id);

    const found = await repository.findByConversationAndLibraryItem(conversation.id, item.id);

    assert.equal(found.libraryItem.id, item.id);
    assert.equal(
      await repository.findByConversationAndLibraryItem(conversation.id, 'missing-item'),
      null,
    );
  });

  test('countByConversationId counts only links from that conversation', async () => {
    const firstConversation = await createConversation('A');
    const secondConversation = await createConversation('B');
    const first = await createLibraryItem('Primeiro');
    const second = await createLibraryItem('Segundo');
    await repository.create(firstConversation.id, first.id);
    await repository.create(firstConversation.id, second.id);
    await repository.create(secondConversation.id, first.id);

    assert.equal(await repository.countByConversationId(firstConversation.id), 2);
    assert.equal(await repository.countByConversationId(secondConversation.id), 1);
  });

  test('deleteLink removes only the requested association', async () => {
    const conversation = await createConversation('Conversa');
    const first = await createLibraryItem('Primeiro');
    const second = await createLibraryItem('Segundo');
    await repository.create(conversation.id, first.id);
    await repository.create(conversation.id, second.id);

    assert.equal(await repository.deleteLink(conversation.id, first.id), true);
    assert.equal(await repository.deleteLink(conversation.id, first.id), false);
    assert.equal(await repository.countByConversationId(conversation.id), 1);
  });

  test('database rejects a duplicate link at repository level', async () => {
    const conversation = await createConversation('Conversa');
    const item = await createLibraryItem('Artefato');
    await repository.create(conversation.id, item.id);

    await assert.rejects(
      repository.create(conversation.id, item.id),
      (error) => error?.code === 'P2002',
    );
    assert.equal(await repository.countByConversationId(conversation.id), 1);
  });

  test('links remain isolated between conversations', async () => {
    const firstConversation = await createConversation('A');
    const secondConversation = await createConversation('B');
    const firstItem = await createLibraryItem('Item A');
    const secondItem = await createLibraryItem('Item B');
    await repository.create(firstConversation.id, firstItem.id);
    await repository.create(secondConversation.id, secondItem.id);

    assert.deepEqual(
      (await repository.findByConversationId(firstConversation.id)).map(({ libraryItemId }) => libraryItemId),
      [firstItem.id],
    );
    assert.deepEqual(
      (await repository.findByConversationId(secondConversation.id)).map(({ libraryItemId }) => libraryItemId),
      [secondItem.id],
    );
  });
});
