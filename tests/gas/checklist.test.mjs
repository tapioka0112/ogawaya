import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

async function createChecklistApp() {
  const runtime = await loadGasRuntime();
  const seed = createBaseDataset();
  seed.stores.push({
    id: 'store-002',
    name: '銀座店',
    status: 'active',
    created_at: '2026-04-20T00:00:00Z'
  });
  seed.users.push({
    id: 'user-mg-002',
    store_id: 'store-002',
    name: '佐藤 次郎',
    employee_code: 'MG002',
    passcode: '444444',
    role: 'manager',
    status: 'active',
    created_at: '2026-04-20T00:00:00Z'
  });
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
    },
    {
      id: 'line-003',
      user_id: 'user-mg-002',
      line_user_id: 'line-user-003',
      display_name: '佐藤LINE',
      linked_at: '2026-04-20T00:00:00Z'
    }
  ];
  seed.checklist_runs = [
    {
      id: 'run-001',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-21',
      status: 'open',
      notified_at: '2026-04-21T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-21T01:30:00Z'
    }
  ];
  seed.checklist_run_items = [
    {
      id: 'run-item-001',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-001',
      title: '開店準備',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_at: '',
      updated_at: '2026-04-21T01:30:00Z'
    },
    {
      id: 'run-item-002',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-002',
      title: '清掃確認',
      sort_order: '2',
      status: 'unchecked',
      checked_by: '',
      checked_at: '',
      updated_at: '2026-04-21T01:30:00Z'
    }
  ];

  return runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    identityClient: {
      verifyIdToken(idToken) {
        const map = {
          'valid-pt': { lineUserId: 'line-user-001', displayName: '田中LINE' },
          'valid-mg': { lineUserId: 'line-user-002', displayName: '山田LINE' },
          'valid-other-store': { lineUserId: 'line-user-003', displayName: '佐藤LINE' }
        };
        if (!map[idToken]) {
          throw new Error('invalid token');
        }
        return map[idToken];
      }
    },
    clock: {
      now() {
        return new Date('2026-04-21T02:00:00Z');
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

async function createAnonymousChecklistApp() {
  const runtime = await loadGasRuntime();
  const seed = createBaseDataset();
  seed.checklist_runs = [];
  seed.checklist_run_items = [];
  seed.line_accounts = [];

  return runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    allowAnonymousAccess: true,
    identityClient: {
      verifyIdToken() {
        throw new Error('should not be called');
      }
    },
    clock: {
      now() {
        return new Date('2026-04-22T02:00:00Z');
      },
      today() {
        return '2026-04-22';
      },
      yesterday() {
        return '2026-04-21';
      }
    }
  });
}

test('GET /api/checklists/today は未認証で拒否する', async () => {
  const app = await createChecklistApp();

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/today',
    query: {},
    body: {}
  });

  assert.equal(response.statusCode, 401);
});

test('同日チェックリストを返す', async () => {
  const app = await createChecklistApp();

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/today',
    query: { idToken: 'valid-pt' },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.targetDate, '2026-04-21');
  assert.equal(response.body.items.length, 2);
});

test('匿名アクセス有効時は当日 run が無ければ自動生成して返す', async () => {
  const app = await createAnonymousChecklistApp();

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/today',
    query: {},
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.targetDate, '2026-04-22');
  assert.equal(response.body.items.length, 2);
  assert.equal(app.repository.listRunsByDate('2026-04-22').length, 1);
});

test('check 後に checked へ遷移し、チェック者と時刻が保存される', async () => {
  const app = await createChecklistApp();

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/check',
    query: { idToken: 'valid-pt' },
    body: {
      comment: '確認済み'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.item.status, 'checked');
  assert.equal(response.body.item.checkedBy, '田中 花子');
  assert.match(response.body.item.checkedAt, /2026-04-21T02:00:00Z/);
});

test('同時押下相当の再チェックは冪等に扱う', async () => {
  const app = await createChecklistApp();

  app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/check',
    query: { idToken: 'valid-pt' },
    body: {
      comment: '確認済み'
    }
  });
  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/check',
    query: { idToken: 'valid-pt' },
    body: {
      comment: '再送'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.item.status, 'checked');
  assert.equal(response.body.logCreated, false);
});

test('本人は自分のチェックを取り消せるが、他人のチェックはアルバイトでは取り消せない', async () => {
  const app = await createChecklistApp();

  app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/check',
    query: { idToken: 'valid-pt' },
    body: {
      comment: '確認済み'
    }
  });

  const selfResponse = app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/uncheck',
    query: { idToken: 'valid-pt' },
    body: {
      reason: '入力ミス'
    }
  });

  assert.equal(selfResponse.statusCode, 200);

  app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-002/check',
    query: { idToken: 'valid-mg' },
    body: {
      comment: '管理者確認'
    }
  });

  const forbiddenResponse = app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-002/uncheck',
    query: { idToken: 'valid-pt' },
    body: {
      reason: '勝手に取消'
    }
  });

  assert.equal(forbiddenResponse.statusCode, 403);
});

test('管理者は他人のチェックを取り消せる', async () => {
  const app = await createChecklistApp();

  app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/check',
    query: { idToken: 'valid-pt' },
    body: {
      comment: '確認済み'
    }
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/uncheck',
    query: { idToken: 'valid-mg' },
    body: {
      reason: '代理で取消'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.item.status, 'unchecked');
});

test('GET /api/checklists/{runId}/logs は最新順と action フィルタを提供する', async () => {
  const app = await createChecklistApp();

  app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/check',
    query: { idToken: 'valid-pt' },
    body: {
      comment: '確認済み'
    }
  });
  app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/uncheck',
    query: { idToken: 'valid-pt' },
    body: {
      reason: '再確認'
    }
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/run-001/logs',
    query: {
      idToken: 'valid-pt',
      action: 'uncheck'
    },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.logs[0].action, 'uncheck');
  assert.equal(response.body.logs.length, 1);
  assert.deepEqual(response.body.alerts, []);
});

test('GET /api/checklists/{runId}/logs は未認証と所属外ユーザーを拒否する', async () => {
  const app = await createChecklistApp();

  const unauthorized = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/run-001/logs',
    query: {},
    body: {}
  });
  const forbidden = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/run-001/logs',
    query: { idToken: 'valid-other-store' },
    body: {}
  });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
});

test('GET /api/checklists/{runId}/logs は操作ログ欠落時に alerts を返す', async () => {
  const app = await createChecklistApp();

  app.repository.updateRunItem('run-item-001', {
    status: 'checked',
    checked_by: 'user-pt-001',
    checked_at: '2026-04-21T01:45:00Z',
    updated_at: '2026-04-21T01:45:00Z'
  });

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/run-001/logs',
    query: { idToken: 'valid-mg' },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.logs.length, 0);
  assert.equal(response.body.alerts.length, 1);
  assert.equal(response.body.alerts[0].type, 'missing_log');
  assert.equal(response.body.alerts[0].runItemId, 'run-item-001');
  assert.match(response.body.alerts[0].message, /開店準備/);
});
