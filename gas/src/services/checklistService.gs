(function (ns) {
  function listNotificationTypes() {
    return Object.keys(ns.NOTIFICATION_TYPES).map(function (key) {
      return ns.NOTIFICATION_TYPES[key];
    });
  }

  function buildDefaultIdentityClient(channelId) {
    return {
      verifyIdToken: function (idToken) {
        ns.assert(channelId, 'config_error', 'LINE_CHANNEL_ID が未設定です', 500);
        ns.assert(idToken, 'unauthorized', 'LIFF 認証コンテキストがありません', 401);
        var response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
          method: 'post',
          payload: {
            id_token: idToken,
            client_id: channelId
          }
        });
        ns.assert(response.getResponseCode() === 200, 'unauthorized', 'LIFF 認証の検証に失敗しました', 401);
        var payload = JSON.parse(response.getContentText());
        ns.assert(payload.sub, 'internal_error', 'LINE verify 応答に sub が含まれていません', 500);
        return {
          lineUserId: payload.sub,
          displayName: payload.name || ''
        };
      }
    };
  }

  function buildRunItemResponse(repository, item) {
    var checkedUser = item.checked_by ? repository.findRowById('users', item.checked_by) : null;
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      checkedBy: checkedUser ? checkedUser.name : null,
      checkedAt: item.checked_at || null
    };
  }

  function buildChecklistResponse(repository, store, run, items) {
    var checkedCount = items.filter(function (item) {
      return item.status === ns.ITEM_STATUS.CHECKED;
    }).length;

    return {
      storeName: store.name,
      targetDate: run.target_date,
      status: run.status,
      progress: {
        total: items.length,
        checked: checkedCount
      },
      items: items.map(function (item) {
        return buildRunItemResponse(repository, item);
      })
    };
  }

  function buildLogRow(repository, clock, action, userId, run, runItemId, beforeValue, afterValue) {
    var now = ns.toIsoString(clock.now());
    return repository.appendLog({
      id: Utilities.getUuid(),
      run_item_id: runItemId,
      action: action,
      user_id: userId,
      before_value: ns.jsonStringify(beforeValue),
      after_value: ns.jsonStringify(afterValue),
      is_after_close: run.closed_at && now > run.closed_at ? 'true' : 'false',
      created_at: now
    });
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

    function resolveIdentity(query) {
      try {
        return identityClient.verifyIdToken(query.idToken);
      } catch (error) {
        if (error && (error.statusCode || error.code)) {
          throw error;
        }
        throw ns.createError('unauthorized', 'LIFF 認証コンテキストがありません', 401);
      }
    }

    function requireAuthenticatedUser(query) {
      var identity = resolveIdentity(query);
      var user = repository.findLinkedUserByLineUserId(identity.lineUserId);
      ns.assert(user, 'unauthorized', 'LINE 連携済みユーザーではありません', 401);
      return {
        identity: identity,
        user: user,
        store: repository.findStoreById(user.store_id)
      };
    }

    function getTodayRunForUser(user) {
      var run = repository.findRunByStoreAndDate(user.store_id, clock.today());
      ns.assert(run, 'not_found', '当日のチェックリストがありません', 404);
      return run;
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

    function mapLog(log) {
      return {
        id: log.id,
        runItemId: log.run_item_id,
        action: log.action,
        userId: log.user_id,
        beforeValue: ns.safeJsonParse(log.before_value),
        afterValue: ns.safeJsonParse(log.after_value),
        isAfterClose: ns.parseBoolean(log.is_after_close),
        createdAt: log.created_at
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

    return {
      getCurrentUser: requireAuthenticatedUser,

      linkAccount: function (query, body) {
        var keys = Object.keys(body || {});
        ns.assert(keys.length === 2 && keys.indexOf('employeeCode') !== -1 && keys.indexOf('passcode') !== -1, 'invalid_request', 'employeeCode と passcode のみ指定できます', 400);

        var identity = resolveIdentity(query);
        var user = repository.findUserByEmployeeCodeAndPasscode(body.employeeCode, body.passcode);
        ns.assert(user, 'unauthorized', '社員コードまたはパスコードが不正です', 401);

        repository.createLineAccountLink({
          id: Utilities.getUuid(),
          user_id: user.id,
          line_user_id: identity.lineUserId,
          display_name: identity.displayName || '',
          linked_at: ns.toIsoString(clock.now())
        });

        return {
          user: ns.buildUserSummary(user, repository.findStoreById(user.store_id))
        };
      },

      getMe: function (query) {
        var currentUser = requireAuthenticatedUser(query);
        return ns.buildUserSummary(currentUser.user, currentUser.store);
      },

      getTodayChecklist: function (query) {
        var currentUser = requireAuthenticatedUser(query);
        var run = getTodayRunForUser(currentUser.user);
        var items = repository.listRunItems(run.id);
        return buildChecklistResponse(repository, currentUser.store, run, items);
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
        var currentUser = requireAuthenticatedUser(query);
        var scopedRunItem = getRunItemWithScope(runItemId, currentUser.user);
        var item = scopedRunItem.item;
        var run = scopedRunItem.run;
        var beforeValue = ns.clone(item);

        if (item.status === ns.ITEM_STATUS.CHECKED) {
          return {
            item: buildRunItemResponse(repository, item),
            logCreated: false
          };
        }

        var now = ns.toIsoString(clock.now());
        var updatedItem = repository.updateRunItem(item.id, {
          status: ns.ITEM_STATUS.CHECKED,
          checked_by: currentUser.user.id,
          checked_at: now,
          updated_at: now
        });

        buildLogRow(repository, clock, 'check', currentUser.user.id, run, item.id, beforeValue, updatedItem);
        return {
          item: buildRunItemResponse(repository, updatedItem),
          logCreated: true,
          comment: body.comment || ''
        };
      },

      uncheckItem: function (query, runItemId, body) {
        var currentUser = requireAuthenticatedUser(query);
        var scopedRunItem = getRunItemWithScope(runItemId, currentUser.user);
        var item = scopedRunItem.item;
        var run = scopedRunItem.run;
        var beforeValue = ns.clone(item);

        if (item.status === ns.ITEM_STATUS.UNCHECKED) {
          return {
            item: buildRunItemResponse(repository, item),
            logCreated: false
          };
        }

        if (currentUser.user.role === ns.ROLES.PART_TIME) {
          ns.assert(item.checked_by === currentUser.user.id, 'forbidden', '他人のチェックは取り消せません', 403);
        }

        var now = ns.toIsoString(clock.now());
        var updatedItem = repository.updateRunItem(item.id, {
          status: ns.ITEM_STATUS.UNCHECKED,
          checked_by: '',
          checked_at: '',
          updated_at: now
        });

        buildLogRow(repository, clock, 'uncheck', currentUser.user.id, run, item.id, beforeValue, updatedItem);
        return {
          item: buildRunItemResponse(repository, updatedItem),
          logCreated: true,
          reason: body.reason || ''
        };
      },

      getLogs: function (query, runId, action) {
        var currentUser = requireAuthenticatedUser(query);
        getRunWithScope(runId, currentUser.user);
        var logs = repository.listLogsByRunId(runId).filter(function (log) {
          return !action || log.action === action;
        }).sort(function (left, right) {
          return right.created_at.localeCompare(left.created_at);
        });
        return {
          logs: logs.map(mapLog)
        };
      },

      createTemplate: function (query, body) {
        var currentUser = requireAuthenticatedUser(query);
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

      updateTemplate: function (query, templateId, body) {
        var currentUser = requireAuthenticatedUser(query);
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
        var currentUser = requireAuthenticatedUser(query);
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
        var currentUser = requireAuthenticatedUser(query);
        ensureManager(currentUser.user);
        var template = repository.findTemplateById(templateId);
        ns.assert(template, 'not_found', 'テンプレートが見つかりません', 404);
        ensureStoreScope(repository, currentUser.user, template.store_id);

        var beforeValue = repository.findRowById('checklist_template_items', itemId);
        ns.assert(beforeValue, 'not_found', 'テンプレート項目が見つかりません', 404);
        var updatedItem = repository.updateTemplateItem(itemId, {
          title: ns.requireString(body.title, 'title'),
          description: body.description || '',
          sort_order: String(body.sortOrder),
          is_required: ns.boolToString(body.isRequired),
          updated_at: ns.toIsoString(clock.now())
        });
        buildLogRow(repository, clock, 'edit', currentUser.user.id, {
          closed_at: ''
        }, itemId, beforeValue, updatedItem);
        return { item: updatedItem };
      },

      deleteTemplateItem: function (query, templateId, itemId) {
        var currentUser = requireAuthenticatedUser(query);
        ensureManager(currentUser.user);
        var template = repository.findTemplateById(templateId);
        ns.assert(template, 'not_found', 'テンプレートが見つかりません', 404);
        ensureStoreScope(repository, currentUser.user, template.store_id);

        var beforeValue = repository.findRowById('checklist_template_items', itemId);
        ns.assert(beforeValue, 'not_found', 'テンプレート項目が見つかりません', 404);
        var deletedItem = repository.deleteTemplateItem(itemId);
        buildLogRow(repository, clock, 'delete', currentUser.user.id, {
          closed_at: ''
        }, itemId, beforeValue, deletedItem);
        return { item: deletedItem };
      },

      notifyIncompleteManually: function (query, runId) {
        var currentUser = requireAuthenticatedUser(query);
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
          var run = repository.createChecklistRun({
            id: Utilities.getUuid(),
            template_id: template.id,
            store_id: template.store_id,
            target_date: clock.today(),
            status: ns.RUN_STATUS.OPEN,
            notified_at: now,
            closed_at: '',
            created_at: now
          });
          var templateItems = repository.listTemplateItems(template.id);
          repository.createRunItems(templateItems.map(function (templateItem) {
            return {
              id: Utilities.getUuid(),
              run_id: run.id,
              template_item_id: templateItem.id,
              title: templateItem.title,
              sort_order: templateItem.sort_order,
              status: ns.ITEM_STATUS.UNCHECKED,
              checked_by: '',
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
