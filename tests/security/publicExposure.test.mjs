import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('公開運用ドキュメントは本番専用URLを含めない', async () => {
  const manual = await readFile('docs/operations/non-technical-operations.md', 'utf8');

  assert.doesNotMatch(manual, /https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+/);
  assert.doesNotMatch(manual, /https:\/\/script\.google\.com\/d\/[A-Za-z0-9_-]+\/edit/);
  assert.doesNotMatch(manual, /https:\/\/script\.google\.com\/macros\/s\/AKfycb[A-Za-z0-9_-]+\/exec/);
  assert.match(manual, /公開リポジトリにはURLを書かない/);
  assert.match(manual, /https:\/\/script\.google\.com\/macros\/s\/<DEPLOYMENT_ID>\/exec/);
  assert.match(manual, /GitHub Pagesで配信されるため、値は閲覧者から見えます/);
  assert.match(manual, /秘匿が必要な値は、Apps Script の Script Properties または社内の運用台帳で管理します/);
});

test('Apps Script の本番 scriptId は追跡対象ファイルに置かない', async () => {
  const gitignore = await readFile('.gitignore', 'utf8');
  const claspExample = await readFile('gas/.clasp.example.json', 'utf8');
  const bootstrap = await readFile('docs/operations/bootstrap.md', 'utf8');

  assert.match(gitignore, /^gas\/\.clasp\.json$/m);
  assert.match(claspExample, /YOUR_APPS_SCRIPT_PROJECT_ID/);
  assert.doesNotMatch(claspExample, /"scriptId"\s*:\s*"[A-Za-z0-9_-]{40,}"/);
  assert.match(bootstrap, /gas\/\.clasp\.json/);
  assert.match(bootstrap, /公開リポジトリへ commit しません/);
});
