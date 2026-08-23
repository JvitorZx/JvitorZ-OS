const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const {
  ConversationRepository,
} = require('../dist/database/repositories/ConversationRepository');
const {
  LibraryItemRepository,
} = require('../dist/database/repositories/LibraryItemRepository');
const { MessageRepository } = require('../dist/database/repositories/MessageRepository');
const { createOperatorsRouter } = require('../dist/routes/operators');
const { LibraryService } = require('../dist/services/LibraryService');
const { PlannerService } = require('../dist/services/PlannerService');

let client;
let libraryService;
let server;
let baseUrl;

const request = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return { status: response.status, body: await response.json() };
};

const createConversation = async (title = 'Conversa de teste') => {
  const response = await request('/conversations', { method: 'POST', body: { title } });
  assert.equal(response.status, 201);
  return response.body;
};

const createMessage = async (conversationId, sender = 'operator', text = 'Resposta persistida') => {
  const response = await request(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { sender, text },
  });
  assert.equal(response.status, 201);
  return response.body;
};

const saveMessage = (conversationId, messageId, options = {}) =>
  request(`/conversations/${conversationId}/messages/${messageId}/library`, {
    method: 'POST',
    ...options,
  });

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

  const conversations = new ConversationRepository(client);
  const messages = new MessageRepository(client);
  const libraryItems = new LibraryItemRepository(client);
  const plannerService = new PlannerService(conversations, messages);
  libraryService = new LibraryService(conversations, messages, libraryItems);

  const app = express();
  app.use(express.json());
  app.use('/api/operators', createOperatorsRouter(plannerService, libraryService));

  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/operators/planner`;
});

beforeEach(async () => {
  await client.libraryItem.deleteMany();
  await client.message.deleteMany();
  await client.conversation.deleteMany();
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await DatabaseService.disconnect();
});

describe('Planner library API', { concurrency: false }, () => {
  test('saves a persisted operator message and returns 201 with real content', async () => {
    const conversation = await createConversation('Planejamento semanal');
    const message = await createMessage(conversation.id, 'operator', 'Conteudo real persistido');

    const response = await saveMessage(conversation.id, message.id);

    assert.equal(response.status, 201);
    assert.equal(response.body.title, 'Resposta - Planejamento semanal');
    assert.equal(response.body.type, 'resource');
    assert.equal(response.body.content, 'Conteudo real persistido');
    assert.equal(await client.libraryItem.count(), 1);
    assert.equal(
      (await client.libraryItem.findUnique({ where: { id: response.body.id } })).sourceMessageId,
      message.id,
    );
    assert.deepEqual(Object.keys(response.body).sort(), [
      'content',
      'createdAt',
      'id',
      'projectId',
      'title',
      'type',
      'updatedAt',
    ]);
  });

  test('returns 200 with the existing item when the same message is saved again', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id);

    const first = await saveMessage(conversation.id, message.id);
    const repeated = await saveMessage(conversation.id, message.id);
    const listed = await request('/library');

    assert.equal(first.status, 201);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.id, first.body.id);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].id, first.body.id);
    assert.equal(await client.libraryItem.count(), 1);
  });

  test('concurrent HTTP saves return one 201 and one 200 with a single persisted item', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id);

    const responses = await Promise.all([
      saveMessage(conversation.id, message.id),
      saveMessage(conversation.id, message.id),
    ]);

    assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 201]);
    assert.equal(new Set(responses.map(({ body }) => body.id)).size, 1);
    assert.equal(await client.libraryItem.count(), 1);
  });

  test('returns 404 when the conversation does not exist', async () => {
    const response = await saveMessage('conversation-not-found', 'message-not-found');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Conversation not found' });
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('returns 404 when the message does not exist', async () => {
    const conversation = await createConversation();

    const response = await saveMessage(conversation.id, 'message-not-found');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Message not found' });
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('returns 409 when the message belongs to another conversation', async () => {
    const conversationA = await createConversation('A');
    const conversationB = await createConversation('B');
    const messageB = await createMessage(conversationB.id);

    const response = await saveMessage(conversationA.id, messageB.id);

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: 'Message does not belong to conversation' });
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('returns 422 for user and system messages', async (t) => {
    for (const sender of ['user', 'system']) {
      await t.test(sender, async () => {
        const conversation = await createConversation(`Conversa ${sender}`);
        const message = await createMessage(conversation.id, sender, `Mensagem ${sender}`);

        const response = await saveMessage(conversation.id, message.id);

        assert.equal(response.status, 422);
        assert.deepEqual(response.body, { error: 'Only operator messages can be saved' });
      });
    }
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('lists an empty library with 200', async () => {
    const response = await request('/library');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
  });

  test('lists multiple items in repository order', async () => {
    const conversation = await createConversation();
    const firstMessage = await createMessage(conversation.id, 'operator', 'Primeiro');
    const secondMessage = await createMessage(conversation.id, 'operator', 'Segundo');
    const first = await saveMessage(conversation.id, firstMessage.id);
    const second = await saveMessage(conversation.id, secondMessage.id);

    await client.libraryItem.update({
      where: { id: first.body.id },
      data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    await client.libraryItem.update({
      where: { id: second.body.id },
      data: { createdAt: new Date('2026-01-02T00:00:00.000Z') },
    });

    const response = await request('/library');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(({ id }) => id), [second.body.id, first.body.id]);
  });

  test('opens an existing persisted item', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id);
    const saved = await saveMessage(conversation.id, message.id);

    const response = await request(`/library/${saved.body.id}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.id, saved.body.id);
    assert.equal(response.body.content, message.text);
  });

  test('returns 404 when opening an unknown item', async () => {
    const response = await request('/library/library-item-not-found');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Library item not found' });
  });

  test('rejects invalid route parameters with 400', async (t) => {
    await t.test('conversationId', async () => {
      assert.equal((await saveMessage('%20', 'message-id')).status, 400);
    });
    await t.test('messageId', async () => {
      assert.equal((await saveMessage('conversation-id', '%20')).status, 400);
    });
    await t.test('library item id', async () => {
      assert.equal((await request('/library/%20')).status, 400);
    });
  });

  test('rejects unexpected save fields with 400 without creating an item', async () => {
    const conversation = await createConversation();
    const message = await createMessage(conversation.id);

    const response = await saveMessage(conversation.id, message.id, {
      body: { content: 'Conteudo arbitrario' },
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'body must be empty' });
    assert.equal(await client.libraryItem.count(), 0);
  });

  test('returns a safe 500 without exposing internal details', async () => {
    const privateDetail = 'Prisma private query and database path';
    const originalListItems = libraryService.listItems;
    const originalConsoleError = console.error;
    const logs = [];
    libraryService.listItems = async () => {
      throw new Error(privateDetail);
    };
    console.error = (...values) => logs.push(values);

    let response;
    try {
      response = await request('/library');
    } finally {
      libraryService.listItems = originalListItems;
      console.error = originalConsoleError;
    }

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: 'Failed to list library items' });
    assert.equal(JSON.stringify({ response, logs }).includes(privateDetail), false);
  });

  test('keeps existing conversation and message endpoints functional', async () => {
    const conversation = await createConversation('Regressao');
    const message = await createMessage(conversation.id, 'user', 'Mensagem existente');

    const opened = await request(`/conversations/${conversation.id}`);

    assert.equal(opened.status, 200);
    assert.equal(opened.body.id, conversation.id);
    assert.deepEqual(opened.body.messages.map(({ id }) => id), [message.id]);
  });
});
