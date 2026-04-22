import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';

const importCsvFiles = {
  stores: 'docs/operations/import/stores.csv',
  users: 'docs/operations/import/users.csv',
  line_accounts: 'docs/operations/import/line_accounts.csv',
  checklist_templates: 'docs/operations/import/checklist_templates.csv',
  checklist_template_items: 'docs/operations/import/checklist_template_items.csv',
  checklist_runs: 'docs/operations/import/checklist_runs.csv',
  checklist_run_items: 'docs/operations/import/checklist_run_items.csv',
  checklist_item_logs: 'docs/operations/import/checklist_item_logs.csv',
  notifications: 'docs/operations/import/notifications.csv'
};

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseCsvRows(content) {
  const lines = content.trimEnd().split(/\r?\n/);
  const headers = lines[0].split(',');

  return lines.slice(1).filter((line) => line !== '').map((line) => {
    const values = line.split(',');
    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? '';
      return row;
    }, {});
  });
}

function createSheet(initialValues = []) {
  let values = initialValues.map((row) => row.slice());

  return {
    getDataRange() {
      return {
        getDisplayValues() {
          return values.map((row) => row.slice());
        },
        getValues() {
          return values.map((row) => row.slice());
        }
      };
    },
    clearContents() {
      values = [];
    },
    getRange() {
      return {
        setValues(nextValues) {
          values = nextValues.map((row) => row.map((value) => (value == null ? '' : String(value))));
        }
      };
    },
    dump() {
      return values.map((row) => row.slice());
    }
  };
}

function createSpreadsheet(initialSheets = {}) {
  const sheets = new Map(
    Object.entries(initialSheets).map(([sheetName, values]) => [sheetName, createSheet(values)])
  );

  return {
    getSheetByName(sheetName) {
      return sheets.get(sheetName) || null;
    },
    insertSheet(sheetName) {
      const sheet = createSheet();
      sheets.set(sheetName, sheet);
      return sheet;
    },
    dumpSheet(sheetName) {
      const sheet = sheets.get(sheetName);
      return sheet ? sheet.dump() : null;
    }
  };
}

test('bootstrapSpreadsheetTemplates は空 Spreadsheet にテンプレートを一括投入できる', async () => {
  const spreadsheet = createSpreadsheet();
  const runtime = await loadGasRuntime({
    scriptProperties: {
      SPREADSHEET_ID: 'spreadsheet-001'
    },
    spreadsheetFactory(spreadsheetId) {
      assert.equal(spreadsheetId, 'spreadsheet-001');
      return spreadsheet;
    }
  });

  const result = runtime.bootstrapSpreadsheetTemplates();

  assert.equal(result.ok, true);
  assert.deepEqual(normalize(result.sheetNames), normalize(runtime.Ogawaya.getSheetNames()));
  assert.deepEqual(normalize(spreadsheet.dumpSheet('stores')), [
    ['id', 'name', 'status', 'created_at'],
    ['store-001', '青山店', 'active', '2026-04-22T00:00:00Z']
  ]);
  assert.deepEqual(normalize(spreadsheet.dumpSheet('users')), [
    ['id', 'store_id', 'name', 'employee_code', 'passcode', 'role', 'status', 'created_at'],
    ['user-pt-001', 'store-001', '田中 花子', 'PT001', '111111', 'part_time', 'active', '2026-04-22T00:00:00Z'],
    ['user-mg-001', 'store-001', '山田 太郎', 'MG001', '222222', 'manager', 'active', '2026-04-22T00:00:00Z'],
    ['user-ad-001', 'store-001', '本部 次郎', 'AD001', '333333', 'admin', 'active', '2026-04-22T00:00:00Z']
  ]);
  assert.deepEqual(normalize(spreadsheet.dumpSheet('checklist_templates')), [
    ['id', 'store_id', 'name', 'notify_time', 'closing_time', 'is_active', 'created_by', 'created_at', 'updated_at'],
    ['tmpl-001', 'store-001', '日次チェックリスト', '10:30', '00:00', 'true', 'user-mg-001', '2026-04-22T00:00:00Z', '2026-04-22T00:00:00Z']
  ]);
  assert.deepEqual(normalize(spreadsheet.dumpSheet('checklist_template_items')), [
    ['id', 'template_id', 'title', 'description', 'sort_order', 'is_required', 'is_active', 'created_at', 'updated_at'],
    ['tmpl-item-001', 'tmpl-001', '開店準備', '', '1', 'true', 'true', '2026-04-22T00:00:00Z', '2026-04-22T00:00:00Z'],
    ['tmpl-item-002', 'tmpl-001', '清掃確認', '', '2', 'true', 'true', '2026-04-22T00:00:00Z', '2026-04-22T00:00:00Z']
  ]);
});

test('bootstrapSpreadsheetTemplates は既存データがある対象シートでは失敗する', async () => {
  const spreadsheet = createSpreadsheet({
    stores: [
      ['id', 'name', 'status', 'created_at'],
      ['store-existing', '既存店', 'active', '2026-04-20T00:00:00Z']
    ]
  });
  const runtime = await loadGasRuntime({
    scriptProperties: {
      SPREADSHEET_ID: 'spreadsheet-001'
    },
    spreadsheetFactory() {
      return spreadsheet;
    }
  });

  assert.throws(() => {
    runtime.bootstrapSpreadsheetTemplates();
  }, /既存データ/);
});

test('createImportTemplateState は CSV fallback と同じ内容を返す', async () => {
  const runtime = await loadGasRuntime();
  const state = normalize(runtime.Ogawaya.createImportTemplateState());

  for (const [sheetName, path] of Object.entries(importCsvFiles)) {
    const content = await readFile(path, 'utf8');
    assert.deepEqual(state[sheetName], parseCsvRows(content));
  }
});
