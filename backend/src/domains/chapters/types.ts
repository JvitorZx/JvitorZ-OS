export const TRANSCRIPT_FORMATS = ['SBV', 'SRT', 'VTT', 'INTERNAL'] as const;
export const CHAPTER_SET_STATUSES = ['DRAFT', 'SELECTED', 'ARCHIVED', 'STALE'] as const;

export type TranscriptFormat = typeof TRANSCRIPT_FORMATS[number];
export type ChapterSetStatus = typeof CHAPTER_SET_STATUSES[number];

export interface TimedTranscriptSegmentInput {
  startMs: number;
  endMs: number;
  text: string;
  sourceSegmentId?: string | null;
  confidence?: number | null;
}

export interface ChapterCandidate {
  position: number;
  startMs: number;
  endMs: number | null;
  title: string;
  rationale: string;
  segmentStartPosition: number;
  segmentEndPosition: number;
  confidence: number | null;
}

export interface ChapterEditableInput {
  id?: string;
  startMs: number;
  title: string;
}
