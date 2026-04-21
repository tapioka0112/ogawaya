/**
 * GAS Web App entrypoint.
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('liff/index')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  return routePost_(e);
}

function routePost_(e) {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    message: 'route placeholder',
    path: e && e.parameter ? e.parameter.path : null
  })).setMimeType(ContentService.MimeType.JSON);
}
