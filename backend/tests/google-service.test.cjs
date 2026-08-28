const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  GoogleService,
  getSafeGoogleRequestError,
  isGoogleReauthenticationRequired,
  isGoogleTemporarilyUnavailable,
} = require('../dist/services/GoogleService.js');

const withConfiguredGoogle = async (callback) => {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  };
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://127.0.0.1/test-callback';
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const temporaryTokenFile = (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jvitorz-google-service-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'tokens.json');
};

test('recognizes an invalid Google grant as requiring reauthentication', () => {
  const error = {
    name: 'GaxiosError',
    code: 'ERR_BAD_REQUEST',
    response: {
      status: 400,
      data: {
        error: 'invalid_grant',
        error_description: 'sensitive provider detail',
      },
    },
    config: {
      data: 'client_secret=sensitive',
    },
  };

  assert.equal(isGoogleReauthenticationRequired(error), true);
  assert.deepEqual(getSafeGoogleRequestError(error), {
    error_name: 'GaxiosError',
    error_code: 'ERR_BAD_REQUEST',
    provider_error: 'invalid_grant',
    http_status: 400,
  });
});

test('sanitizes unexpected Google errors without exposing raw payloads', () => {
  const error = {
    name: 'invalid name with payload',
    code: 'token=secret',
    response: {
      status: 999,
      data: {
        error: 'invalid value with spaces',
      },
    },
    stack: 'sensitive stack',
  };
  const safeError = getSafeGoogleRequestError(error);

  assert.equal(isGoogleReauthenticationRequired(error), false);
  assert.deepEqual(safeError, {
    error_name: 'UnknownError',
    error_code: undefined,
    provider_error: undefined,
    http_status: undefined,
  });
  assert.doesNotMatch(JSON.stringify(safeError), /secret|payload|stack/);
});

test('recognizes temporary Google network and provider failures', () => {
  assert.equal(isGoogleTemporarilyUnavailable({ code: 'ETIMEDOUT' }), true);
  assert.equal(isGoogleTemporarilyUnavailable({ code: 'EACCES' }), true);
  assert.equal(isGoogleTemporarilyUnavailable({ response: { status: 503 } }), true);
  assert.equal(isGoogleTemporarilyUnavailable(new Error('ordinary failure')), false);
});

test('distinguishes valid, expired and refresh-capable persisted credentials', async (t) => {
  await withConfiguredGoogle(async () => {
    const tokenFile = temporaryTokenFile(t);
    const service = new GoogleService(tokenFile);

    assert.equal(service.getAuthenticationState(), 'AUTH_REQUIRED');
    service.saveTokens({ access_token: 'test-access', expiry_date: Date.now() + 60_000 });
    assert.equal(service.getAuthenticationState(), 'CONNECTED');

    service.saveTokens({ access_token: 'test-access', expiry_date: Date.now() - 60_000 });
    assert.equal(service.getAuthenticationState(), 'AUTH_REQUIRED');

    service.saveTokens({ refresh_token: 'test-refresh' });
    assert.equal(service.getAuthenticationState(), 'CONNECTED');
  });
});

test('persists refreshed credentials while preserving the existing refresh token', async (t) => {
  await withConfiguredGoogle(async () => {
    const tokenFile = temporaryTokenFile(t);
    const service = new GoogleService(tokenFile);
    service.saveTokens({ refresh_token: 'test-refresh', access_token: 'old-access' });
    service.saveTokens({ access_token: 'new-access', expiry_date: Date.now() + 60_000 });

    assert.deepEqual(service.loadTokens(), {
      refresh_token: 'test-refresh',
      access_token: 'new-access',
      expiry_date: service.loadTokens().expiry_date,
    });
  });
});
