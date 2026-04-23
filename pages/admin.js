(function (global) {
  var ADMIN_SESSION_STORAGE_KEY = 'ogawaya:admin:session-token';
  var JST_OFFSET_MS = 9 * 60 * 60 * 1000;

  var state = {
    config: null,
    token: '',
    storeId: '',
    selectedDate: '',
    calendarYear: 0,
    calendarMonth: 0,
    tasks: [],
    templates: [],
    checklist: null
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
    createTaskButton: document.getElementById('create-task-button'),
    taskSelect: document.getElementById('task-select'),
    insertTaskButton: document.getElementById('insert-task-button'),
    templateNameInput: document.getElementById('template-name-input'),
    templateTaskList: document.getElementById('template-task-list'),
    createTemplateButton: document.getElementById('create-template-button'),
    templateSelect: document.getElementById('template-select'),
    applyTemplateButton: document.getElementById('apply-template-button'),
    dateInput: document.getElementById('admin-date-input'),
    runItems: document.getElementById('admin-run-items'),
    calendarPrevButton: document.getElementById('calendar-prev'),
    calendarNextButton: document.getElementById('calendar-next'),
    calendarLabel: document.getElementById('calendar-label'),
    calendarGrid: document.getElementById('calendar-grid')
  };

  function normalizeBaseUrl(value) {
    return String(value || '').replace(/\/+$/, '');
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
      defaultStoreId: defaultStoreId
    };
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
    if (!Array.isArray(state.tasks) || state.tasks.length === 0) {
      var empty = document.createElement('li');
      empty.textContent = 'タスクがありません';
      elements.templateTaskList.appendChild(empty);
      return;
    }
    state.tasks.forEach(function (task) {
      var li = document.createElement('li');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = task.id;
      checkbox.id = 'template-task-' + task.id;
      var label = document.createElement('label');
      label.setAttribute('for', checkbox.id);
      label.textContent = task.title;
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
          label: task.title + (task.description ? ' - ' + task.description : '')
        };
      })
    );
    renderTemplateTaskChecklist();
  }

  function renderTemplateSelector() {
    fillSelectOptions(
      elements.templateSelect,
      (state.templates || []).map(function (template) {
        return {
          value: template.id,
          label: template.name
        };
      })
    );
  }

  function renderRunItems() {
    if (!elements.runItems) {
      return;
    }
    elements.runItems.innerHTML = '';
    var items = state.checklist && Array.isArray(state.checklist.items) ? state.checklist.items : [];
    if (items.length === 0) {
      var empty = document.createElement('li');
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

  async function loadTasks() {
    var response = await apiRequest('GET', '/api/admin/tasks', null);
    state.tasks = Array.isArray(response.tasks) ? response.tasks : [];
    renderTaskSelector();
  }

  async function loadTemplates() {
    var response = await apiRequest('GET', '/api/admin/templates', null);
    state.templates = Array.isArray(response.templates) ? response.templates : [];
    renderTemplateSelector();
  }

  async function loadRunItems() {
    var response = await apiRequest('GET', '/api/admin/runs/' + encodeURIComponent(state.selectedDate), null);
    state.checklist = response.checklist || null;
    renderRunItems();
  }

  async function createTask() {
    clearError();
    setStatus('タスクを作成しています...');
    var title = String((elements.taskTitleInput && elements.taskTitleInput.value) || '').trim();
    var description = String((elements.taskDescriptionInput && elements.taskDescriptionInput.value) || '').trim();
    if (!title) {
      throw new Error('タスク名を入力してください');
    }
    await apiRequest('POST', '/api/admin/tasks', {
      title: title,
      description: description
    });
    if (elements.taskTitleInput) {
      elements.taskTitleInput.value = '';
    }
    if (elements.taskDescriptionInput) {
      elements.taskDescriptionInput.value = '';
    }
    await loadTasks();
    setStatus('タスクを作成しました');
  }

  async function insertTask() {
    clearError();
    setStatus('タスクを挿入しています...');
    var taskId = elements.taskSelect ? String(elements.taskSelect.value || '') : '';
    if (!taskId) {
      throw new Error('挿入するタスクを選択してください');
    }
    await apiRequest(
      'POST',
      '/api/admin/runs/' + encodeURIComponent(state.selectedDate) + '/items:insert',
      {
        taskId: taskId
      }
    );
    await loadRunItems();
    setStatus('タスクを挿入しました');
  }

  async function createTemplate() {
    clearError();
    setStatus('テンプレートを作成しています...');
    var templateName = String((elements.templateNameInput && elements.templateNameInput.value) || '').trim();
    if (!templateName) {
      throw new Error('テンプレート名を入力してください');
    }
    var taskIds = readSelectedTemplateTaskIds();
    if (taskIds.length === 0) {
      throw new Error('テンプレートへ含めるタスクを1件以上選択してください');
    }
    await apiRequest('POST', '/api/admin/templates', {
      name: templateName,
      taskIds: taskIds
    });
    if (elements.templateNameInput) {
      elements.templateNameInput.value = '';
    }
    await loadTemplates();
    setStatus('テンプレートを作成しました');
  }

  async function applyTemplate() {
    clearError();
    setStatus('テンプレートを適用しています...');
    var templateId = elements.templateSelect ? String(elements.templateSelect.value || '') : '';
    if (!templateId) {
      throw new Error('テンプレートを選択してください');
    }
    await apiRequest(
      'POST',
      '/api/admin/runs/' + encodeURIComponent(state.selectedDate) + '/templates/' + encodeURIComponent(templateId) + ':apply',
      {}
    );
    await loadRunItems();
    setStatus('テンプレートを適用しました');
  }

  async function deleteRunItem(runItemId) {
    clearError();
    setStatus('タスクを削除しています...');
    await apiRequest(
      'DELETE',
      '/api/admin/runs/' + encodeURIComponent(state.selectedDate) + '/items/' + encodeURIComponent(runItemId),
      null
    );
    await loadRunItems();
    setStatus('タスクを削除しました');
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
    var year = Number(normalized.slice(0, 4));
    var month = Number(normalized.slice(5, 7));
    setCalendarMonth(year, month);
    await loadRunItems();
  }

  async function initializeAfterLogin() {
    await loadTasks();
    await loadTemplates();
    await loadRunItems();
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
        password: password
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
      await loadTasks();
      await loadTemplates();
      await loadRunItems();
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
      Promise.resolve()
        .then(handler)
        .catch(function (error) {
          setError(error && error.message ? String(error.message) : '操作に失敗しました');
          clearStatus();
        });
    });
  }

  function bindEvents() {
    bindButtonClick(elements.loginButton, login);
    bindButtonClick(elements.logoutButton, function () {
      logout();
    });
    bindButtonClick(elements.createTaskButton, createTask);
    bindButtonClick(elements.insertTaskButton, insertTask);
    bindButtonClick(elements.createTemplateButton, createTemplate);
    bindButtonClick(elements.applyTemplateButton, applyTemplate);

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
    setCalendarMonth(Number(state.selectedDate.slice(0, 4)), Number(state.selectedDate.slice(5, 7)));
    bindEvents();

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
