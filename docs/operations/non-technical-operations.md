# おがわやチェックリスト 運用手順書

この手順書は、プログラムを書かない運用担当者が毎日の運用を行うための最新版です。
古い手順書の内容は引き継がず、現在のリポジトリ設定とコードから確認できた内容で作り直しています。

## 1. まず開くURL

| 用途 | URL |
| --- | --- |
| 従業員がLINEで開く画面 | `https://liff.line.me/2009859108-sJ31BCFx` |
| 従業員用Web画面 | `https://tapioka0112.github.io/ogawaya/` |
| 管理者画面 | `https://tapioka0112.github.io/ogawaya/admin.html` |
| Googleスプレッドシート | `https://docs.google.com/spreadsheets/d/1VBTZaLtSi1FZQnWG-zIDQ1GFpoHilAUpf1R7xcllLP8/edit?gid=2082526106#gid=2082526106` |
| GitHubリポジトリ | `https://github.com/tapioka0112/ogawaya` |
| GitHub Pages設定 | `https://github.com/tapioka0112/ogawaya/settings/pages` |
| Apps Script編集画面 | `https://script.google.com/d/1q7LLKLs4l_mH2gE9VmaxdX0Ilrbt9BLuOSTZXlOZIPxukh7FH7zHeMHd/edit` |
| GAS API | `https://script.google.com/macros/s/AKfycbwHus8fdYWaLzkL0qrj6mX2rEDBphVlqWA4IAzETnsNXmanUgD5xLiMZZooGkeLI4pbMg/exec` |
| Firebase Console | `https://console.firebase.google.com/project/owagaya-fd93b/overview` |
| Firestore Rules | `https://console.firebase.google.com/project/owagaya-fd93b/firestore/rules` |
| LINE Official Account Manager | `https://manager.line.biz/` |
| LINE Developers Console | `https://developers.line.biz/console/` |

Googleスプレッドシートは運用中の本番データに直結します。URLを社外へ共有しないでください。

## 2. このシステムの基本

| 項目 | 内容 |
| --- | --- |
| 1日の切替 | 日本時間 `10:30`。`10:30` から翌日 `10:29` までが同じ営業日です。 |
| 今日のタスク作成 | Apps Scriptの `runDailyStart` が毎日 `10:30` に作ります。 |
| 未完了通知 | `runDailyIncompleteReminder` が `0:30` に送ります。 |
| データの正本 | Googleスプレッドシートです。 |
| 画面の公開場所 | GitHub Pagesです。GitHub Actionsの `Deploy LIFF Pages` が `pages/` を公開します。 |
| 保存API | GAS APIです。 |
| 画面の高速同期 | Firebase Firestore の `events` と `snapshots/today` を使います。 |
| チェックした人 | LIFF認証で取得したLINE表示名とユーザーIDで記録します。 |

普段の運用で触る順番は、管理者画面、Googleスプレッドシート、Apps Scriptの順です。
GitHub、Firebase、LINE Developersは、設定変更や障害対応のときだけ触ります。

## 3. 毎日やること

### 従業員がタスクをチェックする

1. LINE公式アカウントのリッチメニューからチェックリストを開く。
2. 開けない場合は、LINEアプリ内で `https://liff.line.me/2009859108-sJ31BCFx` を開く。
3. 今日のタスクを確認する。
4. 終わったタスクを押してチェック済みにする。
5. 間違えて押した場合は、もう一度押して未完了に戻す。
6. 統計タブで、自分の完了数と今月の達成状況を確認する。

PCブラウザでもWeb画面は開けますが、本人確認はLINEのLIFF認証を使います。通常はLINEアプリから開いてください。

### 管理者が確認する

1. `https://tapioka0112.github.io/ogawaya/admin.html` を開く。
2. 管理者IDとパスワードでログインする。
3. カレンダーで今日の日付を選ぶ。
4. 「タスクの管理」で、今日のタスクが正しく並んでいるか確認する。
5. 足りないタスクがあれば、管理者画面から追加する。
6. 不要なタスクがあれば、管理者画面から削除する。
7. 営業後に未完了タスクが残っていないか確認する。

管理者IDとパスワードは、Apps ScriptのScript Propertiesにある `ADMIN_LOGIN_ID` と `ADMIN_LOGIN_PASSWORD` です。値そのものはこの手順書に書きません。

## 4. 管理者画面の使い方

管理者画面は、LINE内の従業員画面から「管理者画面を開く」を押すか、直接 `https://tapioka0112.github.io/ogawaya/admin.html` を開いて使います。

### ログインする

1. 管理者画面を開く。
2. 「管理者ID」に `ADMIN_LOGIN_ID` の値を入力する。
3. 「パスワード」に `ADMIN_LOGIN_PASSWORD` の値を入力する。
4. 「ログイン」を押す。
5. 「タスク操作」が表示されたらログイン完了です。

### タスクを作成する

これは「後で日付に入れられるタスクの部品」を作る操作です。作成しただけでは今日のチェックリストには入りません。

1. 「タスクを作成」を押す。
2. 「タスク名」に名前を入力する。
3. 必要なら「詳細 (任意)」に説明を入力する。
4. 「タスクを作成」を押す。
5. 画面に「タスクを作成しました」と出ることを確認する。

### 作成済みタスクを指定日に入れる

1. カレンダーで追加したい日付を選ぶ。
2. 「タスクを挿入」を押す。
3. 「挿入するタスク」から追加したいタスクを選ぶ。
4. 「選択したタスクを挿入」を押す。
5. 「タスクの管理」に追加されたことを確認する。

### テンプレートを作成する

テンプレートは、複数タスクをまとめて追加するためのセットです。

1. 先に必要なタスクを「タスクを作成」で作っておく。
2. 「テンプレートを作成」を押す。
3. 「新規テンプレート名」に名前を入力する。
4. 「テンプレートに含めるタスク」で入れたいタスクにチェックを付ける。
5. 「テンプレートを作成」を押す。
6. 画面に「テンプレートを作成しました」と出ることを確認する。

### テンプレートを指定日に入れる

1. カレンダーで追加したい日付を選ぶ。
2. 「テンプレートを挿入」を押す。
3. 「挿入するテンプレート」から使いたいテンプレートを選ぶ。
4. 「選択したテンプレートを挿入」を押す。
5. 「タスクの管理」にテンプレート内のタスクが追加されたことを確認する。

テンプレート挿入は、画面へ先に反映され、その後GASへ保存されます。少し待って別端末にも表示されれば正常です。

### 日付に入っているタスクを削除する

これは「その日のチェックリストから外す」操作です。タスクの部品自体は残ります。

1. カレンダーで対象日を選ぶ。
2. 「タスクの管理」を見る。
3. 消したいタスクの右側にある「削除」を押す。
4. 一覧から消えたことを確認する。

## 5. 統計とカレンダーの見方

従業員画面の統計タブでは、Firestore snapshotを集計して表示します。

| 表示 | 意味 |
| --- | --- |
| 今月の達成状況 | タスクが全件完了した日数です。 |
| 自分が完了させたタスク数 | 自分のLINEユーザーIDでチェックした件数です。 |
| カレンダーの点 | その日にタスクがあることを示します。 |
| カレンダーのチェック | その日のタスクが全件完了したことを示します。 |
| カレンダーの選択枠 | 今、詳細を表示している日付です。 |

統計がおかしいときは、まずLINE画面を閉じて開き直します。
それでも直らない場合は、Firestore snapshotが古い、またはGAS保存が遅れている状態です。Apps Scriptの実行ログと `?debugTiming=1` の表示を確認します。

## 6. Apps Scriptで関数を実行する方法

1. Apps Script編集画面を開く。
2. 上部の関数選択欄を押す。
3. 実行したい関数名を選ぶ。
4. 「実行」を押す。
5. 初回だけ権限確認が出たら、運用アカウントで許可する。
6. 実行ログが「完了」になったことを確認する。

よく使う関数です。

| 関数名 | いつ使うか |
| --- | --- |
| `runDailyStart` | 今日のタスクが作られていないとき。通常は毎日 `10:30` のトリガーで自動実行されます。 |
| `runDailyClosing` | 締め処理を手動で確認したいとき。通常は毎日 `0:00` のトリガーで自動実行されます。 |
| `installReminderTriggers` | `0:30` 未完了通知のトリガーを作り直すとき。 |
| `runDailyIncompleteReminder` | 未完了通知を今すぐ手動で送るとき。 |
| `runReminderWatchdog` | 未完了通知の送信漏れ補正を手動確認するとき。 |
| `rebalanceNotificationRecipients` | 従業員や通知用LINE公式アカウントを増減した後。 |
| `syncNotificationChannelUsage` | 通知送信数を今すぐ集計し直したいとき。 |
| `bootstrapSpreadsheetTemplates` | 初期シートを作るとき。既存データがあるシートは上書きしません。 |

## 7. 自動処理とトリガー

Apps Scriptの「トリガー」画面で確認します。

| 関数名 | 予定 | 役割 |
| --- | --- | --- |
| `runDailyStart` | 毎日 `10:30` | 当日のチェックリストを作り、Firestore snapshotも保存します。 |
| `runDailyClosing` | 毎日 `0:00` | 営業日の締め処理をします。 |
| `runDailyIncompleteReminder` | 次回 `0:30` の1回限り | 未完了タスク通知を送ります。 |
| `runReminderWatchdog` | 15分おき | `0:30` 通知の送信漏れを補正します。 |

`runDailyIncompleteReminder` は毎日作り直される1回限りのトリガーです。見当たらない場合は `installReminderTriggers` を実行してください。

## 8. Googleスプレッドシートで触ってよい場所

基本は管理者画面を使います。Googleスプレッドシートを直接編集するのは、通知設定、従業員停止、緊急確認のときだけです。

| シート | 触ってよい作業 |
| --- | --- |
| `stores` | 店舗IDと店舗名の確認。 |
| `notification_channels` | 通知用LINE公式アカウントの追加、停止。 |
| `notification_recipients` | 従業員の通知対象化、退職者の停止。 |
| `notification_channel_usage` | 月間送信数の確認。 |
| `notifications` | 通知が送られたか、失敗したかの確認。 |

通常は直接編集しないシートです。

| シート | 理由 |
| --- | --- |
| `checklist_runs` | 毎日のチェックリスト本体です。 |
| `checklist_run_items` | 各タスクのチェック状態です。 |
| `checklist_item_logs` | 操作履歴です。 |
| `checklist_templates` | 管理者画面から作るテンプレート本体です。 |
| `checklist_template_items` | テンプレート内のタスクです。 |
| `line_accounts` | 旧連携用です。通常は使いません。 |
| `users` | 旧ユーザー管理用です。通常は使いません。 |

行を削除するより、`status` を `inactive` にする運用を優先してください。削除すると過去の履歴確認が難しくなります。

## 9. 従業員を追加する

1. 従業員にLINE公式アカウントを友だち追加してもらう。
2. 従業員にLINEアプリ内で `https://liff.line.me/2009859108-sJ31BCFx` を開いてもらう。
3. Googleスプレッドシートの `notification_recipients` を開く。
4. 従業員のLINE表示名が増えていることを確認する。
5. 対象者の `status` が `active` になっていることを確認する。
6. Apps Scriptで `rebalanceNotificationRecipients` を実行する。
7. `notification_recipients.channel_id` に `notify-01` などが入ったことを確認する。

`channel_id` が空の人には `0:30` の未完了通知を送れません。

## 10. 従業員を外す

1. Googleスプレッドシートの `notification_recipients` を開く。
2. 対象者の `status` を `inactive` にする。
3. Apps Scriptで `rebalanceNotificationRecipients` を実行する。
4. `notification_recipients.channel_id` の割当が更新されたことを確認する。
5. 必要なら、LINE公式アカウント側でも友だちやグループの整理をする。

## 11. 通知用LINE公式アカウントを増やす

未完了通知は、LINE公式アカウントの無料通数を超えないように複数アカウントへ分散します。
この運用では、1アカウントあたり月 `200` 通、1アカウントあたり `6` 人を目安にします。

| 人数 | 31日送った場合 | 判定 |
| --- | ---: | --- |
| 6人 | 186通 | 目安内 |
| 7人 | 217通 | 200通を超える |

追加手順です。

1. LINE Official Account Managerで新しい公式アカウントを作る。
2. LINE Developersで同じProvider配下にMessaging APIチャネルを作る。
3. Messaging API設定で長期チャネルアクセストークンを発行する。
4. Apps ScriptのScript Propertiesに `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_02` のような名前で保存する。
5. Googleスプレッドシートの `notification_channels` に1行追加する。
6. 追加した公式アカウントを、通知を受ける従業員に友だち追加してもらう。
7. Apps Scriptで `rebalanceNotificationRecipients` を実行する。
8. `notification_recipients.channel_id` に新しい `notify-02` などが割り当たったことを確認する。

`notification_channels` に入れる例です。

| 列 | 入れる値 |
| --- | --- |
| `id` | `notify-02` |
| `store_id` | `store-hashimoto` |
| `name` | `通知アカウント2` |
| `access_token_property` | `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_02` |
| `monthly_limit` | `200` |
| `recipient_limit` | `6` |
| `status` | `active` |
| `created_at` | 追加した日時。例: `2026-04-25T00:00:00Z` |
| `updated_at` | 更新した日時。例: `2026-04-25T00:00:00Z` |

## 12. 送信数を確認する

Googleスプレッドシートの `notification_channel_usage` を見ます。

| 列 | 意味 |
| --- | --- |
| `channel_id` | どの通知アカウントか。 |
| `year_month` | 対象月。 |
| `monthly_limit` | 月の上限。 |
| `local_sent_count` | このシステムが送った数。 |
| `remaining_count` | 残り送信可能数。 |
| `last_synced_at` | 最後に更新された時刻。 |
| `error_message` | 更新失敗時の理由。 |

今すぐ再集計したい場合は、Apps Scriptで `syncNotificationChannelUsage` を実行します。

## 13. LINE公式アカウントとLIFFの設定確認

この章は、初期構築や再設定のときに使います。日々の運用では毎回触りません。

### LINE公式アカウントを作る

1. `https://manager.line.biz/` を開く。
2. LINEアカウントでログインする。
3. アカウントリストから「作成」を押す。
4. 店舗や通知用途が分かる名前で公式アカウントを作る。
5. 作成後、該当アカウントを開く。
6. 「設定」からMessaging APIを有効化する。

### LINE DevelopersでMessaging APIを確認する

1. `https://developers.line.biz/console/` を開く。
2. 対象Providerを開く。
3. Messaging APIチャネルを開く。
4. 「Channel ID」をScript Propertiesの `LINE_CHANNEL_ID` に入れる。
5. 「Channel secret」を `LINE_CHANNEL_SECRET` に入れる。
6. 「Messaging API設定」でチャネルアクセストークンを発行し、`LINE_CHANNEL_ACCESS_TOKEN` に入れる。
7. 通常は、LINE公式アカウントのリッチメニューからLIFF URLを直接開く設定にする。
8. Webhookを使う運用にしている場合だけ、Webhook URLに次を設定する。

```text
https://script.google.com/macros/s/AKfycbwHus8fdYWaLzkL0qrj6mX2rEDBphVlqWA4IAzETnsNXmanUgD5xLiMZZooGkeLI4pbMg/exec?path=/webhook
```

9. Webhookを使う運用の場合はWebhook利用を有効にする。リッチメニューのURIだけで運用する場合は必須ではありません。

### LINE DevelopersでLIFFを確認する

1. LINE Loginチャネルを開く。
2. LIFFタブを開く。
3. LIFF IDが `2009859108-sJ31BCFx` であることを確認する。
4. Endpoint URLが `https://tapioka0112.github.io/ogawaya/` であることを確認する。
5. Scopeに `openid` と `profile` が含まれることを確認する。
6. 必要に応じて、LINE公式アカウントのリッチメニューから `https://liff.line.me/2009859108-sJ31BCFx` を開けるように設定する。

## 14. GAS Script Properties

Apps Script編集画面で「プロジェクトの設定」を開き、「スクリプト プロパティ」を確認します。

| キー | 用途 |
| --- | --- |
| `SPREADSHEET_ID` | 正本データのGoogleスプレッドシートID。 |
| `LINE_LOGIN_CHANNEL_ID` | LIFFのID token検証に使うLINE Login channel ID。 |
| `LINE_CHANNEL_ID` | Messaging APIのチャネルID。 |
| `LINE_CHANNEL_SECRET` | Webhook署名検証に使う秘密値。 |
| `LINE_CHANNEL_ACCESS_TOKEN` | メイン公式アカウントの送信用アクセストークン。 |
| `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01` | 未完了通知用公式アカウント1つ目のアクセストークン。 |
| `LIFF_ID` | `2009859108-sJ31BCFx`。 |
| `CHECKLIST_APP_URL` | `https://tapioka0112.github.io/ogawaya/`。 |
| `FIREBASE_PROJECT_ID` | `owagaya-fd93b`。 |
| `ADMIN_LOGIN_ID` | 管理者画面のログインID。 |
| `ADMIN_LOGIN_PASSWORD` | 管理者画面のパスワード。 |
| `ADMIN_SESSION_TTL_SECONDS` | 管理者ログインの有効秒数。通常 `43200`。 |
| `ALLOW_ANONYMOUS_ACCESS` | 通常 `false`。閲覧フォールバックを許可する場合だけ `true`。 |
| `DEBUG_EVENT_SHEET_ENABLED` | 通常 `false`。debug_eventsへ記録したい場合だけ `true`。 |
| `SPREADSHEET_STATE_CACHE_ENABLED` | 通常 `true`。 |
| `SPREADSHEET_STATE_CACHE_TTL_SECONDS` | 通常 `300`。 |
| `SPREADSHEET_STATE_CACHE_CHUNK_SIZE` | 通常 `90000`。 |

秘密値を変更したら、必ず小さな確認をします。例として管理者ログイン、LINE画面表示、未完了通知の手動実行です。

## 15. GitHub Pagesと設定ファイル

画面はGitHub Pagesから配信されています。

| ファイル | 役割 |
| --- | --- |
| `pages/index.html` | 従業員画面のHTML。 |
| `pages/app.js` | 従業員画面の動き。 |
| `pages/admin.html` | 管理者画面のHTML。 |
| `pages/admin.js` | 管理者画面の動き。 |
| `pages/config.json` | GAS API、LIFF、Firebaseの接続先。 |

現行 `pages/config.json` の重要値です。

| キー | 現行値 |
| --- | --- |
| `gasApiBaseUrl` | `https://script.google.com/macros/s/AKfycbwHus8fdYWaLzkL0qrj6mX2rEDBphVlqWA4IAzETnsNXmanUgD5xLiMZZooGkeLI4pbMg/exec` |
| `liffId` | `2009859108-sJ31BCFx` |
| `defaultStoreId` | `store-hashimoto` |
| `enableRealtimeSync` | `true` |
| `clientFirestoreWriteEnabled` | `true` |
| `consistencyRefreshSeconds` | `30` |
| `firebase.projectId` | `owagaya-fd93b` |

GitHub Pagesの公開元はGitHubのSettingsから確認します。このリポジトリでは `.github/workflows/pages.yml` の `Deploy LIFF Pages` が、`pages/` 配下をGitHub Pagesへ公開します。

## 16. Firebaseの確認

Firebase projectは `owagaya-fd93b` です。

確認する場所です。

| 場所 | 確認すること |
| --- | --- |
| Authentication | Sign-in methodでAnonymousが有効。 |
| Firestore Database | データベースが作成済み。 |
| Firestore Rules | `firebase/firestore.rules` と同じ内容が公開済み。 |
| Project settings | Web appの `apiKey`, `authDomain`, `projectId`, `appId` が `pages/config.json` と一致。 |

Firestoreで使う場所です。

| パス | 用途 |
| --- | --- |
| `stores/{storeId}/runs/{targetDate}/events/*` | チェックやテンプレート挿入をリアルタイム同期するイベント。 |
| `stores/{storeId}/runs/{targetDate}/snapshots/today` | 初回表示と統計用の当日snapshot。 |

Firestore Rulesは、`events` の読み取りと認証済み作成、`snapshots/today` の読み取りだけを許可します。それ以外は拒否します。

## 17. 初期構築で最低限やること

日々の運用では不要です。環境を作り直すときだけ使います。

1. Googleスプレッドシートを用意する。
2. Apps ScriptのScript Propertiesに `SPREADSHEET_ID` を入れる。
3. Apps Scriptで `bootstrapSpreadsheetTemplates` を実行する。
4. `stores` と `checklist_templates` と `checklist_template_items` を実データに直す。
5. LINE公式アカウントを作る。
6. LINE DevelopersでMessaging APIとLINE Login/LIFFを設定する。
7. Script PropertiesにLINE関連の値を入れる。
8. `pages/config.json` の値が実環境と一致していることを確認する。
9. Firebase AuthenticationのAnonymousを有効にする。
10. Firestore Rulesを公開する。
11. GASをWebアプリとしてデプロイする。
12. LINEのWebhook URLとLIFF Endpoint URLを確認する。
13. LINE公式アカウントのリッチメニューにLIFF URLを設定する。
14. Apps Scriptで `runDailyStart` を実行し、今日のタスクが開けることを確認する。
15. Apps Scriptで `installReminderTriggers` を実行する。

## 18. よくあるトラブル

### チェックリストが表示されない

1. LINEアプリ内で `https://liff.line.me/2009859108-sJ31BCFx` を開いているか確認する。
2. `https://tapioka0112.github.io/ogawaya/` が開けるか確認する。
3. 今日の運用日が `10:30` 切替で合っているか確認する。
4. Googleスプレッドシートの `checklist_runs` に今日の行があるか確認する。
5. 行がなければ、Apps Scriptで `runDailyStart` を実行する。
6. それでも出ない場合は、Apps Scriptの実行ログを確認する。

### チェックした人が正しく表示されない

1. LINEアプリから開いているか確認する。
2. PCブラウザだけで開いていないか確認する。
3. LINE DevelopersのLIFF scopeに `openid` と `profile` があるか確認する。
4. LIFF画面を閉じて開き直す。

### 管理者画面にログインできない

1. Apps ScriptのScript Propertiesを開く。
2. `ADMIN_LOGIN_ID` を確認する。
3. `ADMIN_LOGIN_PASSWORD` を確認する。
4. 前後に余計な空白がないか確認する。
5. それでも失敗する場合は、Apps Scriptの実行ログで `/api/admin/login` のエラーを見る。

### タスクを追加したのに他の端末へ出ない

1. 管理者画面で同じ日付を選び直す。
2. 従業員画面を閉じて開き直す。
3. Firebase AuthenticationのAnonymousが有効か確認する。
4. Firestore Rulesが現行 `firebase/firestore.rules` と同じか確認する。
5. GAS APIが成功しているかApps Scriptの実行ログを見る。

### 0:30の通知が届かない

1. `notification_recipients` に対象者がいるか確認する。
2. 対象者の `status` が `active` か確認する。
3. 対象者の `channel_id` が空でないか確認する。
4. `notification_channels` の対象行が `active` か確認する。
5. Script Propertiesに `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01` などがあるか確認する。
6. Apps Scriptのトリガーに `runDailyIncompleteReminder` と `runReminderWatchdog` があるか確認する。
7. なければ `installReminderTriggers` を実行する。
8. `notifications` の `status` と `error_message` を確認する。

### Firebase設定エラーが出る

1. Firebase Consoleを開く。
2. projectが `owagaya-fd93b` であることを確認する。
3. Firestore Databaseが作成済みか確認する。
4. AuthenticationのAnonymousが有効か確認する。
5. Firestore Rulesが公開済みか確認する。
6. `pages/config.json` のFirebase設定とFirebase ConsoleのWeb app設定が一致するか確認する。

### `snapshotAuthorizationStatus=REQUIRED` が出る

1. LIFF画面に `?debugTiming=1` を付けて開く。
2. 表示された `snapshotAuthorizationUrl` をコピーする。
3. GASをデプロイしたGoogleアカウントでURLを開く。
4. Firestore snapshot保存に必要な権限を承認する。
5. LIFF画面を開き直し、`snapshotSync=ok` になることを確認する。

## 19. 触らない方がよいもの

| 場所 | 理由 |
| --- | --- |
| Apps Scriptのコード | 保存やデプロイで本番に影響します。 |
| GitHubのコード | GitHub PagesとGAS反映に影響します。 |
| Firebase Rules | 間違えると同期が止まるか、不要に公開されます。 |
| Script Propertiesのトークン | 消すとLINE通知や認証が止まります。 |
| `checklist_run_items` のID列 | チェック状態の紐付けが壊れます。 |

## 20. 月1回の確認

1. `notification_channel_usage.remaining_count` を確認する。
2. 残数が少ない通知アカウントがあれば、通知用LINE公式アカウントを増やす。
3. 退職者が `notification_recipients` に `active` のまま残っていないか確認する。
4. テンプレートが実際の業務とズレていないか確認する。
5. 管理者IDとパスワードの保管者が分かる状態になっているか確認する。
6. GitHub PagesとGAS API URLが現行と一致しているか確認する。

## 21. 開発者に連絡する条件

次の場合は、運用担当者だけで直さず開発者に連絡してください。

1. Apps Scriptの実行ログで赤いエラーが続く。
2. GitHub Pagesの画面が全員で開けない。
3. Firebase Rulesを変更してから同期が止まった。
4. Spreadsheetの列やIDを消した。
5. LINE Developersのチャネル設定を変更した後に認証できない。
6. `pages/config.json` を変更する必要がある。

## 22. 公式情報

外部サービスの画面や料金は変わります。迷ったら以下の公式情報を確認してください。

- LINE LIFFアプリ追加: https://developers.line.biz/en/docs/liff/registering-liff-apps/
- LINE LIFF開発: https://developers.line.biz/en/docs/liff/developing-liff-apps
- LINE Messaging API概要: https://developers.line.biz/en/docs/messaging-api/overview/
- LINE Messaging API Webhook: https://developers.line.biz/en/docs/messaging-api/receiving-messages/
- LINE公式アカウント管理画面: https://manager.line.biz/
- LINE Official Account Manager基本操作: https://www.lycbiz.com/jp/manual/OfficialAccountRestaurant/basic/
- Apps Script Webアプリ: https://developers.google.com/apps-script/guides/web
- Apps Scriptデプロイ: https://developers.google.com/apps-script/concepts/deployments
- Firebase Security Rules管理: https://firebase.google.com/docs/rules/manage-deploy
- GitHub Pages公開元設定: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
