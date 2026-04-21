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
    this.innerHTML = '';
    this.listeners = {};
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(eventName, handler) {
    this.listeners[eventName] = handler;
  }

  click() {
    if (this.listeners.click) {
      return this.listeners.click();
    }
    return undefined;
  }
}

function createFakeDocument() {
  const elements = {};
  [
    'error-message',
    'role-badge',
    'store-name',
    'target-date',
    'progress-summary',
    'checklist-items',
    'refresh-button',
    'admin-panel',
    'screen-mode'
  ].forEach((id) => {
    elements[id] = new FakeElement('div', id);
  });

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

function createChecklistPayload() {
  return {
    storeName: '青山店',
    targetDate: '2026-04-21',
    progress: {
      checked: 1,
      total: 2
    },
    items: [
      {
        id: 'run-item-001',
        title: '開店準備',
        status: 'checked',
        checkedBy: '田中 花子',
        checkedAt: '2026-04-21T10:35:00Z'
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
      },
      async getTodayChecklist() {
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
      },
      async getTodayChecklist() {
        throw new Error('not used');
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
          role: 'manager'
        };
      },
      async getTodayChecklist() {
        return createChecklistPayload();
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

test('更新ボタンで today API を再取得する', async () => {
  const { client } = await loadClientModule();
  const documentRef = createFakeDocument();
  let checklistCallCount = 0;
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
          role: 'admin'
        };
      },
      async getTodayChecklist() {
        checklistCallCount += 1;
        return createChecklistPayload();
      }
    },
    mode: 'admin'
  });

  await controller.init();
  assert.equal(checklistCallCount, 1);

  await documentRef.elements['refresh-button'].click();
  assert.equal(checklistCallCount, 2);
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
