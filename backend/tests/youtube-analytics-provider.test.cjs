const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
  YouTubeAnalyticsPerformanceProvider,
  YOUTUBE_ANALYTICS_METRICS,
  YOUTUBE_ANALYTICS_SOURCE,
} = require('../dist/integrations/youtube/YouTubeAnalyticsPerformanceProvider');
const {
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeAnalyticsQuotaError,
  YouTubeAnalyticsTemporaryError,
  YouTubeVideoNotFoundError,
} = require('../dist/integrations/youtube/YouTubeAnalyticsErrors');
const {
  parseYouTubeDurationSeconds,
} = require('../dist/integrations/youtube/YouTubeVideoMetadataService');

const configuredGoogle = {
  isConfigured: () => true,
  isAuthenticated: () => true,
  getClient: () => ({ credentials: { refresh_token: 'not-used-by-tests' } }),
};

const metadataFor = (entries) => ({
  async getByIds(ids) {
    return new Map(ids.flatMap((id) => entries[id] ? [[id, entries[id]]] : []));
  },
  async listRecentVideoIds() { return []; },
});

const columns = [
  'video',
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
];

const createProvider = ({ rows = [], metadata = {}, query, googleService = configuredGoogle, options = {} } = {}) => {
  let calls = 0;
  let received;
  const provider = new YouTubeAnalyticsPerformanceProvider({
    startDate: '2026-08-01',
    endDate: '2026-08-24',
    maxResults: 10,
    ...options,
  }, {
    googleService,
    metadata: metadataFor(metadata),
    clientFactory: () => ({
      reports: {
        async query(parameters) {
          calls += 1;
          received = parameters;
          if (query) return query(parameters);
          return {
            data: {
              columnHeaders: columns.map((name) => ({ name })),
              rows,
            },
          };
        },
      },
    }),
  });
  return { provider, getCalls: () => calls, getReceived: () => received };
};

const videoMetadata = (videoId, overrides = {}) => ({
  videoId,
  title: `Video ${videoId}`,
  publishedAt: '2026-08-03T12:00:00.000Z',
  durationSeconds: 615,
  ...overrides,
});

describe('YouTube Analytics performance provider', () => {
  test('implements the neutral provider contract and identifies its source', async () => {
    const { provider } = createProvider();
    assert.equal(provider.name, YOUTUBE_ANALYTICS_SOURCE);
    assert.equal(typeof provider.fetch, 'function');
    assert.deepEqual(await provider.fetch(), []);
  });

  test('queries the permitted metrics and configured period without extra metrics', async () => {
    const { provider, getReceived } = createProvider();
    await provider.fetch();
    assert.equal(getReceived().ids, 'channel==MINE');
    assert.equal(getReceived().dimensions, 'video');
    assert.equal(getReceived().metrics, YOUTUBE_ANALYTICS_METRICS.join(','));
    assert.equal(getReceived().startDate, '2026-08-01');
    assert.equal(getReceived().endDate, '2026-08-24');
    assert.equal(getReceived().maxResults, 10);
  });

  test('adds a video filter for a bounded video sync', async () => {
    const { provider, getReceived } = createProvider({ options: { videoIds: ['one', 'two', 'one'] } });
    await provider.fetch();
    assert.equal(getReceived().filters, 'video==one,two');
  });

  test('maps analytics and Data API metadata without inventing CTR or impressions', async () => {
    const { provider } = createProvider({
      rows: [['abc', 100, 450, 270, 45, 4, 1, 12, 3]],
      metadata: { abc: videoMetadata('abc') },
    });
    const [record] = await provider.fetch();
    assert.equal(record.videoId, 'abc');
    assert.equal(record.title, 'Video abc');
    assert.equal(record.views, 100);
    assert.equal(record.watchTimeMinutes, 450);
    assert.equal(record.averageViewDurationSeconds, 270);
    assert.equal(record.averageViewPercentage, 45);
    assert.equal(record.subscribersGained, 4);
    assert.equal(record.subscribersLost, 1);
    assert.equal(record.likes, 12);
    assert.equal(record.comments, 3);
    assert.equal(record.durationSeconds, 615);
    assert.equal(record.impressions, null);
    assert.equal(record.ctr, null);
    assert.equal(record.periodStart, '2026-08-01');
    assert.equal(record.periodEnd, '2026-08-24');
    assert.ok(record.collectedAt instanceof Date);
  });

  test('keeps absent metrics null and preserves chronological metadata', async () => {
    const { provider } = createProvider({
      rows: [['abc', 100]],
      metadata: { abc: videoMetadata('abc', { publishedAt: null, durationSeconds: null }) },
    });
    const [record] = await provider.fetch();
    assert.equal(record.averageViewPercentage, null);
    assert.equal(record.subscribersLost, null);
    assert.equal(record.publishedAt, null);
    assert.equal(record.durationSeconds, null);
  });

  test('preserves the order returned by YouTube Analytics', async () => {
    const { provider } = createProvider({
      rows: [['b', 200], ['a', 100]],
      metadata: { a: videoMetadata('a'), b: videoMetadata('b') },
    });
    assert.deepEqual((await provider.fetch()).map(({ videoId }) => videoId), ['b', 'a']);
  });

  test('does not fabricate records when Data API metadata is unavailable', async () => {
    const { provider } = createProvider({ rows: [['missing', 100]] });
    assert.deepEqual(await provider.fetch(), []);
  });

  test('reports a missing specifically requested video safely', async () => {
    const { provider } = createProvider({ options: { videoIds: ['missing'] } });
    await assert.rejects(provider.fetch(), YouTubeVideoNotFoundError);
  });

  test('accepts an existing requested video with no analytics rows as an empty period', async () => {
    const { provider } = createProvider({
      options: { videoIds: ['quiet'] },
      metadata: { quiet: videoMetadata('quiet') },
    });
    assert.deepEqual(await provider.fetch(), []);
  });

  test('fails before network when Google is not configured or not authorized', async () => {
    const missing = createProvider({ googleService: { isConfigured: () => false, isAuthenticated: () => false } });
    const unauthorized = createProvider({ googleService: { isConfigured: () => true, isAuthenticated: () => false } });
    await assert.rejects(missing.provider.fetch(), YouTubeAnalyticsNotConfiguredError);
    await assert.rejects(unauthorized.provider.fetch(), YouTubeAnalyticsNotAuthorizedError);
    assert.equal(missing.getCalls(), 0);
    assert.equal(unauthorized.getCalls(), 0);
  });

  test('maps invalid_grant to reauthorization without exposing the provider payload', async () => {
    const { provider } = createProvider({ query: async () => {
      throw { response: { data: { error: 'invalid_grant', secret: 'must-not-leak' } } };
    } });
    await assert.rejects(provider.fetch(), (error) => {
      assert.ok(error instanceof YouTubeAnalyticsNotAuthorizedError);
      assert.ok(!error.message.includes('must-not-leak'));
      return true;
    });
  });

  test('maps quota and timeout failures to safe domain errors', async () => {
    const quota = createProvider({ query: async () => {
      throw { response: { status: 403, data: { error: { errors: [{ reason: 'quotaExceeded' }] } } } };
    } });
    const timeout = createProvider({ query: async () => { throw { code: 'ETIMEDOUT' }; } });
    await assert.rejects(quota.provider.fetch(), YouTubeAnalyticsQuotaError);
    await assert.rejects(timeout.provider.fetch(), YouTubeAnalyticsTemporaryError);
  });

  test('allows refresh-capable authentication to proceed through the existing OAuth client', async () => {
    const googleService = {
      isConfigured: () => true,
      isAuthenticated: () => true,
      getClient: () => ({ credentials: { refresh_token: 'refresh-is-handled-by-googleapis' } }),
    };
    const { provider, getCalls } = createProvider({ googleService });
    await provider.fetch();
    assert.equal(getCalls(), 1);
  });

  test('parses YouTube durations deterministically', () => {
    assert.equal(parseYouTubeDurationSeconds('PT1H2M3S'), 3723);
    assert.equal(parseYouTubeDurationSeconds('PT10M15.5S'), 615.5);
    assert.equal(parseYouTubeDurationSeconds('invalid'), null);
    assert.equal(parseYouTubeDurationSeconds(null), null);
  });
});
