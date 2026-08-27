const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getSafeGoogleRequestError,
  isGoogleReauthenticationRequired,
  isGoogleTemporarilyUnavailable,
} = require('../dist/services/GoogleService.js');

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
