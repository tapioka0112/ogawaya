var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  var cachedScriptAppUrl = null;

  function resolveAppBaseUrl(explicitUrl) {
    if (explicitUrl) {
      return explicitUrl;
    }
    if (cachedScriptAppUrl) {
      return cachedScriptAppUrl;
    }
    cachedScriptAppUrl = ScriptApp.getService().getUrl();
    return cachedScriptAppUrl;
  }

  function createLineClient(channelAccessToken, propertyName) {
    return {
      pushMessage: function (lineUserId, message) {
        ns.assert(channelAccessToken, 'config_error', (propertyName || 'LINE_CHANNEL_ACCESS_TOKEN') + ' が未設定です', 500);
        var payload = {
          to: lineUserId,
          messages: [
            {
              type: 'text',
              text: message
            }
          ]
        };
        UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
          method: 'post',
          contentType: 'application/json',
          headers: {
            Authorization: 'Bearer ' + channelAccessToken
          },
          payload: JSON.stringify(payload)
        });
        return { status: 'sent' };
      }
    };
  }

  function createLineClientFactory(scriptProperties) {
    return {
      createPushClient: function (channel) {
        var propertyName = channel.access_token_property;
        ns.assert(propertyName, 'config_error', '通知チャネルの access_token_property が未設定です', 500);
        return createLineClient(scriptProperties.getProperty(propertyName), propertyName);
      }
    };
  }

  function createFirestoreSnapshotClient(projectId) {
    var normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) {
      return null;
    }
    return ns.createFirestoreSnapshotClient({
      projectId: normalizedProjectId,
      fetch: function (url, requestOptions) {
        return UrlFetchApp.fetch(url, requestOptions);
      },
      getOAuthToken: function () {
        return ScriptApp.getOAuthToken();
      },
      getAuthorizationInfo: function (scopes) {
        return ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, scopes);
      }
    });
  }

  function routeApiRequest(service, request) {
    var method = request.method;
    var path = request.path;

    if ((method === 'POST' || method === 'GET') && path === '/api/client-events') {
      var source = method === 'POST' ? (request.body || {}) : (request.query || {});
      ns.writeDebugEvent('api.client-events', {
        path: path,
        name: source.name || ''
      });
      ns.logEvent('info', 'client.event.http', {
        name: source.name || '',
        mode: source.mode || '',
        details: source.details || {
          message: source.message || '',
          code: source.code || '',
          statusCode: source.statusCode || ''
        }
      });
      return ns.createJsonResponse(200, { ok: true });
    }

    if (method === 'POST' && path === '/api/internal/firestore-events:apply') {
      return ns.createJsonResponse(200, service.applyFirestoreEventSync(request.query, request.body));
    }

    if (method === 'POST' && path === '/api/internal/firestore-events:sync') {
      return ns.createJsonResponse(200, service.syncFirestoreEventsFromFirestore(request.query, request.body));
    }

    if (method === 'POST' && path === '/api/internal/scheduled-items:repair') {
      return ns.createJsonResponse(200, service.repairScheduledItemsForExistingRun(request.query, request.body));
    }

    if (method === 'POST' && path === '/api/internal/firestore-events:install-trigger') {
      var triggerSecret = String(
        PropertiesService.getScriptProperties().getProperty('FIRESTORE_EVENT_SYNC_SECRET') || ''
      ).trim();
      ns.assert(triggerSecret, 'config_error', 'FIRESTORE_EVENT_SYNC_SECRET が未設定です', 500);
      ns.assert(
        String((request.body && request.body.syncSecret) || '').trim() === triggerSecret,
        'forbidden',
        'Firestore event sync secret が不正です',
        403
      );
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction && trigger.getHandlerFunction() === 'syncFirestoreEventsToSpreadsheet') {
          ScriptApp.deleteTrigger(trigger);
        }
      });
      ScriptApp.newTrigger('syncFirestoreEventsToSpreadsheet').timeBased().everyMinutes(5).create();
      return ns.createJsonResponse(200, { installed: true });
    }

    if (method === 'POST' && path === '/api/admin/login') {
      return ns.createJsonResponse(200, service.adminLogin(request.body));
    }
    if (method === 'GET' && path === '/api/admin/tasks') {
      return ns.createJsonResponse(200, service.listAdminTasks(request.query, request.body));
    }
    if (method === 'POST' && path === '/api/admin/tasks') {
      return ns.createJsonResponse(201, service.createAdminTask(request.query, request.body));
    }
    if (method === 'GET' && path.match(/^\/api\/admin\/runs\/(\d{4}-\d{2}-\d{2})$/)) {
      var runByDateMatch = path.match(/^\/api\/admin\/runs\/(\d{4}-\d{2}-\d{2})$/);
      return ns.createJsonResponse(200, service.getAdminRunByDate(request.query, request.body, runByDateMatch[1]));
    }
    if (method === 'POST' && path.match(/^\/api\/admin\/runs\/(\d{4}-\d{2}-\d{2})\/items:insert$/)) {
      var insertRunItemMatch = path.match(/^\/api\/admin\/runs\/(\d{4}-\d{2}-\d{2})\/items:insert$/);
      return ns.createJsonResponse(201, service.insertAdminRunItem(request.query, request.body, insertRunItemMatch[1]));
    }
    if (method === 'POST' && path.match(/^\/api\/admin\/runs\/(\d{4}-\d{2}-\d{2})\/templates\/([^/]+):apply$/)) {
      var applyTemplateMatch = path.match(/^\/api\/admin\/runs\/(\d{4}-\d{2}-\d{2})\/templates\/([^/]+):apply$/);
      return ns.createJsonResponse(
        201,
        service.applyAdminTemplateToRun(request.query, request.body, applyTemplateMatch[1], applyTemplateMatch[2])
      );
    }
    if (method === 'DELETE' && path.match(/^\/api\/admin\/runs\/(\d{4}-\d{2}-\d{2})\/items\/([^/]+)$/)) {
      var deleteRunItemMatch = path.match(/^\/api\/admin\/runs\/(\d{4}-\d{2}-\d{2})\/items\/([^/]+)$/);
      return ns.createJsonResponse(
        200,
        service.deleteAdminRunItem(request.query, request.body, deleteRunItemMatch[1], deleteRunItemMatch[2])
      );
    }
    if (method === 'GET' && path === '/api/admin/templates') {
      var adminToken = String((request.query && request.query.adminToken) || '');
      if (adminToken) {
        return ns.createJsonResponse(200, service.listAdminTemplates(request.query, request.body));
      }
    }
    if (method === 'POST' && path === '/api/admin/templates') {
      var adminTemplateToken = String(
        ((request.query && request.query.adminToken) || (request.body && request.body.adminToken) || '')
      );
      if (adminTemplateToken) {
        return ns.createJsonResponse(201, service.createAdminTemplate(request.query, request.body));
      }
    }

    if (method === 'GET' && path === '/api/me') {
      return ns.createJsonResponse(200, service.getMe(request.query));
    }
    if (method === 'POST' && path === '/api/link') {
      return ns.createJsonResponse(200, service.linkAccount(request.query, request.body));
    }
    if (method === 'GET' && path === '/api/checklists/today') {
      return ns.createJsonResponse(200, service.getTodayChecklist(request.query));
    }
    if (method === 'GET' && path === '/api/checklists/today/incomplete') {
      return ns.createJsonResponse(200, service.getTodayIncomplete(request.query));
    }
    if (method === 'GET' && path === '/api/stats/monthly') {
      return ns.createJsonResponse(200, service.getMonthlyStats(request.query));
    }
    if (method === 'GET' && path === '/api/stats/daily') {
      return ns.createJsonResponse(200, service.getDailyStats(request.query));
    }

    var checkMatch = path.match(/^\/api\/checklist-items\/([^/]+)\/check$/);
    if (method === 'POST' && checkMatch) {
      return ns.createJsonResponse(200, service.checkItem(request.query, checkMatch[1], request.body));
    }

    var uncheckMatch = path.match(/^\/api\/checklist-items\/([^/]+)\/uncheck$/);
    if (method === 'POST' && uncheckMatch) {
      return ns.createJsonResponse(200, service.uncheckItem(request.query, uncheckMatch[1], request.body));
    }

    if (method === 'POST' && path === '/api/admin/templates') {
      return ns.createJsonResponse(201, service.createTemplate(request.query, request.body));
    }
    if (method === 'GET' && path === '/api/admin/templates') {
      return ns.createJsonResponse(200, service.listTemplates(request.query));
    }

    var templateMatch = path.match(/^\/api\/admin\/templates\/([^/]+)$/);
    if (method === 'PUT' && templateMatch) {
      return ns.createJsonResponse(200, service.updateTemplate(request.query, templateMatch[1], request.body));
    }

    var createTemplateItemMatch = path.match(/^\/api\/admin\/templates\/([^/]+)\/items$/);
    if (method === 'POST' && createTemplateItemMatch) {
      return ns.createJsonResponse(201, service.createTemplateItem(request.query, createTemplateItemMatch[1], request.body));
    }

    var updateTemplateItemMatch = path.match(/^\/api\/admin\/templates\/([^/]+)\/items\/([^/]+)$/);
    if (method === 'PUT' && updateTemplateItemMatch) {
      return ns.createJsonResponse(
        200,
        service.updateTemplateItem(request.query, updateTemplateItemMatch[1], updateTemplateItemMatch[2], request.body)
      );
    }
    if (method === 'DELETE' && updateTemplateItemMatch) {
      return ns.createJsonResponse(
        200,
        service.deleteTemplateItem(request.query, updateTemplateItemMatch[1], updateTemplateItemMatch[2])
      );
    }

    var manualNotifyMatch = path.match(/^\/api\/admin\/checklists\/([^/]+)\/notify-incomplete$/);
    if (method === 'POST' && manualNotifyMatch) {
      return ns.createJsonResponse(200, service.notifyIncompleteManually(request.query, manualNotifyMatch[1]));
    }

    throw ns.createError('not_found', '未対応の API です', 404);
  }

  ns.createApplication = function (options) {
    options = options || {};
    var scriptProperties = PropertiesService.getScriptProperties();
    var allowAnonymousAccess = typeof options.allowAnonymousAccess === 'boolean'
      ? options.allowAnonymousAccess
      : scriptProperties.getProperty('ALLOW_ANONYMOUS_ACCESS') === 'true';
    var repository = options.repository || ns.createSpreadsheetRepository({
      storage: options.storage,
      spreadsheetId: options.spreadsheetId || scriptProperties.getProperty('SPREADSHEET_ID')
    });
    if (options.ensureSchema === true) {
      repository.ensureSchema();
    }

    var clock = options.clock || ns.defaultClock();
    var lineClientFactory = options.lineClientFactory || createLineClientFactory(scriptProperties);
    var notificationService = ns.createNotificationService({
      repository: repository,
      clock: clock,
      lineClient: options.lineClient || createLineClient(
        options.channelAccessToken || scriptProperties.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),
        'LINE_CHANNEL_ACCESS_TOKEN'
      ),
      lineClientFactory: lineClientFactory
    });
    var appBaseUrl = resolveAppBaseUrl(options.appBaseUrl);
    var checklistService = ns.createChecklistService({
      repository: repository,
      clock: clock,
      identityClient: options.identityClient,
      notificationService: notificationService,
      appBaseUrl: appBaseUrl,
      checklistAppUrl: options.checklistAppUrl || scriptProperties.getProperty('CHECKLIST_APP_URL') || appBaseUrl,
      lineLoginChannelId: options.lineLoginChannelId || scriptProperties.getProperty('LINE_LOGIN_CHANNEL_ID'),
      liffId: options.liffId || scriptProperties.getProperty('LIFF_ID'),
      lineChannelId: options.lineChannelId || scriptProperties.getProperty('LINE_CHANNEL_ID'),
      allowAnonymousAccess: allowAnonymousAccess,
      adminLoginId: options.adminLoginId || scriptProperties.getProperty('ADMIN_LOGIN_ID'),
      adminLoginPassword: options.adminLoginPassword || scriptProperties.getProperty('ADMIN_LOGIN_PASSWORD'),
      adminSessionTtlSeconds: options.adminSessionTtlSeconds || scriptProperties.getProperty('ADMIN_SESSION_TTL_SECONDS'),
      firestoreEventSyncSecret: options.firestoreEventSyncSecret
        || scriptProperties.getProperty('FIRESTORE_EVENT_SYNC_SECRET'),
      snapshotClient: typeof options.snapshotClient !== 'undefined'
        ? options.snapshotClient
        : createFirestoreSnapshotClient(
          options.firebaseProjectId
          || scriptProperties.getProperty('FIREBASE_PROJECT_ID')
          || ns.DEFAULT_FIREBASE_PROJECT_ID
        ),
      firestoreEventReader: typeof options.firestoreEventReader !== 'undefined'
        ? options.firestoreEventReader
        : ns.createFirestoreEventReader({
          projectId: options.firebaseProjectId
            || scriptProperties.getProperty('FIREBASE_PROJECT_ID')
            || ns.DEFAULT_FIREBASE_PROJECT_ID
        })
    });
    var webhookHandler = ns.createWebhookHandler({
      appBaseUrl: appBaseUrl,
      channelSecret: options.channelSecret || scriptProperties.getProperty('LINE_CHANNEL_SECRET')
    });

    return {
      repository: repository,
      clock: clock,
      checklistService: checklistService,
      createWebhookSignature: webhookHandler.createWebhookSignature,
      handleWebhook: webhookHandler.handleWebhook,
      handleApiRequest: function (request) {
        var startedAt = new Date().getTime();
        try {
          var response = routeApiRequest(checklistService, request);
          var durationMs = new Date().getTime() - startedAt;
          ns.logEvent('info', 'api.request.success', {
            method: request.method,
            path: request.path,
            statusCode: response.statusCode,
            durationMs: durationMs
          });
          return response;
        } catch (error) {
          var failedDurationMs = new Date().getTime() - startedAt;
          ns.logEvent('error', 'api.request.failed', {
            method: request.method,
            path: request.path,
            code: error && error.code ? String(error.code) : '',
            statusCode: error && error.statusCode ? Number(error.statusCode) : 500,
            message: error && error.message ? String(error.message) : '',
            durationMs: failedDurationMs
          });
          return ns.mapErrorToResponse(error);
        }
      },
      runDailyClosing: function () {
        return checklistService.runDailyClosing();
      },
      runDailyStart: function () {
        return checklistService.runDailyStart();
      },
      runDailyIncompleteReminder: function () {
        return checklistService.runDailyIncompleteReminder();
      },
      runReminderWatchdog: function () {
        return checklistService.runReminderWatchdog();
      },
      rebalanceNotificationRecipients: function () {
        return checklistService.rebalanceNotificationRecipients();
      },
      syncNotificationChannelUsage: function () {
        return checklistService.syncNotificationChannelUsage();
      },
      runFirestoreEventSync: function (options) {
        return checklistService.runFirestoreEventSync(options || {});
      }
    };
  };

  function handleGetTodayChecklist() {
    return ns.createApplication({}).handleApiRequest({
      method: 'GET',
      path: '/api/checklists/today',
      query: {},
      body: {}
    }).body;
  }

  this.handleGetTodayChecklist = handleGetTodayChecklist;
})(Ogawaya);
