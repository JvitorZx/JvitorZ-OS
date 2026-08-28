const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
  GoogleYouTubeReachProvider,
  parseYouTubeReachReport,
  YOUTUBE_REACH_REPORT_TYPE,
} = require('../dist/integrations/youtube/YouTubeReachProvider');
const {
  YouTubeReachDataError,
  YouTubeReachNotAuthorizedError,
  YouTubeReachNotConfiguredError,
  YouTubeReachQuotaError,
} = require('../dist/integrations/youtube/YouTubeReachErrors');

const report = { id: 'report-1', createTime: '2026-08-25T03:00:00Z', downloadUrl: 'https://example.test/report.csv' };
const csv = 'date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n2026-08-24,channel,video-a,1000,7.5\n';
const googleReady = { isConfigured: () => true, isAuthenticated: () => true, getClient: () => ({}) };
const client = ({ jobs = [{ id: 'job-1', reportTypeId: YOUTUBE_REACH_REPORT_TYPE }], reports = [report], error } = {}) => ({
  jobs: {
    list: async () => { if (error) throw error; return { data: { jobs } }; },
    create: async ({ requestBody }) => ({ data: { id: 'created-job', ...requestBody } }),
    reports: { list: async () => ({ data: { reports } }) },
  },
});

describe('YouTube Reporting reach provider', () => {
  test('parses official reach columns without recalculating CTR', () => {
    const rows = parseYouTubeReachReport(csv, report, 'job-1', '2026-08-25T04:00:00Z');
    assert.equal(rows[0].impressions, 1000); assert.equal(rows[0].ctr, 7.5); assert.equal(rows[0].periodEnd, '2026-08-25');
  });
  test('preserves quoted fields and skips aggregate rows without video id', () => {
    const rows = parseYouTubeReachReport('date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n2026-08-24,"video,a",12,5\n2026-08-24,,20,4\n', report, 'job', '2026-08-25T04:00:00Z');
    assert.equal(rows.length, 1); assert.equal(rows[0].videoId, 'video,a');
  });
  test('rejects missing columns and leaves numeric anomalies for data-quality classification', () => {
    assert.throws(() => parseYouTubeReachReport('date,video_id\n2026-08-24,a\n', report, 'job', '2026-08-25T04:00:00Z'), YouTubeReachDataError);
    assert.equal(parseYouTubeReachReport('date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n2026-08-24,a,10,101\n', report, 'job', '2026-08-25T04:00:00Z')[0].ctr, 101);
  });
  test('reuses an existing job and downloads its report once', async () => {
    const downloads = [];
    const provider = new GoogleYouTubeReachProvider({ googleService: googleReady, clientFactory: () => client(), download: async (url) => { downloads.push(url); return csv; } });
    const result = await provider.fetch({ startDate: '2026-08-01', endDate: '2026-08-25' });
    assert.equal(result.state, 'available'); assert.equal(result.jobCreated, false); assert.equal(result.records.length, 1); assert.deepEqual(downloads, ['https://example.test/report.csv']);
  });
  test('creates one missing job and reports the asynchronous wait honestly', async () => {
    const provider = new GoogleYouTubeReachProvider({ googleService: googleReady, clientFactory: () => client({ jobs: [] }), download: async () => csv });
    assert.deepEqual(await provider.fetch({ startDate: '2026-08-01', endDate: '2026-08-25' }), { state: 'waiting', jobId: 'created-job', jobCreated: true, reportsProcessed: 0, records: [] });
  });
  test('reuses the concurrently created job after a creation conflict', async () => {
    let listCalls = 0;
    const concurrentClient = {
      jobs: {
        list: async () => ({
          data: {
            jobs: listCalls++ === 0 ? [] : [{ id: 'concurrent-job', reportTypeId: YOUTUBE_REACH_REPORT_TYPE }],
          },
        }),
        create: async () => { throw { response: { status: 409 } }; },
        reports: { list: async () => ({ data: { reports: [] } }) },
      },
    };
    const provider = new GoogleYouTubeReachProvider({ googleService: googleReady, clientFactory: () => concurrentClient, download: async () => csv });
    assert.deepEqual(await provider.fetch({ startDate: '2026-08-01', endDate: '2026-08-25' }), { state: 'waiting', jobId: 'concurrent-job', jobCreated: false, reportsProcessed: 0, records: [] });
    assert.equal(listCalls, 2);
  });
  test('does not recreate an existing job that has no report yet', async () => {
    const provider = new GoogleYouTubeReachProvider({ googleService: googleReady, clientFactory: () => client({ reports: [] }), download: async () => csv });
    const result = await provider.fetch({ startDate: '2026-08-01', endDate: '2026-08-25' });
    assert.equal(result.state, 'waiting'); assert.equal(result.jobCreated, false);
  });
  test('evaluates configuration and auth only when fetch is called', async () => {
    const missing = new GoogleYouTubeReachProvider({ googleService: { isConfigured: () => false, isAuthenticated: () => false } });
    const unauthorized = new GoogleYouTubeReachProvider({ googleService: { isConfigured: () => true, isAuthenticated: () => false } });
    await assert.rejects(missing.fetch({ startDate: '2026-08-01', endDate: '2026-08-02' }), YouTubeReachNotConfiguredError);
    await assert.rejects(unauthorized.fetch({ startDate: '2026-08-01', endDate: '2026-08-02' }), YouTubeReachNotAuthorizedError);
  });
  test('sanitizes provider quota failures', async () => {
    const provider = new GoogleYouTubeReachProvider({ googleService: googleReady, clientFactory: () => client({ error: { response: { status: 429, data: { secret: 'do-not-leak' } } } }) });
    await assert.rejects(provider.fetch({ startDate: '2026-08-01', endDate: '2026-08-02' }), YouTubeReachQuotaError);
  });
});
