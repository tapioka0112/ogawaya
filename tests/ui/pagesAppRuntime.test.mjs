import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

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
      this.values.add(name);
      return true;
    }
    this.values.delete(name);
    return false;
  }
}

class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.textContent = '';
    this.dataset = {};
    this.hidden = false;
    this.className = '';
    this.classList = new FakeClassList();
    this.listeners = {};
    this.value = '';
    this.disabled = false;
    this.type = '';
    this._innerHTML = '';
    this._attributes = {};
    this.style = {};
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') {
      this.children = [];
    }
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parentNode = null;
    return child;
  }

  addEventListener(eventName, handler) {
    this.listeners[eventName] = handler;
  }

  setAttribute(name, value) {
    this._attributes[name] = String(value);
    if (name === 'class') {
      this.className = String(value);
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attributes, name) ? this._attributes[name] : null;
  }

  removeAttribute(name) {
    delete this._attributes[name];
  }

  focus() {}

  scrollIntoView() {}

  contains(node) {
    if (!node) {
      return false;
    }
    if (node === this) {
      return true;
    }
    return this.children.some((child) => child === node || (child && typeof child.contains === 'function' && child.contains(node)));
  }

  click() {
    if (!this.listeners.click) {
      return undefined;
    }
    return this.listeners.click({
      preventDefault() {},
      stopPropagation() {},
      target: this
    });
  }
}

function createFakeDocument() {
  const elements = {};
  const body = new FakeElement('body');

  function register(tagName, id) {
    elements[id] = new FakeElement(tagName, id);
  }

  [
    ['div', 'error-message'],
    ['div', 'status-message'],
    ['div', 'screen-mode'],
    ['div', 'store-name'],
    ['div', 'target-date'],
    ['div', 'progress-summary'],
    ['strong', 'progress-count-checked'],
    ['span', 'progress-count-total'],
    ['span', 'progress-bar-fill'],
    ['circle', 'progress-ring-progress'],
    ['span', 'progress-ring-label'],
    ['ul', 'checklist-items'],
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
    ['section', 'todo-menu'],
    ['button', 'tab-home'],
    ['button', 'tab-stats'],
    ['section', 'main-content'],
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
    ['section', 'stats-day-detail-card'],
    ['span', 'stats-day-detail-title'],
    ['p', 'stats-day-detail-summary'],
    ['ul', 'stats-day-detail-items'],
    ['section', 'progress-card']
  ].forEach(([tagName, id]) => register(tagName, id));

  return {
    elements,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      return selector === '.progress-card' ? elements['progress-card'] : null;
    },
    addEventListener() {}
  };
}

function flattenElements(root) {
  const nodes = [];
  root.children.forEach((child) => {
    nodes.push(child);
    nodes.push(...flattenElements(child));
  });
  return nodes;
}

function findByDataset(root, key, value) {
  return flattenElements(root).find((node) => node.dataset[key] === value) ?? null;
}

function findByClassName(root, className) {
  return flattenElements(root).find((node) => String(node.className || '').split(/\s+/).includes(className)) ?? null;
}

function datasetValues(root, key) {
  return flattenElements(root).map((node) => node.dataset[key]).filter(Boolean);
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function responseWithStatus(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function toFirestoreRestValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toFirestoreRestValue)
      }
    };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, childValue]) => [key, toFirestoreRestValue(childValue)]))
      }
    };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function firestoreRestDocument(payload) {
  return response({
    fields: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, toFirestoreRestValue(value)]))
  });
}

function createChecklistPayload(item) {
  return {
    ok: true,
    statusCode: 200,
    runId: 'run-001',
    templateId: 'tmpl-001',
    storeName: '橋本店',
    targetDate: '2026-04-24',
    status: 'open',
    currentUser: {
      userId: 'line-user-001',
      name: '田中LINE',
      role: '',
      store: { id: 'store-hashimoto', name: '橋本店' }
    },
    items: [item]
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createFixedDate(isoText) {
  const fixedMs = new Date(isoText).getTime();
  return class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedMs);
        return;
      }
      super(...args);
    }

    static now() {
      return fixedMs;
    }
  };
}

function createIdToken(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

function createFakeFirestore(writes, options = {}) {
  const addImpl = options.addImpl || ((payload) => {
    writes.push(payload);
    return Promise.resolve({ id: `event-${writes.length}` });
  });
  const getImpl = options.getImpl || (() => Promise.resolve({
    exists: false,
    data() {
      return null;
    }
  }));

  function createRef(pathParts) {
    return {
      collection(name) {
        return createRef([...pathParts, name]);
      },
      doc(id) {
        return createRef([...pathParts, id]);
      },
      orderBy() {
        return this;
      },
      limit() {
        return this;
      },
      onSnapshot() {
        if (options.onSnapshotImpl) {
          return options.onSnapshotImpl(pathParts, ...arguments);
        }
        return function unsubscribe() {};
      },
      get() {
        return getImpl(pathParts);
      },
      add(payload) {
        return addImpl(payload, pathParts);
      }
    };
  }

  return createRef([]);
}

function createFakeFirebase(writes, options = {}) {
  const firestore = createFakeFirestore(writes, options);
  const auth = {
    currentUser: null,
    signInAnonymously() {
      this.currentUser = { uid: 'anonymous-user-001' };
      return Promise.resolve({ user: this.currentUser });
    }
  };
  function firestoreFactory() {
    return firestore;
  }
  firestoreFactory.FieldValue = {
    serverTimestamp() {
      return { __type: 'serverTimestamp' };
    }
  };
  return {
    apps: [],
    initializeApp() {
      this.apps.push({});
      return {};
    },
    app() {
      return this.apps[0] || {};
    },
    firestore: firestoreFactory,
    auth() {
      return auth;
    }
  };
}

async function loadPagesApp(fetchHandler, options = {}) {
  const documentRef = createFakeDocument();
  const appJs = await readFile('pages/app.js', 'utf8');
  const hasLiffOption = Object.prototype.hasOwnProperty.call(options, 'liff');
  const context = {
    globalThis: {},
    document: documentRef,
    location: options.location || { href: '', search: '' },
    localStorage: {
      values: Object.assign({}, options.localStorageValues || {}),
      getItem(key) {
        return this.values[key] || '';
      },
      setItem(key, value) {
        this.values[key] = String(value);
      },
      removeItem(key) {
        delete this.values[key];
      }
    },
    liff: hasLiffOption ? options.liff : {
      async init() {},
      isLoggedIn() {
        return true;
      },
      getIDToken() {
        return 'token';
      }
    },
    firebase: options.firebase,
    fetch: fetchHandler,
    atob(value) {
      return Buffer.from(value, 'base64').toString('binary');
    },
    setTimeout(handler, ms) {
      const timer = setTimeout(handler, ms);
      timer.unref();
      return timer;
    },
    clearTimeout,
    requestAnimationFrame(handler) {
      return setTimeout(handler, 0);
    },
    setInterval(handler, ms) {
      const timer = setInterval(handler, ms);
      timer.unref();
      return timer;
    },
    clearInterval,
    confetti: options.confetti,
    addEventListener() {},
    console: options.console || console,
    Intl,
    Date: options.Date || Date
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(appJs, context);
  await wait(30);
  return {
    context,
    document: documentRef
  };
}

test('GitHub Pages app は期限切れ ID token を検知したら LIFF session を1回だけ更新する', async () => {
  const expiredToken = createIdToken({
    sub: 'line-user-001',
    name: '田中LINE',
    aud: '2009859108',
    exp: Math.floor(Date.now() / 1000) - 60
  });
  let gasCalls = 0;
  let logoutCalls = 0;
  let reloadCalls = 0;
  const location = {
    href: 'https://tapioka0112.github.io/ogawaya/?debugTiming=1',
    search: '?debugTiming=1',
    reload() {
      reloadCalls += 1;
    }
  };

  const { context } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2009859108-sJ31BCFx',
        allowAnonymousAccess: false
      });
    }
    gasCalls += 1;
    throw new Error(`unexpected request: ${url}`);
  }, {
    location,
    liff: {
      async init() {},
      isLoggedIn() {
        return true;
      },
      isInClient() {
        return true;
      },
      getIDToken() {
        return expiredToken;
      },
      getAccessToken() {
        return 'revoked-access-token';
      },
      logout() {
        logoutCalls += 1;
      }
    }
  });

  assert.equal(logoutCalls, 1);
  assert.equal(reloadCalls, 1);
  assert.equal(gasCalls, 0);
  assert.ok(Number(context.localStorage.values['ogawaya:liff-reauth-attempted-at']) > 0);
});

test('GitHub Pages app は LIFF session 更新済みなら access token 経路を継続する', async () => {
  const expiredToken = createIdToken({
    sub: 'line-user-001',
    name: '田中LINE',
    aud: '2009859108',
    exp: Math.floor(Date.now() / 1000) - 60
  });
  let reloadCalls = 0;
  let todayRequestBody = null;
  const { document } = await loadPagesApp(async (url, options = {}) => {
    if (url === './config.json') {
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2009859108-sJ31BCFx',
        allowAnonymousAccess: false
      });
    }
    if (String(url).startsWith('https://gas.example/exec?')) {
      todayRequestBody = JSON.parse(options.body);
      return response(createChecklistPayload({
        id: 'run-item-001',
        title: '開店準備',
        description: '',
        status: 'unchecked',
        checkedBy: '',
        checkedByUserId: '',
        checkedAt: '',
        updatedAt: '2026-04-24T10:00:00Z'
      }));
    }
    throw new Error(`unexpected request: ${url}`);
  }, {
    localStorageValues: {
      'ogawaya:liff-reauth-attempted-at': String(Date.now())
    },
    location: {
      href: 'https://tapioka0112.github.io/ogawaya/',
      search: '',
      reload() {
        reloadCalls += 1;
      }
    },
    liff: {
      async init() {},
      isLoggedIn() {
        return true;
      },
      isInClient() {
        return true;
      },
      getIDToken() {
        return expiredToken;
      },
      getAccessToken() {
        return 'valid-access-token';
      },
      logout() {
        throw new Error('logout should not run twice');
      }
    }
  });

  assert.equal(reloadCalls, 0);
  assert.equal(todayRequestBody.authToken, expiredToken);
  assert.equal(todayRequestBody.accessToken, 'valid-access-token');
  assert.equal(document.elements['checklist-items'].children.length, 1);
});

test('GitHub Pages app は GAS 認証 401 でも LIFF session を更新する', async () => {
  const validToken = createIdToken({
    sub: 'line-user-001',
    name: '田中LINE',
    aud: '2009859108',
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  let logoutCalls = 0;
  let reloadCalls = 0;
  const { context } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2009859108-sJ31BCFx',
        allowAnonymousAccess: false
      });
    }
    if (String(url).startsWith('https://gas.example/exec?')) {
      return responseWithStatus(200, {
        ok: false,
        statusCode: 401,
        code: 'unauthorized',
        message: 'LIFF access token の検証に失敗しました',
        details: {
          accessTokenVerifyStatus: 400
        }
      });
    }
    throw new Error(`unexpected request: ${url}`);
  }, {
    location: {
      href: 'https://tapioka0112.github.io/ogawaya/',
      search: '',
      reload() {
        reloadCalls += 1;
      }
    },
    liff: {
      async init() {},
      isLoggedIn() {
        return true;
      },
      isInClient() {
        return true;
      },
      getIDToken() {
        return validToken;
      },
      getAccessToken() {
        return 'revoked-access-token';
      },
      logout() {
        logoutCalls += 1;
      }
    }
  });

  assert.equal(logoutCalls, 1);
  assert.equal(reloadCalls, 1);
  assert.ok(Number(context.localStorage.values['ogawaya:liff-reauth-attempted-at']) > 0);
});

test('GitHub Pages app は全件完了済みでも外部エフェクトに依存せず描画する', async () => {
  const checkedItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'checked',
    checkedBy: '田中LINE',
    checkedByUserId: 'line-user-001',
    checkedAt: '2026-04-24T10:05:00Z',
    updatedAt: '2026-04-24T10:05:00Z'
  };
  let confettiCalls = 0;
  let todayRequestBody = null;
  const { document } = await loadPagesApp(async (url, options = {}) => {
    if (url === './config.json') {
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: false,
        clientFirestoreWriteEnabled: false,
        consistencyRefreshSeconds: 999,
        firebase: null
      });
    }
    const path = new URL(url).searchParams.get('path');
    if (path === 'api/checklists/today') {
      todayRequestBody = JSON.parse(options.body);
      return response(createChecklistPayload(checkedItem));
    }
    throw new Error(`unexpected request: ${url}`);
  }, {
    liff: {
      async init() {},
      isLoggedIn() {
        return true;
      },
      getIDToken() {
        return 'token';
      },
      getAccessToken() {
        return 'access-token';
      }
    },
    confetti() {
      confettiCalls += 1;
      throw new Error('confetti should not be required for completion rendering');
    }
  });

  assert.equal(document.elements['error-message'].textContent, '');
  assert.equal(document.elements['progress-ring-label'].textContent, '完了');
  assert.equal(document.elements['progress-ring-label'].classList.values.has('celebrating'), true);
  assert.ok(findByClassName(document.body, 'completion-confetti-layer'));
  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'checked')?.dataset.status,
    'checked'
  );
  assert.equal(confettiCalls, 0);
  assert.equal(todayRequestBody.authToken, 'token');
  assert.equal(todayRequestBody.accessToken, 'access-token');
  assert.equal(todayRequestBody.liffId, '2000000000-test');
});

test('GitHub Pages app は外部SDK未ロードでも Firestore REST snapshot でホームを描画する', async () => {
  const snapshotItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'checked',
    checkedBy: '田中LINE',
    checkedByUserId: 'line-user-001',
    checkedAt: '2026-04-24T10:05:00Z',
    updatedAt: '2026-04-24T10:05:00Z'
  };
  let todayRequestCount = 0;
  let firestoreSnapshotRequestCount = 0;
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: true,
        clientFirestoreWriteEnabled: false,
        consistencyRefreshSeconds: 999,
        firebase: {
          apiKey: 'test-key',
          authDomain: 'test.firebaseapp.com',
          projectId: 'test-project',
          appId: 'app'
        }
      });
    }
    if (String(url).startsWith('https://firestore.googleapis.com/')) {
      if (String(url).includes('/snapshots/')) {
        firestoreSnapshotRequestCount += 1;
        assert.match(String(url), /projects\/test-project\/databases\/\(default\)\/documents\/stores\/store-hashimoto\/runs\//);
        return firestoreRestDocument(createChecklistPayload(snapshotItem));
      }
      return response({ documents: [] });
    }
    const path = new URL(url).searchParams.get('path');
    if (path === 'api/checklists/today') {
      todayRequestCount += 1;
      return response(createChecklistPayload(snapshotItem));
    }
    if (path === 'api/client-events') {
      return response({ ok: true, statusCode: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  }, {
    liff: null,
    firebase: null
  });

  assert.equal(document.elements['progress-summary'].textContent, '1 / 1');
  assert.equal(document.elements['progress-ring-label'].textContent, '完了');
  assert.equal(firestoreSnapshotRequestCount, 1);
  assert.equal(todayRequestCount, 0);
});

test('GitHub Pages app は Firestore snapshot が未作成でも同日端末キャッシュでホームを描画する', async () => {
  const cachedItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'unchecked',
    checkedBy: null,
    checkedByUserId: null,
    checkedAt: null,
    updatedAt: '2026-04-24T10:00:00Z'
  };
  let firestoreSnapshotRequestCount = 0;
  let todayRequestCount = 0;
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: true,
        clientFirestoreWriteEnabled: false,
        consistencyRefreshSeconds: 999,
        firebase: {
          apiKey: 'test-key',
          authDomain: 'test.firebaseapp.com',
          projectId: 'test-project',
          appId: 'app'
        }
      });
    }
    if (String(url).startsWith('https://firestore.googleapis.com/')) {
      if (String(url).includes('/snapshots/')) {
        firestoreSnapshotRequestCount += 1;
        return responseWithStatus(404, { error: { code: 404, message: 'not found' } });
      }
      return response({ documents: [] });
    }
    const path = new URL(url).searchParams.get('path');
    if (path === 'api/checklists/today') {
      todayRequestCount += 1;
      return response(createChecklistPayload(cachedItem));
    }
    if (path === 'api/client-events') {
      return response({ ok: true, statusCode: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  }, {
    Date: createFixedDate('2026-04-24T02:00:00Z'),
    liff: null,
    firebase: null,
    localStorageValues: {
      'ogawaya:checklist-cache:v1': JSON.stringify({
        storeId: 'store-hashimoto',
        targetDate: '2026-04-24',
        checklist: createChecklistPayload(cachedItem)
      })
    }
  });

  assert.equal(document.elements['progress-summary'].textContent, '0 / 1');
  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'unchecked')?.dataset.status,
    'unchecked'
  );
  assert.equal(firestoreSnapshotRequestCount, 1);
  assert.equal(todayRequestCount, 0);
});

test('GitHub Pages app は debugTiming=1 で起動時間ウォーターフォールを描画する', async () => {
  const snapshotItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'unchecked',
    checkedBy: null,
    checkedByUserId: null,
    checkedAt: null,
    updatedAt: '2026-04-24T10:00:00Z'
  };
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: false,
        clientFirestoreWriteEnabled: false,
        consistencyRefreshSeconds: 999,
        firebase: {
          apiKey: 'test-key',
          authDomain: 'test.firebaseapp.com',
          projectId: 'test-project',
          appId: 'app'
        }
      });
    }
    if (String(url).startsWith('https://firestore.googleapis.com/')) {
      return firestoreRestDocument(createChecklistPayload(snapshotItem));
    }
    const path = new URL(url).searchParams.get('path');
    if (path === 'api/client-events') {
      return response({ ok: true, statusCode: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  }, {
    liff: null,
    firebase: null,
    location: {
      href: 'https://example.test/?debugTiming=1',
      search: '?debugTiming=1'
    },
    console: {
      debug() {},
      error() {},
      log() {},
      table() {},
      warn() {}
    }
  });

  await wait(80);

  assert.ok(findByClassName(document.body, 'boot-timing-panel'));
  assert.ok(findByClassName(document.body, 'boot-timing-bar'));
  assert.ok(flattenElements(document.body).some((node) => node.textContent === 'config.json'));
  assert.ok(flattenElements(document.body).some((node) => node.textContent === '初回描画まで'));
});

test('GitHub Pages app は GAS API の snapshot 同期状態を debugTiming に表示する', async () => {
  const item = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'unchecked',
    checkedBy: null,
    checkedByUserId: null,
    checkedAt: null,
    updatedAt: '2026-04-24T10:00:00Z'
  };
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: false,
        clientFirestoreWriteEnabled: false,
        consistencyRefreshSeconds: 999,
        firebase: null
      });
    }
    const path = new URL(url).searchParams.get('path');
    if (path === 'api/checklists/today') {
      return response(Object.assign(createChecklistPayload(item), {
        snapshotSync: {
          status: 'error',
          responseCode: 502,
          statusCode: 502,
          message: 'Firestore snapshot の保存に失敗しました',
          response: 'bad gateway from firestore'
        }
      }));
    }
    if (path === 'api/client-events') {
      return response({ ok: true, statusCode: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  }, {
    Date: createFixedDate('2026-04-24T02:00:00Z'),
    location: {
      href: 'https://example.test/?debugTiming=1',
      search: '?debugTiming=1'
    },
    console: {
      debug() {},
      error() {},
      log() {},
      table() {},
      warn() {}
    }
  });

  await wait(80);

  assert.ok(
    flattenElements(document.body).some((node) => String(node.textContent || '').includes('snapshotSync=error'))
  );
  assert.ok(
    flattenElements(document.body).some((node) => String(node.textContent || '').includes('snapshotHttpStatus=502'))
  );
  assert.ok(
    flattenElements(document.body).some((node) => String(node.textContent || '').includes('snapshotResponse=bad gateway from firestore'))
  );
});

test('GitHub Pages app は古い再取得レスポンスで新しいチェック状態を戻さない', async () => {
  const initialItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'unchecked',
    checkedBy: null,
    checkedByUserId: null,
    checkedAt: null,
    updatedAt: '2026-04-24T10:00:00Z'
  };
  const checkedItem = {
    ...initialItem,
    status: 'checked',
    checkedBy: '田中LINE',
    checkedByUserId: 'line-user-001',
    checkedAt: '2026-04-24T10:05:00Z',
    updatedAt: '2026-04-24T10:05:00Z'
  };
  const staleRefreshItem = {
    ...initialItem,
    updatedAt: ''
  };
  const requestedPaths = [];
  let todayRequestCount = 0;
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      requestedPaths.push(url);
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: false,
        clientFirestoreWriteEnabled: false,
        consistencyRefreshSeconds: 999,
        firebase: null
      });
    }
    const path = new URL(url).searchParams.get('path');
    requestedPaths.push(path || url);
    if (path === 'api/checklists/today') {
      todayRequestCount += 1;
      return response(createChecklistPayload(todayRequestCount === 1 ? initialItem : staleRefreshItem));
    }
    if (path === 'api/checklist-items/run-item-001/check') {
      return response({
        ok: true,
        statusCode: 200,
        item: checkedItem
      });
    }
    throw new Error(`unexpected request: ${url}`);
  });

  const checkButton = findByDataset(document.elements['checklist-items'], 'action', 'check');
  assert.ok(checkButton);
  checkButton.click();
  await wait(300);

  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'checked')?.dataset.status,
    'checked',
    JSON.stringify({ requestedPaths, statuses: datasetValues(document.elements['checklist-items'], 'status') })
  );

  document.elements['refresh-button'].click();
  await wait(30);

  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'checked')?.dataset.status,
    'checked',
    JSON.stringify({ requestedPaths, statuses: datasetValues(document.elements['checklist-items'], 'status') })
  );
  assert.deepEqual(requestedPaths.filter((path) => path === 'api/checklists/today').length, 2);
});

test('GitHub Pages app は同じLINEユーザーの別端末 realtime event を反映する', async () => {
  const initialItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'unchecked',
    checkedBy: null,
    checkedByUserId: null,
    checkedAt: null,
    updatedAt: '2026-04-24T10:00:00Z'
  };
  let realtimeListener = null;
  const firebase = createFakeFirebase([], {
    onSnapshotImpl(pathParts, next) {
      if (pathParts.at(-1) === 'events') {
        realtimeListener = next;
      }
      return function unsubscribe() {};
    }
  });
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: true,
        clientFirestoreWriteEnabled: true,
        consistencyRefreshSeconds: 999,
        firebase: {
          apiKey: 'test-key',
          authDomain: 'test.firebaseapp.com',
          projectId: 'test-project',
          appId: 'test-app'
        }
      });
    }
    if (String(url).startsWith('https://firestore.googleapis.com/')) {
      return responseWithStatus(404, { error: { code: 404, message: 'not found' } });
    }
    const path = new URL(url).searchParams.get('path');
    if (path === 'api/checklists/today') {
      return response(createChecklistPayload(initialItem));
    }
    if (path === 'api/client-events') {
      return response({ ok: true, statusCode: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  }, { firebase });

  assert.equal(typeof realtimeListener, 'function');
  realtimeListener({
    docChanges() {
      return [
        {
          type: 'added',
          doc: {
            data() {
              return {
                runId: 'run-001',
                targetDate: '2026-04-24',
                storeId: 'store-hashimoto',
                itemId: 'run-item-001',
                status: 'checked',
                checkedBy: '田中LINE',
                checkedByUserId: 'line-user-001',
                checkedAt: '2026-04-24T10:05:00Z',
                updatedAt: '2026-04-24T10:05:00Z',
                emittedAt: '2026-04-24T10:05:01Z',
                sourceUserId: 'line-user-001',
                sourceClientId: 'other-client'
              };
            }
          }
        }
      ];
    }
  });
  await wait(30);

  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'checked')?.dataset.status,
    'checked',
    JSON.stringify({ statuses: datasetValues(document.elements['checklist-items'], 'status') })
  );
});

test('GitHub Pages app は Firestore 直接書き込み成功時にGAS保存完了を待たずに表示を確定する', async () => {
  const initialItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'unchecked',
    checkedBy: null,
    checkedByUserId: null,
    checkedAt: null,
    updatedAt: '2026-04-24T10:00:00Z'
  };
  const firestoreWrites = [];
  const requestedPaths = [];
  const firebase = createFakeFirebase(firestoreWrites);
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      requestedPaths.push(url);
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: true,
        clientFirestoreWriteEnabled: true,
        consistencyRefreshSeconds: 999,
        firebase: {
          apiKey: 'test-key',
          authDomain: 'test.firebaseapp.com',
          projectId: 'test-project',
          appId: 'test-app'
        }
      });
    }
    const path = new URL(url).searchParams.get('path');
    requestedPaths.push(path || url);
    if (path === 'api/client-events') {
      return response({ ok: true, statusCode: 200 });
    }
    if (path === 'api/checklists/today') {
      return response(createChecklistPayload(initialItem));
    }
    if (path === 'api/checklist-items/run-item-001/check') {
      throw new Error('GAS保存は即時UI確定の前に呼ばれない');
    }
    throw new Error(`unexpected request: ${url}`);
  }, { firebase });

  const checkButton = findByDataset(document.elements['checklist-items'], 'action', 'check');
  assert.ok(checkButton);
  checkButton.click();
  await wait(300);

  assert.equal(firestoreWrites.length, 1);
  assert.equal(firestoreWrites[0].itemId, 'run-item-001');
  assert.equal(firestoreWrites[0].status, 'checked');
  assert.equal(firestoreWrites[0].checkedBy, '田中LINE');
  assert.match(firestoreWrites[0].sourceClientId, /^client-/);
  assert.deepEqual(firestoreWrites[0].updatedAt, { __type: 'serverTimestamp' });
  assert.deepEqual(firestoreWrites[0].emittedAt, { __type: 'serverTimestamp' });
  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'checked')?.dataset.status,
    'checked',
    JSON.stringify({ requestedPaths, statuses: datasetValues(document.elements['checklist-items'], 'status') })
  );
  assert.equal(requestedPaths.includes('api/checklist-items/run-item-001/check'), false);
});

test('GitHub Pages app は sourceClientId 未許可Rulesでも旧payloadでFirestore同期する', async () => {
  const initialItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'unchecked',
    checkedBy: null,
    checkedByUserId: null,
    checkedAt: null,
    updatedAt: '2026-04-24T10:00:00Z'
  };
  const firestoreWrites = [];
  const requestedPaths = [];
  const firebase = createFakeFirebase(firestoreWrites, {
    addImpl(payload) {
      if (Object.prototype.hasOwnProperty.call(payload, 'sourceClientId')) {
        const error = new Error('sourceClientId is not allowed by deployed rules');
        error.code = 'permission-denied';
        return Promise.reject(error);
      }
      firestoreWrites.push(payload);
      return Promise.resolve({ id: `event-${firestoreWrites.length}` });
    }
  });
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      requestedPaths.push(url);
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: true,
        clientFirestoreWriteEnabled: true,
        consistencyRefreshSeconds: 999,
        firebase: {
          apiKey: 'test-key',
          authDomain: 'test.firebaseapp.com',
          projectId: 'test-project',
          appId: 'test-app'
        }
      });
    }
    const path = new URL(url).searchParams.get('path');
    requestedPaths.push(path || url);
    if (path === 'api/client-events') {
      return response({ ok: true, statusCode: 200 });
    }
    if (path === 'api/checklists/today') {
      return response(createChecklistPayload(initialItem));
    }
    if (path === 'api/checklist-items/run-item-001/check') {
      throw new Error('旧Rules互換のFirestore再試行に成功するためGAS同期へfallbackしない');
    }
    throw new Error(`unexpected request: ${url}`);
  }, { firebase });

  const checkButton = findByDataset(document.elements['checklist-items'], 'action', 'check');
  assert.ok(checkButton);
  checkButton.click();
  await wait(300);

  assert.equal(firestoreWrites.length, 1);
  assert.equal(firestoreWrites[0].itemId, 'run-item-001');
  assert.equal(firestoreWrites[0].status, 'checked');
  assert.equal(Object.prototype.hasOwnProperty.call(firestoreWrites[0], 'sourceClientId'), false);
  assert.equal(requestedPaths.includes('api/checklist-items/run-item-001/check'), false);
  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'checked')?.dataset.status,
    'checked',
    JSON.stringify({ requestedPaths, statuses: datasetValues(document.elements['checklist-items'], 'status') })
  );
});

test('GitHub Pages app は Firestore 直接書き込み失敗時にGAS同期へfallbackする', async () => {
  const initialItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'unchecked',
    checkedBy: null,
    checkedByUserId: null,
    checkedAt: null,
    updatedAt: '2026-04-24T10:00:00Z'
  };
  const checkedItem = {
    ...initialItem,
    status: 'checked',
    checkedBy: '田中LINE',
    checkedByUserId: 'line-user-001',
    checkedAt: '2026-04-24T10:05:00Z',
    updatedAt: '2026-04-24T10:05:00Z'
  };
  const requestedPaths = [];
  const firebase = createFakeFirebase([], {
    addImpl() {
      const error = new Error('quota exceeded');
      error.code = 'resource-exhausted';
      return Promise.reject(error);
    }
  });
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      requestedPaths.push(url);
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: true,
        clientFirestoreWriteEnabled: true,
        consistencyRefreshSeconds: 999,
        firebase: {
          apiKey: 'test-key',
          authDomain: 'test.firebaseapp.com',
          projectId: 'test-project',
          appId: 'test-app'
        }
      });
    }
    const path = new URL(url).searchParams.get('path');
    requestedPaths.push(path || url);
    if (path === 'api/client-events') {
      return response({ ok: true, statusCode: 200 });
    }
    if (path === 'api/checklists/today') {
      return response(createChecklistPayload(initialItem));
    }
    if (path === 'api/checklist-items/run-item-001/check') {
      return response({
        ok: true,
        statusCode: 200,
        item: checkedItem
      });
    }
    throw new Error(`unexpected request: ${url}`);
  }, { firebase });

  const checkButton = findByDataset(document.elements['checklist-items'], 'action', 'check');
  assert.ok(checkButton);
  checkButton.click();
  await wait(400);

  assert.equal(requestedPaths.includes('api/checklist-items/run-item-001/check'), true);
  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'checked')?.dataset.status,
    'checked',
    JSON.stringify({ requestedPaths, statuses: datasetValues(document.elements['checklist-items'], 'status') })
  );
});

test('GitHub Pages app は古い再取得レスポンスで新しい未チェック状態を戻さない', async () => {
  const initialItem = {
    id: 'run-item-001',
    title: '開店準備',
    description: '券売機を確認する',
    status: 'checked',
    checkedBy: '田中LINE',
    checkedByUserId: 'line-user-001',
    checkedAt: '2026-04-24T10:05:00Z',
    updatedAt: '2026-04-24T10:05:00Z'
  };
  const uncheckedItem = {
    ...initialItem,
    status: 'unchecked',
    checkedBy: null,
    checkedByUserId: null,
    checkedAt: null,
    updatedAt: '2026-04-24T10:10:00Z'
  };
  const staleRefreshItem = {
    ...initialItem,
    updatedAt: ''
  };
  const requestedPaths = [];
  let todayRequestCount = 0;
  const { document } = await loadPagesApp(async (url) => {
    if (url === './config.json') {
      requestedPaths.push(url);
      return response({
        gasApiBaseUrl: 'https://gas.example/exec',
        functionsApiBaseUrl: '',
        liffId: '2000000000-test',
        defaultStoreId: 'store-hashimoto',
        allowAnonymousAccess: false,
        tryLiffAuthInAnonymous: false,
        enableRealtimeSync: false,
        clientFirestoreWriteEnabled: false,
        consistencyRefreshSeconds: 999,
        firebase: null
      });
    }
    const path = new URL(url).searchParams.get('path');
    requestedPaths.push(path || url);
    if (path === 'api/checklists/today') {
      todayRequestCount += 1;
      return response(createChecklistPayload(todayRequestCount === 1 ? initialItem : staleRefreshItem));
    }
    if (path === 'api/checklist-items/run-item-001/uncheck') {
      return response({
        ok: true,
        statusCode: 200,
        item: uncheckedItem
      });
    }
    throw new Error(`unexpected request: ${url}`);
  });

  const uncheckButton = findByDataset(document.elements['checklist-items'], 'action', 'uncheck');
  assert.ok(uncheckButton);
  uncheckButton.click();
  await wait(300);

  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'unchecked')?.dataset.status,
    'unchecked',
    JSON.stringify({ requestedPaths, statuses: datasetValues(document.elements['checklist-items'], 'status') })
  );

  document.elements['refresh-button'].click();
  await wait(30);

  assert.equal(
    findByDataset(document.elements['checklist-items'], 'status', 'unchecked')?.dataset.status,
    'unchecked',
    JSON.stringify({ requestedPaths, statuses: datasetValues(document.elements['checklist-items'], 'status') })
  );
  assert.deepEqual(requestedPaths.filter((path) => path === 'api/checklists/today').length, 2);
});
