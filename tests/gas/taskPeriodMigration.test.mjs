import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

test('applyCurrentCleaningTaskPeriodTags は既存テンプレート項目と実行項目へ期間タグを付ける', async () => {
  const runtime = await loadGasRuntime();
  const seed = createBaseDataset();
  seed.checklist_template_items = [
    {
      id: 'tmpl-item-daily',
      template_id: 'tmpl-001',
      title: '厨房内床清掃',
      description: '',
      period: '',
      sort_order: '1',
      is_required: 'true',
      is_active: 'true',
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    },
    {
      id: 'tmpl-item-weekly',
      template_id: 'tmpl-001',
      title: '厨房内機器のパッキン・フィルター',
      description: '',
      period: '',
      sort_order: '2',
      is_required: 'true',
      is_active: 'true',
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    },
    {
      id: 'tmpl-item-monthly',
      template_id: 'tmpl-001',
      title: '自販機 POP 等の汚れや剥がれの改善',
      description: '',
      period: '',
      sort_order: '3',
      is_required: 'true',
      is_active: 'true',
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    },
    {
      id: 'tmpl-item-other',
      template_id: 'tmpl-001',
      title: '別タスク',
      description: '',
      period: '',
      sort_order: '4',
      is_required: 'true',
      is_active: 'true',
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    }
  ];
  seed.checklist_runs = [
    {
      id: 'run-001',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-25',
      status: 'open',
      notified_at: '2026-04-25T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-25T01:30:00Z'
    }
  ];
  seed.checklist_run_items = [
    {
      id: 'run-item-weekly',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-weekly',
      title: '厨房内機器のパッキン・フィルター',
      period: '',
      sort_order: '1',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-25T01:30:00Z'
    },
    {
      id: 'run-item-monthly',
      run_id: 'run-001',
      template_item_id: 'tmpl-item-monthly',
      title: '自販機 POP 等の汚れや剥がれの改善',
      period: '',
      sort_order: '2',
      status: 'unchecked',
      checked_by: '',
      checked_by_name: '',
      checked_at: '',
      updated_at: '2026-04-25T01:30:00Z'
    }
  ];

  const repository = runtime.Ogawaya.createSpreadsheetRepository({
    storage: runtime.Ogawaya.createArrayStorage(seed)
  });
  const result = runtime.Ogawaya.applyCurrentCleaningTaskPeriodTags({
    repository,
    now: new Date('2026-04-25T12:00:00Z')
  });

  const templatePeriodByTitle = Object.fromEntries(
    repository.listTable('checklist_template_items').map((item) => [item.title, item.period])
  );
  const runPeriodByTitle = Object.fromEntries(
    repository.listTable('checklist_run_items').map((item) => [item.title, item.period])
  );
  assert.equal(templatePeriodByTitle['厨房内床清掃'], 'daily');
  assert.equal(templatePeriodByTitle['厨房内機器のパッキン・フィルター'], 'weekly');
  assert.equal(templatePeriodByTitle['自販機 POP 等の汚れや剥がれの改善'], 'monthly');
  assert.equal(templatePeriodByTitle['別タスク'], '');
  assert.equal(runPeriodByTitle['厨房内機器のパッキン・フィルター'], 'weekly');
  assert.equal(runPeriodByTitle['自販機 POP 等の汚れや剥がれの改善'], 'monthly');
  assert.equal(result.templateChangedCount, 3);
  assert.equal(result.runChangedCount, 2);
  assert.ok(result.unmatchedRuleTitles.includes('換気扇の清掃'));
});

test('normalizeTaskTitleForPeriodMigration は空白や改行違いを同一タイトルとして扱う', async () => {
  const runtime = await loadGasRuntime();

  assert.equal(
    runtime.Ogawaya.normalizeTaskTitleForPeriodMigration('厨房内機器のパッキン・フィル\nター'),
    runtime.Ogawaya.normalizeTaskTitleForPeriodMigration('厨房内機器のパッキン・フィルター')
  );
});
