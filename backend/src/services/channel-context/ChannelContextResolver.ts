import { DatabaseService } from '../../database/DatabaseService';
import { ChannelContextRepository } from '../../database/repositories/ChannelContextRepository';
import type { ChannelContextResolutionQuery } from '../../domains/channel-context';

const normalized = (value?: string | null) => value?.trim().toLocaleLowerCase('pt-BR') ?? '';
const tokens = (value?: string | null) => [...new Set(normalized(value).split(/[^a-z0-9]+/).filter((part) => part.length >= 3))];

export class ChannelContextResolver {
  constructor(private readonly repository = new ChannelContextRepository(DatabaseService.client), private readonly clock = () => new Date()) {}

  async resolve(query: ChannelContextResolutionQuery = {}) {
    const limit = Math.min(20, Math.max(1, query.limit ?? 8));
    const maxCharacters = Math.min(12_000, Math.max(500, query.maxCharacters ?? 6_000));
    const rows = await this.repository.findAll({ projectId: query.projectId, currentOnly: true, limit: 200 });
    const wantedTokens = tokens([query.text, query.subject, query.game, query.series, query.format].filter(Boolean).join(' '));
    const now = this.clock().getTime();
    const ranked = rows
      .filter((entry) => !query.types?.length || query.types.includes(entry.type as never))
      .map((entry) => {
        const haystack = normalized([entry.category, entry.subject, entry.statement, entry.game, entry.series, entry.format].filter(Boolean).join(' '));
        const ageDays = Math.max(0, (now - (entry.occurredAt ?? entry.periodEnd ?? entry.updatedAt).getTime()) / 86_400_000);
        const relationMatch = Boolean(query.entityType && query.entityId && (
          (entry.entityType === query.entityType && entry.entityId === query.entityId)
          || entry.relations.some((relation) => relation.entityType === query.entityType && relation.entityId === query.entityId)
        ));
        const dimensions = [[query.game, entry.game], [query.series, entry.series], [query.format, entry.format]];
        const dimensionScore = dimensions.reduce((score, [wanted, actual]) => score + (wanted && normalized(wanted) === normalized(actual) ? 16 : 0), 0);
        const tokenScore = wantedTokens.reduce((score, token) => score + (haystack.includes(token) ? 3 : 0), 0);
        const score = (entry.status === 'CONFIRMED' ? 12 : 9) + entry.confidence * 8 + (relationMatch ? 30 : 0)
          + dimensionScore + tokenScore + Math.max(0, 5 - ageDays / 90);
        return { entry, score };
      })
      .sort((a, b) => b.score - a.score || (b.entry.occurredAt?.getTime() ?? 0) - (a.entry.occurredAt?.getTime() ?? 0) || a.entry.id.localeCompare(b.entry.id));

    const selected = [] as typeof ranked;
    let characters = 0;
    for (const candidate of ranked) {
      if (selected.length >= limit) break;
      const size = candidate.entry.statement.length + candidate.entry.subject.length + 40;
      if (selected.length && characters + size > maxCharacters) continue;
      selected.push(candidate); characters += size;
    }
    return { entries: selected.map(({ entry, score }) => ({ ...entry, relevanceScore: Number(score.toFixed(3)) })), totalCandidates: ranked.length, truncated: selected.length < ranked.length };
  }
}
