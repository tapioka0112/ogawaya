var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  function buildNotificationRow(repository, clock, run, user, type, message, status, errorMessage) {
    return repository.appendNotification({
      id: Utilities.getUuid(),
      store_id: run.store_id,
      user_id: user.id,
      type: type,
      message: message,
      status: status,
      sent_at: ns.toIsoString(clock.now()),
      error_message: errorMessage || ''
    });
  }

  ns.createNotificationService = function (options) {
    var repository = options.repository;
    var clock = options.clock || ns.defaultClock();
    var lineClient = options.lineClient || {
      pushMessage: function () {
        return { status: 'sent' };
      }
    };

    return {
      sendToUsers: function (run, linkedUsers, type, message) {
        if (!linkedUsers.length) {
          return [];
        }

        var notifications = [];
        linkedUsers.forEach(function (linkedUser) {
          var user = linkedUser.user;
          if (repository.findMatchingNotification(type, user.id, message)) {
            return;
          }

          try {
            lineClient.pushMessage(linkedUser.lineAccount.line_user_id, message);
            notifications.push(buildNotificationRow(repository, clock, run, user, type, message, 'sent', ''));
          } catch (error) {
            notifications.push(buildNotificationRow(repository, clock, run, user, type, message, 'failed', error.message));
          }
        });
        return notifications;
      }
    };
  };
})(Ogawaya);
