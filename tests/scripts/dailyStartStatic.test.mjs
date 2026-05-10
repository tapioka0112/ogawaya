import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('GitHub Actions daily-start は日間・週間・月間の対象日判定を使う', async () => {
  const taskHelpers = await readFile('scripts/firestoreTasks.mjs', 'utf8');
  const dailyStart = await readFile('scripts/daily-start.mjs', 'utf8');

  assert.match(taskHelpers, /function shouldCreateTaskForDate\(task,\s*targetDate\)/);
  assert.match(taskHelpers, /period === 'daily'/);
  assert.match(taskHelpers, /period === 'weekly'[\s\S]*date\.getUTCDay\(\) === 0/);
  assert.match(taskHelpers, /targetDate\.endsWith\('-01'\)/);
  assert.match(dailyStart, /filter\(\(task\) => shouldCreateTaskForDate\(task,\s*targetDate\)\)/);
});
