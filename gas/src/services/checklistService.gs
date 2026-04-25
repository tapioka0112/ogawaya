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

  function isBusinessDayCutoverPassed(date) {
    var isoString = Utilities.formatDate(date, ns.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'");
    var timeMatch = isoString.match(/T(\d{2}):(\d{2}):\d{2}Z$/);
    ns.assert(timeMatch, 'internal_error', '時刻フォーマットの解析に失敗しました', 500);
    var hour = Number(timeMatch[1]);
    var minute = Number(timeMatch[2]);
    return hour > 10 || (hour === 10 && minute >= 30);
  }

  function resolveBusinessDate(now) {
    var normalizedNow = now || new Date();
    var baseDate = normalizedNow;
    if (!isBusinessDayCutoverPassed(normalizedNow)) {
      baseDate = new Date(normalizedNow.getTime() - (24 * 60 * 60 * 1000));
    }
    return Utilities.formatDate(baseDate, ns.TIMEZONE, 'yyyy-MM-dd');
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

  function extractLiffChannelId(liffId) {
    var match = String(liffId || '').replace(/\s+/g, '').match(/([0-9]{10})-[A-Za-z0-9]+/);
    return match && match[1] ? match[1] : '';
  }

  function normalizeVerifyChannelIds(loginChannelId, configuredLiffId, channelId, requestLiffId) {
    var ids = [];
    var configuredLiffChannelId = extractLiffChannelId(configuredLiffId);
    var requestLiffChannelId = configuredLiffChannelId ? '' : extractLiffChannelId(requestLiffId);
    [loginChannelId, configuredLiffChannelId, requestLiffChannelId, channelId].forEach(function (candidate) {
      var normalized = String(candidate || '').trim();
      if (normalized && ids.indexOf(normalized) === -1) {
        ids.push(normalized);
      }
    });
    return ids;
  }

  function encodeFormPayload(fields) {
    return Object.keys(fields).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(String(fields[key]));
    }).join('&');
  }

  function sanitizeDiagnosticText(value) {
    return String(value || '').replace(/\s+/g, ' ').replace(/[,\r\n]/g, ' ').slice(0, 160);
  }

  function parseLineVerifyError(responseText) {
    if (!responseText) {
      return {
        error: '',
        description: ''
      };
    }
    try {
      var errorPayload = JSON.parse(responseText);
      return {
        error: errorPayload && errorPayload.error ? sanitizeDiagnosticText(errorPayload.error) : '',
        description: errorPayload && errorPayload.error_description
          ? sanitizeDiagnosticText(errorPayload.error_description)
          : ''
      };
    } catch (parseError) {
      return {
        error: 'unparseable',
        description: ''
      };
    }
  }

  function buildVerifyFailureDetails(attempts, idToken) {
    var tokenText = String(idToken || '');
    var descriptions = attempts.map(function (attempt) {
      if (!attempt.lineErrorDescription) {
        return '';
      }
      return attempt.channelIdSuffix + ':' + attempt.lineErrorDescription;
    }).filter(function (value) {
      return value !== '';
    });
    return {
      verifyAttempts: attempts.map(function (attempt) {
        return [
          attempt.channelIdSuffix,
          attempt.responseCode,
          attempt.lineError
        ].filter(function (value) {
          return value !== '';
        }).join(':');
      }).join(','),
      verifyDescriptions: descriptions.join('|'),
      tokenLength: tokenText.length,
      tokenParts: tokenText ? tokenText.split('.').length : 0
    };
  }

  function buildDefaultIdentityClient(loginChannelId, liffId, channelId) {
    return {
      verifyIdToken: function (idToken, requestLiffId) {
        var verifyChannelIds = normalizeVerifyChannelIds(loginChannelId, liffId, channelId, requestLiffId);
        var attempts = [];
        var verifyStartedAt = nowMillis();
        ns.logEvent('info', 'auth.verify.request', {
          channelConfigured: verifyChannelIds.length > 0,
          hasIdToken: !!idToken,
          idTokenLength: idToken ? String(idToken).length : 0
        });
        ns.assert(verifyChannelIds.length > 0, 'config_error', 'LIFF 認証用 channel ID が未設定です', 500);
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

        for (var channelIndex = 0; channelIndex < verifyChannelIds.length; channelIndex += 1) {
          var verifyChannelId = verifyChannelIds[channelIndex];
          var response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
            method: 'post',
            contentType: 'application/x-www-form-urlencoded',
            muteHttpExceptions: true,
            payload: encodeFormPayload({
              id_token: idToken,
              client_id: verifyChannelId
            })
          });
          var responseCode = Number(response.getResponseCode());
          var responseText = response.getContentText();
          var lineError = '';
          var lineErrorDescription = '';
          if (responseCode !== 200 && responseText) {
            var verifyError = parseLineVerifyError(responseText);
            lineError = verifyError.error;
            lineErrorDescription = verifyError.description;
          }
          attempts.push({
            responseCode: responseCode,
            channelIdSuffix: String(verifyChannelId).slice(-4),
            lineError: lineError,
            lineErrorDescription: lineErrorDescription
          });
          ns.logEvent('info', 'auth.verify.response', {
            responseCode: responseCode,
            channelIdSuffix: String(verifyChannelId).slice(-4),
            lineError: lineError,
            lineErrorDescription: lineErrorDescription
          });
          if (responseCode !== 200) {
            continue;
          }
          var payload = JSON.parse(responseText);
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

        var error = ns.createError('unauthorized', 'LIFF 認証の検証に失敗しました', 401);
        error.details = buildVerifyFailureDetails(attempts, idToken);
        throw error;
      }
    };
  }

  function buildTemplateItemDescriptionMap(repository, items) {
    var neededIds = {};
    (items || []).forEach(function (item) {
      var templateItemId = String(item.template_item_id || '').trim();
      if (templateItemId) {
        neededIds[templateItemId] = true;
      }
    });
    if (Object.keys(neededIds).length === 0) {
      return {};
    }

    var descriptions = {};
    repository.listTable('checklist_template_items').forEach(function (templateItem) {
      if (neededIds[templateItem.id]) {
        descriptions[templateItem.id] = String(templateItem.description || '');
      }
    });
    return descriptions;
  }

  function buildRunItemResponse(item, descriptionByTemplateItemId) {
    var checkedByName = String(item.checked_by_name || '').trim();
    var checkedByUserId = String(item.checked_by || '').trim();
    var templateItemId = String(item.template_item_id || '').trim();
    return {
      id: item.id,
      templateItemId: templateItemId,
      title: item.title,
      description: descriptionByTemplateItemId && templateItemId
        ? String(descriptionByTemplateItemId[templateItemId] || '')
        : '',
      status: item.status,
      checkedBy: checkedByName || null,
      checkedByUserId: checkedByUserId || null,
      checkedAt: item.checked_at || null,
      updatedAt: item.updated_at || null
    };
  }

  function buildSingleRunItemResponse(repository, item) {
    return buildRunItemResponse(item, buildTemplateItemDescriptionMap(repository, [item]));
  }

  function buildChecklistResponse(repository, currentUser, run, items) {
    var checkedCount = items.filter(function (item) {
      return item.status === ns.ITEM_STATUS.CHECKED;
    }).length;
    var descriptionByTemplateItemId = buildTemplateItemDescriptionMap(repository, items);

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
        return buildRunItemResponse(item, descriptionByTemplateItemId);
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
    var identityClient = options.identityClient || buildDefaultIdentityClient(
      options.lineLoginChannelId,
      options.liffId,
      options.lineChannelId
    );
    var notificationService = options.notificationService;
    var appBaseUrl = options.appBaseUrl || '';
    var checklistAppUrl = options.checklistAppUrl || appBaseUrl;
    var allowAnonymousAccess = options.allowAnonymousAccess === true;
    function normalizeAdminCredential(value) {
      var normalized = String(value || '').trim();
      if (normalized.length >= 2) {
        var first = normalized.charAt(0);
        var last = normalized.charAt(normalized.length - 1);
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
          normalized = normalized.slice(1, -1).trim();
        }
      }
      return normalized;
    }

    var adminLoginId = normalizeAdminCredential(options.adminLoginId);
    var adminLoginPassword = normalizeAdminCredential(options.adminLoginPassword);
    var adminSessionTtlSeconds = Number(options.adminSessionTtlSeconds || 12 * 60 * 60);
    var adminSessionMemory = {};
    var ADMIN_SESSION_KEY_PREFIX = 'ogawaya:admin:session:v1:';
    var TASK_CATALOG_TEMPLATE_PREFIX = 'task-catalog-';

    if (!isFinite(adminSessionTtlSeconds) || adminSessionTtlSeconds < 300) {
      adminSessionTtlSeconds = 12 * 60 * 60;
    }

    function resolveIdentity(query) {
      try {
        var identity = identityClient.verifyIdToken(query.idToken, query.liffId);
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

    function registerNotificationRecipient(currentUser) {
      if (currentUser.user.id === 'anonymous') {
        return null;
      }
      var now = ns.toIsoString(clock.now());
      return repository.upsertNotificationRecipient({
        id: Utilities.getUuid(),
        store_id: currentUser.store.id,
        line_user_id: currentUser.user.id,
        display_name: currentUser.user.name,
        channel_id: '',
        status: 'active',
        last_seen_at: now,
        created_at: now,
        updated_at: now
      });
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
      var currentUser = buildCurrentUserContext(identity);
      registerNotificationRecipient(currentUser);
      return currentUser;
    }

    function requireAuthenticatedWriteUser(query) {
      var safeQuery = query || {};
      ns.assert(safeQuery.idToken, 'unauthorized', '更新操作には LIFF 認証が必要です', 401);
      var identity = resolveIdentity(safeQuery);
      var currentUser = buildCurrentUserContext(identity);
      registerNotificationRecipient(currentUser);
      return currentUser;
    }

    function getTodayRunForUser(user) {
      var targetDate = resolveBusinessDate(clock.now());
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

    function buildDailyIncompleteReminderMessage(store, run, items) {
      var lines = [
        '今日の残りタスクです。',
        '',
        '店舗：' + store.name,
        '対象日：' + run.target_date,
        '',
        '未完了項目：'
      ].concat(items.map(function (item) {
        return '・' + item.title;
      }));
      if (checklistAppUrl) {
        lines.push('', 'チェックはこちら', checklistAppUrl);
      }
      return lines.join('\n');
    }

    function buildDailyIncompleteReminderDedupeKey(run, recipient) {
      return [
        ns.NOTIFICATION_TYPES.DAILY_INCOMPLETE_REMINDER,
        run.store_id,
        run.target_date,
        recipient.line_user_id
      ].join(':');
    }

    function hasSentDailyIncompleteReminder(storeId, targetDate) {
      var prefix = [
        ns.NOTIFICATION_TYPES.DAILY_INCOMPLETE_REMINDER,
        storeId,
        targetDate,
        ''
      ].join(':');
      return repository.listTable('notifications').some(function (notification) {
        return notification.status === 'sent'
          && notification.type === ns.NOTIFICATION_TYPES.DAILY_INCOMPLETE_REMINDER
          && String(notification.dedupe_key || '').indexOf(prefix) === 0;
      });
    }

    function getJstMinutesOfDay(date) {
      var isoString = Utilities.formatDate(date, ns.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'");
      var timeMatch = isoString.match(/T(\d{2}):(\d{2}):\d{2}Z$/);
      ns.assert(timeMatch, 'internal_error', '時刻フォーマットの解析に失敗しました', 500);
      return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
    }

    function isReminderWatchdogWindow(date) {
      var minutes = getJstMinutesOfDay(date);
      return minutes >= 30 && minutes <= 90;
    }

    function getCurrentStoreReminderContext() {
      var store = findCurrentStore();
      var targetDate = resolveBusinessDate(clock.now());
      var run = repository.findRunByStoreAndDate(store.id, targetDate);
      return {
        store: store,
        targetDate: targetDate,
        run: run
      };
    }

    function ensureNotificationChannelsCapacity(channels, recipients) {
      var totalCapacity = channels.reduce(function (sum, channel) {
        return sum + Number(channel.recipient_limit);
      }, 0);
      ns.assert(
        recipients.length <= totalCapacity,
        'invalid_state',
        '通知チャネル容量が不足しています。公式アカウントを追加してください',
        409
      );
    }

    function logCheckMutationBreakdown(eventName, startedAt, authMs, storageWriteMs, idempotent) {
      ns.logEvent('info', eventName, {
        authMs: authMs,
        storageWriteMs: storageWriteMs,
        totalMs: nowMillis() - startedAt,
        idempotent: idempotent === true
      });
    }

    function parseRequiredInteger(value, fieldName) {
      var normalized = String(value || '').trim();
      ns.assert(normalized !== '', 'invalid_request', fieldName + ' は必須です', 400);
      ns.assert(/^-?\d+$/.test(normalized), 'invalid_request', fieldName + ' は整数で指定してください', 400);
      return Number(normalized);
    }

    function parseMonthlyStatsPeriod(query) {
      var safeQuery = query || {};
      var year = parseRequiredInteger(safeQuery.year, 'year');
      var month = parseRequiredInteger(safeQuery.month, 'month');
      ns.assert(month >= 1 && month <= 12, 'invalid_request', 'month は 1〜12 で指定してください', 400);
      return {
        year: year,
        month: month
      };
    }

    function parseDailyStatsDate(query) {
      var safeQuery = query || {};
      var date = String(safeQuery.date || '').trim();
      ns.assert(date !== '', 'invalid_request', 'date は必須です', 400);
      ns.assert(ns.isDateString(date), 'invalid_request', 'date は YYYY-MM-DD 形式で指定してください', 400);
      return date;
    }

    function buildMonthlyStats(query) {
      var period = parseMonthlyStatsPeriod(query);
      var currentUser = requireAuthenticatedUser(query);
      var runs = repository.listRunsByStoreAndMonth(currentUser.user.store_id, period.year, period.month);

      var runDateById = {};
      var dayStatsByDate = {};
      runs.forEach(function (run) {
        runDateById[run.id] = run.target_date;
        if (!dayStatsByDate[run.target_date]) {
          dayStatsByDate[run.target_date] = {
            date: run.target_date,
            total: 0,
            checked: 0
          };
        }
      });

      var runIds = runs.map(function (run) {
        return run.id;
      });
      var items = repository.listRunItemsByRunIds(runIds);
      var myCheckedItems = 0;
      items.forEach(function (item) {
        var targetDate = runDateById[item.run_id];
        ns.assert(targetDate, 'internal_error', 'run item に対応する run が見つかりません', 500);
        dayStatsByDate[targetDate].total += 1;
        if (item.status === ns.ITEM_STATUS.CHECKED) {
          dayStatsByDate[targetDate].checked += 1;
          if (item.checked_by === currentUser.user.id) {
            myCheckedItems += 1;
          }
        }
      });

      var calendar = Object.keys(dayStatsByDate).sort().map(function (date) {
        var dayStats = dayStatsByDate[date];
        return {
          date: dayStats.date,
          achieved: dayStats.total > 0 && dayStats.checked === dayStats.total,
          total: dayStats.total,
          checked: dayStats.checked
        };
      });

      var totalItems = items.length;
      var achievedDays = calendar.filter(function (entry) {
        return entry.achieved;
      }).length;
      return {
        year: period.year,
        month: period.month,
        totalDays: calendar.length,
        achievedDays: achievedDays,
        totalItems: totalItems,
        myCheckedItems: myCheckedItems,
        calendar: calendar
      };
    }

    function buildDailyStats(query) {
      var targetDate = parseDailyStatsDate(query);
      var currentUser = requireAuthenticatedUser(query);
      var runs = repository.listRunsByDate(targetDate).filter(function (run) {
        return run.store_id === currentUser.user.store_id;
      });
      var runIds = runs.map(function (run) {
        return run.id;
      });
      var runIdSet = {};
      runIds.forEach(function (runId) {
        runIdSet[runId] = true;
      });
      var runItems = ns.sortBySortOrder(repository.listRunItemsByRunIds(runIds)).filter(function (item) {
        return !!runIdSet[item.run_id];
      });
      var checkedItems = runItems.filter(function (item) {
        return item.status === ns.ITEM_STATUS.CHECKED;
      }).length;
      var descriptionByTemplateItemId = buildTemplateItemDescriptionMap(repository, runItems);
      return {
        date: targetDate,
        runCount: runs.length,
        total: runItems.length,
        checked: checkedItems,
        achieved: runItems.length > 0 && checkedItems === runItems.length,
        items: runItems.map(function (item) {
          return buildRunItemResponse(item, descriptionByTemplateItemId);
        })
      };
    }

    function assertAdminCredentialConfigured() {
      ns.assert(adminLoginId && adminLoginPassword, 'config_error', 'ADMIN_LOGIN_ID / ADMIN_LOGIN_PASSWORD が未設定です', 500);
    }

    function getAdminSessionCache() {
      if (typeof CacheService === 'undefined' || !CacheService || typeof CacheService.getScriptCache !== 'function') {
        return null;
      }
      try {
        return CacheService.getScriptCache();
      } catch (error) {
        return null;
      }
    }

    function buildAdminSessionCacheKey(token) {
      return ADMIN_SESSION_KEY_PREFIX + String(token || '');
    }

    function createAdminSessionToken() {
      var raw = Utilities.getUuid() + ':' + String(nowMillis());
      var digest = Utilities.computeHmacSha256Signature(raw, ADMIN_SESSION_KEY_PREFIX);
      return Utilities.base64EncodeWebSafe(digest);
    }

    function persistAdminSession(token, session) {
      var cache = getAdminSessionCache();
      if (cache) {
        cache.put(buildAdminSessionCacheKey(token), JSON.stringify(session), adminSessionTtlSeconds);
      }
      adminSessionMemory[token] = ns.clone(session);
    }

    function readAdminSession(token) {
      var normalizedToken = String(token || '');
      if (!normalizedToken) {
        return null;
      }

      var inMemory = adminSessionMemory[normalizedToken];
      if (inMemory && Number(inMemory.expiresAtMs || 0) > nowMillis()) {
        return ns.clone(inMemory);
      }
      if (inMemory) {
        delete adminSessionMemory[normalizedToken];
      }

      var cache = getAdminSessionCache();
      if (!cache) {
        return null;
      }
      var raw = cache.get(buildAdminSessionCacheKey(normalizedToken));
      if (!raw) {
        return null;
      }
      var session = JSON.parse(raw);
      if (!session || Number(session.expiresAtMs || 0) <= nowMillis()) {
        return null;
      }
      adminSessionMemory[normalizedToken] = ns.clone(session);
      return session;
    }

    function resolveAdminToken(query, body) {
      var safeQuery = query || {};
      var safeBody = body || {};
      return String(safeQuery.adminToken || safeBody.adminToken || '').trim();
    }

    function requireAdminSession(query, body) {
      assertAdminCredentialConfigured();
      var token = resolveAdminToken(query, body);
      ns.assert(token, 'unauthorized', '管理者ログインが必要です', 401);
      var session = readAdminSession(token);
      ns.assert(session && session.storeId, 'unauthorized', '管理者セッションが無効です', 401);
      return session;
    }

    function parseAdminTargetDate(targetDate) {
      var normalizedDate = String(targetDate || '').trim();
      ns.assert(ns.isDateString(normalizedDate), 'invalid_request', 'targetDate は YYYY-MM-DD 形式で指定してください', 400);
      return normalizedDate;
    }

    function buildTaskCatalogTemplateId(storeId) {
      return TASK_CATALOG_TEMPLATE_PREFIX + String(storeId || '');
    }

    function ensureTaskCatalogTemplate(storeId) {
      var catalogTemplateId = buildTaskCatalogTemplateId(storeId);
      var existingTemplate = repository.findTemplateById(catalogTemplateId);
      if (existingTemplate) {
        return existingTemplate;
      }
      var now = ns.toIsoString(clock.now());
      return repository.createTemplate({
        id: catalogTemplateId,
        store_id: storeId,
        name: 'タスクカタログ',
        notify_time: '10:30',
        closing_time: '00:00',
        is_active: 'false',
        created_by: 'admin',
        created_at: now,
        updated_at: now
      });
    }

    function listCatalogTasksByStore(storeId) {
      var catalogTemplate = ensureTaskCatalogTemplate(storeId);
      return repository.listTemplateItems(catalogTemplate.id);
    }

    function buildAdminTaskResponse(item) {
      return {
        id: item.id,
        title: item.title,
        description: item.description,
        sortOrder: Number(item.sort_order)
      };
    }

    function buildClientRunItemIdByTemplateItemId(body) {
      var result = {};
      var seenRunItemIds = {};
      var rawItems = body && Array.isArray(body.clientItems) ? body.clientItems : [];
      rawItems.forEach(function (entry) {
        var templateItemId = String(entry && entry.templateItemId ? entry.templateItemId : '').trim();
        var runItemId = String(entry && entry.id ? entry.id : '').trim();
        if (!templateItemId && !runItemId) {
          return;
        }
        ns.assert(templateItemId, 'invalid_request', 'clientItems.templateItemId は必須です', 400);
        ns.assert(/^[A-Za-z0-9_-]{8,120}$/.test(runItemId), 'invalid_request', 'clientItems.id の形式が不正です', 400);
        ns.assert(!seenRunItemIds[runItemId], 'invalid_request', 'clientItems.id が重複しています', 400);
        seenRunItemIds[runItemId] = true;
        result[templateItemId] = runItemId;
      });
      return result;
    }

    function ensureRunForDate(storeId, targetDate) {
      var existingRun = repository.findRunByStoreAndDate(storeId, targetDate);
      if (existingRun) {
        return existingRun;
      }
      var activeTemplate = repository.listActiveTemplates().find(function (template) {
        return template.store_id === storeId;
      });
      ns.assert(activeTemplate, 'not_found', '有効なチェックリストテンプレートがありません', 404);
      var now = ns.toIsoString(clock.now());
      return repository.createChecklistRun({
        id: Utilities.getUuid(),
        template_id: activeTemplate.id,
        store_id: storeId,
        target_date: targetDate,
        status: ns.RUN_STATUS.OPEN,
        notified_at: now,
        closed_at: '',
        created_at: now
      });
    }

    function buildAdminRunResponse(store, targetDate, run, items) {
      var runItems = items || [];
      var descriptionByTemplateItemId = buildTemplateItemDescriptionMap(repository, runItems);
      return {
        runId: run ? run.id : '',
        targetDate: targetDate,
        status: run ? run.status : ns.RUN_STATUS.OPEN,
        storeName: store.name,
        items: runItems.map(function (item) {
          return buildRunItemResponse(item, descriptionByTemplateItemId);
        })
      };
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

      getMonthlyStats: function (query) {
        return buildMonthlyStats(query);
      },

      getDailyStats: function (query) {
        return buildDailyStats(query);
      },

      adminLogin: function (body) {
        assertAdminCredentialConfigured();
        var safeBody = body || {};
        var loginId = ns.requireString(safeBody.loginId, 'loginId');
        var password = ns.requireString(safeBody.password, 'password');
        var isMatched = loginId === adminLoginId && password === adminLoginPassword;
        if (!isMatched) {
          var failureDetails = {
            path: '/api/admin/login',
            name: 'admin.login.failed',
            loginIdMatched: loginId === adminLoginId,
            loginIdLength: loginId.length,
            configuredLoginIdLength: adminLoginId.length,
            passwordLength: password.length,
            configuredPasswordLength: adminLoginPassword.length
          };
          ns.logEvent('warn', 'admin.login.failed', failureDetails);
          ns.writeDebugEvent('admin.login.failed', failureDetails);
        }
        ns.assert(
          isMatched,
          'unauthorized',
          '管理者IDまたはパスワードが正しくありません',
          401
        );
        var store = findCurrentStore();
        var token = createAdminSessionToken();
        var issuedAtMs = nowMillis();
        var expiresAtMs = issuedAtMs + (adminSessionTtlSeconds * 1000);
        persistAdminSession(token, {
          token: token,
          storeId: store.id,
          issuedAtMs: issuedAtMs,
          expiresAtMs: expiresAtMs
        });
        return {
          session: {
            token: token,
            storeId: store.id,
            storeName: store.name,
            expiresAt: ns.toIsoString(new Date(expiresAtMs))
          }
        };
      },

      listAdminTasks: function (query, body) {
        var session = requireAdminSession(query, body);
        return {
          tasks: listCatalogTasksByStore(session.storeId).map(buildAdminTaskResponse)
        };
      },

      createAdminTask: function (query, body) {
        var session = requireAdminSession(query, body);
        var safeBody = body || {};
        var title = ns.requireString(safeBody.title, 'title');
        var description = String(safeBody.description || '').trim();
        var catalogTasks = listCatalogTasksByStore(session.storeId);
        var maxSortOrder = catalogTasks.reduce(function (maxValue, task) {
          return Math.max(maxValue, Number(task.sort_order || 0));
        }, 0);
        var now = ns.toIsoString(clock.now());
        var catalogTemplate = ensureTaskCatalogTemplate(session.storeId);
        var createdTask = repository.createTemplateItem({
          id: Utilities.getUuid(),
          template_id: catalogTemplate.id,
          title: title,
          description: description,
          sort_order: String(maxSortOrder + 1),
          is_required: 'true',
          is_active: 'true',
          created_at: now,
          updated_at: now
        });
        return {
          task: buildAdminTaskResponse(createdTask)
        };
      },

      listAdminTemplates: function (query, body) {
        var session = requireAdminSession(query, body);
        return {
          templates: repository.listActiveTemplatesWithItems(session.storeId).map(function (entry) {
            return {
              id: entry.template.id,
              name: entry.template.name,
              itemCount: entry.items.length,
              items: entry.items.map(buildTemplateItemResponse)
            };
          })
        };
      },

      createAdminTemplate: function (query, body) {
        var session = requireAdminSession(query, body);
        var safeBody = body || {};
        var name = ns.requireString(safeBody.name, 'name');
        var rawTaskIds = Array.isArray(safeBody.taskIds) ? safeBody.taskIds.map(function (taskId) {
          return String(taskId || '').trim();
        }).filter(function (taskId) {
          return taskId !== '';
        }) : [];
        var deduplicatedTaskIds = [];
        var taskIdSet = {};
        rawTaskIds.forEach(function (taskId) {
          if (taskIdSet[taskId]) {
            return;
          }
          taskIdSet[taskId] = true;
          deduplicatedTaskIds.push(taskId);
        });
        ns.assert(deduplicatedTaskIds.length > 0, 'invalid_request', 'taskIds は1件以上指定してください', 400);

        var catalogTaskById = {};
        listCatalogTasksByStore(session.storeId).forEach(function (task) {
          catalogTaskById[task.id] = task;
        });
        var selectedTasks = deduplicatedTaskIds.map(function (taskId) {
          var task = catalogTaskById[taskId];
          ns.assert(task, 'not_found', '指定された taskId が見つかりません', 404);
          return task;
        });

        var now = ns.toIsoString(clock.now());
        var template = repository.createTemplate({
          id: Utilities.getUuid(),
          store_id: session.storeId,
          name: name,
          notify_time: '10:30',
          closing_time: '00:00',
          is_active: 'true',
          created_by: 'admin',
          created_at: now,
          updated_at: now
        });
        var createdItems = selectedTasks.map(function (task, index) {
          return repository.createTemplateItem({
            id: Utilities.getUuid(),
            template_id: template.id,
            title: task.title,
            description: task.description,
            sort_order: String(index + 1),
            is_required: 'true',
            is_active: 'true',
            created_at: now,
            updated_at: now
          });
        });
        return {
          template: {
            id: template.id,
            name: template.name,
            itemCount: createdItems.length,
            items: createdItems.map(buildTemplateItemResponse)
          }
        };
      },

      getAdminRunByDate: function (query, body, targetDateRaw) {
        var session = requireAdminSession(query, body);
        var targetDate = parseAdminTargetDate(targetDateRaw);
        var store = repository.findStoreById(session.storeId);
        ns.assert(store, 'config_error', '店舗が見つかりません', 500);
        var run = repository.findRunByStoreAndDate(session.storeId, targetDate);
        var items = run ? repository.listRunItems(run.id) : [];
        return {
          checklist: buildAdminRunResponse(store, targetDate, run, items)
        };
      },

      insertAdminRunItem: function (query, body, targetDateRaw) {
        var session = requireAdminSession(query, body);
        var targetDate = parseAdminTargetDate(targetDateRaw);
        var safeBody = body || {};
        var taskId = ns.requireString(safeBody.taskId, 'taskId');

        var task = listCatalogTasksByStore(session.storeId).find(function (candidate) {
          return candidate.id === taskId;
        });
        ns.assert(task, 'not_found', 'タスクが見つかりません', 404);

        var run = ensureRunForDate(session.storeId, targetDate);
        var runItems = repository.listRunItems(run.id);
        var duplicated = runItems.some(function (runItem) {
          return runItem.template_item_id === taskId;
        });
        ns.assert(!duplicated, 'conflict', '同じタスクはすでに追加されています', 409);
        var maxSortOrder = runItems.reduce(function (maxValue, runItem) {
          return Math.max(maxValue, Number(runItem.sort_order || 0));
        }, 0);
        var now = ns.toIsoString(clock.now());
        var createdItem = repository.createRunItems([
          {
            id: Utilities.getUuid(),
            run_id: run.id,
            template_item_id: task.id,
            title: task.title,
            sort_order: String(maxSortOrder + 1),
            status: ns.ITEM_STATUS.UNCHECKED,
            checked_by: '',
            checked_by_name: '',
            checked_at: '',
            updated_at: now
          }
        ])[0];
        return {
          item: buildRunItemResponse(createdItem, buildTemplateItemDescriptionMap(repository, [createdItem]))
        };
      },

      applyAdminTemplateToRun: function (query, body, targetDateRaw, templateId) {
        var session = requireAdminSession(query, body);
        var targetDate = parseAdminTargetDate(targetDateRaw);
        var normalizedTemplateId = String(templateId || '').trim();
        ns.assert(normalizedTemplateId, 'invalid_request', 'templateId は必須です', 400);
        var template = repository.findTemplateById(normalizedTemplateId);
        ns.assert(template, 'not_found', 'テンプレートが見つかりません', 404);
        ns.assert(template.store_id === session.storeId, 'forbidden', '所属外のテンプレートは利用できません', 403);

        var templateItems = repository.listTemplateItems(template.id);
        ns.assert(templateItems.length > 0, 'invalid_request', 'テンプレートに項目がありません', 400);
        var clientRunItemIdByTemplateItemId = buildClientRunItemIdByTemplateItemId(body);

        var run = ensureRunForDate(session.storeId, targetDate);
        var existingRunItems = repository.listRunItems(run.id);
        var existingTemplateItemIds = {};
        existingRunItems.forEach(function (runItem) {
          if (runItem.template_item_id) {
            existingTemplateItemIds[runItem.template_item_id] = true;
          }
        });
        var maxSortOrder = existingRunItems.reduce(function (maxValue, runItem) {
          return Math.max(maxValue, Number(runItem.sort_order || 0));
        }, 0);
        var now = ns.toIsoString(clock.now());
        var newItems = templateItems.filter(function (templateItem) {
          return !existingTemplateItemIds[templateItem.id];
        }).map(function (templateItem, index) {
          var item = {
            id: Utilities.getUuid(),
            run_id: run.id,
            template_item_id: templateItem.id,
            title: templateItem.title,
            sort_order: String(maxSortOrder + index + 1),
            status: ns.ITEM_STATUS.UNCHECKED,
            checked_by: '',
            checked_by_name: '',
            checked_at: '',
            updated_at: now
          };
          if (clientRunItemIdByTemplateItemId[templateItem.id]) {
            ns.assert(
              !repository.findRunItemById(clientRunItemIdByTemplateItemId[templateItem.id]),
              'invalid_request',
              'clientItems.id は既に使用されています',
              400
            );
            item.id = clientRunItemIdByTemplateItemId[templateItem.id];
          }
          return item;
        });
        var insertedItems = newItems.length > 0 ? repository.createRunItems(newItems) : [];
        var descriptionByTemplateItemId = buildTemplateItemDescriptionMap(repository, insertedItems);
        return {
          insertedCount: insertedItems.length,
          items: insertedItems.map(function (item) {
            return buildRunItemResponse(item, descriptionByTemplateItemId);
          })
        };
      },

      deleteAdminRunItem: function (query, body, targetDateRaw, runItemIdRaw) {
        var session = requireAdminSession(query, body);
        var targetDate = parseAdminTargetDate(targetDateRaw);
        var runItemId = String(runItemIdRaw || '').trim();
        ns.assert(runItemId, 'invalid_request', 'runItemId は必須です', 400);

        var runItem = repository.findRunItemById(runItemId);
        ns.assert(runItem, 'not_found', '削除対象のタスクが見つかりません', 404);
        var run = repository.findRunById(runItem.run_id);
        ns.assert(run, 'not_found', '対象チェックリストが見つかりません', 404);
        ns.assert(run.store_id === session.storeId, 'forbidden', '所属外のタスクは削除できません', 403);
        ns.assert(run.target_date === targetDate, 'invalid_request', '選択日と異なるタスクは削除できません', 400);

        var allRunItems = repository.listTable('checklist_run_items');
        var filteredRunItems = allRunItems.filter(function (item) {
          return item.id !== runItemId;
        });
        ns.assert(filteredRunItems.length !== allRunItems.length, 'not_found', '削除対象のタスクが見つかりません', 404);
        repository.replaceTable('checklist_run_items', filteredRunItems);
        return {
          deletedRunItemId: runItemId
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
            item: buildSingleRunItemResponse(repository, item)
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
          item: buildSingleRunItemResponse(repository, updatedItem),
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
            item: buildSingleRunItemResponse(repository, item)
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
          item: buildSingleRunItemResponse(repository, updatedItem),
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

      rebalanceNotificationRecipients: function () {
        var store = findCurrentStore();
        var channels = repository.listActiveNotificationChannelsByStore(store.id).sort(function (left, right) {
          return left.id.localeCompare(right.id);
        });
        var recipients = repository.listActiveNotificationRecipientsByStore(store.id).sort(function (left, right) {
          return left.line_user_id.localeCompare(right.line_user_id);
        });
        ensureNotificationChannelsCapacity(channels, recipients);

        var assignments = [];
        var channelIndex = 0;
        var usedCountForCurrentChannel = 0;
        recipients.forEach(function (recipient) {
          var channel = channels[channelIndex];
          ns.assert(channel, 'invalid_state', '通知チャネル容量が不足しています。公式アカウントを追加してください', 409);
          var recipientLimit = Number(channel.recipient_limit);
          if (usedCountForCurrentChannel >= recipientLimit) {
            channelIndex += 1;
            usedCountForCurrentChannel = 0;
            channel = channels[channelIndex];
          }
          ns.assert(channel, 'invalid_state', '通知チャネル容量が不足しています。公式アカウントを追加してください', 409);
          assignments.push({
            recipientId: recipient.id,
            channelId: channel.id
          });
          usedCountForCurrentChannel += 1;
        });

        var updatedRecipients = repository.assignNotificationRecipientChannels(
          assignments,
          ns.toIsoString(clock.now())
        );
        var usageRows = notificationService.refreshUsageRows(channels);
        return {
          assignedCount: updatedRecipients.length,
          channels: channels.map(function (channel) {
            return {
              id: channel.id,
              recipientCount: updatedRecipients.filter(function (recipient) {
                return recipient.channel_id === channel.id;
              }).length
            };
          }),
          usage: usageRows
        };
      },

      runDailyIncompleteReminder: function () {
        var context = getCurrentStoreReminderContext();
        if (!context.run) {
          return {
            skipped: true,
            reason: 'no_run',
            targetDate: context.targetDate,
            notifications: []
          };
        }

        var items = repository.listRunItems(context.run.id).filter(function (item) {
          return item.status === ns.ITEM_STATUS.UNCHECKED;
        });
        if (items.length === 0) {
          return {
            skipped: true,
            reason: 'no_unchecked_items',
            targetDate: context.targetDate,
            notifications: []
          };
        }

        var channels = repository.listActiveNotificationChannelsByStore(context.store.id);
        var recipients = repository.listActiveNotificationRecipientsByStore(context.store.id);
        ns.assert(
          recipients.length > 0,
          'invalid_state',
          '通知対象者がいません。従業員にLIFFを開いてもらってください',
          409
        );
        ensureNotificationChannelsCapacity(channels, recipients);
        var message = buildDailyIncompleteReminderMessage(context.store, context.run, items);
        var notifications = notificationService.sendToNotificationRecipients(
          context.run,
          recipients,
          channels,
          ns.NOTIFICATION_TYPES.DAILY_INCOMPLETE_REMINDER,
          message,
          {
            buildDedupeKey: function (recipient) {
              return buildDailyIncompleteReminderDedupeKey(context.run, recipient);
            }
          }
        );
        return {
          skipped: false,
          targetDate: context.targetDate,
          uncheckedCount: items.length,
          notifications: notifications
        };
      },

      runReminderWatchdog: function () {
        var context = getCurrentStoreReminderContext();
        if (!isReminderWatchdogWindow(clock.now())) {
          return {
            skipped: true,
            reason: 'outside_window',
            targetDate: context.targetDate,
            notifications: []
          };
        }
        if (hasSentDailyIncompleteReminder(context.store.id, context.targetDate)) {
          return {
            skipped: true,
            reason: 'already_sent',
            targetDate: context.targetDate,
            notifications: []
          };
        }
        return this.runDailyIncompleteReminder();
      },

      syncNotificationChannelUsage: function () {
        var store = findCurrentStore();
        var channels = repository.listActiveNotificationChannelsByStore(store.id);
        return {
          usage: notificationService.refreshUsageRows(channels)
        };
      },

      runDailyStart: function () {
        var createdRuns = [];
        var targetDate = resolveBusinessDate(clock.now());
        repository.listActiveTemplates().forEach(function (template) {
          var existingRun = repository.findRunByStoreAndDate(template.store_id, targetDate);
          if (existingRun) {
            return;
          }

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
