import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ChapterRepository, type ChapterSetDetails } from '../../database/repositories/ChapterRepository';
import { ProductionService } from '../production';
import { SupervisorModule } from '../../modules/dashboard/supervisor/SupervisorModule';
import {
  formatChapters,
  generateChapterCandidates,
  normalizeTimedSegments,
  parseTimedTranscript,
  TRANSCRIPT_FORMATS,
  validateChapters,
  TranscriptParseError,
  type ChapterEditableInput,
  type TimedTranscriptSegmentInput,
  type TranscriptFormat,
} from '../../domains/chapters';

export class ChaptersError extends Error { constructor(message: string) { super(message); this.name = 'ChaptersError'; } }
export class ChaptersValidationError extends ChaptersError { constructor(message: string) { super(message); this.name = 'ChaptersValidationError'; } }
export class ChaptersNotFoundError extends ChaptersError { constructor(message: string) { super(message); this.name = 'ChaptersNotFoundError'; } }
export class ChaptersConflictError extends ChaptersError { constructor(message: string) { super(message); this.name = 'ChaptersConflictError'; } }

const identifier = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw new ChaptersValidationError(`${field} is invalid`);
  return value.trim();
};
const optionalText = (value: unknown, field: string, max: number): string | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ChaptersValidationError(`${field} is invalid`);
  return value.trim();
};
const fingerprint = (productionId: string, segments: readonly TimedTranscriptSegmentInput[]): string => createHash('sha256').update(JSON.stringify({ productionId, segments })).digest('hex');

export interface ImportTranscriptInput {
  productionId?: unknown;
  format?: unknown;
  content?: unknown;
  segments?: unknown;
  source?: unknown;
  language?: unknown;
  videoId?: unknown;
  durationMs?: unknown;
}

export class ChaptersService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly repository = new ChapterRepository(DatabaseService.client),
    private readonly production = new ProductionService(),
    private readonly clock = () => new Date(),
    private readonly supervisor: Pick<SupervisorModule, 'reviewChapters'> = new SupervisorModule(),
  ) {}

  private async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queue = previous.then(() => current);
    this.locks.set(key, queue);
    await previous;
    try { return await work(); } finally { release(); if (this.locks.get(key) === queue) this.locks.delete(key); }
  }

  async importTranscript(raw: ImportTranscriptInput) {
    const productionId = identifier(raw.productionId, 'productionId');
    return this.locked(productionId, async () => {
      const production = await this.production.get(productionId);
      if (!production.steps.some(({ key }) => key === 'CHAPTERS')) throw new ChaptersConflictError('This production does not support chapters');
      const format = String(raw.format ?? '').toUpperCase() as TranscriptFormat;
      if (!TRANSCRIPT_FORMATS.includes(format)) throw new ChaptersValidationError('format is invalid');
      let segments: TimedTranscriptSegmentInput[];
      try {
        if (format === 'INTERNAL') {
          if (!Array.isArray(raw.segments)) throw new ChaptersValidationError('segments are required');
          segments = normalizeTimedSegments(raw.segments as TimedTranscriptSegmentInput[]);
        } else {
          if (typeof raw.content !== 'string') throw new ChaptersValidationError('content is required');
          segments = parseTimedTranscript(format, raw.content);
        }
      } catch (error) {
        if (error instanceof ChaptersValidationError) throw error;
        if (error instanceof TranscriptParseError) throw new ChaptersValidationError(error.message);
        throw error;
      }
      const durationMs = raw.durationMs == null ? null : Number(raw.durationMs);
      if (durationMs != null && (!Number.isInteger(durationMs) || durationMs < segments[segments.length - 1].endMs)) throw new ChaptersValidationError('durationMs is invalid');
      const key = fingerprint(productionId, segments);
      const existing = await this.repository.findTranscriptByFingerprint(key);
      if (existing) return { transcript: existing, created: false };
      const transcript = await this.repository.createTranscript({
        productionId,
        format,
        source: optionalText(raw.source, 'source', 100) ?? 'USER_IMPORT',
        language: optionalText(raw.language, 'language', 40),
        videoId: optionalText(raw.videoId, 'videoId', 160),
        durationMs: durationMs ?? segments[segments.length - 1].endMs,
        fingerprint: key,
        rawContent: format === 'INTERNAL' ? null : String(raw.content),
        assetRole: format === 'INTERNAL' ? 'TRANSCRIPT' : 'SUBTITLE',
        now: this.clock(),
        segments: segments.map((item, position) => ({ ...item, position })),
      });
      return { transcript, created: true };
    });
  }

  async getTranscript(idValue: unknown) {
    const transcript = await this.repository.findTranscriptById(identifier(idValue, 'transcriptId'));
    if (!transcript) throw new ChaptersNotFoundError('Transcript not found');
    return transcript;
  }

  async getProductionTranscript(productionIdValue: unknown) {
    const productionId = identifier(productionIdValue, 'productionId');
    await this.production.get(productionId);
    const transcript = await this.repository.findLatestTranscript(productionId);
    if (!transcript) throw new ChaptersNotFoundError('Timed transcript not found');
    return transcript;
  }

  async listVersions(productionIdValue: unknown) {
    const productionId = identifier(productionIdValue, 'productionId');
    await this.production.get(productionId);
    return this.repository.listChapterSets(productionId);
  }

  async getVersion(idValue: unknown) {
    const set = await this.repository.findChapterSetById(identifier(idValue, 'chapterSetId'));
    if (!set) throw new ChaptersNotFoundError('Chapter version not found');
    return set;
  }

  async generate(productionIdValue: unknown, options: { regenerate?: unknown } = {}) {
    const productionId = identifier(productionIdValue, 'productionId');
    return this.locked(productionId, async () => {
      let production = await this.production.get(productionId);
      const transcript = await this.repository.findLatestTranscript(productionId);
      if (!transcript) throw new ChaptersConflictError('Timed transcript is required');
      const regenerate = options.regenerate === true;
      const selected = await this.repository.findSelectedChapterSet(productionId);
      if (selected && selected.transcriptId === transcript.id && !regenerate) return { chapterSet: selected, created: false, production };
      const step = production.steps.find(({ key }) => key === 'CHAPTERS');
      if (!step) throw new ChaptersConflictError('This production does not support chapters');
      if (regenerate && ['COMPLETED', 'SKIPPED'].includes(step.state)) production = await this.production.repeatStep(productionId, 'CHAPTERS', { origin: 'chapters', reason: 'Explicit chapter regeneration' });
      const currentStep = production.steps.find(({ key }) => key === 'CHAPTERS')!;
      if (['AVAILABLE', 'FAILED', 'OUTDATED'].includes(currentStep.state)) production = await this.production.startStep(productionId, 'CHAPTERS', { origin: 'chapters' });
      else if (!['IN_PROGRESS', 'WAITING_USER'].includes(currentStep.state)) throw new ChaptersConflictError('Chapters step is not available');
      const candidates = generateChapterCandidates(transcript.segments);
      validateChapters(candidates, transcript.durationMs);
      const chapterSet = await this.repository.createChapterSet({ productionId, transcriptId: transcript.id, generation: 'DETERMINISTIC', entries: candidates });
      return { chapterSet, created: true, production: await this.production.get(productionId) };
    });
  }

  private editable(set: ChapterSetDetails, raw: unknown): Prisma.ChapterEntryCreateWithoutChapterSetInput[] {
    if (!Array.isArray(raw)) throw new ChaptersValidationError('entries are required');
    const values = raw.map((entry, index): ChapterEditableInput => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ChaptersValidationError(`entry ${index + 1} is invalid`);
      const value = entry as Record<string, unknown>;
      if (!Object.keys(value).every((key) => ['id', 'startMs', 'title'].includes(key))) throw new ChaptersValidationError(`entry ${index + 1} is invalid`);
      return { id: typeof value.id === 'string' ? value.id : undefined, startMs: Number(value.startMs), title: String(value.title ?? '') };
    });
    try { validateChapters(values, set.transcript.durationMs); } catch (error) { throw new ChaptersValidationError(error instanceof Error ? error.message : 'entries are invalid'); }
    return values.map((entry, position) => {
      const prior = entry.id ? set.entries.find(({ id }) => id === entry.id) : null;
      const nearest = set.transcript.segments.reduce((selected, segment) => Math.abs(segment.startMs - entry.startMs) < Math.abs(selected.startMs - entry.startMs) ? segment : selected, set.transcript.segments[0]);
      return {
        position,
        startMs: entry.startMs,
        endMs: values[position + 1]?.startMs ?? set.transcript.durationMs,
        title: entry.title.trim(),
        rationale: prior?.rationale ?? 'Capitulo inserido ou ajustado manualmente pelo usuario.',
        segmentStartPosition: prior?.segmentStartPosition ?? nearest.position,
        segmentEndPosition: prior?.segmentEndPosition ?? nearest.position,
        confidence: prior?.confidence ?? null,
        manuallyEdited: true,
      };
    });
  }

  async editVersion(idValue: unknown, entries: unknown, reasonValue?: unknown) {
    const set = await this.getVersion(idValue);
    if (set.status === 'STALE') throw new ChaptersConflictError('Stale chapter version cannot be edited');
    const reason = optionalText(reasonValue, 'reason', 300) ?? 'Manual chapter edit';
    return this.repository.replaceEntries(set.id, this.editable(set, entries), reason);
  }

  async addChapter(idValue: unknown, raw: unknown) {
    const set = await this.getVersion(idValue);
    const values = set.entries.map(({ id, startMs, title }) => ({ id, startMs, title }));
    values.push(raw as { id: string; startMs: number; title: string });
    values.sort((a, b) => Number(a.startMs) - Number(b.startMs));
    return this.editVersion(set.id, values, 'Chapter added manually');
  }

  async removeChapter(idValue: unknown, entryIdValue: unknown) {
    const set = await this.getVersion(idValue);
    const entryId = identifier(entryIdValue, 'chapterEntryId');
    if (!set.entries.some(({ id }) => id === entryId)) throw new ChaptersNotFoundError('Chapter entry not found');
    return this.editVersion(set.id, set.entries.filter(({ id }) => id !== entryId).map(({ id, startMs, title }) => ({ id, startMs, title })), 'Chapter removed manually');
  }

  async selectVersion(idValue: unknown) {
    const set = await this.getVersion(idValue);
    if (!set.productionId) throw new ChaptersConflictError('Chapter version is not linked to a production');
    return this.locked(set.productionId, async () => {
      let production = await this.production.get(set.productionId!);
      const latest = await this.repository.findLatestTranscript(set.productionId!);
      if (!latest || latest.id !== set.transcriptId) throw new ChaptersConflictError('Chapter version does not use the latest transcript');
      const review = this.supervisor.reviewChapters({ durationMs: set.transcript.durationMs, entries: set.entries });
      if (review.outcome !== 'APPROVED') throw new ChaptersConflictError(`Supervisor review requires changes: ${review.findings.join(' ')}`);
      const step = production.steps.find(({ key }) => key === 'CHAPTERS');
      if (step && ['AVAILABLE', 'FAILED', 'OUTDATED'].includes(step.state)) production = await this.production.startStep(set.productionId!, 'CHAPTERS', { origin: 'chapters' });
      let selected;
      try { selected = await this.repository.selectChapterSet(set.id, this.clock()); }
      catch (error) { if (error instanceof Error && ['CHAPTERS_STEP_MISSING', 'CHAPTERS_STEP_CONFLICT'].includes(error.message)) throw new ChaptersConflictError('Chapters step is not available for selection'); throw error; }
      production = await this.production.resume(set.productionId!);
      return { chapterSet: selected, production };
    });
  }

  async formatVersion(idValue: unknown) {
    const set = await this.getVersion(idValue);
    return { chapterSetId: set.id, text: formatChapters(set.entries) };
  }
}
