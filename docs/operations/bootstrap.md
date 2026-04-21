# 初期データ投入と運用手順

## 1. Spreadsheet 初期シート

以下のシート名を作成し、1行目にヘッダーを配置する。

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

そのまま import したい場合は [docs/operations/import/](/home/sota411/Documents/project/ogawaya/docs/operations/import) 配下の同名 CSV を使う。

## 2. Script Properties

最低限以下を設定する。

- `SPREADSHEET_ID`
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LIFF_ID`

コピペ用のテンプレートは [script-properties.example.json](/home/sota411/Documents/project/ogawaya/docs/operations/import/script-properties.example.json) を使う。

## 3. デプロイ前チェック

ローカルでは以下を確認する。

1. `gas/.clasp.json` の `scriptId` が入っている
2. `gas/appsscript.json` に以下 scope がある
   - `https://www.googleapis.com/auth/script.external_request`
   - `https://www.googleapis.com/auth/spreadsheets`
3. `npm test` が成功する

## 4. 初期データ

最低限以下を投入する。

1. `stores`
   - 店舗ID、名称、`status=active`
2. `users`
   - 所属店舗、社員コード、`passcode`、`role`、`status=active`
3. `checklist_templates`
   - 店舗ごとの有効テンプレート
4. `checklist_template_items`
   - テンプレートに紐づく日次項目

最短で始めるなら以下の順に import する。

1. `stores.csv`
2. `users.csv`
3. `checklist_templates.csv`
4. `checklist_template_items.csv`
5. 残りの CSV はヘッダーのみ import する

## 5. Webhook / LIFF

- `/api/link` は `idToken` をクエリに付け、本文は `employeeCode` と `passcode` のみ送る。
- Webhook 署名は GAS 入口では `signature` クエリとして受ける。直接 LINE から受ける場合は `X-Line-Signature` を転送するプロキシを用意する。

## 6. Trigger

以下の 2 本を作成する。

- `runDailyStart` を毎日 `10:30`
- `runDailyClosing` を毎日 `0:00`
