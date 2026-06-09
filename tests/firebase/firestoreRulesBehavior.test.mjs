import test, { after, before, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

const STORE_ID = 'store-rules-behavior-test';
const ADMIN_UID = 'admin-rules-test';
const EMPLOYEE_UID = 'employee-rules-test';
const TARGET_DATE = '2026-06-09';

function buildRunItem(overrides = {}) {
  return {
    id: 'item-001',
    templateItemId: 'template-item-001',
    title: 'Rules 動作確認タスク',
    description: 'Firestore Rules の targetDate 許可確認',
    period: 'daily',
    sortOrder: 1,
    status: 'unchecked',
    checkedBy: '',
    checkedByUserId: '',
    checkedAt: '',
    updatedAt: '2026-06-09T00:00:00.000Z',
    isActive: true,
    ...overrides
  };
}

function buildCheckedPatch() {
  return {
    status: 'checked',
    checkedBy: '従業員',
    checkedByUserId: EMPLOYEE_UID,
    checkedAt: '2026-06-09T13:30:00.000Z',
    updatedAt: serverTimestamp()
  };
}

function buildChecklistEvent(overrides = {}) {
  return {
    runId: TARGET_DATE,
    targetDate: TARGET_DATE,
    storeId: STORE_ID,
    itemId: 'item-001',
    status: 'checked',
    checkedBy: '従業員',
    checkedByUserId: EMPLOYEE_UID,
    checkedAt: '2026-06-09T13:30:00.000Z',
    updatedAt: serverTimestamp(),
    sourceUserId: EMPLOYEE_UID,
    sourceClientId: 'client-rules-test',
    emittedAt: serverTimestamp(),
    ...overrides
  };
}

function itemDoc(db, itemId) {
  return doc(db, 'stores', STORE_ID, 'runs', TARGET_DATE, 'items', itemId);
}

function eventsCollection(db) {
  return collection(db, 'stores', STORE_ID, 'runs', TARGET_DATE, 'events');
}

async function seedAdmin(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'stores', STORE_ID), {
      id: STORE_ID,
      name: 'Rules 動作確認店舗',
      isActive: true
    });
    await setDoc(doc(db, 'stores', STORE_ID, 'admins', ADMIN_UID), {
      uid: ADMIN_UID
    });
  });
}

async function seedItem(testEnv, itemId, itemData) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(itemDoc(context.firestore(), itemId), itemData);
  });
}

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('Firestore Rules の allow/deny 動作確認', { skip: 'FIRESTORE_EMULATOR_HOST が必要です。npm run test:firestore-rules で実行してください。' }, () => {});
} else {
  let testEnv;

  before(async () => {
    const rules = await readFile('firebase/firestore.rules', 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: 'ogawaya-rules-behavior-test',
      firestore: { rules }
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedAdmin(testEnv);
  });

  after(async () => {
    await testEnv.cleanup();
  });

  test('従業員は targetDate 付き run item をチェック更新できる', async () => {
    await seedItem(testEnv, 'item-with-target-date', buildRunItem({
      id: 'item-with-target-date',
      targetDate: TARGET_DATE
    }));
    const db = testEnv.authenticatedContext(EMPLOYEE_UID).firestore();

    await assertSucceeds(updateDoc(itemDoc(db, 'item-with-target-date'), buildCheckedPatch()));
  });

  test('従業員は targetDate なしの既存 run item を引き続きチェック更新できる', async () => {
    await seedItem(testEnv, 'item-without-target-date', buildRunItem({
      id: 'item-without-target-date'
    }));
    const db = testEnv.authenticatedContext(EMPLOYEE_UID).firestore();

    await assertSucceeds(updateDoc(itemDoc(db, 'item-without-target-date'), buildCheckedPatch()));
  });

  test('従業員は path と targetDate が不一致の run item をチェック更新できない', async () => {
    await seedItem(testEnv, 'item-mismatched-target-date', buildRunItem({
      id: 'item-mismatched-target-date',
      targetDate: '2026-06-08'
    }));
    const db = testEnv.authenticatedContext(EMPLOYEE_UID).firestore();

    await assertFails(updateDoc(itemDoc(db, 'item-mismatched-target-date'), buildCheckedPatch()));
  });

  test('管理者は targetDate 付き run item と targetDate なし run item を作成できる', async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();

    await assertSucceeds(setDoc(itemDoc(db, 'admin-item-with-target-date'), buildRunItem({
      id: 'admin-item-with-target-date',
      targetDate: TARGET_DATE
    })));
    await assertSucceeds(setDoc(itemDoc(db, 'admin-item-without-target-date'), buildRunItem({
      id: 'admin-item-without-target-date'
    })));
  });

  test('管理者は path と targetDate が不一致の run item を作成できない', async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();

    await assertFails(setDoc(itemDoc(db, 'admin-item-mismatched-target-date'), buildRunItem({
      id: 'admin-item-mismatched-target-date',
      targetDate: '2026-06-08'
    })));
  });

  test('従業員は他端末同期用 event を作成できる', async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_UID).firestore();

    await assertSucceeds(addDoc(eventsCollection(db), buildChecklistEvent()));
  });

  test('従業員は sourceUserId が auth uid と不一致の event を作成できない', async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_UID).firestore();

    await assertFails(addDoc(eventsCollection(db), buildChecklistEvent({
      sourceUserId: 'other-user'
    })));
  });

  test('従業員は path と targetDate が不一致の event を作成できない', async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_UID).firestore();

    await assertFails(addDoc(eventsCollection(db), buildChecklistEvent({
      targetDate: '2026-06-08'
    })));
  });
}
