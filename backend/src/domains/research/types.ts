export const RESEARCH_INTENTS = [
  'GAME_DISCOVERY', 'CONTENT_DISCOVERY', 'TOPIC_RESEARCH', 'NICHE_RESEARCH',
  'COMPETITIVE_SIGNAL', 'AUDIENCE_OPPORTUNITY', 'SEARCH_DEMAND', 'CONTENT_GAP',
  'TREND_RESEARCH', 'IDEA_RESEARCH',
] as const;
export type ResearchIntent = typeof RESEARCH_INTENTS[number];

export const RESEARCH_SUBJECT_TYPES = [
  'GAME', 'THEME', 'SERIES', 'FORMAT', 'CAR', 'SIMULATOR', 'TOPIC', 'IDEA', 'CHANNEL',
] as const;
export type ResearchSubjectType = typeof RESEARCH_SUBJECT_TYPES[number];
export type ResearchSourceKind = 'INTERNAL' | 'EXTERNAL';
export type ResearchQuality = 'GOOD' | 'PARTIAL' | 'STALE' | 'MISSING' | 'INCONSISTENT' | 'ERROR';
export type ResearchFreshness = 'RECENT' | 'AGING' | 'STALE' | 'MISSING';
export type ResearchEvidenceClassification = 'fact' | 'inference' | 'hypothesis';
export const RESEARCH_OPPORTUNITY_STATES = [
  'HIGH_INTEREST', 'PROMISING', 'WATCH', 'WEAK_SIGNAL', 'INSUFFICIENT_DATA',
] as const;
export type ResearchOpportunityState = typeof RESEARCH_OPPORTUNITY_STATES[number];

export interface ResearchConfidence {
  score: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  basis: string[];
}

export interface ResearchRequest {
  query: string;
  intent?: ResearchIntent;
  projectId?: string | null;
  subjectType?: ResearchSubjectType;
  subject?: string;
  forceRefresh?: boolean;
}

export interface ResearchQuery {
  text: string;
  normalized: string;
  intent: ResearchIntent;
  projectId: string | null;
  subjectType: ResearchSubjectType | null;
  subject: string | null;
}

export interface ResearchSource {
  id: string;
  provider: string;
  label: string;
  kind: ResearchSourceKind;
  collectedAt: string;
  freshness: ResearchFreshness;
  quality: ResearchQuality;
  limitations: string[];
}

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  classification: ResearchEvidenceClassification;
  summary: string;
  relevance: number;
  confidence: number;
  observedAt: string | null;
  freshness: ResearchFreshness;
  context: Record<string, string | number | boolean | null>;
}

export interface ResearchCandidate {
  key: string;
  label: string;
  type: ResearchSubjectType;
  summary: string;
  relevance: number;
  confidence: number;
  sourceIds: string[];
  evidenceIds: string[];
  context: Record<string, string | number | boolean | null>;
}

export interface ResearchResult {
  source: ResearchSource;
  evidence: ResearchEvidence[];
  candidates: ResearchCandidate[];
}

export interface ResearchOpportunity {
  key: string;
  rank: number;
  subject: string;
  subjectType: ResearchSubjectType;
  state: ResearchOpportunityState;
  summary: string;
  sources: string[];
  evidence: ResearchEvidence[];
  freshness: ResearchFreshness;
  compatibility: number;
  confidence: number;
  risks: string[];
  gaps: string[];
  nextInvestigation: string;
}

export interface ResearchProviderResult {
  source: ResearchSource;
  evidence: ResearchEvidence[];
  candidates: ResearchCandidate[];
}

export interface ResearchExecution {
  historyId: string;
  query: ResearchQuery;
  sources: ResearchSource[];
  results: ResearchResult[];
  opportunities: ResearchOpportunity[];
  quality: ResearchQuality;
  freshness: ResearchFreshness;
  limitations: string[];
  researchedAt: string;
  validUntil: string;
  cache: 'MISS' | 'HIT' | 'STALE_FALLBACK';
}
