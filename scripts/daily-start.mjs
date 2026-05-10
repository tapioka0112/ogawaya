import {
  buildRunItemFromTask,
  ensureRun,
  getTodayInJst,
  listActiveTasks,
  listRunItems,
  requireStoreId,
  shouldCreateTaskForDate,
  writeRunItem
} from './firestoreTasks.mjs';

const storeId = requireStoreId();
const targetDate = String(process.env.TARGET_DATE || getTodayInJst()).trim();

if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  throw new Error(`TARGET_DATE の形式が不正です: ${targetDate}`);
}

await ensureRun(storeId, targetDate);

const tasks = (await listActiveTasks(storeId)).filter((task) => shouldCreateTaskForDate(task, targetDate));
const existingItems = await listRunItems(storeId, targetDate);
const existingTaskIds = new Set(existingItems.map((item) => String(item.id || '').replace(`${targetDate}-`, '')));

let createdCount = 0;
let sortOrder = existingItems.length + 1;

for (const task of tasks) {
  if (existingTaskIds.has(task.id)) {
    continue;
  }
  const item = buildRunItemFromTask(task, targetDate, sortOrder);
  await writeRunItem(storeId, targetDate, item);
  sortOrder += 1;
  createdCount += 1;
}

console.log(JSON.stringify({
  ok: true,
  storeId,
  targetDate,
  activeTaskCount: tasks.length,
  createdCount
}));
