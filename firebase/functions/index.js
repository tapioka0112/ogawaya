const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

function assertValidTargetDate(targetDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || ''))) {
    throw new Error('targetDate must be YYYY-MM-DD');
  }
}

function buildDayEntry(dailyStats) {
  return {
    date: dailyStats.date,
    total: Number(dailyStats.total || 0),
    checked: Number(dailyStats.checked || 0),
    achieved: dailyStats.achieved === true
  };
}

function normalizeStatsItem(item) {
  return {
    id: String(item && item.id ? item.id : ''),
    title: String(item && item.title ? item.title : ''),
    status: String(item && item.status ? item.status : 'unchecked') === 'checked' ? 'checked' : 'unchecked',
    checkedBy: item && item.checkedBy ? String(item.checkedBy) : '',
    checkedByUserId: item && item.checkedByUserId ? String(item.checkedByUserId) : '',
    checkedAt: item && item.checkedAt ? String(item.checkedAt) : ''
  };
}

function buildCheckedByUserCounts(items) {
  const counts = {};
  items.forEach((item) => {
    if (item.status !== 'checked') {
      return;
    }
    if (!item.checkedByUserId) {
      return;
    }
    counts[item.checkedByUserId] = Number(counts[item.checkedByUserId] || 0) + 1;
  });
  return counts;
}

function buildDailyStats(snapshotData, storeId, targetDate) {
  const items = Array.isArray(snapshotData.items)
    ? snapshotData.items.map(normalizeStatsItem).filter((item) => item.id && item.title)
    : [];
  const checked = items.reduce((sum, item) => {
    return sum + (item.status === 'checked' ? 1 : 0);
  }, 0);

  return {
    storeId: String(storeId || ''),
    date: String(targetDate || ''),
    runId: String(snapshotData.runId || ''),
    total: items.length,
    checked: checked,
    achieved: items.length > 0 && checked === items.length,
    checkedByUserCounts: buildCheckedByUserCounts(items),
    items: items
  };
}

function normalizeMonthlyCounts(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const normalized = {};
  Object.keys(value).forEach((key) => {
    const count = Number(value[key] || 0);
    if (!key || !Number.isFinite(count) || count <= 0) {
      return;
    }
    normalized[key] = count;
  });
  return normalized;
}

function applyCountDelta(baseCounts, deltaCounts, multiplier) {
  Object.keys(deltaCounts || {}).forEach((userId) => {
    const delta = Number(deltaCounts[userId] || 0) * Number(multiplier || 0);
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    const next = Number(baseCounts[userId] || 0) + delta;
    if (next > 0) {
      baseCounts[userId] = next;
      return;
    }
    delete baseCounts[userId];
  });
}

function normalizeCalendarEntries(value) {
  if (!Array.isArray(value)) {
    return {};
  }
  const map = {};
  value.forEach((entry) => {
    const date = String(entry && entry.date ? entry.date : '');
    if (!date) {
      return;
    }
    map[date] = {
      date: date,
      total: Number(entry && entry.total ? entry.total : 0),
      checked: Number(entry && entry.checked ? entry.checked : 0),
      achieved: entry && entry.achieved === true
    };
  });
  return map;
}

function buildMonthlySummary(calendarMap, year, month, storeId, counts) {
  const calendar = Object.keys(calendarMap).sort().map((date) => {
    return calendarMap[date];
  });
  const totalItems = calendar.reduce((sum, day) => {
    return sum + Number(day.total || 0);
  }, 0);
  const achievedDays = calendar.reduce((sum, day) => {
    return sum + (day.achieved ? 1 : 0);
  }, 0);
  return {
    storeId: String(storeId || ''),
    year: Number(year),
    month: Number(month),
    totalDays: calendar.length,
    achievedDays: achievedDays,
    totalItems: totalItems,
    checkedByUserCounts: counts,
    calendar: calendar,
    updatedAt: FieldValue.serverTimestamp()
  };
}

exports.syncStatsFromSnapshot = onDocumentWritten(
  {
    document: 'stores/{storeId}/runs/{targetDate}/snapshots/today',
    region: 'asia-northeast1'
  },
  async (event) => {
    if (!event.data || !event.data.after.exists) {
      return;
    }

    const storeId = String(event.params.storeId || '');
    const targetDate = String(event.params.targetDate || '');
    assertValidTargetDate(targetDate);
    if (!storeId) {
      throw new Error('storeId is required');
    }

    const snapshotData = event.data.after.data() || {};
    const dailyStats = buildDailyStats(snapshotData, storeId, targetDate);
    const year = Number(targetDate.slice(0, 4));
    const month = Number(targetDate.slice(5, 7));
    const monthId = targetDate.slice(0, 7);

    const dailyDocRef = db.collection('stores').doc(storeId).collection('daily_stats').doc(targetDate);
    const monthlyDocRef = db.collection('stores').doc(storeId).collection('monthly_stats').doc(monthId);

    await db.runTransaction(async (transaction) => {
      const previousDailySnap = await transaction.get(dailyDocRef);
      const monthlySnap = await transaction.get(monthlyDocRef);
      const previousDaily = previousDailySnap.exists ? previousDailySnap.data() : null;
      const monthlyData = monthlySnap.exists ? monthlySnap.data() : {};

      const calendarMap = normalizeCalendarEntries(monthlyData.calendar);
      calendarMap[targetDate] = buildDayEntry(dailyStats);

      const checkedByUserCounts = normalizeMonthlyCounts(monthlyData.checkedByUserCounts);
      if (previousDaily && previousDaily.checkedByUserCounts) {
        applyCountDelta(checkedByUserCounts, previousDaily.checkedByUserCounts, -1);
      }
      applyCountDelta(checkedByUserCounts, dailyStats.checkedByUserCounts, 1);

      transaction.set(
        dailyDocRef,
        {
          storeId: dailyStats.storeId,
          date: dailyStats.date,
          runId: dailyStats.runId,
          total: dailyStats.total,
          checked: dailyStats.checked,
          achieved: dailyStats.achieved,
          checkedByUserCounts: dailyStats.checkedByUserCounts,
          items: dailyStats.items,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      transaction.set(
        monthlyDocRef,
        buildMonthlySummary(calendarMap, year, month, storeId, checkedByUserCounts),
        { merge: true }
      );
    });
  }
);
