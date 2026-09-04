const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, test } = require('node:test');
const fs = require('node:fs'); const path = require('node:path'); const express = require('express');
process.env.DATABASE_URL = ':memory:';

const { DatabaseService } = require('../dist/database/DatabaseService');
const { ProductionRepository } = require('../dist/database/repositories/ProductionRepository');
const { ChapterRepository } = require('../dist/database/repositories/ChapterRepository');
const { ProductionService } = require('../dist/services/production');
const { ChaptersService, ChaptersConflictError, ChaptersValidationError } = require('../dist/services/chapters');
const { parseTimedTranscript, normalizeTimedSegments, generateChapterCandidates, formatChapters } = require('../dist/domains/chapters');
const { createChaptersRouter } = require('../dist/routes/chapters');
const { SupervisorModule } = require('../dist/modules/dashboard/supervisor/SupervisorModule');
const { createDefaultCapabilityRegistry } = require('../dist/services/orchestration/OrchestrationComposition');

const migrateAll = async (client) => {
  const root = path.resolve(__dirname, '../prisma/migrations');
  for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort()) {
    const sql = fs.readFileSync(path.join(root, directory, 'migration.sql'), 'utf8');
    for (const statement of sql.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
  }
};
const segments = () => [
  { startMs: 0, endMs: 10_000, text: 'Introducao da viagem' },
  { startMs: 60_000, endMs: 72_000, text: 'Agora comeca a primeira missao' },
  { startMs: 130_000, endMs: 145_000, text: 'Depois aparece um novo desafio' },
];

describe('chapters intelligence and timed transcript pipeline', { concurrency: false }, () => {
  let client; let production; let chapters; let server; let baseUrl;
  const createReadyForChapters = async (key = 'chapters') => {
    const { production: row } = await production.create({ productionKey: key, title: `Video ${key}`, format: 'LONG_FORM', origin: 'DIRECT' });
    await production.startStep(row.id, 'PREPARING'); await production.completeStep(row.id, 'PREPARING');
    await production.startStep(row.id, 'EDITING'); await production.completeStep(row.id, 'EDITING');
    return production.get(row.id);
  };
  before(async () => {
    client = await DatabaseService.connect(); await client.$executeRawUnsafe('PRAGMA foreign_keys = ON'); await migrateAll(client);
    production = new ProductionService(new ProductionRepository(client), undefined, { reviewProduction: () => ({ outcome: 'APPROVED', findings: [] }) }, { resolve: async () => ({ entries: [], truncated: false }) });
    chapters = new ChaptersService(new ChapterRepository(client), production, () => new Date('2026-09-14T12:00:00Z'), new SupervisorModule());
    const app = express(); app.use(express.json()); app.use('/api/chapters', createChaptersRouter(chapters));
    server = await new Promise((resolve) => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); }); baseUrl = `http://127.0.0.1:${server.address().port}/api/chapters`;
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await DatabaseService.disconnect(); });
  beforeEach(async () => {
    await client.chapterRevision.deleteMany(); await client.chapterEntry.deleteMany(); await client.chapterSet.deleteMany(); await client.timedTranscriptSegment.deleteMany(); await client.timedTranscript.deleteMany();
    await client.productionAssetRelation.deleteMany(); await client.productionEvent.deleteMany(); await client.productionStep.deleteMany(); await client.contentProduction.deleteMany(); await client.libraryItem.deleteMany();
  });
  const request = async (url, options = {}) => { const response = await fetch(`${baseUrl}${url}`, { headers: { 'content-type': 'application/json' }, ...options }); return { status: response.status, body: await response.json() }; };

  test('parses SBV while preserving timing and multiline text', () => {
    const result = parseTimedTranscript('SBV', '0:00:01.000,0:00:03.500\nPrimeira linha\nsegunda linha\n\n0:00:04.000,0:00:06.000\nFim');
    assert.deepEqual(result.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })), [{ startMs: 1000, endMs: 3500, text: 'Primeira linha segunda linha' }, { startMs: 4000, endMs: 6000, text: 'Fim' }]);
  });
  test('parses indexed SRT with comma milliseconds', () => assert.equal(parseTimedTranscript('SRT', '1\n00:00:01,000 --> 00:00:02,500\nOla')[0].endMs, 2500));
  test('parses WebVTT cues and strips markup from text data', () => assert.equal(parseTimedTranscript('VTT', 'WEBVTT\n\nc1\n00:01.000 --> 00:03.000\n<b>Acao</b> agora')[0].text, 'Acao agora'));
  test('rejects malformed blocks and invalid timestamps without dropping data', () => {
    assert.throws(() => parseTimedTranscript('SBV', 'nao e tempo\nTexto'));
    assert.throws(() => parseTimedTranscript('SRT', '1\n00:00:03,000 --> 00:00:02,000\nTexto'));
  });
  test('normalizes internal segments in chronological order without mutating input', () => {
    const input = [segments()[1], segments()[0]]; const snapshot = structuredClone(input); const result = normalizeTimedSegments(input);
    assert.equal(result[0].startMs, 0); assert.deepEqual(input, snapshot);
  });
  test('generation follows natural transitions and preserves segment evidence', () => {
    const result = generateChapterCandidates(segments()); assert.equal(result.length, 3); assert.equal(result[1].startMs, 60_000); assert.equal(result[1].segmentStartPosition, 1); assert.match(result[1].rationale, /mudanca/);
  });
  test('generation avoids chapter spam for nearby speech', () => {
    const dense = Array.from({ length: 20 }, (_, index) => ({ startMs: index * 5_000, endMs: index * 5_000 + 4_000, text: `fala ${index}` }));
    assert.equal(generateChapterCandidates(dense).length, 1);
  });
  test('formatter returns plain copyable timestamps without markdown', () => assert.equal(formatChapters([{ startMs: 0, title: 'Inicio' }, { startMs: 135_000, title: 'Missao' }]), '0:00 Inicio\n2:15 Missao'));

  test('import persists normalized segments and relates the source asset in Library', async () => {
    const row = await createReadyForChapters('import'); const result = await chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: segments(), source: 'PERSISTED' });
    assert.equal(result.created, true); assert.equal(result.transcript.segments.length, 3); assert.equal(await client.libraryItem.count(), 0);
    const imported = await chapters.importTranscript({ productionId: row.id, format: 'SBV', content: '0:00:00.000,0:00:03.000\nInicio real', source: 'USER_IMPORT' });
    assert.equal(imported.transcript.libraryItem.type, 'transcript'); assert.equal((await production.get(row.id)).assets.at(-1).role, 'SUBTITLE');
  });
  test('identical import is idempotent', async () => {
    const row = await createReadyForChapters('idempotent'); const input = { productionId: row.id, format: 'INTERNAL', segments: segments() };
    const first = await chapters.importTranscript(input); const second = await chapters.importTranscript(structuredClone(input)); assert.equal(second.created, false); assert.equal(first.transcript.id, second.transcript.id); assert.equal(await client.timedTranscript.count(), 1);
  });
  test('generation requires a real temporal source', async () => { const row = await createReadyForChapters('missing'); await assert.rejects(() => chapters.generate(row.id), ChaptersConflictError); });
  test('generation persists one ordered version with traceable evidence', async () => {
    const row = await createReadyForChapters('generate'); await chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: segments() }); const result = await chapters.generate(row.id);
    assert.equal(result.created, true); assert.equal(result.chapterSet.version, 1); assert.deepEqual(result.chapterSet.entries.map(({ startMs }) => startMs), [0, 60_000, 130_000]); assert.equal(result.chapterSet.revisions[0].event, 'GENERATED');
  });
  test('resume and ordinary generation reuse valid selected chapters', async () => {
    const row = await createReadyForChapters('resume'); await chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: segments() }); const generated = await chapters.generate(row.id); await chapters.selectVersion(generated.chapterSet.id);
    await production.resume(row.id); const repeated = await chapters.generate(row.id); assert.equal(repeated.created, false); assert.equal(repeated.chapterSet.id, generated.chapterSet.id); assert.equal(await client.chapterSet.count(), 1);
  });
  test('manual edit, add and remove preserve audit history', async () => {
    const row = await createReadyForChapters('edit'); await chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: segments() }); let set = (await chapters.generate(row.id)).chapterSet;
    set = await chapters.editVersion(set.id, set.entries.map(({ id, startMs, title }) => ({ id, startMs, title: `${title} revisado` }))); assert.equal(set.entries[0].manuallyEdited, true);
    set = await chapters.addChapter(set.id, { startMs: 100_000, title: 'Momento extra' }); assert.equal(set.entries.length, 4); const extra = set.entries.find(({ title }) => title === 'Momento extra');
    set = await chapters.removeChapter(set.id, extra.id); assert.equal(set.entries.length, 3); assert.ok(set.revisions.length >= 4);
  });
  test('invalid manual timestamp is rejected safely', async () => {
    const row = await createReadyForChapters('invalid-edit'); await chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: segments() }); const set = (await chapters.generate(row.id)).chapterSet;
    await assert.rejects(() => chapters.editVersion(set.id, [{ id: set.entries[0].id, startMs: -1, title: 'Erro' }]), ChaptersValidationError);
  });
  test('selecting an approved version completes CHAPTERS and unlocks SHORTS', async () => {
    const row = await createReadyForChapters('select'); await chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: segments() }); const set = (await chapters.generate(row.id)).chapterSet; const selected = await chapters.selectVersion(set.id);
    assert.equal(selected.chapterSet.status, 'SELECTED'); assert.equal(selected.production.steps.find(({ key }) => key === 'CHAPTERS').state, 'COMPLETED'); assert.equal(selected.production.nextAction.stepKey, 'SHORTS');
  });
  test('a changed transcript preserves and marks the selected version stale', async () => {
    const row = await createReadyForChapters('stale'); await chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: segments() }); const set = (await chapters.generate(row.id)).chapterSet; await chapters.selectVersion(set.id);
    await chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: [...segments(), { startMs: 200_000, endMs: 210_000, text: 'Conclusao nova' }] }); const old = await chapters.getVersion(set.id); const changed = await production.get(row.id);
    assert.equal(old.status, 'STALE'); assert.equal(changed.steps.find(({ key }) => key === 'CHAPTERS').state, 'OUTDATED'); assert.ok(changed.events.some(({ event }) => event === 'CHAPTERS_INVALIDATED'));
  });
  test('Short production honestly rejects Chapters', async () => { const { production: row } = await production.create({ productionKey: 'short', title: 'Short', format: 'SHORT', origin: 'DIRECT' }); await assert.rejects(() => chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: segments() }), ChaptersConflictError); });
  test('Supervisor rejects incoherent temporal versions and accepts valid evidence', () => {
    const supervisor = new SupervisorModule(); assert.equal(supervisor.reviewChapters({ durationMs: 1000, entries: [{ startMs: 10, title: 'Ok', segmentStartPosition: 0, segmentEndPosition: 0 }] }).outcome, 'APPROVED');
    assert.equal(supervisor.reviewChapters({ durationMs: 1000, entries: [{ startMs: 2000, title: '', segmentStartPosition: 2, segmentEndPosition: 1 }] }).outcome, 'NEEDS_CHANGES');
  });
  test('Manager generates Chapters when requested and reports missing transcript honestly', async () => {
    const row = await createReadyForChapters('manager'); const registry = createDefaultCapabilityRegistry({ production, chapters });
    let result = await registry.get('production.manage').execute({ request: { intent: 'Gera os capitulos deste video' }, results: new Map() }); assert.deepEqual(result.missingData, ['timed transcript']);
    await chapters.importTranscript({ productionId: row.id, format: 'INTERNAL', segments: segments() }); result = await registry.get('production.manage').execute({ request: { intent: 'Faz os capitulos desta producao' }, results: new Map() }); assert.match(result.summary, /gerados/);
  });
  test('HTTP imports, generates, edits, selects and formats persisted chapters', async () => {
    const row = await createReadyForChapters('http'); let response = await request('/transcripts', { method: 'POST', body: JSON.stringify({ productionId: row.id, format: 'INTERNAL', segments: segments() }) }); assert.equal(response.status, 201);
    response = await request(`/productions/${row.id}/generate`, { method: 'POST', body: '{"regenerate":false}' }); assert.equal(response.status, 201); const set = response.body.chapterSet;
    assert.equal((await request(`/productions/${row.id}`)).status, 200); assert.equal((await request(`/versions/${set.id}`)).status, 200); assert.equal((await request(`/versions/${set.id}/output`)).body.text.split('\n').length, 3);
    assert.equal((await request(`/versions/${set.id}/select`, { method: 'POST', body: '{}' })).status, 200);
  });
  test('HTTP errors are strict and never expose internal details', async () => {
    assert.equal((await request('/transcripts', { method: 'POST', body: '{"secret":"x"}' })).status, 400); const missing = await request('/versions/missing'); assert.equal(missing.status, 404); assert.doesNotMatch(JSON.stringify(missing.body), /Prisma|stack|secret/);
  });
});
