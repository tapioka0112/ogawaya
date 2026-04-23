(function (global) {
  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '');
  }

  function appendQuery(url, query) {
    var pairs = [];
    Object.keys(query || {}).forEach(function (key) {
      var value = query[key];
      if (value === '' || value == null) {
        return;
      }
      pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    if (pairs.length === 0) {
      return url;
    }
    return url + (url.indexOf('?') === -1 ? '?' : '&') + pairs.join('&');
  }

  function withTimeout(promise, timeoutMs, message) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = global.setTimeout(function () {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(message));
      }, timeoutMs);

      promise.then(function (value) {
        if (settled) {
          return;
        }
        settled = true;
        global.clearTimeout(timer);
        resolve(value);
      }).catch(function (error) {
        if (settled) {
          return;
        }
        settled = true;
        global.clearTimeout(timer);
        reject(error);
      });
    });
  }

  async function loadConfig() {
    var response = await fetch('./config.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('config.json の読み込みに失敗しました');
    }
    var payload = await response.json();
    var gasApiBaseUrl = normalizeBaseUrl(payload.gasApiBaseUrl || '');
    var liffId = String(payload.liffId || '').trim();
    if (!gasApiBaseUrl) {
      throw new Error('config.json の gasApiBaseUrl が未設定です');
    }
    if (!liffId) {
      throw new Error('config.json の liffId が未設定です');
    }
    return {
      gasApiBaseUrl: gasApiBaseUrl,
      liffId: liffId,
      allowAnonymousAccess: payload.allowAnonymousAccess === true,
      tryLiffAuthInAnonymous: payload.tryLiffAuthInAnonymous === true
    };
  }

  function createApi(baseUrl) {
    var normalizedBaseUrl = normalizeBaseUrl(baseUrl);

    async function request(method, path, idToken, body) {
      var query = {
        path: String(path || '').replace(/^\/+/, '')
      };
      if (idToken) {
        query.idToken = idToken;
      }

      var options = {
        method: method
      };
      if (method !== 'GET') {
        options.body = JSON.stringify(body || {});
      }

      var response = await fetch(appendQuery(normalizedBaseUrl, query), options);
      var rawText = await response.text();
      var payload = null;
      try {
        payload = JSON.parse(rawText);
      } catch (error) {
        throw new Error('API 応答の解析に失敗しました');
      }

      var statusCode = typeof payload.statusCode === 'number'
        ? payload.statusCode
        : Number(payload.statusCode) || response.status || 500;
      if (!payload || payload.ok === false || statusCode >= 400) {
        var apiError = new Error(payload && payload.message ? payload.message : 'API request failed');
        apiError.code = payload && payload.code ? payload.code : '';
        apiError.statusCode = statusCode;
        throw apiError;
      }
      return payload;
    }

    return {
      getTodayChecklist: function (idToken) {
        return request('GET', 'api/checklists/today', idToken);
      },
      checkItem: function (idToken, runItemId) {
        return request('POST', 'api/checklist-items/' + encodeURIComponent(runItemId) + '/check', idToken, { comment: '' });
      },
      uncheckItem: function (idToken, runItemId) {
        return request('POST', 'api/checklist-items/' + encodeURIComponent(runItemId) + '/uncheck', idToken, { reason: '' });
      }
    };
  }

  async function initializeAuth(liffId) {
    if (!global.liff || typeof global.liff.init !== 'function') {
      throw new Error('LIFF SDK が読み込まれていません');
    }

    await withTimeout(
      global.liff.init({
        liffId: liffId,
        withLoginOnExternalBrowser: true
      }),
      10000,
      'LIFF 認証の初期化がタイムアウトしました。LINE から再度開いてください。'
    );

    if (typeof global.liff.isLoggedIn === 'function' && !global.liff.isLoggedIn()) {
      if (typeof global.liff.login === 'function') {
        global.liff.login();
      }
      throw new Error('LINE ログイン画面へ遷移しました。ログイン後に再度開いてください。');
    }

    var idToken = typeof global.liff.getIDToken === 'function'
      ? global.liff.getIDToken()
      : '';
    if (!idToken) {
      throw new Error('LIFF 認証コンテキストを取得できません');
    }
    return idToken;
  }

  var state = {
    idToken: '',
    checklist: null,
    pendingItemActions: {},
    api: null
  };

  var elements = {
    errorBox: document.getElementById('error-message'),
    statusBox: document.getElementById('status-message'),
    screenMode: document.getElementById('screen-mode'),
    storeName: document.getElementById('store-name'),
    targetDate: document.getElementById('target-date'),
    progressSummary: document.getElementById('progress-summary'),
    checklistItems: document.getElementById('checklist-items'),
    incompleteSummary: document.getElementById('incomplete-summary'),
    incompleteItems: document.getElementById('incomplete-items'),
    refreshButton: document.getElementById('refresh-button')
  };

  function setText(element, value) {
    if (!element) {
      return;
    }
    element.textContent = value == null ? '' : String(value);
  }

  function setBoxMessage(element, message) {
    if (!element) {
      return;
    }
    element.textContent = message || '';
    element.dataset.visible = message ? 'true' : 'false';
  }

  function setError(message) {
    setBoxMessage(elements.errorBox, message);
  }

  function clearError() {
    setError('');
  }

  function setStatus(message) {
    setBoxMessage(elements.statusBox, message);
  }

  function clearStatus() {
    setStatus('');
  }

  function clearList(element) {
    if (!element) {
      return;
    }
    element.innerHTML = '';
  }

  function createMessageListItem(text, className) {
    var item = document.createElement('li');
    item.className = className;
    item.textContent = text;
    return item;
  }

  function recomputeProgress() {
    if (!state.checklist) {
      return;
    }
    var items = Array.isArray(state.checklist.items) ? state.checklist.items : [];
    var checkedCount = items.filter(function (item) {
      return item.status === 'checked';
    }).length;
    state.checklist.progress = {
      checked: checkedCount,
      total: items.length
    };
  }

  function findChecklistItemById(runItemId) {
    if (!state.checklist || !Array.isArray(state.checklist.items)) {
      return null;
    }
    return state.checklist.items.find(function (item) {
      return item.id === runItemId;
    }) || null;
  }

  function applyChecklistItemUpdate(updatedItem) {
    var target = findChecklistItemById(updatedItem.id);
    if (!target) {
      return;
    }
    target.status = updatedItem.status;
    target.checkedBy = updatedItem.checkedBy;
    target.checkedByUserId = updatedItem.checkedByUserId;
    target.checkedAt = updatedItem.checkedAt;
    recomputeProgress();
    renderChecklist();
    renderOverview();
    renderIncomplete();
  }

  function buildOptimisticCheckedItem(item) {
    return {
      id: item.id,
      title: item.title,
      status: 'checked',
      checkedBy: state.checklist && state.checklist.currentUser ? state.checklist.currentUser.name : 'LINEユーザー',
      checkedByUserId: state.checklist && state.checklist.currentUser ? state.checklist.currentUser.userId : '',
      checkedAt: new Date().toISOString()
    };
  }

  function buildOptimisticUncheckedItem(item) {
    return {
      id: item.id,
      title: item.title,
      status: 'unchecked',
      checkedBy: null,
      checkedByUserId: null,
      checkedAt: null
    };
  }

  function ensureWritableSession() {
    if (state.idToken) {
      return true;
    }
    setError('LINE認証が完了していないため更新できません。LINEから開き直してください。');
    return false;
  }

  function withPendingItemAction(runItemId, action) {
    if (state.pendingItemActions[runItemId]) {
      return;
    }
    state.pendingItemActions[runItemId] = true;
    renderChecklist();
    action().finally(function () {
      delete state.pendingItemActions[runItemId];
      renderChecklist();
    });
  }

  function handleCheck(runItemId) {
    if (!ensureWritableSession()) {
      return;
    }
    var currentItem = findChecklistItemById(runItemId);
    if (!currentItem || currentItem.status === 'checked') {
      return;
    }
    var rollbackItem = {
      id: currentItem.id,
      title: currentItem.title,
      status: currentItem.status,
      checkedBy: currentItem.checkedBy,
      checkedByUserId: currentItem.checkedByUserId,
      checkedAt: currentItem.checkedAt
    };
    applyChecklistItemUpdate(buildOptimisticCheckedItem(currentItem));
    setStatus('チェックを更新しました');

    withPendingItemAction(runItemId, function () {
      return state.api.checkItem(state.idToken, runItemId).then(function (response) {
        if (response && response.item) {
          applyChecklistItemUpdate(response.item);
        }
      }).catch(function (error) {
        applyChecklistItemUpdate(rollbackItem);
        setError(error && error.message ? String(error.message) : 'チェック更新に失敗しました');
      });
    });
  }

  function handleUncheck(runItemId) {
    if (!ensureWritableSession()) {
      return;
    }
    var currentItem = findChecklistItemById(runItemId);
    if (!currentItem || currentItem.status === 'unchecked') {
      return;
    }
    var rollbackItem = {
      id: currentItem.id,
      title: currentItem.title,
      status: currentItem.status,
      checkedBy: currentItem.checkedBy,
      checkedByUserId: currentItem.checkedByUserId,
      checkedAt: currentItem.checkedAt
    };
    applyChecklistItemUpdate(buildOptimisticUncheckedItem(currentItem));
    setStatus('チェックを取り消しました');

    withPendingItemAction(runItemId, function () {
      return state.api.uncheckItem(state.idToken, runItemId).then(function (response) {
        if (response && response.item) {
          applyChecklistItemUpdate(response.item);
        }
      }).catch(function (error) {
        applyChecklistItemUpdate(rollbackItem);
        setError(error && error.message ? String(error.message) : 'チェック取消に失敗しました');
      });
    });
  }

  function renderOverview() {
    var checklist = state.checklist;
    if (!checklist) {
      setText(elements.storeName, '-');
      setText(elements.targetDate, '-');
      setText(elements.progressSummary, '-');
      return;
    }
    setText(elements.storeName, checklist.storeName || '-');
    setText(elements.targetDate, checklist.targetDate || '-');
    setText(elements.progressSummary, checklist.progress.checked + ' / ' + checklist.progress.total);
  }

  function renderChecklist() {
    var checklist = state.checklist;
    clearList(elements.checklistItems);
    if (!checklist || !Array.isArray(checklist.items) || checklist.items.length === 0) {
      elements.checklistItems.appendChild(createMessageListItem('当日の項目はありません。', 'empty-item'));
      return;
    }

    checklist.items.forEach(function (item) {
      var listItem = document.createElement('li');
      listItem.className = 'checklist-item';

      var bullet = document.createElement('span');
      bullet.className = 'check-bullet';
      bullet.dataset.status = item.status;

      var body = document.createElement('div');
      body.className = 'item-body';

      var title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = item.title;

      var meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = item.status === 'checked'
        ? (item.checkedBy || 'LINEユーザー') + ' / ' + (item.checkedAt || '')
        : '未チェック';

      var actions = document.createElement('div');
      actions.className = 'button-row item-actions';

      if (item.status === 'unchecked') {
        var checkButton = document.createElement('button');
        checkButton.type = 'button';
        checkButton.className = 'action-button';
        checkButton.textContent = 'チェックする';
        checkButton.disabled = !!state.pendingItemActions[item.id] || !state.idToken;
        checkButton.addEventListener('click', function () {
          clearError();
          clearStatus();
          handleCheck(item.id);
        });
        actions.appendChild(checkButton);
      } else {
        var uncheckButton = document.createElement('button');
        uncheckButton.type = 'button';
        uncheckButton.className = 'action-button ghost-button';
        uncheckButton.textContent = '取消';
        uncheckButton.disabled = !!state.pendingItemActions[item.id] || !state.idToken;
        uncheckButton.addEventListener('click', function () {
          clearError();
          clearStatus();
          handleUncheck(item.id);
        });
        actions.appendChild(uncheckButton);
      }

      body.appendChild(title);
      body.appendChild(meta);
      body.appendChild(actions);
      listItem.appendChild(bullet);
      listItem.appendChild(body);
      elements.checklistItems.appendChild(listItem);
    });
  }

  function renderIncomplete() {
    clearList(elements.incompleteItems);
    if (!state.checklist || !Array.isArray(state.checklist.items)) {
      setText(elements.incompleteSummary, '未完了 0 件');
      return;
    }
    var incompleteItems = state.checklist.items.filter(function (item) {
      return item.status === 'unchecked';
    });
    setText(elements.incompleteSummary, '未完了 ' + incompleteItems.length + ' 件');

    incompleteItems.forEach(function (item) {
      elements.incompleteItems.appendChild(createMessageListItem(item.title, 'plain-item'));
    });
    if (incompleteItems.length === 0) {
      elements.incompleteItems.appendChild(createMessageListItem('未完了はありません。', 'empty-item'));
    }
  }

  async function refreshChecklist() {
    var checklist = await state.api.getTodayChecklist(state.idToken);
    state.checklist = checklist;
    renderOverview();
    renderChecklist();
    renderIncomplete();
  }

  async function boot() {
    setText(elements.screenMode, 'チェック LIFF');
    clearError();
    clearStatus();

    var config = await loadConfig();
    global.OGAWAYA_APP_BASE_URL = config.gasApiBaseUrl;
    global.OGAWAYA_LIFF_ID = config.liffId;
    global.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = config.allowAnonymousAccess;
    global.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = config.tryLiffAuthInAnonymous;

    state.api = createApi(config.gasApiBaseUrl);
    state.idToken = await initializeAuth(config.liffId);
    await refreshChecklist();
  }

  function start() {
    if (elements.refreshButton) {
      elements.refreshButton.addEventListener('click', function () {
        clearError();
        setStatus('最新状態を取得中です...');
        refreshChecklist().then(function () {
          clearStatus();
        }).catch(function (error) {
          setError(error && error.message ? String(error.message) : 'チェックリスト取得に失敗しました');
        });
      });
    }

    boot().catch(function (error) {
      setError(error && error.message ? String(error.message) : 'LIFF の初期化に失敗しました');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(globalThis);
