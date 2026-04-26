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

  function encodeFirestoreFields(value) {
    var fields = {};
    Object.keys(value || {}).forEach(function (key) {
      fields[key] = encodeFirestoreValue(value[key]);
    });
    return fields;
  }

  function encodeFirestoreValue(value) {
    if (value === null || typeof value === 'undefined') {
      return { nullValue: null };
    }
    if (Array.isArray(value)) {
      return {
        arrayValue: {
          values: value.map(encodeFirestoreValue)
        }
      };
    }
    if (typeof value === 'object') {
      return {
        mapValue: {
          fields: encodeFirestoreFields(value)
        }
      };
    }
    if (typeof value === 'boolean') {
      return { booleanValue: value };
    }
    if (typeof value === 'number') {
      return Number(value) === Math.floor(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };
    }
    return { stringValue: String(value) };
  }

  function buildFirestoreSnapshotDocumentUrl(projectId, storeId, targetDate) {
    var path = [
      'stores',
      storeId,
      'runs',
      targetDate,
      'snapshots',
      'today'
    ].map(encodeURIComponent).join('/');
    return 'https://firestore.googleapis.com/v1/projects/' +
      encodeURIComponent(projectId) +
      '/databases/(default)/documents/' +
      path;
  }

  ns.createFirestoreSnapshotClient = function (options) {
    var safeOptions = options || {};
    var projectId = String(safeOptions.projectId || '').trim();
    ns.assert(projectId, 'config_error', 'FIREBASE_PROJECT_ID が未設定です', 500);
    var fetchFn = safeOptions.fetch || function (url, requestOptions) {
      return UrlFetchApp.fetch(url, requestOptions);
    };
    var getOAuthToken = safeOptions.getOAuthToken || function () {
      return ScriptApp.getOAuthToken();
    };
    var requiredScopes = safeOptions.requiredScopes || ['https://www.googleapis.com/auth/datastore'];
    var getAuthorizationInfo = safeOptions.getAuthorizationInfo || null;

    function ensureRequiredScopesAuthorized() {
      if (!getAuthorizationInfo) {
        return;
      }
      var authInfo = getAuthorizationInfo(requiredScopes);
      var status = authInfo && authInfo.getAuthorizationStatus ? String(authInfo.getAuthorizationStatus()) : '';
      if (status !== 'REQUIRED') {
        return;
      }
      var error = ns.createError('authorization_required', 'Firestore snapshot 用 OAuth scope の承認が必要です', 403);
      error.details = {
        authorizationStatus: status,
        authorizationUrl: authInfo && authInfo.getAuthorizationUrl ? String(authInfo.getAuthorizationUrl() || '') : '',
        requiredScopes: requiredScopes.join(' ')
      };
      throw error;
    }

    return {
      writeTodaySnapshot: function (storeId, targetDate, payload) {
        ensureRequiredScopesAuthorized();
        var token = String(getOAuthToken() || '');
        ns.assert(token, 'config_error', 'Firestore snapshot 用 OAuth token を取得できません', 500);
        var response = fetchFn(buildFirestoreSnapshotDocumentUrl(projectId, storeId, targetDate), {
          method: 'patch',
          contentType: 'application/json',
          headers: {
            Authorization: 'Bearer ' + token
          },
          payload: JSON.stringify({
            fields: encodeFirestoreFields(payload)
          }),
          muteHttpExceptions: true
        });
        var responseCode = Number(response.getResponseCode());
        var responseText = response.getContentText();
        if (responseCode < 200 || responseCode >= 300) {
          var error = ns.createError('external_api_error', 'Firestore snapshot の保存に失敗しました', 502);
          error.details = {
            projectId: projectId,
            storeId: storeId,
            targetDate: targetDate,
            responseCode: responseCode,
            response: sanitizeDiagnosticText(responseText || '')
          };
          throw error;
        }
        return {
          responseCode: responseCode
        };
      }
    };
  };

  function decodeFirestoreValue(value) {
    if (!value || typeof value !== 'object') {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) {
      return String(value.stringValue || '');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) {
      return ns.toIsoString(new Date(String(value.timestampValue || '')));
    }
    if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) {
      return Number(value.integerValue || 0);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) {
      return Number(value.doubleValue || 0);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) {
      return value.booleanValue === true;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) {
      return null;
    }
    if (value.arrayValue) {
      return (value.arrayValue.values || []).map(decodeFirestoreValue);
    }
    if (value.mapValue) {
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

  function decodeFirestoreEventDocument(document) {
    var eventPayload = decodeFirestoreFields((document && document.fields) || {});
    var nameParts = String((document && document.name) || '').split('/');
    eventPayload.id = nameParts[nameParts.length - 1] || '';
    return eventPayload;
  }

  function buildFirestoreRunEventsUrl(projectId, storeId, targetDate, pageToken) {
    var path = [
      'stores',
      storeId,
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

  ns.createFirestoreEventReader = function (options) {
    var safeOptions = options || {};
    var projectId = String(safeOptions.projectId || '').trim();
    ns.assert(projectId, 'config_error', 'FIREBASE_PROJECT_ID が未設定です', 500);
    var fetchFn = safeOptions.fetch || function (url, requestOptions) {
      return UrlFetchApp.fetch(url, requestOptions);
    };

    return {
      listRunEvents: function (storeId, targetDate) {
        var events = [];
        var pageToken = '';
        do {
          var response = fetchFn(buildFirestoreRunEventsUrl(projectId, storeId, targetDate, pageToken), {
            method: 'get',
            muteHttpExceptions: true
          });
          var responseCode = Number(response.getResponseCode());
          var responseText = response.getContentText();
          if (responseCode === 404) {
            return events;
          }
          if (responseCode < 200 || responseCode >= 300) {
            var error = ns.createError('external_api_error', 'Firestore events の取得に失敗しました', 502);
            error.details = {
              projectId: projectId,
              storeId: storeId,
              targetDate: targetDate,
              responseCode: responseCode,
              response: sanitizeDiagnosticText(responseText || '')
            };
            throw error;
          }
          var payload = JSON.parse(responseText || '{}');
          (payload.documents || []).forEach(function (document) {
            events.push(decodeFirestoreEventDocument(document));
          });
          pageToken = String(payload.nextPageToken || '');
        } while (pageToken);
        return events;
      }
    };
  };

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

  function parseLineJson(responseText, errorMessage) {
    try {
      return JSON.parse(responseText || '{}');
    } catch (parseError) {
      throw ns.createError('external_api_error', errorMessage, 502);
    }
  }

  function buildAccessTokenFailureDetails(accessToken, responseCode, lineError, lineErrorDescription, responseText) {
    return {
      accessTokenLength: String(accessToken || '').length,
      accessTokenVerifyStatus: responseCode,
      accessTokenError: lineError,
      accessTokenDescription: lineErrorDescription,
      accessTokenResponse: sanitizeDiagnosticText(responseText || '')
    };
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

  function verifyIdentityByAccessToken(accessToken, requestLiffId, loginChannelId, liffId, channelId) {
    var tokenText = String(accessToken || '');
    var verifyChannelIds = normalizeVerifyChannelIds(loginChannelId, liffId, channelId, requestLiffId);
    ns.assert(verifyChannelIds.length > 0, 'config_error', 'LIFF 認証用 channel ID が未設定です', 500);
    ns.assert(tokenText, 'unauthorized', 'LIFF 認証コンテキストがありません', 401);

    var verifyStartedAt = nowMillis();
    var verifyResponse = UrlFetchApp.fetch(
      'https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(tokenText),
      {
        method: 'get',
        muteHttpExceptions: true
      }
    );
    var verifyResponseCode = Number(verifyResponse.getResponseCode());
    var verifyResponseText = verifyResponse.getContentText();
    if (verifyResponseCode !== 200) {
      var verifyError = parseLineVerifyError(verifyResponseText);
      var verifyFailure = ns.createError('unauthorized', 'LIFF access token の検証に失敗しました', 401);
      verifyFailure.details = buildAccessTokenFailureDetails(
        tokenText,
        verifyResponseCode,
        verifyError.error,
        verifyError.description,
        verifyResponseText
      );
      throw verifyFailure;
    }
    var verifyPayload = parseLineJson(verifyResponseText, 'LINE access token verify 応答の解析に失敗しました');
    var tokenClientId = String(verifyPayload.client_id || '').trim();
    if (verifyChannelIds.indexOf(tokenClientId) === -1) {
      var clientError = ns.createError('unauthorized', 'LIFF access token の channel が一致しません', 401);
      clientError.details = {
        accessTokenLength: tokenText.length,
        accessTokenClientIdSuffix: tokenClientId ? tokenClientId.slice(-4) : '',
        expectedClientIdSuffixes: verifyChannelIds.map(function (candidate) {
          return String(candidate).slice(-4);
        }).join(',')
      };
      throw clientError;
    }

    var profileResponse = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + tokenText
      }
    });
    var profileResponseCode = Number(profileResponse.getResponseCode());
    var profileResponseText = profileResponse.getContentText();
    if (profileResponseCode !== 200) {
      var profileError = parseLineVerifyError(profileResponseText);
      var profileFailure = ns.createError('unauthorized', 'LIFF access token の userinfo 取得に失敗しました', 401);
      profileFailure.details = buildAccessTokenFailureDetails(
        tokenText,
        profileResponseCode,
        profileError.error,
        profileError.description,
        profileResponseText
      );
      throw profileFailure;
    }
    var profilePayload = parseLineJson(profileResponseText, 'LINE profile 応答の解析に失敗しました');
    ns.assert(profilePayload.userId, 'internal_error', 'LINE profile 応答に userId が含まれていません', 500);
    ns.logEvent('info', 'auth.verify.success', {
      lineUserId: summarizeId(profilePayload.userId),
      hasDisplayName: !!profilePayload.displayName,
      cacheHit: false,
      method: 'access_token',
      verifyMs: nowMillis() - verifyStartedAt
    });
    return {
      lineUserId: profilePayload.userId,
      displayName: profilePayload.displayName || ''
    };
  }

  function buildDefaultIdentityClient(loginChannelId, liffId, channelId) {
    function verifyIdentityByIdToken(idToken, requestLiffId) {
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

    return {
      verifyIdToken: function (idToken, requestLiffId, accessToken) {
        if (idToken) {
          try {
            return verifyIdentityByIdToken(idToken, requestLiffId);
          } catch (idTokenError) {
            if (!accessToken || Number(idTokenError.statusCode) !== 401) {
              throw idTokenError;
            }
            ns.logEvent('warn', 'auth.verify.id_token_fallback', buildErrorLog(idTokenError));
          }
        }
        return verifyIdentityByAccessToken(accessToken, requestLiffId, loginChannelId, liffId, channelId);
      }
    };
  }

  function buildTemplateItemMetadataMap(repository, items) {
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

    var metadata = {};
    repository.listTable('checklist_template_items').forEach(function (templateItem) {
      if (neededIds[templateItem.id]) {
        metadata[templateItem.id] = {
          description: String(templateItem.description || ''),
          period: ns.normalizeTaskPeriod(templateItem.period)
        };
      }
    });
    return metadata;
  }

  function buildRunItemResponse(item, metadataByTemplateItemId) {
    var checkedByName = String(item.checked_by_name || '').trim();
    var checkedByUserId = String(item.checked_by || '').trim();
    var templateItemId = String(item.template_item_id || '').trim();
    var templateMetadata = metadataByTemplateItemId && templateItemId
      ? metadataByTemplateItemId[templateItemId]
      : null;
    return {
      id: item.id,
      templateItemId: templateItemId,
      title: item.title,
      description: templateMetadata
        ? String(templateMetadata.description || '')
        : '',
      period: ns.normalizeTaskPeriod(item.period || (templateMetadata && templateMetadata.period)),
      status: item.status,
      checkedBy: checkedByName || null,
      checkedByUserId: checkedByUserId || null,
      checkedAt: item.checked_at || null,
      updatedAt: item.updated_at || null
    };
  }

  function buildSingleRunItemResponse(repository, item) {
    return buildRunItemResponse(item, buildTemplateItemMetadataMap(repository, [item]));
  }

  function buildChecklistResponse(repository, currentUser, run, items) {
    var checkedCount = items.filter(function (item) {
      return item.status === ns.ITEM_STATUS.CHECKED;
    }).length;
    var progressByPeriod = buildProgressByPeriod(items);
    var metadataByTemplateItemId = buildTemplateItemMetadataMap(repository, items);

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
      progressByPeriod: progressByPeriod,
      items: items.map(function (item) {
        return buildRunItemResponse(item, metadataByTemplateItemId);
      })
    };
  }

  function buildProgressByPeriod(items) {
    var progressByPeriod = {};
    ns.TASK_PERIOD_VALUES.forEach(function (period) {
      progressByPeriod[period] = {
        checked: 0,
        total: 0
      };
    });
    items.forEach(function (item) {
      var period = ns.normalizeTaskPeriod(item.period);
      progressByPeriod[period].total += 1;
      if (item.status === ns.ITEM_STATUS.CHECKED) {
        progressByPeriod[period].checked += 1;
      }
    });
    return progressByPeriod;
  }

  function getPeriodSortIndex(period) {
    return ns.TASK_PERIOD_VALUES.indexOf(ns.normalizeTaskPeriod(period));
  }

  function buildTemplateItemResponse(item) {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      period: ns.normalizeTaskPeriod(item.period),
      sortOrder: Number(item.sort_order),
      isRequired: ns.parseBoolean(item.is_required)
    };
  }

  var TASK_PERIOD_LABELS = {
    daily: '日間',
    weekly: '週間',
    monthly: '月間'
  };

  function requireTaskPeriod(value, fieldName) {
    var rawPeriod = String(value || '').trim();
    ns.assert(rawPeriod, 'invalid_request', fieldName + ' は必須です', 400);
    return ns.normalizeTaskPeriod(rawPeriod, 'invalid_request');
  }

  function listTemplateItemPeriods(items) {
    var periodMap = {};
    (items || []).forEach(function (item) {
      periodMap[ns.normalizeTaskPeriod(item.period)] = true;
    });
    return ns.TASK_PERIOD_VALUES.filter(function (period) {
      return !!periodMap[period];
    });
  }

  function resolveTemplatePeriod(template, items) {
    var rawPeriod = String(template && template.period ? template.period : '').trim();
    if (rawPeriod) {
      return ns.normalizeTaskPeriod(rawPeriod, 'invalid_data');
    }
    var periods = listTemplateItemPeriods(items || []);
    if (periods.length === 1) {
      return periods[0];
    }
    return ns.TASK_PERIODS.DAILY;
  }

  function assertTemplateItemsMatchPeriod(period, items) {
    var normalizedPeriod = ns.normalizeTaskPeriod(period, 'invalid_request');
    (items || []).forEach(function (item) {
      ns.assert(
        ns.normalizeTaskPeriod(item.period, 'invalid_request') === normalizedPeriod,
        'invalid_request',
        'テンプレートには同じ期間のタスクだけを含めてください',
        400
      );
    });
  }

  function buildTemplateResponse(template, items) {
    return {
      id: template.id,
      name: template.name,
      period: resolveTemplatePeriod(template, items),
      notifyTime: template.notify_time,
      closingTime: template.closing_time,
      isActive: ns.parseBoolean(template.is_active),
      items: items.map(buildTemplateItemResponse)
    };
  }

  function parseTargetDateParts(targetDate) {
    var match = String(targetDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    ns.assert(match, 'invalid_data', 'target_date の形式が不正です', 400);
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3])
    };
  }

  function calculateDayOfWeek(targetDate) {
    var parts = parseTargetDateParts(targetDate);
    var month = parts.month;
    var year = parts.year;
    if (month < 3) {
      month += 12;
      year -= 1;
    }
    return (parts.day + Math.floor((13 * (month + 1)) / 5) + year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400)) % 7;
  }

  function formatUtcDate(date) {
    var year = date.getUTCFullYear();
    var month = String(date.getUTCMonth() + 1);
    var day = String(date.getUTCDate());
    return year + '-' + (month.length === 1 ? '0' + month : month) + '-' + (day.length === 1 ? '0' + day : day);
  }

  function addDaysToTargetDate(targetDate, days) {
    var parts = parseTargetDateParts(targetDate);
    return formatUtcDate(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0))));
  }

  function getMonthStartDate(targetDate) {
    var parts = parseTargetDateParts(targetDate);
    return parts.year + '-' + (parts.month < 10 ? '0' + parts.month : String(parts.month)) + '-01';
  }

  function getMonthEndDate(targetDate) {
    var parts = parseTargetDateParts(targetDate);
    return formatUtcDate(new Date(Date.UTC(parts.year, parts.month, 0)));
  }

  function getSundayWeekStartDate(targetDate) {
    var dayOfWeek = calculateDayOfWeek(targetDate);
    var offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    return addDaysToTargetDate(targetDate, offset);
  }

  function isRunItemVisibleOnTargetDate(item, runTargetDate, targetDate) {
    var period = ns.normalizeTaskPeriod(item.period);
    if (period === ns.TASK_PERIODS.DAILY) {
      return runTargetDate === targetDate;
    }
    if (period === ns.TASK_PERIODS.WEEKLY) {
      return runTargetDate === getSundayWeekStartDate(targetDate);
    }
    return runTargetDate === getMonthStartDate(targetDate);
  }

  function isRunItemDueForClosing(item, runTargetDate, closingDate) {
    var period = ns.normalizeTaskPeriod(item.period);
    if (period === ns.TASK_PERIODS.DAILY) {
      return runTargetDate === closingDate;
    }
    if (period === ns.TASK_PERIODS.WEEKLY) {
      return runTargetDate === getSundayWeekStartDate(closingDate) && calculateDayOfWeek(closingDate) === 0;
    }
    return runTargetDate === getMonthStartDate(closingDate) && closingDate === getMonthEndDate(closingDate);
  }

  function shouldCreateTemplateItemOnDate(templateItem, targetDate) {
    var period = ns.normalizeTaskPeriod(templateItem.period);
    if (period === ns.TASK_PERIODS.DAILY) {
      return true;
    }
    if (period === ns.TASK_PERIODS.WEEKLY) {
      return calculateDayOfWeek(targetDate) === 1;
    }
    return parseTargetDateParts(targetDate).day === 1;
  }

  function listScheduledTemplateItems(templateItems, targetDate) {
    return templateItems.filter(function (templateItem) {
      return shouldCreateTemplateItemOnDate(templateItem, targetDate);
    });
  }

  function buildRunItemPayloadFromTemplateItem(templateItem, runId, runItemId, sortOrder, now) {
    return {
      id: runItemId,
      run_id: runId,
      template_item_id: templateItem.id,
      title: templateItem.title,
      period: ns.normalizeTaskPeriod(templateItem.period),
      sort_order: String(sortOrder),
      status: ns.ITEM_STATUS.UNCHECKED,
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: now
    };
  }

  function listHomeRunItemsForStore(repository, storeId, targetDate, todayRun) {
    var runById = {};
    var runs = [];
    function addRun(run) {
      if (!run || runById[run.id]) {
        return;
      }
      runById[run.id] = run;
      runs.push(run);
    }

    addRun(todayRun || repository.findRunByStoreAndDate(storeId, targetDate));
    addRun(repository.findRunByStoreAndDate(storeId, getSundayWeekStartDate(targetDate)));
    addRun(repository.findRunByStoreAndDate(storeId, getMonthStartDate(targetDate)));

    var itemIds = {};
    var items = [];
    runs.forEach(function (run) {
      repository.listRunItems(run.id).forEach(function (item) {
        if (!isRunItemVisibleOnTargetDate(item, run.target_date, targetDate) || itemIds[item.id]) {
          return;
        }
        itemIds[item.id] = true;
        items.push(item);
      });
    });

    return items.sort(function (a, b) {
      var periodDiff = getPeriodSortIndex(a.period) - getPeriodSortIndex(b.period);
      if (periodDiff !== 0) {
        return periodDiff;
      }
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
  }

  function runHasItemsVisibleOnTargetDate(repository, run, targetDate) {
    return repository.listRunItems(run.id).some(function (item) {
      return isRunItemVisibleOnTargetDate(item, run.target_date, targetDate);
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
    var identityClient = options.identityClient || buildDefaultIdentityClient(
      options.lineLoginChannelId,
      options.liffId,
      options.lineChannelId
    );
    var notificationService = options.notificationService;
    var appBaseUrl = options.appBaseUrl || '';
    var checklistAppUrl = options.checklistAppUrl || appBaseUrl;
    var allowAnonymousAccess = options.allowAnonymousAccess === true;
    var snapshotClient = options.snapshotClient || null;
    var firestoreEventReader = options.firestoreEventReader || null;
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
    var firestoreEventSyncSecret = String(options.firestoreEventSyncSecret || '').trim();
    var adminSessionMemory = {};
    var ADMIN_SESSION_KEY_PREFIX = 'ogawaya:admin:session:v2:';
    var TASK_CATALOG_TEMPLATE_PREFIX = 'task-catalog-';

    if (!isFinite(adminSessionTtlSeconds) || adminSessionTtlSeconds < 300) {
      adminSessionTtlSeconds = 12 * 60 * 60;
    }

    function resolveIdentity(query) {
      try {
        var identity = identityClient.verifyIdToken(query.idToken, query.liffId, query.accessToken);
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

    function findAdminSessionStore(body) {
      var storeId = String((body && body.storeId) || '').trim();
      if (!storeId) {
        return findCurrentStore();
      }

      var store = repository.findStoreById(storeId);
      ns.assert(store, 'invalid_request', 'storeId の店舗が見つかりません', 400);
      ns.assert(String(store.status || '') === 'active', 'invalid_request', 'storeId の店舗が有効ではありません', 400);
      return store;
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

    function buildSnapshotUserContext(store) {
      return {
        user: {
          id: '',
          store_id: store.id,
          name: '',
          role: ''
        },
        store: store
      };
    }

    function buildChecklistSnapshot(store, run, items) {
      var payload = buildChecklistResponse(repository, buildSnapshotUserContext(store), run, items);
      payload.items = payload.items.map(function (item) {
        var snapshotItem = ns.clone(item);
        delete snapshotItem.checkedBy;
        delete snapshotItem.checkedByUserId;
        return snapshotItem;
      });
      payload.ok = true;
      payload.statusCode = 200;
      payload.snapshotUpdatedAt = ns.toIsoString(clock.now());
      return payload;
    }

    function writeChecklistSnapshotPayload(store, targetDate, payload) {
      if (!snapshotClient) {
        return {
          status: 'disabled'
        };
      }
      var startedAt = nowMillis();
      try {
        var result = snapshotClient.writeTodaySnapshot(
          store.id,
          targetDate,
          payload
        );
        var responseCode = Number(result && result.responseCode ? result.responseCode : 0);
        if (responseCode < 200 || responseCode >= 300) {
          var writeError = ns.createError('external_api_error', 'Firestore snapshot の保存に失敗しました', 502);
          writeError.details = {
            responseCode: responseCode,
            response: result && result.response ? sanitizeDiagnosticText(result.response) : ''
          };
          throw writeError;
        }
        ns.logEvent('info', 'firestore.snapshot.write.success', {
          storeId: store.id,
          targetDate: targetDate,
          durationMs: nowMillis() - startedAt,
          responseCode: responseCode
        });
        return {
          status: 'ok',
          responseCode: responseCode
        };
      } catch (error) {
        var errorDetails = error && error.details ? error.details : {};
        var errorResponseCode = errorDetails.responseCode ? Number(errorDetails.responseCode) : 0;
        var errorResponse = errorDetails.response ? sanitizeDiagnosticText(errorDetails.response) : '';
        var authorizationStatus = errorDetails.authorizationStatus ? String(errorDetails.authorizationStatus) : '';
        var authorizationUrl = errorDetails.authorizationUrl ? String(errorDetails.authorizationUrl) : '';
        ns.logEvent('warn', 'firestore.snapshot.write.failed', {
          storeId: store.id,
          targetDate: targetDate,
          durationMs: nowMillis() - startedAt,
          code: error && error.code ? String(error.code) : '',
          statusCode: error && error.statusCode ? Number(error.statusCode) : 0,
          message: error && error.message ? String(error.message) : '',
          responseCode: errorResponseCode,
          response: errorResponse,
          authorizationStatus: authorizationStatus
        });
        return {
          status: 'error',
          code: error && error.code ? String(error.code) : '',
          statusCode: error && error.statusCode ? Number(error.statusCode) : 0,
          responseCode: errorResponseCode,
          message: error && error.message ? String(error.message) : '',
          response: errorResponse,
          authorizationStatus: authorizationStatus,
          authorizationUrl: authorizationUrl
        };
      }
    }

    function writeChecklistSnapshot(run, items) {
      var store = repository.findStoreById(run.store_id);
      ns.assert(store, 'config_error', '店舗が見つかりません', 500);
      return writeChecklistSnapshotPayload(store, run.target_date, buildChecklistSnapshot(store, run, items));
    }

    function writeChecklistSnapshotForTargetDate(storeId, targetDate) {
      var run = repository.findRunByStoreAndDate(storeId, targetDate);
      if (!run) {
        return {
          status: 'missing_run'
        };
      }
      var store = repository.findStoreById(storeId);
      ns.assert(store, 'config_error', '店舗が見つかりません', 500);
      var items = listHomeRunItemsForStore(repository, storeId, targetDate, run);
      return writeChecklistSnapshotPayload(store, targetDate, buildChecklistSnapshot(store, run, items));
    }

    function writeRunAndCurrentSnapshots(run) {
      var originSync = writeChecklistSnapshotForTargetDate(run.store_id, run.target_date);
      var currentTargetDate = resolveBusinessDate(clock.now());
      if (
        currentTargetDate !== run.target_date
        && runHasItemsVisibleOnTargetDate(repository, run, currentTargetDate)
        && repository.findRunByStoreAndDate(run.store_id, currentTargetDate)
      ) {
        writeChecklistSnapshotForTargetDate(run.store_id, currentTargetDate);
      }
      return originSync;
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
      if (!safeQuery.idToken && !safeQuery.accessToken) {
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
      ns.assert(
        safeQuery.idToken || safeQuery.accessToken,
        'unauthorized',
        '更新操作には LIFF 認証が必要です',
        401
      );
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
        var templateItems = listScheduledTemplateItems(repository.listTemplateItems(template.id), targetDate);
        var runItems = templateItems.map(function (templateItem) {
          return buildRunItemPayloadFromTemplateItem(templateItem, runId, Utilities.getUuid(), templateItem.sort_order, now);
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
        'チェックリストに未完了項目があります。',
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
      var metadataByTemplateItemId = buildTemplateItemMetadataMap(repository, runItems);
      return {
        date: targetDate,
        runCount: runs.length,
        total: runItems.length,
        checked: checkedItems,
        achieved: runItems.length > 0 && checkedItems === runItems.length,
        items: runItems.map(function (item) {
          return buildRunItemResponse(item, metadataByTemplateItemId);
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

    function requireFirestoreEventSyncSecret(body) {
      ns.assert(
        firestoreEventSyncSecret,
        'config_error',
        'FIRESTORE_EVENT_SYNC_SECRET が未設定です',
        500
      );
      var actualSecret = String((body && body.syncSecret) || '').trim();
      ns.assert(actualSecret === firestoreEventSyncSecret, 'forbidden', 'Firestore event sync secret が不正です', 403);
    }

    function resolveRunTargetDateForPeriod(period, targetDate) {
      var normalizedPeriod = ns.normalizeTaskPeriod(period);
      if (normalizedPeriod === ns.TASK_PERIODS.WEEKLY) {
        return getSundayWeekStartDate(targetDate);
      }
      if (normalizedPeriod === ns.TASK_PERIODS.MONTHLY) {
        return getMonthStartDate(targetDate);
      }
      return targetDate;
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
        period: ns.TASK_PERIODS.DAILY,
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
        period: ns.normalizeTaskPeriod(item.period),
        sortOrder: Number(item.sort_order)
      };
    }

    function buildAdminTemplateResponse(template, items) {
      var response = buildTemplateResponse(template, items);
      response.itemCount = items.length;
      return response;
    }

    function buildSplitTemplateId(templateId, period) {
      return String(templateId || '') + '-' + ns.normalizeTaskPeriod(period);
    }

    function buildSplitTemplateItemId(itemId, period) {
      return String(itemId || '') + '-' + ns.normalizeTaskPeriod(period);
    }

    function buildSplitTemplateName(name, period) {
      return String(name || '') + '（' + TASK_PERIOD_LABELS[ns.normalizeTaskPeriod(period)] + '）';
    }

    function groupTemplateItemsByPeriod(items) {
      var grouped = {};
      ns.TASK_PERIOD_VALUES.forEach(function (period) {
        grouped[period] = [];
      });
      (items || []).forEach(function (item) {
        grouped[ns.normalizeTaskPeriod(item.period)].push(item);
      });
      return grouped;
    }

    function ensureSplitTemplateItems(templateId, period, items, now) {
      (items || []).forEach(function (item, index) {
        var splitItemId = buildSplitTemplateItemId(item.id, period);
        if (repository.findRowById('checklist_template_items', splitItemId)) {
          return;
        }
        repository.createTemplateItem({
          id: splitItemId,
          template_id: templateId,
          title: item.title,
          description: item.description,
          period: ns.normalizeTaskPeriod(period),
          sort_order: String(index + 1),
          is_required: item.is_required,
          is_active: 'true',
          created_at: now,
          updated_at: now
        });
      });
    }

    function normalizePeriodTemplatesForStore(storeId) {
      var now = ns.toIsoString(clock.now());
      repository.listActiveTemplatesWithItems(storeId).forEach(function (entry) {
        var template = entry.template;
        var items = entry.items;
        var itemPeriods = listTemplateItemPeriods(items);
        var rawPeriod = String(template.period || '').trim();
        if (itemPeriods.length <= 1) {
          var nextPeriod = itemPeriods[0] || (rawPeriod ? ns.normalizeTaskPeriod(rawPeriod, 'invalid_data') : ns.TASK_PERIODS.DAILY);
          if (rawPeriod !== nextPeriod) {
            repository.updateTemplate(template.id, {
              period: nextPeriod,
              updated_at: now
            });
          }
          return;
        }

        var groupedItems = groupTemplateItemsByPeriod(items);
        itemPeriods.forEach(function (period) {
          var splitTemplateId = buildSplitTemplateId(template.id, period);
          var splitTemplate = repository.findTemplateById(splitTemplateId);
          if (splitTemplate) {
            repository.updateTemplate(splitTemplateId, {
              name: buildSplitTemplateName(template.name, period),
              period: period,
              notify_time: template.notify_time,
              closing_time: template.closing_time,
              is_active: 'true',
              updated_at: now
            });
          } else {
            repository.createTemplate({
              id: splitTemplateId,
              store_id: template.store_id,
              name: buildSplitTemplateName(template.name, period),
              period: period,
              notify_time: template.notify_time,
              closing_time: template.closing_time,
              is_active: 'true',
              created_by: template.created_by,
              created_at: now,
              updated_at: now
            });
          }
          ensureSplitTemplateItems(splitTemplateId, period, groupedItems[period], now);
        });
        repository.updateTemplate(template.id, {
          is_active: 'false',
          updated_at: now
        });
      });
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
      var metadataByTemplateItemId = buildTemplateItemMetadataMap(repository, runItems);
      return {
        runId: run ? run.id : '',
        targetDate: targetDate,
        status: run ? run.status : ns.RUN_STATUS.OPEN,
        storeName: store.name,
        items: runItems.map(function (item) {
          return buildRunItemResponse(item, metadataByTemplateItemId);
        })
      };
    }

    function buildTemplateItemIdFilter(templateItemIds) {
      if (!templateItemIds || templateItemIds.length === 0) {
        return null;
      }
      var filter = {};
      templateItemIds.forEach(function (templateItemId) {
        var normalizedTemplateItemId = String(templateItemId || '').trim();
        if (normalizedTemplateItemId) {
          filter[normalizedTemplateItemId] = true;
        }
      });
      return Object.keys(filter).length > 0 ? filter : null;
    }

    function buildTemplateApplyRunContext(run, existingRunItems) {
      var existingTemplateItemIds = {};
      existingRunItems.forEach(function (runItem) {
        if (runItem.template_item_id) {
          existingTemplateItemIds[runItem.template_item_id] = true;
        }
      });
      return {
        run: run,
        existingTemplateItemIds: existingTemplateItemIds,
        maxSortOrder: existingRunItems.reduce(function (maxValue, runItem) {
          return Math.max(maxValue, Number(runItem.sort_order || 0));
        }, 0),
        nextItems: [],
        changedItems: []
      };
    }

    function addMissingScheduledTemplateItemsToRun(template, run, targetDate, now) {
      var existingItems = repository.listRunItems(run.id);
      var existingTemplateItemIds = {};
      existingItems.forEach(function (runItem) {
        if (runItem.template_item_id) {
          existingTemplateItemIds[runItem.template_item_id] = true;
        }
      });
      var maxSortOrder = existingItems.reduce(function (maxValue, runItem) {
        return Math.max(maxValue, Number(runItem.sort_order || 0));
      }, 0);
      var missingItems = listScheduledTemplateItems(repository.listTemplateItems(template.id), targetDate)
        .filter(function (templateItem) {
          return !existingTemplateItemIds[templateItem.id];
        })
        .map(function (templateItem, index) {
          return buildRunItemPayloadFromTemplateItem(
            templateItem,
            run.id,
            Utilities.getUuid(),
            maxSortOrder + index + 1,
            now
          );
        });
      return missingItems.length > 0 ? repository.createRunItems(missingItems) : [];
    }

    function applyTemplateToPeriodRuns(storeId, targetDate, templateId, body, options) {
      var applyOptions = options || {};
      var normalizedTemplateId = String(templateId || '').trim();
      ns.assert(normalizedTemplateId, 'invalid_request', 'templateId は必須です', 400);
      var template = repository.findTemplateById(normalizedTemplateId);
      ns.assert(template, 'not_found', 'テンプレートが見つかりません', 404);
      ns.assert(template.store_id === storeId, 'forbidden', '所属外のテンプレートは利用できません', 403);

      var allowedTemplateItemIds = buildTemplateItemIdFilter(applyOptions.templateItemIds || []);
      var templateItems = repository.listTemplateItems(template.id).filter(function (templateItem) {
        return !allowedTemplateItemIds || !!allowedTemplateItemIds[templateItem.id];
      });
      ns.assert(templateItems.length > 0, 'invalid_request', 'テンプレートに項目がありません', 400);
      var templatePeriod = resolveTemplatePeriod(template, templateItems);
      assertTemplateItemsMatchPeriod(templatePeriod, templateItems);
      if (applyOptions.templatePeriod) {
        ns.assert(
          ns.normalizeTaskPeriod(applyOptions.templatePeriod, 'invalid_request') === templatePeriod,
          'invalid_request',
          'event.period とテンプレート期間が一致しません',
          400
        );
      }
      var effectiveTargetDate = resolveRunTargetDateForPeriod(templatePeriod, targetDate);

      var clientRunItemIdByTemplateItemId = buildClientRunItemIdByTemplateItemId(body);
      var baseRun = ensureRunForDate(storeId, effectiveTargetDate);
      var contextByTargetDate = {};
      var affectedRunById = {};
      var now = ns.toIsoString(clock.now());

      function getContext(runTargetDate) {
        if (!contextByTargetDate[runTargetDate]) {
          var run = runTargetDate === effectiveTargetDate ? baseRun : ensureRunForDate(storeId, runTargetDate);
          contextByTargetDate[runTargetDate] = buildTemplateApplyRunContext(run, repository.listRunItems(run.id));
        }
        return contextByTargetDate[runTargetDate];
      }

      function rememberAffectedRun(run) {
        affectedRunById[run.id] = run;
      }

      templateItems.forEach(function (templateItem) {
        var runTargetDate = resolveRunTargetDateForPeriod(templateItem.period, targetDate);
        var context = getContext(runTargetDate);
        if (context.existingTemplateItemIds[templateItem.id]) {
          return;
        }

        var clientRunItemId = clientRunItemIdByTemplateItemId[templateItem.id] || '';
        if (clientRunItemId) {
          var existingClientRunItem = repository.findRunItemById(clientRunItemId);
          if (existingClientRunItem) {
            ns.assert(
              existingClientRunItem.template_item_id === templateItem.id,
              'invalid_request',
              'clientItems.id は別のタスクで使用されています',
              400
            );
            var existingClientRun = repository.findRunById(existingClientRunItem.run_id);
            ns.assert(existingClientRun, 'not_found', '移動元チェックリストが見つかりません', 404);
            ns.assert(existingClientRun.store_id === storeId, 'forbidden', '所属外のタスクは利用できません', 403);
            if (existingClientRun.id !== context.run.id) {
              var movedItem = repository.updateRunItem(existingClientRunItem.id, {
                run_id: context.run.id,
                title: templateItem.title,
                period: ns.normalizeTaskPeriod(templateItem.period),
                sort_order: String(context.maxSortOrder + context.nextItems.length + context.changedItems.length + 1),
                updated_at: now
              });
              context.changedItems.push(movedItem);
              rememberAffectedRun(existingClientRun);
              rememberAffectedRun(context.run);
            }
            context.existingTemplateItemIds[templateItem.id] = true;
            return;
          }
        }

        var item = buildRunItemPayloadFromTemplateItem(
          templateItem,
          context.run.id,
          Utilities.getUuid(),
          context.maxSortOrder + context.nextItems.length + context.changedItems.length + 1,
          now
        );
        if (clientRunItemId) {
          item.id = clientRunItemId;
        }
        context.nextItems.push(item);
        context.existingTemplateItemIds[templateItem.id] = true;
        rememberAffectedRun(context.run);
      });

      var insertedItems = [];
      var changedItems = [];
      Object.keys(contextByTargetDate).forEach(function (runTargetDate) {
        var context = contextByTargetDate[runTargetDate];
        if (context.nextItems.length > 0) {
          insertedItems = insertedItems.concat(repository.createRunItems(context.nextItems));
          rememberAffectedRun(context.run);
        }
        changedItems = changedItems.concat(context.changedItems);
      });

      Object.keys(affectedRunById).forEach(function (runId) {
        writeRunAndCurrentSnapshots(affectedRunById[runId]);
      });
      if (!affectedRunById[baseRun.id]) {
        writeChecklistSnapshotForTargetDate(storeId, effectiveTargetDate);
      }

      var responseItems = insertedItems.concat(changedItems);
      var metadataByTemplateItemId = buildTemplateItemMetadataMap(repository, responseItems);
      return {
        insertedCount: insertedItems.length,
        changedCount: changedItems.length,
        items: responseItems.map(function (item) {
          return buildRunItemResponse(item, metadataByTemplateItemId);
        })
      };
    }

    function buildFirestoreTemplateClientBody(eventPayload) {
      return {
        clientItems: (eventPayload.items || []).map(function (item) {
          return {
            templateItemId: String(item && item.templateItemId ? item.templateItemId : '').trim(),
            id: String(item && item.id ? item.id : '').trim()
          };
        })
      };
    }

    function normalizeFirestoreEventTimestamp(value, fieldName, required) {
      var normalized = String(value || '').trim();
      if (!normalized) {
        ns.assert(required !== true, 'invalid_request', fieldName + ' は必須です', 400);
        return '';
      }
      var parsed = new Date(normalized);
      ns.assert(!isNaN(parsed.getTime()), 'invalid_request', fieldName + ' の形式が不正です', 400);
      return ns.toIsoString(parsed);
    }

    function applyFirestoreStatusEvent(storeId, targetDate, eventPayload) {
      var runItemId = ns.requireString(eventPayload.itemId, 'event.itemId');
      var status = String(eventPayload.status || '').trim();
      ns.assert(
        status === ns.ITEM_STATUS.CHECKED || status === ns.ITEM_STATUS.UNCHECKED,
        'invalid_request',
        'event.status が不正です',
        400
      );
      var item = repository.findRunItemById(runItemId);
      ns.assert(item, 'not_found', 'チェック項目が見つかりません', 404);
      var run = repository.findRunById(item.run_id);
      ns.assert(run, 'not_found', 'チェックリストが見つかりません', 404);
      ns.assert(run.store_id === storeId, 'forbidden', '所属外のタスクは利用できません', 403);

      var checked = status === ns.ITEM_STATUS.CHECKED;
      var checkedAt = checked
        ? normalizeFirestoreEventTimestamp(eventPayload.checkedAt, 'event.checkedAt', true)
        : '';
      var updatedAt = normalizeFirestoreEventTimestamp(eventPayload.updatedAt, 'event.updatedAt', false)
        || ns.toIsoString(clock.now());
      var updatedItem = repository.updateRunItem(item.id, {
        status: status,
        checked_by: checked ? String(eventPayload.checkedByUserId || '').trim() : '',
        checked_by_name: checked ? String(eventPayload.checkedBy || '').trim() : '',
        checked_at: checkedAt,
        updated_at: updatedAt
      });
      writeRunAndCurrentSnapshots(run);
      if (targetDate !== run.target_date && repository.findRunByStoreAndDate(run.store_id, targetDate)) {
        writeChecklistSnapshotForTargetDate(run.store_id, targetDate);
      }
      return {
        item: buildSingleRunItemResponse(repository, updatedItem)
      };
    }

    function applyFirestoreEventPayload(storeId, targetDate, eventId, eventPayload) {
      ns.assert(storeId, 'invalid_request', 'storeId は必須です', 400);
      ns.assert(String(eventPayload.storeId || '') === storeId, 'invalid_request', 'event.storeId が不正です', 400);
      ns.assert(String(eventPayload.targetDate || '') === targetDate, 'invalid_request', 'event.targetDate が不正です', 400);

      if (eventPayload.type === 'template_insert') {
        var templateItemIds = (eventPayload.items || []).map(function (item) {
          return String(item && item.templateItemId ? item.templateItemId : '').trim();
        }).filter(function (templateItemId) {
          return templateItemId !== '';
        });
        ns.assert(templateItemIds.length > 0, 'invalid_request', 'event.items は1件以上必要です', 400);
        return {
          eventId: String(eventId || ''),
          result: applyTemplateToPeriodRuns(
            storeId,
            targetDate,
            eventPayload.templateId,
            buildFirestoreTemplateClientBody(eventPayload),
            {
              templateItemIds: templateItemIds,
              templatePeriod: String(eventPayload.period || '').trim()
            }
          )
        };
      }

      return {
        eventId: String(eventId || ''),
        result: applyFirestoreStatusEvent(storeId, targetDate, eventPayload)
      };
    }

    function listFirestoreEventSyncTargetDates(options) {
      var syncOptions = options || {};
      if (syncOptions.targetDate) {
        return [parseAdminTargetDate(syncOptions.targetDate)];
      }
      var days = Number(syncOptions.days || 14);
      ns.assert(isFinite(days) && days >= 1 && days <= 45, 'invalid_request', 'days は 1〜45 で指定してください', 400);
      var currentTargetDate = resolveBusinessDate(clock.now());
      var dates = [];
      for (var offset = 0; offset < days; offset += 1) {
        dates.push(addDaysToTargetDate(currentTargetDate, -offset));
      }
      return dates;
    }

    function listFirestoreEventSyncStoreIds(options) {
      var syncOptions = options || {};
      if (syncOptions.storeId) {
        var storeId = String(syncOptions.storeId || '').trim();
        ns.assert(repository.findStoreById(storeId), 'invalid_request', 'storeId の店舗が見つかりません', 400);
        return [storeId];
      }
      return repository.listTable('stores').filter(function (store) {
        return String(store.status || '') === 'active';
      }).map(function (store) {
        return store.id;
      });
    }

    function sortFirestoreEvents(events) {
      return (events || []).slice().sort(function (left, right) {
        return String(left.emittedAt || '').localeCompare(String(right.emittedAt || ''));
      });
    }

    function buildFirestoreEventSyncStateKey(storeId, targetDate) {
      return [
        'FIRESTORE_EVENT_SYNCED_IDS',
        String(storeId || '').replace(/[^A-Za-z0-9_-]/g, '_'),
        String(targetDate || '').replace(/[^0-9-]/g, '_')
      ].join(':');
    }

    function readSyncedFirestoreEventIds(storeId, targetDate) {
      var raw = PropertiesService.getScriptProperties().getProperty(buildFirestoreEventSyncStateKey(storeId, targetDate));
      if (!raw) {
        return {};
      }
      var values = JSON.parse(raw);
      ns.assert(Array.isArray(values), 'invalid_data', 'Firestore event sync state の形式が不正です', 500);
      var result = {};
      values.forEach(function (eventId) {
        if (eventId) {
          result[String(eventId)] = true;
        }
      });
      return result;
    }

    function writeSyncedFirestoreEventIds(storeId, targetDate, eventIds) {
      var values = Object.keys(eventIds || {}).sort().slice(-1000);
      PropertiesService.getScriptProperties().setProperty(
        buildFirestoreEventSyncStateKey(storeId, targetDate),
        JSON.stringify(values)
      );
    }

    function syncFirestoreEventsFromReader(options) {
      ns.assert(firestoreEventReader, 'config_error', 'Firestore event reader が未設定です', 500);
      var syncOptions = options || {};
      var storeIds = listFirestoreEventSyncStoreIds(syncOptions);
      var targetDates = listFirestoreEventSyncTargetDates(syncOptions);
      var appliedCount = 0;
      var scannedCount = 0;
      var skippedCount = 0;
      var force = syncOptions.force === true;

      storeIds.forEach(function (storeId) {
        targetDates.forEach(function (targetDate) {
          var events = sortFirestoreEvents(firestoreEventReader.listRunEvents(storeId, targetDate));
          var syncedEventIds = readSyncedFirestoreEventIds(storeId, targetDate);
          var changed = false;
          scannedCount += events.length;
          events.forEach(function (eventPayload) {
            var eventId = String(eventPayload.id || '');
            ns.assert(eventId, 'invalid_data', 'Firestore event id が空です', 500);
            if (!force && syncedEventIds[eventId]) {
              skippedCount += 1;
              return;
            }
            applyFirestoreEventPayload(storeId, targetDate, eventPayload.id, eventPayload);
            syncedEventIds[eventId] = true;
            changed = true;
            appliedCount += 1;
          });
          if (changed) {
            writeSyncedFirestoreEventIds(storeId, targetDate, syncedEventIds);
          }
        });
      });

      return {
        storeIds: storeIds,
        targetDates: targetDates,
        scannedCount: scannedCount,
        appliedCount: appliedCount,
        skippedCount: skippedCount
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
        var items = listHomeRunItemsForStore(repository, currentUser.user.store_id, run.target_date, run);
        var itemsMs = nowMillis() - itemsStartedAt;

        var buildStartedAt = nowMillis();
        var response = buildChecklistResponse(repository, currentUser, run, items);
        var buildMs = nowMillis() - buildStartedAt;
        var snapshotStartedAt = nowMillis();
        var snapshotSync = writeChecklistSnapshot(run, items);
        response.snapshotSync = snapshotSync;
        var snapshotMs = nowMillis() - snapshotStartedAt;
        ns.logEvent('info', 'api.today.breakdown', {
          authMs: authMs,
          runMs: runMs,
          itemsMs: itemsMs,
          buildMs: buildMs,
          snapshotMs: snapshotMs,
          totalMs: nowMillis() - startedAt,
          itemsCount: items.length
        });
        return response;
      },

      getTodayIncomplete: function (query) {
        var currentUser = requireAuthenticatedUser(query);
        var run = getTodayRunForUser(currentUser.user);
        var items = listHomeRunItemsForStore(repository, currentUser.user.store_id, run.target_date, run).filter(function (item) {
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
        var store = findAdminSessionStore(safeBody);
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
          period: ns.normalizeTaskPeriod(safeBody.period, 'invalid_request'),
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
        normalizePeriodTemplatesForStore(session.storeId);
        return {
          templates: repository.listActiveTemplatesWithItems(session.storeId).map(function (entry) {
            return buildAdminTemplateResponse(entry.template, entry.items);
          })
        };
      },

      createAdminTemplate: function (query, body) {
        var session = requireAdminSession(query, body);
        var safeBody = body || {};
        var name = ns.requireString(safeBody.name, 'name');
        var templatePeriod = requireTaskPeriod(safeBody.period, 'period');
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
        assertTemplateItemsMatchPeriod(templatePeriod, selectedTasks);

        var now = ns.toIsoString(clock.now());
        var template = repository.createTemplate({
          id: Utilities.getUuid(),
          store_id: session.storeId,
          name: name,
          period: templatePeriod,
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
            period: ns.normalizeTaskPeriod(task.period),
            sort_order: String(index + 1),
            is_required: 'true',
            is_active: 'true',
            created_at: now,
            updated_at: now
          });
        });
        return {
          template: buildAdminTemplateResponse(template, createdItems)
        };
      },

      getAdminRunByDate: function (query, body, targetDateRaw) {
        var session = requireAdminSession(query, body);
        var targetDate = parseAdminTargetDate(targetDateRaw);
        var store = repository.findStoreById(session.storeId);
        ns.assert(store, 'config_error', '店舗が見つかりません', 500);
        var run = repository.findRunByStoreAndDate(session.storeId, targetDate);
        var items = listHomeRunItemsForStore(repository, session.storeId, targetDate, run);
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
            period: ns.normalizeTaskPeriod(task.period),
            sort_order: String(maxSortOrder + 1),
            status: ns.ITEM_STATUS.UNCHECKED,
            checked_by: '',
            checked_by_name: '',
            checked_at: '',
            updated_at: now
          }
        ])[0];
        writeRunAndCurrentSnapshots(run);
        return {
          item: buildRunItemResponse(createdItem, buildTemplateItemMetadataMap(repository, [createdItem]))
        };
      },

      applyAdminTemplateToRun: function (query, body, targetDateRaw, templateId) {
        var session = requireAdminSession(query, body);
        var targetDate = parseAdminTargetDate(targetDateRaw);
        return applyTemplateToPeriodRuns(session.storeId, targetDate, templateId, body, {
          templatePeriod: String((body && body.period) || '').trim()
        });
      },

      applyFirestoreEventSync: function (query, body) {
        var safeBody = body || {};
        requireFirestoreEventSyncSecret(safeBody);
        var eventPayload = safeBody.event || {};
        var storeId = String(safeBody.storeId || eventPayload.storeId || '').trim();
        var targetDate = parseAdminTargetDate(safeBody.targetDate || eventPayload.targetDate);
        return applyFirestoreEventPayload(storeId, targetDate, safeBody.eventId, eventPayload);
      },

      syncFirestoreEventsFromFirestore: function (query, body) {
        var safeBody = body || {};
        requireFirestoreEventSyncSecret(safeBody);
        return syncFirestoreEventsFromReader(safeBody);
      },

      repairScheduledItemsForExistingRun: function (query, body) {
        var safeBody = body || {};
        requireFirestoreEventSyncSecret(safeBody);
        var storeId = String(safeBody.storeId || '').trim();
        ns.assert(repository.findStoreById(storeId), 'invalid_request', 'storeId の店舗が見つかりません', 400);
        var targetDate = parseAdminTargetDate(safeBody.targetDate);
        var template = repository.listActiveTemplates().find(function (activeTemplate) {
          return activeTemplate.store_id === storeId;
        });
        ns.assert(template, 'not_found', '有効なチェックリストテンプレートがありません', 404);
        var run = repository.findRunByStoreAndDate(storeId, targetDate);
        ns.assert(run, 'not_found', '補修対象のチェックリストがありません', 404);
        var insertedItems = addMissingScheduledTemplateItemsToRun(template, run, targetDate, ns.toIsoString(clock.now()));
        var metadataByTemplateItemId = buildTemplateItemMetadataMap(repository, insertedItems);
        return {
          storeId: storeId,
          targetDate: targetDate,
          runId: run.id,
          insertedCount: insertedItems.length,
          items: insertedItems.map(function (item) {
            return buildRunItemResponse(item, metadataByTemplateItemId);
          }),
          snapshotSync: writeChecklistSnapshotForTargetDate(storeId, targetDate)
        };
      },

      runFirestoreEventSync: function (options) {
        return syncFirestoreEventsFromReader(options || {});
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
        ns.assert(
          run.target_date === targetDate || isRunItemVisibleOnTargetDate(runItem, run.target_date, targetDate),
          'invalid_request',
          '選択日に表示されないタスクは削除できません',
          400
        );

        var allRunItems = repository.listTable('checklist_run_items');
        var filteredRunItems = allRunItems.filter(function (item) {
          return item.id !== runItemId;
        });
        ns.assert(filteredRunItems.length !== allRunItems.length, 'not_found', '削除対象のタスクが見つかりません', 404);
        repository.replaceTable('checklist_run_items', filteredRunItems);
        writeRunAndCurrentSnapshots(run);
        if (targetDate !== run.target_date && repository.findRunByStoreAndDate(run.store_id, targetDate)) {
          writeChecklistSnapshotForTargetDate(run.store_id, targetDate);
        }
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
          writeRunAndCurrentSnapshots(scopedRunItem.run);
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
        writeRunAndCurrentSnapshots(scopedRunItem.run);
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
          writeRunAndCurrentSnapshots(scopedRunItem.run);
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
        writeRunAndCurrentSnapshots(scopedRunItem.run);
        return {
          item: buildSingleRunItemResponse(repository, updatedItem),
          reason: body.reason || ''
        };
      },

      createTemplate: function (query, body) {
        var currentUser = requireAuthenticatedWriteUser(query);
        ensureManager(currentUser.user);
        var name = ns.requireString(body.name, 'name');
        var templatePeriod = requireTaskPeriod(body.period, 'period');
        var now = ns.toIsoString(clock.now());
        var template = repository.createTemplate({
          id: Utilities.getUuid(),
          store_id: currentUser.user.store_id,
          name: name,
          period: templatePeriod,
          notify_time: '10:30',
          closing_time: '00:00',
          is_active: 'true',
          created_by: currentUser.user.id,
          created_at: now,
          updated_at: now
        });
        return { template: buildTemplateResponse(template, []) };
      },

      listTemplates: function (query) {
        var currentUser = requireAuthenticatedUser(query);
        ensureManager(currentUser.user);
        normalizePeriodTemplatesForStore(currentUser.user.store_id);
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
        var templatePeriod = resolveTemplatePeriod(template, repository.listTemplateItems(template.id));
        var itemPeriod = requireTaskPeriod(body.period, 'period');
        ns.assert(itemPeriod === templatePeriod, 'invalid_request', 'テンプレート期間と項目タグが一致しません', 400);

        var now = ns.toIsoString(clock.now());
        var item = repository.createTemplateItem({
          id: Utilities.getUuid(),
          template_id: templateId,
          title: ns.requireString(body.title, 'title'),
          description: body.description || '',
          period: itemPeriod,
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
        var templatePeriod = resolveTemplatePeriod(template, repository.listTemplateItems(template.id));
        var itemPeriod = requireTaskPeriod(body.period, 'period');
        ns.assert(itemPeriod === templatePeriod, 'invalid_request', 'テンプレート期間と項目タグが一致しません', 400);

        var updatedItem = repository.updateTemplateItem(itemId, {
          title: ns.requireString(body.title, 'title'),
          description: body.description || '',
          period: itemPeriod,
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
        var snapshotSyncs = [];
        var targetDate = resolveBusinessDate(clock.now());
        repository.listActiveTemplates().forEach(function (template) {
          var existingRun = repository.findRunByStoreAndDate(template.store_id, targetDate);
          var run = existingRun;
          var created = false;
          var now = ns.toIsoString(clock.now());
          if (!run) {
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
            var templateItems = listScheduledTemplateItems(repository.listTemplateItems(template.id), targetDate);
            run = repository.createChecklistRunWithItems(runPayload, templateItems.map(function (templateItem) {
              return buildRunItemPayloadFromTemplateItem(templateItem, runId, Utilities.getUuid(), templateItem.sort_order, now);
            }));
            created = true;

            notificationService.sendToUsers(
              run,
              repository.listLinkedUsersByStore(template.store_id, [ns.ROLES.PART_TIME]),
              ns.NOTIFICATION_TYPES.DAILY_START,
              buildDailyStartMessage(repository.findStoreById(template.store_id), run)
            );
            createdRuns.push(run);
          } else {
            addMissingScheduledTemplateItemsToRun(template, run, targetDate, now);
          }

          var snapshotSync = writeChecklistSnapshotForTargetDate(template.store_id, targetDate);
          snapshotSyncs.push(Object.assign({
            runId: run.id,
            storeId: template.store_id,
            targetDate: targetDate,
            created: created
          }, snapshotSync));
        });
        return {
          createdRuns: createdRuns,
          snapshotSyncs: snapshotSyncs
        };
      },

      runDailyClosing: function () {
        var notifications = [];
        var closingDate = clock.yesterday();
        var targetDates = {};
        targetDates[closingDate] = true;
        if (calculateDayOfWeek(closingDate) === 0) {
          targetDates[getSundayWeekStartDate(closingDate)] = true;
        }
        if (closingDate === getMonthEndDate(closingDate)) {
          targetDates[getMonthStartDate(closingDate)] = true;
        }
        var processedRunIds = {};
        var closedRuns = [];
        Object.keys(targetDates).sort().forEach(function (targetDate) {
          repository.listRunsByDate(targetDate).forEach(function (run) {
            if (processedRunIds[run.id]) {
              return;
            }
            processedRunIds[run.id] = true;
            var store = repository.findStoreById(run.store_id);
            var items = repository.listRunItems(run.id).filter(function (item) {
              return item.status === ns.ITEM_STATUS.UNCHECKED
                && isRunItemDueForClosing(item, run.target_date, closingDate);
            });
            if (items.length > 0) {
              notifications = notifications.concat(notificationService.sendToUsers(
                run,
                repository.listLinkedUsersByStore(run.store_id),
                ns.NOTIFICATION_TYPES.INCOMPLETE,
                buildIncompleteMessage(store, run, items)
              ));
            }
            var closedRun = run.status === ns.RUN_STATUS.CLOSED
              ? run
              : repository.updateRun(run.id, {
                status: ns.RUN_STATUS.CLOSED,
                closed_at: ns.toIsoString(clock.now())
              });
            writeRunAndCurrentSnapshots(closedRun);
            closedRuns.push(closedRun);
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
