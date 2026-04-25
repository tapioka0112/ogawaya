import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

async function createAuthApp() {
  const runtime = await loadGasRuntime();
  return runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset()),
    identityClient: {
      verifyIdToken(idToken) {
        if (idToken === 'valid-pt') {
          return { lineUserId: 'line-user-001', displayName: '田中LINE' };
        }
        if (idToken === 'valid-mg') {
          return { lineUserId: 'line-user-002', displayName: '山田LINE' };
        }
        throw new Error('invalid id token');
      }
    }
  });
}

function createVerifyResponse(statusCode, payload) {
  return {
    getResponseCode() {
      return statusCode;
    },
    getContentText() {
      return JSON.stringify(payload);
    }
  };
}

function parseVerifyPayload(requestOptions) {
  assert.equal(requestOptions.method, 'post');
  assert.equal(requestOptions.muteHttpExceptions, true);
  assert.equal(requestOptions.contentType, 'application/x-www-form-urlencoded');
  assert.equal(typeof requestOptions.payload, 'string');
  return Object.fromEntries(new URLSearchParams(requestOptions.payload));
}

function createScriptCache() {
  const entries = new Map();
  return {
    get(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    put(key, value) {
      entries.set(key, String(value));
    },
    remove(key) {
      entries.delete(key);
    }
  };
}

test('/api/link は廃止され 410 を返す', async () => {
  const app = await createAuthApp();

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/link',
    query: { idToken: 'valid-pt' },
    body: {
      employeeCode: 'PT001',
      passcode: '111111'
    }
  });

  assert.equal(response.statusCode, 410);
  assert.equal(response.body.code, 'gone');
});

test('GET /api/me は LIFF 表示名ベースの現在ユーザーを返す', async () => {
  const app = await createAuthApp();

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'valid-pt' },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.userId, 'line-user-001');
  assert.equal(response.body.name, '田中LINE');
  assert.equal(response.body.role, '');
  assert.equal(response.body.store.name, '青山店');
});

test('ALLOW_ANONYMOUS_ACCESS=true かつ idToken なしなら匿名ユーザーを返す', async () => {
  const runtime = await loadGasRuntime();
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset()),
    allowAnonymousAccess: true,
    identityClient: {
      verifyIdToken() {
        throw new Error('should not be called');
      }
    }
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: {},
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.userId, 'anonymous');
  assert.equal(response.body.name, '匿名ユーザー');
});

test('LIFF_ID と LINE_CHANNEL_ID が未設定なら 500 を返す', async () => {
  const runtime = await loadGasRuntime();
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'valid-pt' },
    body: {}
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, 'config_error');
});

test('LIFF verify が 401 を返した場合は 401 を維持する', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LINE_CHANNEL_ID: 'channel-001'
    },
    fetch() {
      return createVerifyResponse(401, {
        error: 'invalid id token'
      });
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'broken-token' },
    body: {}
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'unauthorized');
});

test('ID token が期限切れでも access token が有効なら認証できる', async () => {
  const fetchUrls = [];
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LIFF_ID: '2009859108-sJ31BCFx'
    },
    fetch(url, requestOptions) {
      fetchUrls.push(url);
      if (url === 'https://api.line.me/oauth2/v2.1/verify' && requestOptions.method === 'post') {
        const payload = parseVerifyPayload(requestOptions);
        assert.equal(payload.id_token, 'expired-id-token');
        assert.equal(payload.client_id, '2009859108');
        return createVerifyResponse(400, {
          error: 'invalid_request',
          error_description: 'IdToken expired.'
        });
      }
      if (url === 'https://api.line.me/oauth2/v2.1/verify?access_token=valid-access-token') {
        assert.equal(requestOptions.method, 'get');
        assert.equal(requestOptions.muteHttpExceptions, true);
        return createVerifyResponse(200, {
          client_id: '2009859108',
          expires_in: 3600,
          scope: 'openid profile'
        });
      }
      if (url === 'https://api.line.me/oauth2/v2.1/userinfo') {
        assert.equal(requestOptions.method, 'get');
        assert.equal(requestOptions.muteHttpExceptions, true);
        assert.equal(requestOptions.headers.Authorization, 'Bearer valid-access-token');
        return createVerifyResponse(200, {
          sub: 'line-user-001',
          name: '田中LINE'
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: {
      idToken: 'expired-id-token',
      accessToken: 'valid-access-token',
      liffId: '2009859108-sJ31BCFx'
    },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.userId, 'line-user-001');
  assert.equal(response.body.name, '田中LINE');
  assert.deepEqual(fetchUrls, [
    'https://api.line.me/oauth2/v2.1/verify',
    'https://api.line.me/oauth2/v2.1/verify?access_token=valid-access-token',
    'https://api.line.me/oauth2/v2.1/userinfo'
  ]);
});

test('access token の channel が一致しない場合は拒否する', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LIFF_ID: '2009859108-sJ31BCFx'
    },
    fetch(url, requestOptions) {
      if (url === 'https://api.line.me/oauth2/v2.1/verify' && requestOptions.method === 'post') {
        return createVerifyResponse(400, {
          error: 'invalid_request',
          error_description: 'IdToken expired.'
        });
      }
      if (url === 'https://api.line.me/oauth2/v2.1/verify?access_token=wrong-access-token') {
        return createVerifyResponse(200, {
          client_id: '2999999999',
          expires_in: 3600,
          scope: 'openid profile'
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: {
      idToken: 'expired-id-token',
      accessToken: 'wrong-access-token',
      liffId: '2009859108-sJ31BCFx'
    },
    body: {}
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'unauthorized');
  assert.equal(response.body.details.accessTokenClientIdSuffix, '9999');
  assert.equal(response.body.details.expectedClientIdSuffixes, '9108');
});

test('ID token verify の内部エラーでは access token fallback しない', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LIFF_ID: '2009859108-sJ31BCFx'
    },
    fetch(url, requestOptions) {
      if (url === 'https://api.line.me/oauth2/v2.1/verify' && requestOptions.method === 'post') {
        return createVerifyResponse(200, {
          name: '田中LINE'
        });
      }
      throw new Error(`unexpected fallback fetch: ${url}`);
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: {
      idToken: 'broken-id-token',
      accessToken: 'valid-access-token',
      liffId: '2009859108-sJ31BCFx'
    },
    body: {}
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, 'internal_error');
});

test('LIFF_ID が設定済みなら LIFF channel ID を verify に使う', async () => {
  const verifyClientIds = [];
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LIFF_ID: '2009859108-sJ31BCFx',
      LINE_CHANNEL_ID: 'wrong-channel'
    },
    fetch(url, requestOptions) {
      assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
      const payload = parseVerifyPayload(requestOptions);
      assert.equal(payload.id_token, 'valid-pt');
      verifyClientIds.push(payload.client_id);
      return createVerifyResponse(200, {
        sub: 'line-user-001',
        name: '田中LINE',
        exp: Math.floor(Date.now() / 1000) + 3600
      });
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'valid-pt' },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(verifyClientIds, ['2009859108']);
});

test('LINE_LOGIN_CHANNEL_ID が設定済みなら verify で最優先する', async () => {
  const verifyClientIds = [];
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LINE_LOGIN_CHANNEL_ID: '2001234567',
      LIFF_ID: '2009859108-sJ31BCFx',
      LINE_CHANNEL_ID: 'wrong-channel'
    },
    fetch(url, requestOptions) {
      assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
      const payload = parseVerifyPayload(requestOptions);
      assert.equal(payload.id_token, 'valid-pt');
      verifyClientIds.push(payload.client_id);
      return createVerifyResponse(200, {
        sub: 'line-user-001',
        name: '田中LINE',
        exp: Math.floor(Date.now() / 1000) + 3600
      });
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: {
      idToken: 'valid-pt',
      liffId: '2999999999-other'
    },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(verifyClientIds, ['2001234567']);
});

test('LIFF_ID 未設定なら request liffId の channel ID を verify に使う', async () => {
  const verifyClientIds = [];
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LINE_CHANNEL_ID: 'wrong-channel'
    },
    fetch(url, requestOptions) {
      assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
      const payload = parseVerifyPayload(requestOptions);
      assert.equal(payload.id_token, 'valid-pt');
      verifyClientIds.push(payload.client_id);
      return createVerifyResponse(200, {
        sub: 'line-user-001',
        name: '田中LINE',
        exp: Math.floor(Date.now() / 1000) + 3600
      });
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: {
      idToken: 'valid-pt',
      liffId: '2009859108-sJ31BCFx'
    },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(verifyClientIds, ['2009859108']);
});

test('Script Properties の LIFF_ID は request liffId より優先される', async () => {
  const verifyClientIds = [];
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LIFF_ID: '2009859108-sJ31BCFx',
      LINE_CHANNEL_ID: 'wrong-channel'
    },
    fetch(url, requestOptions) {
      assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
      const payload = parseVerifyPayload(requestOptions);
      assert.equal(payload.id_token, 'valid-pt');
      verifyClientIds.push(payload.client_id);
      return createVerifyResponse(200, {
        sub: 'line-user-001',
        name: '田中LINE',
        exp: Math.floor(Date.now() / 1000) + 3600
      });
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: {
      idToken: 'valid-pt',
      liffId: '2999999999-other'
    },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(verifyClientIds, ['2009859108']);
});

test('LIFF channel ID で失敗したら LINE_CHANNEL_ID で verify を再試行する', async () => {
  const verifyClientIds = [];
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LIFF_ID: '2009859108-sJ31BCFx',
      LINE_CHANNEL_ID: 'channel-001'
    },
    fetch(url, requestOptions) {
      assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
      const payload = parseVerifyPayload(requestOptions);
      assert.equal(payload.id_token, 'valid-pt');
      verifyClientIds.push(payload.client_id);
      if (payload.client_id === '2009859108') {
        return createVerifyResponse(401, {
          error: 'invalid id token'
        });
      }
      return createVerifyResponse(200, {
        sub: 'line-user-001',
        name: '田中LINE',
        exp: Math.floor(Date.now() / 1000) + 3600
      });
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'valid-pt' },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(verifyClientIds, ['2009859108', 'channel-001']);
});

test('LIFF verify 応答に sub が無い場合は 500 を返す', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LINE_CHANNEL_ID: 'channel-001'
    },
    fetch() {
      return createVerifyResponse(200, {
        name: '田中LINE'
      });
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'broken-token' },
    body: {}
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, 'internal_error');
});

test('LIFF verify 失敗時は試行した channel suffix と LINE error を details に返す', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LIFF_ID: '2009859108-sJ31BCFx',
      LINE_CHANNEL_ID: 'channel-001'
    },
    fetch() {
      return createVerifyResponse(401, {
        error: 'invalid_request',
        error_description: 'Invalid IdToken Audience.'
      });
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'broken-token' },
    body: {}
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'unauthorized');
  assert.equal(response.body.details.verifyAttempts, '9108:401:invalid_request,-001:401:invalid_request');
  assert.equal(response.body.details.verifyDescriptions, '9108:Invalid IdToken Audience.|-001:Invalid IdToken Audience.');
  assert.equal(response.body.details.tokenLength, 12);
  assert.equal(response.body.details.tokenParts, 1);
});

test('同じ idToken の連続 API は verify 結果を ScriptCache から再利用する', async () => {
  let fetchCount = 0;
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LINE_CHANNEL_ID: 'channel-001'
    },
    cacheFactory() {
      return createScriptCache();
    },
    fetch() {
      fetchCount += 1;
      return createVerifyResponse(200, {
        sub: 'line-user-001',
        name: '田中LINE',
        exp: Math.floor(Date.now() / 1000) + 3600
      });
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const firstResponse = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'valid-pt' },
    body: {}
  });
  assert.equal(firstResponse.statusCode, 200);

  const secondResponse = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'valid-pt' },
    body: {}
  });
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(fetchCount, 1);
});
