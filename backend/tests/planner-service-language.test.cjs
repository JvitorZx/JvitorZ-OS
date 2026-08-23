const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';

const app = require('../dist/app').default;
const { DatabaseService } = require('../dist/database/DatabaseService');
const {
  ConversationRepository,
} = require('../dist/database/repositories/ConversationRepository');
const { MessageRepository } = require('../dist/database/repositories/MessageRepository');
const {
  PlannerLanguageGenerationError,
  PlannerLanguageProviderUnavailableError,
  PlannerService,
} = require('../dist/services/PlannerService');
const {
  DEFAULT_LANGUAGE_GENERATION_LIMITS,
} = require('../dist/services/language/PlannerLanguageInput');

class FakeLanguageProvider {
  constructor(responses = ['Resposta deterministica']) {
    this.responses = [...responses];
    this.inputs = [];
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
let server;
let conversationUrl;

const createService = (provider) =>
  new PlannerService(
    new ConversationRepository(client),
    new MessageRepository(client),
    provider,
  );

const persistMessage = (conversationId, sender, text, index) =>
  client.message.create({
    data: {
      conversationId,
      sender,
      text,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    },
  });

const getConversation = async (id) => {
  const response = await fetch(`${conversationUrl}/${id}`);
  return { status: response.status, body: await response.json() };
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

  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  conversationUrl = `http://127.0.0.1:${server.address().port}/api/operators/planner/conversations`;
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

describe('PlannerService language generation', { concurrency: false }, () => {
  test('calls the provider once with the persisted context and chronological history', async () => {
    const provider = new FakeLanguageProvider(['Resposta']);
    const service = createService(provider);
    const conversation = await service.createConversation({ title: 'Conversa A' });
    await service.updateConversationContext(conversation.id, { context: 'Contexto da conversa' });
    await persistMessage(conversation.id, 'operator', 'Resposta anterior', 2);
    await persistMessage(conversation.id, 'user', 'Pergunta inicial', 1);
    await persistMessage(conversation.id, 'system', 'Regra interna', 3);

    await service.generateReply(conversation.id);

    assert.equal(provider.inputs.length, 1);
    assert.equal(provider.inputs[0].context, 'Contexto da conversa');
    assert.deepEqual(provider.inputs[0].messages, [
      { role: 'user', content: 'Pergunta inicial' },
      { role: 'operator', content: 'Resposta anterior' },
      { role: 'system', content: 'Regra interna' },
    ]);
  });

  test('persists one trimmed operator message and exposes it through the existing GET', async () => {
    const provider = new FakeLanguageProvider(['  Resposta persistida  ']);
    const service = createService(provider);
    const conversation = await service.createConversation();
    await service.createMessage(conversation.id, { sender: 'user', text: 'Mensagem atual' });

    const reply = await service.generateReply(conversation.id);
    const opened = await getConversation(conversation.id);

    assert.equal(reply.sender, 'operator');
    assert.equal(reply.text, 'Resposta persistida');
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.body.messages.map(({ sender, text }) => ({ sender, text })), [
      { sender: 'user', text: 'Mensagem atual' },
      { sender: 'operator', text: 'Resposta persistida' },
    ]);
  });

  test('does not call the provider or persist when the conversation does not exist', async () => {
    const provider = new FakeLanguageProvider();
    const service = createService(provider);

    const reply = await service.generateReply('conversation-not-found');

    assert.equal(reply, null);
    assert.equal(provider.inputs.length, 0);
    assert.equal(await client.message.count(), 0);
  });

  test('converts provider exceptions into a domain error without persisting', async () => {
    const provider = new FakeLanguageProvider();
    provider.error = new Error('Provider internal detail');
    const service = createService(provider);
    const conversation = await service.createConversation();

    await assert.rejects(
      service.generateReply(conversation.id),
      (error) =>
        error instanceof PlannerLanguageGenerationError &&
        error.message === 'Unable to generate planner reply' &&
        !error.message.includes('Provider internal detail'),
    );
    assert.equal(await client.message.count(), 0);
  });

  test('rejects an empty provider response without persisting', async () => {
    const service = createService(new FakeLanguageProvider(['']));
    const conversation = await service.createConversation();

    await assert.rejects(service.generateReply(conversation.id), PlannerLanguageGenerationError);
    assert.equal(await client.message.count(), 0);
  });

  test('rejects a whitespace-only provider response without persisting', async () => {
    const service = createService(new FakeLanguageProvider(['   ']));
    const conversation = await service.createConversation();

    await assert.rejects(service.generateReply(conversation.id), PlannerLanguageGenerationError);
    assert.equal(await client.message.count(), 0);
  });

  test('rejects a non-string provider response without persisting', async () => {
    const service = createService(new FakeLanguageProvider([{ text: 'invalido' }]));
    const conversation = await service.createConversation();

    await assert.rejects(service.generateReply(conversation.id), PlannerLanguageGenerationError);
    assert.equal(await client.message.count(), 0);
  });

  test('persists exactly one operator message per successful sequential call', async () => {
    const provider = new FakeLanguageProvider(['Primeira resposta', 'Segunda resposta']);
    const service = createService(provider);
    const conversation = await service.createConversation();
    await service.createMessage(conversation.id, { sender: 'user', text: 'Pergunta' });

    await service.generateReply(conversation.id);
    await service.generateReply(conversation.id);

    const messages = await client.message.findMany({
      where: { conversationId: conversation.id, sender: 'operator' },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(provider.inputs.length, 2);
    assert.deepEqual(messages.map(({ text }) => text), ['Primeira resposta', 'Segunda resposta']);
    assert.deepEqual(provider.inputs[1].messages.map(({ content }) => content), [
      'Pergunta',
      'Primeira resposta',
    ]);
  });

  test('keeps generated histories isolated between conversations', async () => {
    const provider = new FakeLanguageProvider(['Resposta A', 'Resposta B']);
    const service = createService(provider);
    const conversationA = await service.createConversation({ title: 'A' });
    const conversationB = await service.createConversation({ title: 'B' });
    await service.createMessage(conversationA.id, { sender: 'user', text: 'Mensagem A' });
    await service.createMessage(conversationB.id, { sender: 'user', text: 'Mensagem B' });

    await service.generateReply(conversationA.id);
    await service.generateReply(conversationB.id);

    assert.deepEqual(provider.inputs[0].messages.map(({ content }) => content), ['Mensagem A']);
    assert.deepEqual(provider.inputs[1].messages.map(({ content }) => content), ['Mensagem B']);
    assert.deepEqual(
      (await service.getConversationById(conversationA.id)).messages.map(({ text }) => text),
      ['Mensagem A', 'Resposta A'],
    );
    assert.deepEqual(
      (await service.getConversationById(conversationB.id)).messages.map(({ text }) => text),
      ['Mensagem B', 'Resposta B'],
    );
  });

  test('sends only the most recent persisted messages allowed by mapper limits', async () => {
    const provider = new FakeLanguageProvider(['Resposta limitada']);
    const service = createService(provider);
    const conversation = await service.createConversation();
    const totalMessages = DEFAULT_LANGUAGE_GENERATION_LIMITS.maxMessages + 2;

    for (let index = 1; index <= totalMessages; index += 1) {
      await persistMessage(conversation.id, 'user', `Mensagem ${index}`, index);
    }

    await service.generateReply(conversation.id);

    const received = provider.inputs[0].messages;
    assert.equal(received.length, DEFAULT_LANGUAGE_GENERATION_LIMITS.maxMessages);
    assert.equal(received[0].content, 'Mensagem 3');
    assert.equal(received.at(-1).content, `Mensagem ${totalMessages}`);
  });

  test('requires an explicitly injected provider only when generation is requested', async () => {
    const service = createService(undefined);
    const conversation = await service.createConversation();

    await assert.rejects(
      service.generateReply(conversation.id),
      PlannerLanguageProviderUnavailableError,
    );
    assert.equal(await client.message.count(), 0);
  });
});
