import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

test('主要シート構成を初期化できる', async () => {
  const runtime = await loadGasRuntime();
  const storage = runtime.Ogawaya.createArrayStorage({});
  const repository = runtime.Ogawaya.createSpreadsheetRepository({ storage });

  repository.ensureSchema();

  assert.equal(repository.getSheetNames().join(','), [
    'stores',
    'users',
    'line_accounts',
    'checklist_templates',
    'checklist_template_items',
    'checklist_runs',
    'checklist_run_items',
    'checklist_item_logs',
    'notifications'
  ].join(','));
});

test('(store_id, template_id, target_date) の重複を拒否する', async () => {
  const runtime = await loadGasRuntime();
  const storage = runtime.Ogawaya.createArrayStorage(createBaseDataset());
  const repository = runtime.Ogawaya.createSpreadsheetRepository({ storage });

  repository.createChecklistRun({
    id: 'run-001',
    template_id: 'tmpl-001',
    store_id: 'store-001',
    target_date: '2026-04-21',
    status: 'open',
    notified_at: '2026-04-21T01:30:00Z',
    closed_at: '',
    created_at: '2026-04-21T01:30:00Z'
  });

  assert.throws(() => {
    repository.createChecklistRun({
      id: 'run-002',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-21',
      status: 'open',
      notified_at: '2026-04-21T01:31:00Z',
      closed_at: '',
      created_at: '2026-04-21T01:31:00Z'
    });
  }, /duplicate/i);
});

test('日付とタイムスタンプの形式を検証する', async () => {
  const runtime = await loadGasRuntime();
  const storage = runtime.Ogawaya.createArrayStorage(createBaseDataset());
  const repository = runtime.Ogawaya.createSpreadsheetRepository({ storage });

  assert.throws(() => {
    repository.createChecklistRun({
      id: 'run-001',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026/04/21',
      status: 'open',
      notified_at: '2026-04-21 01:30:00',
      closed_at: '',
      created_at: '2026-04-21T01:30:00Z'
    });
  }, /target_date/);
});

test('不正データ投入時はロールバックされる', async () => {
  const runtime = await loadGasRuntime();
  const initialDataset = createBaseDataset();
  const storage = runtime.Ogawaya.createArrayStorage(initialDataset);
  const repository = runtime.Ogawaya.createSpreadsheetRepository({ storage });

  assert.throws(() => {
    repository.replaceTable('users', [
      ...initialDataset.users,
      {
        id: 'broken-user',
        store_id: 'store-001',
        name: '不正ユーザー',
        employee_code: 'BROKEN',
        passcode: '444444',
        role: 'invalid',
        status: 'active',
        created_at: '2026-04-20T00:00:00Z'
      }
    ]);
  }, /role/);

  assert.equal(repository.listTable('users').length, initialDataset.users.length);
});

test('Spreadsheet 読み込みは display values を使い、0 と false を空文字に潰さない', async () => {
  const runtime = await loadGasRuntime({
    spreadsheetFactory() {
      return {
        getSheetByName(sheetName) {
          if (sheetName !== 'stores') {
            return null;
          }
          return {
            getDataRange() {
              return {
                getDisplayValues() {
                  return [
                    ['id', 'name', 'status', 'created_at'],
                    ['store-001', 0, false, '2026-04-20T00:00:00Z']
                  ];
                }
              };
            }
          };
        }
      };
    }
  });
  const repository = runtime.Ogawaya.createSpreadsheetRepository({
    spreadsheetId: 'spreadsheet-001'
  });

  const stores = repository.listTable('stores');
  assert.equal(stores[0].name, '0');
  assert.equal(stores[0].status, 'false');
});

test('テンプレートと項目の一括取得は storage.load を 1 回に抑える', async () => {
  const runtime = await loadGasRuntime();
  let state = createBaseDataset();
  let loadCount = 0;
  const storage = {
    load() {
      loadCount += 1;
      return JSON.parse(JSON.stringify(state));
    },
    save(nextState) {
      state = JSON.parse(JSON.stringify(nextState));
    }
  };
  const repository = runtime.Ogawaya.createSpreadsheetRepository({ storage });

  const templates = repository.listActiveTemplatesWithItems('store-001');

  assert.equal(loadCount, 1);
  assert.equal(templates.length, 1);
  assert.equal(templates[0].template.id, 'tmpl-001');
  assert.equal(templates[0].items.length, 2);
});

test('is_active が TRUE/FALSE 表示値でもアクティブ判定できる', async () => {
  const runtime = await loadGasRuntime();
  const dataset = createBaseDataset();
  dataset.checklist_templates[0].is_active = 'TRUE';
  dataset.checklist_template_items[0].is_active = 'TRUE';
  dataset.checklist_template_items[1].is_active = 'TRUE';
  const storage = runtime.Ogawaya.createArrayStorage(dataset);
  const repository = runtime.Ogawaya.createSpreadsheetRepository({ storage });

  const templates = repository.listActiveTemplatesWithItems('store-001');

  assert.equal(templates.length, 1);
  assert.equal(templates[0].template.id, 'tmpl-001');
  assert.equal(templates[0].items.length, 2);
});

test('runItemIds が既知ならログ一括取得は storage.load を 1 回に抑える', async () => {
  const runtime = await loadGasRuntime();
  let state = createBaseDataset();
  let loadCount = 0;
  state.checklist_runs = [
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
  state.checklist_run_items = [
    {
      id: 'run-item-001',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-001',
      title: '開店準備',
      sort_order: '1',
      status: 'checked',
      checked_by: 'user-pt-001',
      checked_at: '2026-04-21T01:35:00Z',
      updated_at: '2026-04-21T01:35:00Z'
    }
  ];
  state.checklist_item_logs = [
    {
      id: 'log-001',
      run_item_id: 'run-item-001',
      action: 'check',
      user_id: 'user-pt-001',
      before_value: '{}',
      after_value: '{}',
      is_after_close: 'false',
      created_at: '2026-04-21T01:35:00Z'
    }
  ];
  const storage = {
    load() {
      loadCount += 1;
      return JSON.parse(JSON.stringify(state));
    },
    save(nextState) {
      state = JSON.parse(JSON.stringify(nextState));
    }
  };
  const repository = runtime.Ogawaya.createSpreadsheetRepository({ storage });

  const logs = repository.listLogsByRunItemIds(['run-item-001']);

  assert.equal(loadCount, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].id, 'log-001');
});
