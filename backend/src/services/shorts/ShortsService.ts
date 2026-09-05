import { createHash } from 'crypto';
import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ShortsRepository, shortAnalysisDetails } from '../../database/repositories/ShortsRepository';
import { ProductionService } from '../production';
import { ChannelContextResolver } from '../channel-context';
import { SupervisorModule } from '../../modules/dashboard/supervisor/SupervisorModule';
import { clipConfiguration, describeClip, detectClips, validateClipBoundaries, overlapRatio, sameVariantFamily, scoreClipHook, ShortsConflictError, ShortsNotFoundError, ShortsValidationError, type ClipConfiguration } from '../../domains/shorts';

const json = (value: unknown): PrismaTypes.InputJsonValue => JSON.parse(JSON.stringify(value));
const text = (value: unknown, field: string, max = 160) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ShortsValidationError(`${field} is invalid`); return value.trim(); };
const only = (raw: Record<string, unknown>, fields: string[]) => { if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !fields.includes(key))) throw new ShortsValidationError('payload is invalid'); };

export class ShortsService {
  constructor(
    private readonly repository = new ShortsRepository(DatabaseService.client),
    private readonly production = new ProductionService(),
    private readonly context: Pick<ChannelContextResolver, 'resolve'> = new ChannelContextResolver(),
    private readonly supervisor: Pick<SupervisorModule, 'reviewShorts'> = new SupervisorModule(),
    private readonly clock = () => new Date(),
  ) {}

  private async source(transaction: PrismaTypes.TransactionClient, productionId: string) {
    const production = await transaction.contentProduction.findUnique({ where: { id: productionId }, include: { steps: true, assets: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], include: { libraryItem: true } } } });
    if (!production) throw new ShortsNotFoundError('Production not found');
    const step = production.steps.find(({ key }) => key === 'SHORTS');
    if (!step) throw new ShortsConflictError('This production does not support clip candidates');
    const transcript = await transaction.timedTranscript.findFirst({ where: { productionId }, orderBy: [{ version: 'desc' }], include: { segments: { orderBy: [{ position: 'asc' }] } } });
    const editing = production.steps.find(({ key }) => key === 'EDITING');
    const asset = production.assets.find(({ role }) => role === 'EDITED_VIDEO') ?? production.assets.find(({ role }) => role === 'RAW_VIDEO');
    const sourceFingerprint = createHash('sha256').update(JSON.stringify({ transcript: transcript?.fingerprint ?? null, editing: editing ? { state: editing.state, attempts: editing.attempts, completedAt: editing.completedAt, invalidatedAt: editing.invalidatedAt } : null, asset: asset ? { id: asset.id, libraryItemId: asset.libraryItemId } : null })).digest('hex');
    const chapterSet = transcript ? await transaction.chapterSet.findFirst({ where: { productionId, transcriptId: transcript.id, status: 'SELECTED' }, include: { entries: { orderBy: [{ startMs: 'asc' }] } } }) : null;
    return { production, step, transcript, sourceFingerprint, asset, chapters: chapterSet?.entries ?? [] };
  }

  private async invalidateOutput(transaction: PrismaTypes.TransactionClient, productionId: string, reason: string) {
    await transaction.productionStep.updateMany({ where: { productionId, key: 'SHORTS', state: 'COMPLETED' }, data: { state: 'WAITING_USER', completedAt: null, output: Prisma.DbNull, invalidatedAt: this.clock() } });
    await transaction.productionStep.updateMany({ where: { productionId, key: 'REVIEW', state: { in: ['COMPLETED', 'WAITING_USER', 'IN_PROGRESS'] } }, data: { state: 'OUTDATED', completedAt: null, invalidatedAt: this.clock() } });
    await transaction.contentProduction.updateMany({ where: { id: productionId, status: { in: ['READY_TO_PUBLISH', 'IN_REVIEW'] } }, data: { status: 'IN_PRODUCTION', currentStage: 'SHORTS' } });
    await transaction.productionEvent.create({ data: { productionId, stepKey: 'SHORTS', event: 'SHORTS_CHANGED', origin: 'shorts', actor: 'user', reason } });
  }

  private async refresh(transaction: PrismaTypes.TransactionClient, productionId: string) {
    const source = await this.source(transaction, productionId);
    const stale = await transaction.shortAnalysis.updateMany({ where: { productionId, status: 'CURRENT', sourceFingerprint: { not: source.sourceFingerprint } }, data: { status: 'STALE' } });
    if (stale.count) {
      await this.invalidateOutput(transaction, productionId, 'Temporal source changed');
      await transaction.productionStep.updateMany({ where: { productionId, key: 'SHORTS', state: { in: ['WAITING_USER', 'IN_PROGRESS', 'AVAILABLE'] } }, data: { state: 'OUTDATED', output: Prisma.DbNull, invalidatedAt: this.clock() } });
    }
    return source;
  }

  private async current(transaction: PrismaTypes.TransactionClient, analysisId: string, productionId: string) {
    const source = await this.refresh(transaction, productionId);
    const analysis = await transaction.shortAnalysis.findUnique({ where: { id: analysisId }, include: shortAnalysisDetails });
    if (!analysis) throw new ShortsNotFoundError('Analysis not found');
    if (analysis.status !== 'CURRENT' || !source.transcript || analysis.transcriptId !== source.transcript.id || analysis.sourceFingerprint !== source.sourceFingerprint) throw new ShortsConflictError('Analysis is stale or superseded; generate a new version');
    if (['CANCELLED', 'PUBLISHED', 'ANALYZED', 'COMPLETED'].includes(source.production.status)) throw new ShortsConflictError('Production is closed for editorial changes');
    return { ...source, transcript: source.transcript, analysis };
  }

  async list(productionIdValue: unknown) {
    const productionId = text(productionIdValue, 'productionId');
    return this.repository.transaction(productionId, async (transaction) => { await this.refresh(transaction, productionId); return transaction.shortAnalysis.findMany({ where: { productionId }, include: shortAnalysisDetails, orderBy: [{ version: 'desc' }] }); });
  }
  async getAnalysis(idValue: unknown) {
    const row = await this.repository.findAnalysis(text(idValue, 'analysisId'));
    if (!row) throw new ShortsNotFoundError('Analysis not found');
    await this.list(row.productionId);
    return (await this.repository.findAnalysis(row.id))!;
  }
  async getCandidate(idValue: unknown) {
    const row = await this.repository.findCandidate(text(idValue, 'candidateId'));
    if (!row) throw new ShortsNotFoundError('Candidate not found');
    await this.list(row.analysis.productionId);
    return (await this.repository.findCandidate(row.id))!;
  }

  async analyze(productionIdValue: unknown, options: Record<string, unknown> = {}, regenerate = false) {
    const productionId = text(productionIdValue, 'productionId');
    const configuration = clipConfiguration(options);
    const production = await this.production.get(productionId);
    const resolved = await this.context.resolve({ projectId: production.projectId, game: production.game ?? undefined, series: production.series ?? undefined, format: 'SHORT', text: 'Shorts estilo editorial momentos cortes', limit: 5, maxCharacters: 2500 });
    return this.repository.transaction(productionId, async (transaction) => {
      const source = await this.refresh(transaction, productionId);
      if (!source.transcript?.segments.length) throw new ShortsConflictError('Timed transcript is required; no temporal data available');
      if (['CANCELLED', 'PUBLISHED', 'ANALYZED', 'COMPLETED'].includes(source.production.status)) throw new ShortsConflictError('Production is closed for editorial changes');
      if (!source.production.steps.some(({ key, state }) => key === 'EDITING' && state === 'COMPLETED')) throw new ShortsConflictError('Complete temporal EDITING before analyzing clips');
      const existing = await transaction.shortAnalysis.findFirst({ where: { productionId, status: 'CURRENT' }, include: shortAnalysisDetails });
      if (existing && !regenerate) {
        if (Object.keys(options).length && JSON.stringify(existing.configuration) !== JSON.stringify(configuration)) throw new ShortsConflictError('Configuration changed; use explicit regeneration');
        return { analysis: existing, created: false };
      }
      const dependencyKeys = Array.isArray(source.step.dependencies) ? source.step.dependencies as string[] : [];
      if (dependencyKeys.some((key) => !source.production.steps.some((step) => step.key === key && ['COMPLETED', 'SKIPPED'].includes(step.state)))) throw new ShortsConflictError('Complete or skip the preceding Production steps first');
      if (!['AVAILABLE', 'IN_PROGRESS', 'WAITING_USER', 'FAILED', 'OUTDATED', 'COMPLETED', 'SKIPPED'].includes(source.step.state)) throw new ShortsConflictError('SHORTS step is not available');
      if (existing) await transaction.shortAnalysis.update({ where: { id: existing.id }, data: { status: 'SUPERSEDED' } });
      const previous = await transaction.shortAnalysis.findFirst({ where: { productionId }, orderBy: [{ version: 'desc' }] });
      const clips = detectClips(source.transcript.segments, configuration, source.chapters);
      const limitations = ['Ranking relativo editorial; nao e previsao de views ou viralizacao.', 'Deteccao heuristica baseada no texto; imagem, audio e entonacao nao sao analisados.', 'Nenhuma renderizacao ou publicacao nesta etapa.', 'Analytics nao participa do score; nenhum historico causal inferido.'];
      if (!clips.length) limitations.push('Nenhum acontecimento sustentado pelo transcript dentro da duracao configurada. Adicione manualmente ou ajuste a configuracao.');
      const analysis = await transaction.shortAnalysis.create({ data: { productionId, transcriptId: source.transcript.id, version: (previous?.version ?? 0) + 1, sourceFingerprint: source.sourceFingerprint,
        configuration: json(configuration), context: json({ entries: resolved.entries.map(({ id, type, subject, statement }) => ({ id, type, subject, statement })), usage: 'Contexto editorial para revisao; nao altera a evidencia nem cria aprendizado.' }), limitations: json(limitations),
        candidates: { create: clips.map((candidate) => ({ ...candidate, scoreFactors: json(candidate.scoreFactors), risks: json(candidate.risks), evidence: json(candidate.evidence), game: source.production.game, series: source.production.series })) },
      }, include: shortAnalysisDetails });
      await this.invalidateOutput(transaction, productionId, regenerate ? 'Explicit regeneration preserves prior analysis and edits' : 'Analysis generated');
      await transaction.productionStep.update({ where: { id: source.step.id }, data: { state: 'WAITING_USER', mode: 'ASSISTED', capability: 'shorts', attempts: { increment: 1 }, startedAt: this.clock(), completedAt: null, invalidatedAt: null, output: { analysisId: analysis.id, candidateIds: analysis.candidates.map(({ id }) => id) } } });
      await transaction.clipRevision.create({ data: { analysisId: analysis.id, event: 'GENERATED', snapshot: json({ configuration, candidateIds: analysis.candidates.map(({ id }) => id) }) } });
      return { analysis, created: true };
    });
  }

  async editCandidate(idValue: unknown, raw: Record<string, unknown>) {
    only(raw, ['startMs', 'endMs', 'title', 'hook']);
    if (!Object.keys(raw).length) throw new ShortsValidationError('editable fields required');
    const initial = await this.getCandidate(idValue);
    return this.repository.transaction(initial.analysis.productionId, async (transaction) => {
      const source = await this.current(transaction, initial.analysisId, initial.analysis.productionId);
      const candidate = source.analysis.candidates.find(({ id }) => id === initial.id)!;
      const startMs = 'startMs' in raw ? raw.startMs : candidate.startMs; const endMs = 'endMs' in raw ? raw.endMs : candidate.endMs;
      validateClipBoundaries(source.transcript.segments, startMs, endMs, source.analysis.configuration as unknown as ClipConfiguration);
      const hook = 'hook' in raw ? text(raw.hook, 'hook', 200) : candidate.hook;
      const changed = scoreClipHook(describeClip(source.transcript.segments, startMs as number, endMs as number, source.chapters), hook, source.transcript.segments);
      if (source.analysis.candidates.some((other) => other.id !== candidate.id && other.status !== 'ARCHIVED' && overlapRatio(changed, other) >= 0.65 && !sameVariantFamily(candidate, other))) throw new ShortsConflictError('Overlapping moment requires an explicit variant');
      const result = await transaction.clipCandidate.update({ where: { id: candidate.id }, data: { ...changed, momentKey: candidate.momentKey, title: 'title' in raw ? text(raw.title, 'title') : candidate.title, hook: 'hook' in raw ? text(raw.hook, 'hook', 200) : candidate.hook, scoreFactors: json(changed.scoreFactors), risks: json(changed.risks), evidence: json(changed.evidence), manuallyEdited: true, review: Prisma.DbNull, status: candidate.status === 'SELECTED' ? 'SHORTLISTED' : candidate.status } });
      await transaction.shortAnalysis.update({ where: { id: source.analysis.id }, data: { review: Prisma.DbNull } });
      await transaction.clipRevision.create({ data: { analysisId: source.analysis.id, candidateId: candidate.id, event: 'EDITED', snapshot: json({ before: candidate, after: result }) } });
      await this.invalidateOutput(transaction, source.production.id, 'Manual candidate edit requires renewed review and selection');
      return result;
    });
  }

  async createManual(analysisIdValue: unknown, raw: Record<string, unknown>) {
    only(raw, ['startMs', 'endMs', 'title', 'hook', 'variantOfId', 'variantReason']);
    const initial = await this.getAnalysis(analysisIdValue);
    return this.repository.transaction(initial.productionId, async (transaction) => {
      const source = await this.current(transaction, initial.id, initial.productionId);
      validateClipBoundaries(source.transcript.segments, raw.startMs, raw.endMs, source.analysis.configuration as unknown as ClipConfiguration);
      if (source.analysis.candidates.filter(({ status }) => status !== 'ARCHIVED').length >= 30) throw new ShortsConflictError('Archive candidates before adding more than 30');
      const variant = raw.variantOfId ? source.analysis.candidates.find(({ id }) => id === raw.variantOfId) : null;
      if (raw.variantOfId && !variant) throw new ShortsValidationError('variantOfId must reference this analysis');
      if (variant?.variantOfId) throw new ShortsValidationError('Variants must reference the original moment');
      const candidate = scoreClipHook(describeClip(source.transcript.segments, raw.startMs as number, raw.endMs as number, source.chapters), text(raw.hook, 'hook', 200), source.transcript.segments);
      if (variant && overlapRatio(candidate, variant) < 0.3) throw new ShortsValidationError('Variant must contain the same temporal moment');
      if (variant && candidate.startMs === variant.startMs && candidate.endMs === variant.endMs) throw new ShortsValidationError('Variant must use distinct boundaries');
      const overlaps = source.analysis.candidates.filter((other) => other.status !== 'ARCHIVED' && overlapRatio(candidate, other) >= 0.65);
      if (overlaps.some((other) => !variant || (other.id !== variant.id && other.variantOfId !== variant.id))) throw new ShortsConflictError('Duplicate moment requires an explicit variant');
      const result = await transaction.clipCandidate.create({ data: { analysisId: initial.id, ...candidate, title: text(raw.title, 'title'), hook: text(raw.hook, 'hook', 200), game: source.production.game, series: source.production.series, manuallyEdited: true, momentKey: variant?.momentKey ?? candidate.momentKey, variantOfId: variant?.id ?? null, variantReason: variant ? text(raw.variantReason, 'variantReason', 500) : null, scoreFactors: json(candidate.scoreFactors), risks: json(candidate.risks), evidence: json(candidate.evidence) } });
      await transaction.shortAnalysis.update({ where: { id: initial.id }, data: { review: Prisma.DbNull } });
      await transaction.clipRevision.create({ data: { analysisId: initial.id, candidateId: result.id, event: variant ? 'VARIANT_CREATED' : 'MANUAL_CREATED', snapshot: json(result) } });
      await this.invalidateOutput(transaction, initial.productionId, 'Candidate added');
      return result;
    });
  }

  async setStatus(idValue: unknown, status: string) {
    if (!['SHORTLISTED', 'SELECTED', 'REJECTED', 'ARCHIVED'].includes(status)) throw new ShortsValidationError('status is invalid');
    const initial = await this.getCandidate(idValue);
    return this.repository.transaction(initial.analysis.productionId, async (transaction) => {
      const source = await this.current(transaction, initial.analysisId, initial.analysis.productionId);
      const candidate = source.analysis.candidates.find(({ id }) => id === initial.id)!;
      if (candidate.status === status) return candidate;
      let review: ReturnType<SupervisorModule['reviewShorts']> | undefined;
      if (status === 'SELECTED') {
        const selected = source.analysis.candidates.filter((other) => other.status === 'SELECTED' && other.id !== candidate.id);
        if (selected.some((other) => other.momentKey === candidate.momentKey || overlapRatio(candidate, other) >= 0.65)) throw new ShortsConflictError('Select only one variant of a moment');
        review = this.supervisor.reviewShorts([candidate], source.transcript.segments, source.analysis.configuration as unknown as ClipConfiguration);
        if (review.outcome === 'NEEDS_CHANGES') throw new ShortsConflictError(`Supervisor requires changes: ${review.findings.filter(({ severity }) => severity === 'ERROR').map(({ message }) => message).join(' ')}`);
      }
      const result = await transaction.clipCandidate.update({ where: { id: candidate.id }, data: { status, ...(review ? { review: json(review) } : {}) } });
      await transaction.shortAnalysis.update({ where: { id: source.analysis.id }, data: { review: Prisma.DbNull } });
      await transaction.clipRevision.create({ data: { analysisId: source.analysis.id, candidateId: candidate.id, event: status, snapshot: json({ before: candidate.status, after: status, review }) } });
      await this.invalidateOutput(transaction, source.production.id, `Candidate ${status.toLowerCase()}`);
      return result;
    });
  }

  async review(analysisIdValue: unknown) {
    const initial = await this.getAnalysis(analysisIdValue);
    return this.repository.transaction(initial.productionId, async (transaction) => {
      const source = await this.current(transaction, initial.id, initial.productionId);
      const active = source.analysis.candidates.filter(({ status }) => !['ARCHIVED', 'REJECTED'].includes(status));
      const review = this.supervisor.reviewShorts(active, source.transcript.segments, source.analysis.configuration as unknown as ClipConfiguration);
      await transaction.clipRevision.create({ data: { analysisId: initial.id, event: 'SUPERVISOR_REVIEWED', snapshot: json(review) } });
      return transaction.shortAnalysis.update({ where: { id: initial.id }, data: { review: json(review) }, include: shortAnalysisDetails });
    });
  }

  async complete(analysisIdValue: unknown) {
    const initial = await this.getAnalysis(analysisIdValue);
    const analysis = await this.repository.transaction(initial.productionId, async (transaction) => {
      const source = await this.current(transaction, initial.id, initial.productionId);
      const selected = source.analysis.candidates.filter(({ status }) => status === 'SELECTED');
      if (!selected.length) throw new ShortsConflictError('Select at least one candidate or skip SHORTS explicitly');
      if (!source.production.steps.some(({ key, state }) => key === 'EDITING' && state === 'COMPLETED')) throw new ShortsConflictError('Complete temporal EDITING before finalizing clips');
      const dependencyKeys = Array.isArray(source.step.dependencies) ? source.step.dependencies as string[] : [];
      if (dependencyKeys.some((key) => !source.production.steps.some((step) => step.key === key && ['COMPLETED', 'SKIPPED'].includes(step.state)))) throw new ShortsConflictError('Preceding steps require completion');
      const review = this.supervisor.reviewShorts(selected, source.transcript.segments, source.analysis.configuration as unknown as ClipConfiguration);
      if (review.outcome === 'NEEDS_CHANGES') throw new ShortsConflictError('Supervisor requires changes');
      if (source.step.state === 'COMPLETED') return source.analysis;
      if (!['WAITING_USER', 'IN_PROGRESS', 'AVAILABLE', 'OUTDATED'].includes(source.step.state)) throw new ShortsConflictError('SHORTS step cannot complete');
      await transaction.productionStep.update({ where: { id: source.step.id }, data: { state: 'COMPLETED', completedAt: this.clock(), invalidatedAt: null, output: { analysisId: initial.id, selectedCandidateIds: selected.map(({ id }) => id), sourceFingerprint: source.sourceFingerprint } } });
      await transaction.productionEvent.create({ data: { productionId: initial.productionId, stepKey: 'SHORTS', event: 'SHORTS_COMPLETED', actor: 'user', origin: 'shorts', data: { analysisId: initial.id, candidateIds: selected.map(({ id }) => id) } } });
      await transaction.clipRevision.create({ data: { analysisId: initial.id, event: 'COMPLETED', snapshot: json({ review, selectedCandidateIds: selected.map(({ id }) => id) }) } });
      return transaction.shortAnalysis.update({ where: { id: initial.id }, data: { review: json(review) }, include: shortAnalysisDetails });
    });
    return { analysis, production: await this.production.resume(initial.productionId) };
  }

  async evidence(idValue: unknown) {
    const candidate = await this.getCandidate(idValue);
    const ids = (candidate.evidence as Array<{ segmentId: string }>).map(({ segmentId }) => segmentId);
    const segments = await this.repository.client.timedTranscriptSegment.findMany({ where: { transcriptId: candidate.analysis.transcriptId, id: { in: ids } }, orderBy: [{ position: 'asc' }] });
    return { transcriptId: candidate.analysis.transcriptId, segments };
  }
  async selected(productionIdValue: unknown) { const rows = await this.list(productionIdValue); return rows.find(({ status }) => status === 'CURRENT')?.candidates.filter(({ status }) => status === 'SELECTED') ?? []; }
  async renderContract(productionIdValue: unknown) {
    const productionId = text(productionIdValue, 'productionId');
    return this.repository.transaction(productionId, async (transaction) => {
      const source = await this.refresh(transaction, productionId);
      const analysis = await transaction.shortAnalysis.findFirst({ where: { productionId, status: 'CURRENT' }, include: shortAnalysisDetails });
      if (!analysis || source.step.state !== 'COMPLETED') throw new ShortsConflictError('Complete a current Shorts analysis before handoff');
      if (!source.production.steps.some(({ key, state }) => key === 'EDITING' && state === 'COMPLETED') || !source.production.steps.some(({ key, state }) => key === 'CHAPTERS' && ['COMPLETED', 'SKIPPED'].includes(state))) throw new ShortsConflictError('Source workflow changed; review editing and Chapters before handoff');
      const selected = analysis.candidates.filter(({ status }) => status === 'SELECTED');
      return { contractVersion: 1, productionId, analysisId: analysis.id, sourceFingerprint: analysis.sourceFingerprint, renderReady: Boolean(source.asset), missingData: source.asset ? [] : ['source video asset'], clips: selected.map((candidate) => ({ clipId: candidate.id, sourceAssetId: source.asset?.libraryItemId ?? null, sourceVideoId: source.transcript?.videoId ?? source.production.publishedVideoId, startMs: candidate.startMs, endMs: candidate.endMs, metadata: { title: candidate.title, hook: candidate.hook, game: candidate.game, series: candidate.series }, captions: { transcriptId: analysis.transcriptId, segmentIds: (candidate.evidence as Array<{ segmentId: string }>).map(({ segmentId }) => segmentId), startMs: candidate.startMs, endMs: candidate.endMs } })) };
    });
  }
}
