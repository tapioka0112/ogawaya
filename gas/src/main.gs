function doGet(e) {
  var request = Ogawaya.extractRequest(e, 'GET');
  if (request.path.indexOf('/api/') === 0) {
    return Ogawaya.toTextOutput(Ogawaya.createApplication({}).handleApiRequest(request));
  }

  var mode = (e && e.parameter && e.parameter.mode) || 'index';
  var templateName = 'src/liff/index';
  if (mode === 'user') {
    templateName = 'src/liff/user/index';
  }
  if (mode === 'admin') {
    templateName = 'src/liff/admin/index';
  }

  return Ogawaya.renderTemplate(templateName, {
    appBaseUrl: ScriptApp.getService().getUrl(),
    mode: mode,
    liffId: PropertiesService.getScriptProperties().getProperty('LIFF_ID') || ''
  });
}

function doPost(e) {
  var request = Ogawaya.extractRequest(e, 'POST');
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
