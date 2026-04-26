var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  ns.IMPORT_TEMPLATE_ROWS = {
    stores: [
      {
        id: 'store-001',
        name: '青山店',
        status: 'active',
        created_at: '2026-04-22T00:00:00Z'
      }
    ],
    users: [
      {
        id: 'user-pt-001',
        store_id: 'store-001',
        name: '田中 花子',
        employee_code: 'PT001',
        passcode: '111111',
        role: 'part_time',
        status: 'active',
        created_at: '2026-04-22T00:00:00Z'
      },
      {
        id: 'user-mg-001',
        store_id: 'store-001',
        name: '山田 太郎',
        employee_code: 'MG001',
        passcode: '222222',
        role: 'manager',
        status: 'active',
        created_at: '2026-04-22T00:00:00Z'
      },
      {
        id: 'user-ad-001',
        store_id: 'store-001',
        name: '本部 次郎',
        employee_code: 'AD001',
        passcode: '333333',
        role: 'admin',
        status: 'active',
        created_at: '2026-04-22T00:00:00Z'
      }
    ],
    line_accounts: [],
    notification_channels: [],
    notification_recipients: [],
    notification_channel_usage: [],
    checklist_templates: [
      {
        id: 'tmpl-001',
        store_id: 'store-001',
        name: '日次チェックリスト',
        period: 'daily',
        notify_time: '10:30',
        closing_time: '00:00',
        is_active: 'true',
        created_by: 'user-mg-001',
        created_at: '2026-04-22T00:00:00Z',
        updated_at: '2026-04-22T00:00:00Z'
      }
    ],
    checklist_template_items: [
      {
        id: 'tmpl-item-001',
        template_id: 'tmpl-001',
        title: '開店準備',
        description: '',
        period: 'daily',
        sort_order: '1',
        is_required: 'true',
        is_active: 'true',
        created_at: '2026-04-22T00:00:00Z',
        updated_at: '2026-04-22T00:00:00Z'
      },
      {
        id: 'tmpl-item-002',
        template_id: 'tmpl-001',
        title: '清掃確認',
        description: '',
        period: 'daily',
        sort_order: '2',
        is_required: 'true',
        is_active: 'true',
        created_at: '2026-04-22T00:00:00Z',
        updated_at: '2026-04-22T00:00:00Z'
      }
    ],
    checklist_runs: [],
    checklist_run_items: [],
    checklist_item_logs: [],
    notifications: []
  };

  function listNonEmptyRows(values) {
    return (values || []).filter(function (row) {
      return row.join('') !== '';
    });
  }

  function isSameRow(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function isBootstrapSafeSheet(sheet, sheetName) {
    if (!sheet) {
      return true;
    }
    var nonEmptyRows = listNonEmptyRows(sheet.getDataRange().getDisplayValues());
    if (nonEmptyRows.length === 0) {
      return true;
    }
    return nonEmptyRows.length === 1 && isSameRow(nonEmptyRows[0], ns.SHEET_DEFINITIONS[sheetName]);
  }

  ns.createImportTemplateState = function () {
    var state = {};
    ns.getSheetNames().forEach(function (sheetName) {
      state[sheetName] = (ns.IMPORT_TEMPLATE_ROWS[sheetName] || []).map(ns.clone);
    });
    return state;
  };

  ns.bootstrapSpreadsheetTemplates = function (options) {
    var spreadsheetId = options && options.spreadsheetId
      ? options.spreadsheetId
      : PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    ns.assert(spreadsheetId, 'config_error', 'SPREADSHEET_ID が未設定です', 500);

    var spreadsheet = options && options.spreadsheet
      ? options.spreadsheet
      : SpreadsheetApp.openById(spreadsheetId);
    var blockedSheets = ns.getSheetNames().filter(function (sheetName) {
      return !isBootstrapSafeSheet(spreadsheet.getSheetByName(sheetName), sheetName);
    });
    ns.assert(
      blockedSheets.length === 0,
      'invalid_state',
      '初期化対象のシートに既存データがあります: ' + blockedSheets.join(', '),
      409
    );

    var storage = options && options.storage
      ? options.storage
      : ns.createSpreadsheetStorage({ spreadsheetId: spreadsheetId });
    var state = ns.createImportTemplateState();
    storage.save(state);

    return {
      ok: true,
      sheetNames: ns.getSheetNames(),
      seededRowCounts: ns.getSheetNames().reduce(function (counts, sheetName) {
        counts[sheetName] = state[sheetName].length;
        return counts;
      }, {})
    };
  };
})(Ogawaya);
