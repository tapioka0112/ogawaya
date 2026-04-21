(function (ns) {
  function ensureStateShape(state) {
    var nextState = ns.clone(state || {});
    ns.getSheetNames().forEach(function (sheetName) {
      if (!Array.isArray(nextState[sheetName])) {
        nextState[sheetName] = [];
      }
    });
    return nextState;
  }

  function validateTimestamp(value, fieldName) {
    if (!value) {
      return;
    }
    ns.assert(ns.isIsoTimestamp(value), 'invalid_data', fieldName + ' の形式が不正です', 400);
  }

  function validateDate(value, fieldName) {
    ns.assert(ns.isDateString(value), 'invalid_data', fieldName + ' の形式が不正です', 400);
  }

  function validateRow(sheetName, row) {
    if (sheetName === 'users') {
      ns.assert([ns.ROLES.PART_TIME, ns.ROLES.MANAGER, ns.ROLES.ADMIN].indexOf(row.role) !== -1, 'invalid_data', 'role が不正です', 400);
      validateTimestamp(row.created_at, 'users.created_at');
      ns.requireString(row.passcode, 'passcode');
    }
    if (sheetName === 'stores') {
      validateTimestamp(row.created_at, 'stores.created_at');
    }
    if (sheetName === 'line_accounts') {
      validateTimestamp(row.linked_at, 'line_accounts.linked_at');
    }
    if (sheetName === 'checklist_templates') {
      validateTimestamp(row.created_at, 'checklist_templates.created_at');
      validateTimestamp(row.updated_at, 'checklist_templates.updated_at');
      ns.assert(ns.isTimeString(row.notify_time), 'invalid_data', 'notify_time の形式が不正です', 400);
      ns.assert(ns.isTimeString(row.closing_time), 'invalid_data', 'closing_time の形式が不正です', 400);
    }
    if (sheetName === 'checklist_template_items') {
      validateTimestamp(row.created_at, 'checklist_template_items.created_at');
      validateTimestamp(row.updated_at, 'checklist_template_items.updated_at');
      ns.requireString(row.title, 'title');
    }
    if (sheetName === 'checklist_runs') {
      validateDate(row.target_date, 'target_date');
      validateTimestamp(row.notified_at, 'notified_at');
      validateTimestamp(row.created_at, 'created_at');
      if (row.closed_at) {
        validateTimestamp(row.closed_at, 'closed_at');
      }
      ns.assert([ns.RUN_STATUS.OPEN, ns.RUN_STATUS.CLOSED].indexOf(row.status) !== -1, 'invalid_data', 'checklist_runs.status が不正です', 400);
    }
    if (sheetName === 'checklist_run_items') {
      validateTimestamp(row.updated_at, 'updated_at');
      if (row.checked_at) {
        validateTimestamp(row.checked_at, 'checked_at');
      }
      ns.assert([ns.ITEM_STATUS.UNCHECKED, ns.ITEM_STATUS.CHECKED].indexOf(row.status) !== -1, 'invalid_data', 'checklist_run_items.status が不正です', 400);
    }
    if (sheetName === 'checklist_item_logs') {
      validateTimestamp(row.created_at, 'created_at');
      ns.assert(ns.LOG_ACTIONS.indexOf(row.action) !== -1, 'invalid_data', 'action が不正です', 400);
    }
    if (sheetName === 'notifications') {
      validateTimestamp(row.sent_at, 'sent_at');
      ns.assert(ns.NOTIFICATION_STATUSES.indexOf(row.status) !== -1, 'invalid_data', 'notification status が不正です', 400);
      ns.assert(Object.keys(ns.NOTIFICATION_TYPES).map(function (key) { return ns.NOTIFICATION_TYPES[key]; }).indexOf(row.type) !== -1, 'invalid_data', 'notification type が不正です', 400);
    }
  }

  function validateState(state) {
    ns.getSheetNames().forEach(function (sheetName) {
      state[sheetName].forEach(function (row) {
        validateRow(sheetName, row);
      });
    });

    var runKeys = {};
    state.checklist_runs.forEach(function (run) {
      var key = [run.store_id, run.template_id, run.target_date].join(':');
      ns.assert(!runKeys[key], 'duplicate_run', 'duplicate checklist run', 409);
      runKeys[key] = true;
    });

    var linkedLineUsers = {};
    state.line_accounts.forEach(function (lineAccount) {
      ns.assert(!linkedLineUsers[lineAccount.line_user_id], 'duplicate_link', 'duplicate line_user_id', 409);
      linkedLineUsers[lineAccount.line_user_id] = true;
    });
  }

  function createRepository(storage) {
    function readState() {
      return ensureStateShape(storage.load());
    }

    function commit(mutator) {
      var currentState = readState();
      var draftState = ns.clone(currentState);
      var result = mutator(draftState);
      validateState(draftState);
      storage.save(draftState);
      return result;
    }

    function listTable(sheetName) {
      return readState()[sheetName].map(ns.clone);
    }

    function findRowById(sheetName, rowId) {
      return listTable(sheetName).find(function (row) {
        return row.id === rowId;
      }) || null;
    }

    function replaceTable(sheetName, rows) {
      commit(function (draftState) {
        draftState[sheetName] = rows.map(ns.clone);
      });
    }

    function appendRow(sheetName, row) {
      return commit(function (draftState) {
        draftState[sheetName].push(ns.clone(row));
        return ns.clone(row);
      });
    }

    function updateRow(sheetName, rowId, updater) {
      return commit(function (draftState) {
        var index = draftState[sheetName].findIndex(function (row) {
          return row.id === rowId;
        });
        ns.assert(index !== -1, 'not_found', sheetName + ' が見つかりません', 404);
        draftState[sheetName][index] = updater(ns.clone(draftState[sheetName][index]));
        return ns.clone(draftState[sheetName][index]);
      });
    }

    function findUserByEmployeeCodeAndPasscode(employeeCode, passcode) {
      return listTable('users').find(function (user) {
        return user.employee_code === employeeCode && user.passcode === passcode && user.status === 'active';
      }) || null;
    }

    function findLineAccountByLineUserId(lineUserId) {
      return listTable('line_accounts').find(function (lineAccount) {
        return lineAccount.line_user_id === lineUserId;
      }) || null;
    }

    function findLineAccountByUserId(userId) {
      return listTable('line_accounts').find(function (lineAccount) {
        return lineAccount.user_id === userId;
      }) || null;
    }

    function createLineAccountLink(lineAccount) {
      ns.assert(!findLineAccountByLineUserId(lineAccount.line_user_id), 'duplicate_link', 'LINE アカウントは既に連携済みです', 409);
      ns.assert(!findLineAccountByUserId(lineAccount.user_id), 'duplicate_link', 'ユーザーは既に LINE 連携済みです', 409);
      return appendRow('line_accounts', lineAccount);
    }

    function findLinkedUserByLineUserId(lineUserId) {
      var lineAccount = findLineAccountByLineUserId(lineUserId);
      if (!lineAccount) {
        return null;
      }
      return findRowById('users', lineAccount.user_id);
    }

    function findStoreById(storeId) {
      return findRowById('stores', storeId);
    }

    function findTemplateById(templateId) {
      return findRowById('checklist_templates', templateId);
    }

    function listActiveTemplates() {
      return listTable('checklist_templates').filter(function (template) {
        return ns.parseBoolean(template.is_active);
      });
    }

    function listTemplateItems(templateId) {
      return ns.sortBySortOrder(listTable('checklist_template_items').filter(function (item) {
        return item.template_id === templateId && ns.parseBoolean(item.is_active);
      }));
    }

    function listActiveTemplatesWithItems(storeId) {
      var state = readState();
      var groupedItems = {};

      state.checklist_template_items.forEach(function (item) {
        if (!ns.parseBoolean(item.is_active)) {
          return;
        }
        if (!groupedItems[item.template_id]) {
          groupedItems[item.template_id] = [];
        }
        groupedItems[item.template_id].push(ns.clone(item));
      });

      return state.checklist_templates.filter(function (template) {
        if (!ns.parseBoolean(template.is_active)) {
          return false;
        }
        return !storeId || template.store_id === storeId;
      }).map(function (template) {
        return {
          template: ns.clone(template),
          items: ns.sortBySortOrder(groupedItems[template.id] || [])
        };
      });
    }

    function findRunById(runId) {
      return findRowById('checklist_runs', runId);
    }

    function findRunByStoreAndDate(storeId, targetDate) {
      return listTable('checklist_runs').find(function (run) {
        return run.store_id === storeId && run.target_date === targetDate;
      }) || null;
    }

    function listRunsByDate(targetDate) {
      return listTable('checklist_runs').filter(function (run) {
        return run.target_date === targetDate;
      });
    }

    function createChecklistRun(run) {
      return appendRow('checklist_runs', run);
    }

    function listRunItems(runId) {
      return ns.sortBySortOrder(listTable('checklist_run_items').filter(function (item) {
        return item.run_id === runId;
      }));
    }

    function createRunItems(items) {
      commit(function (draftState) {
        items.forEach(function (item) {
          draftState.checklist_run_items.push(ns.clone(item));
        });
      });
      return items.map(ns.clone);
    }

    function findRunItemById(runItemId) {
      return findRowById('checklist_run_items', runItemId);
    }

    function updateRunItem(runItemId, changes) {
      return updateRow('checklist_run_items', runItemId, function (row) {
        Object.keys(changes).forEach(function (key) {
          row[key] = changes[key];
        });
        return row;
      });
    }

    function updateRun(runId, changes) {
      return updateRow('checklist_runs', runId, function (row) {
        Object.keys(changes).forEach(function (key) {
          row[key] = changes[key];
        });
        return row;
      });
    }

    function appendLog(log) {
      return appendRow('checklist_item_logs', log);
    }

    function listLogsByRunId(runId) {
      var runItemIds = listRunItems(runId).map(function (item) {
        return item.id;
      });
      return listTable('checklist_item_logs').filter(function (log) {
        return runItemIds.indexOf(log.run_item_id) !== -1;
      });
    }

    function appendNotification(notification) {
      return appendRow('notifications', notification);
    }

    function findMatchingNotification(type, userId, message) {
      return listTable('notifications').find(function (notification) {
        return notification.type === type && notification.user_id === userId && notification.message === message;
      }) || null;
    }

    function createTemplate(template) {
      return appendRow('checklist_templates', template);
    }

    function updateTemplate(templateId, changes) {
      return updateRow('checklist_templates', templateId, function (template) {
        Object.keys(changes).forEach(function (key) {
          template[key] = changes[key];
        });
        return template;
      });
    }

    function createTemplateItem(item) {
      return appendRow('checklist_template_items', item);
    }

    function updateTemplateItem(itemId, changes) {
      return updateRow('checklist_template_items', itemId, function (item) {
        Object.keys(changes).forEach(function (key) {
          item[key] = changes[key];
        });
        return item;
      });
    }

    function deleteTemplateItem(itemId) {
      return updateTemplateItem(itemId, {
        is_active: 'false'
      });
    }

    function listUsersByStore(storeId) {
      return listTable('users').filter(function (user) {
        return user.store_id === storeId && user.status === 'active';
      });
    }

    function listLinkedUsersByStore(storeId, roles) {
      var users = listUsersByStore(storeId);
      return users.filter(function (user) {
        if (roles && roles.indexOf(user.role) === -1) {
          return false;
        }
        return !!findLineAccountByUserId(user.id);
      }).map(function (user) {
        var lineAccount = findLineAccountByUserId(user.id);
        return {
          user: user,
          lineAccount: lineAccount
        };
      });
    }

    return {
      ensureSchema: function () {
        commit(function () {});
      },
      getSheetNames: ns.getSheetNames,
      listTable: listTable,
      replaceTable: replaceTable,
      appendLog: appendLog,
      appendNotification: appendNotification,
      createChecklistRun: createChecklistRun,
      createLineAccountLink: createLineAccountLink,
      createRunItems: createRunItems,
      createTemplate: createTemplate,
      createTemplateItem: createTemplateItem,
      deleteTemplateItem: deleteTemplateItem,
      findLineAccountByUserId: findLineAccountByUserId,
      findLinkedUserByLineUserId: findLinkedUserByLineUserId,
      findMatchingNotification: findMatchingNotification,
      findRunById: findRunById,
      findRunByStoreAndDate: findRunByStoreAndDate,
      findRunItemById: findRunItemById,
      findStoreById: findStoreById,
      findTemplateById: findTemplateById,
      findUserByEmployeeCodeAndPasscode: findUserByEmployeeCodeAndPasscode,
      findRowById: findRowById,
      listActiveTemplates: listActiveTemplates,
      listActiveTemplatesWithItems: listActiveTemplatesWithItems,
      listLinkedUsersByStore: listLinkedUsersByStore,
      listLogsByRunId: listLogsByRunId,
      listRunItems: listRunItems,
      listRunsByDate: listRunsByDate,
      listTableUnsafe: readState,
      listTemplateItems: listTemplateItems,
      listUsersByStore: listUsersByStore,
      updateRun: updateRun,
      updateRunItem: updateRunItem,
      updateTemplate: updateTemplate,
      updateTemplateItem: updateTemplateItem
    };
  }

  ns.createArrayStorage = function (initialState) {
    var state = ensureStateShape(initialState);
    return {
      load: function () {
        return ns.clone(state);
      },
      save: function (nextState) {
        state = ensureStateShape(nextState);
      }
    };
  };

  ns.createSpreadsheetStorage = function (options) {
    var spreadsheetId = options.spreadsheetId || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    ns.assert(spreadsheetId, 'config_error', 'SPREADSHEET_ID が未設定です', 500);

    function getSpreadsheet() {
      return SpreadsheetApp.openById(spreadsheetId);
    }

    function load() {
      var spreadsheet = getSpreadsheet();
      var state = {};
      ns.getSheetNames().forEach(function (sheetName) {
        var sheet = spreadsheet.getSheetByName(sheetName);
        if (!sheet) {
          state[sheetName] = [];
          return;
        }
        var values = sheet.getDataRange().getDisplayValues();
        if (values.length === 0) {
          state[sheetName] = [];
          return;
        }
        var headers = values[0];
        state[sheetName] = values.slice(1).filter(function (row) {
          return row.join('') !== '';
        }).map(function (row) {
          var record = {};
          headers.forEach(function (header, index) {
            record[header] = row[index] == null ? '' : String(row[index]);
          });
          return record;
        });
      });
      return ensureStateShape(state);
    }

    function save(state) {
      var spreadsheet = getSpreadsheet();
      ns.getSheetNames().forEach(function (sheetName) {
        var headers = ns.SHEET_DEFINITIONS[sheetName];
        var sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
        sheet.clearContents();
        var values = [headers].concat(state[sheetName].map(function (row) {
          return headers.map(function (header) {
            return row[header] || '';
          });
        }));
        sheet.getRange(1, 1, values.length, headers.length).setValues(values);
      });
    }

    return {
      load: load,
      save: save
    };
  };

  ns.createSpreadsheetRepository = function (options) {
    var storage = options && options.storage ? options.storage : ns.createSpreadsheetStorage(options || {});
    return createRepository(storage);
  };
})(Ogawaya);
