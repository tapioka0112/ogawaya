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
    },
    {
      id: 'run-item-002',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-002',
      title: '清掃確認',
      sort_order: '2',
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
          'valid-pt': { lineUserId: 'line-user-001', displayName: '田中LINE' },
          'valid-mg': { lineUserId: 'line-user-002', displayName: '山田LINE' }
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

async function createMonthlyStatsApp() {
  const runtime = await loadGasRuntime();
  const seed = createBaseDataset();
  seed.checklist_runs = [
    {
      id: 'run-0401-a',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-01',
      status: 'open',
      notified_at: '2026-04-01T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-01T01:30:00Z'
    },
    {
      id: 'run-0401-b',
      template_id: 'tmpl-002',
      store_id: 'store-001',
      target_date: '2026-04-01',
      status: 'open',
      notified_at: '2026-04-01T01:35:00Z',
      closed_at: '',
      created_at: '2026-04-01T01:35:00Z'
    },
    {
      id: 'run-0402-a',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-02',
      status: 'open',
      notified_at: '2026-04-02T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-02T01:30:00Z'
    },
    {
      id: 'run-0501-a',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-05-01',
      status: 'open',
      notified_at: '2026-05-01T01:30:00Z',
      closed_at: '',
      created_at: '2026-05-01T01:30:00Z'
    }
  ];
  seed.checklist_run_items = [
    {
      id: 'item-0401-a-1',
      run_id: 'run-0401-a',
      template_item_id: 'tmpl-item-001',
      title: 'A-1',
      sort_order: '1',
      status: 'checked',
      checked_by: 'line-user-001',
      checked_by_name: '田中LINE',
      checked_at: '2026-04-01T02:00:00Z',
      updated_at: '2026-04-01T02:00:00Z'
    },
    {
      id: 'item-0401-a-2',
      run_id: 'run-0401-a',
      template_item_id: 'tmpl-item-002',
      title: 'A-2',
      sort_order: '2',
      status: 'checked',
      checked_by: 'line-user-002',
      checked_by_name: '山田LINE',
      checked_at: '2026-04-01T02:01:00Z',
      updated_at: '2026-04-01T02:01:00Z'
    },
    {
      id: 'item-0401-b-1',
      run_id: 'run-0401-b',
      template_item_id: 'tmpl-item-003',
      title: 'B-1',
      sort_order: '1',
      status: 'checked',
      checked_by: 'line-user-001',
      checked_by_name: '田中LINE',
      checked_at: '2026-04-01T02:02:00Z',
      updated_at: '2026-04-01T02:02:00Z'
    },
    {
      id: 'item-0402-a-1',
      run_id: 'run-0402-a',
      template_item_id: 'tmpl-item-001',
      title: 'C-1',
      sort_order: '1',
      status: 'checked',
      checked_by: 'line-user-001',
      checked_by_name: '田中LINE',
      checked_at: '2026-04-02T02:00:00Z',
      updated_at: '2026-04-02T02:00:00Z'
    },
    {
      id: 'item-0402-a-2',
      run_id: 'run-0402-a',
      template_item_id: 'tmpl-item-002',
      title: 'C-2',
      sort_order: '2',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-02T02:00:00Z'
    },
    {
      id: 'item-0501-a-1',
      run_id: 'run-0501-a',
      template_item_id: 'tmpl-item-001',
      title: 'MAY-1',
      sort_order: '1',
      status: 'checked',
      checked_by: 'line-user-001',
      checked_by_name: '田中LINE',
      checked_at: '2026-05-01T02:00:00Z',
      updated_at: '2026-05-01T02:00:00Z'
    }
  ];

  return runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    identityClient: {
      verifyIdToken(idToken) {
        const map = {
          'valid-pt': { lineUserId: 'line-user-001', displayName: '田中LINE' },
          'valid-mg': { lineUserId: 'line-user-002', displayName: '山田LINE' }
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
  assert.equal(response.body.currentUser.userId, 'line-user-001');
  assert.equal(response.body.currentUser.name, '田中LINE');
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
  assert.equal(response.body.currentUser.userId, 'anonymous');
  assert.equal(app.repository.listRunsByDate('2026-04-22').length, 1);
});

test('匿名アクセス有効でも更新系 API は未認証で拒否する', async () => {
  const app = await createAnonymousChecklistApp();

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/check',
    query: {},
    body: {}
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'unauthorized');
});

test('check 後に checked へ遷移し、チェック者は LINE 表示名で保存される', async () => {
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
  assert.equal(response.body.item.checkedBy, '田中LINE');
  assert.equal(response.body.item.checkedByUserId, 'line-user-001');
  assert.match(response.body.item.checkedAt, /2026-04-21T02:00:00Z/);
  assert.match(response.body.item.updatedAt, /2026-04-21T02:00:00Z/);
});

test('再チェックは冪等に扱い、チェック状態を維持する', async () => {
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
  assert.equal(response.body.item.checkedBy, '田中LINE');
});

test('他ユーザーのチェックも取り消せる（ロール制限なし）', async () => {
  const app = await createChecklistApp();

  app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/check',
    query: { idToken: 'valid-mg' },
    body: {
      comment: '管理者確認'
    }
  });

  const response = app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-001/uncheck',
    query: { idToken: 'valid-pt' },
    body: {
      reason: '取り消し'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.item.status, 'unchecked');
});

test('操作履歴 API は廃止され 404 を返す', async () => {
  const app = await createChecklistApp();

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/run-001/logs',
    query: { idToken: 'valid-pt' },
    body: {}
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'not_found');
});

test('GET /api/stats/monthly は月次統計を返す', async () => {
  const app = await createMonthlyStatsApp();

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/stats/monthly',
    query: { idToken: 'valid-pt', year: '2026', month: '4' },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.year, 2026);
  assert.equal(response.body.month, 4);
  assert.equal(response.body.totalDays, 2);
  assert.equal(response.body.achievedDays, 1);
  assert.equal(response.body.totalItems, 5);
  assert.equal(response.body.myCheckedItems, 3);
  assert.equal(
    JSON.stringify(response.body.calendar),
    JSON.stringify([
      { date: '2026-04-01', achieved: true, total: 3, checked: 3 },
      { date: '2026-04-02', achieved: false, total: 2, checked: 1 }
    ])
  );
});

test('GET /api/stats/monthly は不正な month を 400 で拒否する', async () => {
  const app = await createMonthlyStatsApp();

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/stats/monthly',
    query: { idToken: 'valid-pt', year: '2026', month: '13' },
    body: {}
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'invalid_request');
});

test('GET /api/stats/monthly は未認証で 401 を返す', async () => {
  const app = await createMonthlyStatsApp();

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/stats/monthly',
    query: { year: '2026', month: '4' },
    body: {}
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'unauthorized');
});

test('GET /api/stats/monthly は該当月 run なしなら空集計を返す', async () => {
  const app = await createMonthlyStatsApp();

  const response = app.handleApiRequest({
    method: 'GET',
    path: '/api/stats/monthly',
    query: { idToken: 'valid-pt', year: '2026', month: '6' },
    body: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totalDays, 0);
  assert.equal(response.body.achievedDays, 0);
  assert.equal(response.body.totalItems, 0);
  assert.equal(response.body.myCheckedItems, 0);
  assert.equal(JSON.stringify(response.body.calendar), JSON.stringify([]));
});
