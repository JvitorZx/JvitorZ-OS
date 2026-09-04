const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'); const path = require('node:path'); const Database = require('better-sqlite3');

test('chapters migration creates temporal, version and evidence tables', () => {
  const database = new Database(':memory:'); database.pragma('foreign_keys = ON');
  const root = path.resolve(__dirname, '../prisma/migrations');
  for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort()) database.exec(fs.readFileSync(path.join(root, directory, 'migration.sql'), 'utf8'));
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({ name }) => name);
  for (const expected of ['TimedTranscript', 'TimedTranscriptSegment', 'ChapterSet', 'ChapterEntry', 'ChapterRevision']) assert.ok(tables.includes(expected));
  const foreignKeys = database.prepare("PRAGMA foreign_key_list('ChapterEntry')").all(); assert.equal(foreignKeys[0].table, 'ChapterSet'); database.close();
});

test('chapters migration upgrades legacy CHAPTERS steps without changing other steps', () => {
  const database = new Database(':memory:'); database.pragma('foreign_keys = ON'); const root = path.resolve(__dirname, '../prisma/migrations');
  for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort()) {
    if (directory === '20260914120000_chapters_intelligence') { database.prepare('INSERT INTO ContentProduction (id, productionKey, title, format, origin, workflowTemplate, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run('p', 'p', 'P', 'LONG_FORM', 'DIRECT', 'LONG_FORM', new Date().toISOString()); database.prepare('INSERT INTO ProductionStep (id, productionId, key, label, position, mode, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run('s', 'p', 'CHAPTERS', 'Capitulos', 3, 'MANUAL', new Date().toISOString()); }
    database.exec(fs.readFileSync(path.join(root, directory, 'migration.sql'), 'utf8'));
  }
  assert.deepEqual(database.prepare('SELECT mode, capability FROM ProductionStep WHERE id = ?').get('s'), { mode: 'ASSISTED', capability: 'chapters' }); database.close();
});
