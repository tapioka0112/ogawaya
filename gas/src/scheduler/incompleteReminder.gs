var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  function parseJstDateParts(date) {
    var isoString = Utilities.formatDate(date, ns.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'");
    var match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    ns.assert(match, 'internal_error', '日付フォーマットの解析に失敗しました', 500);
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3])
    };
  }

  function buildJstReminderDate(parts) {
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1, 15, 30, 0));
  }

  ns.calculateNextIncompleteReminderAt = function (now) {
    var baseNow = now || new Date();
    var parts = parseJstDateParts(baseNow);
    var reminderAt = buildJstReminderDate(parts);
    if (reminderAt.getTime() <= baseNow.getTime()) {
      reminderAt = new Date(reminderAt.getTime() + (24 * 60 * 60 * 1000));
    }
    return reminderAt;
  };

  function deleteTriggersByFunctionName(scriptApp, functionNames) {
    var nameSet = {};
    functionNames.forEach(function (functionName) {
      nameSet[functionName] = true;
    });
    scriptApp.getProjectTriggers().forEach(function (trigger) {
      if (nameSet[trigger.getHandlerFunction()]) {
        scriptApp.deleteTrigger(trigger);
      }
    });
  }

  ns.installIncompleteReminderTriggers = function (options) {
    var safeOptions = options || {};
    var scriptApp = safeOptions.scriptApp || ScriptApp;
    var clock = safeOptions.clock || ns.defaultClock();
    deleteTriggersByFunctionName(scriptApp, ['runDailyIncompleteReminder', 'runReminderWatchdog']);

    var reminderAt = ns.calculateNextIncompleteReminderAt(clock.now());
    scriptApp.newTrigger('runDailyIncompleteReminder').timeBased().at(reminderAt).create();
    scriptApp.newTrigger('runReminderWatchdog').timeBased().everyMinutes(15).create();

    return {
      reminderAt: ns.toIsoString(reminderAt),
      watchdogEveryMinutes: 15
    };
  };

  ns.installNextIncompleteReminderTrigger = function (options) {
    var safeOptions = options || {};
    var scriptApp = safeOptions.scriptApp || ScriptApp;
    var clock = safeOptions.clock || ns.defaultClock();
    deleteTriggersByFunctionName(scriptApp, ['runDailyIncompleteReminder']);

    var reminderAt = ns.calculateNextIncompleteReminderAt(clock.now());
    scriptApp.newTrigger('runDailyIncompleteReminder').timeBased().at(reminderAt).create();
    return {
      reminderAt: ns.toIsoString(reminderAt)
    };
  };
})(Ogawaya);

function runDailyIncompleteReminder() {
  try {
    return Ogawaya.createApplication({}).runDailyIncompleteReminder();
  } finally {
    Ogawaya.installNextIncompleteReminderTrigger({});
  }
}

function runReminderWatchdog() {
  return Ogawaya.createApplication({}).runReminderWatchdog();
}

function installReminderTriggers() {
  return Ogawaya.installIncompleteReminderTriggers({});
}

function rebalanceNotificationRecipients() {
  return Ogawaya.createApplication({}).rebalanceNotificationRecipients();
}

function syncNotificationChannelUsage() {
  return Ogawaya.createApplication({}).syncNotificationChannelUsage();
}
