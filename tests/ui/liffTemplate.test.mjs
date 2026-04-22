import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readTemplate(relativePath) {
  return readFile(relativePath, 'utf8');
}

test('従業員画面テンプレートは JS 埋め込みを JSON 文字列で安全化する', async () => {
  const html = await readTemplate('gas/src/liff/user/index.html');

  assert.match(
    html,
    /window\.OGAWAYA_APP_BASE_URL = <\?!= JSON\.stringify\(String\(appBaseUrl\)\)\.replace\(\/</
  );
  assert.match(
    html,
    /window\.OGAWAYA_LIFF_ID = <\?!= JSON\.stringify\(String\(liffId\)\)\.replace\(\/</
  );
  assert.match(
    html,
    /window\.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = <\?!= JSON\.stringify\(Boolean\(allowAnonymousAccess\)\)\.replace\(\/</
  );
  assert.match(
    html,
    /window\.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = true;/
  );
});

test('管理者画面テンプレートは JS 埋め込みを JSON 文字列で安全化する', async () => {
  const html = await readTemplate('gas/src/liff/admin/index.html');

  assert.match(
    html,
    /window\.OGAWAYA_APP_BASE_URL = <\?!= JSON\.stringify\(String\(appBaseUrl\)\)\.replace\(\/</
  );
  assert.match(
    html,
    /window\.OGAWAYA_LIFF_ID = <\?!= JSON\.stringify\(String\(liffId\)\)\.replace\(\/</
  );
  assert.match(
    html,
    /window\.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = <\?!= JSON\.stringify\(Boolean\(allowAnonymousAccess\)\)\.replace\(\/</
  );
  assert.match(
    html,
    /window\.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = true;/
  );
});

test('user/admin 画面のエラー表示はスクリーンリーダー向け属性を持つ', async () => {
  const userHtml = await readTemplate('gas/src/liff/user/index.html');
  const adminHtml = await readTemplate('gas/src/liff/admin/index.html');

  assert.match(
    userHtml,
    /<div class="error-box" id="error-message" data-visible="false" role="alert" aria-atomic="true"><\/div>/
  );
  assert.match(
    adminHtml,
    /<div class="error-box" id="error-message" data-visible="false" role="alert" aria-atomic="true"><\/div>/
  );
});

test('共通スタイルは iOS WebView 向けの mask/backdrop プレフィックスを併記する', async () => {
  const css = await readTemplate('gas/src/liff/shared/style.html');

  assert.match(css, /-webkit-mask-image:\s*linear-gradient/);
  assert.match(css, /-webkit-backdrop-filter:\s*blur\(18px\)/);
});
