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
    this.checked = false;
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
    if (this.tagName === 'select' && child.tagName === 'option' && !this.value) {
      this.value = child.value;
    }
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

  contains(node) {
    if (!node) {
      return false;
    }
    if (node === this) {
      return true;
    }
    for (const child of this.children) {
      if (child === node) {
        return true;
      }
      if (child && typeof child.contains === 'function' && child.contains(node)) {
        return true;
      }
    }
    return false;
  }

  click() {
    if (this.listeners.click) {
      return this.listeners.click({
        preventDefault() {},
        stopPropagation() {},
        target: this
      });
    }
    return undefined;
  }

  trigger(eventName) {
    if (this.listeners[eventName]) {
      return this.listeners[eventName]({
        preventDefault() {},
        stopPropagation() {},
        target: this
      });
    }
    return undefined;
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
    ['div', 'role-badge'],
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
    ['h2', 'task-detail-title'],
    ['p', 'task-detail-description'],
    ['div', 'task-detail-meta'],
    ['section', 'main-content'],
    ['section', 'link-panel'],
    ['input', 'link-employee-code-input'],
    ['input', 'link-passcode-input'],
    ['button', 'link-account-button'],
    ['button', 'refresh-button'],
    ['section', 'admin-panel'],
    ['div', 'screen-mode'],
    ['div', 'incomplete-summary'],
    ['ul', 'incomplete-items'],
    ['button', 'load-logs-button'],
    ['select', 'log-action-filter'],
    ['ul', 'logs-list'],
    ['button', 'notify-button'],
    ['select', 'template-select'],
    ['input', 'template-name-input'],
    ['button', 'update-template-button'],
    ['input', 'new-template-name-input'],
    ['button', 'create-template-button'],
    ['ul', 'template-items'],
    ['select', 'template-item-select'],
    ['input', 'template-item-title-input'],
    ['input', 'template-item-description-input'],
    ['select', 'template-item-period-input'],
    ['input', 'template-item-sort-order-input'],
    ['input', 'template-item-required-input'],
    ['button', 'update-template-item-button'],
    ['button', 'delete-template-item-button'],
    ['input', 'new-item-title-input'],
    ['input', 'new-item-description-input'],
    ['select', 'new-item-period-input'],
    ['input', 'new-item-sort-order-input'],
    ['input', 'new-item-required-input'],
    ['button', 'add-template-item-button'],
    ['button', 'tab-home'],
    ['button', 'tab-stats'],
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
    ['button', 'stats-next-month']
  ].forEach(([tagName, id]) => register(tagName, id));

  elements['template-item-required-input'].type = 'checkbox';
  elements['new-item-required-input'].type = 'checkbox';
  elements['template-item-period-input'].value = 'daily';
  elements['new-item-period-input'].value = 'daily';
  elements['period-tab-daily'].dataset.period = 'daily';
  elements['period-tab-weekly'].dataset.period = 'weekly';
  elements['period-tab-monthly'].dataset.period = 'monthly';

  return {
    elements,
    body,
    getElementById(id) {
      return elements[id];
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    }
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

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadClientModule() {
  const html = await readFile('gas/src/liff/shared/client.html', 'utf8');
  const script = html.match(/<script>([\s\S]+)<\/script>/)[1];
  const context = {
    globalThis: {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  return {
    client: context.OgawayaLiff,
    context
  };
}

function createChecklistPayload(overrides = {}) {
  return {
    runId: 'run-001',
    templateId: 'tmpl-001',
    storeName: '青山店',
    targetDate: '2026-04-21',
    status: 'open',
    progress: {
      checked: 1,
      total: 2
    },
    items: [
      {
        id: 'run-item-001',
        title: '開店準備',
        description: '券売機と入口を確認する',
        status: 'unchecked',
        checkedBy: null,
        checkedByUserId: null,
        checkedAt: null
      },
      {
        id: 'run-item-002',
        title: '清掃確認',
        description: '客席と厨房の床を確認する',
        status: 'checked',
        checkedBy: '田中 花子',
        checkedByUserId: 'user-pt-001',
        checkedAt: '2026-04-21T10:35:00Z'
      }
    ],
    ...overrides
  };
}

function createIncompletePayload(items = [{ id: 'run-item-001', title: '開店準備' }]) {
  return {
    runId: 'run-001',
    targetDate: '2026-04-21',
    items
  };
}

function createLogsPayload(action = 'check') {
  return {
    logs: [
      {
        id: 'log-001',
        runItemId: 'run-item-001',
        action,
        userId: 'user-pt-001',
        beforeValue: {},
        afterValue: {},
        isAfterClose: false,
        createdAt: '2026-04-21T10:35:00Z'
      }
    ]
  };
}

function createMonthlyStatsPayload(overrides = {}) {
  return {
    year: 2026,
    month: 4,
    totalDays: 1,
    achievedDays: 0,
    totalItems: 2,
    myCheckedItems: 1,
    calendar: [
      {
        date: '2026-04-21',
        total: 2,
        checked: 1,
        achieved: false
      }
    ],
    ...overrides
  };
}

function createTemplatesPayload() {
  return {
    templates: [
      {
        id: 'tmpl-001',
        name: '日次チェックリスト',
        notifyTime: '10:30',
        closingTime: '00:00',
        isActive: true,
        items: [
          {
            id: 'tmpl-item-001',
            title: '開店準備',
            description: '',
            sortOrder: 1,
            isRequired: true
          }
        ]
      }
    ]
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test('匿名アクセス有効時は LIFF SDK なしでも初期化できる', async () => {
  const { client, context } = await loadClientModule();
  context.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = true;
  const auth = client.createAuth();

  const result = await auth.initialize();

  assert.equal(result.idToken, '');
  assert.equal(result.context.isAnonymous, true);
});

test('匿名アクセス有効でも LIFF idToken が取れる場合は認証コンテキストを使う', async () => {
  const { client, context } = await loadClientModule();
  context.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = true;
  context.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = true;
  context.OGAWAYA_LIFF_ID = '2000000000-test';
  context.liff = {
    async init() {},
    getIDToken() {
      return 'token-from-liff';
    },
    isInClient() {
      return true;
    },
    isLoggedIn() {
      return true;
    },
    getOS() {
      return 'ios';
    },
    getLineVersion() {
      return '1.0.0';
    },
    getLanguage() {
      return 'ja';
    }
  };
  const auth = client.createAuth();

  const result = await auth.initialize();

  assert.equal(result.idToken, 'token-from-liff');
  assert.equal(result.context.isAnonymous, false);
  assert.equal(result.context.isInClient, true);
});

test('匿名アクセス有効で LIFF_ID に URL を入れても ID を抽出して初期化できる', async () => {
  const { client, context } = await loadClientModule();
  let capturedLiffId = '';
  context.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = true;
  context.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = true;
  context.OGAWAYA_LIFF_ID = 'https://liff.line.me/2000000000-test';
  context.liff = {
    async init(config) {
      capturedLiffId = config.liffId;
    },
    getIDToken() {
      return 'token-from-liff';
    },
    isInClient() {
      return true;
    },
    isLoggedIn() {
      return true;
    },
    getOS() {
      return 'ios';
    },
    getLineVersion() {
      return '1.0.0';
    },
    getLanguage() {
      return 'ja';
    }
  };
  const auth = client.createAuth();

  const result = await auth.initialize();

  assert.equal(capturedLiffId, '2000000000-test');
  assert.equal(result.idToken, 'token-from-liff');
  assert.equal(result.context.isAnonymous, false);
});

test('匿名アクセス有効かつ LIFF_ID が空白だけなら匿名へフォールバックする', async () => {
  const { client, context } = await loadClientModule();
  let initCalled = false;
  context.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = true;
  context.OGAWAYA_LIFF_ID = '   ';
  context.liff = {
    async init() {
      initCalled = true;
    },
    getIDToken() {
      return 'token-from-liff';
    }
  };
  const auth = client.createAuth();

  const result = await auth.initialize();

  assert.equal(initCalled, false);
  assert.equal(result.idToken, '');
  assert.equal(result.context.isAnonymous, true);
});

test('匿名アクセス有効かつ LIFF_ID が不正形式なら匿名へフォールバックする', async () => {
  const { client, context } = await loadClientModule();
  let initCalled = false;
  context.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = true;
  context.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = true;
  context.OGAWAYA_LIFF_ID = 'invalid-liff-id';
  context.liff = {
    async init() {
      initCalled = true;
    },
    getIDToken() {
      return 'token-from-liff';
    }
  };
  const auth = client.createAuth();

  const result = await auth.initialize();

  assert.equal(initCalled, false);
  assert.equal(result.idToken, '');
  assert.equal(result.context.isAnonymous, true);
});

test('匿名アクセス有効で liff.init が失敗しても匿名へフォールバックする', async () => {
  const { client, context } = await loadClientModule();
  context.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = true;
  context.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = true;
  context.OGAWAYA_LIFF_ID = '2009859108-sJ31BCFx';
  context.liff = {
    async init() {
      const error = new Error('liffId is necessary for liff.init()');
      error.code = 'INVALID_CONFIG';
      throw error;
    },
    getIDToken() {
      return 'token-from-liff';
    }
  };
  const auth = client.createAuth();

  const result = await auth.initialize();

  assert.equal(result.idToken, '');
  assert.equal(result.context.isAnonymous, true);
});

test('匿名アクセス有効で liff.init がハングしても匿名へフォールバックする', async () => {
  const { client, context } = await loadClientModule();
  context.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = true;
  context.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = true;
  context.OGAWAYA_LIFF_ID = '2009859108-sJ31BCFx';
  context.OGAWAYA_LIFF_INIT_TIMEOUT_MS = 10;
  context.liff = {
    init() {
      return new Promise(() => {});
    },
    getIDToken() {
      return 'token-from-liff';
    }
  };
  const auth = client.createAuth();
  const startedAt = Date.now();

  const result = await auth.initialize();
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.idToken, '');
  assert.equal(result.context.isAnonymous, true);
  assert.ok(elapsedMs < 500);
});

test('LIFF 初期化失敗時はユーザー向けエラーを表示する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        throw new Error('LIFF の初期化に失敗しました');
      }
    },
    api: {
      async getMe() {
        throw new Error('not used');
      }
    },
    mode: 'user'
  });

  await controller.init();

  assert.equal(documentRef.elements['error-message'].dataset.visible, 'true');
  assert.match(documentRef.elements['error-message'].textContent, /LIFF/);
});

test('/api/me 取得失敗時はエラーを表示する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getTodayChecklist() {
        return createChecklistPayload({
          currentUser: null
        });
      },
      async getMe() {
        throw new Error('未認証です');
      }
    },
    mode: 'user'
  });

  await controller.init();

  assert.equal(documentRef.elements['error-message'].dataset.visible, 'true');
  assert.match(documentRef.elements['error-message'].textContent, /未認証/);
});

test('/api/me が unauthorized(401) のときは連携フォームを表示する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getTodayChecklist() {
        return createChecklistPayload({
          currentUser: null
        });
      },
      async getMe() {
        const error = new Error('LIFF 認証コンテキストがありません');
        error.code = 'unauthorized';
        error.statusCode = 401;
        throw error;
      }
    },
    mode: 'user'
  });

  await controller.init();

  assert.equal(documentRef.elements['link-panel'].hidden, false);
  assert.equal(documentRef.elements['main-content'].hidden, true);
  assert.equal(documentRef.elements['status-message'].dataset.visible, 'true');
});

test('/api/checklists/today に currentUser が含まれる場合は /api/me を呼ばない', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  let getMeCallCount = 0;
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getTodayChecklist() {
        return createChecklistPayload({
          currentUser: {
            userId: 'user-ad-001',
            name: '管理者 太郎',
            role: 'admin',
            store: { id: 'store-001', name: '青山店' }
          }
        });
      },
      async getTodayIncomplete() {
        return createIncompletePayload();
      },
      async getMe() {
        getMeCallCount += 1;
        return {
          userId: 'user-ad-001',
          role: 'admin',
          store: { id: 'store-001', name: '青山店' }
        };
      }
    },
    mode: 'admin'
  });

  await controller.init();

  assert.equal(getMeCallCount, 0);
  assert.equal(controller.getState().me.userId, 'user-ad-001');
});

test('renderRole は no-op で、表示はチェック画面に固定する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-mg-001',
          role: 'manager',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        return createChecklistPayload();
      },
      async getTodayIncomplete() {
        return createIncompletePayload();
      }
    },
    mode: 'admin'
  });

  await controller.init();

  controller.renderRole('part_time');
  assert.equal(documentRef.elements['screen-mode'].textContent, 'チェック LIFF');
});

test('更新ボタンで today を再取得し、incomplete は today から再計算する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  let checklistCallCount = 0;
  let incompleteCallCount = 0;
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-ad-001',
          role: 'admin',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        checklistCallCount += 1;
        return createChecklistPayload();
      },
      async getTodayIncomplete() {
        incompleteCallCount += 1;
        return createIncompletePayload();
      },
      async getLogs() {
        return createLogsPayload();
      },
      async listTemplates() {
        return createTemplatesPayload();
      }
    },
    mode: 'admin'
  });

  await controller.init();
  assert.equal(checklistCallCount, 1);
  assert.equal(incompleteCallCount, 0);

  await documentRef.elements['refresh-button'].click();
  assert.equal(checklistCallCount, 2);
  assert.equal(incompleteCallCount, 0);
});

test('createApi は GAS 応答の ok=false をエラーとして扱う', async () => {
  const { client, context } = await loadClientModule();
  const api = client.createApi('https://example.com/exec');
  context.fetch = async () => ({
    ok: true,
    async json() {
      return {
        ok: false,
        statusCode: 401,
        message: '未認証です'
      };
    }
  });

  await assert.rejects(
    api.getMe('token'),
    /未認証/
  );
});

test('createApi は google.script.run が使える場合に GAS ブリッジを優先する', async () => {
  const { client, context } = await loadClientModule();
  const api = client.createApi('https://example.com/exec');
  let calledRequest = null;
  let fetchCalled = false;

  context.fetch = async () => {
    fetchCalled = true;
    return {
      ok: true,
      async json() {
        return { ok: true, statusCode: 200 };
      }
    };
  };
  context.google = {
    script: {
      run: {
        withSuccessHandler(handler) {
          this.successHandler = handler;
          return this;
        },
        withFailureHandler(handler) {
          this.failureHandler = handler;
          return this;
        },
        handleClientApi(request) {
          calledRequest = request;
          this.successHandler({
            ok: true,
            statusCode: 200,
            userId: 'user-001'
          });
        }
      }
    }
  };

  const payload = await api.getMe('token');

  assert.equal(fetchCalled, false);
  assert.deepEqual(toPlainJson(calledRequest), {
    method: 'GET',
    path: '/api/me',
    query: {
      idToken: 'token'
    },
    body: {}
  });
  assert.equal(payload.userId, 'user-001');
});

test('createApi は google.script.run 経由の API エラーをそのまま扱う', async () => {
  const { client, context } = await loadClientModule();
  const api = client.createApi('https://example.com/exec');

  context.google = {
    script: {
      run: {
        withSuccessHandler(handler) {
          this.successHandler = handler;
          return this;
        },
        withFailureHandler(handler) {
          this.failureHandler = handler;
          return this;
        },
        handleClientApi() {
          this.successHandler({
            ok: false,
            statusCode: 401,
            code: 'unauthorized',
            message: '未認証です'
          });
        }
      }
    }
  };

  await assert.rejects(api.getMe('token'), /未認証です/);
});

test('createApi は checklist 操作と履歴 API を呼び分ける', async () => {
  const { client, context } = await loadClientModule();
  const calls = [];
  const api = client.createApi('https://example.com/exec/');
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { ok: true, statusCode: 200 };
      }
    };
  };

  await api.checkItem('token', 'run-item-001', { comment: '確認済み' });
  await api.uncheckItem('token', 'run-item-001', { reason: '再確認' });
  await api.getTodayIncomplete('token');

  assert.equal(calls[0].url, 'https://example.com/exec/api/checklist-items/run-item-001/check');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { comment: '確認済み', authToken: 'token' });
  assert.equal(calls[1].url, 'https://example.com/exec/api/checklist-items/run-item-001/uncheck');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { reason: '再確認', authToken: 'token' });
  assert.equal(calls[2].url, 'https://example.com/exec/api/checklists/today/incomplete?_method=GET');
  assert.equal(calls[2].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].options.body), { authToken: 'token' });
});

test('チェック操作で UI と未完了一覧を更新する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  let checklistCallCount = 0;
  const checklistResponses = [
    createChecklistPayload(),
    createChecklistPayload({
      progress: {
        checked: 2,
        total: 2
      },
      items: [
        {
          id: 'run-item-001',
          title: '開店準備',
          status: 'checked',
          checkedBy: '田中 花子',
          checkedByUserId: 'user-pt-001',
          checkedAt: '2026-04-21T10:36:00Z'
        }
      ]
    })
  ];
  const incompleteResponses = [
    createIncompletePayload(),
    createIncompletePayload([])
  ];
  const calls = [];
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-pt-001',
          role: 'part_time',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        checklistCallCount += 1;
        return checklistResponses.shift();
      },
      async getTodayIncomplete() {
        return incompleteResponses.shift();
      },
      async checkItem(idToken, runItemId, body) {
        calls.push({ idToken, runItemId, body });
        return { item: { id: runItemId, status: 'checked' } };
      },
      async uncheckItem() {
        return { item: { id: 'run-item-001', status: 'unchecked' } };
      }
    },
    mode: 'user'
  });

  await controller.init();

  const uncheckedItem = findByDataset(documentRef.elements['checklist-items'], 'status', 'unchecked');
  assert.ok(uncheckedItem);
  assert.equal(uncheckedItem.tagName, 'li');

  const checkButton = findByDataset(documentRef.elements['checklist-items'], 'action', 'check');
  assert.ok(checkButton);
  assert.equal(checkButton.tagName, 'button');

  await checkButton.click();

  assert.deepEqual(toPlainJson(calls[0]), {
    idToken: 'token',
    runItemId: 'run-item-001',
    body: {
      comment: ''
    }
  });
  assert.equal(documentRef.elements['progress-summary'].textContent, '2 / 2');
  assert.equal(documentRef.elements['progress-ring-label'].textContent, '完了');
  assert.equal(documentRef.elements['progress-ring-label'].classList.values.has('celebrating'), true);
  assert.ok(findByClassName(documentRef.body, 'completion-confetti-layer'));
  assert.equal(documentRef.elements['incomplete-summary'].textContent, '未完了 0 件');
  const checkedItem = findByDataset(documentRef.elements['checklist-items'], 'status', 'checked');
  assert.ok(checkedItem);
  assert.equal(checkedItem.tagName, 'li');
  assert.equal(checklistCallCount, 1);
});

test('チェック更新後は統計タブを再取得せず月間達成と自分の件数を即時同期する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  let getMonthlyStatsCallCount = 0;
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-pt-001',
          name: '田中 花子',
          role: 'part_time',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        return createChecklistPayload();
      },
      async getTodayIncomplete() {
        return createIncompletePayload();
      },
      async getMonthlyStats() {
        getMonthlyStatsCallCount += 1;
        return createMonthlyStatsPayload();
      },
      async checkItem(idToken, runItemId) {
        return {
          item: {
            id: runItemId,
            title: '開店準備',
            status: 'checked',
            checkedBy: '田中 花子',
            checkedByUserId: 'user-pt-001',
            checkedAt: '2026-04-21T10:36:00Z'
          }
        };
      },
      async uncheckItem() {
        return { item: { id: 'run-item-001', status: 'unchecked' } };
      }
    },
    mode: 'user'
  });

  await controller.init();
  documentRef.elements['tab-stats'].click();
  await flushPromises();

  assert.equal(getMonthlyStatsCallCount, 1);
  assert.match(findByClassName(documentRef.elements['stats-overall-info'], 'stats-info-sub').innerHTML, /0\/1日/);
  assert.equal(findByClassName(documentRef.elements['stats-mine-info'], 'stats-info-main').innerHTML, '1<em>件 / 2件</em>');

  documentRef.elements['tab-home'].click();
  const checkButton = findByDataset(documentRef.elements['checklist-items'], 'action', 'check');
  assert.ok(checkButton);
  await checkButton.click();
  await flushPromises();

  documentRef.elements['tab-stats'].click();
  await flushPromises();

  assert.equal(getMonthlyStatsCallCount, 1);
  assert.match(findByClassName(documentRef.elements['stats-overall-info'], 'stats-info-sub').innerHTML, /1\/1日/);
  assert.equal(findByClassName(documentRef.elements['stats-mine-info'], 'stats-info-main').innerHTML, '2<em>件 / 2件</em>');
});

test('ホームのタスクカード押下は詳細を表示しチェック API を呼ばない', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  let checkItemCallCount = 0;
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-pt-001',
          name: '田中 花子',
          role: 'part_time',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        return createChecklistPayload();
      },
      async getTodayIncomplete() {
        return createIncompletePayload();
      },
      async checkItem() {
        checkItemCallCount += 1;
        return { item: { id: 'run-item-001', status: 'checked' } };
      },
      async uncheckItem() {
        return { item: { id: 'run-item-001', status: 'unchecked' } };
      }
    },
    mode: 'user'
  });

  await controller.init();

  const uncheckedItem = findByDataset(documentRef.elements['checklist-items'], 'status', 'unchecked');
  assert.ok(uncheckedItem);
  await uncheckedItem.click();

  assert.equal(checkItemCallCount, 0);
  assert.equal(documentRef.elements['task-detail-panel'].hidden, false);
  assert.equal(documentRef.elements['task-detail-title'].textContent, '開店準備');
  assert.equal(documentRef.elements['task-detail-description'].textContent, '券売機と入口を確認する');
  assert.equal(documentRef.elements['task-detail-meta'].textContent, '日間 ・ 未完了');
});

test('ホームは期間タブで表示タスクとテーマを切り替える', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-pt-001',
          role: 'part_time',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        return createChecklistPayload({
          progress: {
            checked: 1,
            total: 2
          },
          progressByPeriod: {
            daily: { checked: 0, total: 1 },
            weekly: { checked: 1, total: 1 },
            monthly: { checked: 0, total: 0 }
          },
          items: [
            {
              id: 'run-item-daily',
              title: '毎日の確認',
              description: '',
              period: 'daily',
              status: 'unchecked',
              checkedBy: null,
              checkedByUserId: null,
              checkedAt: null
            },
            {
              id: 'run-item-weekly',
              title: '週間の確認',
              description: '',
              period: 'weekly',
              status: 'checked',
              checkedBy: '田中 花子',
              checkedByUserId: 'user-pt-001',
              checkedAt: '2026-04-21T10:35:00Z'
            }
          ]
        });
      },
      async getTodayIncomplete() {
        return createIncompletePayload();
      }
    },
    mode: 'user'
  });

  await controller.init();

  assert.equal(documentRef.body.dataset.taskPeriod, 'daily');
  assert.equal(documentRef.elements['progress-summary'].textContent, '0 / 1');
  assert.ok(findByDataset(documentRef.elements['checklist-items'], 'period', 'daily'));
  assert.equal(findByDataset(documentRef.elements['checklist-items'], 'period', 'weekly'), null);

  documentRef.elements['period-tab-weekly'].click();

  assert.equal(documentRef.body.dataset.taskPeriod, 'weekly');
  assert.equal(documentRef.elements['progress-summary'].textContent, '1 / 1');
  assert.ok(findByDataset(documentRef.elements['checklist-items'], 'period', 'weekly'));
  assert.equal(findByDataset(documentRef.elements['checklist-items'], 'period', 'daily'), null);

  documentRef.elements['period-tab-monthly'].click();

  assert.equal(documentRef.body.dataset.taskPeriod, 'monthly');
  assert.equal(documentRef.elements['checklist-items'].children[0].textContent, '月間タスクはありません。');
  assert.equal(documentRef.elements['progress-summary'].textContent, '0 / 0');
});

test('チェック操作は API 応答前でも UI を即時反映する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  let resolveCheck = null;
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-pt-001',
          name: '田中 花子',
          role: 'part_time',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        return createChecklistPayload();
      },
      async getTodayIncomplete() {
        return createIncompletePayload();
      },
      async checkItem() {
        return new Promise((resolve) => {
          resolveCheck = resolve;
        });
      },
      async uncheckItem() {
        return { item: { id: 'run-item-001', status: 'unchecked' } };
      }
    },
    mode: 'user'
  });

  await controller.init();

  const uncheckedItem = findByDataset(documentRef.elements['checklist-items'], 'status', 'unchecked');
  assert.ok(uncheckedItem);
  const checkButton = findByDataset(documentRef.elements['checklist-items'], 'action', 'check');
  assert.ok(checkButton);
  checkButton.click();

  assert.equal(documentRef.elements['progress-summary'].textContent, '2 / 2');
  assert.equal(documentRef.elements['incomplete-summary'].textContent, '未完了 0 件');
  const pendingItem = findByDataset(documentRef.elements['checklist-items'], 'pending', 'true');
  assert.ok(pendingItem);
  assert.equal(pendingItem.dataset.status, 'checked');

  resolveCheck({
    item: {
      id: 'run-item-001',
      title: '開店準備',
      status: 'checked',
      checkedBy: '田中 花子',
      checkedByUserId: 'user-pt-001',
      checkedAt: '2026-04-21T10:36:00Z'
    }
  });
  await Promise.resolve();
  await Promise.resolve();
});

test('idToken なしの状態ではチェック更新を拒否し API を呼ばない', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  let checkItemCallCount = 0;
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: '' };
      }
    },
    api: {
      async getTodayChecklist() {
        return createChecklistPayload({
          currentUser: {
            userId: 'anonymous',
            name: '匿名ユーザー',
            role: '',
            store: { id: 'store-001', name: '青山店' }
          }
        });
      },
      async checkItem() {
        checkItemCallCount += 1;
        return { item: { id: 'run-item-001', status: 'checked' } };
      },
      async uncheckItem() {
        return { item: { id: 'run-item-001', status: 'unchecked' } };
      }
    },
    mode: 'user'
  });

  await controller.init();

  const uncheckedItem = findByDataset(documentRef.elements['checklist-items'], 'status', 'unchecked');
  assert.ok(uncheckedItem);

  const checkButton = findByDataset(documentRef.elements['checklist-items'], 'action', 'check');
  assert.ok(checkButton);
  await checkButton.click();

  assert.equal(checkItemCallCount, 0);
  assert.equal(documentRef.elements['error-message'].dataset.visible, 'true');
  assert.match(documentRef.elements['error-message'].textContent, /LINE認証/);
});

test('管理者は UI から他人のチェックを取り消せる', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  const checklistResponses = [
    createChecklistPayload({
      items: [
        {
          id: 'run-item-001',
          title: '開店準備',
          status: 'checked',
          checkedBy: '田中 花子',
          checkedByUserId: 'user-pt-001',
          checkedAt: '2026-04-21T10:35:00Z'
        }
      ]
    }),
    createChecklistPayload({
      progress: {
        checked: 0,
        total: 1
      },
      items: [
        {
          id: 'run-item-001',
          title: '開店準備',
          status: 'unchecked',
          checkedBy: null,
          checkedByUserId: null,
          checkedAt: null
        }
      ]
    })
  ];
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-mg-001',
          role: 'manager',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        return checklistResponses.shift();
      },
      async getTodayIncomplete() {
        return createIncompletePayload([{ id: 'run-item-001', title: '開店準備' }]);
      },
      async checkItem() {
        return { item: { id: 'run-item-001', status: 'checked' } };
      },
      async uncheckItem(idToken, runItemId, body) {
        assert.equal(idToken, 'token');
        assert.equal(runItemId, 'run-item-001');
        assert.deepEqual(toPlainJson(body), { reason: '' });
        return { item: { id: runItemId, status: 'unchecked' } };
      }
    },
    mode: 'admin'
  });

  await controller.init();

  const uncheckButton = findByDataset(documentRef.elements['checklist-items'], 'action', 'uncheck');
  assert.ok(uncheckButton);

  await uncheckButton.click();

  assert.equal(documentRef.elements['progress-summary'].textContent, '0 / 1');
  assert.ok(findByDataset(documentRef.elements['checklist-items'], 'action', 'check'));
});

test('履歴 UI が無くても初期化と更新が動く', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  const calls = {
    checklist: 0
  };
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-pt-001',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        calls.checklist += 1;
        return createChecklistPayload();
      },
      async getTodayIncomplete() {
        return createIncompletePayload();
      }
    },
    mode: 'user'
  });

  await controller.init();
  await documentRef.elements['refresh-button'].click();
  assert.equal(calls.checklist, 2);
});

test('管理者モードでもテンプレート管理 API を呼ばない', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  let listTemplatesCallCount = 0;
  const controller = client.createController({
    document: documentRef,
    auth: {
      async initialize() {
        return { idToken: 'token' };
      }
    },
    api: {
      async getMe() {
        return {
          userId: 'user-ad-001',
          role: '',
          store: { id: 'store-001', name: '青山店' }
        };
      },
      async getTodayChecklist() {
        return createChecklistPayload({
          items: [
            {
              id: 'run-item-001',
              title: '開店準備',
              status: 'unchecked',
              checkedBy: null,
              checkedByUserId: null,
              checkedAt: null
            }
          ]
        });
      },
      async getTodayIncomplete() {
        return createIncompletePayload([{ id: 'run-item-001', title: '開店準備' }]);
      },
      async listTemplates() {
        listTemplatesCallCount += 1;
        return createTemplatesPayload();
      }
    },
    mode: 'admin'
  });

  await controller.init();
  assert.equal(listTemplatesCallCount, 0);
});

test('GAS LIFF の期間別進捗は選択期間のテーマ色で表示する', async () => {
  const css = await readFile('gas/src/liff/shared/style.html', 'utf8');
  const clientHtml = await readFile('gas/src/liff/shared/client.html', 'utf8');

  assert.match(css, /body\.user-mode\[data-task-period='weekly'\]\s*\{[\s\S]*--period-accent:\s*#36a18b;/);
  assert.match(css, /body\.user-mode\[data-task-period='monthly'\]\s*\{[\s\S]*--period-accent:\s*#7c5ac7;/);
  assert.match(css, /\.progress-ring-progress\s*\{[\s\S]*stroke:\s*var\(--period-accent\);/);
  assert.match(css, /\.progress-ring-label\s*\{[\s\S]*color:\s*var\(--period-accent-strong\);/);
  assert.match(css, /\.progress-title\s*\{[\s\S]*color:\s*var\(--period-accent-strong\);/);
  assert.match(css, /\.progress-count strong\s*\{[\s\S]*color:\s*var\(--period-accent-strong\);/);
  assert.match(css, /\.progress-bar-fill\s*\{[\s\S]*linear-gradient\(90deg,\s*var\(--period-accent\),\s*var\(--period-accent-strong\)\)/);
  assert.doesNotMatch(clientHtml, /progressRingProgress\.style\.stroke\s*=/);
});
