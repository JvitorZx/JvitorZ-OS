export interface ClipSegment { id: string; position: number; startMs: number; endMs: number; text: string }
export interface ClipChapter { id: string; startMs: number; endMs: number | null; title: string }
export interface ClipConfiguration { minDurationMs: number; maxDurationMs: number; maxCandidates: number }
export const DEFAULT_CLIP_CONFIGURATION: ClipConfiguration = { minDurationMs: 5000, maxDurationMs: 90000, maxCandidates: 8 };
export class ShortsValidationError extends Error { constructor(message: string) { super(message); this.name = 'ShortsValidationError'; } }
export class ShortsConflictError extends Error { constructor(message: string) { super(message); this.name = 'ShortsConflictError'; } }
export class ShortsNotFoundError extends Error { constructor(message: string) { super(message); this.name = 'ShortsNotFoundError'; } }
export const normalizeClipText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const clipConfiguration = (raw: Record<string, unknown> = {}): ClipConfiguration => {
  if (Object.keys(raw).some((key) => !['minDurationMs', 'maxDurationMs', 'maxCandidates'].includes(key))) throw new ShortsValidationError('configuration is invalid');
  const result = { ...DEFAULT_CLIP_CONFIGURATION, ...raw } as ClipConfiguration;
  for (const value of Object.values(result)) if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new ShortsValidationError('configuration must use positive integers');
  if (result.maxDurationMs > 600000 || result.minDurationMs > result.maxDurationMs || result.maxCandidates > 30) throw new ShortsValidationError('configuration exceeds editorial processing bounds');
  return result;
};

const events: Array<[string, RegExp]> = [
  ['erro', /\b(errei|erro|falhei|perdi|quebrou|bug|oops|failed|mistake)\b/],
  ['tensao', /\b(quase|cuidado|perigo|socorro|tensao|almost|danger)\b/],
  ['descoberta', /\b(descobri|descoberta|encontrei|segredo|achei|found|discovered)\b/],
  ['conquista', /\b(consegui|conseguimos|venci|ganhei|vitoria|finalmente|won|success)\b/],
  ['desafio', /\b(desafio|dificil|impossivel|problema|challenge)\b/],
  ['reacao', /\b(nossa|caramba|incrivel|engracado|risos|uau|wow|laugh)\b/],
  ['transformacao', /\b(mudou|transformou|resolveu|resolvi|changed|solved)\b/],
];
const payoff = /\b(consegui|conseguimos|venci|ganhei|fim|finalmente|resolveu|resolvi|acabou|pronto|perdi|falhei|risos|won|solved|failed)\b/;
const eventOf = (text: string) => events.find(([, pattern]) => pattern.test(normalizeClipText(text)))?.[0];
export const clipEvidence = (segments: ClipSegment[], startMs: number, endMs: number) => segments.filter((segment) => segment.endMs > startMs && segment.startMs < endMs);
export const validateClipBoundaries = (segments: ClipSegment[], startMs: unknown, endMs: unknown, configuration: ClipConfiguration) => {
  if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs) throw new ShortsValidationError('startMs/endMs are invalid');
  if (endMs - startMs < configuration.minDurationMs || endMs - startMs > configuration.maxDurationMs) throw new ShortsValidationError('duration is outside the configured editorial range');
  const evidence = clipEvidence(segments, startMs, endMs);
  if (!evidence.length || !segments.some((segment) => segment.startMs === startMs) || !segments.some((segment) => segment.endMs === endMs)) throw new ShortsValidationError('boundaries must coincide with real transcript segment boundaries');
  if (evidence.some((segment) => segment.startMs < startMs || segment.endMs > endMs)) throw new ShortsValidationError('boundaries would cut a transcript segment');
  return evidence;
};
export const overlapRatio = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) => Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs)) / Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
export const sameVariantFamily = (a: { id: string; variantOfId?: string | null }, b: { id: string; variantOfId?: string | null }) => (a.variantOfId ?? a.id) === (b.variantOfId ?? b.id);
export const scoreClipHook = (candidate: ReturnType<typeof describeClip>, hook: string, segments: ClipSegment[]) => {
  const evidence = clipEvidence(segments, candidate.startMs, candidate.endMs);
  const words = normalizeClipText(hook).split(/\W+/).filter((word) => word.length > 3);
  const joined = normalizeClipText(evidence.map(({ text }) => text).join(' '));
  const support = words.length ? words.filter((word) => joined.includes(word)).length / words.length : 0;
  const literal = evidence.some(({ text }) => text.includes(hook));
  const scoreFactors = candidate.scoreFactors.map((factor) => factor.factor === 'hook' ? { factor: 'hook', points: literal ? 10 : Math.round(support * 8), reason: literal ? 'Hook extraido literalmente da evidencia.' : `Hook manual: suporte lexical ${Math.round(support * 100)}%; fidelidade exige revisao.` } : factor);
  return { ...candidate, hook, scoreFactors, score: scoreFactors.reduce((sum, factor) => sum + factor.points, 0), rationale: scoreFactors.map(({ reason }) => reason).join(' ') };
};

export const describeClip = (segments: ClipSegment[], startMs: number, endMs: number, chapters: ClipChapter[] = []) => {
  const evidence = clipEvidence(segments, startMs, endMs);
  const anchor = evidence.find((segment) => eventOf(segment.text)) ?? evidence[0];
  const event = eventOf(anchor.text) ?? 'momento manual';
  const hasPayoff = evidence.some((segment) => payoff.test(normalizeClipText(segment.text)));
  const chapter = chapters.find((entry) => anchor.startMs >= entry.startMs && (entry.endMs == null || anchor.startMs < entry.endMs));
  const setup = evidence[0].position < anchor.position;
  const spokenMs = evidence.reduce((sum, segment) => sum + segment.endMs - segment.startMs, 0);
  const scoreFactors = [
    { factor: 'acontecimento', points: eventOf(anchor.text) ? 30 : 10, reason: eventOf(anchor.text) ? `Marcador textual de ${event} em ${anchor.startMs}ms.` : 'Momento indicado manualmente; nenhum marcador reconhecido.' },
    { factor: 'payoff', points: hasPayoff ? 25 : 0, reason: hasPayoff ? 'O texto inclui um marcador de desfecho.' : 'Desfecho nao identificado; revisar.' },
    { factor: 'contexto', points: setup ? 20 : 8, reason: setup ? 'Um segmento de setup precede o acontecimento.' : 'Independencia narrativa exige revisao.' },
    { factor: 'densidade', points: Math.round(15 * Math.min(1, spokenMs / (endMs - startMs))), reason: 'Proporcao de fala temporal no intervalo; menor duracao nao implica maior qualidade.' },
    { factor: 'hook', points: 10, reason: 'Hook inicial extraido literalmente da evidencia.' },
  ];
  const risks = ['Heuristica textual: revisar video, contexto e entonacao antes de cortar.'];
  if (!hasPayoff) risks.push('Payoff nao identificado no texto.');
  if (!setup) risks.push('Setup/contexto pode ser insuficiente.');
  if (chapters.some((entry) => entry.startMs > startMs && entry.startMs < endMs)) risks.push('Intervalo atravessa uma transicao de capitulo.');
  return { startMs, endMs, durationMs: endMs - startMs, title: anchor.text.slice(0, 160), hook: anchor.text.slice(0, 200),
    summary: `Momento de ${event}: ${anchor.text.slice(0, 300)}`, rationale: scoreFactors.map(({ reason }) => reason).join(' '), event,
    momentKey: anchor.id, chapterEntryId: chapter?.id ?? null, score: scoreFactors.reduce((sum, item) => sum + item.points, 0), scoreFactors,
    risks, evidence: evidence.map(({ id, position }) => ({ segmentId: id, position })) };
};

export const detectClips = (segments: ClipSegment[], configuration: ClipConfiguration, chapters: ClipChapter[] = []) => {
  const candidates: ReturnType<typeof describeClip>[] = [];
  segments.forEach((anchor, index) => {
    if (!eventOf(anchor.text)) return;
    const chapter = chapters.find((entry) => anchor.startMs >= entry.startMs && (entry.endMs == null || anchor.startMs < entry.endMs));
    let first = index;
    if (index > 0 && anchor.startMs - segments[index - 1].endMs <= 5000 && (!chapter || segments[index - 1].startMs >= chapter.startMs)) first--;
    let last = index;
    while (last + 1 < segments.length && last < index + 3) {
      const next = segments[last + 1];
      if (next.startMs - segments[last].endMs > 5000 || next.endMs - segments[first].startMs > configuration.maxDurationMs || (chapter?.endMs != null && next.startMs >= chapter.endMs)) break;
      last++;
      if (payoff.test(normalizeClipText(next.text))) break;
    }
    try { validateClipBoundaries(segments, segments[first].startMs, segments[last].endMs, configuration); }
    catch { return; }
    candidates.push(describeClip(segments, segments[first].startMs, segments[last].endMs, chapters));
  });
  const ranked = candidates.sort((a, b) => b.score - a.score || a.startMs - b.startMs);
  const unique: typeof ranked = [];
  for (const candidate of ranked) if (!unique.some((prior) => prior.momentKey === candidate.momentKey || overlapRatio(prior, candidate) >= 0.65)) unique.push(candidate);
  return unique.slice(0, configuration.maxCandidates);
};

export const reviewClips = (candidates: Array<{ id: string; startMs: number; endMs: number; hook: string; title: string; evidence: unknown; risks: unknown; variantOfId?: string | null }>, segments: ClipSegment[], configuration: ClipConfiguration) => {
  const findings: Array<{ candidateId: string; severity: string; message: string }> = [];
  if (candidates.length > 30) findings.push({ candidateId: '', severity: 'ERROR', message: 'Candidatos excessivos.' });
  candidates.forEach((candidate, index) => {
    let evidence: ClipSegment[] = [];
    try { evidence = validateClipBoundaries(segments, candidate.startMs, candidate.endMs, configuration); }
    catch { findings.push({ candidateId: candidate.id, severity: 'ERROR', message: 'Boundary sem evidencia temporal valida.' }); }
    const supplied = Array.isArray(candidate.evidence) ? candidate.evidence as Array<{ segmentId: string }> : [];
    if (supplied.length !== evidence.length || evidence.some((segment) => !supplied.some(({ segmentId }) => segmentId === segment.id))) findings.push({ candidateId: candidate.id, severity: 'ERROR', message: 'Referencias de evidencia divergentes.' });
    const text = normalizeClipText(evidence.map(({ text }) => text).join(' '));
    const hookWords = normalizeClipText(candidate.hook).split(/\W+/).filter((word) => word.length > 3);
    if (!candidate.hook.trim() || !hookWords.length || hookWords.filter((word) => text.includes(word)).length / hookWords.length < 0.5 || /\b(viral|milhoes|garantid|nunca visto)\w*/.test(normalizeClipText(candidate.hook))) findings.push({ candidateId: candidate.id, severity: 'ERROR', message: 'Hook sem suporte textual suficiente ou promessa exagerada; revisar fidelidade.' });
    if (candidates.slice(0, index).some((other) => overlapRatio(candidate, other) >= 0.65 && !sameVariantFamily(candidate, other))) findings.push({ candidateId: candidate.id, severity: 'ERROR', message: 'Momento duplicado sem variante explicita.' });
    if (!payoff.test(text)) findings.push({ candidateId: candidate.id, severity: 'WARNING', message: 'Payoff nao identificado; revisar video.' });
    if (Array.isArray(candidate.risks)) for (const risk of candidate.risks) findings.push({ candidateId: candidate.id, severity: 'WARNING', message: String(risk) });
  });
  return { outcome: findings.some(({ severity }) => severity === 'ERROR') ? 'NEEDS_CHANGES' : findings.length ? 'APPROVED_WITH_WARNINGS' : 'APPROVED', findings };
};
