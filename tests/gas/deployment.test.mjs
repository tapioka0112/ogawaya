import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';

test('scriptId 未設定時はデプロイ前チェックが失敗する', async () => {
  const runtime = await loadGasRuntime();
  const result = runtime.Ogawaya.validateDeploymentConfig(
    { scriptId: '', rootDir: 'gas/src' },
    {
      oauthScopes: [
        'https://www.googleapis.com/auth/script.external_request',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    }
  );

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /scriptId/);
});

test('必要スコープ不足時はデプロイ前チェックが失敗する', async () => {
  const runtime = await loadGasRuntime();
  const result = runtime.Ogawaya.validateDeploymentConfig(
    { scriptId: 'script-id', rootDir: 'gas/src' },
    { oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'] }
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /external_request/);
});

test('設定正常時は clasp push 実行情報を返す', async () => {
  const runtime = await loadGasRuntime();
  const result = runtime.Ogawaya.validateDeploymentConfig(
    { scriptId: 'script-id', rootDir: 'gas/src' },
    {
      oauthScopes: [
        'https://www.googleapis.com/auth/script.external_request',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.command, 'clasp push');
});
