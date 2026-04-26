import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const importCsvHeaders = {
  'docs/operations/import/stores.csv': 'id,name,status,created_at',
  'docs/operations/import/users.csv': 'id,store_id,name,employee_code,passcode,role,status,created_at',
  'docs/operations/import/line_accounts.csv': 'id,user_id,line_user_id,display_name,linked_at',
  'docs/operations/import/notification_channels.csv': 'id,store_id,name,access_token_property,monthly_limit,recipient_limit,status,created_at,updated_at',
  'docs/operations/import/notification_recipients.csv': 'id,store_id,line_user_id,display_name,channel_id,status,last_seen_at,created_at,updated_at',
  'docs/operations/import/notification_channel_usage.csv': 'id,channel_id,year_month,monthly_limit,official_sent_count,local_sent_count,remaining_count,last_synced_at,error_message',
  'docs/operations/import/checklist_templates.csv': 'id,store_id,name,period,notify_time,closing_time,is_active,created_by,created_at,updated_at',
  'docs/operations/import/checklist_template_items.csv': 'id,template_id,title,description,period,sort_order,is_required,is_active,created_at,updated_at',
  'docs/operations/import/checklist_runs.csv': 'id,template_id,store_id,target_date,status,notified_at,closed_at,created_at',
  'docs/operations/import/checklist_run_items.csv': 'id,run_id,template_item_id,title,period,sort_order,status,checked_by,checked_by_name,checked_at,updated_at',
  'docs/operations/import/checklist_item_logs.csv': 'id,run_item_id,action,user_id,before_value,after_value,is_after_close,created_at',
  'docs/operations/import/notifications.csv': 'id,store_id,user_id,type,channel_id,dedupe_key,message,status,sent_at,error_message'
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
    'LINE_LOGIN_CHANNEL_ID',
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
  assert.match(firestoreRules, /isValidTemplateInsertEvent/);
  assert.match(firestoreRules, /data\.type == 'template_insert'/);
  assert.match(bootstrap, /snapshots\/today/);
  assert.match(readme, /正本データ: Spreadsheet/);
  assert.match(readme, /clientFirestoreWriteEnabled/);
  assert.match(bootstrap, /Anonymous/);
  assert.match(
    firestoreRules,
    /allow create: if isValidChecklistEvent\(storeId, targetDate\) \|\| isValidTemplateInsertEvent\(storeId, targetDate\)/
  );
  assert.match(firestoreRules, /allow update, delete: if false/);
  assert.match(firestoreRules, /match \/\{document=\*\*\}/);
});

test('LINE公式アカウント分散通知の運用手順が存在する', async () => {
  const readme = await readFile('README.md', 'utf8');
  const bootstrap = await readFile('docs/operations/bootstrap.md', 'utf8');
  const scaling = await readFile('docs/operations/line-notification-scaling.md', 'utf8');

  assert.match(readme, /line-notification-scaling\.md/);
  assert.match(bootstrap, /installReminderTriggers/);
  assert.match(scaling, /notification_channels/);
  assert.match(scaling, /rebalanceNotificationRecipients/);
  assert.match(scaling, /LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01/);
});

test('非IT担当者向けの全体運用手順が存在する', async () => {
  const readme = await readFile('README.md', 'utf8');
  const bootstrap = await readFile('docs/operations/bootstrap.md', 'utf8');
  const manual = await readFile('docs/operations/non-technical-operations.md', 'utf8');

  for (const content of [readme, bootstrap]) {
    assert.match(content, /non-technical-operations\.md/);
  }
  for (const text of [
    '毎日やること',
    'Apps Scriptで関数を実行する方法',
    '管理者画面の使い方',
    '従業員を追加する',
    '通知用LINE公式アカウントを増やす',
    'Googleスプレッドシートで触ってよい場所',
    'LINE公式アカウントとLIFFの設定確認',
    'GAS Script Properties',
    'GitHub Pagesと設定ファイル',
    'Deploy LIFF Pages',
    'Firebaseの確認',
    'よくあるトラブル',
    'installReminderTriggers',
    'LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01',
    'https://tapioka0112.github.io/ogawaya/',
    'https://tapioka0112.github.io/ogawaya/admin.html',
    'https://liff.line.me/2009859108-sJ31BCFx',
    'https://docs.google.com/spreadsheets/d/1VBTZaLtSi1FZQnWG-zIDQ1GFpoHilAUpf1R7xcllLP8/edit?gid=2082526106#gid=2082526106',
    'https://console.firebase.google.com/project/owagaya-fd93b/overview',
    'https://script.google.com/d/1q7LLKLs4l_mH2gE9VmaxdX0Ilrbt9BLuOSTZXlOZIPxukh7FH7zHeMHd/edit'
  ]) {
    assert.match(manual, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const imagePath of [
    './assets/employee-home.png',
    './assets/employee-stats.png',
    './assets/employee-debug-waterfall.png',
    './assets/admin-login.png',
    './assets/admin-task-management.png',
    './assets/admin-template-insert.png'
  ]) {
    assert.match(manual, new RegExp(imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const image = await readFile(`docs/operations/${imagePath.replace('./', '')}`);
    assert.ok(image.length > 0);
  }
});
