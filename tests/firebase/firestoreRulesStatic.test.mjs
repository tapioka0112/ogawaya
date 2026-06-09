import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Firestore は Spark 前提の主系データを認証済みユーザーと管理者allowlistで保護する', async () => {
  const rules = await readFile('firebase/firestore.rules', 'utf8');

  assert.match(rules, /function isStoreAdmin\(storeId\)/);
  assert.match(rules, /exists\(adminPath\(storeId\)\)/);
  assert.match(rules, /match \/tasks\/\{taskId\}/);
  assert.match(rules, /allow create, update: if isStoreAdmin\(storeId\) && isValidTaskData\(request\.resource\.data\);/);
  assert.match(rules, /match \/runs\/\{targetDate\}/);
  assert.match(rules, /allow create: if isStoreAdmin\(storeId\) && isValidRunItemData\(targetDate, request\.resource\.data\);/);
  assert.match(rules, /allow update: if \(isStoreAdmin\(storeId\) && isValidRunItemData\(targetDate, request\.resource\.data\)\)\s+\|\| \(isSignedIn\(\) && isValidEmployeeItemUpdate\(targetDate\)\);/);
  assert.match(
    rules,
    /match \/events\/\{eventId\} \{\s+allow read: if isSignedIn\(\);/
  );
  assert.match(
    rules,
    /match \/snapshots\/\{snapshotId\} \{\s+allow read: if isSignedIn\(\) && snapshotId == 'today';/
  );
  assert.match(rules, /isValidItemDeleteEvent\(storeId, targetDate\)/);
  assert.match(rules, /!\s*data\.keys\(\)\.hasAny\(\['runId'\]\) \|\| isSafeText\(data\.runId, 80\)/);
  assert.match(
    rules,
    /allow create: if isValidChecklistEvent\(storeId, targetDate\)\s+\|\| isValidTemplateInsertEvent\(storeId, targetDate\)\s+\|\| isValidItemDeleteEvent\(storeId, targetDate\);/
  );
  assert.match(rules, /allow update, delete: if false;/);
});

test('運用ドキュメントの Firestore rules は実体と一致する', async () => {
  const actualRules = await readFile('firebase/firestore.rules', 'utf8');
  const documentedRules = await readFile('docs/operations/firestore.rules', 'utf8');

  assert.equal(documentedRules, actualRules);
});
