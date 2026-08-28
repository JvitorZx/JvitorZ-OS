import { google, type youtubereporting_v1 } from 'googleapis';
import { parse } from 'csv-parse/sync';
import type { OAuth2Client } from 'google-auth-library';
import { GoogleService } from '../../services/GoogleService';
import {
  toSafeYouTubeReachError,
  YouTubeReachDataError,
  YouTubeReachNotAuthorizedError,
  YouTubeReachNotConfiguredError,
} from './YouTubeReachErrors';

export const YOUTUBE_REACH_SOURCE = 'youtube-reporting-reach';
export const YOUTUBE_REACH_REPORT_TYPE = 'channel_reach_basic_a1';
export const YOUTUBE_REACH_JOB_NAME = 'JvitorZ OS Reach';
export const MAX_REACH_REPORTS_PER_SYNC = 31;

export interface YouTubeReachRecord {
  videoId: string;
  periodStart: string;
  periodEnd: string;
  impressions: number;
  ctr: number;
  reportId: string;
  jobId: string;
  reportCreatedAt: string | null;
  collectedAt: string;
}

export interface YouTubeReachFetchResult {
  state: 'waiting' | 'available';
  jobId: string;
  jobCreated: boolean;
  reportsProcessed: number;
  records: YouTubeReachRecord[];
}

export interface YouTubeReachFetchInput {
  startDate: string;
  endDate: string;
}

export interface YouTubeReachProvider {
  fetch(input: YouTubeReachFetchInput): Promise<YouTubeReachFetchResult>;
}

type ReportingClient = youtubereporting_v1.Youtubereporting;
type DownloadReport = (url: string, auth: OAuth2Client) => Promise<string>;

const nextDate = (value: string): string => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const number = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new YouTubeReachDataError();
  return parsed;
};

const parseReport = (
  csv: string,
  report: youtubereporting_v1.Schema$Report,
  jobId: string,
  collectedAt: string,
): YouTubeReachRecord[] => {
  let rows: Record<string, string>[];
  try {
    rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: false, trim: true });
  } catch {
    throw new YouTubeReachDataError();
  }
  const required = ['date', 'video_id', 'video_thumbnail_impressions', 'video_thumbnail_impressions_ctr'];
  if (rows.length > 0 && required.some((field) => !(field in rows[0]))) throw new YouTubeReachDataError();
  return rows.flatMap((row) => {
    const date = row.date?.trim();
    const videoId = row.video_id?.trim();
    if (!date || !videoId) return [];
    const impressions = number(row.video_thumbnail_impressions);
    const ctr = number(row.video_thumbnail_impressions_ctr);
    return [{
      videoId,
      periodStart: date,
      periodEnd: nextDate(date),
      impressions,
      ctr,
      reportId: report.id ?? '',
      jobId,
      reportCreatedAt: report.createTime ?? null,
      collectedAt,
    }];
  });
};

const defaultDownload: DownloadReport = async (url, auth) => {
  const response = await auth.request<string>({ url, responseType: 'text' });
  if (typeof response.data !== 'string') throw new YouTubeReachDataError();
  return response.data;
};

export class GoogleYouTubeReachProvider implements YouTubeReachProvider {
  private readonly googleService: GoogleService;
  private readonly clientFactory?: () => ReportingClient;
  private readonly download: DownloadReport;

  constructor(dependencies: {
    googleService?: GoogleService;
    clientFactory?: () => ReportingClient;
    download?: DownloadReport;
  } = {}) {
    this.googleService = dependencies.googleService ?? new GoogleService();
    this.clientFactory = dependencies.clientFactory;
    this.download = dependencies.download ?? defaultDownload;
  }

  private client(auth: OAuth2Client): ReportingClient {
    return this.clientFactory?.() ?? google.youtubereporting({ version: 'v1', auth });
  }

  private async findOrCreateJob(client: ReportingClient): Promise<{ id: string; created: boolean }> {
    const find = async (): Promise<string | null> => {
      let token: string | undefined;
      do {
        const response = await client.jobs.list({ pageSize: 50, pageToken: token });
        const found = (response.data.jobs ?? []).find(({ reportTypeId }) => reportTypeId === YOUTUBE_REACH_REPORT_TYPE);
        if (found?.id) return found.id;
        token = response.data.nextPageToken ?? undefined;
      } while (token);
      return null;
    };
    const existing = await find();
    if (existing) return { id: existing, created: false };
    try {
      const created = await client.jobs.create({ requestBody: { reportTypeId: YOUTUBE_REACH_REPORT_TYPE, name: YOUTUBE_REACH_JOB_NAME } });
      if (!created.data.id) throw new YouTubeReachDataError();
      return { id: created.data.id, created: true };
    } catch (error) {
      if ((error as { response?: { status?: unknown } })?.response?.status !== 409) throw error;
      const concurrent = await find();
      if (!concurrent) throw error;
      return { id: concurrent, created: false };
    }
  }

  async fetch(input: YouTubeReachFetchInput): Promise<YouTubeReachFetchResult> {
    if (!this.googleService.isConfigured()) throw new YouTubeReachNotConfiguredError();
    if (!this.googleService.isAuthenticated()) throw new YouTubeReachNotAuthorizedError();
    try {
      const auth = this.googleService.getClient();
      const client = this.client(auth);
      const job = await this.findOrCreateJob(client);
      if (job.created) return { state: 'waiting', jobId: job.id, jobCreated: true, reportsProcessed: 0, records: [] };

      const reports: youtubereporting_v1.Schema$Report[] = [];
      let pageToken: string | undefined;
      do {
        const response = await client.jobs.reports.list({
          jobId: job.id,
          startTimeAtOrAfter: `${input.startDate}T00:00:00.000Z`,
          startTimeBefore: `${nextDate(input.endDate)}T00:00:00.000Z`,
          pageSize: 50,
          pageToken,
        });
        reports.push(...(response.data.reports ?? []));
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken && reports.length < MAX_REACH_REPORTS_PER_SYNC);

      const selected = reports
        .filter(({ id, downloadUrl }) => Boolean(id && downloadUrl))
        .sort((left, right) => String(left.startTime).localeCompare(String(right.startTime)))
        .slice(-MAX_REACH_REPORTS_PER_SYNC);
      if (selected.length === 0) return { state: 'waiting', jobId: job.id, jobCreated: false, reportsProcessed: 0, records: [] };

      const collectedAt = new Date().toISOString();
      const records: YouTubeReachRecord[] = [];
      for (const report of selected) {
        const csv = await this.download(report.downloadUrl!, auth);
        records.push(...parseReport(csv, report, job.id, collectedAt));
      }
      return { state: 'available', jobId: job.id, jobCreated: false, reportsProcessed: selected.length, records };
    } catch (error) {
      throw toSafeYouTubeReachError(error);
    }
  }
}

export const parseYouTubeReachReport = parseReport;
