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

function csvPath(name) {
  const baseDir = String(process.env.IMPORT_DIR || 'docs/operations/import').replace(/\/+$/, '');
  return `${baseDir}/${name}.csv`;
}

const storeId = requireStoreId();
const db = getFirestore();
const storeRef = db.collection('stores').doc(storeId);

const [stores, tasks, templates, templateItems, users] = await Promise.all([
  readCsvObjects(csvPath('stores')),
  readCsvObjects(csvPath('tasks')),
  readCsvObjects(csvPath('templates')),
  readCsvObjects(csvPath('template_items')),
  readCsvObjects(csvPath('users'))
]);

const store = stores.find((item) => item.id === storeId);
if (!store) {
  throw new Error(`stores.csv に STORE_ID=${storeId} がありません`);
}

await storeRef.set({
  id: storeId,
  name: store.name,
  updatedAt: admin.firestore.FieldValue.serverTimestamp()
}, { merge: true });

for (const task of tasks.filter((item) => (item.storeId || item.store_id) === storeId)) {
  await storeRef.collection('tasks').doc(task.id).set({
    id: task.id,
    title: task.title,
    description: task.description || '',
    period: task.period || 'daily',
    sortOrder: Number(task.sortOrder || 0),
    isActive: task.status !== 'inactive',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

for (const template of templates.filter((item) => (item.storeId || item.store_id) === storeId)) {
  await storeRef.collection('templates').doc(template.id).set({
    id: template.id,
    name: template.name,
    period: template.period || 'daily',
    isActive: template.status !== 'inactive',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

for (const item of templateItems.filter((row) => (row.storeId || row.store_id) === storeId)) {
  await storeRef.collection('templates').doc(item.templateId).collection('items').doc(item.id).set({
    taskId: item.taskId,
    sortOrder: Number(item.sortOrder || 0),
    isActive: item.status !== 'inactive',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

for (const user of users.filter((item) => (item.storeId || item.store_id) === storeId)) {
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
  tasks: tasks.length,
  templates: templates.length,
  templateItems: templateItems.length,
  adminCandidates: users.filter((item) => (item.storeId || item.store_id) === storeId && item.role === 'admin').length
}));
