# 会社共有チェックリスト LINE Bot（GAS + Firestore 同期）

`tasks.md` を正として実装を進めるリポジトリです。  
現行運用は `LIFF (GitHub Pages) + GAS API + Spreadsheet` を主系にし、Firestore はリアルタイム同期の read に使います。

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
- Firestore: `events` / `snapshots/today` のリアルタイム read

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
   - `firebase.apiKey` / `firebase.authDomain` / `firebase.projectId` / `firebase.appId`
   - `functionsApiBaseUrl` は空文字で運用可能
3. GitHub Pages を有効化し、`pages/` を公開する。
4. LINE Developers の LIFF Endpoint URL を `https://<user>.github.io/<repo>/` に設定する。
5. LIFF URL（`https://liff.line.me/<LIFF_ID>`）をLINEリッチメニューに設定する。

## リアルタイム同期（Firestore）
- `enableRealtimeSync=true` かつ `firebase` 設定済みのときだけ有効。
- イベント読取: `stores/{storeId}/runs/{targetDate}/events/*`
- スナップショット読取: `stores/{storeId}/runs/{targetDate}/snapshots/today`
- 統計タブは `snapshots/today` をクライアント集計する。
- Firestore Rules は [docs/operations/firestore.rules](/home/sota411/Documents/project/ogawaya/docs/operations/firestore.rules) を適用する。

## 0:30 未完了通知
- 複数のLINE公式アカウントを `notification_channels` に登録し、従業員を `notification_recipients` で割り当てる。
- 送信元チャネルは `notifications.channel_id` に残る。
- 月間送信数は `notification_channel_usage` の `local_sent_count` / `remaining_count` で確認する。
- 公式アカウントの無料枠は1アカウントあたり月200通を標準値にする。LINE公式情報では日本のCommunication Planは月200通まで無料、Push messagesは通数カウント対象。
- 運用手順は [docs/operations/line-notification-scaling.md](/home/sota411/Documents/project/ogawaya/docs/operations/line-notification-scaling.md) を参照する。

詳細手順は [docs/operations/bootstrap.md](/home/sota411/Documents/project/ogawaya/docs/operations/bootstrap.md) を参照してください。
