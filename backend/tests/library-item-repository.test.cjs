const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');

process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const {
  LibraryItemRepository,
} = require('../dist/database/repositories/LibraryItemRepository');

let client;
let repository;

const inputFor = (title, overrides = {}) => ({
  title,
  type: 'resource',
  content: `Conteudo de ${title}`,
  ...overrides,
});

before(async () => {
  client = await DatabaseService.connect();
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await client.$executeRawUnsafe(`
    CREATE TABLE "Message" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "sender" TEXT NOT NULL,
      "text" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  repository = new LibraryItemRepository(client);
});

beforeEach(async () => {
  await client.libraryItem.deleteMany();
  await client.message.deleteMany();
});

after(async () => {
  await DatabaseService.disconnect();
});

describe('LibraryItemRepository', { concurrency: false }, () => {
  test('create persists a library item', async () => {
    const created = await repository.create(inputFor('Item persistido'));
    const persisted = await client.libraryItem.findUnique({ where: { id: created.id } });

    assert.ok(persisted);
    assert.equal(persisted.title, 'Item persistido');
    assert.equal(await client.libraryItem.count(), 1);
  });

  test('create returns the saved model fields', async () => {
    const input = inputFor('Campos completos', {
      projectId: null,
      type: 'reference',
      content: 'Conteudo salvo',
    });

    const created = await repository.create(input);

    assert.equal(created.projectId, null);
    assert.equal(created.title, input.title);
    assert.equal(created.type, input.type);
    assert.equal(created.content, input.content);
    assert.ok(created.id);
    assert.ok(created.createdAt instanceof Date);
    assert.ok(created.updatedAt instanceof Date);
  });

  test('findAll returns an empty list when the database is empty', async () => {
    assert.deepEqual(await repository.findAll(), []);
  });

  test('findAll returns multiple persisted items', async () => {
    await repository.create(inputFor('Item A'));
    await repository.create(inputFor('Item B'));

    const items = await repository.findAll();

    assert.equal(items.length, 2);
    assert.deepEqual(new Set(items.map(({ title }) => title)), new Set(['Item A', 'Item B']));
  });

  test('findAll orders newest items first with id as a deterministic tie-breaker', async () => {
    const olderA = await repository.create(inputFor('Antigo A'));
    const olderB = await repository.create(inputFor('Antigo B'));
    const newest = await repository.create(inputFor('Mais recente'));
    const oldTimestamp = new Date('2026-01-01T00:00:00.000Z');
    const newTimestamp = new Date('2026-01-02T00:00:00.000Z');

    await client.libraryItem.updateMany({
      where: { id: { in: [olderA.id, olderB.id] } },
      data: { createdAt: oldTimestamp },
    });
    await client.libraryItem.update({
      where: { id: newest.id },
      data: { createdAt: newTimestamp },
    });

    const tiedIds = [olderA.id, olderB.id].sort().reverse();
    const items = await repository.findAll();

    assert.deepEqual(items.map(({ id }) => id), [newest.id, ...tiedIds]);
  });

  test('findById returns an existing item', async () => {
    const created = await repository.create(inputFor('Item localizado'));

    const found = await repository.findById(created.id);

    assert.equal(found.id, created.id);
    assert.equal(found.title, created.title);
    assert.equal(found.content, created.content);
  });

  test('findById returns null for an unknown item', async () => {
    assert.equal(await repository.findById('library-item-not-found'), null);
  });

  test('findBySourceMessageId returns the item created from a persisted message', async () => {
    await client.message.create({
      data: {
        id: 'source-message-1',
        conversationId: 'conversation-1',
        sender: 'operator',
        text: 'Resposta persistida',
      },
    });
    const created = await repository.create(inputFor('Com origem', {
      sourceMessageId: 'source-message-1',
    }));

    const found = await repository.findBySourceMessageId('source-message-1');

    assert.equal(found.id, created.id);
    assert.equal(found.sourceMessageId, 'source-message-1');
    assert.equal(await repository.findBySourceMessageId('source-message-2'), null);
  });

  test('the database rejects two items for the same source message', async () => {
    await client.message.create({
      data: {
        id: 'source-message-unique',
        conversationId: 'conversation-1',
        sender: 'operator',
        text: 'Resposta única',
      },
    });
    await repository.create(inputFor('Primeiro', {
      sourceMessageId: 'source-message-unique',
    }));

    await assert.rejects(
      repository.create(inputFor('Duplicado', {
        sourceMessageId: 'source-message-unique',
      })),
      (error) => error?.code === 'P2002',
    );
    assert.equal(await client.libraryItem.count(), 1);
  });

  test('findById keeps persisted items isolated', async () => {
    const first = await repository.create(inputFor('Primeiro', { content: 'Conteudo A' }));
    const second = await repository.create(inputFor('Segundo', { content: 'Conteudo B' }));

    const foundFirst = await repository.findById(first.id);
    const foundSecond = await repository.findById(second.id);

    assert.equal(foundFirst.content, 'Conteudo A');
    assert.equal(foundSecond.content, 'Conteudo B');
    assert.notEqual(foundFirst.id, foundSecond.id);
  });

  test('create does not mutate its input', async () => {
    const input = inputFor('Entrada imutavel', {
      projectId: null,
      content: 'Conteudo original',
    });
    const snapshot = structuredClone(input);

    await repository.create(input);

    assert.deepEqual(input, snapshot);
  });
});
