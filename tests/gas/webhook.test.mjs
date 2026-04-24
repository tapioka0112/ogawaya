import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

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

function createReminderDataset() {
  const dataset = createBaseDataset();
  dataset.checklist_runs = [
    {
      id: 'run-001',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-23',
      status: 'open',
      notified_at: '2026-04-23T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-23T01:30:00Z'
    }
  ];
  dataset.checklist_run_items = [
    {
      id: 'run-item-001',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-001',
      title: '開店準備',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-23T01:30:00Z'
    },
    {
      id: 'run-item-002',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-002',
      title: '清掃確認',
      sort_order: '2',
      status: 'checked',
      checked_by: 'line-user-001',
      checked_by_name: '田中LINE',
      checked_at: '2026-04-23T12:00:00Z',
      updated_at: '2026-04-23T12:00:00Z'
    },
    {
      id: 'run-item-003',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-003',
      title: '券売機の金額チェック',
      sort_order: '3',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-23T01:30:00Z'
    }
  ];
  return dataset;
}

async function createReminderWebhookApp(options = {}) {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      LINE_CHANNEL_SECRET: 'secret-value',
      LINE_WEBHOOK_TOKEN: 'webhook-token',
      LINE_CHANNEL_ACCESS_TOKEN: 'line-token'
    }
  });
  const replies = [];
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createReminderDataset()),
    channelSecret: 'secret-value',
    webhookToken: options.webhookToken || 'webhook-token',
    reminderAllowedSourceIds: options.reminderAllowedSourceIds || ['group-001'],
    appBaseUrl: 'https://example.com/exec',
    lineClient: {
      pushMessage() {
        throw new Error('push should not be used');
      },
      replyMessage(replyToken, message) {
        replies.push({ replyToken, message });
        return { status: 'sent' };
      }
    },
    clock: {
      now() {
        return new Date('2026-04-23T15:30:00.000Z');
      },
      today() {
        return '2026-04-24';
      },
      yesterday() {
        return '2026-04-23';
      }
    }
  });
  return { app, replies };
}

function buildCalendarReminderPayload(sourceId = 'group-001') {
  return JSON.stringify({
    events: [
      {
        type: 'message',
        replyToken: 'reply-token-001',
        source: {
          type: 'group',
          groupId: sourceId
        },
        message: {
          type: 'text',
          text: '残りタスク通知'
        }
      }
    ]
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

test('LINEカレンダー通知相当のグループメッセージへ未完了一覧を reply する', async () => {
  const { app, replies } = await createReminderWebhookApp();
  const payload = buildCalendarReminderPayload();
  const signature = app.createWebhookSignature(payload);

  const response = app.handleWebhook({
    body: payload,
    signature
  });

  assert.equal(response.statusCode, 200);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].replyToken, 'reply-token-001');
  assert.match(replies[0].message, /今日の残りタスクです/);
  assert.match(replies[0].message, /・開店準備/);
  assert.match(replies[0].message, /・券売機の金額チェック/);
  assert.doesNotMatch(replies[0].message, /・清掃確認/);

  const notifications = app.repository.listTable('notifications');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'calendar_reminder_reply');
  assert.equal(notifications[0].status, 'sent');
});

test('署名が無くても静的 webhook token が一致すれば処理する', async () => {
  const { app, replies } = await createReminderWebhookApp();
  const payload = buildCalendarReminderPayload();

  const response = app.handleWebhook({
    body: payload,
    token: 'webhook-token'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(replies.length, 1);
});

test('許可されていないグループのリマインダーは reply しない', async () => {
  const { app, replies } = await createReminderWebhookApp({
    reminderAllowedSourceIds: ['group-allowed']
  });
  const payload = buildCalendarReminderPayload('group-denied');
  const signature = app.createWebhookSignature(payload);

  const response = app.handleWebhook({
    body: payload,
    signature
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.skipped, 'source_not_allowed');
  assert.equal(replies.length, 0);
});

test('同一営業日かつ同一グループには二重 reply しない', async () => {
  const { app, replies } = await createReminderWebhookApp();
  const payload = buildCalendarReminderPayload();
  const signature = app.createWebhookSignature(payload);

  app.handleWebhook({
    body: payload,
    signature
  });
  const second = app.handleWebhook({
    body: payload,
    signature
  });

  assert.equal(second.statusCode, 200);
  assert.equal(second.body.skipped, 'already_replied');
  assert.equal(replies.length, 1);
  assert.equal(app.repository.listTable('notifications').length, 1);
});
