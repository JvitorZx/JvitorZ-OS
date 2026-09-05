import { Prisma, type VideoIdea } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ContentPatternRepository } from '../../database/repositories/ContentPatternRepository';
import { ResearchHistoryRepository } from '../../database/repositories/ResearchHistoryRepository';
import { ResearchOpportunityRepository } from '../../database/repositories/ResearchOpportunityRepository';
import { VideoIdeaRepository } from '../../database/repositories/VideoIdeaRepository';
import {
  PRODUCTION_EFFORTS, VIDEO_IDEA_STATUSES, buildIdeaFromOpportunity, ideaIdentityKey, ideaSimilarity,
  type ProductionEffort, type VideoIdeaStatus,
} from '../../domains/research';
import { ChannelContextService } from '../channel-context';
import { StrategicPlanningService } from '../strategic-planning';
import { ResearchConflictError, ResearchNotFoundError, ResearchService, ResearchValidationError } from './ResearchService';

export class ResearchIdeaNotFoundError extends ResearchNotFoundError {
  constructor() { super('Video idea not found'); this.name = 'ResearchIdeaNotFoundError'; }
}

export class ResearchIdeaConflictError extends ResearchConflictError {
  constructor(message: string) { super(message); this.name = 'ResearchIdeaConflictError'; }
}

const text = (value: unknown, field: string, max = 500): string => {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) throw new ResearchValidationError(`${field} is invalid`);
  return value.trim();
};
const optionalText = (value: unknown, field: string, max = 500): string | null => value == null || value === '' ? null : text(value, field, max);
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const jsonArray = <T>(value: Prisma.JsonValue): T[] => Array.isArray(value) ? value as T[] : [];
const isUnique = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export class ResearchIdeationService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly research = new ResearchService(),
    private readonly sessions = new ResearchHistoryRepository(DatabaseService.client),
    private readonly opportunities = new ResearchOpportunityRepository(DatabaseService.client),
    private readonly ideas = new VideoIdeaRepository(DatabaseService.client),
    private readonly patterns = new ContentPatternRepository(DatabaseService.client),
    private readonly planning = new StrategicPlanningService(),
    private readonly memory: Pick<ChannelContextService, 'create'> = new ChannelContextService(),
    private readonly clock = () => new Date(),
  ) {}

  private async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void; const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = prior.then(() => current); this.locks.set(key, queued); await prior;
    try { return await work(); } finally { release(); if (this.locks.get(key) === queued) this.locks.delete(key); }
  }

  createSession(input: Parameters<ResearchService['createSession']>[0]) { return this.research.createSession(input); }
  runSession(id: string) { return this.research.runSession(id); }
  rerunSession(id: string) { return this.research.rerunSession(id); }
  archiveSession(id: string) { return this.research.archiveSession(id); }
  getSession(id: string) { return this.research.getSession(id); }
  listSessions(filters: Parameters<ResearchService['listSessions']>[0]) { return this.research.listSessions(filters); }

  async listGameCandidates(sessionId: string) {
    const session = await this.research.getSession(sessionId);
    return session.opportunities.filter(({ subjectType }) => subjectType === 'GAME');
  }

  async getContentResearch(sessionId: string) {
    const session = await this.research.getSession(sessionId);
    const patterns = await this.patterns.findAll({ projectId: session.projectId });
    return {
      sessionId: session.id,
      patterns: patterns.filter((item) => !session.game || item.game === session.game).slice(0, 30),
      gaps: session.contentGaps,
      repetition: session.opportunities.filter(({ saturation }) => saturation !== null && saturation >= 0.4).map(({ id, subject, saturation }) => ({ id, subject, saturation, classification: 'observation' })),
      limitations: jsonArray<string>(session.limitations),
      disclaimer: 'Padrões e lacunas são observações internas; não demonstram demanda externa nem causalidade.',
    };
  }

  async generateIdeas(sessionIdValue: string, input: {
    objective: unknown; format: unknown; effort?: unknown; game?: unknown; series?: unknown; limit?: unknown;
  }) {
    const sessionId = text(sessionIdValue, 'research session id', 160);
    const session = await this.research.getSession(sessionId);
    if (session.status !== 'COMPLETED') throw new ResearchIdeaConflictError('Research session must be completed before ideas are generated');
    const objective = text(input.objective, 'objective', 500);
    const format = text(input.format, 'format', 80).toUpperCase();
    const effort = String(input.effort ?? 'UNKNOWN').toUpperCase() as ProductionEffort;
    if (!PRODUCTION_EFFORTS.includes(effort)) throw new ResearchValidationError('effort is invalid');
    const game = optionalText(input.game, 'game', 160) ?? session.game;
    const series = optionalText(input.series, 'series', 160);
    const limit = input.limit === undefined ? 5 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new ResearchValidationError('limit must be an integer from 1 to 10');
    if (!session.opportunities.length) throw new ResearchIdeaConflictError('Research session has no evidence-backed opportunities');
    return this.locked(`ideas:${sessionId}`, async () => {
      const recent = await this.ideas.findAllFiltered({ projectId: session.projectId, limit: 50 });
      const selected = session.opportunities.filter((opportunity) => !game || opportunity.subject === game || opportunity.subjectType !== 'GAME').slice(0, limit);
      const generated: Array<{ idea: VideoIdea; created: boolean; duplicateWarning: string | null }> = [];
      for (const opportunity of selected) {
        const draft = buildIdeaFromOpportunity({
          key: opportunity.key, rank: opportunity.rank, subject: opportunity.subject, subjectType: opportunity.subjectType as never,
          state: opportunity.state as never, summary: opportunity.summary, sources: jsonArray(opportunity.sources),
          evidence: jsonArray(opportunity.evidence), freshness: opportunity.freshness as never, compatibility: opportunity.compatibility,
          confidence: opportunity.confidence, risks: jsonArray(opportunity.risks), gaps: jsonArray(opportunity.gaps), nextInvestigation: opportunity.nextInvestigation,
        }, { objective, format, effort, game, series });
        const key = ideaIdentityKey(draft);
        const existing = await this.ideas.findByKey(key);
        if (existing) { generated.push({ idea: existing, created: false, duplicateWarning: 'Ideia idêntica já persistida.' }); continue; }
        const similar = recent.map((candidate) => ({ candidate, similarity: ideaSimilarity(draft, candidate) }))
          .filter(({ similarity }) => similarity >= 0.7).sort((a, b) => b.similarity - a.similarity || a.candidate.id.localeCompare(b.candidate.id))[0];
        try {
          const idea = await this.ideas.create({
            projectId: session.projectId, ...draft, scoreDetails: json(draft.scoreDetails), risks: json(draft.risks), assumptions: json(draft.assumptions),
            sourceResearchHistoryId: session.id, sourceOpportunityId: opportunity.id, ideaKey: key,
            duplicateOfId: similar?.candidate.id ?? null, status: 'CANDIDATE', isExperiment: false,
          });
          await this.sessions.addEvent(session.id, 'IDEA_GENERATED', this.clock(), json({ ideaId: idea.id, opportunityId: opportunity.id, duplicateOfId: idea.duplicateOfId }));
          recent.push(idea); generated.push({ idea, created: true, duplicateWarning: similar ? `Possível repetição (${Math.round(similar.similarity * 100)}% de similaridade interna).` : null });
        } catch (error) {
          if (!isUnique(error)) throw error;
          const raced = await this.ideas.findByKey(key); if (!raced) throw error;
          generated.push({ idea: raced, created: false, duplicateWarning: 'Ideia idêntica já persistida.' });
        }
      }
      return { sessionId, ideas: generated, limitations: jsonArray<string>(session.limitations) };
    });
  }

  async listIdeas(filters: { projectId?: string | null; status?: string; researchHistoryId?: string; limit?: number } = {}) {
    const limit = filters.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ResearchValidationError('limit must be an integer from 1 to 100');
    if (filters.status && !VIDEO_IDEA_STATUSES.includes(filters.status as VideoIdeaStatus)) throw new ResearchValidationError('idea status is invalid');
    return this.ideas.findAllFiltered({ ...filters, limit });
  }

  async getIdea(idValue: string): Promise<VideoIdea> {
    const idea = await this.ideas.findById(text(idValue, 'idea id', 160));
    if (!idea) throw new ResearchIdeaNotFoundError();
    return idea;
  }

  async editIdea(idValue: string, input: { premise?: unknown; coreEvent?: unknown; viewerPromise?: unknown; whyNow?: unknown; effort?: unknown; reason?: unknown }) {
    const idea = await this.getIdea(idValue);
    if (['PLANNED', 'PRODUCED', 'ARCHIVED'].includes(idea.status)) throw new ResearchIdeaConflictError('Idea can no longer be edited in its current state');
    const data: Prisma.VideoIdeaUpdateInput = {};
    if (input.premise !== undefined) data.premise = text(input.premise, 'premise', 1_000);
    if (input.coreEvent !== undefined) data.coreEvent = optionalText(input.coreEvent, 'coreEvent', 500);
    if (input.viewerPromise !== undefined) data.viewerPromise = optionalText(input.viewerPromise, 'viewerPromise', 500);
    if (input.whyNow !== undefined) data.whyNow = optionalText(input.whyNow, 'whyNow', 1_000);
    if (input.effort !== undefined) { const effort = String(input.effort).toUpperCase() as ProductionEffort; if (!PRODUCTION_EFFORTS.includes(effort)) throw new ResearchValidationError('effort is invalid'); data.effortLevel = effort; }
    if (!Object.keys(data).length) throw new ResearchValidationError('at least one editable field is required');
    data.ideaKey = ideaIdentityKey({
      game: idea.game,
      series: idea.series,
      format: idea.format,
      premise: typeof data.premise === 'string' ? data.premise : idea.premise,
      coreEvent: typeof data.coreEvent === 'string' || data.coreEvent === null ? data.coreEvent : idea.coreEvent,
    });
    let updated: VideoIdea;
    try { updated = await this.ideas.update(idea.id, data); }
    catch (error) {
      if (isUnique(error)) throw new ResearchIdeaConflictError('An identical idea already exists');
      throw error;
    }
    if (idea.sourceResearchHistoryId) await this.sessions.addEvent(idea.sourceResearchHistoryId, 'IDEA_EDITED', this.clock(), json({ ideaId: idea.id, fields: Object.keys(data) }), optionalText(input.reason, 'reason', 500));
    return updated;
  }

  async transitionIdea(idValue: string, statusValue: unknown, reasonValue?: unknown) {
    const idea = await this.getIdea(idValue);
    const status = String(statusValue).toUpperCase() as VideoIdeaStatus;
    if (!VIDEO_IDEA_STATUSES.includes(status)) throw new ResearchValidationError('idea status is invalid');
    const allowed: Record<string, VideoIdeaStatus[]> = {
      DRAFT: ['CANDIDATE', 'ARCHIVED'], CANDIDATE: ['SHORTLISTED', 'REJECTED', 'ARCHIVED'],
      SHORTLISTED: ['SELECTED', 'REJECTED', 'ARCHIVED'], SELECTED: ['PLANNED', 'REJECTED', 'ARCHIVED'],
      REJECTED: ['CANDIDATE', 'ARCHIVED'], PLANNED: ['PRODUCED', 'ARCHIVED'], PRODUCED: ['ARCHIVED'], ARCHIVED: [],
    };
    const reason = optionalText(reasonValue, 'reason', 500);
    if (status === 'REJECTED' && !reason) throw new ResearchValidationError('rejection reason is required');
    const lockKey = status === 'SELECTED' && idea.sourceResearchHistoryId
      ? `selection:${idea.sourceResearchHistoryId}`
      : `idea:${idea.id}`;
    return this.locked(lockKey, async () => {
      const current = await this.getIdea(idea.id);
      if (current.status === status) return current;
      if (!allowed[current.status]?.includes(status)) throw new ResearchIdeaConflictError(`Idea cannot transition from ${current.status} to ${status}`);
      if (status === 'SELECTED' && current.sourceResearchHistoryId) {
        const peers = await this.ideas.findAllFiltered({ researchHistoryId: current.sourceResearchHistoryId, limit: 100 });
        if (peers.some((peer) => peer.id !== current.id && peer.status === 'SELECTED')) throw new ResearchIdeaConflictError('Another idea is already selected for this research session');
      }
      const updated = await this.ideas.update(current.id, {
        status, selectedAt: status === 'SELECTED' ? this.clock() : current.selectedAt,
        rejectedAt: status === 'REJECTED' ? this.clock() : status === 'CANDIDATE' ? null : current.rejectedAt,
        archivedAt: status === 'ARCHIVED' ? this.clock() : current.archivedAt,
        rejectionReason: status === 'REJECTED' ? reason : status === 'CANDIDATE' ? null : current.rejectionReason,
      });
      if (current.sourceResearchHistoryId) await this.sessions.addEvent(current.sourceResearchHistoryId, `IDEA_${status}`, this.clock(), json({ ideaId: current.id }), reason);
      if (status === 'SELECTED') await this.memory.create({
        projectId: current.projectId, type: 'DECISION', category: 'research_selection', subject: current.theme,
        statement: `Ideia selecionada para avaliação no planejamento: ${current.premise}`,
        confidence: 1, source: 'research-ideation', sourceReference: current.id,
        entityType: 'VideoIdea', entityId: current.id, game: current.game, series: current.series, format: current.format,
        metadata: { researchHistoryId: current.sourceResearchHistoryId, status },
      }).catch(() => undefined);
      return updated;
    });
  }

  async markExperiment(id: string, input: { enabled: unknown; hypothesis?: unknown }) {
    const idea = await this.getIdea(id);
    if (typeof input.enabled !== 'boolean') throw new ResearchValidationError('enabled must be boolean');
    const hypothesis = input.hypothesis === undefined ? idea.hypothesis : optionalText(input.hypothesis, 'hypothesis', 1_000);
    const updated = await this.ideas.update(idea.id, { isExperiment: input.enabled, hypothesis });
    if (idea.sourceResearchHistoryId) await this.sessions.addEvent(idea.sourceResearchHistoryId, 'IDEA_EXPERIMENT_UPDATED', this.clock(), json({ ideaId: idea.id, enabled: input.enabled }));
    return updated;
  }

  async sendToPlanner(idValue: string) {
    const idea = await this.getIdea(idValue);
    if (!['SHORTLISTED', 'SELECTED', 'PLANNED'].includes(idea.status)) throw new ResearchIdeaConflictError('Idea must be shortlisted or selected before Planner handoff');
    return this.locked(`handoff:${idea.id}`, async () => {
      const result = await this.planning.addVideoIdea({
        ideaId: idea.id, projectId: idea.projectId, title: idea.workingTitle ?? idea.premise,
        rationale: idea.whyNow ?? 'Ideia selecionada explicitamente a partir de pesquisa persistida.',
        effort: idea.effortLevel as never, priority: idea.isExperiment ? 'EXPERIMENTAL' : 'MEDIUM',
        sourceResearchOpportunityId: idea.sourceOpportunityId, researchHistoryId: idea.sourceResearchHistoryId,
        evidence: idea.scoreDetails ? [idea.scoreDetails] : [], risks: jsonArray(idea.risks),
        missingData: idea.scoreDetails && typeof idea.scoreDetails === 'object' && !Array.isArray(idea.scoreDetails)
          ? jsonArray<string>((idea.scoreDetails as Record<string, Prisma.JsonValue>).missingData ?? []) : [],
      });
      if (idea.status !== 'PLANNED') await this.ideas.update(idea.id, { status: 'PLANNED' });
      if (idea.sourceResearchHistoryId) await this.sessions.addEvent(idea.sourceResearchHistoryId, 'PLANNER_HANDOFF', this.clock(), json({ ideaId: idea.id, plannedContentItemId: result.item.id, created: result.created }));
      return result;
    });
  }
}
