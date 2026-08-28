const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const express = require('express');

const { createDashboardRouter } = require('../dist/routes/dashboard');
const { createYouTubeRouter } = require('../dist/routes/youtube');

let server;
let baseUrl;
let dependencies;
let youtubeDependencies;

before(async () => {
  const app = express();
  app.use('/api/dashboard', (req, res, next) => createDashboardRouter(dependencies)(req, res, next));
  app.use('/api/youtube', (req, res, next) => createYouTubeRouter(youtubeDependencies)(req, res, next));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => new Promise((resolve) => server.close(resolve)));

const getDashboard = async () => {
  const response = await fetch(`${baseUrl}/api/dashboard`);
  return { status: response.status, body: await response.json() };
};

describe('Dashboard degraded Google mode', { concurrency: false }, () => {
  test('starts and returns operational local data without Google authentication', async () => {
    const calls = [];
    dependencies = {
      googleService: { isAuthenticated: () => false },
      dashboardService: { getDashboard: async (input) => { calls.push(input); return { status: { youtubeConnected: false }, supervisor: {} }; } },
    };
    const result = await getDashboard();
    assert.equal(result.status, 200);
    assert.equal(result.body.unauthorized, true);
    assert.match(result.body.authUrl, /\/api\/auth\/google$/);
    assert.deepEqual(calls, [{ youtubeConnected: false }]);
  });

  test('turns invalid_grant into a safe reconnect state instead of HTTP 500', async () => {
    const calls = [];
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    dependencies = {
      googleService: { isAuthenticated: () => true },
      dashboardService: {
        async getDashboard(input) {
          calls.push(input);
          if (input.youtubeConnected) throw { response: { status: 400, data: { error: 'invalid_grant', refresh_token: 'secret' } } };
          return { status: { youtubeConnected: false }, channel: { title: null } };
        },
      },
    };
    try {
      const result = await getDashboard();
      assert.equal(result.status, 200);
      assert.equal(result.body.unauthorized, true);
      assert.deepEqual(calls, [{ youtubeConnected: true }, { youtubeConnected: false }]);
      assert.doesNotMatch(JSON.stringify(warnings), /refresh_token|secret/);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('keeps unexpected failures sanitized', async () => {
    const originalError = console.error;
    console.error = () => {};
    dependencies = {
      googleService: { isAuthenticated: () => true },
      dashboardService: { getDashboard: async () => { throw new Error('private stack payload'); } },
    };
    try {
      const result = await getDashboard();
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { error: 'Failed to fetch dashboard data' });
      assert.doesNotMatch(JSON.stringify(result.body), /private|stack/);
    } finally {
      console.error = originalError;
    }
  });

  test('keeps local services available during temporary Google network failure', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    dependencies = {
      googleService: { isAuthenticated: () => true },
      dashboardService: {
        async getDashboard({ youtubeConnected }) {
          if (youtubeConnected) throw Object.assign(new Error('network'), { code: 'EACCES' });
          return { status: { youtubeConnected: false }, supervisor: { automations: { active: 1 } } };
        },
      },
    };
    try {
      const result = await getDashboard();
      assert.equal(result.status, 200);
      assert.equal(result.body.youtubeUnavailable, true);
      assert.equal(result.body.unauthorized, false);
      assert.equal(result.body.supervisor.automations.active, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('sanitizes a local fallback failure after Google becomes unavailable', async () => {
    const originalWarn = console.warn;
    const originalError = console.error;
    const errors = [];
    console.warn = () => {};
    console.error = (...args) => errors.push(args);
    dependencies = {
      googleService: { isAuthenticated: () => true },
      dashboardService: {
        async getDashboard({ youtubeConnected }) {
          if (youtubeConnected) throw Object.assign(new Error('provider private payload'), { code: 'ETIMEDOUT' });
          throw new Error('local private payload');
        },
      },
    };
    try {
      const result = await getDashboard();
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { error: 'Failed to fetch dashboard data' });
      assert.doesNotMatch(JSON.stringify(errors), /provider private|local private|stack/);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  });
});

describe('YouTube route expected states', { concurrency: false }, () => {
  const getChannel = async () => {
    const response = await fetch(`${baseUrl}/api/youtube/channel`);
    return { status: response.status, body: await response.json() };
  };

  test('returns 401 without calling the channel integration when OAuth is absent', async () => {
    let calls = 0;
    youtubeDependencies = {
      googleService: { isAuthenticated: () => false },
      createChannelService: () => ({ getChannelInfo: async () => { calls += 1; } }),
    };
    const result = await getChannel();
    assert.equal(result.status, 401);
    assert.equal(calls, 0);
  });

  test('returns a safe 503 for temporary Google network failure', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    youtubeDependencies = {
      googleService: { isAuthenticated: () => true },
      createChannelService: () => ({ getChannelInfo: async () => { throw Object.assign(new Error('private'), { code: 'ETIMEDOUT' }); } }),
    };
    try {
      const result = await getChannel();
      assert.equal(result.status, 503);
      assert.deepEqual(result.body, {
        error: 'YouTube temporarily unavailable',
        code: 'PROVIDER_UNAVAILABLE',
      });
      assert.doesNotMatch(JSON.stringify(result.body), /private|stack/);
    } finally {
      console.warn = originalWarn;
    }
  });
});
