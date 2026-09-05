import { Prisma, type EditorialDecision, type ResearchOpportunity } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import {
  ContentPlanRepository,
  type ContentPlanWithItems,
} from '../../database/repositories/ContentPlanRepository';
import { PlannedContentItemRepository } from '../../database/repositories/PlannedContentItemRepository';
import { PlanningHistoryRepository } from '../../database/repositories/PlanningHistoryRepository';
import {
  PlanningExecutionRepository,
  PlanningExecutionTransitionConflict,
} from '../../database/repositories/PlanningExecutionRepository';
import {
  CONTENT_PLAN_STATUSES,
  EXECUTION_READINESS,
  PLANNING_EFFORTS,
  PLANNING_HORIZONS,
  PLANNING_PRIORITIES,
  StrategicPlanningRanker,
  createExecutionGuidance,
  PLANNING_EXECUTION_STATES,
  type ContentPlanStatus,
  type PlanningCandidate,
  type PlanningConstraint,
  type PlanningDependency,
  type PlanningEffort,
  type PlanningEvidence,
  type PlanningHorizon,
  type PlanningPriority,
  type PlanningRisk,
  type PlanningExecutionState,
} from '../../domains/strategic-planning';
import { EditorialDecisionService } from '../creator-intelligence/EditorialDecisionService';
import { ResearchService } from '../research';

export class StrategicPlanningError extends Error {
  constructor(message: string) { super(message); this.name = 'StrategicPlanningError'; }
}
export class StrategicPlanningValidationError extends StrategicPlanningError {
  constructor(message: string) { super(message); this.name = 'StrategicPlanningValidationError'; }
}
export class ContentPlanNotFoundError extends StrategicPlanningError {
  constructor() { super('Content plan not found'); this.name = 'ContentPlanNotFoundError'; }
}
export class PlannedContentItemNotFoundError extends StrategicPlanningError {
  constructor() { super('Planned content item not found'); this.name = 'PlannedContentItemNotFoundError'; }
}
export class PlanningExecutionConflictError extends StrategicPlanningError {
  constructor() { super('Planning execution transition conflicts with the current state'); this.name = 'PlanningExecutionConflictError'; }
}

interface PlanningDecisionReader {
  list(input: { projectId?: string | null; limit?: number }): Promise<EditorialDecision[]>;
}
interface PlanningResearchReader {
  listOpportunities(filters?: { projectId?: string | null; limit?: number }): Promise<Array<ResearchOpportunity & { researchHistory: { projectId: string | null; researchedAt: Date } }>>;
  research(input: { query: string; intent: 'GAME_DISCOVERY' | 'IDEA_RESEARCH'; projectId?: string | null; subjectType?: 'GAME' | 'IDEA'; subject?: string }): Promise<{ historyId: string }>;
}

export interface GenerateContentPlanInput {
  projectId?: string | null;
  horizon?: PlanningHorizon;
  constraints?: readonly PlanningConstraint[];
}
export interface CreateManualPlanningItemInput {
  planId: string;
  title: string;
  candidateType?: string;
  priority?: PlanningPriority;
  effort?: PlanningEffort;
  constraints?: readonly PlanningConstraint[];
  reason: string;
}
export interface UpdatePlanningItemInput {
  status?: ContentPlanStatus;
  priority?: PlanningPriority;
  effort?: PlanningEffort;
  reason: string;
}
export interface TransitionPlanningExecutionInput {
  state: PlanningExecutionState;
  reason?: string;
  note?: string;
}

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const jsonArray = <T>(value: Prisma.JsonValue | null): T[] => Array.isArray(value) ? value as T[] : [];
const objectValue = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const normalizeId = (value: string, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw new StrategicPlanningValidationError(`${field} is invalid`);
  return value.trim();
};
const normalizeText = (value: string, field: string, max = 500): string => {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) throw new StrategicPlanningValidationError(`${field} is invalid`);
  return value.trim();
};
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
const normalizedKey = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const planningEvidence = (decision: EditorialDecision): PlanningEvidence[] => jsonArray<Record<string, unknown>>(decision.evidence)
  .flatMap((item) => typeof item.summary === 'string' ? [{
    classification: ['fact', 'inference', 'recommendation'].includes(String(item.classification))
      ? item.classification as PlanningEvidence['classification'] : 'inference',
    source: typeof item.source === 'string' ? item.source : `decision:${decision.id}`,
    summary: item.summary,
    confidence: typeof item.confidence === 'number' ? item.confidence : decision.confidence,
  }] : []);
const planningRisks = (decision: EditorialDecision): PlanningRisk[] => jsonArray<unknown>(decision.risks).flatMap((entry, index) => {
  if (typeof entry === 'string') return [{ code: `DECISION_RISK_${index + 1}`, severity: 'MEDIUM' as const, summary: entry }];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
  const value = entry as Record<string, unknown>;
  if (typeof value.summary !== 'string') return [];
  return [{ code: typeof value.code === 'string' ? value.code : `DECISION_RISK_${index + 1}`,
    severity: ['LOW', 'MEDIUM', 'HIGH'].includes(String(value.severity)) ? value.severity as PlanningRisk['severity'] : 'MEDIUM', summary: value.summary }];
});
const planningConstraints = (decision: EditorialDecision): PlanningConstraint[] => jsonArray<unknown>(decision.constraints).flatMap((entry, index) => {
  if (typeof entry === 'string') return [{ code: `DECISION_CONSTRAINT_${index + 1}`, summary: entry, blocking: false }];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
  const value = entry as Record<string, unknown>;
  if (typeof value.summary !== 'string') return [];
  return [{ code: typeof value.code === 'string' ? value.code : `DECISION_CONSTRAINT_${index + 1}`,
    summary: value.summary, blocking: value.blocking === true }];
});
const component = (score: Record<string, unknown>, id: string): Record<string, unknown> | null => {
  const components = Array.isArray(score.components) ? score.components : [];
  return components.find((item) => item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).id === id) as Record<string, unknown> | undefined ?? null;
};
const directionFrom = (value: unknown, rising: string, declining: string, stable: string): string | undefined =>
  typeof value !== 'number' ? undefined : value >= 60 ? rising : value <= 40 ? declining : stable;
const effortFrom = (constraints: readonly PlanningConstraint[]): PlanningEffort => {
  const joined = constraints.map(({ code, summary }) => `${code} ${summary}`).join(' ').toUpperCase();
  if (/HIGH[_ ]EFFORT|ALTO ESFORCO/.test(joined)) return 'HIGH';
  if (/LOW[_ ]EFFORT|BAIXO ESFORCO/.test(joined)) return 'LOW';
  if (/MEDIUM[_ ]EFFORT|MEDIO ESFORCO/.test(joined)) return 'MEDIUM';
  return 'UNKNOWN';
};

export class StrategicPlanningService {
  private readonly executionLocks = new Map<string, Promise<unknown>>();
  private lastExecutionAt = 0;

  constructor(
    private readonly plans = new ContentPlanRepository(DatabaseService.client),
    private readonly items = new PlannedContentItemRepository(DatabaseService.client),
    private readonly history = new PlanningHistoryRepository(DatabaseService.client),
    private readonly decisions: PlanningDecisionReader = new EditorialDecisionService(),
    private readonly research: PlanningResearchReader = new ResearchService(),
    private readonly ranker = new StrategicPlanningRanker(),
    private readonly clock = () => new Date(),
    private readonly execution = new PlanningExecutionRepository(DatabaseService.client),
  ) {}

  private async candidates(projectId: string | null, explicitConstraints: readonly PlanningConstraint[]): Promise<PlanningCandidate[]> {
    const [decisions, opportunities] = await Promise.all([
      this.decisions.list({ projectId, limit: 50 }).catch(() => []),
      this.research.listOpportunities({ projectId, limit: 50 }).catch(() => []),
    ]);
    const opportunityByKey = new Map(opportunities.map((item) => [item.key, item]));
    const seen = new Set<string>();
    const candidates: PlanningCandidate[] = [];
    for (const decision of decisions) {
      const key = decision.candidateKey?.trim() || `decision:${decision.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const score = objectValue(decision.opportunityScore);
      const trendFactor = component(score, 'TREND');
      const seriesFactor = component(score, 'SERIES_HEALTH');
      const seriesId = typeof seriesFactor?.source === 'string' && seriesFactor.source.startsWith('series:')
        ? seriesFactor.source.slice('series:'.length).trim() || undefined : undefined;
      const opportunity = opportunityByKey.get(key);
      const constraints = [...planningConstraints(decision), ...explicitConstraints.map((item) => ({ ...item }))];
      const missingData = unique([
        ...jsonArray<string>(decision.missingData),
        ...opportunity ? jsonArray<string>(opportunity.gaps) : [],
      ]);
      const dependencies: PlanningDependency[] = [
        { type: 'EDITORIAL_DECISION', referenceId: decision.id, status: 'READY', summary: 'Decisao editorial persistida.' },
        ...(opportunity ? [{ type: 'RESEARCH' as const, referenceId: opportunity.researchHistoryId, status: 'READY' as const, summary: 'Pesquisa persistida disponivel.' }] : []),
      ];
      const evidence = [
        ...planningEvidence(decision),
        ...opportunity ? jsonArray<Record<string, unknown>>(opportunity.evidence).flatMap((item): PlanningEvidence[] => typeof item.summary === 'string' ? [{
          classification: item.classification === 'fact' ? 'fact' : 'inference', source: typeof item.sourceId === 'string' ? item.sourceId : `research:${opportunity.id}`,
          summary: item.summary, confidence: typeof item.confidence === 'number' ? item.confidence : opportunity.confidence, freshness: opportunity.freshness,
        }] : []) : [],
      ];
      candidates.push({
        key, title: decision.recommendation, candidateType: decision.candidateType ?? 'TOPIC',
        sourceDecisionId: decision.id, sourceResearchOpportunityId: opportunity?.id,
        seriesId,
        decisionCategory: decision.category,
        opportunityScore: typeof decision.score === 'number' ? decision.score : typeof score.value === 'number' ? score.value : null,
        confidence: decision.confidence, researchState: opportunity?.state, freshness: opportunity?.freshness
          ?? (Array.isArray(score.components) && score.components.some((item) => objectValue(item as Prisma.JsonValue).quality === 'STALE') ? 'STALE' : 'MISSING'),
        trend: directionFrom(trendFactor?.value, 'RISING', 'DECLINING', 'STABLE'),
        seriesHealth: directionFrom(seriesFactor?.value, 'STRONG', 'DECLINING', 'HEALTHY'),
        daysSinceLastEpisode: null, effort: effortFrom(constraints),
        repetitionKey: `${decision.candidateType ?? 'TOPIC'}:${key}`,
        evidence, risks: [...planningRisks(decision), ...opportunity ? jsonArray<string>(opportunity.risks).map((summary, index) => ({ code: `RESEARCH_RISK_${index + 1}`, severity: 'MEDIUM' as const, summary })) : []],
        constraints, missingData, dependencies,
      });
    }
    for (const opportunity of opportunities) {
      if (seen.has(opportunity.key)) continue;
      const constraints = explicitConstraints.map((item) => ({ ...item }));
      candidates.push({
        key: opportunity.key, title: opportunity.subject, candidateType: opportunity.subjectType,
        sourceResearchOpportunityId: opportunity.id, researchState: opportunity.state,
        opportunityScore: null, confidence: opportunity.confidence, freshness: opportunity.freshness,
        effort: 'UNKNOWN', repetitionKey: `${opportunity.subjectType}:${normalizedKey(opportunity.subject)}`,
        evidence: jsonArray<Record<string, unknown>>(opportunity.evidence).flatMap((item): PlanningEvidence[] => typeof item.summary === 'string' ? [{
          classification: item.classification === 'fact' ? 'fact' : 'inference', source: typeof item.sourceId === 'string' ? item.sourceId : `research:${opportunity.id}`,
          summary: item.summary, confidence: typeof item.confidence === 'number' ? item.confidence : opportunity.confidence, freshness: opportunity.freshness,
        }] : []),
        risks: jsonArray<string>(opportunity.risks).map((summary, index) => ({ code: `RESEARCH_RISK_${index + 1}`, severity: 'MEDIUM', summary })),
        constraints,
        missingData: unique([...jsonArray<string>(opportunity.gaps), 'editorial decision']),
        dependencies: [
          { type: 'RESEARCH', referenceId: opportunity.researchHistoryId, status: 'READY', summary: 'Pesquisa persistida disponivel.' },
          { type: 'EDITORIAL_DECISION', status: 'PENDING', summary: 'O Decision Engine ainda deve avaliar esta oportunidade.' },
        ],
      });
    }
    return candidates;
  }

  async generate(input: GenerateContentPlanInput = {}): Promise<ContentPlanWithItems> {
    const projectId = input.projectId?.trim() || null;
    const horizon = input.horizon ?? 'NEXT_7_DAYS';
    if (!PLANNING_HORIZONS.includes(horizon)) throw new StrategicPlanningValidationError('invalid planning horizon');
    const constraints = (input.constraints ?? []).map((item) => ({
      code: normalizeText(item.code, 'constraint code', 80), summary: normalizeText(item.summary, 'constraint summary'), blocking: item.blocking === true,
    }));
    if (constraints.length > 20) throw new StrategicPlanningValidationError('at most 20 planning constraints are allowed');
    const candidates = await this.candidates(projectId, constraints);
    const ranked = this.ranker.rank(candidates, horizon);
    const generatedAt = this.clock();
    return this.plans.create({
      projectId, horizon, status: ranked.status,
      summary: ranked.candidates.length
        ? `${ranked.candidates.length} itens organizados para ${horizon}; ${ranked.candidates.filter(({ queue }) => queue === 'NEXT').length} proximo item.`
        : `Nenhum candidato editorial disponivel para ${horizon}.`,
      balance: asJson(ranked.balance), constraints: asJson(constraints), risks: asJson(ranked.risks),
      source: asJson({ decisionIds: candidates.flatMap(({ sourceDecisionId }) => sourceDecisionId ? [sourceDecisionId] : []),
        researchOpportunityIds: candidates.flatMap(({ sourceResearchOpportunityId }) => sourceResearchOpportunityId ? [sourceResearchOpportunityId] : []) }),
      generatedAt,
      items: ranked.candidates.map((candidate) => {
        const guidance = createExecutionGuidance(candidate);
        return ({
        sourceDecisionId: candidate.sourceDecisionId ?? null,
        sourceResearchOpportunityId: candidate.sourceResearchOpportunityId ?? null,
        researchHistoryId: null, seriesId: candidate.seriesId ?? null,
        candidateKey: candidate.key, candidateType: candidate.candidateType, title: candidate.title,
        rationale: candidate.rationale, status: candidate.readiness === 'READY' ? 'READY' : candidate.readiness,
        priority: candidate.priority, effort: candidate.effort, readiness: candidate.readiness,
        queue: candidate.queue, position: candidate.rank, executionScore: candidate.executionScore,
        manualPriority: false, evidence: asJson(candidate.evidence), risks: asJson(candidate.risks),
        constraints: asJson(candidate.constraints), missingData: asJson(candidate.missingData), dependencies: asJson(candidate.dependencies),
        executionState: guidance.state, executionAction: guidance.action,
        executionConfidence: guidance.confidence, executionContext: asJson(guidance.context),
      }); }),
    });
  }

  async getCurrent(filters: { projectId?: string | null; horizon?: PlanningHorizon } = {}): Promise<ContentPlanWithItems | null> {
    if (filters.horizon && !PLANNING_HORIZONS.includes(filters.horizon)) throw new StrategicPlanningValidationError('invalid planning horizon');
    return this.plans.findCurrent({ ...filters, ...('projectId' in filters ? { projectId: filters.projectId?.trim() || null } : {}) });
  }

  async getOrGenerateCurrent(input: GenerateContentPlanInput = {}): Promise<{ plan: ContentPlanWithItems; generated: boolean }> {
    const current = await this.getCurrent({ ...('projectId' in input ? { projectId: input.projectId } : {}), ...(input.horizon ? { horizon: input.horizon } : {}) });
    return current ? { plan: current, generated: false } : { plan: await this.generate(input), generated: true };
  }

  async getById(id: string): Promise<ContentPlanWithItems> {
    const plan = await this.plans.findById(normalizeId(id, 'plan id'));
    if (!plan) throw new ContentPlanNotFoundError();
    return plan;
  }

  async createItem(input: CreateManualPlanningItemInput) {
    const plan = await this.getById(input.planId);
    const title = normalizeText(input.title, 'title', 240);
    const priority = input.priority ?? 'MEDIUM'; const effort = input.effort ?? 'UNKNOWN';
    if (!PLANNING_PRIORITIES.includes(priority)) throw new StrategicPlanningValidationError('invalid priority');
    if (!PLANNING_EFFORTS.includes(effort)) throw new StrategicPlanningValidationError('invalid effort');
    const constraints = (input.constraints ?? []).map((item) => ({ ...item, code: normalizeText(item.code, 'constraint code', 80), summary: normalizeText(item.summary, 'constraint summary') }));
    if (constraints.length > 20) throw new StrategicPlanningValidationError('at most 20 planning constraints are allowed');
    const readiness = constraints.some(({ blocking }) => blocking) ? 'BLOCKED' : 'READY';
    const item = await this.items.create({
      planId: plan.id, candidateKey: `manual:${normalizedKey(title)}:${plan.items.length + 1}`,
      candidateType: input.candidateType?.trim().toUpperCase() || 'TOPIC', title,
      rationale: 'Item adicionado manualmente; prioridade nao deriva de previsao de performance.',
      status: readiness, priority, effort, readiness, queue: readiness === 'BLOCKED' ? 'BLOCKED' : plan.items.some(({ queue }) => queue === 'NEXT') ? 'LATER' : 'NEXT',
      position: plan.items.length + 1, executionScore: 0, manualPriority: true,
      evidence: asJson([]), risks: asJson([]), constraints: asJson(constraints), missingData: asJson([]), dependencies: asJson([]),
      executionState: 'pending',
      executionAction: readiness === 'BLOCKED' ? `Resolver os bloqueios antes de produzir: ${title}.` : `Preparar e iniciar a producao de: ${title}.`,
      executionConfidence: null, executionContext: asJson({ manual: true, readiness, priority }),
    }, normalizeText(input.reason, 'reason', 500));
    await this.refreshPlanStatus(plan.id);
    return item;
  }

  async addVideoIdea(input: {
    ideaId: string;
    projectId?: string | null;
    title: string;
    rationale: string;
    effort: PlanningEffort;
    priority?: PlanningPriority;
    sourceResearchOpportunityId?: string | null;
    researchHistoryId?: string | null;
    evidence?: unknown[];
    risks?: unknown[];
    missingData?: string[];
  }) {
    const ideaId = normalizeId(input.ideaId, 'idea id');
    const candidateKey = `idea:${ideaId}`;
    const existing = await this.items.findByCandidateKey(candidateKey);
    if (existing) return { item: existing, created: false };
    const title = normalizeText(input.title, 'title', 240);
    const effort = input.effort;
    const priority = input.priority ?? 'MEDIUM';
    if (!PLANNING_EFFORTS.includes(effort)) throw new StrategicPlanningValidationError('invalid effort');
    if (!PLANNING_PRIORITIES.includes(priority)) throw new StrategicPlanningValidationError('invalid priority');
    const { plan } = await this.getOrGenerateCurrent({ projectId: input.projectId ?? null, horizon: 'NEXT_7_DAYS' });
    try {
      const item = await this.items.create({
        planId: plan.id,
        sourceResearchOpportunityId: input.sourceResearchOpportunityId ?? null,
        researchHistoryId: input.researchHistoryId ?? null,
        candidateKey, candidateType: 'IDEA', title,
        rationale: normalizeText(input.rationale, 'rationale', 1_000),
        status: 'READY', priority, effort, readiness: 'READY',
        queue: plan.items.some(({ queue }) => queue === 'NEXT') ? 'LATER' : 'NEXT',
        position: plan.items.length + 1, executionScore: 0, manualPriority: true,
        evidence: asJson(input.evidence ?? []), risks: asJson(input.risks ?? []), constraints: asJson([]),
        missingData: asJson(input.missingData ?? []),
        dependencies: asJson(input.researchHistoryId ? [{ type: 'RESEARCH', referenceId: input.researchHistoryId, status: 'READY', summary: 'Pesquisa de origem persistida.' }] : []),
        executionState: 'pending', executionAction: `Preparar a execução da ideia: ${title}.`, executionConfidence: null,
        executionContext: asJson({ source: 'video-idea', ideaId }),
      }, 'Ideia selecionada explicitamente e enviada ao planejamento.');
      await this.refreshPlanStatus(plan.id);
      return { item, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.items.findByCandidateKey(candidateKey);
        if (raced) return { item: raced, created: false };
      }
      throw error;
    }
  }

  async updateItem(id: string, input: UpdatePlanningItemInput) {
    const item = await this.items.findById(normalizeId(id, 'item id'));
    if (!item) throw new PlannedContentItemNotFoundError();
    const reason = normalizeText(input.reason, 'reason', 500);
    const data: Prisma.PlannedContentItemUpdateInput = {};
    const executionState = input.status === 'IN_PROGRESS' ? 'in_progress'
      : input.status === 'COMPLETED' ? 'completed'
        : input.status === 'CANCELLED' ? 'skipped'
          : input.status === 'PAUSED' ? 'paused'
            : input.status === 'READY' ? 'pending' : null;
    if (input.status !== undefined && executionState === null) {
      if (!CONTENT_PLAN_STATUSES.includes(input.status)) throw new StrategicPlanningValidationError('invalid status');
      data.status = input.status;
      if (input.status === 'BLOCKED') { data.readiness = 'BLOCKED'; data.queue = 'BLOCKED'; }
      if (input.status === 'NEEDS_RESEARCH') { data.readiness = 'NEEDS_RESEARCH'; data.queue = 'WAITING'; }
      if (input.status === 'DRAFT') data.queue = 'WAITING';
    }
    if (input.priority !== undefined) {
      if (!PLANNING_PRIORITIES.includes(input.priority)) throw new StrategicPlanningValidationError('invalid priority');
      data.priority = input.priority; data.manualPriority = true;
    }
    if (input.effort !== undefined) {
      if (!PLANNING_EFFORTS.includes(input.effort)) throw new StrategicPlanningValidationError('invalid effort');
      data.effort = input.effort;
    }
    if (Object.keys(data).length) await this.items.updateWithHistory(item.id, data, 'ITEM_UPDATED', reason);
    if (executionState) return (await this.transitionExecution(item.id, { state: executionState, reason })).item;
    if (!Object.keys(data).length) throw new StrategicPlanningValidationError('at least one item field is required');
    await this.refreshPlanStatus(item.planId);
    return (await this.items.findById(item.id))!;
  }

  async completeItem(id: string, reason = 'Conteudo marcado como concluido.') {
    return (await this.transitionExecution(id, { state: 'completed', reason })).item;
  }

  async reorder(planId: string, orderedIds: readonly string[], reason: string) {
    const plan = await this.getById(planId);
    if (orderedIds.length !== plan.items.length || new Set(orderedIds).size !== orderedIds.length
      || orderedIds.some((id) => !plan.items.some((item) => item.id === id))) {
      throw new StrategicPlanningValidationError('reorder must contain every plan item exactly once');
    }
    let nextAssigned = false;
    const runningId = plan.items.find(({ executionState }) => executionState === 'in_progress')?.id ?? null;
    const ordered = orderedIds.map((id) => {
      const item = plan.items.find((candidate) => candidate.id === id)!;
      const queue = ['completed', 'skipped'].includes(item.executionState) || ['COMPLETED', 'CANCELLED'].includes(item.status) ? 'DONE'
        : item.executionState === 'paused' || item.status === 'PAUSED' ? 'WAITING'
        : item.readiness === 'BLOCKED' ? 'BLOCKED'
          : item.readiness === 'NEEDS_RESEARCH' ? 'WAITING'
            : item.id === runningId ? (nextAssigned = true, 'NEXT')
              : !runningId && !nextAssigned ? (nextAssigned = true, 'NEXT') : 'LATER';
      return { id, queue };
    });
    return this.items.reorder(plan.id, ordered, normalizeText(reason, 'reason', 500));
  }

  async requestResearch(id: string) {
    const item = await this.items.findById(normalizeId(id, 'item id'));
    if (!item) throw new PlannedContentItemNotFoundError();
    if (item.readiness !== 'NEEDS_RESEARCH') throw new StrategicPlanningValidationError('item does not require research');
    const result = await this.research.research({
      query: `Investigue evidencias para o item editorial: ${item.title}`,
      intent: item.candidateType === 'GAME' ? 'GAME_DISCOVERY' : 'IDEA_RESEARCH',
      projectId: item.plan.projectId,
      subjectType: item.candidateType === 'GAME' ? 'GAME' : 'IDEA',
      subject: item.title,
    });
    const dependencies = jsonArray<PlanningDependency>(item.dependencies).map((dependency) =>
      dependency.type === 'RESEARCH' ? { ...dependency, referenceId: result.historyId, status: 'READY' as const } : dependency);
    if (!dependencies.some(({ type }) => type === 'RESEARCH')) dependencies.push({ type: 'RESEARCH', referenceId: result.historyId, status: 'READY', summary: 'Pesquisa controlada concluida.' });
    return this.items.updateWithHistory(item.id, {
      researchHistory: { connect: { id: result.historyId } }, dependencies: asJson(dependencies),
    }, 'RESEARCH_REQUESTED', 'Pesquisa controlada solicitada para resolver dados faltantes.');
  }

  async listHistory(filters: { planId?: string; itemId?: string; limit?: number } = {}) {
    if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200)) throw new StrategicPlanningValidationError('invalid history limit');
    return this.history.findAll({ ...filters, ...(filters.planId ? { planId: normalizeId(filters.planId, 'plan id') } : {}), ...(filters.itemId ? { itemId: normalizeId(filters.itemId, 'item id') } : {}) });
  }

  async getCurrentGuidance(filters: { projectId?: string | null; horizon?: PlanningHorizon } = {}) {
    const plan = await this.getCurrent(filters);
    return plan ? this.guidanceFromPlan(plan) : null;
  }

  async transitionExecution(id: string, input: TransitionPlanningExecutionInput) {
    const itemId = normalizeId(id, 'item id');
    if (!PLANNING_EXECUTION_STATES.includes(input.state)) throw new StrategicPlanningValidationError('invalid execution state');
    const reason = input.reason === undefined ? null : normalizeText(input.reason, 'reason', 500);
    const note = input.note === undefined ? null : normalizeText(input.note, 'note', 500);
    return this.withExecutionLock(itemId, async () => {
      const item = await this.items.findById(itemId);
      if (!item) throw new PlannedContentItemNotFoundError();
      const action = note ?? item.executionAction;
      const event = input.state === 'in_progress' ? 'EXECUTION_STARTED'
        : input.state === 'completed' ? 'EXECUTION_COMPLETED'
          : input.state === 'skipped' ? 'EXECUTION_SKIPPED'
            : input.state === 'paused' ? 'EXECUTION_PAUSED' : 'EXECUTION_RESET_PENDING';
      const strategicContext = asJson({
        planId: item.planId, itemId: item.id, title: item.title, rationale: item.rationale,
        priority: item.priority, manualPriority: item.manualPriority, position: item.position,
        queue: item.queue, readiness: item.readiness, effort: item.effort,
        executionScore: item.executionScore, executionAction: item.executionAction,
        executionConfidence: item.executionConfidence, executionContext: objectValue(item.executionContext),
        evidence: jsonArray(item.evidence), risks: jsonArray(item.risks), constraints: jsonArray(item.constraints),
        missingData: jsonArray(item.missingData), dependencies: jsonArray(item.dependencies),
        sourceDecisionId: item.sourceDecisionId, sourceResearchOpportunityId: item.sourceResearchOpportunityId,
      });
      try {
        const occurredAt = this.nextExecutionTime();
        const transition = await this.execution.transition({
          itemId, state: input.state, event, action, reason,
          confidence: item.executionConfidence, strategicContext, occurredAt,
        });
        await this.refreshPlanStatus(item.planId);
        const plan = await this.getById(item.planId);
        return { ...transition, plan, currentGuidance: this.guidanceFromPlan(plan) };
      } catch (error) {
        if (error instanceof PlanningExecutionTransitionConflict
          || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw new PlanningExecutionConflictError();
        }
        throw error;
      }
    });
  }

  async listExecutionHistory(filters: { planId?: string; itemId?: string; limit?: number } = {}) {
    if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200)) {
      throw new StrategicPlanningValidationError('invalid execution history limit');
    }
    return this.execution.findAll({
      ...(filters.planId ? { planId: normalizeId(filters.planId, 'plan id') } : {}),
      ...(filters.itemId ? { itemId: normalizeId(filters.itemId, 'item id') } : {}),
      ...(filters.limit ? { limit: filters.limit } : {}),
    });
  }

  async getOperationalSummary(projectId?: string | null) {
    const plan = await this.getCurrent(projectId === undefined ? {} : { projectId });
    if (!plan) return { planId: null, status: 'MISSING', horizon: null, total: 0, ready: 0, needsResearch: 0, blocked: 0, lowConfidence: 0, experiments: 0, stale: 0, conflicts: 0, inProgress: 0, paused: 0, completed: 0, skipped: 0, nextAction: null, executionConfidence: null, alerts: [] as string[] };
    const guidance = this.guidanceFromPlan(plan);
    const summary = {
      planId: plan.id, status: plan.status, horizon: plan.horizon, total: plan.items.length,
      ready: plan.items.filter(({ readiness }) => readiness === 'READY').length,
      needsResearch: plan.items.filter(({ readiness }) => readiness === 'NEEDS_RESEARCH').length,
      blocked: plan.items.filter(({ readiness }) => readiness === 'BLOCKED').length,
      lowConfidence: plan.items.filter(({ evidence }) => jsonArray<PlanningEvidence>(evidence).every(({ confidence }) => confidence < 0.5)).length,
      experiments: plan.items.filter(({ priority }) => priority === 'EXPERIMENTAL').length,
      stale: plan.items.filter(({ evidence }) => jsonArray<PlanningEvidence>(evidence).some(({ freshness }) => freshness === 'STALE')).length,
      conflicts: plan.items.filter(({ risks }) => jsonArray<PlanningRisk>(risks).some(({ code }) => /CONFLICT/i.test(code))).length,
      inProgress: plan.items.filter(({ executionState }) => executionState === 'in_progress').length,
      paused: plan.items.filter(({ executionState }) => executionState === 'paused').length,
      completed: plan.items.filter(({ executionState }) => executionState === 'completed').length,
      skipped: plan.items.filter(({ executionState }) => executionState === 'skipped').length,
      nextAction: guidance?.action ?? null,
      executionConfidence: guidance?.confidence ?? null,
    };
    return {
      ...summary,
      alerts: [
        ...(summary.lowConfidence > 0 ? [`${summary.lowConfidence} item(ns) com baixa confianca.`] : []),
        ...(summary.experiments > Math.ceil(summary.total / 3) ? [`${summary.experiments} testes excedem o balanceamento recomendado.`] : []),
        ...(summary.stale > 0 ? [`${summary.stale} item(ns) usam dados stale.`] : []),
        ...(summary.blocked > 0 ? [`${summary.blocked} item(ns) bloqueado(s).`] : []),
        ...(summary.conflicts > 0 ? [`${summary.conflicts} conflito(s) de evidencia.`] : []),
      ],
    };
  }

  private guidanceFromPlan(plan: ContentPlanWithItems) {
    const ordered = [...plan.items].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const item = ordered.find(({ executionState }) => executionState === 'in_progress')
      ?? ordered.find(({ queue, executionState }) => queue === 'NEXT' && !['completed', 'skipped'].includes(executionState))
      ?? ordered.find(({ queue, executionState }) => ['WAITING', 'BLOCKED'].includes(queue) && !['completed', 'skipped'].includes(executionState));
    if (!item) return null;
    return {
      planId: plan.id, horizon: plan.horizon, planStatus: plan.status,
      itemId: item.id, title: item.title, state: item.executionState, queue: item.queue,
      action: item.executionAction, reason: item.rationale, priority: item.priority,
      readiness: item.readiness, effort: item.effort, confidence: item.executionConfidence,
      evidence: jsonArray(item.evidence).slice(0, 5), risks: jsonArray(item.risks).slice(0, 5),
      missingData: jsonArray(item.missingData).slice(0, 10),
      degraded: jsonArray<Record<string, unknown>>(item.evidence).some(({ freshness }) => freshness === 'STALE')
        || jsonArray(item.missingData).length > 0,
    };
  }

  private withExecutionLock<T>(itemId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.executionLocks.get(itemId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.executionLocks.set(itemId, current);
    return current.finally(() => { if (this.executionLocks.get(itemId) === current) this.executionLocks.delete(itemId); });
  }

  private nextExecutionTime(): Date {
    const current = this.clock().getTime();
    this.lastExecutionAt = Math.max(current, this.lastExecutionAt + 1);
    return new Date(this.lastExecutionAt);
  }

  private async refreshPlanStatus(planId: string): Promise<void> {
    const plan = await this.getById(planId);
    const active = plan.items.filter(({ status }) => !['COMPLETED', 'CANCELLED'].includes(status));
    const next: ContentPlanStatus = plan.items.length > 0 && active.length === 0 ? 'COMPLETED'
      : active.some(({ status }) => status === 'IN_PROGRESS') ? 'IN_PROGRESS'
        : active.some(({ readiness }) => readiness === 'READY') ? 'READY'
          : active.some(({ readiness }) => readiness === 'NEEDS_RESEARCH') ? 'NEEDS_RESEARCH'
            : active.length ? 'BLOCKED' : 'DRAFT';
    if (next === plan.status) return;
    await this.plans.updateStatus(plan.id, next);
    await this.history.create({ planId: plan.id, event: 'STATUS_CHANGED', reason: 'Status derivado do estado atual dos itens.', before: asJson({ status: plan.status }), after: asJson({ status: next }) });
  }
}
