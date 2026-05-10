import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CSV移行は既存importファイル名と本番storeへの写像に対応する', async () => {
  const script = await readFile('scripts/migrate-csv-to-firestore.mjs', 'utf8');
  const admin = await readFile('scripts/firebaseAdmin.mjs', 'utf8');
  const docs = await readFile('docs/operations/firebase-spark-primary.md', 'utf8');

  assert.match(script, /readFirstExistingCsvObjectList\(\['templates',\s*'checklist_templates'\]\)/);
  assert.match(script, /readFirstExistingCsvObjectList\(\['template_items',\s*'checklist_template_items'\]\)/);
  assert.match(script, /SOURCE_STORE_ID/);
  assert.match(script, /sourceStoreId/);
  assert.match(script, /item\.templateId \|\| item\.template_id/);
  assert.match(script, /title:\s*item\.title \|\| ''/);
  assert.match(script, /sortOrder:\s*Number\(item\.sortOrder \|\| item\.sort_order \|\| 0\)/);
  assert.match(admin, /FIREBASE_SERVICE_ACCOUNT_JSON または GOOGLE_APPLICATION_CREDENTIALS が未設定です/);
  assert.match(admin, /admin\.credential\.applicationDefault\(\)/);
  assert.match(docs, /SOURCE_STORE_ID=store-001/);
  assert.match(docs, /GOOGLE_APPLICATION_CREDENTIALS/);
});
