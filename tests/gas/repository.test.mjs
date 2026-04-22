import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

function createScriptCache() {
  const entries = new Map();
  return {
    get(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    put(key, value) {
      entries.set(key, String(value));
    },
    remove(key) {
      entries.delete(key);
    }
  };
}

function createStoresSheet(initialRows) {
  const headers = ['id', 'name', 'status', 'created_at'];
  let values = [headers].concat(initialRows.map((row) => [
    String(row.id || ''),
    String(row.name || ''),
    String(row.status || ''),
    String(row.created_at || '')
  ]));
  const counters = {
    reads: 0,
    clears: 0,
    writes: 0
  };

  return {
    sheet: {
      getDataRange() {
        return {
          getDisplayValues() {
            counters.reads += 1;
            return values.map((row) => row.slice());
          }
        };
      },
      clearContents() {
        counters.clears += 1;
        values = [headers.slice()];
      },
      getRange() {
        return {
          setValues(nextValues) {
            counters.writes += 1;
            values = nextValues.map((row) => row.map((cell) => String(cell == null ? '' : cell)));
          }
        };
      }
    },
    counters,
    getValues() {
      return values.map((row) => row.slice());
    }
  };
}

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

test('Spreadsheet state cache 有効時は新規 repository でも再読込を回避する', async () => {
  const seed = createBaseDataset();
  const cache = createScriptCache();
  const stores = createStoresSheet(seed.stores);
  let openCount = 0;

  const runtime = await loadGasRuntime({
    scriptProperties: {
      SPREADSHEET_ID: 'spreadsheet-001'
    },
    cacheFactory() {
      return cache;
    },
    spreadsheetFactory() {
      openCount += 1;
      return {
        getSheetByName(sheetName) {
          if (sheetName === 'stores') {
            return stores.sheet;
          }
          return null;
        },
        insertSheet() {
          return stores.sheet;
        }
      };
    }
  });

  const repository1 = runtime.Ogawaya.createSpreadsheetRepository({ spreadsheetId: 'spreadsheet-001' });
  assert.equal(repository1.listTable('stores').length, 1);
  assert.equal(openCount, 1);

  const repository2 = runtime.Ogawaya.createSpreadsheetRepository({ spreadsheetId: 'spreadsheet-001' });
  assert.equal(repository2.listTable('stores').length, 1);
  assert.equal(openCount, 1);
});

test('Spreadsheet save 後は cache を更新し、次の repository でも更新値を返す', async () => {
  const seed = createBaseDataset();
  const cache = createScriptCache();
  const stores = createStoresSheet(seed.stores);
  let openCount = 0;

  const runtime = await loadGasRuntime({
    scriptProperties: {
      SPREADSHEET_ID: 'spreadsheet-001'
    },
    cacheFactory() {
      return cache;
    },
    spreadsheetFactory() {
      openCount += 1;
      return {
        getSheetByName(sheetName) {
          if (sheetName === 'stores') {
            return stores.sheet;
          }
          return null;
        },
        insertSheet() {
          return stores.sheet;
        }
      };
    }
  });

  const repository1 = runtime.Ogawaya.createSpreadsheetRepository({ spreadsheetId: 'spreadsheet-001' });
  repository1.listTable('stores');
  repository1.replaceTable('stores', [
    {
      id: 'store-002',
      name: '渋谷店',
      status: 'active',
      created_at: '2026-04-21T00:00:00Z'
    }
  ]);

  assert.equal(stores.counters.writes, 1);
  assert.equal(openCount, 1);

  const repository2 = runtime.Ogawaya.createSpreadsheetRepository({ spreadsheetId: 'spreadsheet-001' });
  const nextStores = repository2.listTable('stores');
  assert.equal(nextStores.length, 1);
  assert.equal(nextStores[0].id, 'store-002');
  assert.equal(openCount, 1);
});

test('SPREADSHEET_STATE_CACHE_ENABLED=false のときは毎回 Spreadsheet を読み込む', async () => {
  const seed = createBaseDataset();
  const cache = createScriptCache();
  const stores = createStoresSheet(seed.stores);
  let openCount = 0;

  const runtime = await loadGasRuntime({
    scriptProperties: {
      SPREADSHEET_ID: 'spreadsheet-001',
      SPREADSHEET_STATE_CACHE_ENABLED: 'false'
    },
    cacheFactory() {
      return cache;
    },
    spreadsheetFactory() {
      openCount += 1;
      return {
        getSheetByName(sheetName) {
          if (sheetName === 'stores') {
            return stores.sheet;
          }
          return null;
        },
        insertSheet() {
          return stores.sheet;
        }
      };
    }
  });

  const repository1 = runtime.Ogawaya.createSpreadsheetRepository({ spreadsheetId: 'spreadsheet-001' });
  repository1.listTable('stores');
  const repository2 = runtime.Ogawaya.createSpreadsheetRepository({ spreadsheetId: 'spreadsheet-001' });
  repository2.listTable('stores');

  assert.equal(openCount, 2);
});
