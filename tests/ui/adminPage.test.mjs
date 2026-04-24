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
  assert.match(html, /id="create-task-button"/);
  assert.match(html, /id="task-select"/);
  assert.match(html, /id="insert-task-button"/);
  assert.match(html, /id="template-name-input"/);
  assert.match(html, /id="create-template-button"/);
  assert.match(html, /id="template-select"/);
  assert.match(html, /id="apply-template-button"/);
  assert.match(html, />テンプレートを挿入<\/button>/);
  assert.match(html, />挿入するテンプレート<\/span>/);
  assert.doesNotMatch(html, /テンプレートを読み込む/);
  assert.match(html, /id="admin-date-input"/);
  assert.match(html, /id="admin-run-items"/);
  assert.match(html, /id="calendar-grid"/);
  assert.match(html, /<script src="\.\/admin\.js\?v=[^"]+"><\/script>/);
});

test('管理者ページの GAS API 呼び出しは CORS preflight を避ける', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.doesNotMatch(js, /Content-Type['"]?\s*:\s*['"]application\/json/);
  assert.match(js, /method: 'GET'/);
  assert.match(js, /query\._payload = JSON\.stringify\(body\);/);
  assert.match(js, /query\._method = method;/);
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

test('管理者ページの日付別タスク取得は古い応答を破棄し読み込み中に前日タスクを残さない', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.match(js, /runItemsRequestId:\s*0/);
  assert.match(js, /runItemsLoading:\s*false/);
  assert.match(js, /state\.runItemsRequestId \+= 1;/);
  assert.match(js, /var requestId = state\.runItemsRequestId;/);
  assert.match(js, /state\.runItemsLoading = true;\s*state\.checklist = null;\s*renderRunItems\(\);/);
  assert.match(js, /if\s*\(requestId !== state\.runItemsRequestId \|\| targetDate !== state\.selectedDate\)\s*\{\s*return;\s*\}/);
  assert.match(js, /catch \(error\)\s*\{\s*if\s*\(requestId !== state\.runItemsRequestId \|\| targetDate !== state\.selectedDate\)\s*\{\s*return;\s*\}\s*throw error;\s*\}/);
  assert.match(js, /state\.runItemsLoading = false;\s*renderRunItems\(\);/);
  assert.match(js, /タスクを読み込み中です。/);
});
