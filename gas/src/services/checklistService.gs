var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  function listNotificationTypes() {
    return Object.keys(ns.NOTIFICATION_TYPES).map(function (key) {
      return ns.NOTIFICATION_TYPES[key];
    });
  }

  function summarizeId(value) {
    var normalized = String(value || '');
    if (!normalized) {
      return '';
    }
    if (normalized.length <= 10) {
      return normalized;
    }
    return normalized.slice(0, 4) + '...' + normalized.slice(-4);
  }

  function buildErrorLog(error) {
    return {
      code: error && error.code ? String(error.code) : '',
      statusCode: error && error.statusCode ? Number(error.statusCode) : 0,
      message: error && error.message ? String(error.message) : ''
    };
  }

  function nowMillis() {
    return new Date().getTime();
  }

  function getScriptCacheSafely() {
    if (typeof CacheService === 'undefined' || !CacheService || typeof CacheService.getScriptCache !== 'function') {
      return null;
    }
    try {
      return CacheService.getScriptCache();
    } catch (error) {
      ns.logEvent('warn', 'auth.verify.cache_unavailable', {
        message: error && error.message ? String(error.message) : ''
      });
      return null;
    }
  }

  function buildIdentityCacheKey(idToken) {
    var digest = Utilities.computeHmacSha256Signature(String(idToken || ''), 'ogawaya:idtoken:cache:v1');
    return 'ogawaya:idtoken:v1:' + Utilities.base64EncodeWebSafe(digest);
  }

  function calculateIdentityCacheTtlSeconds(expSeconds) {
    var nowSeconds = Math.floor(nowMillis() / 1000);
    var parsedExp = Number(expSeconds);
    if (!isFinite(parsedExp) || parsedExp <= nowSeconds) {
      return 60;
    }
    var remaining = Math.floor(parsedExp - nowSeconds - 30);
    if (remaining < 60) {
      return 60;
    }
    if (remaining > 300) {
      return 300;
    }
    return remaining;
  }

  function buildDefaultIdentityClient(channelId) {
    return {
      verifyIdToken: function (idToken) {
        var verifyStartedAt = nowMillis();
        ns.logEvent('info', 'auth.verify.request', {
          channelConfigured: !!channelId,
          hasIdToken: !!idToken,
          idTokenLength: idToken ? String(idToken).length : 0
        });
        ns.assert(channelId, 'config_error', 'LINE_CHANNEL_ID が未設定です', 500);
        ns.assert(idToken, 'unauthorized', 'LIFF 認証コンテキストがありません', 401);

        var scriptCache = getScriptCacheSafely();
        var cacheKey = scriptCache ? buildIdentityCacheKey(idToken) : '';
        if (scriptCache && cacheKey) {
          try {
            var cachedIdentityRaw = scriptCache.get(cacheKey);
            if (cachedIdentityRaw) {
              var cachedIdentity = JSON.parse(cachedIdentityRaw);
              if (cachedIdentity && cachedIdentity.lineUserId) {
                ns.logEvent('info', 'auth.verify.success', {
                  lineUserId: summarizeId(cachedIdentity.lineUserId),
                  hasDisplayName: !!cachedIdentity.displayName,
                  cacheHit: true,
                  verifyMs: nowMillis() - verifyStartedAt
                });
                return {
                  lineUserId: cachedIdentity.lineUserId,
                  displayName: cachedIdentity.displayName || ''
                };
              }
            }
          } catch (cacheReadError) {
            ns.logEvent('warn', 'auth.verify.cache_read_failed', {
              message: cacheReadError && cacheReadError.message ? String(cacheReadError.message) : ''
            });
          }
        }

        var response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
          method: 'post',
          payload: {
            id_token: idToken,
            client_id: channelId
          }
        });
        ns.logEvent('info', 'auth.verify.response', {
          responseCode: Number(response.getResponseCode())
        });
        ns.assert(response.getResponseCode() === 200, 'unauthorized', 'LIFF 認証の検証に失敗しました', 401);
        var payload = JSON.parse(response.getContentText());
        ns.assert(payload.sub, 'internal_error', 'LINE verify 応答に sub が含まれていません', 500);
        var identity = {
          lineUserId: payload.sub,
          displayName: payload.name || ''
        };
        if (scriptCache && cacheKey) {
          try {
            scriptCache.put(
              cacheKey,
              JSON.stringify(identity),
              calculateIdentityCacheTtlSeconds(payload.exp)
            );
          } catch (cacheWriteError) {
            ns.logEvent('warn', 'auth.verify.cache_write_failed', {
              message: cacheWriteError && cacheWriteError.message ? String(cacheWriteError.message) : ''
            });
          }
        }
        ns.logEvent('info', 'auth.verify.success', {
          lineUserId: summarizeId(payload.sub),
          hasDisplayName: !!payload.name,
          cacheHit: false,
          verifyMs: nowMillis() - verifyStartedAt
        });
        return identity;
      }
    };
  }

  function buildRunItemResponse(item) {
    var checkedByName = String(item.checked_by_name || '').trim();
    var checkedByUserId = String(item.checked_by || '').trim();
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      checkedBy: checkedByName || null,
      checkedByUserId: checkedByUserId || null,
      checkedAt: item.checked_at || null,
      updatedAt: item.updated_at || null
    };
  }

  function buildChecklistResponse(repository, currentUser, run, items) {
    var checkedCount = items.filter(function (item) {
      return item.status === ns.ITEM_STATUS.CHECKED;
    }).length;

    return {
      runId: run.id,
      templateId: run.template_id,
      storeName: currentUser.store.name,
      targetDate: run.target_date,
      status: run.status,
      currentUser: ns.buildUserSummary(currentUser.user, currentUser.store),
      progress: {
        total: items.length,
        checked: checkedCount
      },
      items: items.map(function (item) {
        return buildRunItemResponse(item);
      })
    };
  }

  function buildTemplateItemResponse(item) {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      sortOrder: Number(item.sort_order),
      isRequired: ns.parseBoolean(item.is_required)
    };
  }

  function buildTemplateResponse(template, items) {
    return {
      id: template.id,
      name: template.name,
      notifyTime: template.notify_time,
      closingTime: template.closing_time,
      isActive: ns.parseBoolean(template.is_active),
      items: items.map(buildTemplateItemResponse)
    };
  }

  function ensureStoreScope(repository, user, storeId) {
    ns.assert(user.store_id === storeId, 'forbidden', '所属外のデータにはアクセスできません', 403);
  }

  function ensureManager(user) {
    ns.assert(user.role !== ns.ROLES.PART_TIME, 'forbidden', '管理者権限が必要です', 403);
  }

  ns.createChecklistService = function (options) {
    var repository = options.repository;
    var clock = options.clock || ns.defaultClock();
    var identityClient = options.identityClient || buildDefaultIdentityClient(options.lineChannelId);
    var notificationService = options.notificationService;
    var appBaseUrl = options.appBaseUrl || '';
    var allowAnonymousAccess = options.allowAnonymousAccess === true;

    function resolveIdentity(query) {
      try {
        var identity = identityClient.verifyIdToken(query.idToken);
        ns.logEvent('info', 'auth.resolve.success', {
          lineUserId: summarizeId(identity.lineUserId)
        });
        return identity;
      } catch (error) {
        ns.logEvent('error', 'auth.resolve.failed', buildErrorLog(error));
        if (error && (error.statusCode || error.code)) {
          throw error;
        }
        throw ns.createError('unauthorized', 'LIFF 認証コンテキストがありません', 401);
      }
    }

    function findCurrentStore() {
      var stores = repository.listTable('stores');
      var activeStore = stores.find(function (store) {
        return store.status === 'active';
      }) || null;
      ns.assert(activeStore || stores[0], 'config_error', '有効な store がありません', 500);
      return activeStore || stores[0];
    }

    function buildCurrentUserContext(identity) {
      var store = findCurrentStore();
      var lineUserId = String(identity && identity.lineUserId ? identity.lineUserId : 'anonymous');
      var displayName = String(identity && identity.displayName ? identity.displayName : 'LINEユーザー');
      var user = {
        id: lineUserId,
        store_id: store.id,
        name: displayName,
        role: ''
      };
      ns.logEvent('info', 'auth.current_user.resolve', {
        storeId: store.id,
        userId: summarizeId(lineUserId)
      });
      return {
        identity: {
          lineUserId: lineUserId,
          displayName: displayName
        },
        user: user,
        store: store
      };
    }

    function requireAuthenticatedUser(query) {
      var safeQuery = query || {};
      if (!safeQuery.idToken) {
        if (allowAnonymousAccess) {
          return buildCurrentUserContext({
            lineUserId: 'anonymous',
            displayName: '匿名ユーザー'
          });
        }
        throw ns.createError('unauthorized', 'LIFF 認証コンテキストがありません', 401);
      }

      var identity = resolveIdentity(safeQuery);
      return buildCurrentUserContext(identity);
    }

    function requireAuthenticatedWriteUser(query) {
      var safeQuery = query || {};
      ns.assert(safeQuery.idToken, 'unauthorized', '更新操作には LIFF 認証が必要です', 401);
      var identity = resolveIdentity(safeQuery);
      return buildCurrentUserContext(identity);
    }

    function getTodayRunForUser(user) {
      var targetDate = clock.today();
      var run = repository.findRunByStoreAndDate(user.store_id, targetDate);
      if (run) {
        return run;
      }

      if (allowAnonymousAccess) {
        var template = repository.listActiveTemplates().find(function (candidate) {
          return candidate.store_id === user.store_id;
        }) || null;
        ns.assert(template, 'not_found', '有効なチェックリストテンプレートがありません', 404);
        ns.logEvent('info', 'checklist.today.autocreate', {
          storeId: user.store_id,
          templateId: template.id,
          targetDate: targetDate
        });
        var now = ns.toIsoString(clock.now());
        var runId = Utilities.getUuid();
        var runPayload = {
          id: runId,
          template_id: template.id,
          store_id: template.store_id,
          target_date: targetDate,
          status: ns.RUN_STATUS.OPEN,
          notified_at: now,
          closed_at: '',
          created_at: now
        };
        var templateItems = repository.listTemplateItems(template.id);
        var runItems = templateItems.map(function (templateItem) {
          return {
            id: Utilities.getUuid(),
            run_id: runId,
            template_item_id: templateItem.id,
            title: templateItem.title,
            sort_order: templateItem.sort_order,
            status: ns.ITEM_STATUS.UNCHECKED,
            checked_by: '',
            checked_by_name: '',
            checked_at: '',
            updated_at: now
          };
        });
        var createdRun = repository.createChecklistRunWithItems(runPayload, runItems);
        return createdRun;
      }

      ns.assert(false, 'not_found', '当日のチェックリストがありません', 404);
    }

    function getRunWithScope(runId, user) {
      var run = repository.findRunById(runId);
      ns.assert(run, 'not_found', 'チェックリストが見つかりません', 404);
      ensureStoreScope(repository, user, run.store_id);
      return run;
    }

    function getRunItemWithScope(runItemId, user) {
      var item = repository.findRunItemById(runItemId);
      ns.assert(item, 'not_found', 'チェック項目が見つかりません', 404);
      var run = repository.findRunById(item.run_id);
      ensureStoreScope(repository, user, run.store_id);
      return {
        item: item,
        run: run
      };
    }

    function buildIncompleteMessage(store, run, items) {
      var lines = items.map(function (item) {
        return '・' + item.title;
      }).join('\n');
      return [
        '前日分のチェックリストに未完了項目があります。',
        '',
        '店舗：' + store.name,
        '対象日：' + run.target_date,
        '',
        '未完了項目：',
        lines
      ].join('\n');
    }

    function buildDailyStartMessage(store, run) {
      return [
        '本日のチェックリストが作成されました。',
        '',
        '店舗：' + store.name,
        '対象日：' + run.target_date,
        '',
        appBaseUrl + '?mode=user'
      ].join('\n');
    }

    function buildManualReminderMessage(store, run, items) {
      return [
        '未完了項目の手動リマインドです。',
        '',
        '店舗：' + store.name,
        '対象日：' + run.target_date,
        '',
        items.map(function (item) { return '・' + item.title; }).join('\n')
      ].join('\n');
    }

    function logCheckMutationBreakdown(eventName, startedAt, authMs, storageWriteMs, idempotent) {
      ns.logEvent('info', eventName, {
        authMs: authMs,
        storageWriteMs: storageWriteMs,
        totalMs: nowMillis() - startedAt,
        idempotent: idempotent === true
      });
    }

    return {
      getCurrentUser: requireAuthenticatedUser,

      linkAccount: function () {
        throw ns.createError('gone', 'LINE 連携フォームは廃止されました', 410);
      },

      getMe: function (query) {
        var currentUser = requireAuthenticatedUser(query);
        return ns.buildUserSummary(currentUser.user, currentUser.store);
      },

      getTodayChecklist: function (query) {
        var startedAt = nowMillis();
        var currentUser = requireAuthenticatedUser(query);
        var authMs = nowMillis() - startedAt;

        var runStartedAt = nowMillis();
        var run = getTodayRunForUser(currentUser.user);
        var runMs = nowMillis() - runStartedAt;

        var itemsStartedAt = nowMillis();
        var items = repository.listRunItems(run.id);
        var itemsMs = nowMillis() - itemsStartedAt;

        var buildStartedAt = nowMillis();
        var response = buildChecklistResponse(repository, currentUser, run, items);
        var buildMs = nowMillis() - buildStartedAt;
        ns.logEvent('info', 'api.today.breakdown', {
          authMs: authMs,
          runMs: runMs,
          itemsMs: itemsMs,
          buildMs: buildMs,
          totalMs: nowMillis() - startedAt,
          itemsCount: items.length
        });
        return response;
      },

      getTodayIncomplete: function (query) {
        var currentUser = requireAuthenticatedUser(query);
        var run = getTodayRunForUser(currentUser.user);
        var items = repository.listRunItems(run.id).filter(function (item) {
          return item.status === ns.ITEM_STATUS.UNCHECKED;
        });
        return {
          runId: run.id,
          targetDate: run.target_date,
          items: items.map(function (item) {
            return {
              id: item.id,
              title: item.title
            };
          })
        };
      },

      checkItem: function (query, runItemId, body) {
        var startedAt = nowMillis();
        var currentUser = requireAuthenticatedWriteUser(query);
        var authMs = nowMillis() - startedAt;
        var scopedRunItem = getRunItemWithScope(runItemId, currentUser.user);
        var item = scopedRunItem.item;

        if (item.status === ns.ITEM_STATUS.CHECKED) {
          logCheckMutationBreakdown('api.check_item.breakdown', startedAt, authMs, 0, true);
          return {
            item: buildRunItemResponse(item)
          };
        }

        var now = ns.toIsoString(clock.now());
        var changes = {
          status: ns.ITEM_STATUS.CHECKED,
          checked_by: currentUser.user.id,
          checked_by_name: currentUser.identity.displayName || currentUser.user.name,
          checked_at: now,
          updated_at: now
        };
        var writeStartedAt = nowMillis();
        var updatedItem = repository.updateRunItem(item.id, changes);
        var storageWriteMs = nowMillis() - writeStartedAt;
        logCheckMutationBreakdown('api.check_item.breakdown', startedAt, authMs, storageWriteMs, false);
        return {
          item: buildRunItemResponse(updatedItem),
          comment: body.comment || ''
        };
      },

      uncheckItem: function (query, runItemId, body) {
        var startedAt = nowMillis();
        var currentUser = requireAuthenticatedWriteUser(query);
        var authMs = nowMillis() - startedAt;
        var scopedRunItem = getRunItemWithScope(runItemId, currentUser.user);
        var item = scopedRunItem.item;

        if (item.status === ns.ITEM_STATUS.UNCHECKED) {
          logCheckMutationBreakdown('api.uncheck_item.breakdown', startedAt, authMs, 0, true);
          return {
            item: buildRunItemResponse(item)
          };
        }

        var now = ns.toIsoString(clock.now());
        var changes = {
          status: ns.ITEM_STATUS.UNCHECKED,
          checked_by: '',
          checked_by_name: '',
          checked_at: '',
          updated_at: now
        };
        var writeStartedAt = nowMillis();
        var updatedItem = repository.updateRunItem(item.id, changes);
        var storageWriteMs = nowMillis() - writeStartedAt;
        logCheckMutationBreakdown('api.uncheck_item.breakdown', startedAt, authMs, storageWriteMs, false);
        return {
          item: buildRunItemResponse(updatedItem),
          reason: body.reason || ''
        };
      },

      createTemplate: function (query, body) {
        var currentUser = requireAuthenticatedWriteUser(query);
        ensureManager(currentUser.user);
        var name = ns.requireString(body.name, 'name');
        var now = ns.toIsoString(clock.now());
        var template = repository.createTemplate({
          id: Utilities.getUuid(),
          store_id: currentUser.user.store_id,
          name: name,
          notify_time: '10:30',
          closing_time: '00:00',
          is_active: 'true',
          created_by: currentUser.user.id,
          created_at: now,
          updated_at: now
        });
        return { template: template };
      },

      listTemplates: function (query) {
        var currentUser = requireAuthenticatedUser(query);
        ensureManager(currentUser.user);
        return {
          templates: repository.listActiveTemplatesWithItems(currentUser.user.store_id).map(function (entry) {
            return buildTemplateResponse(entry.template, entry.items);
          })
        };
      },

      updateTemplate: function (query, templateId, body) {
        var currentUser = requireAuthenticatedWriteUser(query);
        ensureManager(currentUser.user);
        var template = repository.findTemplateById(templateId);
        ns.assert(template, 'not_found', 'テンプレートが見つかりません', 404);
        ensureStoreScope(repository, currentUser.user, template.store_id);
        var updatedTemplate = repository.updateTemplate(templateId, {
          name: ns.requireString(body.name, 'name'),
          updated_at: ns.toIsoString(clock.now())
        });
        return { template: updatedTemplate };
      },

      createTemplateItem: function (query, templateId, body) {
        var currentUser = requireAuthenticatedWriteUser(query);
        ensureManager(currentUser.user);
        var template = repository.findTemplateById(templateId);
        ns.assert(template, 'not_found', 'テンプレートが見つかりません', 404);
        ensureStoreScope(repository, currentUser.user, template.store_id);

        var now = ns.toIsoString(clock.now());
        var item = repository.createTemplateItem({
          id: Utilities.getUuid(),
          template_id: templateId,
          title: ns.requireString(body.title, 'title'),
          description: body.description || '',
          sort_order: String(body.sortOrder),
          is_required: ns.boolToString(body.isRequired),
          is_active: 'true',
          created_at: now,
          updated_at: now
        });
        return { item: item };
      },

      updateTemplateItem: function (query, templateId, itemId, body) {
        var currentUser = requireAuthenticatedWriteUser(query);
        ensureManager(currentUser.user);
        var template = repository.findTemplateById(templateId);
        ns.assert(template, 'not_found', 'テンプレートが見つかりません', 404);
        ensureStoreScope(repository, currentUser.user, template.store_id);

        var updatedItem = repository.updateTemplateItem(itemId, {
          title: ns.requireString(body.title, 'title'),
          description: body.description || '',
          sort_order: String(body.sortOrder),
          is_required: ns.boolToString(body.isRequired),
          updated_at: ns.toIsoString(clock.now())
        });
        return { item: updatedItem };
      },

      deleteTemplateItem: function (query, templateId, itemId) {
        var currentUser = requireAuthenticatedWriteUser(query);
        ensureManager(currentUser.user);
        var template = repository.findTemplateById(templateId);
        ns.assert(template, 'not_found', 'テンプレートが見つかりません', 404);
        ensureStoreScope(repository, currentUser.user, template.store_id);

        var deletedItem = repository.deleteTemplateItem(itemId);
        return { item: deletedItem };
      },

      notifyIncompleteManually: function (query, runId) {
        var currentUser = requireAuthenticatedWriteUser(query);
        ensureManager(currentUser.user);
        var run = getRunWithScope(runId, currentUser.user);
        var store = repository.findStoreById(run.store_id);
        var items = repository.listRunItems(run.id).filter(function (item) {
          return item.status === ns.ITEM_STATUS.UNCHECKED;
        });
        var linkedUsers = repository.listLinkedUsersByStore(run.store_id);
        var notifications = notificationService.sendToUsers(
          run,
          linkedUsers,
          ns.NOTIFICATION_TYPES.MANUAL_REMINDER,
          buildManualReminderMessage(store, run, items)
        );
        return { notifications: notifications };
      },

      runDailyStart: function () {
        var createdRuns = [];
        repository.listActiveTemplates().forEach(function (template) {
          var existingRun = repository.findRunByStoreAndDate(template.store_id, clock.today());
          if (existingRun) {
            return;
          }

          var now = ns.toIsoString(clock.now());
          var runId = Utilities.getUuid();
          var runPayload = {
            id: runId,
            template_id: template.id,
            store_id: template.store_id,
            target_date: clock.today(),
            status: ns.RUN_STATUS.OPEN,
            notified_at: now,
            closed_at: '',
            created_at: now
          };
          var templateItems = repository.listTemplateItems(template.id);
          var run = repository.createChecklistRunWithItems(runPayload, templateItems.map(function (templateItem) {
            return {
              id: Utilities.getUuid(),
              run_id: runId,
              template_item_id: templateItem.id,
              title: templateItem.title,
              sort_order: templateItem.sort_order,
              status: ns.ITEM_STATUS.UNCHECKED,
              checked_by: '',
              checked_by_name: '',
              checked_at: '',
              updated_at: now
            };
          }));

          notificationService.sendToUsers(
            run,
            repository.listLinkedUsersByStore(template.store_id, [ns.ROLES.PART_TIME]),
            ns.NOTIFICATION_TYPES.DAILY_START,
            buildDailyStartMessage(repository.findStoreById(template.store_id), run)
          );
          createdRuns.push(run);
        });
        return { createdRuns: createdRuns };
      },

      runDailyClosing: function () {
        var notifications = [];
        var closedRuns = repository.listRunsByDate(clock.yesterday()).map(function (run) {
          if (run.status === ns.RUN_STATUS.CLOSED) {
            return run;
          }
          var store = repository.findStoreById(run.store_id);
          var items = repository.listRunItems(run.id).filter(function (item) {
            return item.status === ns.ITEM_STATUS.UNCHECKED;
          });
          if (items.length > 0) {
            notifications = notifications.concat(notificationService.sendToUsers(
              run,
              repository.listLinkedUsersByStore(run.store_id),
              ns.NOTIFICATION_TYPES.INCOMPLETE,
              buildIncompleteMessage(store, run, items)
            ));
          }
          return repository.updateRun(run.id, {
            status: ns.RUN_STATUS.CLOSED,
            closed_at: ns.toIsoString(clock.now())
          });
        });
        return {
          closedRuns: closedRuns,
          notifications: notifications
        };
      },

      listNotificationTypes: listNotificationTypes
    };
  };
})(Ogawaya);
