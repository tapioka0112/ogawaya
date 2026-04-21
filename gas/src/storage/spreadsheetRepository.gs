/**
 * Spreadsheet persistence layer.
 */
function getSpreadsheetById(spreadsheetId) {
  return SpreadsheetApp.openById(spreadsheetId);
}
