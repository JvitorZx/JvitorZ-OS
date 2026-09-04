import type {
  GeneratedPackagingVariant,
  PackagingContextItem,
  PackagingGenerationInput,
  PackagingReview,
  ThumbnailBrief,
} from './types';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const compact = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const titleCase = (value: string) => value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
const episodeLabel = (input: PackagingGenerationInput) => input.episode ? `Ep. ${input.episode}` : null;

const thumbnailText = (event: string, game: string): string => {
  const text = normalize(event);
  if (/ronc|som|motor/.test(text)) return 'OUVE ESSE SOM';
  if (/rar|encontr|descob|abandon/.test(text)) return 'ACHADO RARO';
  if (/restaur|reform|consert/.test(text)) return 'FICOU NOVO';
  if (/bat|erro|problema|quebr|falh/.test(text)) return 'DEU PROBLEMA';
  if (/missao|entrega|viagem|desafio/.test(text)) return 'MISSAO REAL';
  return normalize(game).includes('forza') ? 'OLHA ESSE CARRO' : 'MOMENTO DECISIVO';
};

const profile = (input: PackagingGenerationInput) => {
  const identity = normalize(`${input.game ?? ''} ${input.series ?? ''}`);
  if (identity.includes('city car')) return {
    name: 'City Car Driving 2.0', required: ['preto e laranja', 'numero do episodio evidente', 'logo consistente'],
    focus: 'acontecimento concreto da missao', composition: 'veiculo e consequencia da cena em primeiro plano, com continuidade visual da serie', fit: 1,
  };
  if (identity.includes('forza')) return {
    name: 'Forza Horizon 6', required: ['carro como protagonista', 'estetica cinematografica ou agressiva', 'logo do jogo quando coerente'],
    focus: 'carro e transformacao observavel', composition: 'carro dominante, contraste forte e ambiente apenas como suporte', fit: 1,
  };
  return {
    name: input.series ?? input.game ?? 'conteudo atual', required: ['identidade atual do canal'], focus: 'acontecimento principal',
    composition: 'assunto principal em primeiro plano, sem elementos que prometam algo ausente', fit: input.series || input.game ? 0.8 : 0.55,
  };
};

const buildBrief = (input: PackagingGenerationInput, event: string, variant: number): ThumbnailBrief => {
  const current = profile(input); const text = thumbnailText(event, input.game ?? current.name);
  return {
    concept: `Mostrar visualmente ${compact(event, 120)}, sem inventar um acontecimento.`,
    focus: current.focus,
    composition: variant === 1 ? current.composition : variant === 2
      ? `${current.composition}; reservar uma area limpa para texto curto.` : `${current.composition}; usar contraste entre antes e depois somente se ambos existirem no conteudo.`,
    text,
    requiredElements: current.required,
    optionalElements: [episodeLabel(input), input.series, input.game].filter((value): value is string => Boolean(value)),
    avoidElements: ['texto longo', 'clickbait sem apoio no video', 'repetir literalmente o titulo'],
    complementsTitle: `O titulo explica o acontecimento; a thumbnail evidencia ${text.toLowerCase()} como leitura visual curta.`,
  };
};

const titleCandidates = (input: PackagingGenerationInput, event: string): Array<{ title: string; angle: string }> => {
  const subject = input.series ?? input.game ?? 'o video'; const episode = episodeLabel(input);
  return [
    { title: compact(`${episode ? `${episode}: ` : ''}${titleCase(event)}`, 100), angle: 'acontecimento concreto' },
    { title: compact(`${titleCase(event)} em ${subject}`, 100), angle: 'acontecimento e contexto' },
    { title: compact(`${subject}${episode ? ` ${episode}` : ''} | ${titleCase(event)}`, 100), angle: 'continuidade e progressao' },
    { title: compact(`O momento em que ${event} - ${subject}`, 100), angle: 'consequencia observada' },
    { title: compact(`${titleCase(event)}: o proximo passo em ${subject}`, 100), angle: 'progressao editorial' },
  ];
};

const tagsFor = (input: PackagingGenerationInput, event: string) => unique([
  input.game ?? '', input.series ?? '', input.format ?? '', ...normalize(event).split(/[^a-z0-9]+/).filter((part) => part.length >= 4).slice(0, 5), 'JvitorZx',
]).slice(0, 12);

export const generatePackagingVariants = (
  input: PackagingGenerationInput,
  context: PackagingContextItem[],
): GeneratedPackagingVariant[] => {
  const count = Math.min(5, Math.max(2, input.variationCount ?? 3));
  const event = compact(input.keyEvents[0] ?? '', 120); const currentProfile = profile(input);
  const titles = titleCandidates(input, event); const contextIds = context.slice(0, 10).map(({ id }) => id);
  return titles.slice(0, count).map((candidate, index) => ({
    key: String.fromCharCode(65 + index), title: candidate.title, angle: candidate.angle, sourceEvent: event,
    thumbnailBrief: buildBrief(input, event, index + 1),
    description: compact(`${input.summary} ${input.series ? `Este conteudo faz parte de ${input.series}.` : ''} ${episodeLabel(input) ? `Episodio ${input.episode}.` : ''}`, 2_000),
    tags: tagsFor(input, event),
    rationale: `Usa o acontecimento real "${event}" e preserva a identidade de ${currentProfile.name}. Score apenas comparativo entre variantes.`,
    seriesFit: currentProfile.fit, clickbaitRisk: 'LOW', internalScore: Number(Math.max(0.55, 0.92 - index * 0.07).toFixed(2)), contextUsed: contextIds,
  }));
};

export const reviewPackagingVariant = (variant: GeneratedPackagingVariant | {
  title: string; sourceEvent: string; thumbnailBrief: unknown; contextUsed?: unknown; clickbaitRisk?: string;
}): PackagingReview => {
  const findings: PackagingReview['findings'] = [];
  const title = normalize(variant.title); const eventTokens = normalize(variant.sourceEvent).split(/[^a-z0-9]+/).filter((part) => part.length >= 4);
  if (!eventTokens.some((token) => title.includes(token))) findings.push({ severity: 'ERROR', code: 'EVENT_NOT_REPRESENTED', message: 'O titulo nao representa o acontecimento informado.' });
  if (/voce nao vai acreditar|chocante|melhor do mundo|100% garantido/.test(title)) findings.push({ severity: 'ERROR', code: 'MISLEADING_CLICKBAIT', message: 'O titulo usa promessa exagerada sem evidencia.' });
  const brief = variant.thumbnailBrief && typeof variant.thumbnailBrief === 'object' ? variant.thumbnailBrief as Record<string, unknown> : {};
  if (normalize(String(brief.text ?? '')) === title) findings.push({ severity: 'WARNING', code: 'TITLE_THUMB_DUPLICATION', message: 'Titulo e texto da thumbnail repetem a mesma informacao.' });
  if (!Array.isArray(variant.contextUsed) || variant.contextUsed.length === 0) findings.push({ severity: 'WARNING', code: 'CONTEXT_MISSING', message: 'Nenhum contexto historico foi associado a variante.' });
  if (!findings.length) findings.push({ severity: 'INFO', code: 'REVIEW_OK', message: 'A embalagem e fiel ao acontecimento e usa contexto rastreavel.' });
  return { valid: !findings.some(({ severity }) => severity === 'ERROR'), findings };
};
