const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const {
  ConversationRepository,
} = require('../dist/database/repositories/ConversationRepository');
const {
  LibraryItemRepository,
} = require('../dist/database/repositories/LibraryItemRepository');
const { MessageRepository } = require('../dist/database/repositories/MessageRepository');
const {
  LibraryConversationNotFoundError,
  LibraryMessageConversationMismatchError,
  LibraryMessageNotFoundError,
  LibraryMessageSenderNotAllowedError,
  LibraryService,
} = require('../dist/services/LibraryService');

let client;
let conversations;
let messages;
let libraryItems;
let service;

const createConversation = (title = 'Conversa de teste') =>
  conversations.create({ projectId: null, title, context: null });

const createMessage = (conversationId, sender = 'operator', text = 'Resposta persistida') =>
  messages.create({ conversationId, sender, text });

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
      FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id")
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
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("sourceMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await client.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "LibraryItem_sourceMessageId_key" ON "LibraryItem"("sourceMessageId")',
  );

  conversations = new ConversationRepository(client);
  messages = new MessageRepository(client);
  libraryItems = new LibraryItemRepository(client);
  service = new LibraryService(conversations, messages, libraryItems);
});

beforeEach(async () => {
  await client.libraryItem.deleteMany();
  await client.message.deleteMany();
  await client.conversation.deleteMany();
});

after(async () => {
  await DatabaseService.disconnect();
});

describe('LibraryService', { concurrency: false }, () => {
  test('saves a persisted operator message as a library item', async () => {
    const conversation = await createConversation('Planejamento semanal');
    const message = await createMessage(conversation.id, 'operator', 'Plano persistido');

    const result = await service.saveOperatorMessage(conversation.id, message.id);
    const { item } = result;

    assert.equal(result.created, true);
    assert.equal(item.title, 'Resposta - Planejamento semanal');
    assert.equal(item.type, 'resource');
    assert.equal(item.content, 'Plano persistido');
    assert.equal(await client.libraryItem.count(), 1);
  });

  test('copies content from the persisted message and ignores external arguments', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id, 'operator', 'Conteudo real do banco');

    const result = await service.saveOperatorMessage(
      conversation.id,
      message.id,
      'Conteudo forjado pelo cliente',
    );
    const { item } = result;

    assert.equal(item.content, 'Conteudo real do banco');
    assert.notEqual(item.content, 'Conteudo forjado pelo cliente');
  });

  test('returns the existing item when the same message is saved again', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id);

    const first = await service.saveOperatorMessage(conversation.id, message.id);
    const second = await service.saveOperatorMessage(conversation.id, message.id);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.item.id, first.item.id);
    assert.equal(second.item.sourceMessageId, message.id);
    assert.equal(await client.libraryItem.count(), 1);
  });

  test('concurrent saves for the same message persist exactly one item', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id);

    const results = await Promise.all([
      service.saveOperatorMessage(conversation.id, message.id),
      service.saveOperatorMessage(conversation.id, message.id),
    ]);

    assert.deepEqual(results.map(({ created }) => created).sort(), [false, true]);
    assert.equal(new Set(results.map(({ item }) => item.id)).size, 1);
    assert.equal(await client.libraryItem.count(), 1);
  });

  test('recovers the existing item from a unique conflict without leaking its details', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id);
    const existing = {
      id: 'library-existing',
      projectId: null,
      sourceMessageId: message.id,
      title: 'Resposta existente',
      type: 'resource',
      content: message.text,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let lookupCount = 0;
    const repository = {
      async findBySourceMessageId() {
        lookupCount += 1;
        return lookupCount === 1 ? null : existing;
      },
      async create() {
        const error = new Error('private Prisma query and database path');
        error.code = 'P2002';
        throw error;
      },
    };
    const conflictService = new LibraryService(conversations, messages, repository);

    const result = await conflictService.saveOperatorMessage(conversation.id, message.id);

    assert.equal(result.created, false);
    assert.equal(result.item, existing);
    assert.equal(lookupCount, 2);
  });

  test('different operator messages create distinct items', async () => {
    const conversation = await createConversation();
    const firstMessage = await createMessage(conversation.id, 'operator', 'Primeira resposta');
    const secondMessage = await createMessage(conversation.id, 'operator', 'Segunda resposta');

    const first = await service.saveOperatorMessage(conversation.id, firstMessage.id);
    const second = await service.saveOperatorMessage(conversation.id, secondMessage.id);

    assert.equal(first.created, true);
    assert.equal(second.created, true);
    assert.notEqual(first.item.id, second.item.id);
    assert.equal(await client.libraryItem.count(), 2);
  });

  test('rejects a missing conversation without creating an item', async () => {
    await assert.rejects(
      service.saveOperatorMessage('conversation-not-found', 'message-not-found'),
      LibraryConversationNotFoundError,
    );
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('rejects a missing message without creating an item', async () => {
    const conversation = await createConversation();

    await assert.rejects(
      service.saveOperatorMessage(conversation.id, 'message-not-found'),
      LibraryMessageNotFoundError,
    );
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('rejects a message that belongs to another conversation', async () => {
    const conversationA = await createConversation('Conversa A');
    const conversationB = await createConversation('Conversa B');
    const messageB = await createMessage(conversationB.id);

    await assert.rejects(
      service.saveOperatorMessage(conversationA.id, messageB.id),
      LibraryMessageConversationMismatchError,
    );
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('rejects a user message', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id, 'user', 'Mensagem do usuario');

    await assert.rejects(
      service.saveOperatorMessage(conversation.id, message.id),
      LibraryMessageSenderNotAllowedError,
    );
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('rejects a system message', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id, 'system', 'Mensagem de sistema');

    await assert.rejects(
      service.saveOperatorMessage(conversation.id, message.id),
      LibraryMessageSenderNotAllowedError,
    );
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('listItems returns persisted items in repository order', async () => {
    const conversation = await createConversation();
    const firstMessage = await createMessage(conversation.id, 'operator', 'Primeiro');
    const secondMessage = await createMessage(conversation.id, 'operator', 'Segundo');
    const firstItem = (await service.saveOperatorMessage(conversation.id, firstMessage.id)).item;
    const secondItem = (await service.saveOperatorMessage(conversation.id, secondMessage.id)).item;
    const oldTimestamp = new Date('2026-01-01T00:00:00.000Z');
    const newTimestamp = new Date('2026-01-02T00:00:00.000Z');

    await client.libraryItem.update({ where: { id: firstItem.id }, data: { createdAt: oldTimestamp } });
    await client.libraryItem.update({ where: { id: secondItem.id }, data: { createdAt: newTimestamp } });

    assert.deepEqual(
      (await service.listItems()).map(({ id }) => id),
      [secondItem.id, firstItem.id],
    );
  });

  test('getItemById returns an existing item', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id);
    const created = (await service.saveOperatorMessage(conversation.id, message.id)).item;

    const found = await service.getItemById(created.id);

    assert.equal(found.id, created.id);
    assert.equal(found.content, created.content);
  });

  test('getItemById returns null for an unknown item', async () => {
    assert.equal(await service.getItemById('library-item-not-found'), null);
  });

  test('keeps artifacts from different conversations isolated', async () => {
    const conversationA = await createConversation('Conversa A');
    const conversationB = await createConversation('Conversa B');
    const messageA = await createMessage(conversationA.id, 'operator', 'Conteudo A');
    const messageB = await createMessage(conversationB.id, 'operator', 'Conteudo B');

    const itemA = (await service.saveOperatorMessage(conversationA.id, messageA.id)).item;
    const itemB = (await service.saveOperatorMessage(conversationB.id, messageB.id)).item;

    assert.equal((await service.getItemById(itemA.id)).content, 'Conteudo A');
    assert.equal((await service.getItemById(itemB.id)).content, 'Conteudo B');
    assert.notEqual(itemA.id, itemB.id);
  });

  test('does not mutate the source conversation or message', async () => {
    const conversation = await createConversation('Origem imutavel');
    const message = await createMessage(conversation.id, 'operator', 'Texto original');
    const conversationSnapshot = structuredClone(conversation);
    const messageSnapshot = structuredClone(message);

    await service.saveOperatorMessage(conversation.id, message.id);

    assert.deepEqual(await client.conversation.findUnique({ where: { id: conversation.id } }), conversationSnapshot);
    assert.deepEqual(await client.message.findUnique({ where: { id: message.id } }), messageSnapshot);
  });

  test('uses a deterministic fallback title when the conversation has no title', async () => {
    const conversation = await createConversation(null);
    const message = await createMessage(conversation.id);

    const item = (await service.saveOperatorMessage(conversation.id, message.id)).item;

    assert.equal(item.title, 'Resposta do Planner');
  });
});
