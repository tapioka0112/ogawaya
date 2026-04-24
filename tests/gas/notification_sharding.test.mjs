import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

async function createNotificationApp(seed, sentMessages = []) {
  const runtime = await loadGasRuntime();
  return runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    lineClientFactory: {
      createPushClient(channel) {
        return {
          pushMessage(lineUserId, message) {
            sentMessages.push({
              channelId: channel.id,
              tokenProperty: channel.access_token_property,
              lineUserId,
              message
            });
            return { status: 'sent' };
          }
        };
      }
    },
    clock: {
      now() {
        return new Date('2026-04-24T15:30:00Z');
      },
      today() {
        return '2026-04-25';
      },
      yesterday() {
        return '2026-04-24';
      }
    }
  });
}

function createSeedWithRun() {
  const seed = createBaseDataset();
  seed.notification_channels = [
    {
      id: 'notify-01',
      store_id: 'store-001',
      name: '通知アカウント1',
      access_token_property: 'LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01',
      monthly_limit: '200',
      recipient_limit: '6',
      status: 'active',
      created_at: '2026-04-24T00:00:00Z',
      updated_at: '2026-04-24T00:00:00Z'
    },
    {
      id: 'notify-02',
      store_id: 'store-001',
      name: '通知アカウント2',
      access_token_property: 'LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_02',
      monthly_limit: '200',
      recipient_limit: '6',
      status: 'active',
      created_at: '2026-04-24T00:00:00Z',
      updated_at: '2026-04-24T00:00:00Z'
    }
  ];
  seed.notification_recipients = [
    {
      id: 'recipient-001',
      store_id: 'store-001',
      line_user_id: 'line-user-001',
      display_name: '田中LINE',
      channel_id: 'notify-01',
      status: 'active',
      last_seen_at: '2026-04-24T00:00:00Z',
      created_at: '2026-04-24T00:00:00Z',
      updated_at: '2026-04-24T00:00:00Z'
    },
    {
      id: 'recipient-002',
      store_id: 'store-001',
      line_user_id: 'line-user-002',
      display_name: '山田LINE',
      channel_id: 'notify-02',
      status: 'active',
      last_seen_at: '2026-04-24T00:00:00Z',
      created_at: '2026-04-24T00:00:00Z',
      updated_at: '2026-04-24T00:00:00Z'
    }
  ];
  seed.notification_channel_usage = [];
  seed.checklist_runs = [
    {
      id: 'run-001',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-24',
      status: 'open',
      notified_at: '2026-04-24T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-24T01:30:00Z'
    }
  ];
  seed.checklist_run_items = [
    {
      id: 'item-001',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-001',
      title: '開店準備',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-24T01:30:00Z'
    }
  ];
  return seed;
}

test('runDailyIncompleteReminder は通知チャネルごとのアクセストークンで分散送信し usage を更新する', async () => {
  const sentMessages = [];
  const app = await createNotificationApp(createSeedWithRun(), sentMessages);

  const response = app.runDailyIncompleteReminder();

  assert.equal(response.notifications.length, 2);
  assert.deepEqual(sentMessages.map((message) => message.tokenProperty), [
    'LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01',
    'LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_02'
  ]);
  assert.deepEqual(app.repository.listTable('notifications').map((notification) => notification.channel_id), [
    'notify-01',
    'notify-02'
  ]);
  assert.deepEqual(app.repository.listTable('notification_channel_usage').map((usage) => ({
    channelId: usage.channel_id,
    localSentCount: usage.local_sent_count,
    remainingCount: usage.remaining_count
  })), [
    { channelId: 'notify-01', localSentCount: '1', remainingCount: '199' },
    { channelId: 'notify-02', localSentCount: '1', remainingCount: '199' }
  ]);
});

test('runDailyIncompleteReminder は通知対象者が0件の場合に送信前に拒否する', async () => {
  const seed = createSeedWithRun();
  seed.notification_recipients = [];
  const app = await createNotificationApp(seed);

  assert.throws(() => app.runDailyIncompleteReminder(), /通知対象者がいません/);
  assert.equal(app.repository.listTable('notifications').length, 0);
});

test('runDailyIncompleteReminder は通知対象者の channel_id 未割当を送信前に拒否する', async () => {
  const seed = createSeedWithRun();
  seed.notification_recipients[0].channel_id = '';
  const app = await createNotificationApp(seed);

  assert.throws(() => app.runDailyIncompleteReminder(), /通知チャネル未割当/);
  assert.equal(app.repository.listTable('notifications').length, 0);
});

test('runDailyIncompleteReminder は1チャネルの割当上限超過を送信前に拒否する', async () => {
  const seed = createSeedWithRun();
  seed.notification_channels[0].recipient_limit = '1';
  seed.notification_recipients[1].channel_id = 'notify-01';
  const app = await createNotificationApp(seed);

  assert.throws(() => app.runDailyIncompleteReminder(), /割当人数が上限/);
  assert.equal(app.repository.listTable('notifications').length, 0);
});

test('rebalanceNotificationRecipients は active channel に6人ずつ割り当てる', async () => {
  const seed = createSeedWithRun();
  seed.notification_recipients = Array.from({ length: 7 }, (_, index) => ({
    id: `recipient-${String(index + 1).padStart(3, '0')}`,
    store_id: 'store-001',
    line_user_id: `line-user-${String(index + 1).padStart(3, '0')}`,
    display_name: `スタッフ${index + 1}`,
    channel_id: '',
    status: 'active',
    last_seen_at: '2026-04-24T00:00:00Z',
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z'
  }));
  const app = await createNotificationApp(seed);

  const response = app.rebalanceNotificationRecipients();
  const recipients = app.repository.listTable('notification_recipients');

  assert.equal(response.assignedCount, 7);
  assert.equal(recipients.filter((recipient) => recipient.channel_id === 'notify-01').length, 6);
  assert.equal(recipients.filter((recipient) => recipient.channel_id === 'notify-02').length, 1);
});

test('rebalanceNotificationRecipients はチャネル容量不足を拒否する', async () => {
  const seed = createSeedWithRun();
  seed.notification_channels = [seed.notification_channels[0]];
  seed.notification_recipients = Array.from({ length: 7 }, (_, index) => ({
    id: `recipient-${String(index + 1).padStart(3, '0')}`,
    store_id: 'store-001',
    line_user_id: `line-user-${String(index + 1).padStart(3, '0')}`,
    display_name: `スタッフ${index + 1}`,
    channel_id: '',
    status: 'active',
    last_seen_at: '2026-04-24T00:00:00Z',
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z'
  }));
  const app = await createNotificationApp(seed);

  assert.throws(() => app.rebalanceNotificationRecipients(), /通知チャネル容量が不足しています/);
});

test('installIncompleteReminderTriggers は次回0:30の one-shot と watchdog を作る', async () => {
  const runtime = await loadGasRuntime();
  const deleted = [];
  const created = [];
  const existingTriggers = [
    { getHandlerFunction: () => 'runDailyIncompleteReminder' },
    { getHandlerFunction: () => 'runReminderWatchdog' },
    { getHandlerFunction: () => 'runDailyStart' }
  ];
  const scriptApp = {
    getProjectTriggers() {
      return existingTriggers;
    },
    deleteTrigger(trigger) {
      deleted.push(trigger.getHandlerFunction());
    },
    newTrigger(functionName) {
      const trigger = { functionName };
      return {
        timeBased() {
          return {
            at(date) {
              trigger.at = date.toISOString();
              return {
                create() {
                  created.push(trigger);
                  return trigger;
                }
              };
            },
            everyMinutes(minutes) {
              trigger.everyMinutes = minutes;
              return {
                create() {
                  created.push(trigger);
                  return trigger;
                }
              };
            }
          };
        }
      };
    }
  };

  const result = runtime.Ogawaya.installIncompleteReminderTriggers({
    scriptApp,
    clock: {
      now() {
        return new Date('2026-04-24T14:00:00Z');
      }
    }
  });

  assert.deepEqual(deleted, ['runDailyIncompleteReminder', 'runReminderWatchdog']);
  assert.equal(result.reminderAt, '2026-04-24T15:30:00Z');
  assert.deepEqual(created, [
    { functionName: 'runDailyIncompleteReminder', at: '2026-04-24T15:30:00.000Z' },
    { functionName: 'runReminderWatchdog', everyMinutes: 15 }
  ]);
});

test('runDailyIncompleteReminder は送信失敗時も次回 one-shot を再作成する', async () => {
  const runtime = await loadGasRuntime();
  let scheduled = false;
  runtime.Ogawaya.createApplication = () => ({
    runDailyIncompleteReminder() {
      throw new Error('push failed');
    }
  });
  runtime.Ogawaya.installNextIncompleteReminderTrigger = () => {
    scheduled = true;
  };

  assert.throws(() => runtime.runDailyIncompleteReminder(), /push failed/);
  assert.equal(scheduled, true);
});
