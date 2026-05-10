import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Firestore events は Functions 内で primary store へ反映される', async () => {
  const source = await readFile('firebase/functions/index.js', 'utf8');

  assert.match(source, /onDocumentCreated/);
  assert.match(source, /stores\/\{storeId\}\/runs\/\{targetDate\}\/events\/\{eventId\}/);
  assert.match(source, /applyFirestoreEventToPrimaryStore/);
  assert.match(source, /function applyTemplateInsertEvent/);
  assert.match(source, /function applyItemDeleteEvent/);
  assert.match(source, /normalizeTaskPeriod\(activeTaskMap\.get\(taskId\)\.period\) === period/);
  assert.doesNotMatch(source, /GAS_API_BASE_URL/);
  assert.doesNotMatch(source, /\/api\/internal\/firestore-events:apply/);
});
