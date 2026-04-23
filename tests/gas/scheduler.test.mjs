import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

async function createSchedulerApp(lineClient) {
  const runtime = await loadGasRuntime();
  const seed = createBaseDataset();
  seed.line_accounts = [
    {
      id: 'line-001',
      user_id: 'user-pt-001',
      line_user_id: 'line-user-001',
      display_name: '田中LINE',
      linked_at: '2026-04-20T00:00:00Z'
    },
    {
      id: 'line-002',
      user_id: 'user-mg-001',
      line_user_id: 'line-user-002',
      display_name: '山田LINE',
      linked_at: '2026-04-20T00:00:00Z'
    }
  ];

  return runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    identityClient: {
      verifyIdToken(idToken) {
        if (idToken === 'valid-after-close') {
          return { lineUserId: 'line-user-001', displayName: '田中LINE' };
        }
        throw new Error('not used');
      }
    },
    lineClient,
    clock: {
      now() {
        return new Date('2026-04-21T01:30:00Z');
      },
      today() {
        return '2026-04-21';
      },
      yesterday() {
        return '2026-04-20';
      }
    }
  });
}

test('daily start は当日分を作成し、既存時は二重作成しない', async () => {
  const app = await createSchedulerApp({
    pushMessage() {
      return { status: 'sent' };
    }
  });

  const first = app.runDailyStart();
  const second = app.runDailyStart();

  assert.equal(first.createdRuns.length, 1);
  assert.equal(second.createdRuns.length, 0);
  assert.equal(app.repository.listTable('checklist_runs').length, 1);
  assert.ok(app.repository.listTable('checklist_run_items').every((item) => item.status === 'unchecked'));
});

test('daily start は 10:30 境界で運用日の target_date を切り替える', async () => {
  const app = await createSchedulerApp({
    pushMessage() {
      return { status: 'sent' };
    }
  });

  app.clock.now = () => new Date('2026-04-21T00:20:00Z');
  const beforeCutover = app.runDailyStart();
  assert.equal(beforeCutover.createdRuns.length, 1);
  assert.equal(beforeCutover.createdRuns[0].target_date, '2026-04-20');

  app.clock.now = () => new Date('2026-04-21T01:40:00Z');
  const afterCutover = app.runDailyStart();
  assert.equal(afterCutover.createdRuns.length, 1);
  assert.equal(afterCutover.createdRuns[0].target_date, '2026-04-21');
});

test('daily start は通知送信対象が 0 件でもスキップして異常終了しない', async () => {
  let pushCount = 0;
  const app = await createSchedulerApp({
    pushMessage() {
      pushCount += 1;
      return { status: 'sent' };
    }
  });
  app.repository.replaceTable('line_accounts', []);

  const response = app.runDailyStart();

  assert.equal(response.createdRuns.length, 1);
  assert.equal(pushCount, 0);
  assert.equal(app.repository.listTable('notifications').length, 0);
});

test('daily start の通知失敗は notifications に failed で残る', async () => {
  const app = await createSchedulerApp({
    pushMessage() {
      throw new Error('network down');
    }
  });

  app.runDailyStart();

  const notifications = app.repository.listTable('notifications');
  assert.equal(notifications[0].status, 'failed');
  assert.match(notifications[0].error_message, /network down/);
});

test('daily closing は前日分を対象に未完了通知し、未完了なしなら通知しない', async () => {
  const app = await createSchedulerApp({
    pushMessage() {
      return { status: 'sent' };
    }
  });

  app.repository.createChecklistRun({
    id: 'run-previous',
    template_id: 'tmpl-001',
    store_id: 'store-001',
    target_date: '2026-04-20',
    status: 'open',
    notified_at: '2026-04-20T01:30:00Z',
    closed_at: '',
    created_at: '2026-04-20T01:30:00Z'
  });
  app.repository.replaceTable('checklist_run_items', [
    {
      id: 'run-item-previous',
      run_id: 'run-previous',
      template_item_id: 'tmpl-item-001',
      title: '開店準備',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-20T01:30:00Z'
    }
  ]);

  const closing = app.runDailyClosing();
  assert.equal(closing.closedRuns[0].status, 'closed');
  assert.equal(closing.notifications.length > 0, true);

  app.repository.replaceTable('notifications', []);
  app.repository.replaceTable('checklist_run_items', [
    {
      id: 'run-item-previous',
      run_id: 'run-previous',
      template_item_id: 'tmpl-item-001',
      title: '開店準備',
      sort_order: '1',
      status: 'checked',
      checked_by: 'user-pt-001',
      checked_by_name: '田中LINE',
      checked_at: '2026-04-20T02:00:00Z',
      updated_at: '2026-04-20T02:00:00Z'
    }
  ]);

  const secondClosing = app.runDailyClosing();
  assert.equal(secondClosing.notifications.length, 0);
  assert.equal(secondClosing.closedRuns[0].closed_at, closing.closedRuns[0].closed_at);
});

test('締切後でもチェック更新は成功し、操作履歴ログは作成しない', async () => {
  const app = await createSchedulerApp({
    pushMessage() {
      return { status: 'sent' };
    }
  });

  app.repository.createChecklistRun({
    id: 'run-previous',
    template_id: 'tmpl-001',
    store_id: 'store-001',
    target_date: '2026-04-20',
    status: 'closed',
    notified_at: '2026-04-20T01:30:00Z',
    closed_at: '2026-04-21T00:00:00Z',
    created_at: '2026-04-20T01:30:00Z'
  });
  app.repository.replaceTable('checklist_run_items', [
    {
      id: 'run-item-previous',
      run_id: 'run-previous',
      template_item_id: 'tmpl-item-001',
      title: '開店準備',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-20T01:30:00Z'
    }
  ]);
  app.repository.replaceTable('line_accounts', [
    {
      id: 'line-001',
      user_id: 'user-pt-001',
      line_user_id: 'line-user-001',
      display_name: '田中LINE',
      linked_at: '2026-04-20T00:00:00Z'
    }
  ]);

  app.clock.now = () => new Date('2026-04-21T00:05:00Z');
  app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-previous/check',
    query: { idToken: 'valid-after-close' },
    body: {
      comment: '締切後'
    }
  });

  const runItem = app.repository.findRunItemById('run-item-previous');
  assert.equal(runItem.status, 'checked');
  assert.equal(runItem.checked_by_name, '田中LINE');
  assert.equal(app.repository.listTable('checklist_item_logs').length, 0);
});
