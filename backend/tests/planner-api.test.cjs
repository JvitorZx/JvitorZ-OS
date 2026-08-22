const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';

const app = require('../dist/app').default;
const { DatabaseService } = require('../dist/database/DatabaseService');

let client;
let server;
let baseUrl;

const request = async (path = '', { method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
};

const createConversation = async (body = {}) => {
  const response = await request('', { method: 'POST', body });
  assert.equal(response.status, 201);
  return response.body;
};

const waitForNextTimestamp = () => new Promise((resolve) => setTimeout(resolve, 5));

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

  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/operators/planner/conversations`;
});

beforeEach(async () => {
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

describe('Planner conversation API', { concurrency: false }, () => {
  test('creates and persists a conversation', async () => {
    const response = await request('', {
      method: 'POST',
      body: { title: '  Planejamento semanal  ' },
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.title, 'Planejamento semanal');
    assert.equal(response.body.context, null);
    assert.equal(await client.conversation.count(), 1);
  });

  test('lists conversations in repository order', async () => {
    const first = await createConversation({ title: 'Primeira' });
    await waitForNextTimestamp();
    const second = await createConversation({ title: 'Segunda' });

    const response = await request();

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(({ id }) => id), [second.id, first.id]);
  });

  test('opens a conversation by id with its persisted fields', async () => {
    const created = await createConversation({ title: 'Conversa aberta' });

    const response = await request(`/${created.id}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.id, created.id);
    assert.equal(response.body.context, null);
    assert.deepEqual(response.body.messages, []);
  });

  test('creates messages with valid roles and returns them chronologically', async () => {
    const created = await createConversation();
    const inputs = [
      { sender: 'user', text: 'Primeira mensagem' },
      { sender: 'system', text: 'Segunda mensagem' },
      { sender: 'operator', text: 'Terceira mensagem' },
    ];

    for (const input of inputs) {
      const response = await request(`/${created.id}/messages`, {
        method: 'POST',
        body: input,
      });
      assert.equal(response.status, 201);
      await waitForNextTimestamp();
    }

    const response = await request(`/${created.id}`);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.messages.map(({ sender }) => sender), inputs.map(({ sender }) => sender));
    assert.deepEqual(response.body.messages.map(({ text }) => text), inputs.map(({ text }) => text));
    assert.equal(await client.message.count(), 3);
  });

  test('updates, returns and clears conversation context', async () => {
    const created = await createConversation();

    const updated = await request(`/${created.id}/context`, {
      method: 'PATCH',
      body: { context: '  Contexto persistido  ' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.context, 'Contexto persistido');

    const opened = await request(`/${created.id}`);
    assert.equal(opened.body.context, 'Contexto persistido');

    const cleared = await request(`/${created.id}/context`, {
      method: 'PATCH',
      body: { context: '   ' },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.context, null);
  });

  test('returns 400 for invalid payloads and message roles', async (t) => {
    const created = await createConversation();

    await t.test('invalid conversation title', async () => {
      const response = await request('', { method: 'POST', body: { title: 42 } });
      assert.equal(response.status, 400);
    });

    await t.test('empty message', async () => {
      const response = await request(`/${created.id}/messages`, {
        method: 'POST',
        body: { sender: 'user', text: '   ' },
      });
      assert.equal(response.status, 400);
    });

    await t.test('unsupported message role', async () => {
      const response = await request(`/${created.id}/messages`, {
        method: 'POST',
        body: { sender: 'assistant', text: 'Mensagem' },
      });
      assert.equal(response.status, 400);
    });

    await t.test('extra message field', async () => {
      const response = await request(`/${created.id}/messages`, {
        method: 'POST',
        body: { sender: 'user', text: 'Mensagem', token: 'invalido' },
      });
      assert.equal(response.status, 400);
    });

    await t.test('non-text context', async () => {
      const response = await request(`/${created.id}/context`, {
        method: 'PATCH',
        body: { context: 42 },
      });
      assert.equal(response.status, 400);
    });

    await t.test('extra context field', async () => {
      const response = await request(`/${created.id}/context`, {
        method: 'PATCH',
        body: { context: 'Contexto', title: 'Nao permitido' },
      });
      assert.equal(response.status, 400);
    });
  });

  test('returns 404 for a missing conversation', async (t) => {
    const missingId = 'conversation-not-found';

    await t.test('open', async () => {
      assert.equal((await request(`/${missingId}`)).status, 404);
    });

    await t.test('create message', async () => {
      const response = await request(`/${missingId}/messages`, {
        method: 'POST',
        body: { sender: 'user', text: 'Mensagem' },
      });
      assert.equal(response.status, 404);
    });

    await t.test('update context', async () => {
      const response = await request(`/${missingId}/context`, {
        method: 'PATCH',
        body: { context: 'Contexto' },
      });
      assert.equal(response.status, 404);
    });
  });
});
