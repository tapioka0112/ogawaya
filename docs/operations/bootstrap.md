# 初期データ投入と運用手順

## 1. Spreadsheet 初期シート

最短は、Apps Script エディタで `bootstrapSpreadsheetTemplates` を 1 回実行して、以下のシートと最小サンプル行をまとめて作る方法です。

対象シートに既存データがある場合は fail-fast で停止し、上書きしません。

作られるシート名は以下のとおりです。

- `stores`
- `users`
- `line_accounts`
- `checklist_templates`
- `checklist_template_items`
- `checklist_runs`
- `checklist_run_items`
- `checklist_item_logs`
- `notifications`

手動で作りたい場合は [docs/operations/import/](./import/) 配下の同名 CSV を使う。

## 2. Script Properties

最低限以下を設定する。

- `SPREADSHEET_ID`
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LIFF_ID`
- `ALLOW_ANONYMOUS_ACCESS`（`true` は閲覧フォールバックのみ。更新系は `idToken` 必須）
- `DEBUG_EVENT_SHEET_ENABLED`（通常運用は `false` 推奨、調査時のみ `true`）
- `SPREADSHEET_STATE_CACHE_ENABLED`（通常運用は `true` 推奨）
- `SPREADSHEET_STATE_CACHE_TTL_SECONDS`（通常運用は `300`）
- `SPREADSHEET_STATE_CACHE_CHUNK_SIZE`（通常運用は `90000`）

コピペ用のテンプレートは [script-properties.example.json](./import/script-properties.example.json) を使う。

Spreadsheet 初期シートだけ先に作るなら、まず `SPREADSHEET_ID` を設定してから `bootstrapSpreadsheetTemplates` を実行し、その後に残りの Script Properties を埋める。

パフォーマンス確認は、Apps Script 実行ログの `api.request.success` / `api.request.failed` の `durationMs` を見る。

## 3. デプロイ前チェック

ローカルでは以下を確認する。

1. `gas/.clasp.json` の `scriptId` が入っている
2. `gas/appsscript.json` に以下 scope がある
   - `https://www.googleapis.com/auth/script.external_request`
   - `https://www.googleapis.com/auth/spreadsheets`
3. `npm test` が成功する

## 4. 初期データ

`bootstrapSpreadsheetTemplates` 実行後は、最低限以下を実データへ置き換える。

1. `stores`
   - 店舗ID、名称、`status=active`
2. `checklist_templates`
   - 店舗ごとの有効テンプレート
3. `checklist_template_items`
   - テンプレートに紐づく日次項目

Apps Script をまだ実行できず、手動 import を使う場合は以下の順に入れる。

1. `stores.csv`
2. `checklist_templates.csv`
3. `checklist_template_items.csv`
4. 残りの CSV はヘッダーのみ import する

## 5. LIFF

- LIFF 画面は GitHub Pages の `pages/` を公開して利用する（`https://<user>.github.io/<repo>/`）。
- `pages/config.json` に以下を設定する。
  - `gasApiBaseUrl`: GAS WebアプリURL（`.../exec`）
  - `liffId`: LIFF ID（`1234567890-xxxxxxx`）
  - `enableRealtimeSync`: `true`（リアルタイム同期を使う場合）
  - `consistencyRefreshSeconds`: `30`（推奨）
  - `firebase.apiKey` / `firebase.authDomain` / `firebase.projectId` / `firebase.appId`
- 更新系APIは `idToken` 必須。LIFF認証が通らない場合はチェック更新できない。
- `/api/link` は廃止済み（`410`）。LINE 連携フォームは使用しない。
- 現行運用は `LIFF + API + Trigger` を前提とし、LINE Developers の `Use webhook` は `OFF` にする。
- Firestore は同期イベント専用で、正本データは従来どおり Spreadsheet を使用する。

## 5.5 Firestore Rules（リアルタイム同期を使う場合のみ）

1. Firebase Console で `Firestore Database > ルール` を開く。
2. [docs/operations/firestore.rules](./firestore.rules) の内容をそのまま貼る。
3. 公開ボタンで反映する。

このルールは以下の挙動になる。

- 許可: `stores/{storeId}/runs/{targetDate}/events/*` の `read` と `create`
- 禁止: 上記以外の全パス（`read/write`）
- 禁止: `events` の `update/delete`

## 6. Trigger

以下の 2 本を作成する。

- `runDailyStart` を毎日 `10:30`
- `runDailyClosing` を毎日 `0:00`

## 7. 任意: Webhook

Webhook を将来使う場合のみ有効化する。

- GAS 入口は `signature` クエリ受け取り前提。
- 直接 LINE から受ける場合は `X-Line-Signature` を `signature` クエリへ転送する受信経路を用意する。
