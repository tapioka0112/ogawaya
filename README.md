# 会社共有チェックリスト LINE Bot（Firebase Spark 主系）

`tasks.md` を正として実装を進めるリポジトリです。  
現行運用は `LIFF (GitHub Pages) + Firebase Auth + Firestore + GitHub Actions` を主系にします。GAS と Firebase Functions は本番運用の主系として使いません。

## 確定仕様（tasks.md 準拠）
- 初期版は `1ユーザー = 1店舗` 前提。
- 当日判定は日本時間 10:30 切替（`10:30〜翌10:29` を同じ運用日として扱う）。
- 日次ジョブは GitHub Actions で 10:35 開始処理、00:35 未完了通知を実行する。
- チェック実行者は Firestore の `checkedBy` と `checkedByUserId` に保存する。
- 更新系は Firebase Auth のログイン状態が必須。

## 構成
- API/バックエンド: Firestore 直接書き込みと GitHub Actions (`scripts/`)
- 正本データ: Firestore
- LIFF フロント: GitHub Pages (`pages/`)
- 管理者画面: GitHub Pages (`pages/admin.html`)
- Firestore: タスク、テンプレート、日別実行項目、ユーザー、管理者allowlistを保存

## 運用手順
- 非IT担当者向けの現行運用説明書は [docs/operations/non-it-operator-guide.md](/home/sota411/Documents/project/ogawaya/docs/operations/non-it-operator-guide.md) を参照してください。
- Firebase Spark 主系の技術運用は [docs/operations/firebase-spark-primary.md](/home/sota411/Documents/project/ogawaya/docs/operations/firebase-spark-primary.md) を参照してください。
- 旧GAS主系の参考資料は [docs/operations/bootstrap.md](/home/sota411/Documents/project/ogawaya/docs/operations/bootstrap.md) に残っています。

## ディレクトリ
- [docs/](/home/sota411/Documents/project/ogawaya/docs)
- [pages/](/home/sota411/Documents/project/ogawaya/pages)
- [scripts/](/home/sota411/Documents/project/ogawaya/scripts)
- [tasks.md](/home/sota411/Documents/project/ogawaya/tasks.md)

## ローカル準備
- Node.js をインストール
- `npm ci`

## テスト
- `npm test`

## 必要な本番設定
- Firebase Authentication: Email/Password と Anonymous を有効化する。
- Firestore Rules: [docs/operations/firestore.rules](/home/sota411/Documents/project/ogawaya/docs/operations/firestore.rules) を適用する。
- 管理者: Firebase Auth のUIDを `stores/store-hashimoto/admins/{uid}` に登録する。
- GitHub Actions secrets:
  - `FIREBASE_SERVICE_ACCOUNT_JSON`
  - `LINE_CHANNEL_ACCESS_TOKEN`
- GitHub Actions variables:
  - `STORE_ID`。未設定時は `store-hashimoto` を使う。

## 自動処理
- `Deploy LIFF Pages`: `pages/` を GitHub Pages へ公開する。
- `Daily start`: JST 10:35 に `scripts/daily-start.mjs` を実行し、当日分タスクを作成する。
- `Incomplete reminder`: JST 00:35 に `scripts/incomplete-reminder.mjs` を実行し、前日分の未完了通知を送る。

## Firestore同期
- チェック操作、テンプレート挿入、日付内タスク削除は Firestore へ直接保存する。
- リアルタイム同期用イベントは `stores/{storeId}/runs/{targetDate}/events/*` に保存する。
- 日別タスクは `stores/{storeId}/runs/{targetDate}/items/*` に保存する。
- 統計タブは Firestore の日別データをクライアントで集計する。

## LIFF 起動時間の計測
- `pages/` のURLに `?debugTiming=1` を付けると、起動時間のウォーターフォールを画面下部とブラウザconsoleに表示する。
- 解除する場合は `localStorage.removeItem('ogawaya:debug-timing')` を実行する。
