# 初期データ投入と運用手順（GAS 主系）

この手順は `LIFF + GAS API + Spreadsheet` を主系として運用する前提です。
Firestore はリアルタイム同期（read-only）で利用します。

## 1. Spreadsheet 初期シート

最短は、Apps Script エディタで `bootstrapSpreadsheetTemplates` を1回実行する方法です。
既存データがあるシートは fail-fast で停止し、上書きしません。

作られるシート:
- `stores`
- `users`
- `line_accounts`
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
- `LIFF_ID`
- `ADMIN_LOGIN_ID`
- `ADMIN_LOGIN_PASSWORD`
- `LINE_WEBHOOK_TOKEN`

任意:
- `ALLOW_ANONYMOUS_ACCESS`（通常は `false` 推奨）
- `DEBUG_EVENT_SHEET_ENABLED`（通常 `false`）
- `SPREADSHEET_STATE_CACHE_ENABLED`（通常 `true`）
- `SPREADSHEET_STATE_CACHE_TTL_SECONDS`（通常 `300`）
- `SPREADSHEET_STATE_CACHE_CHUNK_SIZE`（通常 `90000`）
- `ADMIN_SESSION_TTL_SECONDS`（通常 `43200`）
- `LINE_REMINDER_SOURCE_IDS`（未完了一覧返信を許可する groupId / roomId。複数の場合はカンマ区切り）
- `LINE_REMINDER_TRIGGER_TEXT`（通常は `残りタスク通知`）
- `CHECKLIST_APP_URL`（通知本文に入れる GitHub Pages URL）

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

1. Firestore Database > ルールを開く
2. [docs/operations/firestore.rules](./firestore.rules) を貼り付ける
3. 公開する

このルールは以下のみ許可します。
- `stores/{storeId}/runs/{targetDate}/events/*` の read
- `stores/{storeId}/runs/{targetDate}/snapshots/today` の read

上記以外の read/write は拒否します。

## 8. Trigger

GAS の時間主導トリガーを設定:
- `runDailyStart` を毎日 10:30
- `runDailyClosing` を毎日 0:00

## 9. LINEカレンダー通知起点の未完了一覧返信

この機能は、LINEカレンダー通知がWebhookに届くかを最初に実測してから有効化します。

1. LINE Developers の Messaging API で Webhook を有効にする。
2. Bot のグループ参加を許可する。
3. Webhook URL を `GAS_WEB_APP_URL?path=webhook&token=<LINE_WEBHOOK_TOKEN>` にする。
4. `DEBUG_EVENT_SHEET_ENABLED=true` にして、テスト用グループへBotを追加する。
5. LINEカレンダーで1分後の予定を作り、予定名を `残りタスク通知` にする。
6. リマインダー発火後、`debug_events` の `webhook.message` に `sourceId` が出るか確認する。
7. `sourceId` が出たら、その値を `LINE_REMINDER_SOURCE_IDS` に設定する。
8. もう一度 `残りタスク通知` を発火させ、グループに未完了一覧が返信されることを確認する。

補足:
- 返信は Reply API を使うため、Push 通知枠は使いません。
- 同一営業日・同一 `sourceId` には二重返信しません。
- GAS Web App は LINE の `X-Line-Signature` ヘッダーを直接読めないため、GAS単体運用では静的 `token` を使います。
