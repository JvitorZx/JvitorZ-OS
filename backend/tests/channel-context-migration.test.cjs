const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = ':memory:';
const { DatabaseService } = require('../dist/database/DatabaseService');

describe('channel context migration', { concurrency: false }, () => {
  let client;
  before(async () => {
    client = await DatabaseService.connect();
    await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await client.$executeRawUnsafe('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)');
    const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260911120000_channel_context_memory/migration.sql'), 'utf8');
    for (const statement of sql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
  });
  after(async () => DatabaseService.disconnect());

  test('creates temporal context and relation tables with foreign keys enabled', async () => {
    const tables = await client.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ChannelContext%'");
    assert.deepEqual(tables.map(({ name }) => name).sort(), ['ChannelContextEntry', 'ChannelContextRelation']);
    assert.equal((await client.$queryRawUnsafe('PRAGMA foreign_key_check')).length, 0);
  });

  test('unique stable keys and supersession predecessors are enforced', async () => {
    await client.$executeRawUnsafe(`INSERT INTO "ChannelContextEntry" ("id","stableKey","type","status","category","subject","statement","confidence","source","updatedAt") VALUES ('one','stable','FACT','ACTIVE','TEST','Subject','Statement',1,'test',CURRENT_TIMESTAMP)`);
    await assert.rejects(() => client.$executeRawUnsafe(`INSERT INTO "ChannelContextEntry" ("id","stableKey","type","status","category","subject","statement","confidence","source","updatedAt") VALUES ('two','stable','FACT','ACTIVE','TEST','S','S',1,'test',CURRENT_TIMESTAMP)`));
  });
});
