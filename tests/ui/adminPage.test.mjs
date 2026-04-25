import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('管理者ページはログイン導線と管理UIの主要要素を持つ', async () => {
  const html = await readFile('pages/admin.html', 'utf8');

  assert.match(html, /id="admin-login-id"/);
  assert.match(html, /id="admin-login-password"/);
  assert.match(html, /id="admin-login-button"/);
  assert.match(html, /id="task-title-input"/);
  assert.match(html, /id="task-description-input"/);
  assert.match(html, /id="task-period-input"/);
  assert.match(html, /id="create-task-button"/);
  assert.match(html, /data-admin-flow-button="create-task"/);
  assert.match(html, /data-admin-flow-panel="create-task"/);
  assert.match(html, /id="task-select"/);
  assert.match(html, /id="insert-daily-date-input"/);
  assert.match(html, /id="insert-week-month-input"/);
  assert.match(html, /id="insert-week-select"/);
  assert.match(html, /id="insert-month-input"/);
  assert.match(html, /id="insert-task-button"/);
  assert.match(html, /data-admin-flow-panel="insert-task" hidden/);
  assert.match(html, /id="template-name-input"/);
  assert.match(html, /id="create-template-button"/);
  assert.match(html, /data-admin-flow-panel="create-template" hidden/);
  assert.match(html, /id="template-select"/);
  assert.match(html, /id="apply-template-button"/);
  assert.match(html, /data-admin-flow-panel="apply-template" hidden/);
  assert.match(html, />テンプレートを挿入<\/button>/);
  assert.match(html, />挿入するテンプレート<\/span>/);
  assert.doesNotMatch(html, /テンプレートを読み込む/);
  assert.match(html, /id="admin-date-input"/);
  assert.match(html, /id="admin-run-items"/);
  assert.match(html, /id="calendar-grid"/);
  assert.match(html, /https:\/\/www\.gstatic\.com\/firebasejs\/11\.0\.1\/firebase-app-compat\.js/);
  assert.match(html, /https:\/\/www\.gstatic\.com\/firebasejs\/11\.0\.1\/firebase-auth-compat\.js/);
  assert.match(html, /https:\/\/www\.gstatic\.com\/firebasejs\/11\.0\.1\/firebase-firestore-compat\.js/);
  assert.match(html, /<script src="\.\/admin\.js\?v=[^"]+"><\/script>/);
  assert.match(html, /<script src="\.\/admin\.js\?v=admin-event-rest-repair-fix-20260426"><\/script>/);
});

test('管理者ページのタスク挿入はタグごとに対象日を算出する', async () => {
  const js = await readFile('pages/admin.js', 'utf8');
  const css = await readFile('pages/admin.css', 'utf8');

  assert.match(js, /function listWeeksForMonth\(monthValue\)/);
  assert.match(js, /function getInsertTargetDateForTask\(task\)/);
  assert.match(js, /case 'weekly':\s*return getSelectedWeekStartDate\(\);/);
  assert.match(js, /case 'monthly':\s*return getSelectedMonthStartDate\(\);/);
  assert.match(js, /elements\.taskSelect\.addEventListener\('change', updateInsertPeriodFields\);/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('管理者ページのテンプレート作成タスク一覧は専用フロー内でスクロール表示する', async () => {
  const html = await readFile('pages/admin.html', 'utf8');
  const css = await readFile('pages/admin.css', 'utf8');
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(html, /id="create-template-flow"[\s\S]*id="template-task-list"/);
  assert.match(css, /#template-task-list\s*\{[\s\S]*max-height:\s*240px;/);
  assert.match(css, /#template-task-list\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /#template-task-list li\s*\{[\s\S]*grid-template-columns:\s*24px minmax\(0,\s*1fr\);/);
  assert.match(css, /#template-task-list label\s*\{[\s\S]*white-space:\s*nowrap;/);
  assert.match(css, /#template-task-list label\s*\{[\s\S]*text-overflow:\s*ellipsis;/);
  assert.match(js, /if \(state\.activeFlow === 'create-template'\) \{\s*renderTemplateTaskChecklist\(\);/);
});

test('管理者ページの GAS API 呼び出しは CORS preflight を避ける', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.doesNotMatch(js, /Content-Type['"]?\s*:\s*['"]application\/json/);
  assert.match(js, /method: 'GET'/);
  assert.match(js, /query\._payload = JSON\.stringify\(body\);/);
  assert.match(js, /query\._method = method;/);
});

test('管理者ログインは設定ファイルの店舗IDでGASセッションを作成する', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(js, /ADMIN_SESSION_STORAGE_KEY = 'ogawaya:admin:session-token:v3'/);
  assert.match(js, /storeId:\s*state\.config\.defaultStoreId/);
});

test('管理者ページの4操作ボタンはレスポンシブグリッドで同じ幅に揃える', async () => {
  const html = await readFile('pages/admin.html', 'utf8');
  const css = await readFile('pages/admin.css', 'utf8');

  assert.match(html, /class="admin-action-grid"/);
  assert.match(css, /\.admin-action-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /\.admin-action-grid button\s*\{[\s\S]*width:\s*100%;/);
  assert.match(css, /@media \(max-width: 840px\)\s*\{[\s\S]*\.admin-action-grid\s*\{[\s\S]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width: 520px\)\s*\{[\s\S]*\.admin-action-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
});

test('管理者ページの日付別タスク削除ボタンは固定幅で折り返さない', async () => {
  const html = await readFile('pages/admin.html', 'utf8');
  const css = await readFile('pages/admin.css', 'utf8');

  assert.match(html, /<link rel="stylesheet" href="\.\/admin\.css\?v=admin-period-fix-20260426" \/>/);
  assert.match(css, /\.run-item-main\s*\{[\s\S]*min-width:\s*0;/);
  assert.match(css, /\.run-item-delete\s*\{[\s\S]*flex:\s*0 0 72px;/);
  assert.match(css, /\.run-item-delete\s*\{[\s\S]*width:\s*72px;/);
  assert.match(css, /\.run-item-delete\s*\{[\s\S]*white-space:\s*nowrap;/);
  assert.match(css, /\.run-item-delete\s*\{[\s\S]*display:\s*inline-flex;/);
});

test('管理者ページの日付別タスク取得は古い応答を破棄し日付キャッシュを使う', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(js, /runItemsByDate:\s*\{\}/);
  assert.match(js, /runItemsRequestId:\s*0/);
  assert.match(js, /runItemsLoading:\s*false/);
  assert.match(js, /function getCachedRunItems\(date\)/);
  assert.match(js, /function rememberRunItems\(date, checklist\)/);
  assert.match(js, /state\.runItemsRequestId \+= 1;/);
  assert.match(js, /var requestId = state\.runItemsRequestId;/);
  assert.match(js, /var cachedChecklist = requestOptions\.preferCache === false \? null : getCachedRunItems\(targetDate\);/);
  assert.match(js, /state\.runItemsLoading = true;\s*state\.checklist = cachedChecklist \|\| null;\s*renderRunItems\(\);/);
  assert.match(js, /if\s*\(requestId !== state\.runItemsRequestId \|\| targetDate !== state\.selectedDate\)\s*\{\s*return;\s*\}/);
  assert.match(js, /catch \(error\)\s*\{\s*if\s*\(requestId !== state\.runItemsRequestId \|\| targetDate !== state\.selectedDate\)\s*\{\s*return;\s*\}\s*throw error;\s*\}/);
  assert.match(js, /rememberRunItems\(targetDate, state\.checklist\);/);
  assert.match(js, /state\.runItemsLoading = false;\s*renderRunItems\(\);/);
  assert.match(js, /タスクを読み込み中です。/);
});

test('管理者ページの管理データ取得と操作後反映は不要な全再取得を避ける', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(js, /await Promise\.all\(\[\s*loadTasks\(\),\s*loadTemplates\(\),\s*loadRunItems\(\)\s*\]\);/);
  assert.match(js, /function upsertTask\(task\)/);
  assert.match(js, /function upsertTemplate\(template\)/);
  assert.match(js, /function appendCurrentRunItems\(items\)/);
  assert.match(js, /function removeCurrentRunItem\(runItemId\)/);
  assert.match(js, /if \(response\.item\) \{\s*appendRunItemsForDate\(targetDate,\s*\[response\.item\]\);/);
  assert.match(js, /if \(Array\.isArray\(response\.items\) && response\.items\.length > 0\) \{\s*appendRunItemsForDate\(targetDate,\s*response\.items\);/);
});

test('管理者ページのテンプレート挿入は即時表示しFirestore通知後にGAS保存をバックグラウンド実行する', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(js, /function initializeRealtimeClient\(\)/);
  assert.match(js, /function ensureFirebaseAuthSession\(\)/);
  assert.match(js, /function buildOptimisticTemplateRunItems\(template\)/);
  assert.match(js, /pendingSave:\s*true/);
  assert.match(js, /function writeTemplateInsertEvent\(targetDate,\s*templateId,\s*items\)/);
  assert.match(js, /\.collection\('events'\)\s*\.add\(buildTemplateInsertEventPayload\(targetDate,\s*templateId,\s*items\)\)/);
  assert.match(js, /type:\s*'template_insert'/);
  assert.match(js, /function syncTemplateInsertViaGasInBackground\(targetDate,\s*templateId,\s*items,\s*attempt\)/);
  assert.match(js, /function restoreTemplateInsertEventsForDate\(targetDate\)/);
  assert.match(js, /function applyTemplateInsertEventToRunItems\(eventPayload,\s*targetDate\)/);
  assert.match(js, /function loadTemplateInsertEventsFromFirestoreRest\(targetDate\)/);
  assert.match(js, /function applyRunItemStatusEventToRunItems\(eventPayload,\s*targetDate\)/);
  assert.match(js, /pageSize=300/);
  assert.match(js, /clientItems:\s*buildTemplateClientItems\(items\)/);
  assert.match(js, /writeTemplateInsertEvent\(state\.selectedDate,\s*template\.id,\s*optimisticItems\)\.catch/);
  assert.match(js, /syncTemplateInsertViaGasInBackground\(state\.selectedDate,\s*template\.id,\s*optimisticItems,\s*0\);/);
  assert.match(js, /await restoreTemplateInsertEventsForDate\(targetDate\);/);
  assert.doesNotMatch(js, /await apiRequest\(\s*'POST',\s*'\/api\/admin\/runs\/'\s*\+ encodeURIComponent\(state\.selectedDate\)\s*\+ '\/templates\//);
});
