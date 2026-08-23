const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const express = require('express');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const {
  ConversationRepository,
} = require('../dist/database/repositories/ConversationRepository');
const { MessageRepository } = require('../dist/database/repositories/MessageRepository');
const { createOperatorsRouter } = require('../dist/routes/operators');
const { PlannerService } = require('../dist/services/PlannerService');
const {
  LanguageProviderUnavailableError,
} = require('../dist/services/language/LanguageProvider');

class FakeLanguageProvider {
  constructor() {
    this.reset();
  }

  reset() {
    this.inputs = [];
    this.responses = ['Resposta deterministica'];
    this.error = null;
  }

  async generate(input) {
    this.inputs.push(input);

    if (this.error) {
      throw this.error;
    }

    return this.responses.shift();
  }
}

let client;
let provider;
let server;
let baseUrl;

const request = async (path = '', { method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return { status: response.status, body: await response.json() };
};

const createConversation = async (title = 'Conversa de teste') => {
  const response = await request('', { method: 'POST', body: { title } });
  assert.equal(response.status, 201);
  return response.body;
};

const createUserMessage = async (conversationId, text) => {
  const response = await request(`/${conversationId}/messages`, {
    method: 'POST',
    body: { sender: 'user', text },
  });
  assert.equal(response.status, 201);
  return response.body;
};

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

  provider = new FakeLanguageProvider();
  const plannerService = new PlannerService(
    new ConversationRepository(client),
    new MessageRepository(client),
    provider,
  );
  const app = express();
  app.use(express.json());
  app.use('/api/operators', createOperatorsRouter(plannerService));

  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/operators/planner/conversations`;
});

beforeEach(async () => {
  provider.reset();
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

describe('Planner reply API', { concurrency: false }, () => {
  test('generates exactly one persisted operator reply and returns 201', async () => {
    const conversation = await createConversation();
    await createUserMessage(conversation.id, 'Mensagem atual');
    provider.responses = ['Resposta persistida'];

    const generated = await request(`/${conversation.id}/reply`, { method: 'POST' });
    const opened = await request(`/${conversation.id}`);

    assert.equal(generated.status, 201);
    assert.equal(generated.body.sender, 'operator');
    assert.equal(generated.body.text, 'Resposta persistida');
    assert.equal(provider.inputs.length, 1);
    assert.deepEqual(opened.body.messages.map(({ sender, text }) => ({ sender, text })), [
      { sender: 'user', text: 'Mensagem atual' },
      { sender: 'operator', text: 'Resposta persistida' },
    ]);
  });

  test('returns 404 without calling the provider for a missing conversation', async () => {
    const response = await request('/conversation-not-found/reply', { method: 'POST' });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Conversation not found' });
    assert.equal(provider.inputs.length, 0);
    assert.equal(await client.message.count(), 0);
  });

  test('rejects invalid ids and unexpected body fields with 400', async (t) => {
    await t.test('empty id', async () => {
      const response = await request('/%20/reply', { method: 'POST' });
      assert.equal(response.status, 400);
      assert.deepEqual(response.body, { error: 'id must be a non-empty string' });
    });

    await t.test('unexpected body field', async () => {
      const conversation = await createConversation();
      const response = await request(`/${conversation.id}/reply`, {
        method: 'POST',
        body: { prompt: 'not allowed' },
      });
      assert.equal(response.status, 400);
      assert.deepEqual(response.body, { error: 'body must be empty' });
      assert.equal(provider.inputs.length, 0);
    });
  });

  test('maps provider unavailability to a safe 503 without persistence', async () => {
    const conversation = await createConversation();
    provider.error = new LanguageProviderUnavailableError('private configuration detail');

    const response = await request(`/${conversation.id}/reply`, { method: 'POST' });

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'Language provider is unavailable' });
    assert.equal(await client.message.count(), 0);
  });

  test('maps provider failures to a safe 502 without persistence or sensitive logs', async () => {
    const conversation = await createConversation();
    const privateDetail = 'secret-key private-prompt raw-provider-payload';
    provider.error = new Error(privateDetail);
    const logs = [];
    const originalError = console.error;
    console.error = (...values) => logs.push(values);

    let response;
    try {
      response = await request(`/${conversation.id}/reply`, { method: 'POST' });
    } finally {
      console.error = originalError;
    }

    assert.equal(response.status, 502);
    assert.deepEqual(response.body, { error: 'Failed to generate planner reply' });
    assert.equal(await client.message.count(), 0);
    assert.equal(JSON.stringify({ response, logs }).includes(privateDetail), false);
  });

  test('does not persist an invalid provider response', async () => {
    const conversation = await createConversation();
    provider.responses = ['   '];

    const response = await request(`/${conversation.id}/reply`, { method: 'POST' });

    assert.equal(response.status, 502);
    assert.equal(await client.message.count(), 0);
  });

  test('creates one distinct operator reply for each sequential request', async () => {
    const conversation = await createConversation();
    provider.responses = ['Primeira resposta', 'Segunda resposta'];

    const first = await request(`/${conversation.id}/reply`, { method: 'POST' });
    const second = await request(`/${conversation.id}/reply`, { method: 'POST' });
    const opened = await request(`/${conversation.id}`);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body.id, second.body.id);
    assert.deepEqual(
      opened.body.messages.filter(({ sender }) => sender === 'operator').map(({ text }) => text),
      ['Primeira resposta', 'Segunda resposta'],
    );
    assert.equal(provider.inputs.length, 2);
  });

  test('keeps replies isolated between conversations', async () => {
    const conversationA = await createConversation('A');
    const conversationB = await createConversation('B');
    await createUserMessage(conversationA.id, 'Mensagem A');
    await createUserMessage(conversationB.id, 'Mensagem B');
    provider.responses = ['Resposta A', 'Resposta B'];

    await request(`/${conversationA.id}/reply`, { method: 'POST' });
    await request(`/${conversationB.id}/reply`, { method: 'POST' });
    const openedA = await request(`/${conversationA.id}`);
    const openedB = await request(`/${conversationB.id}`);

    assert.deepEqual(openedA.body.messages.map(({ text }) => text), ['Mensagem A', 'Resposta A']);
    assert.deepEqual(openedB.body.messages.map(({ text }) => text), ['Mensagem B', 'Resposta B']);
    assert.deepEqual(provider.inputs[0].messages.map(({ content }) => content), ['Mensagem A']);
    assert.deepEqual(provider.inputs[1].messages.map(({ content }) => content), ['Mensagem B']);
  });
});
