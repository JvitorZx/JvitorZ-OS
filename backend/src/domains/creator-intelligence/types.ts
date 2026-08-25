export const EVIDENCE_CLASSIFICATIONS = [
  'real',
  'inference',
  'recommendation',
  'unknown',
] as const;

export type EvidenceClassification = (typeof EVIDENCE_CLASSIFICATIONS)[number];

export const CONTENT_DECISION_CATEGORIES = [
  'GRAVAR',
  'TESTAR',
  'GUARDAR',
  'DESCARTAR',
] as const;

export type ContentDecisionCategory = (typeof CONTENT_DECISION_CATEGORIES)[number];

export const IDEA_SCORE_FACTORS = [
  'gamePerformance',
  'formatPerformance',
  'similarContentPerformance',
  'premiseClarity',
  'novelty',
  'productionEffort',
  'channelIdentityFit',
] as const;

export type IdeaScoreFactor = (typeof IDEA_SCORE_FACTORS)[number];

export interface ResearchEvidence {
  factor: IdeaScoreFactor;
  value: number;
  classification: EvidenceClassification;
  source: string;
  summary: string;
  sampleSize?: number;
  confidence?: number;
}

export interface IdeaScoreComponent {
  factor: IdeaScoreFactor;
  value: number | null;
  weight: number;
  classification: EvidenceClassification;
  rationale: string;
  sources: string[];
}

export interface IdeaEvaluation {
  ideaId: string;
  score: number;
  category: ContentDecisionCategory;
  classification: 'recommendation';
  rationale: string;
  components: IdeaScoreComponent[];
  unknownFactors: IdeaScoreFactor[];
  confidence: number;
  evidenceUsed: Array<{
    factor: IdeaScoreFactor;
    classification: EvidenceClassification;
    sources: string[];
  }>;
  risks: string[];
  missingData: IdeaScoreFactor[];
}

export interface RankedIdeaEvaluation extends IdeaEvaluation {
  rank: number;
  rankingRationale: string;
}

export interface CreatorIntelligenceContext {
  channelState: {
    insights: Array<{
      category: string;
      subject: string;
      statement: string;
      confidence: number;
      classification: EvidenceClassification;
    }>;
  };
  relevantHistory: ResearchEvidence[];
  ideas: Array<{
    id: string;
    game: string | null;
    theme: string;
    format: string;
    premise: string;
  }>;
  opportunities: Array<{
    ideaId: string;
    summary: string;
    classification: EvidenceClassification;
  }>;
  previousDecisions: Array<{
    ideaId: string;
    category: ContentDecisionCategory;
    score: number;
    rationale: string;
  }>;
  creatorConstraints: string[];
};

export const clampScore = (value: number): number =>
  Math.min(100, Math.max(0, Math.round(value * 100) / 100));
