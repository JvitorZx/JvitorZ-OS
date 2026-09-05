import type { Prisma, PrismaClient } from '@prisma/client';
import { invalidateShortsSource } from './ShortsRepository';

const transcriptDetails = {
  segments: { orderBy: [{ position: 'asc' as const }] },
  chapterSets: { orderBy: [{ version: 'desc' as const }], include: { entries: { orderBy: [{ position: 'asc' as const }] }, revisions: { orderBy: [{ createdAt: 'desc' as const }] } } },
  libraryItem: true,
  production: true,
} satisfies Prisma.TimedTranscriptInclude;

const chapterDetails = {
  entries: { orderBy: [{ position: 'asc' as const }] },
  revisions: { orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }] },
  transcript: { include: { segments: { orderBy: [{ position: 'asc' as const }] } } },
  production: true,
} satisfies Prisma.ChapterSetInclude;

export type TimedTranscriptDetails = Prisma.TimedTranscriptGetPayload<{ include: typeof transcriptDetails }>;
export type ChapterSetDetails = Prisma.ChapterSetGetPayload<{ include: typeof chapterDetails }>;

export class ChapterRepository {
  constructor(private readonly client: PrismaClient) {}

  findTranscriptById(id: string): Promise<TimedTranscriptDetails | null> {
    return this.client.timedTranscript.findUnique({ where: { id }, include: transcriptDetails });
  }

  findTranscriptByFingerprint(fingerprint: string): Promise<TimedTranscriptDetails | null> {
    return this.client.timedTranscript.findUnique({ where: { fingerprint }, include: transcriptDetails });
  }

  findLatestTranscript(productionId: string): Promise<TimedTranscriptDetails | null> {
    return this.client.timedTranscript.findFirst({ where: { productionId }, include: transcriptDetails, orderBy: [{ version: 'desc' }, { createdAt: 'desc' }] });
  }

  async createTranscript(input: {
    productionId: string;
    videoId?: string | null;
    source: string;
    format: string;
    language?: string | null;
    durationMs?: number | null;
    fingerprint: string;
    rawContent?: string | null;
    assetRole?: string;
    now: Date;
    segments: Array<{ position: number; startMs: number; endMs: number; text: string; sourceSegmentId?: string | null; confidence?: number | null }>;
  }): Promise<TimedTranscriptDetails> {
    const transcriptId = await this.client.$transaction(async (transaction) => {
      const latest = await transaction.timedTranscript.findFirst({ where: { productionId: input.productionId }, orderBy: [{ version: 'desc' }] });
      let libraryItemId: string | null = null;
      if (input.rawContent) {
        const production = await transaction.contentProduction.findUniqueOrThrow({ where: { id: input.productionId } });
        const item = await transaction.libraryItem.create({ data: { projectId: production.projectId, title: `${production.title} - ${input.format}`, type: 'transcript', content: input.rawContent } });
        libraryItemId = item.id;
        await transaction.productionAssetRelation.create({ data: { productionId: input.productionId, libraryItemId: item.id, role: input.assetRole ?? 'TRANSCRIPT' } });
      }
      const transcript = await transaction.timedTranscript.create({ data: {
        productionId: input.productionId, libraryItemId, videoId: input.videoId ?? null, source: input.source,
        format: input.format, language: input.language ?? null, durationMs: input.durationMs ?? null,
        fingerprint: input.fingerprint, version: (latest?.version ?? 0) + 1, segments: { create: input.segments },
      } });
      if (latest && latest.fingerprint !== input.fingerprint) {
        await invalidateShortsSource(transaction, input.productionId, 'Timed transcript changed; prior candidates preserved');
        await transaction.chapterSet.updateMany({ where: { productionId: input.productionId, status: 'SELECTED' }, data: { status: 'STALE' } });
        const changed = await transaction.productionStep.updateMany({ where: { productionId: input.productionId, key: 'CHAPTERS', state: { in: ['COMPLETED', 'WAITING_USER', 'IN_PROGRESS'] } }, data: { state: 'OUTDATED', invalidatedAt: input.now } });
        if (changed.count) await transaction.productionEvent.create({ data: { productionId: input.productionId, stepKey: 'CHAPTERS', event: 'CHAPTERS_INVALIDATED', actor: 'system', origin: 'chapters', reason: 'Timed transcript changed', data: { previousTranscriptId: latest.id, transcriptId: transcript.id } } });
      }
      return transcript.id;
    });
    return this.client.timedTranscript.findUniqueOrThrow({ where: { id: transcriptId }, include: transcriptDetails });
  }

  findChapterSetById(id: string): Promise<ChapterSetDetails | null> {
    return this.client.chapterSet.findUnique({ where: { id }, include: chapterDetails });
  }

  listChapterSets(productionId: string): Promise<ChapterSetDetails[]> {
    return this.client.chapterSet.findMany({ where: { productionId }, include: chapterDetails, orderBy: [{ version: 'desc' }, { createdAt: 'desc' }] });
  }

  findSelectedChapterSet(productionId: string): Promise<ChapterSetDetails | null> {
    return this.client.chapterSet.findFirst({ where: { productionId, status: 'SELECTED' }, include: chapterDetails, orderBy: [{ selectedAt: 'desc' }] });
  }

  async createChapterSet(input: { productionId: string; transcriptId: string; generation: string; entries: Prisma.ChapterEntryCreateWithoutChapterSetInput[] }): Promise<ChapterSetDetails> {
    const set = await this.client.$transaction(async (transaction) => {
      const latest = await transaction.chapterSet.findFirst({ where: { productionId: input.productionId }, orderBy: [{ version: 'desc' }] });
      const created = await transaction.chapterSet.create({ data: { productionId: input.productionId, transcriptId: input.transcriptId, generation: input.generation, version: (latest?.version ?? 0) + 1, entries: { create: input.entries } } });
      await transaction.chapterRevision.create({ data: { chapterSetId: created.id, event: 'GENERATED', actor: 'system', snapshot: input.entries as unknown as Prisma.InputJsonValue } });
      return created;
    });
    return this.client.chapterSet.findUniqueOrThrow({ where: { id: set.id }, include: chapterDetails });
  }

  async replaceEntries(chapterSetId: string, entries: Prisma.ChapterEntryCreateWithoutChapterSetInput[], reason: string): Promise<ChapterSetDetails> {
    await this.client.$transaction(async (transaction) => {
      const before = await transaction.chapterEntry.findMany({ where: { chapterSetId }, orderBy: { position: 'asc' } });
      await transaction.chapterEntry.deleteMany({ where: { chapterSetId } });
      await transaction.chapterEntry.createMany({ data: entries.map((entry) => ({ ...entry, chapterSetId })) });
      await transaction.chapterRevision.create({ data: { chapterSetId, event: 'MANUALLY_EDITED', actor: 'user', reason, snapshot: { before, after: entries } as unknown as Prisma.InputJsonValue } });
    });
    return this.client.chapterSet.findUniqueOrThrow({ where: { id: chapterSetId }, include: chapterDetails });
  }

  async selectChapterSet(id: string, now: Date): Promise<ChapterSetDetails> {
    await this.client.$transaction(async (transaction) => {
      const set = await transaction.chapterSet.findUniqueOrThrow({ where: { id }, include: { entries: true } });
      const step = set.productionId ? await transaction.productionStep.findUnique({ where: { productionId_key: { productionId: set.productionId, key: 'CHAPTERS' } } }) : null;
      if (!step) throw new Error('CHAPTERS_STEP_MISSING');
      if (step.state === 'COMPLETED' && set.status === 'SELECTED') return;
      if (!['IN_PROGRESS', 'WAITING_USER'].includes(step.state)) throw new Error('CHAPTERS_STEP_CONFLICT');
      await transaction.chapterSet.updateMany({ where: { productionId: set.productionId, status: 'SELECTED', id: { not: id } }, data: { status: 'ARCHIVED' } });
      await transaction.chapterSet.update({ where: { id }, data: { status: 'SELECTED', selectedAt: now } });
      await transaction.chapterRevision.create({ data: { chapterSetId: id, event: 'SELECTED', actor: 'user', snapshot: set.entries as unknown as Prisma.InputJsonValue } });
      await transaction.productionStep.update({ where: { id: step.id }, data: { state: 'COMPLETED', completedAt: now, error: null, output: { chapterSetId: set.id, transcriptId: set.transcriptId, version: set.version } } });
      await transaction.productionEvent.create({ data: { productionId: set.productionId!, stepKey: 'CHAPTERS', event: 'STEP_COMPLETED', actor: 'user', origin: 'chapters', fromState: step.state, toState: 'COMPLETED', data: { chapterSetId: set.id, transcriptId: set.transcriptId, version: set.version } } });
    });
    return this.client.chapterSet.findUniqueOrThrow({ where: { id }, include: chapterDetails });
  }
}
