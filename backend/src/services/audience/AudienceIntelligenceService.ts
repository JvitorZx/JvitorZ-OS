import type { AudienceSnapshot } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { AudienceSnapshotRepository } from '../../database/repositories/AudienceSnapshotRepository';
import { DataQualityService } from '../../domains/data-quality/DataQualityService';
import { AUDIENCE_DIMENSIONS } from '../../integrations/youtube/YouTubeAudienceProvider';

const total = (rows: readonly AudienceSnapshot[], field: 'views' | 'watchTimeMinutes') => rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
const currentPeriod = (rows: AudienceSnapshot[]) => { const first = rows[0]; return first ? rows.filter((row) => row.periodStart.getTime() === first.periodStart.getTime() && row.periodEnd.getTime() === first.periodEnd.getTime()) : []; };
const group = (rows: AudienceSnapshot[]) => {
  const values = new Map<string, { segment: string; views: number; watchTimeMinutes: number; durationTotal: number; durationWeight: number; percentageTotal: number; percentageWeight: number; formats: Set<string> }>();
  for (const row of rows) {
    const item = values.get(row.segment) ?? { segment: row.segment, views: 0, watchTimeMinutes: 0, durationTotal: 0, durationWeight: 0, percentageTotal: 0, percentageWeight: 0, formats: new Set<string>() };
    const weight = Math.max(0, row.views ?? 0);
    item.views += row.views ?? 0; item.watchTimeMinutes += row.watchTimeMinutes ?? 0;
    if (row.averageViewDurationSeconds !== null && weight > 0) { item.durationTotal += row.averageViewDurationSeconds * weight; item.durationWeight += weight; }
    if (row.averageViewPercentage !== null && weight > 0) { item.percentageTotal += row.averageViewPercentage * weight; item.percentageWeight += weight; }
    if (row.format) item.formats.add(row.format); values.set(row.segment, item);
  }
  const views = [...values.values()].reduce((sum, item) => sum + item.views, 0);
  return [...values.values()].map((item) => ({ segment: item.segment, views: item.views, watchTimeMinutes: item.watchTimeMinutes, averageViewDurationSeconds: item.durationWeight ? item.durationTotal / item.durationWeight : null, averageViewPercentage: item.percentageWeight ? item.percentageTotal / item.percentageWeight : null, viewShare: views ? item.views / views : 0, formats: [...item.formats] })).sort((a, b) => b.views - a.views || a.segment.localeCompare(b.segment));
};

export class AudienceIntelligenceService {
  constructor(
    private readonly snapshots = new AudienceSnapshotRepository(DatabaseService.client),
    private readonly quality = new DataQualityService(),
    private readonly now: () => Date = () => new Date(),
  ) {}
  async summary(projectId?: string | null) {
    const rows = currentPeriod(await this.snapshots.findAll({ projectId: projectId?.trim() || null }));
    const byDimension = (dimension: string) => group(rows.filter((row) => row.dimension === dimension));
    const trafficSources = byDimension('traffic_source'); const countries = byDimension('country'); const devices = byDimension('device_type'); const subscribed = byDimension('subscribed_status'); const searchTerms = byDimension('search_term');
    const quality = this.quality.evaluateAudience(rows, AUDIENCE_DIMENSIONS, this.now());
    const missingData = AUDIENCE_DIMENSIONS.filter((dimension) => !rows.some((row) => row.dimension === dimension));
    const top = trafficSources[0]; const concentration = trafficSources.reduce((sum, item) => sum + item.viewShare ** 2, 0);
    const facts = [top ? `Principal fonte: ${top.segment} (${Math.round(top.viewShare * 100)}% das views no período).` : null, countries[0] ? `Principal país: ${countries[0].segment} (${Math.round(countries[0].viewShare * 100)}%).` : null, devices[0] ? `Principal dispositivo: ${devices[0].segment} (${Math.round(devices[0].viewShare * 100)}%).` : null].filter((value): value is string => Boolean(value));
    const signals = [concentration >= 0.5 && top ? `Distribuição concentrada em ${top.segment}; concentração observada, sem causalidade presumida.` : null, trafficSources.some(({ segment, viewShare }) => segment === 'SHORTS' && viewShare >= 0.5) ? 'A maior parte das views observadas veio do feed de Shorts.' : null].filter((value): value is string => Boolean(value));
    return { period: rows[0] ? { startDate: rows[0].periodStart, endDate: rows[0].periodEnd } : null, trafficSources, countries, devices, subscribedStatus: subscribed, searchTerms, quality, facts, signals, hypotheses: signals.length ? ['Mudanças de mix podem alterar duração e watch time; confirme em períodos equivalentes.'] : [], recommendations: top ? ['Compare o mix atual com um período anterior equivalente antes de ajustar a estratégia editorial.'] : [], missingData, confidence: Number((Math.min(1, rows.length / 10) * quality.consistency * quality.completeness).toFixed(2)) };
  }
  async traffic(projectId?: string | null) { const summary = await this.summary(projectId); return { period: summary.period, sources: summary.trafficSources, searchTerms: summary.searchTerms, quality: summary.quality, signals: summary.signals, missingData: summary.missingData.filter((item) => item.includes('traffic') || item.includes('search')) }; }
  async compare(input: { projectId?: string | null; currentStart: Date; currentEnd: Date; previousStart: Date; previousEnd: Date }) {
    const [current, previous] = await Promise.all([this.snapshots.findAll({ projectId: input.projectId?.trim() || null, startDate: input.currentStart, endDate: input.currentEnd }), this.snapshots.findAll({ projectId: input.projectId?.trim() || null, startDate: input.previousStart, endDate: input.previousEnd })]);
    const summarize = (rows: AudienceSnapshot[]) => ({ views: total(rows, 'views'), watchTimeMinutes: total(rows, 'watchTimeMinutes'), traffic: group(rows.filter((row) => row.dimension === 'traffic_source')), countries: group(rows.filter((row) => row.dimension === 'country')), devices: group(rows.filter((row) => row.dimension === 'device_type')) });
    const a = summarize(current); const b = summarize(previous);
    const changed = (left?: { segment: string }, right?: { segment: string }) => left?.segment && right?.segment ? left.segment !== right.segment : null;
    return { current: a, previous: b, changes: { views: b.views ? (a.views - b.views) / b.views : null, watchTimeMinutes: b.watchTimeMinutes ? (a.watchTimeMinutes - b.watchTimeMinutes) / b.watchTimeMinutes : null, principalTrafficChanged: changed(a.traffic[0], b.traffic[0]), principalCountryChanged: changed(a.countries[0], b.countries[0]), principalDeviceChanged: changed(a.devices[0], b.devices[0]) }, quality: this.quality.evaluateAudience(current, AUDIENCE_DIMENSIONS, this.now()), missingData: [...(!current.length ? ['current period'] : []), ...(!previous.length ? ['previous period'] : [])] };
  }
}
