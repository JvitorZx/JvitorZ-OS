import type { VideoReachSnapshot } from '@prisma/client';
import { classifyFreshness, type DataFreshness } from './FreshnessPolicy';

export const DATA_QUALITY_STATES = [
  'GOOD', 'PARTIAL', 'STALE', 'MISSING', 'INCONSISTENT', 'ERROR',
] as const;
export type DataQualityState = typeof DATA_QUALITY_STATES[number];

export interface DataQualityReason {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface DataQualityReport {
  state: DataQualityState;
  availability: number;
  freshness: DataFreshness;
  completeness: number;
  consistency: number;
  sampleSize: number;
  sourceReliability: number;
  latestCollectedAt: Date | null;
  latestPeriodEnd: Date | null;
  reasons: DataQualityReason[];
}

const validNumber = (value: number): boolean => Number.isFinite(value);
const rounded = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;

export class DataQualityService {
  evaluateReach(
    records: readonly VideoReachSnapshot[],
    options: { knownVideoIds?: ReadonlySet<string>; now?: Date } = {},
  ): DataQualityReport {
    if (records.length === 0) {
      return {
        state: 'MISSING', availability: 0, freshness: 'MISSING', completeness: 0,
        consistency: 1, sampleSize: 0, sourceReliability: 1, latestCollectedAt: null, latestPeriodEnd: null,
        reasons: [{ code: 'NO_REACH_REPORT', message: 'Nenhum relatório de alcance foi coletado.', severity: 'info' }],
      };
    }

    const reasons: DataQualityReason[] = [];
    const latestCollectedAt = records.reduce<Date | null>((latest, record) => (
      !latest || record.collectedAt > latest ? record.collectedAt : latest
    ), null);
    const latestPeriodEnd = records.reduce<Date | null>((latest, record) => (
      !latest || record.periodEnd > latest ? record.periodEnd : latest
    ), null);
    const freshness = classifyFreshness(latestPeriodEnd, options.now).state;
    let invalid = 0;
    let warnings = 0;
    const seen = new Set<string>();

    for (const record of records) {
      const key = `${record.projectId ?? ''}|${record.videoId}|${record.periodStart.toISOString()}|${record.periodEnd.toISOString()}|${record.source}`;
      if (seen.has(key)) {
        invalid += 1;
        reasons.push({ code: 'DUPLICATE_PERIOD', message: `Período duplicado para o vídeo ${record.videoId}.`, severity: 'error' });
      }
      seen.add(key);
      if (!record.videoId.trim() || (options.knownVideoIds && !options.knownVideoIds.has(record.videoId))) {
        warnings += 1;
        reasons.push({ code: 'UNKNOWN_VIDEO', message: `O vídeo ${record.videoId || '(vazio)'} não é conhecido pela base local.`, severity: 'warning' });
      }
      if (!validNumber(record.impressions) || record.impressions < 0) {
        invalid += 1;
        reasons.push({ code: 'INVALID_IMPRESSIONS', message: `Impressões inválidas para o vídeo ${record.videoId}.`, severity: 'error' });
      }
      if (!validNumber(record.ctr) || record.ctr < 0 || record.ctr > 100) {
        invalid += 1;
        reasons.push({ code: 'INVALID_CTR', message: `CTR fora da faixa de 0 a 100% para o vídeo ${record.videoId}.`, severity: 'error' });
      }
      if (record.periodStart >= record.periodEnd || record.collectedAt < record.periodStart) {
        invalid += 1;
        reasons.push({ code: 'INVALID_PERIOD', message: `Período ou coleta inválida para o vídeo ${record.videoId}.`, severity: 'error' });
      }
    }

    if (freshness === 'STALE') reasons.push({ code: 'STALE_DATA', message: 'Os dados de alcance estão desatualizados.', severity: 'warning' });
    if (freshness === 'HISTORICAL') reasons.push({ code: 'HISTORICAL_DATA', message: 'Os dados de alcance são apenas históricos.', severity: 'warning' });
    if (records.length < 3) reasons.push({ code: 'SMALL_SAMPLE', message: 'A amostra de alcance ainda é pequena.', severity: 'warning' });

    const consistency = rounded(1 - invalid / Math.max(1, records.length * 5));
    const completeness = rounded(records.filter(({ impressions, ctr }) => (
      validNumber(impressions) && validNumber(ctr)
    )).length / records.length);
    const state: DataQualityState = invalid > 0
      ? 'INCONSISTENT'
      : freshness === 'STALE' || freshness === 'HISTORICAL'
        ? 'STALE'
        : records.length < 3 || completeness < 1 || warnings > 0
          ? 'PARTIAL'
          : 'GOOD';

    return {
      state,
      availability: 1,
      freshness,
      completeness,
      consistency,
      sampleSize: records.length,
      sourceReliability: 1,
      latestCollectedAt,
      latestPeriodEnd,
      reasons,
    };
  }

  providerError(message = 'O provider de alcance falhou.'): DataQualityReport {
    return {
      state: 'ERROR', availability: 0, freshness: 'MISSING', completeness: 0,
      consistency: 0, sampleSize: 0, sourceReliability: 1, latestCollectedAt: null, latestPeriodEnd: null,
      reasons: [{ code: 'PROVIDER_ERROR', message, severity: 'error' }],
    };
  }
}
