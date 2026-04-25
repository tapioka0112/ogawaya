import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

async function createAdminApp(lineClient = {
  pushMessage() {
    return { status: 'sent' };
  }
}) {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      ADMIN_LOGIN_ID: 'admin-login',
      ADMIN_LOGIN_PASSWORD: 'admin-password'
    },
    enableCacheService: true
  });
  const seed = createBaseDataset();
  seed.line_accounts = [
    {
      id: 'line-002',
      user_id: 'user-mg-001',
      line_user_id: 'line-user-002',
      display_name: '山田LINE',
      linked_at: '2026-04-20T00:00:00Z'
    },
    {
      id: 'line-003',
      user_id: 'user-ad-001',
      line_user_id: 'line-user-003',
      display_name: '本部LINE',
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
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-21T01:30:00Z'
    }
  ];

  return runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    identityClient: {
      verifyIdToken(idToken) {
        const map = {
          'valid-part-time': { lineUserId: 'line-user-001', displayName: '田中LINE' },
          'valid-manager': { lineUserId: 'line-user-002', displayName: '山田LINE' },
          'valid-admin': { lineUserId: 'line-user-003', displayName: '本部LINE' }
        };
        if (!map[idToken]) {
          throw new Error('invalid token');
        }
        return map[idToken];
      }
    },
    lineClient,
    clock: {
      now() {
        return new Date('2026-04-21T03:00:00Z');
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

function loginAsAdmin(app) {
  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/login',
    query: {},
    body: {
      loginId: 'admin-login',
      password: 'admin-password'
    }
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.session);
  assert.ok(response.body.session.token);
  return response.body.session.token;
}

test('管理者ログインは指定店舗のセッションを作成し日付別タスクを同じ店舗から返す', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      ADMIN_LOGIN_ID: 'admin-login',
      ADMIN_LOGIN_PASSWORD: 'admin-password'
    },
    enableCacheService: true
  });
  const seed = createBaseDataset();
  seed.stores.push({
    id: 'store-hashimoto',
    name: '橋本店',
    status: 'active',
    created_at: '2026-04-20T00:00:00Z'
  });
  seed.checklist_templates.push({
    id: 'tmpl-hashimoto',
    store_id: 'store-hashimoto',
    name: '橋本店日次チェックリスト',
    notify_time: '10:30',
    closing_time: '00:00',
    is_active: 'true',
    created_by: 'user-mg-hashimoto',
    created_at: '2026-04-20T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z'
  });
  seed.checklist_template_items.push({
    id: 'tmpl-item-hashimoto',
    template_id: 'tmpl-hashimoto',
    title: '厨房内床清掃',
    description: '',
    period: 'daily',
    sort_order: '1',
    is_required: 'true',
    is_active: 'true',
    created_at: '2026-04-20T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z'
  });
  seed.checklist_runs = [
    {
      id: 'run-hashimoto-20260425',
      template_id: 'tmpl-hashimoto',
      store_id: 'store-hashimoto',
      target_date: '2026-04-25',
      status: 'open',
      notified_at: '2026-04-25T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-25T01:30:00Z'
    }
  ];
  seed.checklist_run_items = [
    {
      id: 'run-item-hashimoto-daily',
      run_id: 'run-hashimoto-20260425',
      template_item_id: 'tmpl-item-hashimoto',
      title: '厨房内床清掃',
      period: 'daily',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-25T01:30:00Z'
    }
  ];
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    clock: {
      now() {
        return new Date('2026-04-25T03:00:00Z');
      },
      today() {
        return '2026-04-25';
      },
      yesterday() {
        return '2026-04-24';
      }
    }
  });

  const login = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/login',
    query: {},
    body: {
      loginId: 'admin-login',
      password: 'admin-password',
      storeId: 'store-hashimoto'
    }
  });

  assert.equal(login.statusCode, 200);
  assert.equal(login.body.session.storeId, 'store-hashimoto');
  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/admin/runs/2026-04-25',
    query: { adminToken: login.body.session.token },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.checklist.storeName, '橋本店');
  assert.deepEqual(
    JSON.parse(JSON.stringify(response.body.checklist.items.map((item) => item.title))),
    ['厨房内床清掃']
  );
});

test('管理者ログインは Script Properties の前後空白を無視する', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      ADMIN_LOGIN_ID: ' admin-login ',
      ADMIN_LOGIN_PASSWORD: ' admin-password '
    },
    enableCacheService: true
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/login',
    query: {},
    body: {
      loginId: 'admin-login',
      password: 'admin-password'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.session.token);
});

test('管理者ログインは Script Properties の引用符付き値を正規化する', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      ADMIN_LOGIN_ID: '"admin-login"',
      ADMIN_LOGIN_PASSWORD: "'admin-password'"
    },
    enableCacheService: true
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/login',
    query: {},
    body: {
      loginId: 'admin-login',
      password: 'admin-password'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.session.token);
});

test('管理者ログイン失敗は debug_events 向けの安全な診断情報を出す', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      ADMIN_LOGIN_ID: 'admin-login',
      ADMIN_LOGIN_PASSWORD: 'admin-password'
    },
    enableCacheService: true
  });
  const debugEvents = [];
  runtime.Ogawaya.writeDebugEvent = function (source, details) {
    debugEvents.push({ source, details });
  };
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset())
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/login',
    query: {},
    body: {
      loginId: 'admin-login',
      password: 'wrong-password'
    }
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(JSON.stringify(debugEvents)), [
    {
      source: 'admin.login.failed',
      details: {
        path: '/api/admin/login',
        name: 'admin.login.failed',
        loginIdMatched: true,
        loginIdLength: 11,
        configuredLoginIdLength: 11,
        passwordLength: 14,
        configuredPasswordLength: 14
      }
    }
  ]);
});

test('ロール制限なしでテンプレート項目を追加できる', async () => {
  const app = await createAdminApp();

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/templates/tmpl-001/items',
    query: { idToken: 'valid-part-time' },
    body: {
      title: 'レジ確認',
      description: '',
      sortOrder: 3,
      isRequired: true
    }
  });

  assert.equal(response.statusCode, 201);
});

test('テンプレート新規作成・更新・項目 CRUD が成功する', async () => {
  const app = await createAdminApp();

  const createTemplate = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/templates',
    query: { idToken: 'valid-manager' },
    body: {
      name: '閉店チェックリスト'
    }
  });
  assert.equal(createTemplate.statusCode, 201);

  const templateId = createTemplate.body.template.id;
  const updateTemplate = app.handleApiRequest({
    method: 'PUT',
    path: `/api/admin/templates/${templateId}`,
    query: { idToken: 'valid-manager' },
    body: {
      name: '閉店チェックリスト改'
    }
  });
  assert.equal(updateTemplate.statusCode, 200);

  const addItem = app.handleApiRequest({
    method: 'POST',
    path: `/api/admin/templates/${templateId}/items`,
    query: { idToken: 'valid-manager' },
    body: {
      title: '施錠確認',
      description: '',
      sortOrder: 1,
      isRequired: true
    }
  });
  assert.equal(addItem.statusCode, 201);

  const itemId = addItem.body.item.id;
  const editItem = app.handleApiRequest({
    method: 'PUT',
    path: `/api/admin/templates/${templateId}/items/${itemId}`,
    query: { idToken: 'valid-manager' },
    body: {
      title: '最終施錠確認',
      description: '閉店時',
      sortOrder: 1,
      isRequired: true
    }
  });
  assert.equal(editItem.statusCode, 200);

  const deleteItem = app.handleApiRequest({
    method: 'DELETE',
    path: `/api/admin/templates/${templateId}/items/${itemId}`,
    query: { idToken: 'valid-manager' },
    body: {}
  });
  assert.equal(deleteItem.statusCode, 200);
});

test('テンプレート編集・削除で操作履歴ログを追加しない', async () => {
  const app = await createAdminApp();

  const addItem = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/templates/tmpl-001/items',
    query: { idToken: 'valid-admin' },
    body: {
      title: 'レジ確認',
      description: '',
      sortOrder: 3,
      isRequired: true
    }
  });
  const itemId = addItem.body.item.id;

  app.handleApiRequest({
    method: 'PUT',
    path: `/api/admin/templates/tmpl-001/items/${itemId}`,
    query: { idToken: 'valid-admin' },
    body: {
      title: 'レジ締め確認',
      description: '',
      sortOrder: 3,
      isRequired: true
    }
  });
  app.handleApiRequest({
    method: 'DELETE',
    path: `/api/admin/templates/tmpl-001/items/${itemId}`,
    query: { idToken: 'valid-admin' },
    body: {}
  });

  const logs = app.repository.listTable('checklist_item_logs');
  assert.equal(logs.length, 0);
});

test('手動通知 API は実行でき、manual_reminder を保存する', async () => {
  const app = await createAdminApp();

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/checklists/run-001/notify-incomplete',
    query: { idToken: 'valid-manager' },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.notifications[0].type, 'manual_reminder');
});

test('手動通知の再試行では同一対象へ重複送信しない', async () => {
  const calls = [];
  const app = await createAdminApp({
    pushMessage(lineUserId, message) {
      calls.push({ lineUserId, message });
      return { status: 'sent' };
    }
  });

  const first = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/checklists/run-001/notify-incomplete',
    query: { idToken: 'valid-manager' },
    body: {}
  });
  const second = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/checklists/run-001/notify-incomplete',
    query: { idToken: 'valid-manager' },
    body: {}
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.notifications.length, 2);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.notifications.length, 0);
  assert.equal(calls.length, 2);
  assert.equal(app.repository.listTable('notifications').length, 2);
});

test('管理者画面向け API でログイン後にタスク作成・挿入・テンプレ適用・削除できる', async () => {
  const app = await createAdminApp();
  const token = loginAsAdmin(app);

  const createTask = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/tasks',
    query: { adminToken: token },
    body: {
      title: '追加タスク',
      description: 'テスト用',
      period: 'weekly'
    }
  });
  assert.equal(createTask.statusCode, 201);
  assert.equal(createTask.body.task.period, 'weekly');
  const taskId = createTask.body.task.id;

  const listTasks = app.handleApiRequest({
    method: 'GET',
    path: '/api/admin/tasks',
    query: { adminToken: token },
    body: {}
  });
  assert.equal(listTasks.statusCode, 200);
  assert.ok(listTasks.body.tasks.some((task) => task.id === taskId));
  assert.equal(listTasks.body.tasks.find((task) => task.id === taskId).period, 'weekly');

  const insertTask = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/runs/2026-04-21/items:insert',
    query: { adminToken: token },
    body: {
      taskId: taskId
    }
  });
  assert.equal(insertTask.statusCode, 201);
  assert.equal(insertTask.body.item.period, 'weekly');
  const insertedRunItemId = insertTask.body.item.id;

  const createTemplate = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/templates',
    query: { adminToken: token },
    body: {
      name: '管理画面テンプレート',
      taskIds: [taskId]
    }
  });
  assert.equal(createTemplate.statusCode, 201);
  assert.equal(createTemplate.body.template.items[0].period, 'weekly');
  const templateId = createTemplate.body.template.id;

  const applyTemplate = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/runs/2026-04-21/templates/' + templateId + ':apply',
    query: { adminToken: token },
    body: {}
  });
  assert.equal(applyTemplate.statusCode, 201);

  const getRun = app.handleApiRequest({
    method: 'GET',
    path: '/api/admin/runs/2026-04-21',
    query: { adminToken: token },
    body: {}
  });
  assert.equal(getRun.statusCode, 200);
  assert.ok(getRun.body.checklist);
  assert.ok(Array.isArray(getRun.body.checklist.items));
  assert.ok(getRun.body.checklist.items.length >= 1);

  const deleteItem = app.handleApiRequest({
    method: 'DELETE',
    path: '/api/admin/runs/2026-04-21/items/' + insertedRunItemId,
    query: { adminToken: token },
    body: {}
  });
  assert.equal(deleteItem.statusCode, 200);
});

test('管理者の日付別タスク一覧は従業員ホームと同じ期間内タスクを返し削除できる', async () => {
  const app = await createAdminApp();
  const token = loginAsAdmin(app);
  app.repository.createChecklistRun({
    id: 'run-week',
    template_id: 'tmpl-001',
    store_id: 'store-001',
    target_date: '2026-04-19',
    status: 'closed',
    notified_at: '2026-04-19T01:30:00Z',
    closed_at: '2026-04-20T01:00:00Z',
    created_at: '2026-04-19T01:30:00Z'
  });
  app.repository.createChecklistRun({
    id: 'run-month',
    template_id: 'tmpl-001',
    store_id: 'store-001',
    target_date: '2026-04-01',
    status: 'closed',
    notified_at: '2026-04-01T01:30:00Z',
    closed_at: '2026-04-02T01:00:00Z',
    created_at: '2026-04-01T01:30:00Z'
  });
  app.repository.createRunItems([
    {
      id: 'run-item-weekly',
      run_id: 'run-week',
      template_item_id: 'tmpl-item-002',
      title: '週間確認',
      period: 'weekly',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-19T01:30:00Z'
    },
    {
      id: 'run-item-monthly',
      run_id: 'run-month',
      template_item_id: 'tmpl-item-monthly',
      title: '月間確認',
      period: 'monthly',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-01T01:30:00Z'
    }
  ]);

  const adminRun = app.handleApiRequest({
    method: 'GET',
    path: '/api/admin/runs/2026-04-21',
    query: { adminToken: token },
    body: {}
  });
  const employeeRun = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/today',
    query: { idToken: 'valid-manager' },
    body: {}
  });

  assert.equal(adminRun.statusCode, 200);
  assert.equal(employeeRun.statusCode, 200);
  assert.deepEqual(
    adminRun.body.checklist.items.map((item) => [item.id, item.period]),
    employeeRun.body.items.map((item) => [item.id, item.period])
  );

  const deleteCarriedWeekly = app.handleApiRequest({
    method: 'DELETE',
    path: '/api/admin/runs/2026-04-21/items/run-item-weekly',
    query: { adminToken: token },
    body: {}
  });

  assert.equal(deleteCarriedWeekly.statusCode, 200);
  assert.equal(app.repository.findRunItemById('run-item-weekly'), null);
});

test('管理者の日付別タスク一覧は 2026-04-25 の期間内タスクを従業員ホームと同じ内容で返す', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      ADMIN_LOGIN_ID: 'admin-login',
      ADMIN_LOGIN_PASSWORD: 'admin-password'
    },
    enableCacheService: true
  });
  const seed = createBaseDataset();
  seed.line_accounts = [
    {
      id: 'line-002',
      user_id: 'user-mg-001',
      line_user_id: 'line-user-002',
      display_name: '山田LINE',
      linked_at: '2026-04-20T00:00:00Z'
    }
  ];
  seed.checklist_runs = [
    {
      id: 'run-month',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-01',
      status: 'open',
      notified_at: '2026-04-01T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-01T01:30:00Z'
    },
    {
      id: 'run-week',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-19',
      status: 'open',
      notified_at: '2026-04-19T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-19T01:30:00Z'
    },
    {
      id: 'run-day',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-25',
      status: 'open',
      notified_at: '2026-04-25T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-25T01:30:00Z'
    }
  ];
  seed.checklist_run_items = [
    {
      id: 'run-item-daily',
      run_id: 'run-day',
      template_item_id: 'tmpl-item-001',
      title: '厨房内床清掃',
      period: 'daily',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-25T01:30:00Z'
    },
    {
      id: 'run-item-weekly',
      run_id: 'run-week',
      template_item_id: 'tmpl-item-002',
      title: 'バーナー・コンロの清掃',
      period: 'weekly',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-19T01:30:00Z'
    },
    {
      id: 'run-item-monthly',
      run_id: 'run-month',
      template_item_id: 'tmpl-item-monthly',
      title: '換気扇の清掃',
      period: 'monthly',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-01T01:30:00Z'
    }
  ];
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    identityClient: {
      verifyIdToken(idToken) {
        if (idToken !== 'valid-manager') {
          throw new Error('invalid token');
        }
        return { lineUserId: 'line-user-002', displayName: '山田LINE' };
      }
    },
    clock: {
      now() {
        return new Date('2026-04-25T03:00:00Z');
      },
      today() {
        return '2026-04-25';
      },
      yesterday() {
        return '2026-04-24';
      }
    }
  });
  const token = loginAsAdmin(app);

  const adminRun = app.handleApiRequest({
    method: 'GET',
    path: '/api/admin/runs/2026-04-25',
    query: { adminToken: token },
    body: {}
  });
  const employeeRun = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/today',
    query: { idToken: 'valid-manager' },
    body: {}
  });

  assert.equal(adminRun.statusCode, 200);
  assert.equal(employeeRun.statusCode, 200);
  assert.equal(
    JSON.stringify(adminRun.body.checklist.items.map((item) => [item.id, item.period])),
    JSON.stringify(employeeRun.body.items.map((item) => [item.id, item.period]))
  );
  assert.equal(
    JSON.stringify(adminRun.body.checklist.items.map((item) => [item.id, item.period])),
    JSON.stringify([
      ['run-item-daily', 'daily'],
      ['run-item-weekly', 'weekly'],
      ['run-item-monthly', 'monthly']
    ])
  );
});

test('管理者テンプレート一覧は挿入用にテンプレート項目を返す', async () => {
  const app = await createAdminApp();
  const token = loginAsAdmin(app);

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/admin/templates',
    query: { adminToken: token },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  const dailyTemplate = response.body.templates.find((template) => template.id === 'tmpl-001');
  assert.ok(dailyTemplate);
  assert.equal(dailyTemplate.itemCount, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(dailyTemplate.items.map((item) => item.id))),
    ['tmpl-item-001', 'tmpl-item-002']
  );
});

test('管理者テンプレート作成レスポンスは新規テンプレート項目IDを返す', async () => {
  const app = await createAdminApp();
  const token = loginAsAdmin(app);

  const createTask = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/tasks',
    query: { adminToken: token },
    body: {
      title: '厨房床清掃',
      description: '床全体を清掃する'
    }
  });
  assert.equal(createTask.statusCode, 201);
  const taskId = createTask.body.task.id;

  const createTemplate = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/templates',
    query: { adminToken: token },
    body: {
      name: '毎日タスク',
      taskIds: [taskId]
    }
  });

  assert.equal(createTemplate.statusCode, 201);
  assert.equal(createTemplate.body.template.itemCount, 1);
  assert.equal(createTemplate.body.template.items.length, 1);
  assert.notEqual(createTemplate.body.template.items[0].id, taskId);
  assert.equal(createTemplate.body.template.items[0].title, '厨房床清掃');
});

test('管理者テンプレート挿入はクライアント生成IDで保存して即時反映とGAS保存結果を一致させる', async () => {
  const app = await createAdminApp();
  const token = loginAsAdmin(app);

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/runs/2026-04-21/templates/tmpl-001:apply',
    query: { adminToken: token },
    body: {
      clientItems: [
        {
          templateItemId: 'tmpl-item-002',
          id: 'client-run-item-002'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.insertedCount, 1);
  assert.equal(response.body.items[0].id, 'client-run-item-002');
  assert.equal(response.body.items[0].templateItemId, 'tmpl-item-002');
  assert.ok(app.repository.findRunItemById('client-run-item-002'));
});

test('管理者テンプレート挿入は重複したクライアント生成IDを拒否する', async () => {
  const app = await createAdminApp();
  const token = loginAsAdmin(app);

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/admin/runs/2026-04-21/templates/tmpl-001:apply',
    query: { adminToken: token },
    body: {
      clientItems: [
        {
          templateItemId: 'tmpl-item-001',
          id: 'client-run-item-dup'
        },
        {
          templateItemId: 'tmpl-item-002',
          id: 'client-run-item-dup'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'invalid_request');
});

test('Firestore event 内部同期 API は shared secret 不一致を拒否する', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      FIRESTORE_EVENT_SYNC_SECRET: 'sync-secret'
    }
  });
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(createBaseDataset()),
    snapshotClient: null
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/internal/firestore-events:apply',
    query: {},
    body: {
      syncSecret: 'wrong-secret',
      event: {}
    }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'forbidden');
});

test('Firestore template_insert event は週間月間タスクを期間開始日の run に保存する', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      ADMIN_LOGIN_ID: 'admin-login',
      ADMIN_LOGIN_PASSWORD: 'admin-password',
      FIRESTORE_EVENT_SYNC_SECRET: 'sync-secret'
    },
    enableCacheService: true
  });
  const seed = createBaseDataset();
  seed.checklist_template_items = [
    {
      id: 'tmpl-item-weekly',
      template_id: 'tmpl-001',
      title: '週間確認',
      description: '',
      period: 'weekly',
      sort_order: '1',
      is_required: 'true',
      is_active: 'true',
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    },
    {
      id: 'tmpl-item-monthly',
      template_id: 'tmpl-001',
      title: '月間確認',
      description: '',
      period: 'monthly',
      sort_order: '2',
      is_required: 'true',
      is_active: 'true',
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    }
  ];
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    snapshotClient: {
      writeTodaySnapshot() {
        return { responseCode: 200 };
      }
    },
    clock: {
      now() {
        return new Date('2026-04-25T03:00:00Z');
      },
      today() {
        return '2026-04-25';
      },
      yesterday() {
        return '2026-04-24';
      }
    }
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/internal/firestore-events:apply',
    query: {},
    body: {
      syncSecret: 'sync-secret',
      eventId: 'event-template-insert',
      storeId: 'store-001',
      targetDate: '2026-04-25',
      event: {
        type: 'template_insert',
        storeId: 'store-001',
        targetDate: '2026-04-25',
        runId: 'client-run-20260425',
        templateId: 'tmpl-001',
        items: [
          {
            id: 'client-run-item-weekly',
            templateItemId: 'tmpl-item-weekly'
          },
          {
            id: 'client-run-item-monthly',
            templateItemId: 'tmpl-item-monthly'
          }
        ]
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.result.insertedCount, 2);
  const weeklyItem = app.repository.findRunItemById('client-run-item-weekly');
  const monthlyItem = app.repository.findRunItemById('client-run-item-monthly');
  assert.equal(app.repository.findRunById(weeklyItem.run_id).target_date, '2026-04-19');
  assert.equal(app.repository.findRunById(monthlyItem.run_id).target_date, '2026-04-01');

  const token = loginAsAdmin(app);
  const adminRun = app.handleApiRequest({
    method: 'GET',
    path: '/api/admin/runs/2026-04-25',
    query: { adminToken: token },
    body: {}
  });

  assert.equal(adminRun.statusCode, 200);
  assert.equal(
    JSON.stringify(adminRun.body.checklist.items.map((item) => [item.id, item.period])),
    JSON.stringify([
      ['client-run-item-weekly', 'weekly'],
      ['client-run-item-monthly', 'monthly']
    ])
  );
});

test('Firestore status event は認証なしの内部同期で run item の完了状態を更新する', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      FIRESTORE_EVENT_SYNC_SECRET: 'sync-secret'
    }
  });
  const seed = createBaseDataset();
  seed.checklist_runs = [
    {
      id: 'run-week',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-19',
      status: 'open',
      notified_at: '2026-04-19T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-19T01:30:00Z'
    },
    {
      id: 'run-day',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-25',
      status: 'open',
      notified_at: '2026-04-25T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-25T01:30:00Z'
    }
  ];
  seed.checklist_run_items = [
    {
      id: 'run-item-weekly',
      run_id: 'run-week',
      template_item_id: 'tmpl-item-002',
      title: '週間確認',
      period: 'weekly',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-19T01:30:00Z'
    }
  ];
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    snapshotClient: {
      writeTodaySnapshot() {
        return { responseCode: 200 };
      }
    }
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/internal/firestore-events:apply',
    query: {},
    body: {
      syncSecret: 'sync-secret',
      eventId: 'event-status',
      storeId: 'store-001',
      targetDate: '2026-04-25',
      event: {
        storeId: 'store-001',
        targetDate: '2026-04-25',
        runId: 'run-day',
        itemId: 'run-item-weekly',
        status: 'checked',
        checkedBy: '蒼太',
        checkedByUserId: 'line-user-sota',
        checkedAt: '2026-04-25T12:00:00.000Z',
        updatedAt: '2026-04-25T12:00:01.000Z'
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const updatedItem = app.repository.findRunItemById('run-item-weekly');
  assert.equal(updatedItem.status, 'checked');
  assert.equal(updatedItem.checked_by, 'line-user-sota');
  assert.equal(updatedItem.checked_by_name, '蒼太');
  assert.equal(updatedItem.checked_at, '2026-04-25T12:00:00Z');
});

test('Firestore events 定期同期は reader から取得した template_insert を Spreadsheet へ反映する', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      FIRESTORE_EVENT_SYNC_SECRET: 'sync-secret'
    }
  });
  const seed = createBaseDataset();
  seed.checklist_template_items = [
    {
      id: 'tmpl-item-weekly',
      template_id: 'tmpl-001',
      title: '週間確認',
      description: '',
      period: 'weekly',
      sort_order: '1',
      is_required: 'true',
      is_active: 'true',
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    }
  ];
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    snapshotClient: {
      writeTodaySnapshot() {
        return { responseCode: 200 };
      }
    },
    firestoreEventReader: {
      listRunEvents(storeId, targetDate) {
        assert.equal(storeId, 'store-001');
        assert.equal(targetDate, '2026-04-25');
        return [
          {
            id: 'event-template-insert',
            type: 'template_insert',
            emittedAt: '2026-04-25T12:00:00Z',
            storeId: 'store-001',
            targetDate: '2026-04-25',
            runId: 'client-run-20260425',
            templateId: 'tmpl-001',
            items: [
              {
                id: 'client-run-item-weekly-sync',
                templateItemId: 'tmpl-item-weekly'
              }
            ]
          }
        ];
      }
    }
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/internal/firestore-events:sync',
    query: {},
    body: {
      syncSecret: 'sync-secret',
      storeId: 'store-001',
      targetDate: '2026-04-25'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.appliedCount, 1);
  const weeklyItem = app.repository.findRunItemById('client-run-item-weekly-sync');
  assert.equal(app.repository.findRunById(weeklyItem.run_id).target_date, '2026-04-19');

  const secondResponse = app.handleApiRequest({
    method: 'POST',
    path: '/api/internal/firestore-events:sync',
    query: {},
    body: {
      syncSecret: 'sync-secret',
      storeId: 'store-001',
      targetDate: '2026-04-25'
    }
  });

  assert.equal(secondResponse.statusCode, 200);
  assert.equal(secondResponse.body.appliedCount, 0);
  assert.equal(secondResponse.body.skippedCount, 1);
});

test('scheduled-items repair は既存 run に日間予定タスクだけを補修する', async () => {
  const runtime = await loadGasRuntime({
    scriptProperties: {
      FIRESTORE_EVENT_SYNC_SECRET: 'sync-secret'
    }
  });
  const seed = createBaseDataset();
  seed.checklist_runs = [
    {
      id: 'run-empty-day',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-25',
      status: 'open',
      notified_at: '2026-04-25T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-25T01:30:00Z'
    }
  ];
  seed.checklist_run_items = [];
  seed.checklist_template_items = [
    {
      id: 'tmpl-item-daily',
      template_id: 'tmpl-001',
      title: '日間確認',
      description: '',
      period: 'daily',
      sort_order: '1',
      is_required: 'true',
      is_active: 'true',
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    },
    {
      id: 'tmpl-item-weekly',
      template_id: 'tmpl-001',
      title: '週間確認',
      description: '',
      period: 'weekly',
      sort_order: '2',
      is_required: 'true',
      is_active: 'true',
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    }
  ];
  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    snapshotClient: {
      writeTodaySnapshot() {
        return { responseCode: 200 };
      }
    }
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/internal/scheduled-items:repair',
    query: {},
    body: {
      syncSecret: 'sync-secret',
      storeId: 'store-001',
      targetDate: '2026-04-25'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.insertedCount, 1);
  assert.equal(response.body.items[0].title, '日間確認');
  assert.equal(app.repository.listRunItems('run-empty-day').length, 1);

  const secondResponse = app.handleApiRequest({
    method: 'POST',
    path: '/api/internal/scheduled-items:repair',
    query: {},
    body: {
      syncSecret: 'sync-secret',
      storeId: 'store-001',
      targetDate: '2026-04-25'
    }
  });

  assert.equal(secondResponse.statusCode, 200);
  assert.equal(secondResponse.body.insertedCount, 0);
});
