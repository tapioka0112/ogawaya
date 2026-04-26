(function (global) {
  var ADMIN_SESSION_STORAGE_KEY = 'ogawaya:admin:session-token:v3';
  var CLIENT_ID_STORAGE_KEY = 'ogawaya:client-id';
  var JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var TEMPLATE_GAS_SYNC_RETRY_MAX_ATTEMPTS = 5;
  var TEMPLATE_GAS_SYNC_BASE_DELAY_MS = 1000;

  var state = {
    config: null,
    token: '',
    storeId: '',
    selectedDate: '',
    calendarYear: 0,
    calendarMonth: 0,
    activeFlow: 'create-task',
    tasks: [],
    templates: [],
    checklist: null,
    runItemsByDate: {},
    runItemsRequestId: 0,
    runItemsLoading: false,
    firebaseApp: null,
    firestore: null,
    firebaseAuthPromise: null,
    clientInstanceId: ''
  };

  var elements = {
    loginPanel: document.getElementById('admin-login-panel'),
    mainPanel: document.getElementById('admin-main-panel'),
    taskManagementPanel: document.getElementById('task-management-panel'),
    calendarPanel: document.getElementById('calendar-panel'),
    errorBox: document.getElementById('error-message'),
    statusBox: document.getElementById('status-message'),
    loginIdInput: document.getElementById('admin-login-id'),
    loginPasswordInput: document.getElementById('admin-login-password'),
    loginButton: document.getElementById('admin-login-button'),
    logoutButton: document.getElementById('admin-logout-button'),
    taskTitleInput: document.getElementById('task-title-input'),
    taskDescriptionInput: document.getElementById('task-description-input'),
    taskPeriodInput: document.getElementById('task-period-input'),
    createTaskButton: document.getElementById('create-task-button'),
    taskSelect: document.getElementById('task-select'),
    insertDailyDateInput: document.getElementById('insert-daily-date-input'),
    insertWeekMonthInput: document.getElementById('insert-week-month-input'),
    insertWeekSelect: document.getElementById('insert-week-select'),
    insertMonthInput: document.getElementById('insert-month-input'),
    insertPeriodFields: document.querySelectorAll('[data-insert-period-field]'),
    insertTaskButton: document.getElementById('insert-task-button'),
    templateNameInput: document.getElementById('template-name-input'),
    templatePeriodInput: document.getElementById('template-period-input'),
    templateTaskList: document.getElementById('template-task-list'),
    createTemplateButton: document.getElementById('create-template-button'),
    templateSelect: document.getElementById('template-select'),
    templateDailyDateInput: document.getElementById('template-daily-date-input'),
    templateWeekMonthInput: document.getElementById('template-week-month-input'),
    templateWeekSelect: document.getElementById('template-week-select'),
    templateMonthInput: document.getElementById('template-month-input'),
    templatePeriodFields: document.querySelectorAll('[data-template-period-field]'),
    applyTemplateButton: document.getElementById('apply-template-button'),
    dateInput: document.getElementById('admin-date-input'),
    runItems: document.getElementById('admin-run-items'),
    calendarPrevButton: document.getElementById('calendar-prev'),
    calendarNextButton: document.getElementById('calendar-next'),
    calendarLabel: document.getElementById('calendar-label'),
    calendarGrid: document.getElementById('calendar-grid'),
    flowButtons: document.querySelectorAll('[data-admin-flow-button]'),
    flowPanels: document.querySelectorAll('[data-admin-flow-panel]')
  };

  var TASK_PERIOD_LABELS = {
    daily: '日間',
    weekly: '週間',
    monthly: '月間'
  };

  function normalizeTaskPeriod(value) {
    var normalized = String(value || '').trim();
    return Object.prototype.hasOwnProperty.call(TASK_PERIOD_LABELS, normalized) ? normalized : 'daily';
  }

  function getTaskPeriodLabel(period) {
    return TASK_PERIOD_LABELS[normalizeTaskPeriod(period)];
  }

  function normalizeBaseUrl(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function decodeFirestoreValue(value) {
    if (!value || typeof value !== 'object') {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) {
      return value.stringValue;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) {
      return Number(value.integerValue);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) {
      return Number(value.doubleValue);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) {
      return value.booleanValue === true;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) {
      return value.timestampValue;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
      return (value.arrayValue.values || []).map(decodeFirestoreValue);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
      return decodeFirestoreFields(value.mapValue.fields || {});
    }
    return null;
  }

  function decodeFirestoreFields(fields) {
    var decoded = {};
    Object.keys(fields || {}).forEach(function (key) {
      decoded[key] = decodeFirestoreValue(fields[key]);
    });
    return decoded;
  }

  function buildFirestoreRestEventsUrl(targetDate, pageToken) {
    var projectId = state.config && state.config.firebase ? String(state.config.firebase.projectId || '') : '';
    if (!projectId || !state.storeId || !targetDate) {
      return '';
    }
    var path = [
      'stores',
      state.storeId,
      'runs',
      targetDate,
      'events'
    ].map(encodeURIComponent).join('/');
    var url = 'https://firestore.googleapis.com/v1/projects/' +
      encodeURIComponent(projectId) +
      '/databases/(default)/documents/' +
      path +
      '?pageSize=300';
    if (pageToken) {
      url += '&pageToken=' + encodeURIComponent(pageToken);
    }
    return url;
  }

  function appendQuery(url, query) {
    var pairs = [];
    Object.keys(query || {}).forEach(function (key) {
      var value = query[key];
      if (value == null || value === '') {
        return;
      }
      pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    if (pairs.length === 0) {
      return url;
    }
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + pairs.join('&');
  }

  function getClientInstanceId() {
    if (state.clientInstanceId) {
      return state.clientInstanceId;
    }
    try {
      if (global.localStorage && typeof global.localStorage.getItem === 'function') {
        state.clientInstanceId = String(global.localStorage.getItem(CLIENT_ID_STORAGE_KEY) || '');
      }
    } catch (error) {
      state.clientInstanceId = '';
    }
    if (state.clientInstanceId) {
      return state.clientInstanceId;
    }
    state.clientInstanceId = 'client-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    try {
      if (global.localStorage && typeof global.localStorage.setItem === 'function') {
        global.localStorage.setItem(CLIENT_ID_STORAGE_KEY, state.clientInstanceId);
      }
    } catch (error) {
      // localStorage が使えない環境ではセッション内IDで同期する。
    }
    return state.clientInstanceId;
  }

  function setBoxMessage(element, message) {
    if (!element) {
      return;
    }
    element.textContent = String(message || '');
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

  function setAuthenticated(authenticated) {
    if (elements.loginPanel) {
      elements.loginPanel.hidden = authenticated;
    }
    if (elements.mainPanel) {
      elements.mainPanel.hidden = !authenticated;
    }
    if (elements.taskManagementPanel) {
      elements.taskManagementPanel.hidden = !authenticated;
    }
    if (elements.calendarPanel) {
      elements.calendarPanel.hidden = !authenticated;
    }
  }

  function setActiveFlow(flowName) {
    state.activeFlow = String(flowName || 'create-task');
    elements.flowButtons.forEach(function (button) {
      var isActive = button.dataset.adminFlowButton === state.activeFlow;
      button.dataset.active = isActive ? 'true' : 'false';
      button.classList.toggle('primary', isActive);
      button.classList.toggle('ghost', !isActive);
    });
    elements.flowPanels.forEach(function (panel) {
      panel.hidden = panel.dataset.adminFlowPanel !== state.activeFlow;
    });
    if (state.activeFlow === 'create-template') {
      renderTemplateTaskChecklist();
    }
  }

  function toJstDate(baseDate) {
    var date = baseDate instanceof Date ? baseDate : new Date(baseDate || Date.now());
    return new Date(date.getTime() + JST_OFFSET_MS);
  }

  function formatJstDate(dateValue) {
    var jstDate = toJstDate(dateValue);
    var year = jstDate.getUTCFullYear();
    var month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
    var day = String(jstDate.getUTCDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function getBusinessDateJst() {
    var jstDate = toJstDate(Date.now());
    var hour = jstDate.getUTCHours();
    var minute = jstDate.getUTCMinutes();
    if (hour > 10 || (hour === 10 && minute >= 30)) {
      return formatJstDate(jstDate);
    }
    var previous = new Date(jstDate.getTime() - (24 * 60 * 60 * 1000));
    return formatJstDate(previous);
  }

  function formatUtcDate(date) {
    var year = date.getUTCFullYear();
    var month = String(date.getUTCMonth() + 1).padStart(2, '0');
    var day = String(date.getUTCDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function parseMonthValue(monthValue) {
    var match = String(monthValue || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      throw new Error('対象月を選択してください');
    }
    return {
      year: Number(match[1]),
      month: Number(match[2])
    };
  }

  function formatMonthValue(dateValue) {
    return String(dateValue || '').slice(0, 7);
  }

  function addUtcDays(date, days) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + Number(days || 0)));
  }

  function listWeeksForMonth(monthValue) {
    var parts = parseMonthValue(monthValue);
    var firstDay = new Date(Date.UTC(parts.year, parts.month - 1, 1));
    var lastDay = new Date(Date.UTC(parts.year, parts.month, 0));
    var weekStart = addUtcDays(firstDay, -firstDay.getUTCDay());
    var weeks = [];
    while (weekStart <= lastDay) {
      var weekEnd = addUtcDays(weekStart, 6);
      weeks.push({
        index: weeks.length + 1,
        startDate: formatUtcDate(weekStart),
        endDate: formatUtcDate(weekEnd),
        label: '第' + (weeks.length + 1) + '週（' + formatUtcDate(weekStart).slice(5).replace('-', '/') + '〜' + formatUtcDate(weekEnd).slice(5).replace('-', '/') + '）'
      });
      weekStart = addUtcDays(weekStart, 7);
    }
    return weeks;
  }

  function safeSetStorage(key, value) {
    try {
      if (global.localStorage && typeof global.localStorage.setItem === 'function') {
        global.localStorage.setItem(key, value);
      }
    } catch (error) {
      // noop
    }
  }

  function safeGetStorage(key) {
    try {
      if (global.localStorage && typeof global.localStorage.getItem === 'function') {
        return String(global.localStorage.getItem(key) || '');
      }
    } catch (error) {
      // noop
    }
    return '';
  }

  function safeRemoveStorage(key) {
    try {
      if (global.localStorage && typeof global.localStorage.removeItem === 'function') {
        global.localStorage.removeItem(key);
      }
    } catch (error) {
      // noop
    }
  }

  async function loadConfig() {
    var response = await fetch('./config.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('config.json の読み込みに失敗しました');
    }
    var config = await response.json();
    var gasApiBaseUrl = normalizeBaseUrl(config.gasApiBaseUrl || '');
    var defaultStoreId = String(config.defaultStoreId || '').trim();
    if (!gasApiBaseUrl) {
      throw new Error('config.json の gasApiBaseUrl が未設定です');
    }
    if (!defaultStoreId) {
      throw new Error('config.json の defaultStoreId が未設定です');
    }
    return {
      gasApiBaseUrl: gasApiBaseUrl,
      defaultStoreId: defaultStoreId,
      enableRealtimeSync: config.enableRealtimeSync !== false,
      clientFirestoreWriteEnabled: config.clientFirestoreWriteEnabled === true,
      firebase: config.firebase || null
    };
  }

  function initializeRealtimeClient() {
    if (!state.config || !state.config.enableRealtimeSync || !state.config.firebase) {
      return false;
    }
    if (!global.firebase || typeof global.firebase.initializeApp !== 'function' || typeof global.firebase.firestore !== 'function') {
      return false;
    }
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

  function createApiError(message, statusCode, code) {
    var error = new Error(message);
    error.statusCode = Number(statusCode || 500);
    error.code = String(code || '');
    return error;
  }

  async function apiRequest(method, path, body, options) {
    var requestOptions = options || {};
    var query = Object.assign({}, requestOptions.query || {}, {
      path: String(path || '').replace(/^\/+/, '')
    });
    if (requestOptions.auth !== false) {
      if (!state.token) {
        throw createApiError('管理者ログインが必要です', 401, 'unauthorized');
      }
      query.adminToken = state.token;
    }
    if (method !== 'GET') {
      query._method = method;
    }
    if (body && typeof body === 'object' && Object.keys(body).length > 0) {
      query._payload = JSON.stringify(body);
    }
    var url = appendQuery(state.config.gasApiBaseUrl, query);
    var response = await fetch(url, {
      method: 'GET',
      cache: 'no-store'
    });
    var raw = await response.text();
    var json = {};
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw createApiError('API 応答の解析に失敗しました', response.status || 500, 'invalid_response');
    }
    var statusCode = typeof json.statusCode === 'number' ? json.statusCode : response.status;
    if (!json.ok || statusCode >= 400) {
      throw createApiError(
        json.message || 'API 実行に失敗しました',
        statusCode,
        json.code || ''
      );
    }
    return json;
  }

  function fillSelectOptions(selectElement, options) {
    if (!selectElement) {
      return;
    }
    selectElement.innerHTML = '';
    (options || []).forEach(function (option) {
      var optionElement = document.createElement('option');
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      selectElement.appendChild(optionElement);
    });
  }

  function renderTemplateTaskChecklist() {
    if (!elements.templateTaskList) {
      return;
    }
    elements.templateTaskList.innerHTML = '';
    var templatePeriod = getTemplateCreatePeriod();
    var templateTasks = (state.tasks || []).filter(function (task) {
      var taskPeriod = normalizeTaskPeriod(task && task.period);
      return taskPeriod === templatePeriod;
    });
    if (!Array.isArray(state.tasks) || state.tasks.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'template-task-empty';
      empty.textContent = 'タスクがありません';
      elements.templateTaskList.appendChild(empty);
      return;
    }
    if (templateTasks.length === 0) {
      var periodEmpty = document.createElement('li');
      periodEmpty.className = 'template-task-empty';
      periodEmpty.textContent = getTaskPeriodLabel(templatePeriod) + 'タスクがありません';
      elements.templateTaskList.appendChild(periodEmpty);
      return;
    }
    templateTasks.forEach(function (task) {
      var li = document.createElement('li');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = task.id;
      checkbox.id = 'template-task-' + task.id;
      var label = document.createElement('label');
      label.setAttribute('for', checkbox.id);
      label.textContent = '[' + getTaskPeriodLabel(task.period) + '] ' + task.title;
      label.title = label.textContent;
      li.appendChild(checkbox);
      li.appendChild(label);
      elements.templateTaskList.appendChild(li);
    });
  }

  function renderTaskSelector() {
    fillSelectOptions(
      elements.taskSelect,
      (state.tasks || []).map(function (task) {
        return {
          value: task.id,
          label: '[' + getTaskPeriodLabel(task.period) + '] ' + task.title + (task.description ? ' - ' + task.description : '')
        };
      })
    );
    if (state.activeFlow === 'create-template') {
      renderTemplateTaskChecklist();
    }
    updateInsertPeriodFields();
  }

  function getSelectedTask() {
    var taskId = elements.taskSelect ? String(elements.taskSelect.value || '') : '';
    if (!taskId) {
      return null;
    }
    return (state.tasks || []).find(function (task) {
      return task.id === taskId;
    }) || null;
  }

  function fillWeekSelect(monthInput, weekSelect) {
    if (!monthInput || !weekSelect) {
      return;
    }
    var monthValue = monthInput.value || formatMonthValue(state.selectedDate);
    var selectedValue = weekSelect.value;
    fillSelectOptions(
      weekSelect,
      listWeeksForMonth(monthValue).map(function (week) {
        return {
          value: week.startDate,
          label: week.label
        };
      })
    );
    if (selectedValue) {
      weekSelect.value = selectedValue;
    }
    if (!weekSelect.value && weekSelect.options.length > 0) {
      weekSelect.value = weekSelect.options[0].value;
    }
  }

  function fillWeekOptions() {
    fillWeekSelect(elements.insertWeekMonthInput, elements.insertWeekSelect);
  }

  function fillTemplateWeekOptions() {
    fillWeekSelect(elements.templateWeekMonthInput, elements.templateWeekSelect);
  }

  function updateInsertPeriodFields() {
    var task = getSelectedTask();
    var period = normalizeTaskPeriod(task && task.period);
    elements.insertPeriodFields.forEach(function (field) {
      field.hidden = field.dataset.insertPeriodField !== period;
    });
    if (elements.insertDailyDateInput && !elements.insertDailyDateInput.value) {
      elements.insertDailyDateInput.value = state.selectedDate;
    }
    if (elements.insertWeekMonthInput && !elements.insertWeekMonthInput.value) {
      elements.insertWeekMonthInput.value = formatMonthValue(state.selectedDate);
    }
    if (elements.insertMonthInput && !elements.insertMonthInput.value) {
      elements.insertMonthInput.value = formatMonthValue(state.selectedDate);
    }
    if (period === 'weekly') {
      fillWeekOptions();
    }
  }

  function getSelectedWeekStartDate() {
    if (!elements.insertWeekSelect || !elements.insertWeekSelect.value) {
      fillWeekOptions();
    }
    var selectedWeekStart = elements.insertWeekSelect ? String(elements.insertWeekSelect.value || '') : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedWeekStart)) {
      throw new Error('対象週を選択してください');
    }
    return selectedWeekStart;
  }

  function getSelectedMonthStartDate() {
    var parts = parseMonthValue(elements.insertMonthInput && elements.insertMonthInput.value);
    return parts.year + '-' + String(parts.month).padStart(2, '0') + '-01';
  }

  function getTemplateCreatePeriod() {
    return normalizeTaskPeriod(elements.templatePeriodInput && elements.templatePeriodInput.value);
  }

  function getInsertTargetDateForTask(task) {
    switch (normalizeTaskPeriod(task && task.period)) {
      case 'weekly':
        return getSelectedWeekStartDate();
      case 'monthly':
        return getSelectedMonthStartDate();
      default:
        var targetDate = elements.insertDailyDateInput ? String(elements.insertDailyDateInput.value || '') : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
          throw new Error('対象日を選択してください');
        }
        return targetDate;
    }
  }

  function renderTemplateSelector() {
    fillSelectOptions(
      elements.templateSelect,
      (state.templates || []).map(function (template) {
        var period = normalizeTaskPeriod(template && template.period);
        return {
          value: template.id,
          label: '[' + getTaskPeriodLabel(period) + '] ' + template.name
        };
      })
    );
    updateTemplatePeriodFields();
  }

  function getSelectedTemplatePeriod(template) {
    return normalizeTaskPeriod(template && template.period);
  }

  function updateTemplatePeriodFields() {
    var template = getSelectedTemplate();
    var period = getSelectedTemplatePeriod(template);
    elements.templatePeriodFields.forEach(function (field) {
      field.hidden = field.dataset.templatePeriodField !== period;
    });
    if (elements.templateDailyDateInput && !elements.templateDailyDateInput.value) {
      elements.templateDailyDateInput.value = state.selectedDate;
    }
    if (elements.templateWeekMonthInput && !elements.templateWeekMonthInput.value) {
      elements.templateWeekMonthInput.value = formatMonthValue(state.selectedDate);
    }
    if (elements.templateMonthInput && !elements.templateMonthInput.value) {
      elements.templateMonthInput.value = formatMonthValue(state.selectedDate);
    }
    if (period === 'weekly') {
      fillTemplateWeekOptions();
    }
  }

  function getSelectedTemplateWeekStartDate() {
    if (!elements.templateWeekSelect || !elements.templateWeekSelect.value) {
      fillTemplateWeekOptions();
    }
    var selectedWeekStart = elements.templateWeekSelect ? String(elements.templateWeekSelect.value || '') : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedWeekStart)) {
      throw new Error('対象週を選択してください');
    }
    return selectedWeekStart;
  }

  function getSelectedTemplateMonthStartDate() {
    var parts = parseMonthValue(elements.templateMonthInput && elements.templateMonthInput.value);
    return parts.year + '-' + String(parts.month).padStart(2, '0') + '-01';
  }

  function getTemplateApplyTargetDate(template) {
    switch (getSelectedTemplatePeriod(template)) {
      case 'weekly':
        return getSelectedTemplateWeekStartDate();
      case 'monthly':
        return getSelectedTemplateMonthStartDate();
      default:
        var targetDate = elements.templateDailyDateInput ? String(elements.templateDailyDateInput.value || '') : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
          throw new Error('対象日を選択してください');
        }
        return targetDate;
    }
  }

  function renderRunItems() {
    if (!elements.runItems) {
      return;
    }
    elements.runItems.innerHTML = '';
    var items = state.checklist && Array.isArray(state.checklist.items) ? state.checklist.items : [];
    if (state.runItemsLoading && items.length === 0) {
      var loading = document.createElement('li');
      loading.className = 'run-item-empty';
      loading.textContent = 'タスクを読み込み中です。';
      elements.runItems.appendChild(loading);
      return;
    }
    if (items.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'run-item-empty';
      empty.textContent = 'この日のタスクはありません。';
      elements.runItems.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      var li = document.createElement('li');
      var main = document.createElement('div');
      main.className = 'run-item-main';
      var title = document.createElement('div');
      title.className = 'run-item-title';
      title.textContent = item.title;
      var meta = document.createElement('div');
      meta.className = 'run-item-meta';
      if (item.status === 'checked') {
        var checkedBy = item.checkedBy || 'LINEユーザー';
        meta.textContent = checkedBy + ' が完了';
      } else if (item.pendingSave) {
        meta.textContent = '未完了・保存中';
      } else {
        meta.textContent = '未完了';
      }
      main.appendChild(title);
      main.appendChild(meta);

      var deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'run-item-delete';
      deleteButton.textContent = '削除';
      deleteButton.addEventListener('click', function () {
        deleteRunItem(item.id);
      });

      li.appendChild(main);
      li.appendChild(deleteButton);
      elements.runItems.appendChild(li);
    });
  }

  function normalizeMonth(year, month) {
    var normalizedYear = Number(year);
    var normalizedMonth = Number(month);
    if (normalizedMonth < 1) {
      normalizedYear -= 1;
      normalizedMonth = 12;
    }
    if (normalizedMonth > 12) {
      normalizedYear += 1;
      normalizedMonth = 1;
    }
    return {
      year: normalizedYear,
      month: normalizedMonth
    };
  }

  function setCalendarMonth(year, month) {
    var normalized = normalizeMonth(year, month);
    state.calendarYear = normalized.year;
    state.calendarMonth = normalized.month;
    renderCalendar();
  }

  function renderCalendar() {
    if (!elements.calendarGrid) {
      return;
    }
    var year = state.calendarYear;
    var month = state.calendarMonth;
    var monthLabel = year + '年' + month + '月';
    if (elements.calendarLabel) {
      elements.calendarLabel.textContent = monthLabel;
    }

    elements.calendarGrid.innerHTML = '';
    var firstDay = new Date(year, month - 1, 1).getDay();
    var lastDate = new Date(year, month, 0).getDate();

    for (var blankIndex = 0; blankIndex < firstDay; blankIndex += 1) {
      var blankCell = document.createElement('div');
      blankCell.className = 'calendar-day is-empty';
      elements.calendarGrid.appendChild(blankCell);
    }

    for (var day = 1; day <= lastDate; day += 1) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'calendar-day';
      var monthText = String(month).padStart(2, '0');
      var dayText = String(day).padStart(2, '0');
      var date = year + '-' + monthText + '-' + dayText;
      button.textContent = String(day);
      if (date === state.selectedDate) {
        button.classList.add('is-selected');
      }
      button.addEventListener('click', function (event) {
        var target = event.currentTarget;
        if (!target) {
          return;
        }
        var selectedDay = String(target.textContent || '').trim();
        if (!/^\d+$/.test(selectedDay)) {
          return;
        }
        var selectedDate = state.calendarYear
          + '-'
          + String(state.calendarMonth).padStart(2, '0')
          + '-'
          + String(Number(selectedDay)).padStart(2, '0');
        selectDate(selectedDate);
      });
      elements.calendarGrid.appendChild(button);
    }
  }

  function readSelectedTemplateTaskIds() {
    var selected = [];
    if (!elements.templateTaskList) {
      return selected;
    }
    var checkboxes = elements.templateTaskList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(function (checkbox) {
      if (checkbox.checked) {
        selected.push(String(checkbox.value || ''));
      }
    });
    return selected.filter(function (value) {
      return value !== '';
    });
  }

  function getCachedRunItems(date) {
    return state.runItemsByDate[String(date || '')] || null;
  }

  function rememberRunItems(date, checklist) {
    var normalizedDate = String(date || '');
    if (!normalizedDate) {
      return;
    }
    if (!checklist) {
      delete state.runItemsByDate[normalizedDate];
      return;
    }
    state.runItemsByDate[normalizedDate] = checklist;
  }

  function sortTasksBySortOrder(tasks) {
    return (tasks || []).slice().sort(function (a, b) {
      return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    });
  }

  function sortRunItemsByStableOrder(items) {
    return (items || []).slice();
  }

  function upsertTask(task) {
    state.tasks = sortTasksBySortOrder((state.tasks || []).filter(function (candidate) {
      return candidate.id !== task.id;
    }).concat([task]));
    renderTaskSelector();
  }

  function upsertTemplate(template) {
    state.templates = (state.templates || []).filter(function (candidate) {
      return candidate.id !== template.id;
    }).concat([template]);
    renderTemplateSelector();
  }

  function getSelectedTemplate() {
    var templateId = elements.templateSelect ? String(elements.templateSelect.value || '') : '';
    if (!templateId) {
      return null;
    }
    return (state.templates || []).find(function (template) {
      return template.id === templateId;
    }) || null;
  }

  function createClientRunItemId(templateItemId) {
    var suffix = String(templateItemId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36);
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return 'admin-' + global.crypto.randomUUID();
    }
    return 'admin-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + '-' + suffix;
  }

  function updateCurrentChecklistItems(items) {
    var baseChecklist = state.checklist || {
      targetDate: state.selectedDate,
      status: 'open',
      items: []
    };
    state.checklist = Object.assign({}, baseChecklist, {
      targetDate: baseChecklist.targetDate || state.selectedDate,
      items: sortRunItemsByStableOrder(items)
    });
    rememberRunItems(state.selectedDate, state.checklist);
    renderRunItems();
  }

  function appendRunItemsForDate(date, items) {
    var incomingItems = (items || []).filter(function (item) {
      return item && item.id;
    });
    if (incomingItems.length === 0) {
      return;
    }
    var targetDate = String(date || '');
    var baseChecklist = targetDate === state.selectedDate
      ? state.checklist
      : getCachedRunItems(targetDate);
    var existingItems = baseChecklist && Array.isArray(baseChecklist.items) ? baseChecklist.items : [];
    var incomingIds = {};
    var incomingTemplateItemIds = {};
    incomingItems.forEach(function (item) {
      incomingIds[item.id] = true;
      if (item.templateItemId) {
        incomingTemplateItemIds[item.templateItemId] = true;
      }
    });
    var nextItems = existingItems.filter(function (item) {
      if (incomingIds[item.id]) {
        return false;
      }
      return !(item.templateItemId && incomingTemplateItemIds[item.templateItemId]);
    }).concat(incomingItems);
    if (targetDate === state.selectedDate) {
      updateCurrentChecklistItems(nextItems);
      return;
    }
    rememberRunItems(targetDate, Object.assign({}, baseChecklist || {
      targetDate: targetDate,
      status: 'open',
      items: []
    }, {
      items: sortRunItemsByStableOrder(nextItems)
    }));
  }

  function appendCurrentRunItems(items) {
    appendRunItemsForDate(state.selectedDate, items);
  }

  function markRunItemsSavedForDate(date, runItemIds) {
    var targetDate = String(date || '');
    var idSet = {};
    (runItemIds || []).forEach(function (runItemId) {
      idSet[runItemId] = true;
    });
    var baseChecklist = targetDate === state.selectedDate
      ? state.checklist
      : getCachedRunItems(targetDate);
    if (!baseChecklist || !Array.isArray(baseChecklist.items)) {
      return;
    }
    var nextItems = baseChecklist.items.map(function (item) {
      if (!idSet[item.id]) {
        return item;
      }
      return Object.assign({}, item, {
        pendingSave: false
      });
    });
    if (targetDate === state.selectedDate) {
      updateCurrentChecklistItems(nextItems);
      return;
    }
    rememberRunItems(targetDate, Object.assign({}, baseChecklist, {
      items: nextItems
    }));
  }

  function getExistingTemplateItemIdSet() {
    var result = {};
    var items = state.checklist && Array.isArray(state.checklist.items) ? state.checklist.items : [];
    items.forEach(function (item) {
      if (item.templateItemId) {
        result[item.templateItemId] = true;
      }
    });
    return result;
  }

  function buildOptimisticTemplateRunItems(template) {
    var templateItems = template && Array.isArray(template.items) ? template.items : [];
    var templatePeriod = getSelectedTemplatePeriod(template);
    var existingTemplateItemIds = getExistingTemplateItemIdSet();
    var existingItems = state.checklist && Array.isArray(state.checklist.items) ? state.checklist.items : [];
    var maxSortOrder = existingItems.reduce(function (maxValue, item) {
      return Math.max(maxValue, Number(item.sortOrder || 0));
    }, 0);
    var now = new Date().toISOString();
    return templateItems.filter(function (item) {
      return item && item.id && normalizeTaskPeriod(item.period) === templatePeriod && !existingTemplateItemIds[item.id];
    }).map(function (item, index) {
      return {
        id: createClientRunItemId(item.id),
        templateItemId: String(item.id),
        title: String(item.title || ''),
        description: String(item.description || ''),
        period: normalizeTaskPeriod(item.period),
        sortOrder: maxSortOrder + index + 1,
        status: 'unchecked',
        checkedBy: null,
        checkedByUserId: null,
        checkedAt: null,
        updatedAt: now,
        pendingSave: true
      };
    }).filter(function (item) {
      return item.title !== '';
    });
  }

  function buildTemplateInsertEventPayload(targetDate, templateId, period, items) {
    var runId = state.checklist && state.checklist.runId ? String(state.checklist.runId) : '';
    if (!runId) {
      throw new Error('Firestore同期用のrunIdが未確定です');
    }
    return {
      type: 'template_insert',
      storeId: state.storeId,
      targetDate: targetDate,
      runId: runId,
      templateId: templateId,
      period: normalizeTaskPeriod(period),
      items: items.map(function (item) {
        return {
          id: item.id,
          templateItemId: item.templateItemId,
          title: item.title,
          description: item.description || '',
          period: normalizeTaskPeriod(item.period),
          sortOrder: Number(item.sortOrder || 0),
          updatedAt: item.updatedAt || ''
        };
      }),
      sourceUserId: 'admin:' + state.storeId,
      sourceClientId: getClientInstanceId(),
      emittedAt: global.firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  function writeTemplateInsertEvent(targetDate, templateId, period, items) {
    if (!state.config || state.config.clientFirestoreWriteEnabled !== true) {
      return Promise.reject(new Error('Firestore直接書き込みは無効です'));
    }
    if (!Array.isArray(items) || items.length === 0) {
      return Promise.resolve();
    }
    return ensureFirebaseAuthSession().then(function () {
      return state.firestore
        .collection('stores')
        .doc(state.storeId)
        .collection('runs')
        .doc(targetDate)
        .collection('events')
        .add(buildTemplateInsertEventPayload(targetDate, templateId, period, items));
    });
  }

  function normalizeTemplateInsertEventItem(item) {
    return {
      id: String(item && item.id ? item.id : ''),
      templateItemId: String(item && item.templateItemId ? item.templateItemId : ''),
      title: String(item && item.title ? item.title : ''),
      description: String(item && item.description ? item.description : ''),
      period: normalizeTaskPeriod(item && item.period),
      sortOrder: Number(item && item.sortOrder ? item.sortOrder : 0),
      status: 'unchecked',
      checkedBy: null,
      checkedByUserId: null,
      checkedAt: null,
      updatedAt: item && item.updatedAt ? String(item.updatedAt) : new Date().toISOString(),
      pendingSave: true
    };
  }

  function applyTemplateInsertEventToRunItems(eventPayload, targetDate) {
    if (!eventPayload || eventPayload.type !== 'template_insert') {
      return [];
    }
    if (String(eventPayload.storeId || '') !== String(state.storeId || '')) {
      return [];
    }
    if (String(eventPayload.targetDate || '') !== String(targetDate || '')) {
      return [];
    }
    var incomingItems = Array.isArray(eventPayload.items)
      ? eventPayload.items.map(normalizeTemplateInsertEventItem)
      : [];
    incomingItems = incomingItems.filter(function (item) {
      return item.id !== '' && item.title !== '';
    });
    if (incomingItems.length === 0) {
      return [];
    }

    var existingItems = state.checklist && Array.isArray(state.checklist.items) ? state.checklist.items : [];
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
      return [];
    }

    appendRunItemsForDate(targetDate, newItems);
    return newItems;
  }

  function sortFirestoreEvents(events) {
    return (events || []).slice().sort(function (a, b) {
      return String(a.emittedAt || '').localeCompare(String(b.emittedAt || ''));
    });
  }

  function loadTemplateInsertEventsFromFirestoreRest(targetDate) {
    if (!state.config || state.config.enableRealtimeSync !== true || !state.config.firebase) {
      return Promise.resolve([]);
    }
    var events = [];
    function loadPage(pageToken) {
      var url = buildFirestoreRestEventsUrl(targetDate, pageToken);
      if (!url) {
        return Promise.resolve(events);
      }
      return fetch(url, { method: 'GET', cache: 'no-store' }).then(function (response) {
        if (!response.ok) {
          throw new Error('Firestore events REST の読み込みに失敗しました');
        }
        return response.json();
      }).then(function (payload) {
        (payload.documents || []).forEach(function (doc) {
          events.push(decodeFirestoreFields(doc.fields || {}));
        });
        if (payload.nextPageToken) {
          return loadPage(payload.nextPageToken);
        }
        return events;
      });
    }
    return loadPage('');
  }

  function loadTemplateInsertEventsFromFirestoreSdk(targetDate) {
    if (!state.config || state.config.enableRealtimeSync !== true || !state.config.firebase) {
      return Promise.resolve([]);
    }
    if (!initializeRealtimeClient()) {
      return Promise.resolve([]);
    }
    return ensureFirebaseAuthSession().then(function () {
      return state.firestore
        .collection('stores')
        .doc(state.storeId)
        .collection('runs')
        .doc(targetDate)
        .collection('events')
        .orderBy('emittedAt', 'desc')
        .limit(300)
        .get();
    }).then(function (snapshot) {
      var events = [];
      snapshot.forEach(function (doc) {
        var data = doc && typeof doc.data === 'function' ? doc.data() : null;
        if (data && data.type === 'template_insert') {
          events.push(data);
        }
      });
      return events.reverse();
    });
  }

  function loadTemplateInsertEventsFromFirestore(targetDate) {
    return loadTemplateInsertEventsFromFirestoreRest(targetDate).catch(function (restError) {
      console.error('[admin-sync] template_insert event REST load failed', restError);
      return loadTemplateInsertEventsFromFirestoreSdk(targetDate).catch(function (sdkError) {
        console.error('[admin-sync] template_insert event SDK load failed', sdkError);
        return [];
      });
    }).then(sortFirestoreEvents);
  }

  function applyRunItemStatusEventToRunItems(eventPayload, targetDate) {
    if (!eventPayload || String(eventPayload.storeId || '') !== String(state.storeId || '')) {
      return false;
    }
    if (String(eventPayload.targetDate || '') !== String(targetDate || '')) {
      return false;
    }
    var runItemId = String(eventPayload.itemId || '');
    if (!runItemId || !eventPayload.status) {
      return false;
    }
    var baseChecklist = state.checklist || {
      targetDate: targetDate,
      status: 'open',
      items: []
    };
    var items = Array.isArray(baseChecklist.items) ? baseChecklist.items : [];
    var changed = false;
    var nextItems = items.map(function (item) {
      if (String(item.id || '') !== runItemId) {
        return item;
      }
      changed = true;
      return Object.assign({}, item, {
        status: String(eventPayload.status || item.status || 'unchecked'),
        checkedBy: eventPayload.checkedBy || null,
        checkedByUserId: eventPayload.checkedByUserId || null,
        checkedAt: eventPayload.checkedAt || null,
        updatedAt: eventPayload.updatedAt || item.updatedAt || null,
        pendingSave: false
      });
    });
    if (changed) {
      updateCurrentChecklistItems(nextItems);
    }
    return changed;
  }

  function restoreTemplateInsertEventsForDate(targetDate) {
    return loadTemplateInsertEventsFromFirestore(targetDate).then(function (events) {
      events.forEach(function (eventPayload) {
        if (eventPayload.type === 'template_insert') {
          var addedItems = applyTemplateInsertEventToRunItems(eventPayload, targetDate);
          if (addedItems.length > 0 && eventPayload.templateId) {
            syncTemplateInsertViaGasInBackground(
              targetDate,
              String(eventPayload.templateId),
              normalizeTaskPeriod(eventPayload.period),
              addedItems,
              0
            );
          }
          return;
        }
        applyRunItemStatusEventToRunItems(eventPayload, targetDate);
      });
    });
  }

  function buildTemplateClientItems(items) {
    return (items || []).map(function (item) {
      return {
        id: item.id,
        templateItemId: item.templateItemId
      };
    });
  }

  function syncTemplateInsertViaGasInBackground(targetDate, templateId, period, items, attempt) {
    var currentAttempt = Number(attempt || 0);
    apiRequest(
      'POST',
      '/api/admin/runs/' + encodeURIComponent(targetDate) + '/templates/' + encodeURIComponent(templateId) + ':apply',
      {
        period: normalizeTaskPeriod(period),
        clientItems: buildTemplateClientItems(items)
      }
    ).then(function (response) {
      if (Array.isArray(response.items) && response.items.length > 0) {
        appendRunItemsForDate(targetDate, response.items);
      } else {
        markRunItemsSavedForDate(targetDate, items.map(function (item) {
          return item.id;
        }));
      }
      if (targetDate === state.selectedDate) {
        setStatus('テンプレートを保存しました');
      }
    }).catch(function (error) {
      if (currentAttempt + 1 < TEMPLATE_GAS_SYNC_RETRY_MAX_ATTEMPTS) {
        global.setTimeout(function () {
          syncTemplateInsertViaGasInBackground(targetDate, templateId, period, items, currentAttempt + 1);
        }, TEMPLATE_GAS_SYNC_BASE_DELAY_MS * Math.pow(2, currentAttempt));
        return;
      }
      setError(error && error.message
        ? 'テンプレートの保存に失敗しました: ' + String(error.message)
        : 'テンプレートの保存に失敗しました');
    });
  }

  function removeCurrentRunItem(runItemId) {
    var existingItems = state.checklist && Array.isArray(state.checklist.items) ? state.checklist.items : [];
    updateCurrentChecklistItems(existingItems.filter(function (item) {
      return item.id !== runItemId;
    }));
  }

  async function loadTasks() {
    var response = await apiRequest('GET', '/api/admin/tasks', null);
    state.tasks = sortTasksBySortOrder(Array.isArray(response.tasks) ? response.tasks : []);
    renderTaskSelector();
  }

  async function loadTemplates() {
    var response = await apiRequest('GET', '/api/admin/templates', null);
    state.templates = Array.isArray(response.templates) ? response.templates : [];
    renderTemplateSelector();
  }

  async function loadRunItems(options) {
    var requestOptions = options || {};
    var targetDate = state.selectedDate;
    state.runItemsRequestId += 1;
    var requestId = state.runItemsRequestId;
    var cachedChecklist = requestOptions.preferCache === false ? null : getCachedRunItems(targetDate);
    state.runItemsLoading = true;
    state.checklist = cachedChecklist || null;
    renderRunItems();
    try {
      var response = await apiRequest('GET', '/api/admin/runs/' + encodeURIComponent(targetDate), null);
      if (requestId !== state.runItemsRequestId || targetDate !== state.selectedDate) {
        return;
      }
      state.checklist = response.checklist || null;
      rememberRunItems(targetDate, state.checklist);
      await restoreTemplateInsertEventsForDate(targetDate);
      if (requestId !== state.runItemsRequestId || targetDate !== state.selectedDate) {
        return;
      }
    } catch (error) {
      if (requestId !== state.runItemsRequestId || targetDate !== state.selectedDate) {
        return;
      }
      throw error;
    } finally {
      if (requestId === state.runItemsRequestId && targetDate === state.selectedDate) {
        state.runItemsLoading = false;
        renderRunItems();
      }
    }
  }

  async function createTask() {
    clearError();
    setStatus('タスクを作成しています...');
    var title = String((elements.taskTitleInput && elements.taskTitleInput.value) || '').trim();
    var description = String((elements.taskDescriptionInput && elements.taskDescriptionInput.value) || '').trim();
    var period = normalizeTaskPeriod(elements.taskPeriodInput && elements.taskPeriodInput.value);
    if (!title) {
      throw new Error('タスク名を入力してください');
    }
    var response = await apiRequest('POST', '/api/admin/tasks', {
      title: title,
      description: description,
      period: period
    });
    if (elements.taskTitleInput) {
      elements.taskTitleInput.value = '';
    }
    if (elements.taskDescriptionInput) {
      elements.taskDescriptionInput.value = '';
    }
    if (elements.taskPeriodInput) {
      elements.taskPeriodInput.value = 'daily';
    }
    if (response.task) {
      upsertTask(response.task);
    } else {
      await loadTasks();
    }
    setStatus('タスクを作成しました');
  }

  async function insertTask() {
    clearError();
    setStatus('タスクを挿入しています...');
    var taskId = elements.taskSelect ? String(elements.taskSelect.value || '') : '';
    if (!taskId) {
      throw new Error('挿入するタスクを選択してください');
    }
    var task = getSelectedTask();
    if (!task) {
      throw new Error('挿入するタスクが見つかりません');
    }
    var targetDate = getInsertTargetDateForTask(task);
    var response = await apiRequest(
      'POST',
      '/api/admin/runs/' + encodeURIComponent(targetDate) + '/items:insert',
      {
        taskId: taskId
      }
    );
    if (response.item) {
      appendRunItemsForDate(targetDate, [response.item]);
    } else if (targetDate === state.selectedDate) {
      await loadRunItems({ preferCache: false, targetDate: targetDate });
    }
    if (targetDate !== state.selectedDate) {
      await selectDate(targetDate);
    }
    setStatus('タスクを挿入しました');
  }

  async function createTemplate() {
    clearError();
    setStatus('テンプレートを作成しています...');
    var templateName = String((elements.templateNameInput && elements.templateNameInput.value) || '').trim();
    if (!templateName) {
      throw new Error('テンプレート名を入力してください');
    }
    var templatePeriod = getTemplateCreatePeriod();
    var taskIds = readSelectedTemplateTaskIds();
    if (taskIds.length === 0) {
      throw new Error('テンプレートへ含めるタスクを1件以上選択してください');
    }
    var response = await apiRequest('POST', '/api/admin/templates', {
      name: templateName,
      period: templatePeriod,
      taskIds: taskIds
    });
    if (elements.templateNameInput) {
      elements.templateNameInput.value = '';
    }
    if (response.template) {
      upsertTemplate(response.template);
    } else {
      await loadTemplates();
    }
    setStatus('テンプレートを作成しました');
  }

  async function applyTemplate() {
    clearError();
    setStatus('テンプレートを挿入しています...');
    var template = getSelectedTemplate();
    if (!template) {
      throw new Error('テンプレートを選択してください');
    }
    var targetDate = getTemplateApplyTargetDate(template);
    if (targetDate !== state.selectedDate) {
      await selectDate(targetDate);
    }
    var templatePeriod = getSelectedTemplatePeriod(template);
    var optimisticItems = buildOptimisticTemplateRunItems(template);
    if (optimisticItems.length === 0) {
      setStatus('このテンプレートのタスクはすでに挿入済みです');
      return;
    }
    appendCurrentRunItems(optimisticItems);
    setStatus('テンプレートを挿入しました。保存しています...');
    writeTemplateInsertEvent(targetDate, template.id, templatePeriod, optimisticItems).catch(function (error) {
      console.error('[admin-sync] template_insert realtime write failed', error);
    });
    syncTemplateInsertViaGasInBackground(targetDate, template.id, templatePeriod, optimisticItems, 0);
  }

  async function deleteRunItem(runItemId) {
    clearError();
    setStatus('タスクを削除しています...');
    var previousChecklist = state.checklist;
    removeCurrentRunItem(runItemId);
    try {
      await apiRequest(
        'DELETE',
        '/api/admin/runs/' + encodeURIComponent(state.selectedDate) + '/items/' + encodeURIComponent(runItemId),
        null
      );
      setStatus('タスクを削除しました');
    } catch (error) {
      state.checklist = previousChecklist;
      rememberRunItems(state.selectedDate, state.checklist);
      renderRunItems();
      throw error;
    }
  }

  async function selectDate(date) {
    var normalized = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new Error('日付形式が不正です');
    }
    state.selectedDate = normalized;
    if (elements.dateInput) {
      elements.dateInput.value = normalized;
    }
    if (elements.insertDailyDateInput) {
      elements.insertDailyDateInput.value = normalized;
    }
    if (elements.templateDailyDateInput) {
      elements.templateDailyDateInput.value = normalized;
    }
    var year = Number(normalized.slice(0, 4));
    var month = Number(normalized.slice(5, 7));
    setCalendarMonth(year, month);
    await loadRunItems({ preferCache: true });
  }

  async function initializeAfterLogin() {
    await Promise.all([
      loadTasks(),
      loadTemplates(),
      loadRunItems()
    ]);
  }

  async function login() {
    clearError();
    setStatus('ログインしています...');
    var loginId = String((elements.loginIdInput && elements.loginIdInput.value) || '').trim();
    var password = String((elements.loginPasswordInput && elements.loginPasswordInput.value) || '').trim();
    if (!loginId || !password) {
      throw new Error('管理者IDとパスワードを入力してください');
    }
    var response = await apiRequest(
      'POST',
      '/api/admin/login',
      {
        loginId: loginId,
        password: password,
        storeId: state.config.defaultStoreId
      },
      { auth: false }
    );
    state.token = String(response.session && response.session.token ? response.session.token : '');
    if (!state.token) {
      throw new Error('ログインに失敗しました');
    }
    safeSetStorage(ADMIN_SESSION_STORAGE_KEY, state.token);
    setAuthenticated(true);
    await initializeAfterLogin();
    clearStatus();
  }

  async function restoreSession() {
    var token = safeGetStorage(ADMIN_SESSION_STORAGE_KEY);
    if (!token) {
      return false;
    }
    state.token = token;
    try {
      await Promise.all([
        loadTasks(),
        loadTemplates(),
        loadRunItems()
      ]);
      setAuthenticated(true);
      return true;
    } catch (error) {
      state.token = '';
      safeRemoveStorage(ADMIN_SESSION_STORAGE_KEY);
      setAuthenticated(false);
      return false;
    }
  }

  function logout() {
    state.token = '';
    safeRemoveStorage(ADMIN_SESSION_STORAGE_KEY);
    setAuthenticated(false);
    clearStatus();
    if (elements.loginPasswordInput) {
      elements.loginPasswordInput.value = '';
    }
  }

  function bindButtonClick(button, handler) {
    if (!button) {
      return;
    }
    button.addEventListener('click', function () {
      button.disabled = true;
      Promise.resolve()
        .then(handler)
        .catch(function (error) {
          setError(error && error.message ? String(error.message) : '操作に失敗しました');
          clearStatus();
        })
        .finally(function () {
          button.disabled = false;
        });
    });
  }

  function bindEvents() {
    elements.flowButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        setActiveFlow(button.dataset.adminFlowButton);
      });
    });

    bindButtonClick(elements.loginButton, login);
    bindButtonClick(elements.logoutButton, function () {
      logout();
    });
    bindButtonClick(elements.createTaskButton, createTask);
    bindButtonClick(elements.insertTaskButton, insertTask);
    bindButtonClick(elements.createTemplateButton, createTemplate);
    bindButtonClick(elements.applyTemplateButton, applyTemplate);

    if (elements.taskSelect) {
      elements.taskSelect.addEventListener('change', updateInsertPeriodFields);
    }
    if (elements.insertWeekMonthInput) {
      elements.insertWeekMonthInput.addEventListener('change', fillWeekOptions);
    }
    if (elements.templatePeriodInput) {
      elements.templatePeriodInput.addEventListener('change', renderTemplateTaskChecklist);
    }
    if (elements.templateSelect) {
      elements.templateSelect.addEventListener('change', updateTemplatePeriodFields);
    }
    if (elements.templateWeekMonthInput) {
      elements.templateWeekMonthInput.addEventListener('change', fillTemplateWeekOptions);
    }

    if (elements.dateInput) {
      elements.dateInput.addEventListener('change', function () {
        selectDate(elements.dateInput.value).catch(function (error) {
          setError(error && error.message ? String(error.message) : '日付の更新に失敗しました');
        });
      });
    }

    if (elements.calendarPrevButton) {
      elements.calendarPrevButton.addEventListener('click', function () {
        setCalendarMonth(state.calendarYear, state.calendarMonth - 1);
      });
    }
    if (elements.calendarNextButton) {
      elements.calendarNextButton.addEventListener('click', function () {
        setCalendarMonth(state.calendarYear, state.calendarMonth + 1);
      });
    }
  }

  async function boot() {
    state.config = await loadConfig();
    state.storeId = state.config.defaultStoreId;
    state.selectedDate = getBusinessDateJst();
    if (elements.dateInput) {
      elements.dateInput.value = state.selectedDate;
    }
    if (elements.insertDailyDateInput) {
      elements.insertDailyDateInput.value = state.selectedDate;
    }
    if (elements.templateDailyDateInput) {
      elements.templateDailyDateInput.value = state.selectedDate;
    }
    if (elements.insertWeekMonthInput) {
      elements.insertWeekMonthInput.value = formatMonthValue(state.selectedDate);
    }
    if (elements.templateWeekMonthInput) {
      elements.templateWeekMonthInput.value = formatMonthValue(state.selectedDate);
    }
    if (elements.insertMonthInput) {
      elements.insertMonthInput.value = formatMonthValue(state.selectedDate);
    }
    if (elements.templateMonthInput) {
      elements.templateMonthInput.value = formatMonthValue(state.selectedDate);
    }
    updateInsertPeriodFields();
    updateTemplatePeriodFields();
    setCalendarMonth(Number(state.selectedDate.slice(0, 4)), Number(state.selectedDate.slice(5, 7)));
    bindEvents();
    setActiveFlow(state.activeFlow);

    var restored = await restoreSession();
    if (!restored) {
      setAuthenticated(false);
      clearStatus();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      boot().catch(function (error) {
        setError(error && error.message ? String(error.message) : '初期化に失敗しました');
      });
    }, { once: true });
  } else {
    boot().catch(function (error) {
      setError(error && error.message ? String(error.message) : '初期化に失敗しました');
    });
  }
})(globalThis);
