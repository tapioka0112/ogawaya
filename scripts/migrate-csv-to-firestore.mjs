import { readFile } from 'node:fs/promises';
import { admin, getFirestore } from './firebaseAdmin.mjs';
import { requireStoreId } from './firestoreTasks.mjs';

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value !== '')) {
        rows.push(row);
      }
      row = [];
      field = '';
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((value) => value !== '')) {
    rows.push(row);
  }
  return rows;
}

async function readCsvObjects(path) {
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return [];
  }
  const headers = rows[0].map((header) => String(header || '').trim());
  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = String(row[index] || '').trim();
    });
    return item;
  });
}

async function readFirstExistingCsvObjectList(names) {
  for (const name of names) {
    const rows = await readCsvObjects(csvPath(name));
    if (rows.length > 0) {
      return {
        name,
        rows
      };
    }
  }
  return {
    name: names[0],
    rows: []
  };
}

function csvPath(name) {
  const baseDir = String(process.env.IMPORT_DIR || 'docs/operations/import').replace(/\/+$/, '');
  return `${baseDir}/${name}.csv`;
}

function pickSourceStore(stores, targetStoreId) {
  const explicitSourceStoreId = String(process.env.SOURCE_STORE_ID || '').trim();
  if (explicitSourceStoreId) {
    const source = stores.find((item) => item.id === explicitSourceStoreId);
    if (!source) {
      throw new Error(`stores.csv に SOURCE_STORE_ID=${explicitSourceStoreId} がありません`);
    }
    return source;
  }

  const direct = stores.find((item) => item.id === targetStoreId);
  if (direct) {
    return direct;
  }

  if (stores.length === 1) {
    return stores[0];
  }

  throw new Error(`stores.csv に STORE_ID=${targetStoreId} がありません。SOURCE_STORE_ID を指定してください`);
}

function belongsToSourceStore(item, sourceStoreId) {
  return (item.storeId || item.store_id) === sourceStoreId;
}

function isActive(item) {
  if (String(item.isActive || item.is_active || '').toLowerCase() === 'false') {
    return false;
  }
  return item.status !== 'inactive';
}

const storeId = requireStoreId();
const db = getFirestore();
const storeRef = db.collection('stores').doc(storeId);

const [stores, tasksResult, templatesResult, templateItemsResult, users] = await Promise.all([
  readCsvObjects(csvPath('stores')),
  readFirstExistingCsvObjectList(['tasks', 'checklist_items']),
  readFirstExistingCsvObjectList(['templates', 'checklist_templates']),
  readFirstExistingCsvObjectList(['template_items', 'checklist_template_items']),
  readCsvObjects(csvPath('users'))
]);

const sourceStore = pickSourceStore(stores, storeId);
const sourceStoreId = sourceStore.id;
const tasks = tasksResult.rows;
const templates = templatesResult.rows;
const templateItems = templateItemsResult.rows;

await storeRef.set({
  id: storeId,
  sourceStoreId,
  name: sourceStore.name,
  updatedAt: admin.firestore.FieldValue.serverTimestamp()
}, { merge: true });

for (const task of tasks.filter((item) => belongsToSourceStore(item, sourceStoreId))) {
  await storeRef.collection('tasks').doc(task.id).set({
    id: task.id,
    title: task.title,
    description: task.description || '',
    period: task.period || 'daily',
    sortOrder: Number(task.sortOrder || 0),
    isActive: isActive(task),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

for (const template of templates.filter((item) => belongsToSourceStore(item, sourceStoreId))) {
  await storeRef.collection('templates').doc(template.id).set({
    id: template.id,
    name: template.name,
    period: template.period || 'daily',
    notifyTime: template.notify_time || template.notifyTime || '',
    closingTime: template.closing_time || template.closingTime || '',
    isActive: isActive(template),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

for (const item of templateItems) {
  const templateId = item.templateId || item.template_id;
  if (!templateId || !templates.some((template) => template.id === templateId && belongsToSourceStore(template, sourceStoreId))) {
    continue;
  }
  await storeRef.collection('templates').doc(templateId).collection('items').doc(item.id).set({
    taskId: item.taskId || item.task_id || '',
    title: item.title || '',
    description: item.description || '',
    period: item.period || 'daily',
    sortOrder: Number(item.sortOrder || item.sort_order || 0),
    isRequired: String(item.is_required || item.isRequired || '').toLowerCase() === 'true',
    isActive: isActive(item),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

for (const user of users.filter((item) => belongsToSourceStore(item, sourceStoreId))) {
  if (user.role === 'admin') {
    await storeRef.collection('admins').doc(user.id).set({
      uid: user.id,
      displayName: user.displayName || user.name || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
}

console.log(JSON.stringify({
  ok: true,
  storeId,
  sourceStoreId,
  taskCsv: tasksResult.name,
  templateCsv: templatesResult.name,
  templateItemCsv: templateItemsResult.name,
  tasks: tasks.length,
  templates: templates.length,
  templateItems: templateItems.length,
  adminCandidates: users.filter((item) => belongsToSourceStore(item, sourceStoreId) && item.role === 'admin').length
}));
