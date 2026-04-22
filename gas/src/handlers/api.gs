var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  function createLineClient(channelAccessToken) {
    return {
      pushMessage: function (lineUserId, message) {
        ns.assert(channelAccessToken, 'config_error', 'LINE_CHANNEL_ACCESS_TOKEN が未設定です', 500);
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

    var checkMatch = path.match(/^\/api\/checklist-items\/([^/]+)\/check$/);
    if (method === 'POST' && checkMatch) {
      return ns.createJsonResponse(200, service.checkItem(request.query, checkMatch[1], request.body));
    }

    var uncheckMatch = path.match(/^\/api\/checklist-items\/([^/]+)\/uncheck$/);
    if (method === 'POST' && uncheckMatch) {
      return ns.createJsonResponse(200, service.uncheckItem(request.query, uncheckMatch[1], request.body));
    }

    var logsMatch = path.match(/^\/api\/checklists\/([^/]+)\/logs$/);
    if (method === 'GET' && logsMatch) {
      return ns.createJsonResponse(200, service.getLogs(request.query, logsMatch[1], request.query.action));
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
    repository.ensureSchema();

    var clock = options.clock || ns.defaultClock();
    var notificationService = ns.createNotificationService({
      repository: repository,
      clock: clock,
      lineClient: options.lineClient || createLineClient(options.channelAccessToken || scriptProperties.getProperty('LINE_CHANNEL_ACCESS_TOKEN'))
    });
    var checklistService = ns.createChecklistService({
      repository: repository,
      clock: clock,
      identityClient: options.identityClient,
      notificationService: notificationService,
      appBaseUrl: options.appBaseUrl || ScriptApp.getService().getUrl(),
      lineChannelId: options.lineChannelId || scriptProperties.getProperty('LINE_CHANNEL_ID'),
      allowAnonymousAccess: allowAnonymousAccess
    });
    var webhookHandler = ns.createWebhookHandler({
      appBaseUrl: options.appBaseUrl || ScriptApp.getService().getUrl(),
      channelSecret: options.channelSecret || scriptProperties.getProperty('LINE_CHANNEL_SECRET')
    });

    return {
      repository: repository,
      clock: clock,
      checklistService: checklistService,
      createWebhookSignature: webhookHandler.createWebhookSignature,
      handleWebhook: webhookHandler.handleWebhook,
      handleApiRequest: function (request) {
        try {
          var response = routeApiRequest(checklistService, request);
          ns.logEvent('info', 'api.request.success', {
            method: request.method,
            path: request.path,
            statusCode: response.statusCode
          });
          return response;
        } catch (error) {
          ns.logEvent('error', 'api.request.failed', {
            method: request.method,
            path: request.path,
            code: error && error.code ? String(error.code) : '',
            statusCode: error && error.statusCode ? Number(error.statusCode) : 500,
            message: error && error.message ? String(error.message) : ''
          });
          return ns.mapErrorToResponse(error);
        }
      },
      runDailyClosing: function () {
        return checklistService.runDailyClosing();
      },
      runDailyStart: function () {
        return checklistService.runDailyStart();
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
