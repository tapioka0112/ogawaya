import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('GitHub Pages 用 LIFF 画面は必要スクリプトと要素を持つ', async () => {
  const html = await readFile('pages/index.html', 'utf8');

  assert.match(html, /https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(html, /https:\/\/www\.gstatic\.com\/firebasejs\/11\.0\.1\/firebase-app-compat\.js/);
  assert.match(html, /https:\/\/www\.gstatic\.com\/firebasejs\/11\.0\.1\/firebase-firestore-compat\.js/);
  assert.match(html, /<script src="\.\/app\.js"><\/script>/);
  assert.match(html, /id="checklist-items"/);
  assert.match(html, /id="task-detail-panel"/);
  assert.match(html, /id="task-detail-title"/);
  assert.match(html, /id="task-detail-description"/);
  assert.match(html, /id="task-detail-meta"/);
  assert.match(html, /id="incomplete-items"/);
  assert.match(html, /id="error-message"/);
  assert.match(html, /id="open-admin-button"/);
  assert.match(html, /id="tab-home"/);
  assert.match(html, /id="tab-stats"/);
  assert.match(html, /id="stats-content"/);
  assert.match(html, /id="stats-day-detail-card"/);
  assert.match(html, /id="stats-day-detail-items"/);
});

test('GitHub Pages の config.json は必須キーを持つ', async () => {
  const content = await readFile('pages/config.json', 'utf8');
  const config = JSON.parse(content);

  assert.equal(typeof config.gasApiBaseUrl, 'string');
  assert.equal(typeof config.functionsApiBaseUrl, 'string');
  assert.equal(typeof config.liffId, 'string');
  assert.equal(typeof config.defaultStoreId, 'string');
  assert.equal(typeof config.allowAnonymousAccess, 'boolean');
  assert.equal(typeof config.tryLiffAuthInAnonymous, 'boolean');
  assert.equal(typeof config.enableRealtimeSync, 'boolean');
  assert.equal(typeof config.clientFirestoreWriteEnabled, 'boolean');
  assert.equal(typeof config.consistencyRefreshSeconds, 'number');
  assert.equal(typeof config.firebase, 'object');
  assert.equal(typeof config.firebase.apiKey, 'string');
  assert.equal(typeof config.firebase.authDomain, 'string');
  assert.equal(typeof config.firebase.projectId, 'string');
  assert.equal(typeof config.firebase.appId, 'string');
});

test('GitHub Pages は pending 中でもクリックを無効化しない', async () => {
  const css = await readFile('pages/style.css', 'utf8');
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(css, /\.todo-item\[data-pending='true'\]\s*\{/);
  assert.doesNotMatch(css, /\.todo-item\[data-pending='true'\]\s*\{[^}]*pointer-events\s*:\s*none/);
  assert.doesNotMatch(appJs, /if\s*\(actionState\.inFlight\)\s*\{\s*return;\s*\}\s*clearError\(\);\s*clearStatus\(\);/);
});

test('GitHub Pages の連打制御は confirmedItem 基準で latest-wins を維持する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /confirmedItem:\s*null/);
  assert.match(appJs, /retryTimerId:\s*null/);
  assert.match(appJs, /retryAttempt:\s*0/);
  assert.match(appJs, /if\s*\(!actionState\.confirmedItem\)\s*\{\s*actionState\.confirmedItem = cloneChecklistItem\(currentItem\);\s*\}/);
  assert.match(appJs, /applyOptimisticStatus\(runItemId,\s*desiredStatus\);/);
  assert.match(appJs, /if\s*\(requestFailed\)\s*\{\s*scheduleItemStatusRetry\(runItemId,\s*requestError\);/);
  assert.match(appJs, /if\s*\(latestDesiredStatus && latestConfirmedStatus && latestDesiredStatus !== latestConfirmedStatus\)\s*\{\s*processItemStatusChange\(runItemId\);/);
});

test('GitHub Pages の realtime 同期は自己イベント・未確定時刻・欠落時刻を除外する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /if\s*\(emittedAtMs <= 0\)\s*\{\s*console\.debug\('\[sync\] ignore realtime event: pending_server_timestamp'\);/);
  assert.match(appJs, /if\s*\(currentUserId && String\(eventPayload\.sourceUserId \|\| ''\) === currentUserId\)\s*\{\s*console\.debug\('\[sync\] ignore realtime event: self_event'\);/);
  assert.match(appJs, /if\s*\(syncedItem\.status === 'checked' && !syncedItem\.checkedAt\)\s*\{\s*console\.debug\('\[sync\] ignore realtime event: missing_checked_at'\);/);
  assert.match(appJs, /if\s*\(incomingUpdatedAtMs <= latestKnownUpdatedAtMs\)\s*\{\s*return;\s*\}/);
  assert.match(appJs, /if\s*\(emittedAtMs <= actionState\.lastSyncedAtMs\)\s*\{\s*return;\s*\}/);
  assert.match(appJs, /actionState\.lastSyncedAtMs = emittedAtMs;/);
});

test('GitHub Pages の API再取得マージは未確定 desiredStatus を維持する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(
    appJs,
    /if\s*\(\s*actionState\.confirmedItem &&\s*actionState\.desiredStatus &&\s*actionState\.desiredStatus !== actionState\.confirmedItem\.status\s*\)\s*\{\s*return cloneChecklistItem\(localItem\);\s*\}/
  );
});

test('GitHub Pages の連打時は古い API 応答を UI に反映しない', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(
    appJs,
    /var latestDesiredStatusAtResponse = actionState\.desiredStatus;\s*if\s*\(\s*latestDesiredStatusAtResponse &&\s*latestDesiredStatusAtResponse !== response\.item\.status\s*\)\s*\{\s*return Promise\.resolve\(\);\s*\}\s*applyChecklistItemUpdate\(response\.item\);/
  );
});

test('GitHub Pages の check/uncheck は Firestore 副作用完了を待たずに inFlight を解放する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(
    appJs,
    /var optimisticItemForDispatch = desiredStatus === 'checked'\s*\?\s*buildOptimisticCheckedItem\(currentItem\)\s*:\s*buildOptimisticUncheckedItem\(currentItem\);/
  );
  assert.match(appJs, /emitRealtimeSideEffects\(optimisticItemForDispatch\);/);
  assert.doesNotMatch(appJs, /applyChecklistItemUpdate\(actionState\.confirmedItem\);/);
  assert.match(
    appJs,
    /function emitRealtimeSideEffects\(updatedItem\)\s*\{\s*emitRealtimeEvent\(updatedItem\);\s*scheduleChecklistSnapshotPersist\(\);\s*\}/
  );
});

test('GitHub Pages の API 同期失敗は指数バックオフで再試行する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /function scheduleItemStatusRetry\(runItemId,\s*requestError\)/);
  assert.match(appJs, /var retryable = statusCode === 0 \|\| statusCode >= 500;/);
  assert.match(appJs, /actionState\.retryAttempt = Math\.min\(actionState\.retryAttempt \+ 1,\s*ITEM_ACTION_RETRY_MAX_ATTEMPTS\);/);
  assert.match(appJs, /var delayMs = Math\.min\(10000,\s*400 \* Math\.pow\(2,\s*actionState\.retryAttempt - 1\)\);/);
  assert.match(appJs, /actionState\.retryTimerId = global\.setTimeout\(function \(\) \{\s*actionState\.retryTimerId = null;\s*processItemStatusChange\(runItemId\);\s*\}, delayMs\);/);
});

test('GitHub Pages の API 同期はタイムアウト付きで実行する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /var ITEM_ACTION_REQUEST_TIMEOUT_MS = 2500;/);
  assert.match(appJs, /var requestPromiseWithTimeout = withTimeout\(\s*requestPromise,\s*ITEM_ACTION_REQUEST_TIMEOUT_MS,\s*'API 同期がタイムアウトしました'\s*\);/);
  assert.match(appJs, /requestPromiseWithTimeout\.then\(function \(response\)/);
});

test('GitHub Pages の snapshot 保存はデバウンスで集約する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /var SNAPSHOT_PERSIST_DEBOUNCE_MS = 1500;/);
  assert.match(appJs, /snapshotPersistTimerId:\s*null/);
  assert.match(appJs, /function scheduleChecklistSnapshotPersist\(\)/);
  assert.match(appJs, /state\.snapshotPersistTimerId = global\.setTimeout\(function \(\) \{\s*state\.snapshotPersistTimerId = null;\s*persistChecklistSnapshot\(\);\s*\}, SNAPSHOT_PERSIST_DEBOUNCE_MS\);/);
  assert.doesNotMatch(appJs, /function refreshChecklist\(options\)\s*\{[\s\S]*persistChecklistSnapshot\(\)/);
});

test('GitHub Pages の連打制御は dispatch debounce で送信を集約する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /var ITEM_ACTION_DISPATCH_DEBOUNCE_MS = 120;/);
  assert.match(appJs, /if\s*\(actionState\.dispatchTimerId\)\s*\{\s*global\.clearTimeout\(actionState\.dispatchTimerId\);\s*\}/);
  assert.match(appJs, /actionState\.dispatchTimerId = global\.setTimeout\(function \(\) \{\s*actionState\.dispatchTimerId = null;\s*processItemStatusChange\(runItemId\);\s*\}, ITEM_ACTION_DISPATCH_DEBOUNCE_MS\);/);
});

test('GitHub Pages のトグル判定は最新 state から next status を決める', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /function openTaskDetail\(runItemId\)/);
  assert.match(appJs, /listItem\.addEventListener\('click', openDetailHandler\);/);
  assert.match(appJs, /checkButton\.addEventListener\('click', toggleHandler\);/);
  assert.match(appJs, /var latestItem = findChecklistItemById\(item\.id\);/);
  assert.match(appJs, /var nextStatus = latestItem\.status === 'unchecked' \? 'checked' : 'unchecked';/);
  assert.match(appJs, /requestItemStatusChange\(item\.id,\s*nextStatus\);/);
});

test('GitHub Pages の checklist snapshot はタスク詳細を保持する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /description: String\(item\.description \|\| ''\),/);
  assert.match(appJs, /setText\(\s*elements\.taskDetailDescription,\s*item\.description \? String\(item\.description\) : 'このタスクには詳細が登録されていません。'\s*\);/);
});

test('GitHub Pages のタブUIはホームと統計を切り替えられる', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');
  const css = await readFile('pages/style.css', 'utf8');

  assert.match(appJs, /function setActiveTab\(tabName\)/);
  assert.match(appJs, /elements\.mainContent\.hidden = isStatsTab;/);
  assert.match(appJs, /elements\.statsContent\.hidden = !isStatsTab;/);
  assert.match(appJs, /elements\.tabHome\.addEventListener\('click'/);
  assert.match(appJs, /elements\.tabStats\.addEventListener\('click'/);
  assert.match(appJs, /if\s*\(isStatsTab\)\s*\{\s*updateMonthLabel\(\);\s*renderCalendar\(state\.statsYear,\s*state\.statsMonth,\s*state\.statsData \? state\.statsData\.calendar : \[\]\);\s*renderStatsDayDetails\(\);/);
  assert.match(appJs, /bindStatsCalendarSelection\(\);/);
  assert.match(css, /#stats-content\s*\{\s*display:\s*none;/);
  assert.match(css, /#stats-content:not\(\[hidden\]\)\s*\{\s*display:\s*flex;/);
});

test('GitHub Pages の統計タブは Firestore snapshot からクライアント集計して表示する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /function buildSnapshotDocRef\(storeId,\s*targetDate\)/);
  assert.match(appJs, /function buildMonthTargetDates\(year,\s*month\)/);
  assert.match(appJs, /function loadMonthlyStatsFromSnapshots\(year,\s*month\)/);
  assert.match(appJs, /Promise\.all\(targetDates\.map\(function \(targetDate\)/);
  assert.match(appJs, /function loadDailyStatsFromSnapshot\(targetDate\)/);
  assert.match(appJs, /function startStatsTodaySnapshotSubscription\(\)/);
  assert.doesNotMatch(appJs, /\.collection\('monthly_stats'\)/);
  assert.doesNotMatch(appJs, /\.collection\('daily_stats'\)/);
  assert.doesNotMatch(appJs, /state\.api\.getMonthlyStats\(/);
  assert.doesNotMatch(appJs, /state\.api\.getDailyStats\(/);
});
