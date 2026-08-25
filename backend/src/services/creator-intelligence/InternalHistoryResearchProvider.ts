import type { VideoIdea } from '@prisma/client';
import type { ResearchProvider } from '../../domains/creator-intelligence/ResearchProvider';
import {
  EVIDENCE_CLASSIFICATIONS,
  type EvidenceClassification,
  type IdeaScoreFactor,
  type ResearchEvidence,
} from '../../domains/creator-intelligence/types';
import { DatabaseService } from '../../database/DatabaseService';
import { PerformanceSignalRepository } from '../../database/repositories/PerformanceSignalRepository';

const METRIC_FACTORS: Readonly<Record<string, IdeaScoreFactor | undefined>> = Object.freeze({
  game_performance: 'gamePerformance',
  format_performance: 'formatPerformance',
  similar_content_performance: 'similarContentPerformance',
});

const toClassification = (value: string): EvidenceClassification =>
  EVIDENCE_CLASSIFICATIONS.includes(value as EvidenceClassification)
    ? value as EvidenceClassification
    : 'unknown';

export class InternalHistoryResearchProvider implements ResearchProvider {
  readonly name = 'internal-history';
  private repository?: PerformanceSignalRepository;

  constructor(repository?: PerformanceSignalRepository) {
    this.repository = repository;
  }

  private get signals(): PerformanceSignalRepository {
    if (!this.repository) {
      this.repository = new PerformanceSignalRepository(DatabaseService.client);
    }
    return this.repository;
  }

  async research(idea: VideoIdea): Promise<ResearchEvidence[]> {
    const signals = await this.signals.findRelevant({
      projectId: idea.projectId,
      videoIdeaId: idea.id,
      game: idea.game,
      format: idea.format,
    });

    return signals.flatMap((signal): ResearchEvidence[] => {
      const factor = METRIC_FACTORS[signal.metric];
      if (!factor) return [];

      const matchesIdea = signal.videoIdeaId === idea.id
        || (factor === 'gamePerformance' && Boolean(idea.game) && signal.game === idea.game)
        || (factor === 'formatPerformance' && signal.format === idea.format)
        || factor === 'similarContentPerformance';
      if (!matchesIdea) return [];

      return [{
        factor,
        value: signal.value,
        classification: toClassification(signal.classification),
        source: `${this.name}:${signal.source}`,
        summary: `Sinal histórico ${signal.metric} baseado em ${signal.sampleSize} amostra(s).`,
        sampleSize: signal.sampleSize,
        confidence: signal.confidence,
      }];
    });
  }
}
