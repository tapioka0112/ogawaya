# import 用アセット

最短は Apps Script エディタから `bootstrapSpreadsheetTemplates` を 1 回実行して、12 シートのヘッダーと最小サンプル行をまとめて入れる方法です。CSV import は手動 fallback として、このディレクトリに残しています。

## 含まれるファイル

- `stores.csv`
- `users.csv`
- `line_accounts.csv`
- `notification_channels.csv`
- `notification_recipients.csv`
- `notification_channel_usage.csv`
- `checklist_templates.csv`
- `checklist_template_items.csv`
- `checklist_runs.csv`
- `checklist_run_items.csv`
- `checklist_item_logs.csv`
- `notifications.csv`
- `script-properties.example.json`

## 使い方

1. Google Spreadsheet を新規作成し、ID を控える。
2. GAS の Script Properties に `SPREADSHEET_ID` だけ先に設定する。
3. Apps Script エディタで `bootstrapSpreadsheetTemplates` を 1 回実行する。
4. 実行後に `stores` `checklist_templates` `checklist_template_items` のサンプル行を実データへ置き換える。
5. 残りの Script Properties は `script-properties.example.json` を開いて、実値へ置き換えてから Apps Script の UI へ入力する。

## 一括初期化の注意

- `bootstrapSpreadsheetTemplates` は、対象シートが空、またはヘッダーのみのときだけ実行できる。
- `stores` `checklist_templates` `checklist_template_items` には最小サンプル行が入る。
- 既存データがあるシートでは fail-fast で停止し、上書きしない。

## 手動 fallback

Apps Script をまだ実行できない場合は、従来どおり CSV を手で import する。

## 手動 import の順序

1. `stores.csv`
2. `checklist_templates.csv`
3. `checklist_template_items.csv`
4. 残りの CSV はヘッダーだけ import する

## 置き換える必要がある値

- `SPREADSHEET_ID`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01`
- `LIFF_ID`
- `CHECKLIST_APP_URL`
- `ADMIN_LOGIN_ID`
- `ADMIN_LOGIN_PASSWORD`
- `store-001` や `user-*-001` などのサンプル ID
- 店舗名、テンプレート名、項目名

## 0:30 未完了通知の追加設定

1. `notification_channels` に通知用LINE公式アカウントを追加する。
2. `access_token_property` には `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01` のように Script Properties のキー名を入れる。
3. 従業員がLIFFを開くと `notification_recipients` にLINE userIdが登録される。
4. Apps Script エディタで `rebalanceNotificationRecipients` を実行し、従業員を通知チャネルへ割り当てる。
5. `notification_channel_usage` でチャネルごとの月間送信数と残数を確認する。
