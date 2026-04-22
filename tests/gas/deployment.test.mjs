import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';

test('GAS モジュールは constants より先に読まれても namespace 初期化で落ちない', async () => {
  const runtime = await loadGasRuntime({
    filePaths: [
      'gas/src/handlers/api.gs',
      'gas/src/shared/bootstrap.gs',
      'gas/src/storage/spreadsheetRepository.gs',
      'gas/src/services/notificationService.gs',
      'gas/src/services/checklistService.gs',
      'gas/src/handlers/webhook.gs',
      'gas/src/shared/constants.gs',
      'gas/src/scheduler/dailyStart.gs',
      'gas/src/scheduler/dailyClosing.gs',
      'gas/src/main.gs'
    ]
  });

  assert.equal(typeof runtime.Ogawaya.createApplication, 'function');
  assert.equal(typeof runtime.Ogawaya.bootstrapSpreadsheetTemplates, 'function');
});

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
