import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('GitHub Pages app は Firestore primary の起動順序で認証と初回取得を行う', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /await measureTiming\('liff\.auth',\s*'LIFF認証全体'/);
  assert.match(appJs, /state\.idToken = authContext\.idToken;/);
  assert.match(appJs, /state\.accessToken = authContext\.accessToken;/);
  assert.match(appJs, /await upsertCurrentUserProfile\(\);/);
  assert.match(appJs, /source:\s*'firestore\.primary'/);
  assert.match(appJs, /timingName:\s*'firestore\.today\.blocking'/);
  assert.doesNotMatch(appJs, /gasApiBaseUrl|functionsApiBaseUrl|requestLegacyGas|requestFunctionsApi/);
});

test('GitHub Pages app は Firestore run items をホーム表示の入力にする', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /async function getTodayChecklist\(\)/);
  assert.match(appJs, /function getChecklistTargetDateCandidates\(\)/);
  assert.match(appJs, /function getCalendarDateInJst\(\)/);
  assert.match(appJs, /function getWeekStartDateForDate\(dateValue\)/);
  assert.match(appJs, /function getMonthStartDateForDate\(dateValue\)/);
  assert.match(appJs, /async function loadChecklistForDate\(firebaseUser,\s*storeId,\s*store,\s*targetDate\)/);
  assert.match(appJs, /var candidates = getChecklistTargetDateCandidates\(\);/);
  assert.match(appJs, /var fallbackChecklist = null;/);
  assert.match(appJs, /var mergedItems = \[\];/);
  assert.match(appJs, /var checklistResults = await Promise\.all\(candidates\.map\(function \(candidate\)/);
  assert.match(appJs, /addDateCandidatePeriod\(candidates,\s*dateValue,\s*'daily'\);/);
  assert.match(appJs, /addDateCandidatePeriod\(candidates,\s*getWeekStartDateForDate\(dateValue\),\s*'weekly'\);/);
  assert.match(appJs, /addDateCandidatePeriod\(candidates,\s*getMonthStartDateForDate\(dateValue\),\s*'monthly'\);/);
  assert.match(appJs, /loadChecklistForDate\(firebaseUser,\s*storeId,\s*store,\s*candidate\.targetDate\)/);
  assert.match(appJs, /if \(!candidate\.periods\[normalizeTaskPeriod\(item\.period\)\]\) \{/);
  assert.match(appJs, /targetDate:\s*String\(targetDate \|\| ''\)/);
  assert.match(appJs, /return Object\.assign\(\{\},\s*fallbackChecklist,\s*\{\s*items:\s*mergedItems\s*\}\);/);
  assert.match(appJs, /\.collection\('stores'\)\.doc\(storeId\)\.collection\('runs'\)\.doc\(targetDate\)\.get\(\)/);
  assert.match(appJs, /\.collection\('items'\)\s*\.get\(\)/);
  assert.match(appJs, /if \(data\.isActive === false\) \{/);
  assert.match(appJs, /items\.sort\(function \(left,\s*right\)/);
  assert.match(appJs, /currentUser\.store\.name = String\(store\.name \|\| run\.storeName \|\| ''\);/);
});

test('GitHub Pages app はチェック操作を item 更新と realtime event の両方へ保存する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /async function updateItem\(runItemId,\s*status\)/);
  assert.match(appJs, /await itemRef\.set\(\{/);
  assert.match(appJs, /var targetDate = String\(item\.targetDate \|\| checklist\.targetDate \|\| getTodayDateInJst\(\)\);/);
  assert.match(appJs, /nextItem\.targetDate = targetDate;/);
  assert.match(appJs, /\.collection\('runs'\)\s*\.doc\(targetDate\)\s*\.collection\('events'\)/);
  assert.match(appJs, /function getRealtimeTargetInfos\(\)/);
  assert.match(appJs, /function isVisibleRunTargetDate\(targetDate\)/);
  assert.match(appJs, /targetInfos\.forEach\(bootstrapRealtimeEventsFromRest\);/);
  assert.match(appJs, /var unsubscribers = targetInfos\.map\(function \(targetInfo\)/);
  assert.match(appJs, /if \(!isVisibleRunTargetDate\(eventPayload\.targetDate\)\) \{/);
  assert.match(appJs, /checkedByUserId:\s*nextItem\.checkedByUserId \|\| ''/);
  assert.match(appJs, /await writeRealtimeEvent\(nextItem\);/);
  assert.match(appJs, /sourceUserId:\s*sourceUserId/);
  assert.match(appJs, /payload\.sourceClientId = getClientInstanceId\(\);/);
  assert.doesNotMatch(appJs, /syncItemStatusViaGas|GAS同期/);
});

test('GitHub Pages app は LIFF profile を Firestore user profile として保存する', async () => {
  const appJs = await readFile('pages/app.js', 'utf8');

  assert.match(appJs, /async function upsertCurrentUserProfile\(\)/);
  assert.match(appJs, /\.collection\('users'\)\s*\.doc\(firebaseUser\.uid\)/);
  assert.match(appJs, /uid:\s*firebaseUser\.uid/);
  assert.match(appJs, /liffUserId:\s*String\(authUser\.userId \|\| ''\)/);
  assert.match(appJs, /lastSeenAt:\s*global\.firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
});
