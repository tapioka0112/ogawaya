(function (ns) {
  ns.createWebhookHandler = function (options) {
    var appBaseUrl = options.appBaseUrl || '';
    var channelSecret = options.channelSecret;

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
          ns.assert(channelSecret, 'config_error', 'LINE_CHANNEL_SECRET が未設定です', 500);
          var expectedSignature = ns.createWebhookSignature(bodyText, channelSecret);
          ns.assert(request.signature === expectedSignature, 'forbidden', '署名が不正です', 403);

          var payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
          var event = (payload.events || [])[0];
          if (!event || !event.postback || !event.postback.data) {
            return ns.createJsonResponse(200, { ok: true });
          }

          var menuMatch = event.postback.data.match(/menu=([^&]+)/);
          return ns.createJsonResponse(200, createReplyPayload(menuMatch ? menuMatch[1] : 'today'));
        } catch (error) {
          return ns.mapErrorToResponse(error);
        }
      }
    };
  };

  function handleLineWebhook(payload) {
    return ns.createWebhookHandler({
      appBaseUrl: ScriptApp.getService().getUrl(),
      channelSecret: PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_SECRET')
    }).handleWebhook({
      body: payload,
      signature: ''
    }).body;
  }

  this.handleLineWebhook = handleLineWebhook;
})(Ogawaya);
