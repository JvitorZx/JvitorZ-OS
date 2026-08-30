import { DatabaseService } from '../../database/DatabaseService';
import { AudienceSnapshotRepository } from '../../database/repositories/AudienceSnapshotRepository';
import { ContentPatternRepository } from '../../database/repositories/ContentPatternRepository';
import { SeriesDefinitionRepository } from '../../database/repositories/SeriesDefinitionRepository';
import { TrendSignalRepository } from '../../database/repositories/TrendSignalRepository';
import { VideoIdeaRepository } from '../../database/repositories/VideoIdeaRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import type {
  ResearchCandidate,
  ResearchEvidence,
  ResearchIntent,
  ResearchProvider,
  ResearchProviderResult,
  ResearchQuery,
  ResearchSubjectType,
} from '../../domains/research';
import { freshnessFor, normalizeSearchText } from './ResearchNormalization';

interface InternalResearchRepositories {
  snapshots: Pick<VideoPerformanceSnapshotRepository, 'findAll'>;
  trends: Pick<TrendSignalRepository, 'findAll'>;
  series: Pick<SeriesDefinitionRepository, 'findAll'>;
  patterns: Pick<ContentPatternRepository, 'findAll'>;
  ideas: Pick<VideoIdeaRepository, 'findAll'>;
  audience: Pick<AudienceSnapshotRepository, 'findAll'>;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const subjectType = (value: string): ResearchSubjectType => {
  const normalized = value.toUpperCase();
  return ['GAME', 'SERIES', 'FORMAT', 'TOPIC', 'IDEA', 'CHANNEL'].includes(normalized)
    ? normalized as ResearchSubjectType : 'TOPIC';
};
const relevanceFor = (query: ResearchQuery, ...values: Array<string | null | undefined>): number => {
  const terms = query.normalized.split(' ').filter((term) => term.length >= 3);
  if (terms.length === 0) return 0.5;
  const haystack = normalizeSearchText(values.filter(Boolean).join(' '));
  const matches = terms.filter((term) => haystack.includes(term)).length;
  return clamp(0.35 + (matches / terms.length) * 0.65);
};
const candidateKey = (type: ResearchSubjectType, label: string): string =>
  `${type.toLowerCase()}:${normalizeSearchText(label).replace(/\s+/g, '-')}`;

export class InternalResearchProvider implements ResearchProvider {
  readonly id = 'internal-channel-intelligence';
  readonly sourceKind = 'INTERNAL' as const;
  private repositories?: InternalResearchRepositories;

  constructor(repositories?: InternalResearchRepositories, private readonly clock = () => new Date()) {
    this.repositories = repositories;
  }

  supports(_intent: ResearchIntent): boolean { return true; }

  private get data(): InternalResearchRepositories {
    if (!this.repositories) {
      const client = DatabaseService.client;
      this.repositories = {
        snapshots: new VideoPerformanceSnapshotRepository(client),
        trends: new TrendSignalRepository(client),
        series: new SeriesDefinitionRepository(client),
        patterns: new ContentPatternRepository(client),
        ideas: new VideoIdeaRepository(client),
        audience: new AudienceSnapshotRepository(client),
      };
    }
    return this.repositories;
  }

  async search(query: ResearchQuery): Promise<ResearchProviderResult> {
    const now = this.clock();
    const projectFilter = { projectId: query.projectId };
    const [snapshots, trends, series, patterns, ideas, audience] = await Promise.all([
      this.data.snapshots.findAll(projectFilter),
      this.data.trends.findAll(projectFilter),
      this.data.series.findAll(query.projectId),
      this.data.patterns.findAll(projectFilter),
      this.data.ideas.findAll(query.projectId),
      this.data.audience.findAll(projectFilter),
    ]);
    const evidence: ResearchEvidence[] = [];
    const candidates = new Map<string, ResearchCandidate>();
    const add = (input: {
      entityId: string; label: string; type: ResearchSubjectType; summary: string;
      confidence: number; observedAt: Date | null; classification?: ResearchEvidence['classification'];
      context?: ResearchEvidence['context'];
    }) => {
      const key = candidateKey(input.type, input.label);
      const id = `${this.id}:${input.entityId}`;
      const relevance = relevanceFor(query, input.label, input.summary);
      const item: ResearchEvidence = {
        id, sourceId: this.id, classification: input.classification ?? 'fact', summary: input.summary,
        relevance, confidence: clamp(input.confidence), observedAt: input.observedAt?.toISOString() ?? null,
        freshness: freshnessFor(input.observedAt, now), context: input.context ?? {},
      };
      evidence.push(item);
      const existing = candidates.get(key);
      if (existing) {
        existing.evidenceIds.push(id);
        existing.relevance = Math.max(existing.relevance, relevance);
        existing.confidence = Math.max(existing.confidence, item.confidence);
        existing.context = { ...existing.context, ...item.context };
      } else {
        candidates.set(key, {
          key, label: input.label, type: input.type, summary: input.summary, relevance,
          confidence: item.confidence, sourceIds: [this.id], evidenceIds: [id], context: { ...item.context },
        });
      }
    };

    for (const trend of trends.slice(0, 30)) add({
      entityId: `trend:${trend.id}`, label: trend.subject, type: subjectType(trend.subjectType),
      summary: `${trend.subject} apresenta sinal interno ${trend.classification} em ${trend.metric}.`,
      confidence: trend.confidence, observedAt: trend.detectedAt, classification: 'inference',
      context: { signal: trend.classification, explored: true, sampleSize: trend.sampleSize },
    });
    for (const pattern of patterns.slice(0, 30)) add({
      entityId: `pattern:${pattern.id}`, label: pattern.subject, type: subjectType(pattern.patternType),
      summary: pattern.summary, confidence: pattern.confidence, observedAt: pattern.detectedAt,
      classification: 'inference', context: { signal: pattern.classification, explored: true, sampleSize: pattern.sampleSize },
    });
    for (const item of series.slice(0, 20)) add({
      entityId: `series:${item.id}`, label: item.name, type: 'SERIES',
      summary: `Série existente com ${item.videoLinks.length} conteúdo(s) associado(s).`,
      confidence: Math.min(1, item.videoLinks.length / 5), observedAt: item.updatedAt,
      context: { explored: true, sampleSize: item.videoLinks.length },
    });
    for (const idea of ideas.slice(0, 30)) add({
      entityId: `idea:${idea.id}`, label: idea.game || idea.theme, type: idea.game ? 'GAME' : 'IDEA',
      summary: `Ideia existente: ${idea.theme} no formato ${idea.format}.`, confidence: idea.identityFit === null ? 0.5 : idea.identityFit / 100,
      observedAt: idea.updatedAt, context: { explored: false, format: idea.format },
    });
    const seenSnapshotSubjects = new Set<string>();
    for (const snapshot of snapshots.slice(0, 60)) {
      for (const [label, type] of [[snapshot.game, 'GAME'], [snapshot.format, 'FORMAT']] as const) {
        if (!label) continue;
        const key = `${type}:${normalizeSearchText(label)}`;
        if (seenSnapshotSubjects.has(key)) continue;
        seenSnapshotSubjects.add(key);
        add({ entityId: `snapshot:${type}:${snapshot.id}`, label, type,
          summary: `${label} aparece no histórico persistido do canal.`, confidence: snapshot.confidence,
          observedAt: snapshot.collectedAt, context: { explored: true, views: snapshot.views, format: snapshot.format } });
      }
    }
    for (const row of audience.filter(({ dimension }) => dimension === 'traffic_source').slice(0, 10)) add({
      entityId: `audience:${row.id}`, label: row.segment, type: 'TOPIC',
      summary: `Fonte de tráfego observada: ${row.segment}, com ${row.views ?? 0} views no período.`,
      confidence: row.qualityAtCollection === 'GOOD' ? 0.85 : 0.55, observedAt: row.collectedAt,
      context: { signal: 'AUDIENCE_SOURCE', explored: false, sampleSize: row.views ?? 0 },
    });

    const orderedEvidence = evidence.sort((left, right) => right.relevance - left.relevance
      || right.confidence - left.confidence || left.id.localeCompare(right.id)).slice(0, 80);
    const selectedEvidence = new Set(orderedEvidence.map(({ id }) => id));
    const orderedCandidates = [...candidates.values()]
      .map((candidate) => ({ ...candidate, evidenceIds: candidate.evidenceIds.filter((id) => selectedEvidence.has(id)) }))
      .filter(({ evidenceIds }) => evidenceIds.length > 0)
      .sort((left, right) => right.relevance - left.relevance || right.confidence - left.confidence || left.key.localeCompare(right.key))
      .slice(0, 30);
    const latest = [
      ...snapshots.map(({ collectedAt }) => collectedAt), ...trends.map(({ detectedAt }) => detectedAt),
      ...patterns.map(({ detectedAt }) => detectedAt), ...audience.map(({ collectedAt }) => collectedAt),
    ].sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const freshness = freshnessFor(latest, now);
    return {
      source: {
        id: this.id, provider: this.id, label: 'Dados internos do JvitorZ OS', kind: this.sourceKind,
        collectedAt: (latest ?? now).toISOString(), freshness,
        quality: orderedEvidence.length === 0 ? 'MISSING' : freshness === 'STALE' ? 'STALE' : 'GOOD',
        limitations: ['Não mede demanda externa.', 'Associação interna não demonstra causalidade nem prevê views.'],
      },
      evidence: orderedEvidence,
      candidates: orderedCandidates,
    };
  }
}
