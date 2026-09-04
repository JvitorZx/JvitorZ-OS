import type { ChapterCandidate, TimedTranscriptSegmentInput } from './types';

const MAX_CHAPTERS = 12;
const MIN_CHAPTER_GAP_MS = 45_000;
const MAX_SECTION_MS = 180_000;
const transition = /^(agora|depois|entao|em seguida|proxim[oa]|vamos|missao|desafio|descobri|final|conclusao|nova etapa)\b/i;

const titleFrom = (text: string): string => {
  const clean = text.replace(/^[-–—\s]+/, '').replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').slice(0, 8).join(' ');
  const title = words.length > 60 ? `${words.slice(0, 57).trim()}...` : words;
  return title || 'Novo trecho';
};

export const generateChapterCandidates = (segments: readonly TimedTranscriptSegmentInput[]): ChapterCandidate[] => {
  if (!segments.length) return [];
  const starts = [0];
  for (let index = 1; index < segments.length && starts.length < MAX_CHAPTERS; index += 1) {
    const previousStart = segments[starts[starts.length - 1]].startMs;
    const gap = segments[index].startMs - segments[index - 1].endMs;
    const elapsed = segments[index].startMs - previousStart;
    const naturalChange = transition.test(segments[index].text) || gap >= 20_000;
    if (elapsed >= MIN_CHAPTER_GAP_MS && (naturalChange || elapsed >= MAX_SECTION_MS)) starts.push(index);
  }
  return starts.map((segmentIndex, position) => {
    const nextSegmentIndex = starts[position + 1] ?? segments.length;
    const current = segments[segmentIndex];
    const last = segments[nextSegmentIndex - 1];
    const marker = transition.test(current.text);
    const confidenceValues = segments.slice(segmentIndex, nextSegmentIndex).flatMap(({ confidence }) => confidence == null ? [] : [confidence]);
    return {
      position,
      startMs: current.startMs,
      endMs: position + 1 < starts.length ? segments[starts[position + 1]].startMs : last.endMs,
      title: titleFrom(current.text),
      rationale: marker ? 'A transcricao indica uma mudanca explicita de assunto ou etapa.' : position === 0 ? 'Inicio do conteudo temporal disponivel.' : 'Novo bloco temporal apos uma transicao ou intervalo relevante.',
      segmentStartPosition: segmentIndex,
      segmentEndPosition: nextSegmentIndex - 1,
      confidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : null,
    };
  });
};

export const validateChapters = (entries: readonly Pick<ChapterCandidate, 'startMs' | 'title'>[], durationMs?: number | null): void => {
  if (!entries.length || entries.length > 100) throw new Error('At least one chapter and at most 100 chapters are required');
  entries.forEach((entry, index) => {
    if (!Number.isInteger(entry.startMs) || entry.startMs < 0) throw new Error(`Chapter ${index + 1} timestamp is invalid`);
    if (durationMs != null && entry.startMs > durationMs) throw new Error(`Chapter ${index + 1} starts after transcript duration`);
    if (typeof entry.title !== 'string' || !entry.title.trim() || entry.title.trim().length > 100) throw new Error(`Chapter ${index + 1} title is invalid`);
    if (index > 0 && entry.startMs <= entries[index - 1].startMs) throw new Error('Chapter timestamps must be strictly increasing');
  });
};
