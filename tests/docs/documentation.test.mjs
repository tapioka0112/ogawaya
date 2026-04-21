import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('README と architecture に権限表・単一店舗前提・/api/link 契約・日次時刻が記載されている', async () => {
  const readme = await readFile('README.md', 'utf8');
  const architecture = await readFile('docs/design/architecture.md', 'utf8');

  assert.match(readme, /part_time \/ manager \/ admin/);
  assert.match(readme, /\| ロール \| 業務上の役割 \| 主な権限 \|/);
  assert.match(readme, /1ユーザー = 1店舗/);
  assert.match(readme, /employeeCode \+ passcode/);
  assert.match(readme, /10:30/);
  assert.match(readme, /0:00/);

  assert.match(architecture, /\| ロール \| 業務上の役割 \| 閲覧・操作範囲 \|/);
  assert.match(architecture, /1ユーザー = 1店舗/);
  assert.match(architecture, /POST \/api\/link/);
  assert.match(architecture, /10:30/);
  assert.match(architecture, /0:00/);
});

test('bootstrap 手順に初期データ投入と本番設定の再現手順が記載されている', async () => {
  const bootstrap = await readFile('docs/operations/bootstrap.md', 'utf8');

  assert.match(bootstrap, /## 1\. Spreadsheet 初期シート/);
  assert.match(bootstrap, /`stores`/);
  assert.match(bootstrap, /`notifications`/);
  assert.match(bootstrap, /## 2\. Script Properties/);
  assert.match(bootstrap, /`SPREADSHEET_ID`/);
  assert.match(bootstrap, /`LIFF_ID`/);
  assert.match(bootstrap, /## 4\. 初期データ/);
  assert.match(bootstrap, /checklist_templates/);
  assert.match(bootstrap, /checklist_template_items/);
  assert.match(bootstrap, /## 5\. Webhook \/ LIFF/);
  assert.match(bootstrap, /employeeCode/);
  assert.match(bootstrap, /X-Line-Signature/);
  assert.match(bootstrap, /## 6\. Trigger/);
  assert.match(bootstrap, /runDailyStart/);
  assert.match(bootstrap, /runDailyClosing/);
});
