import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ProductionRepository, type ContentProductionDetails } from '../../database/repositories/ProductionRepository';
import { SupervisorModule } from '../../modules/dashboard/supervisor/SupervisorModule';
import { PackagingService } from '../packaging';
import { ChannelContextResolver } from '../channel-context';
import {
  PRODUCTION_ASSET_ROLES, PRODUCTION_FORMATS, PRODUCTION_PRIORITIES, PRODUCTION_STATUSES,
  productionWorkflowFor, resolveProductionNextAction,
  type ProductionAssetRole, type ProductionFormat, type ProductionPriority,
} from '../../domains/production';

export class ProductionError extends Error { constructor(message: string) { super(message); this.name = 'ProductionError'; } }
export class ProductionValidationError extends ProductionError { constructor(message: string) { super(message); this.name = 'ProductionValidationError'; } }
export class ProductionNotFoundError extends ProductionError { constructor(message = 'Production not found') { super(message); this.name = 'ProductionNotFoundError'; } }
export class ProductionConflictError extends ProductionError { constructor(message: string) { super(message); this.name = 'ProductionConflictError'; } }

export interface CreateProductionInput {
  productionKey?: unknown; projectId?: unknown; title?: unknown; format?: unknown; game?: unknown; series?: unknown; episode?: unknown;
  origin?: unknown; objective?: unknown; summary?: unknown; keyEvents?: unknown; owner?: unknown; priority?: unknown; plannedAt?: unknown;
  videoIdeaId?: unknown; plannedContentItemId?: unknown; seriesId?: unknown;
}

const id = (value: unknown, field: string): string => { if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw new ProductionValidationError(`${field} is invalid`); return value.trim(); };
const text = (value: unknown, field: string, max = 500): string => { if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) throw new ProductionValidationError(`${field} is invalid`); return value.trim(); };
const optionalText = (value: unknown, field: string, max = 500): string | null => value == null || value === '' ? null : text(value, field, max);
const stringArray = (value: unknown, field: string, max = 20): string[] => { if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 300)) throw new ProductionValidationError(`${field} is invalid`); return value.map((item) => item.trim()); };
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const slug = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
const parseDate = (value: unknown, field: string): Date | null => { if (value == null || value === '') return null; const date = new Date(text(value, field, 50)); if (Number.isNaN(date.getTime())) throw new ProductionValidationError(`${field} is invalid`); return date; };
const dependencies = (value: Prisma.JsonValue): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export class ProductionService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly repository = new ProductionRepository(DatabaseService.client),
    private readonly packaging = new PackagingService(),
    private readonly supervisor: Pick<SupervisorModule, 'reviewProduction'> = new SupervisorModule(),
    private readonly contextResolver: Pick<ChannelContextResolver, 'resolve'> = new ChannelContextResolver(),
    private readonly clock = () => new Date(),
  ) {}

  private async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void; const current = new Promise<void>((resolve) => { release = resolve; }); const queue = previous.then(() => current); this.locks.set(key, queue);
    await previous; try { return await work(); } finally { release(); if (this.locks.get(key) === queue) this.locks.delete(key); }
  }

  private view(production: ContentProductionDetails) { return { ...production, nextAction: resolveProductionNextAction(production.status, production.steps) }; }

  private async reconcile(productionId: string) {
    let production = await this.repository.findById(productionId); if (!production) throw new ProductionNotFoundError();
    const terminal = new Set(['COMPLETED', 'SKIPPED']);
    const available = production.steps.filter((step) => step.state === 'NOT_STARTED' && dependencies(step.dependencies).every((key) => terminal.has(production!.steps.find((item) => item.key === key)?.state ?? 'NOT_STARTED'))).map(({ key }) => key);
    await this.repository.setStepAvailable(productionId, available);
    production = await this.repository.findById(productionId); if (!production) throw new ProductionNotFoundError();
    if (!['CANCELLED', 'PUBLISHED', 'ANALYZED', 'COMPLETED'].includes(production.status)) {
      const requiredComplete = production.steps.filter(({ required }) => required).every(({ state }) => state === 'COMPLETED');
      const next = resolveProductionNextAction(production.status, production.steps);
      const status = requiredComplete ? 'READY_TO_PUBLISH' : next.stepKey === 'REVIEW' ? 'IN_REVIEW' : production.steps.some(({ state }) => state !== 'NOT_STARTED' && state !== 'AVAILABLE') ? 'IN_PRODUCTION' : 'PLANNED';
      const currentStage = requiredComplete ? 'READY_TO_PUBLISH' : next.stepKey ?? production.currentStage;
      if (status !== production.status || currentStage !== production.currentStage) production = await this.repository.updateProduction(productionId, { status, currentStage }) ?? production;
    }
    return this.view(production);
  }

  async create(raw: CreateProductionInput) {
    if (!raw || typeof raw !== 'object') throw new ProductionValidationError('payload is invalid');
    const plannedContentItemId = optionalText(raw.plannedContentItemId, 'plannedContentItemId', 160);
    if (plannedContentItemId) { const existing = await this.repository.findByPlannedItem(plannedContentItemId); if (existing) return { production: this.view(existing), created: false }; }
    const refs = await this.repository.references({ plannedContentItemId, videoIdeaId: optionalText(raw.videoIdeaId, 'videoIdeaId', 160), seriesId: optionalText(raw.seriesId, 'seriesId', 160) });
    if (plannedContentItemId && !refs.planned) throw new ProductionNotFoundError('Planned content item not found');
    if (raw.videoIdeaId && !refs.idea) throw new ProductionNotFoundError('Video idea not found');
    if (raw.seriesId && !refs.series) throw new ProductionNotFoundError('Series not found');
    const inferredFormat = refs.planned?.candidateType === 'SHORT' ? 'SHORT' : 'LONG_FORM';
    const format = String(raw.format ?? inferredFormat).toUpperCase() as ProductionFormat;
    if (!PRODUCTION_FORMATS.includes(format)) throw new ProductionValidationError('format is invalid');
    const title = raw.title == null && refs.planned ? refs.planned.title : text(raw.title, 'title', 200);
    const priority = String(raw.priority ?? refs.planned?.priority ?? 'MEDIUM').toUpperCase() as ProductionPriority;
    if (!PRODUCTION_PRIORITIES.includes(priority)) throw new ProductionValidationError('priority is invalid');
    const episode = raw.episode == null ? null : Number(raw.episode); if (episode != null && (!Number.isInteger(episode) || episode < 1 || episode > 10000)) throw new ProductionValidationError('episode is invalid');
    const projectId = optionalText(raw.projectId, 'projectId', 160);
    const productionKey = optionalText(raw.productionKey, 'productionKey', 200) ?? (plannedContentItemId ? `planning:${plannedContentItemId}` : `direct:${projectId ?? 'local'}:${slug(title)}:${format}:${episode ?? 0}`);
    const workflow = productionWorkflowFor(format);
    const result = await this.repository.create({ productionKey, projectId, title, format, game: optionalText(raw.game, 'game', 160), series: optionalText(raw.series, 'series', 160) ?? refs.series?.name ?? null,
      episode, origin: optionalText(raw.origin, 'origin', 80) ?? (plannedContentItemId ? 'PLANNER' : 'DIRECT'), objective: optionalText(raw.objective, 'objective', 500), summary: optionalText(raw.summary, 'summary', 2000),
      keyEvents: json(stringArray(raw.keyEvents ?? [], 'keyEvents', 10)), owner: optionalText(raw.owner, 'owner', 160), priority, plannedAt: parseDate(raw.plannedAt, 'plannedAt'),
      videoIdeaId: refs.idea?.id ?? null, plannedContentItemId: refs.planned?.id ?? null, seriesId: refs.series?.id ?? null, workflowTemplate: format,
      steps: { create: workflow.map((step, index) => ({ key: step.key, label: step.label, position: index + 1, mode: step.mode, capability: step.capability ?? null, required: step.required, skippable: step.skippable, dependencies: json(step.dependencies), state: index === 0 ? 'AVAILABLE' : 'NOT_STARTED' })) },
      events: { create: { event: 'PRODUCTION_CREATED', actor: 'user', origin: 'production-api', toState: 'PLANNED', data: { format, workflow: workflow.map(({ key }) => key) } } },
    });
    return { production: this.view(result.production), created: result.created };
  }

  async list(filters: { projectId?: string | null; status?: string; format?: string; limit?: number } = {}) {
    if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200)) throw new ProductionValidationError('limit is invalid');
    if (filters.status && !PRODUCTION_STATUSES.includes(filters.status as typeof PRODUCTION_STATUSES[number])) throw new ProductionValidationError('status is invalid');
    if (filters.format && !PRODUCTION_FORMATS.includes(filters.format as ProductionFormat)) throw new ProductionValidationError('format is invalid');
    return Promise.all((await this.repository.findAll(filters)).map(async (item) => this.reconcile(item.id)));
  }
  async get(idValue: unknown) { const production = await this.repository.findById(id(idValue, 'production id')); if (!production) throw new ProductionNotFoundError(); return this.view(production); }
  resume(idValue: unknown) { return this.reconcile(id(idValue, 'production id')); }
  async nextAction(idValue: unknown) { return (await this.resume(idValue)).nextAction; }

  async update(idValue: unknown, raw: Record<string, unknown>) {
    const productionId = id(idValue, 'production id'); const current = await this.get(productionId);
    const data: Prisma.ContentProductionUncheckedUpdateInput = {}; const significant: string[] = [];
    for (const field of ['title', 'game', 'series', 'objective', 'summary', 'owner'] as const) if (field in raw) { const value = field === 'title' ? text(raw[field], field, 200) : optionalText(raw[field], field, field === 'summary' ? 2000 : 500); (data as Record<string, unknown>)[field] = value; if (['game', 'series', 'summary', 'objective'].includes(field)) significant.push(field); }
    if ('keyEvents' in raw) { data.keyEvents = json(stringArray(raw.keyEvents, 'keyEvents', 10)); significant.push('keyEvents'); }
    if ('priority' in raw) { const priority = String(raw.priority).toUpperCase() as ProductionPriority; if (!PRODUCTION_PRIORITIES.includes(priority)) throw new ProductionValidationError('priority is invalid'); data.priority = priority; }
    if ('plannedAt' in raw) data.plannedAt = parseDate(raw.plannedAt, 'plannedAt');
    if (!Object.keys(data).length) throw new ProductionValidationError('editable fields are required');
    const invalidated = significant.length ? current.steps.filter(({ key, state }) => ['PACKAGING', 'REVIEW'].includes(key) && ['COMPLETED', 'WAITING_USER', 'IN_PROGRESS'].includes(state)).map(({ key }) => key) : [];
    if (significant.length) data.version = { increment: 1 };
    await this.repository.updateMetadata(productionId, data, invalidated, `Campos atualizados: ${Object.keys(data).join(', ')}`, this.clock());
    return this.reconcile(productionId);
  }

  private async transition(productionId: string, stepKey: string, state: string, event: string, allowedStates: string[], input: { reason?: unknown; actor?: unknown; origin?: unknown; operationKey?: unknown; output?: unknown; error?: unknown } = {}) {
    const reason = optionalText(input.reason, 'reason', 500); const actor = optionalText(input.actor, 'actor', 80) ?? 'user'; const origin = optionalText(input.origin, 'origin', 80) ?? 'production-api'; const operationKey = optionalText(input.operationKey, 'operationKey', 200);
    try { await this.repository.transitionStep({ productionId, stepKey, allowedStates, state, event, actor, origin, reason, executionKey: operationKey, output: input.output === undefined ? undefined : json(input.output), error: input.error == null ? null : text(input.error, 'error', 500), now: this.clock() }); }
    catch (error) { if (error instanceof Error && error.message === 'PRODUCTION_TRANSITION_CONFLICT') throw new ProductionConflictError('Step transition conflicts with the current state'); throw error; }
    return this.reconcile(productionId);
  }

  async startStep(productionIdValue: unknown, stepKeyValue: unknown, input: Record<string, unknown> = {}) { const productionId = id(productionIdValue, 'production id'); const stepKey = id(stepKeyValue, 'step key').toUpperCase(); const production = await this.get(productionId); if (!production.steps.some(({ key }) => key === stepKey)) throw new ProductionNotFoundError('Production step not found'); return this.locked(productionId, () => this.transition(productionId, stepKey, 'IN_PROGRESS', 'STEP_STARTED', ['AVAILABLE', 'FAILED', 'OUTDATED'], input)); }
  async completeStep(productionIdValue: unknown, stepKeyValue: unknown, input: Record<string, unknown> = {}) {
    const productionId = id(productionIdValue, 'production id'); const stepKey = id(stepKeyValue, 'step key').toUpperCase();
    return this.locked(productionId, async () => { const production = await this.get(productionId); const step = production.steps.find(({ key }) => key === stepKey); if (!step) throw new ProductionNotFoundError('Production step not found');
      if (stepKey === 'REVIEW') throw new ProductionConflictError('Use the Supervisor review action');
      if (stepKey === 'PACKAGING' && !production.packaging?.variants.some(({ status }) => status === 'SELECTED')) throw new ProductionConflictError('Select a Packaging variant before completing the step');
      return this.transition(productionId, stepKey, 'COMPLETED', 'STEP_COMPLETED', ['IN_PROGRESS', 'WAITING_USER'], { ...input, output: input.output ?? step.output ?? {} }); });
  }
  async skipStep(productionIdValue: unknown, stepKeyValue: unknown, input: Record<string, unknown> = {}) { const productionId = id(productionIdValue, 'production id'); const stepKey = id(stepKeyValue, 'step key').toUpperCase(); return this.locked(productionId, async () => { const production = await this.get(productionId); const step = production.steps.find(({ key }) => key === stepKey); if (!step) throw new ProductionNotFoundError('Production step not found'); if (!step.skippable) throw new ProductionConflictError('This step cannot be skipped'); return this.transition(productionId, stepKey, 'SKIPPED', 'STEP_SKIPPED', ['AVAILABLE', 'IN_PROGRESS', 'WAITING_USER'], input); }); }
  async retryStep(productionIdValue: unknown, stepKeyValue: unknown, input: Record<string, unknown> = {}) { const productionId = id(productionIdValue, 'production id'); const stepKey = id(stepKeyValue, 'step key').toUpperCase(); const production = await this.get(productionId); if (!production.steps.some(({ key }) => key === stepKey)) throw new ProductionNotFoundError('Production step not found'); return this.locked(productionId, () => this.transition(productionId, stepKey, 'AVAILABLE', 'STEP_RETRY_REQUESTED', ['FAILED'], input)); }
  async repeatStep(productionIdValue: unknown, stepKeyValue: unknown, input: Record<string, unknown> = {}) { const productionId = id(productionIdValue, 'production id'); const stepKey = id(stepKeyValue, 'step key').toUpperCase(); return this.locked(productionId, async () => { const production = await this.get(productionId); const selected = production.steps.find(({ key }) => key === stepKey); if (!selected) throw new ProductionNotFoundError('Production step not found'); const downstream = production.steps.filter((step) => step.position > selected.position && ['COMPLETED', 'WAITING_USER', 'IN_PROGRESS'].includes(step.state)); if (downstream.length) await this.repository.updateMetadata(productionId, {}, downstream.map(({ key }) => key), `Repeticao de ${stepKey}`, this.clock()); return this.transition(productionId, stepKey, 'AVAILABLE', 'STEP_REPEAT_REQUESTED', ['COMPLETED', 'SKIPPED', 'OUTDATED'], input); }); }

  async runPackaging(productionIdValue: unknown) { const productionId = id(productionIdValue, 'production id'); return this.locked(productionId, async () => { let production = await this.resume(productionId); const step = production.steps.find(({ key }) => key === 'PACKAGING'); if (!step) throw new ProductionNotFoundError('Packaging step not found');
    if (production.packaging && ['WAITING_USER', 'COMPLETED'].includes(step.state)) return { production, packaging: production.packaging, created: false };
    if (!['AVAILABLE', 'FAILED', 'OUTDATED'].includes(step.state)) throw new ProductionConflictError('Packaging is not available');
    if (!production.summary || !Array.isArray(production.keyEvents) || !production.keyEvents.length) throw new ProductionConflictError('Packaging requires summary and at least one real event');
    await this.transition(productionId, 'PACKAGING', 'IN_PROGRESS', 'STEP_STARTED', ['AVAILABLE', 'FAILED', 'OUTDATED'], { origin: 'production-packaging', operationKey: `production:${productionId}:packaging:start:${step.attempts + 1}` });
    const resolved = await this.contextResolver.resolve({ projectId: production.projectId, text: `${production.game ?? ''} ${production.series ?? ''} packaging producao`, limit: 8, maxCharacters: 4000 });
    let created;
    try { created = await this.packaging.generate({ projectId: production.projectId, contentKey: `production:${productionId}:packaging:v${step.attempts + 1}`, game: production.game, series: production.series, episode: production.episode, format: production.format, summary: production.summary, keyEvents: production.keyEvents as string[], editorialObjective: production.objective, constraints: resolved.entries.slice(0, 5).map(({ subject }) => subject), variationCount: 3 }); }
    catch (error) { await this.transition(productionId, 'PACKAGING', 'FAILED', 'STEP_FAILED', ['IN_PROGRESS'], { origin: 'production-packaging', error: error instanceof Error ? error.name : 'PackagingError' }); throw new ProductionConflictError('Packaging generation failed safely'); }
    await this.repository.updateProduction(productionId, { packagingId: created.id }, { event: 'PACKAGING_LINKED', actor: 'system', origin: 'production-packaging', data: { packagingId: created.id } });
    production = await this.transition(productionId, 'PACKAGING', 'WAITING_USER', 'PACKAGING_GENERATED', ['IN_PROGRESS'], { origin: 'production-packaging', output: { packagingId: created.id, variantIds: created.variants.map(({ id }) => id) } });
    return { production, packaging: created, created: true }; }); }

  async linkPackaging(productionIdValue: unknown, packagingIdValue: unknown) { const productionId = id(productionIdValue, 'production id'); const packagingId = id(packagingIdValue, 'packaging id'); const refs = await this.repository.references({ packagingId }); if (!refs.packaging) throw new ProductionNotFoundError('Packaging not found'); await this.get(productionId); await this.repository.updateProduction(productionId, { packagingId }, { event: 'PACKAGING_LINKED', actor: 'user', origin: 'production-api', data: { packagingId } }); const current = await this.get(productionId); const step = current.steps.find(({ key }) => key === 'PACKAGING'); if (step && ['AVAILABLE', 'IN_PROGRESS', 'OUTDATED'].includes(step.state)) await this.transition(productionId, 'PACKAGING', 'WAITING_USER', 'PACKAGING_LINKED', [step.state], { output: { packagingId } }); return this.resume(productionId); }

  async review(productionIdValue: unknown) { const productionId = id(productionIdValue, 'production id'); return this.locked(productionId, async () => { let production = await this.resume(productionId); const step = production.steps.find(({ key }) => key === 'REVIEW'); if (!step) throw new ProductionNotFoundError('Review step not found'); if (step.state === 'AVAILABLE') production = await this.transition(productionId, 'REVIEW', 'IN_PROGRESS', 'STEP_STARTED', ['AVAILABLE'], { origin: 'supervisor' });
    const selected = production.packaging?.variants.find(({ status }) => status === 'SELECTED'); const packagingReview = selected ? await this.packaging.reviewVariant(selected.id) : null;
    const priorRequiredComplete = production.steps.filter(({ required, key }) => required && key !== 'REVIEW').every(({ state }) => state === 'COMPLETED');
    const result = this.supervisor.reviewProduction({ requiredStepsComplete: priorRequiredComplete, packagingSelected: Boolean(selected), packagingReview });
    if (result.outcome === 'APPROVED' || result.outcome === 'APPROVED_WITH_WARNINGS') return this.transition(productionId, 'REVIEW', 'COMPLETED', 'SUPERVISOR_REVIEWED', ['IN_PROGRESS', 'WAITING_USER'], { origin: 'supervisor', output: result });
    return this.transition(productionId, 'REVIEW', 'WAITING_USER', 'SUPERVISOR_REVIEWED', ['IN_PROGRESS', 'WAITING_USER'], { origin: 'supervisor', output: result }); }); }

  async linkAsset(productionIdValue: unknown, libraryItemIdValue: unknown, roleValue: unknown) { const productionId = id(productionIdValue, 'production id'); const libraryItemId = id(libraryItemIdValue, 'library item id'); const role = String(roleValue).toUpperCase() as ProductionAssetRole; if (!PRODUCTION_ASSET_ROLES.includes(role)) throw new ProductionValidationError('asset role is invalid'); const refs = await this.repository.references({ libraryItemId }); if (!refs.library) throw new ProductionNotFoundError('Library item not found'); await this.get(productionId); return this.view((await this.repository.linkAsset(productionId, libraryItemId, role))!); }
  async unlinkAsset(productionIdValue: unknown, relationIdValue: unknown) { const productionId = id(productionIdValue, 'production id'); await this.get(productionId); return this.view((await this.repository.unlinkAsset(productionId, id(relationIdValue, 'asset relation id')))!); }
  async publish(productionIdValue: unknown, input: { videoId?: unknown; url?: unknown; publishedAt?: unknown }) { const productionId = id(productionIdValue, 'production id'); const current = await this.get(productionId); if (!['READY_TO_PUBLISH', 'PUBLISHED'].includes(current.status)) throw new ProductionConflictError('Production is not ready to publish'); const videoId = text(input.videoId, 'videoId', 160); if (current.status === 'PUBLISHED' && current.publishedVideoId === videoId) return current; const url = optionalText(input.url, 'url', 500); if (url && !/^https?:\/\//i.test(url)) throw new ProductionValidationError('url is invalid'); const publishedAt = parseDate(input.publishedAt, 'publishedAt') ?? this.clock(); return this.view((await this.repository.updateProduction(productionId, { publishedVideoId: videoId, publishedUrl: url, publishedAt, status: 'PUBLISHED', currentStage: 'PUBLISHED' }, { event: 'PUBLICATION_LINKED', actor: 'user', origin: 'production-api', data: { videoId, url, publishedAt: publishedAt.toISOString() } }))!); }
  async cancel(productionIdValue: unknown, reasonValue: unknown) { const productionId = id(productionIdValue, 'production id'); const current = await this.get(productionId); if (['PUBLISHED', 'COMPLETED'].includes(current.status)) throw new ProductionConflictError('Published or completed production cannot be cancelled'); return this.view((await this.repository.updateProduction(productionId, { status: 'CANCELLED', currentStage: 'CANCELLED', steps: { updateMany: { where: { state: { notIn: ['COMPLETED', 'SKIPPED'] } }, data: { state: 'CANCELLED' } } } }, { event: 'PRODUCTION_CANCELLED', actor: 'user', origin: 'production-api', reason: text(reasonValue, 'reason', 500) }))!); }
  async getOperationalSummary(projectId?: string | null) { const rows = await this.repository.findAll({ ...(projectId === undefined ? {} : { projectId }), limit: 100 }); return { total: rows.length, active: rows.filter(({ status }) => ['PLANNED', 'IN_PRODUCTION', 'IN_REVIEW'].includes(status)).length, ready: rows.filter(({ status }) => status === 'READY_TO_PUBLISH').length, blocked: rows.filter((row) => row.steps.some(({ state }) => state === 'BLOCKED' || state === 'FAILED')).length, latest: rows[0] ? this.view(rows[0]) : null }; }
}
