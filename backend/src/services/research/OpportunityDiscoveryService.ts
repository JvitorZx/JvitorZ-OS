import type {
  ResearchCandidate,
  ResearchEvidence,
  ResearchFreshness,
  ResearchOpportunity,
  ResearchOpportunityState,
  ResearchProviderResult,
  ResearchQuery,
} from '../../domains/research';

const round = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 1_000) / 1_000;
const freshnessRank: Record<ResearchFreshness, number> = { RECENT: 4, AGING: 3, STALE: 2, MISSING: 1 };
const weakestFreshness = (items: readonly ResearchEvidence[]): ResearchFreshness => items
  .map(({ freshness }) => freshness)
  .sort((left, right) => freshnessRank[left] - freshnessRank[right])[0] ?? 'MISSING';
const stateFor = (confidence: number, evidenceCount: number, conflicting: boolean): ResearchOpportunityState => {
  if (evidenceCount === 0 || confidence < 0.2) return 'INSUFFICIENT_DATA';
  if (conflicting) return 'WATCH';
  if (confidence >= 0.8 && evidenceCount >= 3) return 'HIGH_INTEREST';
  if (confidence >= 0.6 && evidenceCount >= 2) return 'PROMISING';
  if (confidence >= 0.4) return 'WATCH';
  return 'WEAK_SIGNAL';
};

export class OpportunityDiscoveryService {
  discover(query: ResearchQuery, results: readonly ResearchProviderResult[]): ResearchOpportunity[] {
    const evidenceById = new Map(results.flatMap(({ evidence }) => evidence).map((item) => [item.id, item]));
    const merged = new Map<string, ResearchCandidate>();
    for (const candidate of results.flatMap(({ candidates }) => candidates)) {
      const existing = merged.get(candidate.key);
      if (!existing) {
        merged.set(candidate.key, structuredClone(candidate));
        continue;
      }
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...candidate.evidenceIds])];
      existing.sourceIds = [...new Set([...existing.sourceIds, ...candidate.sourceIds])];
      existing.relevance = Math.max(existing.relevance, candidate.relevance);
      existing.confidence = Math.max(existing.confidence, candidate.confidence);
      existing.context = { ...existing.context, ...candidate.context };
    }
    return [...merged.values()].map((candidate): Omit<ResearchOpportunity, 'rank'> => {
      const evidence = candidate.evidenceIds.flatMap((id) => evidenceById.get(id) ?? []);
      const signals = evidence.map(({ context }) => String(context.signal ?? '')).filter(Boolean);
      const positive = signals.some((value) => ['RISING', 'STRONG', 'POSITIVE'].includes(value));
      const negative = signals.some((value) => ['DECLINING', 'WEAK', 'NEGATIVE'].includes(value));
      const conflicting = positive && negative;
      const sourceDiversity = new Set(evidence.map(({ sourceId }) => sourceId)).size;
      const evidenceConfidence = evidence.length
        ? evidence.reduce((sum, item) => sum + item.confidence * item.relevance, 0) / evidence.length : 0;
      const compatibility = round(candidate.confidence * 0.45 + candidate.relevance * 0.35
        + (candidate.context.explored ? 0.2 : 0.1));
      const confidence = round(evidenceConfidence * 0.65 + Math.min(1, evidence.length / 4) * 0.25
        + Math.min(1, sourceDiversity / 2) * 0.1);
      const gaps = [
        ...(!candidate.context.explored ? ['O assunto não possui conteúdo publicado identificado no histórico atual.'] : []),
        ...(sourceDiversity < 2 ? ['A oportunidade ainda depende de uma única fonte.'] : []),
        ...(query.intent === 'SEARCH_DEMAND' && candidate.sourceIds.every((id) => id.includes('internal'))
          ? ['Demanda de busca externa não está disponível no provider interno.'] : []),
      ];
      const risks = [
        ...(conflicting ? ['Fontes ou sinais internos apresentam direções conflitantes.'] : []),
        ...(weakestFreshness(evidence) === 'STALE' ? ['Parte da evidência está desatualizada.'] : []),
        'O sinal indica uma hipótese de investigação, não garantia de performance.',
      ];
      const state = stateFor(confidence, evidence.length, conflicting);
      return {
        key: candidate.key, subject: candidate.label, subjectType: candidate.type, state,
        summary: `${candidate.summary} Estado de descoberta: ${state}.`, sources: candidate.sourceIds,
        evidence, freshness: weakestFreshness(evidence), compatibility, confidence, risks, gaps,
        nextInvestigation: state === 'INSUFFICIENT_DATA'
          ? `Colete mais evidências sobre ${candidate.label} antes de uma decisão editorial.`
          : `Compare ${candidate.label} no Editorial Decision Engine com alternativas e restrições reais do canal.`,
      };
    }).sort((left, right) => right.confidence - left.confidence
      || right.compatibility - left.compatibility || left.key.localeCompare(right.key)).slice(0, 20)
      .map((opportunity, index) => ({ rank: index + 1, ...opportunity }));
  }
}
