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
  assert.doesNotMatch(css, /pointer-events\s*:\s*none/);
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
  assert.match(appJs, /if\s*\(emittedAtMs <= actionState\.lastSyncedAtMs\)\s*\{\s*return;\s*\}\s*actionState\.lastSyncedAtMs = emittedAtMs;/);
});

test('GitHub Pages の API再取得マージは未確定 desiredStatus を維持する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(
    appJs,
    /if\s*\(\s*actionState\.confirmedItem &&\s*actionState\.desiredStatus &&\s*actionState\.desiredStatus !== actionState\.confirmedItem\.status\s*\)\s*\{\s*return cloneChecklistItem\(localItem\);\s*\}/
  );
});
