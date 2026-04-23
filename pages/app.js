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
    var defaultStoreId = String(payload.defaultStoreId || '').trim();

    return {
      gasApiBaseUrl: gasApiBaseUrl,
      liffId: liffId,
      defaultStoreId: defaultStoreId,
      allowAnonymousAccess: payload.allowAnonymousAccess === true,
      tryLiffAuthInAnonymous: payload.tryLiffAuthInAnonymous === true,
      enableRealtimeSync: payload.enableRealtimeSync !== false,
      consistencyRefreshSeconds: consistencyRefreshSeconds,
      firebase: normalizeFirebaseConfig(payload.firebase)
    };
  }

  var LAST_STORE_ID_STORAGE_KEY = 'ogawaya:last-store-id';
  var SNAPSHOT_DOC_ID = 'today';

  function getTodayDateInJst() {
    var formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(new Date());
  }

  function readStorageValue(key) {
    try {
      if (!global.localStorage || typeof global.localStorage.getItem !== 'function') {
        return '';
      }
      return String(global.localStorage.getItem(key) || '');
    } catch (error) {
      return '';
    }
  }

  function writeStorageValue(key, value) {
    try {
      if (!global.localStorage || typeof global.localStorage.setItem !== 'function') {
        return;
      }
      global.localStorage.setItem(key, String(value || ''));
    } catch (error) {
      // noop
    }
  }

  function decodeBase64Url(value) {
    if (typeof value !== 'string' || value === '' || typeof global.atob !== 'function') {
      return '';
    }
    var normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    var padding = normalized.length % 4;
    if (padding) {
      normalized += '='.repeat(4 - padding);
    }
    var binary = global.atob(normalized);
    var encoded = '';
    for (var index = 0; index < binary.length; index += 1) {
      var code = binary.charCodeAt(index).toString(16);
      encoded += '%' + (code.length === 1 ? '0' + code : code);
    }
    return decodeURIComponent(encoded);
  }

  function extractUserContextFromIdToken(idToken) {
    if (typeof idToken !== 'string') {
      return {
        userId: '',
        name: ''
      };
    }
    var parts = idToken.split('.');
    if (parts.length < 2) {
      return {
        userId: '',
        name: ''
      };
    }
    try {
      var payloadText = decodeBase64Url(parts[1]);
      var payload = JSON.parse(payloadText);
      return {
        userId: payload && payload.sub ? String(payload.sub) : '',
        name: payload && payload.name ? String(payload.name) : ''
      };
    } catch (error) {
      return {
        userId: '',
        name: ''
      };
    }
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
    visibilityHandlerBound: false,
    authUserContext: {
      userId: '',
      name: ''
    }
  };

  var elements = {
    errorBox: document.getElementById('error-message'),
    statusBox: document.getElementById('status-message'),
    screenMode: document.getElementById('screen-mode'),
    storeName: document.getElementById('store-name'),
    targetDate: document.getElementById('target-date'),
    progressSummary: document.getElementById('progress-summary'),
    progressCountChecked: document.getElementById('progress-count-checked'),
    progressCountTotal: document.getElementById('progress-count-total'),
    progressBarFill: document.getElementById('progress-bar-fill'),
    progressRingProgress: document.getElementById('progress-ring-progress'),
    progressRingLabel: document.getElementById('progress-ring-label'),
    checklistItems: document.getElementById('checklist-items'),
    incompleteSummary: document.getElementById('incomplete-summary'),
    incompleteItems: document.getElementById('incomplete-items'),
    refreshButton: document.getElementById('refresh-button'),
    hamburgerButton: document.getElementById('hamburger-button'),
    todoMenu: document.getElementById('todo-menu')
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

  function setMenuOpen(open) {
    if (!elements.hamburgerButton || !elements.todoMenu) {
      return;
    }
    elements.hamburgerButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    elements.hamburgerButton.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    elements.todoMenu.dataset.open = open ? 'true' : 'false';
    elements.todoMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function bindHamburgerMenu() {
    if (!elements.hamburgerButton || !elements.todoMenu || elements.hamburgerButton.__boundMenu) {
      return;
    }
    elements.hamburgerButton.__boundMenu = true;
    elements.hamburgerButton.addEventListener('click', function (event) {
      event.stopPropagation();
      var isOpen = elements.hamburgerButton.getAttribute('aria-expanded') === 'true';
      setMenuOpen(!isOpen);
    });
    document.addEventListener('click', function (event) {
      if (elements.hamburgerButton.getAttribute('aria-expanded') !== 'true') {
        return;
      }
      if (elements.todoMenu.contains(event.target) || elements.hamburgerButton.contains(event.target)) {
        return;
      }
      setMenuOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && elements.hamburgerButton.getAttribute('aria-expanded') === 'true') {
        setMenuOpen(false);
        elements.hamburgerButton.focus();
      }
    });
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

  function normalizeCurrentUser(value) {
    var currentUser = value || {};
    var store = currentUser.store || {};
    return {
      userId: String(currentUser.userId || ''),
      name: String(currentUser.name || ''),
      role: String(currentUser.role || ''),
      store: {
        id: String(store.id || ''),
        name: String(store.name || '')
      }
    };
  }

  function normalizeChecklistPayload(value) {
    var checklist = value || {};
    var rawItems = Array.isArray(checklist.items) ? checklist.items : [];
    var normalizedItems = rawItems.map(function (item) {
      return {
        id: String(item.id || ''),
        title: String(item.title || ''),
        status: item.status === 'checked' ? 'checked' : 'unchecked',
        checkedBy: item.checkedBy ? String(item.checkedBy) : null,
        checkedByUserId: item.checkedByUserId ? String(item.checkedByUserId) : null,
        checkedAt: item.checkedAt ? String(item.checkedAt) : null
      };
    }).filter(function (item) {
      return item.id !== '' && item.title !== '';
    });

    var normalized = {
      runId: String(checklist.runId || ''),
      templateId: String(checklist.templateId || ''),
      storeName: String(checklist.storeName || ''),
      targetDate: String(checklist.targetDate || ''),
      status: String(checklist.status || ''),
      currentUser: normalizeCurrentUser(checklist.currentUser),
      progress: {
        checked: 0,
        total: normalizedItems.length
      },
      items: normalizedItems
    };
    normalized.progress.checked = normalizedItems.filter(function (item) {
      return item.status === 'checked';
    }).length;
    return normalized;
  }

  function rememberStoreIdFromChecklist(checklist) {
    if (!checklist || !checklist.currentUser || !checklist.currentUser.store) {
      return;
    }
    var storeId = String(checklist.currentUser.store.id || '');
    if (!storeId) {
      return;
    }
    writeStorageValue(LAST_STORE_ID_STORAGE_KEY, storeId);
  }

  function applyChecklistPayload(checklist, options) {
    var applyOptions = options || {};
    var normalizedChecklist = normalizeChecklistPayload(checklist);
    if (applyOptions.currentUserOverride) {
      var currentUserOverride = applyOptions.currentUserOverride;
      normalizedChecklist.currentUser.userId = String(currentUserOverride.userId || normalizedChecklist.currentUser.userId || '');
      normalizedChecklist.currentUser.name = String(currentUserOverride.name || normalizedChecklist.currentUser.name || '');
    }
    state.checklist = mergeChecklistPreservingInFlight(normalizedChecklist);
    recomputeProgress();
    renderOverview();
    renderChecklist();
    renderIncomplete();
    rememberStoreIdFromChecklist(state.checklist);
    if (applyOptions.restartSync !== false) {
      startRealtimeSync();
    }
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
        lastSyncedAtMs: 0,
        confirmedItem: null
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

  function applyOptimisticStatus(runItemId, desiredStatus) {
    var currentItem = findChecklistItemById(runItemId);
    if (!currentItem || currentItem.status === desiredStatus) {
      return;
    }
    if (desiredStatus === 'checked') {
      applyChecklistItemUpdate(buildOptimisticCheckedItem(currentItem));
      setStatus('チェックを更新しました');
      return;
    }
    applyChecklistItemUpdate(buildOptimisticUncheckedItem(currentItem));
    setStatus('チェックを取り消しました');
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

  function initializeRealtimeClient() {
    if (!state.config || !state.config.enableRealtimeSync || !state.config.firebase) {
      return false;
    }
    if (!global.firebase || typeof global.firebase.initializeApp !== 'function' || typeof global.firebase.firestore !== 'function') {
      console.error('[sync] firebase sdk is not available');
      return false;
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
      return true;
    } catch (error) {
      console.error('[sync] failed to initialize firebase client', error);
      return false;
    }
  }

  function buildSnapshotDocRef(storeId, targetDate) {
    return state.firestore
      .collection('stores')
      .doc(storeId)
      .collection('runs')
      .doc(targetDate)
      .collection('snapshots')
      .doc(SNAPSHOT_DOC_ID);
  }

  function buildChecklistSnapshotPayload(checklist) {
    return {
      runId: String(checklist.runId || ''),
      templateId: String(checklist.templateId || ''),
      storeName: String(checklist.storeName || ''),
      targetDate: String(checklist.targetDate || ''),
      status: String(checklist.status || ''),
      currentUser: {
        userId: String(checklist.currentUser && checklist.currentUser.userId ? checklist.currentUser.userId : ''),
        name: String(checklist.currentUser && checklist.currentUser.name ? checklist.currentUser.name : ''),
        role: String(checklist.currentUser && checklist.currentUser.role ? checklist.currentUser.role : ''),
        store: {
          id: String(checklist.currentUser && checklist.currentUser.store && checklist.currentUser.store.id ? checklist.currentUser.store.id : ''),
          name: String(checklist.currentUser && checklist.currentUser.store && checklist.currentUser.store.name ? checklist.currentUser.store.name : '')
        }
      },
      progress: {
        checked: Number(checklist.progress && checklist.progress.checked ? checklist.progress.checked : 0),
        total: Number(checklist.progress && checklist.progress.total ? checklist.progress.total : 0)
      },
      items: (Array.isArray(checklist.items) ? checklist.items : []).map(function (item) {
        return {
          id: String(item.id || ''),
          title: String(item.title || ''),
          status: String(item.status || 'unchecked'),
          checkedBy: item.checkedBy ? String(item.checkedBy) : '',
          checkedByUserId: item.checkedByUserId ? String(item.checkedByUserId) : '',
          checkedAt: item.checkedAt ? String(item.checkedAt) : ''
        };
      }),
      updatedAt: global.firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  function persistChecklistSnapshot() {
    if (!state.checklist || !initializeRealtimeClient()) {
      return Promise.resolve();
    }
    var targetInfo = ensureSyncTargetInfo();
    if (!targetInfo) {
      return Promise.resolve();
    }
    return buildSnapshotDocRef(targetInfo.storeId, targetInfo.targetDate)
      .set(buildChecklistSnapshotPayload(state.checklist), { merge: true })
      .catch(function (error) {
        console.error('[sync] failed to persist checklist snapshot', error);
      });
  }

  async function loadChecklistFromSnapshot() {
    if (!initializeRealtimeClient()) {
      return null;
    }
    var storeId = readStorageValue(LAST_STORE_ID_STORAGE_KEY);
    if (!storeId && state.config && state.config.defaultStoreId) {
      storeId = String(state.config.defaultStoreId);
      writeStorageValue(LAST_STORE_ID_STORAGE_KEY, storeId);
    }
    if (!storeId) {
      return null;
    }
    var targetDate = getTodayDateInJst();
    var doc = await buildSnapshotDocRef(storeId, targetDate).get();
    if (!doc.exists) {
      return null;
    }
    return normalizeChecklistPayload(doc.data() || {});
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
    if (emittedAtMs <= 0) {
      console.debug('[sync] ignore realtime event: pending_server_timestamp');
      return;
    }
    if (String(eventPayload.runId || '') !== String(state.checklist.runId || '')) {
      return;
    }
    var currentUserId = state.checklist && state.checklist.currentUser
      ? String(state.checklist.currentUser.userId || '')
      : '';
    if (currentUserId && String(eventPayload.sourceUserId || '') === currentUserId) {
      console.debug('[sync] ignore realtime event: self_event');
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
    if (emittedAtMs <= actionState.lastSyncedAtMs) {
      return;
    }
    actionState.lastSyncedAtMs = emittedAtMs;
    var currentItem = findChecklistItemById(runItemId);
    var syncedItem = {
      id: runItemId,
      title: currentItem ? currentItem.title : '',
      status: eventPayload.status,
      checkedBy: eventPayload.checkedBy || null,
      checkedByUserId: eventPayload.checkedByUserId || null,
      checkedAt: eventPayload.checkedAt || null
    };
    if (syncedItem.status === 'checked' && !syncedItem.checkedAt) {
      console.debug('[sync] ignore realtime event: missing_checked_at');
      return;
    }
    applyChecklistItemUpdate(syncedItem);
    actionState.confirmedItem = cloneChecklistItem(syncedItem);
    persistChecklistSnapshot();
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
    if (!initializeRealtimeClient()) {
      return;
    }

    var targetInfo = ensureSyncTargetInfo();
    if (!targetInfo) {
      return;
    }

    try {
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
      if (
        actionState.confirmedItem &&
        actionState.desiredStatus &&
        actionState.desiredStatus !== actionState.confirmedItem.status
      ) {
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
    if (!actionState.confirmedItem) {
      actionState.confirmedItem = cloneChecklistItem(currentItem);
    }
    actionState.desiredStatus = desiredStatus;
    applyOptimisticStatus(runItemId, desiredStatus);
    if (!actionState.inFlight) {
      processItemStatusChange(runItemId);
    }
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
    if (!actionState.confirmedItem) {
      actionState.confirmedItem = cloneChecklistItem(currentItem);
    }
    var desiredStatus = actionState.desiredStatus;
    var confirmedStatus = actionState.confirmedItem.status;
    if (!desiredStatus || desiredStatus === confirmedStatus) {
      actionState.desiredStatus = confirmedStatus;
      return;
    }
    actionState.inFlight = true;
    var requestFailed = false;

    var requestPromise = desiredStatus === 'checked'
      ? state.api.checkItem(state.idToken, runItemId)
      : state.api.uncheckItem(state.idToken, runItemId);

    requestPromise.then(function (response) {
      if (!response || !response.item) {
        requestFailed = true;
        return Promise.resolve();
      }
      actionState.confirmedItem = cloneChecklistItem(response.item);
      var latestDesiredStatusAtResponse = actionState.desiredStatus;
      if (
        latestDesiredStatusAtResponse &&
        latestDesiredStatusAtResponse !== response.item.status
      ) {
        return Promise.resolve();
      }
      applyChecklistItemUpdate(response.item);
      emitRealtimeEvent(response.item).then(function () {
        return persistChecklistSnapshot();
      }).catch(function (error) {
        console.error('[sync] failed to process post-check side effects', error);
      });
      return Promise.resolve();
    }).catch(function (error) {
      requestFailed = true;
      applyChecklistItemUpdate(actionState.confirmedItem);
      setError(buildApiErrorMessage(error, 'チェック更新に失敗しました'));
    }).finally(function () {
      actionState.inFlight = false;
      var latestDesiredStatus = actionState.desiredStatus;
      var latestConfirmedStatus = actionState.confirmedItem ? actionState.confirmedItem.status : '';
      if (requestFailed) {
        actionState.desiredStatus = latestConfirmedStatus;
        renderChecklist();
        return;
      }
      if (latestDesiredStatus && latestConfirmedStatus && latestDesiredStatus !== latestConfirmedStatus) {
        applyOptimisticStatus(runItemId, latestDesiredStatus);
        processItemStatusChange(runItemId);
        return;
      }
      actionState.desiredStatus = latestConfirmedStatus;
      renderChecklist();
    });
  }

  function renderOverview() {
    var checklist = state.checklist;
    if (!checklist) {
      setText(elements.storeName, '-');
      setText(elements.targetDate, '-');
      setText(elements.progressSummary, '-');
      renderProgressGauge({ checked: 0, total: 0 });
      return;
    }
    setText(elements.storeName, checklist.storeName || '-');
    setText(elements.targetDate, checklist.targetDate || '-');
    setText(elements.progressSummary, checklist.progress.checked + ' / ' + checklist.progress.total);
    renderProgressGauge(checklist.progress);
  }

  function renderProgressGauge(progress) {
    var checked = progress && typeof progress.checked === 'number' ? progress.checked : 0;
    var total = progress && typeof progress.total === 'number' ? progress.total : 0;
    var pct = total > 0 ? Math.round((checked / total) * 100) : 0;
    setText(elements.progressCountChecked, String(checked));
    setText(elements.progressCountTotal, String(total));
    if (elements.progressBarFill) {
      elements.progressBarFill.style.width = pct + '%';
    }
    if (elements.progressRingProgress) {
      var circumference = 201.06;
      var offset = circumference * (1 - pct / 100);
      elements.progressRingProgress.style.strokeDashoffset = String(offset);
    }
    setText(elements.progressRingLabel, pct + '%');
  }

  function renderChecklist() {
    var checklist = state.checklist;
    clearList(elements.checklistItems);
    if (!checklist || !Array.isArray(checklist.items) || checklist.items.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'todo-empty';
      empty.textContent = '当日の項目はありません。';
      elements.checklistItems.appendChild(empty);
      return;
    }

    checklist.items.forEach(function (item) {
      var listItem = document.createElement('li');
      listItem.className = 'todo-item';
      listItem.dataset.status = item.status;
      var actionState = getItemActionState(item.id);
      if (actionState.inFlight) {
        listItem.dataset.pending = 'true';
      }
      listItem.setAttribute('role', 'button');
      listItem.setAttribute('tabindex', '0');
      listItem.setAttribute(
        'aria-label',
        item.status === 'checked'
          ? item.title + ' (完了済み、タップで未完了に戻す)'
          : item.title + ' (未完了、タップで完了にする)'
      );

      var bullet = document.createElement('span');
      bullet.className = 'todo-bullet';
      bullet.dataset.status = item.status;

      var main = document.createElement('div');
      main.className = 'todo-main';

      var title = document.createElement('div');
      title.className = 'todo-title-text';
      title.textContent = item.title;
      main.appendChild(title);

      if (item.status === 'checked') {
        var checkedBy = item.checkedBy || 'LINEユーザー';
        var checkedAtText = formatCheckedAtJst(item.checkedAt);
        var meta = document.createElement('div');
        meta.className = 'todo-meta';
        meta.textContent = checkedAtText ? checkedBy + ' ・ ' + checkedAtText : checkedBy;
        main.appendChild(meta);
      }

      var chevron = document.createElement('span');
      chevron.className = 'todo-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '›';

      var toggleHandler = function () {
        if (!state.idToken) {
          clearError();
          setError('LINE認証が完了していないため更新できません。LINEから開き直してください。');
          return;
        }
        clearError();
        clearStatus();
        if (item.status === 'unchecked') {
          requestItemStatusChange(item.id, 'checked');
          return;
        }
        requestItemStatusChange(item.id, 'unchecked');
      };
      listItem.addEventListener('click', toggleHandler);
      listItem.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          toggleHandler();
        }
      });

      listItem.appendChild(bullet);
      listItem.appendChild(main);
      listItem.appendChild(chevron);
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
    applyChecklistPayload(checklist, { restartSync: refreshOptions.restartSync !== false });
    persistChecklistSnapshot();
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
    state.authUserContext = extractUserContextFromIdToken(state.idToken);
    var loadedFromSnapshot = false;
    try {
      var snapshotChecklist = await loadChecklistFromSnapshot();
      if (snapshotChecklist && snapshotChecklist.runId) {
        applyChecklistPayload(snapshotChecklist, {
          restartSync: true,
          currentUserOverride: state.authUserContext
        });
        loadedFromSnapshot = true;
      }
    } catch (snapshotError) {
      console.error('[sync] failed to load checklist snapshot', snapshotError);
    }

    if (loadedFromSnapshot) {
      refreshChecklist({ restartSync: false }).catch(function (error) {
        console.error('[sync] background api refresh failed', error);
      });
    } else {
      await refreshChecklist();
    }
    startConsistencyRefresh();
  }

  function start() {
    bindHamburgerMenu();
    setMenuOpen(false);

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
