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
  assert.match(html, /id="incomplete-items"/);
  assert.match(html, /id="error-message"/);
  assert.match(html, /id="tab-home"/);
  assert.match(html, /id="tab-stats"/);
  assert.match(html, /id="stats-content"/);
});

test('GitHub Pages の config.json は必須キーを持つ', async () => {
  const content = await readFile('pages/config.json', 'utf8');
  const config = JSON.parse(content);

  assert.equal(typeof config.gasApiBaseUrl, 'string');
  assert.equal(typeof config.liffId, 'string');
  assert.equal(typeof config.defaultStoreId, 'string');
  assert.equal(typeof config.allowAnonymousAccess, 'boolean');
  assert.equal(typeof config.tryLiffAuthInAnonymous, 'boolean');
  assert.equal(typeof config.enableRealtimeSync, 'boolean');
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
  assert.match(appJs, /if\s*\(!actionState\.confirmedItem\)\s*\{\s*actionState\.confirmedItem = cloneChecklistItem\(currentItem\);\s*\}/);
  assert.match(appJs, /applyOptimisticStatus\(runItemId,\s*desiredStatus\);/);
  assert.match(appJs, /if\s*\(requestFailed\)\s*\{\s*actionState\.desiredStatus = latestConfirmedStatus;/);
  assert.match(appJs, /if\s*\(latestDesiredStatus && latestConfirmedStatus && latestDesiredStatus !== latestConfirmedStatus\)\s*\{/);
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

  assert.doesNotMatch(appJs, /return emitRealtimeEvent\(response\.item\)\.then/);
  assert.match(
    appJs,
    /applyChecklistItemUpdate\(response\.item\);\s*emitRealtimeEvent\(response\.item\)\.then\(function \(\) \{\s*return persistChecklistSnapshot\(\);\s*\}\)\.catch\(function \(error\) \{\s*console\.error\('\[sync\] failed to process post-check side effects', error\);/
  );
});

test('GitHub Pages の連打制御は dispatch debounce で送信を集約する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /var ITEM_ACTION_DISPATCH_DEBOUNCE_MS = 120;/);
  assert.match(appJs, /if\s*\(actionState\.dispatchTimerId\)\s*\{\s*global\.clearTimeout\(actionState\.dispatchTimerId\);\s*\}/);
  assert.match(appJs, /actionState\.dispatchTimerId = global\.setTimeout\(function \(\) \{\s*actionState\.dispatchTimerId = null;\s*processItemStatusChange\(runItemId\);\s*\}, ITEM_ACTION_DISPATCH_DEBOUNCE_MS\);/);
});

test('GitHub Pages のトグル判定は最新 state から next status を決める', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /var latestItem = findChecklistItemById\(item\.id\);/);
  assert.match(appJs, /var nextStatus = latestItem\.status === 'unchecked' \? 'checked' : 'unchecked';/);
  assert.match(appJs, /requestItemStatusChange\(item\.id,\s*nextStatus\);/);
});

test('GitHub Pages のタブUIはホームと統計を切り替えられる', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');
  const css = await readFile('pages/style.css', 'utf8');

  assert.match(appJs, /function setActiveTab\(tabName\)/);
  assert.match(appJs, /elements\.mainContent\.hidden = isStatsTab;/);
  assert.match(appJs, /elements\.statsContent\.hidden = !isStatsTab;/);
  assert.match(appJs, /elements\.tabHome\.addEventListener\('click'/);
  assert.match(appJs, /elements\.tabStats\.addEventListener\('click'/);
  assert.match(appJs, /if\s*\(isStatsTab\)\s*\{\s*updateMonthLabel\(\);\s*renderCalendar\(state\.statsYear,\s*state\.statsMonth,\s*state\.statsData \? state\.statsData\.calendar : \[\]\);\s*if\s*\(!state\.statsData\)\s*\{\s*loadStats\(\);/);
  assert.match(css, /#stats-content\s*\{\s*display:\s*none;/);
  assert.match(css, /#stats-content:not\(\[hidden\]\)\s*\{\s*display:\s*flex;/);
});
