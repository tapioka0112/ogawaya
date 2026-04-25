# 会社共有チェックリスト LINE Bot（GAS + Firestore 同期）

`tasks.md` を正として実装を進めるリポジトリです。  
現行運用は `LIFF (GitHub Pages) + GAS API + Spreadsheet` を主系にし、Firestore はチェック操作の高速反映とリアルタイム同期に使います。

## 確定仕様（tasks.md 準拠）
- 初期版は `1ユーザー = 1店舗` 前提。
- 当日判定は日本時間 10:30 切替（`10:30〜翌10:29` を同じ運用日として扱う）。
- 日次ジョブは 10:30 開始処理、0:30 未完了通知、0:00 締め処理を想定。
- チェック実行者は `checked_by_name` に LINE 表示名で保存する。
- `ALLOW_ANONYMOUS_ACCESS` は閲覧フォールバック用途（更新系は `idToken` 必須）。

## 構成
- API/バックエンド: GAS (`gas/src`)
- 正本データ: Spreadsheet
- LIFF フロント: GitHub Pages (`pages/`)
- 管理者画面: GitHub Pages (`pages/admin.html`)
- Firestore: `events` の create/read、`snapshots/today` の read

## 運用手順
- 非IT担当者向けの全体運用手順は [docs/operations/non-technical-operations.md](/home/sota411/Documents/project/ogawaya/docs/operations/non-technical-operations.md) を参照してください。
- 初期構築やScript Propertiesの詳細は [docs/operations/bootstrap.md](/home/sota411/Documents/project/ogawaya/docs/operations/bootstrap.md) を参照してください。
- 通知用LINE公式アカウントの増設・人数調整は [docs/operations/line-notification-scaling.md](/home/sota411/Documents/project/ogawaya/docs/operations/line-notification-scaling.md) を参照してください。

## ディレクトリ
- [gas/](/home/sota411/Documents/project/ogawaya/gas)
- [docs/](/home/sota411/Documents/project/ogawaya/docs)
- [pages/](/home/sota411/Documents/project/ogawaya/pages)
- [tasks.md](/home/sota411/Documents/project/ogawaya/tasks.md)

## ローカル準備
- Node.js をインストール
- `clasp` をインストール
  - `npm i -g @google/clasp`
- `clasp login`

## テスト
- `npm test`

## デプロイ準備
1. GAS 側 Script Properties を設定する。
   - `SPREADSHEET_ID`
   - `LINE_CHANNEL_ID`
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_ACCESS_TOKEN_NOTIFY_01` 以降（0:30未完了通知用）
   - `LIFF_ID`
   - `CHECKLIST_APP_URL`
   - `ADMIN_LOGIN_ID`
   - `ADMIN_LOGIN_PASSWORD`
2. `pages/config.json` を設定する。
   - `gasApiBaseUrl`
   - `liffId`
   - `defaultStoreId`
   - `enableRealtimeSync`
   - `clientFirestoreWriteEnabled`
   - `firebase.apiKey` / `firebase.authDomain` / `firebase.projectId` / `firebase.appId`
   - `functionsApiBaseUrl` は空文字で運用可能
3. GitHub Pages を有効化し、`pages/` を公開する。
4. LINE Developers の LIFF Endpoint URL を `https://<user>.github.io/<repo>/` に設定する。
5. LIFF URL（`https://liff.line.me/<LIFF_ID>`）をLINEリッチメニューに設定する。

## リアルタイム同期（Firestore）
- `enableRealtimeSync=true` かつ `firebase` 設定済みのときだけ有効。
- `clientFirestoreWriteEnabled=true` のとき、チェック操作は Firestore `events` へ先に書き込み、GAS API は保存用にバックグラウンド同期する。
- イベント作成・読取: `stores/{storeId}/runs/{targetDate}/events/*`
- スナップショット読取: `stores/{storeId}/runs/{targetDate}/snapshots/today`
- `snapshots/today` が未作成の運用日でも、LIFF は同日分の端末キャッシュを先に描画し、Firestore `events` とGAS APIで追従する。
- 統計タブは `snapshots/today` をクライアント集計する。
- Firestore 直接書き込みには Firebase Authentication の匿名ログインを使う。
- Firestore Rules は [docs/operations/firestore.rules](/home/sota411/Documents/project/ogawaya/docs/operations/firestore.rules) を適用する。

## LIFF 起動時間の計測
- `pages/` のURLに `?debugTiming=1` を付けると、起動時間のウォーターフォールを画面下部とブラウザconsoleに表示する。
- 表示対象は `config.json`、Firestore snapshot/cache、LIFF SDK、`liff.init`、GAS API、初回描画までの時間。
- LIFF URLでクエリを付けにくい場合は、ブラウザconsoleで `localStorage.setItem('ogawaya:debug-timing', '1')` を実行してから再読み込みする。
- 解除する場合は `localStorage.removeItem('ogawaya:debug-timing')` を実行する。

## 0:30 未完了通知
- 複数のLINE公式アカウントを `notification_channels` に登録し、従業員を `notification_recipients` で割り当てる。
- 送信元チャネルは `notifications.channel_id` に残る。
- 月間送信数は `notification_channel_usage` の `local_sent_count` / `remaining_count` で確認する。
- 公式アカウントの無料枠は1アカウントあたり月200通を標準値にする。LINE公式情報では日本のCommunication Planは月200通まで無料、Push messagesは通数カウント対象。
- 運用手順は [docs/operations/line-notification-scaling.md](/home/sota411/Documents/project/ogawaya/docs/operations/line-notification-scaling.md) を参照する。

詳細手順は [docs/operations/bootstrap.md](/home/sota411/Documents/project/ogawaya/docs/operations/bootstrap.md) を参照してください。
