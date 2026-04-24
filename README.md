# 会社共有チェックリスト LINE Bot（GAS + Firestore 同期）

`tasks.md` を正として実装を進めるリポジトリです。  
現行運用は `LIFF (GitHub Pages) + GAS API + Spreadsheet` を主系にし、Firestore はリアルタイム同期の read に使います。

## 確定仕様（tasks.md 準拠）
- 初期版は `1ユーザー = 1店舗` 前提。
- 当日判定は日本時間 10:30 切替（`10:30〜翌10:29` を同じ運用日として扱う）。
- 日次ジョブは 10:30 開始通知、0:00 締め処理を想定。
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
   - `LIFF_ID`
   - `ADMIN_LOGIN_ID`
   - `ADMIN_LOGIN_PASSWORD`
   - `LINE_WEBHOOK_TOKEN`（LINE Webhook URL に付ける静的 token）
   - `LINE_REMINDER_SOURCE_IDS`（未完了一覧返信を許可する groupId / roomId）
   - `CHECKLIST_APP_URL`（通知本文に入れる GitHub Pages URL）
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

## LINEカレンダー起点の未完了一覧返信
- LINEカレンダーの予定名は `残りタスク通知` にします。
- Webhook URL は `GAS_WEB_APP_URL?path=webhook&token=<LINE_WEBHOOK_TOKEN>` を設定します。
- 初回検証時は `LINE_REMINDER_SOURCE_IDS` を未設定にして、`debug_events` の `webhook.message` から `sourceId` を確認します。
- 確認した `sourceId` を `LINE_REMINDER_SOURCE_IDS` に設定すると、そのグループ/ルームだけReply APIで未完了一覧を返します。
- GAS Web App では `X-Line-Signature` ヘッダーを直接読めないため、GAS単体運用では静的 `token` を併用します。

## リアルタイム同期（Firestore）
- `enableRealtimeSync=true` かつ `firebase` 設定済みのときだけ有効。
- イベント読取: `stores/{storeId}/runs/{targetDate}/events/*`
- スナップショット読取: `stores/{storeId}/runs/{targetDate}/snapshots/today`
- 統計タブは `snapshots/today` をクライアント集計する。
- Firestore Rules は [docs/operations/firestore.rules](/home/sota411/Documents/project/ogawaya/docs/operations/firestore.rules) を適用する。

詳細手順は [docs/operations/bootstrap.md](/home/sota411/Documents/project/ogawaya/docs/operations/bootstrap.md) を参照してください。
