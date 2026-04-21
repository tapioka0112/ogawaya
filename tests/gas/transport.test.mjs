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
