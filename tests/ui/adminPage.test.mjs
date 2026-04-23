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
  assert.match(html, /id="admin-date-input"/);
  assert.match(html, /id="admin-run-items"/);
  assert.match(html, /id="calendar-grid"/);
  assert.match(html, /<script src="\.\/admin\.js"><\/script>/);
});

test('管理者ページの GAS API 呼び出しは CORS preflight を避ける', async () => {
  const js = await readFile('pages/admin.js', 'utf8');

  assert.doesNotMatch(js, /Content-Type['"]?\s*:\s*['"]application\/json/);
  assert.match(js, /var transportMethod = method === 'GET' \? 'GET' : 'POST';/);
  assert.match(js, /query\._method = method;/);
});
