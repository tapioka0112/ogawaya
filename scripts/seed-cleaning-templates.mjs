import { admin, getFirestore } from './firebaseAdmin.mjs';
import { requireStoreId } from './firestoreTasks.mjs';

const templates = [
  {
    id: 'cleaning-daily',
    name: '日間清掃チェックリスト',
    period: 'daily',
    items: [
      '厨房内床清掃',
      '餃子機',
      'コールドテーブル外壁',
      'タワータイプ冷蔵・冷凍庫外壁',
      '入口タイル清掃',
      'ゴミ拾い'
    ]
  },
  {
    id: 'cleaning-weekly',
    name: '週間清掃チェックリスト',
    period: 'weekly',
    items: [
      'バーナー・コンロの清掃（完全燃焼）',
      'グリトラ周辺・グリトラ内の掃除',
      '雑草処理',
      'エアコンフィルター・カバーの掃除',
      '厨房内機器のパッキン・フィルター',
      '厨房内外壁清掃',
      'タワータイプ冷凍・冷蔵庫の内側清掃',
      'コールドテーブルの内側清掃',
      '厨房ゴミ箱の掃除',
      '店舗内床の黒ずみ等の清掃'
    ]
  },
  {
    id: 'cleaning-monthly',
    name: '月間清掃チェックリスト',
    period: 'monthly',
    items: [
      '換気扇の清掃',
      '自販機 POP 等の汚れや剥がれの改善',
      '傘立ての清掃',
      '店舗天井の黒ずみ清掃・剥がれ等の改善'
    ]
  }
];

const storeId = requireStoreId();
const db = getFirestore();
const storeRef = db.collection('stores').doc(storeId);
const now = admin.firestore.FieldValue.serverTimestamp();

for (const template of templates) {
  const templateRef = storeRef.collection('templates').doc(template.id);
  await templateRef.set({
    id: template.id,
    name: template.name,
    period: template.period,
    isActive: true,
    updatedAt: now
  }, { merge: true });

  for (const [index, title] of template.items.entries()) {
    const sortOrder = index + 1;
    await templateRef.collection('items').doc(`${template.id}-item-${String(sortOrder).padStart(3, '0')}`).set({
      title,
      description: '',
      period: template.period,
      sortOrder,
      isRequired: true,
      isActive: true,
      updatedAt: now
    }, { merge: true });
  }
}

const sampleTemplateRef = storeRef.collection('templates').doc('tmpl-001');
const sampleTemplate = await sampleTemplateRef.get();
if (sampleTemplate.exists) {
  const sampleItems = await sampleTemplateRef.collection('items').get();
  const sampleTitles = sampleItems.docs.map((doc) => String((doc.data() || {}).title || '')).sort();
  if (sampleTitles.join('\n') === ['清掃確認', '開店準備'].sort().join('\n')) {
    await sampleTemplateRef.set({
      isActive: false,
      updatedAt: now
    }, { merge: true });
  }
}

console.log(JSON.stringify({
  ok: true,
  storeId,
  templates: templates.map((template) => ({
    id: template.id,
    period: template.period,
    itemCount: template.items.length
  }))
}));
