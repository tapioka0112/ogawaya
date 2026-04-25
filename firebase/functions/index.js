const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('node:crypto');

initializeApp();
const db = getFirestore();
const firestoreEventSyncSecret = defineSecret('FIRESTORE_EVENT_SYNC_SECRET');

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const BUSINESS_DAY_CUTOFF_HOUR = 10;
const BUSINESS_DAY_CUTOFF_MINUTE = 30;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LINE_ID_TOKEN_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const ID_TOKEN_VERIFY_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const idTokenVerifyCache = new Map();

const ITEM_STATUS = {
  CHECKED: 'checked',
  UNCHECKED: 'unchecked'
};

const TASK_PERIODS = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly'
};

const TASK_PERIOD_VALUES = new Set(Object.values(TASK_PERIODS));

const RUN_STATUS = {
  OPEN: 'open',
  CLOSED: 'closed'
};

const COLLECTIONS = {
  STORES: 'stores',
  TASK_CATALOG: 'task_catalog',
  TEMPLATES: 'templates',
  TEMPLATE_ITEMS: 'items',
  DAILY_RUNS: 'daily_runs',
  DAILY_RUN_ITEMS: 'items',
  SNAPSHOT_RUNS: 'runs',
  SNAPSHOTS: 'snapshots',
  EVENTS: 'events',
  ADMIN_CREDENTIALS: 'admin_credentials',
  ADMIN_SESSIONS: 'admin_sessions'
};

const SNAPSHOT_DOC_ID = 'today';
const FIRESTORE_EVENT_DOCUMENT_PATH = 'stores/{storeId}/runs/{targetDate}/events/{eventId}';
const GAS_FIRESTORE_EVENT_SYNC_PATH = '/api/internal/firestore-events:apply';

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = Number(statusCode) || 500;
    this.code = String(code || 'internal_error');
  }
}

function fail(statusCode, code, message) {
  throw new HttpError(statusCode, code, message);
}

function assert(condition, statusCode, code, message) {
  if (!condition) {
    fail(statusCode, code, message);
  }
}

function normalizeTaskPeriod(value) {
  const period = String(value || '').trim();
  if (!period) {
    return TASK_PERIODS.DAILY;
  }
  assert(TASK_PERIOD_VALUES.has(period), 400, 'invalid_request', 'period が不正です');
  return period;
}

function sendOk(res, statusCode, payload) {
  const safeStatusCode = Number(statusCode) || 200;
  const body = Object.assign({}, payload || {}, {
    ok: true,
    statusCode: safeStatusCode
  });
  res.status(safeStatusCode).json(body);
}

function sendError(res, error) {
  const statusCode = Number(error && error.statusCode) || 500;
  const code = String(error && error.code ? error.code : 'internal_error');
  const message = String(error && error.message ? error.message : 'internal_error');
  if (statusCode >= 500) {
    console.error('[api] unexpected error', {
      code,
      statusCode,
      message
    });
  }
  res.status(statusCode).json({
    ok: false,
    statusCode,
    code,
    message
  });
}

function normalizePath(value) {
  const raw = String(value || '');
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function normalizeDateString(input) {
  const value = String(input || '');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), 400, 'invalid_request', 'date は YYYY-MM-DD 形式で指定してください');
  return value;
}

function normalizeStoreId(input) {
  const value = String(input || '').trim();
  assert(value !== '', 400, 'invalid_request', 'storeId は必須です');
  assert(/^[A-Za-z0-9_-]{1,64}$/.test(value), 400, 'invalid_request', 'storeId の形式が不正です');
  return value;
}

function normalizeString(input, fieldName) {
  const value = String(input || '').trim();
  assert(value !== '', 400, 'invalid_request', `${fieldName} は必須です`);
  return value;
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

function readLineChannelId() {
  const channelId = String(process.env.LINE_CHANNEL_ID || '').trim();
  assert(channelId !== '', 500, 'config_error', 'LINE_CHANNEL_ID が未設定です');
  return channelId;
}

function readRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  assert(value !== '', 500, 'config_error', `${name} が未設定です`);
  return value;
}

function buildGasFirestoreEventSyncUrl() {
  const url = new URL(readRequiredEnv('GAS_API_BASE_URL'));
  url.searchParams.set('path', GAS_FIRESTORE_EVENT_SYNC_PATH);
  return url.toString();
}

function readFirestoreEventSyncSecret() {
  const value = String(firestoreEventSyncSecret.value() || process.env.FIRESTORE_EVENT_SYNC_SECRET || '').trim();
  assert(value !== '', 500, 'config_error', 'FIRESTORE_EVENT_SYNC_SECRET が未設定です');
  return value;
}

function readCachedVerifiedIdentity(cacheKey) {
  const cached = idTokenVerifyCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (Number(cached.expiresAtMs || 0) <= Date.now()) {
    idTokenVerifyCache.delete(cacheKey);
    return null;
  }
  return {
    userId: String(cached.userId || ''),
    userName: String(cached.userName || '')
  };
}

function writeVerifiedIdentityCache(cacheKey, userId, userName, expSeconds) {
  const nowMs = Date.now();
  const tokenExpiryMs = Number(expSeconds || 0) * 1000;
  const maxExpiryMs = nowMs + ID_TOKEN_VERIFY_CACHE_MAX_AGE_MS;
  const expiresAtMs = tokenExpiryMs > nowMs ? Math.min(tokenExpiryMs - 30000, maxExpiryMs) : maxExpiryMs;
  if (expiresAtMs <= nowMs) {
    return;
  }
  idTokenVerifyCache.set(
    cacheKey,
    {
      userId: String(userId || ''),
      userName: String(userName || ''),
      expiresAtMs
    }
  );
}

function toJstDate(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now());
  return new Date(date.getTime() + JST_OFFSET_MS);
}

function formatJstDate(jstDate) {
  const year = jstDate.getUTCFullYear();
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jstDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveBusinessDate(nowValue) {
  const jstDate = toJstDate(nowValue);
  const hour = jstDate.getUTCHours();
  const minute = jstDate.getUTCMinutes();
  if (hour > BUSINESS_DAY_CUTOFF_HOUR || (hour === BUSINESS_DAY_CUTOFF_HOUR && minute >= BUSINESS_DAY_CUTOFF_MINUTE)) {
    return formatJstDate(jstDate);
  }
  const previous = new Date(jstDate.getTime() - (24 * 60 * 60 * 1000));
  return formatJstDate(previous);
}

function parseTimestampMillis(value) {
  if (!value) {
    return 0;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value.toMillis === 'function') {
    return Number(value.toMillis()) || 0;
  }
  if (typeof value.seconds === 'number') {
    return Number(value.seconds) * 1000;
  }
  return 0;
}

function toIsoString(value) {
  if (!value) {
    return '';
  }
  const ms = parseTimestampMillis(value);
  if (!ms) {
    return '';
  }
  return new Date(ms).toISOString();
}

function getStoreCollection() {
  return db.collection(COLLECTIONS.STORES);
}

function getStoreRef(storeId) {
  return getStoreCollection().doc(storeId);
}

function getTaskCatalogCollection(storeId) {
  return getStoreRef(storeId).collection(COLLECTIONS.TASK_CATALOG);
}

function getTemplatesCollection(storeId) {
  return getStoreRef(storeId).collection(COLLECTIONS.TEMPLATES);
}

function getTemplateItemsCollection(storeId, templateId) {
  return getTemplatesCollection(storeId).doc(templateId).collection(COLLECTIONS.TEMPLATE_ITEMS);
}

function getDailyRunsCollection(storeId) {
  return getStoreRef(storeId).collection(COLLECTIONS.DAILY_RUNS);
}

function getDailyRunRef(storeId, businessDate) {
  return getDailyRunsCollection(storeId).doc(businessDate);
}

function getDailyRunItemsCollection(storeId, businessDate) {
  return getDailyRunRef(storeId, businessDate).collection(COLLECTIONS.DAILY_RUN_ITEMS);
}

function getSnapshotDocRef(storeId, businessDate) {
  return getStoreRef(storeId)
    .collection(COLLECTIONS.SNAPSHOT_RUNS)
    .doc(businessDate)
    .collection(COLLECTIONS.SNAPSHOTS)
    .doc(SNAPSHOT_DOC_ID);
}

function getEventsCollection(storeId, businessDate) {
  return getStoreRef(storeId)
    .collection(COLLECTIONS.SNAPSHOT_RUNS)
    .doc(businessDate)
    .collection(COLLECTIONS.EVENTS);
}

function normalizeTask(docSnapshot) {
  const data = docSnapshot.data() || {};
  return {
    id: docSnapshot.id,
    title: String(data.title || ''),
    description: String(data.description || ''),
    period: normalizeTaskPeriod(data.period),
    isActive: data.isActive !== false,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt)
  };
}

function normalizeRunItem(docSnapshot) {
  const data = docSnapshot.data() || {};
  return {
    id: String(data.id || docSnapshot.id),
    taskId: String(data.taskId || ''),
    title: String(data.title || ''),
    description: String(data.description || ''),
    period: normalizeTaskPeriod(data.period),
    sortOrder: Number(data.sortOrder || 0),
    status: data.status === ITEM_STATUS.CHECKED ? ITEM_STATUS.CHECKED : ITEM_STATUS.UNCHECKED,
    checkedBy: data.checkedByName ? String(data.checkedByName) : null,
    checkedByUserId: data.checkedByUserId ? String(data.checkedByUserId) : null,
    checkedAt: data.checkedAt ? String(data.checkedAt) : null,
    updatedAt: data.updatedAt ? String(data.updatedAt) : null,
    isActive: data.isActive !== false
  };
}

function normalizeCurrentUserContext(userId, userName, storeId, storeName) {
  return {
    userId: String(userId || ''),
    name: String(userName || ''),
    role: '',
    store: {
      id: String(storeId || ''),
      name: String(storeName || '')
    }
  };
}

async function verifyLineIdToken(idToken) {
  const normalizedIdToken = String(idToken || '').trim();
  assert(normalizedIdToken !== '', 401, 'unauthorized', 'LIFF 認証コンテキストがありません');
  const cacheKey = sha256Hex(normalizedIdToken);
  const cached = readCachedVerifiedIdentity(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await fetch(
    LINE_ID_TOKEN_VERIFY_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(
        {
          id_token: normalizedIdToken,
          client_id: readLineChannelId()
        }
      ).toString()
    }
  );
  assert(response.status === 200, 401, 'unauthorized', 'LIFF 認証コンテキストがありません');

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    fail(401, 'unauthorized', 'LIFF 認証コンテキストがありません');
  }
  const userId = String(payload && payload.sub ? payload.sub : '').trim();
  const userName = String(payload && payload.name ? payload.name : 'LINEユーザー').trim() || 'LINEユーザー';
  assert(userId !== '', 401, 'unauthorized', 'LIFF 認証コンテキストがありません');
  writeVerifiedIdentityCache(cacheKey, userId, userName, payload && payload.exp ? Number(payload.exp) : 0);
  return {
    userId,
    userName
  };
}

async function resolveUserIdentity(req, body) {
  const idTokenFromQuery = req.query && req.query.idToken ? String(req.query.idToken) : '';
  const idTokenFromBody = body && body.idToken ? String(body.idToken) : '';
  const idToken = idTokenFromQuery || idTokenFromBody;
  return verifyLineIdToken(idToken);
}

function resolveStoreId(req, body) {
  const queryStoreId = req.query && req.query.storeId ? String(req.query.storeId) : '';
  const bodyStoreId = body && body.storeId ? String(body.storeId) : '';
  const envStoreId = process.env.DEFAULT_STORE_ID ? String(process.env.DEFAULT_STORE_ID) : '';
  return normalizeStoreId(queryStoreId || bodyStoreId || envStoreId);
}

async function readStoreName(storeId) {
  const storeSnap = await getStoreRef(storeId).get();
  if (!storeSnap.exists) {
    return storeId;
  }
  const data = storeSnap.data() || {};
  const name = String(data.name || '').trim();
  return name || storeId;
}

async function listActiveTasks(storeId) {
  const snapshot = await getTaskCatalogCollection(storeId).get();
  return snapshot.docs
    .map(normalizeTask)
    .filter((task) => task.isActive && task.title)
    .sort((left, right) => left.title.localeCompare(right.title, 'ja'));
}

async function getTaskById(storeId, taskId) {
  const doc = await getTaskCatalogCollection(storeId).doc(taskId).get();
  assert(doc.exists, 404, 'not_found', 'タスクが見つかりません');
  const task = normalizeTask(doc);
  assert(task.isActive, 404, 'not_found', 'タスクが見つかりません');
  return task;
}

async function ensureDailyRun(storeId, businessDate) {
  const runRef = getDailyRunRef(storeId, businessDate);
  const runSnap = await runRef.get();
  if (runSnap.exists) {
    return runSnap.data() || {};
  }
  await runRef.set(
    {
      id: businessDate,
      businessDate,
      status: RUN_STATUS.OPEN,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  const created = await runRef.get();
  return created.data() || {};
}

async function listActiveRunItems(storeId, businessDate) {
  const snapshot = await getDailyRunItemsCollection(storeId, businessDate).get();
  return snapshot.docs
    .map((doc) => ({ doc, item: normalizeRunItem(doc) }))
    .filter(({ item }) => item.isActive)
    .sort((left, right) => {
      if (left.item.sortOrder !== right.item.sortOrder) {
        return left.item.sortOrder - right.item.sortOrder;
      }
      return left.item.title.localeCompare(right.item.title, 'ja');
    });
}

function buildChecklistResponse(storeId, storeName, businessDate, runData, currentUser, items) {
  const checkedCount = items.filter((item) => item.status === ITEM_STATUS.CHECKED).length;
  return {
    runId: String((runData && runData.id) || businessDate),
    templateId: String((runData && runData.templateId) || ''),
    storeName,
    targetDate: businessDate,
    status: String((runData && runData.status) || RUN_STATUS.OPEN),
    currentUser: normalizeCurrentUserContext(currentUser.userId, currentUser.userName, storeId, storeName),
    progress: {
      total: items.length,
      checked: checkedCount
    },
    items: items.map((item) => {
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        checkedBy: item.checkedBy,
        checkedByUserId: item.checkedByUserId,
        checkedAt: item.checkedAt,
        updatedAt: item.updatedAt
      };
    })
  };
}

async function writeSnapshotForRun(storeId, businessDate, currentUser) {
  const storeName = await readStoreName(storeId);
  const runSnap = await getDailyRunRef(storeId, businessDate).get();
  const runData = runSnap.exists ? runSnap.data() || {} : {};
  const runItems = await listActiveRunItems(storeId, businessDate);
  const checklistResponse = buildChecklistResponse(
    storeId,
    storeName,
    businessDate,
    runData,
    currentUser,
    runItems.map((entry) => entry.item)
  );
  await getSnapshotDocRef(storeId, businessDate).set(
    Object.assign({}, checklistResponse, {
      updatedAt: FieldValue.serverTimestamp()
    }),
    { merge: true }
  );
  return checklistResponse;
}

async function ensureSnapshotExists(storeId, businessDate, currentUser) {
  const snapshotRef = getSnapshotDocRef(storeId, businessDate);
  const snapshot = await snapshotRef.get();
  if (snapshot.exists) {
    return;
  }
  await writeSnapshotForRun(storeId, businessDate, currentUser);
}

async function findRunItemById(runItemId) {
  const safeRunItemId = normalizeString(runItemId, 'runItemId');
  const snapshot = await db.collectionGroup(COLLECTIONS.DAILY_RUN_ITEMS).where('id', '==', safeRunItemId).limit(10).get();
  for (const doc of snapshot.docs) {
    const runRef = doc.ref.parent.parent;
    const runsCollectionRef = runRef && runRef.parent;
    if (!runRef || !runsCollectionRef || runsCollectionRef.id !== COLLECTIONS.DAILY_RUNS) {
      continue;
    }
    const storeRef = runsCollectionRef.parent;
    if (!storeRef) {
      continue;
    }
    return {
      doc,
      item: normalizeRunItem(doc),
      storeId: storeRef.id,
      businessDate: runRef.id
    };
  }
  fail(404, 'not_found', 'チェック項目が見つかりません');
}

async function appendRunEvent(storeId, businessDate, payload) {
  await getEventsCollection(storeId, businessDate).add(
    Object.assign({}, payload, {
      emittedAt: FieldValue.serverTimestamp()
    })
  );
}

function extractBearerToken(req) {
  const rawHeader = req.headers && req.headers.authorization ? String(req.headers.authorization) : '';
  const match = rawHeader.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
}

async function createAdminSession(loginId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(token);
  const expiresAtMs = Date.now() + ADMIN_SESSION_TTL_MS;
  await db.collection(COLLECTIONS.ADMIN_SESSIONS).doc(tokenHash).set(
    {
      loginId: String(loginId || ''),
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAtMs)
    },
    { merge: true }
  );
  return {
    token,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

async function verifyAdminLogin(loginId, password) {
  const credentialSnap = await db.collection(COLLECTIONS.ADMIN_CREDENTIALS).doc('default').get();
  assert(credentialSnap.exists, 500, 'config_error', 'admin_credentials/default が未設定です');
  const credential = credentialSnap.data() || {};
  assert(credential.isActive !== false, 403, 'forbidden', '管理者アカウントが無効です');
  const expectedLoginId = String(credential.loginId || '').trim();
  const expectedHash = String(credential.passwordHashSha256 || '').trim();
  assert(expectedLoginId !== '' && expectedHash !== '', 500, 'config_error', '管理者認証情報が不正です');
  assert(loginId === expectedLoginId, 401, 'unauthorized', 'ログインIDまたはパスワードが不正です');
  assert(sha256Hex(password) === expectedHash, 401, 'unauthorized', 'ログインIDまたはパスワードが不正です');
}

async function requireAdminSession(req) {
  const token = extractBearerToken(req);
  assert(token, 401, 'unauthorized', '管理者ログインが必要です');
  const tokenHash = sha256Hex(token);
  const sessionSnap = await db.collection(COLLECTIONS.ADMIN_SESSIONS).doc(tokenHash).get();
  assert(sessionSnap.exists, 401, 'unauthorized', 'セッションが見つかりません');
  const session = sessionSnap.data() || {};
  assert(session.isActive !== false, 401, 'unauthorized', 'セッションが無効です');
  const expiresAtMs = parseTimestampMillis(session.expiresAt);
  assert(expiresAtMs > Date.now(), 401, 'unauthorized', 'セッションの有効期限が切れています');
  return {
    tokenHash,
    loginId: String(session.loginId || '')
  };
}

async function handleAdminLogin(req, body) {
  const loginId = normalizeString(body.loginId, 'loginId');
  const password = normalizeString(body.password, 'password');
  await verifyAdminLogin(loginId, password);
  const session = await createAdminSession(loginId);
  return {
    session
  };
}

async function handleAdminListTasks(req, body) {
  await requireAdminSession(req);
  const storeId = resolveStoreId(req, body);
  const tasks = await listActiveTasks(storeId);
  return {
    storeId,
    tasks
  };
}

async function handleAdminCreateTask(req, body) {
  await requireAdminSession(req);
  const storeId = resolveStoreId(req, body);
  const title = normalizeString(body.title, 'title');
  const description = String(body.description || '').trim();
  const period = normalizeTaskPeriod(body.period);
  const taskRef = getTaskCatalogCollection(storeId).doc();
  await taskRef.set(
    {
      id: taskRef.id,
      title,
      description,
      period,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  const taskSnap = await taskRef.get();
  return {
    storeId,
    task: normalizeTask(taskSnap)
  };
}

async function listActiveTemplateItems(storeId, templateId) {
  const snapshot = await getTemplateItemsCollection(storeId, templateId).get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        taskId: String(data.taskId || ''),
        sortOrder: Number(data.sortOrder || 0),
        isActive: data.isActive !== false
      };
    })
    .filter((item) => item.isActive && item.taskId)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

async function handleAdminCreateTemplate(req, body) {
  await requireAdminSession(req);
  const storeId = resolveStoreId(req, body);
  const name = normalizeString(body.name, 'name');
  const rawTaskIds = Array.isArray(body.taskIds) ? body.taskIds : [];
  const taskIds = [...new Set(rawTaskIds.map((value) => String(value || '').trim()).filter((value) => value !== ''))];
  assert(taskIds.length > 0, 400, 'invalid_request', 'taskIds は1件以上指定してください');

  const tasks = await listActiveTasks(storeId);
  const activeTaskMap = new Map(tasks.map((task) => [task.id, task]));
  taskIds.forEach((taskId) => {
    assert(activeTaskMap.has(taskId), 400, 'invalid_request', `taskIds に存在しない taskId が含まれています: ${taskId}`);
  });

  const templateRef = getTemplatesCollection(storeId).doc();
  const batch = db.batch();
  batch.set(
    templateRef,
    {
      id: templateRef.id,
      name,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  taskIds.forEach((taskId, index) => {
    const itemRef = getTemplateItemsCollection(storeId, templateRef.id).doc();
    batch.set(
      itemRef,
      {
        id: itemRef.id,
        taskId,
        sortOrder: index + 1,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  });
  await batch.commit();
  return {
    storeId,
    templateId: templateRef.id
  };
}

async function handleAdminListTemplates(req, body) {
  await requireAdminSession(req);
  const storeId = resolveStoreId(req, body);
  const templateSnapshot = await getTemplatesCollection(storeId).get();
  const tasks = await listActiveTasks(storeId);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const templates = [];

  for (const templateDoc of templateSnapshot.docs) {
    const templateData = templateDoc.data() || {};
    if (templateData.isActive === false) {
      continue;
    }
    const items = await listActiveTemplateItems(storeId, templateDoc.id);
    templates.push({
      id: templateDoc.id,
      name: String(templateData.name || ''),
      items: items.map((item) => {
        const task = taskMap.get(item.taskId);
        return {
          id: item.id,
          taskId: item.taskId,
          title: task ? task.title : '',
          description: task ? task.description : '',
          period: task ? task.period : TASK_PERIODS.DAILY,
          sortOrder: item.sortOrder
        };
      })
    });
  }

  templates.sort((left, right) => left.name.localeCompare(right.name, 'ja'));
  return {
    storeId,
    templates
  };
}

async function insertTaskIntoRun(storeId, businessDate, task) {
  await ensureDailyRun(storeId, businessDate);
  const existingItems = await listActiveRunItems(storeId, businessDate);
  const duplicated = existingItems.find((entry) => entry.item.taskId === task.id);
  if (duplicated) {
    return {
      inserted: false,
      item: duplicated.item
    };
  }
  const maxSortOrder = existingItems.reduce((maxValue, entry) => {
    return Math.max(maxValue, Number(entry.item.sortOrder || 0));
  }, 0);
  const nextSortOrder = maxSortOrder + 1;
  const nowIso = new Date().toISOString();
  const itemRef = getDailyRunItemsCollection(storeId, businessDate).doc();
  const nextItem = {
    id: itemRef.id,
    taskId: task.id,
    title: task.title,
    description: task.description || '',
    period: normalizeTaskPeriod(task.period),
    sortOrder: nextSortOrder,
    status: ITEM_STATUS.UNCHECKED,
    checkedByName: '',
    checkedByUserId: '',
    checkedAt: '',
    updatedAt: nowIso,
    createdAt: nowIso,
    isActive: true
  };
  await itemRef.set(nextItem, { merge: true });
  await getDailyRunRef(storeId, businessDate).set(
    {
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  return {
    inserted: true,
    item: normalizeRunItem({
      id: itemRef.id,
      data() {
        return nextItem;
      }
    })
  };
}

async function handleAdminInsertTask(req, body, businessDate) {
  await requireAdminSession(req);
  const storeId = resolveStoreId(req, body);
  const taskId = normalizeString(body.taskId, 'taskId');
  const task = await getTaskById(storeId, taskId);
  const result = await insertTaskIntoRun(storeId, businessDate, task);
  const snapshot = await writeSnapshotForRun(
    storeId,
    businessDate,
    {
      userId: 'admin',
      userName: '管理者'
    }
  );
  return {
    storeId,
    date: businessDate,
    inserted: result.inserted,
    item: result.item,
    checklist: snapshot
  };
}

async function handleAdminApplyTemplate(req, body, businessDate, templateId) {
  await requireAdminSession(req);
  const storeId = resolveStoreId(req, body);
  const templateRef = getTemplatesCollection(storeId).doc(templateId);
  const templateSnap = await templateRef.get();
  assert(templateSnap.exists, 404, 'not_found', 'テンプレートが見つかりません');
  const templateData = templateSnap.data() || {};
  assert(templateData.isActive !== false, 404, 'not_found', 'テンプレートが見つかりません');

  const templateItems = await listActiveTemplateItems(storeId, templateId);
  const tasks = await listActiveTasks(storeId);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  let insertedCount = 0;

  for (const templateItem of templateItems) {
    const task = taskMap.get(templateItem.taskId);
    if (!task) {
      continue;
    }
    const result = await insertTaskIntoRun(storeId, businessDate, task);
    if (result.inserted) {
      insertedCount += 1;
    }
  }

  const snapshot = await writeSnapshotForRun(
    storeId,
    businessDate,
    {
      userId: 'admin',
      userName: '管理者'
    }
  );
  return {
    storeId,
    date: businessDate,
    templateId,
    insertedCount,
    checklist: snapshot
  };
}

async function handleAdminGetRun(req, body, businessDate) {
  await requireAdminSession(req);
  const storeId = resolveStoreId(req, body);
  const storeName = await readStoreName(storeId);
  const runSnap = await getDailyRunRef(storeId, businessDate).get();
  const runData = runSnap.exists
    ? runSnap.data() || {}
    : { id: businessDate, businessDate, status: RUN_STATUS.OPEN };
  const runItems = await listActiveRunItems(storeId, businessDate);
  const response = buildChecklistResponse(
    storeId,
    storeName,
    businessDate,
    runData,
    {
      userId: 'admin',
      userName: '管理者'
    },
    runItems.map((entry) => entry.item)
  );
  return {
    storeId,
    date: businessDate,
    checklist: response
  };
}

async function handleAdminDeleteRunItem(req, body, businessDate, runItemId) {
  await requireAdminSession(req);
  const storeId = resolveStoreId(req, body);
  const itemRef = getDailyRunItemsCollection(storeId, businessDate).doc(runItemId);
  const itemSnap = await itemRef.get();
  assert(itemSnap.exists, 404, 'not_found', 'タスクが見つかりません');
  const item = normalizeRunItem(itemSnap);
  assert(item.isActive, 404, 'not_found', 'タスクが見つかりません');

  await itemRef.set(
    {
      isActive: false,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
  const snapshot = await writeSnapshotForRun(
    storeId,
    businessDate,
    {
      userId: 'admin',
      userName: '管理者'
    }
  );
  return {
    storeId,
    date: businessDate,
    runItemId,
    checklist: snapshot
  };
}

async function handleUserGetTodayChecklist(req, body) {
  const identity = await resolveUserIdentity(req, body);
  const storeId = resolveStoreId(req, body);
  const businessDate = resolveBusinessDate(Date.now());
  const storeName = await readStoreName(storeId);
  const runData = await ensureDailyRun(storeId, businessDate);
  const items = await listActiveRunItems(storeId, businessDate);
  await ensureSnapshotExists(
    storeId,
    businessDate,
    {
      userId: identity.userId,
      userName: identity.userName
    }
  );
  return buildChecklistResponse(
    storeId,
    storeName,
    businessDate,
    runData,
    identity,
    items.map((entry) => entry.item)
  );
}

async function updateUserRunItem(req, body, runItemId, nextStatus) {
  const identity = await resolveUserIdentity(req, body);
  const located = await findRunItemById(runItemId);
  assert(located.item.isActive, 404, 'not_found', 'チェック項目が見つかりません');
  const nowIso = new Date().toISOString();
  const isCheck = nextStatus === ITEM_STATUS.CHECKED;
  const updates = {
    status: nextStatus,
    checkedByName: isCheck ? identity.userName : '',
    checkedByUserId: isCheck ? identity.userId : '',
    checkedAt: isCheck ? nowIso : '',
    updatedAt: nowIso
  };
  await located.doc.ref.set(updates, { merge: true });

  const updatedSnap = await located.doc.ref.get();
  const updatedItem = normalizeRunItem(updatedSnap);
  await appendRunEvent(located.storeId, located.businessDate, {
    runId: located.businessDate,
    targetDate: located.businessDate,
    storeId: located.storeId,
    itemId: updatedItem.id,
    status: updatedItem.status,
    checkedBy: updatedItem.checkedBy || '',
    checkedByUserId: updatedItem.checkedByUserId || '',
    checkedAt: updatedItem.checkedAt || '',
    updatedAt: updatedItem.updatedAt || nowIso,
    sourceUserId: identity.userId
  });
  await writeSnapshotForRun(
    located.storeId,
    located.businessDate,
    {
      userId: identity.userId,
      userName: identity.userName
    }
  );
  return {
    item: {
      id: updatedItem.id,
      title: updatedItem.title,
      status: updatedItem.status,
      checkedBy: updatedItem.checkedBy,
      checkedByUserId: updatedItem.checkedByUserId,
      checkedAt: updatedItem.checkedAt,
      updatedAt: updatedItem.updatedAt
    }
  };
}

async function routeApiRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const path = normalizePath(req.path);
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  if (method === 'POST' && path === '/v1/admin/login') {
    return {
      statusCode: 200,
      payload: await handleAdminLogin(req, body)
    };
  }

  if (method === 'GET' && path === '/v1/admin/tasks') {
    return {
      statusCode: 200,
      payload: await handleAdminListTasks(req, body)
    };
  }

  if (method === 'POST' && path === '/v1/admin/tasks') {
    return {
      statusCode: 201,
      payload: await handleAdminCreateTask(req, body)
    };
  }

  if (method === 'GET' && path === '/v1/admin/templates') {
    return {
      statusCode: 200,
      payload: await handleAdminListTemplates(req, body)
    };
  }

  if (method === 'POST' && path === '/v1/admin/templates') {
    return {
      statusCode: 201,
      payload: await handleAdminCreateTemplate(req, body)
    };
  }

  const insertTaskMatch = path.match(/^\/v1\/admin\/runs\/([^/]+)\/items:insert$/);
  if (method === 'POST' && insertTaskMatch) {
    return {
      statusCode: 200,
      payload: await handleAdminInsertTask(req, body, normalizeDateString(insertTaskMatch[1]))
    };
  }

  const applyTemplateMatch = path.match(/^\/v1\/admin\/runs\/([^/]+)\/templates\/([^/]+):apply$/);
  if (method === 'POST' && applyTemplateMatch) {
    return {
      statusCode: 200,
      payload: await handleAdminApplyTemplate(
        req,
        body,
        normalizeDateString(applyTemplateMatch[1]),
        normalizeString(applyTemplateMatch[2], 'templateId')
      )
    };
  }

  const getRunMatch = path.match(/^\/v1\/admin\/runs\/([^/]+)$/);
  if (method === 'GET' && getRunMatch) {
    return {
      statusCode: 200,
      payload: await handleAdminGetRun(req, body, normalizeDateString(getRunMatch[1]))
    };
  }

  const deleteRunItemMatch = path.match(/^\/v1\/admin\/runs\/([^/]+)\/items\/([^/]+)$/);
  if (method === 'DELETE' && deleteRunItemMatch) {
    return {
      statusCode: 200,
      payload: await handleAdminDeleteRunItem(
        req,
        body,
        normalizeDateString(deleteRunItemMatch[1]),
        normalizeString(deleteRunItemMatch[2], 'runItemId')
      )
    };
  }

  if (method === 'GET' && path === '/v1/user/checklists/today') {
    return {
      statusCode: 200,
      payload: await handleUserGetTodayChecklist(req, body)
    };
  }

  const checkItemMatch = path.match(/^\/v1\/user\/checklist-items\/([^/]+)\/check$/);
  if (method === 'POST' && checkItemMatch) {
    return {
      statusCode: 200,
      payload: await updateUserRunItem(req, body, checkItemMatch[1], ITEM_STATUS.CHECKED)
    };
  }

  const uncheckItemMatch = path.match(/^\/v1\/user\/checklist-items\/([^/]+)\/uncheck$/);
  if (method === 'POST' && uncheckItemMatch) {
    return {
      statusCode: 200,
      payload: await updateUserRunItem(req, body, uncheckItemMatch[1], ITEM_STATUS.UNCHECKED)
    };
  }

  fail(404, 'not_found', '未対応の API です');
}

exports.api = onRequest(
  {
    region: 'asia-northeast1',
    cors: true
  },
  async (req, res) => {
    try {
      const result = await routeApiRequest(req);
      sendOk(res, result.statusCode, result.payload);
    } catch (error) {
      sendError(res, error);
    }
  }
);

function assertValidTargetDate(targetDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || ''))) {
    throw new Error('targetDate must be YYYY-MM-DD');
  }
}

function buildDayEntry(dailyStats) {
  return {
    date: dailyStats.date,
    total: Number(dailyStats.total || 0),
    checked: Number(dailyStats.checked || 0),
    achieved: dailyStats.achieved === true
  };
}

function normalizeStatsItem(item) {
  return {
    id: String(item && item.id ? item.id : ''),
    title: String(item && item.title ? item.title : ''),
    status: String(item && item.status ? item.status : 'unchecked') === 'checked' ? 'checked' : 'unchecked',
    checkedBy: item && item.checkedBy ? String(item.checkedBy) : '',
    checkedByUserId: item && item.checkedByUserId ? String(item.checkedByUserId) : '',
    checkedAt: item && item.checkedAt ? String(item.checkedAt) : ''
  };
}

function buildCheckedByUserCounts(items) {
  const counts = {};
  items.forEach((item) => {
    if (item.status !== 'checked') {
      return;
    }
    if (!item.checkedByUserId) {
      return;
    }
    counts[item.checkedByUserId] = Number(counts[item.checkedByUserId] || 0) + 1;
  });
  return counts;
}

function buildDailyStats(snapshotData, storeId, targetDate) {
  const items = Array.isArray(snapshotData.items)
    ? snapshotData.items.map(normalizeStatsItem).filter((item) => item.id && item.title)
    : [];
  const checked = items.reduce((sum, item) => {
    return sum + (item.status === 'checked' ? 1 : 0);
  }, 0);

  return {
    storeId: String(storeId || ''),
    date: String(targetDate || ''),
    runId: String(snapshotData.runId || ''),
    total: items.length,
    checked,
    achieved: items.length > 0 && checked === items.length,
    checkedByUserCounts: buildCheckedByUserCounts(items),
    items
  };
}

function normalizeMonthlyCounts(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const normalized = {};
  Object.keys(value).forEach((key) => {
    const count = Number(value[key] || 0);
    if (!key || !Number.isFinite(count) || count <= 0) {
      return;
    }
    normalized[key] = count;
  });
  return normalized;
}

function applyCountDelta(baseCounts, deltaCounts, multiplier) {
  Object.keys(deltaCounts || {}).forEach((userId) => {
    const delta = Number(deltaCounts[userId] || 0) * Number(multiplier || 0);
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    const next = Number(baseCounts[userId] || 0) + delta;
    if (next > 0) {
      baseCounts[userId] = next;
      return;
    }
    delete baseCounts[userId];
  });
}

function normalizeCalendarEntries(value) {
  if (!Array.isArray(value)) {
    return {};
  }
  const map = {};
  value.forEach((entry) => {
    const date = String(entry && entry.date ? entry.date : '');
    if (!date) {
      return;
    }
    map[date] = {
      date,
      total: Number(entry && entry.total ? entry.total : 0),
      checked: Number(entry && entry.checked ? entry.checked : 0),
      achieved: entry && entry.achieved === true
    };
  });
  return map;
}

function normalizeFirestoreEventSyncValue(value) {
  if (value === null || typeof value === 'undefined') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeFirestoreEventSyncValue);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (typeof value === 'object') {
    const normalized = {};
    Object.keys(value).forEach((key) => {
      normalized[key] = normalizeFirestoreEventSyncValue(value[key]);
    });
    return normalized;
  }
  return value;
}

async function postFirestoreEventToGas(storeId, targetDate, eventId, eventPayload) {
  const response = await fetch(
    buildGasFirestoreEventSyncUrl(),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        syncSecret: readFirestoreEventSyncSecret(),
        eventId,
        storeId,
        targetDate,
        event: normalizeFirestoreEventSyncValue(eventPayload)
      })
    }
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`GAS Firestore event sync failed: ${response.status} ${responseText.slice(0, 240)}`);
  }
  const responsePayload = responseText ? JSON.parse(responseText) : {};
  if (responsePayload.ok === false) {
    throw new Error(`GAS Firestore event sync rejected: ${responsePayload.code || 'unknown'}`);
  }
  return responsePayload;
}

function buildMonthlySummary(calendarMap, year, month, storeId, counts) {
  const calendar = Object.keys(calendarMap).sort().map((date) => {
    return calendarMap[date];
  });
  const totalItems = calendar.reduce((sum, day) => {
    return sum + Number(day.total || 0);
  }, 0);
  const achievedDays = calendar.reduce((sum, day) => {
    return sum + (day.achieved ? 1 : 0);
  }, 0);
  return {
    storeId: String(storeId || ''),
    year: Number(year),
    month: Number(month),
    totalDays: calendar.length,
    achievedDays,
    totalItems,
    checkedByUserCounts: counts,
    calendar,
    updatedAt: FieldValue.serverTimestamp()
  };
}

exports.syncFirestoreEventToGas = onDocumentCreated(
  {
    document: FIRESTORE_EVENT_DOCUMENT_PATH,
    region: 'asia-northeast1',
    retry: true,
    secrets: [firestoreEventSyncSecret]
  },
  async (event) => {
    if (!event.data) {
      return;
    }

    const storeId = String(event.params.storeId || '');
    const targetDate = String(event.params.targetDate || '');
    const eventId = String(event.params.eventId || '');
    assertValidTargetDate(targetDate);
    if (!storeId) {
      throw new Error('storeId is required');
    }
    if (!eventId) {
      throw new Error('eventId is required');
    }

    const eventPayload = event.data.data() || {};
    await postFirestoreEventToGas(storeId, targetDate, eventId, eventPayload);
  }
);

exports.syncStatsFromSnapshot = onDocumentWritten(
  {
    document: 'stores/{storeId}/runs/{targetDate}/snapshots/today',
    region: 'asia-northeast1'
  },
  async (event) => {
    if (!event.data || !event.data.after.exists) {
      return;
    }

    const storeId = String(event.params.storeId || '');
    const targetDate = String(event.params.targetDate || '');
    assertValidTargetDate(targetDate);
    if (!storeId) {
      throw new Error('storeId is required');
    }

    const snapshotData = event.data.after.data() || {};
    const dailyStats = buildDailyStats(snapshotData, storeId, targetDate);
    const year = Number(targetDate.slice(0, 4));
    const month = Number(targetDate.slice(5, 7));
    const monthId = targetDate.slice(0, 7);

    const dailyDocRef = db.collection('stores').doc(storeId).collection('daily_stats').doc(targetDate);
    const monthlyDocRef = db.collection('stores').doc(storeId).collection('monthly_stats').doc(monthId);

    await db.runTransaction(async (transaction) => {
      const previousDailySnap = await transaction.get(dailyDocRef);
      const monthlySnap = await transaction.get(monthlyDocRef);
      const previousDaily = previousDailySnap.exists ? previousDailySnap.data() : null;
      const monthlyData = monthlySnap.exists ? monthlySnap.data() : {};

      const calendarMap = normalizeCalendarEntries(monthlyData.calendar);
      calendarMap[targetDate] = buildDayEntry(dailyStats);

      const checkedByUserCounts = normalizeMonthlyCounts(monthlyData.checkedByUserCounts);
      if (previousDaily && previousDaily.checkedByUserCounts) {
        applyCountDelta(checkedByUserCounts, previousDaily.checkedByUserCounts, -1);
      }
      applyCountDelta(checkedByUserCounts, dailyStats.checkedByUserCounts, 1);

      transaction.set(
        dailyDocRef,
        {
          storeId: dailyStats.storeId,
          date: dailyStats.date,
          runId: dailyStats.runId,
          total: dailyStats.total,
          checked: dailyStats.checked,
          achieved: dailyStats.achieved,
          checkedByUserCounts: dailyStats.checkedByUserCounts,
          items: dailyStats.items,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      transaction.set(
        monthlyDocRef,
        buildMonthlySummary(calendarMap, year, month, storeId, checkedByUserCounts),
        { merge: true }
      );
    });
  }
);

exports.__private = {
  resolveBusinessDate,
  sha256Hex,
  normalizePath
};
