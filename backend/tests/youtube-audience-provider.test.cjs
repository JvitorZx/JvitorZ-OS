const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
  GoogleYouTubeAudienceProvider,
} = require('../dist/integrations/youtube/YouTubeAudienceProvider');
const {
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeAnalyticsQuotaError,
} = require('../dist/integrations/youtube/YouTubeAnalyticsErrors');

const googleReady = {
  isConfigured: () => true,
  isAuthenticated: () => true,
  getClient: () => ({}),
};

const responseFor = (dimensions) => {
  const creator = { name: 'creatorContentType' };
  const metrics = [
    { name: 'engagedViews' },
    { name: 'views' },
    { name: 'estimatedMinutesWatched' },
  ];
  if (dimensions.startsWith('insightTrafficSourceType')) return {
    columnHeaders: [{ name: 'insightTrafficSourceType' }, creator, ...metrics],
    rows: [
      ['YT_SEARCH', 'VIDEO_ON_DEMAND', 90, 100, 500],
      ['SHORTS', 'SHORTS', 180, 200, 300],
      ['RELATED_VIDEO', 'VIDEO_ON_DEMAND', 70, 80, 450],
      ['BROWSE', 'VIDEO_ON_DEMAND', 60, 70, 400],
      ['EXT_URL', 'VIDEO_ON_DEMAND', 20, 30, 100],
    ],
  };
  if (dimensions.startsWith('insightTrafficSourceDetail')) return {
    columnHeaders: [{ name: 'insightTrafficSourceDetail' }, creator, ...metrics],
    rows: [['jogo teste', 'VIDEO_ON_DEMAND', 20, 25, 90]],
  };
  if (dimensions.startsWith('country')) return {
    columnHeaders: [{ name: 'country' }, creator, ...metrics, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }],
    rows: [['BR', 'VIDEO_ON_DEMAND', 400, 450, 1800, 240, 52]],
  };
  if (dimensions.startsWith('deviceType')) return {
    columnHeaders: [{ name: 'deviceType' }, creator, ...metrics],
    rows: [['MOBILE', 'SHORTS', 200, 230, 500], ['COMPUTER', 'VIDEO_ON_DEMAND', 100, 120, 700]],
  };
  return {
    columnHeaders: [{ name: 'subscribedStatus' }, creator, ...metrics, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }],
    rows: [['SUBSCRIBED', 'VIDEO_ON_DEMAND', 130, 150, 900, 260, 57], ['UNSUBSCRIBED', 'VIDEO_ON_DEMAND', 300, 350, 1200, 180, 42]],
  };
};

describe('YouTube Analytics audience provider', () => {
  test('uses official report dimensions and preserves official segment names', async () => {
    const calls = [];
    const provider = new GoogleYouTubeAudienceProvider({
      googleService: googleReady,
      clientFactory: () => ({ reports: { query: async (request) => {
        calls.push(structuredClone(request));
        return { data: responseFor(request.dimensions) };
      } } }),
    });
    const result = await provider.fetch({ startDate: '2026-08-01', endDate: '2026-08-07' });

    assert.equal(calls.length, 5);
    assert.deepEqual(calls.map(({ dimensions }) => dimensions), [
      'insightTrafficSourceType,creatorContentType',
      'insightTrafficSourceDetail,creatorContentType',
      'country,creatorContentType',
      'deviceType,creatorContentType',
      'subscribedStatus,creatorContentType',
    ]);
    assert.deepEqual(calls[1].filters, 'insightTrafficSourceType==YT_SEARCH');
    assert.equal(calls[1].sort, '-views');
    assert.equal(calls[1].maxResults, 25);
    assert.ok(result.records.some(({ dimension, segment }) => dimension === 'traffic_source' && segment === 'RELATED_VIDEO'));
    assert.ok(result.records.some(({ dimension, segment }) => dimension === 'traffic_source' && segment === 'BROWSE'));
    assert.ok(result.records.some(({ dimension, segment }) => dimension === 'traffic_source' && segment === 'SHORTS'));
    assert.ok(result.records.some(({ dimension, segment }) => dimension === 'traffic_source' && segment === 'EXT_URL'));
    assert.ok(result.records.some(({ dimension, segment }) => dimension === 'search_term' && segment === 'jogo teste'));
    assert.ok(result.records.some(({ dimension, segment }) => dimension === 'country' && segment === 'BR'));
    assert.ok(result.records.some(({ dimension, segment }) => dimension === 'device_type' && segment === 'MOBILE'));
    assert.ok(result.records.some(({ dimension, segment }) => dimension === 'subscribed_status' && segment === 'UNSUBSCRIBED'));
    assert.deepEqual(result.missingDimensions, []);
  });

  test('marks a suppressed search detail report as missing without inventing terms', async () => {
    const provider = new GoogleYouTubeAudienceProvider({
      googleService: googleReady,
      clientFactory: () => ({ reports: { query: async (request) => ({
        data: request.dimensions.startsWith('insightTrafficSourceDetail')
          ? { columnHeaders: [], rows: [] }
          : responseFor(request.dimensions),
      }) } }),
    });
    const result = await provider.fetch({ startDate: '2026-08-01', endDate: '2026-08-07' });
    assert.ok(result.missingDimensions.includes('search_term'));
    assert.equal(result.records.some(({ dimension }) => dimension === 'search_term'), false);
  });

  test('evaluates configuration and authorization lazily', async () => {
    const missing = new GoogleYouTubeAudienceProvider({ googleService: { isConfigured: () => false, isAuthenticated: () => false } });
    const unauthorized = new GoogleYouTubeAudienceProvider({ googleService: { isConfigured: () => true, isAuthenticated: () => false } });
    await assert.rejects(missing.fetch({ startDate: '2026-08-01', endDate: '2026-08-02' }), YouTubeAnalyticsNotConfiguredError);
    await assert.rejects(unauthorized.fetch({ startDate: '2026-08-01', endDate: '2026-08-02' }), YouTubeAnalyticsNotAuthorizedError);
  });

  test('sanitizes quota failures without leaking provider payloads', async () => {
    const provider = new GoogleYouTubeAudienceProvider({
      googleService: googleReady,
      clientFactory: () => ({ reports: { query: async () => { throw { response: { status: 429, data: { access_token: 'never-log' } } }; } } }),
    });
    await assert.rejects(
      provider.fetch({ startDate: '2026-08-01', endDate: '2026-08-02' }),
      (error) => error instanceof YouTubeAnalyticsQuotaError && !error.message.includes('never-log'),
    );
  });
});
