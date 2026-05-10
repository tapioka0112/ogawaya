import { admin, getFirestore } from './firebaseAdmin.mjs';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function requireStoreId() {
  const storeId = String(process.env.STORE_ID || '').trim();
  if (!storeId) {
    throw new Error('STORE_ID が未設定です');
  }
  return storeId;
}

export function formatDateInJst(date) {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

export function getTodayInJst() {
  return formatDateInJst(new Date());
}

export function getPreviousDateInJst() {
  return formatDateInJst(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

export function normalizePeriod(value) {
  const period = String(value || '').trim();
  if (period === 'daily' || period === 'weekly' || period === 'monthly') {
    return period;
  }
  throw new Error(`period の形式が不正です: ${period}`);
}

export function shouldCreateTaskForDate(task, targetDate) {
  const period = normalizePeriod(task.period || 'daily');
  if (period === 'daily') {
    return true;
  }
  const date = new Date(`${targetDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`targetDate の形式が不正です: ${targetDate}`);
  }
  if (period === 'weekly') {
    return date.getUTCDay() === 0;
  }
  return targetDate.endsWith('-01');
}

export function toPlainDoc(doc) {
  return { id: doc.id, ...doc.data() };
}

export async function listActiveTasks(storeId) {
  const db = getFirestore();
  const snapshot = await db.collection('stores').doc(storeId).collection('tasks').get();
  return snapshot.docs
    .map(toPlainDoc)
    .filter((task) => task.isActive !== false)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
}

export async function ensureRun(storeId, targetDate) {
  const db = getFirestore();
  const runRef = db.collection('stores').doc(storeId).collection('runs').doc(targetDate);
  const runDoc = await runRef.get();
  const basePayload = {
    id: targetDate,
    storeId,
    targetDate,
    status: 'open',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (runDoc.exists) {
    await runRef.set(basePayload, { merge: true });
    return runRef;
  }
  await runRef.set({
    ...basePayload,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return runRef;
}

export async function listRunItems(storeId, targetDate) {
  const db = getFirestore();
  const snapshot = await db
    .collection('stores')
    .doc(storeId)
    .collection('runs')
    .doc(targetDate)
    .collection('items')
    .get();
  return snapshot.docs.map(toPlainDoc).filter((item) => item.isActive !== false);
}

export function buildRunItemFromTask(task, targetDate, sortOrder) {
  const now = new Date().toISOString();
  return {
    id: `${targetDate}-${task.id}`,
    templateItemId: '',
    title: String(task.title || ''),
    description: String(task.description || ''),
    period: normalizePeriod(task.period || 'daily'),
    sortOrder: Number(sortOrder || task.sortOrder || 0),
    status: 'unchecked',
    checkedBy: '',
    checkedByUserId: '',
    checkedAt: '',
    updatedAt: now,
    isActive: true
  };
}

export async function writeRunItem(storeId, targetDate, item) {
  const db = getFirestore();
  await db
    .collection('stores')
    .doc(storeId)
    .collection('runs')
    .doc(targetDate)
    .collection('items')
    .doc(item.id)
    .set(item, { merge: true });
}
