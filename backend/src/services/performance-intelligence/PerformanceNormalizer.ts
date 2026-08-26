import { createHash } from 'node:crypto';
import type { VideoPerformanceSnapshot } from '@prisma/client';
import type { RawVideoPerformanceRecord } from '../../domains/performance-intelligence/PerformanceProvider';
import type { SaveVideoPerformanceSnapshotData } from '../../database/repositories/VideoPerformanceSnapshotRepository';

export class PerformanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerformanceValidationError';
  }
}

const textOrNull = (value: unknown, field: string, maxLength = 500): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new PerformanceValidationError(`${field} must be text`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (Array.from(normalized).length > maxLength) {
    throw new PerformanceValidationError(`${field} is too long`);
  }
  return normalized;
};

const requiredText = (value: unknown, field: string, maxLength: number): string => {
  const normalized = textOrNull(value, field, maxLength);
  if (!normalized) throw new PerformanceValidationError(`${field} is required`);
  return normalized;
};

const numberOrNull = (
  value: unknown,
  field: string,
  options: { integer?: boolean; max?: number } = {},
): number | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PerformanceValidationError(`${field} must be a non-negative number`);
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new PerformanceValidationError(`${field} must be an integer`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new PerformanceValidationError(`${field} must be at most ${options.max}`);
  }
  return value;
};

const dateOrNull = (value: unknown, field: string): Date | null => {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new PerformanceValidationError(`${field} must be a valid date`);
  return date;
};

export const buildPerformanceIngestionKey = (input: {
  projectId: string | null;
  source: string;
  videoId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
}): string => createHash('sha256').update(JSON.stringify({
  source: input.source,
  projectId: input.projectId,
  videoId: input.videoId,
  periodStart: input.periodStart?.toISOString() ?? null,
  periodEnd: input.periodEnd?.toISOString() ?? null,
})).digest('hex');

export const normalizePerformanceRecord = (
  record: RawVideoPerformanceRecord,
  source: string,
  fallbackProjectId?: string | null,
): SaveVideoPerformanceSnapshotData => {
  const normalizedSource = requiredText(source, 'source', 120);
  const videoId = requiredText(record.videoId, 'videoId', 160);
  const projectId = textOrNull(record.projectId, 'projectId', 160)
    ?? (fallbackProjectId?.trim() || null);
  const periodStart = dateOrNull(record.periodStart, 'periodStart');
  const periodEnd = dateOrNull(record.periodEnd, 'periodEnd');
  if (periodStart && periodEnd && periodStart > periodEnd) {
    throw new PerformanceValidationError('periodStart must not be after periodEnd');
  }
  const confidence = record.confidence === undefined
    ? 1
    : numberOrNull(record.confidence, 'confidence', { max: 1 });
  const collectedAt = dateOrNull(record.collectedAt, 'collectedAt') ?? new Date();

  return {
    projectId,
    ingestionKey: buildPerformanceIngestionKey({
      projectId,
      source: normalizedSource,
      videoId,
      periodStart,
      periodEnd,
    }),
    videoId,
    title: requiredText(record.title, 'title', 500),
    game: textOrNull(record.game, 'game', 160),
    series: textOrNull(record.series, 'series', 160),
    format: textOrNull(record.format, 'format', 160),
    publishedAt: dateOrNull(record.publishedAt, 'publishedAt'),
    periodStart,
    periodEnd,
    views: numberOrNull(record.views, 'views'),
    engagedViews: numberOrNull(record.engagedViews, 'engagedViews'),
    impressions: numberOrNull(record.impressions, 'impressions'),
    ctr: numberOrNull(record.ctr, 'ctr', { max: 100 }),
    durationSeconds: numberOrNull(record.durationSeconds, 'durationSeconds'),
    averageViewDurationSeconds: numberOrNull(record.averageViewDurationSeconds, 'averageViewDurationSeconds'),
    averageViewPercentage: numberOrNull(record.averageViewPercentage, 'averageViewPercentage', { max: 100 }),
    watchTimeMinutes: numberOrNull(record.watchTimeMinutes, 'watchTimeMinutes'),
    subscribersGained: numberOrNull(record.subscribersGained, 'subscribersGained', { integer: true }),
    subscribersLost: numberOrNull(record.subscribersLost, 'subscribersLost', { integer: true }),
    likes: numberOrNull(record.likes, 'likes', { integer: true }),
    comments: numberOrNull(record.comments, 'comments', { integer: true }),
    source: normalizedSource,
    confidence: confidence ?? 1,
    collectedAt,
  } satisfies Omit<VideoPerformanceSnapshot, 'id' | 'createdAt' | 'updatedAt'>;
};
