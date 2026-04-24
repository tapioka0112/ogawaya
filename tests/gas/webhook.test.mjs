import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';

async function createWebhookApp() {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LINE_CHANNEL_SECRET: 'secret-value'
    }
  });
  return runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage({}),
    channelSecret: 'secret-value',
    appBaseUrl: 'https://example.com/exec'
  });
}

test('不正署名は 403 で拒否する', async () => {
  const app = await createWebhookApp();

  const response = app.handleWebhook({
    body: {
      events: []
    },
    signature: 'broken-signature'
  });

  assert.equal(response.statusCode, 403);
});

test('有効署名は処理を通過する', async () => {
  const app = await createWebhookApp();
  const payload = JSON.stringify({
    events: []
  });
  const signature = app.createWebhookSignature(payload);

  const response = app.handleWebhook({
    body: payload,
    signature
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
});

test('メニュー選択イベントで LIFF 誘導 URL を返す', async () => {
  const app = await createWebhookApp();
  const payload = JSON.stringify({
    events: [
      {
        type: 'postback',
        postback: {
          data: 'menu=today'
        }
      }
    ]
  });
  const signature = app.createWebhookSignature(payload);

  const response = app.handleWebhook({
    body: payload,
    signature
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body.reply.messages[1].template.actions[0].uri, /mode=user/);
});

test('共通の 3 メニューを返す', async () => {
  const app = await createWebhookApp();
  const payload = JSON.stringify({
    events: [
      {
        type: 'postback',
        postback: {
          data: 'menu=help'
        }
      }
    ]
  });
  const signature = app.createWebhookSignature(payload);

  const response = app.handleWebhook({
    body: payload,
    signature
  });

  assert.equal(response.body.menuItems.join(','), [
    '今日のチェックリスト',
    '未完了一覧',
    'ヘルプ'
  ].join(','));
});
