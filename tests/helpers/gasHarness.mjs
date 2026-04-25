import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const GAS_FILE_PATHS = [
  'gas/src/shared/constants.gs',
  'gas/src/shared/bootstrap.gs',
  'gas/src/storage/spreadsheetRepository.gs',
  'gas/src/services/notificationService.gs',
  'gas/src/services/checklistService.gs',
  'gas/src/handlers/api.gs',
  'gas/src/handlers/webhook.gs',
  'gas/src/scheduler/dailyStart.gs',
  'gas/src/scheduler/dailyClosing.gs',
  'gas/src/scheduler/incompleteReminder.gs',
  'gas/src/main.gs'
];

function createTextOutput(content) {
  return {
    content,
    mimeType: null,
    setMimeType(mimeType) {
      this.mimeType = mimeType;
      return this;
    }
  };
}

function createTemplate(fileName) {
  return {
    fileName,
    appBaseUrl: '',
    mode: '',
    evaluate() {
      return {
        fileName,
        appBaseUrl: this.appBaseUrl,
        mode: this.mode,
        setXFrameOptionsMode() {
          return this;
        }
      };
    }
  };
}

function createUtilities() {
  return {
    formatDate(date, timeZone, format) {
      const locale = timeZone === 'Asia/Tokyo' ? 'sv-SE' : 'en-CA';
      const formatter = new Intl.DateTimeFormat(locale, {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
      if (format === 'yyyy-MM-dd') {
        return `${parts.year}-${parts.month}-${parts.day}`;
      }
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`;
    },
    getUuid() {
      return crypto.randomUUID();
    },
    base64Encode(bytes) {
      return Buffer.from(bytes).toString('base64');
    },
    base64EncodeWebSafe(bytes) {
      return Buffer.from(bytes).toString('base64url');
    },
    computeHmacSha256Signature(value, key) {
      return crypto.createHmac('sha256', key).update(value).digest();
    }
  };
}

function createScriptProperties(initialProperties = {}) {
  const properties = { ...initialProperties };
  return {
    getProperty(key) {
      return Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null;
    },
    setProperty(key, value) {
      properties[key] = value;
    },
    getProperties() {
      return { ...properties };
    }
  };
}

function createScriptCache(initialEntries = {}) {
  const entries = new Map(Object.entries(initialEntries));
  return {
    get(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    put(key, value) {
      entries.set(key, String(value));
    },
    remove(key) {
      entries.delete(key);
    }
  };
}

export async function loadGasRuntime(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const filePaths = options.filePaths ?? GAS_FILE_PATHS;
  const scriptProperties = createScriptProperties(options.scriptProperties);
  const scriptCache = options.cacheFactory
    ? options.cacheFactory()
    : (options.enableCacheService === true ? createScriptCache() : null);
  const context = {
    console,
    JSON,
    Date,
    Math,
    Buffer,
    setTimeout,
    clearTimeout,
    UrlFetchApp: {
      fetch(url, requestOptions) {
        if (!options.fetch) {
          throw new Error(`Unexpected fetch: ${url}`);
        }
        return options.fetch(url, requestOptions);
      }
    },
    SpreadsheetApp: {
      openById(spreadsheetId) {
        if (!options.spreadsheetFactory) {
          throw new Error(`Unexpected spreadsheet access: ${spreadsheetId}`);
        }
        return options.spreadsheetFactory(spreadsheetId);
      }
    },
    ContentService: {
      MimeType: {
        JSON: 'application/json'
      },
      createTextOutput(content) {
        return createTextOutput(content);
      }
    },
    HtmlService: {
      XFrameOptionsMode: {
        ALLOWALL: 'ALLOWALL'
      },
      createHtmlOutputFromFile(fileName) {
        return {
          fileName,
          setXFrameOptionsMode() {
            return this;
          }
        };
      },
      createTemplateFromFile(fileName) {
        return createTemplate(fileName);
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return scriptProperties;
      }
    },
    ScriptApp: {
      AuthMode: {
        FULL: 'FULL'
      },
      AuthorizationStatus: {
        NOT_REQUIRED: 'NOT_REQUIRED',
        REQUIRED: 'REQUIRED'
      },
      getAuthorizationInfo(authMode, scopes) {
        const status = options.authorizationStatus ?? 'NOT_REQUIRED';
        return {
          authMode,
          scopes,
          getAuthorizationStatus() {
            return status;
          },
          getAuthorizationUrl() {
            return options.authorizationUrl ?? 'https://script.google.com/auth';
          }
        };
      },
      getOAuthToken() {
        return options.oauthToken ?? 'test-oauth-token';
      },
      getService() {
        return {
          getUrl() {
            return options.appBaseUrl ?? 'https://example.com/exec';
          }
        };
      }
    },
    Utilities: createUtilities()
  };
  if (options.enableCacheService === true || options.cacheFactory) {
    context.CacheService = {
      getScriptCache() {
        return scriptCache;
      }
    };
  }
  context.global = context;
  context.globalThis = context;
  vm.createContext(context);

  for (const relativePath of filePaths) {
    const absolutePath = path.join(cwd, relativePath);
    const code = await readFile(absolutePath, 'utf8');
    vm.runInContext(code, context, { filename: absolutePath });
  }

  return context;
}
