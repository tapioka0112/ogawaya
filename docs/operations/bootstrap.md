# 初期データ投入と運用手順（GAS 主系）

この手順は `LIFF + GAS API + Spreadsheet` を主系として運用する前提です。
Firestore はチェック操作の高速反映とリアルタイム同期に利用します。

初期構築が終わった後の日々の運用は [non-technical-operations.md](./non-technical-operations.md) を参照してください。

## 1. Spreadsheet 初期シート

最短は、Apps Script エディタで `bootstrapSpreadsheetTemplates` を1回実行する方法です。
既存データがあるシートは fail-fast で停止し、上書きしません。

作られるシート:
- `stores`
- `users`
- `line_accounts`
- `notification_channels`
- `notification_recipients`
- `notification_channel_usage`
- `checklist_templates`
- `checklist_template_items`
- `checklist_runs`
- `checklist_run_items`
- `checklist_item_logs`
- `notifications`

手動作成する場合は [docs/operations/import/](./import/) の CSV を使用します。

## 2. Script Properties

必須:
- `SPREADSHEET_ID`
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01`
- `LIFF_ID`
- `CHECKLIST_APP_URL`
- `ADMIN_LOGIN_ID`
- `ADMIN_LOGIN_PASSWORD`

任意:
- `ALLOW_ANONYMOUS_ACCESS`（通常は `false` 推奨）
- `DEBUG_EVENT_SHEET_ENABLED`（通常 `false`）
- `SPREADSHEET_STATE_CACHE_ENABLED`（通常 `true`）
- `SPREADSHEET_STATE_CACHE_TTL_SECONDS`（通常 `300`）
- `SPREADSHEET_STATE_CACHE_CHUNK_SIZE`（通常 `90000`）
- `ADMIN_SESSION_TTL_SECONDS`（通常 `43200`）

通知用LINE公式アカウントを増やす場合は、`LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_02` のように連番で追加します。
追加したキー名は `notification_channels.access_token_property` に入れます。

テンプレートは [script-properties.example.json](./import/script-properties.example.json) を使用します。

## 3. デプロイ前チェック

1. `gas/.clasp.json` の `scriptId` が入っている
2. `gas/appsscript.json` に必要 scope がある
3. `npm test` が成功する

## 4. 初期データ

`bootstrapSpreadsheetTemplates` 実行後、最低限以下を実データに置換します。
- `stores`
- `checklist_templates`
- `checklist_template_items`

## 5. LIFF (GitHub Pages)

`pages/config.json` に以下を設定:
- `gasApiBaseUrl`
- `liffId`
- `defaultStoreId`
- `allowAnonymousAccess`
- `enableRealtimeSync`
- `clientFirestoreWriteEnabled`
- `consistencyRefreshSeconds`
- `firebase.apiKey`
- `firebase.authDomain`
- `firebase.projectId`
- `firebase.appId`

補足:
- `functionsApiBaseUrl` は空文字で運用可能です。
- `/api/link` は廃止済みです。

## 6. 管理者画面

`/admin.html` は `ADMIN_LOGIN_ID` / `ADMIN_LOGIN_PASSWORD` でログインします。
ログイン後、以下を実行できます。
- タスク作成
- タスク挿入
- テンプレート作成
- テンプレート読込
- 日付別タスク削除

## 7. Firestore Rules（リアルタイム同期を使う場合）

1. Firebase Authentication > Sign-in method で `Anonymous` を有効にする
2. Firestore Database > ルールを開く
3. [docs/operations/firestore.rules](./firestore.rules) を貼り付ける
4. 公開する

このルールは以下のみ許可します。
- `stores/{storeId}/runs/{targetDate}/events/*` の read
- `stores/{storeId}/runs/{targetDate}/events/*` の認証済み create
- `stores/{storeId}/runs/{targetDate}/snapshots/today` の read

上記以外の read/write は拒否します。

## 8. Trigger

GAS の時間主導トリガーを設定:
- `runDailyStart` を毎日 10:30
- `runDailyClosing` を毎日 0:00

0:30 未完了通知は手動で通常の日次トリガーを作りません。Apps Script エディタで `installReminderTriggers` を 1 回実行します。

作成されるトリガー:
- `runDailyIncompleteReminder`: 次回 0:30 JST の one-shot trigger
- `runReminderWatchdog`: 15分おきの漏れ補正 trigger

理由:
- Apps Script の通常の繰り返し時刻トリガーは実行時刻が揺れます。
- `nearMinute()` も指定分の前後15分で実行されます。
- そのため、この実装では毎回 `at(date)` で次の0:30を作り直し、watchdogで送信漏れを補正します。

## 9. 0:30 未完了通知の初期設定

1. 通知用LINE公式アカウントを作成する。
2. Messaging API を有効化し、長期チャネルアクセストークンを発行する。
3. Script Properties に `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01` として保存する。
4. `notification_channels` に以下の行を追加する。
   - `id`: `notify-01`
   - `store_id`: `stores.id`
   - `name`: 管理用の名前
   - `access_token_property`: `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01`
   - `monthly_limit`: `200`
   - `recipient_limit`: `6`
   - `status`: `active`
5. 従業員にLIFFを開いてもらう。
6. `notification_recipients` に従業員の `line_user_id` と `display_name` が入ったことを確認する。
7. Apps Script エディタで `rebalanceNotificationRecipients` を実行する。
8. `notification_recipients.channel_id` に `notify-01` などが入ったことを確認する。
9. Apps Script エディタで `installReminderTriggers` を実行する。

詳細な増員・退職・公式アカウント追加の手順は [line-notification-scaling.md](./line-notification-scaling.md) を参照してください。
