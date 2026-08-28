export const DATA_FRESHNESS_POLICY = Object.freeze({
  recentHours: 72,
  staleHours: 24 * 14,
});

export type DataFreshness = 'RECENT' | 'STALE' | 'HISTORICAL' | 'MISSING';

export const classifyFreshness = (
  collectedAt: Date | null | undefined,
  now = new Date(),
): { state: DataFreshness; ageHours: number | null } => {
  if (!collectedAt || Number.isNaN(collectedAt.getTime())) return { state: 'MISSING', ageHours: null };
  const ageHours = Math.max(0, (now.getTime() - collectedAt.getTime()) / 3_600_000);
  if (ageHours <= DATA_FRESHNESS_POLICY.recentHours) return { state: 'RECENT', ageHours };
  if (ageHours <= DATA_FRESHNESS_POLICY.staleHours) return { state: 'STALE', ageHours };
  return { state: 'HISTORICAL', ageHours };
};
