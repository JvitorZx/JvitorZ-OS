export interface CaptionSegment { id: string; position: number; startMs: number; endMs: number; text: string }
export interface CaptionCue { index: number; startMs: number; endMs: number; text: string; sourceSegmentId: string }

export const normalizeCaptionText = (text: string): string => text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
export const buildClipCaptions = (segments: readonly CaptionSegment[], startMs: number, endMs: number) => {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs) throw new Error('Invalid caption clip interval');
  const warnings: string[] = []; const cues: CaptionCue[] = [];
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.position - b.position || a.id.localeCompare(b.id));
  for (const segment of sorted) {
    if (!Number.isSafeInteger(segment.startMs) || !Number.isSafeInteger(segment.endMs) || segment.startMs < 0 || segment.endMs <= segment.startMs) { warnings.push('Um segmento com tempo invalido foi omitido.'); continue; }
    if (segment.endMs <= startMs || segment.startMs >= endMs) continue;
    const text = normalizeCaptionText(segment.text);
    if (!text) { warnings.push('Um segmento sem texto utilizavel foi omitido.'); continue; }
    if (segment.startMs < startMs || segment.endMs > endMs) warnings.push('Segmento parcial: o intervalo foi limitado ao corte, mas a fala completa do segmento foi preservada; revise antes de publicar.');
    const cue = { index: cues.length + 1, startMs: Math.max(segment.startMs, startMs) - startMs, endMs: Math.min(segment.endMs, endMs) - startMs, text, sourceSegmentId: segment.id };
    if (cues.some((previous) => previous.endMs > cue.startMs)) warnings.push('Existem segmentos temporais sobrepostos; a sobreposicao original foi preservada.');
    cues.push(cue);
  }
  return { durationMs: endMs - startMs, cues, warnings: [...new Set(warnings)] };
};
export const captionTimestamp = (milliseconds: number, separator: ',' | '.') => {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('Invalid caption timestamp');
  const hours = Math.floor(milliseconds / 3600000); const minutes = Math.floor(milliseconds / 60000) % 60; const seconds = Math.floor(milliseconds / 1000) % 60; const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
};
const safeCueText = (text: string) => normalizeCaptionText(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const serializeCaptions = (cues: readonly CaptionCue[], format: 'srt' | 'vtt') => {
  const separator = format === 'srt' ? ',' : '.';
  const blocks = cues.map((cue, index) => `${index + 1}\n${captionTimestamp(cue.startMs, separator)} --> ${captionTimestamp(cue.endMs, separator)}\n${safeCueText(cue.text)}`);
  return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${blocks.join('\n\n')}${blocks.length ? '\n' : ''}`;
};
