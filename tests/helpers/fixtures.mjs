export function createBaseDataset() {
  return {
    stores: [
      {
        id: 'store-001',
        name: '青山店',
        status: 'active',
        created_at: '2026-04-20T00:00:00Z'
      }
    ],
    users: [
      {
        id: 'user-pt-001',
        store_id: 'store-001',
        name: '田中 花子',
        employee_code: 'PT001',
        passcode: '111111',
        role: 'part_time',
        status: 'active',
        created_at: '2026-04-20T00:00:00Z'
      },
      {
        id: 'user-mg-001',
        store_id: 'store-001',
        name: '山田 太郎',
        employee_code: 'MG001',
        passcode: '222222',
        role: 'manager',
        status: 'active',
        created_at: '2026-04-20T00:00:00Z'
      },
      {
        id: 'user-ad-001',
        store_id: 'store-001',
        name: '本部 次郎',
        employee_code: 'AD001',
        passcode: '333333',
        role: 'admin',
        status: 'active',
        created_at: '2026-04-20T00:00:00Z'
      }
    ],
    line_accounts: [],
    checklist_templates: [
      {
        id: 'tmpl-001',
        store_id: 'store-001',
        name: '日次チェックリスト',
        notify_time: '10:30',
        closing_time: '00:00',
        is_active: 'true',
        created_by: 'user-mg-001',
        created_at: '2026-04-20T00:00:00Z',
        updated_at: '2026-04-20T00:00:00Z'
      }
    ],
    checklist_template_items: [
      {
        id: 'tmpl-item-001',
        template_id: 'tmpl-001',
        title: '開店準備',
        description: '',
        sort_order: '1',
        is_required: 'true',
        is_active: 'true',
        created_at: '2026-04-20T00:00:00Z',
        updated_at: '2026-04-20T00:00:00Z'
      },
      {
        id: 'tmpl-item-002',
        template_id: 'tmpl-001',
        title: '清掃確認',
        description: '',
        sort_order: '2',
        is_required: 'true',
        is_active: 'true',
        created_at: '2026-04-20T00:00:00Z',
        updated_at: '2026-04-20T00:00:00Z'
      }
    ],
    checklist_runs: [],
    checklist_run_items: [],
    checklist_item_logs: [],
    notifications: []
  };
}
