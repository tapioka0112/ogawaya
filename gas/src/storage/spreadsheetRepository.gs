var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  function ensureStateShapeInPlace(state) {
    var nextState = state || {};
    ns.getSheetNames().forEach(function (sheetName) {
      if (!Array.isArray(nextState[sheetName])) {
        nextState[sheetName] = [];
      }
    });
    return nextState;
  }

  function ensureStateShape(state) {
    return ensureStateShapeInPlace(ns.clone(state || {}));
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
    var cachedState = ensureStateShapeInPlace({});
    var loadedSheetFlags = {};
    var hasLoadedAllSheets = false;

    function markAllSheetsLoaded() {
      ns.getSheetNames().forEach(function (sheetName) {
        loadedSheetFlags[sheetName] = true;
      });
      hasLoadedAllSheets = true;
    }

    function loadFullState() {
      cachedState = ensureStateShapeInPlace(storage.load());
      markAllSheetsLoaded();
    }

    function ensureSheetLoaded(sheetName) {
      if (hasLoadedAllSheets || loadedSheetFlags[sheetName]) {
        return;
      }
      if (typeof storage.loadTable !== 'function') {
        loadFullState();
        return;
      }
      var loadedRows = storage.loadTable(sheetName);
      cachedState[sheetName] = Array.isArray(loadedRows) ? loadedRows : [];
      loadedSheetFlags[sheetName] = true;
    }

    function readState() {
      if (!hasLoadedAllSheets) {
        if (typeof storage.loadTable !== 'function') {
          loadFullState();
          return cachedState;
        }
        ns.getSheetNames().forEach(function (sheetName) {
          ensureSheetLoaded(sheetName);
        });
        hasLoadedAllSheets = true;
      }
      return cachedState;
    }

    function commit(mutator) {
      var draftState = ns.clone(readState());
      var result = mutator(draftState);
      validateState(draftState);
      storage.save(draftState);
      cachedState = ensureStateShapeInPlace(draftState);
      markAllSheetsLoaded();
      return result;
    }

    function listTable(sheetName) {
      return getTableRowsUnsafe(sheetName).map(ns.clone);
    }

    function getTableRowsUnsafe(sheetName) {
      ensureSheetLoaded(sheetName);
      return cachedState[sheetName];
    }

    function findRowById(sheetName, rowId) {
      var rows = getTableRowsUnsafe(sheetName);
      for (var index = 0; index < rows.length; index += 1) {
        if (rows[index].id === rowId) {
          return ns.clone(rows[index]);
        }
      }
      return null;
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
      var users = getTableRowsUnsafe('users');
      for (var index = 0; index < users.length; index += 1) {
        var user = users[index];
        if (user.employee_code === employeeCode && user.passcode === passcode && user.status === 'active') {
          return ns.clone(user);
        }
      }
      return null;
    }

    function findLineAccountByLineUserId(lineUserId) {
      var lineAccounts = getTableRowsUnsafe('line_accounts');
      for (var index = 0; index < lineAccounts.length; index += 1) {
        var lineAccount = lineAccounts[index];
        if (lineAccount.line_user_id === lineUserId) {
          return ns.clone(lineAccount);
        }
      }
      return null;
    }

    function findLineAccountByUserId(userId) {
      var lineAccounts = getTableRowsUnsafe('line_accounts');
      for (var index = 0; index < lineAccounts.length; index += 1) {
        var lineAccount = lineAccounts[index];
        if (lineAccount.user_id === userId) {
          return ns.clone(lineAccount);
        }
      }
      return null;
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
      return getTableRowsUnsafe('checklist_templates').filter(function (template) {
        return ns.parseBoolean(template.is_active);
      }).map(ns.clone);
    }

    function listTemplateItems(templateId) {
      return ns.sortBySortOrder(getTableRowsUnsafe('checklist_template_items').filter(function (item) {
        return item.template_id === templateId && ns.parseBoolean(item.is_active);
      }).map(ns.clone));
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
      var runs = getTableRowsUnsafe('checklist_runs');
      for (var index = 0; index < runs.length; index += 1) {
        var run = runs[index];
        if (run.store_id === storeId && run.target_date === targetDate) {
          return ns.clone(run);
        }
      }
      return null;
    }

    function listRunsByDate(targetDate) {
      return getTableRowsUnsafe('checklist_runs').filter(function (run) {
        return run.target_date === targetDate;
      }).map(ns.clone);
    }

    function createChecklistRun(run) {
      return appendRow('checklist_runs', run);
    }

    function createChecklistRunWithItems(run, items) {
      return commit(function (draftState) {
        draftState.checklist_runs.push(ns.clone(run));
        items.forEach(function (item) {
          draftState.checklist_run_items.push(ns.clone(item));
        });
        return ns.clone(run);
      });
    }

    function listRunItems(runId) {
      return ns.sortBySortOrder(getTableRowsUnsafe('checklist_run_items').filter(function (item) {
        return item.run_id === runId;
      }).map(ns.clone));
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
      if (storage && typeof storage.updateRunItem === 'function') {
        var runItems = getTableRowsUnsafe('checklist_run_items');
        var runItemIndex = runItems.findIndex(function (row) {
          return row.id === runItemId;
        });
        ns.assert(runItemIndex !== -1, 'not_found', 'checklist_run_items が見つかりません', 404);
        var updatedRow = ns.clone(runItems[runItemIndex]);
        Object.keys(changes).forEach(function (key) {
          updatedRow[key] = changes[key];
        });
        validateRow('checklist_run_items', updatedRow);
        storage.updateRunItem(runItemId, ns.clone(updatedRow));
        runItems[runItemIndex] = ns.clone(updatedRow);
        cachedState.checklist_run_items = runItems;
        loadedSheetFlags.checklist_run_items = true;
        return ns.clone(updatedRow);
      }
      return updateRow('checklist_run_items', runItemId, function (row) {
        Object.keys(changes).forEach(function (key) {
          row[key] = changes[key];
        });
        return row;
      });
    }

    function updateRunItemWithLog(runItemId, changes, log) {
      if (storage && typeof storage.updateRunItemWithLog === 'function') {
        var runItems = getTableRowsUnsafe('checklist_run_items');
        var logs = getTableRowsUnsafe('checklist_item_logs');
        var runItemIndex = runItems.findIndex(function (row) {
          return row.id === runItemId;
        });
        ns.assert(runItemIndex !== -1, 'not_found', 'checklist_run_items が見つかりません', 404);
        var updatedRow = ns.clone(runItems[runItemIndex]);
        Object.keys(changes).forEach(function (key) {
          updatedRow[key] = changes[key];
        });
        validateRow('checklist_run_items', updatedRow);
        validateRow('checklist_item_logs', log);
        storage.updateRunItemWithLog(runItemId, ns.clone(updatedRow), ns.clone(log));
        runItems[runItemIndex] = ns.clone(updatedRow);
        logs.push(ns.clone(log));
        cachedState.checklist_run_items = runItems;
        cachedState.checklist_item_logs = logs;
        loadedSheetFlags.checklist_run_items = true;
        loadedSheetFlags.checklist_item_logs = true;
        return ns.clone(updatedRow);
      }
      return commit(function (draftState) {
        var index = draftState.checklist_run_items.findIndex(function (row) {
          return row.id === runItemId;
        });
        ns.assert(index !== -1, 'not_found', 'checklist_run_items が見つかりません', 404);
        Object.keys(changes).forEach(function (key) {
          draftState.checklist_run_items[index][key] = changes[key];
        });
        draftState.checklist_item_logs.push(ns.clone(log));
        return ns.clone(draftState.checklist_run_items[index]);
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
      return listLogsByRunItemIds(runItemIds);
    }

    function listLogsByRunItemIds(runItemIds) {
      return getTableRowsUnsafe('checklist_item_logs').filter(function (log) {
        return runItemIds.indexOf(log.run_item_id) !== -1;
      }).map(ns.clone);
    }

    function appendNotification(notification) {
      return appendRow('notifications', notification);
    }

    function findMatchingNotification(type, userId, message) {
      var notifications = getTableRowsUnsafe('notifications');
      for (var index = 0; index < notifications.length; index += 1) {
        var notification = notifications[index];
        if (notification.type === type && notification.user_id === userId && notification.message === message) {
          return ns.clone(notification);
        }
      }
      return null;
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
      return getTableRowsUnsafe('users').filter(function (user) {
        return user.store_id === storeId && user.status === 'active';
      }).map(ns.clone);
    }

    function listLinkedUsersByStore(storeId, roles) {
      var allowedRoles = {};
      if (roles && roles.length > 0) {
        roles.forEach(function (role) {
          allowedRoles[role] = true;
        });
      }

      var linkedAccountByUserId = {};
      getTableRowsUnsafe('line_accounts').forEach(function (lineAccount) {
        if (!linkedAccountByUserId[lineAccount.user_id]) {
          linkedAccountByUserId[lineAccount.user_id] = lineAccount;
        }
      });

      return getTableRowsUnsafe('users').filter(function (user) {
        if (user.store_id !== storeId || user.status !== 'active') {
          return false;
        }
        if (roles && roles.length > 0 && !allowedRoles[user.role]) {
          return false;
        }
        return !!linkedAccountByUserId[user.id];
      }).map(function (user) {
        return {
          user: ns.clone(user),
          lineAccount: ns.clone(linkedAccountByUserId[user.id])
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
      createChecklistRunWithItems: createChecklistRunWithItems,
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
      listLogsByRunItemIds: listLogsByRunItemIds,
      listLogsByRunId: listLogsByRunId,
      listRunItems: listRunItems,
      listRunsByDate: listRunsByDate,
      listTableUnsafe: readState,
      listTemplateItems: listTemplateItems,
      listUsersByStore: listUsersByStore,
      updateRun: updateRun,
      updateRunItem: updateRunItem,
      updateRunItemWithLog: updateRunItemWithLog,
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
      loadTable: function (sheetName) {
        return (state[sheetName] || []).map(ns.clone);
      },
      save: function (nextState) {
        state = ensureStateShape(nextState);
      }
    };
  };

  ns.createSpreadsheetStorage = function (options) {
    var scriptProperties = PropertiesService.getScriptProperties();
    var spreadsheetId = options.spreadsheetId || scriptProperties.getProperty('SPREADSHEET_ID');
    ns.assert(spreadsheetId, 'config_error', 'SPREADSHEET_ID が未設定です', 500);
    var cacheKeyBase = 'ogawaya:spreadsheet-state:v2:' + spreadsheetId;
    var directCacheKey = cacheKeyBase + ':direct';
    var metaCacheKey = cacheKeyBase + ':meta';
    var tableCacheKeyPrefix = cacheKeyBase + ':table:';
    var legacyCacheKey = 'ogawaya:spreadsheet-state:v1:' + spreadsheetId;
    var cacheEnabled = scriptProperties.getProperty('SPREADSHEET_STATE_CACHE_ENABLED') !== 'false';
    var cacheTtlRaw = scriptProperties.getProperty('SPREADSHEET_STATE_CACHE_TTL_SECONDS');
    var chunkSizeRaw = scriptProperties.getProperty('SPREADSHEET_STATE_CACHE_CHUNK_SIZE');
    var cacheTtlSeconds = 300;
    var chunkSize = 90000;
    var lastLoadedState = null;
    var tableStateCache = {};
    var cachedSpreadsheet = null;

    if (cacheTtlRaw) {
      var parsedCacheTtl = Number(cacheTtlRaw);
      ns.assert(
        isFinite(parsedCacheTtl) && parsedCacheTtl >= 1 && Math.floor(parsedCacheTtl) === parsedCacheTtl,
        'config_error',
        'SPREADSHEET_STATE_CACHE_TTL_SECONDS は 1 以上の整数で指定してください',
        500
      );
      cacheTtlSeconds = parsedCacheTtl;
    }

    if (chunkSizeRaw) {
      var parsedChunkSize = Number(chunkSizeRaw);
      ns.assert(
        isFinite(parsedChunkSize) && parsedChunkSize >= 50 && Math.floor(parsedChunkSize) === parsedChunkSize,
        'config_error',
        'SPREADSHEET_STATE_CACHE_CHUNK_SIZE は 50 以上の整数で指定してください',
        500
      );
      chunkSize = parsedChunkSize;
    }

    function getSpreadsheet() {
      if (!cachedSpreadsheet) {
        cachedSpreadsheet = SpreadsheetApp.openById(spreadsheetId);
      }
      return cachedSpreadsheet;
    }

    function getScriptCache() {
      if (!cacheEnabled || typeof CacheService === 'undefined' || !CacheService) {
        return null;
      }
      return CacheService.getScriptCache();
    }

    function buildChunkCacheKey(index) {
      return cacheKeyBase + ':chunk:' + String(index);
    }

    function buildTableCacheKey(sheetName) {
      return tableCacheKeyPrefix + sheetName;
    }

    function buildTableMetaCacheKey(sheetName) {
      return buildTableCacheKey(sheetName) + ':meta';
    }

    function buildTableChunkCacheKey(sheetName, index) {
      return buildTableCacheKey(sheetName) + ':chunk:' + String(index);
    }

    function cloneTableRows(rows) {
      return (rows || []).map(ns.clone);
    }

    function refreshTableStateCacheFromState(state) {
      tableStateCache = {};
      ns.getSheetNames().forEach(function (sheetName) {
        tableStateCache[sheetName] = cloneTableRows(state[sheetName]);
      });
    }

    function readTableFromMatrix(sheetName, rows) {
      var headers = ns.SHEET_DEFINITIONS[sheetName];
      return rows.filter(function (row) {
        return row.join('') !== '';
      }).map(function (row) {
        var record = {};
        headers.forEach(function (header, index) {
          record[header] = row[index] == null ? '' : String(row[index]);
        });
        return record;
      });
    }

    function logSlowSheetRead(sheetName, rowCount, startedAt) {
      var durationMs = new Date().getTime() - startedAt;
      if (durationMs < 100) {
        return;
      }
      ns.logEvent('info', 'storage.sheet.read', {
        sheetName: sheetName,
        rows: rowCount,
        durationMs: durationMs
      });
    }

    function readTableFromSpreadsheet(sheetName) {
      var sheetReadStartedAt = new Date().getTime();
      var spreadsheet = getSpreadsheet();
      var sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        logSlowSheetRead(sheetName, 0, sheetReadStartedAt);
        return [];
      }
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        logSlowSheetRead(sheetName, 0, sheetReadStartedAt);
        return [];
      }
      var headers = ns.SHEET_DEFINITIONS[sheetName];
      var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
      var records = readTableFromMatrix(sheetName, rows);
      logSlowSheetRead(sheetName, records.length, sheetReadStartedAt);
      return records;
    }

    function buildStateFromSpreadsheet() {
      var loadedState = {};
      ns.getSheetNames().forEach(function (sheetName) {
        loadedState[sheetName] = readTableFromSpreadsheet(sheetName);
      });
      return ensureStateShapeInPlace(loadedState);
    }

    function tryReadCacheValue(cache, key) {
      try {
        return cache.get(key);
      } catch (error) {
        ns.logEvent('error', 'storage.cache.read_failed', {
          key: key,
          message: error && error.message ? String(error.message) : ''
        });
        return null;
      }
    }

    function tryRemoveCacheKeys(cache, keys) {
      var normalizedKeys = keys.filter(function (key) {
        return !!key;
      });
      if (normalizedKeys.length === 0) {
        return;
      }
      try {
        if (typeof cache.removeAll === 'function') {
          cache.removeAll(normalizedKeys);
          return;
        }
      } catch (error) {
        ns.logEvent('error', 'storage.cache.remove_all_failed', {
          message: error && error.message ? String(error.message) : ''
        });
      }
      normalizedKeys.forEach(function (key) {
        try {
          cache.remove(key);
        } catch (removeError) {
          ns.logEvent('error', 'storage.cache.remove_failed', {
            key: key,
            message: removeError && removeError.message ? String(removeError.message) : ''
          });
        }
      });
    }

    function parseCachedState(raw, source) {
      if (!raw) {
        return null;
      }
      try {
        var parsed = JSON.parse(raw);
        return ensureStateShapeInPlace(parsed);
      } catch (parseError) {
        ns.logEvent('error', 'storage.cache.parse_failed', {
          source: source,
          message: parseError && parseError.message ? String(parseError.message) : ''
        });
        return null;
      }
    }

    function parseCachedTable(raw, sheetName) {
      if (!raw) {
        return null;
      }
      try {
        var parsed = JSON.parse(raw);
        ns.assert(Array.isArray(parsed), 'invalid_data', sheetName + ' table cache の形式が不正です', 500);
        return parsed.map(function (row) {
          return ns.clone(row);
        });
      } catch (parseError) {
        ns.logEvent('error', 'storage.cache.table_parse_failed', {
          sheetName: sheetName,
          message: parseError && parseError.message ? String(parseError.message) : ''
        });
        return null;
      }
    }

    function readTableFromCache(cache, sheetName) {
      if (!cache) {
        return null;
      }
      var tableCacheKey = buildTableCacheKey(sheetName);
      var tableRaw = tryReadCacheValue(cache, tableCacheKey);
      var tableRows = parseCachedTable(tableRaw, sheetName);
      if (tableRows) {
        return tableRows;
      }
      if (tableRaw && !tableRows) {
        tryRemoveCacheKeys(cache, [tableCacheKey]);
      }

      var tableMetaKey = buildTableMetaCacheKey(sheetName);
      var metaRaw = tryReadCacheValue(cache, tableMetaKey);
      if (!metaRaw) {
        return null;
      }
      var meta = null;
      try {
        meta = JSON.parse(metaRaw);
      } catch (error) {
        tryRemoveCacheKeys(cache, [tableMetaKey]);
        return null;
      }
      if (!meta || !meta.parts || !isFinite(Number(meta.parts)) || Number(meta.parts) < 1) {
        tryRemoveCacheKeys(cache, [tableMetaKey]);
        return null;
      }
      var parts = Number(meta.parts);
      var payload = '';
      for (var index = 0; index < parts; index += 1) {
        var chunkRaw = tryReadCacheValue(cache, buildTableChunkCacheKey(sheetName, index));
        if (!chunkRaw) {
          var staleKeys = [tableMetaKey];
          for (var staleIndex = 0; staleIndex < parts; staleIndex += 1) {
            staleKeys.push(buildTableChunkCacheKey(sheetName, staleIndex));
          }
          tryRemoveCacheKeys(cache, staleKeys);
          return null;
        }
        payload += chunkRaw;
      }

      var chunkedTableRows = parseCachedTable(payload, sheetName);
      if (chunkedTableRows) {
        return chunkedTableRows;
      }
      var invalidChunkKeys = [tableMetaKey];
      for (var invalidIndex = 0; invalidIndex < parts; invalidIndex += 1) {
        invalidChunkKeys.push(buildTableChunkCacheKey(sheetName, invalidIndex));
      }
      tryRemoveCacheKeys(cache, invalidChunkKeys);
      return null;
    }

    function writeTableToCache(cache, sheetName, rows) {
      if (!cache) {
        return;
      }
      var payload = JSON.stringify(rows || []);
      var tableCacheKey = buildTableCacheKey(sheetName);
      var tableMetaKey = buildTableMetaCacheKey(sheetName);
      var previousMetaRaw = tryReadCacheValue(cache, tableMetaKey);
      var previousChunkCount = 0;
      if (previousMetaRaw) {
        try {
          var previousMeta = JSON.parse(previousMetaRaw);
          previousChunkCount = Number(previousMeta.parts) || 0;
        } catch (error) {
          previousChunkCount = 0;
        }
      }
      var staleKeys = [tableCacheKey, tableMetaKey];
      for (var staleIndex = 0; staleIndex < previousChunkCount; staleIndex += 1) {
        staleKeys.push(buildTableChunkCacheKey(sheetName, staleIndex));
      }
      tryRemoveCacheKeys(cache, staleKeys);
      try {
        cache.put(tableCacheKey, payload, cacheTtlSeconds);
      } catch (error) {
        try {
          var chunks = splitPayload(payload, chunkSize);
          chunks.forEach(function (chunk, index) {
            cache.put(buildTableChunkCacheKey(sheetName, index), chunk, cacheTtlSeconds);
          });
          cache.put(tableMetaKey, JSON.stringify({ parts: chunks.length }), cacheTtlSeconds);
        } catch (chunkError) {
          ns.logEvent('warn', 'storage.cache.table_write_failed', {
            sheetName: sheetName,
            message: chunkError && chunkError.message ? String(chunkError.message) : ''
          });
        }
      }
    }

    function writeTablesToCache(cache, state) {
      if (!cache) {
        return;
      }
      ns.getSheetNames().forEach(function (sheetName) {
        writeTableToCache(cache, sheetName, state[sheetName] || []);
      });
    }

    function readChunkedStateFromCache(cache) {
      var metaRaw = tryReadCacheValue(cache, metaCacheKey);
      if (!metaRaw) {
        return null;
      }
      var meta = null;
      try {
        meta = JSON.parse(metaRaw);
      } catch (error) {
        ns.logEvent('error', 'storage.cache.meta_parse_failed', {
          message: error && error.message ? String(error.message) : ''
        });
        tryRemoveCacheKeys(cache, [metaCacheKey]);
        return null;
      }
      if (!meta || !meta.chunked || !meta.parts || !isFinite(Number(meta.parts)) || Number(meta.parts) < 1) {
        tryRemoveCacheKeys(cache, [metaCacheKey]);
        return null;
      }
      var parts = Number(meta.parts);
      var joinedPayload = '';
      for (var index = 0; index < parts; index += 1) {
        var partRaw = tryReadCacheValue(cache, buildChunkCacheKey(index));
        if (!partRaw) {
          var staleKeys = [metaCacheKey];
          for (var staleIndex = 0; staleIndex < parts; staleIndex += 1) {
            staleKeys.push(buildChunkCacheKey(staleIndex));
          }
          tryRemoveCacheKeys(cache, staleKeys);
          return null;
        }
        joinedPayload += partRaw;
      }
      return parseCachedState(joinedPayload, 'chunked');
    }

    function readStateFromCache(cache) {
      if (!cache) {
        return null;
      }
      var directRaw = tryReadCacheValue(cache, directCacheKey);
      var directState = parseCachedState(directRaw, 'direct');
      if (directState) {
        return directState;
      }
      if (directRaw && !directState) {
        tryRemoveCacheKeys(cache, [directCacheKey]);
      }
      var chunkedState = readChunkedStateFromCache(cache);
      if (chunkedState) {
        return chunkedState;
      }
      var legacyRaw = tryReadCacheValue(cache, legacyCacheKey);
      var legacyState = parseCachedState(legacyRaw, 'legacy');
      if (legacyState) {
        return legacyState;
      }
      if (legacyRaw && !legacyState) {
        tryRemoveCacheKeys(cache, [legacyCacheKey]);
      }
      return null;
    }

    function splitPayload(payload, size) {
      var chunks = [];
      for (var offset = 0; offset < payload.length; offset += size) {
        chunks.push(payload.slice(offset, offset + size));
      }
      return chunks;
    }

    function writeChunkedStateToCache(cache, payload) {
      var chunks = splitPayload(payload, chunkSize);
      var metaPayload = JSON.stringify({
        chunked: true,
        parts: chunks.length
      });
      chunks.forEach(function (chunk, index) {
        cache.put(buildChunkCacheKey(index), chunk, cacheTtlSeconds);
      });
      cache.put(metaCacheKey, metaPayload, cacheTtlSeconds);
    }

    function writeStateToCache(cache, state) {
      if (!cache) {
        return;
      }
      var payload = JSON.stringify(state);
      var previousMetaRaw = tryReadCacheValue(cache, metaCacheKey);
      var previousChunkCount = 0;
      if (previousMetaRaw) {
        try {
          var previousMeta = JSON.parse(previousMetaRaw);
          previousChunkCount = Number(previousMeta.parts) || 0;
        } catch (error) {
          previousChunkCount = 0;
        }
      }
      var staleKeys = [legacyCacheKey, directCacheKey, metaCacheKey];
      for (var staleIndex = 0; staleIndex < previousChunkCount; staleIndex += 1) {
        staleKeys.push(buildChunkCacheKey(staleIndex));
      }
      ns.getSheetNames().forEach(function (sheetName) {
        staleKeys.push(buildTableCacheKey(sheetName));
      });
      tryRemoveCacheKeys(cache, staleKeys);
      try {
        cache.put(directCacheKey, payload, cacheTtlSeconds);
      } catch (error) {
        ns.logEvent('warn', 'storage.cache.direct_write_failed', {
          message: error && error.message ? String(error.message) : '',
          payloadLength: payload.length
        });
        try {
          writeChunkedStateToCache(cache, payload);
        } catch (chunkError) {
          ns.logEvent('error', 'storage.cache.chunked_write_failed', {
            message: chunkError && chunkError.message ? String(chunkError.message) : '',
            payloadLength: payload.length
          });
        }
      }
      writeTablesToCache(cache, state);
    }

    function buildRowValues(sheetName, row) {
      var headers = ns.SHEET_DEFINITIONS[sheetName];
      return headers.map(function (header) {
        return row[header] == null ? '' : String(row[header]);
      });
    }

    function ensureSheetHeader(sheet, sheetName) {
      var headers = ns.SHEET_DEFINITIONS[sheetName];
      var lastRow = sheet.getLastRow();
      if (lastRow < 1) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        return;
      }
      var headerValues = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
      var isSameHeader = headers.every(function (header, index) {
        return String(headerValues[index] == null ? '' : headerValues[index]) === header;
      });
      if (!isSameHeader) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
    }

    function findDataRowById(sheet, sheetName, rowId) {
      var headers = ns.SHEET_DEFINITIONS[sheetName];
      var idColumnIndex = headers.indexOf('id') + 1;
      ns.assert(idColumnIndex > 0, 'config_error', sheetName + ' に id 列がありません', 500);
      var lastRow = sheet.getLastRow();
      ns.assert(lastRow >= 2, 'not_found', sheetName + ' が見つかりません', 404);
      var idValues = sheet.getRange(2, idColumnIndex, lastRow - 1, 1).getValues();
      for (var offset = 0; offset < idValues.length; offset += 1) {
        if (String(idValues[offset][0] == null ? '' : idValues[offset][0]) === rowId) {
          return offset + 2;
        }
      }
      ns.assert(false, 'not_found', sheetName + ' が見つかりません', 404);
    }

    function appendRowToSheet(sheet, sheetName, row) {
      var headers = ns.SHEET_DEFINITIONS[sheetName];
      var nextRow = sheet.getLastRow() + 1;
      if (nextRow < 2) {
        nextRow = 2;
      }
      sheet.getRange(nextRow, 1, 1, headers.length).setValues([buildRowValues(sheetName, row)]);
    }

    function hasCachedTableRows(sheetName) {
      return Object.prototype.hasOwnProperty.call(tableStateCache, sheetName);
    }

    function loadTable(sheetName) {
      if (lastLoadedState) {
        return cloneTableRows(lastLoadedState[sheetName]);
      }
      if (hasCachedTableRows(sheetName)) {
        return cloneTableRows(tableStateCache[sheetName]);
      }
      var cache = getScriptCache();
      var cachedTableRows = readTableFromCache(cache, sheetName);
      if (cachedTableRows) {
        tableStateCache[sheetName] = cloneTableRows(cachedTableRows);
        return cloneTableRows(cachedTableRows);
      }
      var cachedState = readStateFromCache(cache);
      if (cachedState) {
        lastLoadedState = cachedState;
        refreshTableStateCacheFromState(cachedState);
        return cloneTableRows(cachedState[sheetName]);
      }
      var loadedRows = readTableFromSpreadsheet(sheetName);
      tableStateCache[sheetName] = cloneTableRows(loadedRows);
      writeTableToCache(cache, sheetName, loadedRows);
      return cloneTableRows(loadedRows);
    }

    function updateRunItem(runItemId, updatedRunItem) {
      var spreadsheet = getSpreadsheet();
      var runItemsSheet = spreadsheet.getSheetByName('checklist_run_items') || spreadsheet.insertSheet('checklist_run_items');
      ensureSheetHeader(runItemsSheet, 'checklist_run_items');

      var runItemRow = findDataRowById(runItemsSheet, 'checklist_run_items', runItemId);
      runItemsSheet
        .getRange(runItemRow, 1, 1, ns.SHEET_DEFINITIONS.checklist_run_items.length)
        .setValues([buildRowValues('checklist_run_items', updatedRunItem)]);

      var runItems = loadTable('checklist_run_items');
      var runItemIndex = runItems.findIndex(function (row) {
        return row.id === runItemId;
      });
      ns.assert(runItemIndex !== -1, 'not_found', 'checklist_run_items が見つかりません', 404);
      runItems[runItemIndex] = ns.clone(updatedRunItem);
      tableStateCache.checklist_run_items = cloneTableRows(runItems);

      var cache = getScriptCache();
      if (lastLoadedState) {
        lastLoadedState.checklist_run_items = cloneTableRows(runItems);
        writeStateToCache(cache, lastLoadedState);
        return;
      }
      writeTableToCache(cache, 'checklist_run_items', runItems);
    }

    function updateRunItemWithLog(runItemId, updatedRunItem, log) {
      var spreadsheet = getSpreadsheet();
      var runItemsSheet = spreadsheet.getSheetByName('checklist_run_items') || spreadsheet.insertSheet('checklist_run_items');
      var logsSheet = spreadsheet.getSheetByName('checklist_item_logs') || spreadsheet.insertSheet('checklist_item_logs');
      ensureSheetHeader(runItemsSheet, 'checklist_run_items');
      ensureSheetHeader(logsSheet, 'checklist_item_logs');

      var runItemRow = findDataRowById(runItemsSheet, 'checklist_run_items', runItemId);
      runItemsSheet
        .getRange(runItemRow, 1, 1, ns.SHEET_DEFINITIONS.checklist_run_items.length)
        .setValues([buildRowValues('checklist_run_items', updatedRunItem)]);
      appendRowToSheet(logsSheet, 'checklist_item_logs', log);

      var runItems = loadTable('checklist_run_items');
      var logs = loadTable('checklist_item_logs');
      var runItemIndex = runItems.findIndex(function (row) {
        return row.id === runItemId;
      });
      ns.assert(runItemIndex !== -1, 'not_found', 'checklist_run_items が見つかりません', 404);
      runItems[runItemIndex] = ns.clone(updatedRunItem);
      logs.push(ns.clone(log));
      tableStateCache.checklist_run_items = cloneTableRows(runItems);
      tableStateCache.checklist_item_logs = cloneTableRows(logs);

      var cache = getScriptCache();
      if (lastLoadedState) {
        lastLoadedState.checklist_run_items = cloneTableRows(runItems);
        lastLoadedState.checklist_item_logs = cloneTableRows(logs);
        writeStateToCache(cache, lastLoadedState);
        return;
      }
      writeTableToCache(cache, 'checklist_run_items', runItems);
      writeTableToCache(cache, 'checklist_item_logs', logs);
    }

    function load() {
      var loadStartedAt = new Date().getTime();
      var cache = getScriptCache();
      var cachedState = readStateFromCache(cache);
      if (cachedState) {
        lastLoadedState = cachedState;
        refreshTableStateCacheFromState(cachedState);
        ns.logEvent('info', 'storage.load', {
          source: 'cache',
          durationMs: new Date().getTime() - loadStartedAt
        });
        return cachedState;
      }
      var loadedState = buildStateFromSpreadsheet();
      lastLoadedState = loadedState;
      refreshTableStateCacheFromState(loadedState);
      writeStateToCache(cache, loadedState);
      ns.logEvent('info', 'storage.load', {
        source: 'spreadsheet',
        durationMs: new Date().getTime() - loadStartedAt
      });
      return loadedState;
    }

    function buildSheetValues(headers, rows) {
      return [headers].concat(rows.map(function (row) {
        return headers.map(function (header) {
          return row[header] == null ? '' : String(row[header]);
        });
      }));
    }

    function isSameMatrix(left, right) {
      if (left.length !== right.length) {
        return false;
      }
      for (var rowIndex = 0; rowIndex < left.length; rowIndex += 1) {
        if (left[rowIndex].length !== right[rowIndex].length) {
          return false;
        }
        for (var colIndex = 0; colIndex < left[rowIndex].length; colIndex += 1) {
          if (String(left[rowIndex][colIndex]) !== String(right[rowIndex][colIndex])) {
            return false;
          }
        }
      }
      return true;
    }

    function hasSheetChanged(headers, currentRows, nextRows) {
      var currentValues = buildSheetValues(headers, currentRows || []);
      var nextValues = buildSheetValues(headers, nextRows || []);
      return !isSameMatrix(currentValues, nextValues);
    }

    function save(state) {
      var nextState = ensureStateShapeInPlace(ns.clone(state));
      var currentState = lastLoadedState || load();
      var changedSheetNames = ns.getSheetNames().filter(function (sheetName) {
        var headers = ns.SHEET_DEFINITIONS[sheetName];
        return hasSheetChanged(headers, currentState[sheetName], nextState[sheetName]);
      });

      if (changedSheetNames.length > 0) {
        var spreadsheet = getSpreadsheet();
        changedSheetNames.forEach(function (sheetName) {
          var headers = ns.SHEET_DEFINITIONS[sheetName];
          var sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
          var nextValues = buildSheetValues(headers, nextState[sheetName]);
          sheet.clearContents();
          sheet.getRange(1, 1, nextValues.length, headers.length).setValues(nextValues);
        });
      }

      lastLoadedState = nextState;
      refreshTableStateCacheFromState(nextState);
      var cache = getScriptCache();
      writeStateToCache(cache, nextState);
    }

    return {
      load: load,
      loadTable: loadTable,
      save: save,
      updateRunItem: updateRunItem,
      updateRunItemWithLog: updateRunItemWithLog
    };
  };

  ns.createSpreadsheetRepository = function (options) {
    var storage = options && options.storage ? options.storage : ns.createSpreadsheetStorage(options || {});
    return createRepository(storage);
  };
})(Ogawaya);
