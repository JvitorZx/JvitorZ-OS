import { TRANSCRIPT_FORMATS, type TimedTranscriptSegmentInput, type TranscriptFormat } from './types';

export class TranscriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptParseError';
  }
}

const normalizeText = (value: string): string => value.replace(/\r\n?/g, '\n').trim();

const parseTimestamp = (value: string): number => {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length < 2 || parts.length > 3) throw new TranscriptParseError(`Invalid timestamp: ${value}`);
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite) || hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
    throw new TranscriptParseError(`Invalid timestamp: ${value}`);
  }
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
};

const segment = (start: string, end: string, lines: string[], sourceSegmentId?: string): TimedTranscriptSegmentInput => {
  const startMs = parseTimestamp(start);
  const endMs = parseTimestamp(end);
  const text = lines.join(' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!text) throw new TranscriptParseError('Transcript segment text is empty');
  if (endMs <= startMs) throw new TranscriptParseError('Transcript segment end must be after start');
  return { startMs, endMs, text, sourceSegmentId: sourceSegmentId ?? null };
};

const parseSbv = (content: string): TimedTranscriptSegmentInput[] => normalizeText(content).split(/\n{2,}/).map((block, index) => {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  const timing = lines.shift()?.match(/^([^,]+),([^,]+)$/);
  if (!timing || !lines.length) throw new TranscriptParseError(`Invalid SBV block ${index + 1}`);
  return segment(timing[1], timing[2], lines, String(index + 1));
});

const parseArrowBlocks = (content: string, format: 'SRT' | 'VTT'): TimedTranscriptSegmentInput[] => {
  let normalized = normalizeText(content);
  if (format === 'VTT') {
    if (!/^WEBVTT(?:\s|$)/.test(normalized)) throw new TranscriptParseError('VTT header is required');
    normalized = normalized.replace(/^WEBVTT[^\n]*\n?/, '').trim();
  }
  if (!normalized) throw new TranscriptParseError('Transcript contains no segments');
  const blocks = normalized.split(/\n{2,}/).filter((block) => !/^NOTE(?:\s|$)/.test(block.trim()));
  return blocks.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    let sourceId: string | undefined;
    if (lines[0] && !lines[0].includes('-->')) sourceId = lines.shift();
    const timingLine = lines.shift();
    const timing = timingLine?.match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if (!timing || !lines.length) throw new TranscriptParseError(`Invalid ${format} block ${index + 1}`);
    return segment(timing[1], timing[2], lines, sourceId ?? String(index + 1));
  });
};

export const normalizeTimedSegments = (segments: readonly TimedTranscriptSegmentInput[]): TimedTranscriptSegmentInput[] => {
  if (!Array.isArray(segments) || !segments.length) throw new TranscriptParseError('Transcript contains no segments');
  const normalized = segments.map((item, index) => {
    if (!item || !Number.isInteger(item.startMs) || !Number.isInteger(item.endMs) || item.startMs < 0 || item.endMs <= item.startMs) {
      throw new TranscriptParseError(`Invalid transcript segment ${index + 1}`);
    }
    const text = typeof item.text === 'string' ? item.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > 10_000) throw new TranscriptParseError(`Invalid transcript segment ${index + 1}`);
    if (item.confidence != null && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) throw new TranscriptParseError(`Invalid confidence at segment ${index + 1}`);
    return { startMs: item.startMs, endMs: item.endMs, text, sourceSegmentId: item.sourceSegmentId?.trim() || null, confidence: item.confidence ?? null };
  });
  return normalized.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
};

export const parseTimedTranscript = (formatValue: string, content: string): TimedTranscriptSegmentInput[] => {
  const format = formatValue.toUpperCase() as TranscriptFormat;
  if (!TRANSCRIPT_FORMATS.includes(format) || format === 'INTERNAL') throw new TranscriptParseError('Unsupported transcript format');
  if (typeof content !== 'string' || !content.trim() || content.length > 5_000_000) throw new TranscriptParseError('Transcript content is invalid');
  const parsed = format === 'SBV' ? parseSbv(content) : parseArrowBlocks(content, format);
  return normalizeTimedSegments(parsed);
};
