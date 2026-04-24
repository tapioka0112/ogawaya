
# LINE公式アカウント分散通知 運用手順

## 目的

毎日0:30に「今日の残りタスク」を自動通知する。  
LINE公式アカウント1つあたり月200通の無料枠を超えないように、従業員を複数アカウントへ分散する。

根拠:
- LINE Developers Pricing: 日本のCommunication Planは月200通まで無料。
- LINE Developers Pricing: Push messages は通数カウント対象。
- Apps Script Installable Triggers: 繰り返し時刻トリガーは実行時刻が少しランダム化される。
- Apps Script ClockTriggerBuilder: `nearMinute()` は指定分の前後15分で実行される。

## 使うシート

- `notification_channels`: 通知用LINE公式アカウントの一覧。
- `notification_recipients`: 通知を受ける従業員の一覧。
- `notification_channel_usage`: チャネルごとの月間送信数と残数。
- `notifications`: 実際に送った通知ログ。

## 公式アカウントを新規追加する

1. LINE Official Account Manager で新しい公式アカウントを作成する。
2. LINE Developers で同じ Provider 配下に Messaging API チャネルを作る。
3. Messaging API の長期チャネルアクセストークンを発行する。
4. Apps Script の Script Properties に追加する。
   - 1個目: `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01`
   - 2個目: `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_02`
   - 3個目: `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_03`
5. Spreadsheet の `notification_channels` に1行追加する。

例:

```csv
id,store_id,name,access_token_property,monthly_limit,recipient_limit,status,created_at,updated_at
notify-01,store-hashimoto,通知アカウント1,LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01,200,6,active,2026-04-24T00:00:00Z,2026-04-24T00:00:00Z
```

## 従業員を追加する

1. 従業員に `https://liff.line.me/<LIFF_ID>` をLINEから開いてもらう。
2. `notification_recipients` にその人の `line_user_id` と `display_name` が入る。
3. 追加した従業員に、割り当て予定の公式アカウントを友だち追加してもらう。
4. Apps Script エディタで `rebalanceNotificationRecipients` を実行する。
5. `notification_recipients.channel_id` に `notify-01` などが入ったことを確認する。

## 従業員を外す

1. `notification_recipients` で対象者の `status` を `inactive` にする。
2. Apps Script エディタで `rebalanceNotificationRecipients` を実行する。
3. 必要なら、その人をLINE公式アカウントの運用グループから外す。

## 公式アカウントを止める

1. `notification_channels` で対象アカウントの `status` を `inactive` にする。
2. Apps Script エディタで `rebalanceNotificationRecipients` を実行する。
3. `notification_recipients.channel_id` に inactive な channel が残っていないことを確認する。

## 月間送信数を見る

`notification_channel_usage` を見る。

- `local_sent_count`: このアプリが今月送信成功として記録した数。
- `remaining_count`: `monthly_limit - local_sent_count`。
- `last_synced_at`: usage行を更新した時刻。

このアプリ以外から同じ公式アカウントでPush配信した場合、`local_sent_count` には含まれません。  
その運用は禁止です。確認が必要なときは LINE Official Account Manager 側の利用状況も見ます。

## 0:30通知を有効化する

Apps Script エディタで `installReminderTriggers` を1回実行する。

作成されるもの:
- `runDailyIncompleteReminder`: 次回0:30 JSTに1回だけ動く。
- `runReminderWatchdog`: 15分おきに動き、0:30〜1:30 JSTの間だけ送信漏れを補正する。

`runDailyIncompleteReminder` は実行後に次回0:30のトリガーを作り直します。

## 0:30通知の送信条件

- 対象日は `10:30〜翌10:29` の運用日。
- 未完了タスクが0件なら送らない。
- `notification_recipients.channel_id` が空の人がいる場合は送らずに失敗する。
- 1チャネルあたり `recipient_limit` を超えている場合は送らずに失敗する。
- 同じ運用日・同じ従業員には二重送信しない。

## 人数の目安

月200通、毎日1通通知する前提では、1アカウントあたり6人までにします。

計算:
- 6人 x 31日 = 186通
- 7人 x 31日 = 217通

7人以上なら公式アカウントを追加します。

## 失敗時に見る場所

1. Apps Script の実行ログ。
2. `notifications` の `status` / `error_message`。
3. `notification_channel_usage` の `remaining_count`。
4. `notification_recipients.channel_id` の空欄。
5. `notification_channels.status` が `active` か。
6. Script Properties に `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_XX` があるか。

## 公式ドキュメント

- LINE Messaging API pricing: https://developers.line.biz/en/docs/messaging-api/pricing/
- Apps Script installable triggers: https://developers.google.com/apps-script/guides/triggers/installable
- Apps Script ClockTriggerBuilder: https://developers.google.com/apps-script/reference/script/clock-trigger-builder
