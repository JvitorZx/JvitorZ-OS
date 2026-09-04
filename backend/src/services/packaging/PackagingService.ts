import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { PackagingRepository } from '../../database/repositories/PackagingRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { VideoReachSnapshotRepository } from '../../database/repositories/VideoReachSnapshotRepository';
import { generatePackagingVariants, reviewPackagingVariant, type PackagingGenerationInput } from '../../domains/packaging';
import { ChannelContextResolver, ChannelContextService } from '../channel-context';

export class PackagingError extends Error { constructor(message: string) { super(message); this.name = 'PackagingError'; } }
export class PackagingValidationError extends PackagingError { constructor(message: string) { super(message); this.name = 'PackagingValidationError'; } }
export class PackagingNotFoundError extends PackagingError { constructor(message = 'Packaging not found') { super(message); this.name = 'PackagingNotFoundError'; } }
export class PackagingConflictError extends PackagingError { constructor(message: string) { super(message); this.name = 'PackagingConflictError'; } }

const text = (value: unknown, field: string, max = 500): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new PackagingValidationError(`${field} is invalid`);
  return value.trim();
};
const optionalText = (value: unknown, field: string, max = 300): string | null => value == null || value === '' ? null : text(value, field, max);
const strings = (value: unknown, field: string, maxItems = 20): string[] => {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 300)) throw new PackagingValidationError(`${field} is invalid`);
  return value.map((item) => item.trim());
};
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export class PackagingService {
  constructor(
    private readonly repository = new PackagingRepository(DatabaseService.client),
    private readonly contextResolver: Pick<ChannelContextResolver, 'resolve'> = new ChannelContextResolver(),
    private readonly contextService: Pick<ChannelContextService, 'create' | 'relate'> = new ChannelContextService(),
    private readonly performanceRepository = new VideoPerformanceSnapshotRepository(DatabaseService.client),
    private readonly reachRepository = new VideoReachSnapshotRepository(DatabaseService.client),
    private readonly clock = () => new Date(),
  ) {}

  async generate(raw: PackagingGenerationInput) {
    if (!raw || typeof raw !== 'object') throw new PackagingValidationError('payload is invalid');
    const summary = text(raw.summary, 'summary', 2_000); const keyEvents = strings(raw.keyEvents, 'keyEvents', 10);
    if (!keyEvents.length) throw new PackagingValidationError('keyEvents must contain a real event');
    const variationCount = raw.variationCount ?? 3;
    if (!Number.isInteger(variationCount) || variationCount < 2 || variationCount > 5) throw new PackagingValidationError('variationCount is invalid');
    if (raw.episode != null && (!Number.isInteger(raw.episode) || raw.episode < 1 || raw.episode > 10_000)) throw new PackagingValidationError('episode is invalid');
    const input: PackagingGenerationInput = {
      projectId: optionalText(raw.projectId, 'projectId', 160), contentKey: optionalText(raw.contentKey, 'contentKey', 200) ?? `packaging:${randomUUID()}`,
      videoId: optionalText(raw.videoId, 'videoId', 160), game: optionalText(raw.game, 'game', 160), series: optionalText(raw.series, 'series', 160),
      episode: raw.episode ?? null, format: optionalText(raw.format, 'format', 80), summary, keyEvents,
      editorialObjective: optionalText(raw.editorialObjective, 'editorialObjective', 500), constraints: strings(raw.constraints ?? [], 'constraints'), variationCount,
    };
    const resolved = await this.contextResolver.resolve({ projectId: input.projectId, text: `${input.game ?? ''} ${input.series ?? ''} packaging titulo thumbnail`,
      ...(input.game ? { game: input.game } : {}), ...(input.series ? { series: input.series } : {}), ...(input.format ? { format: input.format } : {}), limit: 10, maxCharacters: 5_000 });
    const context = resolved.entries.map(({ id, type, subject, statement, confidence }) => ({ id, type, subject, statement, confidence }));
    const variants = generatePackagingVariants(input, context);
    return this.repository.create({
      projectId: input.projectId, contentKey: input.contentKey!, videoId: input.videoId, game: input.game, series: input.series, episode: input.episode,
      format: input.format, summary, keyEvents: json(keyEvents), editorialObjective: input.editorialObjective, constraints: json(input.constraints ?? []), contextSnapshot: json(context),
      variants: { create: variants.map((variant) => ({ ...variant, thumbnailBrief: json(variant.thumbnailBrief), tags: json(variant.tags), contextUsed: json(variant.contextUsed) })) },
      history: { create: { event: 'GENERATED', data: { variationCount: variants.length, contextIds: context.map(({ id }) => id) } } },
    });
  }

  list(filters: { projectId?: string | null; game?: string; series?: string; status?: string; limit?: number } = {}) {
    if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200)) throw new PackagingValidationError('limit is invalid');
    return this.repository.findAll(filters);
  }

  async get(id: string) { const result = await this.repository.findById(text(id, 'id', 160)); if (!result) throw new PackagingNotFoundError(); return result; }

  async editVariant(id: string, input: { title?: unknown; thumbnailBrief?: unknown; description?: unknown; tags?: unknown; reason?: unknown }) {
    const variant = await this.repository.findVariant(text(id, 'id', 160)); if (!variant) throw new PackagingNotFoundError('Packaging variant not found');
    if (variant.status === 'PUBLISHED' || variant.status === 'ARCHIVED') throw new PackagingConflictError('Published or archived variants cannot be edited');
    const data: Prisma.PackagingVariantUncheckedUpdateInput = {}; const edits: Record<string, unknown> = {};
    if (input.title !== undefined) edits.title = data.title = text(input.title, 'title', 100);
    if (input.description !== undefined) edits.description = data.description = text(input.description, 'description', 2_000);
    if (input.tags !== undefined) edits.tags = data.tags = json(strings(input.tags, 'tags', 20));
    if (input.thumbnailBrief !== undefined) {
      if (!input.thumbnailBrief || typeof input.thumbnailBrief !== 'object' || Array.isArray(input.thumbnailBrief)) throw new PackagingValidationError('thumbnailBrief is invalid');
      edits.thumbnailBrief = input.thumbnailBrief; data.thumbnailBrief = json(input.thumbnailBrief);
    }
    if (!Object.keys(edits).length) throw new PackagingValidationError('editable fields are required');
    data.manualEdits = json({ ...(variant.manualEdits as Record<string, unknown>), ...edits, editedAt: this.clock().toISOString() });
    const updated = await this.repository.updateVariant(variant.id, data, optionalText(input.reason, 'reason', 500) ?? undefined);
    await this.recordContext(updated, variant.id, 'DECISION', 'Edicao manual de embalagem', `O criador editou manualmente a variante ${variant.key}; a edicao e uma decisao, nao um erro.`);
    return updated;
  }

  async selectVariant(id: string, reason?: unknown) {
    const variant = await this.repository.findVariant(text(id, 'id', 160)); if (!variant) throw new PackagingNotFoundError('Packaging variant not found');
    if (variant.status === 'REJECTED' || variant.status === 'ARCHIVED') throw new PackagingConflictError('Rejected or archived variants cannot be selected');
    const result = await this.repository.selectVariant(variant.id, optionalText(reason, 'reason', 500) ?? undefined); if (!result) throw new PackagingNotFoundError();
    await this.recordContext(result, variant.id, 'DECISION', 'Variante de embalagem selecionada', `A variante ${variant.key} foi selecionada pelo criador${reason ? `: ${String(reason).trim()}` : '.'}`);
    return result;
  }

  async rejectVariant(id: string, reason?: unknown) {
    const variant = await this.repository.findVariant(text(id, 'id', 160)); if (!variant) throw new PackagingNotFoundError('Packaging variant not found');
    if (variant.status === 'PUBLISHED') throw new PackagingConflictError('Published variants cannot be rejected');
    return this.repository.rejectVariant(variant.id, optionalText(reason, 'reason', 500) ?? undefined);
  }

  async publishVariant(id: string, input: { videoId: unknown; publishedAt?: unknown }) {
    const variant = await this.repository.findVariant(text(id, 'id', 160)); if (!variant) throw new PackagingNotFoundError('Packaging variant not found');
    const videoId = text(input.videoId, 'videoId', 160); const publishedAt = input.publishedAt == null ? this.clock() : new Date(text(input.publishedAt, 'publishedAt', 40));
    if (Number.isNaN(publishedAt.getTime())) throw new PackagingValidationError('publishedAt is invalid');
    const result = await this.repository.publishVariant(variant.id, videoId, publishedAt);
    await this.recordContext(result, variant.id, 'FACT', 'Embalagem publicada', `A variante ${variant.key} foi associada explicitamente ao video ${videoId}.`);
    return result;
  }

  async observeVariant(id: string) {
    const variant = await this.repository.findVariant(text(id, 'id', 160)); if (!variant) throw new PackagingNotFoundError('Packaging variant not found');
    if (!variant.publishedVideoId) throw new PackagingConflictError('Variant is not linked to a published video');
    const performance = (await this.performanceRepository.findAll({ projectId: variant.packaging.projectId, videoId: variant.publishedVideoId }))[0] ?? null;
    const reach = (await this.reachRepository.findAll({ projectId: variant.packaging.projectId, videoId: variant.publishedVideoId }))[0] ?? null;
    if (!performance && !reach) return { snapshot: null, created: false, missingData: ['performance', 'reach'] };
    const sourceId = `${performance?.id ?? 'none'}:${reach?.id ?? 'none'}`;
    const metrics = {
      views: performance?.views ?? null, watchTimeMinutes: performance?.watchTimeMinutes ?? null,
      averageViewDurationSeconds: performance?.averageViewDurationSeconds ?? null, averageViewPercentage: performance?.averageViewPercentage ?? null,
      retention: performance?.averageViewPercentage ?? null, impressions: reach?.impressions ?? performance?.impressions ?? null,
      ctr: reach?.ctr ?? performance?.ctr ?? null, subscribersGained: performance?.subscribersGained ?? null, likes: performance?.likes ?? null,
    };
    const result = await this.repository.saveMetric({ variantId: variant.id, performanceSnapshotId: performance?.id ?? null,
      ingestionKey: `packaging:${variant.id}:${sourceId}`, videoId: variant.publishedVideoId,
      periodStart: reach?.periodStart ?? performance?.periodStart ?? null, periodEnd: reach?.periodEnd ?? performance?.periodEnd ?? null,
      metrics: json(metrics), source: [performance?.source, reach?.source].filter(Boolean).join('+'), confidence: Math.min(performance?.confidence ?? 1, reach?.qualityAtCollection === 'GOOD' ? 1 : 0.65),
    });
    if (result.created) await this.recordContext(variant.packaging, variant.id, 'FACT', 'Resultado observado de embalagem', `A variante ${variant.key} apresentou metricas observadas no periodo disponivel; isto registra associacao, nao causalidade.`);
    return { ...result, missingData: Object.entries(metrics).filter(([, value]) => value == null).map(([key]) => key) };
  }

  async createExperiment(packagingId: string, input: { hypothesis: unknown; variantIds: unknown }) {
    const packaging = await this.get(packagingId); const variantIds = strings(input.variantIds, 'variantIds', 5);
    if (variantIds.length < 2 || variantIds.some((id) => !packaging.variants.some((variant) => variant.id === id))) throw new PackagingValidationError('variantIds are invalid');
    const hypothesis = text(input.hypothesis, 'hypothesis', 1_000);
    const context = await this.contextService.create({ projectId: packaging.projectId, channelId: 'UCV-OcBRDccTTUCDp6ZiK3dQ', type: 'EXPERIMENT', status: 'ACTIVE', category: 'PACKAGING', subject: 'Experimento de embalagem', statement: hypothesis, confidence: 0.35, source: 'packaging-intelligence', entityType: 'PACKAGING', entityId: packaging.id, game: packaging.game, series: packaging.series, format: packaging.format, metadata: { variantIds } });
    return this.repository.createExperiment({ packagingId: packaging.id, hypothesis, variantIds: json(variantIds), contextEntryId: context.id });
  }

  async recordLearning(packagingId: string) {
    const packaging = await this.get(packagingId);
    const observations = packaging.variants.flatMap((variant) => variant.metricSnapshots.map((snapshot) => ({ variant, snapshot,
      ctr: snapshot.metrics && typeof snapshot.metrics === 'object' && !Array.isArray(snapshot.metrics) ? Number((snapshot.metrics as Record<string, unknown>).ctr) : Number.NaN })))
      .filter(({ ctr }) => Number.isFinite(ctr));
    if (observations.length < 2) throw new PackagingConflictError('At least two observed CTR snapshots are required');
    const values = observations.map(({ ctr }) => ctr); const low = Math.min(...values); const high = Math.max(...values);
    const statement = `Em ${observations.length} observacoes de embalagem com CTR real, os valores variaram de ${low} a ${high}. A associacao observada nao demonstra causalidade.`;
    const entry = await this.contextService.create({ projectId: packaging.projectId, channelId: 'UCV-OcBRDccTTUCDp6ZiK3dQ', type: 'LEARNING', status: 'ACTIVE', category: 'PACKAGING',
      subject: `Aprendizado de ${packaging.series ?? packaging.game ?? 'embalagem'}`, statement, confidence: Math.min(0.75, 0.35 + observations.length * 0.1), source: 'packaging-intelligence',
      entityType: 'PACKAGING', entityId: packaging.id, game: packaging.game, series: packaging.series, format: packaging.format,
      metadata: { observationIds: observations.map(({ snapshot }) => snapshot.id), variantIds: [...new Set(observations.map(({ variant }) => variant.id))] } });
    await this.contextService.relate(entry.id, { relation: 'LEARNED_FROM', entityType: 'PACKAGING', entityId: packaging.id });
    return entry;
  }

  reviewVariant(id: string) { return this.repository.findVariant(text(id, 'id', 160)).then((variant) => { if (!variant) throw new PackagingNotFoundError('Packaging variant not found'); return reviewPackagingVariant({ title: variant.title, sourceEvent: variant.sourceEvent, thumbnailBrief: variant.thumbnailBrief, contextUsed: variant.contextUsed, clickbaitRisk: variant.clickbaitRisk }); }); }

  async getOperationalSummary(projectId?: string | null) {
    const rows = await this.list({ ...((projectId !== undefined) ? { projectId } : {}), limit: 100 });
    return { total: rows.length, selected: rows.filter(({ status }) => status === 'SELECTED').length, published: rows.filter(({ status }) => status === 'PUBLISHED').length,
      experiments: rows.reduce((sum, row) => sum + row.experiments.length, 0), needingReview: rows.filter((row) => row.variants.some(({ clickbaitRisk }) => clickbaitRisk !== 'LOW')).length };
  }

  private async recordContext(packaging: { id: string; projectId: string | null; game: string | null; series: string | null; format: string | null }, variantId: string, type: 'FACT' | 'DECISION', subject: string, statement: string) {
    const entry = await this.contextService.create({ projectId: packaging.projectId, channelId: 'UCV-OcBRDccTTUCDp6ZiK3dQ', type, status: 'ACTIVE', category: 'PACKAGING', subject, statement,
      confidence: type === 'FACT' ? 1 : 0.9, source: 'packaging-intelligence', entityType: 'PACKAGING_VARIANT', entityId: variantId, game: packaging.game, series: packaging.series, format: packaging.format });
    await this.contextService.relate(entry.id, { relation: 'BELONGS_TO', entityType: 'PACKAGING', entityId: packaging.id });
  }
}
