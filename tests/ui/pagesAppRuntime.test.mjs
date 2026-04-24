import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class FakeClassList {
  constructor() {
    this.values = new Set();
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
    this.children.push(child);
    return child;
  }

  addEventListener(eventName, handler) {
    this.listeners[eventName] = handler;
  }

  setAttribute(name, value) {
    this._attributes[name] = String(value);
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
    readyState: 'complete',
    visibilityState: 'visible',
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
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

async function loadPagesApp(fetchHandler) {
  const documentRef = createFakeDocument();
  const appJs = await readFile('pages/app.js', 'utf8');
  const context = {
    globalThis: {},
    document: documentRef,
    location: { href: '' },
    localStorage: {
      values: {},
      getItem(key) {
        return this.values[key] || '';
      },
      setItem(key, value) {
        this.values[key] = String(value);
      }
    },
    liff: {
      async init() {},
      isLoggedIn() {
        return true;
      },
      getIDToken() {
        return 'token';
      }
    },
    fetch: fetchHandler,
    setTimeout(handler, ms) {
      const timer = setTimeout(handler, ms);
      timer.unref();
      return timer;
    },
    clearTimeout,
    setInterval(handler, ms) {
      const timer = setInterval(handler, ms);
      timer.unref();
      return timer;
    },
    clearInterval,
    addEventListener() {},
    console,
    Intl,
    Date
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
