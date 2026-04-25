import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Firestore events は GAS 内部同期 API へサーバー側で同期される', async () => {
  const source = await readFile('firebase/functions/index.js', 'utf8');

  assert.match(source, /onDocumentCreated/);
  assert.match(source, /stores\/\{storeId\}\/runs\/\{targetDate\}\/events\/\{eventId\}/);
  assert.match(source, /syncFirestoreEventToGas/);
  assert.match(source, /GAS_API_BASE_URL/);
  assert.match(source, /FIRESTORE_EVENT_SYNC_SECRET/);
  assert.match(source, /\/api\/internal\/firestore-events:apply/);
});
