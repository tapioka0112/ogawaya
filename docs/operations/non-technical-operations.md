# おがわやチェックリスト 非IT担当者向け運用手順書

## まず読むところ

この手順書は、プログラムを書かない人が毎日の運用をするためのものです。  
「どの画面を開くか」「何を押すか」「どこを確認するか」だけを順番に書いています。

このシステムで使う画面は主に3つです。

| 使うもの | 何をする場所か | 普段触る人 |
| --- | --- | --- |
| LINEのチェックリスト画面 | 従業員が今日のタスクをチェックする | 全員 |
| 管理者画面 | タスクを作る、日付に追加する、テンプレートを入れる | 店長、管理者 |
| Googleスプレッドシート | データ確認、通知設定、緊急時の確認 | 運用担当者 |

このシステムの基本ルールです。

| 項目 | 内容 |
| --- | --- |
| 1日の切替 | 日本時間 `10:30`。`10:30〜翌10:29` が同じ営業日です。 |
| 今日のタスク | 毎日 `10:30` に自動で作られます。 |
| 残りタスク通知 | 毎日 `0:30` に未完了タスクがある人へ送ります。 |
| チェックした人 | LINEの表示名で記録されます。 |
| データの正本 | Googleスプレッドシートです。 |
| 画面の同期 | Firestoreを使って、開いている画面へ反映します。 |

## 最初にブックマークするもの

以下のURLは、実際の運用担当者が自分の環境のURLに置き換えて管理してください。

| 名前 | URL |
| --- | --- |
| 従業員用LINE画面 | `https://liff.line.me/<LIFF_ID>` |
| Web画面 | `https://tapioka0112.github.io/ogawaya/` |
| 管理者画面 | `https://tapioka0112.github.io/ogawaya/admin.html` |
| Googleスプレッドシート | 運用中のSpreadsheet URL |
| Apps Script | 運用中のApps Script URL |
| Firebase Console | 運用中のFirebaseプロジェクトURL |
| LINE Official Account Manager | https://manager.line.biz/ |
| LINE Developers | https://developers.line.biz/console/ |

## Apps Scriptで関数を実行する方法

この手順書では、何度か「Apps Scriptで `関数名` を実行する」と書いています。  
その場合は、以下の通りに操作します。

1. ブックマークしているApps Scriptを開く。
2. 画面上部の関数選択欄を押す。
3. 実行したい関数名を選ぶ。
4. 「実行」を押す。
5. 初回だけ権限確認が出るので、運用アカウントで許可する。
6. 実行ログが「完了」になったことを確認する。

よく使う関数です。

| 関数名 | いつ使うか |
| --- | --- |
| `runDailyStart` | 今日のタスクが作られていないとき |
| `rebalanceNotificationRecipients` | 従業員や通知アカウントを増減した後 |
| `syncNotificationChannelUsage` | 通知数を今すぐ更新したいとき |
| `installReminderTriggers` | 0:30通知トリガーを作り直したいとき |

## 毎日やること

従業員がやることです。

1. LINEのリッチメニューを開く。
2. 「チェックリストを表示する」を押す。
3. 今日のタスクを確認する。
4. 終わったタスクにチェックを入れる。
5. 間違えてチェックした場合は、もう一度押して取り消す。
6. 統計タブで自分のチェック数を確認する。

管理者が見ることです。

1. 営業中にチェックリスト画面を開く。
2. 未完了のタスクが残っていないか確認する。
3. 必要なタスクが足りない場合は、管理者画面から追加する。
4. 深夜 `0:30` の残りタスク通知後に、まだ残っているタスクがないか確認する。

## 管理者画面の使い方

管理者画面は、タスクを追加・削除するための画面です。

ログイン手順です。

1. `https://tapioka0112.github.io/ogawaya/admin.html` を開く。
2. 管理者IDを入力する。
3. 管理者パスワードを入力する。
4. 「ログイン」を押す。

ログインできない場合は、Apps ScriptのScript Propertiesにある `ADMIN_LOGIN_ID` と `ADMIN_LOGIN_PASSWORD` を確認します。

## タスクを新しく作る

「タスクを作る」は、あとで日付に追加できるタスクの部品を作る操作です。  
作っただけでは、その日のチェックリストには入りません。

1. 管理者画面を開く。
2. 「タスク名」に名前を入れる。
3. 「詳細」に説明を入れる。
4. 「タスクを作成」を押す。
5. タスク一覧に増えたことを確認する。

例です。

| 入力欄 | 例 |
| --- | --- |
| タスク名 | 店内清掃 |
| 詳細 | テーブル、床、券売機周りを確認する |

## 作ったタスクを指定日に入れる

「タスクを挿入」は、作成済みタスクを選んだ日付のチェックリストに追加する操作です。

1. 管理者画面のカレンダーで日付を選ぶ。
2. 「タスクを挿入」を押す。
3. 追加したいタスクを選ぶ。
4. 挿入する。
5. 「タスクの管理」に表示されたことを確認する。

## いらないタスクを消す

日付に入っているタスクを消す操作です。  
タスクの部品自体を完全削除する操作ではありません。

1. 管理者画面のカレンダーで日付を選ぶ。
2. 「タスクの管理」を見る。
3. 消したいタスクの右側にある削除ボタンを押す。
4. 表示から消えたことを確認する。

## テンプレートを作る

テンプレートは、複数のタスクをまとめて一括追加するためのセットです。

1. 管理者画面を開く。
2. 「テンプレートを作成」を押す。
3. テンプレート名を入れる。
4. 含めたいタスクを複数選ぶ。
5. 保存する。
6. テンプレート一覧に増えたことを確認する。

例です。

| テンプレート名 | 入れるタスク |
| --- | --- |
| 開店前チェック | 材料補充、水回り確認、券売機確認 |
| 閉店前チェック | 清掃、在庫確認、戸締まり |

## テンプレートを指定日に入れる

「テンプレートを挿入」は、テンプレート内のタスクを選んだ日付へまとめて追加する操作です。

1. 管理者画面のカレンダーで日付を選ぶ。
2. 「テンプレートを挿入」を押す。
3. 使いたいテンプレートを選ぶ。
4. 挿入する。
5. 「タスクの管理」に複数タスクが追加されたことを確認する。

## 従業員を追加する

従業員を追加するときは、本人のLINEで一度チェックリストを開いてもらいます。  
これでシステムがLINEのユーザーIDと表示名を覚えます。

1. 従業員にLINE公式アカウントを友だち追加してもらう。
2. 従業員に `https://liff.line.me/<LIFF_ID>` をLINEアプリ内で開いてもらう。
3. Googleスプレッドシートの `notification_recipients` を開く。
4. 従業員のLINE表示名が増えていることを確認する。
5. Apps Scriptで `rebalanceNotificationRecipients` を実行する。
6. `notification_recipients` の `channel_id` に `notify-01` などが入ったことを確認する。

`channel_id` が空のままだと、`0:30` の残りタスク通知は送れません。

## 従業員を外す

退職や通知不要になった人を外す手順です。

1. Googleスプレッドシートの `notification_recipients` を開く。
2. 対象者の `status` を `inactive` にする。
3. Apps Scriptで `rebalanceNotificationRecipients` を実行する。
4. 必要ならLINE公式アカウント側でも友だち・グループの整理をする。

行を削除するのではなく、`status` を `inactive` にしてください。  
削除すると、過去の通知や確認で誰だったか分かりにくくなります。

## 通知用LINE公式アカウントを増やす

残りタスク通知は、LINE公式アカウントの無料通数を超えないように分散します。  
日本のLINE公式アカウント料金例では、コミュニケーションプランの無料メッセージ通数は月200通です。

1アカウントあたりの人数目安です。

| 人数 | 31日送った場合 | 判定 |
| --- | ---: | --- |
| 6人 | 186通 | 安全 |
| 7人 | 217通 | 超過 |

増設手順です。

1. LINE Official Account Managerで新しい公式アカウントを作る。
2. LINE DevelopersでMessaging APIを有効にする。
3. 長期チャネルアクセストークンを発行する。
4. Apps ScriptのScript Propertiesに `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_02` のような名前で保存する。
5. Googleスプレッドシートの `notification_channels` に1行追加する。
6. 追加した公式アカウントを、通知を受ける従業員に友だち追加してもらう。
7. Apps Scriptで `rebalanceNotificationRecipients` を実行する。
8. `notification_recipients.channel_id` の割当が更新されたことを確認する。

`notification_channels` に入れる例です。

| 列 | 入れる値の例 |
| --- | --- |
| `id` | `notify-02` |
| `store_id` | `store-hashimoto` |
| `name` | `通知アカウント2` |
| `access_token_property` | `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_02` |
| `monthly_limit` | `200` |
| `recipient_limit` | `6` |
| `status` | `active` |
| `created_at` | `2026-04-24T00:00:00Z` |
| `updated_at` | `2026-04-24T00:00:00Z` |

## 送信数を確認する

Googleスプレッドシートの `notification_channel_usage` を見ます。

| 列 | 意味 |
| --- | --- |
| `channel_id` | どの通知アカウントか |
| `year_month` | 対象月 |
| `monthly_limit` | 月の上限 |
| `local_sent_count` | このシステムが送った数 |
| `remaining_count` | 残り送信可能数 |
| `last_synced_at` | 最後に更新された時刻 |

送信数を今すぐ更新したい場合は、Apps Scriptで `syncNotificationChannelUsage` を実行します。

## 自動処理の確認

Apps Scriptの「トリガー」画面で確認します。

必要なトリガーです。

| 関数名 | 役割 |
| --- | --- |
| `runDailyStart` | 毎日10:30に今日のタスクを作る |
| `runDailyClosing` | 毎日0:00に自動確認処理をする |
| `runDailyIncompleteReminder` | 次回0:30に残りタスク通知を送る |
| `runReminderWatchdog` | 送信漏れを15分おきに補正する |

`runDailyIncompleteReminder` は毎日作り直される1回限りのトリガーです。  
見当たらない場合は、Apps Scriptで `installReminderTriggers` を1回実行してください。

## Googleスプレッドシートで触ってよい場所

基本は管理者画面を使います。  
スプレッドシートを直接編集するのは、通知設定や緊急修正のときだけです。

触ってよいシートです。

| シート | 何をするか |
| --- | --- |
| `stores` | 店舗名の確認 |
| `notification_channels` | 通知用LINE公式アカウントの追加・停止 |
| `notification_recipients` | 従業員の通知対象化・停止 |
| `notification_channel_usage` | 月間送信数の確認 |

通常は触らないシートです。

| シート | 理由 |
| --- | --- |
| `checklist_runs` | 毎日のチェックリスト本体です。手で壊すと当日の画面が崩れます。 |
| `checklist_run_items` | チェック状態の本体です。手で壊すとチェック済み状態が崩れます。 |
| `checklist_item_logs` | 過去の操作記録です。 |
| `notifications` | 通知ログです。 |
| `line_accounts` | 旧連携用です。通常は使いません。 |
| `users` | 旧ユーザー管理用です。通常は使いません。 |

タスク追加や削除は、できるだけ管理者画面から行ってください。

## よくあるトラブル

### チェックリストが表示されない

確認することです。

1. LINEアプリ内で `https://liff.line.me/<LIFF_ID>` を開いているか確認する。
2. Googleスプレッドシートの `checklist_runs` に今日の行があるか確認する。
3. 行がなければ、Apps Scriptで `runDailyStart` を実行する。
4. `checklist_template_items` に有効なタスクがあるか確認する。

### チェックした人が正しく表示されない

確認することです。

1. LINEアプリから開いているか確認する。
2. ブラウザだけで開いていないか確認する。
3. LIFFの権限で `openid` と `profile` が有効か確認する。
4. もう一度LINEから開き直す。

### 管理者画面にログインできない

確認することです。

1. Apps ScriptのScript Propertiesを開く。
2. `ADMIN_LOGIN_ID` が正しいか確認する。
3. `ADMIN_LOGIN_PASSWORD` が正しいか確認する。
4. 前後に余計な空白がないか確認する。

### 0:30の通知が届かない

確認することです。

1. `notification_recipients` に対象者がいるか確認する。
2. 対象者の `status` が `active` か確認する。
3. 対象者の `channel_id` が空ではないか確認する。
4. `notification_channels` の `status` が `active` か確認する。
5. Script Propertiesに `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01` などがあるか確認する。
6. Apps Scriptの実行ログで `runDailyIncompleteReminder` の失敗を確認する。
7. `notifications` の `status` と `error_message` を確認する。
8. `installReminderTriggers` を1回実行し直す。

### 画面が古いまま変わらない

確認することです。

1. スマホのLINE画面を閉じて開き直す。
2. それでも変わらない場合は、GitHub Actionsの `Deploy LIFF Pages` が成功しているか確認する。
3. 失敗している場合は、開発者に連絡する。

### Firebase設定エラーが出る

確認することです。

1. Firebase Consoleを開く。
2. Firestore Databaseが作成済みか確認する。
3. Firebase Authenticationの匿名ログインが有効か確認する。
4. Firestore Rulesに `docs/operations/firestore.rules` の内容が公開されているか確認する。
5. `pages/config.json` のFirebase設定が現在のFirebaseプロジェクトと一致しているか開発者に確認する。

## 触らない方がよいもの

以下は、分からない状態で触るとシステム全体が止まります。

| 場所 | 理由 |
| --- | --- |
| Apps Scriptのコード | 保存・デプロイすると本番に影響します。 |
| GitHubのコード | GitHub PagesやGAS反映に影響します。 |
| Firebase Rules | 間違えると同期が止まるか、不要に公開されます。 |
| Script Propertiesのトークン | 消すとLINE通知や認証が止まります。 |
| `checklist_run_items` のID列 | チェック状態の紐付けが壊れます。 |

## 月1回の確認

月初または月末に確認します。

1. `notification_channel_usage` の `remaining_count` を確認する。
2. 残数が少ない通知アカウントがあれば、公式アカウント追加を検討する。
3. 退職者が `notification_recipients` に残っていないか確認する。
4. テンプレートが実際の業務とズレていないか確認する。
5. 管理者IDとパスワードの管理者が分かる状態になっているか確認する。

## 開発者に連絡する条件

以下は運用担当者だけで直さず、開発者に連絡してください。

1. GASの実行ログで赤いエラーが続く。
2. GitHub Actionsが失敗している。
3. LIFF画面が全員で開けない。
4. Spreadsheetの列を間違えて消した。
5. Firebase Rulesを変更してから画面同期が止まった。
6. LINE DevelopersやMessaging APIの設定画面で迷った。

## 公式情報

料金やトリガーの仕様は変更されることがあります。最新情報は公式ページで確認してください。

- LINE Messaging APIの料金: https://developers.line.biz/ja/docs/messaging-api/pricing/
- Apps Scriptのインストール型トリガー: https://developers.google.com/apps-script/guides/triggers/installable
- Apps Script ClockTriggerBuilder: https://developers.google.com/apps-script/reference/script/clock-trigger-builder
