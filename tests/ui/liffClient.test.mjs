import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.textContent = '';
    this.dataset = {};
    this.hidden = false;
    this.className = '';
    this.listeners = {};
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this.type = '';
    this._innerHTML = '';
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
    if (this.tagName === 'select' && child.tagName === 'option' && !this.value) {
      this.value = child.value;
    }
    return child;
  }

  addEventListener(eventName, handler) {
    this.listeners[eventName] = handler;
  }

  click() {
    if (this.listeners.click) {
      return this.listeners.click({
        preventDefault() {},
        target: this
      });
    }
    return undefined;
  }

  trigger(eventName) {
    if (this.listeners[eventName]) {
      return this.listeners[eventName]({
        preventDefault() {},
        target: this
      });
    }
    return undefined;
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
    ['div', 'role-badge'],
    ['div', 'store-name'],
    ['div', 'target-date'],
    ['div', 'progress-summary'],
    ['ul', 'checklist-items'],
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
    ['input', 'template-item-sort-order-input'],
    ['input', 'template-item-required-input'],
    ['button', 'update-template-item-button'],
    ['button', 'delete-template-item-button'],
    ['input', 'new-item-title-input'],
    ['input', 'new-item-description-input'],
    ['input', 'new-item-sort-order-input'],
    ['input', 'new-item-required-input'],
    ['button', 'add-template-item-button']
  ].forEach(([tagName, id]) => register(tagName, id));

  elements['template-item-required-input'].type = 'checkbox';
  elements['new-item-required-input'].type = 'checkbox';

  return {
    elements,
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

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadClientModule() {
  const html = await readFile('gas/src/liff/shared/client.html', 'utf8');
  const script = html.match(/<script>([\s\S]+)<\/script>/)[1];
  const context = {
    globalThis: {},
    fetch: async () => ({ ok: true, json: async () => ({}) })
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
        status: 'unchecked',
        checkedBy: null,
        checkedByUserId: null,
        checkedAt: null
      },
      {
        id: 'run-item-002',
        title: '清掃確認',
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

test('ロール別表示に分岐する', async () => {
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

  assert.equal(documentRef.elements['role-badge'].textContent, 'manager');
  assert.equal(documentRef.elements['admin-panel'].hidden, false);

  controller.renderRole('part_time');
  assert.equal(documentRef.elements['admin-panel'].hidden, true);
});

test('更新ボタンで today と incomplete を再取得する', async () => {
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
  assert.equal(incompleteCallCount, 1);

  await documentRef.elements['refresh-button'].click();
  assert.equal(checklistCallCount, 2);
  assert.equal(incompleteCallCount, 2);
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
  await api.getLogs('token', 'run-001', 'uncheck');

  assert.equal(calls[0].url, 'https://example.com/exec/api/checklist-items/run-item-001/check?idToken=token');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].url, 'https://example.com/exec/api/checklist-items/run-item-001/uncheck?idToken=token');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[2].url, 'https://example.com/exec/api/checklists/today/incomplete?idToken=token');
  assert.equal(calls[2].options.method, 'GET');
  assert.equal(calls[3].url, 'https://example.com/exec/api/checklists/run-001/logs?idToken=token&action=uncheck');
  assert.equal(calls[3].options.method, 'GET');
});

test('チェック操作で UI と未完了一覧を更新する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
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
        return checklistResponses.shift();
      },
      async getTodayIncomplete() {
        return incompleteResponses.shift();
      },
      async getLogs() {
        return createLogsPayload();
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

  const checkButton = findByDataset(documentRef.elements['checklist-items'], 'action', 'check');
  assert.ok(checkButton);

  await checkButton.click();

  assert.deepEqual(toPlainJson(calls[0]), {
    idToken: 'token',
    runItemId: 'run-item-001',
    body: {
      comment: ''
    }
  });
  assert.equal(documentRef.elements['progress-summary'].textContent, '2 / 2');
  assert.equal(documentRef.elements['incomplete-summary'].textContent, '未完了 0 件');
  assert.ok(findByDataset(documentRef.elements['checklist-items'], 'action', 'uncheck'));
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
      async getLogs() {
        return createLogsPayload('uncheck');
      },
      async listTemplates() {
        return createTemplatesPayload();
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

test('履歴再取得ボタンは action フィルタ付きで logs API を呼ぶ', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  const logCalls = [];
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
        return createChecklistPayload();
      },
      async getTodayIncomplete() {
        return createIncompletePayload();
      },
      async getLogs(idToken, runId, action) {
        logCalls.push({ idToken, runId, action });
        return createLogsPayload(action || 'check');
      }
    },
    mode: 'user'
  });

  await controller.init();
  documentRef.elements['log-action-filter'].value = 'uncheck';

  await documentRef.elements['load-logs-button'].click();

  assert.deepEqual(logCalls.at(-1), {
    idToken: 'token',
    runId: 'run-001',
    action: 'uncheck'
  });
});

test('管理者画面からテンプレート CRUD と手動通知の主要導線を呼べる', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  const calls = {
    createTemplate: [],
    updateTemplate: [],
    createTemplateItem: [],
    updateTemplateItem: [],
    deleteTemplateItem: [],
    notifyIncomplete: []
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
          userId: 'user-ad-001',
          role: 'admin',
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
      async getLogs() {
        return createLogsPayload();
      },
      async listTemplates() {
        return createTemplatesPayload();
      },
      async createTemplate(idToken, body) {
        calls.createTemplate.push({ idToken, body });
        return { template: { id: 'tmpl-002', name: body.name } };
      },
      async updateTemplate(idToken, templateId, body) {
        calls.updateTemplate.push({ idToken, templateId, body });
        return { template: { id: templateId, name: body.name } };
      },
      async createTemplateItem(idToken, templateId, body) {
        calls.createTemplateItem.push({ idToken, templateId, body });
        return { item: { id: 'tmpl-item-002', title: body.title } };
      },
      async updateTemplateItem(idToken, templateId, itemId, body) {
        calls.updateTemplateItem.push({ idToken, templateId, itemId, body });
        return { item: { id: itemId, title: body.title } };
      },
      async deleteTemplateItem(idToken, templateId, itemId) {
        calls.deleteTemplateItem.push({ idToken, templateId, itemId });
        return { item: { id: itemId } };
      },
      async notifyIncomplete(idToken, runId) {
        calls.notifyIncomplete.push({ idToken, runId });
        return { notifications: [] };
      }
    },
    mode: 'admin'
  });

  await controller.init();

  documentRef.elements['new-template-name-input'].value = '閉店チェックリスト';
  await documentRef.elements['create-template-button'].click();

  documentRef.elements['template-name-input'].value = '日次チェックリスト改';
  await documentRef.elements['update-template-button'].click();

  documentRef.elements['template-item-title-input'].value = '開店準備改';
  documentRef.elements['template-item-description-input'].value = '朝一番';
  documentRef.elements['template-item-sort-order-input'].value = '2';
  documentRef.elements['template-item-required-input'].checked = false;
  await documentRef.elements['update-template-item-button'].click();

  documentRef.elements['new-item-title-input'].value = 'レジ確認';
  documentRef.elements['new-item-description-input'].value = '朝礼前';
  documentRef.elements['new-item-sort-order-input'].value = '3';
  documentRef.elements['new-item-required-input'].checked = true;
  await documentRef.elements['add-template-item-button'].click();

  await documentRef.elements['delete-template-item-button'].click();
  await documentRef.elements['notify-button'].click();

  assert.deepEqual(toPlainJson(calls.createTemplate[0]), {
    idToken: 'token',
    body: {
      name: '閉店チェックリスト'
    }
  });
  assert.deepEqual(toPlainJson(calls.updateTemplate[0]), {
    idToken: 'token',
    templateId: 'tmpl-001',
    body: {
      name: '日次チェックリスト改'
    }
  });
  assert.deepEqual(toPlainJson(calls.updateTemplateItem[0]), {
    idToken: 'token',
    templateId: 'tmpl-001',
    itemId: 'tmpl-item-001',
    body: {
      title: '開店準備改',
      description: '朝一番',
      sortOrder: 2,
      isRequired: false
    }
  });
  assert.deepEqual(toPlainJson(calls.createTemplateItem[0]), {
    idToken: 'token',
    templateId: 'tmpl-001',
    body: {
      title: 'レジ確認',
      description: '朝礼前',
      sortOrder: 3,
      isRequired: true
    }
  });
  assert.deepEqual(toPlainJson(calls.deleteTemplateItem[0]), {
    idToken: 'token',
    templateId: 'tmpl-001',
    itemId: 'tmpl-item-001'
  });
  assert.deepEqual(toPlainJson(calls.notifyIncomplete[0]), {
    idToken: 'token',
    runId: 'run-001'
  });
});
