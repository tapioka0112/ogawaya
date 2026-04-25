function allowAnonymousAccessEnabled_() {
  var rawValue = PropertiesService.getScriptProperties().getProperty('ALLOW_ANONYMOUS_ACCESS');
  return rawValue !== 'false';
}

function normalizeLiffId_(value) {
  var rawValue = String(value || '').replace(/\s+/g, '');
  if (!rawValue) {
    return '';
  }
  if (/^[0-9]{10}-[A-Za-z0-9]+$/.test(rawValue)) {
    return rawValue;
  }
  var extracted = rawValue.match(/(?:https?:\/\/liff\.line\.me\/|line:\/\/app\/)?([0-9]{10}-[A-Za-z0-9]+)/);
  if (extracted && extracted[1]) {
    return extracted[1];
  }
  return '';
}

function doGet(e) {
  var request = Ogawaya.extractRequest(e, 'GET');
  var appBaseUrl = ScriptApp.getService().getUrl();
  var liffId = normalizeLiffId_(PropertiesService.getScriptProperties().getProperty('LIFF_ID'));
  var allowAnonymousAccess = allowAnonymousAccessEnabled_();
  var queryKeys = Object.keys((e && e.parameter) || {});
  Ogawaya.writeDebugEvent('doGet', {
    path: request.path,
    mode: (e && e.parameter && e.parameter.mode) || '',
    appBaseUrl: appBaseUrl,
    queryKeys: queryKeys,
    hasLiffId: !!liffId,
    liffIdLength: String(liffId).length,
    allowAnonymousAccess: allowAnonymousAccess
  });
  if (request.path.indexOf('/api/') === 0) {
    return Ogawaya.toTextOutput(Ogawaya.createApplication({
      allowAnonymousAccess: allowAnonymousAccess
    }).handleApiRequest(request));
  }

  var mode = (e && e.parameter && e.parameter.mode) || 'user';
  var templateName = 'src/liff/index';
  if (mode === 'user' || mode === 'admin') {
    templateName = 'src/liff/user/index';
  }

  return Ogawaya.renderTemplate(templateName, {
    appBaseUrl: appBaseUrl,
    mode: mode,
    liffId: liffId,
    allowAnonymousAccess: allowAnonymousAccess
  });
}

function doPost(e) {
  var request = Ogawaya.extractRequest(e, 'POST');
  var appBaseUrl = ScriptApp.getService().getUrl();
  var allowAnonymousAccess = allowAnonymousAccessEnabled_();
  Ogawaya.writeDebugEvent('doPost', {
    path: request.path,
    appBaseUrl: appBaseUrl,
    allowAnonymousAccess: allowAnonymousAccess
  });
  var app = Ogawaya.createApplication({
    allowAnonymousAccess: allowAnonymousAccess
  });
  if (request.path === '/webhook' || request.path === '/api/webhook') {
    return Ogawaya.toTextOutput(app.handleWebhook({
      body: e.postData.contents,
      signature: (e.parameter && e.parameter.signature) || ''
    }));
  }
  return Ogawaya.toTextOutput(app.handleApiRequest(request));
}

function routePost_(e) {
  return doPost(e);
}

function bootstrapSpreadsheetTemplates() {
  return Ogawaya.bootstrapSpreadsheetTemplates({});
}

function handleClientApi(request) {
  var safeRequest = request && typeof request === 'object' ? request : {};
  var response = Ogawaya.createApplication({
    allowAnonymousAccess: allowAnonymousAccessEnabled_()
  }).handleApiRequest({
    method: Ogawaya.normalizeMethod(safeRequest.method, 'GET'),
    path: safeRequest.path || '/',
    query: safeRequest.query || {},
    body: safeRequest.body || {}
  });
  var payload = Ogawaya.clone(response.body || {});
  payload.ok = response.statusCode < 400;
  payload.statusCode = response.statusCode;
  Ogawaya.writeDebugEvent('handleClientApi', {
    path: safeRequest.path || '/',
    method: Ogawaya.normalizeMethod(safeRequest.method, 'GET'),
    statusCode: response.statusCode
  });
  return payload;
}

function logClientEvent(payload) {
  var details = payload && typeof payload === 'object' ? payload : { raw: String(payload || '') };
  Ogawaya.writeDebugEvent('logClientEvent', details);
  Ogawaya.logEvent('info', 'client.event', details);
  return { ok: true };
}

Ogawaya.normalizeTaskTitleForPeriodMigration = function (value) {
  return String(value || '').replace(/\s+/g, '').trim();
};

Ogawaya.getCurrentCleaningTaskPeriodRules = function () {
  return [
    { period: Ogawaya.TASK_PERIODS.DAILY, title: '厨房内床清掃' },
    { period: Ogawaya.TASK_PERIODS.DAILY, title: '餃子機' },
    { period: Ogawaya.TASK_PERIODS.DAILY, title: 'コールドテーブル外壁' },
    { period: Ogawaya.TASK_PERIODS.DAILY, title: 'タワータイプ冷蔵・冷凍庫外壁' },
    { period: Ogawaya.TASK_PERIODS.DAILY, title: '入口タイル清掃' },
    { period: Ogawaya.TASK_PERIODS.DAILY, title: 'ゴミ拾い' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: 'バーナー・コンロの清掃（完全燃焼）' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: 'グリトラ周辺・グリトラ内の掃除' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: '雑草処理' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: 'エアコンフィルター・カバーの掃除' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: '厨房内機器のパッキン・フィルター' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: '厨房内外壁清掃' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: 'タワータイプ冷凍・冷蔵庫の内側清掃' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: 'コールドテーブルの内側清掃' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: '厨房ゴミ箱の掃除' },
    { period: Ogawaya.TASK_PERIODS.WEEKLY, title: '店舗内床の黒ずみ等の清掃' },
    { period: Ogawaya.TASK_PERIODS.MONTHLY, title: '換気扇の清掃' },
    { period: Ogawaya.TASK_PERIODS.MONTHLY, title: '自販機 POP 等の汚れや剥がれの改善' },
    { period: Ogawaya.TASK_PERIODS.MONTHLY, title: '傘立ての清掃' },
    { period: Ogawaya.TASK_PERIODS.MONTHLY, title: '店舗天井の黒ずみ清掃・剥がれ等の改善' }
  ];
};

Ogawaya.applyCurrentCleaningTaskPeriodTags = function (options) {
  var safeOptions = options || {};
  var spreadsheetId = safeOptions.spreadsheetId
    || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  Ogawaya.assert(spreadsheetId || safeOptions.repository, 'config_error', 'SPREADSHEET_ID が未設定です', 500);

  var repository = safeOptions.repository || Ogawaya.createSpreadsheetRepository({ spreadsheetId: spreadsheetId });
  var now = Ogawaya.toIsoString(safeOptions.now || new Date());
  var periodByTitleKey = {};
  var titleByKey = {};
  Ogawaya.getCurrentCleaningTaskPeriodRules().forEach(function (rule) {
    var titleKey = Ogawaya.normalizeTaskTitleForPeriodMigration(rule.title);
    Ogawaya.assert(!periodByTitleKey[titleKey], 'config_error', 'タスク期間ルールのタイトルが重複しています', 500);
    periodByTitleKey[titleKey] = Ogawaya.normalizeTaskPeriod(rule.period);
    titleByKey[titleKey] = rule.title;
  });

  var matchedTitleKeys = {};
  var templateChangedCount = 0;
  var runChangedCount = 0;

  var templateItems = repository.listTable('checklist_template_items').map(function (item) {
    var titleKey = Ogawaya.normalizeTaskTitleForPeriodMigration(item.title);
    var nextPeriod = periodByTitleKey[titleKey];
    if (!nextPeriod) {
      return item;
    }
    matchedTitleKeys[titleKey] = true;
    if (String(item.period || '').trim() === nextPeriod) {
      return item;
    }
    var nextItem = Ogawaya.clone(item);
    nextItem.period = nextPeriod;
    nextItem.updated_at = now;
    templateChangedCount += 1;
    return nextItem;
  });

  var runItems = repository.listTable('checklist_run_items').map(function (item) {
    var titleKey = Ogawaya.normalizeTaskTitleForPeriodMigration(item.title);
    var nextPeriod = periodByTitleKey[titleKey];
    if (!nextPeriod) {
      return item;
    }
    matchedTitleKeys[titleKey] = true;
    if (String(item.period || '').trim() === nextPeriod) {
      return item;
    }
    var nextItem = Ogawaya.clone(item);
    nextItem.period = nextPeriod;
    runChangedCount += 1;
    return nextItem;
  });

  if (templateChangedCount > 0) {
    repository.replaceTable('checklist_template_items', templateItems);
  }
  if (runChangedCount > 0) {
    repository.replaceTable('checklist_run_items', runItems);
  }

  return {
    ok: true,
    updatedAt: now,
    templateChangedCount: templateChangedCount,
    runChangedCount: runChangedCount,
    unmatchedRuleTitles: Object.keys(periodByTitleKey).filter(function (titleKey) {
      return !matchedTitleKeys[titleKey];
    }).map(function (titleKey) {
      return titleByKey[titleKey];
    })
  };
};

function applyCurrentCleaningTaskPeriodTags() {
  return Ogawaya.applyCurrentCleaningTaskPeriodTags({});
}
