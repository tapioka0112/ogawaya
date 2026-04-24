var Ogawaya = typeof Ogawaya === 'object' ? Ogawaya : {};

(function (ns) {
  function buildNotificationRow(repository, clock, run, user, type, message, status, errorMessage, channelId, dedupeKey) {
    return repository.appendNotification({
      id: Utilities.getUuid(),
      store_id: run.store_id,
      user_id: user.id,
      type: type,
      channel_id: channelId || '',
      dedupe_key: dedupeKey || '',
      message: message,
      status: status,
      sent_at: ns.toIsoString(clock.now()),
      error_message: errorMessage || ''
    });
  }

  function resolveYearMonth(clock) {
    return Utilities.formatDate(clock.now(), ns.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'").slice(0, 7);
  }

  function countSentNotificationsByChannel(repository, channelId, yearMonth) {
    return repository.listTable('notifications').filter(function (notification) {
      return notification.channel_id === channelId
        && notification.status === 'sent'
        && String(notification.sent_at || '').indexOf(yearMonth + '-') === 0;
    }).length;
  }

  function refreshUsageRows(repository, clock, channels) {
    var yearMonth = resolveYearMonth(clock);
    var now = ns.toIsoString(clock.now());
    return channels.map(function (channel) {
      var localSentCount = countSentNotificationsByChannel(repository, channel.id, yearMonth);
      var monthlyLimit = Number(channel.monthly_limit);
      ns.assert(isFinite(monthlyLimit), 'invalid_data', 'monthly_limit が不正です', 400);
      return repository.upsertNotificationChannelUsage({
        id: [channel.id, yearMonth].join(':'),
        channel_id: channel.id,
        year_month: yearMonth,
        monthly_limit: String(monthlyLimit),
        official_sent_count: '',
        local_sent_count: String(localSentCount),
        remaining_count: String(Math.max(monthlyLimit - localSentCount, 0)),
        last_synced_at: now,
        error_message: ''
      });
    });
  }

  function groupChannelsById(channels) {
    var channelsById = {};
    channels.forEach(function (channel) {
      channelsById[channel.id] = channel;
    });
    return channelsById;
  }

  function assertRecipientChannels(recipients, channelsById) {
    var missingRecipients = recipients.filter(function (recipient) {
      return !recipient.channel_id;
    });
    ns.assert(
      missingRecipients.length === 0,
      'invalid_state',
      '通知チャネル未割当のメンバーがいます。rebalanceNotificationRecipients を実行してください',
      409
    );

    var unknownChannelRecipients = recipients.filter(function (recipient) {
      return !channelsById[recipient.channel_id];
    });
    ns.assert(
      unknownChannelRecipients.length === 0,
      'invalid_state',
      '存在しない通知チャネルに割り当てられたメンバーがいます',
      409
    );

    var countsByChannelId = {};
    recipients.forEach(function (recipient) {
      countsByChannelId[recipient.channel_id] = (countsByChannelId[recipient.channel_id] || 0) + 1;
    });
    Object.keys(countsByChannelId).forEach(function (channelId) {
      var channel = channelsById[channelId];
      ns.assert(
        countsByChannelId[channelId] <= Number(channel.recipient_limit),
        'invalid_state',
        '通知チャネルの割当人数が上限を超えています。rebalanceNotificationRecipients を実行してください',
        409
      );
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
    var lineClientFactory = options.lineClientFactory || {
      createPushClient: function () {
        return lineClient;
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
            notifications.push(buildNotificationRow(repository, clock, run, user, type, message, 'sent', '', '', ''));
          } catch (error) {
            notifications.push(buildNotificationRow(repository, clock, run, user, type, message, 'failed', error.message, '', ''));
          }
        });
        return notifications;
      },

      sendToNotificationRecipients: function (run, recipients, channels, type, message, options) {
        if (!recipients.length) {
          return [];
        }

        var safeOptions = options || {};
        var channelsById = groupChannelsById(channels);
        assertRecipientChannels(recipients, channelsById);

        var notifications = [];
        recipients.forEach(function (recipient) {
          var channel = channelsById[recipient.channel_id];
          var dedupeKey = safeOptions.buildDedupeKey
            ? safeOptions.buildDedupeKey(recipient)
            : [type, run.id, recipient.line_user_id].join(':');
          if (repository.findNotificationByDedupeKey(dedupeKey)) {
            return;
          }

          var client = lineClientFactory.createPushClient(channel);
          var user = {
            id: recipient.line_user_id
          };
          try {
            client.pushMessage(recipient.line_user_id, message);
            notifications.push(
              buildNotificationRow(repository, clock, run, user, type, message, 'sent', '', channel.id, dedupeKey)
            );
          } catch (error) {
            notifications.push(
              buildNotificationRow(
                repository,
                clock,
                run,
                user,
                type,
                message,
                'failed',
                error.message,
                channel.id,
                dedupeKey
              )
            );
          }
        });

        refreshUsageRows(repository, clock, channels);
        return notifications;
      },

      refreshUsageRows: function (channels) {
        return refreshUsageRows(repository, clock, channels);
      }
    };
  };
})(Ogawaya);
