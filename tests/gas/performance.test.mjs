import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { loadGasRuntime } from '../helpers/gasHarness.mjs';
import { createBaseDataset } from '../helpers/fixtures.mjs';

test('today 取得は 2 秒以内、check は 1 秒以内', async () => {
  const runtime = await loadGasRuntime();
  const seed = createBaseDataset();
  seed.line_accounts = [
    {
      id: 'line-001',
      user_id: 'user-pt-001',
      line_user_id: 'line-user-001',
      display_name: '田中LINE',
      linked_at: '2026-04-20T00:00:00Z'
    }
  ];
  seed.checklist_runs = [
    {
      id: 'run-001',
      template_id: 'tmpl-001',
      store_id: 'store-001',
      target_date: '2026-04-21',
      status: 'open',
      notified_at: '2026-04-21T01:30:00Z',
      closed_at: '',
      created_at: '2026-04-21T01:30:00Z'
    }
  ];
  seed.checklist_run_items = Array.from({ length: 50 }, (_, index) => ({
    id: `run-item-${index + 1}`,
    run_id: 'run-001',
    template_item_id: `tmpl-item-${index + 1}`,
    title: `項目-${index + 1}`,
    sort_order: String(index + 1),
    status: 'unchecked',
    checked_by: '',
    checked_at: '',
    updated_at: '2026-04-21T01:30:00Z'
  }));

  const app = runtime.Ogawaya.createApplication({
    storage: runtime.Ogawaya.createArrayStorage(seed),
    identityClient: {
      verifyIdToken() {
        return { lineUserId: 'line-user-001', displayName: '田中LINE' };
      }
    },
    clock: {
      now() {
        return new Date('2026-04-21T02:00:00Z');
      },
      today() {
        return '2026-04-21';
      },
      yesterday() {
        return '2026-04-20';
      }
    }
  });

  const startToday = performance.now();
  app.handleApiRequest({
    method: 'GET',
    path: '/api/checklists/today',
    query: { idToken: 'valid-pt' },
    body: {}
  });
  const todayDuration = performance.now() - startToday;

  const startCheck = performance.now();
  app.handleApiRequest({
    method: 'POST',
    path: '/api/checklist-items/run-item-1/check',
    query: { idToken: 'valid-pt' },
    body: {
      comment: '確認済み'
    }
  });
  const checkDuration = performance.now() - startCheck;

  assert.ok(todayDuration < 2000, `today 取得が遅すぎます: ${todayDuration}ms`);
  assert.ok(checkDuration < 1000, `check 操作が遅すぎます: ${checkDuration}ms`);
});
