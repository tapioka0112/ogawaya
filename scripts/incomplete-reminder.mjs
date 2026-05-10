import { getPreviousDateInJst, listRunItems, requireStoreId } from './firestoreTasks.mjs';
import { getFirestore } from './firebaseAdmin.mjs';

const storeId = requireStoreId();
const targetDate = String(process.env.TARGET_DATE || getPreviousDateInJst()).trim();
const lineToken = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();

if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  throw new Error(`TARGET_DATE の形式が不正です: ${targetDate}`);
}
if (!lineToken) {
  throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
}

const items = await listRunItems(storeId, targetDate);
const uncheckedItems = items.filter((item) => item.status !== 'checked');

if (uncheckedItems.length === 0) {
  console.log(JSON.stringify({ ok: true, storeId, targetDate, sentCount: 0, uncheckedCount: 0 }));
  process.exit(0);
}

const db = getFirestore();
const usersSnapshot = await db.collection('stores').doc(storeId).collection('users').get();
const lineUserIds = usersSnapshot.docs
  .map((doc) => String((doc.data() || {}).liffUserId || '').trim())
  .filter((lineUserId) => lineUserId);

const messageText = [
  `${targetDate} の未完了タスクが ${uncheckedItems.length} 件あります。`,
  ...uncheckedItems.slice(0, 10).map((item) => `・${String(item.title || '')}`)
].join('\n');

let sentCount = 0;
for (const to of lineUserIds) {
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${lineToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: messageText }]
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE push に失敗しました: status=${response.status} body=${body}`);
  }
  sentCount += 1;
}

console.log(JSON.stringify({
  ok: true,
  storeId,
  targetDate,
  sentCount,
  uncheckedCount: uncheckedItems.length
}));
