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
    var functionsApiBaseUrl = normalizeBaseUrl(payload.functionsApiBaseUrl || '');
    var liffId = String(payload.liffId || '').trim();
    if (!gasApiBaseUrl && !functionsApiBaseUrl) {
      throw new Error('config.json の gasApiBaseUrl または functionsApiBaseUrl を設定してください');
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
      functionsApiBaseUrl: functionsApiBaseUrl,
      liffId: liffId,
      defaultStoreId: defaultStoreId,
      allowAnonymousAccess: payload.allowAnonymousAccess === true,
      tryLiffAuthInAnonymous: payload.tryLiffAuthInAnonymous === true,
      enableRealtimeSync: payload.enableRealtimeSync !== false,
      clientFirestoreWriteEnabled: payload.clientFirestoreWriteEnabled === true,
      consistencyRefreshSeconds: consistencyRefreshSeconds,
      firebase: normalizeFirebaseConfig(payload.firebase)
    };
  }

  var LAST_STORE_ID_STORAGE_KEY = 'ogawaya:last-store-id';
  var SNAPSHOT_DOC_ID = 'today';
  // 統計タブは Firestore snapshot をクライアント集計して表示する。
  var ITEM_ACTION_DISPATCH_DEBOUNCE_MS = 120;
  var ITEM_ACTION_REQUEST_TIMEOUT_MS = 2500;
  var ITEM_ACTION_RETRY_MAX_ATTEMPTS = 6;
  var BACKGROUND_GAS_SYNC_TIMEOUT_MS = 8000;
  var BACKGROUND_GAS_SYNC_RETRY_MAX_ATTEMPTS = 5;
  var FIRESTORE_WRITE_SUSPEND_MS = 5 * 60 * 1000;
  var JST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  var JST_HOUR_MINUTE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  function getTodayDateInJst() {
    var now = new Date();
    var hourMinuteText = JST_HOUR_MINUTE_FORMATTER.format(now);
    var parts = hourMinuteText.split(':');
    var hour = Number(parts[0] || 0);
    var minute = Number(parts[1] || 0);
    if (hour > 10 || (hour === 10 && minute >= 30)) {
      return JST_DATE_FORMATTER.format(now);
    }
    var previousDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    return JST_DATE_FORMATTER.format(previousDate);
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

  function createApi(options) {
    var normalizedGasBaseUrl = normalizeBaseUrl(options && options.gasApiBaseUrl ? options.gasApiBaseUrl : '');
    var normalizedFunctionsBaseUrl = normalizeBaseUrl(options && options.functionsApiBaseUrl ? options.functionsApiBaseUrl : '');
    var defaultStoreId = String(options && options.defaultStoreId ? options.defaultStoreId : '');
    var useFunctionsApi = normalizedFunctionsBaseUrl !== '';

    async function requestLegacyGas(method, path, idToken, body, queryExtras) {
      var query = {
        path: String(path || '').replace(/^\/+/, '')
      };
      if (idToken) {
        query.idToken = idToken;
      }
      Object.keys(queryExtras || {}).forEach(function (key) {
        query[key] = queryExtras[key];
      });

      var options = {
        method: method
      };
      if (method !== 'GET') {
        options.body = JSON.stringify(body || {});
      }

      var response = await fetch(appendQuery(normalizedGasBaseUrl, query), options);
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

    async function requestFunctionsApi(method, path, idToken, body, queryExtras) {
      var query = Object.assign({}, queryExtras || {});
      if (idToken) {
        query.idToken = idToken;
      }
      if (defaultStoreId && !query.storeId) {
        query.storeId = defaultStoreId;
      }
      var url = appendQuery(normalizedFunctionsBaseUrl + String(path || ''), query);
      var options = {
        method: method
      };
      if (method !== 'GET' && method !== 'DELETE') {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body || {});
      }
      var response = await fetch(url, options);
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

    function request(method, legacyPath, idToken, body, queryExtras) {
      if (useFunctionsApi) {
        if (legacyPath === 'api/checklists/today') {
          return requestFunctionsApi('GET', '/v1/user/checklists/today', idToken, body, queryExtras);
        }
        var checkMatch = String(legacyPath).match(/^api\/checklist-items\/([^/]+)\/check$/);
        if (checkMatch) {
          return requestFunctionsApi('POST', '/v1/user/checklist-items/' + encodeURIComponent(checkMatch[1]) + '/check', idToken, body, queryExtras);
        }
        var uncheckMatch = String(legacyPath).match(/^api\/checklist-items\/([^/]+)\/uncheck$/);
        if (uncheckMatch) {
          return requestFunctionsApi('POST', '/v1/user/checklist-items/' + encodeURIComponent(uncheckMatch[1]) + '/uncheck', idToken, body, queryExtras);
        }
      }
      return requestLegacyGas(method, legacyPath, idToken, body, queryExtras);
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
    firebaseAuthPromise: null,
    firestoreWriteSuspendedUntilMs: 0,
    realtimeEnabled: false,
    syncUnsubscribe: null,
    consistencyTimerId: null,
    visibilityHandlerBound: false,
    statsYear: new Date().getFullYear(),
    statsMonth: new Date().getMonth() + 1,
    statsData: null,
    statsSelectedDate: '',
    statsDailyData: null,
    statsDailyLoading: false,
    statsLoadRequestId: 0,
    statsDailyRequestId: 0,
    statsTodaySnapshotUnsubscribe: null,
    statsMonthStoreId: '',
    statsMonthlySnapshots: {},
    activeTab: 'home',
    selectedTaskDetailId: '',
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
    taskDetailPanel: document.getElementById('task-detail-panel'),
    taskDetailBackdrop: document.getElementById('task-detail-backdrop'),
    taskDetailClose: document.getElementById('task-detail-close'),
    taskDetailTitle: document.getElementById('task-detail-title'),
    taskDetailDescription: document.getElementById('task-detail-description'),
    taskDetailMeta: document.getElementById('task-detail-meta'),
    incompleteSummary: document.getElementById('incomplete-summary'),
    incompleteItems: document.getElementById('incomplete-items'),
    refreshButton: document.getElementById('refresh-button'),
    openAdminButton: document.getElementById('open-admin-button'),
    hamburgerButton: document.getElementById('hamburger-button'),
    todoMenu: document.getElementById('todo-menu'),
    tabHome: document.getElementById('tab-home'),
    tabStats: document.getElementById('tab-stats'),
    mainContent: document.getElementById('main-content'),
    statsContent: document.getElementById('stats-content'),
    statsOverallProgress: document.getElementById('stats-overall-progress'),
    statsOverallPct: document.getElementById('stats-overall-pct'),
    statsOverallInfo: document.getElementById('stats-overall-info'),
    statsMineProgress: document.getElementById('stats-mine-progress'),
    statsMinePct: document.getElementById('stats-mine-pct'),
    statsMineInfo: document.getElementById('stats-mine-info'),
    statsCalendar: document.getElementById('stats-calendar'),
    statsCalGridHeader: document.getElementById('stats-cal-grid-header'),
    statsMonthLabel: document.getElementById('stats-month-label'),
    statsPrevMonth: document.getElementById('stats-prev-month'),
    statsNextMonth: document.getElementById('stats-next-month'),
    statsDayDetailCard: document.getElementById('stats-day-detail-card'),
    statsDayDetailTitle: document.getElementById('stats-day-detail-title'),
    statsDayDetailSummary: document.getElementById('stats-day-detail-summary'),
    statsDayDetailItems: document.getElementById('stats-day-detail-items')
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

  function emitClientEvent(name, details) {
    if (!state.config || !state.config.gasApiBaseUrl || !global.fetch) {
      return;
    }
    var eventDetails = details || {};
    var query = {
      path: 'api/client-events',
      name: String(name || ''),
      mode: 'user',
      message: eventDetails.message ? String(eventDetails.message) : JSON.stringify(eventDetails),
      code: eventDetails.code ? String(eventDetails.code) : '',
      statusCode: eventDetails.statusCode ? String(eventDetails.statusCode) : ''
    };
    if (typeof eventDetails.elapsedMs === 'number') {
      query.elapsedMs = String(eventDetails.elapsedMs);
    }
    if (eventDetails.runItemId) {
      query.runItemId = String(eventDetails.runItemId);
    }
    if (eventDetails.desiredStatus) {
      query.desiredStatus = String(eventDetails.desiredStatus);
    }
    if (eventDetails.source) {
      query.source = String(eventDetails.source);
    }
    global.fetch(appendQuery(state.config.gasApiBaseUrl, query), {
      method: 'GET',
      mode: 'no-cors',
      keepalive: true
    }).catch(function () {});
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

  function setActiveTab(tabName) {
    if (!elements.tabHome || !elements.tabStats || !elements.mainContent || !elements.statsContent) {
      return;
    }
    var isStatsTab = tabName === 'stats';
    state.activeTab = isStatsTab ? 'stats' : 'home';
    elements.tabHome.classList.toggle('tab-btn--active', !isStatsTab);
    elements.tabStats.classList.toggle('tab-btn--active', isStatsTab);
    var progressCard = document.querySelector('.progress-card');
    if (progressCard) {
      progressCard.hidden = isStatsTab;
    }
    elements.mainContent.hidden = isStatsTab;
    elements.statsContent.hidden = !isStatsTab;
    if (isStatsTab) {
      updateMonthLabel();
      renderCalendar(state.statsYear, state.statsMonth, state.statsData ? state.statsData.calendar : []);
      renderStatsDayDetails();
      if (!state.statsData) {
        loadStats();
      } else if (state.statsSelectedDate) {
        loadDailyStats(state.statsSelectedDate);
      }
    }
  }

  function bindTabNavigation() {
    if (!elements.tabHome || !elements.tabStats || elements.tabHome.__boundTabs) {
      return;
    }
    elements.tabHome.__boundTabs = true;
    elements.tabHome.addEventListener('click', function () {
      setActiveTab('home');
    });
    elements.tabStats.addEventListener('click', function () {
      setActiveTab('stats');
    });
  }

  function bindStatsNavigation() {
    if (!elements.statsPrevMonth || !elements.statsNextMonth || elements.statsPrevMonth.__boundStatsNavigation) {
      return;
    }
    elements.statsPrevMonth.__boundStatsNavigation = true;
    elements.statsPrevMonth.addEventListener('click', function () {
      state.statsMonth -= 1;
      if (state.statsMonth < 1) {
        state.statsMonth = 12;
        state.statsYear -= 1;
      }
      stopDailyStatsSubscription();
      state.statsData = null;
      state.statsSelectedDate = '';
      state.statsDailyData = null;
      state.statsDailyLoading = false;
      loadStats();
    });
    elements.statsNextMonth.addEventListener('click', function () {
      state.statsMonth += 1;
      if (state.statsMonth > 12) {
        state.statsMonth = 1;
        state.statsYear += 1;
      }
      stopDailyStatsSubscription();
      state.statsData = null;
      state.statsSelectedDate = '';
      state.statsDailyData = null;
      state.statsDailyLoading = false;
      loadStats();
    });
  }

  function bindStatsCalendarSelection() {
    if (!elements.statsCalendar || elements.statsCalendar.__boundStatsCalendarSelection) {
      return;
    }
    elements.statsCalendar.__boundStatsCalendarSelection = true;

    function resolveDateTarget(eventTarget) {
      if (!eventTarget || typeof eventTarget.closest !== 'function') {
        return '';
      }
      var dateElement = eventTarget.closest('.stats-cal-day[data-date]');
      if (!dateElement || !elements.statsCalendar.contains(dateElement)) {
        return '';
      }
      return String(dateElement.dataset.date || '');
    }

    function openStatsDateDetails(date) {
      if (!date) {
        return;
      }
      state.statsSelectedDate = date;
      loadDailyStats(date);
    }

    elements.statsCalendar.addEventListener('click', function (event) {
      openStatsDateDetails(resolveDateTarget(event.target));
    });
    elements.statsCalendar.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
        return;
      }
      var date = resolveDateTarget(event.target);
      if (!date) {
        return;
      }
      event.preventDefault();
      openStatsDateDetails(date);
    });
  }

  function updateMonthLabel() {
    setText(elements.statsMonthLabel, state.statsYear + '年' + state.statsMonth + '月');
  }

  function renderDonutChart(progressEl, labelEl, pct) {
    var circumference = 201.06;
    var safePct = Math.max(0, Math.min(100, isFinite(pct) ? Math.round(pct) : 0));
    if (progressEl) {
      progressEl.style.strokeDashoffset = String(circumference * (1 - safePct / 100));
    }
    setText(labelEl, safePct + '%');
  }

  function renderStatsInfoContent(infoElement, lines) {
    if (!infoElement) {
      return;
    }
    infoElement.innerHTML = '';
    (lines || []).forEach(function (line) {
      var div = document.createElement('div');
      div.className = line.className || '';
      div.innerHTML = line.html || '';
      infoElement.appendChild(div);
    });
  }

  function renderCalendar(year, month, calendarItems) {
    if (!elements.statsCalendar) {
      return;
    }
    if (elements.statsCalGridHeader) {
      elements.statsCalGridHeader.innerHTML = '';
      ['日', '月', '火', '水', '木', '金', '土'].forEach(function (dow) {
        var headerCell = document.createElement('div');
        headerCell.className = 'stats-cal-dow';
        headerCell.textContent = dow;
        elements.statsCalGridHeader.appendChild(headerCell);
      });
    }

    var daysInMonth = new Date(year, month, 0).getDate();
    var firstDow = new Date(year, month - 1, 1).getDay();

    var calMap = {};
    (calendarItems || []).forEach(function (item) {
      if (item && item.date) {
        calMap[item.date] = item;
      }
    });

    var now = new Date();
    var tz = now.getMonth() + 1;
    var td = now.getDate();
    var todayStr = now.getFullYear() + '-' + (tz < 10 ? '0' + tz : tz) + '-' + (td < 10 ? '0' + td : td);
    var mm = month < 10 ? '0' + month : String(month);

    elements.statsCalendar.innerHTML = '';
    for (var blank = 0; blank < firstDow; blank += 1) {
      var blankCell = document.createElement('div');
      blankCell.className = 'stats-cal-day';
      elements.statsCalendar.appendChild(blankCell);
    }

    for (var day = 1; day <= daysInMonth; day += 1) {
      var dd = day < 10 ? '0' + day : String(day);
      var dateStr = year + '-' + mm + '-' + dd;
      var item = calMap[dateStr];
      var dayCell = item ? document.createElement('button') : document.createElement('div');
      if (item) {
        dayCell.type = 'button';
        dayCell.dataset.date = dateStr;
        dayCell.setAttribute('aria-label', dateStr + ' ' + String(item.checked || 0) + '/' + String(item.total || 0) + '件完了');
      }
      dayCell.textContent = String(day);
      var classes = ['stats-cal-day'];
      if (item) {
        if (item.achieved) {
          classes.push('stats-cal-day--achieved');
        } else if (item.total > 0) {
          classes.push('stats-cal-day--partial');
        }
      }
      if (dateStr === todayStr) {
        classes.push('stats-cal-day--today');
      }
      if (state.statsSelectedDate === dateStr) {
        classes.push('stats-cal-day--selected');
      }
      dayCell.className = classes.join(' ');
      elements.statsCalendar.appendChild(dayCell);
    }
  }

  function renderStatsDayDetails() {
    if (!elements.statsDayDetailCard) {
      return;
    }
    elements.statsDayDetailCard.hidden = false;
    clearList(elements.statsDayDetailItems);

    if (!state.statsSelectedDate) {
      setText(elements.statsDayDetailTitle, '日別の詳細');
      setText(elements.statsDayDetailSummary, 'カレンダーの日付を選択すると、当日の達成状況が表示されます。');
      return;
    }

    setText(elements.statsDayDetailTitle, state.statsSelectedDate + ' のタスク');
    if (state.statsDailyLoading) {
      setText(elements.statsDayDetailSummary, '読み込み中です...');
      return;
    }
    if (!state.statsDailyData) {
      setText(elements.statsDayDetailSummary, '日次データを取得できませんでした。');
      return;
    }
    if (state.statsDailyData.errorMessage) {
      setText(elements.statsDayDetailSummary, state.statsDailyData.errorMessage);
      return;
    }

    setText(
      elements.statsDayDetailSummary,
      '達成 ' + state.statsDailyData.checked + ' / ' + state.statsDailyData.total + ' 件'
    );

    var items = Array.isArray(state.statsDailyData.items) ? state.statsDailyData.items : [];
    if (items.length === 0) {
      elements.statsDayDetailItems.appendChild(createMessageListItem('この日のタスクはありません。', 'empty-item'));
      return;
    }

    items.forEach(function (item) {
      var listItem = document.createElement('li');
      listItem.className = 'stats-day-item';
      listItem.dataset.status = item.status === 'checked' ? 'checked' : 'unchecked';

      var title = document.createElement('div');
      title.className = 'stats-day-item-title';
      title.textContent = item.title;
      listItem.appendChild(title);

      var meta = document.createElement('div');
      meta.className = 'stats-day-item-meta';
      if (item.status === 'checked') {
        var checkedBy = item.checkedBy || 'LINEユーザー';
        var checkedAt = formatCheckedAtJst(item.checkedAt);
        meta.textContent = checkedAt ? '完了: ' + checkedBy + ' ・ ' + checkedAt : '完了: ' + checkedBy;
      } else {
        meta.textContent = '未完了';
      }
      listItem.appendChild(meta);
      elements.statsDayDetailItems.appendChild(listItem);
    });
  }

  function shouldLoadStatsForChecklistMonth() {
    if (!state.checklist || !state.checklist.targetDate) {
      return false;
    }
    var match = String(state.checklist.targetDate).match(/^(\d{4})-(\d{2})-/);
    if (!match) {
      return false;
    }
    return Number(match[1]) === state.statsYear && Number(match[2]) === state.statsMonth;
  }

  function stopMonthlyStatsSubscription() {
    if (typeof state.statsTodaySnapshotUnsubscribe === 'function') {
      state.statsTodaySnapshotUnsubscribe();
    }
    state.statsTodaySnapshotUnsubscribe = null;
    state.statsMonthStoreId = '';
  }

  function stopDailyStatsSubscription() {
    state.statsDailyRequestId += 1;
    state.statsDailyLoading = false;
  }

  function stopStatsSubscriptions() {
    stopMonthlyStatsSubscription();
    stopDailyStatsSubscription();
  }

  function isDateInStatsMonth(dateString) {
    var match = String(dateString || '').match(/^(\d{4})-(\d{2})-/);
    if (!match) {
      return false;
    }
    return Number(match[1]) === state.statsYear && Number(match[2]) === state.statsMonth;
  }

  function isCurrentStatsMonth(year, month) {
    var now = new Date();
    return now.getFullYear() === Number(year) && (now.getMonth() + 1) === Number(month);
  }

  function updateStatsFromCurrentChecklist() {
    if (!state.statsData || !shouldLoadStatsForChecklistMonth() || !state.checklist) {
      return false;
    }
    var targetDate = String(state.checklist.targetDate || '');
    if (!targetDate) {
      return false;
    }
    state.statsMonthlySnapshots[targetDate] = buildDailyStatsFromChecklist(state.checklist, targetDate);
    var currentUserId = state.checklist.currentUser ? String(state.checklist.currentUser.userId || '') : '';
    state.statsData = buildMonthlyStatsFromDailyStats(
      state.statsMonthlySnapshots,
      state.statsYear,
      state.statsMonth,
      currentUserId
    );
    if (state.statsSelectedDate === targetDate) {
      state.statsDailyData = state.statsMonthlySnapshots[targetDate];
      state.statsDailyLoading = false;
    }
    return true;
  }

  function onChecklistMutation() {
    var statsUpdatedLocally = updateStatsFromCurrentChecklist();
    if (!statsUpdatedLocally) {
      state.statsData = null;
    }
    if (state.activeTab === 'stats') {
      if (statsUpdatedLocally) {
        renderStats();
        return;
      }
      renderStatsDayDetails();
    }
  }

  function renderStats() {
    var data = state.statsData;
    if (!data) {
      return;
    }
    var overallPct = data.totalDays > 0 ? (data.achievedDays / data.totalDays) * 100 : 0;
    renderDonutChart(elements.statsOverallProgress, elements.statsOverallPct, overallPct);
    renderStatsInfoContent(elements.statsOverallInfo, [
      { className: 'stats-info-main', html: String(data.achievedDays) + '<em>日達成</em>' },
      { className: 'stats-info-sub', html: '今月は <strong>' + data.achievedDays + '/' + data.totalDays + '日</strong> でタスク達成' }
    ]);

    var minePct = data.totalItems > 0 ? (data.myCheckedItems / data.totalItems) * 100 : 0;
    renderDonutChart(elements.statsMineProgress, elements.statsMinePct, minePct);
    renderStatsInfoContent(elements.statsMineInfo, [
      { className: 'stats-info-main', html: String(data.myCheckedItems) + '<em>件 / ' + data.totalItems + '件</em>' },
      { className: 'stats-info-sub', html: '達成率 <strong>' + Math.round(minePct) + '%</strong>' }
    ]);

    updateMonthLabel();
    renderCalendar(data.year, data.month, data.calendar);
    renderStatsDayDetails();
  }

  function startStatsTodaySnapshotSubscription() {
    if (typeof state.statsTodaySnapshotUnsubscribe === 'function') {
      state.statsTodaySnapshotUnsubscribe();
    }
    state.statsTodaySnapshotUnsubscribe = null;
    if (!state.statsMonthStoreId || !isCurrentStatsMonth(state.statsYear, state.statsMonth) || !initializeRealtimeClient()) {
      return;
    }
    var requestId = state.statsLoadRequestId;
    var targetDate = getTodayDateInJst();
    state.statsTodaySnapshotUnsubscribe = buildSnapshotDocRef(state.statsMonthStoreId, targetDate).onSnapshot(function (doc) {
      if (state.statsLoadRequestId !== requestId) {
        return;
      }
      if (doc.exists) {
        state.statsMonthlySnapshots[targetDate] = normalizeDailyStatsFromSnapshotPayload(doc.data() || {}, targetDate);
      } else {
        delete state.statsMonthlySnapshots[targetDate];
      }
      var currentUserId = state.checklist && state.checklist.currentUser
        ? String(state.checklist.currentUser.userId || '')
        : '';
      state.statsData = buildMonthlyStatsFromDailyStats(
        state.statsMonthlySnapshots,
        state.statsYear,
        state.statsMonth,
        currentUserId
      );
      if (state.statsSelectedDate === targetDate) {
        state.statsDailyData = state.statsMonthlySnapshots[targetDate] || {
          date: targetDate,
          total: 0,
          checked: 0,
          achieved: false,
          items: []
        };
        state.statsDailyLoading = false;
      }
      if (state.activeTab === 'stats') {
        renderStats();
      }
    }, function (error) {
      console.error('[stats] failed to subscribe today snapshot', error);
    });
  }

  async function loadDailyStatsFromSnapshot(targetDate) {
    if (!targetDate) {
      stopDailyStatsSubscription();
      state.statsDailyData = null;
      return;
    }
    if (!initializeRealtimeClient()) {
      setError('統計データの読み込みに失敗しました。Firebase 設定を確認してください。');
      return;
    }
    var storeId = resolveStatsStoreId();
    if (!storeId) {
      return;
    }
    var requestId = state.statsDailyRequestId + 1;
    state.statsDailyRequestId = requestId;
    state.statsSelectedDate = targetDate;
    state.statsDailyLoading = true;
    state.statsDailyData = null;
    renderStatsDayDetails();
    if (state.statsMonthlySnapshots[targetDate]) {
      state.statsDailyData = state.statsMonthlySnapshots[targetDate];
      state.statsDailyLoading = false;
      renderStatsDayDetails();
      return;
    }
    try {
      var doc = await buildSnapshotDocRef(storeId, targetDate).get();
      if (state.statsDailyRequestId !== requestId) {
        return;
      }
      if (!doc.exists) {
        state.statsDailyData = {
          date: targetDate,
          total: 0,
          checked: 0,
          achieved: false,
          items: []
        };
      } else {
        state.statsDailyData = normalizeDailyStatsFromSnapshotPayload(doc.data() || {}, targetDate);
        if (isDateInStatsMonth(targetDate)) {
          state.statsMonthlySnapshots[targetDate] = state.statsDailyData;
        }
      }
      state.statsDailyLoading = false;
      renderStatsDayDetails();
    } catch (error) {
      if (state.statsDailyRequestId !== requestId) {
        return;
      }
      state.statsDailyLoading = false;
      state.statsDailyData = {
        errorMessage: buildApiErrorMessage(error, '日次統計の取得に失敗しました'),
        date: targetDate,
        total: 0,
        checked: 0,
        items: []
      };
      renderStatsDayDetails();
    }
  }

  async function loadMonthlyStatsFromSnapshots(year, month) {
    if (!initializeRealtimeClient()) {
      setError('統計データの読み込みに失敗しました。Firebase 設定を確認してください。');
      return;
    }
    var storeId = resolveStatsStoreId();
    if (!storeId) {
      return;
    }
    var requestId = state.statsLoadRequestId + 1;
    state.statsLoadRequestId = requestId;
    state.statsMonthlySnapshots = {};
    updateMonthLabel();
    state.statsData = buildEmptyMonthlyStats(year, month);
    renderStats();

    stopMonthlyStatsSubscription();
    state.statsMonthStoreId = storeId;
    try {
      var targetDates = buildMonthTargetDates(year, month);
      var dailyStatsEntries = await Promise.all(targetDates.map(function (targetDate) {
        return buildSnapshotDocRef(storeId, targetDate).get().then(function (doc) {
          if (!doc.exists) {
            return null;
          }
          return {
            targetDate: targetDate,
            daily: normalizeDailyStatsFromSnapshotPayload(doc.data() || {}, targetDate)
          };
        });
      }));
      if (state.statsLoadRequestId !== requestId) {
        return;
      }
      var snapshotMap = {};
      dailyStatsEntries.forEach(function (entry) {
        if (!entry || !entry.daily) {
          return;
        }
        snapshotMap[entry.targetDate] = entry.daily;
      });
      state.statsMonthlySnapshots = snapshotMap;
      var userId = state.checklist && state.checklist.currentUser
        ? String(state.checklist.currentUser.userId || '')
        : '';
      state.statsData = buildMonthlyStatsFromDailyStats(snapshotMap, year, month, userId);
      renderStats();
      startStatsTodaySnapshotSubscription();
      if (state.statsSelectedDate) {
        loadDailyStats(state.statsSelectedDate);
      }
    } catch (error) {
      if (state.statsLoadRequestId !== requestId) {
        return;
      }
      setError(buildApiErrorMessage(error, '統計データの取得に失敗しました'));
    }
  }

  function loadDailyStats(date) {
    loadDailyStatsFromSnapshot(date);
  }

  function loadStats() {
    loadMonthlyStatsFromSnapshots(state.statsYear, state.statsMonth);
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
      templateItemId: item.templateItemId,
      title: item.title,
      description: item.description,
      status: item.status,
      checkedBy: item.checkedBy,
      checkedByUserId: item.checkedByUserId,
      checkedAt: item.checkedAt,
      updatedAt: item.updatedAt
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
        templateItemId: String(item.templateItemId || ''),
        title: String(item.title || ''),
        description: String(item.description || ''),
        status: item.status === 'checked' ? 'checked' : 'unchecked',
        checkedBy: item.checkedBy ? String(item.checkedBy) : null,
        checkedByUserId: item.checkedByUserId ? String(item.checkedByUserId) : null,
        checkedAt: item.checkedAt ? String(item.checkedAt) : null,
        updatedAt: item.updatedAt ? String(item.updatedAt) : null
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
    renderSelectedTaskDetail({ focus: false });
    renderIncomplete();
    rememberStoreIdFromChecklist(state.checklist);
    if (applyOptions.restartSync !== false) {
      startRealtimeSync();
    }
    updateStatsFromCurrentChecklist();
    if (state.activeTab === 'stats') {
      var latestStatsStoreId = resolveStatsStoreId();
      var shouldReloadStats = !state.statsData || state.statsMonthStoreId !== latestStatsStoreId;
      if (shouldReloadStats) {
        loadStats();
      }
      if (state.statsSelectedDate) {
        loadDailyStats(state.statsSelectedDate);
      }
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
        confirmedItem: null,
        dispatchTimerId: null,
        retryTimerId: null,
        retryAttempt: 0
      };
    }
    return state.itemActions[runItemId];
  }

  function clearItemRetryTimer(actionState) {
    if (!actionState || !actionState.retryTimerId) {
      return;
    }
    global.clearTimeout(actionState.retryTimerId);
    actionState.retryTimerId = null;
  }

  function applyChecklistItemUpdate(updatedItem) {
    var target = findChecklistItemById(updatedItem.id);
    if (!target) {
      return;
    }
    var previousItem = cloneChecklistItem(target);
    target.status = updatedItem.status;
    target.checkedBy = updatedItem.checkedBy;
    target.checkedByUserId = updatedItem.checkedByUserId;
    target.checkedAt = updatedItem.checkedAt;
    target.updatedAt = updatedItem.updatedAt;
    if (Object.prototype.hasOwnProperty.call(updatedItem, 'templateItemId')) {
      target.templateItemId = updatedItem.templateItemId;
    }
    if (Object.prototype.hasOwnProperty.call(updatedItem, 'description')) {
      target.description = updatedItem.description;
    }
    recomputeProgress();
    renderChecklist();
    renderSelectedTaskDetail({ focus: false });
    renderOverview();
    renderIncomplete();
    onChecklistMutation(previousItem, cloneChecklistItem(target));
  }

  function buildOptimisticCheckedItem(item) {
    return {
      id: item.id,
      templateItemId: item.templateItemId,
      title: item.title,
      description: item.description,
      status: 'checked',
      checkedBy: state.checklist && state.checklist.currentUser ? state.checklist.currentUser.name : 'LINEユーザー',
      checkedByUserId: state.checklist && state.checklist.currentUser ? state.checklist.currentUser.userId : '',
      checkedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function buildOptimisticUncheckedItem(item) {
    return {
      id: item.id,
      templateItemId: item.templateItemId,
      title: item.title,
      description: item.description,
      status: 'unchecked',
      checkedBy: null,
      checkedByUserId: null,
      checkedAt: null,
      updatedAt: new Date().toISOString()
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

  function resolveItemUpdatedAtMs(item) {
    if (!item) {
      return 0;
    }
    return parseTimestampMillis(item.updatedAt);
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

  function ensureFirebaseAuthSession() {
    if (!initializeRealtimeClient()) {
      return Promise.reject(new Error('Firebase が初期化されていません'));
    }
    if (!global.firebase || typeof global.firebase.auth !== 'function') {
      return Promise.reject(new Error('Firebase Auth SDK が読み込まれていません'));
    }
    var auth = global.firebase.auth();
    if (auth.currentUser) {
      return Promise.resolve(auth.currentUser);
    }
    if (!state.firebaseAuthPromise) {
      state.firebaseAuthPromise = auth.signInAnonymously().then(function (result) {
        return result && result.user ? result.user : auth.currentUser;
      }).catch(function (error) {
        state.firebaseAuthPromise = null;
        throw error;
      });
    }
    return state.firebaseAuthPromise;
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

  function resolveStatsStoreId() {
    if (state.checklist && state.checklist.currentUser && state.checklist.currentUser.store) {
      var checklistStoreId = String(state.checklist.currentUser.store.id || '');
      if (checklistStoreId) {
        return checklistStoreId;
      }
    }
    var storedStoreId = readStorageValue(LAST_STORE_ID_STORAGE_KEY);
    if (storedStoreId) {
      return storedStoreId;
    }
    if (state.config && state.config.defaultStoreId) {
      return String(state.config.defaultStoreId);
    }
    return '';
  }

  function buildEmptyMonthlyStats(year, month) {
    return {
      year: year,
      month: month,
      totalDays: 0,
      achievedDays: 0,
      totalItems: 0,
      myCheckedItems: 0,
      calendar: []
    };
  }

  function buildMonthTargetDates(year, month) {
    var daysInMonth = new Date(year, month, 0).getDate();
    var monthString = month < 10 ? '0' + month : String(month);
    var targetDates = [];
    for (var day = 1; day <= daysInMonth; day += 1) {
      var dayString = day < 10 ? '0' + day : String(day);
      targetDates.push(String(year) + '-' + monthString + '-' + dayString);
    }
    return targetDates;
  }

  function normalizeStatsItem(item) {
    return {
      id: String(item && item.id ? item.id : ''),
      title: String(item && item.title ? item.title : ''),
      description: String(item && item.description ? item.description : ''),
      status: String(item && item.status ? item.status : 'unchecked') === 'checked' ? 'checked' : 'unchecked',
      checkedBy: item && item.checkedBy ? String(item.checkedBy) : null,
      checkedByUserId: item && item.checkedByUserId ? String(item.checkedByUserId) : null,
      checkedAt: item && item.checkedAt ? String(item.checkedAt) : null
    };
  }

  function buildDailyStatsFromChecklist(checklist, targetDate) {
    if (!checklist || typeof checklist !== 'object') {
      return {
        date: targetDate,
        total: 0,
        checked: 0,
        achieved: false,
        items: []
      };
    }
    var items = (Array.isArray(checklist.items) ? checklist.items : []).map(function (item) {
      return normalizeStatsItem(item);
    }).filter(function (item) {
      return item.id !== '' && item.title !== '';
    });
    var checkedCount = items.filter(function (item) {
      return item.status === 'checked';
    }).length;
    var resolvedDate = String(checklist.targetDate || targetDate || '');
    var total = items.length;
    return {
      date: resolvedDate,
      total: total,
      checked: checkedCount,
      achieved: total > 0 && checkedCount === total,
      items: items
    };
  }

  function normalizeDailyStatsFromSnapshotPayload(payload, targetDate) {
    if (!payload || typeof payload !== 'object') {
      return {
        date: targetDate,
        total: 0,
        checked: 0,
        achieved: false,
        items: []
      };
    }
    return buildDailyStatsFromChecklist(normalizeChecklistPayload(payload), targetDate);
  }

  function buildMonthlyStatsFromDailyStats(dailyStatsByDate, year, month, currentUserId) {
    var byDate = dailyStatsByDate && typeof dailyStatsByDate === 'object' ? dailyStatsByDate : {};
    var calendar = Object.keys(byDate).map(function (date) {
      var daily = byDate[date];
      return {
        date: date,
        achieved: daily && daily.achieved === true,
        total: Number(daily && daily.total ? daily.total : 0),
        checked: Number(daily && daily.checked ? daily.checked : 0)
      };
    }).filter(function (entry) {
      return entry.date !== '';
    }).sort(function (left, right) {
      return left.date.localeCompare(right.date);
    });
    var totalItems = calendar.reduce(function (sum, day) {
      return sum + Number(day.total || 0);
    }, 0);
    var achievedDays = calendar.reduce(function (sum, day) {
      return sum + (day.achieved ? 1 : 0);
    }, 0);
    var myCheckedItems = 0;
    if (currentUserId) {
      calendar.forEach(function (entry) {
        var daily = byDate[entry.date];
        var items = daily && Array.isArray(daily.items) ? daily.items : [];
        items.forEach(function (item) {
          if (item.status === 'checked' && String(item.checkedByUserId || '') === currentUserId) {
            myCheckedItems += 1;
          }
        });
      });
    }
    return {
      year: year,
      month: month,
      totalDays: calendar.length,
      achievedDays: achievedDays,
      totalItems: totalItems,
      myCheckedItems: myCheckedItems,
      calendar: calendar
    };
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

  function isFirestoreWriteSuspended() {
    return state.firestoreWriteSuspendedUntilMs > Date.now();
  }

  function suspendFirestoreWrites(error) {
    var code = error && error.code ? String(error.code) : '';
    if (
      code === 'permission-denied' ||
      code === 'resource-exhausted' ||
      code === 'auth/operation-not-allowed' ||
      code === 'auth/admin-restricted-operation' ||
      code === 'auth/configuration-not-found'
    ) {
      state.firestoreWriteSuspendedUntilMs = Date.now() + FIRESTORE_WRITE_SUSPEND_MS;
    }
  }

  function buildRealtimeEventPayload(updatedItem) {
    var targetInfo = ensureSyncTargetInfo();
    if (!targetInfo) {
      throw new Error('Firestore 同期対象が未確定です');
    }
    var sourceUserId = state.checklist && state.checklist.currentUser
      ? String(state.checklist.currentUser.userId || '')
      : '';

    return {
      runId: targetInfo.runId,
      targetDate: targetInfo.targetDate,
      storeId: targetInfo.storeId,
      itemId: String(updatedItem.id || ''),
      status: String(updatedItem.status || ''),
      checkedBy: updatedItem.checkedBy || '',
      checkedByUserId: updatedItem.checkedByUserId || '',
      checkedAt: updatedItem.checkedAt || '',
      updatedAt: global.firebase.firestore.FieldValue.serverTimestamp(),
      sourceUserId: sourceUserId,
      emittedAt: global.firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  function normalizeTemplateInsertEventItem(item) {
    return {
      id: String(item && item.id ? item.id : ''),
      templateItemId: String(item && item.templateItemId ? item.templateItemId : ''),
      title: String(item && item.title ? item.title : ''),
      description: String(item && item.description ? item.description : ''),
      status: 'unchecked',
      checkedBy: null,
      checkedByUserId: null,
      checkedAt: null,
      updatedAt: item && item.updatedAt ? String(item.updatedAt) : new Date().toISOString()
    };
  }

  function writeRealtimeEvent(updatedItem) {
    if (!state.config || state.config.clientFirestoreWriteEnabled !== true) {
      return Promise.reject(new Error('Firestore 直接書き込みは無効です'));
    }
    if (isFirestoreWriteSuspended()) {
      return Promise.reject(new Error('Firestore 直接書き込みを一時停止しています'));
    }
    if (!updatedItem) {
      return Promise.reject(new Error('Firestore event payload が空です'));
    }
    return ensureFirebaseAuthSession().then(function () {
      var targetInfo = ensureSyncTargetInfo();
      if (!targetInfo) {
        throw new Error('Firestore 同期対象が未確定です');
      }
      return state.firestore
        .collection('stores')
        .doc(targetInfo.storeId)
        .collection('runs')
        .doc(targetInfo.targetDate)
        .collection('events')
        .add(buildRealtimeEventPayload(updatedItem));
    }).catch(function (error) {
      suspendFirestoreWrites(error);
      throw error;
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
    if (eventPayload.type === 'template_insert') {
      applyTemplateInsertRealtimeEvent(eventPayload);
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
    var currentItem = findChecklistItemById(runItemId);
    var incomingUpdatedAtMs = parseTimestampMillis(eventPayload.updatedAt);
    if (incomingUpdatedAtMs <= 0) {
      return;
    }
    var latestKnownUpdatedAtMs = Math.max(
      resolveItemUpdatedAtMs(currentItem),
      resolveItemUpdatedAtMs(actionState.confirmedItem)
    );
    if (incomingUpdatedAtMs <= latestKnownUpdatedAtMs) {
      return;
    }
    actionState.lastSyncedAtMs = emittedAtMs;
    var syncedItem = {
      id: runItemId,
      title: currentItem ? currentItem.title : '',
      status: eventPayload.status,
      checkedBy: eventPayload.checkedBy || null,
      checkedByUserId: eventPayload.checkedByUserId || null,
      checkedAt: eventPayload.checkedAt || null,
      updatedAt: eventPayload.updatedAt || null
    };
    if (syncedItem.status === 'checked' && !syncedItem.checkedAt) {
      console.debug('[sync] ignore realtime event: missing_checked_at');
      return;
    }
    applyChecklistItemUpdate(syncedItem);
    actionState.confirmedItem = cloneChecklistItem(syncedItem);
  }

  function applyTemplateInsertRealtimeEvent(eventPayload) {
    var incomingItems = Array.isArray(eventPayload.items) ? eventPayload.items.map(normalizeTemplateInsertEventItem) : [];
    incomingItems = incomingItems.filter(function (item) {
      return item.id !== '' && item.title !== '';
    });
    if (incomingItems.length === 0) {
      return;
    }
    var existingItems = Array.isArray(state.checklist.items) ? state.checklist.items : [];
    var existingIds = {};
    var existingTemplateItemIds = {};
    existingItems.forEach(function (item) {
      existingIds[item.id] = true;
      if (item.templateItemId) {
        existingTemplateItemIds[item.templateItemId] = true;
      }
    });
    var newItems = incomingItems.filter(function (item) {
      if (existingIds[item.id]) {
        return false;
      }
      return !(item.templateItemId && existingTemplateItemIds[item.templateItemId]);
    });
    if (newItems.length === 0) {
      return;
    }
    state.checklist.items = existingItems.concat(newItems);
    recomputeProgress();
    renderChecklist();
    renderSelectedTaskDetail({ focus: false });
    renderOverview();
    renderIncomplete();
    updateStatsFromCurrentChecklist();
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
      var localUpdatedAtMs = resolveItemUpdatedAtMs(localItem);
      var serverUpdatedAtMs = resolveItemUpdatedAtMs(serverItem);
      if (localUpdatedAtMs > 0 && serverUpdatedAtMs <= 0) {
        return cloneChecklistItem(localItem);
      }
      if (localUpdatedAtMs > 0 && serverUpdatedAtMs > 0 && localUpdatedAtMs > serverUpdatedAtMs) {
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

  function scheduleItemStatusChange(runItemId) {
    var actionState = getItemActionState(runItemId);
    if (actionState.inFlight) {
      return;
    }
    if (actionState.dispatchTimerId) {
      global.clearTimeout(actionState.dispatchTimerId);
    }
    actionState.dispatchTimerId = global.setTimeout(function () {
      actionState.dispatchTimerId = null;
      processItemStatusChange(runItemId);
    }, ITEM_ACTION_DISPATCH_DEBOUNCE_MS);
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
    clearItemRetryTimer(actionState);
    actionState.retryAttempt = 0;
    actionState.desiredStatus = desiredStatus;
    applyOptimisticStatus(runItemId, desiredStatus);
    scheduleItemStatusChange(runItemId);
  }

  function scheduleItemStatusRetry(runItemId, requestError) {
    var actionState = getItemActionState(runItemId);
    if (actionState.inFlight || actionState.retryTimerId) {
      return;
    }
    var statusCode = requestError && typeof requestError.statusCode === 'number'
      ? requestError.statusCode
      : 0;
    var retryable = statusCode === 0 || statusCode >= 500;
    if (!retryable) {
      actionState.retryAttempt = 0;
      return;
    }

    actionState.retryAttempt = Math.min(actionState.retryAttempt + 1, ITEM_ACTION_RETRY_MAX_ATTEMPTS);
    var delayMs = Math.min(10000, 400 * Math.pow(2, actionState.retryAttempt - 1));
    actionState.retryTimerId = global.setTimeout(function () {
      actionState.retryTimerId = null;
      processItemStatusChange(runItemId);
    }, delayMs);
    setStatus('通信遅延のため保存を再試行しています...');
  }

  function syncItemStatusViaGas(runItemId, desiredStatus, timeoutMs) {
    var requestPromise = desiredStatus === 'checked'
      ? state.api.checkItem(state.idToken, runItemId)
      : state.api.uncheckItem(state.idToken, runItemId);
    return withTimeout(
      requestPromise,
      timeoutMs,
      'API 同期がタイムアウトしました'
    );
  }

  function syncItemStatusViaGasInBackground(runItemId, desiredStatus, expectedUpdatedAt, attempt) {
    var currentAttempt = Number(attempt || 1);
    global.setTimeout(function () {
      var latestItem = findChecklistItemById(runItemId);
      if (
        !latestItem ||
        latestItem.status !== desiredStatus ||
        String(latestItem.updatedAt || '') !== String(expectedUpdatedAt || '')
      ) {
        return;
      }
      var startedAtMs = Date.now();
      syncItemStatusViaGas(runItemId, desiredStatus, BACKGROUND_GAS_SYNC_TIMEOUT_MS).then(function () {
        emitClientEvent('item.sync.background_gas.success', {
          source: 'gas',
          runItemId: runItemId,
          desiredStatus: desiredStatus,
          elapsedMs: Date.now() - startedAtMs
        });
      }).catch(function (error) {
        emitClientEvent('item.sync.background_gas.failed', {
          source: 'gas',
          runItemId: runItemId,
          desiredStatus: desiredStatus,
          code: error && error.code ? String(error.code) : '',
          statusCode: error && typeof error.statusCode === 'number' ? error.statusCode : 0,
          message: error && error.message ? String(error.message) : 'background gas sync failed',
          elapsedMs: Date.now() - startedAtMs
        });
        console.error('[sync] background GAS sync failed', error);
        if (currentAttempt < BACKGROUND_GAS_SYNC_RETRY_MAX_ATTEMPTS) {
          syncItemStatusViaGasInBackground(runItemId, desiredStatus, expectedUpdatedAt, currentAttempt + 1);
        }
      });
    }, Math.min(15000, 1000 * currentAttempt));
  }

  function processItemStatusChange(runItemId) {
    var actionState = getItemActionState(runItemId);
    if (actionState.dispatchTimerId) {
      global.clearTimeout(actionState.dispatchTimerId);
      actionState.dispatchTimerId = null;
    }
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
    var optimisticItemForDispatch = desiredStatus === 'checked'
      ? buildOptimisticCheckedItem(currentItem)
      : buildOptimisticUncheckedItem(currentItem);

    actionState.inFlight = true;
    var requestFailed = false;
    var requestError = null;
    var syncStartedAtMs = Date.now();
    var syncSource = 'firestore';

    emitClientEvent('item.sync.start', {
      source: syncSource,
      runItemId: runItemId,
      desiredStatus: desiredStatus
    });

    var requestPromiseWithFallback = writeRealtimeEvent(optimisticItemForDispatch).then(function () {
      actionState.confirmedItem = cloneChecklistItem(optimisticItemForDispatch);
      syncItemStatusViaGasInBackground(runItemId, desiredStatus, optimisticItemForDispatch.updatedAt);
      emitClientEvent('item.sync.firestore.success', {
        source: 'firestore',
        runItemId: runItemId,
        desiredStatus: desiredStatus,
        elapsedMs: Date.now() - syncStartedAtMs
      });
      return {
        item: optimisticItemForDispatch
      };
    }).catch(function (firestoreError) {
      syncSource = 'gas';
      emitClientEvent('item.sync.firestore.fallback', {
        source: 'firestore',
        runItemId: runItemId,
        desiredStatus: desiredStatus,
        code: firestoreError && firestoreError.code ? String(firestoreError.code) : '',
        message: firestoreError && firestoreError.message ? String(firestoreError.message) : 'Firestore sync failed',
        elapsedMs: Date.now() - syncStartedAtMs
      });
      setStatus('高速同期に失敗したため通常保存に切り替えます');
      return syncItemStatusViaGas(runItemId, desiredStatus, ITEM_ACTION_REQUEST_TIMEOUT_MS);
    });

    requestPromiseWithFallback.then(function (response) {
      if (!response || !response.item) {
        requestFailed = true;
        return Promise.resolve();
      }
      var responseUpdatedAtMs = parseTimestampMillis(response.item.updatedAt);
      var confirmedUpdatedAtMs = resolveItemUpdatedAtMs(actionState.confirmedItem);
      if (responseUpdatedAtMs > 0 && confirmedUpdatedAtMs > 0 && responseUpdatedAtMs < confirmedUpdatedAtMs) {
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
      emitClientEvent('item.sync.success', {
        source: syncSource,
        runItemId: runItemId,
        desiredStatus: desiredStatus,
        elapsedMs: Date.now() - syncStartedAtMs
      });
      return Promise.resolve();
    }).catch(function (error) {
      requestFailed = true;
      if (typeof error.statusCode !== 'number') {
        error.statusCode = 0;
      }
      requestError = error;
      emitClientEvent('item.sync.failed', {
        source: syncSource,
        runItemId: runItemId,
        desiredStatus: desiredStatus,
        code: error && error.code ? String(error.code) : '',
        statusCode: error && typeof error.statusCode === 'number' ? error.statusCode : 0,
        message: error && error.message ? String(error.message) : 'sync failed',
        elapsedMs: Date.now() - syncStartedAtMs
      });
      setError(buildApiErrorMessage(error, 'チェック更新に失敗しました'));
    }).finally(function () {
      actionState.inFlight = false;
      var latestDesiredStatus = actionState.desiredStatus;
      var latestConfirmedStatus = actionState.confirmedItem ? actionState.confirmedItem.status : '';
      if (requestFailed) {
        scheduleItemStatusRetry(runItemId, requestError);
        renderChecklist();
        return;
      }
      clearItemRetryTimer(actionState);
      actionState.retryAttempt = 0;
      if (latestDesiredStatus && latestConfirmedStatus && latestDesiredStatus !== latestConfirmedStatus) {
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

  function buildTaskDetailMetaText(item) {
    if (!item) {
      return '';
    }
    if (item.status !== 'checked') {
      return '未完了';
    }
    var checkedBy = item.checkedBy || 'LINEユーザー';
    var checkedAtText = formatCheckedAtJst(item.checkedAt);
    return checkedAtText ? checkedBy + ' ・ ' + checkedAtText : checkedBy;
  }

  function hideTaskDetail() {
    state.selectedTaskDetailId = '';
    if (!elements.taskDetailPanel) {
      return;
    }
    elements.taskDetailPanel.hidden = true;
    delete elements.taskDetailPanel.dataset.status;
  }

  function renderTaskDetail(item, options) {
    if (!elements.taskDetailPanel || !item) {
      return;
    }
    var renderOptions = options || {};
    setText(elements.taskDetailTitle, item.title);
    setText(
      elements.taskDetailDescription,
      item.description ? String(item.description) : 'このタスクには詳細が登録されていません。'
    );
    setText(elements.taskDetailMeta, buildTaskDetailMetaText(item));
    elements.taskDetailPanel.dataset.status = item.status;
    elements.taskDetailPanel.hidden = false;
    if (renderOptions.focus !== false && elements.taskDetailClose && typeof elements.taskDetailClose.focus === 'function') {
      elements.taskDetailClose.focus();
    }
  }

  function renderSelectedTaskDetail(options) {
    if (!state.selectedTaskDetailId) {
      return;
    }
    var selectedItem = findChecklistItemById(state.selectedTaskDetailId);
    if (!selectedItem) {
      hideTaskDetail();
      return;
    }
    renderTaskDetail(selectedItem, options);
  }

  function openTaskDetail(runItemId) {
    var item = findChecklistItemById(runItemId);
    if (!item) {
      return;
    }
    state.selectedTaskDetailId = item.id;
    renderTaskDetail(item);
  }

  function bindTaskDetailModal() {
    if (elements.taskDetailClose) {
      elements.taskDetailClose.addEventListener('click', hideTaskDetail);
    }
    if (elements.taskDetailBackdrop) {
      elements.taskDetailBackdrop.addEventListener('click', hideTaskDetail);
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && elements.taskDetailPanel && !elements.taskDetailPanel.hidden) {
        hideTaskDetail();
      }
    });
  }

  function renderChecklist() {
    var checklist = state.checklist;
    clearList(elements.checklistItems);
    if (!checklist || !Array.isArray(checklist.items) || checklist.items.length === 0) {
      hideTaskDetail();
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

      var toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'todo-toggle-button';
      toggleButton.dataset.itemId = item.id;
      toggleButton.dataset.action = item.status === 'checked' ? 'uncheck' : 'check';
      toggleButton.setAttribute(
        'aria-label',
        item.status === 'checked'
          ? item.title + ' を未完了に戻す'
          : item.title + ' を完了にする'
      );
      var bullet = document.createElement('span');
      bullet.className = 'todo-bullet';
      bullet.dataset.status = item.status;
      toggleButton.appendChild(bullet);

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
      toggleButton.appendChild(main);

      var detailButton = document.createElement('button');
      detailButton.type = 'button';
      detailButton.className = 'todo-detail-button';
      detailButton.dataset.itemId = item.id;
      detailButton.dataset.action = 'detail';
      detailButton.setAttribute('aria-label', item.title + ' の詳細を表示');
      detailButton.textContent = '›';

      var openDetailHandler = function () {
        openTaskDetail(item.id);
      };
      var toggleHandler = function (event) {
        clearError();
        clearStatus();
        var latestItem = findChecklistItemById(item.id);
        if (!latestItem) {
          return;
        }
        var nextStatus = latestItem.status === 'unchecked' ? 'checked' : 'unchecked';
        requestItemStatusChange(item.id, nextStatus);
      };
      toggleButton.addEventListener('click', toggleHandler);
      detailButton.addEventListener('click', openDetailHandler);

      listItem.appendChild(toggleButton);
      listItem.appendChild(detailButton);
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
    global.OGAWAYA_APP_BASE_URL = config.gasApiBaseUrl || config.functionsApiBaseUrl;
    global.OGAWAYA_LIFF_ID = config.liffId;
    global.OGAWAYA_ALLOW_ANONYMOUS_ACCESS = config.allowAnonymousAccess;
    global.OGAWAYA_TRY_LIFF_AUTH_IN_ANONYMOUS = config.tryLiffAuthInAnonymous;

    state.api = createApi({
      gasApiBaseUrl: config.gasApiBaseUrl,
      functionsApiBaseUrl: config.functionsApiBaseUrl,
      defaultStoreId: config.defaultStoreId
    });
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
    bindTabNavigation();
    bindStatsNavigation();
    bindStatsCalendarSelection();
    bindTaskDetailModal();
    setActiveTab('home');
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
    if (elements.openAdminButton) {
      elements.openAdminButton.addEventListener('click', function () {
        setMenuOpen(false);
        global.location.href = './admin.html';
      });
    }

    global.addEventListener('beforeunload', function () {
      stopRealtimeSync();
      stopConsistencyRefresh();
      stopStatsSubscriptions();
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
