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
const {
  ConversationLibraryConversationNotFoundError,
  ConversationLibraryItemNotFoundError,
  ConversationLibraryLimitReachedError,
  ConversationLibraryPersistenceError,
  ConversationLibraryService,
} = require('../dist/services/ConversationLibraryService');

let client;
let conversations;
let libraryItems;
let links;
let service;

const createConversation = (title = 'Conversa') =>
  conversations.create({ projectId: null, title, context: null });

const createLibraryItem = (title) =>
  libraryItems.create({ title, projectId: null, type: 'resource', content: `Conteudo ${title}` });

const createItems = (count, prefix = 'Item') =>
  Promise.all(Array.from({ length: count }, (_, index) => createLibraryItem(`${prefix} ${index + 1}`)));

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
    CREATE TABLE "Message" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "sender" TEXT NOT NULL,
      "text" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
  links = new ConversationLibraryItemRepository(client);
  service = new ConversationLibraryService(conversations, libraryItems, links);
});

beforeEach(async () => {
  await client.conversationLibraryItem.deleteMany();
  await client.libraryItem.deleteMany();
  await client.message.deleteMany();
  await client.conversation.deleteMany();
});

after(async () => {
  await DatabaseService.disconnect();
});

describe('ConversationLibraryService', { concurrency: false }, () => {
  test('links a valid persisted library item', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');

    const result = await service.linkItem(conversation.id, item.id);

    assert.equal(result.created, true);
    assert.equal(result.item.id, item.id);
    assert.equal(await links.countByConversationId(conversation.id), 1);
  });

  test('rejects a missing conversation before creating a link', async () => {
    const item = await createLibraryItem('Artefato');

    await assert.rejects(
      service.linkItem('missing-conversation', item.id),
      ConversationLibraryConversationNotFoundError,
    );
    assert.equal(await client.conversationLibraryItem.count(), 0);
  });

  test('rejects a missing library item', async () => {
    const conversation = await createConversation();

    await assert.rejects(
      service.linkItem(conversation.id, 'missing-item'),
      ConversationLibraryItemNotFoundError,
    );
    assert.equal(await links.countByConversationId(conversation.id), 0);
  });

  test('returns the existing link idempotently', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');

    const first = await service.linkItem(conversation.id, item.id);
    const second = await service.linkItem(conversation.id, item.id);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.item.id, item.id);
    assert.equal(await links.countByConversationId(conversation.id), 1);
  });

  test('keeps an existing link idempotent when the conversation already has five items', async () => {
    const conversation = await createConversation();
    const items = await createItems(5);
    for (const item of items) await service.linkItem(conversation.id, item.id);

    const repeated = await service.linkItem(conversation.id, items[0].id);

    assert.equal(repeated.created, false);
    assert.equal(repeated.item.id, items[0].id);
    assert.equal(await links.countByConversationId(conversation.id), 5);
  });

  test('rejects a sixth different item with a domain limit error', async () => {
    const conversation = await createConversation();
    const items = await createItems(6);
    for (const item of items.slice(0, 5)) await service.linkItem(conversation.id, item.id);

    await assert.rejects(
      service.linkItem(conversation.id, items[5].id),
      ConversationLibraryLimitReachedError,
    );
    assert.equal(await links.countByConversationId(conversation.id), 5);
  });

  test('unlinking an item frees one slot', async () => {
    const conversation = await createConversation();
    const items = await createItems(6);
    for (const item of items.slice(0, 5)) await service.linkItem(conversation.id, item.id);

    assert.deepEqual(await service.unlinkItem(conversation.id, items[0].id), { removed: true });
    const replacement = await service.linkItem(conversation.id, items[5].id);

    assert.equal(replacement.created, true);
    assert.equal(await links.countByConversationId(conversation.id), 5);
  });

  test('lists only real items linked to the requested conversation', async () => {
    const firstConversation = await createConversation('A');
    const secondConversation = await createConversation('B');
    const [firstItem, secondItem, unrelated] = await createItems(3);
    await service.linkItem(firstConversation.id, firstItem.id);
    await service.linkItem(firstConversation.id, secondItem.id);
    await service.linkItem(secondConversation.id, unrelated.id);

    const listed = await service.listLinkedItems(firstConversation.id);

    assert.deepEqual(new Set(listed.map(({ id }) => id)), new Set([firstItem.id, secondItem.id]));
    assert.ok(listed.every(({ content }) => typeof content === 'string'));
  });

  test('allows the same library item in different conversations', async () => {
    const firstConversation = await createConversation('A');
    const secondConversation = await createConversation('B');
    const item = await createLibraryItem('Compartilhado');

    await service.linkItem(firstConversation.id, item.id);
    await service.linkItem(secondConversation.id, item.id);

    assert.equal(await links.countByConversationId(firstConversation.id), 1);
    assert.equal(await links.countByConversationId(secondConversation.id), 1);
  });

  test('unlinkItem removes an existing link', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');
    await service.linkItem(conversation.id, item.id);

    assert.deepEqual(await service.unlinkItem(conversation.id, item.id), { removed: true });
    assert.equal(await links.countByConversationId(conversation.id), 0);
  });

  test('unlinkItem is idempotent when the link does not exist', async () => {
    const conversation = await createConversation();

    assert.deepEqual(
      await service.unlinkItem(conversation.id, 'missing-link'),
      { removed: false },
    );
  });

  test('unlinkItem never deletes the library item', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');
    await service.linkItem(conversation.id, item.id);

    await service.unlinkItem(conversation.id, item.id);

    assert.equal((await libraryItems.findById(item.id)).id, item.id);
  });

  test('concurrent calls for the same item persist one link', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');

    const results = await Promise.all([
      service.linkItem(conversation.id, item.id),
      service.linkItem(conversation.id, item.id),
    ]);

    assert.deepEqual(results.map(({ created }) => created).sort(), [false, true]);
    assert.equal(await links.countByConversationId(conversation.id), 1);
  });

  test('concurrent different links cannot exceed the five-item limit', async () => {
    const conversation = await createConversation();
    const items = await createItems(6);
    for (const item of items.slice(0, 4)) await service.linkItem(conversation.id, item.id);

    const results = await Promise.allSettled([
      service.linkItem(conversation.id, items[4].id),
      service.linkItem(conversation.id, items[5].id),
    ]);

    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(results.filter(
      (result) => result.status === 'rejected'
        && result.reason instanceof ConversationLibraryLimitReachedError,
    ).length, 1);
    assert.equal(await links.countByConversationId(conversation.id), 5);
  });

  test('recovers a unique conflict without exposing Prisma details', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');
    const existingLink = { libraryItem: item };
    const conflictRepository = {
      async createWithinLimit() {
        const error = new Error('private SQL and database path');
        error.code = 'P2002';
        throw error;
      },
      async findByConversationAndLibraryItem() {
        return existingLink;
      },
    };
    const conflictService = new ConversationLibraryService(
      conversations,
      libraryItems,
      conflictRepository,
    );

    const result = await conflictService.linkItem(conversation.id, item.id);

    assert.equal(result.created, false);
    assert.equal(result.item.id, item.id);
  });

  test('converts unexpected persistence failures into a safe domain error', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');
    const failingRepository = {
      async createWithinLimit() {
        throw new Error('private SQL, Prisma stack and database path');
      },
    };
    const failingService = new ConversationLibraryService(
      conversations,
      libraryItems,
      failingRepository,
    );

    await assert.rejects(
      failingService.linkItem(conversation.id, item.id),
      (error) => error instanceof ConversationLibraryPersistenceError
        && !error.message.includes('Prisma')
        && !error.message.includes('database'),
    );
  });
});
