const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const express = require('express');

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
const { MessageRepository } = require('../dist/database/repositories/MessageRepository');
const { createOperatorsRouter } = require('../dist/routes/operators');
const {
  ConversationLibraryService,
} = require('../dist/services/ConversationLibraryService');
const { LibraryService } = require('../dist/services/LibraryService');
const { PlannerService } = require('../dist/services/PlannerService');

let client;
let conversations;
let libraryItems;
let conversationLibraryService;
let server;
let baseUrl;

const request = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const createConversation = (title = 'Conversa') =>
  conversations.create({ projectId: null, title, context: null });

const createLibraryItem = (title, content = `Conteudo ${title}`) =>
  libraryItems.create({ title, projectId: null, type: 'resource', content });

const linkItem = (conversationId, libraryItemId, options = {}) =>
  request(`/conversations/${conversationId}/library/${libraryItemId}`, {
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
  const messages = new MessageRepository(client);
  libraryItems = new LibraryItemRepository(client);
  const links = new ConversationLibraryItemRepository(client);
  const plannerService = new PlannerService(conversations, messages);
  const libraryService = new LibraryService(conversations, messages, libraryItems);
  conversationLibraryService = new ConversationLibraryService(
    conversations,
    libraryItems,
    links,
  );

  const app = express();
  app.use(express.json());
  app.use(
    '/api/operators',
    createOperatorsRouter(plannerService, libraryService, conversationLibraryService),
  );

  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/operators/planner`;
});

beforeEach(async () => {
  await client.conversationLibraryItem.deleteMany();
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

describe('Planner active conversation library API', { concurrency: false }, () => {
  test('POST creates a link and returns the real persisted item with 201', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Real', 'Conteudo persistido');

    const response = await linkItem(conversation.id, item.id);

    assert.equal(response.status, 201);
    assert.equal(response.body.id, item.id);
    assert.equal(response.body.content, 'Conteudo persistido');
    assert.equal(await client.conversationLibraryItem.count(), 1);
  });

  test('repeated POST returns 200 without creating a duplicate', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');

    const first = await linkItem(conversation.id, item.id);
    const repeated = await linkItem(conversation.id, item.id);

    assert.equal(first.status, 201);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.id, item.id);
    assert.equal(await client.conversationLibraryItem.count(), 1);
  });

  test('POST returns 404 for a missing conversation', async () => {
    const item = await createLibraryItem('Artefato');

    const response = await linkItem('missing-conversation', item.id);

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Conversation not found' });
  });

  test('POST returns 404 for a missing library item', async () => {
    const conversation = await createConversation();

    const response = await linkItem(conversation.id, 'missing-item');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Library item not found' });
  });

  test('POST rejects a sixth different item with 422', async () => {
    const conversation = await createConversation();
    const items = await Promise.all(
      Array.from({ length: 6 }, (_, index) => createLibraryItem(`Item ${index + 1}`)),
    );
    for (const item of items.slice(0, 5)) {
      assert.equal((await linkItem(conversation.id, item.id)).status, 201);
    }

    const response = await linkItem(conversation.id, items[5].id);

    assert.equal(response.status, 422);
    assert.deepEqual(response.body, { error: 'Conversation library limit reached' });
    assert.equal(await client.conversationLibraryItem.count(), 5);
  });

  test('POST rejects unexpected fields without accepting arbitrary content', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Original', 'Conteudo real');

    const response = await linkItem(conversation.id, item.id, {
      body: { title: 'Forjado', content: 'Conteudo arbitrario' },
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'body must be empty' });
    assert.equal(await client.conversationLibraryItem.count(), 0);
    assert.equal((await libraryItems.findById(item.id)).content, 'Conteudo real');
  });

  test('DELETE rejects an unexpected body without removing the link', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');
    await linkItem(conversation.id, item.id);

    const response = await request(`/conversations/${conversation.id}/library/${item.id}`, {
      method: 'DELETE',
      body: { content: 'Nao permitido' },
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'body must be empty' });
    assert.equal(await client.conversationLibraryItem.count(), 1);
  });

  test('GET returns an empty list for a conversation without links', async () => {
    const conversation = await createConversation();

    const response = await request(`/conversations/${conversation.id}/library`);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
  });

  test('GET returns only linked items in persisted link order', async () => {
    const conversation = await createConversation();
    const older = await createLibraryItem('Antigo');
    const newer = await createLibraryItem('Novo');
    const unrelated = await createLibraryItem('Nao vinculado');
    await linkItem(conversation.id, older.id);
    await linkItem(conversation.id, newer.id);
    await client.conversationLibraryItem.update({
      where: {
        conversationId_libraryItemId: {
          conversationId: conversation.id,
          libraryItemId: older.id,
        },
      },
      data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    await client.conversationLibraryItem.update({
      where: {
        conversationId_libraryItemId: {
          conversationId: conversation.id,
          libraryItemId: newer.id,
        },
      },
      data: { createdAt: new Date('2026-01-02T00:00:00.000Z') },
    });

    const response = await request(`/conversations/${conversation.id}/library`);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(({ id }) => id), [older.id, newer.id]);
    assert.equal(response.body.some(({ id }) => id === unrelated.id), false);
  });

  test('GET returns 404 for a missing conversation', async () => {
    const response = await request('/conversations/missing-conversation/library');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Conversation not found' });
  });

  test('DELETE removes an existing link with 204 and preserves the item', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');
    await linkItem(conversation.id, item.id);

    const response = await request(`/conversations/${conversation.id}/library/${item.id}`, {
      method: 'DELETE',
    });

    assert.equal(response.status, 204);
    assert.equal(response.body, null);
    assert.equal(await client.conversationLibraryItem.count(), 0);
    assert.equal((await libraryItems.findById(item.id)).id, item.id);
  });

  test('DELETE is idempotent for an absent link', async () => {
    const conversation = await createConversation();

    const response = await request(`/conversations/${conversation.id}/library/missing-item`, {
      method: 'DELETE',
    });

    assert.equal(response.status, 204);
    assert.equal(response.body, null);
  });

  test('conversations remain isolated during listing and unlink', async () => {
    const conversationA = await createConversation('A');
    const conversationB = await createConversation('B');
    const itemA = await createLibraryItem('Item A');
    const itemB = await createLibraryItem('Item B');
    await linkItem(conversationA.id, itemA.id);
    await linkItem(conversationB.id, itemB.id);

    await request(`/conversations/${conversationA.id}/library/${itemB.id}`, { method: 'DELETE' });
    const listedA = await request(`/conversations/${conversationA.id}/library`);
    const listedB = await request(`/conversations/${conversationB.id}/library`);

    assert.deepEqual(listedA.body.map(({ id }) => id), [itemA.id]);
    assert.deepEqual(listedB.body.map(({ id }) => id), [itemB.id]);
  });

  test('the same library item can be linked to two conversations', async () => {
    const conversationA = await createConversation('A');
    const conversationB = await createConversation('B');
    const item = await createLibraryItem('Compartilhado');

    assert.equal((await linkItem(conversationA.id, item.id)).status, 201);
    assert.equal((await linkItem(conversationB.id, item.id)).status, 201);
    assert.equal(await client.conversationLibraryItem.count(), 2);
  });

  test('concurrent POST requests create one link with 201 and 200', async () => {
    const conversation = await createConversation();
    const item = await createLibraryItem('Artefato');

    const responses = await Promise.all([
      linkItem(conversation.id, item.id),
      linkItem(conversation.id, item.id),
    ]);

    assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 201]);
    assert.equal(await client.conversationLibraryItem.count(), 1);
  });

  test('invalid route parameters return 400 before the service is called', async (t) => {
    await t.test('conversationId', async () => {
      assert.equal((await linkItem('%20', 'item-id')).status, 400);
      assert.equal((await request('/conversations/%20/library')).status, 400);
    });
    await t.test('libraryItemId', async () => {
      assert.equal((await linkItem('conversation-id', '%20')).status, 400);
      assert.equal((await request('/conversations/conversation-id/library/%20', {
        method: 'DELETE',
      })).status, 400);
    });
  });

  test('internal errors return sanitized responses and logs', async () => {
    const conversation = await createConversation();
    const privateDetail = 'P2002 private SQL stack and database path';
    const originalList = conversationLibraryService.listLinkedItems;
    const originalConsoleError = console.error;
    const logs = [];
    conversationLibraryService.listLinkedItems = async () => {
      throw new Error(privateDetail);
    };
    console.error = (...values) => logs.push(values);

    let response;
    try {
      response = await request(`/conversations/${conversation.id}/library`);
    } finally {
      conversationLibraryService.listLinkedItems = originalList;
      console.error = originalConsoleError;
    }

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: 'Failed to list conversation library items' });
    assert.equal(JSON.stringify({ response, logs }).includes(privateDetail), false);
    assert.equal(JSON.stringify({ response, logs }).includes('P2002'), false);
  });
});
