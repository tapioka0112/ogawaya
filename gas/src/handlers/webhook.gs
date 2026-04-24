var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  ns.createWebhookHandler = function (options) {
    var appBaseUrl = options.appBaseUrl || '';
    var channelSecret = options.channelSecret;
    var webhookToken = options.webhookToken || '';
    var reminderAllowedSourceIds = options.reminderAllowedSourceIds || [];
    var reminderTriggerText = options.reminderTriggerText || '残りタスク通知';
    var checklistService = options.checklistService || null;
    var lineClient = options.lineClient || null;

    function assertWebhookAuthorized(request, bodyText) {
      ns.assert(channelSecret || webhookToken, 'config_error', 'LINE_CHANNEL_SECRET または LINE_WEBHOOK_TOKEN が未設定です', 500);

      var signatureValid = false;
      if (channelSecret && request.signature) {
        signatureValid = request.signature === ns.createWebhookSignature(bodyText, channelSecret);
      }
      var tokenValid = !!(webhookToken && request.token && request.token === webhookToken);
      ns.assert(signatureValid || tokenValid, 'forbidden', 'Webhook 認証に失敗しました', 403);
    }

    function getSourceId(source) {
      if (!source) {
        return '';
      }
      if (source.type === 'group') {
        return String(source.groupId || '');
      }
      if (source.type === 'room') {
        return String(source.roomId || '');
      }
      if (source.type === 'user') {
        return String(source.userId || '');
      }
      return '';
    }

    function isAllowedReminderSource(sourceId) {
      if (reminderAllowedSourceIds.indexOf('*') !== -1) {
        return true;
      }
      return reminderAllowedSourceIds.indexOf(sourceId) !== -1;
    }

    function isCalendarReminderEvent(event) {
      if (!event || event.type !== 'message' || !event.message || event.message.type !== 'text') {
        return false;
      }
      var text = String(event.message.text || '');
      return text.indexOf(reminderTriggerText) !== -1;
    }

    function logWebhookMessage(event, name) {
      var source = event.source || {};
      ns.writeDebugEvent('webhook.message', {
        name: name,
        sourceType: source.type || '',
        sourceId: getSourceId(source),
        hasReplyToken: !!event.replyToken,
        text: event.message && event.message.text ? String(event.message.text) : ''
      });
    }

    function handleCalendarReminderEvent(event) {
      logWebhookMessage(event, 'calendar_reminder_candidate');
      var sourceId = getSourceId(event.source);
      if (!isAllowedReminderSource(sourceId)) {
        ns.logEvent('info', 'webhook.calendar_reminder.skipped', {
          reason: 'source_not_allowed',
          sourceId: sourceId
        });
        return ns.createJsonResponse(200, { ok: true, skipped: 'source_not_allowed' });
      }
      if (!event.replyToken) {
        ns.logEvent('info', 'webhook.calendar_reminder.skipped', {
          reason: 'missing_reply_token',
          sourceId: sourceId
        });
        return ns.createJsonResponse(200, { ok: true, skipped: 'missing_reply_token' });
      }
      ns.assert(checklistService && typeof checklistService.prepareCalendarReminderReply === 'function', 'config_error', 'リマインダー返信サービスが未設定です', 500);
      ns.assert(lineClient && typeof lineClient.replyMessage === 'function', 'config_error', 'LINE reply client が未設定です', 500);

      var prepared = checklistService.prepareCalendarReminderReply(sourceId);
      if (!prepared.shouldReply) {
        return ns.createJsonResponse(200, { ok: true, skipped: prepared.reason || 'skipped' });
      }

      try {
        lineClient.replyMessage(event.replyToken, prepared.message);
        checklistService.recordCalendarReminderReply(prepared, 'sent', '');
        return ns.createJsonResponse(200, {
          ok: true,
          replied: true,
          targetDate: prepared.targetDate,
          uncheckedCount: prepared.uncheckedCount
        });
      } catch (error) {
        checklistService.recordCalendarReminderReply(prepared, 'failed', error.message);
        throw error;
      }
    }

    function createReplyPayload(menuKey) {
      var label = menuKey === 'today' ? 'チェックリストを開く' : 'LIFFを開く';
      return {
        ok: true,
        menuItems: ns.MENU_ITEMS.slice(),
        reply: {
          messages: [
            {
              type: 'text',
              text: '今日のチェックリストはこちら'
            },
            {
              type: 'template',
              altText: '会社共有チェックリスト',
              template: {
                type: 'buttons',
                text: '今日のチェックリストはこちら',
                actions: [
                  {
                    type: 'uri',
                    label: label,
                    uri: appBaseUrl + '?mode=user'
                  }
                ]
              }
            }
          ]
        }
      };
    }

    return {
      createWebhookSignature: function (payload) {
        return ns.createWebhookSignature(payload, channelSecret);
      },
      handleWebhook: function (request) {
        try {
          var bodyText = typeof request.body === 'string' ? request.body : JSON.stringify(request.body || {});
          assertWebhookAuthorized(request, bodyText);

          var payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
          var events = payload.events || [];
          for (var index = 0; index < events.length; index += 1) {
            var event = events[index];
            if (isCalendarReminderEvent(event)) {
              return handleCalendarReminderEvent(event);
            }
            if (event && event.postback && event.postback.data) {
              var menuMatch = event.postback.data.match(/menu=([^&]+)/);
              return ns.createJsonResponse(200, createReplyPayload(menuMatch ? menuMatch[1] : 'today'));
            }
          }
          return ns.createJsonResponse(200, { ok: true });
        } catch (error) {
          return ns.mapErrorToResponse(error);
        }
      }
    };
  };

  function handleLineWebhook(payload) {
    return ns.createWebhookHandler({
      appBaseUrl: ScriptApp.getService().getUrl(),
      channelSecret: PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_SECRET'),
      webhookToken: PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_TOKEN')
    }).handleWebhook({
      body: payload,
      signature: ''
    }).body;
  }

  this.handleLineWebhook = handleLineWebhook;
})(Ogawaya);
