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

`users` シートは `/api/link` に必要なため、`passcode` 列を含める。

手動で作りたい場合は [docs/operations/import/](./import/) 配下の同名 CSV を使う。

## 2. Script Properties

最低限以下を設定する。

- `SPREADSHEET_ID`
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LIFF_ID`
- `ALLOW_ANONYMOUS_ACCESS`（MVP は `true` 推奨）
- `DEBUG_EVENT_SHEET_ENABLED`（通常運用は `false` 推奨、調査時のみ `true`）
- `SPREADSHEET_STATE_CACHE_ENABLED`（通常運用は `true` 推奨）
- `SPREADSHEET_STATE_CACHE_TTL_SECONDS`（通常運用は `30`）

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
2. `users`
   - 所属店舗、社員コード、`passcode`、`role`、`status=active`
3. `checklist_templates`
   - 店舗ごとの有効テンプレート
4. `checklist_template_items`
   - テンプレートに紐づく日次項目

Apps Script をまだ実行できず、手動 import を使う場合は以下の順に入れる。

1. `stores.csv`
2. `users.csv`
3. `checklist_templates.csv`
4. `checklist_template_items.csv`
5. 残りの CSV はヘッダーのみ import する

## 5. LIFF

- `ALLOW_ANONYMOUS_ACCESS=true` の場合、LIFF 認証はスキップして画面を直接利用する。
- `ALLOW_ANONYMOUS_ACCESS=false` の場合のみ、`/api/link` は `idToken` をクエリに付け、本文は `employeeCode` と `passcode` のみ送る。
- 現行運用は `LIFF + API + Trigger` を前提とし、LINE Developers の `Use webhook` は `OFF` にする。

## 6. Trigger

以下の 2 本を作成する。

- `runDailyStart` を毎日 `10:30`
- `runDailyClosing` を毎日 `0:00`

## 7. 任意: Webhook

Webhook を将来使う場合のみ有効化する。

- GAS 入口は `signature` クエリ受け取り前提。
- 直接 LINE から受ける場合は `X-Line-Signature` を `signature` クエリへ転送する受信経路を用意する。
