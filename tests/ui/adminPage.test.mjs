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
  assert.match(html, /id="template-period-input"/);
  assert.match(html, /id="create-template-button"/);
  assert.match(html, /data-admin-flow-panel="create-template" hidden/);
  assert.match(html, /id="template-select"/);
  assert.match(html, /id="template-daily-date-input"/);
  assert.match(html, /id="template-week-month-input"/);
  assert.match(html, /id="template-week-select"/);
  assert.match(html, /id="template-month-input"/);
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
  assert.match(html, /<script src="\.\/admin\.js\?v=admin-period-anchor-20260511"><\/script>/);
});

test('管理者ページのタスク挿入はタグごとに対象日を算出する', async () => {
  const js = await readFile('pages/admin.js', 'utf8');
  const css = await readFile('pages/admin.css', 'utf8');

  assert.match(js, /function listWeeksForMonth\(monthValue\)/);
  assert.match(js, /function getInsertTargetDateForTask\(task\)/);
  assert.match(js, /case 'weekly':\s*return getSelectedWeekStartDate\(\);/);
  assert.match(js, /case 'monthly':\s*return getSelectedMonthStartDate\(\);/);
  assert.match(js, /function getRunTargetDateCandidatesForDate\(dateValue\)/);
  assert.match(js, /getWeekStartDateForDate\(dateValue\)/);
  assert.match(js, /getMonthStartDateForDate\(dateValue\)/);
  assert.match(js, /addCandidatePeriod\(dateValue,\s*'daily'\);/);
  assert.match(js, /addCandidatePeriod\(getWeekStartDateForDate\(dateValue\),\s*'weekly'\);/);
  assert.match(js, /addCandidatePeriod\(getMonthStartDateForDate\(dateValue\),\s*'monthly'\);/);
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

test('管理者ページのテンプレートは期間専用で作成・挿入する', async () => {
  const html = await readFile('pages/admin.html', 'utf8');
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(html, /id="template-period-input"[\s\S]*<option value="daily">日間<\/option>/);
  assert.match(html, /data-template-period-field="daily"[\s\S]*id="template-daily-date-input"/);
  assert.match(html, /data-template-period-field="weekly"[\s\S]*id="template-week-month-input"/);
  assert.match(html, /data-template-period-field="weekly"[\s\S]*id="template-week-select"/);
  assert.match(html, /data-template-period-field="monthly"[\s\S]*id="template-month-input"/);
  assert.match(js, /function getTemplateCreatePeriod\(\)/);
  assert.match(js, /function getTemplateApplyTargetDate\(template\)/);
  assert.match(js, /taskPeriod === templatePeriod/);
  assert.match(js, /templateRef\.collection\('items'\)\.doc\(\)\.set\(\{/);
  assert.match(js, /var targetDate = getTemplateApplyTargetDate\(template\);/);
  assert.match(js, /await writeTemplateInsertEvent\(targetDate,\s*template\.id,\s*templatePeriod,\s*optimisticItems\);/);
  assert.doesNotMatch(js, /syncTemplateInsertViaGasInBackground/);
});

test('管理者ページは GAS API と Functions API を呼び出さない', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.doesNotMatch(js, /gasApiBaseUrl|functionsApiBaseUrl|apiRequest\(|functionsApiRequest|syncTemplateInsertViaGas|deleteRunItemViaGas/);
  assert.match(js, /getStoreRef\(\)\.collection\('tasks'\)\.get\(\)/);
  assert.match(js, /getStoreRef\(\)\.collection\('templates'\)\.get\(\)/);
  assert.match(js, /getStoreRef\(\)\.collection\('runs'\)\.doc\(targetDate\)/);
});

test('管理者ログインは Firebase Auth と店舗allowlistで判定する', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(js, /signInWithEmailAndPassword\(loginId,\s*password\)/);
  assert.match(js, /collection\('admins'\)\.doc\(firebaseUser\.uid\)\.get\(\)/);
  assert.match(js, /throw createApiError\('管理者権限がありません',\s*403,\s*'forbidden'\);/);
  assert.doesNotMatch(js, /ADMIN_SESSION_STORAGE_KEY/);
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
  assert.match(js, /var targetDates = getRunTargetDateCandidatesForDate\(targetDate\);/);
  assert.match(js, /var cachedChecklist = requestOptions\.preferCache === false \? null : getCachedRunItems\(targetDate\);/);
  assert.match(js, /state\.runItemsLoading = true;\s*state\.checklist = cachedChecklist \|\| null;\s*renderRunItems\(\);/);
  assert.match(js, /Promise\.all\(targetDates\.map\(function \(candidate\)/);
  assert.match(js, /doc\(candidate\.targetDate\)/);
  assert.match(js, /if \(!entry\.periods\[normalizeTaskPeriod\(data\.period\)\]\) \{/);
  assert.match(js, /items\.push\(normalizeRunItemDoc\(doc,\s*entry\.targetDate\)\);/);
  assert.match(js, /if\s*\(requestId !== state\.runItemsRequestId \|\| targetDate !== state\.selectedDate\)\s*\{\s*return;\s*\}/);
  assert.match(js, /catch \(error\)\s*\{\s*if\s*\(requestId !== state\.runItemsRequestId \|\| targetDate !== state\.selectedDate\)\s*\{\s*return;\s*\}\s*throw error;\s*\}/);
  assert.match(js, /rememberRunItems\(targetDate, state\.checklist\);/);
  assert.match(js, /state\.runItemsLoading = false;\s*renderRunItems\(\);/);
  assert.match(js, /タスクを読み込み中です。/);
});

test('管理者ページの管理データ取得と操作後反映は不要な全再取得を避ける', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(js, /await loadTasks\(\);\s*await Promise\.all\(\[\s*loadTemplates\(\),\s*loadRunItems\(\)\s*\]\);/);
  assert.match(js, /function upsertTask\(task\)/);
  assert.match(js, /function upsertTemplate\(template\)/);
  assert.match(js, /function appendCurrentRunItems\(items\)/);
  assert.match(js, /function removeCurrentRunItem\(runItemId\)/);
  assert.match(js, /appendRunItemsForDate\(targetDate,\s*\[item\]\);/);
  assert.match(js, /appendCurrentRunItems\(optimisticItems\);/);
});

test('管理者ページのテンプレート挿入と削除はFirestoreへ直接保存する', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(js, /function initializeRealtimeClient\(\)/);
  assert.match(js, /function ensureFirebaseAuthSession\(\)/);
  assert.match(js, /function getFirebaseIdToken\(\)/);
  assert.match(js, /typeof user\.getIdToken !== 'function'/);
  assert.match(js, /return user\.getIdToken\(\);/);
  assert.match(js, /function buildOptimisticTemplateRunItems\(template\)/);
  assert.match(js, /pendingSave:\s*true/);
  assert.match(js, /function getRunIdForDate\(date\)/);
  assert.match(js, /function rememberRunMetadataForDate\(date,\s*response\)/);
  assert.match(js, /function writeTemplateInsertEvent\(targetDate,\s*templateId,\s*period,\s*items\)/);
  assert.match(js, /\.collection\('events'\)\s*\.add\(buildTemplateInsertEventPayload\(targetDate,\s*templateId,\s*period,\s*items\)\)/);
  assert.match(js, /type:\s*'template_insert'/);
  assert.match(js, /period:\s*normalizeTaskPeriod\(period\)/);
  assert.match(js, /await ensureRunDocument\(targetDate\);/);
  assert.match(js, /return writeRunItemDoc\(targetDate,\s*item\);/);
  assert.match(js, /function writeRunItemDeleteEvent\(targetDate,\s*runItemId\)/);
  assert.match(js, /\.collection\('events'\)\s*\.add\(buildRunItemDeleteEventPayload\(targetDate,\s*runItemId\)\)/);
  assert.match(js, /type:\s*'item_delete'/);
  assert.match(js, /sourceUserId:\s*state\.adminUser \? String\(state\.adminUser\.uid \|\| ''\) : ''/);
  assert.match(js, /sourceClientId:\s*getClientInstanceId\(\)/);
  assert.match(js, /function restoreTemplateInsertEventsForDate\(targetDate\)/);
  assert.match(js, /function applyTemplateInsertEventToRunItems\(eventPayload,\s*targetDate\)/);
  assert.match(js, /function applyRunItemDeleteEventToRunItems\(eventPayload,\s*targetDate\)/);
  assert.match(js, /function loadTemplateInsertEventsFromFirestoreRest\(targetDate\)/);
  assert.match(js, /function applyRunItemStatusEventToRunItems\(eventPayload,\s*targetDate\)/);
  assert.match(js, /pageSize=300/);
  assert.match(js, /Authorization:\s*'Bearer ' \+ idToken/);
  assert.doesNotMatch(js, /Firestore同期用のrunIdが未確定です/);
  assert.match(js, /await writeTemplateInsertEvent\(targetDate,\s*template\.id,\s*templatePeriod,\s*optimisticItems\);/);
  assert.match(js, /var targetDate = String\(item && item\.targetDate \? item\.targetDate : state\.selectedDate\);/);
  assert.match(js, /await writeRunItemDeleteEvent\(targetDate,\s*runItemId\);/);
  assert.doesNotMatch(js, /syncRunItemDeleteViaGasInBackground|deleteRunItemViaGas|apiRequest\(/);
  assert.match(js, /if \(eventPayload\.type === 'item_delete'\) \{\s*applyRunItemDeleteEventToRunItems\(eventPayload,\s*targetDate\);\s*return;\s*\}/);
  assert.match(js, /await restoreTemplateInsertEventsForDate\(targetDate\);/);
});
