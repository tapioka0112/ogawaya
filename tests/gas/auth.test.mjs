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

test('LIFF 認証コンテキストがないとリンクに失敗する', async () => {
  const app = await createAuthApp();

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/link',
    query: {},
    body: {
      employeeCode: 'PT001',
      passcode: '111111'
    }
  });

  assert.equal(response.statusCode, 401);
});

test('employeeCode + passcode でリンク成功する', async () => {
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

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.user.role, 'part_time');
  assert.equal(response.body.user.store.name, '青山店');
});

test('lineUserId をリクエストボディに含めると拒否する', async () => {
  const app = await createAuthApp();

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/link',
    query: { idToken: 'valid-pt' },
    body: {
      employeeCode: 'PT001',
      passcode: '111111',
      lineUserId: 'tampered'
    }
  });

  assert.equal(response.statusCode, 400);
});

test('重複リンク時は衝突を返す', async () => {
  const app = await createAuthApp();

  app.handleApiRequest({
    method: 'POST',
    path: '/api/link',
    query: { idToken: 'valid-pt' },
    body: {
      employeeCode: 'PT001',
      passcode: '111111'
    }
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/link',
    query: { idToken: 'valid-mg' },
    body: {
      employeeCode: 'PT001',
      passcode: '111111'
    }
  });

  assert.equal(response.statusCode, 409);
});

test('GET /api/me は role と store を返す', async () => {
  const app = await createAuthApp();

  app.handleApiRequest({
    method: 'POST',
    path: '/api/link',
    query: { idToken: 'valid-pt' },
    body: {
      employeeCode: 'PT001',
      passcode: '111111'
    }
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/me',
    query: { idToken: 'valid-pt' },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.role, 'part_time');
  assert.equal(response.body.store.name, '青山店');
});

test('LINE_CHANNEL_ID 未設定は 500 を返す', async () => {
  const runtime = await loadGasRuntime();
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/link',
    query: { idToken: 'valid-pt' },
    body: {
      employeeCode: 'PT001',
      passcode: '111111'
    }
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
    method: 'POST',
    path: '/api/link',
    query: { idToken: 'broken-token' },
    body: {
      employeeCode: 'PT001',
      passcode: '111111'
    }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'unauthorized');
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
    method: 'POST',
    path: '/api/link',
    query: { idToken: 'broken-token' },
    body: {
      employeeCode: 'PT001',
      passcode: '111111'
    }
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, 'internal_error');
});
