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
  'docs/operations/import/checklist_run_items.csv': 'id,run_id,template_item_id,title,sort_order,status,checked_by,checked_at,updated_at',
  'docs/operations/import/checklist_item_logs.csv': 'id,run_item_id,action,user_id,before_value,after_value,is_after_close,created_at',
  'docs/operations/import/notifications.csv': 'id,store_id,user_id,type,message,status,sent_at,error_message'
};

test('README に権限・単一店舗前提・/api/link 契約・日次時刻が記載されている', async () => {
  const readme = await readFile('README.md', 'utf8');

  assert.match(readme, /part_time \/ manager \/ admin/);
  assert.match(readme, /1ユーザー = 1店舗/);
  assert.match(readme, /employeeCode \+ passcode/);
  assert.match(readme, /10:30/);
  assert.match(readme, /0:00/);
});

test('import 用アセットに CSV と Script Properties テンプレートが揃っている', async () => {
  const importReadme = await readFile('docs/operations/import/README.md', 'utf8');
  const scriptProperties = await readFile('docs/operations/import/script-properties.example.json', 'utf8');

  assert.match(importReadme, /stores\.csv/);
  assert.match(importReadme, /script-properties\.example\.json/);
  assert.match(scriptProperties, /SPREADSHEET_ID/);
  assert.match(scriptProperties, /LINE_CHANNEL_ID/);
  assert.match(scriptProperties, /LIFF_ID/);

  for (const [path, header] of Object.entries(importCsvHeaders)) {
    const content = await readFile(path, 'utf8');
    assert.equal(content.split('\n')[0], header);
  }
});
