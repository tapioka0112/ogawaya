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
