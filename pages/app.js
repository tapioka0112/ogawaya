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

  function isConfiguredValue(value) {
    var normalized = String(value || '').trim();
    return normalized !== '' && normalized.indexOf('REPLACE_') !== 0;
  }

  function normalizeFirebaseConfig(rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object') {
      return null;
    }
    var normalized = {};
    [
      'apiKey',
      'authDomain',
      'projectId',
      'appId',
      'messagingSenderId',
      'storageBucket'
    ].forEach(function (key) {
      if (isConfiguredValue(rawConfig[key])) {
        normalized[key] = String(rawConfig[key]).trim();
      }
    });
    if (!normalized.apiKey || !normalized.projectId || !normalized.appId) {
      return null;
    }
    return normalized;
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

    var consistencyRefreshSeconds = Number(payload.consistencyRefreshSeconds);
    if (!isFinite(consistencyRefreshSeconds) || consistencyRefreshSeconds < 5) {
      consistencyRefreshSeconds = 30;
    }

    return {
      gasApiBaseUrl: gasApiBaseUrl,
      liffId: liffId,
      allowAnonymousAccess: payload.allowAnonymousAccess === true,
      tryLiffAuthInAnonymous: payload.tryLiffAuthInAnonymous === true,
      enableRealtimeSync: payload.enableRealtimeSync !== false,
      consistencyRefreshSeconds: consistencyRefreshSeconds,
      firebase: normalizeFirebaseConfig(payload.firebase)
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
    api: null,
    config: null,
    itemActions: {},
    firebaseApp: null,
    firestore: null,
    realtimeEnabled: false,
    syncUnsubscribe: null,
    syncSessionStartedAtMs: 0,
    consistencyTimerId: null,
    visibilityHandlerBound: false
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

  function formatCheckedAtJst(value) {
    if (!value) {
      return '';
    }
    var date = new Date(value);
    if (isNaN(date.getTime())) {
      return String(value);
    }
    if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
      var jstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
      var fallbackMinute = jstDate.getUTCMinutes();
      return (
        (jstDate.getUTCMonth() + 1) +
        '月' +
        jstDate.getUTCDate() +
        '日' +
        jstDate.getUTCHours() +
        '時' +
        (fallbackMinute < 10 ? '0' + fallbackMinute : String(fallbackMinute)) +
        '分'
      );
    }
    var formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: false
    });
    var values = {};
    formatter.formatToParts(date).forEach(function (part) {
      values[part.type] = part.value;
    });
    if (!values.month || !values.day || !values.hour || !values.minute) {
      return String(value);
    }
    return values.month + '月' + values.day + '日' + values.hour + '時' + values.minute + '分';
  }

  function cloneChecklistItem(item) {
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      checkedBy: item.checkedBy,
      checkedByUserId: item.checkedByUserId,
      checkedAt: item.checkedAt
    };
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

  function getItemActionState(runItemId) {
    if (!state.itemActions[runItemId]) {
      state.itemActions[runItemId] = {
        desiredStatus: null,
        inFlight: false,
        lastSyncedAtMs: 0
      };
    }
    return state.itemActions[runItemId];
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

  function buildApiErrorMessage(error, fallbackMessage) {
    return error && error.message ? String(error.message) : fallbackMessage;
  }

  function parseTimestampMillis(value) {
    if (!value) {
      return 0;
    }
    if (typeof value === 'number' && isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      var parsed = Date.parse(value);
      return isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value.toMillis === 'function') {
      return Number(value.toMillis()) || 0;
    }
    if (typeof value.seconds === 'number') {
      return value.seconds * 1000;
    }
    return 0;
  }

  function ensureSyncTargetInfo() {
    if (!state.checklist || !state.checklist.currentUser || !state.checklist.currentUser.store) {
      return null;
    }
    var storeId = String(state.checklist.currentUser.store.id || '');
    var targetDate = String(state.checklist.targetDate || '');
    var runId = String(state.checklist.runId || '');
    if (!storeId || !targetDate || !runId) {
      return null;
    }
    return {
      storeId: storeId,
      targetDate: targetDate,
      runId: runId
    };
  }

  function emitRealtimeEvent(updatedItem) {
    if (!state.realtimeEnabled || !state.firestore || !updatedItem) {
      return Promise.resolve();
    }
    var targetInfo = ensureSyncTargetInfo();
    if (!targetInfo) {
      return Promise.resolve();
    }
    var sourceUserId = state.checklist && state.checklist.currentUser
      ? String(state.checklist.currentUser.userId || '')
      : '';

    var payload = {
      runId: targetInfo.runId,
      targetDate: targetInfo.targetDate,
      storeId: targetInfo.storeId,
      itemId: String(updatedItem.id || ''),
      status: String(updatedItem.status || ''),
      checkedBy: updatedItem.checkedBy || '',
      checkedByUserId: updatedItem.checkedByUserId || '',
      checkedAt: updatedItem.checkedAt || '',
      sourceUserId: sourceUserId,
      emittedAt: global.firebase.firestore.FieldValue.serverTimestamp()
    };

    return state.firestore
      .collection('stores')
      .doc(targetInfo.storeId)
      .collection('runs')
      .doc(targetInfo.targetDate)
      .collection('events')
      .add(payload)
      .catch(function (error) {
        console.error('[sync] failed to emit realtime event', error);
      });
  }

  function applyRealtimeEvent(eventPayload, emittedAtMs) {
    if (!eventPayload || !state.checklist) {
      return;
    }
    if (String(eventPayload.runId || '') !== String(state.checklist.runId || '')) {
      return;
    }
    var runItemId = String(eventPayload.itemId || '');
    if (!runItemId) {
      return;
    }
    var actionState = getItemActionState(runItemId);
    if (actionState.inFlight) {
      return;
    }
    if (emittedAtMs > 0 && emittedAtMs <= actionState.lastSyncedAtMs) {
      return;
    }
    if (emittedAtMs > 0) {
      actionState.lastSyncedAtMs = emittedAtMs;
    }
    applyChecklistItemUpdate({
      id: runItemId,
      status: eventPayload.status,
      checkedBy: eventPayload.checkedBy || null,
      checkedByUserId: eventPayload.checkedByUserId || null,
      checkedAt: eventPayload.checkedAt || null
    });
  }

  function stopRealtimeSync() {
    if (typeof state.syncUnsubscribe === 'function') {
      state.syncUnsubscribe();
    }
    state.syncUnsubscribe = null;
    state.realtimeEnabled = false;
  }

  function startRealtimeSync() {
    stopRealtimeSync();
    if (!state.config || !state.config.enableRealtimeSync || !state.config.firebase) {
      return;
    }
    if (!global.firebase || typeof global.firebase.initializeApp !== 'function' || typeof global.firebase.firestore !== 'function') {
      console.error('[sync] firebase sdk is not available');
      return;
    }

    var targetInfo = ensureSyncTargetInfo();
    if (!targetInfo) {
      return;
    }

    try {
      if (!state.firebaseApp) {
        if (Array.isArray(global.firebase.apps) && global.firebase.apps.length > 0) {
          state.firebaseApp = global.firebase.app();
        } else {
          state.firebaseApp = global.firebase.initializeApp(state.config.firebase);
        }
      }
      if (!state.firestore) {
        state.firestore = global.firebase.firestore();
      }
      state.syncSessionStartedAtMs = Date.now();

      var query = state.firestore
        .collection('stores')
        .doc(targetInfo.storeId)
        .collection('runs')
        .doc(targetInfo.targetDate)
        .collection('events')
        .orderBy('emittedAt', 'desc')
        .limit(40);

      state.syncUnsubscribe = query.onSnapshot(function (snapshot) {
        snapshot.docChanges().forEach(function (change) {
          if (change.type !== 'added' && change.type !== 'modified') {
            return;
          }
          var payload = change.doc.data() || {};
          var emittedAtMs = parseTimestampMillis(payload.emittedAt);
          if (emittedAtMs > 0 && emittedAtMs < state.syncSessionStartedAtMs - 5000) {
            return;
          }
          applyRealtimeEvent(payload, emittedAtMs);
        });
      }, function (error) {
        console.error('[sync] realtime listener failed', error);
      });

      state.realtimeEnabled = true;
    } catch (error) {
      console.error('[sync] failed to initialize realtime sync', error);
      stopRealtimeSync();
    }
  }

  function mergeChecklistPreservingInFlight(serverChecklist) {
    if (!state.checklist || !Array.isArray(state.checklist.items)) {
      return serverChecklist;
    }
    var localItems = {};
    state.checklist.items.forEach(function (item) {
      localItems[item.id] = item;
    });
    var nextChecklist = serverChecklist || {};
    var nextItems = Array.isArray(nextChecklist.items) ? nextChecklist.items : [];
    nextChecklist.items = nextItems.map(function (serverItem) {
      var localItem = localItems[serverItem.id];
      if (!localItem) {
        return serverItem;
      }
      var actionState = getItemActionState(serverItem.id);
      if (actionState.inFlight) {
        return cloneChecklistItem(localItem);
      }
      return serverItem;
    });
    return nextChecklist;
  }

  function requestItemStatusChange(runItemId, desiredStatus) {
    if (!ensureWritableSession()) {
      return;
    }
    var currentItem = findChecklistItemById(runItemId);
    if (!currentItem) {
      return;
    }
    var actionState = getItemActionState(runItemId);
    actionState.desiredStatus = desiredStatus;
    processItemStatusChange(runItemId);
  }

  function processItemStatusChange(runItemId) {
    var actionState = getItemActionState(runItemId);
    if (actionState.inFlight) {
      return;
    }
    var currentItem = findChecklistItemById(runItemId);
    if (!currentItem) {
      return;
    }
    var desiredStatus = actionState.desiredStatus;
    if (!desiredStatus || currentItem.status === desiredStatus) {
      actionState.desiredStatus = currentItem.status;
      return;
    }

    var rollbackItem = cloneChecklistItem(currentItem);
    actionState.inFlight = true;

    if (desiredStatus === 'checked') {
      applyChecklistItemUpdate(buildOptimisticCheckedItem(currentItem));
      setStatus('チェックを更新しました');
    } else {
      applyChecklistItemUpdate(buildOptimisticUncheckedItem(currentItem));
      setStatus('チェックを取り消しました');
    }

    var requestPromise = desiredStatus === 'checked'
      ? state.api.checkItem(state.idToken, runItemId)
      : state.api.uncheckItem(state.idToken, runItemId);

    requestPromise.then(function (response) {
      if (response && response.item) {
        applyChecklistItemUpdate(response.item);
        return emitRealtimeEvent(response.item);
      }
      return Promise.resolve();
    }).catch(function (error) {
      applyChecklistItemUpdate(rollbackItem);
      setError(buildApiErrorMessage(error, 'チェック更新に失敗しました'));
    }).finally(function () {
      actionState.inFlight = false;
      var latestItem = findChecklistItemById(runItemId);
      if (!latestItem) {
        return;
      }
      if (actionState.desiredStatus !== latestItem.status) {
        processItemStatusChange(runItemId);
        return;
      }
      actionState.desiredStatus = latestItem.status;
      renderChecklist();
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
      if (item.status === 'checked') {
        var checkedBy = item.checkedBy || 'LINEユーザー';
        var checkedAtText = formatCheckedAtJst(item.checkedAt);
        meta.textContent = checkedAtText ? checkedBy + ' / ' + checkedAtText : checkedBy;
      } else {
        meta.textContent = '未チェック';
      }

      var actions = document.createElement('div');
      actions.className = 'button-row item-actions';

      if (item.status === 'unchecked') {
        var checkButton = document.createElement('button');
        checkButton.type = 'button';
        checkButton.className = 'action-button';
        checkButton.textContent = 'チェックする';
        checkButton.disabled = !state.idToken;
        checkButton.addEventListener('click', function () {
          clearError();
          clearStatus();
          requestItemStatusChange(item.id, 'checked');
        });
        actions.appendChild(checkButton);
      } else {
        var uncheckButton = document.createElement('button');
        uncheckButton.type = 'button';
        uncheckButton.className = 'action-button ghost-button';
        uncheckButton.textContent = '取消';
        uncheckButton.disabled = !state.idToken;
        uncheckButton.addEventListener('click', function () {
          clearError();
          clearStatus();
          requestItemStatusChange(item.id, 'unchecked');
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

  async function refreshChecklist(options) {
    var refreshOptions = options || {};
    var checklist = await state.api.getTodayChecklist(state.idToken);
    state.checklist = mergeChecklistPreservingInFlight(checklist);
    recomputeProgress();
    renderOverview();
    renderChecklist();
    renderIncomplete();
    if (refreshOptions.restartSync !== false) {
      startRealtimeSync();
    }
  }

  function startConsistencyRefresh() {
    if (!state.config) {
      return;
    }
    if (state.consistencyTimerId) {
      global.clearInterval(state.consistencyTimerId);
    }
    state.consistencyTimerId = global.setInterval(function () {
      if (typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') {
        return;
      }
      refreshChecklist({ restartSync: false }).catch(function (error) {
        console.error('[sync] consistency refresh failed', error);
      });
    }, state.config.consistencyRefreshSeconds * 1000);

    if (!state.visibilityHandlerBound) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          refreshChecklist({ restartSync: false }).catch(function (error) {
            console.error('[sync] refresh on visible failed', error);
          });
        }
      });
      state.visibilityHandlerBound = true;
    }
  }

  function stopConsistencyRefresh() {
    if (state.consistencyTimerId) {
      global.clearInterval(state.consistencyTimerId);
    }
    state.consistencyTimerId = null;
  }

  async function boot() {
    setText(elements.screenMode, 'チェック LIFF');
    clearError();
    clearStatus();

    var config = await loadConfig();
    state.config = config;
    global.OGAWAYA_APP_BASE_URL = config.gasApiBaseUrl;
    global.OGAWAYA_LIFF_ID = config.liffId;
    global.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = config.allowAnonymousAccess;
    global.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = config.tryLiffAuthInAnonymous;

    state.api = createApi(config.gasApiBaseUrl);
    state.idToken = await initializeAuth(config.liffId);
    await refreshChecklist();
    startConsistencyRefresh();
  }

  function start() {
    if (elements.refreshButton) {
      elements.refreshButton.addEventListener('click', function () {
        clearError();
        setStatus('最新状態を取得中です...');
        refreshChecklist({ restartSync: false }).then(function () {
          clearStatus();
        }).catch(function (error) {
          setError(buildApiErrorMessage(error, 'チェックリスト取得に失敗しました'));
        });
      });
    }

    global.addEventListener('beforeunload', function () {
      stopRealtimeSync();
      stopConsistencyRefresh();
    });

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
