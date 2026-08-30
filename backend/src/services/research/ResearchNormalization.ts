import {
  RESEARCH_INTENTS,
  RESEARCH_SUBJECT_TYPES,
  type ResearchFreshness,
  type ResearchIntent,
  type ResearchQuery,
  type ResearchRequest,
  type ResearchSubjectType,
} from '../../domains/research';

export class ResearchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchValidationError';
  }
}

export const normalizeSearchText = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const classifyResearchIntent = (value: string): ResearchIntent => {
  const text = normalizeSearchText(value);
  if (/(jogo|game|simulador|sim racing)/.test(text)) return 'GAME_DISCOVERY';
  if (/(lacuna|nao explorei|ainda nao fiz|content gap)/.test(text)) return 'CONTENT_GAP';
  if (/(tendenc|emergente|surgindo|crescendo)/.test(text)) return 'TREND_RESEARCH';
  if (/(audiencia|publico|interesse)/.test(text)) return 'AUDIENCE_OPPORTUNITY';
  if (/(busca|demanda|pesquisa youtube)/.test(text)) return 'SEARCH_DEMAND';
  if (/(concorr|outros canais|nicho)/.test(text)) return 'COMPETITIVE_SIGNAL';
  if (/(ideia|premissa)/.test(text)) return 'IDEA_RESEARCH';
  if (/(tema|topico|assunto)/.test(text)) return 'TOPIC_RESEARCH';
  return 'CONTENT_DISCOVERY';
};

const optionalText = (value: unknown, field: string, max: number): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ResearchValidationError(`${field} must be text`);
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > max) {
    throw new ResearchValidationError(`${field} must contain from 1 to ${max} characters`);
  }
  return normalized;
};

export const normalizeResearchRequest = (input: ResearchRequest): ResearchQuery => {
  if (!input || typeof input !== 'object' || typeof input.query !== 'string') {
    throw new ResearchValidationError('query is required');
  }
  const text = input.query.trim();
  if (!text || Array.from(text).length > 500) {
    throw new ResearchValidationError('query must contain from 1 to 500 characters');
  }
  if (input.intent !== undefined && !RESEARCH_INTENTS.includes(input.intent)) {
    throw new ResearchValidationError('invalid research intent');
  }
  if (input.subjectType !== undefined && !RESEARCH_SUBJECT_TYPES.includes(input.subjectType)) {
    throw new ResearchValidationError('invalid subject type');
  }
  return {
    text,
    normalized: normalizeSearchText(text),
    intent: input.intent ?? classifyResearchIntent(text),
    projectId: optionalText(input.projectId, 'projectId', 120),
    subjectType: input.subjectType ?? null,
    subject: optionalText(input.subject, 'subject', 160),
  };
};

export const freshnessFor = (observedAt: Date | null, now: Date): ResearchFreshness => {
  if (!observedAt) return 'MISSING';
  const age = Math.max(0, now.getTime() - observedAt.getTime());
  if (age <= 24 * 60 * 60 * 1_000) return 'RECENT';
  if (age <= 7 * 24 * 60 * 60 * 1_000) return 'AGING';
  return 'STALE';
};

export const inferSubjectType = (intent: ResearchIntent): ResearchSubjectType => ({
  GAME_DISCOVERY: 'GAME', CONTENT_DISCOVERY: 'TOPIC', TOPIC_RESEARCH: 'TOPIC', NICHE_RESEARCH: 'TOPIC',
  COMPETITIVE_SIGNAL: 'TOPIC', AUDIENCE_OPPORTUNITY: 'TOPIC', SEARCH_DEMAND: 'TOPIC',
  CONTENT_GAP: 'TOPIC', TREND_RESEARCH: 'TOPIC', IDEA_RESEARCH: 'IDEA',
}[intent] as ResearchSubjectType);
