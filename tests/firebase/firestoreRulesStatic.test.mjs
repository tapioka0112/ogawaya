import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Firestore events は認証済み read のみ許可し、snapshot は公開 read を維持する', async () => {
  const rules = await readFile('firebase/firestore.rules', 'utf8');

  assert.match(
    rules,
    /match \/stores\/\{storeId\}\/runs\/\{targetDate\}\/events\/\{eventId\} \{\s+allow read: if isSignedIn\(\);/
  );
  assert.match(
    rules,
    /match \/stores\/\{storeId\}\/runs\/\{targetDate\}\/snapshots\/\{snapshotId\} \{\s+allow read: if snapshotId == 'today';/
  );
  assert.match(rules, /allow create: if isValidChecklistEvent\(storeId, targetDate\) \|\| isValidTemplateInsertEvent\(storeId, targetDate\);/);
  assert.match(rules, /allow update, delete: if false;/);
});

test('運用ドキュメントの Firestore rules は実体と一致する', async () => {
  const actualRules = await readFile('firebase/firestore.rules', 'utf8');
  const documentedRules = await readFile('docs/operations/firestore.rules', 'utf8');

  assert.equal(documentedRules, actualRules);
});
