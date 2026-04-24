var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  ns.TIMEZONE = 'Asia/Tokyo';
  ns.ROLES = {
    PART_TIME: 'part_time',
    MANAGER: 'manager',
    ADMIN: 'admin'
  };
  ns.RUN_STATUS = {
    OPEN: 'open',
    CLOSED: 'closed'
  };
  ns.ITEM_STATUS = {
    UNCHECKED: 'unchecked',
    CHECKED: 'checked'
  };
  ns.LOG_ACTIONS = ['check', 'uncheck', 'edit', 'delete'];
  ns.NOTIFICATION_TYPES = {
    DAILY_START: 'daily_start',
    INCOMPLETE: 'incomplete',
    MANUAL_REMINDER: 'manual_reminder',
    DAILY_INCOMPLETE_REMINDER: 'daily_incomplete_reminder'
  };
  ns.NOTIFICATION_STATUSES = ['sent', 'failed', 'skipped'];
  ns.NOTIFICATION_CHANNEL_STATUSES = ['active', 'inactive'];
  ns.NOTIFICATION_RECIPIENT_STATUSES = ['active', 'inactive'];
  ns.MENU_ITEMS = [
    '今日のチェックリスト',
    '未完了一覧',
    'ヘルプ'
  ];
  ns.REQUIRED_OAUTH_SCOPES = [
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/spreadsheets'
  ];
  ns.SHEET_DEFINITIONS = {
    stores: ['id', 'name', 'status', 'created_at'],
    users: ['id', 'store_id', 'name', 'employee_code', 'passcode', 'role', 'status', 'created_at'],
    line_accounts: ['id', 'user_id', 'line_user_id', 'display_name', 'linked_at'],
    notification_channels: [
      'id',
      'store_id',
      'name',
      'access_token_property',
      'monthly_limit',
      'recipient_limit',
      'status',
      'created_at',
      'updated_at'
    ],
    notification_recipients: [
      'id',
      'store_id',
      'line_user_id',
      'display_name',
      'channel_id',
      'status',
      'last_seen_at',
      'created_at',
      'updated_at'
    ],
    notification_channel_usage: [
      'id',
      'channel_id',
      'year_month',
      'monthly_limit',
      'official_sent_count',
      'local_sent_count',
      'remaining_count',
      'last_synced_at',
      'error_message'
    ],
    checklist_templates: [
      'id',
      'store_id',
      'name',
      'notify_time',
      'closing_time',
      'is_active',
      'created_by',
      'created_at',
      'updated_at'
    ],
    checklist_template_items: [
      'id',
      'template_id',
      'title',
      'description',
      'sort_order',
      'is_required',
      'is_active',
      'created_at',
      'updated_at'
    ],
    checklist_runs: [
      'id',
      'template_id',
      'store_id',
      'target_date',
      'status',
      'notified_at',
      'closed_at',
      'created_at'
    ],
    checklist_run_items: [
      'id',
      'run_id',
      'template_item_id',
      'title',
      'sort_order',
      'status',
      'checked_by',
      'checked_by_name',
      'checked_at',
      'updated_at'
    ],
    checklist_item_logs: [
      'id',
      'run_item_id',
      'action',
      'user_id',
      'before_value',
      'after_value',
      'is_after_close',
      'created_at'
    ],
    notifications: [
      'id',
      'store_id',
      'user_id',
      'type',
      'channel_id',
      'dedupe_key',
      'message',
      'status',
      'sent_at',
      'error_message'
    ]
  };

  ns.getSheetNames = function () {
    return Object.keys(ns.SHEET_DEFINITIONS);
  };

  ns.clone = function (value) {
    return JSON.parse(JSON.stringify(value));
  };

  ns.createError = function (code, message, statusCode) {
    var error = new Error(message);
    error.code = code;
    error.statusCode = statusCode || 500;
    return error;
  };

  ns.assert = function (condition, code, message, statusCode) {
    if (!condition) {
      throw ns.createError(code, message, statusCode);
    }
  };

  ns.toIsoString = function (date) {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  };

  ns.isIsoTimestamp = function (value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value);
  };

  ns.isDateString = function (value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  };

  ns.isTimeString = function (value) {
    return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
  };

  ns.boolToString = function (value) {
    return value === true || value === 'true' ? 'true' : 'false';
  };

  ns.parseBoolean = function (value) {
    if (value === true) {
      return true;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return false;
  };

  ns.requireString = function (value, fieldName) {
    ns.assert(typeof value === 'string' && value.trim() !== '', 'invalid_request', fieldName + ' は必須です', 400);
    return value.trim();
  };

  ns.safeJsonParse = function (value) {
    if (!value) {
      return {};
    }
    return JSON.parse(value);
  };

  ns.jsonStringify = function (value) {
    return JSON.stringify(value || {});
  };

  ns.sortBySortOrder = function (rows) {
    return rows.slice().sort(function (left, right) {
      return Number(left.sort_order) - Number(right.sort_order);
    });
  };

  ns.defaultClock = function () {
    return {
      now: function () {
        return new Date();
      },
      today: function () {
        return Utilities.formatDate(new Date(), ns.TIMEZONE, 'yyyy-MM-dd');
      },
      yesterday: function () {
        var date = new Date();
        date.setDate(date.getDate() - 1);
        return Utilities.formatDate(date, ns.TIMEZONE, 'yyyy-MM-dd');
      }
    };
  };

  ns.createJsonResponse = function (statusCode, body) {
    return {
      statusCode: statusCode,
      body: body
    };
  };

  ns.toTextOutput = function (response) {
    var payload = ns.clone(response.body || {});
    payload.ok = response.statusCode < 400;
    payload.statusCode = response.statusCode;
    return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
  };

  ns.mapErrorToResponse = function (error) {
    return ns.createJsonResponse(error.statusCode || 500, {
      ok: false,
      code: error.code || 'internal_error',
      message: error.message
    });
  };

  ns.logEvent = function (level, eventName, details) {
    var payload = {
      level: level,
      event: eventName,
      at: ns.toIsoString(new Date()),
      details: details || {}
    };
    var message = JSON.stringify(payload);
    console.log(message);
    if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function') {
      Logger.log(message);
    }
  };

  ns.writeDebugEvent = function (source, details) {
    var payload = {
      source: String(source || ''),
      at: ns.toIsoString(new Date()),
      details: details || {}
    };
    ns.logEvent('info', 'debug.event', payload);

    var scriptProperties = PropertiesService.getScriptProperties();
    if (scriptProperties.getProperty('DEBUG_EVENT_SHEET_ENABLED') !== 'true') {
      return;
    }

    try {
      var spreadsheetId = scriptProperties.getProperty('SPREADSHEET_ID');
      if (!spreadsheetId) {
        return;
      }
      var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      var sheet = spreadsheet.getSheetByName('debug_events') || spreadsheet.insertSheet('debug_events');

      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, 5).setValues([['at', 'source', 'path', 'name', 'details']]);
      }

      sheet.appendRow([
        payload.at,
        payload.source,
        String((payload.details && payload.details.path) || ''),
        String((payload.details && payload.details.name) || ''),
        JSON.stringify(payload.details || {})
      ]);
    } catch (error) {
      ns.logEvent('error', 'debug.event.persist_failed', {
        message: error && error.message ? String(error.message) : ''
      });
    }
  };

  ns.normalizeMethod = function (method, fallbackMethod) {
    return String(method || fallbackMethod || 'GET').toUpperCase();
  };

  ns.validateDeploymentConfig = function (claspConfig, appsscriptConfig) {
    var errors = [];
    if (!claspConfig || !claspConfig.scriptId) {
      errors.push('scriptId が未設定です。');
    }
    var scopes = (appsscriptConfig && appsscriptConfig.oauthScopes) || [];
    ns.REQUIRED_OAUTH_SCOPES.forEach(function (scope) {
      if (scopes.indexOf(scope) === -1) {
        errors.push('不足している OAuth scope: ' + scope);
      }
    });
    if (errors.length > 0) {
      return {
        ok: false,
        errors: errors
      };
    }
    return {
      ok: true,
      command: 'clasp push'
    };
  };

  ns.createWebhookSignature = function (payload, channelSecret) {
    var signature = Utilities.computeHmacSha256Signature(payload, channelSecret);
    return Utilities.base64Encode(signature);
  };

  ns.extractRequest = function (e, fallbackMethod) {
    var method = fallbackMethod || (e && e.postData ? 'POST' : 'GET');
    var query = ns.clone((e && e.parameter) || {});
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (error) {
        throw ns.createError('invalid_request', 'リクエストボディが不正な JSON です。', 400);
      }
    }
    if (!(e && e.postData) && query._payload) {
      try {
        body = JSON.parse(query._payload);
      } catch (error) {
        throw ns.createError('invalid_request', '_payload が不正な JSON です。', 400);
      }
      delete query._payload;
    }
    if (query._method) {
      method = query._method;
      delete query._method;
    }
    delete query.path;
    return {
      method: ns.normalizeMethod(method),
      path: '/' + String((e && (e.pathInfo || (e.parameter && e.parameter.path))) || '').replace(/^\/+/, ''),
      query: query,
      body: body
    };
  };

  ns.renderTemplate = function (templateName, values) {
    var template = HtmlService.createTemplateFromFile(templateName);
    Object.keys(values || {}).forEach(function (key) {
      template[key] = values[key];
    });
    return template.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  };

  ns.buildStoreSummary = function (store) {
    return {
      id: store.id,
      name: store.name
    };
  };

  ns.buildUserSummary = function (user, store) {
    return {
      userId: user.id,
      name: user.name,
      role: user.role,
      store: ns.buildStoreSummary(store)
    };
  };
})(Ogawaya);
