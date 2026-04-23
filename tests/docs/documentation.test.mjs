import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const importCsvHeaders = {
  'docs/operations/import/stores.csv': 'id,name,status,created_at',
  'docs/operations/import/users.csv': 'id,store_id,name,employee_code,passcode,role,status,created_at',
  'docs/operations/import/line_accounts.csv': 'id,user_id,line_user_id,display_name,linked_at',
  'docs/operations/import/checklist_templates.csv': 'id,store_id,name,notify_time,closing_time,is_active,created_by,created_at,updated_at',
  'docs/operations/import/checklist_template_items.csv': 'id,template_id,title,description,sort_order,is_required,is_active,created_at,updated_at',
  'docs/operations/import/checklist_runs.csv': 'id,template_id,store_id,target_date,status,notified_at,closed_at,created_at',
  'docs/operations/import/checklist_run_items.csv': 'id,run_id,template_item_id,title,sort_order,status,checked_by,checked_by_name,checked_at,updated_at',
  'docs/operations/import/checklist_item_logs.csv': 'id,run_item_id,action,user_id,before_value,after_value,is_after_close,created_at',
  'docs/operations/import/notifications.csv': 'id,store_id,user_id,type,message,status,sent_at,error_message'
};

test('README に単一店舗前提・匿名運用・日次時刻・LINE表示名記録が記載されている', async () => {
  const readme = await readFile('README.md', 'utf8');

  assert.match(readme, /1ユーザー = 1店舗/);
  assert.match(readme, /ALLOW_ANONYMOUS_ACCESS/);
  assert.match(readme, /checked_by_name/);
  assert.match(readme, /10:30/);
  assert.match(readme, /0:00/);
  assert.match(readme, /Firestore/);
  assert.match(readme, /enableRealtimeSync/);
  assert.match(readme, /snapshots\/today/);
  assert.match(readme, /Spreadsheet/);
});

test('import 用アセットに CSV と Script Properties テンプレートが揃っている', async () => {
  const importReadme = await readFile('docs/operations/import/README.md', 'utf8');
  const scriptProperties = await readFile('docs/operations/import/script-properties.example.json', 'utf8');
  const scriptPropertiesJson = JSON.parse(scriptProperties);

  assert.match(importReadme, /stores\.csv/);
  assert.match(importReadme, /script-properties\.example\.json/);

  for (const key of [
    'SPREADSHEET_ID',
    'LINE_CHANNEL_ID',
    'LINE_CHANNEL_SECRET',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LIFF_ID'
  ]) {
    assert.ok(scriptPropertiesJson[key]);
  }

  for (const [path, header] of Object.entries(importCsvHeaders)) {
    const content = await readFile(path, 'utf8');
    assert.equal(content.split(/\r?\n/)[0], header);
  }
});

test('bootstrap は import アセットを相対リンクで参照する', async () => {
  const bootstrap = await readFile('docs/operations/bootstrap.md', 'utf8');

  assert.match(bootstrap, /\[docs\/operations\/import\/\]\(\.\/import\/\)/);
  assert.match(bootstrap, /\[script-properties\.example\.json\]\(\.\/import\/script-properties\.example\.json\)/);
});

test('import 手順は一括初期化関数を案内し、CSV import を fallback として残す', async () => {
  const importReadme = await readFile('docs/operations/import/README.md', 'utf8');
  const bootstrap = await readFile('docs/operations/bootstrap.md', 'utf8');

  assert.match(importReadme, /bootstrapSpreadsheetTemplates/);
  assert.match(importReadme, /CSV import は手動 fallback/);
  assert.match(bootstrap, /bootstrapSpreadsheetTemplates/);
  assert.match(bootstrap, /firebase\.apiKey/);
  assert.match(bootstrap, /enableRealtimeSync/);
});

test('Firestore 同期用 rules の実体と適用手順が存在する', async () => {
  const readme = await readFile('README.md', 'utf8');
  const bootstrap = await readFile('docs/operations/bootstrap.md', 'utf8');
  const firestoreRules = await readFile('docs/operations/firestore.rules', 'utf8');

  assert.match(readme, /docs\/operations\/firestore\.rules/);
  assert.match(bootstrap, /Firestore Rules/);
  assert.match(bootstrap, /\[docs\/operations\/firestore\.rules\]\(\.\/firestore\.rules\)/);
  assert.match(firestoreRules, /match \/stores\/\{storeId\}\/runs\/\{targetDate\}\/events\/\{eventId\}/);
  assert.match(firestoreRules, /match \/stores\/\{storeId\}\/runs\/\{targetDate\}\/snapshots\/\{snapshotId\}/);
  assert.match(bootstrap, /snapshots\/today/);
  assert.match(readme, /正本データ: Spreadsheet/);
  assert.match(firestoreRules, /allow create, update, delete: if false/);
  assert.match(firestoreRules, /match \/\{document=\*\*\}/);
});
