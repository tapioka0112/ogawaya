import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const TARGET_DATE = '2026-06-09';
const WEEK_TARGET_DATE = '2026-06-07';
const MONTH_TARGET_DATE = '2026-06-01';
const STORE_ID = 'store-hashimoto';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(name) {
    this.values.add(name);
  }

  remove(name) {
    this.values.delete(name);
  }

  toggle(name, force) {
    if (force) {
      this.add(name);
      return true;
    }
    this.remove(name);
    return false;
  }
}

class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.className = '';
    this.classList = new FakeClassList();
    this.listeners = {};
    this.textContent = '';
    this.type = '';
    this.value = '';
    this.parentNode = null;
    this.innerHtmlClearCount = 0;
    this.attributes = {};
    this._innerHTML = '';
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    if (value === '') {
      this.innerHtmlClearCount += 1;
      this.children = [];
    }
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  click() {
    if (typeof this.listeners.click === 'function') {
      return this.listeners.click({
        currentTarget: this,
        target: this,
        preventDefault() {}
      });
    }
    return undefined;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') {
      this.className = String(value);
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  focus() {}

  contains(node) {
    if (!node) {
      return false;
    }
    if (node === this) {
      return true;
    }
    return this.children.some((child) => child === node || (child.contains && child.contains(node)));
  }

  closest() {
    return null;
  }
}

function createFakeDocument() {
  const elements = {};
  const body = new FakeElement('body');
  const progressCard = new FakeElement('section');
  progressCard.className = 'progress-card';

  function register(tagName, id) {
    elements[id] = new FakeElement(tagName, id);
  }

  [
    ['div', 'error-message'],
    ['div', 'status-message'],
    ['span', 'screen-mode'],
    ['div', 'store-name'],
    ['div', 'target-date'],
    ['div', 'progress-summary'],
    ['strong', 'progress-count-checked'],
    ['span', 'progress-count-total'],
    ['span', 'progress-bar-fill'],
    ['circle', 'progress-ring-progress'],
    ['span', 'progress-ring-label'],
    ['ul', 'checklist-items'],
    ['div', 'period-tabs'],
    ['button', 'period-tab-daily'],
    ['button', 'period-tab-weekly'],
    ['button', 'period-tab-monthly'],
    ['article', 'task-detail-panel'],
    ['button', 'task-detail-backdrop'],
    ['button', 'task-detail-close'],
    ['h2', 'task-detail-title'],
    ['p', 'task-detail-description'],
    ['div', 'task-detail-meta'],
    ['div', 'incomplete-summary'],
    ['ul', 'incomplete-items'],
    ['button', 'refresh-button'],
    ['button', 'open-admin-button'],
    ['button', 'hamburger-button'],
    ['nav', 'todo-menu'],
    ['button', 'tab-home'],
    ['button', 'tab-stats'],
    ['main', 'main-content'],
    ['section', 'stats-content'],
    ['circle', 'stats-overall-progress'],
    ['span', 'stats-overall-pct'],
    ['div', 'stats-overall-info'],
    ['circle', 'stats-mine-progress'],
    ['span', 'stats-mine-pct'],
    ['div', 'stats-mine-info'],
    ['div', 'stats-calendar'],
    ['div', 'stats-cal-grid-header'],
    ['span', 'stats-month-label'],
    ['button', 'stats-prev-month'],
    ['button', 'stats-next-month'],
    ['article', 'stats-day-detail-card'],
    ['h3', 'stats-day-detail-title'],
    ['div', 'stats-day-detail-summary'],
    ['ul', 'stats-day-detail-items']
  ].forEach(([tagName, id]) => register(tagName, id));

  elements['period-tab-daily'].dataset.period = 'daily';
  elements['period-tab-weekly'].dataset.period = 'weekly';
  elements['period-tab-monthly'].dataset.period = 'monthly';

  return {
    body,
    readyState: 'complete',
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createElementNS(namespace, tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      return selector === '.progress-card' ? progressCard : null;
    },
    addEventListener() {},
    elements
  };
}

function createDoc(id, data) {
  return {
    id,
    data() {
      return { ...data };
    }
  };
}

function createSnapshot(docs) {
  return {
    forEach(callback) {
      docs.forEach(callback);
    },
    docChanges() {
      return docs.map((doc) => ({ type: 'added', doc }));
    }
  };
}

class FakeFirestore {
  constructor(options = {}) {
    this.itemObservers = [];
    this.eventObservers = [];
    this.baseItem = {
      id: 'run-item-1',
      templateItemId: 'task-1',
      title: '床清掃',
      description: '床を確認する',
      period: 'daily',
      sortOrder: 1,
      status: 'unchecked',
      checkedBy: '',
      checkedByUserId: '',
      checkedAt: '',
      updatedAt: '2026-06-09T00:00:00.000Z',
      isActive: true
    };
    this.itemsByDate = options.itemsByDate || {
      [TARGET_DATE]: options.items || [this.baseItem]
    };
    this.items = this.itemsByDate[TARGET_DATE] || [];
    this.failEventAdds = options.failEventAdds === true;
    this.setCalls = [];
    this.addCalls = [];
  }

  collection(name) {
    return new FakeCollectionRef(this, [name]);
  }

  handleDocGet(path) {
    if (path.length === 2 && path[0] === 'stores') {
      return Promise.resolve({
        exists: true,
        data() {
          return { name: '橋本店' };
        }
      });
    }
    if (path.length === 4 && path[2] === 'runs') {
      return Promise.resolve({
        exists: true,
        data() {
          return {
            id: path[3],
            storeId: path[1],
            targetDate: path[3],
            storeName: '橋本店',
            status: 'open'
          };
        }
      });
    }
    return Promise.resolve({
      exists: false,
      data() {
        return {};
      }
    });
  }

  handleCollectionGet(path) {
    if (path.length === 5 && path[2] === 'runs' && path[4] === 'items') {
      const targetDate = path[3];
      const docs = (this.itemsByDate[targetDate] || []).map((item) => createDoc(item.id, item));
      return Promise.resolve(createSnapshot(docs));
    }
    return Promise.resolve(createSnapshot([]));
  }

  handleCollectionAdd(path, data) {
    this.addCalls.push({ path, data });
    if (this.failEventAdds) {
      return Promise.reject(new Error('event write failed'));
    }
    return Promise.resolve({ id: `event-${this.addCalls.length}` });
  }

  handleDocSet(path, data, options) {
    this.setCalls.push({ path, data, options });
    if (path.length === 6 && path[2] === 'runs' && path[4] === 'items') {
      const targetDate = path[3];
      const itemId = path[5];
      const currentItems = this.itemsByDate[targetDate] || [];
      const nextItems = currentItems.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        return options && options.merge ? { ...item, ...data } : { id: itemId, ...data };
      });
      if (!currentItems.some((item) => item.id === itemId)) {
        nextItems.push({ id: itemId, ...data });
      }
      this.itemsByDate[targetDate] = nextItems;
      this.items = this.itemsByDate[TARGET_DATE] || [];
    }
    return Promise.resolve();
  }

  registerObserver(path, callback) {
    const observer = { path, callback };
    if (path.at(-1) === 'items') {
      this.itemObservers.push(observer);
    }
    if (path.at(-1) === 'events') {
      this.eventObservers.push(observer);
    }
    return () => {};
  }

  emitItemChange(data, targetDate = TARGET_DATE) {
    const observer = this.itemObservers.find((candidate) => candidate.path[3] === targetDate);
    assert.ok(observer, 'items observer が登録されている');
    observer.callback(createSnapshot([createDoc(data.id, data)]));
  }

  emitEventChange(data, targetDate = TARGET_DATE) {
    const observer = this.eventObservers.find((candidate) => candidate.path[3] === targetDate);
    assert.ok(observer, 'events observer が登録されている');
    observer.callback(createSnapshot([createDoc('event-1', data)]));
  }
}

class FakeCollectionRef {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }

  doc(id) {
    return new FakeDocRef(this.firestore, this.path.concat([id]));
  }

  get() {
    return this.firestore.handleCollectionGet(this.path);
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  onSnapshot(callback) {
    return this.firestore.registerObserver(this.path, callback);
  }

  add(data) {
    return this.firestore.handleCollectionAdd(this.path, data);
  }
}

class FakeDocRef {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }

  collection(name) {
    return new FakeCollectionRef(this.firestore, this.path.concat([name]));
  }

  get() {
    return this.firestore.handleDocGet(this.path);
  }

  set(data, options) {
    return this.firestore.handleDocSet(this.path, data, options);
  }
}

function createIdToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({ alg: 'none' }),
    encode({
      sub: 'line-user-1',
      name: '山田 太郎',
      exp: 4102444800
    }),
    'signature'
  ].join('.');
}

function createFixedDate() {
  const NativeDate = Date;
  return class FixedDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) {
        super('2026-06-09T03:00:00.000Z');
        return;
      }
      super(...args);
    }

    static now() {
      return new NativeDate('2026-06-09T03:00:00.000Z').getTime();
    }

    static parse(value) {
      return NativeDate.parse(value);
    }

    static UTC(...args) {
      return NativeDate.UTC(...args);
    }
  };
}

async function waitFor(assertion) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    }
  }
  assertion();
}

async function loadPagesAppRuntime(options = {}) {
  const document = createFakeDocument();
  const firestore = new FakeFirestore(options);
  const expectedItemCount = options.expectedInitialRenderedCount ?? firestore.items.length;
  const firestoreFactory = () => firestore;
  firestoreFactory.FieldValue = {
    serverTimestamp() {
      return 'SERVER_TIMESTAMP';
    }
  };
  const script = await readFile('pages/app.js', 'utf8');
  const context = {
    console,
    document,
    location: {
      href: 'http://localhost/',
      search: ''
    },
    navigator: {},
    Intl,
    Date: createFixedDate(),
    atob(value) {
      return Buffer.from(value, 'base64').toString('binary');
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        liffId: '2009859108-sJ31BCFx',
        defaultStoreId: STORE_ID,
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: true,
        clientFirestoreWriteEnabled: true,
        consistencyRefreshSeconds: 30,
        firebase: {
          apiKey: 'test-api-key',
          projectId: 'test-project',
          appId: 'test-app'
        }
      })
    }),
    firebase: {
      apps: [],
      initializeApp() {
        return {};
      },
      app() {
        return {};
      },
      firestore: firestoreFactory,
      auth() {
        return {
          currentUser: {
            uid: 'firebase-user-1',
            getIdToken: async () => 'firebase-id-token'
          },
          signInAnonymously: async () => ({
            user: {
              uid: 'firebase-user-1',
              getIdToken: async () => 'firebase-id-token'
            }
          })
        };
      }
    },
    liff: {
      async init() {},
      isLoggedIn() {
        return true;
      },
      getIDToken() {
        return createIdToken();
      },
      getAccessToken() {
        return 'line-access-token';
      }
    },
    requestAnimationFrame(callback) {
      callback();
    },
    setTimeout,
    clearTimeout,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    addEventListener() {}
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  await waitFor(() => {
    const errorMessage = document.elements['error-message'].textContent;
    assert.equal(firestore.itemObservers.length, 3, errorMessage);
    assert.equal(firestore.eventObservers.length, 3, errorMessage);
    assert.equal(document.elements['checklist-items'].children.length, expectedItemCount);
  });
  return { document, firestore };
}

function getRenderedItemIds(document) {
  return document.elements['checklist-items'].children.map((listItem) => listItem.children[0].dataset.itemId);
}

function createMonthlyItems() {
  return [
    ['monthly-item-1', '換気扇の清掃'],
    ['monthly-item-2', '白板POP 等の汚れや剥がれの改善'],
    ['monthly-item-3', '傘立ての清掃'],
    ['monthly-item-4', '店舗天井の墨すみ清掃・剥がれ等の改善']
  ].map(([id, title], index) => ({
    id,
    templateItemId: `template-${id}`,
    title,
    description: '',
    period: 'monthly',
    sortOrder: index + 1,
    status: 'unchecked',
    checkedBy: '',
    checkedByUserId: '',
    checkedAt: '',
    updatedAt: '2026-06-01T00:00:00.000Z',
    isActive: true
  }));
}

test('GitHub Pages の月間タスクは月初 run に保存し、当日 run の同一 id snapshot で消えない', async () => {
  const monthlyItems = createMonthlyItems();
  const { document, firestore } = await loadPagesAppRuntime({
    itemsByDate: {
      [TARGET_DATE]: [],
      [WEEK_TARGET_DATE]: [],
      [MONTH_TARGET_DATE]: monthlyItems
    },
    expectedInitialRenderedCount: 1
  });
  document.elements['period-tab-monthly'].click();
  await waitFor(() => {
    assert.equal(document.elements['checklist-items'].children.length, 4);
  });
  const checklistItems = document.elements['checklist-items'];

  checklistItems.children[0].children[0].click();

  assert.equal(checklistItems.children.length, 4);
  assert.deepEqual(getRenderedItemIds(document), [
    'monthly-item-1',
    'monthly-item-2',
    'monthly-item-3',
    'monthly-item-4'
  ]);
  await waitFor(() => {
    const itemSetCalls = firestore.setCalls.filter((call) => call.path.at(-2) === 'items');
    assert.equal(itemSetCalls.length, 1);
    assert.equal(itemSetCalls[0].path.at(3), MONTH_TARGET_DATE);
    assert.equal(itemSetCalls[0].path.at(5), 'monthly-item-1');
  });

  const clearCountAfterSave = checklistItems.innerHtmlClearCount;
  firestore.emitItemChange({
    id: 'monthly-item-1',
    title: '別 run に誤って残った月間タスク',
    period: 'monthly',
    status: 'checked',
    checkedBy: '山田 太郎',
    checkedByUserId: 'firebase-user-2',
    checkedAt: '2026-06-09T03:00:02.000Z',
    updatedAt: '2026-06-09T03:00:02.000Z',
    isActive: true
  }, TARGET_DATE);

  assert.equal(checklistItems.children.length, 4);
  assert.deepEqual(getRenderedItemIds(document), [
    'monthly-item-1',
    'monthly-item-2',
    'monthly-item-3',
    'monthly-item-4'
  ]);
  assert.equal(checklistItems.children[0].dataset.period, 'monthly');
  assert.equal(checklistItems.innerHtmlClearCount, clearCountAfterSave);
});

test('GitHub Pages のチェック押下は項目をリスト下部へ移動させず表示位置を保つ', async () => {
  const secondItem = {
    id: 'run-item-2',
    templateItemId: 'task-2',
    title: '棚清掃',
    description: '棚を確認する',
    period: 'daily',
    sortOrder: 2,
    status: 'unchecked',
    checkedBy: '',
    checkedByUserId: '',
    checkedAt: '',
    updatedAt: '2026-06-09T00:00:00.000Z',
    isActive: true
  };
  const { document, firestore } = await loadPagesAppRuntime({
    items: [
      {
        ...new FakeFirestore().baseItem
      },
      secondItem
    ]
  });
  const checklistItems = document.elements['checklist-items'];
  assert.deepEqual(getRenderedItemIds(document), ['run-item-1', 'run-item-2']);

  checklistItems.children[0].children[0].click();

  assert.equal(checklistItems.children.length, 2);
  assert.deepEqual(getRenderedItemIds(document), ['run-item-1', 'run-item-2']);
  assert.equal(checklistItems.children[0].dataset.status, 'checked');
  await waitFor(() => {
    const itemSetCalls = firestore.setCalls.filter((call) => call.path.at(-2) === 'items');
    assert.equal(itemSetCalls.length, 1);
    assert.equal(firestore.addCalls.length, 1);
  });
});

test('GitHub Pages のチェック押下は event 書き込み失敗時も item 保存済みなら失敗表示にしない', async () => {
  const { document, firestore } = await loadPagesAppRuntime({ failEventAdds: true });
  const checklistItems = document.elements['checklist-items'];

  checklistItems.children[0].children[0].click();

  await waitFor(() => {
    const itemSetCalls = firestore.setCalls.filter((call) => call.path.at(-2) === 'items');
    assert.equal(itemSetCalls.length, 1);
    assert.equal(firestore.addCalls.length, 1);
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  assert.equal(checklistItems.children[0].dataset.status, 'checked');
  assert.equal(document.elements['error-message'].textContent, '');
});

test('GitHub Pages の realtime item 購読は event なしで別端末更新を反映し、同一 event を二重描画しない', async () => {
  const { document, firestore } = await loadPagesAppRuntime();
  const checklistItems = document.elements['checklist-items'];
  const initialClearCount = checklistItems.innerHtmlClearCount;
  assert.equal(checklistItems.children[0].dataset.status, 'unchecked');

  const checkedItem = {
    ...firestore.baseItem,
    status: 'checked',
    checkedBy: '山田 太郎',
    checkedByUserId: 'firebase-user-2',
    checkedAt: '2026-06-09T03:00:01.000Z',
    updatedAt: '2026-06-09T03:00:01.000Z'
  };
  firestore.emitItemChange(checkedItem);
  assert.equal(checklistItems.children[0].dataset.status, 'checked');
  assert.equal(checklistItems.innerHtmlClearCount, initialClearCount + 1);
  const clearCountAfterCheckedItem = checklistItems.innerHtmlClearCount;

  firestore.emitItemChange({
    ...checkedItem,
    updatedAt: '2026-06-09T03:00:02.000Z'
  });
  assert.equal(checklistItems.children[0].dataset.status, 'checked');
  assert.equal(checklistItems.innerHtmlClearCount, clearCountAfterCheckedItem);

  firestore.emitEventChange({
    runId: TARGET_DATE,
    targetDate: TARGET_DATE,
    storeId: STORE_ID,
    itemId: checkedItem.id,
    status: checkedItem.status,
    checkedBy: checkedItem.checkedBy,
    checkedByUserId: checkedItem.checkedByUserId,
    checkedAt: checkedItem.checkedAt,
    updatedAt: '2026-06-09T03:00:02.000Z',
    sourceUserId: 'firebase-user-2',
    sourceClientId: 'other-client',
    emittedAt: '2026-06-09T03:00:03.000Z'
  });
  assert.equal(checklistItems.children[0].dataset.status, 'checked');
  assert.equal(checklistItems.innerHtmlClearCount, clearCountAfterCheckedItem);
});
