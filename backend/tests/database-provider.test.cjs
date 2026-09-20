const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { resolveDatabaseUrl } = require('../dist/database/DatabaseService');

describe('database provider selection', () => {
  test('keeps SQLite as the safe default', () => {
    assert.match(resolveDatabaseUrl({}), /^file:/);
  });

  test('uses PostgreSQL only when explicitly enabled', () => {
    const url = 'postgresql://example.invalid/postgres';
    assert.equal(resolveDatabaseUrl({ DATABASE_MODE: 'postgres', POSTGRES_DATABASE_URL: url }), url);
  });

  test('an explicit DATABASE_URL has precedence for isolated tests and deployments', () => {
    const url = 'file:C:/temporary/test.db';
    assert.equal(resolveDatabaseUrl({
      DATABASE_URL: url,
      DATABASE_MODE: 'postgres',
      POSTGRES_DATABASE_URL: 'postgresql://example.invalid/postgres',
    }), url);
  });
});
