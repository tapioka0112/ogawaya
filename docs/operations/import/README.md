# import 用アセット

Spreadsheet は XML よりシート単位の CSV import のほうが速いため、このディレクトリに各シート用 CSV を置いています。

## 含まれるファイル

- `stores.csv`
- `users.csv`
- `line_accounts.csv`
- `checklist_templates.csv`
- `checklist_template_items.csv`
- `checklist_runs.csv`
- `checklist_run_items.csv`
- `checklist_item_logs.csv`
- `notifications.csv`
- `script-properties.example.json`

## 使い方

1. Google Spreadsheet を新規作成する。
2. CSV 名と同じ名前のシートを作る。
3. 各シートで対応する CSV を import する。
4. `line_accounts.csv` 以降の運用テーブルは、初期状態ではヘッダーのみでよい。
5. GAS の Script Properties は `script-properties.example.json` を開いて、実値へ置き換えてから Apps Script の UI へ入力する。

## 初期 import の順序

1. `stores.csv`
2. `users.csv`
3. `checklist_templates.csv`
4. `checklist_template_items.csv`
5. 残りの CSV はヘッダーだけ import する

## 置き換える必要がある値

- `SPREADSHEET_ID`
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LIFF_ID`
- `store-001` や `user-*-001` などのサンプル ID
- 店舗名、社員コード、パスコード、テンプレート名、項目名
