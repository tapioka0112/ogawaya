function doGet(e) {
  var request = Ogawaya.extractRequest(e, 'GET');
  var appBaseUrl = ScriptApp.getService().getUrl();
  var liffId = PropertiesService.getScriptProperties().getProperty('LIFF_ID') || '';
  var queryKeys = Object.keys((e && e.parameter) || {});
  Ogawaya.writeDebugEvent('doGet', {
    path: request.path,
    mode: (e && e.parameter && e.parameter.mode) || '',
    appBaseUrl: appBaseUrl,
    queryKeys: queryKeys,
    hasLiffId: !!liffId,
    liffIdLength: String(liffId).length
  });
  if (request.path.indexOf('/api/') === 0) {
    return Ogawaya.toTextOutput(Ogawaya.createApplication({}).handleApiRequest(request));
  }

  var mode = (e && e.parameter && e.parameter.mode) || 'user';
  var templateName = 'src/liff/index';
  if (mode === 'user') {
    templateName = 'src/liff/user/index';
  }
  if (mode === 'admin') {
    templateName = 'src/liff/admin/index';
  }

  return Ogawaya.renderTemplate(templateName, {
    appBaseUrl: appBaseUrl,
    mode: mode,
    liffId: liffId
  });
}

function doPost(e) {
  var request = Ogawaya.extractRequest(e, 'POST');
  var appBaseUrl = ScriptApp.getService().getUrl();
  Ogawaya.writeDebugEvent('doPost', {
    path: request.path,
    appBaseUrl: appBaseUrl
  });
  var app = Ogawaya.createApplication({});
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
  var response = Ogawaya.createApplication({}).handleApiRequest({
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
