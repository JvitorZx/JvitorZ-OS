const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'); const path = require('node:path'); const Database = require('better-sqlite3');

test('Sprint 49 migration preserves legacy data and creates auditable research relations', () => {
  const database = new Database(':memory:'); database.pragma('foreign_keys = ON'); const root = path.resolve(__dirname, '../prisma/migrations');
  for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort()) {
    if (directory === '20260915120000_research_ideation_intelligence') {
      database.prepare('INSERT INTO VideoIdea (id, theme, format, premise, updatedAt) VALUES (?, ?, ?, ?, ?)').run('legacy-idea', 'Tema', 'LONG_FORM', 'Premissa', new Date().toISOString());
      database.prepare('INSERT INTO ResearchHistory (id, executionKey, cacheKey, query, normalizedQuery, intent, sources, results, quality, freshness, limitations, researchedAt, validUntil, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-history', 'legacy', 'legacy', 'Tema', 'tema', 'IDEA_RESEARCH', '[]', '[]', 'GOOD', 'RECENT', '[]', new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    }
    database.exec(fs.readFileSync(path.join(root, directory, 'migration.sql'), 'utf8'));
  }
  assert.deepEqual(database.prepare('SELECT status, effortLevel FROM VideoIdea WHERE id = ?').get('legacy-idea'), { status: 'CANDIDATE', effortLevel: 'UNKNOWN' });
  assert.equal(database.prepare('SELECT status FROM ResearchHistory WHERE id = ?').get('legacy-history').status, 'COMPLETED');
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({ name }) => name);
  for (const table of ['ResearchEvidenceItem', 'ResearchSessionEvent', 'ResearchContentGap']) assert.ok(tables.includes(table));
  assert.ok(database.prepare("PRAGMA foreign_key_list('ResearchEvidenceItem')").all().some(({ table }) => table === 'ResearchHistory'));
  assert.ok(database.prepare("PRAGMA index_list('VideoIdea')").all().some(({ name, unique }) => name === 'VideoIdea_ideaKey_key' && unique === 1));
  assert.deepEqual(database.pragma('foreign_key_check'), []); assert.equal(database.pragma('integrity_check')[0].integrity_check, 'ok'); database.close();
});

test('Sprint 49 migration is additive and non-empty', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260915120000_research_ideation_intelligence/migration.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE "VideoIdea" ADD COLUMN "sourceResearchHistoryId"/); assert.match(sql, /CREATE TABLE "ResearchEvidenceItem"/); assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM/);
});
