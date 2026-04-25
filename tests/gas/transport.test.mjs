import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';

test('GAS 応答 JSON に statusCode と ok を含める', async () => {
  const runtime = await loadGasRuntime();
  const output = runtime.Ogawaya.toTextOutput(
    runtime.Ogawaya.createJsonResponse(401, {
      message: '未認証です'
    })
  );
  const payload = JSON.parse(output.content);

  assert.equal(payload.ok, false);
  assert.equal(payload.statusCode, 401);
  assert.equal(payload.message, '未認証です');
});

test('不正な JSON ボディは invalid_request として 400 を返す', async () => {
  const runtime = await loadGasRuntime();

  assert.throws(() => {
    runtime.Ogawaya.extractRequest({
      postData: {
        contents: '{broken'
      },
      parameter: {}
    }, 'POST');
  }, (error) => {
    assert.equal(error.code, 'invalid_request');
    assert.equal(error.statusCode, 400);
    return true;
  });
});

test('GET の _method と _payload は API request として復元される', async () => {
  const runtime = await loadGasRuntime();
  const request = runtime.Ogawaya.extractRequest({
    parameter: {
      path: 'api/admin/login',
      _method: 'POST',
      _payload: JSON.stringify({
        loginId: 'admin',
        password: 'secret'
      })
    }
  }, 'GET');

  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/api/admin/login');
  assert.deepEqual(request.query, {});
  assert.deepEqual(request.body, {
    loginId: 'admin',
    password: 'secret'
  });
});

test('POST body の idToken は query に復元される', async () => {
  const runtime = await loadGasRuntime();
  const request = runtime.Ogawaya.extractRequest({
    parameter: {
      path: 'api/checklists/today',
      _method: 'GET'
    },
    postData: {
      contents: JSON.stringify({
        idToken: 'valid-pt'
      })
    }
  }, 'POST');

  assert.equal(request.method, 'GET');
  assert.equal(request.path, '/api/checklists/today');
  assert.deepEqual(request.query, { idToken: 'valid-pt' });
  assert.deepEqual(request.body, {});
});

test('POST body の idToken は通常 POST API でも query に復元される', async () => {
  const runtime = await loadGasRuntime();
  const request = runtime.Ogawaya.extractRequest({
    parameter: {
      path: 'api/checklist-items/run-item-001/check'
    },
    postData: {
      contents: JSON.stringify({
        idToken: 'valid-pt',
        comment: '確認済み'
      })
    }
  }, 'POST');

  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/api/checklist-items/run-item-001/check');
  assert.deepEqual(request.query, { idToken: 'valid-pt' });
  assert.deepEqual(request.body, { comment: '確認済み' });
});

test('POST body の authToken は query.idToken に復元される', async () => {
  const runtime = await loadGasRuntime();
  const request = runtime.Ogawaya.extractRequest({
    parameter: {
      path: 'api/checklists/today',
      _method: 'GET'
    },
    postData: {
      contents: JSON.stringify({
        authToken: 'valid-pt'
      })
    }
  }, 'POST');

  assert.equal(request.method, 'GET');
  assert.equal(request.path, '/api/checklists/today');
  assert.deepEqual(request.query, { idToken: 'valid-pt' });
  assert.deepEqual(request.body, {});
});

test('GET の不正な _payload は invalid_request として 400 を返す', async () => {
  const runtime = await loadGasRuntime();

  assert.throws(() => {
    runtime.Ogawaya.extractRequest({
      parameter: {
        _payload: '{broken'
      }
    }, 'GET');
  }, (error) => {
    assert.equal(error.code, 'invalid_request');
    assert.equal(error.statusCode, 400);
    return true;
  });
});
